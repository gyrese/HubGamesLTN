import { useEffect, useState } from 'react';
import { socket } from '../../../socket';

/**
 * RÉFLEXE — côté téléphone.
 *
 * Le pad occupe tout l'écran : à cette vitesse, viser un petit bouton fausserait
 * la mesure. Rouge = on attend, vert = on tape. Partir trop tôt annule la volée,
 * et le serveur seul décide (il horodate à la réception) : rien n'est calculé ici.
 */
function ReflexePlayer({ roomCode, canPlay }) {
    const [phase, setPhase] = useState('idle'); // idle | armed | go | done | fail
    const [volley, setVolley] = useState(0);
    const [reaction, setReaction] = useState(null);
    const [scores, setScores] = useState([]);

    useEffect(() => {
        const onPulse = (payload) => {
            if (!payload) return;
            switch (payload.kind) {
                case 'arm':
                    setVolley(payload.volley);
                    setReaction(null);
                    setPhase('armed');
                    break;
                case 'go':
                    setVolley(payload.volley);
                    setPhase('go');
                    if (navigator.vibrate) navigator.vibrate(12);
                    break;
                case 'reaction':
                    setReaction(payload.reaction);
                    setScores((prev) => [...prev, payload.score]);
                    setPhase('done');
                    break;
                case 'false-start':
                    setScores((prev) => [...prev, 0]);
                    setPhase('fail');
                    break;
                default:
                    break;
            }
        };

        socket.on('party-pulse', onPulse);
        return () => socket.off('party-pulse', onPulse);
    }, []);

    const tap = () => {
        if (!canPlay) return;
        if (phase !== 'armed' && phase !== 'go') return;
        socket.emit('party-input', { roomCode, data: { volley } });
    };

    if (!canPlay) {
        return (
            <div className="pty-panel p-6 text-center">
                <p className="font-bold text-lg">Votre table est hors course sur cette épreuve.</p>
                <p className="text-sm mt-2" style={{ color: 'var(--pty-muted)' }}>
                    Vous reprenez la main à la manche suivante.
                </p>
            </div>
        );
    }

    const label = {
        idle: 'Préparez-vous…',
        armed: 'ATTENDEZ',
        go: 'TAPEZ !',
        done: reaction !== null ? `${reaction} ms` : 'Enregistré',
        fail: 'Trop tôt !',
    }[phase];

    const padClass = {
        idle: 'pty-reflex-done',
        armed: 'pty-reflex-wait',
        go: 'pty-reflex-go',
        done: 'pty-reflex-done',
        fail: 'pty-reflex-fail',
    }[phase];

    return (
        <div className="flex flex-col gap-4 flex-1">
            <button type="button" className={`pty-reflex-pad ${padClass}`} onClick={tap}>
                <span>{label}</span>
                {phase === 'done' && (
                    <span className="text-sm font-semibold opacity-70">
                        Volée {volley + 1} sur 4
                    </span>
                )}
                {phase === 'fail' && (
                    <span className="text-sm font-semibold opacity-80">
                        Volée perdue, la suivante arrive
                    </span>
                )}
            </button>

            {scores.length > 0 && (
                <div className="flex justify-center gap-2">
                    {scores.map((score, index) => (
                        <span key={index} className="pty-badge">
                            {score > 0 ? `${score}` : '✗'}
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}

export default ReflexePlayer;
