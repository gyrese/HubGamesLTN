/**
 * RoomBase — socle commun des gestionnaires de salon.
 *
 * Les 7 jeux du hub répétaient la même plomberie : génération de code,
 * inscription, reconnexion par pseudo, période de grâce hôte, nettoyage
 * périodique. Cette classe la porte une fois ; chaque jeu ne garde que ses
 * règles propres.
 *
 * Ce que la classe NE fait pas : elle ne connaît aucune règle de jeu, aucun
 * état de manche, aucun score. Un gestionnaire reste libre de tout surcharger.
 *
 * ── Points d'extension ──────────────────────────────────────────────
 *   codeFormat        'alpha6' | 'num4'  — format de code du jeu
 *   logTag            préfixe des journaux
 *   createRoomState() l'état initial propre au jeu
 *   createPlayer()    les champs d'un joueur pour ce jeu
 *   describePlayer()  la vue publique d'un joueur
 *   onPlayerRejoin()  réécriture des références après changement d'identifiant
 *   describeRejoin()  le payload rendu à un joueur qui se reconnecte
 *   describeJoin()    le payload rendu à un nouvel arrivant
 *   canJoinMidGame()  politique d'arrivée en cours de partie
 *   onRoomDisposed()  libération des ressources du jeu (minuteurs, boucles)
 */

const ALPHA6 = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans I, O, 0, 1 : illisibles de loin

class RoomBase {
    /**
     * @param {object} options
     * @param {string} options.logTag         préfixe de journal, ex. 'DRAW'
     * @param {'alpha6'|'num4'} [options.codeFormat='alpha6']
     * @param {number} [options.cleanupIntervalMs=600000]
     * @param {number} [options.staleTtlMs=5400000]  salon vide depuis trop longtemps
     * @param {number} [options.endedTtlMs=1800000]  salon terminé depuis trop longtemps
     * @param {number} [options.maxPlayers=0]        0 = pas de limite
     * @param {string[]} [options.endStates=['GAME_END']]
     * @param {string} [options.stateField='gameState'] nom du champ d'état
     *        (Party et IO l'appellent `state`)
     */
    constructor({
        logTag = 'ROOM',
        codeFormat = 'alpha6',
        stateField = 'gameState',
        cleanupIntervalMs = 10 * 60 * 1000,
        staleTtlMs = 90 * 60 * 1000,
        endedTtlMs = 30 * 60 * 1000,
        maxPlayers = 0,
        endStates = ['GAME_END']
    } = {}) {
        this.rooms = new Map();
        this.logTag = logTag;
        this.codeFormat = codeFormat;
        this.staleTtlMs = staleTtlMs;
        this.endedTtlMs = endedTtlMs;
        this.maxPlayers = maxPlayers;
        this.endStates = endStates;
        this.stateField = stateField;

        this.cleanupTimer = setInterval(() => this.cleanupRooms(), cleanupIntervalMs);
        // Ne pas retenir le processus en vie pour un simple nettoyage
        if (this.cleanupTimer.unref) this.cleanupTimer.unref();

        this.log('Game manager initialized');
    }

    log(message) {
        console.log(`[${this.logTag}] ${message}`);
    }

    /** État courant d'un salon, quel que soit le nom du champ dans ce jeu. */
    stateOf(room) {
        return room?.[this.stateField];
    }

    /* ── Codes de salon ────────────────────────────────────────────── */

    /**
     * Tire un code libre. Le format reste celui du jeu : changer les codes
     * existants perturberait les joueurs sans rien apporter.
     */
    generateRoomCode() {
        const draw = () => {
            if (this.codeFormat === 'num4') {
                return String(Math.floor(1000 + Math.random() * 9000));
            }
            let code = '';
            for (let i = 0; i < 6; i++) {
                code += ALPHA6.charAt(Math.floor(Math.random() * ALPHA6.length));
            }
            return code;
        };

        // Tirage aléatoire : le cas normal, immédiat tant que la table est creuse.
        for (let i = 0; i < 200; i++) {
            const code = draw();
            if (!this.rooms.has(code)) return code;
        }

        // Table presque pleine : le hasard ne trouvera plus le trou restant.
        // L'espace num4 ne fait que 9000 codes — on le balaie.
        if (this.codeFormat === 'num4') {
            for (let n = 1000; n <= 9999; n++) {
                const code = String(n);
                if (!this.rooms.has(code)) return code;
            }
        }

        throw new Error(`[${this.logTag}] Impossible de tirer un code de salon libre`);
    }

