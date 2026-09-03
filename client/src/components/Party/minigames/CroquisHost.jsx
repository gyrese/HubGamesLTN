import PhotoGallery from '../PhotoGallery';
import { usePhaseTimer } from '../usePhaseTimer';

/**
 * LE CROQUIS — grand écran.
 *
 * Rien ne se joue sur l'écran pendant que les champions dessinent : il porte le
 * thème et le chrono, puis devient la galerie où le bar découvre les productions.
 */
function CroquisHost({ phase, theme, remainingMs, duration, gallery, onDiscard, tables, votedCount }) {
    const { seconds } = usePhaseTimer(remainingMs, duration);
    const captainCount = tables.filter((t) => !t.frozen && t.captainId).length;

    if (phase === 'brief' || phase === 'draw') {
        return (
            <div className="flex-1 flex flex-col items-center justify-center text-center gap-8 px-10">
                <p className="pty-eyebrow">Thème imposé</p>
                <p className="pty-title" style={{ fontSize: 'clamp(2.4rem, 6.5vw, 5.5rem)' }}>
                    {theme || '…'}
                </p>
                {phase === 'draw' && (
                    <>
                        <p
                            className="pty-title"
                            style={{ fontSize: 'clamp(4rem, 14vw, 11rem)', color: 'var(--pty-accent)' }}
                        >
                            {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
                        </p>
                        <p className="text-2xl" style={{ color: 'var(--pty-muted)' }}>
                            Les champions dessinent sur papier
                        </p>
                    </>
                )}
                {phase === 'brief' && (
                    <p className="text-2xl" style={{ color: 'var(--pty-muted)' }}>
                        Papier et stylo devant chaque champion
                    </p>
                )}
            </div>
        );
    }

    if (phase === 'capture') {
        return (
            <div className="flex-1 flex flex-col gap-6 px-10 py-4 pty-scroll">
                <div className="text-center">
                    <p className="pty-eyebrow mb-2">Photographiez vos créations</p>
                    <p className="pty-title" style={{ fontSize: 'clamp(1.8rem, 4vw, 3rem)' }}>
                        {gallery.length} création{gallery.length > 1 ? 's' : ''} reçue{gallery.length > 1 ? 's' : ''}
                    </p>
                </div>
                {/* Modération : l'hôte écarte avant que la salle ne voie quoi que ce soit. */}
                <PhotoGallery entries={gallery} moderation onDiscard={onDiscard} />
            </div>
        );
    }

    return (
        <div className="flex-1 flex flex-col gap-5 px-10 py-4 pty-scroll">
            <div className="text-center">
                <p className="pty-eyebrow mb-2">{theme}</p>
                <p className="pty-title" style={{ fontSize: 'clamp(1.8rem, 4vw, 3rem)' }}>
                    Le bar vote — {votedCount} / {captainCount}
                </p>
                <p className="text-lg mt-2" style={{ color: 'var(--pty-muted)' }}>
                    Une voix par table, sur le téléphone du capitaine. On ne vote pas pour soi.
                </p>
            </div>
            <PhotoGallery entries={gallery} />
        </div>
    );
}

export default CroquisHost;
