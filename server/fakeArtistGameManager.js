/**
 * Fake Artist Game Manager
 * Gère l'état des salons de jeu "Fake Artist"
 */

const { getRandomWord } = require('./drawWords');

const PLAYER_COLORS = [
    { name: 'Rouge', value: '#e71d36' },
    { name: 'Bleu', value: '#0055ff' },
    { name: 'Vert', value: '#00d26a' },
    { name: 'Orange', value: '#ff9f1c' },
    { name: 'Jaune', value: '#ffd60a' },
    { name: 'Violet', value: '#9b59b6' },
    { name: 'Rose', value: '#f43f5e' },
    { name: 'Cyan', value: '#06b6d4' },
    { name: 'Marron', value: '#8b4513' },
    { name: 'Noir', value: '#1a1a1a' },
    { name: 'Gris', value: '#7f8c8d' },
    { name: 'Vert Forêt', value: '#27ae60' }
];

class FakeArtistGameManager {
    constructor() {
        this.rooms = new Map(); // Map<roomCode, FakeArtistRoom>
        // Nettoyage des salons inactifs (toutes les 10 min)
        setInterval(() => this.cleanupRooms(), 10 * 60 * 1000);
        console.log('[FAKE_ARTIST] Game manager initialized');
    }

    cleanupRooms() {
        const now = Date.now();
        const GAME_END_TTL = 30 * 60 * 1000; // 30 min après GAME_END
        const STALE_TTL = 90 * 60 * 1000;    // 1h30 d'inactivité totale
        for (const [code, room] of this.rooms) {
            if (room.gameState === 'GAME_END' && room.gameEndTime && (now - room.gameEndTime) > GAME_END_TTL) {
                this.rooms.delete(code);
                console.log(`[FAKE_ARTIST] Cleanup: room ${code} supprimée (GAME_END)`);
                continue;
            }
            const ref = room.lastActivity || 0;
            const activePlayers = Array.from(room.players.values()).filter(p => !p.disconnected);
            if (activePlayers.length === 0 && (now - ref) > STALE_TTL) {
                this.rooms.delete(code);
                console.log(`[FAKE_ARTIST] Cleanup: room ${code} supprimée (stale)`);
            }
        }
    }

    deleteRoom(roomCode) {
        this.rooms.delete(roomCode);
        console.log(`[FAKE_ARTIST] Room ${roomCode} deleted`);
    }

    generateRoomCode() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let code = '';
        for (let i = 0; i < 6; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return code;
    }

    createRoom(hostId, settings = {}) {
        const roomCode = this.generateRoomCode();
        const defaultSettings = {
            roundsCount: 2,         // Nombre de passages par joueur
            timePerRound: 30,       // Secondes par trait de dessin
            categories: ['all']     // Catégories
        };

        this.rooms.set(roomCode, {
            code: roomCode,
            hostId: hostId,
            players: new Map(),     // Map<socketId, PlayerData>
            gameState: 'LOBBY',     // LOBBY, PLAYING, VOTING, REVEAL, GUESSING, GAME_END
            currentRound: 0,
            totalRounds: 0,
            drawOrder: [],          // Ordre des IDs de joueurs
            drawQueue: [],          // File complète des tours restants
            currentDrawerId: null,
            currentDrawerIndex: 0,
            impostorId: null,       // ID de l'impostor
            currentWord: null,      // { word, category, hint }
            canvasHistory: [],      // Historique des tracés validés
            votes: {},              // Map<voterId, votedId>
            accusedId: null,        // Joueur qui a reçu le plus de votes
            impostorGuess: null,    // Proposition du mot secret par l'imposteur
            winner: null,           // 'artists' ou 'impostor'
            settings: { ...defaultSettings, ...settings },
            lastActivity: Date.now()
        });

        console.log(`[FAKE_ARTIST] Room created: ${roomCode}`);
        return roomCode;
    }

    getRoom(roomCode) {
        return this.rooms.get(roomCode);
    }

    getPlayersInRoom(roomCode) {
        const room = this.rooms.get(roomCode);
        if (!room) return [];
        return Array.from(room.players.values()).map(p => ({
            id: p.id,
            name: p.name,
            avatar: p.avatar,
            color: p.color,
            disconnected: p.disconnected,
            score: p.score,
            hasVoted: !!room.votes[p.id],
            hasConfirmedRole: p.hasConfirmedRole
        }));
    }

    assignColorToPlayer(room) {
        const usedColors = Array.from(room.players.values()).map(p => p.color?.value);
        for (const color of PLAYER_COLORS) {
            if (!usedColors.includes(color.value)) {
                return color;
            }
        }
        // Fallback si on a plus de 12 joueurs
        return PLAYER_COLORS[room.players.size % PLAYER_COLORS.length];
    }

