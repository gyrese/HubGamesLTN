/**
 * Draw Up Game Manager
 * Gère les salons de jeu Pictionary avec dessin en temps réel
 */

const { getRandomWord, getCategories } = require('./drawWords');

const CANVAS_HISTORY_MAX = 500; // B8 — limite mémoire

class DrawGameManager {
    constructor() {
        this.rooms = new Map(); // Map<roomCode, DrawRoom>
        // B5 — nettoyage périodique des rooms mortes (toutes les 10 min)
        setInterval(() => this.cleanupRooms(), 10 * 60 * 1000);
        console.log('[DRAW] Draw Up game manager initialized');
    }

    cleanupRooms() {
        const now = Date.now();
        const GAME_END_TTL = 30 * 60 * 1000; // 30 min après GAME_END
        const STALE_TTL    = 90 * 60 * 1000; // 1h30 sans activité
        for (const [code, room] of this.rooms) {
            if (room.gameState === 'GAME_END' && room.gameEndTime && (now - room.gameEndTime) > GAME_END_TTL) {
                this.rooms.delete(code);
                console.log(`[DRAW] Cleanup: room ${code} supprimée (GAME_END)`);
                continue;
            }
            const ref = room.roundStartTime || 0;
            const activePlayers = Array.from(room.players.values()).filter(p => !p.disconnected);
            if (activePlayers.length === 0 && (now - ref) > STALE_TTL) {
                this.rooms.delete(code);
                console.log(`[DRAW] Cleanup: room ${code} supprimée (stale)`);
            }
        }
    }

    deleteRoom(roomCode) {
        this.rooms.delete(roomCode);
        console.log(`[DRAW] Room ${roomCode} deleted`);
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
            roundsPerPlayer: 2,    // Nombre de fois que chaque joueur dessine
            timePerRound: 90,      // Secondes par manche
            categories: ['all'],   // Catégories de mots
            pointsForGuessing: 100,// Points pour deviner
            pointsForDrawer: 50,   // Points bonus pour le dessinateur si quelqu'un trouve
        };

        this.rooms.set(roomCode, {
            code: roomCode,
            hostId: hostId,
            players: new Map(),    // Map<socketId, PlayerData>
            gameState: 'LOBBY',    // LOBBY, PLAYING, ROUND_END, GAME_END
            currentRound: 0,
            currentDrawerIndex: 0,
            currentDrawerId: null, // Stable drawer ID for the active round
            currentWord: null,     // { word, category, hint }
            drawOrder: [],         // Array of player IDs in draw order
            drawQueue: [],         // Pre-calculated queue of drawers for rounds
            totalRounds: 0,        // Will be calculated when game starts
            timePerRound: settings.timePerRound || defaultSettings.timePerRound,
            roundStartTime: null,
            canvasHistory: [],     // Store drawing strokes for new joiners
            guessedThisRound: new Set(), // Players who guessed correctly this round
            usedWords: new Set(),  // Anti-doublon des mots joués dans la partie
            drawerScoreThisRound: 0,
            settings: { ...defaultSettings, ...settings },
            remoteIds: []          // Remote control socket IDs
        });

