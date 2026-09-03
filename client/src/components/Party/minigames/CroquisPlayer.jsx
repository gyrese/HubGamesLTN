import { Pencil, Trophy, Users } from 'lucide-react';
import PhotoCapture from '../PhotoCapture';
import PhotoGallery from '../PhotoGallery';
import { usePhaseTimer } from '../usePhaseTimer';

/**
 * LE CROQUIS — côté téléphone.
 *
 * Le champion dessine sur papier, sans téléphone : c'est le capitaine qui tient
 * l'appareil de la table, affiche le thème et le chrono, photographie l'œuvre,
 * puis porte la voix de son équipe au moment du vote.
 */
function CroquisPlayer({
    phase, theme, remainingMs, duration,
    isCaptain, championName,
    photoSubmitted, onSubmitPhoto,
    gallery, chosenPid, hasVoted, onVote,
}) {
    const { seconds } = usePhaseTimer(remainingMs, duration);
    const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

    if (phase === 'brief' || phase === 'draw') {
        return (
            <div className="flex flex-col gap-5 flex-1">
                <div className="pty-panel p-5 text-center">
                    <p className="pty-eyebrow mb-3">Thème</p>
                    <p className="text-2xl font-black leading-tight">{theme || '…'}</p>
                </div>

                <div className="pty-panel p-6 flex flex-col items-center gap-3 text-center flex-1 justify-center">
                    <Pencil className="w-10 h-10" style={{ color: 'var(--pty-accent)' }} />
                    <p className="text-xl font-black">
                        {championName ? `${championName} dessine` : 'Votre table dessine'}
                    </p>
                    <p className="text-sm" style={{ color: 'var(--pty-muted)' }}>
                        {isCaptain
                            ? 'Sur papier. Montrez-lui le thème, vous photographierez à la fin du temps.'
                            : 'Sur papier. Le reste de la table a le droit de crier des conseils.'}
                    </p>
                    <p className="pty-title mt-2" style={{ fontSize: '3rem', color: 'var(--pty-accent)' }}>
                        {clock}
                    </p>
                </div>
            </div>
        );
    }

    if (phase === 'capture') {
        if (isCaptain) {
            return (
                <div className="flex flex-col gap-4 flex-1 justify-center">
                    <p className="text-center font-bold text-lg">
                        Photographiez le croquis {championName ? `de ${championName}` : ''}
                    </p>
                    <PhotoCapture onSubmit={onSubmitPhoto} submitted={photoSubmitted} />
                </div>
            );
        }
        return (
            <div className="pty-panel p-6 text-center flex-1 flex flex-col justify-center gap-2">
                <p className="text-lg font-bold">Les capitaines photographient</p>
                <p className="text-sm" style={{ color: 'var(--pty-muted)' }}>
                    Le vote arrive dans un instant.
                </p>
            </div>
        );
    }

    if (phase === 'vote') {
        if (!isCaptain) {
            return (
                <div className="pty-panel p-6 text-center flex-1 flex flex-col justify-center gap-3">
                    <Trophy className="w-10 h-10 mx-auto" style={{ color: 'var(--pty-muted)' }} />
                    <p className="text-lg font-bold">Votre capitaine vote</p>
                    <p className="text-sm" style={{ color: 'var(--pty-muted)' }}>
                        Une voix par table : débattez, c'est lui qui valide.
                    </p>
                </div>
            );
        }
        return (
            <div className="flex flex-col gap-4 flex-1">
                <p className="text-center font-black text-lg">
                    {hasVoted ? 'Vote enregistré' : 'Quelle est la meilleure ?'}
                </p>
                <p className="text-center text-xs" style={{ color: 'var(--pty-muted)' }}>
                    Votre création est grisée : on ne vote pas pour sa propre table.
                </p>
                <PhotoGallery entries={gallery} votable={!hasVoted} chosenPid={chosenPid} onVote={onVote} />
            </div>
        );
    }

    return (
        <div className="pty-panel p-6 text-center flex-1 flex flex-col justify-center gap-2">
            <Users className="w-10 h-10 mx-auto" style={{ color: 'var(--pty-muted)' }} />
            <p className="text-sm" style={{ color: 'var(--pty-muted)' }}>Épreuve en cours…</p>
        </div>
    );
}

export default CroquisPlayer;