    joinRoom(roomCode, playerId, playerName, avatar) {
        const room = this.rooms.get(roomCode);
        if (!room) return { error: 'Salon introuvable' };
        room.lastActivity = Date.now();

        // 1. Reconnexion (par nom d'utilisateur)
        let existingPlayerId = null;
        for (const [id, p] of room.players) {
            if (p.name.toLowerCase() === playerName.toLowerCase()) {
                existingPlayerId = id;
                break;
            }
        }

        if (existingPlayerId) {
            const playerData = room.players.get(existingPlayerId);
            room.players.delete(existingPlayerId);

            playerData.id = playerId;
            playerData.disconnected = false;
            if (avatar) playerData.avatar = avatar;

            room.players.set(playerId, playerData);

            // Mettre à jour l'ordre de passage si nécessaire
            const orderIndex = room.drawOrder.indexOf(existingPlayerId);
            if (orderIndex !== -1) {
                room.drawOrder[orderIndex] = playerId;
            }
            if (room.drawQueue) {
                room.drawQueue = room.drawQueue.map(id => id === existingPlayerId ? playerId : id);
            }
            if (room.currentDrawerId === existingPlayerId) {
                room.currentDrawerId = playerId;
            }
            if (room.impostorId === existingPlayerId) {
                room.impostorId = playerId;
            }
            // Transférer le vote
            if (room.votes[existingPlayerId]) {
                const voted = room.votes[existingPlayerId];
                delete room.votes[existingPlayerId];
                room.votes[playerId] = voted;
            }

            console.log(`[FAKE_ARTIST] Player ${playerName} reconnected to room ${roomCode}`);

            return {
                success: true,
                room,
                reconnected: true,
                gameState: room.gameState,
                color: playerData.color,
                role: room.impostorId === playerId ? 'impostor' : 'artist',
                currentDrawerId: room.currentDrawerId,
                currentRound: room.currentRound,
                totalRounds: room.totalRounds,
                canvasHistory: room.canvasHistory,
                myScore: playerData.score
            };
        }

        // 2. Nouveau joueur rejoint
        const isLateJoin = room.gameState !== 'LOBBY';
        if (isLateJoin) {
            return { error: 'La partie a déjà commencé' };
        }

        const color = this.assignColorToPlayer(room);
        room.players.set(playerId, {
            id: playerId,
            name: playerName,
            avatar: avatar || null,
            color: color,
            score: 0,
            disconnected: false,
            hasConfirmedRole: false
        });

        console.log(`[FAKE_ARTIST] Player ${playerName} joined room ${roomCode}`);
        return {
            success: true,
            room,
            reconnected: false,
            gameState: room.gameState
        };
    }

    async startGame(roomCode) {
        const room = this.rooms.get(roomCode);
        if (!room) return { error: 'Salon introuvable' };
        if (room.players.size < 3) return { error: 'Minimum 3 joueurs requis' };

        room.lastActivity = Date.now();
        
        // Choisir un mot secret et sa catégorie
        const wordData = await getRandomWord(room.settings.categories);
        if (!wordData) return { error: 'Aucun mot disponible' };
        room.currentWord = wordData;

        // Mélanger l'ordre de dessin
        const playerIds = Array.from(room.players.keys());
        room.drawOrder = this.shuffleArray([...playerIds]);

        // Assigner l'imposteur
        const randomIdx = Math.floor(Math.random() * playerIds.length);
        room.impostorId = playerIds[randomIdx];

        // Construire la drawQueue
        room.drawQueue = [];
        for (let r = 0; r < room.settings.roundsCount; r++) {
            room.drawQueue.push(...room.drawOrder);
        }
        
        room.gameState = 'PLAYING';
        room.currentRound = 1;
        room.totalRounds = room.settings.roundsCount;
        room.currentDrawerIndex = 0;
        room.currentDrawerId = room.drawQueue[0];
        room.canvasHistory = [];
        room.votes = {};
        room.accusedId = null;
        room.impostorGuess = null;
        room.winner = null;

        // Réinitialiser les confirmations des joueurs
        for (const p of room.players.values()) {
            p.hasConfirmedRole = false;
        }

        console.log(`[FAKE_ARTIST] Room ${roomCode} game started. Word: ${room.currentWord.word}, Impostor: ${room.players.get(room.impostorId).name}`);

        return {
            success: true,
            roomCode,
            drawOrder: room.drawOrder,
            currentDrawerId: room.currentDrawerId,
            currentRound: room.currentRound,
            totalRounds: room.totalRounds,
            category: room.currentWord.category
        };
    }

