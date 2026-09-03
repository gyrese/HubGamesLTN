/**
 * Super LTN Party — les photos des épreuves créatives
 *
 * Tout reste en mémoire et meurt avec le salon : rien n'atterrit sur le disque.
 * Le redimensionnement est fait côté client avant l'envoi (canvas, ~1200 px,
 * JPEG 0.7) ; ici on ne fait que vérifier ce qui arrive.
 */

const MAX_PHOTO_BYTES = 600 * 1024; // ~600 Ko après compression client
const DATA_URL_RE = /^data:image\/(jpeg|png|webp);base64,/;

const store = new Map(); // roomCode → Map<tableId, { dataUrl, tableId, discarded }>

function validate(dataUrl) {
    if (typeof dataUrl !== 'string' || !DATA_URL_RE.test(dataUrl)) {
        return { error: 'Format d\'image non accepté' };
    }
    // Une base64 pèse ~4/3 des octets réels : on borne la chaîne, c'est suffisant.
    if (dataUrl.length > MAX_PHOTO_BYTES * 1.4) {
        return { error: 'Photo trop lourde, réessayez' };
    }
    return { ok: true };
}

function put(roomCode, tableId, dataUrl) {
    const check = validate(dataUrl);
    if (check.error) return check;

    if (!store.has(roomCode)) store.set(roomCode, new Map());
    // L'horodatage sert de départage : à égalité de voix, la table qui a rendu
    // sa copie en premier l'emporte.
    store.get(roomCode).set(tableId, { tableId, dataUrl, discarded: false, at: Date.now() });
    return { ok: true };
}

function get(roomCode, tableId) {
    return store.get(roomCode)?.get(tableId) || null;
}

/** Galerie de la manche : l'ordre est mélangé et les noms de table restent cachés. */
function gallery(roomCode) {
    const room = store.get(roomCode);
    if (!room) return [];
    const entries = Array.from(room.values()).filter((e) => !e.discarded);
    for (let i = entries.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [entries[i], entries[j]] = [entries[j], entries[i]];
    }
    return entries.map((e) => ({ tableId: e.tableId, dataUrl: e.dataUrl }));
}

function count(roomCode) {
    const room = store.get(roomCode);
    if (!room) return 0;
    return Array.from(room.values()).filter((e) => !e.discarded).length;
}

/** Modération hôte : une photo écartée ne réapparaît jamais dans la galerie. */
function discard(roomCode, tableId) {
    const entry = store.get(roomCode)?.get(tableId);
    if (!entry) return { error: 'Photo introuvable' };
    entry.discarded = true;
    entry.dataUrl = null;
    return { ok: true };
}

/** Entre deux manches : on repart d'une galerie vide. */
function clearRound(roomCode) {
    store.get(roomCode)?.clear();
}

function clearRoom(roomCode) {
    store.delete(roomCode);
}

module.exports = { put, get, gallery, count, discard, clearRound, clearRoom, MAX_PHOTO_BYTES };
