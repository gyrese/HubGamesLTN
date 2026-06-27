const fakeArtistGameManager = require('../fakeArtistGameManager');

const HOST_GRACE_MS = 90_000; // 90s de grâce si l'hôte se déconnecte
const hostDisconnectTimers = new Map(); // roomCode → Timeout

function setupTurnTimer(io, roomCode, room) {
    if (room.turnTimer) clearTimeout(room.turnTimer);
    
    const delay = (room.settings.timePerRound + 5) * 1000; // +5s de marge
    room.turnTimer = setTimeout(() => {
        room.turnTimer = null;
        const currentRoom = fakeArtistGameManager.getRoom(roomCode);
        if (!currentRoom || currentRoom.gameState !== 'PLAYING') return;

        console.log(`[FAKE_ARTIST] Timer serveur: fin de tour automatique pour ${currentRoom.currentDrawerId} dans le salon ${roomCode}`);
        
        // Simuler un trait vide / abandon de tour
        const emptyStroke = { color: '#000000', size: 0, points: [] };
        const result = fakeArtistGameManager.validateStroke(roomCode, currentRoom.currentDrawerId, emptyStroke);
        
        if (result.success) {
            if (result.nextPhase === 'VOTING') {
                io.to(`fakeartist-${roomCode}`).emit('fakeartist-game-state-updated', {
                    gameState: 'VOTING',
                    players: fakeArtistGameManager.getPlayersInRoom(roomCode),
                    canvasHistory: currentRoom.canvasHistory
                });
            } else {
                currentRoom.turnStartTime = Date.now();
                io.to(`fakeartist-${roomCode}`).emit('fakeartist-turn-updated', {
                    currentDrawerId: currentRoom.currentDrawerId,
                    currentRound: currentRoom.currentRound,
                    canvasHistory: currentRoom.canvasHistory,
                    turnStartTime: currentRoom.turnStartTime
                });
                setupTurnTimer(io, roomCode, currentRoom);
            }
        }
    }, delay);
}