    confirmRole(roomCode, playerId) {
        const room = this.rooms.get(roomCode);
        if (!room) return false;
        const player = room.players.get(playerId);
        if (player) {
            player.hasConfirmedRole = true;
            return true;
        }
        return false;
    }

    validateStroke(roomCode, playerId, stroke) {
        const room = this.rooms.get(roomCode);
        if (!room) return { error: 'Salon introuvable' };
        if (room.gameState !== 'PLAYING') return { error: 'Pas en phase de dessin' };
        if (room.currentDrawerId !== playerId) return { error: 'Ce n\'est pas votre tour' };

        room.lastActivity = Date.now();

        // Enregistrer le tracé avec la couleur imposée du joueur
        const player = room.players.get(playerId);
        if (player) {
            stroke.color = player.color.value;
        }
        room.canvasHistory.push(stroke);

        // Passer au tour suivant
        room.currentDrawerIndex++;
        
        // Calcul du round courant
        const newRound = Math.floor(room.currentDrawerIndex / room.drawOrder.length) + 1;
        if (newRound <= room.totalRounds) {
            room.currentRound = newRound;
        }

        if (room.currentDrawerIndex >= room.drawQueue.length) {
            // Fin de la phase de dessin -> Transition vers les votes
            room.gameState = 'VOTING';
            room.currentDrawerId = null;
            console.log(`[FAKE_ARTIST] Room ${roomCode} transitioned to VOTING`);
            return {
                success: true,
                nextPhase: 'VOTING',
                canvasHistory: room.canvasHistory
            };
        } else {
            // Joueur suivant
            room.currentDrawerId = room.drawQueue[room.currentDrawerIndex];
            return {
                success: true,
                nextPhase: 'PLAYING',
                currentDrawerId: room.currentDrawerId,
                currentRound: room.currentRound,
                canvasHistory: room.canvasHistory
            };
        }
    }

    submitVote(roomCode, voterId, votedId) {
        const room = this.rooms.get(roomCode);
        if (!room) return { error: 'Salon introuvable' };
        if (room.gameState !== 'VOTING') return { error: 'Pas en phase de vote' };
        if (!room.players.has(voterId)) return { error: 'Joueur votant non trouvé' };
        if (!room.players.has(votedId)) return { error: 'Joueur voté non trouvé' };

        room.votes[voterId] = votedId;
        room.lastActivity = Date.now();

        const activePlayers = Array.from(room.players.values()).filter(p => !p.disconnected);
        const votesCount = Object.keys(room.votes).length;

        // Si tout le monde a voté
        if (votesCount >= activePlayers.length) {
            return this.resolveVotes(roomCode);
        }

        return {
            success: true,
            votingFinished: false,
            players: this.getPlayersInRoom(roomCode)
        };
    }

    resolveVotes(roomCode) {
        const room = this.rooms.get(roomCode);
        if (!room) return { error: 'Salon introuvable' };

        // Compter les votes
        const voteTallies = {}; // Map<votedId, count>
        for (const voterId in room.votes) {
            const votedId = room.votes[voterId];
            voteTallies[votedId] = (voteTallies[votedId] || 0) + 1;
        }

        // Trouver le plus voté
        let accusedId = null;
        let maxVotes = -1;
        let candidates = [];

        for (const votedId in voteTallies) {
            const count = voteTallies[votedId];
            if (count > maxVotes) {
                maxVotes = count;
                candidates = [votedId];
            } else if (count === maxVotes) {
                candidates.push(votedId);
            }
        }

        // En cas d'égalité, si l'imposteur est dans les candidats, on le désigne pour le fun
        if (candidates.includes(room.impostorId)) {
            accusedId = room.impostorId;
        } else {
            // Sinon on prend le premier
            accusedId = candidates[0] || Array.from(room.players.keys())[0];
        }

        room.accusedId = accusedId;

        // Vérifier si l'accuse est l'imposteur
        if (accusedId === room.impostorId) {
            // Démasqué ! L'imposteur doit deviner le mot
            room.gameState = 'GUESSING';
            console.log(`[FAKE_ARTIST] Room ${roomCode}: Impostor was accused. Moving to GUESSING.`);
            return {
                success: true,
                votingFinished: true,
                nextPhase: 'GUESSING',
                accusedName: room.players.get(accusedId).name,
                isImpostorAccused: true,
                voteTallies,
                impostorId: room.impostorId
            };
        } else {
            // Les artistes se sont trompés d'accusé ! L'imposteur gagne immédiatement !
            room.gameState = 'GAME_END';
            room.winner = 'impostor';
            room.gameEndTime = Date.now();
            
            // Donner des points à l'imposteur
            const impostor = room.players.get(room.impostorId);
            if (impostor) impostor.score += 200;

            console.log(`[FAKE_ARTIST] Room ${roomCode}: Artists failed to accuse impostor. Winner: impostor.`);
            return {
                success: true,
                votingFinished: true,
                nextPhase: 'GAME_END',
                accusedName: room.players.get(accusedId).name,
                isImpostorAccused: false,
                winner: 'impostor',
                impostorName: room.players.get(room.impostorId).name,
                secretWord: room.currentWord.word,
                voteTallies
            };
        }
    }

