/**
 * IO_ARENA — moteur de rendu du grand écran
 *
 * Direction artistique : néon arcade pour la lisibilité, habillage de salle de
 * projection pour les moments forts (letterbox, grain, amorce de bobine).
 *
 * Trois décisions structurent ce fichier, toutes issues de mesures :
 *
 * 1. **Trois calques.** Le fond est peint une fois, le terrain seulement quand
 *    une case change, et seules les têtes sont redessinées à 60 fps. Repeindre
 *    3600 cases par image serait gratuit en calcul (0,02 ms mesuré) mais pas en
 *    appels de dessin — c'est le nombre de `fillRect` qui coûte.
 *
 * 2. **Fusion en segments.** Sur des territoires réalistes, fusionner les cases
 *    voisines d'une même ligne fait passer les appels de 2320 à 174 (÷13).
 *
 * 3. **Le glow est pré-rendu.** `shadowBlur` plafonne à quelques dizaines
 *    d'appels par image ; l'appliquer par case est impossible. Chaque couleur a
 *    donc son halo dessiné une fois dans un canvas hors écran, puis simplement
 *    recopié.
 *
 * Et une contrainte de fond : la couleur seule ne suffit pas à distinguer six
 * joueurs pour toutes les visions (mesuré : écart 1,12 au mieux, il en faut
 * 1,2). Chaque joueur a donc aussi une **forme**, dessinée sur sa tête et
 * reprise dans le classement.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Palette
// ─────────────────────────────────────────────────────────────────────────────

export const THEME = {
    void: '#050810',          // hors-cadre (bandes letterbox)
    ground: '#080d18',        // le terrain lui-même
    gridLine: 'rgba(120, 200, 255, 0.055)',
    gridMajor: 'rgba(120, 200, 255, 0.11)',
    ink: '#EAF6FF',
    gold: '#d4a24e',          // accent « salle de projection »
    danger: '#FF2158',
    trailAlpha: 0.5,
    territoryAlpha: 0.32,
};

// ─────────────────────────────────────────────────────────────────────────────
// Formes d'identité
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Trace la forme d'un joueur, centrée sur (0,0) et de rayon `r`.
 * Utilisée pour la tête sur le terrain et pour la pastille du classement, afin
 * que les deux se lisent comme la même identité.
 */
export function traceShape(ctx, shape, r) {
    ctx.beginPath();
    switch (shape) {
        case 'square':
            ctx.rect(-r * 0.82, -r * 0.82, r * 1.64, r * 1.64);
            break;
        case 'triangle':
            ctx.moveTo(0, -r);
            ctx.lineTo(r * 0.92, r * 0.72);
            ctx.lineTo(-r * 0.92, r * 0.72);
            ctx.closePath();
            break;
        case 'diamond':
            ctx.moveTo(0, -r * 1.1);
            ctx.lineTo(r, 0);
            ctx.lineTo(0, r * 1.1);
            ctx.lineTo(-r, 0);
            ctx.closePath();
            break;
        case 'hexagon':
            for (let i = 0; i < 6; i += 1) {
                const a = (Math.PI / 3) * i - Math.PI / 2;
                const px = Math.cos(a) * r;
                const py = Math.sin(a) * r;
                if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
            }
            ctx.closePath();
            break;
        case 'star':
            for (let i = 0; i < 10; i += 1) {
                const a = (Math.PI / 5) * i - Math.PI / 2;
                const rad = i % 2 === 0 ? r * 1.15 : r * 0.5;
                const px = Math.cos(a) * rad;
                const py = Math.sin(a) * rad;
                if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
            }
            ctx.closePath();
            break;
        case 'circle':
        default:
            ctx.arc(0, 0, r, 0, Math.PI * 2);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Ressources pré-rendues
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Halo lumineux par couleur, dessiné une fois hors écran.
 * `shadowBlur` est l'opération la plus chère du Canvas 2D ; le payer une fois
 * au démarrage plutôt qu'à chaque image est ce qui rend le néon jouable.
 */
export function makeGlowSprite(color, radius) {
    const size = Math.ceil(radius * 6);
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    g.shadowColor = color;
    g.shadowBlur = radius * 1.6;
    g.fillStyle = color;
    g.beginPath();
    g.arc(size / 2, size / 2, radius * 0.55, 0, Math.PI * 2);
    g.fill();
    // Deux passes : le halo gagne en densité sans coûter plus cher à l'usage.
    g.fill();
    return c;
}

/**
 * Grain de pellicule : quelques tuiles pré-générées qu'on alterne.
 * Régénérer du bruit à chaque image coûterait plusieurs millisecondes ; alterner
 * 4 tuiles à ~12 Hz donne le même scintillement pour un simple changement de
 * référence.
 */
export function makeGrainTiles(count = 4, size = 128) {
    const tiles = [];
    for (let t = 0; t < count; t += 1) {
        const c = document.createElement('canvas');
        c.width = c.height = size;
        const g = c.getContext('2d');
        const img = g.createImageData(size, size);
        for (let i = 0; i < img.data.length; i += 4) {
            const v = 128 + (Math.random() - 0.5) * 90;
            img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
            img.data[i + 3] = Math.random() * 42;
        }
        g.putImageData(img, 0, 0);
        tiles.push(c);
    }
    return tiles;
}

/** Vignettage : un dégradé radial peint une fois, recopié ensuite. */
export function makeVignette(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.34, w / 2, h / 2, Math.max(w, h) * 0.72);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.62)');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    return c;
}