        console.log(`[DRAW] Room created: ${roomCode}`);
        return roomCode;
    }

    getRoom(roomCode) {
        return this.rooms.get(roomCode);
    }

    joinRoom(roomCode, playerId, playerName, avatar) {
        const room = this.rooms.get(roomCode);
        if (!room) return { error: 'Salon introuvable' };

        // Check for reconnection (same name)
        let existingPlayerId = null;
        for (const [id, p] of room.players) {
            if (p.name.toLowerCase() === playerName.toLowerCase()) {
                existingPlayerId = id;
                break;
            }
        }

        if (existingPlayerId) {
            // RECONNECTION
            const playerData = room.players.get(existingPlayerId);
            room.players.delete(existingPlayerId);

            playerData.id = playerId;
            playerData.disconnected = false;
            if (avatar) playerData.avatar = avatar;

            room.players.set(playerId, playerData);

            // Update drawOrder and drawQueue if player was in it
            const drawOrderIndex = room.drawOrder.indexOf(existingPlayerId);
            if (drawOrderIndex !== -1) {
                room.drawOrder[drawOrderIndex] = playerId;
            }
            if (room.drawQueue) {
                room.drawQueue = room.drawQueue.map(id => id === existingPlayerId ? playerId : id);
            }

            console.log(`[DRAW] Player ${playerName} reconnected to room ${roomCode}`);

            return {
                success: true,
                room,
                reconnected: true,
                gameState: room.gameState,
                currentRound: room.currentRound,
                totalRounds: room.totalRounds,
                currentWord: room.currentWord,
                currentDrawerId: this.getCurrentDrawerId(roomCode),
                currentDrawerName: room.players.get(this.getCurrentDrawerId(roomCode))?.name || '',
                isDrawer: this.getCurrentDrawerId(roomCode) === playerId,
                roundStartTime: room.roundStartTime,
                timePerRound: room.timePerRound,
                canvasHistory: room.canvasHistory,
                myScore: playerData.score,
                hasGuessed: room.guessedThisRound.has(playerId)
            };
        }

        // NEW PLAYER
        const isLateJoin = room.gameState !== 'LOBBY';

        room.players.set(playerId, {
            id: playerId,
            name: playerName,
            avatar: avatar || null,
            score: 0,
            wordsGuessed: 0,
            timesDrawn: 0,
            correctGuesses: 0,
            disconnected: false
        });

        // Don't add late joiners to draw order mid-game
        if (!isLateJoin) {
            room.drawOrder.push(playerId);
        }

        console.log(`[DRAW] Player ${playerName} joined room ${roomCode}${isLateJoin ? ' (late join)' : ''}`);

        return {
            success: true,
            room,
            lateJoin: isLateJoin,
            gameState: room.gameState,
            currentRound: room.currentRound,
            totalRounds: room.totalRounds,
            currentWord: isLateJoin ? { category: room.currentWord?.category, wordLength: room.currentWord?.word.length } : null,
            currentDrawerId: this.getCurrentDrawerId(roomCode),
            currentDrawerName: room.players.get(this.getCurrentDrawerId(roomCode))?.name || '',
            roundStartTime: room.roundStartTime,
            timePerRound: room.timePerRound,
            canvasHistory: room.canvasHistory
        };
    }

    getCurrentDrawerId(roomCode) {
        const room = this.rooms.get(roomCode);
        if (!room) return null;
        return room.currentDrawerId || null;
    }

    async startGame(roomCode) {
        const room = this.rooms.get(roomCode);
        if (!room) return { error: 'Salon introuvable' };
        if (room.players.size < 2) return { error: 'Minimum 2 joueurs requis' };

        // Shuffle draw order
        room.drawOrder = this.shuffleArray([...room.players.keys()]);
        
        // Generate drawQueue by repeating drawOrder roundsPerPlayer times
        room.drawQueue = [];
        for (let i = 0; i < room.settings.roundsPerPlayer; i++) {
            room.drawQueue.push(...room.drawOrder);
        }
        room.totalRounds = room.drawQueue.length;

        room.gameState = 'PLAYING';
        room.currentRound = 1;
        room.currentDrawerIndex = 0;
        room.currentDrawerId = room.drawQueue[0];
        room.usedWords = new Set();
        room.drawerScoreThisRound = 0;

        // Get first word without duplication
        const wordData = await getRandomWord(room.settings.categories, Array.from(room.usedWords));
        room.currentWord = wordData;
        if (wordData) room.usedWords.add(wordData.word);
        room.roundStartTime = Date.now();
        room.canvasHistory = [];
        room.guessedThisRound = new Set();

        const drawerId = room.currentDrawerId;

        console.log(`[DRAW] Game started in room ${roomCode}. DrawerIndex: ${room.currentDrawerIndex}, DrawOrder: ${JSON.stringify(room.drawOrder)}, First drawer: ${room.players.get(drawerId)?.name}`);

        return {
            success: true,
            round: room.currentRound,
            totalRounds: room.totalRounds,
            drawerId: drawerId,
            drawerName: room.players.get(drawerId)?.name,
            word: room.currentWord,
            timePerRound: room.timePerRound,
            roundStartTime: room.roundStartTime
        };
    }

    // Submit a guess
    submitGuess(roomCode, playerId, guess) {
        const room = this.rooms.get(roomCode);
        if (!room) return { error: 'Salon introuvable' };
        if (room.gameState !== 'PLAYING') return { error: 'Partie non en cours' };

        const player = room.players.get(playerId);
        if (!player) return { error: 'Joueur introuvable' };

        // Can't guess if you're the drawer
        if (playerId === this.getCurrentDrawerId(roomCode)) {
            return { error: 'Le dessinateur ne peut pas deviner' };
        }

        // Already guessed correctly this round
        if (room.guessedThisRound.has(playerId)) {
            return { error: 'Déjà trouvé' };
        }

        const normalizedGuess = this.normalizeText(guess);
        const normalizedWord = this.normalizeText(room.currentWord.word);

        // Check for exact match
        if (normalizedGuess === normalizedWord) {
            return this.handleCorrectGuess(room, player, playerId);
        }

        // Check for close match (spelling mistake)
        const distance = this.levenshteinDistance(normalizedGuess, normalizedWord);
        const threshold = Math.max(1, Math.floor(normalizedWord.length * 0.25)); // 25% tolerance

        if (distance > 0 && distance <= threshold) {
            return {
                success: false,
                closeMatch: true,
                message: 'Très proche ! Vérifie l\'orthographe 🔥'
            };
        }

        return {
            success: false,
            closeMatch: false
        };
    }

    handleCorrectGuess(room, player, playerId) {
        room.guessedThisRound.add(playerId);

        // Calculate points based on time remaining
        const timeElapsed = (Date.now() - room.roundStartTime) / 1000;
        const timeRemaining = Math.max(0, room.timePerRound - timeElapsed);
        const timeRatio = timeRemaining / room.timePerRound;

        // Points: Base 100 + up to 100 bonus for speed
        const points = Math.round(room.settings.pointsForGuessing + (100 * timeRatio));
        player.score += points;
        player.wordsGuessed++;
        player.correctGuesses++;

        // Give points to the drawer (plafonné à 160 pts max par manche)
        const drawerId = this.getCurrentDrawerId(room.code);
        const drawer = room.players.get(drawerId);
        if (drawer) {
            if (room.drawerScoreThisRound === undefined) room.drawerScoreThisRound = 0;
            const drawerBonus = Math.round(room.settings.pointsForDrawer * (0.5 + 0.5 * timeRatio));
            if (room.drawerScoreThisRound < 160) {
                const addScore = Math.min(drawerBonus, 160 - room.drawerScoreThisRound);
                drawer.score += addScore;
                room.drawerScoreThisRound += addScore;
            }
        }

        const rank = room.guessedThisRound.size;

        console.log(`[DRAW] ${player.name} guessed correctly in room ${room.code} (rank ${rank})`);

        return {
            success: true,
            correct: true,
            points: points,
            rank: rank,
            totalGuessers: room.guessedThisRound.size,
            totalPlayers: room.players.size - 1 // Exclude drawer
        };
    }

    // Normalize text for comparison
    normalizeText(text) {
        return text
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '') // Remove accents
            .replace(/[^a-z0-9]/g, '') // Remove special chars
            .trim();
    }

    // Levenshtein distance for spelling detection
    levenshteinDistance(a, b) {
        const matrix = [];
        for (let i = 0; i <= b.length; i++) {
            matrix[i] = [i];
        }
        for (let j = 0; j <= a.length; j++) {
            matrix[0][j] = j;
        }
        for (let i = 1; i <= b.length; i++) {
            for (let j = 1; j <= a.length; j++) {
                if (b.charAt(i - 1) === a.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1,
                        matrix[i][j - 1] + 1,
                        matrix[i - 1][j] + 1
                    );
                }
            }
        }
        return matrix[b.length][a.length];
    }

    // Add drawing stroke to history — B8 limité à CANVAS_HISTORY_MAX
    addStroke(roomCode, stroke) {
        const room = this.rooms.get(roomCode);
        if (!room) return;
        if (room.canvasHistory.length >= CANVAS_HISTORY_MAX) {
            room.canvasHistory.shift(); // retire le plus vieux
        }
        room.canvasHistory.push(stroke);
    }

    // Clear canvas
    clearCanvas(roomCode) {
        const room = this.rooms.get(roomCode);
        if (!room) return;
        room.canvasHistory = [];
    }

    endRound(roomCode) {
        const room = this.rooms.get(roomCode);
        if (!room) return { error: 'Salon introuvable' };

        if (room.gameState === 'ROUND_END') {
            // Already ended, return current state
            return {
                success: true,
                alreadyEnded: true,
                word: room.currentWord,
                guessers: Array.from(room.guessedThisRound),
                currentRound: room.currentRound,
                totalRounds: room.totalRounds
            };
        }

        if (room.gameState !== 'PLAYING') {
            return { error: `Cannot end round: game is in ${room.gameState} state` };
        }

        room.gameState = 'ROUND_END';

        // Mark that drawer has drawn
        const drawerId = this.getCurrentDrawerId(roomCode);
        const drawer = room.players.get(drawerId);
        if (drawer) {
            drawer.timesDrawn++;
        }

        // Compile results
        const results = [];
        for (const player of room.players.values()) {
            results.push({
                id: player.id,
                name: player.name,
                avatar: player.avatar,
                score: player.score,
                guessedThisRound: room.guessedThisRound.has(player.id),
                wasDrawer: player.id === drawerId
            });
        }
        results.sort((a, b) => b.score - a.score);

        console.log(`[DRAW] Round ${room.currentRound} ended in room ${roomCode}. Word was: ${room.currentWord.word}`);

        return {
            success: true,
            word: room.currentWord,
            results: results,
            guessersCount: room.guessedThisRound.size,
            currentRound: room.currentRound,
            totalRounds: room.totalRounds
        };
    }

    async nextRound(roomCode) {
        const room = this.rooms.get(roomCode);
        if (!room) return { error: 'Salon introuvable' };

        room.currentRound++;

        // Check if game over
        if (room.currentRound > room.totalRounds) {
            room.gameState = 'GAME_END';

            const finalResults = [];
            for (const player of room.players.values()) {
                finalResults.push({
                    id: player.id,
                    name: player.name,
                    avatar: player.avatar,
                    score: player.score,
                    wordsGuessed: player.wordsGuessed,
                    timesDrawn: player.timesDrawn,
                    correctGuesses: player.correctGuesses
                });
            }
            finalResults.sort((a, b) => b.score - a.score);

            return {
                gameOver: true,
                results: finalResults,
                awards: this.calculateAwards(roomCode)
            };
        }

        // Prepare next round
        room.gameState = 'PLAYING';
        room.currentDrawerId = room.drawQueue[room.currentRound - 1];
        if (!room.usedWords) room.usedWords = new Set();
        room.drawerScoreThisRound = 0;

        const wordData = await getRandomWord(room.settings.categories, Array.from(room.usedWords));
        room.currentWord = wordData;
        if (wordData) room.usedWords.add(wordData.word);

        room.roundStartTime = Date.now();
        room.canvasHistory = [];
        room.guessedThisRound = new Set();

        const drawerId = room.currentDrawerId;

        console.log(`[DRAW] Round ${room.currentRound} started. DrawerIndex: ${room.currentRound - 1}, DrawOrder: ${JSON.stringify(room.drawOrder)}, Drawer: ${room.players.get(drawerId)?.name}`);

        return {
            success: true,
            round: room.currentRound,
            totalRounds: room.totalRounds,
            drawerId: drawerId,
            drawerName: room.players.get(drawerId)?.name,
            word: room.currentWord,
            timePerRound: room.timePerRound,
            roundStartTime: room.roundStartTime
        };
    }

    restartGame(roomCode) {
        const room = this.rooms.get(roomCode);
        if (!room) return { error: 'Salon introuvable' };

        room.gameState = 'LOBBY';
        room.currentRound = 0;
        room.currentDrawerIndex = 0;
        room.currentDrawerId = null;
        room.currentWord = null;
        room.canvasHistory = [];
        room.guessedThisRound = new Set();
        room.usedWords = new Set();
        room.drawerScoreThisRound = 0;
        room.drawOrder = [...room.players.keys()];
        room.drawQueue = [];

        for (const player of room.players.values()) {
            player.score = 0;
            player.wordsGuessed = 0;
            player.timesDrawn = 0;
            player.correctGuesses = 0;
            player.disconnected = false;
        }

        return { success: true };
    }

    kickPlayer(roomCode, playerId) {
        const room = this.rooms.get(roomCode);
        if (!room) return { error: 'Salon introuvable' };

        if (room.players.has(playerId)) {
            room.players.delete(playerId);
            room.drawOrder = room.drawOrder.filter(id => id !== playerId);
            if (room.drawQueue) {
                room.drawQueue = room.drawQueue.filter((id, idx) => id !== playerId || idx < room.currentRound - 1);
                room.totalRounds = room.drawQueue.length;
            }
            return { success: true };
        }
        return { error: 'Joueur introuvable' };
    }

    removePlayer(playerId) {
        for (const [code, room] of this.rooms) {
            if (room.hostId === playerId) {
                // On NE supprime pas la room tout de suite : le contrôleur applique une
                // période de grâce (90s) pendant laquelle l'hôte peut se reconnecter
                // (draw-host-reconnect). La suppression réelle est faite par le timer.
                room.hostDisconnected = true;
                return { roomCode: code, room, isHost: true };
            }

            if (room.players.has(playerId)) {
                if (room.gameState !== 'LOBBY') {
                    const player = room.players.get(playerId);
                    player.disconnected = true;

                    // If current drawer disconnects, we might need to skip
                    const isCurrentDrawer = this.getCurrentDrawerId(code) === playerId;

                    if (room.drawQueue) {
                        room.drawQueue = room.drawQueue.filter((id, idx) => id !== playerId || idx < room.currentRound - 1);
                        room.totalRounds = room.drawQueue.length;
                    }

                    return {
                        roomCode: code,
                        room,
                        isHost: false,
                        type: 'disconnected',
                        player,
                        wasDrawer: isCurrentDrawer
                    };
                }

                room.players.delete(playerId);
                room.drawOrder = room.drawOrder.filter(id => id !== playerId);
                if (room.drawQueue) {
                    room.drawQueue = room.drawQueue.filter(id => id !== playerId);
                    room.totalRounds = room.drawQueue.length;
                }
                return { roomCode: code, room, isHost: false, type: 'left' };
            }
        }
        return null;
    }

    getPlayersInRoom(roomCode) {
        const room = this.rooms.get(roomCode);
        if (!room) return [];
        return Array.from(room.players.values());
    }

    shuffleArray(array) {
        const arr = [...array];
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }

    calculateAwards(roomCode) {
        const room = this.rooms.get(roomCode);
        if (!room) return [];

        const players = Array.from(room.players.values());
        const awards = [];

        // Best guesser
        const bestGuesser = players.reduce((best, p) =>
            p.correctGuesses > (best?.correctGuesses || 0) ? p : best, null);
        if (bestGuesser) {
            awards.push({
                type: 'guesser',
                title: 'Sherlock',
                icon: '🔍',
                playerId: bestGuesser.id,
                playerName: bestGuesser.name,
                avatar: bestGuesser.avatar,
                value: `${bestGuesser.correctGuesses} mots trouvés`
            });
        }

        // Best artist (drawer whose rounds had most guesses - would need to track this)
        // For now, give to whoever has highest score relative to times drawn
        const artistScores = players.map(p => ({
            ...p,
            artistScore: p.timesDrawn > 0 ? p.score / p.timesDrawn : 0
        }));
        const bestArtist = artistScores.reduce((best, p) =>
            p.artistScore > (best?.artistScore || 0) ? p : best, null);
        if (bestArtist && bestArtist.timesDrawn > 0) {
            awards.push({
                type: 'artist',
                title: 'Picasso',
                icon: '🎨',
                playerId: bestArtist.id,
                playerName: bestArtist.name,
                avatar: bestArtist.avatar,
                value: `${Math.round(bestArtist.artistScore)} pts/dessin`
            });
        }

        return awards;
    }
}

module.exports = new DrawGameManager();
