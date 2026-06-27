const gameManager = require('../gameManager');
const quizManager = require('../quizManager');
const iqEngine = require('../iqEngine');
const { calculateStats } = require('../funStats');

// ─── Constantes de jeu ────────────────────────────────────────────
const HOST_GRACE_MS = 60_000;  // 60s avant fermeture du salon si l'hôte ne revient pas
const RESULT_MS = 6_000;       // durée d'affichage des résultats avant auto-avance
const BASE_POINTS = 1000;      // points d'une bonne réponse
const SPEED_BONUS = 500;       // bonus de vitesse max (n'influence QUE le score de jeu, pas le QI)

const quizHostDisconnectTimers = new Map(); // roomCode → timeout (grâce hôte)

// ─── Helpers de timing serveur-autoritaire ───────────────────────
function clearRoomTimers(room) {
    if (!room) return;
    if (room.questionTimer) { clearTimeout(room.questionTimer); room.questionTimer = null; }
    if (room.resultTimer) { clearTimeout(room.resultTimer); room.resultTimer = null; }
}

function presentPlayers(room) {
    return Array.from(room.players.values()).filter(p => !p.disconnected);
}

function leaderboardOf(room) {
    return Array.from(room.players.values()).sort((a, b) => b.score - a.score);
}

// Version « publique » d'une question : on retire la bonne réponse et
// l'explication tant que la question est en cours (anti-triche client).
// Elles sont révélées uniquement dans round-results.
function publicQuestion(q) {
    if (!q) return q;
    return { text: q.text, options: q.options, image: q.image || null, difficulty: q.difficulty };
}

// Démarre la question courante : reset, broadcast, et arme le timer de fin.
function startQuestion(io, room) {
    clearRoomTimers(room);
    const q = room.questions[room.currentQuestionIndex];
    room.gameState = 'QUESTION';
    room.questionStartTime = Date.now();
    room.questionEnded = false;
    room.lastActivity = Date.now();
    for (const p of room.players.values()) { p.lastAnswer = null; p.answerTime = null; }

    io.to(room.code).emit('game-started', {
        question: publicQuestion(q),
        total: room.questions.length,
        current: room.currentQuestionIndex + 1,
        duration: room.questionDuration,
        autoAdvance: room.autoAdvance,
    });

    room.questionTimer = setTimeout(() => endQuestionInternal(io, room), room.questionDuration * 1000);
}

// Clôt la question : scoring, accumulateurs QI, broadcast des résultats.
// Idempotent (garde questionEnded) — peut être déclenché par le timer,
// le « tous ont répondu », ou le bouton « passer » de l'hôte.
function endQuestionInternal(io, room) {
    if (!room || room.gameState !== 'QUESTION' || room.questionEnded) return;
    clearRoomTimers(room);

    const q = room.questions[room.currentQuestionIndex];
    const correctIndex = q.correct;
    const maxTime = room.questionDuration * 1000;

    // p-value de l'item sur le groupe présent → poids de difficulté pour le QI.
    let answeredOnItem = 0, correctOnItem = 0;
    for (const p of room.players.values()) {
        if (p.disconnected) continue;
        if (p.lastAnswer !== null && p.lastAnswer !== undefined) {
            answeredOnItem++;
            if (p.lastAnswer === correctIndex) correctOnItem++;
        }
    }
    const { weight } = iqEngine.itemWeight({
        correctCount: correctOnItem, answeredCount: answeredOnItem, difficulty: q.difficulty,
    });

    for (const p of room.players.values()) {
        const present = !p.disconnected;
        const isCorrect = p.lastAnswer === correctIndex;

        if (isCorrect) {
            // Score de jeu : base + bonus de vitesse (côté « nervosité » du classement).
            const timeBonus = p.answerTime
                ? Math.max(0, Math.floor(SPEED_BONUS * (1 - p.answerTime / maxTime)))
                : 0;
            p.score += BASE_POINTS + timeBonus;
        }

        // Accumulateurs QI : précision pondérée difficulté, indépendante de la vitesse.
        if (present) {
            p.seenCount++;
            p.weightSum += weight;
            if (isCorrect) { p.correctCount++; p.weightedCorrect += weight; }
        }

        p.lastAnswer = null;
        p.answerTime = null;
    }

    room.questionEnded = true;
    room.questionsPlayed++;
    room.lastActivity = Date.now();

    io.to(room.code).emit('round-results', {
        leaderboard: leaderboardOf(room),
        correctAnswer: correctIndex,
        explanation: q.explanation || null,
        autoAdvance: room.autoAdvance,
        resultDuration: room.autoAdvance ? RESULT_MS : null,
    });

    if (room.autoAdvance) {
        room.resultTimer = setTimeout(() => nextQuestionInternal(io, room), RESULT_MS);
    }
}