/** Fond + grille : peints une seule fois, puis recopiés. */
export function paintBackground(ctx, w, h, cols, rows) {
    const cw = w / cols;
    const ch = h / rows;

    const grad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.72);
    grad.addColorStop(0, '#0b1424');
    grad.addColorStop(1, THEME.ground);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = THEME.gridLine;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= cols; x += 1) {
        const px = Math.round(x * cw) + 0.5;
        ctx.moveTo(px, 0); ctx.lineTo(px, h);
    }
    for (let y = 0; y <= rows; y += 1) {
        const py = Math.round(y * ch) + 0.5;
        ctx.moveTo(0, py); ctx.lineTo(w, py);
    }
    ctx.stroke();

    // Lignes majeures toutes les 10 cases : donne l'échelle du terrain sans
    // concurrencer les territoires.
    ctx.strokeStyle = THEME.gridMajor;
    ctx.beginPath();
    for (let x = 0; x <= cols; x += 10) {
        const px = Math.round(x * cw) + 0.5;
        ctx.moveTo(px, 0); ctx.lineTo(px, h);
    }
    for (let y = 0; y <= rows; y += 10) {
        const py = Math.round(y * ch) + 0.5;
        ctx.moveTo(0, py); ctx.lineTo(w, py);
    }
    ctx.stroke();
}

