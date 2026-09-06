/**
 * DANCE_DANCE — fenêtres de jugement et calcul du score
 *
 * Le barème s'inspire d'Etterna plutôt que du DDR d'arcade : les fenêtres y
 * sont serrées et le score récompense la précision continue, pas seulement le
 * fait de toucher la note. C'est ce qui donne envie de rejouer une chanson
 * qu'on « passe » déjà.
 *
 * ── Pourquoi le jugement vit ici ET sur le téléphone ────────────────
 * Ce module est chargé des deux côtés (le client en importe les constantes) :
 * une seule table de vérité, donc aucune divergence possible entre ce que le
 * joueur voit et ce que le serveur compte. Le téléphone juge pour la
 * réactivité ; le serveur rejuge pour l'autorité. Voir `validateHit` : le
 * serveur ne fait jamais confiance au verdict annoncé, il le recalcule.
 */

/**
 * Fenêtres en millisecondes, en écart absolu par rapport à l'instant théorique.
 * Au-delà de `MISS_WINDOW`, la frappe ne concerne plus cette note du tout.
 */
const WINDOWS = [
    { id: 'PERFECT', maxMs: 25,  points: 100, label: 'PARFAIT', color: '#22d3ee' },
    { id: 'GREAT',   maxMs: 55,  points: 70,  label: 'SUPER',   color: '#a3e635' },
    { id: 'GOOD',    maxMs: 95,  points: 40,  label: 'BIEN',    color: '#facc15' },
    { id: 'BAD',     maxMs: 145, points: 10,  label: 'BOF',     color: '#fb923c' },
];

/** Au-delà, on ne considère plus que la note a été visée. */
const MISS_WINDOW = 180;

/** Une frappe ratée casse le combo ; un BAD le casse aussi (règle Etterna). */
const COMBO_BREAKERS = new Set(['BAD', 'MISS']);

/**
 * Multiplicateur de combo, plafonné. Sans plafond, une seule longue chanson
 * réussie écraserait tout le classement de la soirée.
 */
const COMBO_STEPS = [
    { min: 100, mult: 2.0 },
    { min: 50,  mult: 1.75 },
    { min: 25,  mult: 1.5 },
    { min: 10,  mult: 1.25 },
];

function comboMultiplier(combo) {
    for (const step of COMBO_STEPS) {
        if (combo >= step.min) return step.mult;
    }
    return 1;
}

/**
 * Verdict pour un écart donné.
 * @param {number} offsetMs  écart signé (négatif = en avance)
 * @returns {{id, points, label, color}} — 'MISS' si hors fenêtre
 */
function judgeOffset(offsetMs) {
    const abs = Math.abs(offsetMs);
    for (const w of WINDOWS) {
        if (abs <= w.maxMs) return w;
    }
    return { id: 'MISS', maxMs: MISS_WINDOW, points: 0, label: 'RATÉ', color: '#ef4444' };
}

/** Une frappe si loin de la note qu'elle ne la visait pas. */
function isWithinHitRange(offsetMs) {
    return Math.abs(offsetMs) <= MISS_WINDOW;
}

/**
 * État de score d'un joueur pour une chanson.
 * Volontairement une structure plate : elle part telle quelle dans les
 * instantanés vers le grand écran.
 */
function createScoreState() {
    return {
        score: 0,
        combo: 0,
        maxCombo: 0,
        counts: { PERFECT: 0, GREAT: 0, GOOD: 0, BAD: 0, MISS: 0 },
        totalOffset: 0,   // somme des écarts signés → biais moyen du joueur
        judged: 0,
    };
}

/**
 * Applique un verdict à un état de score. Mute `state` et le renvoie.
 */
function applyJudgement(state, judgement, offsetMs = 0) {
    const id = judgement.id;
    state.counts[id] = (state.counts[id] || 0) + 1;
    state.judged += 1;

    if (COMBO_BREAKERS.has(id)) {
        state.combo = 0;
    } else {
        state.combo += 1;
        if (state.combo > state.maxCombo) state.maxCombo = state.combo;
        state.totalOffset += offsetMs;
    }

    state.score += Math.round(judgement.points * comboMultiplier(state.combo));
    return state;
}

/**
 * Précision en pourcentage — la métrique que les joueurs comparent réellement,
 * bien plus parlante que le score brut qui dépend de la longueur du morceau.
 */
function accuracy(state) {
    if (!state.judged) return 0;
    const best = WINDOWS[0].points * state.judged;
    const raw = WINDOWS.reduce((sum, w) => sum + w.points * (state.counts[w.id] || 0), 0);
    return Math.round((raw / best) * 1000) / 10;
}

/**
 * Note de fin de morceau, façon jeu d'arcade. Purement cosmétique, mais c'est
 * ce que la salle regarde en premier sur l'écran de résultats.
 */
function rank(state) {
    const acc = accuracy(state);
    if (state.counts.MISS === 0 && state.counts.BAD === 0 && acc >= 99) return 'SSS';
    if (acc >= 96) return 'SS';
    if (acc >= 92) return 'S';
    if (acc >= 85) return 'A';
    if (acc >= 75) return 'B';
    if (acc >= 60) return 'C';
    return 'D';
}

module.exports = {
    WINDOWS,
    MISS_WINDOW,
    judgeOffset,
    isWithinHitRange,
    comboMultiplier,
    createScoreState,
    applyJudgement,
    accuracy,
    rank,
};
