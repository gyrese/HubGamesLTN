/**
 * DANCE_DANCE — gestionnaire de salons
 *
 * Huitième jeu du hub, et le premier à **déléguer le jugement au client**.
 * Ce choix mérite d'être justifié, car il rompt avec la règle « serveur
 * autoritaire » de l'arène .IO :
 *
 * Un jeu de rythme distingue une frappe parfaite d'une frappe correcte à 25 ms
 * près. Or la latence d'un téléphone sur le wifi d'un bar oscille entre 30 et
 * 80 ms, et surtout elle *varie*. Faire juger le serveur reviendrait à noter la
 * qualité de la connexion plutôt que le sens du rythme : le joueur le mieux
 * connecté gagnerait. Le téléphone connaît donc la chorégraphie à l'avance et
 * juge sur place, ce qui rend le retour immédiat et équitable.
 *
 * Le serveur ne fait pas confiance pour autant : il ne reçoit pas un score mais
 * des frappes individuelles `{ noteId, offsetMs }`, qu'il **rejuge lui-même**
 * avec la même table que le client (`dance/judge.js`). Le client annonce un
 * écart, jamais un verdict ni des points. Voir `registerHit` pour les gardes.
 */

const RoomBase = require('./core/RoomBase');
const judge = require('./dance/judge');
const chart = require('./dance/chart');
const songs = require('./dance/songs');

const DEFAULT_SETTINGS = {
    songId: null,
    difficulty: chart.DEFAULT_DIFFICULTY,
};

/**
 * Marge tolérée entre l'écart annoncé par le téléphone et ce que le serveur
 * juge plausible. Elle absorbe la dérive d'horloge résiduelle après
 * synchronisation, sans laisser passer une frappe inventée.
 */
const CLOCK_TOLERANCE_MS = 250;

class DanceGameManager extends RoomBase {
    constructor() {
        super({
            logTag: 'DANCE',
            codeFormat: 'num4',
            stateField: 'state',
            endStates: ['RESULT'],
            endedTtlMs: 30 * 60 * 1000,
            staleTtlMs: 2 * 60 * 60 * 1000,
        });
    }

    defaultSettings() {
        return { ...DEFAULT_SETTINGS };
    }

    createRoomState() {
        return {
            // LOBBY | COUNTDOWN | PLAYING | RESULT
            chart: null,        // chorégraphie de la manche en cours
            song: null,         // morceau joué
            startAt: null,      // instant serveur absolu du départ (ms epoch)
            results: null,
            timers: [],
            // Intervalle de diffusion des scores pendant la chanson ; il doit
            // mourir avec le salon, sinon il continue de tourner à vide.
            scoreTicker: null,
        };
    }

    onRoomDisposed(room) {
        this.clearTimers(room);
        if (room.scoreTicker) {
            clearInterval(room.scoreTicker);
            room.scoreTicker = null;
        }
    }

    clearTimers(room) {
        for (const timer of room.timers) clearTimeout(timer);
        room.timers = [];
    }

    /**
     * On entre en pleine chanson, mais on ne joue qu'à la suivante : rejoindre
     * au milieu d'un morceau donnerait un score incomparable aux autres. Le
     * joueur est admis comme spectateur, ce qui vaut mieux que de le laisser à
     * la porte pendant trois minutes.
     */
    canJoinMidGame() {
        return true;
    }

    sanitizeName(playerName) {
        return super.sanitizeName(playerName, 16);
    }

    createPlayer(playerId, playerName, avatar, room) {
        return {
            id: playerId,
            name: playerName,
            avatar: avatar || null,
            disconnected: false,
            joinedAt: Date.now(),
            // `ready` distingue le joueur qui a chargé l'audio et attend le
            // départ de celui dont le téléphone rame encore.
            ready: false,
            // Score de la manche courante, remis à zéro à chaque chanson.
            live: judge.createScoreState(),
            // Notes déjà comptées : une frappe rejouée doit être ignorée.
            hitNotes: new Set(),
            // Spectateur : arrivé en cours de chanson, jouera la suivante.
            spectator: room ? room.state !== 'LOBBY' : false,
            lastResult: null,
            totalScore: 0,   // cumul sur la soirée
        };
    }

    describePlayer(p) {
        return {
            id: p.id,
            name: p.name,
            avatar: p.avatar,
            disconnected: p.disconnected,
            ready: p.ready,
            spectator: p.spectator,
            score: p.live.score,
            combo: p.live.combo,
            maxCombo: p.live.maxCombo,
            accuracy: judge.accuracy(p.live),
            totalScore: p.totalScore,
        };
    }

    /** Le set de notes frappées est indexé par joueur : il suit le nouveau socket. */
    onPlayerRejoin(room, oldId, newId) {
        const player = room.players.get(newId);
        if (player) player.id = newId;
    }

    describeRejoin(room, player) {
        return {
            state: room.state,
            spectator: player.spectator,
        };
    }

    describeJoin(room, player) {
        return {
            state: room.state,
            spectator: player.spectator,
        };
    }

    /* ── Préparation d'une chanson ─────────────────────────────────── */

