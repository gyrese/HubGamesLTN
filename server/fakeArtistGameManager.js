/**
 * Fake Artist Game Manager
 * Gère l'état des salons de jeu "Fake Artist"
 */

const RoomBase = require('./core/RoomBase');
const { getRandomWord } = require('./drawWords');

const PLAYER_COLORS = [
    { name: 'Rouge', value: '#FF4757' },
    { name: 'Bleu', value: '#3B82F6' },
    { name: 'Vert', value: '#4ADE80' },
    { name: 'Ambre', value: '#F5A524' },
    { name: 'Cyan', value: '#22D3EE' },
    { name: 'Violet', value: '#A855F7' },
    { name: 'Rose', value: '#F0398B' },
    { name: 'Lime', value: '#A3E635' },
    { name: 'Orange', value: '#FB7185' },
    { name: 'Indigo', value: '#6366F1' },
    { name: 'Turquoise', value: '#2DD4BF' },
    { name: 'Prune', value: '#C084FC' }
];

// ── Bornes anti-abus sur les tracés ────────────────────────────────
const MAX_STROKE_POINTS = 1200;   // au-delà, le tracé est sous-échantillonné
const MAX_STROKE_SIZE = 24;       // épaisseur maximale acceptée
const MIN_STROKE_SIZE = 2;

// ── Barème ─────────────────────────────────────────────────────────
const SCORE = {
    ARTIST_WIN: 100,          // l'imposteur est démasqué et échoue
    ARTIST_CORRECT_VOTE: 50,  // avoir personnellement voté pour l'imposteur
    IMPOSTOR_SURVIVES: 200,   // ne pas être démasqué du tout
    IMPOSTOR_GUESSES: 150     // démasqué, mais devine le mot
};

// ── Seuil du second imposteur (règle du jeu original) ──────────────
const TWO_IMPOSTORS_FROM = 7;

class FakeArtistGameManager extends RoomBase {
    constructor() {
        super({
            logTag: 'FAKE_ARTIST',
            codeFormat: 'alpha6',
            maxPlayers: 12,          // autant que de couleurs distinctes
            endStates: ['GAME_END'],
            endedTtlMs: 30 * 60 * 1000,  // 30 min après GAME_END
            staleTtlMs: 90 * 60 * 1000   // 1h30 d'inactivité totale
        });
    }

    defaultSettings() {
        return {
            roundsCount: 2,         // Nombre de passages par joueur
            timePerRound: 30,       // Secondes par trait de dessin
            voteDuration: 90,       // Secondes de délibération
            guessDuration: 45,      // Secondes laissées à l'imposteur démasqué
            categories: ['all'],    // Catégories
            twoImpostors: 'auto'    // 'auto' | 'never' — 2 imposteurs dès 7 joueurs
        };
    }

    createRoomState() {
        return {
            // LOBBY, PLAYING, VOTING, REVEAL, GUESSING, GAME_END
            currentRound: 0,
            totalRounds: 0,
            matchNumber: 0,         // Numéro de manche dans la soirée
            drawOrder: [],          // Ordre des IDs de joueurs
            drawQueue: [],          // File complète des tours restants
            currentDrawerId: null,
            currentDrawerIndex: 0,
            impostorIds: [],        // IDs des imposteurs (1 ou 2)
            currentWord: null,      // { word, category, hint }
            canvasHistory: [],      // Historique des tracés validés
            votes: {},              // Map<voterId, votedId>
            voteTallies: {},        // Résultat du dépouillement
            accusedId: null,        // Joueur qui a reçu le plus de votes
            impostorGuess: null,    // Proposition du mot secret par l'imposteur
            guessingImpostorId: null, // Imposteur qui doit deviner
            winner: null,           // 'artists' ou 'impostor'
            roundScores: {}         // Points gagnés sur la manche courante
        };
    }

