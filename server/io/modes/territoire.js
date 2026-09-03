/**
 * TERRITOIRE — le Paper.io du bar
 *
 * Chaque joueur est un point coloré qui laisse une traînée derrière lui. Revenir
 * sur son propre territoire referme la boucle et conquiert tout l'intérieur.
 * Toucher une traînée (la sienne ou celle d'un autre) tue son propriétaire.
 *
 * Choix de conception, tous dictés par la salle :
 *
 * - **Une grille, pas de la géométrie.** Le remplissage de boucle se fait par
 *   coloriage par diffusion depuis les bords (le complément de la zone atteinte
 *   est l'intérieur), le même principe que le détourage de CouleurMoi. C'est
 *   robuste, borné, et ça évite toute intersection de polygones.
 * - **La grille est petite (80×45).** Elle tient dans un instantané, se lit de
 *   loin en gros pavés, et rend la conquête visible depuis le fond du bar.
 * - **On meurt, on revient.** Trois secondes, et le joueur réapparaît avec un
 *   carré neuf : personne n'est éliminé d'une manche, ce qui est la condition
 *   pour que quelqu'un qui arrive à 23 h puisse jouer.
 */

/**
 * Tailles de terrain proposées à l'hôte au moment d'ouvrir le salon.
 *
 * La carte n'est plus figée : sur une grande carte, personne ne voit tout, et
 * chaque joueur navigue avec sa propre caméra rapprochée. C'est ce qui donne la
 * sensation d'un monde à conquérir plutôt que d'un plateau.
 *
 * `spawnSpacing` suit la taille : sur un grand terrain, faire apparaître les
 * joueurs à dix cases les uns des autres les collerait au même endroit.
 */
const SIZES = {
    petit:  { cols: 80,  rows: 45,  label: 'Petit',      spawnSpacing: 14 },
    moyen:  { cols: 120, rows: 70,  label: 'Moyen',      spawnSpacing: 20 },
    grand:  { cols: 200, rows: 120, label: 'Grand',      spawnSpacing: 30 },
    immense:{ cols: 320, rows: 180, label: 'Immense',    spawnSpacing: 42 },
};
const DEFAULT_SIZE = 'moyen';

const CELL = 20;                    // taille logique d'une case (le client met à l'échelle)

const SPEED = 130;                  // unités par seconde
const TURN_RATE = 4.2;              // radians par seconde (braquage progressif)
const RESPAWN_MS = 3000;
const SPAWN_HALF = 2;               // demi-côté du carré de départ, en cases
// Brève immunité à l'apparition : sans elle, réapparaître à côté d'une mêlée
// tue avant même que le joueur ait vu son point à l'écran.
const SPAWN_SHIELD_MS = 1500;

const EMPTY = 0;                    // valeur de case : 0 = neutre, sinon index joueur

/**
 * Identité d'un joueur : une couleur **et** une forme.
 *
 * La forme n'est pas décorative, elle est nécessaire. Mesuré : sur six joueurs,
 * aucune palette ne reste lisible pour toutes les visions — l'optimisation
 * plafonne à un écart de 1,12 entre les deux couleurs les plus proches une fois
 * simulées la deutéranopie, la protanopie et la tritanopie (il en faut ~1,2).
 * La couleur seule condamnerait donc un daltonien à confondre deux joueurs.
 *
 * La forme porte l'identité, la couleur la renforce : à dix mètres tout le monde
 * lit la couleur, et celui qui ne la distingue pas lit la forme. Les deux se
 * retrouvent à l'identique sur le classement.
 *
 * Les couleurs sont ordonnées par luminance décroissante : les premiers joueurs
 * arrivés prennent les teintes les plus lumineuses, donc les plus lisibles.
 */
