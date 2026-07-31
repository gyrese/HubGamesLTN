// Moteur de rendu partagé par la vue joueur et la vue hôte de Draw Me.
//
// Toutes les coordonnées voyagent normalisées (0→1) : les canvas n'ont pas la
// même taille d'un écran à l'autre. Le rendu doit être *déterministe* — un même
// trait doit produire la même image chez le dessinateur, les devineurs et l'hôte
// — d'où le tirage aléatoire semé sur l'id du trait pour le spray, et le rendu
// systématique en une seule passe sur une surface vierge (cf. compose()).

export const BRUSHES = [
    { id: 'pen', label: 'Crayon', icon: 'stylus_note' },
    { id: 'brush', label: 'Pinceau', icon: 'brush' },
    { id: 'neon', label: 'Néon', icon: 'flare' },
    { id: 'spray', label: 'Spray', icon: 'blur_on' },
];

const BRUSH_IDS = new Set(BRUSHES.map(b => b.id));
export const isBrush = (id) => BRUSH_IDS.has(id);

// ─── Utilitaires couleur ──────────────────────────────────────────────

function hexToRgb(hex) {
    const h = (hex || '#000000').replace('#', '');
    const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
    const n = parseInt(full, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Mélange vers le blanc — le cœur clair d'un trait néon.
function lighten(hex, amount) {
    const [r, g, b] = hexToRgb(hex);
    const mix = (c) => Math.round(c + (255 - c) * amount);
    return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

// ─── Aléatoire déterministe (spray) ───────────────────────────────────

function hashString(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ─── Rendu des traits ─────────────────────────────────────────────────

function toPixels(points, w, h) {
    return points.map(pt => ({ x: pt.x * w, y: pt.y * h }));
}

// Chemin lissé par courbes de Bézier quadratiques passant par les points médians.
function tracePath(ctx, points) {
    ctx.beginPath();
    if (points.length === 2) {
        ctx.moveTo(points[0].x, points[0].y);
        ctx.lineTo(points[1].x, points[1].y);
        return;
    }
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length - 1; i++) {
        const midX = (points[i].x + points[i + 1].x) / 2;
        const midY = (points[i].y + points[i + 1].y) / 2;
        ctx.quadraticCurveTo(points[i].x, points[i].y, midX, midY);
    }
    const last = points[points.length - 1];
    const prevLast = points[points.length - 2];
    ctx.quadraticCurveTo(prevLast.x, prevLast.y, last.x, last.y);
}

function dot(ctx, x, y, radius, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
}

function renderPen(ctx, points, stroke) {
    if (points.length === 1) {
        dot(ctx, points[0].x, points[0].y, stroke.size / 2, stroke.color);
        return;
    }
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.size;
    tracePath(ctx, points);
    ctx.stroke();
}

// Pinceau : l'épaisseur suit la vitesse du tracé — fin quand la main va vite,
// épais quand elle ralentit. La vitesse se déduit de la distance entre points
// consécutifs (jamais d'horodatage : il faut que l'hôte retrouve le même tracé).
function renderBrush(ctx, points, stroke, w, h) {
    if (points.length === 1) {
        dot(ctx, points[0].x, points[0].y, (stroke.size * 1.4) / 2, stroke.color);
        return;
    }
    const diag = Math.hypot(w, h);
    const fast = diag * 0.035; // au-delà, le trait est à son plus fin

    let width = stroke.size * 1.4;
    ctx.strokeStyle = stroke.color;

    for (let i = 1; i < points.length; i++) {
        const prev = points[i - 1];
        const cur = points[i];
        const speed = Math.hypot(cur.x - prev.x, cur.y - prev.y);
        const target = stroke.size * (1.4 - Math.min(1, speed / fast) * 1.0);
        // Lissage : sans lui, un doigt qui saccade produit un trait en accordéon.
        width += (Math.max(stroke.size * 0.3, target) - width) * 0.35;

        ctx.lineWidth = width;
        ctx.beginPath();
        if (i === 1) {
            ctx.moveTo(prev.x, prev.y);
        } else {
            ctx.moveTo((points[i - 2].x + prev.x) / 2, (points[i - 2].y + prev.y) / 2);
        }
        const midX = (prev.x + cur.x) / 2;
        const midY = (prev.y + cur.y) / 2;
        ctx.quadraticCurveTo(prev.x, prev.y, midX, midY);
        if (i === points.length - 1) ctx.lineTo(cur.x, cur.y);
        ctx.stroke();
    }
}

// Néon : halo dans la couleur du trait + cœur éclairci, comme une enseigne.
// Deux passes de halo pour l'intensité — le shadowBlur seul reste trop timide.
function renderNeon(ctx, points, stroke) {
    const glow = Math.max(6, stroke.size * 1.6);

    ctx.shadowColor = stroke.color;
    ctx.shadowBlur = glow;
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = Math.max(1, stroke.size * 0.8);

    if (points.length === 1) {
        dot(ctx, points[0].x, points[0].y, ctx.lineWidth / 2, stroke.color);
        dot(ctx, points[0].x, points[0].y, ctx.lineWidth / 2, stroke.color);
        ctx.shadowBlur = 0;
        dot(ctx, points[0].x, points[0].y, Math.max(0.5, stroke.size * 0.18), lighten(stroke.color, 0.7));
        return;
    }

    tracePath(ctx, points);
    ctx.stroke();
    ctx.stroke();

    ctx.shadowBlur = 0;
    ctx.strokeStyle = lighten(stroke.color, 0.7);
    ctx.lineWidth = Math.max(1, stroke.size * 0.3);
    tracePath(ctx, points);
    ctx.stroke();
}

// Spray : nuage de points le long du tracé. Le tirage est semé sur l'id du trait,
// donc identique sur tous les écrans et stable au redimensionnement.
function renderSpray(ctx, points, stroke) {
    const rnd = mulberry32(hashString(stroke.id || 'spray'));
    const radius = Math.max(3, stroke.size * 1.1);
    const step = Math.max(1.5, radius * 0.4);
    const perStep = 3 + Math.round(stroke.size / 5);
    const dotSize = Math.min(3, Math.max(0.8, stroke.size * 0.13));

    ctx.fillStyle = stroke.color;

    // Tous les grains dans un seul chemin, remplis en une fois : un trait un peu
    // long dépasse le millier de points, et le canvas visible est recomposé à
    // chaque frame pendant le tracé. Un beginPath/fill par grain y ferait tomber
    // la fluidité sur mobile.
    ctx.beginPath();

    const spray = (x, y) => {
        for (let k = 0; k < perStep; k++) {
            const angle = rnd() * Math.PI * 2;
            // sqrt : sans lui les grains s'agglutinent au centre du nuage
            const r = Math.sqrt(rnd()) * radius;
            const gx = x + Math.cos(angle) * r;
            const gy = y + Math.sin(angle) * r;
            // moveTo avant chaque grain, sinon les sous-chemins se relient
            ctx.moveTo(gx + dotSize, gy);
            ctx.arc(gx, gy, dotSize, 0, Math.PI * 2);
        }
    };

    if (points.length === 1) {
        spray(points[0].x, points[0].y);
    } else {
        for (let i = 1; i < points.length; i++) {
            const prev = points[i - 1];
            const cur = points[i];
            const dist = Math.hypot(cur.x - prev.x, cur.y - prev.y);
            const steps = Math.max(1, Math.round(dist / step));
            for (let s = 0; s < steps; s++) {
                const t = s / steps;
                spray(prev.x + (cur.x - prev.x) * t, prev.y + (cur.y - prev.y) * t);
            }
        }
        spray(points[points.length - 1].x, points[points.length - 1].y);
    }

    ctx.fill();
}

/**
 * Dessine un trait sur le contexte donné, dans la brosse qu'il porte.
 * Les traits sans `brush` (anciens salons, client pas à jour) tombent sur le crayon.
 */
export function renderStroke(ctx, stroke) {
    if (!ctx || !stroke || !Array.isArray(stroke.points) || stroke.points.length === 0) return;
    const { width: w, height: h } = ctx.canvas;
    if (!w || !h) return;

    const points = toPixels(stroke.points, w, h);

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    switch (stroke.brush) {
        case 'brush': renderBrush(ctx, points, stroke, w, h); break;
        case 'neon': renderNeon(ctx, points, stroke); break;
        case 'spray': renderSpray(ctx, points, stroke); break;
        default: renderPen(ctx, points, stroke); break;
    }

    ctx.restore();
}

// ─── Pot de peinture ──────────────────────────────────────────────────

/**
 * Remplissage par diffusion (scanline) depuis un point normalisé.
 *
 * La tolérance absorbe l'anticrénelage des traits : sans elle, le remplissage
 * s'arrêterait sur les pixels à moitié teintés et laisserait un liseré blanc
 * large autour de chaque contour.
 */
export function floodFill(ctx, nx, ny, hexColor, tolerance = 60) {
    if (!ctx) return false;
    const { width: w, height: h } = ctx.canvas;
    if (!w || !h) return false;

    const x0 = Math.floor(nx * w);
    const y0 = Math.floor(ny * h);
    if (x0 < 0 || y0 < 0 || x0 >= w || y0 >= h) return false;

    const img = ctx.getImageData(0, 0, w, h);
    const data = img.data;

    const start = (y0 * w + x0) * 4;
    const tr = data[start], tg = data[start + 1], tb = data[start + 2];
    const [fr, fg, fb] = hexToRgb(hexColor);

    const tol2 = tolerance * tolerance;
    // Déjà de la bonne couleur : on s'épargne un parcours complet.
    const dr0 = tr - fr, dg0 = tg - fg, db0 = tb - fb;
    if (dr0 * dr0 + dg0 * dg0 + db0 * db0 <= tol2) return false;

    const visited = new Uint8Array(w * h);
    const matches = (px) => {
        const i = px * 4;
        const dr = data[i] - tr, dg = data[i + 1] - tg, db = data[i + 2] - tb;
        return dr * dr + dg * dg + db * db <= tol2;
    };

    const stack = [x0, y0];
    while (stack.length) {
        const y = stack.pop();
        const x = stack.pop();
        const row = y * w;
        if (visited[row + x] || !matches(row + x)) continue;

        let left = x;
        while (left > 0 && !visited[row + left - 1] && matches(row + left - 1)) left--;
        let right = x;
        while (right < w - 1 && !visited[row + right + 1] && matches(row + right + 1)) right++;

        for (let i = left; i <= right; i++) {
            const px = row + i;
            visited[px] = 1;
            const o = px * 4;
            data[o] = fr; data[o + 1] = fg; data[o + 2] = fb; data[o + 3] = 255;

            if (y > 0) {
                const up = px - w;
                if (!visited[up] && matches(up)) stack.push(i, y - 1);
            }
            if (y < h - 1) {
                const down = px + w;
                if (!visited[down] && matches(down)) stack.push(i, y + 1);
            }
        }
    }

    ctx.putImageData(img, 0, 0);
    return true;
}

// ─── Actions ──────────────────────────────────────────────────────────

/**
 * Applique une entrée de l'historique : un trait, ou un coup de pot de peinture.
 * Les deux transitent par le même événement `draw-stroke` — le serveur les stocke
 * et les relaie sans les interpréter, ce qui fait marcher l'annulation et le rejeu
 * à la reconnexion sans code serveur dédié.
 */
export function renderAction(ctx, action) {
    if (!ctx || !action) return;
    if (action.type === 'fill') {
        if (action.point) floodFill(ctx, action.point.x, action.point.y, action.color);
        return;
    }
    renderStroke(ctx, action);
}

/** Crée la surface hors écran qui porte les traits validés. */
export function createSurface(width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    // willReadFrequently : le pot de peinture appelle getImageData sur cette surface.
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, width, height);
    return { canvas, ctx };
}
