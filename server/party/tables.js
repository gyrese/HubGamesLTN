/**
 * Super LTN Party — les tables
 *
 * **Une table = un seul téléphone**, celui du capitaine. C'est le seul membre
 * permanent. Les coéquipiers n'apparaissent que le temps d'une épreuve qui réclame
 * plusieurs joueurs : le capitaine leur fait scanner son QR, ils jouent, puis ils
 * sont relâchés en fin de manche. Personne d'autre n'a à s'inscrire de la soirée.
 *
 * Le jeton de rattachement suit le motif du `remoteToken` de GeoTrackr : tiré en
 * crypto.randomBytes, jamais diffusé dans un instantané d'état, vérifié côté
 * contrôleur au moment du scan.
 */

const crypto = require('crypto');

const MAX_TABLES = 6;

/**
 * Un téléphone seul par table, c'est un seul point de défaillance — et le
 * transport polling coupe régulièrement sur mobile. On laisse donc une minute au
 * capitaine pour revenir avant de considérer la table hors course.
 */
const TABLE_GRACE_MS = 60_000;

// Une couleur par table : elles servent aussi bien au pion sur la carte qu'au
// remplissage des territoires conquis, donc elles doivent rester distinctes de
// loin. Couleurs primaires franches, dans l'esprit plateau de jeu, et assez
// foncées pour porter du texte blanc et un contour d'encre.
const TABLE_COLORS = [
    { id: 'T1', color: '#E52521', name: 'Rouge' },
    { id: 'T2', color: '#43B047', name: 'Vert' },
    { id: 'T3', color: '#049CD8', name: 'Bleu' },
    { id: 'T4', color: '#F7B32B', name: 'Jaune' },
    { id: 'T5', color: '#E45BA0', name: 'Rose' },
    { id: 'T6', color: '#7B3FF2', name: 'Violet' },
];

function newToken() {
    return crypto.randomBytes(16).toString('hex');
}

/**
 * Crée une table et fait de son fondateur le capitaine.
 * Retourne { error } ou { table, token } — le jeton n'est destiné qu'au capitaine.
 */
function createTable(room, captainId, tableName) {
    if (room.tables.size >= room.settings.maxTables) {
        return { error: `Le nombre maximum de tables (${room.settings.maxTables}) est atteint` };
    }
    const player = room.players.get(captainId);
    if (!player) return { error: 'Joueur inconnu' };
    if (player.tableId) return { error: 'Vous appartenez déjà à une table' };

    const slot = TABLE_COLORS.find((c) => !room.tables.has(c.id));
    if (!slot) return { error: 'Plus aucune table disponible' };

    const name = (tableName || '').trim().slice(0, 20) || `Table ${slot.id.slice(1)}`;
    const table = {
        id: slot.id,
        name,
        color: slot.color,
        captainId,
        captainName: player.name,
        token: newToken(),
        disconnectedAt: null,      // début de la période de grâce, null si présent
        roster: [player.name],     // prénoms connus de la table, pour désigner les champions
        championName: null,        // champion de la manche en cours
        lastChampionName: null,    // champion de la manche précédente (rotation)
        championWins: {},          // prénom → nb de manches gagnées
        enrolled: new Set(),       // téléphones inscrits à l'épreuve en cours
    };
    room.tables.set(table.id, table);

    player.tableId = table.id;
    player.role = 'captain';

    return { table, token: table.token };
}

/**
 * Rattachement d'un coéquipier après scan du QR du capitaine. C'est temporaire :
 * il ne vaut que pour l'épreuve en cours et sera relâché en fin de manche.
 */
function joinAsGuest(room, playerId, tableId, token) {
    const table = room.tables.get(tableId);
    if (!table) return { error: 'Table introuvable' };
    if (token !== table.token) return { error: 'Ce QR code n\'est plus valable' };

    const player = room.players.get(playerId);
    if (!player) return { error: 'Joueur inconnu' };
    if (player.tableId && player.tableId !== tableId) {
        return { error: 'Vous êtes déjà rattaché à une autre table' };
    }

    player.tableId = tableId;
    if (player.role !== 'captain') player.role = 'guest';
    rememberName(table, player.name);
    table.enrolled.add(playerId);

    return { table };
}

/** Le roster alimente la liste des champions possibles, sans compte à créer. */
function rememberName(table, name) {
    const clean = (name || '').trim();
    if (!clean) return;
    const exists = table.roster.some((n) => n.toLowerCase() === clean.toLowerCase());
    if (!exists) table.roster.push(clean);
    if (table.roster.length > 12) table.roster.splice(0, table.roster.length - 12);
}

function membersOf(room, tableId, { connectedOnly = false } = {}) {
    const out = [];
    for (const player of room.players.values()) {
        if (player.tableId !== tableId) continue;
        if (connectedOnly && player.disconnected) continue;
        out.push(player);
    }
    return out;
}

/**
 * Une table est hors course quand son capitaine est absent depuis plus d'une
 * minute. Avant ça elle reste en jeu : une coupure de polling ne doit pas coûter
 * une manche.
 */
function isFrozen(table) {
    return table.disconnectedAt !== null && (Date.now() - table.disconnectedAt) > TABLE_GRACE_MS;
}

function isAbsent(table) {
    return table.disconnectedAt !== null;
}

/**
 * Fin de manche : les invités sont relâchés. Ils garderont leur socket ouverte
 * (l'écran leur dira que l'épreuve est finie) mais ne comptent plus dans la table.
 */
function releaseGuests(room, tableId) {
    const table = room.tables.get(tableId);
    if (!table) return [];
    const released = [];
    for (const player of room.players.values()) {
        if (player.tableId !== tableId || player.role !== 'guest') continue;
        player.tableId = null;
        released.push(player.id);
    }
    table.enrolled.clear();
    return released;
}

/**
 * Le capitaine ne revient pas et un invité est encore là : on le promeut plutôt
 * que de perdre la table. Le jeton est régénéré, ce qui invalide les QR déjà
 * photographiés.
 */
function promoteGuest(room, tableId) {
    const table = room.tables.get(tableId);
    if (!table) return { error: 'Table introuvable' };

    const heir = membersOf(room, tableId, { connectedOnly: true })
        .filter((p) => p.id !== table.captainId)
        .sort((a, b) => a.joinedAt - b.joinedAt)[0];

    if (!heir) return { none: true };

    const previous = room.players.get(table.captainId);
    if (previous) previous.role = 'guest';

    table.captainId = heir.id;
    table.captainName = heir.name;
    table.token = newToken();
    table.disconnectedAt = null;
    heir.role = 'captain';
    rememberName(table, heir.name);

    return { captainId: heir.id, captainName: heir.name, token: table.token };
}

/** Le capitaine demande un QR neuf (la table d'à côté a photographié le sien). */
function regenerateToken(room, tableId, requesterId) {
    const table = room.tables.get(tableId);
    if (!table) return { error: 'Table introuvable' };
    if (table.captainId !== requesterId) return { error: 'Seul le capitaine peut faire ça' };
    table.token = newToken();
    return { token: table.token };
}

module.exports = {
    MAX_TABLES,
    TABLE_GRACE_MS,
    TABLE_COLORS,
    newToken,
    createTable,
    joinAsGuest,
    rememberName,
    membersOf,
    isFrozen,
    isAbsent,
    releaseGuests,
    promoteGuest,
    regenerateToken,
};
