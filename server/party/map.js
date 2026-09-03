/**
 * Super LTN Party — la carte du bar
 *
 * Huit zones, dessinées dans un viewBox 120x80 pour être projetées telles quelles
 * par le composant SVG côté hôte. La valeur d'une zone est le nombre de points
 * qu'elle rapporte à la table qui la contrôle en fin de partie.
 *
 * Total = 15 points, volontairement impair : les égalités parfaites restent rares.
 */

const ZONES = [
    {
        id: 'mezzanine',
        name: 'La Mezzanine',
        value: 2,
        points: '4,4 42,4 38,30 4,30',
        label: { x: 22, y: 18 },
    },
    {
        id: 'projection',
        name: 'La Salle de Projection',
        value: 3,
        points: '42,4 116,4 116,30 38,30',
        label: { x: 78, y: 18 },
    },
    {
        id: 'cave',
        name: 'La Cave',
        value: 2,
        points: '4,30 38,30 36,55 4,55',
        label: { x: 20, y: 43 },
    },
    {
        id: 'comptoir',
        name: 'Le Comptoir',
        value: 3,
        points: '38,30 86,30 88,55 36,55',
        label: { x: 62, y: 43 },
    },
    {
        id: 'terrasse',
        name: 'La Terrasse',
        value: 2,
        points: '86,30 116,30 116,55 88,55',
        label: { x: 101, y: 43 },
    },
    {
        id: 'babyfoot',
        name: 'Le Baby-foot',
        value: 1,
        points: '4,55 36,55 40,76 4,76',
        label: { x: 21, y: 66 },
    },
    {
        id: 'flipper',
        name: 'Le Flipper',
        value: 1,
        points: '36,55 88,55 86,76 40,76',
        label: { x: 63, y: 66 },
    },
    {
        id: 'toilettes',
        name: 'Les Toilettes',
        value: 1,
        points: '88,55 116,55 116,76 86,76',
        label: { x: 101, y: 66 },
    },
];

const VIEW_BOX = '0 0 120 80';

/** État initial : toutes les zones sont neutres. */
function createOwnership() {
    const ownership = {};
    for (const zone of ZONES) ownership[zone.id] = null;
    return ownership;
}

/**
 * Tire la zone mise en jeu pour la manche. On évite de remettre en jeu celle de la
 * manche précédente : deux batailles d'affilée sur le même territoire lassent.
 */
function pickContestedZone(previousZoneId) {
    const pool = ZONES.filter((z) => z.id !== previousZoneId);
    return pool[Math.floor(Math.random() * pool.length)].id;
}

function getZone(zoneId) {
    return ZONES.find((z) => z.id === zoneId) || null;
}

/** Somme des valeurs des zones contrôlées par une table. */
function scoreOfTable(ownership, tableId) {
    return ZONES.reduce((sum, zone) => (ownership[zone.id] === tableId ? sum + zone.value : sum), 0);
}

function zonesOfTable(ownership, tableId) {
    return ZONES.filter((z) => ownership[z.id] === tableId).map((z) => z.id);
}

/** Vue publique de la carte, envoyée dans chaque instantané d'état. */
function publicZones(ownership) {
    return ZONES.map((z) => ({
        id: z.id,
        name: z.name,
        value: z.value,
        points: z.points,
        label: z.label,
        ownerTableId: ownership[z.id] || null,
    }));
}

module.exports = {
    ZONES,
    VIEW_BOX,
    createOwnership,
    pickContestedZone,
    getZone,
    scoreOfTable,
    zonesOfTable,
    publicZones,
};
