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

const DEFAULT_SETTINGS = {
    modeId: 'territoire',
    sizeId: 'moyen',      // taille du terrain, choisie à l'ouverture du salon
};

class IoGameManager {
    constructor() {
        this.rooms = new Map(); // Map<roomCode, IoRoom>
        setInterval(() => this.cleanupRooms(), 10 * 60 * 1000);
        console.log('[IO_ARENA] Game manager initialized');
    }

    cleanupRooms() {
        const now = Date.now();
        const ENDED_TTL = 30 * 60 * 1000;
        const STALE_TTL = 2 * 60 * 60 * 1000;
        for (const [code, room] of this.rooms) {
            const ref = room.lastActivity || 0;
            if (room.state === 'RESULT' && (now - ref) > ENDED_TTL) {
                this.deleteRoom(code);
                continue;
            }
            if ((now - ref) > STALE_TTL) this.deleteRoom(code);
        }
    }

    generateRoomCode() {
        let code;
        do {
            code = Math.floor(1000 + Math.random() * 9000).toString();
        } while (this.rooms.has(code));
        return code;
    }

    createRoom(hostId, settings = {}) {
        const roomCode = this.generateRoomCode();
        const merged = { ...DEFAULT_SETTINGS, ...settings };

        // L'hôte pilote l'interface, le serveur reste maître des bornes.
        if (!modes.get(merged.modeId)) merged.modeId = modes.fallback().id;

        const mode = modes.get(merged.modeId);
        if (mode?.sizes && !mode.sizes[merged.sizeId]) {
            merged.sizeId = mode.defaultSize || DEFAULT_SETTINGS.sizeId;
        }

        this.rooms.set(roomCode, {
            code: roomCode,
            hostId,
            hostDisconnected: false,
            players: new Map(),      // Map<socketId, PlayerData>
            state: 'LOBBY',          // LOBBY | PLAYING | RESULT
            settings: merged,
            engine: null,            // TickEngine de la manche en cours
            modeCtx: null,           // contexte passé au mode
            results: null,
            startedAt: null,
            timers: [],
            lastActivity: Date.now(),
        });

        console.log(`[IO_ARENA] Room created: ${roomCode} (mode=${merged.modeId})`);
        return roomCode;
    }

    getRoom(roomCode) {
        return this.rooms.get(roomCode);
    }

    deleteRoom(roomCode) {
        const room = this.rooms.get(roomCode);
        if (room) {
            this.clearTimers(room);
            if (room.engine) room.engine.stop();
        }
        if (this.rooms.delete(roomCode)) console.log(`[IO_ARENA] Room ${roomCode} deleted`);
    }

    clearTimers(room) {
        for (const timer of room.timers) clearTimeout(timer);
        room.timers = [];
    }

    /**
     * Arrivée d'un téléphone. La reconnexion se fait **par pseudo**, comme
     * partout ailleurs dans le hub : le joueur retrouve sa place, sa couleur et
     * son territoire, même après un changement de socket.
     */
    joinRoom(roomCode, playerId, playerName, avatar) {
        const room = this.rooms.get(roomCode);
        if (!room) return { error: 'Salon introuvable' };
        room.lastActivity = Date.now();

        const name = (playerName || '').trim().slice(0, 20);
        if (!name) return { error: 'Pseudo invalide' };

        for (const [id, player] of room.players) {
            if (player.name.toLowerCase() !== name.toLowerCase()) continue;

            // Reconnexion : le socket change, la place reste.
            room.players.delete(id);
            player.id = playerId;
            player.disconnected = false;
            if (avatar) player.avatar = avatar;
            room.players.set(playerId, player);

            // Le corps simulé est indexé par identifiant de joueur : il doit
            // suivre le nouveau socket, sinon le joueur pilote un fantôme.
            if (room.modeCtx?.state?.bodies?.has(id)) {
                const body = room.modeCtx.state.bodies.get(id);
                room.modeCtx.state.bodies.delete(id);
                room.modeCtx.state.bodies.set(playerId, body);
                // Les traînées référencent le propriétaire par identifiant.
                for (const [key, owner] of room.modeCtx.state.trailOwners) {
                    if (owner === id) room.modeCtx.state.trailOwners.set(key, playerId);
                }
            }
            if (room.modeCtx) room.modeCtx.players = room.players;

            return { room, player, reconnected: true };
        }

        // L'identité (couleur + forme) est figée dès l'arrivée, pas au coup
        // d'envoi : le joueur doit se reconnaître sur l'écran du lobby, sinon
        // rien ne lui prouve que son téléphone est bien connecté.
        const mode = modes.get(room.settings.modeId);
        const identities = mode?.identities || [];
        const taken = new Set([...room.players.values()].map((p) => p.slot));
        let slot = 0;
        while (taken.has(slot) && slot < identities.length) slot += 1;
        const identity = identities[slot % (identities.length || 1)] || {};

        const player = {
            id: playerId,
            name,
            avatar: avatar || null,
            slot,
            color: identity.color || null,
            shape: identity.shape || null,
            disconnected: false,
            joinedAt: Date.now(),
        };
        room.players.set(playerId, player);
        if (room.modeCtx) room.modeCtx.players = room.players;

        // Arrivée en pleine manche : le mode fait apparaître le joueur tout de
        // suite. C'est le principe du jeu, pas un cas particulier.
        if (room.state === 'PLAYING' && room.engine) {
            if (mode?.onJoin) mode.onJoin(room.modeCtx, player);
        }

        return { room, player, reconnected: false };
    }

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
