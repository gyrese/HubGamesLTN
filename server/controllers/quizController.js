const gameManager = require('../gameManager');
const quizManager = require('../quizManager');

// Fonction pour calculer les statistiques amusantes
function calculateStats(players) {
    const stats = {
        demographics: {},
        correlations: [],
        topPerformers: {}
    };

    const categories = ['hairColor', 'profession', 'isSportive', 'isVegetarian',
        'zodiacSign', 'favoriteDrink', 'favoriteAnimal', 'bedtime', 'coffeesPerDay'];

    categories.forEach(category => {
        const counts = {};
        const scores = {};

        players.forEach(p => {
            const value = p.profile[category];
            if (value) {
                counts[value] = (counts[value] || 0) + 1;
                if (!scores[value]) scores[value] = [];
                scores[value].push(p.score);
            }
        });

        stats.demographics[category] = counts;

        Object.keys(scores).forEach(value => {
            const avg = scores[value].reduce((a, b) => a + b, 0) / scores[value].length;

            if (!stats.topPerformers[category]) stats.topPerformers[category] = {};
            stats.topPerformers[category][value] = {
                avgScore: Math.round(avg),
                count: scores[value].length
            };
        });
    });


    // Générer des corrélations amusantes
    const funFacts = [];

    // 1. Battle Chat vs Chien (prioritaire)
    if (stats.topPerformers.favoriteAnimal?.Chat && stats.topPerformers.favoriteAnimal?.Chien) {
        const chatScore = stats.topPerformers.favoriteAnimal.Chat.avgScore;
        const chienScore = stats.topPerformers.favoriteAnimal.Chien.avgScore;
        const diff = Math.abs(chatScore - chienScore);
        if (diff > 100) { // Seulement si la différence est significative
            if (chatScore > chienScore) {
                funFacts.push(`🐱 Team Chat domine avec ${diff} points d'avance !`);
            } else {
                funFacts.push(`🐶 Team Chien écrase avec ${diff} points d'avance !`);
            }
        }
    }

    // 2. Meilleur signe astrologique
    if (stats.topPerformers.zodiacSign) {
        const sorted = Object.entries(stats.topPerformers.zodiacSign).sort((a, b) => b[1].avgScore - a[1].avgScore);
        if (sorted.length > 0 && sorted[0][1].count >= 2) {
            const [sign, data] = sorted[0];
            funFacts.push(`♈ Les ${sign} sont les plus brillants (${data.avgScore} pts) !`);
        }
    }

    // 3. Café
    if (stats.topPerformers.coffeesPerDay) {
        const sorted = Object.entries(stats.topPerformers.coffeesPerDay).sort((a, b) => b[1].avgScore - a[1].avgScore);
        if (sorted.length > 0) {
            const [amount, data] = sorted[0];
            funFacts.push(`☕ Les buveurs de ${amount} café(s)/jour dominent (${data.avgScore} pts) !`);
        }
    }

    // 4. Couche-tard vs Couche-tôt
    if (stats.topPerformers.bedtime?.['Après minuit'] && stats.topPerformers.bedtime?.['Avant 22h']) {
        const tardScore = stats.topPerformers.bedtime['Après minuit'].avgScore;
        const totScore = stats.topPerformers.bedtime['Avant 22h'].avgScore;
        if (tardScore > totScore) {
            funFacts.push(`🌙 Les couche-tard sont plus performants (+${tardScore - totScore} pts) !`);
        } else {
            funFacts.push(`🌅 Les lève-tôt dominent (+${totScore - tardScore} pts) !`);
        }
    }

    // 5. Végétariens vs Non-végétariens
    if (stats.topPerformers.isVegetarian?.['Oui'] && stats.topPerformers.isVegetarian?.['Non']) {
        const vegeScore = stats.topPerformers.isVegetarian['Oui'].avgScore;
        const nonVegeScore = stats.topPerformers.isVegetarian['Non'].avgScore;
        const diff = Math.abs(vegeScore - nonVegeScore);
        if (diff > 100) {
            if (vegeScore > nonVegeScore) {
                funFacts.push(`🥗 Les végétariens dominent (+${diff} pts) !`);
            } else {
                funFacts.push(`🍖 Les carnivores sont en tête (+${diff} pts) !`);
            }
        }
    }

    // 6. Sportifs vs Non-sportifs
    if (stats.topPerformers.isSportive?.['Oui'] && stats.topPerformers.isSportive?.['Non']) {
        const sportScore = stats.topPerformers.isSportive['Oui'].avgScore;
        const nonSportScore = stats.topPerformers.isSportive['Non'].avgScore;
        const diff = Math.abs(sportScore - nonSportScore);
        if (diff > 100) {
            if (sportScore > nonSportScore) {
                funFacts.push(`🏃 Les sportifs écrasent (+${diff} pts) !`);
            } else {
                funFacts.push(`🛋️ Les sédentaires dominent (+${diff} pts) !`);
            }
        }
    }

    // 7. Profession
    if (stats.topPerformers.profession) {
        const sorted = Object.entries(stats.topPerformers.profession).sort((a, b) => b[1].avgScore - a[1].avgScore);
        if (sorted.length > 0 && sorted[0][1].count >= 2) {
            const [prof, data] = sorted[0];
            funFacts.push(`💼 Les "${prof}" sont en tête (${data.avgScore} pts) !`);
        }
    }

    stats.correlations = funFacts.slice(0, 5);

    return stats;
}