    /* ── Cycle de vie ──────────────────────────────────────────────── */

    /** État initial propre au jeu. À surcharger. */
    createRoomState() {
        return {};
    }

    createRoom(hostId, settings = {}) {
        const roomCode = this.generateRoomCode();

        const room = {
            code: roomCode,
            hostId,
            players: new Map(),
            [this.stateField]: 'LOBBY',
            hostDisconnected: false,
            createdAt: Date.now(),
            lastActivity: Date.now(),
            settings: { ...this.defaultSettings(), ...settings },
            ...this.createRoomState(settings)
        };

        this.rooms.set(roomCode, room);
        this.log(`Room created: ${roomCode}`);
        return roomCode;
    }

    /** Réglages par défaut du jeu. À surcharger. */
    defaultSettings() {
        return {};
    }

    getRoom(roomCode) {
        return this.rooms.get(roomCode);
    }

    /** Marque une activité — repousse l'expiration du salon. */
    touch(room) {
        if (room) room.lastActivity = Date.now();
    }

    /** Libération des ressources propres au jeu (minuteurs, boucles). À surcharger. */
    onRoomDisposed(_room) { /* rien par défaut */ }

    deleteRoom(roomCode) {
        const room = this.rooms.get(roomCode);
        if (!room) return false;
        this.onRoomDisposed(room);
        this.rooms.delete(roomCode);
        this.log(`Room ${roomCode} deleted`);
        return true;
    }

    /**
     * Supprime les salons terminés depuis longtemps et ceux que plus personne
     * n'occupe. Appelé périodiquement.
     */
    cleanupRooms() {
        const now = Date.now();
        for (const [code, room] of this.rooms) {
            const ref = room.lastActivity || room.createdAt || 0;

            if (this.endStates.includes(this.stateOf(room)) && (now - ref) > this.endedTtlMs) {
                this.onRoomDisposed(room);
                this.rooms.delete(code);
                this.log(`Cleanup: room ${code} supprimée (terminée)`);
                continue;
            }

            const active = this.activePlayers(room);
            if (active.length === 0 && (now - ref) > this.staleTtlMs) {
                this.onRoomDisposed(room);
                this.rooms.delete(code);
                this.log(`Cleanup: room ${code} supprimée (inactive)`);
            }
        }
    }

    /* ── Joueurs ───────────────────────────────────────────────────── */

    /** Joueurs encore connectés. */
    activePlayers(room) {
        if (!room) return [];
        return Array.from(room.players.values()).filter(p => !p.disconnected);
    }

    /** Champs d'un joueur propres au jeu. À surcharger pour enrichir. */
    createPlayer(playerId, playerName, avatar, _room) {
        return {
            id: playerId,
            name: playerName,
            avatar: avatar || null,
            score: 0,
            disconnected: false,
            joinedAt: Date.now()
        };
    }

    /** Vue publique d'un joueur. À surcharger pour exposer d'autres champs. */
    describePlayer(p, _room) {
        return {
            id: p.id,
            name: p.name,
            avatar: p.avatar,
            score: p.score,
            disconnected: p.disconnected
        };
    }

    getPlayersInRoom(roomCode) {
        const room = this.rooms.get(roomCode);
        if (!room) return [];
        return Array.from(room.players.values()).map(p => this.describePlayer(p, room));
    }

    /** Un nouvel arrivant peut-il entrer en pleine partie ? À surcharger. */
    canJoinMidGame(_room) {
        return false;
    }

    /**
     * Recherche un joueur déjà connu, par pseudo (insensible à la casse).
     * C'est le mécanisme de reconnexion historique du hub : le téléphone qui
     * revient n'a pas le même identifiant de socket, mais le même pseudo.
     */
    findPlayerIdByName(room, playerName) {
        const needle = String(playerName || '').trim().toLowerCase();
        if (!needle) return null;
        for (const [id, p] of room.players) {
            if (p.name.toLowerCase() === needle) return id;
        }
        return null;
    }

    /**
     * Réécrit les références à l'ancien identifiant après une reconnexion.
     * Un jeu qui garde des identifiants ailleurs (ordre de passage, votes,
     * file de tours) doit surcharger cette méthode.
     */
    onPlayerRejoin(_room, _oldId, _newId) { /* rien par défaut */ }

