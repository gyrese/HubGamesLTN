import { useState } from 'react';
import { QrCode, Crown, Users, MapPin, X } from 'lucide-react';
import TableQR from './TableQR';

/**
 * Le téléphone du capitaine fait office de tableau de bord de la table : score,
 * territoires, roster, et le QR à faire tourner quand une épreuve réclame
 * plusieurs joueurs. Une table n'a besoin que de ce seul appareil pour jouer
 * toute la partie.
 */
function TableDashboard({ roomCode, table, token, members, onRegenerate, compact }) {
    const [showQR, setShowQR] = useState(false);

    if (!table) return null;

    return (
        <>
            <div className="pty-panel p-4 flex flex-col gap-3">
                <div className="flex items-center gap-3">
                    <span className="pty-dot" style={{ background: table.color, width: 18, height: 18 }} />
                    <div className="flex-1 min-w-0">
                        <p className="font-black text-lg truncate">{table.name}</p>
                        <p className="text-xs" style={{ color: 'var(--pty-muted)' }}>
                            {table.score} point{table.score > 1 ? 's' : ''} de territoire
                        </p>
                    </div>
                    <button
                        type="button"
                        className="pty-btn"
                        style={{ minWidth: 48, padding: '0 0.9rem' }}
                        onClick={() => setShowQR(true)}
                        aria-label="Afficher le QR code de la table"
                    >
                        <QrCode className="w-5 h-5" />
                    </button>
                </div>

                {!compact && (
                    <div className="flex flex-wrap gap-2">
                        <span className="pty-badge">
                            <Crown className="w-3 h-3" />
                            {table.captainName}
                        </span>
                        <span className="pty-badge">
                            <MapPin className="w-3 h-3" />
                            {table.zones.length} zone{table.zones.length > 1 ? 's' : ''}
                        </span>
                        {members.length > 1 && (
                            <span className="pty-badge">
                                <Users className="w-3 h-3" />
                                {members.length - 1} coéquipier{members.length > 2 ? 's' : ''} en jeu
                            </span>
                        )}
                    </div>
                )}
            </div>

            {showQR && (
                <div className="pty-overlay">
                    <p className="pty-title text-2xl text-center">{table.name}</p>
                    <TableQR
                        roomCode={roomCode}
                        tableId={table.id}
                        token={token}
                        size={240}
                        onRegenerate={onRegenerate}
                    />
                    <button type="button" className="pty-btn" onClick={() => setShowQR(false)}>
                        <X className="w-4 h-4" />
                        Fermer
                    </button>
                </div>
            )}
        </>
    );
}

export default TableDashboard;
