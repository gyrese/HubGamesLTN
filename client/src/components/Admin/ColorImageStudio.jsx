import { useEffect, useRef, useState, useCallback } from 'react';
import { 
    Sparkles, 
    Scissors, 
    Pipette, 
    Undo2, 
    RotateCcw, 
    HelpCircle, 
    Check, 
    AlertCircle, 
    Eye,
    Sliders
} from 'lucide-react';

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

export default function ColorImageStudio({ file, target, part, apiUrl, onChange }) {
    const canvasRef = useRef(null);
    const origRef = useRef(null);   // ImageData d'origine (échantillonnage + reset)
    const undoRef = useRef([]);     // pile d'undo
    const [mode, setMode] = useState('detour'); // 'detour' | 'pick'
    const [tol, setTol] = useState(50);
    const [ready, setReady] = useState(false);
    const [previewTarget, setPreviewTarget] = useState(false);
    const [aiLoading, setAiLoading] = useState(false);
    const [aiError, setAiError] = useState('');
    const [aiInfo, setAiInfo] = useState('');

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
    }, [file, exportBlob]);

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

    // Détourage assisté par IA : Gemini localise la partie nommée (points), puis on
    // lance le flood-fill existant depuis chaque point et on échantillonne la couleur.
    const autoSegment = useCallback(async () => {
        if (!ready || aiLoading) return;
        const cleanPart = (part || '').trim();
        if (!cleanPart) { setAiError('Renseigne d’abord « Partie à colorer » ci-dessus.'); setAiInfo(''); return; }
        if (!apiUrl) { setAiError('Configuration API manquante.'); return; }
        setAiError(''); setAiInfo(''); setAiLoading(true);
        try {
            const cv = canvasRef.current;
            const w = cv.width, h = cv.height;

            // On envoie l'image d'origine (non éditée) pour que l'IA voie la partie intacte.
            const tmp = document.createElement('canvas');
            tmp.width = w; tmp.height = h;
            tmp.getContext('2d').putImageData(origRef.current, 0, 0);
            const blob = await new Promise((r) => tmp.toBlob(r, 'image/png'));

            const fd = new FormData();
            fd.append('image', blob, 'source.png');
            fd.append('part', cleanPart);

            const res = await fetch(`${apiUrl}/admin/color/segment`, { method: 'POST', body: fd });
            const payload = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(payload.error || `Erreur ${res.status}`);
            const points = payload.points || [];
            if (points.length === 0) throw new Error('Aucune zone détectée par l’IA.');

            // Applique le détourage : flood-fill depuis chaque point + moyenne de couleur.
            const ctx = cv.getContext('2d', { willReadFrequently: true });
            const imgData = ctx.getImageData(0, 0, w, h);
            undoRef.current.push(new ImageData(new Uint8ClampedArray(imgData.data), w, h));
            if (undoRef.current.length > 8) undoRef.current.shift();

            const od = origRef.current.data;
            let r = 0, g = 0, b = 0, n = 0, filled = 0;
            for (const pt of points) {
                const x = Math.min(w - 1, Math.max(0, Math.round((pt.x / 1000) * w)));
                const y = Math.min(h - 1, Math.max(0, Math.round((pt.y / 1000) * h)));
                filled += floodFillTransparent(imgData.data, w, h, x, y, tol);
                for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
                    const xx = x + dx, yy = y + dy;
                    if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
                    const i = (yy * w + xx) * 4;
                    r += od[i]; g += od[i + 1]; b += od[i + 2]; n++;
                }
            }
            ctx.putImageData(imgData, 0, 0);
            if (n > 0 && onChange) onChange({ hsb: rgbToHsb(r / n, g / n, b / n) });
            exportBlob();

            if (filled === 0) {
                setAiError('Zones trouvées mais rien détouré — monte la tolérance et relance, ou clique à la main.');
            } else {
                const z = points.length;
                setAiInfo(`✅ ${z} zone${z > 1 ? 's' : ''} détectée${z > 1 ? 's' : ''} · couleur pré-remplie.`);
            }
        } catch (e) {
            setAiError(e.message || 'Échec du détourage IA.');
        } finally {
            setAiLoading(false);
        }
    }, [ready, aiLoading, part, apiUrl, tol, onChange, exportBlob]);

    const targetCss = hsbToCss(target?.h || 0, target?.s || 0, target?.b || 0);
    const checker =
        'repeating-conic-gradient(#202535 0% 25%, #151825 0% 50%) 50% / 16px 16px';

    return (
        <div className="border border-slate-850 rounded-2xl p-3.5 mt-3 bg-slate-950/80 space-y-4">
            {/* Tool tray controls */}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900/60 p-2 rounded-xl border border-slate-850">
                <div className="flex items-center gap-2">
                    <button 
                        type="button" 
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all active:scale-[0.97] disabled:opacity-40 ${
                            aiLoading ? 'bg-amber-600/10 border border-amber-500/20 text-amber-400' : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                        }`}
                        onClick={autoSegment} 
                        disabled={aiLoading || !ready}
                        title="Détourage IA automatique"
                    >
                        <Sparkles className={`w-3.5 h-3.5 ${aiLoading ? 'animate-pulse' : ''}`} />
                        {aiLoading ? 'Analyse IA...' : 'Auto IA'}
                    </button>

                    <div className="h-4 w-px bg-slate-800"></div>

                    <div className="inline-flex rounded-lg overflow-hidden bg-slate-950 p-0.5 border border-slate-850">
                        <button 
                            type="button"
                            className={`flex items-center gap-1 px-3 py-1 text-[10px] font-bold uppercase tracking-wider rounded-md transition-all ${
                                mode === 'detour' 
                                    ? 'bg-amber-600/20 border border-amber-500/20 text-amber-400' 
                                    : 'text-slate-400 hover:text-slate-200'
                            }`}
                            onClick={() => setMode('detour')}
                        >
                            <Scissors className="w-3.5 h-3.5" />
                            Détourer
                        </button>
                        <button 
                            type="button"
                            className={`flex items-center gap-1 px-3 py-1 text-[10px] font-bold uppercase tracking-wider rounded-md transition-all ${
                                mode === 'pick' 
                                    ? 'bg-cyan-600/20 border border-cyan-500/20 text-cyan-400' 
                                    : 'text-slate-400 hover:text-slate-200'
                            }`}
                            onClick={() => setMode('pick')}
                        >
                            <Pipette className="w-3.5 h-3.5" />
                            Pipette
                        </button>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <button 
                        type="button" 
                        className="p-1.5 bg-slate-950 hover:bg-slate-900 border border-slate-850 text-slate-400 hover:text-white rounded-lg transition-all"
                        onClick={undo}
                        title="Annuler"
                    >
                        <Undo2 className="w-3.5 h-3.5" />
                    </button>
                    <button 
                        type="button" 
                        className="p-1.5 bg-slate-950 hover:bg-slate-900 border border-slate-850 text-slate-450 hover:text-amber-400 rounded-lg transition-all"
                        onClick={reset}
                        title="Réinitialiser"
                    >
                        <RotateCcw className="w-3.5 h-3.5" />
                    </button>
                </div>
            </div>

            {/* Slider tolerance */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900/20 p-3 rounded-xl border border-slate-850">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-wide">
                    <Sliders className="w-3.5 h-3.5 text-amber-400" />
                    Tolérance de diffusion
                    <input 
                        type="range" 
                        min="10" 
                        max="120" 
                        value={tol}
                        onChange={(e) => setTol(parseInt(e.target.value))} 
                        className="w-24 accent-amber-500 cursor-ew-resize h-1.5 bg-slate-950 rounded-lg appearance-none"
                    />
                    <span className="font-mono text-amber-400 bg-slate-950 px-2 py-0.5 rounded border border-slate-850">{tol}</span>
                </div>

                <label className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-wide cursor-pointer select-none">
                    <input 
                        type="checkbox" 
                        checked={previewTarget}
                        onChange={(e) => setPreviewTarget(e.target.checked)}
                        className="w-4 h-4 rounded text-amber-600 bg-slate-950 border-slate-800 focus:ring-amber-500"
                    />
                    <Eye className="w-3.5 h-3.5 text-slate-400" />
                    Aperçu sur cible
                </label>
            </div>

            {/* Canvas Area */}
            <div 
                className="flex justify-center rounded-2xl overflow-hidden border border-slate-850/80 p-4 transition-all duration-300"
                style={{ background: previewTarget ? targetCss : checker }}
            >
                <canvas 
                    ref={canvasRef} 
                    onClick={handleCanvasClick}
                    className="max-w-full max-h-[360px] h-auto rounded-lg shadow-lg border border-slate-900/60"
                    style={{
                        cursor: mode === 'pick' ? 'cell' : 'crosshair',
                        imageRendering: 'auto',
                    }} 
                />
            </div>

            {/* Notifications info/error */}
            {aiError && (
                <div className="flex items-center gap-2 p-3 bg-red-950/20 border border-red-500/20 text-red-400 text-xs font-semibold rounded-xl">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    {aiError}
                </div>
            )}
            {aiInfo && (
                <div className="flex items-center gap-2 p-3 bg-emerald-950/20 border border-emerald-500/20 text-emerald-400 text-xs font-semibold rounded-xl">
                    <Check className="w-4 h-4 shrink-0" />
                    {aiInfo}
                </div>
            )}

            {/* Help instructions */}
            <p className="text-[10px] text-slate-500 uppercase tracking-wider leading-relaxed m-0 flex items-start gap-1.5">
                <HelpCircle className="w-4 h-4 text-slate-650 shrink-0 mt-px" />
                {mode === 'detour'
                    ? 'Mode Détourage : Cliquez sur les zones de couleur à effacer pour les rendre transparentes.'
                    : 'Mode Pipette : Cliquez sur la couleur d’origine pour l’enregistrer comme couleur cible.'}
            </p>
        </div>
    );
}