module.exports = {
    handleConnection: (io, socket) => {
        // ─── CRÉATION SALON ───
        socket.on('fakeartist-create-room', ({ settings }, callback) => {
            try {
                const roomCode = fakeArtistGameManager.createRoom(socket.id, settings);
                socket.join(`fakeartist-${roomCode}`);
                callback({ roomCode });
                console.log(`[FAKE_ARTIST] Room ${roomCode} created by host ${socket.id}`);
            } catch (err) {
                console.error('[FAKE_ARTIST] Error in create-room:', err);
                callback({ error: 'Erreur lors de la création du salon' });
            }
        });

        // ─── RECONNEXION HÔTE ───
        socket.on('fakeartist-host-reconnect', ({ roomCode }, callback) => {
            try {
                const room = fakeArtistGameManager.getRoom(roomCode);
                if (!room) {
                    callback({ error: 'Salon introuvable' });
                    return;
                }

                if (hostDisconnectTimers.has(roomCode)) {
                    clearTimeout(hostDisconnectTimers.get(roomCode));
                    hostDisconnectTimers.delete(roomCode);
                    console.log(`[FAKE_ARTIST] Host reconnect: timer annulé pour ${roomCode}`);
                }

                room.hostId = socket.id;
                socket.join(`fakeartist-${roomCode}`);
                console.log(`[FAKE_ARTIST] Host reconnected to room ${roomCode}`);

                callback({
                    success: true,
                    roomCode,
                    gameState: room.gameState,
                    currentRound: room.currentRound,
                    totalRounds: room.totalRounds,
                    settings: room.settings,
                    players: fakeArtistGameManager.getPlayersInRoom(roomCode),
                    currentDrawerId: room.currentDrawerId,
                    canvasHistory: room.canvasHistory || [],
                    category: room.currentWord ? room.currentWord.category : '',
                    accusedId: room.accusedId,
                    accusedName: room.accusedId ? room.players.get(room.accusedId)?.name : '',
                    impostorGuess: room.impostorGuess,
                    secretWord: room.gameState === 'GAME_END' || room.gameState === 'REVEAL' || room.gameState === 'GUESSING' ? room.currentWord?.word : null,
                    winner: room.winner
                });

                socket.to(`fakeartist-${roomCode}`).emit('fakeartist-host-reconnected');
            } catch (err) {
                console.error('[FAKE_ARTIST] Error in host-reconnect:', err);
                callback({ error: 'Erreur serveur' });
            }
        });

        // ─── REJOINTE DU SALON (JOUEUR) ───
        socket.on('fakeartist-join-room', ({ roomCode, playerName, avatar }, callback) => {
            try {
                const res = fakeArtistGameManager.joinRoom(roomCode, socket.id, playerName, avatar);
                if (res.error) {
                    callback({ error: res.error });
                    return;
                }

                socket.join(`fakeartist-${roomCode}`);

                if (res.reconnected) {
                    callback({
                        success: true,
                        reconnected: true,
                        gameState: res.gameState,
                        color: res.color,
                        role: res.role,
                        secretWord: res.role === 'artist' ? res.room.currentWord?.word : '?',
                        category: res.room.currentWord?.category,
                        currentDrawerId: res.currentDrawerId,
                        currentRound: res.currentRound,
                        totalRounds: res.totalRounds,
                        canvasHistory: res.canvasHistory,
                        myScore: res.myScore,
                        isDrawer: res.currentDrawerId === socket.id,
                        accusedName: res.room.accusedId ? res.room.players.get(res.room.accusedId)?.name : ''
                    });
                    console.log(`[FAKE_ARTIST] Player ${playerName} reconnected to ${roomCode}`);
                } else {
                    callback({
                        success: true,
                        reconnected: false,
                        gameState: res.gameState
                    });
                    console.log(`[FAKE_ARTIST] Player ${playerName} joined room ${roomCode}`);
                }

                // Notifier tout le monde de l'arrivée du joueur
                io.to(`fakeartist-${roomCode}`).emit('fakeartist-players-updated', fakeArtistGameManager.getPlayersInRoom(roomCode));
            } catch (err) {
                console.error('[FAKE_ARTIST] Error in join-room:', err);
                callback({ error: 'Erreur lors de la rejointe' });
            }
        });

        // ─── LANCEMENT DE LA PARTIE ───
        socket.on('fakeartist-start-game', ({ roomCode }) => {
            try {
                const room = fakeArtistGameManager.getRoom(roomCode);
                if (!room || room.hostId !== socket.id) return;

                fakeArtistGameManager.startGame(roomCode).then((res) => {
                    if (res.error) {
                        socket.emit('fakeartist-error', { message: res.error });
                        return;
                    }

                    // Envoyer le rôle et le mot à chaque joueur secrètement
                    for (const [playerId, player] of room.players) {
                        const role = playerId === room.impostorId ? 'impostor' : 'artist';
                        const secretWord = role === 'artist' ? room.currentWord.word : '?';
                        
                        io.to(playerId).emit('fakeartist-role-assigned', {
                            role,
                            secretWord,
                            category: room.currentWord.category,
                            color: player.color
                        });
                    }

                    room.turnStartTime = Date.now();

                    // Notifier l'hôte que la partie démarre
                    io.to(room.hostId).emit('fakeartist-game-started', {
                        drawOrder: room.drawOrder.map(id => room.players.get(id)?.name || 'Inconnu'),
                        currentDrawerId: room.currentDrawerId,
                        currentRound: room.currentRound,
                        totalRounds: room.totalRounds,
                        category: room.currentWord.category,
                        turnStartTime: room.turnStartTime,
                        timePerRound: room.settings.timePerRound
                    });

                    // Notifier tout le monde du changement d'état global
                    io.to(`fakeartist-${roomCode}`).emit('fakeartist-game-state-updated', {
                        gameState: 'PLAYING',
                        currentDrawerId: room.currentDrawerId,
                        currentRound: room.currentRound,
                        totalRounds: room.totalRounds,
                        players: fakeArtistGameManager.getPlayersInRoom(roomCode)
                    });

                    setupTurnTimer(io, roomCode, room);
                });
            } catch (err) {
                console.error('[FAKE_ARTIST] Error in start-game:', err);
            }
        });

        // ─── CONFIRMATION DE RÔLE PAR LE JOUEUR ───
        socket.on('fakeartist-confirm-role', ({ roomCode }, callback) => {
            const success = fakeArtistGameManager.confirmRole(roomCode, socket.id);
            if (success) {
                callback({ success: true });
                io.to(`fakeartist-${roomCode}`).emit('fakeartist-players-updated', fakeArtistGameManager.getPlayersInRoom(roomCode));
            } else {
                callback({ error: 'Action impossible' });
            }
        });

        // ─── VALIDATION DU TRAIT DE DESSIN ───
        socket.on('fakeartist-validate-stroke', ({ roomCode, stroke }) => {
            try {
                const room = fakeArtistGameManager.getRoom(roomCode);
                if (!room || room.gameState !== 'PLAYING') return;

                if (room.turnTimer) clearTimeout(room.turnTimer);

                const result = fakeArtistGameManager.validateStroke(roomCode, socket.id, stroke);

                if (result.success) {
                    if (result.nextPhase === 'VOTING') {
                        io.to(`fakeartist-${roomCode}`).emit('fakeartist-game-state-updated', {
                            gameState: 'VOTING',
                            players: fakeArtistGameManager.getPlayersInRoom(roomCode),
                            canvasHistory: room.canvasHistory
                        });
                    } else {
                        room.turnStartTime = Date.now();
                        io.to(`fakeartist-${roomCode}`).emit('fakeartist-turn-updated', {
                            currentDrawerId: room.currentDrawerId,
                            currentRound: room.currentRound,
                            canvasHistory: room.canvasHistory,
                            turnStartTime: room.turnStartTime
                        });
                        setupTurnTimer(io, roomCode, room);
                    }
                }
            } catch (err) {
                console.error('[FAKE_ARTIST] Error in validate-stroke:', err);
            }
        });

        // ─── PHASE DE VOTE : SOUMISSION D'UN VOTE ───
        socket.on('fakeartist-submit-vote', ({ roomCode, votedId }, callback) => {
            try {
                const result = fakeArtistGameManager.submitVote(roomCode, socket.id, votedId);
                if (result.error) {
                    callback({ error: result.error });
                    return;
                }

                callback({ success: true });

                // Notifier les joueurs de la mise à jour (qui a voté)
                io.to(`fakeartist-${roomCode}`).emit('fakeartist-players-updated', fakeArtistGameManager.getPlayersInRoom(roomCode));

                if (result.votingFinished) {
                    if (result.nextPhase === 'GUESSING') {
                        io.to(`fakeartist-${roomCode}`).emit('fakeartist-game-state-updated', {
                            gameState: 'GUESSING',
                            accusedId: result.impostorId,
                            accusedName: result.accusedName,
                            isImpostorAccused: true,
                            voteTallies: result.voteTallies
                        });
                    } else {
                        io.to(`fakeartist-${roomCode}`).emit('fakeartist-game-state-updated', {
                            gameState: 'GAME_END',
                            accusedName: result.accusedName,
                            isImpostorAccused: false,
                            winner: result.winner,
                            impostorName: result.impostorName,
                            secretWord: result.secretWord,
                            voteTallies: result.voteTallies,
                            players: fakeArtistGameManager.getPlayersInRoom(roomCode)
                        });
                    }
                }
            } catch (err) {
                console.error('[FAKE_ARTIST] Error in submit-vote:', err);
            }
        });

        // ─── DEVINETTE DE L'IMPOSTEUR ───
        socket.on('fakeartist-submit-guess', ({ roomCode, guess }, callback) => {
            try {
                const room = fakeArtistGameManager.getRoom(roomCode);
                if (!room || room.gameState !== 'GUESSING') return;

                const result = fakeArtistGameManager.submitImpostorGuess(roomCode, socket.id, guess);
                if (result.error) {
                    callback({ error: result.error });
                    return;
                }

                callback({ success: true });

                // Envoyer la proposition à l'hôte pour validation manuelle
                io.to(room.hostId).emit('fakeartist-guess-received', {
                    guess: result.guess,
                    secretWord: result.secretWord,
                    autoCorrect: result.autoCorrect
                });
            } catch (err) {
                console.error('[FAKE_ARTIST] Error in submit-guess:', err);
            }
        });

        // ─── DÉCISION DE L'HÔTE (GUESS CORRECT / INCORRECT) ───
        socket.on('fakeartist-host-decision', ({ roomCode, isCorrect }) => {
            try {
                const room = fakeArtistGameManager.getRoom(roomCode);
                if (!room || room.hostId !== socket.id) return;

                const result = fakeArtistGameManager.resolveHostDecision(roomCode, isCorrect);
                if (result.success) {
                    io.to(`fakeartist-${roomCode}`).emit('fakeartist-game-state-updated', {
                        gameState: 'GAME_END',
                        winner: result.winner,
                        secretWord: result.secretWord,
                        impostorName: result.impostorName,
                        players: fakeArtistGameManager.getPlayersInRoom(roomCode)
                    });
                }
            } catch (err) {
                console.error('[FAKE_ARTIST] Error in host-decision:', err);
            }
        });

        // ─── REJOUER (RETOUR LOBBY) ───
        socket.on('fakeartist-restart-game', ({ roomCode }) => {
            try {
                const room = fakeArtistGameManager.getRoom(roomCode);
                if (!room || room.hostId !== socket.id) return;

                const result = fakeArtistGameManager.restartGame(roomCode);
                if (result.success) {
                    io.to(`fakeartist-${roomCode}`).emit('fakeartist-game-state-updated', {
                        gameState: 'LOBBY',
                        players: result.players,
                        canvasHistory: []
                    });
                }
            } catch (err) {
                console.error('[FAKE_ARTIST] Error in restart-game:', err);
            }
        });

        // ─── ENVOI D'UN TRAIT TEMPORAIRE EN DIRECT (optionnel mais génial si l'hôte affiche le dessin en cours de tracé) ───
        socket.on('fakeartist-draw-stroke-live', ({ roomCode, stroke }) => {
            try {
                const room = fakeArtistGameManager.getRoom(roomCode);
                if (!room || room.gameState !== 'PLAYING') return;
                if (room.currentDrawerId !== socket.id) return;

                // Transmettre le trait en cours de dessin uniquement à l'hôte
                socket.to(room.hostId).emit('fakeartist-stroke-live', stroke);
            } catch (err) {
                console.error('[FAKE_ARTIST] Error in draw-stroke-live:', err);
            }
        });

        // ─── EFFACEMENT DU TRAIT EN COURS (DÉBRAYABLE PAR DESSINATEUR) ───
        socket.on('fakeartist-clear-stroke-live', ({ roomCode }) => {
            try {
                const room = fakeArtistGameManager.getRoom(roomCode);
                if (!room || room.gameState !== 'PLAYING') return;
                if (room.currentDrawerId !== socket.id) return;

                socket.to(room.hostId).emit('fakeartist-clear-live');
            } catch (err) {
                console.error('[FAKE_ARTIST] Error in clear-stroke-live:', err);
            }
        });

        // ─── DÉCONNEXION ───
        socket.on('disconnect', () => {
            try {
                const result = fakeArtistGameManager.removePlayer(socket.id);
                if (!result) return;

                const { roomCode, room, isHost } = result;

                if (isHost) {
                    console.log(`[FAKE_ARTIST] Host disconnected from ${roomCode}. Starting grace period timer.`);
                    
                    if (hostDisconnectTimers.has(roomCode)) clearTimeout(hostDisconnectTimers.get(roomCode));

                    // Mettre en place un délai de grâce pour l'hôte
                    hostDisconnectTimers.set(roomCode, setTimeout(() => {
                        console.log(`[FAKE_ARTIST] Grace period expired. Deleting room ${roomCode}`);
                        if (room.turnTimer) clearTimeout(room.turnTimer);
                        fakeArtistGameManager.deleteRoom(roomCode);
                        io.to(`fakeartist-${roomCode}`).emit('fakeartist-room-deleted');
                        hostDisconnectTimers.delete(roomCode);
                    }, HOST_GRACE_MS));

                    io.to(`fakeartist-${roomCode}`).emit('fakeartist-host-disconnected');
                } else {
                    console.log(`[FAKE_ARTIST] Player disconnected from room ${roomCode}`);
                    
                    if (result.type === 'left') {
                        io.to(`fakeartist-${roomCode}`).emit('fakeartist-players-updated', fakeArtistGameManager.getPlayersInRoom(roomCode));
                    } else {
                        // En partie, le joueur est marqué déconnecté
                        io.to(`fakeartist-${roomCode}`).emit('fakeartist-players-updated', fakeArtistGameManager.getPlayersInRoom(roomCode));
                        
                        // Si le joueur actif se déconnecte pendant son tour
                        if (room.currentDrawerId === socket.id && room.gameState === 'PLAYING') {
                            console.log(`[FAKE_ARTIST] Active drawer disconnected. Simulating turn validation.`);
                            if (room.turnTimer) clearTimeout(room.turnTimer);
                            
                            const emptyStroke = { color: '#000000', size: 0, points: [] };
                            const valResult = fakeArtistGameManager.validateStroke(roomCode, socket.id, emptyStroke);
                            
                            if (valResult.success) {
                                if (valResult.nextPhase === 'VOTING') {
                                    io.to(`fakeartist-${roomCode}`).emit('fakeartist-game-state-updated', {
                                        gameState: 'VOTING',
                                        players: fakeArtistGameManager.getPlayersInRoom(roomCode),
                                        canvasHistory: room.canvasHistory
                                    });
                                } else {
                                    room.turnStartTime = Date.now();
                                    io.to(`fakeartist-${roomCode}`).emit('fakeartist-turn-updated', {
                                        currentDrawerId: room.currentDrawerId,
                                        currentRound: room.currentRound,
                                        canvasHistory: room.canvasHistory,
                                        turnStartTime: room.turnStartTime
                                    });
                                    setupTurnTimer(io, roomCode, room);
                                }
                            }
                        }
                    }
                }
            } catch (err) {
                console.error('[FAKE_ARTIST] Error in disconnect handler:', err);
            }
        });
    }
};