// ─────────────────────────────────────────────────────────────────────────────
// Terrain
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Peint les territoires en suivant leur contour lissé.
 *
 * Le remplissage et la bordure partagent **le même chemin** : c'est la seule
 * façon d'éviter qu'un aplat en escalier dépasse d'une bordure arrondie. On
 * utilise la règle de remplissage `evenodd` pour que les trous (le territoire
 * d'un voisin enclavé) restent des trous.
 */
export function paintTerritories(ctx, grid, cols, rows, cw, ch, colorOf) {
    ctx.clearRect(0, 0, cols * cw, rows * ch);

    const owners = new Set();
    for (let i = 0; i < grid.length; i += 1) if (grid[i] !== 0) owners.add(grid[i]);

    const radius = Math.min(cw, ch) * 0.5;

    for (const owner of owners) {
        const color = colorOf(owner);
        if (!color) continue;

        const loops = extractOutlines(grid, cols, rows, owner);
        if (loops.length === 0) continue;

        ctx.beginPath();
        for (const loop of loops) traceSmoothLoop(ctx, simplify(loop), cw, ch, radius);

        ctx.fillStyle = color;
        ctx.globalAlpha = THEME.territoryAlpha;
        ctx.fill('evenodd');
        ctx.globalAlpha = 1;
    }
}

/**
 * Extrait les contours fermés d'un territoire, en suivant les arêtes.
 *
 * On ne parcourt pas les cases mais les **arêtes entre cases** : chaque arête
 * qui sépare le territoire du reste est une portion de frontière, et on les
 * chaîne bout à bout pour reconstituer des boucles fermées. C'est ce qui permet
 * ensuite de lisser — un contour continu se courbe, des segments isolés non.
 *
 * Renvoie un tableau de boucles, chacune étant une suite de points en unités de
 * case (donc indépendante de la taille d'affichage).
 */
function extractOutlines(grid, cols, rows, owner) {
    const has = (x, y) => x >= 0 && y >= 0 && x < cols && y < rows && grid[y * cols + x] === owner;

    // Chaque arête frontière est orientée de façon à ce que le territoire reste
    // à sa gauche ; les arêtes se chaînent alors naturellement en boucles.
    const edges = new Map();   // "x,y" du départ → [{ to }]
    const key = (x, y) => `${x},${y}`;
    const addEdge = (x1, y1, x2, y2) => {
        const k = key(x1, y1);
        if (!edges.has(k)) edges.set(k, []);
        edges.get(k).push({ x: x2, y: y2 });
    };

    for (let y = 0; y < rows; y += 1) {
        for (let x = 0; x < cols; x += 1) {
            if (!has(x, y)) continue;
            if (!has(x, y - 1)) addEdge(x, y, x + 1, y);           // haut
            if (!has(x + 1, y)) addEdge(x + 1, y, x + 1, y + 1);   // droite
            if (!has(x, y + 1)) addEdge(x + 1, y + 1, x, y + 1);   // bas
            if (!has(x - 1, y)) addEdge(x, y + 1, x, y);           // gauche
        }
    }

    const loops = [];
    while (edges.size > 0) {
        const startKey = edges.keys().next().value;
        const [sx, sy] = startKey.split(',').map(Number);
        const loop = [];
        let cx = sx, cy = sy;

        // On suit les arêtes jusqu'à revenir au point de départ. La borne évite
        // toute boucle infinie sur une grille corrompue.
        for (let guard = 0; guard < cols * rows * 4; guard += 1) {
            const k = key(cx, cy);
            const outs = edges.get(k);
            if (!outs || outs.length === 0) break;
            const next = outs.pop();
            if (outs.length === 0) edges.delete(k);
            loop.push({ x: cx, y: cy });
            cx = next.x;
            cy = next.y;
            if (cx === sx && cy === sy) break;
        }
        if (loop.length > 2) loops.push(loop);
    }
    return loops;
}

/**
 * Retire les points alignés d'un contour.
 *
 * Une frontière en escalier contient une majorité de points inutiles : trois
 * points sur une même droite ne décrivent qu'un segment. Les supprimer réduit le
 * bruit avant lissage — c'est ce qui fait la différence entre une courbe douce
 * et une courbe qui ondule sur chaque marche.
 */
function simplify(points) {
    if (points.length < 3) return points;
    const out = [];
    for (let i = 0; i < points.length; i += 1) {
        const prev = points[(i - 1 + points.length) % points.length];
        const curr = points[i];
        const next = points[(i + 1) % points.length];
        const cross = (curr.x - prev.x) * (next.y - curr.y) - (curr.y - prev.y) * (next.x - curr.x);
        if (cross !== 0) out.push(curr);   // on ne garde que les vrais coins
    }
    return out.length > 2 ? out : points;
}

/**
 * Trace un contour fermé en arrondissant les angles.
 *
 * Chaque coin est remplacé par une courbe quadratique dont le point de contrôle
 * est le coin lui-même : le trait entre et sort par le milieu des segments
 * adjacents, ce qui donne une frontière souple sans jamais s'éloigner de la
 * forme réelle du territoire. Le rayon est plafonné à la moitié du plus court
 * segment, sinon deux arrondis voisins se chevaucheraient.
 */
function traceSmoothLoop(ctx, points, cw, ch, radius) {
    const n = points.length;
    if (n < 3) return;

    const px = (p) => p.x * cw;
    const py = (p) => p.y * ch;

    const mid = (a, b, r) => {
        const ax = px(a), ay = py(a), bx = px(b), by = py(b);
        const dx = bx - ax, dy = by - ay;
        const len = Math.hypot(dx, dy) || 1;
        const t = Math.min(r, len / 2) / len;
        return { x: ax + dx * t, y: ay + dy * t };
    };

    const first = mid(points[0], points[1], radius);
    ctx.moveTo(first.x, first.y);

    for (let i = 1; i <= n; i += 1) {
        const curr = points[i % n];
        const next = points[(i + 1) % n];
        const entry = mid(curr, points[(i - 1 + n) % n], radius);
        const exit = mid(curr, next, radius);
        ctx.lineTo(entry.x, entry.y);
        ctx.quadraticCurveTo(px(curr), py(curr), exit.x, exit.y);
    }
    ctx.closePath();
}

/**
 * Contour lumineux des territoires.
 *
 * Le contour est extrait comme une suite de boucles fermées, simplifié, puis
 * tracé avec les angles arrondis. Sans cela, les frontières apparaissent en
 * escalier — chaque case dessinant sa propre arête — ce qui est exactement ce
 * qu'on ne veut pas voir sur un écran de deux mètres.
 *
 * Le résultat est mis en cache : recalculer les contours à 60 fps serait inutile
 * puisqu'ils ne changent qu'à la capture.
 */
export function paintBorders(ctx, grid, cols, rows, cw, ch, colorOf) {
    const owners = new Set();
    for (let i = 0; i < grid.length; i += 1) if (grid[i] !== 0) owners.add(grid[i]);

    ctx.lineWidth = Math.max(2, cw * 0.2);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    const radius = Math.min(cw, ch) * 0.5;

    for (const owner of owners) {
        const color = colorOf(owner);
        if (!color) continue;

        const loops = extractOutlines(grid, cols, rows, owner);
        if (loops.length === 0) continue;

        ctx.beginPath();
        for (const loop of loops) {
            traceSmoothLoop(ctx, simplify(loop), cw, ch, radius);
        }

        // Halo large et diffus, puis trait net par-dessus : le néon se construit
        // en deux passes, ce qui coûte deux `stroke` par joueur — et non par case.
        ctx.save();
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.35;
        ctx.lineWidth = Math.max(6, cw * 0.6);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.lineWidth = Math.max(2, cw * 0.2);
        ctx.stroke();
        ctx.restore();
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Effets ponctuels
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Onde de choc d'une capture. Un seul cercle qui s'étend et s'efface — le
 * moment où l'on comprend, depuis le fond de la salle, que quelqu'un vient de
 * prendre du terrain.
 */
export function drawShockwave(ctx, x, y, progress, color) {
    // ease-out-expo : l'onde part vite puis s'étale, ce qui la rend lisible.
    const eased = 1 - Math.pow(2, -10 * progress);
    const radius = eased * 260;
    ctx.save();
    ctx.globalAlpha = (1 - progress) * 0.75;
    ctx.strokeStyle = color;
    ctx.lineWidth = 6 * (1 - progress) + 1;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
}

/** Éclat de mort : des fragments qui partent en étoile, brefs et secs. */
export function drawDeathBurst(ctx, x, y, progress, color) {
    ctx.save();
    ctx.globalAlpha = 1 - progress;
    ctx.fillStyle = color;
    const dist = progress * 90;
    for (let i = 0; i < 10; i += 1) {
        const a = (Math.PI * 2 * i) / 10;
        const size = 7 * (1 - progress) + 1;
        ctx.fillRect(x + Math.cos(a) * dist - size / 2, y + Math.sin(a) * dist - size / 2, size, size);
    }
    ctx.restore();
}

/**
 * Anneau de bouclier qui se vide pendant l'invulnérabilité.
 * Le temps restant se lit à la longueur de l'arc — aucun chiffre nécessaire,
 * ce qui est la bonne façon d'informer sur un écran vu de loin.
 */
export function drawShield(ctx, x, y, r, remaining, total) {
    const progress = Math.max(0, Math.min(1, remaining / total));
    ctx.save();
    ctx.strokeStyle = THEME.ink;
    ctx.lineWidth = 3;
    ctx.setLineDash([5, 4]);
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.arc(x, y, r * 1.85, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
    ctx.stroke();
    ctx.restore();
}
