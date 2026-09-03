/**
 * RÉFLEXE — famille DIGITAL, chemin de résolution `auto`
 *
 * Quatre volées. À chaque volée, l'écran reste rouge un temps imprévisible puis
 * passe au vert : le premier doigt gagne. Taper avant le vert annule la volée.
 *
 * C'est le micro-jeu de référence du chemin « le serveur calcule » : il ne produit
 * que des scores individuels, que le contrôleur moyennera par table.
 */

const VOLLEYS = 4;
const MIN_WAIT_MS = 2000;
const MAX_WAIT_MS = 5500;
const PAUSE_BETWEEN_MS = 1600;
const MAX_SCORE = 1000;

module.exports = {
    id: 'reflexe',
    name: 'Réflexe',
    rule: 'Quand l\'écran passe au vert : tapez. Partir trop tôt annule la volée.',
    // Présentée au vote de début de manche, avec le titre et l'illustration.
    description: 'Quatre volées. L\'écran reste rouge, puis passe au vert sans prévenir : le premier doigt marque. Toute la table peut jouer.',
    art: { icon: 'zap', color: '#43B047' },
    family: 'DIGITAL',
    discipline: 'RÉFLEXE',
    scope: 'player',
    resolution: 'auto',
    materials: [],
    phases: [{ id: 'play', duration: 45 }],

    start(ctx) {
        ctx.state.volley = 0;
        ctx.state.goAt = null;
        ctx.state.results = {}; // playerId → number[]
        scheduleVolley(ctx);
    },

    onInput(ctx, playerId, data) {
        const { volley, goAt, results } = ctx.state;
        if (!data || data.volley !== volley) return; // volée périmée, on ignore

        if (!results[playerId]) results[playerId] = [];
        if (results[playerId].length > volley) return; // déjà joué cette volée

        if (goAt === null) {
            // Faux départ : la volée est perdue pour ce joueur, pas pour les autres.
            results[playerId].push(0);
            ctx.toPlayer(playerId, { kind: 'false-start', volley });
            return;
        }

        const reaction = Date.now() - goAt;
        const score = Math.max(0, MAX_SCORE - reaction);
        results[playerId].push(score);
        ctx.toPlayer(playerId, { kind: 'reaction', volley, reaction, score });
    },

    finish(ctx) {
        const scoresByPlayer = {};
        for (const [playerId, volleys] of Object.entries(ctx.state.results || {})) {
            if (volleys.length === 0) continue;
            const total = volleys.reduce((a, b) => a + b, 0);
            scoresByPlayer[playerId] = Math.round(total / volleys.length);
        }
        return { scoresByPlayer };
    },
};

function scheduleVolley(ctx) {
    const volley = ctx.state.volley;
    if (volley >= VOLLEYS) {
        ctx.finishEarly();
        return;
    }

    ctx.state.goAt = null;
    ctx.broadcast({ kind: 'arm', volley });

    const wait = MIN_WAIT_MS + Math.random() * (MAX_WAIT_MS - MIN_WAIT_MS);
    ctx.schedule(wait, () => {
        ctx.state.goAt = Date.now();
        ctx.broadcast({ kind: 'go', volley });

        // Laisser retomber la volée, puis enchaîner.
        ctx.schedule(PAUSE_BETWEEN_MS, () => {
            ctx.state.volley += 1;
            scheduleVolley(ctx);
        });
    });
}
