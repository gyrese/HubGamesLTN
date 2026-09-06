const fakeArtistGameManager = require('../fakeArtistGameManager');

const HOST_GRACE_MS = 90_000;   // 90s de grâce si l'hôte se déconnecte
const TURN_GRACE_MS = 5_000;    // marge réseau accordée au dessinateur
const REVEAL_MS = 9_000;        // durée de l'écran de dépouillement

const hostDisconnectTimers = new Map(); // roomCode → Timeout

const roomOf = (roomCode) => `fakeartist-${roomCode}`;

/* ═══════════════════════════════════════════════════════════════════
   Diffusion
   ═══════════════════════════════════════════════════════════════════ */

/** Pousse la liste des joueurs à toute la salle. */
function broadcastPlayers(io, roomCode) {
    io.to(roomOf(roomCode)).emit(
        'fakeartist-players-updated',
        fakeArtistGameManager.getPlayersInRoom(roomCode)
    );
}

/* ═══════════════════════════════════════════════════════════════════
   Phase DESSIN
   ═══════════════════════════════════════════════════════════════════ */

/** Diffuse le passage au joueur suivant et relance le minuteur de tour. */
function announceTurn(io, roomCode, room) {
    room.turnStartTime = Date.now();
    io.to(roomOf(roomCode)).emit('fakeartist-turn-updated', {
        currentDrawerId: room.currentDrawerId,
        currentRound: room.currentRound,
        canvasHistory: room.canvasHistory,
        turnStartTime: room.turnStartTime,
        timePerRound: room.settings.timePerRound,
        graceMs: TURN_GRACE_MS
    });
    setupTurnTimer(io, roomCode, room);
}

/** Applique le résultat d'une validation de trait (manuelle ou automatique). */
function applyStrokeResult(io, roomCode, room, result) {
    if (!result || !result.success) return;

    if (result.nextPhase === 'VOTING') {
        io.to(roomOf(roomCode)).emit('fakeartist-game-state-updated', {
            gameState: 'VOTING',
            players: fakeArtistGameManager.getPlayersInRoom(roomCode),
            canvasHistory: room.canvasHistory,
            voteStartTime: result.voteStartTime,
            voteDuration: result.voteDuration
        });
        setupVoteTimer(io, roomCode, room);
    } else {
        announceTurn(io, roomCode, room);
    }
}

/**
 * Minuteur de tour : si le dessinateur ne valide pas à temps, son tour est
 * abandonné (trait vide) et la partie avance. Sans lui, un téléphone verrouillé
 * bloquerait la table entière.
 */
function setupTurnTimer(io, roomCode, room) {
    if (room.turnTimer) clearTimeout(room.turnTimer);

    const delay = room.settings.timePerRound * 1000 + TURN_GRACE_MS;
    room.turnTimer = setTimeout(() => {
        room.turnTimer = null;
        const current = fakeArtistGameManager.getRoom(roomCode);
        if (!current || current.gameState !== 'PLAYING') return;

        console.log(`[FAKE_ARTIST] Timer: tour abandonné pour ${current.currentDrawerId} (${roomCode})`);
        const result = fakeArtistGameManager.validateStroke(
            roomCode,
            current.currentDrawerId,
            { size: 8, points: [] }
        );
        applyStrokeResult(io, roomCode, current, result);
    }, delay);
}

/* ═══════════════════════════════════════════════════════════════════
   Phase VOTE
   ═══════════════════════════════════════════════════════════════════ */