// Avance à la question suivante, ou clôt la série.
function nextQuestionInternal(io, room) {
    if (!room) return;
    clearRoomTimers(room);
    room.currentQuestionIndex++;
    if (room.currentQuestionIndex < room.questions.length) {
        startQuestion(io, room);
    } else {
        room.gameState = 'SERIES_END';
        room.lastActivity = Date.now();
        const players = Array.from(room.players.values());
        io.to(room.code).emit('series-end', {
            leaderboard: leaderboardOf(room),
            stats: calculateStats(players),
        });
    }
}

module.exports = {
    handleConnection: (io, socket) => {
        socket.on('create-room', (callback) => {
            const roomCode = gameManager.createRoom(socket.id);
            socket.join(roomCode);
            callback({ roomCode });
            console.log(`Room created: ${roomCode} by ${socket.id}`);
        });

        // Reconnexion de l'hôte (rechargement d'onglet / coupure réseau).
        socket.on('quiz-host-reconnect', ({ roomCode }, callback) => {
            try {
                const room = gameManager.getRoom(roomCode);
                if (!room) { if (callback) callback({ error: 'Salon introuvable' }); return; }

                if (quizHostDisconnectTimers.has(roomCode)) {
                    clearTimeout(quizHostDisconnectTimers.get(roomCode));
                    quizHostDisconnectTimers.delete(roomCode);
                }
                room.hostId = socket.id;
                room.hostDisconnected = false;
                room.lastActivity = Date.now();
                socket.join(roomCode);

                const players = Array.from(room.players.values());
                const payload = {
                    success: true, roomCode, gameState: room.gameState, players,
                    duration: room.questionDuration, autoAdvance: room.autoAdvance,
                };
                const idx = room.currentQuestionIndex;

                if (room.gameState === 'QUESTION') {
                    payload.question = publicQuestion(room.questions[idx]);
                    payload.total = room.questions.length;
                    payload.current = idx + 1;
                    payload.questionStartTime = room.questionStartTime;
                    payload.questionEnded = !!room.questionEnded;
                    payload.answeredPlayerIds = players
                        .filter(p => p.lastAnswer !== null && p.lastAnswer !== undefined)
                        .map(p => p.id);
                    if (room.questionEnded) {
                        payload.correctAnswer = room.questions[idx].correct;
                        payload.explanation = room.questions[idx].explanation || null;
                        payload.leaderboard = leaderboardOf(room);
                    }
                } else if (room.gameState === 'SERIES_END' || room.gameState === 'END') {
                    payload.leaderboard = leaderboardOf(room);
                    payload.stats = calculateStats(players);
                }

                if (callback) callback(payload);
                console.log(`[QUIZ] Host reconnected to room ${roomCode} (state=${room.gameState})`);
            } catch (error) {
                console.error('[QUIZ] Error in quiz-host-reconnect:', error);
                if (callback) callback({ error: 'Erreur serveur' });
            }
        });

        socket.on('join-room', ({ roomCode, playerName, avatar }, callback) => {
            try {
                const result = gameManager.joinRoom(roomCode, socket.id, playerName, avatar);
                if (result.error) { callback({ error: result.error }); return; }
                socket.join(roomCode);
                const room = result.room;

                if (result.reconnected) {
                    const players = Array.from(room.players.values());
                    const idx = room.currentQuestionIndex;
                    const payload = {
                        success: true,
                        reconnected: true,
                        gameState: room.gameState,
                        myScore: result.myScore,
                        profileComplete: result.profileComplete,
                        duration: room.questionDuration,
                        autoAdvance: room.autoAdvance,
                    };
                    if (room.gameState === 'QUESTION') {
                        payload.question = publicQuestion(room.questions[idx]);
                        payload.questionEnded = !!room.questionEnded;
                        payload.current = idx + 1;
                        payload.total = room.questions.length;
                        payload.questionStartTime = room.questionStartTime;
                        const me = room.players.get(socket.id);
                        payload.alreadyAnswered = !!(me && me.lastAnswer !== null && me.lastAnswer !== undefined);
                        if (room.questionEnded) {
                            const leaderboard = leaderboardOf(room);
                            payload.correctAnswer = room.questions[idx].correct;
                            payload.explanation = room.questions[idx].explanation || null;
                            payload.rank = leaderboard.findIndex(p => p.id === socket.id) + 1;
                        }
                    } else if (room.gameState === 'SERIES_END' || room.gameState === 'END') {
                        const leaderboard = leaderboardOf(room);
                        payload.rank = leaderboard.findIndex(p => p.id === socket.id) + 1;
                        payload.totalPlayers = leaderboard.length;
                        const me = leaderboard.find(p => p.id === socket.id);
                        if (me) {
                            payload.iq = me.iq || null;
                            payload.iqMargin = me.iqMargin || null;
                            payload.iqPercentile = me.iqPercentile || null;
                            payload.iqLabel = me.iqLabel || null;
                            payload.iqEmoji = me.iqEmoji || null;
                            payload.accuracy = me.accuracy ?? null;
                        }
                    }
                    callback(payload);
                    console.log(`[QUIZ] ${playerName} reconnected to room ${roomCode} (state=${room.gameState})`);
                } else {
                    callback({ success: true });
                    console.log(`${playerName} joined room ${roomCode}`);
                }

                io.to(roomCode).emit('player-joined', Array.from(room.players.values()));
            } catch (error) {
                console.error("Erreur lors du join-room:", error);
                callback({ error: "Erreur serveur lors de la connexion." });
            }
        });

        socket.on('submit-profile', ({ roomCode, profile }) => {
            const room = gameManager.getRoom(roomCode);
            if (room) {
                const player = room.players.get(socket.id);
                if (player) {
                    player.profile = { ...player.profile, ...(profile || {}) };
                    player.profileSubmitted = true;
                    console.log(`${player.name} a soumis son profil`);
                }
            }
        });

        // Démarre une série (1re série ou série suivante). Score & QI cumulent sur la soirée.
        socket.on('start-game', async ({ roomCode, quizId, duration, autoAdvance }) => {
            const room = gameManager.getRoom(roomCode);
            if (!room || room.hostId !== socket.id) return;

            let selectedQuiz = quizId ? await quizManager.getQuiz(quizId) : null;
            if (!selectedQuiz) {
                const all = await quizManager.getAllQuizzes();
                if (all.length > 0) selectedQuiz = all[0];
            }
            if (!selectedQuiz || !selectedQuiz.questions.length) {
                console.error("Aucun quiz disponible pour démarrer la partie.");
                return;
            }

            // Réglages de partie (persistés entre séries).
            if (typeof duration === 'number' && duration >= 5 && duration <= 120) {
                room.questionDuration = Math.round(duration);
            }
            if (typeof autoAdvance === 'boolean') room.autoAdvance = autoAdvance;

            room.questions = selectedQuiz.questions;
            room.currentQuestionIndex = 0;
            startQuestion(io, room);
            console.log(`Série démarrée (${selectedQuiz.questions.length} questions, ${room.questionDuration}s, auto=${room.autoAdvance}).`);
        });

        socket.on('submit-answer', ({ roomCode, answerIndex }) => {
            const room = gameManager.getRoom(roomCode);
            if (!room || room.gameState !== 'QUESTION' || room.questionEnded) return;
            const player = room.players.get(socket.id);
            if (!player || player.lastAnswer !== null) return;

            player.lastAnswer = answerIndex;
            player.answerTime = Date.now() - room.questionStartTime;
            io.to(roomCode).emit('player-answered', { playerId: socket.id });
            console.log(`Player ${player.name} answered ${answerIndex} in ${player.answerTime}ms`);

            // Fin anticipée : tous les joueurs présents ont répondu.
            const present = presentPlayers(room);
            if (present.length > 0 && present.every(p => p.lastAnswer !== null && p.lastAnswer !== undefined)) {
                endQuestionInternal(io, room);
            }
        });

        // Bouton « passer » de l'hôte.
        socket.on('end-question', ({ roomCode }) => {
            const room = gameManager.getRoom(roomCode);
            if (room && room.hostId === socket.id) endQuestionInternal(io, room);
        });

        // Bouton « question suivante » de l'hôte (annule l'auto-avance en cours).
        socket.on('next-question', ({ roomCode }) => {
            const room = gameManager.getRoom(roomCode);
            if (room && room.hostId === socket.id) nextQuestionInternal(io, room);
        });

        // Terminer la soirée → calcul du QI (déviation normée, façon vrai test).
        socket.on('end-evening', ({ roomCode }) => {
            const room = gameManager.getRoom(roomCode);
            if (!room || room.hostId !== socket.id) return;
            clearRoomTimers(room);

            const players = Array.from(room.players.values());
            iqEngine.compute(players);
            players.forEach(p => console.log(`${p.name}: ${p.correctCount}/${p.seenCount} → QI ${p.iq} (±${p.iqMargin}, p${p.iqPercentile})`));

            room.gameState = 'END';
            room.lastActivity = Date.now();

            io.to(roomCode).emit('game-over', {
                leaderboard: leaderboardOf(room),
                stats: calculateStats(players),
            });
        });

        socket.on('disconnect', () => {
            const result = gameManager.removePlayer(socket.id);
            if (!result) return;

            if (result.isHost) {
                // Période de grâce : l'hôte peut se reconnecter avant fermeture du salon.
                // NB : les timers de question continuent de tourner côté serveur (timing autoritaire).
                const roomCode = result.roomCode;
                const timer = setTimeout(() => {
                    quizHostDisconnectTimers.delete(roomCode);
                    const room = gameManager.getRoom(roomCode);
                    clearRoomTimers(room);
                    io.to(roomCode).emit('host-disconnected');
                    gameManager.deleteRoom(roomCode);
                    console.log(`[QUIZ] Room ${roomCode} fermée après délai de grâce hôte`);
                }, HOST_GRACE_MS);
                quizHostDisconnectTimers.set(roomCode, timer);
                console.log(`[QUIZ] Hôte déconnecté de ${roomCode}, grâce ${HOST_GRACE_MS / 1000}s`);
            } else {
                io.to(result.roomCode).emit('player-left', Array.from(result.room.players.values()));
            }
        });
    }
};
