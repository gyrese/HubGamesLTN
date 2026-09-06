/**
 * CouleurMoi (Toon Tone clone) Game Manager
 */

const crypto = require('crypto');
const RoomBase = require('./core/RoomBase');
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

// ΔE2000 (CIEDE2000, Sharma et al. 2005) — remplace ΔE76 qui est très non-uniforme
// dans les bleus saturés : deux bleus quasi identiques y scoraient moins bien que des
// couleurs franchement différentes. ΔE2000 corrige la pondération chroma (SC/SH) et
// la zone bleue (terme de rotation RT). Implémentation validée sur les paires de test
// officielles du papier (9/9 à 1e-4).
function deltaE2000(lab1, lab2) {
    const [L1, a1, b1] = lab1, [L2, a2, b2] = lab2;
    const rad = Math.PI / 180, deg = 180 / Math.PI;
    const C1 = Math.sqrt(a1 * a1 + b1 * b1);
    const C2 = Math.sqrt(a2 * a2 + b2 * b2);
    const Cb = (C1 + C2) / 2;
    const G = 0.5 * (1 - Math.sqrt(Math.pow(Cb, 7) / (Math.pow(Cb, 7) + Math.pow(25, 7))));
    const a1p = a1 * (1 + G), a2p = a2 * (1 + G);
    const C1p = Math.sqrt(a1p * a1p + b1 * b1);
    const C2p = Math.sqrt(a2p * a2p + b2 * b2);
    let h1p = C1p === 0 ? 0 : Math.atan2(b1, a1p) * deg; if (h1p < 0) h1p += 360;
    let h2p = C2p === 0 ? 0 : Math.atan2(b2, a2p) * deg; if (h2p < 0) h2p += 360;
    const dLp = L2 - L1;
    const dCp = C2p - C1p;
    let dhp = 0;
    if (C1p * C2p !== 0) {
        dhp = h2p - h1p;
        if (dhp > 180) dhp -= 360;
        else if (dhp < -180) dhp += 360;
    }
    const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * rad);
    const Lbp = (L1 + L2) / 2;
    const Cbp = (C1p + C2p) / 2;
    let hbp = h1p + h2p;
    if (C1p * C2p !== 0) {
        if (Math.abs(h1p - h2p) > 180) hbp += (hbp < 360 ? 360 : -360);
        hbp /= 2;
    }
    const T = 1 - 0.17 * Math.cos((hbp - 30) * rad) + 0.24 * Math.cos(2 * hbp * rad)
        + 0.32 * Math.cos((3 * hbp + 6) * rad) - 0.20 * Math.cos((4 * hbp - 63) * rad);
    const dTheta = 30 * Math.exp(-Math.pow((hbp - 275) / 25, 2));
    const RC = 2 * Math.sqrt(Math.pow(Cbp, 7) / (Math.pow(Cbp, 7) + Math.pow(25, 7)));
    const SL = 1 + (0.015 * Math.pow(Lbp - 50, 2)) / Math.sqrt(20 + Math.pow(Lbp - 50, 2));
    const SC = 1 + 0.045 * Cbp;
    const SH = 1 + 0.015 * Cbp * T;
    const RT = -Math.sin(2 * dTheta * rad) * RC;
    return Math.sqrt(
        Math.pow(dLp / SL, 2) + Math.pow(dCp / SC, 2) + Math.pow(dHp / SH, 2)
        + RT * (dCp / SC) * (dHp / SH)
    );
}

class ColorGameManager extends RoomBase {
    constructor() {
        super({
            logTag: 'COLOR',
            codeFormat: 'alpha6',
            cleanupIntervalMs: 5 * 60 * 1000,
            endStates: ['GAME_END'],
            endedTtlMs: 30 * 60 * 1000,  // 30 min après GAME_END
            staleTtlMs: 60 * 60 * 1000   // 1 h sans activité
        });
    }

    defaultSettings() {
        return {
            roundsCount: 5,        // Nombre de manches
            timePerRound: 60,      // Secondes par manche
        };
    }

    createRoomState(settings = {}) {
        const d = this.defaultSettings();
        return {
            remoteToken: crypto.randomBytes(16).toString('hex'),
            // LOBBY, PLAYING, ROUND_END, GAME_END
            currentRound: 0,
            totalRounds: settings.roundsCount || d.roundsCount,
            timePerRound: settings.timePerRound || d.timePerRound,
            characters: [],         // Personnages tirés pour cette partie
            currentCharacter: null, // Métadonnées du personnage courant
            roundStartTime: null,
        };
    }

