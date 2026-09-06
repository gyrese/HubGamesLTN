const RoomBase = require('./core/RoomBase');

// Profil joueur : tout est optionnel/sautable. Sert uniquement aux
// « stats absurdes » de fin de partie (cf. funStats.js). Les clés doivent
// rester alignées avec funStats.CATEGORIES et PlayerView.
function createEmptyProfile() {
    return {
        favoriteAnimal: null,
        zodiacSign: null,
        coffeesPerDay: null,
        bedtime: null,
        isSportive: null,
        painChocolat: null,
        pineapplePizza: null,
        hairColor: null,
    };
}

class GameManager extends RoomBase {
    constructor() {
        super({
            logTag: 'QUIZ',
            codeFormat: 'num4',
            endStates: ['END', 'SERIES_END'],
            endedTtlMs: 30 * 60 * 1000,   // 30 min après la fin
            staleTtlMs: 2 * 60 * 60 * 1000 // 2 h sans activité
        });
    }

    /**
     * Le quiz expire ses salons sur l'inactivité seule, sans regarder qui reste
     * connecté : un salon oublié doit partir même si des sockets fantômes y
     * traînent encore.
     */
    cleanupRooms() {
        const now = Date.now();
        for (const [code, room] of this.rooms) {
            const ref = room.lastActivity || room.createdAt || 0;
            if (this.endStates.includes(room.gameState) && (now - ref) > this.endedTtlMs) {
                this.deleteRoom(code);
                continue;
            }
            if ((now - ref) > this.staleTtlMs) {
                this.deleteRoom(code);
            }
        }
    }

    /** État de partie propre au quiz. */
    createRoomState() {
        return {
            currentQuestionIndex: 0,
            questions: [],           // Array of questions
            questionStartTime: null, // Timestamp du début de la question
            questionEnded: false,    // true quand la question courante affiche ses résultats (RESULT)
            questionsPlayed: 0,      // nb de questions jouées sur toute la soirée (toutes séries)
            // Réglages de partie (persistés entre séries), pilotés par l'hôte au lobby.
            questionDuration: 20,    // secondes par question
            autoAdvance: false,      // enchaînement automatique des questions
            // Timing autoritaire serveur (cf. quizController).
            questionTimer: null,     // timeout de fin de question
            resultTimer: null,       // timeout d'auto-avance après résultats
        };
    }

    /** Les minuteurs de question ne doivent pas survivre au salon. */
    onRoomDisposed(room) {
        if (room.questionTimer) { clearTimeout(room.questionTimer); room.questionTimer = null; }
        if (room.resultTimer) { clearTimeout(room.resultTimer); room.resultTimer = null; }
        for (const p of room.players.values()) {
            if (p.removalTimer) { clearTimeout(p.removalTimer); p.removalTimer = null; }
        }
    }

    createPlayer(playerId, playerName, avatar) {
        return {
            id: playerId,
            name: playerName,
            avatar: avatar || null,
            score: 0,            // score de jeu (base + bonus vitesse) → classement live
            disconnected: false,
            lastAnswer: null,
            answerTime: null,    // Temps de réponse en ms
            // Accumulateurs pour le QI (précision pondérée difficulté, cf. iqEngine).
            seenCount: 0,        // questions vues sur la soirée
            correctCount: 0,     // bonnes réponses
            weightedCorrect: 0,  // Σ(correct · poids_item)
            weightSum: 0,        // Σ(poids_item)
            profileSubmitted: false,
            profile: createEmptyProfile(),
        };
    }

    /**
     * Un joueur qui revient annule sa suppression différée : le contrôleur
     * programme un `removalTimer` à la déconnexion.
     */
    onPlayerRejoin(room, oldId, newId) {
        const player = room.players.get(newId);
        if (player?.removalTimer) {
            clearTimeout(player.removalTimer);
            player.removalTimer = null;
        }
    }

    describeRejoin(room, player) {
        // Profil « validé » = le joueur a passé l'étape (même en sautant des champs).
        return {
            myScore: player.score,
            profileComplete: !!player.profileSubmitted
        };
    }

    /** Le quiz ne renvoie rien de plus qu'un succès à l'inscription. */
    describeJoin() {
        return {};
    }

    /** Le pseudo du quiz n'était historiquement pas borné à l'inscription. */
    sanitizeName(playerName) {
        return super.sanitizeName(playerName, 20);
    }
}

module.exports = new GameManager();