    /**
     * Prépare la manche : choisit le morceau, génère la chorégraphie.
     * La chart est générée **une fois pour le salon** puis diffusée telle
     * quelle : tous les téléphones doivent danser exactement la même chose, et
     * régénérer côté client ouvrirait la porte à une chart truquée.
     *
     * @returns {{error}|{chart, song}}
     */
    prepareRound(room, { songId, difficulty } = {}) {
        const song = songs.get(songId || room.settings.songId);
        if (!song) return { error: 'Morceau introuvable' };

        const level = chart.DIFFICULTIES[difficulty || room.settings.difficulty]
            ? (difficulty || room.settings.difficulty)
            : chart.DEFAULT_DIFFICULTY;

        const generated = chart.generateChart({
            bpm: song.bpm,
            durationMs: song.durationMs,
            difficulty: level,
            seed: song.id,
            offsetMs: song.offsetMs || 0,
        });

        room.settings.songId = song.id;
        room.settings.difficulty = level;
        room.song = song;
        room.chart = generated;
        room.results = null;

        // Chaque joueur repart d'un score vierge ; les spectateurs entrent en jeu.
        for (const player of room.players.values()) {
            player.live = judge.createScoreState();
            player.hitNotes = new Set();
            player.spectator = false;
            player.ready = false;
        }

        this.touch(room);
        return { chart: generated, song };
    }

    /**
     * Enregistre une frappe annoncée par un téléphone.
     *
     * C'est ici que se joue l'anti-triche. Le client envoie `{ noteId, offsetMs }` ;
     * il n'envoie **ni verdict ni points**, que le serveur recalcule. Quatre
     * gardes, chacune fermant une fraude distincte :
     *
     *   1. la note doit exister dans la chorégraphie — pas de note inventée ;
     *   2. elle ne doit pas avoir déjà été comptée — pas de frappe rejouée ;
     *   3. l'écart annoncé doit tenir dans la fenêtre de jugement ;
     *   4. l'instant réel d'arrivée doit être cohérent avec l'écart annoncé,
     *      à la tolérance d'horloge près — sinon un client pourrait prétendre
     *      « parfait » sur une note déjà passée depuis longtemps.
     *
     * @returns {{ok:false, reason}|{ok:true, judgement, live}}
     */
    registerHit(room, player, { noteId, offsetMs }) {
        if (room.state !== 'PLAYING') return { ok: false, reason: 'inactive' };
        if (!room.chart) return { ok: false, reason: 'no-chart' };
        if (player.spectator) return { ok: false, reason: 'spectator' };

        const id = Number(noteId);
        const offset = Number(offsetMs);
        if (!Number.isFinite(id) || !Number.isFinite(offset)) {
            return { ok: false, reason: 'malformed' };
        }

        // 1. La note existe-t-elle ? Les identifiants sont l'index dans la
        // chorégraphie, donc la recherche est directe.
        const note = room.chart.notes[id];
        if (!note || note.id !== id) return { ok: false, reason: 'unknown-note' };

        // 2. Déjà comptée ?
        if (player.hitNotes.has(id)) return { ok: false, reason: 'duplicate' };

        // 3. L'écart annoncé est-il seulement jugeable ?
        if (!judge.isWithinHitRange(offset)) return { ok: false, reason: 'out-of-range' };

        // 4. Cohérence temporelle. Position réelle de la frappe dans le morceau,
        // mesurée à l'arrivée du paquet ; elle inclut la latence réseau, donc on
        // ne peut qu'exiger un ordre de grandeur, pas une égalité.
        const songPosition = Date.now() - room.startAt;
        const claimedPosition = note.timeMs + offset;
        if (Math.abs(songPosition - claimedPosition) > CLOCK_TOLERANCE_MS + judge.MISS_WINDOW) {
            return { ok: false, reason: 'implausible' };
        }

        // Le verdict est recalculé par le serveur, jamais lu du client.
        const judgement = judge.judgeOffset(offset);
        player.hitNotes.add(id);
        judge.applyJudgement(player.live, judgement, offset);
        this.touch(room);

        return { ok: true, judgement, live: player.live };
    }

    /**
     * Compte comme ratées les notes jamais frappées, en fin de morceau.
     * Sans cela, un joueur qui ne touche rien finirait avec 100 % de précision
     * sur zéro note jugée.
     */
    finalizeScores(room) {
        const total = room.chart ? room.chart.notes.length : 0;

        for (const player of room.players.values()) {
            if (player.spectator) continue;
            const missed = total - player.hitNotes.size;
            for (let i = 0; i < missed; i++) {
                judge.applyJudgement(player.live, judge.judgeOffset(9999), 0);
            }
            player.totalScore += player.live.score;
            player.lastResult = {
                score: player.live.score,
                maxCombo: player.live.maxCombo,
                accuracy: judge.accuracy(player.live),
                rank: judge.rank(player.live),
                counts: { ...player.live.counts },
            };
        }

        const results = Array.from(room.players.values())
            .filter((p) => !p.spectator && p.lastResult)
            .map((p) => ({
                playerId: p.id,
                name: p.name,
                avatar: p.avatar,
                ...p.lastResult,
                totalScore: p.totalScore,
            }))
            .sort((a, b) => b.score - a.score);

        room.results = results;
        return results;
    }

    /** Vue publique du salon : ce que voient l'écran et les téléphones. */
    snapshot(room) {
        return {
            code: room.code,
            state: room.state,
            song: room.song ? songs.publicCard(room.song) : null,
            difficulty: room.settings.difficulty,
            noteCount: room.chart ? room.chart.notes.length : 0,
            startAt: room.startAt,
            durationMs: room.chart ? room.chart.durationMs : null,
            players: this.getPlayersInRoom(room.code),
            results: room.results,
            hostDisconnected: room.hostDisconnected,
        };
    }
}

module.exports = new DanceGameManager();
module.exports.CLOCK_TOLERANCE_MS = CLOCK_TOLERANCE_MS;
