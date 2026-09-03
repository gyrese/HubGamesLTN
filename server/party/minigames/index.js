/**
 * Super LTN Party — registre des micro-jeux
 *
 * Chaque module déclare son contrat (famille, discipline, scope, resolution,
 * phases, matériel). Le contrôleur ne connaît que ce contrat : ajouter un
 * micro-jeu ne demande jamais de toucher à la machine à états.
 *
 *   family      DIGITAL | ASYNC | PHYSICAL | CREATIVE
 *   discipline  annoncée avant le choix du champion, l'épreuve reste cachée
 *   scope       champion (un représentant) | player (moyenne) | table (classement)
 *   resolution  auto (le serveur calcule) | measure (l'hôte saisit) | vote (le bar juge)
 */

const reflexe = require('./reflexe');
const croquis = require('./croquis');

const MINIGAMES = [reflexe, croquis];

const REGISTRY = new Map(MINIGAMES.map((m) => [m.id, m]));

/** Les familles qui sortent du téléphone demandent du matériel et du temps. */
const LONG_FAMILIES = new Set(['PHYSICAL', 'CREATIVE']);

function get(id) {
    return REGISTRY.get(id) || null;
}

function totalDuration(minigame) {
    return minigame.phases.reduce((sum, p) => sum + p.duration, 0);
}

/** Le matériel à préparer, déduit des familles que l'hôte a activées. */
function materialsFor(families) {
    const out = new Set();
    for (const game of MINIGAMES) {
        if (!families.includes(game.family)) continue;
        for (const item of game.materials || []) out.add(item);
    }
    return Array.from(out);
}

function availableFamilies() {
    return Array.from(new Set(MINIGAMES.map((m) => m.family)));
}

/**
 * Constitue le vivier de la manche : familles activées, jamais deux épreuves
 * longues d'affilée, et on évite de reproposer celle qu'on vient de jouer.
 * Les filtres se relâchent un par un plutôt que de rendre un tirage impossible.
 */
function eligiblePool(room) {
    const families = room.settings.families;
    let pool = MINIGAMES.filter((m) => families.includes(m.family));
    if (pool.length === 0) pool = MINIGAMES.slice();

    const previous = get(room.lastMinigameId);
    if (previous && LONG_FAMILIES.has(previous.family)) {
        const shortOnes = pool.filter((m) => !LONG_FAMILIES.has(m.family));
        if (shortOnes.length > 0) pool = shortOnes;
    }

    const notRepeated = pool.filter((m) => m.id !== room.lastMinigameId);
    if (notRepeated.length > 0) pool = notRepeated;

    return pool;
}

/**
 * Les épreuves soumises au vote des tables en début de manche. On en veut trois,
 * mais on ne propose jamais plus que ce que le catalogue contient réellement :
 * avec deux micro-jeux écrits, le vote se joue entre deux — il prendra tout son
 * sens à mesure que le catalogue grossit.
 */
function pickCandidates(room, count = 3) {
    const pool = eligiblePool(room);
    const shuffled = pool.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled.slice(0, Math.min(count, shuffled.length));
}

/** Vue publique d'une épreuve candidate : titre, description, illustration. */
function publicCard(minigame) {
    return {
        id: minigame.id,
        name: minigame.name,
        description: minigame.description || minigame.rule,
        discipline: minigame.discipline,
        family: minigame.family,
        scope: minigame.scope,
        // `image` prime sur `art` : déposer un fichier dans `public/party/` suffit
        // à remplacer l'illustration procédurale, sans toucher au code.
        image: minigame.image || null,
        art: minigame.art || { icon: 'dice', color: '#F7B32B' },
        duration: totalDuration(minigame),
        materials: minigame.materials || [],
    };
}

/** Tirage direct, sans vote : filet de sécurité et parties sans capitaine. */
function pick(room) {
    const pool = eligiblePool(room);
    return pool[Math.floor(Math.random() * pool.length)];
}

module.exports = {
    MINIGAMES,
    LONG_FAMILIES,
    get,
    pick,
    pickCandidates,
    publicCard,
    totalDuration,
    materialsFor,
    availableFamilies,
};
