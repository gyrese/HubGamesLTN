/**
 * IO_ARENA — gestionnaire de salons
 *
 * Ce module ne connaît que l'état ; la boucle de simulation vit dans
 * `io/tickEngine.js`, et l'enchaînement des phases dans
 * `controllers/ioController.js`. Même découpage que Super LTN Party.
 *
 * La particularité du jeu tient en une phrase : **on entre et on sort en pleine
 * manche**. Un joueur qui rejoint à la 40ᵉ seconde apparaît immédiatement sur la
 * carte, et celui qui s'en va laisse son territoire derrière lui. C'est la
 * contrainte du bar (les gens vont et viennent) transformée en règle du jeu.
 */

const modes = require('./io/modes');
const RoomBase = require('./core/RoomBase');

const DEFAULT_SETTINGS = {
    modeId: 'territoire',
    sizeId: 'moyen',      // taille du terrain, choisie à l'ouverture du salon
};

class IoGameManager extends RoomBase {
    constructor() {
        super({
            logTag: 'IO_ARENA',
            codeFormat: 'num4',
            stateField: 'state',     // IO nomme son état `state`
            endStates: ['RESULT'],
            endedTtlMs: 30 * 60 * 1000,
            staleTtlMs: 2 * 60 * 60 * 1000
        });
    }

    /**
     * L'arène expire sur l'inactivité seule : des manettes peuvent rester
     * connectées sans qu'aucune manche ne tourne.
     */
    cleanupRooms() {
        const now = Date.now();
        for (const [code, room] of this.rooms) {
            const ref = room.lastActivity || room.createdAt || 0;
            if (room.state === 'RESULT' && (now - ref) > this.endedTtlMs) {
                this.deleteRoom(code);
                continue;
            }
            if ((now - ref) > this.staleTtlMs) this.deleteRoom(code);
        }
    }

    defaultSettings() {
        return { ...DEFAULT_SETTINGS };
    }

    /** L'hôte pilote l'interface, le serveur reste maître des bornes. */
    createRoom(hostId, settings = {}) {
        const merged = { ...DEFAULT_SETTINGS, ...settings };

        if (!modes.get(merged.modeId)) merged.modeId = modes.fallback().id;

        const mode = modes.get(merged.modeId);
        if (mode?.sizes && !mode.sizes[merged.sizeId]) {
            merged.sizeId = mode.defaultSize || DEFAULT_SETTINGS.sizeId;
        }

        const roomCode = super.createRoom(hostId, merged);
        this.log(`Room ${roomCode} mode=${merged.modeId}`);
        return roomCode;
    }

    createRoomState() {
        return {
            // LOBBY | PLAYING | RESULT
            engine: null,            // TickEngine de la manche en cours
            modeCtx: null,           // contexte passé au mode
            results: null,
            startedAt: null,
            timers: [],
        };
    }

    /** La boucle de simulation doit s'arrêter avec le salon. */
    onRoomDisposed(room) {
        this.clearTimers(room);
        if (room.engine) room.engine.stop();
    }

    clearTimers(room) {
        for (const timer of room.timers) clearTimeout(timer);
        room.timers = [];
    }

    /**
     * L'arène accueille en pleine manche : le mode fait apparaître l'arrivant
     * immédiatement. C'est le principe du jeu, pas un cas particulier.
     */
    canJoinMidGame() {
        return true;
    }

    sanitizeName(playerName) {
        return super.sanitizeName(playerName, 20);
    }

    /**
     * L'identité (couleur + forme) est figée dès l'arrivée, pas au coup
     * d'envoi : le joueur doit se reconnaître sur l'écran du lobby, sinon
     * rien ne lui prouve que son téléphone est bien connecté.
     */
    createPlayer(playerId, playerName, avatar, room) {
        const mode = modes.get(room.settings.modeId);
        const identities = mode?.identities || [];
        const taken = new Set([...room.players.values()].map((p) => p.slot));
        let slot = 0;
        while (taken.has(slot) && slot < identities.length) slot += 1;
        const identity = identities[slot % (identities.length || 1)] || {};

        return {
            id: playerId,
            name: playerName,
            avatar: avatar || null,
            slot,
            color: identity.color || null,
            shape: identity.shape || null,
            disconnected: false,
            joinedAt: Date.now(),
        };
    }

