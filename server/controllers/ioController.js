/**
 * IO_ARENA — contrôleur socket et machine à états
 *
 *   LOBBY → PLAYING → RESULT → (relance) LOBBY
 *
 * Le contrôleur ne connaît **aucune règle de gameplay** : il ouvre le salon,
 * lance le moteur, relaie les intentions des téléphones et diffuse les
 * instantanés. Toute la logique de jeu vit dans `io/modes/*`, ce qui permet
 * d'ajouter un mode sans jamais toucher à ce fichier.
 *
 * Deux choix de diffusion méritent d'être explicités :
 *
 * - Les instantanés partent en **`volatile`** : un paquet de position perdu ne
 *   doit jamais être rejoué, le suivant le remplace. C'est ce qui protège le
 *   wifi du bar quand la salle est pleine.
 * - Les instantanés ne vont qu'aux **écrans hôtes**, jamais aux téléphones. Le
 *   téléphone est un joystick : lui envoyer l'état du monde multiplierait le
 *   trafic par le nombre de joueurs pour rien.
 */

const ioGameManager = require('../ioGameManager');
const modes = require('../io/modes');
const { TickEngine } = require('../io/tickEngine');

const HOST_GRACE_MS = 90_000;
const RESULT_MS = 15_000;
// Un joueur absent garde sa place le temps d'un blip réseau et d'une manche.
// Au-delà, il est retiré — mais seulement entre deux manches, jamais en direct.
const PLAYER_GRACE_MS = 120_000;

const hostDisconnectTimers = new Map();   // roomCode → Timeout

function roomChannel(roomCode) {
    return `io-${roomCode}`;
}

/** Canal réservé aux grands écrans : eux seuls reçoivent la simulation. */
function screenChannel(roomCode) {
    return `io-screen-${roomCode}`;
}

function safeCallback(callback, payload) {
    if (typeof callback === 'function') callback(payload);
}

function broadcastState(io, room) {
    room.lastActivity = Date.now();
    io.to(roomChannel(room.code)).emit('io-state', ioGameManager.snapshot(room));
}

function schedule(room, ms, fn) {
    const timer = setTimeout(() => {
        room.timers = room.timers.filter((t) => t !== timer);
        try {
            fn();
        } catch (err) {
            console.error('[IO_ARENA] Erreur dans un timer:', err);
        }
    }, ms);
    room.timers.push(timer);
    return timer;
}

// ─────────────────────────────────────────────────────────────────────────────
// Déroulé d'une manche
// ─────────────────────────────────────────────────────────────────────────────

function startRound(io, room) {
    const mode = modes.get(room.settings.modeId) || modes.fallback();

    room.state = 'PLAYING';
    room.results = null;
    room.startedAt = Date.now();

    // Le contexte est la seule chose que le mode voit du monde extérieur.
    // `world` est une copie : le mode y inscrit les dimensions réelles selon la
    // taille choisie, et écrire dans l'objet du module contaminerait les autres
    // salons.
    room.modeCtx = {
        state: {},
        players: room.players,
        world: { ...mode.world },
        settings: room.settings,
        mode,
    };

    room.engine = new TickEngine(mode, room.modeCtx, {
        onSnapshot: (payload) => {
            // Le grand écran reçoit tout : c'est la vue d'ensemble de la salle.
            io.to(screenChannel(room.code)).volatile.emit('io-frame', payload);

            // Chaque téléphone reçoit **sa** fenêtre : sur une grande carte, on
            // ne voit pas tout, on navigue avec sa propre caméra. Envoyer la
            // carte entière à vingt téléphones serait à la fois inutile et le
            // meilleur moyen de saturer le wifi du bar.
            if (!mode.viewFor) return;
            for (const playerId of room.players.keys()) {
                const view = mode.viewFor(room.modeCtx, playerId, payload);
                if (view) io.to(playerId).volatile.emit('io-view', view);
            }
        },
        onEnd: (results) => finishRound(io, room, results),
    });

    room.engine.start();
    broadcastState(io, room);
    console.log(`[IO_ARENA] Manche lancée dans ${room.code} (mode=${mode.id}, ${room.players.size} joueurs)`);
}

