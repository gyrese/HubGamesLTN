/**
 * PASSEPORT — sessions de soirée.
 *
 * Le problème : à chaque changement de jeu, l'hôte doit annoncer un nouveau
 * code, et vingt personnes ressortent leur téléphone pour ressaisir un pseudo
 * et rechoisir un avatar. C'est la friction n°1 en salle, et elle se paie
 * plusieurs fois par soirée.
 *
 * Le principe : une **soirée** est un contenant stable, au-dessus des salons de
 * jeu. Le joueur y entre une fois ; quand l'hôte lance un autre jeu, le serveur
 * pousse la redirection et le téléphone suit tout seul, identité conservée.
 *
 * Ce module ne connaît aucun jeu : il retient qui participe et quel salon est
 * actif. C'est `hubController` qui fait le lien avec les gestionnaires.
 *
 * Les participants sont indexés par `deviceId` — l'identité d'appareil que le
 * client garde en `localStorage` (`ltn-client-id`), stable à travers les
 * reconnexions et les changements de jeu, contrairement au `socket.id`.
 */

const ALPHA6 = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans I, O, 0, 1

// Une soirée sans aucune activité finit par disparaître.
const IDLE_TTL_MS = 6 * 60 * 60 * 1000;      // 6 h
const CLEANUP_INTERVAL_MS = 15 * 60 * 1000;  // quart d'heure

/** Jeux qu'une soirée peut lancer, et la route joueur correspondante. */
const GAMES = {
    quiz:       { label: 'Neural Quiz',      playerPath: '/quiz/play' },
    geo:        { label: 'GeoTrackr',        playerPath: '/geo/play' },
    draw:       { label: 'Draw Up',          playerPath: '/draw/play' },
    color:      { label: 'CouleurMoi',       playerPath: '/color/play' },
    fakeartist: { label: 'Fake Artist',      playerPath: '/fakeartist/play' },
    party:      { label: 'Super LTN Party',  playerPath: '/party/play' },
    io:         { label: 'Arène .IO',        playerPath: '/io/play' },
    dance:      { label: 'Dance Dance',      playerPath: '/dance/play' }
};

class HubSessionManager {
    constructor() {
        this.sessions = new Map();  // Map<hubCode, HubSession>
        this.timer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
        if (this.timer.unref) this.timer.unref();
        console.log('[HUB] Session manager initialized');
    }

    /* ── Codes ─────────────────────────────────────────────────────── */

    generateCode() {
        for (let attempt = 0; attempt < 300; attempt++) {
            let code = '';
            for (let i = 0; i < 6; i++) {
                code += ALPHA6.charAt(Math.floor(Math.random() * ALPHA6.length));
            }
            if (!this.sessions.has(code)) return code;
        }
        throw new Error('[HUB] Impossible de tirer un code de soirée libre');
    }

    /* ── Cycle de vie ──────────────────────────────────────────────── */

    /**
     * Ouvre une soirée.
     * @param {string} hostId   socket de l'écran hôte
     * @param {string} [name]   nom affiché de la soirée
     */
    createSession(hostId, name = '') {
        const code = this.generateCode();
        this.sessions.set(code, {
            code,
            name: String(name || '').trim().slice(0, 40),
            hostId,
            hostDisconnected: false,
            participants: new Map(), // Map<deviceId, Participant>
            currentGame: null,       // clé de GAMES
            currentRoomCode: null,   // salon du jeu en cours
            history: [],             // [{ gameKey, roomCode, startedAt }]
            createdAt: Date.now(),
            lastActivity: Date.now()
        });
        console.log(`[HUB] Soirée ouverte : ${code}`);
        return code;
    }

    getSession(code) {
        return this.sessions.get(code);
    }

    /** Retrouve la soirée qui pilote un salon de jeu donné. */
    findByRoomCode(roomCode) {
        for (const session of this.sessions.values()) {
            if (session.currentRoomCode === roomCode) return session;
        }
        return null;
    }

    /** Retrouve la soirée d'un hôte, par sa socket. */
    findByHost(hostId) {
        for (const session of this.sessions.values()) {
            if (session.hostId === hostId) return session;
        }
        return null;
    }

    touch(session) {
        if (session) session.lastActivity = Date.now();
    }

    closeSession(code) {
        if (this.sessions.delete(code)) {
            console.log(`[HUB] Soirée fermée : ${code}`);
            return true;
        }
        return false;
    }

    cleanup() {
        const now = Date.now();
        for (const [code, session] of this.sessions) {
            if ((now - session.lastActivity) > IDLE_TTL_MS) {
                this.sessions.delete(code);
                console.log(`[HUB] Soirée ${code} expirée`);
            }
        }
    }

    /* ── Participants ──────────────────────────────────────────────── */

    /**
     * Entrée d'un téléphone dans la soirée — ou retour du même appareil.
     *
     * L'identité est portée par `deviceId` : c'est ce qui permet au joueur de
     * traverser plusieurs jeux sans jamais ressaisir son pseudo.
     */
    joinSession(code, { deviceId, socketId, name, avatar }) {
        const session = this.sessions.get(code);
        if (!session) return { error: 'Soirée introuvable' };
        if (!deviceId) return { error: 'Appareil non identifié' };

        this.touch(session);

        const existing = session.participants.get(deviceId);
        if (existing) {
            // Retour d'un appareil connu : on ne réécrit que ce qui est fourni.
            existing.socketId = socketId;
            existing.connected = true;
            existing.lastSeen = Date.now();
            if (name) existing.name = this.cleanName(name);
            if (avatar) existing.avatar = avatar;

            return { success: true, session, participant: existing, returning: true };
        }

        const cleanName = this.cleanName(name);
        if (!cleanName) return { error: 'Pseudo invalide' };

        const participant = {
            deviceId,
            socketId,
            name: cleanName,
            avatar: avatar || null,
            connected: true,
            joinedAt: Date.now(),
            lastSeen: Date.now()
        };
        session.participants.set(deviceId, participant);
        console.log(`[HUB] ${cleanName} rejoint la soirée ${code}`);

        return { success: true, session, participant, returning: false };
    }

