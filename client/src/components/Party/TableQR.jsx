import { QRCodeSVG } from 'qrcode.react';

/**
 * Le QR du capitaine. Il porte le rattachement dans l'URL : scanner, c'est
 * rejoindre cette table-là — impossible de se tromper d'équipe, contrairement à
 * une liste où l'on choisit au hasard.
 *
 * Le jeton ne circule qu'ici et dans le callback destiné au capitaine : il n'apparaît
 * jamais dans un état diffusé à la salle.
 */
function TableQR({ roomCode, tableId, token, size = 200, onRegenerate }) {
    if (!token) return null;

    const url = `${window.location.origin}/party/play/${roomCode}?t=${tableId}&tk=${token}`;

    return (
        <div className="flex flex-col items-center gap-3">
            <div className="pty-qr-frame">
                <QRCodeSVG value={url} size={size} bgColor="#ffffff" fgColor="#17203a" level="M" />
            </div>
            <p className="text-sm text-center" style={{ color: 'var(--pty-muted)' }}>
                Vos coéquipiers scannent ce code pour rejoindre la table.
            </p>
            {onRegenerate && (
                <button type="button" className="pty-btn pty-btn-ghost text-xs" onClick={onRegenerate}>
                    Générer un nouveau code
                </button>
            )}
        </div>
    );
}

export default TableQR;
