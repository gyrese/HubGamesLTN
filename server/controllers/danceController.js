/**
 * DANCE_DANCE — contrôleur socket et machine à états
 *
 *   LOBBY → COUNTDOWN → PLAYING → RESULT → (relance) LOBBY
 *
 * Le contrôleur ouvre le salon, distribue la chorégraphie, aligne le départ et
 * agrège les frappes. Le jugement lui-même vit dans `dance/judge.js`, la
 * chorégraphie dans `dance/chart.js`.
 *
 * ── Le départ synchronisé, cœur du jeu ──────────────────────────────
 * Vingt téléphones doivent lancer la même chanson au même instant, alors que
 * chacun a sa propre latence. On ne dit donc jamais « pars maintenant » : on
 * annonce un **instant serveur absolu** (`startAt`). Chaque téléphone a déjà
 * mesuré son décalage d'horloge via `connection:syncTime` (cf. index.js), il
 * convertit `startAt` dans son horloge locale et attend. Une annonce
 * arrivée 200 ms plus tard chez un joueur ne décale pas sa musique d'un
 * millimètre — elle lui laisse simplement moins de marge avant le départ.
 *
 * ── Trafic ──────────────────────────────────────────────────────────
 * Les frappes arrivent vite (jusqu'à ~6 par seconde et par joueur). On ne
 * rediffuse donc pas chaque frappe : le grand écran reçoit un instantané de
 * scores agrégé à 5 Hz, en `volatile`, comme les instantanés de l'arène .IO.
 */

const multer = require('multer');
const path = require('path');
const fs = require('fs');

const danceGameManager = require('../danceGameManager');
const chart = require('../dance/chart');
const songs = require('../dance/songs');
const authMiddleware = require('../middleware/authMiddleware');

const UPLOAD_DIR = path.join(__dirname, '../uploads/dance');
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
        const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
        cb(null, `song-${unique}${path.extname(file.originalname)}`);
    },
});

const upload = multer({
    storage,
    // Un morceau de quatre minutes en MP3 192 kbps pèse ~6 Mo ; 25 Mo laissent
    // de la marge pour du 320 kbps sans ouvrir la porte à n'importe quoi.
    limits: { fileSize: 25 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('audio/')) cb(null, true);
        else cb(new Error('Seuls les fichiers audio sont autorisés !'));
    },
});

const HOST_GRACE_MS = 90_000;
const RESULT_MS = 20_000;
/** Compte à rebours avant le départ : le temps de poser son téléphone. */
const COUNTDOWN_MS = 5_000;
/** Cadence de rafraîchissement des scores sur le grand écran. */
const SCORE_BROADCAST_MS = 200;

/**
 * Plafond de frappes acceptées par seconde et par joueur. Une chorégraphie
 * experte tourne autour de 6 notes/s ; au-delà de 25, ce n'est plus une main
 * humaine mais un script. Le surplus est ignoré silencieusement — inutile de
 * prévenir un tricheur de ce qui l'a trahi.
 */
const MAX_HITS_PER_SEC = 25;

const hostDisconnectTimers = new Map();   // roomCode → Timeout
const hitBuckets = new Map();             // socketId → { windowStart, count }

function roomChannel(roomCode) {
    return `dance-${roomCode}`;
}

/** Canal des grands écrans : eux seuls reçoivent le flux de scores. */
function screenChannel(roomCode) {
    return `dance-screen-${roomCode}`;
}

function safeCallback(callback, payload) {
    if (typeof callback === 'function') callback(payload);
}

function broadcastState(io, room) {
    room.lastActivity = Date.now();
    io.to(roomChannel(room.code)).emit('dance-state', danceGameManager.snapshot(room));
}

function schedule(room, ms, fn) {
    const timer = setTimeout(() => {
        room.timers = room.timers.filter((t) => t !== timer);
        try {
            fn();
        } catch (err) {
            console.error('[DANCE] Erreur dans un timer:', err);
        }
    }, ms);
    room.timers.push(timer);
    return timer;
}

