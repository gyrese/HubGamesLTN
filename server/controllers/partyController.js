/**
 * Super LTN Party — contrôleur socket et machine à états
 *
 * Enchaînement d'une manche :
 *   ROUND_INTRO → CHAMPION_PICK (scope champion) ou ENROL (scope player)
 *               → REVEAL → MINIGAME (phases du module) → ROUND_RESULT
 *
 * Une table = un téléphone, celui du capitaine. Sur les épreuves à plusieurs, il
 * fait scanner son QR à des coéquipiers le temps de l'épreuve ; sur les épreuves à
 * un seul joueur, il désigne un champion par son prénom et tout se passe sur son
 * propre téléphone.
 *
 * Les trois chemins de résolution (`auto`, `vote`, `measure`) vivent ici et non
 * dans les modules : un micro-jeu ne décrit que son contrat, jamais son plumbing.
 */

const partyGameManager = require('../partyGameManager');
const map = require('../party/map');
const tablesLib = require('../party/tables');
const champions = require('../party/champions');
const photos = require('../party/photos');
const minigames = require('../party/minigames');

const HOST_GRACE_MS = 90_000;
const INTRO_MS = 5_000;
const GAME_VOTE_MS = 22_000;
const CHAMPION_PICK_MS = 20_000;
const ENROL_MS = 25_000;
const REVEAL_MS = 5_000;
const ROUND_RESULT_MS = 12_000;

const hostDisconnectTimers = new Map();    // roomCode → Timeout
const captainGraceTimers = new Map();      // `${roomCode}:${tableId}` → Timeout

function roomChannel(roomCode) {
    return `party-${roomCode}`;
}

function safeCallback(callback, payload) {
    if (typeof callback === 'function') callback(payload);
}

// ─────────────────────────────────────────────────────────────────────────────
// Diffusion
// ─────────────────────────────────────────────────────────────────────────────

function broadcastState(io, room) {
    room.lastActivity = Date.now();
    io.to(roomChannel(room.code)).emit('party-state', partyGameManager.snapshot(room));
}

/** Signal ponctuel et temps-critique (le « GO » du réflexe, un faux départ…). */
function pulse(io, room, payload) {
    io.to(roomChannel(room.code)).emit('party-pulse', payload);
}

function setPhase(room, durationMs) {
    room.phaseDuration = durationMs;
    room.phaseEndsAt = Date.now() + durationMs;
}

function schedule(room, ms, fn) {
    const timer = setTimeout(() => {
        room.timers = room.timers.filter((t) => t !== timer);
        try {
            fn();
        } catch (err) {
            console.error('[PARTY] Erreur dans un timer:', err);
        }
    }, ms);
    room.timers.push(timer);
    return timer;
}

// ─────────────────────────────────────────────────────────────────────────────
// Contexte offert aux micro-jeux
// ─────────────────────────────────────────────────────────────────────────────