    /**
     * Le corps simulé est indexé par identifiant de joueur : il doit suivre le
     * nouveau socket, sinon le joueur pilote un fantôme.
     */
    onPlayerRejoin(room, oldId, newId) {
        if (room.modeCtx?.state?.bodies?.has(oldId)) {
            const body = room.modeCtx.state.bodies.get(oldId);
            room.modeCtx.state.bodies.delete(oldId);
            room.modeCtx.state.bodies.set(newId, body);
            // Les traînées référencent le propriétaire par identifiant.
            for (const [key, owner] of room.modeCtx.state.trailOwners) {
                if (owner === oldId) room.modeCtx.state.trailOwners.set(key, newId);
            }
        }
        if (room.modeCtx) room.modeCtx.players = room.players;
    }

    /**
     * Le contrôleur IO lit `{ room, player, reconnected }`. C'est aussi ici que
     * le mode fait apparaître un arrivant dans une manche déjà lancée.
     */
    joinRoom(roomCode, playerId, playerName, avatar) {
        const result = super.joinRoom(roomCode, playerId, playerName, avatar);
        if (result.error) return result;

        const room = result.room;
        if (room.modeCtx) room.modeCtx.players = room.players;

        if (!result.reconnected && room.state === 'PLAYING' && room.engine) {
            const mode = modes.get(room.settings.modeId);
            if (mode?.onJoin) mode.onJoin(room.modeCtx, result.player);
        }
        return result;
    }

    describeRejoin() { return {}; }
    describeJoin() { return {}; }

    /**
     * Déconnexion. Le joueur n'est **pas** supprimé : il est marqué absent et
     * garde sa place, exactement comme le capitaine d'une table dans Party.
     *
     * C'est ce qui rend la reconnexion par pseudo possible. Sur un réseau
     * mobile, une réattribution d'IP coupe le lien une à trois secondes ; sans
     * cette période de grâce, un joueur perdrait son territoire et sa couleur à
     * chaque passage de porte. Son corps reste dans la simulation et continue
     * d'avancer — c'est aussi ce qui évite qu'une traînée orpheline disparaisse
     * d'un coup de l'écran.
     */
    removePlayer(playerId) {
        for (const [roomCode, room] of this.rooms) {
            if (room.hostId === playerId) {
                room.hostDisconnected = true;
                return { roomCode, room, isHost: true };
            }
            const player = room.players.get(playerId);
            if (!player) continue;

            room.lastActivity = Date.now();
            player.disconnected = true;
            player.disconnectedAt = Date.now();

            return { roomCode, room, isHost: false, player, type: 'disconnected' };
        }
        return null;
    }

    /**
     * Purge les joueurs absents depuis trop longtemps. Appelée par le contrôleur
     * à la fin de chaque manche : en pleine partie, retirer quelqu'un ferait
     * disparaître son point sous les yeux de la salle.
     */
    purgeDisconnected(room, graceMs) {
        const now = Date.now();
        const mode = modes.get(room.settings.modeId);
        for (const [id, player] of [...room.players]) {
            if (!player.disconnected) continue;
            if (now - (player.disconnectedAt || 0) < graceMs) continue;
            room.players.delete(id);
            if (room.modeCtx && mode?.onLeave) mode.onLeave(room.modeCtx, id);
        }
        if (room.modeCtx) room.modeCtx.players = room.players;
    }

    /** Vue publique du salon : ce que voient l'écran et les téléphones. */
    snapshot(room) {
        const mode = modes.get(room.settings.modeId) || modes.fallback();
        return {
            code: room.code,
            state: room.state,
            mode: modes.publicCard(mode),
            players: Array.from(room.players.values()).map((p) => ({
                id: p.id,
                name: p.name,
                avatar: p.avatar,
                color: p.color,
                shape: p.shape,
                disconnected: p.disconnected,
            })),
            // Le monde réel vient du contexte de la manche en cours : il dépend
            // de la taille choisie, pas du défaut déclaré par le mode.
            world: room.modeCtx?.world || mode.world,
            sizeId: room.settings.sizeId,
            results: room.results,
            remaining: room.engine ? room.engine.remaining() : null,
            hostDisconnected: room.hostDisconnected,
        };
    }
}

module.exports = new IoGameManager();