/** Limiteur de cadence par socket. Renvoie false si la frappe doit être ignorée. */
function acceptHit(socketId) {
    const now = Date.now();
    let bucket = hitBuckets.get(socketId);
    if (!bucket || now - bucket.windowStart >= 1000) {
        bucket = { windowStart: now, count: 0 };
        hitBuckets.set(socketId, bucket);
    }
    bucket.count += 1;
    return bucket.count <= MAX_HITS_PER_SEC;
}

/* ─────────────────────────────────────────────────────────────────────
 * Déroulé d'une manche
 * ────────────────────────────────────────────────────────────────── */

/**
 * Envoie la chorégraphie et fixe l'instant du départ.
 *
 * La chart part **avant** le compte à rebours : les téléphones ont ainsi le
 * temps de la recevoir et de précharger l'audio pendant que l'écran affiche
 * « 5, 4, 3… ». C'est aussi ce qui permet au jugement d'être local.
 */
function startCountdown(io, room) {
    room.state = 'COUNTDOWN';
    room.startAt = Date.now() + COUNTDOWN_MS;

    io.to(roomChannel(room.code)).emit('dance-chart', {
        chart: room.chart,
        song: songs.publicCard(room.song),
        difficulty: room.settings.difficulty,
        startAt: room.startAt,
        serverTime: Date.now(),   // permet un dernier calage d'horloge
    });

    broadcastState(io, room);

    schedule(room, COUNTDOWN_MS, () => startPlaying(io, room));
    console.log(`[DANCE] Salon ${room.code} : départ dans ${COUNTDOWN_MS} ms (${room.chart.notes.length} notes)`);
}

function startPlaying(io, room) {
    room.state = 'PLAYING';
    broadcastState(io, room);

    // Flux de scores vers les grands écrans, en volatile : un instantané perdu
    // est remplacé par le suivant 200 ms plus tard, le rejouer n'a aucun sens.
    const ticker = setInterval(() => {
        if (room.state !== 'PLAYING') return;
        io.to(screenChannel(room.code)).volatile.emit('dance-scores', {
            players: danceGameManager.getPlayersInRoom(room.code)
                .filter((p) => !p.spectator)
                .sort((a, b) => b.score - a.score),
            elapsedMs: Date.now() - room.startAt,
        });
    }, SCORE_BROADCAST_MS);
    room.scoreTicker = ticker;

    // Fin du morceau : la durée de la chart fait foi, plus une marge pour
    // laisser arriver les dernières frappes en vol.
    const remaining = room.chart.durationMs - (Date.now() - room.startAt);
    schedule(room, Math.max(1000, remaining + 800), () => finishRound(io, room));
}

function finishRound(io, room) {
    if (room.scoreTicker) {
        clearInterval(room.scoreTicker);
        room.scoreTicker = null;
    }

    room.state = 'RESULT';
    const results = danceGameManager.finalizeScores(room);

    io.to(roomChannel(room.code)).emit('dance-round-end', { results });
    broadcastState(io, room);
    console.log(`[DANCE] Salon ${room.code} : manche terminée (${results.length} joueurs classés)`);

    schedule(room, RESULT_MS, () => {
        if (room.state !== 'RESULT') return;
        room.state = 'LOBBY';
        room.chart = null;
        room.startAt = null;
        broadcastState(io, room);
    });
}

