import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * Studio de détourage CouleurMoi.
 * - Charge une image locale dans un canvas.
 * - "Détourer" : clic sur la feature -> remplissage par diffusion -> zone transparente.
 *   (les contours sombres des dessins servent de barrières naturelles)
 * - "Pipette" : clic sur la feature -> échantillonne la couleur -> renvoie le HSB.
 * - Exporte un WebP transparent (la feature trouée) prêt à être recoloré par la palette.
 * Tout est fait côté client ; aucune dépendance externe.
 */

const MAX_DIM = 512;

function rgbToHsb(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d !== 0) {
        if (max === r) h = ((g - b) / d) % 6;
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h *= 60; if (h < 0) h += 360;
    }
    const s = max === 0 ? 0 : d / max;
    return { h: Math.round(h), s: Math.round(s * 100), b: Math.round(max * 100) };
}

function hsbToCss(h, s, b) {
    const v = b / 100, sHsb = s / 100;
    const l = v * (1 - sHsb / 2);
    const sHsl = (l === 0 || l === 1) ? 0 : (v - l) / Math.min(l, 1 - l);
    return `hsl(${h}, ${Math.round(sHsl * 100)}%, ${Math.round(l * 100)}%)`;
}

// Remplissage par diffusion : troue l'alpha des pixels connectés proches du pixel d'amorce.
function floodFillTransparent(data, w, h, sx, sy, tol) {
    const i0 = (sy * w + sx) * 4;
    if (data[i0 + 3] === 0) return 0; // déjà transparent
    const sr = data[i0], sg = data[i0 + 1], sb = data[i0 + 2];
    const tol2 = 3 * tol * tol; // seuil sur distance² RGB (~tol par canal)
    const seen = new Uint8Array(w * h);
    const stack = [sx, sy];
    let count = 0;
    while (stack.length) {
        const y = stack.pop(), x = stack.pop();
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const p = y * w + x;
        if (seen[p]) continue;
        seen[p] = 1;
        const i = p * 4;
        if (data[i + 3] === 0) continue;
        const dr = data[i] - sr, dg = data[i + 1] - sg, db = data[i + 2] - sb;
        if (dr * dr + dg * dg + db * db > tol2) continue;
        data[i + 3] = 0;
        count++;
        stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
    }
    return count;
}

