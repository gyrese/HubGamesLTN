/**
 * IO_ARENA — moteur de rendu PixiJS (WebGL)
 *
 * Remplace le dessin manuel en Canvas 2D. Ce que le GPU apporte et que le 2D ne
 * pouvait pas donner :
 *
 * - **Des courbes réellement lisses.** Les traînées sont des chemins continus
 *   avec jointures arrondies, plus des cases peintes une par une.
 * - **Du glow véritable**, par filtre GPU, au lieu d'un `shadowBlur` plafonné à
 *   quelques dizaines d'appels par image.
 * - **Des particules** sans coût prohibitif.
 *
 * Le serveur, le protocole et la simulation ne changent pas : seule la couche
 * d'affichage est réécrite. `IoArena` sert aussi bien au grand écran (terrain
 * complet) qu'au téléphone (fenêtre rapprochée) — c'est la même scène, avec un
 * cadrage différent.
 */

import { Application, Container, Graphics, BlurFilter } from 'pixi.js';

export const THEME = {
    ground: 0x080d18,
    gridMinor: 0x2a4a6a,
    gridMajor: 0x3a6a9a,
    ink: 0xeaf6ff,
    danger: 0xff2158,
};

const hexToNum = (hex) => (typeof hex === 'string' ? parseInt(hex.replace('#', ''), 16) : hex);

export class IoArena {
    constructor() {
        this.app = null;
        this.ready = false;
        this.cols = 0;
        this.rows = 0;
        this.cell = 20;
        this.scale = 1;

        // Un conteneur par nature d'objet : l'ordre d'empilement est ainsi
        // garanti sans avoir à trier quoi que ce soit à chaque image.
        this.world = null;      // tout ce qui suit la caméra
        this.gridLayer = null;
        this.territoryLayer = null;
        this.trailLayer = null;
        this.playerLayer = null;
        this.fxLayer = null;

        this.trails = new Map();      // owner → { g, version, points }
        this.heads = new Map();       // owner → { g, glow, x, y }
        this.effects = [];
    }

    /** Prépare le rendu sur un élément DOM. À n'appeler qu'une fois. */
    /**
     * @param {object} opts
     * @param {number} opts.glow  intensité du flou de halo. Sur mobile, le
     *   filtre est appliqué à toute la scène à chaque image : c'est l'opération
     *   la plus coûteuse du rendu (mesuré : 9 fps avec un flou fort sur un
     *   écran de téléphone). On l'allège donc là où l'écran est petit et le GPU
     *   modeste, et on le garde riche sur le grand écran.
     */
    async init(container, { width, height, background = THEME.ground, glow = 22 } = {}) {
        this.app = new Application();
        await this.app.init({
            width,
            height,
            background,
            antialias: true,
            // Sur un écran très dense, rendre à 2x quadruple le nombre de pixels
            // à filtrer. Un halo flouté masque de toute façon la différence : on
            // plafonne à 1,5 quand le halo est léger (cas mobile).
            resolution: Math.min(window.devicePixelRatio || 1, glow > 12 ? 2 : 1.5),
            autoDensity: true,
            // `powerPreference` pousse le navigateur vers le GPU dédié quand il
            // y en a un — utile sur le portable qui pilote le vidéoprojecteur.
            powerPreference: 'high-performance',
        });
        container.appendChild(this.app.canvas);

        this.world = new Container();
        this.gridLayer = new Container();
        this.territoryLayer = new Container();
        this.trailLayer = new Container();
        this.playerLayer = new Container();
        this.fxLayer = new Container();

        // Le halo des territoires et des traînées est un vrai flou GPU : c'est
        // lui qui donne la profondeur que le Canvas 2D ne pouvait pas produire.
        this.glowLayer = new Container();
        if (glow > 0) {
            // `quality` est le nombre de passes du flou : chacune relit toute la
            // surface. C'est le premier levier quand le GPU sature.
            this.glowLayer.filters = [new BlurFilter({ strength: glow, quality: glow > 12 ? 4 : 2 })];
        }
        this.glowLayer.alpha = 0.95;
        // `add` fait s'additionner les lumières au lieu de les recouvrir : deux
        // halos qui se croisent brillent davantage, comme de vraies sources.
        this.glowLayer.blendMode = 'add';

        this.world.addChild(
            this.gridLayer, this.glowLayer, this.territoryLayer,
            this.trailLayer, this.playerLayer, this.fxLayer,
        );
        this.app.stage.addChild(this.world);
        this.ready = true;
        return this;
    }

