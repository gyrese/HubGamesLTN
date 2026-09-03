/**
 * Super LTN Party — la désignation des champions
 *
 * Une table n'a qu'un téléphone : le champion n'est donc pas un appareil connecté
 * mais **un prénom saisi par le capitaine**. La personne construit, lance ou
 * dessine dans la vraie vie ; le téléphone du capitaine sert de chrono, de consigne
 * et d'appareil photo.
 *
 * Règle de rotation : un même prénom ne peut pas être champion deux manches de
 * suite tant que quelqu'un d'autre ne l'a pas été. Elle se **relâche** au lieu de
 * bloquer quand la table ne connaît qu'un seul prénom — un blocage coûterait la
 * manche entière.
 */

const { rememberName, isFrozen } = require('./tables');

/** Prénoms proposables au capitaine pour la manche en cours. */
function eligibleNames(table) {
    if (!table) return [];
    if (table.roster.length <= 1) return table.roster.slice();
    const rotated = table.roster.filter((n) => n !== table.lastChampionName);
    return rotated.length > 0 ? rotated : table.roster.slice();
}

/**
 * Le capitaine désigne son champion : un prénom du roster, ou un nouveau qu'il
 * saisit à la volée (auquel cas il entre dans le roster pour la suite de la soirée).
 */
function designate(room, captainId, rawName) {
    const player = room.players.get(captainId);
    if (!player || !player.tableId) return { error: 'Vous n\'êtes rattaché à aucune table' };

    const table = room.tables.get(player.tableId);
    if (!table) return { error: 'Table introuvable' };
    if (table.captainId !== captainId) return { error: 'Seul le capitaine désigne le champion' };

    const name = (rawName || '').trim().slice(0, 20);
    if (!name) return { error: 'Il faut un prénom' };

    if (table.roster.length > 1 && name === table.lastChampionName) {
        return { error: `${name} était déjà champion à la manche précédente` };
    }

    rememberName(table, name);
    table.championName = name;
    return { table, championName: name };
}

/** Fin du temps imparti : tirage au sort pour les tables restées silencieuses. */
function autoPickMissing(room) {
    const drawn = [];
    for (const table of room.tables.values()) {
        if (isFrozen(table) || table.championName) continue;
        const pool = eligibleNames(table);
        if (pool.length === 0) continue;
        const pick = pool[Math.floor(Math.random() * pool.length)];
        table.championName = pick;
        drawn.push({ tableId: table.id, tableName: table.name, championName: pick });
    }
    return drawn;
}

/** Fin de manche : on mémorise qui vient de concourir, pour la rotation suivante. */
function closeRound(room, winningTableId) {
    for (const table of room.tables.values()) {
        if (table.championName) {
            table.lastChampionName = table.championName;
            if (table.id === winningTableId) {
                const wins = table.championWins[table.championName] || 0;
                table.championWins[table.championName] = wins + 1;
            }
        }
        table.championName = null;
    }
}

/** Titres de fin de partie : le prénom le plus victorieux de chaque table. */
function bestChampion(table) {
    if (!table) return null;
    let best = null;
    for (const [name, wins] of Object.entries(table.championWins)) {
        if (!best || wins > best.wins) best = { name, wins };
    }
    return best && best.wins > 0 ? best : null;
}

module.exports = {
    eligibleNames,
    designate,
    autoPickMissing,
    closeRound,
    bestChampion,
};