module.exports = {
    /**
     * Routes REST du catalogue.
     *
     * Le téléversement est réservé à l'administrateur : n'importe quel visiteur
     * pouvant déposer 25 Mo d'audio sur le disque du serveur serait une porte
     * ouverte. La lecture du catalogue, elle, est publique — l'écran de
     * sélection en a besoin avant toute authentification.
     */
    setupRoutes: (app) => {
        app.get('/api/dance/songs', (req, res) => {
            res.json({
                songs: songs.list(),
                difficulties: chart.listDifficulties(),
            });
        });

        app.post('/api/dance/songs', authMiddleware, upload.single('audio'), (req, res) => {
            try {
                if (!req.file) return res.status(400).json({ error: 'Aucun fichier audio reçu' });

                // Le tempo et la durée sont mesurés par le navigateur au moment
                // du téléversement (Web Audio API) : décoder du MP3 côté serveur
                // demanderait ffmpeg ou un module natif, pour un seul jeu.
                // `songs.add` borne ces valeurs, on ne leur fait pas confiance.
                const song = songs.add({
                    title: req.body.title,
                    artist: req.body.artist,
                    audioUrl: `/uploads/dance/${req.file.filename}`,
                    bpm: req.body.bpm,
                    durationMs: req.body.durationMs,
                    offsetMs: req.body.offsetMs,
                });

                console.log(`[DANCE] Morceau ajouté : ${song.title} (${song.bpm} BPM)`);
                res.json({ success: true, song: songs.publicCard(song) });
            } catch (err) {
                console.error('[DANCE] Erreur de téléversement :', err);
                res.status(500).json({ error: 'Téléversement impossible' });
            }
        });

        app.delete('/api/dance/songs/:id', authMiddleware, (req, res) => {
            const removed = songs.remove(req.params.id);
            if (!removed) return res.status(404).json({ error: 'Morceau introuvable' });

            // Le fichier audio part avec l'entrée : sans cela, le disque se
            // remplit de morceaux que plus rien ne référence.
            if (removed.audioUrl && removed.audioUrl.startsWith('/uploads/dance/')) {
                const filePath = path.join(__dirname, '..', removed.audioUrl);
                fs.unlink(filePath, (err) => {
                    if (err) console.warn('[DANCE] Fichier audio non supprimé :', err.message);
                });
            }

            res.json({ success: true });
        });
    },

    handleConnection: (io, socket) => {

        /** Garde : seul l'hôte du salon peut piloter la manche. */
        const asHost = (roomCode) => {
            const room = danceGameManager.getRoom(roomCode);
            if (!room || room.hostId !== socket.id) return null;
            return room;
        };

        // ─── CATALOGUE ───
        socket.on('dance-list-songs', (_payload, callback) => {
            safeCallback(callback, {
                songs: songs.list(),
                difficulties: chart.listDifficulties(),
            });
        });

        // ─── OUVERTURE DU SALON (grand écran) ───
        socket.on('dance-create-room', ({ songId, difficulty } = {}, callback) => {
            try {
                const roomCode = danceGameManager.createRoom(socket.id, { songId, difficulty });
                socket.join(roomChannel(roomCode));
                socket.join(screenChannel(roomCode));

                const room = danceGameManager.getRoom(roomCode);
                safeCallback(callback, {
                    success: true,
                    roomCode,
                    state: danceGameManager.snapshot(room),
                    songs: songs.list(),
                    difficulties: chart.listDifficulties(),
                });
            } catch (err) {
                console.error('[DANCE] Erreur dance-create-room:', err);
                safeCallback(callback, { error: 'Impossible d\'ouvrir le salon' });
            }
        });

        // ─── RECONNEXION DU GRAND ÉCRAN ───
        socket.on('dance-host-reconnect', ({ roomCode } = {}, callback) => {
            const room = danceGameManager.getRoom(roomCode);
            if (!room) return safeCallback(callback, { error: 'Salon introuvable' });

            const pending = hostDisconnectTimers.get(roomCode);
            if (pending) {
                clearTimeout(pending);
                hostDisconnectTimers.delete(roomCode);
            }

            room.hostId = socket.id;
            room.hostDisconnected = false;
            socket.join(roomChannel(roomCode));
            socket.join(screenChannel(roomCode));
            danceGameManager.touch(room);

            safeCallback(callback, { success: true, state: danceGameManager.snapshot(room) });
            broadcastState(io, room);
        });

        // ─── ARRIVÉE D'UN JOUEUR ───
        socket.on('dance-join-room', ({ roomCode, playerName, avatar } = {}, callback) => {
            const result = danceGameManager.joinRoom(roomCode, socket.id, playerName, avatar);
            if (result.error) return safeCallback(callback, { error: result.error });

            socket.join(roomChannel(roomCode));

            safeCallback(callback, {
                success: true,
                roomCode,
                playerId: socket.id,
                spectator: result.spectator,
                reconnected: result.reconnected,
                state: danceGameManager.snapshot(result.room),
            });

            // Un joueur qui arrive pendant une chanson reçoit quand même la
            // chorégraphie : il la regarde défiler et jouera la suivante.
            if (result.room.state === 'PLAYING' && result.room.chart) {
                socket.emit('dance-chart', {
                    chart: result.room.chart,
                    song: songs.publicCard(result.room.song),
                    difficulty: result.room.settings.difficulty,
                    startAt: result.room.startAt,
                    serverTime: Date.now(),
                    spectator: true,
                });
            }

            broadcastState(io, result.room);
        });

        // ─── LE TÉLÉPHONE A CHARGÉ L'AUDIO ───
        socket.on('dance-ready', ({ roomCode } = {}) => {
            const room = danceGameManager.getRoom(roomCode);
            if (!room) return;
            const player = room.players.get(socket.id);
            if (!player) return;
            player.ready = true;
            broadcastState(io, room);
        });

        // ─── CHOIX DU MORCEAU (hôte) ───
        socket.on('dance-select-song', ({ roomCode, songId, difficulty } = {}, callback) => {
            const room = asHost(roomCode);
            if (!room) return safeCallback(callback, { error: 'Action réservée à l\'hôte' });
            if (room.state !== 'LOBBY') return safeCallback(callback, { error: 'Manche en cours' });

            const song = songs.get(songId);
            if (song) room.settings.songId = song.id;
            if (chart.DIFFICULTIES[difficulty]) room.settings.difficulty = difficulty;

            danceGameManager.touch(room);
            safeCallback(callback, { success: true });
            broadcastState(io, room);
        });

        // ─── LANCEMENT DE LA MANCHE (hôte) ───
        socket.on('dance-start-round', ({ roomCode, songId, difficulty } = {}, callback) => {
            const room = asHost(roomCode);
            if (!room) return safeCallback(callback, { error: 'Action réservée à l\'hôte' });
            if (room.state !== 'LOBBY') return safeCallback(callback, { error: 'Manche déjà en cours' });

            const active = danceGameManager.activePlayers(room);
            if (active.length === 0) return safeCallback(callback, { error: 'Aucun joueur connecté' });

            const prepared = danceGameManager.prepareRound(room, { songId, difficulty });
            if (prepared.error) return safeCallback(callback, { error: prepared.error });

            safeCallback(callback, { success: true });
            startCountdown(io, room);
        });

        // ─── FRAPPE D'UN JOUEUR ───
        //
        // Pas d'accusé de réception : le téléphone a déjà affiché son verdict,
        // attendre le serveur n'apporterait rien et coûterait un aller-retour.
        socket.on('dance-hit', ({ roomCode, noteId, offsetMs } = {}) => {
            if (!acceptHit(socket.id)) return;

            const room = danceGameManager.getRoom(roomCode);
            if (!room) return;
            const player = room.players.get(socket.id);
            if (!player) return;

            danceGameManager.registerHit(room, player, { noteId, offsetMs });
        });

        // ─── EXPULSION (hôte) ───
        socket.on('dance-kick-player', ({ roomCode, playerId } = {}, callback) => {
            const room = asHost(roomCode);
            if (!room) return safeCallback(callback, { error: 'Action réservée à l\'hôte' });

            const result = danceGameManager.kickPlayer(roomCode, playerId);
            if (result.error) return safeCallback(callback, { error: result.error });

            io.to(playerId).emit('dance-kicked');
            safeCallback(callback, { success: true });
            broadcastState(io, room);
        });

        // ─── DÉCONNEXION ───
        socket.on('disconnect', () => {
            hitBuckets.delete(socket.id);

            const result = danceGameManager.removePlayer(socket.id);
            if (!result) return;

            const { roomCode, room, isHost } = result;

            if (isHost) {
                // L'écran hôte a sauté : on laisse une période de grâce avant de
                // fermer, un vidéoprojecteur se rebranche.
                room.hostDisconnected = true;
                broadcastState(io, room);

                const timer = setTimeout(() => {
                    hostDisconnectTimers.delete(roomCode);
                    const current = danceGameManager.getRoom(roomCode);
                    if (current && current.hostDisconnected) {
                        io.to(roomChannel(roomCode)).emit('dance-room-closed');
                        danceGameManager.deleteRoom(roomCode);
                    }
                }, HOST_GRACE_MS);
                hostDisconnectTimers.set(roomCode, timer);
                return;
            }

            broadcastState(io, room);
        });
    },
};