    destroy() {
        if (this.app) {
            this.app.destroy(true, { children: true });
            this.app = null;
        }
        this.ready = false;
    }

    resize(width, height) {
        if (!this.ready) return;
        this.app.renderer.resize(width, height);
    }

    /** Définit les dimensions du terrain et redessine la grille de fond. */
    /**
     * @param {number} [worldCols] dimensions réelles du terrain, quand la scène
     *   n'en affiche qu'une fenêtre (téléphone). La bordure mortelle doit se
     *   tracer sur les vraies limites, pas sur celles du cadrage.
     */
    setWorld(cols, rows, cell, worldCols, worldRows, originX = 0, originY = 0) {
        if (!this.ready) return;
        const wc = worldCols || cols;
        const wr = worldRows || rows;
        if (this.cols === cols && this.rows === rows && this.cell === cell
            && this.worldCols === wc && this.worldRows === wr
            && this.originX === originX && this.originY === originY) return;
        this.cols = cols;
        this.rows = rows;
        this.cell = cell;
        this.worldCols = wc;
        this.worldRows = wr;
        this.originX = originX;
        this.originY = originY;
        this.drawGrid();
    }

    /**
     * Grille de fond et **bordure du terrain**.
     *
     * Les bords sont mortels : les laisser invisibles condamnait le joueur à
     * mourir sans comprendre pourquoi, surtout sur téléphone où l'on ne voit
     * qu'une portion de la carte. Ils sont désormais tracés en rouge, avec un
     * halo qui les signale bien avant qu'on les touche.
     */
    drawGrid() {
        for (const child of this.gridLayer.removeChildren()) child.destroy(true);
        const g = new Graphics();
        const w = this.cols * this.cell;
        const h = this.rows * this.cell;

        for (let x = 0; x <= this.cols; x += 1) {
            const major = x % 10 === 0;
            g.moveTo(x * this.cell, 0).lineTo(x * this.cell, h)
                .stroke({ width: major ? 1.5 : 1, color: major ? THEME.gridMajor : THEME.gridMinor, alpha: major ? 0.22 : 0.1 });
        }
        for (let y = 0; y <= this.rows; y += 1) {
            const major = y % 10 === 0;
            g.moveTo(0, y * this.cell).lineTo(w, y * this.cell)
                .stroke({ width: major ? 1.5 : 1, color: major ? THEME.gridMajor : THEME.gridMinor, alpha: major ? 0.22 : 0.1 });
        }
        this.gridLayer.addChild(g);

        // La limite du terrain, en rouge : c'est une zone mortelle, elle doit se
        // voir arriver. Un liseré large et translucide fait office d'avertissement
        // progressif, le trait net marque la frontière exacte.
        const edge = new Graphics();
        // Coordonnées du terrain réel, ramenées dans le repère de la scène.
        const ex = -this.originX * this.cell;
        const ey = -this.originY * this.cell;
        const ew = (this.worldCols || this.cols) * this.cell;
        const eh = (this.worldRows || this.rows) * this.cell;

        // Le hors-jeu est assombri et hachuré de rouge : un simple trait de
        // bordure laissait un grand vide noir indistinct du terrain, alors que
        // le franchir est mortel. Le contraste doit dire « on ne va pas là ».
        const far = Math.max(ew, eh) * 2;
        edge.rect(ex - far, ey - far, ew + far * 2, far)                    // au-dessus
            .rect(ex - far, ey + eh, ew + far * 2, far)                     // en dessous
            .rect(ex - far, ey, far, eh)                                    // à gauche
            .rect(ex + ew, ey, far, eh)                                     // à droite
            .fill({ color: THEME.danger, alpha: 0.07 });

        edge.rect(ex, ey, ew, eh).stroke({ width: this.cell * 1.6, color: THEME.danger, alpha: 0.16 });
        edge.rect(ex, ey, ew, eh).stroke({ width: Math.max(2, this.cell * 0.2), color: THEME.danger, alpha: 0.85 });
        this.gridLayer.addChild(edge);
    }

    /**
     * Cadre la vue. `zoom` à 1 montre le terrain entier (grand écran) ; une
     * valeur plus grande rapproche la caméra sur un point (téléphone).
     */
    setCamera(centerX, centerY, zoom, viewW, viewH) {
        if (!this.ready) return;
        this.world.scale.set(zoom);
        this.world.position.set(viewW / 2 - centerX * zoom, viewH / 2 - centerY * zoom);
    }