    /** CouleurMoi accepte les arrivants en cours de partie. */
    canJoinMidGame() {
        return true;
    }

    createPlayer(playerId, playerName, avatar, room) {
        // Les manches déjà jouées sont comptées à zéro pour l'arrivant, afin que
        // les tableaux de scores restent alignés d'un joueur à l'autre.
        const isLateJoin = room.gameState !== 'LOBBY';
        const missedRounds = isLateJoin ? Math.max(0, room.currentRound - 1) : 0;

        return {
            id: playerId,
            name: playerName,
            avatar: avatar || null,
            disconnected: false,
            totalScore: 0,
            roundScores: Array(missedRounds).fill(0),
            roundGuesses: Array(missedRounds).fill(null),
            currentGuess: null,
            hasGuessed: room.gameState === 'PLAYING' ? false : true,
            roundTimes: Array(missedRounds).fill(null),
            roundHints: Array(missedRounds).fill(false),
            hintUsedThisRound: false,
            lateJoin: isLateJoin,
            joinedAtRound: isLateJoin ? room.currentRound : 0,
            missedRounds
        };
    }

    describeRejoin(room, player) {
        return {
            gameState: room.gameState,
            currentRound: room.currentRound,
            totalRounds: room.totalRounds,
            character: room.currentCharacter,
            roundStartTime: room.roundStartTime,
            timePerRound: room.timePerRound,
            myScore: player.totalScore
        };
    }

    describeJoin(room, player) {
        return {
            gameState: room.gameState,
            currentRound: room.currentRound,
            totalRounds: room.totalRounds,
            character: room.currentCharacter,
            roundStartTime: room.roundStartTime,
            timePerRound: room.timePerRound,
            missedRounds: player.missedRounds
        };
    }

    async startGame(roomCode) {
        const room = this.rooms.get(roomCode);
        if (!room) return { error: 'Salon introuvable' };

        room.gameState = 'PLAYING';
        room.currentRound = 1;
        const category = room.settings?.category || null;
        room.characters = await colorCharacters.getRandomSet(room.totalRounds, category);

        // Si l'univers choisi est (devenu) vide, on retombe sur le catalogue complet
        // plutôt que de bloquer la partie.
        if (room.characters.length === 0 && category) {
            room.characters = await colorCharacters.getRandomSet(room.totalRounds, null);
        }

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
        // Score perceptuel basé sur la distance CIEDE2000 : il reflète l'écart RÉELLEMENT
        // perçu entre les deux couleurs (teinte + saturation + luminosité combinées),
        // y compris dans les bleus saturés où ΔE76 était trompeur (deux bleus quasi
        // identiques pouvaient scorer moins bien que rouge vs orange).
        const dE = deltaE2000(hsbToLab(guess.h, guess.s, guess.b), hsbToLab(target.h, target.s, target.b));

        // Plateau de tolérance (ΔE00 <= 2 ≈ indiscernable -> parfait 10/10), décroissance
        // douce (exposant 0.8), zéro pour les couleurs vraiment fausses (ΔE00 >= 42).
        // Échelle ΔE2000 ≠ ΔE76 : ~1-2 = imperceptible, ~10 = proche, ~25 = très différent.
        const DE_TOLERANCE = 2.0;
        const DE_MAX = 42.0;
        const EXPONENT = 0.8;

        let score = 0;
        if (dE <= DE_TOLERANCE) {
            score = 10;
        } else if (dE >= DE_MAX) {
            score = 0;
        } else {
            const normalizedDiff = (dE - DE_TOLERANCE) / (DE_MAX - DE_TOLERANCE);
            score = 10 * Math.pow(1 - normalizedDiff, EXPONENT);
        }

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

    /** Le minuteur de manche ne doit pas survivre au salon. */
    onRoomDisposed(room) {
        if (room.roundTimer) {
            clearTimeout(room.roundTimer);
            room.roundTimer = null;
        }
    }

    /**
     * CouleurMoi expose l'objet joueur complet : le contrôleur et les vues
     * s'appuient sur les tableaux de manches (roundScores, roundGuesses…).
     */
    describePlayer(p) {
        return p;
    }

    // kickPlayer, deleteRoom et removePlayer viennent de RoomBase.

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