    /** Purge tous les minuteurs attachés à un salon (tour, vote, devinette). */
    clearRoomTimers(room) {
        if (!room) return;
        if (room.turnTimer) { clearTimeout(room.turnTimer); room.turnTimer = null; }
        if (room.voteTimer) { clearTimeout(room.voteTimer); room.voteTimer = null; }
        if (room.guessTimer) { clearTimeout(room.guessTimer); room.guessTimer = null; }
        if (room.revealTimer) { clearTimeout(room.revealTimer); room.revealTimer = null; }
    }

    onRoomDisposed(room) {
        this.clearRoomTimers(room);
    }

    /** Vue publique d'un joueur — ne fuite jamais le rôle ni le mot. */
    describePlayer(p, room) {
        return {
            id: p.id,
            name: p.name,
            avatar: p.avatar,
            color: p.color,
            disconnected: p.disconnected,
            score: p.score,
            roundScore: room.roundScores?.[p.id] || 0,
            hasVoted: !!room.votes[p.id],
            hasConfirmedRole: p.hasConfirmedRole,
            hasDrawn: room.drawnBy ? !!room.drawnBy[p.id] : false
        };
    }

    /** Ordre de passage résolu en objets joueur — pour l'affichage hôte. */
    getDrawOrderDetails(roomCode) {
        const room = this.rooms.get(roomCode);
        if (!room) return [];
        return room.drawOrder.map(id => {
            const p = room.players.get(id);
            if (!p) return null;
            return {
                id: p.id,
                name: p.name,
                avatar: p.avatar,
                color: p.color,
                disconnected: p.disconnected,
                score: p.score
            };
        }).filter(Boolean);
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

    createPlayer(playerId, playerName, avatar, room) {
        return {
            id: playerId,
            name: playerName,
            avatar: avatar || null,
            color: this.assignColorToPlayer(room),
            score: 0,
            disconnected: false,
            hasConfirmedRole: false
        };
    }

    /**
     * Le joueur revient avec un nouvel identifiant de socket : tout ce qui le
     * désigne ailleurs dans l'état de la partie doit suivre, sans quoi il perd
     * son tour, son vote ou son rôle d'imposteur.
     */
    onPlayerRejoin(room, oldId, newId) {
        const orderIndex = room.drawOrder.indexOf(oldId);
        if (orderIndex !== -1) room.drawOrder[orderIndex] = newId;

        if (room.drawQueue) {
            room.drawQueue = room.drawQueue.map(id => id === oldId ? newId : id);
        }
        if (room.currentDrawerId === oldId) room.currentDrawerId = newId;

        const impIdx = room.impostorIds.indexOf(oldId);
        if (impIdx !== -1) room.impostorIds[impIdx] = newId;

        if (room.guessingImpostorId === oldId) room.guessingImpostorId = newId;
        if (room.accusedId === oldId) room.accusedId = newId;

        // Le vote émis…
        if (room.votes[oldId]) {
            room.votes[newId] = room.votes[oldId];
            delete room.votes[oldId];
        }
        // …et les votes reçus
        for (const voterId in room.votes) {
            if (room.votes[voterId] === oldId) room.votes[voterId] = newId;
        }

        if (room.roundScores?.[oldId] !== undefined) {
            room.roundScores[newId] = room.roundScores[oldId];
            delete room.roundScores[oldId];
        }
        if (room.drawnBy?.[oldId]) {
            room.drawnBy[newId] = true;
            delete room.drawnBy[oldId];
        }
    }

    describeRejoin(room, player) {
        return {
            gameState: room.gameState,
            color: player.color,
            role: room.impostorIds.includes(player.id) ? 'impostor' : 'artist',
            currentDrawerId: room.currentDrawerId,
            currentRound: room.currentRound,
            totalRounds: room.totalRounds,
            canvasHistory: room.canvasHistory,
            myScore: player.score,
            hasVoted: !!room.votes[player.id],
            votedId: room.votes[player.id] || null,
            impostorCount: room.impostorIds.length
        };
    }

    describeJoin(room, player) {
        return {
            gameState: room.gameState,
            color: player.color
        };
    }

    /** Combien d'imposteurs pour cet effectif ? */
    resolveImpostorCount(room, playerCount) {
        if (room.settings.twoImpostors === 'never') return 1;
        return playerCount >= TWO_IMPOSTORS_FROM ? 2 : 1;
    }

    async startGame(roomCode) {
        const room = this.rooms.get(roomCode);
        if (!room) return { error: 'Salon introuvable' };
        if (room.gameState !== 'LOBBY') return { error: 'Partie déjà en cours' };

        const eligible = Array.from(room.players.values()).filter(p => !p.disconnected);
        if (eligible.length < 3) return { error: 'Minimum 3 joueurs requis' };

        room.lastActivity = Date.now();

        // Choisir un mot secret et sa catégorie, en évitant les mots déjà sortis
        room.usedWords = room.usedWords || [];
        const wordData = await getRandomWord(room.settings.categories, room.usedWords);
        if (!wordData) return { error: 'Aucun mot disponible' };
        room.currentWord = wordData;
        room.usedWords.push(wordData.word);
        if (room.usedWords.length > 60) room.usedWords.shift();

        // Mélanger l'ordre de dessin (joueurs connectés uniquement)
        const playerIds = eligible.map(p => p.id);
        room.drawOrder = this.shuffleArray([...playerIds]);

        // Assigner le ou les imposteurs
        const impostorCount = this.resolveImpostorCount(room, playerIds.length);
        room.impostorIds = this.shuffleArray([...playerIds]).slice(0, impostorCount);

        // Construire la drawQueue
        room.drawQueue = [];
        for (let r = 0; r < room.settings.roundsCount; r++) {
            room.drawQueue.push(...room.drawOrder);
        }

        room.gameState = 'PLAYING';
        room.currentRound = 1;
        room.totalRounds = room.settings.roundsCount;
        room.matchNumber = (room.matchNumber || 0) + 1;
        room.currentDrawerIndex = 0;
        room.currentDrawerId = room.drawQueue[0];
        room.canvasHistory = [];
        room.votes = {};
        room.voteTallies = {};
        room.accusedId = null;
        room.impostorGuess = null;
        room.guessingImpostorId = null;
        room.winner = null;
        room.roundScores = {};
        room.drawnBy = {};

        // Réinitialiser les confirmations des joueurs
        for (const p of room.players.values()) {
            p.hasConfirmedRole = false;
        }

        const impostorNames = room.impostorIds.map(id => room.players.get(id)?.name).join(', ');
        console.log(`[FAKE_ARTIST] Room ${roomCode} game started. Word: ${room.currentWord.word}, Impostor(s): ${impostorNames}`);

        return {
            success: true,
            roomCode,
            drawOrder: room.drawOrder,
            currentDrawerId: room.currentDrawerId,
            currentRound: room.currentRound,
            totalRounds: room.totalRounds,
            matchNumber: room.matchNumber,
            category: room.currentWord.category,
            impostorCount
        };
    }

    confirmRole(roomCode, playerId) {
        const room = this.rooms.get(roomCode);
        if (!room) return null;
        const player = room.players.get(playerId);
        if (!player) return null;
        player.hasConfirmedRole = true;
        room.lastActivity = Date.now();

        const active = Array.from(room.players.values()).filter(p => !p.disconnected);
        const ready = active.filter(p => p.hasConfirmedRole).length;
        return { ready, total: active.length, allReady: ready >= active.length };
    }

    /**
     * Nettoie un tracé reçu d'un client : borne le nombre de points,
     * l'épaisseur, et rejette toute coordonnée hors du canevas.
     * Le tracé est stocké en coordonnées normalisées [0,1].
     */
    sanitizeStroke(stroke) {
        if (!stroke || typeof stroke !== 'object') return { size: 8, points: [] };

        let points = Array.isArray(stroke.points) ? stroke.points : [];

        // Filtrer les points valides et les ramener dans le cadre
        points = points
            .filter(pt => pt && Number.isFinite(pt.x) && Number.isFinite(pt.y))
            .map(pt => ({
                x: Math.min(1, Math.max(0, pt.x)),
                y: Math.min(1, Math.max(0, pt.y))
            }));

        // Sous-échantillonner si le tracé est démesuré (anti-DoS mémoire/rendu)
        if (points.length > MAX_STROKE_POINTS) {
            const step = points.length / MAX_STROKE_POINTS;
            const reduced = [];
            for (let i = 0; i < MAX_STROKE_POINTS; i++) {
                reduced.push(points[Math.floor(i * step)]);
            }
            reduced.push(points[points.length - 1]); // toujours conserver la fin
            points = reduced;
        }

        const rawSize = Number(stroke.size);
        const size = Number.isFinite(rawSize)
            ? Math.min(MAX_STROKE_SIZE, Math.max(MIN_STROKE_SIZE, rawSize))
            : 8;

        return { size, points };
    }

    validateStroke(roomCode, playerId, stroke) {
        const room = this.rooms.get(roomCode);
        if (!room) return { error: 'Salon introuvable' };
        if (room.gameState !== 'PLAYING') return { error: 'Pas en phase de dessin' };
        if (room.currentDrawerId !== playerId) return { error: 'Ce n\'est pas votre tour' };

        room.lastActivity = Date.now();

        // Nettoyer le tracé et imposer la couleur du joueur (aucune confiance au client)
        const clean = this.sanitizeStroke(stroke);
        const player = room.players.get(playerId);
        clean.color = player?.color?.value || '#1a1a1a';
        clean.playerId = playerId;
        clean.playerName = player?.name || '';
        room.canvasHistory.push(clean);
        if (clean.points.length > 0) {
            room.drawnBy = room.drawnBy || {};
            room.drawnBy[playerId] = true;
        }

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
            room.voteStartTime = Date.now();
            console.log(`[FAKE_ARTIST] Room ${roomCode} transitioned to VOTING`);
            return {
                success: true,
                nextPhase: 'VOTING',
                canvasHistory: room.canvasHistory,
                voteStartTime: room.voteStartTime,
                voteDuration: room.settings.voteDuration
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
        if (voterId === votedId) return { error: 'Impossible de voter pour soi-même' };
        if (room.votes[voterId]) return { error: 'Vous avez déjà voté' };

        room.votes[voterId] = votedId;
        room.lastActivity = Date.now();

        if (this.everyoneHasVoted(room)) {
            return this.resolveVotes(roomCode);
        }

        return {
            success: true,
            votingFinished: false,
            players: this.getPlayersInRoom(roomCode)
        };
    }

    /**
     * Vrai quand tous les joueurs encore connectés ont voté.
     * Les votes des joueurs partis en cours de phase sont ignorés du décompte,
     * ce qui évite à la fois le déclenchement prématuré et le blocage définitif.
     */
    everyoneHasVoted(room) {
        const active = Array.from(room.players.values()).filter(p => !p.disconnected);
        if (active.length === 0) return true;
        return active.every(p => !!room.votes[p.id]);
    }

    /**
     * Dépouille les votes.
     * @param {boolean} forced — résolution anticipée (minuteur écoulé ou hôte).
     */
    resolveVotes(roomCode, forced = false) {
        const room = this.rooms.get(roomCode);
        if (!room) return { error: 'Salon introuvable' };
        if (room.gameState !== 'VOTING') return { error: 'Pas en phase de vote' };

        // Compter les votes (en ignorant ceux qui visent un joueur disparu)
        const voteTallies = {};
        for (const voterId in room.votes) {
            const votedId = room.votes[voterId];
            if (!room.players.has(votedId)) continue;
            voteTallies[votedId] = (voteTallies[votedId] || 0) + 1;
        }
        room.voteTallies = voteTallies;

        // Trouver le plus voté
        let maxVotes = 0;
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

        // Égalité (ou aucun vote) : personne n'est désigné.
        // Règle du jeu original — le doute profite à l'imposteur.
        const isTie = candidates.length !== 1;
        const accusedId = isTie ? null : candidates[0];
        room.accusedId = accusedId;

        const accusedIsImpostor = accusedId !== null && room.impostorIds.includes(accusedId);

        // Toujours passer par REVEAL : c'est là que le dépouillement est montré.
        room.gameState = 'REVEAL';
        room.revealStartTime = Date.now();
        room.pendingOutcome = accusedIsImpostor ? 'GUESSING' : 'GAME_END';

        if (accusedIsImpostor) {
            room.guessingImpostorId = accusedId;
        }

        console.log(`[FAKE_ARTIST] Room ${roomCode}: vote resolved (forced=${forced}, tie=${isTie}, accused=${accusedId ? room.players.get(accusedId)?.name : 'aucun'}, impostor=${accusedIsImpostor})`);

        return {
            success: true,
            votingFinished: true,
            forced,
            nextPhase: 'REVEAL',
            isTie,
            accusedId,
            accusedName: accusedId ? room.players.get(accusedId)?.name : null,
            accusedAvatar: accusedId ? room.players.get(accusedId)?.avatar : null,
            accusedColor: accusedId ? room.players.get(accusedId)?.color : null,
            isImpostorAccused: accusedIsImpostor,
            voteTallies,
            maxVotes,
            players: this.getPlayersInRoom(roomCode),
            votes: room.votes
        };
    }

    /**
     * Ferme la phase REVEAL et bascule vers la suite (devinette ou fin).
     * Attribue au passage les points liés au vote.
     */
    concludeReveal(roomCode) {
        const room = this.rooms.get(roomCode);
        if (!room) return { error: 'Salon introuvable' };
        if (room.gameState !== 'REVEAL') return { error: 'Pas en phase de révélation' };

        room.lastActivity = Date.now();

        if (room.pendingOutcome === 'GUESSING') {
            // L'imposteur démasqué a droit à sa dernière chance
            room.gameState = 'GUESSING';
            room.guessStartTime = Date.now();
            return {
                success: true,
                nextPhase: 'GUESSING',
                accusedId: room.accusedId,
                accusedName: room.players.get(room.accusedId)?.name || '',
                guessStartTime: room.guessStartTime,
                guessDuration: room.settings.guessDuration
            };
        }

        // Les artistes se sont trompés (ou égalité) : l'imposteur l'emporte
        this.awardScores(room, 'impostor', { impostorGuessed: false, survived: true });
        room.gameState = 'GAME_END';
        room.winner = 'impostor';
        room.gameEndTime = Date.now();

        return {
            success: true,
            nextPhase: 'GAME_END',
            winner: 'impostor',
            reason: room.accusedId ? 'wrong-accusation' : 'tie',
            secretWord: room.currentWord.word,
            impostors: this.describeImpostors(room),
            players: this.getPlayersInRoom(roomCode)
        };
    }

    /** Détail public des imposteurs — à n'envoyer qu'en fin de partie. */
    describeImpostors(room) {
        return room.impostorIds.map(id => {
            const p = room.players.get(id);
            return p ? { id: p.id, name: p.name, avatar: p.avatar, color: p.color } : null;
        }).filter(Boolean);
    }

    /**
     * Attribue les points de la manche.
     * @param {'artists'|'impostor'} winner
     */
    awardScores(room, winner, { impostorGuessed = false, survived = false } = {}) {
        room.roundScores = {};
        const add = (id, pts) => {
            const p = room.players.get(id);
            if (!p) return;
            p.score += pts;
            room.roundScores[id] = (room.roundScores[id] || 0) + pts;
        };

        if (winner === 'impostor') {
            const pts = survived ? SCORE.IMPOSTOR_SURVIVES : SCORE.IMPOSTOR_GUESSES;
            for (const id of room.impostorIds) add(id, pts);
        } else {
            // Victoire des artistes : base pour tous, bonus pour les bons votes
            for (const [id] of room.players) {
                if (room.impostorIds.includes(id)) continue;
                add(id, SCORE.ARTIST_WIN);
            }
        }

        // Bonus individuel : avoir voté juste, quel que soit le vainqueur
        for (const voterId in room.votes) {
            if (room.impostorIds.includes(voterId)) continue;
            if (room.impostorIds.includes(room.votes[voterId])) {
                add(voterId, SCORE.ARTIST_CORRECT_VOTE);
            }
        }
    }

    submitImpostorGuess(roomCode, playerId, guess) {
        const room = this.rooms.get(roomCode);
        if (!room) return { error: 'Salon introuvable' };
        if (room.gameState !== 'GUESSING') return { error: 'Pas en phase de devinette' };
        if (room.guessingImpostorId !== playerId) return { error: 'Seul l\'imposteur démasqué peut deviner' };
        if (room.impostorGuess) return { error: 'Proposition déjà envoyée' };

        const clean = String(guess || '').trim().slice(0, 60);
        if (!clean) return { error: 'Proposition vide' };

        room.impostorGuess = clean;
        room.lastActivity = Date.now();

        const autoCorrect = this.normalizeText(clean) === this.normalizeText(room.currentWord.word);

        console.log(`[FAKE_ARTIST] Room ${roomCode}: Impostor guessed '${clean}' (Secret: '${room.currentWord.word}'). AutoCorrect: ${autoCorrect}`);

        return {
            success: true,
            guess: clean,
            autoCorrect,
            secretWord: room.currentWord.word
        };
    }

    /**
     * Clôt la manche après arbitrage de l'hôte (ou expiration du minuteur).
     */
    resolveHostDecision(roomCode, isCorrect) {
        const room = this.rooms.get(roomCode);
        if (!room) return { error: 'Salon introuvable' };
        if (room.gameState !== 'GUESSING') return { error: 'Pas en phase de devinette' };

        room.gameState = 'GAME_END';
        room.gameEndTime = Date.now();
        room.lastActivity = Date.now();

        if (isCorrect) {
            room.winner = 'impostor';
            this.awardScores(room, 'impostor', { impostorGuessed: true, survived: false });
        } else {
            room.winner = 'artists';
            this.awardScores(room, 'artists');
        }

        console.log(`[FAKE_ARTIST] Room ${roomCode} resolved by host. Winner: ${room.winner}`);

        return {
            success: true,
            winner: room.winner,
            reason: isCorrect ? 'impostor-guessed' : 'impostor-failed',
            secretWord: room.currentWord.word,
            impostorGuess: room.impostorGuess,
            impostors: this.describeImpostors(room),
            players: this.getPlayersInRoom(roomCode),
            results: this.getPlayersInRoom(roomCode)
        };
    }

    restartGame(roomCode, { resetScores = false } = {}) {
        const room = this.rooms.get(roomCode);
        if (!room) return { error: 'Salon introuvable' };

        this.clearRoomTimers(room);

        room.gameState = 'LOBBY';
        room.currentRound = 0;
        room.totalRounds = 0;
        room.drawOrder = [];
        room.drawQueue = [];
        room.currentDrawerId = null;
        room.currentDrawerIndex = 0;
        room.impostorIds = [];
        room.currentWord = null;
        room.canvasHistory = [];
        room.votes = {};
        room.voteTallies = {};
        room.accusedId = null;
        room.impostorGuess = null;
        room.guessingImpostorId = null;
        room.winner = null;
        room.roundScores = {};
        room.drawnBy = {};
        room.pendingOutcome = null;

        // Les couleurs sont conservées d'une manche à l'autre : les joueurs
        // mémorisent « le trait rouge, c'était Pierre ». Seuls les nouveaux
        // arrivants et les collisions éventuelles sont réattribués.
        const seen = new Set();
        for (const player of room.players.values()) {
            player.hasConfirmedRole = false;
            if (resetScores) player.score = 0;
            if (!player.color || seen.has(player.color.value)) {
                player.color = this.assignColorToPlayer(room);
            }
            seen.add(player.color.value);
        }

        console.log(`[FAKE_ARTIST] Room ${roomCode} reset to LOBBY (resetScores=${resetScores})`);
        return {
            success: true,
            roomCode,
            matchNumber: room.matchNumber,
            players: this.getPlayersInRoom(roomCode)
        };
    }

    // removePlayer, shuffleArray et normalizeText viennent de RoomBase.
}

module.exports = new FakeArtistGameManager();
module.exports.SCORE = SCORE;
module.exports.PLAYER_COLORS = PLAYER_COLORS;