/** Diffuse le dépouillement puis programme la sortie de l'écran REVEAL. */
function announceReveal(io, roomCode, room, result) {
    if (room.voteTimer) { clearTimeout(room.voteTimer); room.voteTimer = null; }

    io.to(roomOf(roomCode)).emit('fakeartist-game-state-updated', {
        gameState: 'REVEAL',
        forced: result.forced,
        isTie: result.isTie,
        accusedId: result.accusedId,
        accusedName: result.accusedName,
        accusedAvatar: result.accusedAvatar,
        accusedColor: result.accusedColor,
        isImpostorAccused: result.isImpostorAccused,
        voteTallies: result.voteTallies,
        votes: result.votes,
        maxVotes: result.maxVotes,
        players: result.players,
        revealDuration: Math.round(REVEAL_MS / 1000)
    });

    if (room.revealTimer) clearTimeout(room.revealTimer);
    room.revealTimer = setTimeout(() => {
        room.revealTimer = null;
        finishReveal(io, roomCode);
    }, REVEAL_MS);
}

/** Sort de REVEAL : bascule vers la devinette ou vers la fin de manche. */
function finishReveal(io, roomCode) {
    const room = fakeArtistGameManager.getRoom(roomCode);
    if (!room || room.gameState !== 'REVEAL') return;

    const outcome = fakeArtistGameManager.concludeReveal(roomCode);
    if (!outcome || outcome.error) return;

    if (outcome.nextPhase === 'GUESSING') {
        io.to(roomOf(roomCode)).emit('fakeartist-game-state-updated', {
            gameState: 'GUESSING',
            accusedId: outcome.accusedId,
            accusedName: outcome.accusedName,
            guessStartTime: outcome.guessStartTime,
            guessDuration: outcome.guessDuration,
            players: fakeArtistGameManager.getPlayersInRoom(roomCode)
        });
        setupGuessTimer(io, roomCode, room);
    } else {
        emitGameEnd(io, roomCode, room, outcome);
    }
}

/**
 * Minuteur de délibération : à son terme les votes sont dépouillés tels quels.
 * Sans lui, un seul joueur silencieux fige la partie indéfiniment.
 */
function setupVoteTimer(io, roomCode, room) {
    if (room.voteTimer) clearTimeout(room.voteTimer);

    const delay = room.settings.voteDuration * 1000;
    room.voteTimer = setTimeout(() => {
        room.voteTimer = null;
        const current = fakeArtistGameManager.getRoom(roomCode);
        if (!current || current.gameState !== 'VOTING') return;

        console.log(`[FAKE_ARTIST] Timer: délibération expirée (${roomCode})`);
        const result = fakeArtistGameManager.resolveVotes(roomCode, true);
        if (result.success) announceReveal(io, roomCode, current, result);
    }, delay);
}

/* ═══════════════════════════════════════════════════════════════════
   Phase DEVINETTE
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Minuteur de devinette : sans proposition dans les temps, l'imposteur échoue
 * et les artistes l'emportent.
 */
function setupGuessTimer(io, roomCode, room) {
    if (room.guessTimer) clearTimeout(room.guessTimer);

    const delay = room.settings.guessDuration * 1000;
    room.guessTimer = setTimeout(() => {
        room.guessTimer = null;
        const current = fakeArtistGameManager.getRoom(roomCode);
        if (!current || current.gameState !== 'GUESSING') return;

        console.log(`[FAKE_ARTIST] Timer: devinette expirée (${roomCode})`);
        const result = fakeArtistGameManager.resolveHostDecision(roomCode, false);
        if (result.success) emitGameEnd(io, roomCode, current, { ...result, timedOut: true });
    }, delay);
}

/* ═══════════════════════════════════════════════════════════════════
   Fin de manche
   ═══════════════════════════════════════════════════════════════════ */

function emitGameEnd(io, roomCode, room, payload) {
    fakeArtistGameManager.clearRoomTimers(room);
    if (room.revealTimer) { clearTimeout(room.revealTimer); room.revealTimer = null; }

    io.to(roomOf(roomCode)).emit('fakeartist-game-state-updated', {
        gameState: 'GAME_END',
        winner: payload.winner,
        reason: payload.reason,
        timedOut: !!payload.timedOut,
        secretWord: payload.secretWord,
        impostorGuess: payload.impostorGuess || room.impostorGuess || null,
        impostors: payload.impostors,
        voteTallies: room.voteTallies,
        matchNumber: room.matchNumber,
        players: fakeArtistGameManager.getPlayersInRoom(roomCode)
    });
}