const HOST_GRACE_MS = 60_000; // 60s avant fermeture du salon si l'hôte ne revient pas
const quizHostDisconnectTimers = new Map(); // roomCode → timeout

module.exports = {
    handleConnection: (io, socket) => {
        socket.on('create-room', (callback) => {
            const roomCode = gameManager.createRoom(socket.id);
            socket.join(roomCode);
            callback({ roomCode });
            console.log(`Room created: ${roomCode} by ${socket.id}`);
        });

        // Reconnexion de l'hôte (rechargement d'onglet / coupure réseau).
        // Reconstitue l'état courant à partir du salon, sans rien perdre.
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
                const payload = { success: true, roomCode, gameState: room.gameState, players };
                const idx = room.currentQuestionIndex;

                if (room.gameState === 'QUESTION') {
                    payload.question = room.questions[idx];
                    payload.total = room.questions.length;
                    payload.current = idx + 1;
                    payload.questionStartTime = room.questionStartTime;
                    payload.questionEnded = !!room.questionEnded;
                    payload.answeredPlayerIds = players
                        .filter(p => p.lastAnswer !== null && p.lastAnswer !== undefined)
                        .map(p => p.id);
                    if (room.questionEnded) {
                        payload.correctAnswer = room.questions[idx].correct;
                        payload.leaderboard = players.slice().sort((a, b) => b.score - a.score);
                    }
                } else if (room.gameState === 'SERIES_END' || room.gameState === 'END') {
                    payload.leaderboard = players.slice().sort((a, b) => b.score - a.score);
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
                if (result.error) {
                    callback({ error: result.error });
                    return;
                }
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
                    };
                    if (room.gameState === 'QUESTION') {
                        payload.question = room.questions[idx];
                        payload.questionEnded = !!room.questionEnded;
                        payload.current = idx + 1;
                        payload.total = room.questions.length;
                        const me = room.players.get(socket.id);
                        payload.alreadyAnswered = !!(me && me.lastAnswer !== null && me.lastAnswer !== undefined);
                        if (room.questionEnded) {
                            const leaderboard = players.slice().sort((a, b) => b.score - a.score);
                            payload.correctAnswer = room.questions[idx].correct;
                            payload.rank = leaderboard.findIndex(p => p.id === socket.id) + 1;
                        }
                    } else if (room.gameState === 'SERIES_END' || room.gameState === 'END') {
                        const leaderboard = players.slice().sort((a, b) => b.score - a.score);
                        payload.rank = leaderboard.findIndex(p => p.id === socket.id) + 1;
                        payload.totalPlayers = leaderboard.length;
                        const me = leaderboard.find(p => p.id === socket.id);
                        if (me && me.iq) payload.iq = me.iq;
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
                    player.profile = profile;
                    console.log(`${player.name} a soumis son profil`);
                }
            }
        });

        socket.on('start-game', async ({ roomCode, quizId }) => {
            const room = gameManager.getRoom(roomCode);
            if (room && room.hostId === socket.id) {
                let selectedQuiz = null;
                if (quizId) {
                    selectedQuiz = await quizManager.getQuiz(quizId);
                }

                if (!selectedQuiz) {
                    const allQuizzes = await quizManager.getAllQuizzes();
                    if (allQuizzes.length > 0) selectedQuiz = allQuizzes[0];
                }

                if (selectedQuiz && selectedQuiz.questions.length > 0) {
                    room.gameState = 'QUESTION';
                    room.questions = selectedQuiz.questions;
                    room.currentQuestionIndex = 0;
                    room.questionStartTime = Date.now();
                    room.questionEnded = false;
                    room.lastActivity = Date.now();

                    // Ajouter le score maximum possible de cette série au total de la salle
                    // 1500 points max par question (1000 base + 500 vitesse)
                    room.maxPossibleScore += (selectedQuiz.questions.length * 1500);
                    console.log(`Série démarrée. Max score ajouté: ${selectedQuiz.questions.length * 1500}. Total max: ${room.maxPossibleScore}`);

                    io.to(roomCode).emit('game-started', {
                        question: room.questions[0],
                        total: room.questions.length,
                        current: 1
                    });
                } else {
                    console.error("Aucun quiz disponible pour démarrer la partie.");
                }
            }
        });

        socket.on('submit-answer', ({ roomCode, answerIndex }) => {
            const room = gameManager.getRoom(roomCode);
            if (room && room.gameState === 'QUESTION') {
                const player = room.players.get(socket.id);
                if (player && player.lastAnswer === null) {
                    const responseTime = Date.now() - room.questionStartTime;
                    player.lastAnswer = answerIndex;
                    player.answerTime = responseTime;
                    io.to(roomCode).emit('player-answered', { playerId: socket.id });
                    console.log(`Player ${player.name} answered ${answerIndex} in ${responseTime}ms`);
                }
            }
        });

        socket.on('end-question', ({ roomCode }) => {
            const room = gameManager.getRoom(roomCode);
            if (room && room.hostId === socket.id) {
                const currentQuestion = room.questions[room.currentQuestionIndex];
                const correctIndex = currentQuestion.correct;

                const MAX_TIME = 20000;
                const BASE_POINTS = 1000;

                for (const player of room.players.values()) {
                    if (player.lastAnswer === correctIndex) {
                        const timeBonus = player.answerTime
                            ? Math.max(0, Math.floor(500 * (1 - player.answerTime / MAX_TIME)))
                            : 0;

                        const points = BASE_POINTS + timeBonus;
                        player.score += points;
                        console.log(`${player.name} gagne ${points} points`);
                    }
                    player.lastAnswer = null;
                    player.answerTime = null;
                }

                const leaderboard = Array.from(room.players.values()).sort((a, b) => b.score - a.score);

                room.questionEnded = true; // état RESULT : la question affiche ses résultats
                room.lastActivity = Date.now();

                io.to(roomCode).emit('round-results', {
                    leaderboard,
                    correctAnswer: correctIndex
                });
            }
        });

        socket.on('next-question', ({ roomCode }) => {
            const room = gameManager.getRoom(roomCode);
            if (room && room.hostId === socket.id) {
                room.currentQuestionIndex++;
                if (room.currentQuestionIndex < room.questions.length) {
                    room.gameState = 'QUESTION';
                    room.questionStartTime = Date.now();
                    room.questionEnded = false;
                    room.lastActivity = Date.now();
                    const nextQuestion = room.questions[room.currentQuestionIndex];
                    io.to(roomCode).emit('game-started', {
                        question: nextQuestion,
                        total: room.questions.length,
                        current: room.currentQuestionIndex + 1
                    });
                } else {
                    // Fin de la série (pas de la soirée)
                    room.gameState = 'SERIES_END';
                    room.lastActivity = Date.now();

                    const players = Array.from(room.players.values());
                    const leaderboard = players.sort((a, b) => b.score - a.score);
                    const stats = calculateStats(players);

                    io.to(roomCode).emit('series-end', {
                        leaderboard: leaderboard,
                        stats: stats
                    });
                }
            }
        });

        // Événement pour terminer la soirée et calculer le QI
        socket.on('end-evening', ({ roomCode }) => {
            const room = gameManager.getRoom(roomCode);
            if (room && room.hostId === socket.id) {
                const players = Array.from(room.players.values());

                // Calcul du QI basé sur un système plus précis et dynamique
                // Utilise le score maximum possible réel de la session (basé sur le nombre de questions jouées)
                const maxScore = room.maxPossibleScore || 1; // Éviter division par 0

                players.forEach(player => {
                    // 1. Calculer le pourcentage de réussite
                    const scorePercentage = (player.score / maxScore) * 100;

                    // 2. Conversion en QI selon une courbe réaliste
                    // Basé sur la distribution normale de Wechsler (WAIS)
                    let iq;
                    if (scorePercentage < 20) {
                        iq = 70 + (scorePercentage / 20) * 15;
                    } else if (scorePercentage < 40) {
                        iq = 85 + ((scorePercentage - 20) / 20) * 10;
                    } else if (scorePercentage < 60) {
                        iq = 95 + ((scorePercentage - 40) / 20) * 10;
                    } else if (scorePercentage < 80) {
                        iq = 105 + ((scorePercentage - 60) / 20) * 15;
                    } else if (scorePercentage < 95) {
                        iq = 120 + ((scorePercentage - 80) / 15) * 15;
                    } else {
                        iq = 135 + ((scorePercentage - 95) / 5) * 10;
                    }

                    player.iq = Math.round(iq);
                    player.iq = Math.max(70, Math.min(145, player.iq));

                    console.log(`${player.name}: ${player.score} pts (${scorePercentage.toFixed(1)}%) → QI ${player.iq}`);
                });

                room.gameState = 'END'; // soirée terminée : QI calculés, classement final figé
                room.lastActivity = Date.now();

                const leaderboard = players.sort((a, b) => b.score - a.score);
                const stats = calculateStats(players);

                io.to(roomCode).emit('game-over', {
                    leaderboard: leaderboard,
                    stats: stats
                });
            }
        });

        socket.on('disconnect', () => {
            const result = gameManager.removePlayer(socket.id);
            if (!result) return;

            if (result.isHost) {
                // Période de grâce : l'hôte peut se reconnecter (quiz-host-reconnect)
                // avant que le salon ne soit fermé.
                const roomCode = result.roomCode;
                const timer = setTimeout(() => {
                    quizHostDisconnectTimers.delete(roomCode);
                    io.to(roomCode).emit('host-disconnected');
                    gameManager.deleteRoom(roomCode);
                    console.log(`[QUIZ] Room ${roomCode} fermée après délai de grâce hôte`);
                }, HOST_GRACE_MS);
                quizHostDisconnectTimers.set(roomCode, timer);
                console.log(`[QUIZ] Hôte déconnecté de ${roomCode}, grâce ${HOST_GRACE_MS / 1000}s`);
            } else {
                // Joueur (parti en LOBBY, ou marqué déconnecté en partie) : on rafraîchit la liste.
                io.to(result.roomCode).emit('player-left', Array.from(result.room.players.values()));
            }
        });
    }
};