    /** Cadre le terrain entier dans la surface disponible. */
    fitWorld(viewW, viewH) {
        const w = this.cols * this.cell;
        const h = this.rows * this.cell;
        if (!w || !h) return 1;
        const zoom = Math.min(viewW / w, viewH / h);
        this.setCamera(w / 2, h / 2, zoom, viewW, viewH);
        return zoom;
    }

    /**
     * Redessine les territoires à partir de la grille.
     *
     * Les cases voisines d'une même ligne sont fusionnées en un rectangle, ce
     * qui divise par plus de dix le nombre de formes à produire. Le contour
     * lumineux est repris dans le calque de halo, qui reçoit le flou GPU.
     */
    updateTerritories(grid, colorOf) {
        if (!this.ready || !grid) return;
        this.territoryLayer.removeChildren();
        // Le calque de halo contient aussi les têtes : on ne vide que ce qui
        // appartient aux territoires, repéré par un marqueur.
        for (const child of [...this.glowLayer.children]) {
            if (child.isTerritory) child.destroy();
        }

        const owners = new Set();
        for (let i = 0; i < grid.length; i += 1) if (grid[i] !== 0) owners.add(grid[i]);

        const radius = this.cell * 0.5;

        for (const owner of owners) {
            const color = hexToNum(colorOf(owner) || '#3b82f6');
            const loops = extractOutlines(grid, this.cols, this.rows, owner);
            if (loops.length === 0) continue;

            const fill = new Graphics();
            const glow = new Graphics();

            // Le contour est tracé une fois et rejoué sur les deux calques :
            // le remplissage et le halo partagent exactement la même forme, ce
            // qui évite qu'un aplat en escalier dépasse d'une bordure arrondie.
            //
            // La tolérance vaut 0,7 case : assez pour effacer l'escalier des
            // diagonales (des marches d'une demi-case en moyenne), pas assez
            // pour déformer un vrai décrochement — à 1 case pleine, les carrés
            // de départ se transformaient en trapèzes.
            for (const loop of loops) {
                const pts = simplifyLoop(loop, 0.7);
                traceSmoothLoop(fill, pts, this.cell, radius);
                traceSmoothLoop(glow, pts, this.cell, radius);
            }

            fill.fill({ color, alpha: 0.34 });
            // Le trait vif dessine la frontière : c'est lui qui se lit de loin.
            fill.stroke({ width: Math.max(2, this.cell * 0.22), color, alpha: 1 });
            // Le halo est rempli ET contourné d'un trait large : c'est ce
            // débordement, une fois flouté, qui fait rayonner la zone au-delà de
            // ses bords au lieu de rester confiné à l'intérieur.
            glow.fill({ color, alpha: 0.55 });
            glow.stroke({ width: this.cell * 1.1, color, alpha: 0.9 });
            glow.isTerritory = true;

            this.territoryLayer.addChild(fill);
            this.glowLayer.addChild(glow);
        }
    }

    /**
     * Traînée d'un joueur : un chemin continu, pas une suite de cases.
     *
     * C'est ce qui remplace l'aspect en escalier — le trait a des jointures et
     * des extrémités arrondies, et se courbe naturellement dans les virages.
     */
    /**
     * @param {number} [strideCols] largeur de grille dans laquelle les indices de
     *   `cells` sont exprimés. Sur le téléphone, la scène affiche une fenêtre
     *   mais les traînées arrivent en coordonnées **monde** : sans cette
     *   distinction, elles se décaleraient à chaque glissement de caméra.
     */
    updateTrail(owner, cells, version, color, strideCols, offsetX = 0, offsetY = 0) {
        if (!this.ready) return;
        let entry = this.trails.get(owner);
        if (!entry) {
            const g = new Graphics();
            const glow = new Graphics();
            glow.isTerritory = false;
            this.trailLayer.addChild(g);
            this.glowLayer.addChild(glow);
            entry = { g, glow, version: -1, count: 0 };
            this.trails.set(owner, entry);
        }
        if (entry.version === version && entry.count === cells.length) return;

        entry.version = version;
        entry.count = cells.length;
        entry.g.clear();
        entry.glow.clear();
        if (cells.length === 0) return;

        const c = hexToNum(color);
        const half = this.cell / 2;
        const stride = strideCols || this.cols;
        const pts = cells.map((key) => {
            const x = key % stride;
            const y = (key - x) / stride;
            return {
                x: (x - offsetX) * this.cell + half,
                y: (y - offsetY) * this.cell + half,
            };
        });

        // Le halo part sur le calque flouté, le trait net reste au-dessus :
        // c'est ce qui donne au néon sa profondeur.
        // La tolérance est en pixels ici (les points sont déjà mis à l'échelle),
        // dosée à une case : c'est ce qui redresse l'escalier des diagonales.
        const tol = this.cell;
        tracePath(entry.glow, pts, tol);
        entry.glow.stroke({ width: this.cell * 0.9, color: c, alpha: 0.9, cap: 'round', join: 'round' });
        tracePath(entry.g, pts, tol);
        entry.g.stroke({ width: this.cell * 0.42, color: c, alpha: 1, cap: 'round', join: 'round' });
    }