const IDENTITIES = [
    { color: '#22D3EE', shape: 'circle' },    // cyan
    { color: '#FFE44D', shape: 'square' },    // jaune
    { color: '#FB3B4E', shape: 'triangle' },  // rouge
    { color: '#4ADE80', shape: 'hexagon' },   // vert
    { color: '#C084FC', shape: 'diamond' },   // violet
    { color: '#FB923C', shape: 'star' },      // orange
];

const COLORS = IDENTITIES.map((i) => i.color);

// ─────────────────────────────────────────────────────────────────────────────
// Utilitaires de grille
// ─────────────────────────────────────────────────────────────────────────────

// Les dimensions vivent désormais dans l'état de la partie : ces aides les
// prennent en argument plutôt que de lire des constantes de module.
const idx = (cols, cx, cy) => cy * cols + cx;
const inside = (cols, rows, cx, cy) => cx >= 0 && cy >= 0 && cx < cols && cy < rows;

function cellOf(cols, rows, x, y) {
    return {
        cx: Math.max(0, Math.min(cols - 1, Math.floor(x / CELL))),
        cy: Math.max(0, Math.min(rows - 1, Math.floor(y / CELL))),
    };
}

/** Résout la taille demandée, en retombant sur le défaut si elle est inconnue. */
function resolveSize(sizeId) {
    return SIZES[sizeId] || SIZES[DEFAULT_SIZE];
}

// ─────────────────────────────────────────────────────────────────────────────
// Cycle de vie
// ─────────────────────────────────────────────────────────────────────────────

function init(ctx) {
    // La taille du terrain est choisie par l'hôte à l'ouverture du salon.
    const size = resolveSize(ctx.settings?.sizeId);
    ctx.state.cols = size.cols;
    ctx.state.rows = size.rows;
    ctx.state.spawnSpacing = size.spawnSpacing;
    ctx.world.width = size.cols * CELL;
    ctx.world.height = size.rows * CELL;

    ctx.state.grid = new Uint8Array(size.cols * size.rows);   // 0 = neutre, n = owner
    ctx.state.bodies = new Map();                   // playerId → corps simulé
    ctx.state.nextOwner = 1;                        // 0 est réservé au neutre
    ctx.state.deaths = [];                          // évènements à signaler à l'écran
    // Index inverse case → joueur : sans lui, tester une collision demanderait de
    // parcourir la traînée de tout le monde à chaque déplacement de chaque joueur.
    ctx.state.trailOwners = new Map();              // index de case → playerId
    // Compteur de cases par propriétaire, tenu à jour au fil des peintures :
    // recompter 3 600 cases à chaque capture serait le premier point chaud.
    ctx.state.owned = new Map();                    // owner → nombre de cases
    // Journal des cases retournées depuis le dernier instantané.
    ctx.state.dirty = new Map();                    // index de case → propriétaire
    ctx.state.needFullGrid = true;                  // le premier instantané porte la carte

    for (const player of ctx.players.values()) onJoin(ctx, player);
}

/**
 * Écrit une case, tient les compteurs de territoire à jour et note la
 * modification pour l'instantané suivant. Tout passage par la grille doit
 * emprunter cette fonction, sans quoi l'écran et le serveur divergent.
 */
function setCell(ctx, key, owner) {
    const { grid, owned } = ctx.state;
    const previous = grid[key];
    if (previous === owner) return;
    if (previous !== EMPTY) owned.set(previous, (owned.get(previous) || 1) - 1);
    grid[key] = owner;
    if (owner !== EMPTY) owned.set(owner, (owned.get(owner) || 0) + 1);
    ctx.state.dirty.set(key, owner);
}

/**
 * Cherche un carré de départ libre **et à l'écart des autres joueurs**.
 *
 * Le dégagement compte autant que la place libre : deux territoires 5×5 nés à
 * cinq cases l'un de l'autre se touchent presque, et le premier joueur qui sort
 * de sa zone tombe aussitôt sur son voisin. Mesuré sur 20 joueurs, l'ancienne
 * version produisait cinq paires trop proches et une hécatombe en six secondes.
 * On exige donc une marge, qu'on relâche par paliers plutôt que d'échouer.
 */
