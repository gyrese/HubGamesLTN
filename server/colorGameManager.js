/**
 * CouleurMoi (Toon Tone clone) Game Manager
 */

const crypto = require('crypto');
const colorCharacters = require('./colorCharacters');

// ──────────────────────────────────────────────────────────────
// Couleur perceptuelle (CIELab) — pour un score fidèle à l'œil
// ──────────────────────────────────────────────────────────────
function hsbToRgb(h, s, b) {
    s /= 100; b /= 100;
    const c = b * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = b - c;
    let r = 0, g = 0, bl = 0;
    if (h < 60) { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; bl = x; }
    else if (h < 240) { g = x; bl = c; }
    else if (h < 300) { r = x; bl = c; }
    else { r = c; bl = x; }
    return [r + m, g + m, bl + m]; // 0..1
}

function rgbToLab(r, g, b) {
    const lin = (u) => (u <= 0.04045 ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4));
    r = lin(r); g = lin(g); b = lin(b);
    // RGB linéaire -> XYZ (sRGB / D65), puis normalisation au blanc D65
    let X = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
    let Y = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 1.0;
    let Z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
    const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    const fx = f(X), fy = f(Y), fz = f(Z);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]; // L, a, b
}

function hsbToLab(h, s, b) {
    const [r, g, bl] = hsbToRgb(h, s, b);
    return rgbToLab(r, g, bl);
}

function deltaE76(l1, l2) {
    const dL = l1[0] - l2[0], da = l1[1] - l2[1], db = l1[2] - l2[2];
    return Math.sqrt(dL * dL + da * da + db * db);
}

class ColorGameManager {
    constructor() {
        this.rooms = new Map(); // Map<roomCode, ColorRoom>
        
        // Periodic cleanup of dead rooms (every 5 mins)
        setInterval(() => this.cleanupRooms(), 5 * 60 * 1000);
    }

    cleanupRooms() {
        const now = Date.now();
        const GAME_END_TTL = 30 * 60 * 1000; // 30 min after GAME_END
        const STALE_TTL = 60 * 60 * 1000;    // 1h without activity

        for (const [code, room] of this.rooms) {
            const gameEndRef = room.gameEndTime || room.roundStartTime;
            if (room.gameState === 'GAME_END' && gameEndRef && (now - gameEndRef) > GAME_END_TTL) {
                console.log(`[COLOR] Cleanup: room ${code} (GAME_END for ${Math.round((now - gameEndRef) / 60000)} min)`);
                this.deleteRoom(code);
                continue;
            }
            const activePlayers = Array.from(room.players.values()).filter(p => !p.disconnected);
            if (activePlayers.length === 0 && room.players.size > 0 && room.roundStartTime && (now - room.roundStartTime) > STALE_TTL) {
                console.log(`[COLOR] Cleanup: room ${code} (no active players for ${Math.round((now - room.roundStartTime) / 60000)} min)`);
                this.deleteRoom(code);
            }
        }
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
            roundsCount: 5,        // Number of rounds
            timePerRound: 60,      // Seconds per round
        };

        this.rooms.set(roomCode, {
            code: roomCode,
            remoteToken: crypto.randomBytes(16).toString('hex'),
            hostId: hostId,
            players: new Map(),    // Map<socketId, PlayerData>
            gameState: 'LOBBY',    // LOBBY, PLAYING, ROUND_END, GAME_END
            currentRound: 0,
            totalRounds: settings.roundsCount || defaultSettings.roundsCount,
            timePerRound: settings.timePerRound || defaultSettings.timePerRound,
            characters: [],        // Selected characters for this game
            currentCharacter: null, // Current character metadata
            roundStartTime: null,
            settings: { ...defaultSettings, ...settings }
        });