    cleanName(name) {
        return String(name || '').trim().slice(0, 14);
    }

    /** Met à jour l'identité choisie par un joueur (pseudo, avatar). */
    updateIdentity(code, deviceId, { name, avatar }) {
        const session = this.sessions.get(code);
        const participant = session?.participants.get(deviceId);
        if (!participant) return { error: 'Participant introuvable' };

        if (name) {
            const clean = this.cleanName(name);
            if (!clean) return { error: 'Pseudo invalide' };
            participant.name = clean;
        }
        if (avatar) participant.avatar = avatar;

        this.touch(session);
        return { success: true, participant };
    }

    /** Marque un appareil comme parti, sans oublier son identité. */
    markDisconnected(socketId) {
        for (const session of this.sessions.values()) {
            if (session.hostId === socketId) {
                session.hostDisconnected = true;
                return { session, isHost: true };
            }
            for (const participant of session.participants.values()) {
                if (participant.socketId === socketId) {
                    participant.connected = false;
                    participant.lastSeen = Date.now();
                    return { session, isHost: false, participant };
                }
            }
        }
        return null;
    }

    /** Retire définitivement un participant (expulsion par l'hôte). */
    removeParticipant(code, deviceId) {
        const session = this.sessions.get(code);
        if (!session) return { error: 'Soirée introuvable' };
        const participant = session.participants.get(deviceId);
        if (!participant) return { error: 'Participant introuvable' };

        session.participants.delete(deviceId);
        this.touch(session);
        return { success: true, participant };
    }

    /* ── Jeux ──────────────────────────────────────────────────────── */

    /** Un identifiant de jeu connu du hub ? */
    isKnownGame(gameKey) {
        return Object.prototype.hasOwnProperty.call(GAMES, gameKey);
    }

    /**
     * Bascule la soirée sur un nouveau jeu.
     * Le salon est créé par le contrôleur, qui connaît les gestionnaires ;
     * ici on ne fait qu'enregistrer la destination.
     */
    switchGame(code, gameKey, roomCode) {
        const session = this.sessions.get(code);
        if (!session) return { error: 'Soirée introuvable' };
        if (!this.isKnownGame(gameKey)) return { error: 'Jeu inconnu' };

        // La partie précédente entre dans l'historique de la soirée
        if (session.currentGame && session.currentRoomCode) {
            session.history.push({
                gameKey: session.currentGame,
                roomCode: session.currentRoomCode,
                endedAt: Date.now()
            });
        }

        session.currentGame = gameKey;
        session.currentRoomCode = roomCode;
        this.touch(session);

        console.log(`[HUB] Soirée ${code} → ${GAMES[gameKey].label} (${roomCode})`);
        return {
            success: true,
            session,
            gameKey,
            roomCode,
            ...this.describeDestination(gameKey, roomCode)
        };
    }

    /** Où le téléphone doit-il aller pour ce jeu ? */
    describeDestination(gameKey, roomCode) {
        const game = GAMES[gameKey];
        if (!game) return null;
        return {
            label: game.label,
            path: `${game.playerPath}/${roomCode}`
        };
    }

    /* ── Vues ──────────────────────────────────────────────────────── */

    /** Vue publique de la soirée, pour l'écran hôte. */
    describeSession(code) {
        const session = this.sessions.get(code);
        if (!session) return null;

        return {
            code: session.code,
            name: session.name,
            currentGame: session.currentGame,
            currentRoomCode: session.currentRoomCode,
            gameLabel: session.currentGame ? GAMES[session.currentGame].label : null,
            participants: this.describeParticipants(code),
            gamesPlayed: session.history.length,
            createdAt: session.createdAt
        };
    }

    describeParticipants(code) {
        const session = this.sessions.get(code);
        if (!session) return [];
        return Array.from(session.participants.values()).map(p => ({
            deviceId: p.deviceId,
            name: p.name,
            avatar: p.avatar,
            connected: p.connected
        }));
    }

    /** Ce qu'un téléphone doit savoir en entrant ou en revenant. */
    describeForPlayer(code, deviceId) {
        const session = this.sessions.get(code);
        if (!session) return null;
        const participant = session.participants.get(deviceId);

        return {
            code: session.code,
            name: session.name,
            identity: participant
                ? { name: participant.name, avatar: participant.avatar }
                : null,
            currentGame: session.currentGame,
            destination: session.currentGame
                ? this.describeDestination(session.currentGame, session.currentRoomCode)
                : null,
            participantCount: session.participants.size
        };
    }

    /** Catalogue des jeux lançables depuis une soirée. */
    listGames() {
        return Object.entries(GAMES).map(([key, g]) => ({ key, label: g.label }));
    }
}

module.exports = new HubSessionManager();
module.exports.GAMES = GAMES;