function findSpawn(ctx) {
    const { grid, bodies, cols, rows, spawnSpacing } = ctx.state;
    const centerX = Math.floor(cols / 2);
    const centerY = Math.floor(rows / 2);

    const occupied = [];
    for (const body of bodies.values()) {
        if (body.alive) occupied.push(cellOf(cols, rows, body.x, body.y));
    }

    const squareIsFree = (cx, cy) => {
        for (let y = cy - SPAWN_HALF; y <= cy + SPAWN_HALF; y += 1) {
            for (let x = cx - SPAWN_HALF; x <= cx + SPAWN_HALF; x += 1) {
                if (grid[idx(cols, x, y)] !== EMPTY) return false;
            }
        }
        return true;
    };

    const farEnough = (cx, cy, minDist) => occupied.every(
        (o) => Math.hypot(o.cx - cx, o.cy - cy) >= minDist,
    );

    // Du plus confortable au plus serré : on ne renonce à l'espacement qu'en
    // dernier recours, quand la carte est réellement pleine. L'écart de départ
    // suit la taille du terrain — sinon, sur une grande carte, tout le monde
    // naîtrait au même endroit.
    const ladder = [spawnSpacing, spawnSpacing * 0.7, spawnSpacing * 0.5, 0];
    for (const minDist of ladder) {
        for (let attempt = 0; attempt < 260; attempt += 1) {
            const cx = SPAWN_HALF + 1 + Math.floor(Math.random() * (cols - 2 * SPAWN_HALF - 2));
            const cy = SPAWN_HALF + 1 + Math.floor(Math.random() * (rows - 2 * SPAWN_HALF - 2));
            if (!squareIsFree(cx, cy)) continue;
            if (!farEnough(cx, cy, minDist)) continue;
            return { cx, cy };
        }
    }
    // Grille saturée : on pose au centre, quitte à écraser (cas très improbable).
    return { cx: centerX, cy: centerY };
}

function onJoin(ctx, player) {
    if (ctx.state.bodies.has(player.id)) return;

    const owner = ctx.state.nextOwner;
    ctx.state.nextOwner = (ctx.state.nextOwner % 254) + 1;

    const { cx, cy } = findSpawn(ctx);
    const identity = IDENTITIES[(owner - 1) % IDENTITIES.length];
    const body = {
        owner,
        color: identity.color,
        shape: identity.shape,
        x: cx * CELL + CELL / 2,
        y: cy * CELL + CELL / 2,
        angle: Math.random() * Math.PI * 2,
        targetAngle: null,
        trail: [],           // cases traversées hors de son territoire
        trailSet: new Set(),
        trailVersion: 1,     // change à chaque effacement (mort, capture)
        trailVersionSent: 0, // version que le client possède déjà
        sent: 0,             // nombre de cases déjà transmises pour cette version
        lastCell: idx(ctx.state.cols, cx, cy),
        alive: true,
        respawnAt: 0,
        shieldUntil: Date.now() + SPAWN_SHIELD_MS,
        score: 0,
    };
    ctx.state.bodies.set(player.id, body);

    // Carré de départ : sans territoire initial, refermer une boucle est impossible.
    paintSquare(ctx, cx, cy, owner);
    body.score = countCells(ctx, owner);
}

function onLeave(ctx, playerId) {
    const body = ctx.state.bodies.get(playerId);
    if (!body) return;
    // Le territoire conquis reste sur la carte : il continue de raconter la
    // partie, et effacer une couleur en direct est illisible depuis la salle.
    clearTrail(ctx, body);
    ctx.state.bodies.delete(playerId);
}

