import { useRef, useState } from 'react';
import { Camera, Check, RotateCcw } from 'lucide-react';

const MAX_EDGE = 1200;
const JPEG_QUALITY = 0.7;

/**
 * Prise de photo de la production d'une table (croquis, château de cartes…).
 *
 * Le redimensionnement est fait ici, avant l'envoi : un appareil moderne shoote
 * en 4000 px, et six tables sur quinze manches satureraient la mémoire du serveur.
 * On descend le plus grand côté à 1200 px en JPEG 0.7, ce qui reste largement
 * lisible projeté sur le grand écran.
 */
function PhotoCapture({ onSubmit, disabled, submitted }) {
    const inputRef = useRef(null);
    const [preview, setPreview] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const handleFile = async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;

        setBusy(true);
        setError('');
        try {
            const dataUrl = await shrink(file);
            setPreview(dataUrl);
        } catch (err) {
            setError("Impossible de lire cette photo. Réessayez.");
            console.error('[PARTY] Erreur de lecture photo:', err);
        } finally {
            setBusy(false);
            // Permet de reprendre la même photo deux fois de suite.
            if (inputRef.current) inputRef.current.value = '';
        }
    };

    const confirm = () => {
        if (!preview) return;
        onSubmit(preview, (err) => {
            if (err) setError(err);
            else setPreview(null);
        });
    };

    if (submitted) {
        return (
            <div className="pty-panel p-6 flex flex-col items-center gap-3 text-center">
                <Check className="w-10 h-10" style={{ color: '#22c55e' }} />
                <p className="font-bold text-lg">Photo envoyée</p>
                <p className="text-sm" style={{ color: 'var(--pty-muted)' }}>
                    Elle part au vote dès que toutes les tables ont rendu.
                </p>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-4 w-full">
            {preview ? (
                <>
                    <div className="pty-gallery-card" style={{ aspectRatio: '4 / 3' }}>
                        <img src={preview} alt="Aperçu de votre création" />
                    </div>
                    <div className="flex gap-3">
                        <button
                            type="button"
                            className="pty-btn flex-1"
                            onClick={() => setPreview(null)}
                            disabled={disabled}
                        >
                            <RotateCcw className="w-4 h-4" />
                            Reprendre
                        </button>
                        <button
                            type="button"
                            className="pty-btn pty-btn-primary flex-1"
                            onClick={confirm}
                            disabled={disabled}
                        >
                            <Check className="w-4 h-4" />
                            Envoyer
                        </button>
                    </div>
                </>
            ) : (
                <button
                    type="button"
                    className="pty-btn pty-btn-primary w-full"
                    style={{ minHeight: 72, fontSize: '1.05rem' }}
                    onClick={() => inputRef.current?.click()}
                    disabled={disabled || busy}
                >
                    <Camera className="w-6 h-6" />
                    {busy ? 'Traitement…' : 'Photographier ma création'}
                </button>
            )}

            {error && <p className="text-sm text-center" style={{ color: 'var(--pty-accent)' }}>{error}</p>}

            <input
                ref={inputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleFile}
                style={{ display: 'none' }}
            />
        </div>
    );
}

function shrink(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Lecture impossible'));
        reader.onload = () => {
            const image = new Image();
            image.onerror = () => reject(new Error('Image illisible'));
            image.onload = () => {
                const scale = Math.min(1, MAX_EDGE / Math.max(image.width, image.height));
                const canvas = document.createElement('canvas');
                canvas.width = Math.round(image.width * scale);
                canvas.height = Math.round(image.height * scale);
                const ctx = canvas.getContext('2d');
                ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL('image/jpeg', JPEG_QUALITY));
            };
            image.src = reader.result;
        };
        reader.readAsDataURL(file);
    });
}

export default PhotoCapture;
