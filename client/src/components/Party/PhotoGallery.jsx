import { Ban } from 'lucide-react';

/**
 * Les créations côte à côte : le moment fort de la manche.
 *
 * La galerie est anonyme — les noms de table ne sont révélés qu'au dépouillement,
 * sinon on vote pour ses copains plutôt que pour le meilleur dessin. Le serveur
 * ne renvoie qu'un identifiant de bulletin, jamais l'auteur.
 *
 * Trois usages :
 *   - `moderation` : l'hôte voit arriver les photos et peut en écarter une ;
 *   - `votable`    : le capitaine choisit, sa propre création est grisée ;
 *   - lecture      : le grand écran pendant le vote.
 */
function PhotoGallery({ entries, votable, chosenPid, onVote, moderation, onDiscard }) {
    if (!entries || entries.length === 0) {
        return (
            <p className="text-center text-lg" style={{ color: 'var(--pty-muted)' }}>
                En attente des créations…
            </p>
        );
    }

    return (
        <div className="pty-gallery">
            {entries.map((entry, index) => {
                const isMine = !!entry.mine;
                const canVote = votable && !isMine;
                const classes = [
                    'pty-gallery-card',
                    canVote ? 'pty-gallery-card-votable' : '',
                    isMine ? 'pty-gallery-card-mine' : '',
                    chosenPid === entry.pid ? 'pty-gallery-card-chosen' : '',
                ].filter(Boolean).join(' ');

                return (
                    <div
                        key={entry.pid}
                        className={classes}
                        style={{ animationDelay: `${index * 60}ms` }}
                        onClick={canVote ? () => onVote(entry.pid) : undefined}
                        role={canVote ? 'button' : undefined}
                        tabIndex={canVote ? 0 : undefined}
                        onKeyDown={canVote ? (e) => {
                            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onVote(entry.pid); }
                        } : undefined}
                    >
                        <img src={entry.dataUrl} alt={`Création ${index + 1}`} />

                        <span className="pty-badge" style={{ position: 'absolute', top: 10, left: 10 }}>
                            {String.fromCharCode(65 + index)}
                        </span>

                        {isMine && (
                            <span className="pty-badge" style={{ position: 'absolute', top: 10, right: 10 }}>
                                La vôtre
                            </span>
                        )}

                        {moderation && (
                            <button
                                type="button"
                                className="pty-btn"
                                style={{
                                    position: 'absolute', bottom: 10, right: 10, minHeight: 40,
                                    padding: '0 0.8rem', background: 'rgba(185, 28, 28, 0.9)',
                                }}
                                onClick={(e) => { e.stopPropagation(); onDiscard(entry.pid); }}
                            >
                                <Ban className="w-4 h-4" />
                                Écarter
                            </button>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

export default PhotoGallery;