function finishRound(io, room, results) {
    // Les statistiques se lisent avant de lâcher le moteur, sinon elles partent
    // vides — c'est le seul endroit où le bilan réseau de la manche est visible.
    const stats = { ...(room.engine?.stats || {}) };

    room.state = 'RESULT';
    room.results = results;
    room.engine = null;

    io.to(roomChannel(room.code)).emit('io-round-end', { results, stats });
    broadcastState(io, room);

    // Retour au lobby : on peut relancer une manche immédiatement, c'est le
    // format « on rejoue » qui convient au bar.
    schedule(room, RESULT_MS, () => {
        if (room.state !== 'RESULT') return;
        room.state = 'LOBBY';
        room.modeCtx = null;
        // Entre deux manches seulement : on solde ici les joueurs vraiment partis.
        ioGameManager.purgeDisconnected(room, PLAYER_GRACE_MS);
        broadcastState(io, room);
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Connexion
// ─────────────────────────────────────────────────────────────────────────────

function handleConnection(io, socket) {
    // ── Hôte : ouvre un salon sur le grand écran ──────────────────────────────
    socket.on('io-create-room', ({ settings } = {}, callback) => {
        try {
            const roomCode = ioGameManager.createRoom(socket.id, settings || {});
            const room = ioGameManager.getRoom(roomCode);
            socket.join(roomChannel(roomCode));
            socket.join(screenChannel(roomCode));
            safeCallback(callback, { roomCode, state: ioGameManager.snapshot(room) });
        } catch (err) {
            console.error('[IO_ARENA] Erreur io-create-room:', err);
            safeCallback(callback, { error: 'Création impossible' });
        }
    });

    socket.on('io-host-reconnect', ({ roomCode }, callback) => {
        const room = ioGameManager.getRoom(roomCode);
        if (!room) return safeCallback(callback, { error: 'Salon introuvable' });

        const pending = hostDisconnectTimers.get(roomCode);
        if (pending) {
            clearTimeout(pending);
            hostDisconnectTimers.delete(roomCode);
            console.log(`[IO_ARENA] Host reconnect: timer de grâce annulé pour ${roomCode}`);
        }

        room.hostId = socket.id;
        room.hostDisconnected = false;
        socket.join(roomChannel(roomCode));
        socket.join(screenChannel(roomCode));

        // L'écran a pu manquer des instantanés : il lui faut la carte entière,
        // sinon il afficherait un territoire troué.
        const mode = modes.get(room.settings.modeId);
        if (room.modeCtx && mode?.requestFullState) mode.requestFullState(room.modeCtx);

        safeCallback(callback, { success: true, state: ioGameManager.snapshot(room) });
        broadcastState(io, room);
    });

    // ── Joueur : rejoint depuis son téléphone ─────────────────────────────────
    socket.on('io-join-room', ({ roomCode, playerName, avatar }, callback) => {
        try {
            const result = ioGameManager.joinRoom(roomCode, socket.id, playerName, avatar);
            if (result.error) return safeCallback(callback, { error: result.error });

            socket.join(roomChannel(roomCode));
            safeCallback(callback, {
                playerId: socket.id,
                reconnected: result.reconnected,
                state: ioGameManager.snapshot(result.room),
            });
            broadcastState(io, result.room);
        } catch (err) {
            console.error('[IO_ARENA] Erreur io-join-room:', err);
            safeCallback(callback, { error: 'Connexion impossible' });
        }
    });

    // ── Intention de pilotage ─────────────────────────────────────────────────
    //
    // L'évènement le plus fréquent du hub : jusqu'à 20 fois par seconde et par
    // téléphone. Il n'accuse jamais réception (pas de callback) et ne déclenche
    // aucune diffusion : il se contente de déposer un cap dans la simulation.
    socket.on('io-input', ({ roomCode, angle }) => {
        const room = ioGameManager.getRoom(roomCode);
        if (!room || room.state !== 'PLAYING' || !room.modeCtx) return;
        const mode = modes.get(room.settings.modeId);
        if (mode?.onInput) mode.onInput(room.modeCtx, socket.id, { angle });
    });

    // ── Contrôles hôte ────────────────────────────────────────────────────────
    socket.on('io-start-round', ({ roomCode }, callback) => {
        const room = ioGameManager.getRoom(roomCode);
        if (!room) return safeCallback(callback, { error: 'Salon introuvable' });
        if (room.hostId !== socket.id) return safeCallback(callback, { error: 'Réservé à l\'hôte' });
        if (room.state === 'PLAYING') return safeCallback(callback, { error: 'Manche déjà en cours' });

        const mode = modes.get(room.settings.modeId) || modes.fallback();
        if (room.players.size < (mode.minPlayers || 1)) {
            return safeCallback(callback, { error: `Il faut au moins ${mode.minPlayers} joueur(s)` });
        }

        ioGameManager.clearTimers(room);
        startRound(io, room);
        safeCallback(callback, { success: true });
    });

    socket.on('io-stop-round', ({ roomCode }, callback) => {
        const room = ioGameManager.getRoom(roomCode);
        if (!room) return safeCallback(callback, { error: 'Salon introuvable' });
        if (room.hostId !== socket.id) return safeCallback(callback, { error: 'Réservé à l\'hôte' });
        if (room.state !== 'PLAYING' || !room.engine) return safeCallback(callback, { error: 'Aucune manche' });

        const mode = modes.get(room.settings.modeId);
        const results = mode?.results ? mode.results(room.modeCtx) : [];
        room.engine.stop();
        finishRound(io, room, results);
        safeCallback(callback, { success: true });
    });

    socket.on('io-set-mode', ({ roomCode, modeId }, callback) => {
        const room = ioGameManager.getRoom(roomCode);
        if (!room) return safeCallback(callback, { error: 'Salon introuvable' });
        if (room.hostId !== socket.id) return safeCallback(callback, { error: 'Réservé à l\'hôte' });
        if (room.state === 'PLAYING') return safeCallback(callback, { error: 'Manche en cours' });
        if (!modes.get(modeId)) return safeCallback(callback, { error: 'Mode inconnu' });

        room.settings.modeId = modeId;
        broadcastState(io, room);
        safeCallback(callback, { success: true });
    });

    // ── Diagnostic réseau, pour l'écran hôte ──────────────────────────────────
    socket.on('io-stats', ({ roomCode }, callback) => {
        const room = ioGameManager.getRoom(roomCode);
        if (!room || !room.engine) return safeCallback(callback, null);
        safeCallback(callback, room.engine.stats);
    });

    // ── Départ ────────────────────────────────────────────────────────────────
    socket.on('disconnect', () => {
        const result = ioGameManager.removePlayer(socket.id);
        if (!result) return;

        const { roomCode, room, isHost } = result;

        if (isHost) {
            // Période de grâce : un vidéoprojecteur qui perd le wifi trois
            // secondes ne doit pas effacer la partie de toute la salle.
            console.log(`[IO_ARENA] Hôte déconnecté de ${roomCode}, grâce ${HOST_GRACE_MS / 1000}s`);
            const timer = setTimeout(() => {
                hostDisconnectTimers.delete(roomCode);
                const current = ioGameManager.getRoom(roomCode);
                if (current && current.hostDisconnected) {
                    io.to(roomChannel(roomCode)).emit('io-room-deleted');
                    ioGameManager.deleteRoom(roomCode);
                }
            }, HOST_GRACE_MS);
            hostDisconnectTimers.set(roomCode, timer);
            broadcastState(io, room);
            return;
        }

        broadcastState(io, room);
    });
}

module.exports = { handleConnection };