    /** Payload rendu à un joueur qui se reconnecte. À surcharger. */
    describeRejoin(room, player) {
        return {
            gameState: this.stateOf(room),
            myScore: player.score
        };
    }

    /** Payload rendu à un nouvel arrivant. À surcharger. */
    describeJoin(room, _player) {
        return {
            gameState: this.stateOf(room)
        };
    }

    /** Normalise et borne un pseudo entrant. */
    sanitizeName(playerName, maxLength = 14) {
        return String(playerName || '').trim().slice(0, maxLength);
    }

    /**
     * Inscription ou reconnexion.
     *
     * Le déroulé est identique dans les 7 jeux : on cherche un joueur du même
     * pseudo, on le réhydrate s'il existe, sinon on en crée un — sous réserve
     * que la partie l'autorise.
     */
    joinRoom(roomCode, playerId, playerName, avatar) {
        const room = this.rooms.get(roomCode);
        if (!room) return { error: 'Salon introuvable' };

        const name = this.sanitizeName(playerName);
        if (!name) return { error: 'Pseudo invalide' };

        this.touch(room);

        /* Reconnexion */
        const existingId = this.findPlayerIdByName(room, name);
        if (existingId) {
            const player = room.players.get(existingId);
            room.players.delete(existingId);

            player.id = playerId;
            player.disconnected = false;
            if (avatar) player.avatar = avatar;
            room.players.set(playerId, player);

            this.onPlayerRejoin(room, existingId, playerId);

            this.log(`Player ${name} reconnected to room ${roomCode}`);
            return {
                success: true,
                room,
                player,
                reconnected: true,
                ...this.describeRejoin(room, player)
            };
        }

        /* Nouvel arrivant */
        const midGame = this.stateOf(room) !== 'LOBBY';
        if (midGame && !this.canJoinMidGame(room)) {
            return { error: 'La partie a déjà commencé' };
        }
        if (this.maxPlayers > 0 && room.players.size >= this.maxPlayers) {
            return { error: `Salon complet (${this.maxPlayers} joueurs maximum)` };
        }

        const player = this.createPlayer(playerId, name, avatar, room);
        room.players.set(playerId, player);

        this.log(`Player ${name} joined room ${roomCode}${midGame ? ' (en cours)' : ''}`);
        return {
            success: true,
            room,
            player,
            reconnected: false,
            lateJoin: midGame,
            ...this.describeJoin(room, player)
        };
    }

    /**
     * Retire un joueur du salon (expulsion par l'hôte).
     * Contrairement à une déconnexion, l'éviction est définitive.
     */
    kickPlayer(roomCode, playerId) {
        const room = this.rooms.get(roomCode);
        if (!room) return { error: 'Salon introuvable' };
        if (!room.players.has(playerId)) return { error: 'Joueur introuvable' };

        const player = room.players.get(playerId);
        room.players.delete(playerId);
        this.touch(room);
        this.log(`Player ${player.name} kicked from room ${roomCode}`);
        return { success: true, player };
    }

    /**
     * Traite la perte d'une socket.
     *
     * En lobby, le joueur disparaît ; en partie, il est marqué absent pour
     * qu'il puisse revenir avec ses points. L'hôte, lui, n'est jamais retiré :
     * le contrôleur lui accorde une période de grâce.
     */
    removePlayer(playerId) {
        for (const [code, room] of this.rooms) {
            if (room.hostId === playerId) {
                room.hostDisconnected = true;
                return { roomCode: code, room, isHost: true };
            }

            if (room.players.has(playerId)) {
                const player = room.players.get(playerId);

                if (this.stateOf(room) === 'LOBBY') {
                    room.players.delete(playerId);
                    this.log(`Player ${player.name} left room ${code}`);
                    return { roomCode: code, room, isHost: false, type: 'left', player };
                }

                player.disconnected = true;
                this.log(`Player ${player.name} disconnected from room ${code}`);
                return { roomCode: code, room, isHost: false, type: 'disconnected', player };
            }
        }
        return null;
    }

    /* ── Utilitaires partagés ──────────────────────────────────────── */

    /** Mélange en place (Fisher-Yates). */
    shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }

    /** Minuscules, sans accents ni ponctuation — pour comparer des réponses. */
    normalizeText(text) {
        if (!text) return '';
        return String(text)
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]/g, '');
    }
}

module.exports = RoomBase;
module.exports.ALPHA6 = ALPHA6;