    removeTrail(owner) {
        const entry = this.trails.get(owner);
        if (!entry) return;
        entry.g.destroy();
        entry.glow?.destroy();
        this.trails.delete(owner);
    }

    /** Tête d'un joueur : la forme d'identité, un halo, et un noyau clair. */
    updateHead(owner, x, y, { color, shape, dead, shielded, isMe }) {
        if (!this.ready) return;
        let head = this.heads.get(owner);
        if (!head) {
            const glow = new Graphics();
            const g = new Graphics();
            // Marqué comme non-territoire : le nettoyage des territoires ne doit
            // pas emporter les halos de têtes, qui vivent sur le même calque.
            glow.isTerritory = false;
            this.glowLayer.addChild(glow);
            this.playerLayer.addChild(g);
            head = { g, glow, shape: null, color: null, dead: null, shielded: null, isMe: null };
            this.heads.set(owner, head);
        }

        head.g.position.set(x, y);
        head.glow.position.set(x, y);
        head.g.alpha = dead ? 0.25 : 1;
        head.glow.alpha = dead ? 0.1 : 1;

        // On ne reconstruit la géométrie que si l'apparence a changé : à 60 fps,
        // seule la position bouge la plupart du temps.
        const same = head.shape === shape && head.color === color
            && head.shielded === shielded && head.isMe === isMe;
        if (same) return;
        head.shape = shape;
        head.color = color;
        head.shielded = shielded;
        head.isMe = isMe;

        const c = hexToNum(color);
        const r = this.cell * 0.78;

        head.glow.clear();
        head.glow.circle(0, 0, r * 1.5).fill({ color: c, alpha: 0.85 });

        head.g.clear();
        traceShape(head.g, shape, r);
        head.g.fill({ color: c });
        head.g.stroke({ width: Math.max(2, this.cell * 0.14), color: 0x000000, alpha: 0.6 });
        // Noyau clair : donne la position même quand deux teintes se ressemblent.
        head.g.circle(0, 0, r * 0.32).fill({ color: 0xffffff, alpha: 0.92 });

        if (shielded) {
            head.g.circle(0, 0, r * 1.85).stroke({ width: 3, color: THEME.ink, alpha: 0.85 });
        }
        if (isMe) {
            head.g.circle(0, 0, r * 2.3).stroke({ width: 2, color: 0xffffff, alpha: 0.4 });
        }
    }

    removeHead(owner) {
        const head = this.heads.get(owner);
        if (!head) return;
        head.g.destroy();
        head.glow.destroy();
        this.heads.delete(owner);
    }

    /** Onde de choc d'une capture. */
    addShockwave(x, y, color) {
        if (!this.ready) return;
        const g = new Graphics();
        this.fxLayer.addChild(g);
        this.effects.push({ kind: 'wave', g, x, y, color: hexToNum(color), start: performance.now(), duration: 700 });
    }

    /** Éclat de fragments à la mort d'un joueur. */
    addBurst(x, y, color) {
        if (!this.ready) return;
        const g = new Graphics();
        this.fxLayer.addChild(g);
        const bits = [];
        for (let i = 0; i < 14; i += 1) {
            const a = (Math.PI * 2 * i) / 14 + Math.random() * 0.4;
            bits.push({ a, speed: 60 + Math.random() * 120, size: 3 + Math.random() * 5 });
        }
        this.effects.push({ kind: 'burst', g, x, y, bits, color: hexToNum(color), start: performance.now(), duration: 620 });
    }

