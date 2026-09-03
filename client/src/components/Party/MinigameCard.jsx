import { Dices, Pencil, Zap, Users, User, Check } from 'lucide-react';

/**
 * La carte d'un mini-jeu : illustration, titre, description.
 *
 * L'illustration est **procédurale par défaut** — un aplat de couleur, un motif
 * et une grande icône — pour qu'un nouveau micro-jeu soit jouable sans attendre
 * qu'on lui dessine une image. Si le module déclare un chemin `image`, un fichier
 * déposé dans `public/party/` prend simplement le dessus.
 */
const ICONS = { zap: Zap, pencil: Pencil, dice: Dices };

function MinigameCard({ game, votes, selected, onSelect, compact }) {
    const Icon = ICONS[game.art?.icon] || Dices;
    const color = game.art?.color || '#F7B32B';
    const clickable = typeof onSelect === 'function';
    const minutes = Math.round(game.duration / 60);

    return (
        <button
            type="button"
            className={`pty-game-card ${selected ? 'pty-game-card-selected' : ''} ${clickable ? 'pty-game-card-clickable' : ''}`}
            onClick={clickable ? () => onSelect(game.id) : undefined}
            disabled={!clickable}
        >
            <span className="pty-game-art" style={{ background: color }}>
                {game.image
                    ? <img src={game.image} alt="" />
                    : <Icon className="pty-game-icon" strokeWidth={2.5} />}
                {typeof votes === 'number' && votes > 0 && (
                    <span className="pty-game-votes">{votes}</span>
                )}
                {selected && <span className="pty-game-check"><Check strokeWidth={4} /></span>}
            </span>

            <span className="pty-game-body">
                <span className="pty-game-title">{game.name}</span>
                {!compact && <span className="pty-game-desc">{game.description}</span>}
                <span className="pty-game-meta">
                    {game.scope === 'champion'
                        ? <><User className="w-3 h-3" /> Un champion</>
                        : <><Users className="w-3 h-3" /> Toute la table</>}
                    <span>· {minutes < 1 ? '< 1' : minutes} min</span>
                </span>
            </span>
        </button>
    );
}

export default MinigameCard;
