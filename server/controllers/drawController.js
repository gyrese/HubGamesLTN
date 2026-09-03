const drawGameManager = require('../drawGameManager');

const HOST_GRACE_MS = 90_000; // 90s avant suppression de la room si hôte déconnecté
const drawHostDisconnectTimers = new Map();

// B9 — rate-limit strokes : max 60 strokes/s par socket
const strokeRateMap = new Map(); // socketId → { count, resetAt }
function isStrokeAllowed(socketId) {
    const now = Date.now();
    const entry = strokeRateMap.get(socketId);
    if (!entry || now > entry.resetAt) {
        strokeRateMap.set(socketId, { count: 1, resetAt: now + 1000 });
        return true;
    }
    if (entry.count >= 60) return false;
    entry.count++;
    return true;
}

// Rate-limit dédié aux fragments de trait en cours (relayés, jamais stockés).
// Le client émet ~16/s ; on laisse de la marge sans permettre un flood.
const liveStrokeRateMap = new Map(); // socketId → { count, resetAt }
function isLiveStrokeAllowed(socketId) {
    const now = Date.now();
    const entry = liveStrokeRateMap.get(socketId);
    if (!entry || now > entry.resetAt) {
        liveStrokeRateMap.set(socketId, { count: 1, resetAt: now + 1000 });
        return true;
    }
    if (entry.count >= 40) return false;
    entry.count++;
    return true;
}

const canControlDrawGame = (room, socketId) => {
    if (!room) return false;
    if (room.hostId === socketId) return true;
    if (room.remoteIds && room.remoteIds.includes(socketId)) return true;
    return false;
};

// B2 — timer serveur autoritaire : auto-endRound si le client ne le fait pas
function setupDrawRoundTimer(io, roomCode, room) {
    if (room.roundTimer) clearTimeout(room.roundTimer);
    const delay = (room.timePerRound + 5) * 1000; // +5s de marge
    room.roundTimer = setTimeout(() => {
        room.roundTimer = null;
        const current = drawGameManager.getRoom(roomCode);
        if (!current || current.gameState !== 'PLAYING') return;
        console.log(`[DRAW] Timer serveur: auto-end round ${current.currentRound} pour room ${roomCode}`);
        const result = drawGameManager.endRound(roomCode);
        if (result.success && !result.alreadyEnded) {
            io.to(`draw-${roomCode}`).emit('draw-round-ended', {
                word: result.word,
                results: result.results,
                guessersCount: result.guessersCount,
                currentRound: result.currentRound,
                totalRounds: result.totalRounds
            });
        }
    }, delay);
}