    submitImpostorGuess(roomCode, playerId, guess) {
        const room = this.rooms.get(roomCode);
        if (!room) return { error: 'Salon introuvable' };
        if (room.gameState !== 'GUESSING') return { error: 'Pas en phase de devinette' };
        if (room.impostorId !== playerId) return { error: 'Seul l\'imposteur peut deviner' };

        room.impostorGuess = guess;
        room.lastActivity = Date.now();

        // Comparaison simple en minuscules et sans accents/espaces
        const normGuess = this.normalizeText(guess);
        const normWord = this.normalizeText(room.currentWord.word);
        const autoCorrect = normGuess === normWord;

        console.log(`[FAKE_ARTIST] Room ${roomCode}: Impostor guessed '${guess}' (Secret: '${room.currentWord.word}'). AutoCorrect: ${autoCorrect}`);

        return {
            success: true,
            guess: guess,
            autoCorrect: autoCorrect,
            secretWord: room.currentWord.word
        };
    }

    resolveHostDecision(roomCode, isCorrect) {
        const room = this.rooms.get(roomCode);
        if (!room) return { error: 'Salon introuvable' };
        if (room.gameState !== 'GUESSING') return { error: 'Pas en phase de devinette' };

        room.gameState = 'GAME_END';
        room.gameEndTime = Date.now();
        room.lastActivity = Date.now();

        if (isCorrect) {
            room.winner = 'impostor';
            // Points imposteur
            const impostor = room.players.get(room.impostorId);
            if (impostor) impostor.score += 200;
        } else {
            room.winner = 'artists';
            // Points artistes
            for (const [id, player] of room.players) {
                if (id !== room.impostorId) {
                    player.score += 100;
                }
            }
        }

        console.log(`[FAKE_ARTIST] Room ${roomCode} resolved by host. Winner: ${room.winner}`);

        return {
            success: true,
            winner: room.winner,
            secretWord: room.currentWord.word,
            impostorName: room.players.get(room.impostorId).name,
            results: this.getPlayersInRoom(roomCode)
        };
    }

    restartGame(roomCode) {
        const room = this.rooms.get(roomCode);
        if (!room) return { error: 'Salon introuvable' };

        room.gameState = 'LOBBY';
        room.currentRound = 0;
        room.totalRounds = 0;
        room.drawOrder = [];
        room.drawQueue = [];
        room.currentDrawerId = null;
        room.currentDrawerIndex = 0;
        room.impostorId = null;
        room.currentWord = null;
        room.canvasHistory = [];
        room.votes = {};
        room.accusedId = null;
        room.impostorGuess = null;
        room.winner = null;

        // Conserver les scores et distribuer de nouvelles couleurs si nécessaire
        let idx = 0;
        for (const player of room.players.values()) {
            player.hasConfirmedRole = false;
            player.color = PLAYER_COLORS[idx % PLAYER_COLORS.length];
            idx++;
        }

        console.log(`[FAKE_ARTIST] Room ${roomCode} reset to LOBBY`);
        return {
            success: true,
            roomCode,
            players: this.getPlayersInRoom(roomCode)
        };
    }

    removePlayer(playerId) {
        for (const [code, room] of this.rooms) {
            if (room.hostId === playerId) {
                room.hostDisconnected = true;
                return { roomCode: code, room, isHost: true };
            }
            if (room.players.has(playerId)) {
                const player = room.players.get(playerId);
                if (room.gameState === 'LOBBY') {
                    room.players.delete(playerId);
                    // Redistribuer les couleurs
                    let idx = 0;
                    for (const p of room.players.values()) {
                        p.color = PLAYER_COLORS[idx % PLAYER_COLORS.length];
                        idx++;
                    }
                    return { roomCode: code, room, isHost: false, type: 'left' };
                }
                player.disconnected = true;
                return { roomCode: code, room, isHost: false, type: 'disconnected', player };
            }
        }
        return null;
    }

    // Utilitaires
    shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }

    normalizeText(text) {
        if (!text) return '';
        return text
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "") // Enlever accents
            .replace(/[^a-z0-9]/g, "");     // Garder seulement lettres/chiffres
    }
}

module.exports = new FakeArtistGameManager();
