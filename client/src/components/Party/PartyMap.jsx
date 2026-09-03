/**
 * La carte du bar : huit zones, une couleur par table propriétaire.
 *
 * La zone mise en jeu pulse en or. Celle qui vient d'être conquise reçoit la
 * classe d'animation le temps du résultat de manche : l'animation CSS se déclenche
 * à l'ajout de la classe, il n'y a donc aucun état à tenir ici.
 *
 * Le contour reste toujours l'encre du thème, jamais la couleur de la table :
 * c'est ce trait noir constant qui donne l'aspect « case de plateau » et qui
 * garde les frontières lisibles depuis le fond de la salle.
 */
function PartyMap({ zones, viewBox, tables, contestedZoneId, justCapturedZoneId }) {
    const colorOf = (tableId) => tables.find((t) => t.id === tableId)?.color || null;

    return (
        <svg className="pty-map" viewBox={viewBox} preserveAspectRatio="xMidYMid meet">
            {zones.map((zone) => {
                const color = colorOf(zone.ownerTableId);
                const classes = [
                    'pty-zone',
                    zone.ownerTableId ? 'pty-zone-owned' : '',
                    zone.id === contestedZoneId ? 'pty-zone-contested' : '',
                    zone.id === justCapturedZoneId ? 'pty-zone-captured' : '',
                ].filter(Boolean).join(' ');

                return (
                    <g key={zone.id}>
                        <polygon
                            className={classes}
                            points={zone.points}
                            style={color ? { fill: color, fillOpacity: 0.92 } : undefined}
                        />
                        <text className="pty-zone-label" x={zone.label.x} y={zone.label.y}>
                            {zone.name}
                        </text>
                        <text className="pty-zone-value" x={zone.label.x} y={zone.label.y + 4}>
                            {zone.value} pt{zone.value > 1 ? 's' : ''}
                        </text>
                    </g>
                );
            })}
        </svg>
    );
}

export default PartyMap;