function paintSquare(ctx, cx, cy, owner) {
    const { cols, rows } = ctx.state;
    for (let y = cy - SPAWN_HALF; y <= cy + SPAWN_HALF; y += 1) {
        for (let x = cx - SPAWN_HALF; x <= cx + SPAWN_HALF; x += 1) {
            if (inside(cols, rows, x, y)) setCell(ctx, idx(cols, x, y), owner);
        }
    }
}

function countCells(ctx, owner) {
    return ctx.state.owned.get(owner) || 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Entrées
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Le client n'envoie qu'un cap. Aucune position ne vient jamais du téléphone :
 * le serveur reste seul maître de la simulation.
 */
function onInput(ctx, playerId, data) {
    const body = ctx.state.bodies.get(playerId);
    if (!body || !body.alive) return;
    const angle = Number(data?.angle);
    if (!Number.isFinite(angle)) return;
    body.targetAngle = angle;
}

// ─────────────────────────────────────────────────────────────────────────────
// Simulation
// ─────────────────────────────────────────────────────────────────────────────

function tick(ctx, dt) {
    const { bodies, grid, cols, rows } = ctx.state;
    const now = Date.now();

    for (const [playerId, body] of bodies) {
        if (!body.alive) {
            if (now >= body.respawnAt) respawn(ctx, playerId, body);
            continue;
        }

        // Joueur momentanément déconnecté : son point se fige au lieu de foncer
        // sans pilote vers le premier bord venu. Il reprend là où il s'est
        // arrêté quand son téléphone revient.
        if (ctx.players.get(playerId)?.disconnected) continue;

        // Braquage progressif : le point ne pivote pas instantanément, ce qui
        // rend le pilotage lisible au pouce et les demi-tours impossibles.
        if (body.targetAngle !== null) {
            let diff = body.targetAngle - body.angle;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            const maxTurn = TURN_RATE * dt;
            body.angle += Math.max(-maxTurn, Math.min(maxTurn, diff));
        }

        body.x += Math.cos(body.angle) * SPEED * dt;
        body.y += Math.sin(body.angle) * SPEED * dt;

        // Les bords sont mortels : c'est ce qui donne du danger aux coins et
        // évite un rebond mou qui n'apprend rien au joueur.
        if (body.x < 0 || body.y < 0 || body.x >= cols * CELL || body.y >= rows * CELL) {
            kill(ctx, playerId, body, null);
            continue;
        }

        const { cx, cy } = cellOf(cols, rows, body.x, body.y);
        const key = idx(cols, cx, cy);
        const owner = grid[key];

        // Rester sur la case qu'on occupe déjà n'est jamais un évènement : sans
        // ce test, un joueur pose sa traînée puis se tue dessus au pas suivant,
        // parce qu'à cette vitesse plusieurs pas tiennent dans une même case.
        if (key === body.lastCell) continue;
        body.lastCell = key;

        // Collision avec une traînée — la sienne ou celle d'un voisin.
        const victimId = trailOwnerAt(ctx, key);
        if (victimId) {
            if (victimId === playerId) {
                kill(ctx, playerId, body, null);          // on s'est coupé soi-même
            } else {
                const victim = bodies.get(victimId);
                kill(ctx, victimId, victim, playerId);    // on a coupé quelqu'un
            }
            continue;
        }

        if (owner === body.owner) {
            // Retour au bercail : si on avait une traînée, elle se referme.
            if (body.trail.length > 0) captureLoop(ctx, playerId, body);
        } else {
            body.trail.push(key);
            body.trailSet.add(key);
            ctx.state.trailOwners.set(key, playerId);
        }
    }
}

function trailOwnerAt(ctx, key) {
    return ctx.state.trailOwners.get(key) || null;
}

/**
 * Referme la boucle : on peint la traînée, puis on remplit l'intérieur.
 *
 * L'intérieur n'est pas calculé directement — on colorie par diffusion depuis
 * les bords de la grille en contournant le territoire du joueur, et tout ce qui
 * n'a **pas** été atteint est nécessairement enfermé. C'est exactement le
 * principe du détourage de CouleurMoi, et ça évite tout calcul de polygone.
 *
 * Pourquoi pas un balayage par lignes (« scanline »), comme le font plusieurs
 * clones ? Mesuré : il est ~6x plus rapide (0,017 ms contre 0,098 ms), mais il
 * **se trompe sur les tracés concaves** — sur une simple boucle en U, il offre
 * 16 cases que le joueur n'a jamais encerclées. Or une boucle tordue est le cas
 * normal, pas l'exception. À 0,6 % du budget d'une image, la justesse coûte
 * moins cher qu'un joueur qui gagne du terrain sans l'avoir conquis.
 */
function captureLoop(ctx, playerId, body) {
    const { grid, cols, rows } = ctx.state;
    const { owner } = body;

    for (const key of body.trail) setCell(ctx, key, owner);
    clearTrail(ctx, body);

    const reachable = new Uint8Array(cols * rows);
    const queue = [];

    const seed = (cx, cy) => {
        if (!inside(cols, rows, cx, cy)) return;
        const k = idx(cols, cx, cy);
        if (reachable[k] || grid[k] === owner) return;
        reachable[k] = 1;
        queue.push(k);
    };

    for (let x = 0; x < cols; x += 1) { seed(x, 0); seed(x, rows - 1); }
    for (let y = 0; y < rows; y += 1) { seed(0, y); seed(cols - 1, y); }

    // Diffusion en 4-connexité, avec la file gérée par curseur : sur 3 600 cases,
    // un `shift()` répété coûterait un déplacement de tableau à chaque pas.
    for (let head = 0; head < queue.length; head += 1) {
        const k = queue[head];
        const cx = k % cols;
        const cy = (k - cx) / cols;
        seed(cx + 1, cy);
        seed(cx - 1, cy);
        seed(cx, cy + 1);
        seed(cx, cy - 1);
    }

    // Tout ce que la diffusion n'a pas atteint est à l'intérieur de la boucle.
    // `setCell` tient les compteurs, donc voler des cases à un voisin met aussi
    // son score à jour — c'est le sel du jeu.
    for (let k = 0; k < grid.length; k += 1) {
        if (!reachable[k] && grid[k] !== owner) setCell(ctx, k, owner);
    }

    // Les scores de tout le monde peuvent avoir bougé lors de cette capture.
    for (const other of ctx.state.bodies.values()) {
        other.score = countCells(ctx, other.owner);
    }
}

/**
 * Efface la traînée et **change sa version** : c'est ce numéro qui dit au client
 * de jeter le tracé qu'il affiche au lieu d'y ajouter les cases suivantes.
 */
function clearTrail(ctx, body) {
    for (const key of body.trail) ctx.state.trailOwners.delete(key);
    body.trail = [];
    body.trailSet = new Set();
    body.trailVersion = (body.trailVersion || 0) + 1;
    body.sent = 0;
}

function kill(ctx, playerId, body, killerId) {
    if (!body || !body.alive) return;
    // Le bouclier d'apparition protège aussi bien de sa propre maladresse que
    // d'un voisin : c'est une fenêtre de grâce, pas une immunité sélective.
    if (Date.now() < (body.shieldUntil || 0)) return;
    body.alive = false;
    body.respawnAt = Date.now() + RESPAWN_MS;
    clearTrail(ctx, body);

    const player = ctx.players.get(playerId);
    const killer = killerId ? ctx.players.get(killerId) : null;
    ctx.state.deaths.push({
        name: player?.name || '?',
        by: killer?.name || null,
        at: Date.now(),
    });
}

function respawn(ctx, playerId, body) {
    const { cx, cy } = findSpawn(ctx);
    body.x = cx * CELL + CELL / 2;
    body.y = cy * CELL + CELL / 2;
    body.angle = Math.random() * Math.PI * 2;
    body.targetAngle = null;
    body.alive = true;
    body.lastCell = idx(ctx.state.cols, cx, cy);
    body.shieldUntil = Date.now() + SPAWN_SHIELD_MS;
    clearTrail(ctx, body);
    paintSquare(ctx, cx, cy, body.owner);
    body.score = countCells(ctx, body.owner);
}

// ─────────────────────────────────────────────────────────────────────────────
// Instantané
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ce qui part sur le réseau, dix fois par seconde. Trois économies décisives,
 * mesurées : sans elles, 20 joueurs lancés tout droit coûtaient 41 Ko/s.
 *
 * - Les coordonnées sont **arrondies à l'entier** (jamais de flottant sur le fil).
 * - La grille n'est envoyée **que lorsqu'elle a changé**, encodée par plages
 *   (paires valeur/longueur) : une carte très uniforme tombe à quelques dizaines
 *   d'octets.
 * - Les traînées ne partent **qu'en ajout** : elles ne grandissent que par la
 *   fin, donc renvoyer 500 cases à chaque instantané était pur gaspillage. Le
 *   champ `v` (version) dit au client quand jeter ce qu'il a et repartir de zéro
 *   — à la mort, à la capture, ou pour un écran qui rejoint en cours.
 */
function snapshot(ctx) {
    const { grid, bodies, cols, rows } = ctx.state;
    const now = Date.now();

    const players = [];
    for (const [playerId, body] of bodies) {
        const player = ctx.players.get(playerId);
        // `sent` compte ce que le client possède déjà pour cette version de traînée.
        if (body.trailVersionSent !== body.trailVersion) {
            body.sent = 0;
            body.trailVersionSent = body.trailVersion;
        }
        const added = body.trail.length > body.sent ? body.trail.slice(body.sent) : [];
        body.sent = body.trail.length;

        players.push({
            i: body.owner,
            n: player?.name || '?',
            c: body.color,
            f: body.shape,                               // forme (identité daltonisme)
            x: Math.round(body.x),
            y: Math.round(body.y),
            a: Math.round(body.angle * 100) / 100,
            s: body.score,
            d: body.alive ? 0 : 1,
            p: now < (body.shieldUntil || 0) ? 1 : 0,   // protégé (halo à l'écran)
            v: body.trailVersion,                        // version de la traînée
            t: added,                                    // uniquement les cases ajoutées
        });
    }
    players.sort((a, b) => b.s - a.s);

    const deaths = ctx.state.deaths;
    ctx.state.deaths = [];

    // La grille change presque à chaque tick : la renvoyer entière, même
    // compressée par plages, coûtait plus cher que tout le reste réuni. On
    // n'envoie donc que les cases retournées depuis le dernier instantané, sous
    // forme de paires [index, propriétaire].
    const patch = [];
    for (const [key, owner] of ctx.state.dirty) patch.push(key, owner);
    ctx.state.dirty.clear();

    // `full` n'est produit qu'à la demande (premier instantané, ou écran qui
    // rejoint en cours) : c'est le seul cas où la carte entière est justifiée.
    let full = null;
    if (ctx.state.needFullGrid) {
        full = encodeGrid(grid);
        ctx.state.needFullGrid = false;
    }

    return {
        cols,
        rows,
        cell: CELL,
        players,
        grid: full,        // carte complète, seulement quand c'est nécessaire
        patch,             // sinon, les seules cases qui ont changé
        deaths,
    };
}

/**
 * Vue rapprochée d'un joueur, pour son téléphone.
 *
 * Sur une grande carte, personne ne voit tout : chacun navigue autour de son
 * propre point. On n'envoie donc qu'une fenêtre de cases centrée sur lui, plus
 * les adversaires qui s'y trouvent — ce qui borne le coût réseau quelle que soit
 * la taille du terrain, et évite au passage de révéler la position de joueurs
 * hors de portée.
 *
 * La fenêtre est renvoyée en entier à chaque fois : elle est petite (≈ 27×15
 * cases), et suivre des différences sur une fenêtre qui se déplace coûterait
 * plus cher que de la retransmettre.
 */
// Un téléphone est plus haut que large : la fenêtre suit cette forme, sinon la
// caméra doit sur-zoomer pour remplir l'écran et le joueur ne voit presque rien
// devant lui.
const VIEW_HALF_W = 9;    // demi-largeur de la fenêtre, en cases → 19 de large
const VIEW_HALF_H = 16;   // demi-hauteur → 33 de haut

/** Retrouve l'identifiant de joueur derrière un numéro de propriétaire. */
function idByOwner(ctx, owner) {
    for (const [id, b] of ctx.state.bodies) if (b.owner === owner) return id;
    return null;
}

function viewFor(ctx, playerId, frame) {
    const body = ctx.state.bodies.get(playerId);
    if (!body) return null;

    const { grid, cols, rows } = ctx.state;
    const { cx, cy } = cellOf(cols, rows, body.x, body.y);

    // La fenêtre reste dans les limites du terrain : au bord, on décale plutôt
    // que de laisser du vide, sinon le joueur perd la moitié de son écran.
    const x0 = Math.max(0, Math.min(cols - VIEW_HALF_W * 2 - 1, cx - VIEW_HALF_W));
    const y0 = Math.max(0, Math.min(rows - VIEW_HALF_H * 2 - 1, cy - VIEW_HALF_H));
    const w = Math.min(VIEW_HALF_W * 2 + 1, cols);
    const h = Math.min(VIEW_HALF_H * 2 + 1, rows);

    // Encodage par plages, comme la carte complète : une fenêtre est
    // majoritairement uniforme (du vide, ou un grand territoire), donc 405 cases
    // se résument le plus souvent à quelques dizaines d'octets.
    let cells = '';
    let runValue = grid[y0 * cols + x0];
    let runLength = 0;
    for (let y = 0; y < h; y += 1) {
        const rowBase = (y0 + y) * cols + x0;
        for (let x = 0; x < w; x += 1) {
            const v = grid[rowBase + x];
            if (v === runValue) { runLength += 1; continue; }
            cells += `${runValue},${runLength},`;
            runValue = v;
            runLength = 1;
        }
    }
    cells += `${runValue},${runLength}`;

    // Les joueurs présents dans la fenêtre, y compris soi-même, avec leur
    // traînée : c'est elle qui dit où l'on est passé et ce qui est mortel. Sans
    // elle, le joueur ne voit pas son propre tracé et joue à l'aveugle.
    const visible = [];
    for (const p of frame.players) {
        const px = p.x / CELL;
        const py = p.y / CELL;
        if (px < x0 - 2 || px > x0 + w + 2 || py < y0 - 2 || py > y0 + h + 2) continue;

        // La traînée du joueur, ramenée aux coordonnées de la fenêtre. Seules
        // les cases visibles sont transmises, et on plafonne la longueur : au
        // delà d'une centaine de cases, la queue sort de l'écran de toute façon,
        // et l'envoyer coûterait du réseau pour rien.
        const body2 = ctx.state.bodies.get(idByOwner(ctx, p.i));
        const trail = [];
        if (body2) {
            const source = body2.trail.length > 120
                ? body2.trail.slice(body2.trail.length - 120)
                : body2.trail;
            for (const key of source) {
                const tx = key % cols;
                const ty = (key - tx) / cols;
                if (tx < x0 || tx >= x0 + w || ty < y0 || ty >= y0 + h) continue;
                trail.push((ty - y0) * w + (tx - x0));
            }
        }

        // La traînée part en écarts successifs plutôt qu'en index absolus : deux
        // cases voisines diffèrent de 1 ou de la largeur de fenêtre, donc un
        // chiffre au lieu de quatre. Le tracé est continu, l'économie est nette.
        let packed = '';
        if (trail.length > 0) {
            packed = String(trail[0]);
            for (let i = 1; i < trail.length; i += 1) packed += `.${trail[i] - trail[i - 1]}`;
        }

        visible.push({
            i: p.i, c: p.c, f: p.f, x: p.x, y: p.y, d: p.d, p: p.p,
            me: p.i === body.owner ? 1 : 0,
            t: packed,
        });
    }

    // Le classement et la mini-carte pesaient 44 % de la vue alors qu'ils
    // changent lentement : les envoyer dix fois par seconde était du gaspillage.
    // Deux fois par seconde suffit largement à l'œil, et le client conserve la
    // dernière valeur reçue entre deux envois.
    const slowTick = Math.floor(Date.now() / 500);
    const sendSlow = slowTick !== ctx.state.lastSlowTick;
    if (sendSlow) ctx.state.lastSlowTick = slowTick;

    const top = sendSlow
        ? frame.players.slice(0, 3).map((p) => ({ n: p.n, c: p.c, f: p.f, s: p.s }))
        : undefined;

    const radar = sendSlow
        ? frame.players.map((p) => ({
            c: p.c,
            x: Math.round((p.x / (cols * CELL)) * 100),
            y: Math.round((p.y / (rows * CELL)) * 100),
            me: p.i === body.owner ? 1 : 0,
        }))
        : undefined;

    return {
        x0, y0, w, h, cell: CELL,
        cells,                       // encodé par plages
        players: visible,
        me: body.owner,
        score: body.score,
        alive: body.alive ? 1 : 0,
        total: cols * rows,
        remaining: frame.remaining,
        top,
        radar,
    };
}

/** Encodage par plages : [valeur, longueur, valeur, longueur, ...]. */
function encodeGrid(grid) {
    const out = [];
    let current = grid[0];
    let run = 1;
    for (let i = 1; i < grid.length; i += 1) {
        if (grid[i] === current) { run += 1; continue; }
        out.push(current, run);
        current = grid[i];
        run = 1;
    }
    out.push(current, run);
    return out.join(',');
}

/**
 * Redemande la carte complète au prochain instantané. Appelé quand un écran
 * rejoint en cours de manche : sans cela, il n'aurait que les cases modifiées
 * depuis son arrivée et afficherait une carte trouée.
 */
function requestFullState(ctx) {
    ctx.state.needFullGrid = true;
    for (const body of ctx.state.bodies.values()) {
        body.trailVersionSent = 0;   // force le renvoi intégral des traînées
    }
}

function results(ctx) {
    const total = ctx.state.cols * ctx.state.rows;
    const out = [];
    for (const [playerId, body] of ctx.state.bodies) {
        const player = ctx.players.get(playerId);
        out.push({
            playerId,
            name: player?.name || '?',
            color: body.color,
            shape: body.shape,
            score: body.score,
            percent: Math.round((body.score / total) * 1000) / 10,
        });
    }
    return out.sort((a, b) => b.score - a.score);
}

module.exports = {
    id: 'territoire',
    name: 'Territoire',
    rule: 'Sors de ta zone, fais une boucle, reviens : tout l\'intérieur est à toi.',
    description: 'Chaque joueur laisse une traînée. Referme ta boucle pour conquérir le terrain, '
        + 'et coupe la traînée des autres pour les renvoyer au point de départ.',
    art: { icon: 'flag', color: '#22d3ee' },
    durationMs: 180_000,
    tickHz: 20,
    broadcastHz: 10,
    minPlayers: 1,
    // Valeur de départ : `init` la remplace selon la taille choisie par l'hôte.
    world: { width: SIZES[DEFAULT_SIZE].cols * CELL, height: SIZES[DEFAULT_SIZE].rows * CELL },
    sizes: SIZES,
    defaultSize: DEFAULT_SIZE,
    init,
    onJoin,
    onLeave,
    onInput,
    tick,
    snapshot,
    viewFor,
    results,
    requestFullState,
};