function makeContext(io, room) {
    return {
        room,
        state: room.minigameState,
        schedule: (ms, fn) => schedule(room, ms, fn),
        broadcast: (payload) => pulse(io, room, payload),
        toPlayer: (playerId, payload) => io.to(playerId).emit('party-pulse', payload),
        finishEarly: () => finishMinigame(io, room),
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Déroulé d'une manche
// ─────────────────────────────────────────────────────────────────────────────

function beginRound(io, room) {
    partyGameManager.clearTimers(room);
    photos.clearRound(room.code);

    room.votes = {};
    room.ballot = {};
    room.gameVotes = {};
    room.roundResult = null;
    room.revealed = false;
    room.minigameId = null;
    room.minigameState = {};
    room.minigamePhase = null;

    // Les invités de la manche précédente sont relâchés : ils ne restent
    // rattachés que le temps d'une épreuve.
    for (const table of room.tables.values()) {
        table.championName = null;
        tablesLib.releaseGuests(room, table.id);
    }

    room.candidates = minigames.pickCandidates(room).map((m) => m.id);

    room.contestedZoneId = map.pickContestedZone(room.lastZoneId);
    room.lastZoneId = room.contestedZoneId;

    room.state = 'ROUND_INTRO';
    setPhase(room, INTRO_MS);
    broadcastState(io, room);

    schedule(room, INTRO_MS, () => startGameVote(io, room));
}

/**
 * Chaque table choisit l'épreuve de la manche : une voix par table, portée par le
 * capitaine. Le catalogue ne contenant pour l'instant que deux micro-jeux, le vote
 * se joue souvent entre deux — il prendra tout son sens au lot 2.
 */
function startGameVote(io, room) {
    // Un seul candidat possible : le vote n'aurait rien à départager.
    if (room.candidates.length < 2) {
        electGame(io, room, room.candidates[0] || minigames.pick(room).id, null);
        return;
    }

    room.state = 'GAME_VOTE';
    setPhase(room, GAME_VOTE_MS);
    broadcastState(io, room);

    schedule(room, GAME_VOTE_MS, () => closeGameVote(io, room));
}

/**
 * Dépouillement. À égalité — le cas courant à deux tables qui se départagent —
 * on tire au sort parmi les ex æquo : c'est net, ça se raconte à l'écran, et ça
 * évite qu'une table impose toujours son genre d'épreuve.
 */
function closeGameVote(io, room) {
    partyGameManager.clearTimers(room);

    const counts = {};
    for (const id of room.candidates) counts[id] = 0;
    for (const votedId of Object.values(room.gameVotes)) {
        if (counts[votedId] !== undefined) counts[votedId] += 1;
    }

    const best = Math.max(...Object.values(counts));
    const tied = room.candidates.filter((id) => counts[id] === best);
    const winnerId = tied[Math.floor(Math.random() * tied.length)];

    // `drawn` : le choix s'est joué au sort, l'écran doit le dire.
    electGame(io, room, winnerId, tied.length > 1 ? 'drawn' : 'voted');
}

function electGame(io, room, minigameId, how) {
    const game = minigames.get(minigameId);
    room.minigameId = game.id;
    room.lastMinigameId = game.id;
    room.gameElection = { how, name: game.name };
    // L'épreuve est publique dès son élection : les tables désignent désormais
    // leur champion en sachant à quoi il s'attaque, ce qui est tout l'intérêt.
    room.revealed = true;

    if (how === 'drawn') {
        pulse(io, room, { kind: 'game-drawn', name: game.name });
    }

    if (game.scope === 'champion') startChampionPick(io, room);
    else if (game.scope === 'player') startEnrol(io, room);
    else startReveal(io, room);
}

function startChampionPick(io, room) {
    room.state = 'CHAMPION_PICK';
    setPhase(room, CHAMPION_PICK_MS);
    broadcastState(io, room);

    schedule(room, CHAMPION_PICK_MS, () => {
        const drawn = champions.autoPickMissing(room);
        if (drawn.length > 0) pulse(io, room, { kind: 'champion-drawn', drawn });
        startReveal(io, room);
    });
}

/**
 * Enrôlement : le capitaine est inscrit d'office puisqu'il tient le téléphone de
 * la table. Les coéquipiers rejoignent en scannant son QR, et pour cette épreuve
 * seulement.
 */
function startEnrol(io, room) {
    room.state = 'ENROL';
    setPhase(room, ENROL_MS);
    for (const table of room.tables.values()) {
        if (tablesLib.isFrozen(table)) continue;
        if (table.captainId) table.enrolled.add(table.captainId);
    }
    broadcastState(io, room);
    schedule(room, ENROL_MS, () => startReveal(io, room));
}

function startReveal(io, room) {
    room.state = 'REVEAL';
    setPhase(room, REVEAL_MS);
    broadcastState(io, room);
    schedule(room, REVEAL_MS, () => startMinigame(io, room));
}

function startMinigame(io, room) {
    room.state = 'MINIGAME';
    const game = minigames.get(room.minigameId);
    // Filet de sécurité : une table sans champion en retrouve un ici. Mieux vaut
    // un prénom tiré au sort qu'une table spectatrice.
    if (game.scope === 'champion') champions.autoPickMissing(room);
    runPhase(io, room, 0);
}

function runPhase(io, room, phaseIndex) {
    const game = minigames.get(room.minigameId);
    if (!game || phaseIndex >= game.phases.length) {
        finishMinigame(io, room);
        return;
    }

    const phase = game.phases[phaseIndex];
    room.minigamePhase = phase.id;
    room.minigamePhaseIndex = phaseIndex;
    setPhase(room, phase.duration * 1000);

    const ctx = makeContext(io, room);
    if (typeof game.start === 'function') game.start(ctx, phase.id);

    // Rien à départager (personne n'a envoyé de photo, ou l'hôte les a toutes
    // écartées) : on n'inflige pas 45 s de vote à vide.
    if (phase.id === 'vote') {
        if (photos.count(room.code) === 0) {
            runPhase(io, room, phaseIndex + 1);
            return;
        }
        sendGallery(io, room);
    }

    broadcastState(io, room);

    schedule(room, phase.duration * 1000, () => runPhase(io, room, phaseIndex + 1));
}

/** Avance immédiatement si tout le monde a déjà fait ce qu'on attendait. */
function advancePhaseEarly(io, room) {
    partyGameManager.clearTimers(room);
    runPhase(io, room, (room.minigamePhaseIndex || 0) + 1);
}

function finishMinigame(io, room) {
    partyGameManager.clearTimers(room);
    const game = minigames.get(room.minigameId);
    const ctx = makeContext(io, room);

    const ranking = game.resolution === 'vote' ? tallyVotes(room) : tallyScores(room, game, ctx);
    resolveRound(io, room, ranking);
}

// ─────────────────────────────────────────────────────────────────────────────
// Les trois chemins de résolution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `auto` : le module rend des scores individuels, on les agrège selon le scope.
 * - player   : la **moyenne** des téléphones enrôlés ayant réellement joué, jamais
 *              la somme, sans quoi une table de 6 écraserait une table de 2 ;
 * - champion : le score saisi sur le téléphone du capitaine.
 */
function tallyScores(room, game, ctx) {
    const result = typeof game.finish === 'function' ? game.finish(ctx) : {};
    const scoresByPlayer = result.scoresByPlayer || {};

    const ranking = [];
    for (const table of partyGameManager.activeTables(room)) {
        let score = 0;
        let detail = '—';

        if (game.scope === 'player') {
            const values = Array.from(table.enrolled)
                .map((playerId) => scoresByPlayer[playerId])
                .filter((v) => typeof v === 'number');
            score = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
            detail = values.length > 0
                ? `${Math.round(score)} pts · moyenne de ${values.length} joueur${values.length > 1 ? 's' : ''}`
                : 'aucune réponse';
        } else {
            score = scoresByPlayer[table.captainId] || 0;
            detail = `${Math.round(score)} pts`;
        }

        ranking.push({
            tableId: table.id,
            tableName: table.name,
            score: Math.round(score),
            detail,
            championName: table.championName,
        });
    }

    return ranking.sort((a, b) => b.score - a.score);
}

/** `vote` : une voix par table, portée par le téléphone du capitaine. */
function tallyVotes(room) {
    const counts = {};
    for (const table of partyGameManager.activeTables(room)) counts[table.id] = 0;

    for (const votedTableId of Object.values(room.votes)) {
        if (counts[votedTableId] === undefined) continue;
        counts[votedTableId] += 1;
    }

    return Object.entries(counts)
        .map(([tableId, score]) => {
            const table = room.tables.get(tableId);
            const photo = photos.get(room.code, tableId);
            return {
                tableId,
                tableName: table?.name || '',
                score,
                detail: `${score} voix`,
                championName: table?.championName || null,
                submittedAt: photo?.at || null,
                photo: photo?.dataUrl || null,
            };
        })
        .sort((a, b) => b.score - a.score);
}

/**
 * Attribution de la zone, et départage des égalités dans cet ordre :
 *   1. le tenant de la zone conserve s'il est parmi les ex æquo ;
 *   2. sinon, la table qui a **rendu sa copie en premier** l'emporte — sans quoi
 *      une partie à deux tables, où chacune vote pour l'autre, resterait
 *      éternellement à 1 voix partout et personne ne conquerrait jamais rien ;
 *   3. faute de quoi (aucune copie rendue), statu quo.
 */
function resolveRound(io, room, ranking) {
    const zoneId = room.contestedZoneId;
    const holder = room.ownership[zoneId];

    let winnerTableId = null;
    let tiebreak = null;
    if (ranking.length > 0 && ranking[0].score > 0) {
        const best = ranking[0].score;
        const tied = ranking.filter((r) => r.score === best);

        if (tied.length === 1) {
            winnerTableId = tied[0].tableId;
        } else if (holder && tied.some((r) => r.tableId === holder)) {
            winnerTableId = holder;
            tiebreak = 'holder';
        } else {
            const fastest = tied
                .filter((r) => typeof r.submittedAt === 'number')
                .sort((a, b) => a.submittedAt - b.submittedAt)[0];
            if (fastest) {
                winnerTableId = fastest.tableId;
                tiebreak = 'fastest';
            }
        }
    }

    if (winnerTableId) room.ownership[zoneId] = winnerTableId;

    champions.closeRound(room, winnerTableId);

    const zone = map.getZone(zoneId);
    const winner = winnerTableId ? room.tables.get(winnerTableId) : null;
    room.roundResult = {
        zoneId,
        zoneName: zone ? zone.name : '',
        zoneValue: zone ? zone.value : 0,
        previousOwnerTableId: holder,
        winnerTableId,
        winnerTableName: winner ? winner.name : null,
        stolen: !!(winnerTableId && holder && holder !== winnerTableId),
        tiebreak,
        ranking,
    };

    room.state = 'ROUND_RESULT';
    room.minigamePhase = null;
    setPhase(room, ROUND_RESULT_MS);
    broadcastState(io, room);

    schedule(room, ROUND_RESULT_MS, () => {
        if (room.roundIndex >= room.settings.totalRounds) {
            endGame(io, room);
        } else {
            room.roundIndex += 1;
            beginRound(io, room);
        }
    });
}

function endGame(io, room) {
    partyGameManager.clearTimers(room);
    photos.clearRoom(room.code);

    room.finalResult = { podium: partyGameManager.publicTables(room) };
    room.state = 'FINAL';
    room.minigameId = null;
    room.minigamePhase = null;
    room.contestedZoneId = null;
    room.phaseEndsAt = null;
    broadcastState(io, room);
    console.log(`[PARTY] Partie terminée dans le salon ${room.code}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Galerie et vote
// ─────────────────────────────────────────────────────────────────────────────

/**
 * La galerie est anonyme : chaque photo reçoit un identifiant de bulletin, et la
 * correspondance bulletin → table ne quitte jamais le serveur. Chaque capitaine
 * reçoit sa propre version, où sa création est marquée pour qu'il ne vote pas
 * pour elle.
 */
function sendGallery(io, room) {
    const entries = photos.gallery(room.code);
    room.ballot = {};
    entries.forEach((entry, index) => {
        room.ballot[`B${index + 1}`] = entry.tableId;
    });

    const publicEntries = entries.map((entry, index) => ({
        pid: `B${index + 1}`,
        dataUrl: entry.dataUrl,
    }));

    io.to(room.hostId).emit('party-gallery', { entries: publicEntries, moderation: false });

    for (const table of room.tables.values()) {
        if (!table.captainId) continue;
        io.to(table.captainId).emit('party-gallery', {
            entries: publicEntries.map((e) => ({ ...e, mine: room.ballot[e.pid] === table.id })),
            moderation: false,
        });
    }
}

/** Pendant la capture, l'hôte voit arriver les photos et peut en écarter une. */
function sendModerationGallery(io, room) {
    const entries = photos.gallery(room.code);
    room.ballot = {};
    entries.forEach((entry, index) => {
        room.ballot[`M${index + 1}`] = entry.tableId;
    });
    io.to(room.hostId).emit('party-gallery', {
        entries: entries.map((entry, index) => ({ pid: `M${index + 1}`, dataUrl: entry.dataUrl })),
        moderation: true,
    });
}

function activeCaptainCount(room) {
    return partyGameManager.activeTables(room).filter((t) => t.captainId).length;
}

// ─────────────────────────────────────────────────────────────────────────────
// Événements socket
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
    handleConnection: (io, socket) => {
        // ─── CRÉATION DU SALON (HÔTE) ───
        socket.on('party-create-room', ({ settings }, callback) => {
            try {
                const roomCode = partyGameManager.createRoom(socket.id, settings);
                socket.join(roomChannel(roomCode));
                const room = partyGameManager.getRoom(roomCode);
                safeCallback(callback, { roomCode, state: partyGameManager.snapshot(room) });
                console.log(`[PARTY] Room ${roomCode} created by host ${socket.id}`);
            } catch (err) {
                console.error('[PARTY] Error in create-room:', err);
                safeCallback(callback, { error: 'Erreur lors de la création du salon' });
            }
        });

        // ─── RECONNEXION DE L'HÔTE ───
        socket.on('party-host-reconnect', ({ roomCode }, callback) => {
            try {
                const room = partyGameManager.getRoom(roomCode);
                if (!room) {
                    safeCallback(callback, { error: 'Salon introuvable' });
                    return;
                }

                if (hostDisconnectTimers.has(roomCode)) {
                    clearTimeout(hostDisconnectTimers.get(roomCode));
                    hostDisconnectTimers.delete(roomCode);
                }

                room.hostId = socket.id;
                room.hostDisconnected = false;
                socket.join(roomChannel(roomCode));
                safeCallback(callback, { success: true, state: partyGameManager.snapshot(room) });
                console.log(`[PARTY] Host reconnected to room ${roomCode}`);
            } catch (err) {
                console.error('[PARTY] Error in host-reconnect:', err);
                safeCallback(callback, { error: 'Erreur serveur' });
            }
        });

        // ─── ARRIVÉE D'UN TÉLÉPHONE ───
        socket.on('party-join-room', ({ roomCode, playerName, avatar, tableId, token }, callback) => {
            try {
                const res = partyGameManager.joinRoom(roomCode, socket.id, playerName, avatar);
                if (res.error) {
                    safeCallback(callback, { error: res.error });
                    return;
                }

                const { room, player } = res;
                socket.join(roomChannel(roomCode));

                // Le capitaine revient : on annule la période de grâce de sa table.
                const own = player.tableId ? room.tables.get(player.tableId) : null;
                if (own && own.captainId === socket.id) {
                    const key = `${roomCode}:${own.id}`;
                    if (captainGraceTimers.has(key)) {
                        clearTimeout(captainGraceTimers.get(key));
                        captainGraceTimers.delete(key);
                    }
                }

                // Arrivée par QR : le rattachement est porté par l'URL scannée.
                let joinError = null;
                if (tableId && token && !player.tableId) {
                    const joined = tablesLib.joinAsGuest(room, socket.id, tableId, token);
                    if (joined.error) joinError = joined.error;
                }

                const table = player.tableId ? room.tables.get(player.tableId) : null;
                safeCallback(callback, {
                    success: true,
                    reconnected: res.reconnected,
                    playerId: socket.id,
                    tableId: player.tableId,
                    role: player.role,
                    isCaptain: !!table && table.captainId === socket.id,
                    // Le jeton ne part que vers le capitaine, jamais dans un état diffusé.
                    token: table && table.captainId === socket.id ? table.token : null,
                    joinError,
                    state: partyGameManager.snapshot(room),
                });

                broadcastState(io, room);
                console.log(`[PARTY] ${player.name} ${res.reconnected ? 'reconnecté' : 'rejoint'} le salon ${roomCode}`);
            } catch (err) {
                console.error('[PARTY] Error in join-room:', err);
                safeCallback(callback, { error: 'Erreur lors de la rejointe' });
            }
        });

        // ─── CRÉATION D'UNE TABLE (LE JOUEUR DEVIENT CAPITAINE) ───
        socket.on('party-create-table', ({ roomCode, tableName }, callback) => {
            try {
                const room = partyGameManager.getRoom(roomCode);
                if (!room) {
                    safeCallback(callback, { error: 'Salon introuvable' });
                    return;
                }
                if (room.state !== 'LOBBY') {
                    safeCallback(callback, { error: 'La partie a déjà commencé' });
                    return;
                }

                const res = tablesLib.createTable(room, socket.id, tableName);
                if (res.error) {
                    safeCallback(callback, { error: res.error });
                    return;
                }

                safeCallback(callback, {
                    success: true,
                    tableId: res.table.id,
                    token: res.token,
                    color: res.table.color,
                });
                broadcastState(io, room);
                console.log(`[PARTY] Table ${res.table.id} (${res.table.name}) créée dans ${roomCode}`);
            } catch (err) {
                console.error('[PARTY] Error in create-table:', err);
                safeCallback(callback, { error: 'Erreur lors de la création de la table' });
            }
        });

        // ─── RATTACHEMENT TEMPORAIRE PAR QR (COÉQUIPIER D'ÉPREUVE) ───
        socket.on('party-join-table', ({ roomCode, tableId, token }, callback) => {
            try {
                const room = partyGameManager.getRoom(roomCode);
                if (!room) {
                    safeCallback(callback, { error: 'Salon introuvable' });
                    return;
                }

                const res = tablesLib.joinAsGuest(room, socket.id, tableId, token);
                if (res.error) {
                    safeCallback(callback, { error: res.error });
                    return;
                }

                safeCallback(callback, { success: true, tableId: res.table.id, color: res.table.color });
                broadcastState(io, room);
            } catch (err) {
                console.error('[PARTY] Error in join-table:', err);
                safeCallback(callback, { error: 'Erreur lors du rattachement' });
            }
        });

        // ─── NOUVEAU QR (LA TABLE D'À CÔTÉ A PHOTOGRAPHIÉ L'ANCIEN) ───
        socket.on('party-regen-token', ({ roomCode }, callback) => {
            try {
                const room = partyGameManager.getRoom(roomCode);
                const player = room?.players.get(socket.id);
                if (!room || !player?.tableId) {
                    safeCallback(callback, { error: 'Action impossible' });
                    return;
                }
                const res = tablesLib.regenerateToken(room, player.tableId, socket.id);
                safeCallback(callback, res.error ? { error: res.error } : { success: true, token: res.token });
            } catch (err) {
                console.error('[PARTY] Error in regen-token:', err);
                safeCallback(callback, { error: 'Erreur serveur' });
            }
        });

        // ─── LANCEMENT DE LA PARTIE ───
        socket.on('party-start-game', ({ roomCode }) => {
            try {
                const room = partyGameManager.getRoom(roomCode);
                if (!room || room.hostId !== socket.id) return;
                if (room.state !== 'LOBBY') return;

                const playable = partyGameManager.activeTables(room);
                if (playable.length < 2) {
                    socket.emit('party-error', { message: 'Il faut au moins deux tables pour commencer' });
                    return;
                }

                room.roundIndex = 1;
                console.log(`[PARTY] Partie lancée dans ${roomCode} — ${playable.length} tables, ${room.settings.totalRounds} manches`);
                beginRound(io, room);
            } catch (err) {
                console.error('[PARTY] Error in start-game:', err);
            }
        });

        // ─── VOTE POUR L'ÉPREUVE DE LA MANCHE (UNE VOIX PAR TABLE) ───
        socket.on('party-vote-game', ({ roomCode, minigameId }, callback) => {
            try {
                const room = partyGameManager.getRoom(roomCode);
                if (!room || room.state !== 'GAME_VOTE') {
                    safeCallback(callback, { error: 'Le vote est fermé' });
                    return;
                }

                const player = room.players.get(socket.id);
                const table = player?.tableId ? room.tables.get(player.tableId) : null;
                if (!table || table.captainId !== socket.id) {
                    safeCallback(callback, { error: 'Seul le capitaine vote' });
                    return;
                }
                if (!room.candidates.includes(minigameId)) {
                    safeCallback(callback, { error: 'Cette épreuve n\'est pas proposée' });
                    return;
                }

                room.gameVotes[table.id] = minigameId;
                safeCallback(callback, { success: true });
                broadcastState(io, room);

                // Toutes les tables ont voté : inutile d'attendre la fin du temps.
                if (Object.keys(room.gameVotes).length >= activeCaptainCount(room)) {
                    closeGameVote(io, room);
                }
            } catch (err) {
                console.error('[PARTY] Error in vote-game:', err);
            }
        });

        // ─── DÉSIGNATION DU CHAMPION (PAR LE CAPITAINE, UN PRÉNOM) ───
        socket.on('party-designate-champion', ({ roomCode, championName }, callback) => {
            try {
                const room = partyGameManager.getRoom(roomCode);
                if (!room || room.state !== 'CHAMPION_PICK') {
                    safeCallback(callback, { error: 'Ce n\'est pas le moment' });
                    return;
                }

                const res = champions.designate(room, socket.id, championName);
                if (res.error) {
                    safeCallback(callback, { error: res.error });
                    return;
                }

                safeCallback(callback, { success: true, championName: res.championName });
                broadcastState(io, room);

                // Toutes les tables ont leur champion : inutile d'attendre les 20 s.
                const ready = partyGameManager.activeTables(room).every((t) => t.championName);
                if (ready) {
                    partyGameManager.clearTimers(room);
                    startReveal(io, room);
                }
            } catch (err) {
                console.error('[PARTY] Error in designate-champion:', err);
            }
        });

        // ─── ENTRÉE DE JEU GÉNÉRIQUE (MICRO-JEUX `auto`) ───
        socket.on('party-input', ({ roomCode, data }) => {
            try {
                const room = partyGameManager.getRoom(roomCode);
                if (!room || room.state !== 'MINIGAME') return;

                const game = minigames.get(room.minigameId);
                if (!game || typeof game.onInput !== 'function') return;

                const player = room.players.get(socket.id);
                const table = player?.tableId ? room.tables.get(player.tableId) : null;
                if (!table || tablesLib.isFrozen(table)) return;

                // Seuls les téléphones concernés par l'épreuve peuvent marquer.
                if (game.scope === 'player' && !table.enrolled.has(socket.id)) return;
                if (game.scope === 'champion' && table.captainId !== socket.id) return;

                game.onInput(makeContext(io, room), socket.id, data);
            } catch (err) {
                console.error('[PARTY] Error in input:', err);
            }
        });

        // ─── PHOTO D'UNE ÉPREUVE CRÉATIVE (ENVOYÉE PAR LE CAPITAINE) ───
        socket.on('party-submit-photo', ({ roomCode, dataUrl }, callback) => {
            try {
                const room = partyGameManager.getRoom(roomCode);
                if (!room || room.state !== 'MINIGAME' || room.minigamePhase !== 'capture') {
                    safeCallback(callback, { error: 'Ce n\'est pas le moment d\'envoyer une photo' });
                    return;
                }

                const player = room.players.get(socket.id);
                const table = player?.tableId ? room.tables.get(player.tableId) : null;
                if (!table || table.captainId !== socket.id) {
                    safeCallback(callback, { error: 'Seul le capitaine envoie la photo' });
                    return;
                }

                const res = photos.put(roomCode, table.id, dataUrl);
                if (res.error) {
                    safeCallback(callback, { error: res.error });
                    return;
                }

                safeCallback(callback, { success: true });
                sendModerationGallery(io, room);
                broadcastState(io, room);

                if (photos.count(roomCode) >= activeCaptainCount(room)) advancePhaseEarly(io, room);
            } catch (err) {
                console.error('[PARTY] Error in submit-photo:', err);
                safeCallback(callback, { error: 'Erreur lors de l\'envoi' });
            }
        });

        // ─── MODÉRATION : L'HÔTE ÉCARTE UNE PHOTO ───
        socket.on('party-discard-photo', ({ roomCode, pid }, callback) => {
            try {
                const room = partyGameManager.getRoom(roomCode);
                if (!room || room.hostId !== socket.id) return;

                const tableId = room.ballot?.[pid];
                if (!tableId) {
                    safeCallback(callback, { error: 'Photo introuvable' });
                    return;
                }

                photos.discard(roomCode, tableId);
                safeCallback(callback, { success: true });

                if (room.minigamePhase === 'vote') sendGallery(io, room);
                else sendModerationGallery(io, room);
                console.log(`[PARTY] Photo écartée par l'hôte dans ${roomCode}`);
            } catch (err) {
                console.error('[PARTY] Error in discard-photo:', err);
            }
        });

        // ─── VOTE (UNE VOIX PAR TABLE, PORTÉE PAR LE CAPITAINE) ───
        socket.on('party-vote', ({ roomCode, pid }, callback) => {
            try {
                const room = partyGameManager.getRoom(roomCode);
                if (!room || room.state !== 'MINIGAME' || room.minigamePhase !== 'vote') {
                    safeCallback(callback, { error: 'Le vote est fermé' });
                    return;
                }

                const player = room.players.get(socket.id);
                const table = player?.tableId ? room.tables.get(player.tableId) : null;
                if (!table || table.captainId !== socket.id) {
                    safeCallback(callback, { error: 'Seul le capitaine vote' });
                    return;
                }

                const votedTableId = room.ballot?.[pid];
                if (!votedTableId) {
                    safeCallback(callback, { error: 'Bulletin inconnu' });
                    return;
                }
                if (votedTableId === table.id) {
                    safeCallback(callback, { error: 'On ne vote pas pour sa propre table' });
                    return;
                }

                room.votes[table.id] = votedTableId;
                safeCallback(callback, { success: true });
                broadcastState(io, room);

                if (Object.keys(room.votes).length >= activeCaptainCount(room)) advancePhaseEarly(io, room);
            } catch (err) {
                console.error('[PARTY] Error in vote:', err);
            }
        });

        // ─── DÉCONNEXION ───
        socket.on('disconnect', () => {
            try {
                const result = partyGameManager.removePlayer(socket.id);
                if (!result) return;

                const { roomCode, room, isHost } = result;

                if (isHost) {
                    console.log(`[PARTY] Hôte déconnecté de ${roomCode}, période de grâce`);
                    if (hostDisconnectTimers.has(roomCode)) clearTimeout(hostDisconnectTimers.get(roomCode));
                    hostDisconnectTimers.set(roomCode, setTimeout(() => {
                        partyGameManager.deleteRoom(roomCode);
                        io.to(roomChannel(roomCode)).emit('party-room-deleted');
                        hostDisconnectTimers.delete(roomCode);
                    }, HOST_GRACE_MS));
                    broadcastState(io, room);
                    return;
                }

                const { player, table, wasCaptain } = result;

                /**
                 * Le capitaine tombe. Une table n'a qu'un téléphone : sur mobile en
                 * polling, une coupure de quelques secondes est banale. On laisse
                 * donc la table en jeu pendant la période de grâce, et on ne cherche
                 * un remplaçant qu'à son expiration.
                 */
                if (wasCaptain && table) {
                    const key = `${roomCode}:${table.id}`;
                    if (captainGraceTimers.has(key)) clearTimeout(captainGraceTimers.get(key));
                    captainGraceTimers.set(key, setTimeout(() => {
                        captainGraceTimers.delete(key);
                        const current = partyGameManager.getRoom(roomCode);
                        if (!current) return;
                        const target = current.tables.get(table.id);
                        if (!target || target.disconnectedAt === null) return;

                        const promoted = tablesLib.promoteGuest(current, table.id);
                        if (promoted.captainId) {
                            io.to(promoted.captainId).emit('party-captain-token', {
                                tableId: table.id,
                                token: promoted.token,
                            });
                            pulse(io, current, {
                                kind: 'captain-transfer',
                                tableId: table.id,
                                tableName: target.name,
                                captainName: promoted.captainName,
                            });
                            console.log(`[PARTY] ${target.name}: ${promoted.captainName} reprend le flambeau`);
                        } else {
                            console.log(`[PARTY] ${target.name} hors course : capitaine absent depuis ${tablesLib.TABLE_GRACE_MS / 1000}s`);
                        }
                        broadcastState(io, current);
                    }, tablesLib.TABLE_GRACE_MS));

                    console.log(`[PARTY] Capitaine de ${table.name} déconnecté, ${tablesLib.TABLE_GRACE_MS / 1000}s de grâce`);
                }

                broadcastState(io, room);
                console.log(`[PARTY] ${player.name} déconnecté de ${roomCode}`);
            } catch (err) {
                console.error('[PARTY] Error in disconnect handler:', err);
            }
        });
    },
};