    /** Fait avancer les effets. À appeler une fois par image. */
    tickEffects() {
        if (!this.ready) return;
        const now = performance.now();
        this.effects = this.effects.filter((e) => {
            const t = (now - e.start) / e.duration;
            if (t >= 1) { e.g.destroy(); return false; }

            e.g.clear();
            if (e.kind === 'wave') {
                // ease-out-expo : l'onde part vite puis s'étale.
                const eased = 1 - Math.pow(2, -10 * t);
                e.g.circle(e.x, e.y, eased * this.cell * 14)
                    .stroke({ width: (1 - t) * 8 + 1, color: e.color, alpha: (1 - t) * 0.8 });
            } else {
                for (const b of e.bits) {
                    const d = b.speed * t;
                    e.g.circle(e.x + Math.cos(b.a) * d, e.y + Math.sin(b.a) * d, b.size * (1 - t))
                        .fill({ color: e.color, alpha: 1 - t });
                }
            }
            return true;
        });
    }
}

/**
 * Extrait les contours fermés d'un territoire en suivant ses arêtes.
 *
 * On ne parcourt pas les cases mais les **arêtes entre cases**, orientées de
 * sorte que le territoire reste à gauche : elles se chaînent alors d'elles-mêmes
 * en boucles fermées. C'est la condition pour pouvoir lisser — un contour
 * continu se courbe, des rectangles isolés restent un escalier.
 */
