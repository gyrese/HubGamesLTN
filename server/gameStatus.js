/**
 * Statut des jeux du hub — actif / maintenance / masqué
 *
 * Permet de retirer un jeu de la page d'accueil sans redéployer : un jeu cassé
 * un soir de service se met en maintenance depuis l'admin, et les clients ne
 * tombent pas dessus.
 *
 * Trois états, parce qu'ils ne servent pas la même chose :
 *
 *   `active`      le jeu est jouable, carte normale
 *   `maintenance` la carte reste visible mais grisée et non cliquable. C'est le
 *                 bon choix pour un jeu que les habitués connaissent : ils voient
 *                 qu'il existe et qu'il revient, au lieu de le croire supprimé.
 *   `hidden`      la carte disparaît. Pour un jeu pas encore présentable, dont
 *                 l'existence même n'a pas à être annoncée.
 *
 * Le stockage réutilise `app_meta` (déjà en place dans `db.js`) plutôt qu'une
 * table dédiée : c'est une seule ligne de configuration, pas un modèle de données.
 */

const db = require('./db');

const META_KEY = 'game_status';

const STATES = ['active', 'maintenance', 'hidden'];

// Identifiants alignés sur le tableau GAMES de `client/src/pages/HomePage.jsx`.
// Un jeu absent de cette liste est simplement ignoré : ajouter un jeu au hub ne
// demande donc pas de toucher ce fichier, il sera actif par défaut.
const KNOWN_GAMES = ['quiz', 'geo', 'draw', 'color', 'fakeartist', 'party', 'io', 'apero'];

/** Cache mémoire : la page d'accueil interroge ce statut à chaque visite. */
let cache = null;

function isValidState(state) {
    return STATES.includes(state);
}

/** Statut de tous les jeux. Un jeu jamais configuré est actif. */
async function getAll() {
    if (cache) return cache;
    try {
        const row = await db.get('SELECT value FROM app_meta WHERE key = ?', [META_KEY]);
        const stored = row?.value ? JSON.parse(row.value) : {};
        const out = {};
        for (const id of KNOWN_GAMES) {
            out[id] = isValidState(stored[id]) ? stored[id] : 'active';
        }
        cache = out;
        return out;
    } catch (err) {
        // Une base indisponible ne doit jamais fermer le hub : en cas de doute,
        // tout est jouable. Mieux vaut un jeu cassé qu'une page d'accueil vide.
        console.error('[GAME_STATUS] Lecture impossible, tous les jeux restent actifs :', err.message);
        return Object.fromEntries(KNOWN_GAMES.map((id) => [id, 'active']));
    }
}

async function setOne(gameId, state) {
    if (!KNOWN_GAMES.includes(gameId)) throw new Error('Jeu inconnu');
    if (!isValidState(state)) throw new Error('Statut invalide');

    const current = await getAll();
    const next = { ...current, [gameId]: state };
    await db.run(
        'INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)',
        [META_KEY, JSON.stringify(next)],
    );
    cache = next;
    return next;
}

module.exports = { getAll, setOne, STATES, KNOWN_GAMES };