export default function ColorImageStudio({ file, target, onChange }) {
    const canvasRef = useRef(null);
    const origRef = useRef(null);   // ImageData d'origine (échantillonnage + reset)
    const undoRef = useRef([]);     // pile d'undo
    const [mode, setMode] = useState('detour'); // 'detour' | 'pick'
    const [tol, setTol] = useState(50);
    const [ready, setReady] = useState(false);
    const [previewTarget, setPreviewTarget] = useState(false);

    const exportBlob = useCallback(() => {
        const cv = canvasRef.current;
        if (!cv || !onChange) return;
        cv.toBlob((blob) => { if (blob) onChange({ blob }); }, 'image/webp', 0.92);
    }, [onChange]);

    // Chargement du fichier
    useEffect(() => {
        if (!file) { setReady(false); return; }
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            let w = img.width, h = img.height;
            const scale = Math.min(1, MAX_DIM / Math.max(w, h));
            w = Math.round(w * scale); h = Math.round(h * scale);
            const cv = canvasRef.current;
            if (!cv) return;
            cv.width = w; cv.height = h;
            const ctx = cv.getContext('2d', { willReadFrequently: true });
            ctx.clearRect(0, 0, w, h);
            ctx.drawImage(img, 0, 0, w, h);
            origRef.current = ctx.getImageData(0, 0, w, h);
            undoRef.current = [];
            setReady(true);
            URL.revokeObjectURL(url);
            exportBlob();
        };
        img.src = url;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [file]);

    const toImageCoords = (e) => {
        const cv = canvasRef.current;
        const rect = cv.getBoundingClientRect();
        return {
            x: Math.round((e.clientX - rect.left) * (cv.width / rect.width)),
            y: Math.round((e.clientY - rect.top) * (cv.height / rect.height)),
        };
    };

    const handleCanvasClick = (e) => {
        if (!ready) return;
        const cv = canvasRef.current;
        const ctx = cv.getContext('2d', { willReadFrequently: true });
        const { x, y } = toImageCoords(e);
        if (x < 0 || y < 0 || x >= cv.width || y >= cv.height) return;

        if (mode === 'pick') {
            // Échantillonne la couleur d'origine (moyenne 3x3) -> HSB
            const od = origRef.current.data, w = cv.width;
            let r = 0, g = 0, b = 0, n = 0;
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
                const xx = x + dx, yy = y + dy;
                if (xx < 0 || yy < 0 || xx >= cv.width || yy >= cv.height) continue;
                const i = (yy * w + xx) * 4;
                r += od[i]; g += od[i + 1]; b += od[i + 2]; n++;
            }
            const hsb = rgbToHsb(r / n, g / n, b / n);
            if (onChange) onChange({ hsb });
            return;
        }

        // Détourage
        const imgData = ctx.getImageData(0, 0, cv.width, cv.height);
        undoRef.current.push(new ImageData(new Uint8ClampedArray(imgData.data), cv.width, cv.height));
        if (undoRef.current.length > 8) undoRef.current.shift();
        floodFillTransparent(imgData.data, cv.width, cv.height, x, y, tol);
        ctx.putImageData(imgData, 0, 0);
        exportBlob();
    };

    const undo = () => {
        const prev = undoRef.current.pop();
        if (!prev) return;
        canvasRef.current.getContext('2d').putImageData(prev, 0, 0);
        exportBlob();
    };

    const reset = () => {
        if (!origRef.current) return;
        canvasRef.current.getContext('2d').putImageData(origRef.current, 0, 0);
        undoRef.current = [];
        exportBlob();
    };

    const targetCss = hsbToCss(target?.h || 0, target?.s || 0, target?.b || 0);
    const checker =
        'repeating-conic-gradient(#3a3a4a 0% 25%, #2a2a38 0% 50%) 50% / 18px 18px';

    return (
        <div className="border border-secondary rounded p-2 mt-2 bg-black">
            <div className="d-flex flex-wrap align-items-center gap-2 mb-2">
                <div className="btn-group btn-group-sm" role="group">
                    <button type="button"
                        className={`btn ${mode === 'detour' ? 'btn-primary' : 'btn-outline-primary'}`}
                        onClick={() => setMode('detour')}>✂️ Détourer</button>
                    <button type="button"
                        className={`btn ${mode === 'pick' ? 'btn-info' : 'btn-outline-info'}`}
                        onClick={() => setMode('pick')}>💧 Pipette</button>
                </div>
                <button type="button" className="btn btn-sm btn-outline-light" onClick={undo}>↶ Annuler</button>
                <button type="button" className="btn btn-sm btn-outline-warning" onClick={reset}>⟲ Reset</button>
                <label className="d-flex align-items-center gap-1 text-muted small mb-0 ms-1">
                    Tolérance
                    <input type="range" min="10" max="120" value={tol}
                        onChange={(e) => setTol(parseInt(e.target.value))} style={{ width: 90 }} />
                    <span className="font-mono" style={{ width: 26 }}>{tol}</span>
                </label>
                <label className="d-flex align-items-center gap-1 text-muted small mb-0 ms-auto">
                    <input type="checkbox" checked={previewTarget}
                        onChange={(e) => setPreviewTarget(e.target.checked)} />
                    Aperçu sur couleur cible
                </label>
            </div>

            <div className="d-flex justify-content-center rounded overflow-hidden"
                style={{ background: previewTarget ? targetCss : checker, padding: 8 }}>
                <canvas ref={canvasRef} onClick={handleCanvasClick}
                    style={{
                        maxWidth: '100%', maxHeight: 360, height: 'auto',
                        cursor: mode === 'pick' ? 'cell' : 'crosshair',
                        imageRendering: 'auto',
                    }} />
            </div>

            <p className="text-muted small mb-0 mt-2">
                {mode === 'detour'
                    ? '✂️ Clique sur la partie à recoloriser (ex : le t-shirt) pour la rendre transparente. Ajuste la tolérance si ça déborde ou s’il reste des zones.'
                    : '💧 Clique sur cette même partie pour définir automatiquement la couleur cible (H/S/B).'}
            </p>
        </div>
    );
}