/* ═══════════════════════════════════════════════════════════════════
   Handlers socket
   ═══════════════════════════════════════════════════════════════════ */

module.exports = {
    handleConnection: (io, socket) => {

        /** Garde : seul l'hôte du salon peut déclencher l'action. */
        const asHost = (roomCode) => {
            const room = fakeArtistGameManager.getRoom(roomCode);
            if (!room || room.hostId !== socket.id) return null;
            return room;
        };

        // ─── CRÉATION SALON ───
        socket.on('fakeartist-create-room', ({ settings } = {}, callback) => {
            try {
                const roomCode = fakeArtistGameManager.createRoom(socket.id, settings);
                socket.join(roomOf(roomCode));
                const room = fakeArtistGameManager.getRoom(roomCode);
                callback({ roomCode, settings: room.settings });
                console.log(`[FAKE_ARTIST] Room ${roomCode} created by host ${socket.id}`);
            } catch (err) {
                console.error('[FAKE_ARTIST] Error in create-room:', err);
                callback({ error: 'Erreur lors de la création du salon' });
            }
        });

        // ─── RÉGLAGES (LOBBY) ───
        socket.on('fakeartist-update-settings', ({ roomCode, settings } = {}, callback) => {
            try {
                const room = asHost(roomCode);
                if (!room) return callback?.({ error: 'Non autorisé' });
                if (room.gameState !== 'LOBBY') return callback?.({ error: 'Partie en cours' });

                const s = settings || {};
                const clampInt = (v, min, max, fallback) => {
                    const n = parseInt(v, 10);
                    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
                };

                if (s.roundsCount !== undefined) room.settings.roundsCount = clampInt(s.roundsCount, 1, 4, room.settings.roundsCount);
                if (s.timePerRound !== undefined) room.settings.timePerRound = clampInt(s.timePerRound, 10, 120, room.settings.timePerRound);
                if (s.voteDuration !== undefined) room.settings.voteDuration = clampInt(s.voteDuration, 30, 300, room.settings.voteDuration);
                if (s.guessDuration !== undefined) room.settings.guessDuration = clampInt(s.guessDuration, 15, 180, room.settings.guessDuration);
                if (Array.isArray(s.categories) && s.categories.length > 0) room.settings.categories = s.categories;
                if (s.twoImpostors === 'auto' || s.twoImpostors === 'never') room.settings.twoImpostors = s.twoImpostors;

                room.lastActivity = Date.now();
                callback?.({ success: true, settings: room.settings });
            } catch (err) {
                console.error('[FAKE_ARTIST] Error in update-settings:', err);
                callback?.({ error: 'Erreur serveur' });
            }
        });

        // ─── RECONNEXION HÔTE ───
        socket.on('fakeartist-host-reconnect', ({ roomCode } = {}, callback) => {
            try {
                const room = fakeArtistGameManager.getRoom(roomCode);
                if (!room) return callback({ error: 'Salon introuvable' });

                if (hostDisconnectTimers.has(roomCode)) {
                    clearTimeout(hostDisconnectTimers.get(roomCode));
                    hostDisconnectTimers.delete(roomCode);
                    console.log(`[FAKE_ARTIST] Host reconnect: timer annulé pour ${roomCode}`);
                }

                room.hostId = socket.id;
                room.hostDisconnected = false;
                socket.join(roomOf(roomCode));
                console.log(`[FAKE_ARTIST] Host reconnected to room ${roomCode}`);

                // Le mot n'est révélé à l'hôte qu'une fois le dessin terminé
                const wordVisible = ['VOTING', 'REVEAL', 'GUESSING', 'GAME_END'].includes(room.gameState);

                callback({
                    success: true,
                    roomCode,
                    gameState: room.gameState,
                    currentRound: room.currentRound,
                    totalRounds: room.totalRounds,
                    matchNumber: room.matchNumber,
                    settings: room.settings,
                    players: fakeArtistGameManager.getPlayersInRoom(roomCode),
                    drawOrder: fakeArtistGameManager.getDrawOrderDetails(roomCode),
                    currentDrawerId: room.currentDrawerId,
                    canvasHistory: room.canvasHistory || [],
                    category: room.currentWord ? room.currentWord.category : '',
                    hostWord: room.currentWord ? room.currentWord.word : null,
                    turnStartTime: room.turnStartTime,
                    voteStartTime: room.voteStartTime,
                    guessStartTime: room.guessStartTime,
                    accusedId: room.accusedId,
                    accusedName: room.accusedId ? room.players.get(room.accusedId)?.name : '',
                    voteTallies: room.voteTallies,
                    impostorGuess: room.impostorGuess,
                    secretWord: wordVisible ? room.currentWord?.word : null,
                    impostors: room.gameState === 'GAME_END' ? fakeArtistGameManager.describeImpostors(room) : null,
                    winner: room.winner
                });

                socket.to(roomOf(roomCode)).emit('fakeartist-host-reconnected');
            } catch (err) {
                console.error('[FAKE_ARTIST] Error in host-reconnect:', err);
                callback({ error: 'Erreur serveur' });
            }
        });

        // ─── REJOINTE DU SALON (JOUEUR) ───
        socket.on('fakeartist-join-room', ({ roomCode, playerName, avatar } = {}, callback) => {
            try {
                const res = fakeArtistGameManager.joinRoom(roomCode, socket.id, playerName, avatar);
                if (res.error) return callback({ error: res.error });

                socket.join(roomOf(roomCode));
                const room = res.room;

                if (res.reconnected) {
                    const isImpostor = res.role === 'impostor';
                    callback({
                        success: true,
                        reconnected: true,
                        gameState: room.gameState,
                        color: res.color,
                        role: res.role,
                        secretWord: isImpostor ? null : room.currentWord?.word,
                        category: room.currentWord?.category,
                        impostorCount: res.impostorCount,
                        currentDrawerId: res.currentDrawerId,
                        currentRound: res.currentRound,
                        totalRounds: res.totalRounds,
                        canvasHistory: res.canvasHistory,
                        myScore: res.myScore,
                        isDrawer: res.currentDrawerId === socket.id,
                        hasVoted: res.hasVoted,
                        votedId: res.votedId,
                        turnStartTime: room.turnStartTime,
                        timePerRound: room.settings.timePerRound,
                        voteStartTime: room.voteStartTime,
                        voteDuration: room.settings.voteDuration,
                        guessStartTime: room.guessStartTime,
                        guessDuration: room.settings.guessDuration,
                        isGuessingImpostor: room.guessingImpostorId === socket.id,
                        impostorGuess: room.impostorGuess,
                        accusedName: room.accusedId ? room.players.get(room.accusedId)?.name : '',
                        winner: room.winner,
                        players: fakeArtistGameManager.getPlayersInRoom(roomCode)
                    });
                } else {
                    callback({
                        success: true,
                        reconnected: false,
                        gameState: room.gameState,
                        color: res.color,
                        players: fakeArtistGameManager.getPlayersInRoom(roomCode)
                    });
                }

                broadcastPlayers(io, roomCode);
            } catch (err) {
                console.error('[FAKE_ARTIST] Error in join-room:', err);
                callback({ error: 'Erreur lors de la rejointe' });
            }
        });

        // ─── LANCEMENT DE LA PARTIE ───
        socket.on('fakeartist-start-game', ({ roomCode } = {}) => {
            try {
                const room = asHost(roomCode);
                if (!room) return;

                fakeArtistGameManager.startGame(roomCode).then((res) => {
                    if (res.error) {
                        socket.emit('fakeartist-error', { message: res.error });
                        return;
                    }

                    // Rôle et mot envoyés individuellement, jamais en diffusion
                    for (const [playerId, player] of room.players) {
                        const isImpostor = room.impostorIds.includes(playerId);
                        io.to(playerId).emit('fakeartist-role-assigned', {
                            role: isImpostor ? 'impostor' : 'artist',
                            secretWord: isImpostor ? null : room.currentWord.word,
                            category: room.currentWord.category,
                            hint: isImpostor ? room.currentWord.hint || null : null,
                            color: player.color,
                            impostorCount: res.impostorCount,
                            playerCount: room.players.size
                        });
                    }

                    room.turnStartTime = Date.now();

                    io.to(room.hostId).emit('fakeartist-game-started', {
                        drawOrder: fakeArtistGameManager.getDrawOrderDetails(roomCode),
                        currentDrawerId: room.currentDrawerId,
                        currentRound: room.currentRound,
                        totalRounds: room.totalRounds,
                        matchNumber: res.matchNumber,
                        category: room.currentWord.category,
                        hostWord: room.currentWord.word,
                        impostorCount: res.impostorCount,
                        turnStartTime: room.turnStartTime,
                        timePerRound: room.settings.timePerRound,
                        graceMs: TURN_GRACE_MS
                    });

                    io.to(roomOf(roomCode)).emit('fakeartist-game-state-updated', {
                        gameState: 'PLAYING',
                        currentDrawerId: room.currentDrawerId,
                        currentRound: room.currentRound,
                        totalRounds: room.totalRounds,
                        turnStartTime: room.turnStartTime,
                        timePerRound: room.settings.timePerRound,
                        players: fakeArtistGameManager.getPlayersInRoom(roomCode)
                    });

                    setupTurnTimer(io, roomCode, room);
                }).catch(err => {
                    console.error('[FAKE_ARTIST] startGame rejected:', err);
                    socket.emit('fakeartist-error', { message: 'Impossible de démarrer la partie' });
                });
            } catch (err) {
                console.error('[FAKE_ARTIST] Error in start-game:', err);
            }
        });

        // ─── CONFIRMATION DE RÔLE PAR LE JOUEUR ───
        socket.on('fakeartist-confirm-role', ({ roomCode } = {}, callback) => {
            try {
                const status = fakeArtistGameManager.confirmRole(roomCode, socket.id);
                if (!status) return callback?.({ error: 'Action impossible' });

                callback?.({ success: true, ...status });
                broadcastPlayers(io, roomCode);

                const room = fakeArtistGameManager.getRoom(roomCode);
                if (room) {
                    io.to(room.hostId).emit('fakeartist-ready-updated', status);
                }
            } catch (err) {
                console.error('[FAKE_ARTIST] Error in confirm-role:', err);
                callback?.({ error: 'Erreur serveur' });
            }
        });

        // ─── VALIDATION DU TRAIT DE DESSIN ───
        socket.on('fakeartist-validate-stroke', ({ roomCode, stroke } = {}, callback) => {
            try {
                const room = fakeArtistGameManager.getRoom(roomCode);
                if (!room || room.gameState !== 'PLAYING') {
                    return callback?.({ error: 'Phase de dessin terminée' });
                }

                const result = fakeArtistGameManager.validateStroke(roomCode, socket.id, stroke);
                if (result.error) return callback?.({ error: result.error });

                if (room.turnTimer) { clearTimeout(room.turnTimer); room.turnTimer = null; }
                callback?.({ success: true });
                applyStrokeResult(io, roomCode, room, result);
            } catch (err) {
                console.error('[FAKE_ARTIST] Error in validate-stroke:', err);
                callback?.({ error: 'Erreur serveur' });
            }
        });

        // ─── PHASE DE VOTE : SOUMISSION D'UN VOTE ───
        socket.on('fakeartist-submit-vote', ({ roomCode, votedId } = {}, callback) => {
            try {
                const result = fakeArtistGameManager.submitVote(roomCode, socket.id, votedId);
                if (result.error) return callback?.({ error: result.error });

                callback?.({ success: true, votedId });
                broadcastPlayers(io, roomCode);

                if (result.votingFinished) {
                    const room = fakeArtistGameManager.getRoom(roomCode);
                    announceReveal(io, roomCode, room, result);
                }
            } catch (err) {
                console.error('[FAKE_ARTIST] Error in submit-vote:', err);
                callback?.({ error: 'Erreur serveur' });
            }
        });

        // ─── FORÇAGE DU DÉPOUILLEMENT PAR L'HÔTE ───
        socket.on('fakeartist-force-vote', ({ roomCode } = {}, callback) => {
            try {
                const room = asHost(roomCode);
                if (!room) return callback?.({ error: 'Non autorisé' });
                if (room.gameState !== 'VOTING') return callback?.({ error: 'Pas en phase de vote' });

                const result = fakeArtistGameManager.resolveVotes(roomCode, true);
                if (result.error) return callback?.({ error: result.error });

                callback?.({ success: true });
                announceReveal(io, roomCode, room, result);
            } catch (err) {
                console.error('[FAKE_ARTIST] Error in force-vote:', err);
                callback?.({ error: 'Erreur serveur' });
            }
        });

        // ─── PASSAGE ANTICIPÉ DE L'ÉCRAN DE RÉVÉLATION ───
        socket.on('fakeartist-skip-reveal', ({ roomCode } = {}, callback) => {
            try {
                const room = asHost(roomCode);
                if (!room) return callback?.({ error: 'Non autorisé' });
                if (room.gameState !== 'REVEAL') return callback?.({ error: 'Pas en révélation' });

                if (room.revealTimer) { clearTimeout(room.revealTimer); room.revealTimer = null; }
                callback?.({ success: true });
                finishReveal(io, roomCode);
            } catch (err) {
                console.error('[FAKE_ARTIST] Error in skip-reveal:', err);
                callback?.({ error: 'Erreur serveur' });
            }
        });

        // ─── DEVINETTE DE L'IMPOSTEUR ───
        socket.on('fakeartist-submit-guess', ({ roomCode, guess } = {}, callback) => {
            try {
                const room = fakeArtistGameManager.getRoom(roomCode);
                if (!room || room.gameState !== 'GUESSING') {
                    return callback?.({ error: 'Phase terminée' });
                }

                const result = fakeArtistGameManager.submitImpostorGuess(roomCode, socket.id, guess);
                if (result.error) return callback?.({ error: result.error });

                // La proposition reçue, l'hôte arbitre : le minuteur n'a plus lieu d'être
                if (room.guessTimer) { clearTimeout(room.guessTimer); room.guessTimer = null; }

                callback?.({ success: true, guess: result.guess });

                io.to(room.hostId).emit('fakeartist-guess-received', {
                    guess: result.guess,
                    secretWord: result.secretWord,
                    autoCorrect: result.autoCorrect
                });

                // Les autres joueurs voient que la proposition est partie
                io.to(roomOf(roomCode)).emit('fakeartist-guess-submitted', { guess: result.guess });
            } catch (err) {
                console.error('[FAKE_ARTIST] Error in submit-guess:', err);
                callback?.({ error: 'Erreur serveur' });
            }
        });

        // ─── DÉCISION DE L'HÔTE (GUESS CORRECT / INCORRECT) ───
        socket.on('fakeartist-host-decision', ({ roomCode, isCorrect } = {}) => {
            try {
                const room = asHost(roomCode);
                if (!room) return;

                const result = fakeArtistGameManager.resolveHostDecision(roomCode, !!isCorrect);
                if (result.success) emitGameEnd(io, roomCode, room, result);
            } catch (err) {
                console.error('[FAKE_ARTIST] Error in host-decision:', err);
            }
        });

        // ─── REJOUER (RETOUR LOBBY) ───
        socket.on('fakeartist-restart-game', ({ roomCode, resetScores } = {}) => {
            try {
                const room = asHost(roomCode);
                if (!room) return;

                const result = fakeArtistGameManager.restartGame(roomCode, { resetScores: !!resetScores });
                if (result.success) {
                    io.to(roomOf(roomCode)).emit('fakeartist-game-state-updated', {
                        gameState: 'LOBBY',
                        players: result.players,
                        matchNumber: result.matchNumber,
                        canvasHistory: []
                    });
                }
            } catch (err) {
                console.error('[FAKE_ARTIST] Error in restart-game:', err);
            }
        });

        // ─── TRAIT EN COURS DE TRACÉ (relayé à l'hôte en direct) ───
        socket.on('fakeartist-draw-stroke-live', ({ roomCode, stroke } = {}) => {
            try {
                const room = fakeArtistGameManager.getRoom(roomCode);
                if (!room || room.gameState !== 'PLAYING') return;
                if (room.currentDrawerId !== socket.id) return;

                // Même nettoyage que pour un trait validé : le direct ne doit pas
                // devenir un vecteur d'abus.
                const clean = fakeArtistGameManager.sanitizeStroke(stroke);
                const player = room.players.get(socket.id);
                clean.color = player?.color?.value || '#1a1a1a';

                io.to(room.hostId).emit('fakeartist-stroke-live', clean);
            } catch (err) {
                console.error('[FAKE_ARTIST] Error in draw-stroke-live:', err);
            }
        });

        // ─── EFFACEMENT DU TRAIT EN COURS ───
        socket.on('fakeartist-clear-stroke-live', ({ roomCode } = {}) => {
            try {
                const room = fakeArtistGameManager.getRoom(roomCode);
                if (!room || room.gameState !== 'PLAYING') return;
                if (room.currentDrawerId !== socket.id) return;

                io.to(room.hostId).emit('fakeartist-clear-live');
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
                    console.log(`[FAKE_ARTIST] Host disconnected from ${roomCode}. Grace period.`);
                    if (hostDisconnectTimers.has(roomCode)) clearTimeout(hostDisconnectTimers.get(roomCode));

                    hostDisconnectTimers.set(roomCode, setTimeout(() => {
                        console.log(`[FAKE_ARTIST] Grace expired. Deleting room ${roomCode}`);
                        io.to(roomOf(roomCode)).emit('fakeartist-room-deleted');
                        fakeArtistGameManager.deleteRoom(roomCode);
                        hostDisconnectTimers.delete(roomCode);
                    }, HOST_GRACE_MS));

                    io.to(roomOf(roomCode)).emit('fakeartist-host-disconnected', {
                        graceSeconds: Math.round(HOST_GRACE_MS / 1000)
                    });
                    return;
                }

                broadcastPlayers(io, roomCode);

                // Le dessinateur actif s'en va : on abandonne son tour
                if (room.gameState === 'PLAYING' && room.currentDrawerId === socket.id) {
                    console.log(`[FAKE_ARTIST] Active drawer left, skipping turn (${roomCode})`);
                    if (room.turnTimer) { clearTimeout(room.turnTimer); room.turnTimer = null; }
                    const valResult = fakeArtistGameManager.validateStroke(
                        roomCode, socket.id, { size: 8, points: [] }
                    );
                    applyStrokeResult(io, roomCode, room, valResult);
                    return;
                }

                // Son départ peut compléter le quorum de vote
                if (room.gameState === 'VOTING' && fakeArtistGameManager.everyoneHasVoted(room)) {
                    const voteResult = fakeArtistGameManager.resolveVotes(roomCode, false);
                    if (voteResult.success) announceReveal(io, roomCode, room, voteResult);
                    return;
                }

                // L'imposteur démasqué abandonne : les artistes l'emportent
                if (room.gameState === 'GUESSING' && room.guessingImpostorId === socket.id && !room.impostorGuess) {
                    console.log(`[FAKE_ARTIST] Guessing impostor left (${roomCode})`);
                    const endResult = fakeArtistGameManager.resolveHostDecision(roomCode, false);
                    if (endResult.success) emitGameEnd(io, roomCode, room, { ...endResult, timedOut: true });
                }
            } catch (err) {
                console.error('[FAKE_ARTIST] Error in disconnect handler:', err);
            }
        });
    }
};