function extractOutlines(grid, cols, rows, owner) {
    const has = (x, y) => x >= 0 && y >= 0 && x < cols && y < rows && grid[y * cols + x] === owner;
    const edges = new Map();
    const key = (x, y) => `${x},${y}`;
    const addEdge = (x1, y1, x2, y2) => {
        const k = key(x1, y1);
        if (!edges.has(k)) edges.set(k, []);
        edges.get(k).push({ x: x2, y: y2 });
    };

    for (let y = 0; y < rows; y += 1) {
        for (let x = 0; x < cols; x += 1) {
            if (!has(x, y)) continue;
            if (!has(x, y - 1)) addEdge(x, y, x + 1, y);
            if (!has(x + 1, y)) addEdge(x + 1, y, x + 1, y + 1);
            if (!has(x, y + 1)) addEdge(x + 1, y + 1, x, y + 1);
            if (!has(x - 1, y)) addEdge(x, y + 1, x, y);
        }
    }

    const loops = [];
    while (edges.size > 0) {
        const startKey = edges.keys().next().value;
        const [sx, sy] = startKey.split(',').map(Number);
        const loop = [];
        let cx = sx;
        let cy = sy;
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
 * Réduit un contour à ses points significatifs (Douglas-Peucker).
 *
 * C'est l'étape décisive pour l'aspect du jeu. Une frontière en diagonale sur
 * une grille est un escalier de marches d'une case : retirer seulement les
 * points parfaitement alignés n'enlève rien, et l'arrondi d'angles reste
 * invisible à cette échelle — l'escalier subsiste.
 *
 * En écartant les points qui s'éloignent de moins d'une case de la droite qui
 * relie leurs voisins, l'escalier redevient la diagonale qu'il représentait, et
 * les vrais décrochements sont conservés.
 */
function simplifyLoop(points, tolerance = 1.0) {
    if (points.length < 4) return points;

    // Distance d'un point au segment [a, b].
    const dist = (p, a, b) => {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len2 = dx * dx + dy * dy;
        if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
        let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
        t = Math.max(0, Math.min(1, t));
        return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
    };

    // Version itérative : une récursion pourrait déborder la pile sur un contour
    // de plusieurs milliers de points.
    const keep = new Uint8Array(points.length);
    keep[0] = 1;
    keep[points.length - 1] = 1;
    const stack = [[0, points.length - 1]];

    while (stack.length > 0) {
        const [first, last] = stack.pop();
        if (last <= first + 1) continue;
        let maxDist = 0;
        let index = -1;
        for (let i = first + 1; i < last; i += 1) {
            const d = dist(points[i], points[first], points[last]);
            if (d > maxDist) { maxDist = d; index = i; }
        }
        if (maxDist > tolerance && index > 0) {
            keep[index] = 1;
            stack.push([first, index], [index, last]);
        }
    }

    const out = [];
    for (let i = 0; i < points.length; i += 1) if (keep[i]) out.push(points[i]);
    return out.length > 2 ? out : points;
}

/**
 * Trace un contour fermé avec les angles arrondis.
 *
 * Chaque coin devient une courbe dont le point de contrôle est le coin lui-même :
 * le trait entre et sort par le milieu des segments voisins. Le rayon est
 * plafonné à la moitié du plus court segment, sinon deux arrondis se
 * chevaucheraient.
 */
function traceSmoothLoop(g, points, cell, radius) {
    const n = points.length;
    if (n < 3) return;

    const mid = (a, b) => {
        const ax = a.x * cell;
        const ay = a.y * cell;
        const dx = b.x * cell - ax;
        const dy = b.y * cell - ay;
        const len = Math.hypot(dx, dy) || 1;
        const t = Math.min(radius, len / 2) / len;
        return { x: ax + dx * t, y: ay + dy * t };
    };

    const first = mid(points[0], points[1]);
    g.moveTo(first.x, first.y);
    for (let i = 1; i <= n; i += 1) {
        const curr = points[i % n];
        const entry = mid(curr, points[(i - 1 + n) % n]);
        const exit = mid(curr, points[(i + 1) % n]);
        g.lineTo(entry.x, entry.y);
        g.quadraticCurveTo(curr.x * cell, curr.y * cell, exit.x, exit.y);
    }
    g.closePath();
}

/**
 * Même réduction que `simplifyLoop`, pour un tracé ouvert (une traînée).
 * Les deux extrémités sont toujours conservées : elles portent la position de
 * départ et la tête du joueur.
 */
function simplifyOpenPath(points, tolerance = 1.0) {
    if (points.length < 3) return points;

    const dist = (p, a, b) => {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len2 = dx * dx + dy * dy;
        if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
        let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
        t = Math.max(0, Math.min(1, t));
        return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
    };

    const keep = new Uint8Array(points.length);
    keep[0] = 1;
    keep[points.length - 1] = 1;
    const stack = [[0, points.length - 1]];

    while (stack.length > 0) {
        const [first, last] = stack.pop();
        if (last <= first + 1) continue;
        let maxDist = 0;
        let index = -1;
        for (let i = first + 1; i < last; i += 1) {
            const d = dist(points[i], points[first], points[last]);
            if (d > maxDist) { maxDist = d; index = i; }
        }
        if (maxDist > tolerance && index > 0) {
            keep[index] = 1;
            stack.push([first, index], [index, last]);
        }
    }

    const out = [];
    for (let i = 0; i < points.length; i += 1) if (keep[i]) out.push(points[i]);
    return out;
}

/**
 * Trace une polyligne en arrondissant les virages.
 *
 * Les points viennent d'une grille : les relier au trait droit produit un
 * escalier. On passe donc par le milieu de chaque segment et on courbe autour du
 * point de grille, qui devient le point de contrôle. Le tracé suit exactement le
 * chemin parcouru, mais sans les angles droits.
 */
function tracePath(g, raw, tolerance = 1.0) {
    if (raw.length === 0) return;

    // Même problème que pour les contours : une traînée en diagonale est un
    // escalier de marches d'une case. On la redresse d'abord, sinon le lissage
    // produit une ondulation — pire que l'escalier.
    const pts = simplifyOpenPath(raw, tolerance);

    if (pts.length < 3) {
        g.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i += 1) g.lineTo(pts[i].x, pts[i].y);
        return;
    }

    g.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 1; i += 1) {
        const mx = (pts[i].x + pts[i + 1].x) / 2;
        const my = (pts[i].y + pts[i + 1].y) / 2;
        g.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
    }
    const last = pts[pts.length - 1];
    g.lineTo(last.x, last.y);
}

/** Trace la forme d'identité d'un joueur, centrée sur l'origine. */
export function traceShape(g, shape, r) {
    switch (shape) {
        case 'square':
            g.rect(-r * 0.8, -r * 0.8, r * 1.6, r * 1.6);
            break;
        case 'triangle':
            g.poly([0, -r, r * 0.92, r * 0.72, -r * 0.92, r * 0.72]);
            break;
        case 'diamond':
            g.poly([0, -r * 1.1, r, 0, 0, r * 1.1, -r, 0]);
            break;
        case 'hexagon': {
            const pts = [];
            for (let i = 0; i < 6; i += 1) {
                const a = (Math.PI / 3) * i - Math.PI / 2;
                pts.push(Math.cos(a) * r, Math.sin(a) * r);
            }
            g.poly(pts);
            break;
        }
        case 'star': {
            const pts = [];
            for (let i = 0; i < 10; i += 1) {
                const a = (Math.PI / 5) * i - Math.PI / 2;
                const rad = i % 2 === 0 ? r * 1.15 : r * 0.5;
                pts.push(Math.cos(a) * rad, Math.sin(a) * rad);
            }
            g.poly(pts);
            break;
        }
        default:
            g.circle(0, 0, r);
    }
}