        return roomCode;
    }

    getRoom(roomCode) {
        return this.rooms.get(roomCode);
    }

    joinRoom(roomCode, playerId, playerName, avatar) {
        const room = this.rooms.get(roomCode);
        if (!room) return { error: 'Salon introuvable' };

        // Check for reconnection
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

            console.log(`[COLOR] Player ${playerName} reconnected to room ${roomCode}`);

            return {
                success: true,
                room,
                reconnected: true,
                gameState: room.gameState,
                currentRound: room.currentRound,
                totalRounds: room.totalRounds,
                character: room.currentCharacter,
                roundStartTime: room.roundStartTime,
                timePerRound: room.timePerRound,
                myScore: playerData.totalScore
            };
        }

        const isLateJoin = room.gameState !== 'LOBBY';
        const missedRounds = isLateJoin ? room.currentRound - 1 : 0;

        room.players.set(playerId, {
            id: playerId,
            name: playerName,
            avatar: avatar || null,
            totalScore: 0,
            roundScores: Array(missedRounds).fill(0),
            roundGuesses: Array(missedRounds).fill(null),
            currentGuess: null,
            hasGuessed: room.gameState === 'PLAYING' ? false : true,
            roundTimes: Array(missedRounds).fill(null),
            roundHints: Array(missedRounds).fill(false),
            hintUsedThisRound: false,
            lateJoin: isLateJoin,
            joinedAtRound: isLateJoin ? room.currentRound : 0
        });

        console.log(`[COLOR] Player ${playerName} joined room ${roomCode}${isLateJoin ? ` (late join at round ${room.currentRound})` : ''}`);

        return {
            success: true,
            room,
            lateJoin: isLateJoin,
            gameState: room.gameState,
            currentRound: room.currentRound,
            totalRounds: room.totalRounds,
            character: room.currentCharacter,
            roundStartTime: room.roundStartTime,
            timePerRound: room.timePerRound,
            missedRounds
        };
    }

    async startGame(roomCode) {
        const room = this.rooms.get(roomCode);
        if (!room) return { error: 'Salon introuvable' };

        room.gameState = 'PLAYING';
        room.currentRound = 1;
        room.characters = await colorCharacters.getRandomSet(room.totalRounds);
        
        if (room.characters.length === 0) {
            return { error: 'Aucun personnage disponible dans la base de données' };
        }

        // Adjust total rounds if we have fewer characters in database
        if (room.characters.length < room.totalRounds) {
            room.totalRounds = room.characters.length;
        }

        // Pre-generate random initial HSB colors for all characters
        room.characters.forEach(char => {
            char.random_h = Math.floor(Math.random() * 360);
            char.random_s = Math.floor(Math.random() * 60) + 30; // 30% - 90%
            char.random_b = Math.floor(Math.random() * 60) + 30; // 30% - 90%
        });

        room.currentCharacter = room.characters[0];
        room.roundStartTime = Date.now();

        // Reset player scores
        for (const player of room.players.values()) {
            player.totalScore = 0;
            player.roundScores = [];
            player.roundGuesses = [];
            player.roundTimes = [];
            player.roundHints = [];
            player.currentGuess = null;
            player.hasGuessed = false;
            player.hintUsedThisRound = false;
        }

        return {
            success: true,
            character: room.currentCharacter,
            round: 1,
            total: room.totalRounds
        };
    }

    submitGuess(roomCode, playerId, h, s, b, hintUsed) {
        const room = this.rooms.get(roomCode);
        if (!room) return { error: 'Salon introuvable' };
        if (room.gameState !== 'PLAYING') return { error: 'Partie non en cours' };

        const player = room.players.get(playerId);
        if (!player) return { error: 'Joueur introuvable' };
        if (player.hasGuessed) return { error: 'Déjà répondu' };

        const guess = { h, s, b };
        const target = {
            h: room.currentCharacter.target_h,
            s: room.currentCharacter.target_s,
            b: room.currentCharacter.target_b
        };

        const score = this.calculateScore(guess, target, hintUsed);
        const timeTaken = (Date.now() - room.roundStartTime) / 1000;

        player.currentGuess = guess;
        player.hasGuessed = true;
        player.hintUsedThisRound = hintUsed;

        player.roundScores.push(score);
        player.totalScore += score;
        player.roundGuesses.push(guess);
        player.roundTimes.push(timeTaken);
        player.roundHints.push(hintUsed);

        const allGuessed = this.allPlayersGuessed(roomCode);

        return {
            success: true,
            score,
            allGuessed
        };
    }

    calculateScore(guess, target, hintUsed) {
        // Score perceptuel basé sur la distance CIELab (ΔE76) : il reflète l'écart RÉELLEMENT
        // perçu entre les deux couleurs (teinte + saturation + luminosité combinées). Une moyenne
        // pondérée en HSB pardonnait trop les erreurs de teinte (couleur clairement différente mais
        // bonne note). En Lab, une teinte fausse sur une couleur vive donne un grand ΔE → note basse,
        // et une teinte fausse sur un gris donne un petit ΔE → tolérée (comme à l'œil).
        const dE = deltaE76(hsbToLab(guess.h, guess.s, guess.b), hsbToLab(target.h, target.s, target.b));

        // Mapping ΔE -> note /10. ~0 = parfait ; ~16 ≈ "très proche" (8) ; ~32 ≈ "à côté" (4) ;
        // ≥ DE_ZERO ≈ couleur clairement différente -> 0.
        const DE_ZERO = 55;
        let score = 10 * Math.max(0, 1 - dE / DE_ZERO);

        // Malus de 1 point si un indice a été utilisé
        if (hintUsed) {
            score = Math.max(0, score - 1.0);
        }

        return Math.round(score * 100) / 100; // 2 décimales
    }

    endRound(roomCode) {
        const room = this.rooms.get(roomCode);
        if (!room) return { error: 'Salon introuvable' };

        if (room.gameState === 'ROUND_END') {
            const results = [];
            for (const player of room.players.values()) {
                results.push({
                    id: player.id,
                    name: player.name,
                    avatar: player.avatar,
                    guess: player.currentGuess,
                    roundScore: player.roundScores[player.roundScores.length - 1] || 0,
                    totalScore: player.totalScore,
                    hasGuessed: player.hasGuessed,
                    hintUsed: player.hintUsedThisRound
                });
            }
            results.sort((a, b) => b.roundScore - a.roundScore);
            return {
                success: true,
                character: room.currentCharacter,
                results,
                currentRound: room.currentRound,
                totalRounds: room.totalRounds
            };
        }

        if (room.gameState !== 'PLAYING') {
            return { error: `Cannot end round: game is in state ${room.gameState}` };
        }

        room.gameState = 'ROUND_END';

        const results = [];
        for (const player of room.players.values()) {
            if (!player.hasGuessed) {
                player.roundScores.push(0);
                player.roundGuesses.push(null);
                player.roundTimes.push(null);
                player.roundHints.push(false);
            }

            results.push({
                id: player.id,
                name: player.name,
                avatar: player.avatar,
                guess: player.currentGuess,
                roundScore: player.roundScores[player.roundScores.length - 1] || 0,
                totalScore: player.totalScore,
                hasGuessed: player.hasGuessed,
                hintUsed: player.hintUsedThisRound
            });
        }

        results.sort((a, b) => b.roundScore - a.roundScore);

        return {
            success: true,
            character: room.currentCharacter,
            results,
            currentRound: room.currentRound,
            totalRounds: room.totalRounds
        };
    }

    nextRound(roomCode) {
        const room = this.rooms.get(roomCode);
        if (!room) return { error: 'Salon introuvable' };

        if (room.gameState !== 'ROUND_END') {
            return { error: `Cannot advance: game is in state ${room.gameState}` };
        }

        room.currentRound++;

        if (room.currentRound > room.totalRounds) {
            room.gameState = 'GAME_END';
            room.gameEndTime = Date.now();

            const finalResults = [];
            for (const player of room.players.values()) {
                finalResults.push({
                    id: player.id,
                    name: player.name,
                    avatar: player.avatar,
                    totalScore: player.totalScore,
                    roundScores: player.roundScores
                });
            }
            finalResults.sort((a, b) => b.totalScore - a.totalScore);

            return {
                gameOver: true,
                results: finalResults,
                awards: this.calculateAwards(roomCode)
            };
        }

        room.gameState = 'PLAYING';
        room.currentCharacter = room.characters[room.currentRound - 1];
        room.roundStartTime = Date.now();

        for (const player of room.players.values()) {
            player.currentGuess = null;
            player.hasGuessed = false;
            player.hintUsedThisRound = false;
        }

        return {
            success: true,
            round: room.currentRound,
            total: room.totalRounds,
            timePerRound: room.timePerRound,
            character: room.currentCharacter
        };
    }

    restartGame(roomCode) {
        const room = this.rooms.get(roomCode);
        if (!room) return { error: 'Salon introuvable' };

        room.gameState = 'LOBBY';
        room.currentRound = 0;
        room.currentCharacter = null;
        room.characters = [];
        room.roundStartTime = null;
        room.gameEndTime = null;

        for (const player of room.players.values()) {
            player.totalScore = 0;
            player.roundScores = [];
            player.roundGuesses = [];
            player.roundTimes = [];
            player.roundHints = [];
            player.currentGuess = null;
            player.hasGuessed = false;
            player.hintUsedThisRound = false;
            player.disconnected = false;
        }

        return { success: true, room };
    }

    kickPlayer(roomCode, playerId) {
        const room = this.rooms.get(roomCode);
        if (!room) return { error: 'Salon introuvable' };

        if (room.players.has(playerId)) {
            room.players.delete(playerId);
            return { success: true };
        }
        return { error: 'Joueur introuvable' };
    }

    deleteRoom(roomCode) {
        const room = this.rooms.get(roomCode);
        if (room) {
            if (room.roundTimer) {
                clearTimeout(room.roundTimer);
                room.roundTimer = null;
            }
            this.rooms.delete(roomCode);
            console.log(`[COLOR] Room ${roomCode} deleted`);
        }
    }

    removePlayer(playerId) {
        for (const [code, room] of this.rooms) {
            if (room.hostId === playerId) {
                room.hostDisconnected = true;
                return { roomCode: code, room, isHost: true };
            }

            if (room.players.has(playerId)) {
                if (room.gameState !== 'LOBBY') {
                    const player = room.players.get(playerId);
                    player.disconnected = true;
                    return { roomCode: code, room, isHost: false, type: 'disconnected', player };
                }

                room.players.delete(playerId);
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

    allPlayersGuessed(roomCode) {
        const room = this.rooms.get(roomCode);
        if (!room) return false;

        const activePlayers = Array.from(room.players.values()).filter(p => !p.disconnected);
        if (activePlayers.length === 0) return false;

        for (const player of activePlayers) {
            if (!player.hasGuessed) return false;
        }
        return true;
    }

    calculateAwards(roomCode) {
        const room = this.rooms.get(roomCode);
        if (!room) return [];

        let fastestPlayer = null;
        let fastestTime = Infinity;

        let colorblindPlayer = null;
        let lowestAverageScore = Infinity;

        let perfectionistPlayer = null;
        let highestSingleScore = -1;

        for (const player of room.players.values()) {
            if (player.roundTimes.length === 0) continue;

            // Average response time
            const validTimes = player.roundTimes.filter(t => t !== null);
            if (validTimes.length > 0) {
                const avgTime = validTimes.reduce((a, b) => a + b, 0) / validTimes.length;
                if (avgTime < fastestTime) {
                    fastestTime = avgTime;
                    fastestPlayer = player;
                }
            }

            // Lowest average score
            const validScores = player.roundScores.filter(s => s !== null);
            if (validScores.length > 0) {
                const avgScore = validScores.reduce((a, b) => a + b, 0) / validScores.length;
                if (avgScore < lowestAverageScore) {
                    lowestAverageScore = avgScore;
                    colorblindPlayer = player;
                }

                // Highest single score
                const maxScore = Math.max(...validScores);
                if (maxScore > highestSingleScore) {
                    highestSingleScore = maxScore;
                    perfectionistPlayer = player;
                }
            }
        }

        const awards = [];
        if (fastestPlayer && fastestTime < Infinity) {
            awards.push({
                type: 'fastest',
                title: 'L\'Éclair',
                icon: '⚡',
                playerId: fastestPlayer.id,
                playerName: fastestPlayer.name,
                avatar: fastestPlayer.avatar,
                value: `${fastestTime.toFixed(1)}s (moyenne)`
            });
        }
        if (colorblindPlayer && lowestAverageScore < 10) {
            awards.push({
                type: 'colorblind',
                title: 'Le Daltonien',
                icon: '🕶️',
                playerId: colorblindPlayer.id,
                playerName: colorblindPlayer.name,
                avatar: colorblindPlayer.avatar,
                value: `${lowestAverageScore.toFixed(2)}/10 (moyenne)`
            });
        }
        if (perfectionistPlayer && highestSingleScore > 0) {
            awards.push({
                type: 'perfectionist',
                title: 'Le Perfectionniste',
                icon: '🎯',
                playerId: perfectionistPlayer.id,
                playerName: perfectionistPlayer.name,
                avatar: perfectionistPlayer.avatar,
                value: `${highestSingleScore.toFixed(2)}/10 (max)`
            });
        }

        return awards;
    }
}

module.exports = new ColorGameManager();
