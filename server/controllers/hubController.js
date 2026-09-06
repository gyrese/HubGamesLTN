/**
 * PASSEPORT — évènements socket de la soirée.
 *
 * Fait le lien entre `core/hubSession` (qui ne connaît aucun jeu) et les sept
 * gestionnaires de salon. Grâce au socle commun, tous exposent la même
 * signature `createRoom(hostId, settings)` : lancer un jeu depuis la soirée
 * tient en une ligne, quel que soit le jeu.
 */

const hub = require('../core/hubSession');

/** Les gestionnaires, chargés paresseusement pour éviter les cycles d'import. */
const MANAGERS = {
    quiz:       () => require('../gameManager'),
    geo:        () => require('../geoGameManager'),
    draw:       () => require('../drawGameManager'),
    color:      () => require('../colorGameManager'),
    fakeartist: () => require('../fakeArtistGameManager'),
    party:      () => require('../partyGameManager'),
    io:         () => require('../ioGameManager'),
    dance:      () => require('../danceGameManager')
};

const hubRoom = (code) => `hub-${code}`;

module.exports = {
    handleConnection: (io, socket) => {

        /** Garde : seul l'hôte de la soirée peut piloter. */
        const asHost = (hubCode) => {
            const session = hub.getSession(hubCode);
            if (!session || session.hostId !== socket.id) return null;
            return session;
        };

        /** Pousse l'état de la soirée à l'écran hôte. */
        const pushSession = (hubCode) => {
            const session = hub.getSession(hubCode);
            if (!session) return;
            io.to(session.hostId).emit('hub-session-updated', hub.describeSession(hubCode));
        };

        // ─── OUVERTURE D'UNE SOIRÉE (écran hôte) ───
        socket.on('hub-create-session', ({ name } = {}, callback) => {
            try {
                const code = hub.createSession(socket.id, name);
                socket.join(hubRoom(code));
                callback?.({
                    success: true,
                    hubCode: code,
                    games: hub.listGames(),
                    session: hub.describeSession(code)
                });
            } catch (err) {
                console.error('[HUB] Erreur hub-create-session:', err);
                callback?.({ error: 'Impossible d\'ouvrir la soirée' });
            }
        });

        // ─── RECONNEXION DE L'ÉCRAN HÔTE ───
        socket.on('hub-host-reconnect', ({ hubCode } = {}, callback) => {
            try {
                const session = hub.getSession(hubCode);
                if (!session) return callback?.({ error: 'Soirée introuvable' });

                session.hostId = socket.id;
                session.hostDisconnected = false;
                hub.touch(session);
                socket.join(hubRoom(hubCode));

                callback?.({
                    success: true,
                    hubCode,
                    games: hub.listGames(),
                    session: hub.describeSession(hubCode)
                });
            } catch (err) {
                console.error('[HUB] Erreur hub-host-reconnect:', err);
                callback?.({ error: 'Erreur serveur' });
            }
        });

        // ─── ENTRÉE D'UN TÉLÉPHONE ───
        socket.on('hub-join', ({ hubCode, deviceId, name, avatar } = {}, callback) => {
            try {
                const code = String(hubCode || '').toUpperCase();
                const res = hub.joinSession(code, {
                    deviceId,
                    socketId: socket.id,
                    name,
                    avatar
                });
                if (res.error) return callback?.({ error: res.error });

                socket.join(hubRoom(code));
                callback?.({
                    success: true,
                    returning: res.returning,
                    ...hub.describeForPlayer(code, deviceId)
                });

                pushSession(code);
            } catch (err) {
                console.error('[HUB] Erreur hub-join:', err);
                callback?.({ error: 'Impossible de rejoindre la soirée' });
            }
        });

        // ─── CONSULTATION SANS ENTRER (reprise d'onglet) ───
        socket.on('hub-peek', ({ hubCode, deviceId } = {}, callback) => {
            const code = String(hubCode || '').toUpperCase();
            const view = hub.describeForPlayer(code, deviceId);
            callback?.(view ? { success: true, ...view } : { error: 'Soirée introuvable' });
        });

        // ─── CHANGEMENT D'IDENTITÉ (pseudo, avatar) ───
        socket.on('hub-set-identity', ({ hubCode, deviceId, name, avatar } = {}, callback) => {
            try {
                const code = String(hubCode || '').toUpperCase();
                const res = hub.updateIdentity(code, deviceId, { name, avatar });
                if (res.error) return callback?.({ error: res.error });

                callback?.({ success: true, identity: { name: res.participant.name, avatar: res.participant.avatar } });
                pushSession(code);
            } catch (err) {
                console.error('[HUB] Erreur hub-set-identity:', err);
                callback?.({ error: 'Erreur serveur' });
            }
        });

        // ─── LANCEMENT D'UN JEU (le cœur du passeport) ───
        socket.on('hub-switch-game', ({ hubCode, gameKey, settings } = {}, callback) => {
            try {
                const session = asHost(hubCode);
                if (!session) return callback?.({ error: 'Non autorisé' });
                if (!hub.isKnownGame(gameKey)) return callback?.({ error: 'Jeu inconnu' });

                // Le salon appartient à l'écran hôte, comme s'il l'avait créé
                // depuis la page du jeu : rien ne change pour le contrôleur.
                const manager = MANAGERS[gameKey]();
                const roomCode = manager.createRoom(session.hostId, settings || {});

                const res = hub.switchGame(hubCode, gameKey, roomCode);
                if (res.error) return callback?.({ error: res.error });

                callback?.({
                    success: true,
                    gameKey,
                    roomCode,
                    label: res.label,
                    session: hub.describeSession(hubCode)
                });

                // Tous les téléphones de la soirée basculent d'eux-mêmes.
                io.to(hubRoom(hubCode)).emit('hub-game-switched', {
                    gameKey,
                    roomCode,
                    label: res.label,
                    path: res.path
                });

                pushSession(hubCode);
            } catch (err) {
                console.error('[HUB] Erreur hub-switch-game:', err);
                callback?.({ error: 'Impossible de lancer le jeu' });
            }
        });

        // ─── RETOUR AU SALON D'ATTENTE DE LA SOIRÉE ───
        socket.on('hub-return-lobby', ({ hubCode } = {}, callback) => {
            try {
                const session = asHost(hubCode);
                if (!session) return callback?.({ error: 'Non autorisé' });

                if (session.currentGame && session.currentRoomCode) {
                    session.history.push({
                        gameKey: session.currentGame,
                        roomCode: session.currentRoomCode,
                        endedAt: Date.now()
                    });
                }
                session.currentGame = null;
                session.currentRoomCode = null;
                hub.touch(session);

                callback?.({ success: true, session: hub.describeSession(hubCode) });
                io.to(hubRoom(hubCode)).emit('hub-returned-lobby', {
                    hubCode,
                    participantCount: session.participants.size
                });
                pushSession(hubCode);
            } catch (err) {
                console.error('[HUB] Erreur hub-return-lobby:', err);
                callback?.({ error: 'Erreur serveur' });
            }
        });

        // ─── EXPULSION D'UN PARTICIPANT ───
        socket.on('hub-kick', ({ hubCode, deviceId } = {}, callback) => {
            try {
                const session = asHost(hubCode);
                if (!session) return callback?.({ error: 'Non autorisé' });

                const res = hub.removeParticipant(hubCode, deviceId);
                if (res.error) return callback?.({ error: res.error });

                callback?.({ success: true });
                if (res.participant.socketId) {
                    io.to(res.participant.socketId).emit('hub-kicked');
                }
                pushSession(hubCode);
            } catch (err) {
                console.error('[HUB] Erreur hub-kick:', err);
                callback?.({ error: 'Erreur serveur' });
            }
        });

        // ─── FERMETURE DE LA SOIRÉE ───
        socket.on('hub-close-session', ({ hubCode } = {}, callback) => {
            try {
                const session = asHost(hubCode);
                if (!session) return callback?.({ error: 'Non autorisé' });

                io.to(hubRoom(hubCode)).emit('hub-session-closed');
                hub.closeSession(hubCode);
                callback?.({ success: true });
            } catch (err) {
                console.error('[HUB] Erreur hub-close-session:', err);
                callback?.({ error: 'Erreur serveur' });
            }
        });

        // ─── DÉCONNEXION ───
        socket.on('disconnect', () => {
            try {
                const res = hub.markDisconnected(socket.id);
                if (!res) return;

                if (res.isHost) {
                    // La soirée survit à la coupure : l'écran hôte se reconnecte
                    // avec `hub-host-reconnect`, et le nettoyage périodique se
                    // charge de celles qu'on a vraiment abandonnées.
                    io.to(hubRoom(res.session.code)).emit('hub-host-disconnected');
                    return;
                }

                io.to(res.session.hostId).emit('hub-session-updated', hub.describeSession(res.session.code));
            } catch (err) {
                console.error('[HUB] Erreur disconnect:', err);
            }
        });
    }
};
