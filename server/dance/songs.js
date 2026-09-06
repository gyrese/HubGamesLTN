/**
 * DANCE_DANCE — catalogue des morceaux
 *
 * Le hub ne peut embarquer ni musique ni chorégraphie de StepMania : les packs
 * de chansons sont sous copyright et non redistribuables. Le catalogue est donc
 * **alimenté par l'hôte** : on téléverse un fichier audio dont on a le droit,
 * le navigateur en mesure le tempo, et la chorégraphie est générée.
 *
 * Persistance en JSON à côté des autres données du dépôt (`drawWords.json`,
 * `colorCharacters.json`) : même format, même emplacement, aucune migration de
 * base à prévoir.
 *
 * ── Pourquoi le tempo est mesuré par le navigateur ──────────────────
 * Décoder un MP3 côté serveur demanderait ffmpeg ou un module natif, donc une
 * image Docker plus lourde pour un seul jeu. Le navigateur sait déjà décoder
 * l'audio (Web Audio API) : il envoie le tempo et la durée avec le fichier. Le
 * serveur ne fait jamais confiance à ces valeurs sans les borner (cf. `sanitizeMeta`).
 */

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'data', 'danceSongs.json');

/** Bornes de plausibilité — un tempo hors de cette plage casserait la chart. */
const MIN_BPM = 60;
const MAX_BPM = 220;
const MIN_DURATION_MS = 20_000;      // en dessous, ce n'est pas un morceau
const MAX_DURATION_MS = 10 * 60_000; // au delà, la partie n'a plus de fin

let songs = null;   // cache mémoire, chargé paresseusement

function load() {
    if (songs) return songs;
    try {
        if (fs.existsSync(DATA_FILE)) {
            songs = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
            if (!Array.isArray(songs)) songs = [];
        } else {
            songs = [];
        }
    } catch (err) {
        console.error('[DANCE] Catalogue illisible, on repart à vide :', err.message);
        songs = [];
    }
    return songs;
}

function persist() {
    try {
        const dir = path.dirname(DATA_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(DATA_FILE, JSON.stringify(songs, null, 2), 'utf8');
    } catch (err) {
        console.error('[DANCE] Écriture du catalogue impossible :', err.message);
    }
}

/**
 * Ramène les métadonnées annoncées par le navigateur dans des bornes sûres.
 * Le client mesure, le serveur décide : une valeur aberrante (tempo à 0, durée
 * négative) produirait une chart vide ou une boucle sans fin.
 */
function sanitizeMeta({ bpm, durationMs, offsetMs }) {
    const safeBpm = Number(bpm);
    const safeDuration = Number(durationMs);
    const safeOffset = Number(offsetMs);

    return {
        bpm: Number.isFinite(safeBpm)
            ? Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(safeBpm)))
            : 120,
        durationMs: Number.isFinite(safeDuration)
            ? Math.min(MAX_DURATION_MS, Math.max(MIN_DURATION_MS, Math.round(safeDuration)))
            : MIN_DURATION_MS,
        offsetMs: Number.isFinite(safeOffset)
            ? Math.min(2000, Math.max(0, Math.round(safeOffset)))
            : 0,
    };
}

function list() {
    return load().map(publicCard);
}

/** Vue publique d'un morceau : ce qu'affiche l'écran de sélection. */
function publicCard(song) {
    return {
        id: song.id,
        title: song.title,
        artist: song.artist,
        bpm: song.bpm,
        durationMs: song.durationMs,
        audioUrl: song.audioUrl,
        addedAt: song.addedAt,
    };
}

function get(id) {
    return load().find((s) => s.id === id) || null;
}

/**
 * Ajoute un morceau au catalogue.
 * @param {object} song { title, artist, audioUrl, bpm, durationMs, offsetMs }
 */
function add({ title, artist, audioUrl, bpm, durationMs, offsetMs }) {
    load();

    const meta = sanitizeMeta({ bpm, durationMs, offsetMs });
    const entry = {
        id: `song-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        title: String(title || 'Sans titre').trim().slice(0, 60),
        artist: String(artist || 'Inconnu').trim().slice(0, 60),
        audioUrl,
        ...meta,
        addedAt: Date.now(),
    };

    songs.push(entry);
    persist();
    return entry;
}

function remove(id) {
    load();
    const index = songs.findIndex((s) => s.id === id);
    if (index === -1) return null;
    const [removed] = songs.splice(index, 1);
    persist();
    return removed;
}

/** Rechargement forcé — utilisé par les tests pour repartir propre. */
function reset() {
    songs = null;
}

module.exports = {
    list,
    get,
    add,
    remove,
    reset,
    publicCard,
    sanitizeMeta,
    MIN_BPM,
    MAX_BPM,
};
