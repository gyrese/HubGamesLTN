import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Monitor, Smartphone } from 'lucide-react';
import '../../components/Io/IoStyles.css';

/**
 * Tailles proposées à l'hôte. Elles doivent refléter `SIZES` de
 * `server/io/modes/territoire.js` — le serveur reste maître et retombe sur son
 * défaut si l'identifiant lui est inconnu.
 */
const SIZES = [
    { id: 'petit', label: 'Petit', detail: '80 × 45 — visible d\'un coup d\'œil' },
    { id: 'moyen', label: 'Moyen', detail: '120 × 70 — équilibré' },
    { id: 'grand', label: 'Grand', detail: '200 × 120 — il faut explorer' },
    { id: 'immense', label: 'Immense', detail: '320 × 180 — un monde à conquérir' },
];

/**
 * IO_ARENA — page d'entrée.
 *
 * Volontairement dépouillée : l'hôte ouvre l'écran, les joueurs scannent. Le
 * choix du mode se fait depuis le grand écran une fois le salon ouvert, pas ici,
 * parce que c'est l'hôte qui décide au dernier moment selon l'ambiance.
 */
function IoSelectPage() {
    const navigate = useNavigate();
    const [sizeId, setSizeId] = useState('moyen');

    useEffect(() => {
        document.body.classList.add('io-theme');
        return () => document.body.classList.remove('io-theme');
    }, []);

    return (
        <div className="ioa-root flex items-center justify-center p-6">
            <main className="w-full max-w-2xl flex flex-col gap-6">
                <div className="text-center">
                    <p className="ioa-eyebrow">Temps réel · le téléphone est une manette</p>
                    <h1 className="ioa-title">IO Arena</h1>
                    <p style={{ color: 'var(--ioa-muted)', marginTop: 8 }}>
                        Tout le monde joue en même temps sur le grand écran. On rejoint en
                        cours de partie, on repart quand on veut.
                    </p>
                </div>

                <section className="ioa-panel p-6 flex flex-col gap-4">
                    <div className="flex flex-col gap-3">
                        <p className="ioa-eyebrow">Taille du terrain</p>
                        <div className="ioa-size-grid">
                            {SIZES.map((s) => (
                                <button
                                    key={s.id}
                                    className={`ioa-size-btn${sizeId === s.id ? ' ioa-size-active' : ''}`}
                                    onClick={() => setSizeId(s.id)}
                                >
                                    <strong>{s.label}</strong>
                                    <small>{s.detail}</small>
                                </button>
                            ))}
                        </div>
                        <p style={{ color: 'var(--ioa-muted)', fontSize: '0.8rem', margin: 0 }}>
                            Au-delà du petit format, chaque joueur ne voit qu'une portion
                            de la carte sur son téléphone. Le grand écran, lui, montre tout.
                        </p>
                    </div>

                    <button
                        className="ioa-btn ioa-btn-primary w-full"
                        style={{ minHeight: 62 }}
                        onClick={() => navigate('/io/host', { state: { settings: { sizeId } } })}
                    >
                        <Monitor className="w-5 h-5" /> Ouvrir sur le grand écran
                    </button>
                    <button
                        className="ioa-btn w-full"
                        style={{ minHeight: 62 }}
                        onClick={() => navigate('/io/play')}
                    >
                        <Smartphone className="w-5 h-5" /> Rejoindre depuis un téléphone
                    </button>
                </section>

                <button className="ioa-btn mx-auto" onClick={() => navigate('/')}>
                    <ArrowLeft className="w-4 h-4" /> Retour au menu
                </button>
            </main>
        </div>
    );
}

export default IoSelectPage;