module.exports = {
    handleConnection: (io, socket) => {
        // ================================================
        // DRAW UP (PICTIONARY) EVENTS
        // ================================================

        socket.on('draw-create-room', ({ settings }, callback) => {
            const roomCode = drawGameManager.createRoom(socket.id, settings);
            socket.join(`draw-${roomCode}`);
            callback({ roomCode });
            console.log(`[DRAW] Room created: ${roomCode} by ${socket.id}`);
        });

        // Reconnexion de l'hôte (rechargement d'onglet / coupure réseau) — calque geo/color.
        socket.on('draw-host-reconnect', ({ roomCode }, callback) => {
            try {
                const room = drawGameManager.getRoom(roomCode);
                if (!room) {
                    callback({ error: 'Salon introuvable' });
                    return;
                }

                // Annuler le timer de grâce si l'hôte revient à temps
                if (drawHostDisconnectTimers.has(roomCode)) {
                    clearTimeout(drawHostDisconnectTimers.get(roomCode));
                    drawHostDisconnectTimers.delete(roomCode);
                    console.log(`[DRAW] Host reconnect: timer de grâce annulé pour ${roomCode}`);
                }

                room.hostId = socket.id;
                room.hostDisconnected = false;
                socket.join(`draw-${roomCode}`);
                console.log(`[DRAW] Host reconnected to room ${roomCode}`);

                const players = drawGameManager.getPlayersInRoom(roomCode);
                const drawer = players.find(p => p.id === room.currentDrawerId);

                callback({
                    success: true,
                    roomCode,
                    gameState: room.gameState,
                    currentRound: room.currentRound,
                    totalRounds: room.totalRounds,
                    timePerRound: room.timePerRound,
                    settings: room.settings,
                    players,
                    currentDrawerId: room.currentDrawerId,
                    drawerName: drawer ? drawer.name : '',
                    // L'hôte affiche le mot masqué (catégorie + longueur), jamais le mot complet.
                    wordCategory: room.currentWord ? room.currentWord.category : '',
                    wordLength: room.currentWord && room.currentWord.word ? room.currentWord.word.length : 0,
                    roundStartTime: room.roundStartTime,
                    canvasHistory: room.canvasHistory || []
                });

                // Prévenir les joueurs que l'hôte est de retour (si un overlay l'attendait)
                socket.to(`draw-${roomCode}`).emit('draw-host-reconnected');
            } catch (error) {
                console.error('[DRAW] Error in draw-host-reconnect:', error);
                callback({ error: 'Erreur serveur' });
            }
        });

        socket.on('draw-get-categories', async (_data, callback) => {
            try {
                const { getCategories } = require('../drawWords');
                const categories = await getCategories();
                callback({ categories });
            } catch (err) {
                callback({ categories: [] });
            }
        });

        socket.on('draw-join-room', ({ roomCode, playerName, avatar }, callback) => {
            try {
                const result = drawGameManager.joinRoom(roomCode, socket.id, playerName, avatar);
                if (result.error) {
                    callback({ error: result.error });
                } else {
                    socket.join(`draw-${roomCode}`);

                    if (result.reconnected) {
                        callback({
                            success: true,
                            reconnected: true,
                            gameState: result.gameState,
                            currentRound: result.currentRound,
                            currentWord: result.isDrawer ? result.currentWord : { category: result.currentWord?.category, wordLength: result.currentWord?.word?.length },
                            currentDrawerId: result.currentDrawerId,
                            isDrawer: result.isDrawer,
                            roundStartTime: result.roundStartTime,
                            timePerRound: result.timePerRound,
                            canvasHistory: result.canvasHistory,
                            myScore: result.myScore,
                            hasGuessed: result.hasGuessed
                        });
                        console.log(`[DRAW] ${playerName} reconnected to room ${roomCode}`);
                    } else if (result.lateJoin) {
                        callback({
                            success: true,
                            lateJoin: true,
                            gameState: result.gameState,
                            currentRound: result.currentRound,
                            currentWord: result.currentWord,
                            currentDrawerId: result.currentDrawerId,
                            roundStartTime: result.roundStartTime,
                            timePerRound: result.timePerRound,
                            canvasHistory: result.canvasHistory
                        });
                        console.log(`[DRAW] ${playerName} late joined room ${roomCode}`);
                    } else {
                        callback({ success: true });
                        console.log(`[DRAW] ${playerName} joined room ${roomCode}`);
                    }

                    io.to(`draw-${roomCode}`).emit('draw-player-joined', drawGameManager.getPlayersInRoom(roomCode));
                }
            } catch (error) {
                console.error("[DRAW] Error in join-room:", error);
                callback({ error: "Erreur serveur lors de la connexion." });
            }
        });

        // Remote control connection
        socket.on('draw-join-remote', ({ roomCode }, callback) => {
            try {
                const room = drawGameManager.getRoom(roomCode);
                if (!room) {
                    callback({ error: 'Salon introuvable' });
                    return;
                }

                if (!room.remoteIds) room.remoteIds = [];
                room.remoteIds.push(socket.id);

                socket.join(`draw-${roomCode}`);

                callback({
                    success: true,
                    gameState: room.gameState,
                    players: drawGameManager.getPlayersInRoom(roomCode),
                    currentRound: room.currentRound,
                    totalRounds: room.totalRounds,
                    timePerRound: room.timePerRound,
                    roundStartTime: room.roundStartTime,
                    currentDrawerId: drawGameManager.getCurrentDrawerId(roomCode)
                });

                console.log(`[DRAW] Remote control connected to room ${roomCode}`);
            } catch (error) {
                console.error("[DRAW] Error in join-remote:", error);
                callback({ error: "Erreur serveur lors de la connexion." });
            }
        });

        socket.on('draw-update-settings', ({ roomCode, settings }) => {
            const room = drawGameManager.getRoom(roomCode);
            if (!room || !canControlDrawGame(room, socket.id)) return;

            if (settings) {
                room.settings = { ...room.settings, ...settings };
                room.timePerRound = settings.timePerRound || room.timePerRound;
                console.log(`[DRAW] Settings updated for room ${roomCode}:`, settings);

                io.to(`draw-${roomCode}`).emit('draw-settings-updated', {
                    timePerRound: room.timePerRound,
                    categories: room.settings.categories,
                    roundsPerPlayer: room.settings.roundsPerPlayer
                });
            }
        });

        socket.on('draw-start-game', async ({ roomCode, settings }, callback) => {
            const room = drawGameManager.getRoom(roomCode);
            if (!room || !canControlDrawGame(room, socket.id)) {
                callback({ error: 'Room not found or not authorized' });
                return;
            }

            if (settings) {
                room.settings = { ...room.settings, ...settings };
                room.timePerRound = settings.timePerRound || room.timePerRound;
            }

            const result = await drawGameManager.startGame(roomCode);
            if (result.success) {
                callback({
                    success: true,
                    round: result.round,
                    totalRounds: result.totalRounds,
                    drawerId: result.drawerId,
                    word: result.word,
                    timePerRound: result.timePerRound,
                    roundStartTime: result.roundStartTime
                });

                // Notify all players (but hide word from guessers)
                io.to(`draw-${roomCode}`).emit('draw-game-started', {
                    round: result.round,
                    totalRounds: result.totalRounds,
                    drawerId: result.drawerId,
                    drawerName: result.drawerName,
                    wordCategory: result.word.category,
                    wordLength: result.word.word.length,
                    timePerRound: result.timePerRound,
                    roundStartTime: result.roundStartTime
                });

                // Send word only to drawer
                io.to(result.drawerId).emit('draw-your-word', {
                    word: result.word.word,
                    category: result.word.category,
                    hint: result.word.hint
                });

                // B2 — timer serveur autoritaire
                setupDrawRoundTimer(io, roomCode, drawGameManager.getRoom(roomCode));
                console.log(`[DRAW] Game started in room ${roomCode}`);
            } else {
                callback({ error: result.error });
            }
        });

        socket.on('draw-restart-game', ({ roomCode }, callback) => {
            const room = drawGameManager.getRoom(roomCode);
            if (!room || !canControlDrawGame(room, socket.id)) {
                callback({ error: 'Not authorized' });
                return;
            }

            const result = drawGameManager.restartGame(roomCode);
            if (result.success) {
                callback({ success: true });
                io.to(`draw-${roomCode}`).emit('draw-game-restarted');
            } else {
                callback({ error: result.error });
            }
        });

        socket.on('draw-kick-player', ({ roomCode, playerId }, callback) => {
            const room = drawGameManager.getRoom(roomCode);
            if (!room || room.hostId !== socket.id) {
                callback({ error: 'Unauthorized' });
                return;
            }

            const result = drawGameManager.kickPlayer(roomCode, playerId);
            if (result.success) {
                callback({ success: true });
                io.to(playerId).emit('draw-kicked');
                io.sockets.sockets.get(playerId)?.leave(`draw-${roomCode}`);
                io.to(`draw-${roomCode}`).emit('draw-player-left', drawGameManager.getPlayersInRoom(roomCode));
            } else {
                callback({ error: result.error });
            }
        });

        // Drawing events - real-time canvas sync
        socket.on('draw-stroke', ({ roomCode, stroke }) => {
            const room = drawGameManager.getRoom(roomCode);
            if (!room) return;
            if (drawGameManager.getCurrentDrawerId(roomCode) !== socket.id) return;
            // B9 — rate-limit : max 60 strokes/s par socket
            if (!isStrokeAllowed(socket.id)) return;
            drawGameManager.addStroke(roomCode, stroke);
            socket.to(`draw-${roomCode}`).emit('draw-stroke', stroke);
        });

        // Fragments du trait en cours : relayés tels quels pour un rendu temps réel
        // chez les autres joueurs / l'hôte. Non stockés dans canvasHistory : c'est
        // le 'draw-stroke' final (même id) qui fait foi.
        socket.on('draw-stroke-live', ({ roomCode, id, color, size, brush, points }) => {
            const room = drawGameManager.getRoom(roomCode);
            if (!room) return;
            if (drawGameManager.getCurrentDrawerId(roomCode) !== socket.id) return;
            if (!id || !Array.isArray(points) || points.length === 0) return;
            if (!isLiveStrokeAllowed(socket.id)) return;
            // `brush` doit suivre, sinon le trait s'affiche au crayon pendant le
            // tracé puis change d'aspect au moment de sa validation.
            socket.to(`draw-${roomCode}`).emit('draw-stroke-live', { id, color, size, brush, points });
        });

        socket.on('draw-clear', ({ roomCode }) => {
            const room = drawGameManager.getRoom(roomCode);
            if (!room) return;

            if (drawGameManager.getCurrentDrawerId(roomCode) !== socket.id) return;

            drawGameManager.clearCanvas(roomCode);
            socket.to(`draw-${roomCode}`).emit('draw-clear');
        });

        socket.on('draw-undo', ({ roomCode }) => {
            const room = drawGameManager.getRoom(roomCode);
            if (!room) return;
            if (drawGameManager.getCurrentDrawerId(roomCode) !== socket.id) return;
            if (room.canvasHistory.length > 0) {
                room.canvasHistory.pop();
                // socket.to : le dessinateur a déjà retiré le trait en local
                socket.to(`draw-${roomCode}`).emit('draw-undo-stroke');
            }
        });

        // Player guesses
        socket.on('draw-submit-guess', ({ roomCode, guess }, callback) => {
            const result = drawGameManager.submitGuess(roomCode, socket.id, guess);

            if (result.success && result.correct) {
                callback({
                    success: true,
                    correct: true,
                    points: result.points,
                    rank: result.rank
                });

                const player = drawGameManager.getRoom(roomCode)?.players.get(socket.id);

                // Notify everyone that someone guessed correctly
                // On rediffuse la liste des joueurs avec leurs scores à jour
                // (le devineur ET le dessinateur ont gagné des points) afin que
                // le classement live de l'hôte ne reste pas figé à 0.
                io.to(`draw-${roomCode}`).emit('draw-player-guessed', {
                    playerId: socket.id,
                    playerName: player?.name,
                    rank: result.rank,
                    points: result.points,
                    players: drawGameManager.getPlayersInRoom(roomCode)
                });

                // Check if all players have guessed
                if (result.totalGuessers >= result.totalPlayers) {
                    io.to(`draw-${roomCode}`).emit('draw-all-guessed');
                }
            } else if (result.closeMatch) {
                callback({
                    success: false,
                    closeMatch: true,
                    message: result.message
                });

                // Optionally notify host about close guess
                const player = drawGameManager.getRoom(roomCode)?.players.get(socket.id);
                io.to(`draw-${roomCode}`).emit('draw-close-guess', {
                    playerName: player?.name
                });
            } else {
                const player = drawGameManager.getRoom(roomCode)?.players.get(socket.id);
                io.to(`draw-${roomCode}`).emit('draw-incorrect-guess', {
                    playerName: player?.name,
                    guess: guess
                });
                callback(result);
            }
        });

        socket.on('draw-end-round', ({ roomCode }, callback) => {
            const room = drawGameManager.getRoom(roomCode);
            if (!room) {
                callback({ error: 'Room not found' });
                return;
            }
            if (!canControlDrawGame(room, socket.id)) {
                callback({ error: 'Not authorized' });
                return;
            }

            const result = drawGameManager.endRound(roomCode);
            if (result.success) {
                callback(result);

                io.to(`draw-${roomCode}`).emit('draw-round-ended', {
                    word: result.word,
                    results: result.results,
                    guessersCount: result.guessersCount,
                    currentRound: result.currentRound,
                    totalRounds: result.totalRounds
                });

                console.log(`[DRAW] Round ${result.currentRound} ended in room ${roomCode}`);
            } else {
                callback({ error: result.error });
            }
        });

        socket.on('draw-next-round', async ({ roomCode }, callback) => {
            const room = drawGameManager.getRoom(roomCode);
            if (!room) {
                callback({ error: 'Room not found' });
                return;
            }
            if (!canControlDrawGame(room, socket.id)) {
                callback({ error: 'Not authorized' });
                return;
            }

            const result = await drawGameManager.nextRound(roomCode);

            if (result.gameOver) {
                callback(result);
                io.to(`draw-${roomCode}`).emit('draw-game-over', {
                    results: result.results,
                    awards: result.awards
                });
                console.log(`[DRAW] Game over in room ${roomCode}`);
            } else if (result.success) {
                callback(result);

                // Notify all players (but hide word from guessers)
                io.to(`draw-${roomCode}`).emit('draw-next-round', {
                    round: result.round,
                    totalRounds: result.totalRounds,
                    drawerId: result.drawerId,
                    drawerName: result.drawerName,
                    wordCategory: result.word.category,
                    wordLength: result.word.word.length,
                    timePerRound: result.timePerRound,
                    roundStartTime: result.roundStartTime
                });

                // Send word only to drawer
                io.to(result.drawerId).emit('draw-your-word', {
                    word: result.word.word,
                    category: result.word.category,
                    hint: result.word.hint
                });

                // B2 — timer serveur pour le nouveau round
                setupDrawRoundTimer(io, roomCode, drawGameManager.getRoom(roomCode));
                console.log(`[DRAW] Round ${result.round} started in room ${roomCode}`);
            } else {
                callback({ error: result.error });
            }
        });

        // Skip word (drawer can't draw it)
        socket.on('draw-skip-word', async ({ roomCode }, callback) => {
            const result = await drawGameManager.skipWord(roomCode, socket.id);
            if (!result || result.error) {
                callback({ error: result?.error || 'Erreur lors du changement de mot' });
                return;
            }

            const newWord = result.word;
            const room = drawGameManager.getRoom(roomCode);
            const drawerName = room?.players.get(socket.id)?.name || '';

            callback({
                success: true,
                word: newWord ? newWord.word : '',
                category: newWord ? newWord.category : '',
                hint: newWord ? newWord.hint : '',
                myScore: result.drawerScore
            });

            // Notify others that canvas was cleared and word was skipped
            io.to(`draw-${roomCode}`).emit('draw-word-skipped', {
                wordCategory: newWord ? newWord.category : '',
                wordLength: newWord && newWord.word ? newWord.word.length : 0,
                players: result.players,
                drawerName: drawerName,
                penalty: 40
            });
            io.to(`draw-${roomCode}`).emit('draw-clear');

            console.log(`[DRAW] Word skipped in room ${roomCode} by ${drawerName} (-40 pts). New word: ${newWord ? newWord.word : ''}`);
        });

        socket.on('disconnect', () => {
            // Nettoyer le rate-limit tracker
            strokeRateMap.delete(socket.id);
            liveStrokeRateMap.delete(socket.id);

            const drawResult = drawGameManager.removePlayer(socket.id);
            if (!drawResult) return;

            if (drawResult.isHost) {
                // B5 — grace period : 90s avant suppression de la room
                const timer = setTimeout(() => {
                    drawHostDisconnectTimers.delete(drawResult.roomCode);
                    io.to(`draw-${drawResult.roomCode}`).emit('draw-host-disconnected');
                    drawGameManager.deleteRoom(drawResult.roomCode);
                    console.log(`[DRAW] Room ${drawResult.roomCode} supprimée après délai de grâce`);
                }, HOST_GRACE_MS);
                drawHostDisconnectTimers.set(drawResult.roomCode, timer);
                console.log(`[DRAW] Hôte déconnecté de ${drawResult.roomCode}, délai de grâce ${HOST_GRACE_MS / 1000}s`);
            } else {
                io.to(`draw-${drawResult.roomCode}`).emit('draw-player-left', drawGameManager.getPlayersInRoom(drawResult.roomCode));

                if (drawResult.wasDrawer && drawResult.room.gameState === 'PLAYING') {
                    const endResult = drawGameManager.endRound(drawResult.roomCode);
                    if (endResult.success) {
                        io.to(`draw-${drawResult.roomCode}`).emit('draw-round-ended', {
                            word: endResult.word,
                            results: endResult.results,
                            guessersCount: endResult.guessersCount,
                            currentRound: endResult.currentRound,
                            totalRounds: endResult.totalRounds,
                            drawerLeft: true
                        });
                        io.to(`draw-${drawResult.roomCode}`).emit('draw-drawer-left', {
                            word: endResult.word,
                            results: endResult.results
                        });
                    }
                }
            }
        });
    }
};
