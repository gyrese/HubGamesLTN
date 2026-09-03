import { useEffect, useState } from 'react';
import { socket } from '../../../socket';

/**
 * RÉFLEXE — grand écran.
 *
 * L'écran donne le signal, il ne mesure rien : c'est le serveur qui horodate.
 * Tout est joué sur la lisibilité de loin — pleine surface, deux couleurs.
 */
function ReflexeHost() {
    const [phase, setPhase] = useState('idle'); // idle | armed | go
    const [volley, setVolley] = useState(0);

    useEffect(() => {
        const onPulse = (payload) => {
            if (!payload) return;
            if (payload.kind === 'arm') { setVolley(payload.volley); setPhase('armed'); }
            if (payload.kind === 'go') { setVolley(payload.volley); setPhase('go'); }
        };
        socket.on('party-pulse', onPulse);
        return () => socket.off('party-pulse', onPulse);
    }, []);

    const background = phase === 'go' ? '#22c55e' : phase === 'armed' ? '#7f1d1d' : 'transparent';

    return (
        <div
            className="flex-1 flex flex-col items-center justify-center rounded-3xl transition-colors"
            style={{ background, transitionDuration: '80ms' }}
        >
            <p className="pty-eyebrow mb-4">Volée {Math.min(volley + 1, 4)} sur 4</p>
            <p
                className="pty-title text-center"
                style={{ fontSize: 'clamp(3rem, 12vw, 9rem)', color: phase === 'go' ? '#fffdf7' : 'var(--pty-ink)' }}
            >
                {phase === 'go' ? 'TAPEZ !' : phase === 'armed' ? 'ATTENDEZ' : 'PRÊTS ?'}
            </p>
            {phase !== 'go' && (
                <p className="text-xl mt-6" style={{ color: 'var(--pty-muted)' }}>
                    Le premier doigt sur l'écran vert emporte la volée
                </p>
            )}
        </div>
    );
}

export default ReflexeHost;
