class GameManager {
    constructor() {
        this.rooms = new Map(); // Map<roomCode, Room>
        // Nettoyage périodique des salons morts (toutes les 10 min)
        setInterval(() => this.cleanupRooms(), 10 * 60 * 1000);
    }

    cleanupRooms() {
        const now = Date.now();
        const ENDED_TTL = 30 * 60 * 1000; // 30 min après la fin
        const STALE_TTL = 2 * 60 * 60 * 1000; // 2 h sans activité
        for (const [code, room] of this.rooms) {
            const ref = room.lastActivity || 0;
            if ((room.gameState === 'END' || room.gameState === 'SERIES_END') && (now - ref) > ENDED_TTL) {
                this.deleteRoom(code);
                continue;
            }
            if ((now - ref) > STALE_TTL) {
                this.deleteRoom(code);
            }
        }
    }

    deleteRoom(roomCode) {
        if (this.rooms.delete(roomCode)) {
            console.log(`[QUIZ] Room ${roomCode} deleted`);
        }
    }

    createRoom(hostId) {
        const roomCode = this.generateRoomCode();
        this.rooms.set(roomCode, {
            code: roomCode,
            hostId: hostId,
            hostDisconnected: false, // true pendant la période de grâce hôte
            players: new Map(), // Map<socketId, {name, score, answers, avatar}>
            gameState: 'LOBBY', // LOBBY, QUESTION, SERIES_END, END
            currentQuestionIndex: 0,
            questions: [], // Array of questions
            questionStartTime: null, // Timestamp du début de la question
            questionEnded: false, // true quand la question courante affiche ses résultats (RESULT)
            maxPossibleScore: 0, // Score maximum cumulé de toutes les séries jouées
            lastActivity: Date.now(),
        });
        return roomCode;
    }

    joinRoom(roomCode, playerId, playerName, avatar) {
        const room = this.rooms.get(roomCode);
        if (!room) return { error: 'Room not found' };
        room.lastActivity = Date.now();

        // Reconnexion : un joueur du même pseudo existe déjà → on récupère sa place
        // (score, profil, réponse en cours). Fonctionne même si la partie a démarré.
        let existingId = null;
        for (const [id, p] of room.players) {
            if (p.name.toLowerCase() === playerName.toLowerCase()) { existingId = id; break; }
        }
        if (existingId) {
            const player = room.players.get(existingId);
            if (player.removalTimer) { clearTimeout(player.removalTimer); player.removalTimer = null; }
            room.players.delete(existingId);
            player.id = playerId;
            player.disconnected = false;
            if (avatar) player.avatar = avatar;
            room.players.set(playerId, player);

            const profileComplete = player.profile
                && Object.values(player.profile).every(v => v !== null && v !== '');

            return { success: true, room, reconnected: true, myScore: player.score, profileComplete };
        }

        // Nouvelle entrée : uniquement avant le démarrage.
        if (room.gameState !== 'LOBBY') return { error: 'La partie a déjà commencé' };

        room.players.set(playerId, {
            id: playerId,
            name: playerName,
            avatar: avatar || null,
            score: 0,
            lastAnswer: null,
            answerTime: null, // Temps de réponse en ms
            profile: {
                hairColor: null,
                profession: null,
                isSportive: null,
                isVegetarian: null,
                zodiacSign: null,
                favoriteDrink: null,
                favoriteAnimal: null,
                bedtime: null,
                coffeesPerDay: null
            }
        });
        return { success: true, room };
    }

    generateRoomCode() {
        return Math.floor(1000 + Math.random() * 9000).toString();
    }

    getRoom(roomCode) {
        return this.rooms.get(roomCode);
    }

    removePlayer(playerId) {
        for (const [code, room] of this.rooms) {
            if (room.hostId === playerId) {
                // On garde le salon : le contrôleur applique une période de grâce
                // pour permettre la reconnexion de l'hôte (quiz-host-reconnect).
                room.hostDisconnected = true;
                return { roomCode: code, room, isHost: true };
            }
            if (room.players.has(playerId)) {
                const player = room.players.get(playerId);
                if (room.gameState === 'LOBBY') {
                    room.players.delete(playerId);
                    return { roomCode: code, room, isHost: false, type: 'left' };
                }
                // En partie : on conserve le joueur (score) et on le marque déconnecté ;
                // il pourra se reconnecter par pseudo sans rien perdre.
                player.disconnected = true;
                return { roomCode: code, room, isHost: false, type: 'disconnected', player };
            }
        }
        return null;
    }
}

module.exports = new GameManager();
