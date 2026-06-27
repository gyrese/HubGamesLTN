/* ═══════════════════════════════════════════════════════════════
   iqEngine — Score de QI « façon vrai test »
   ───────────────────────────────────────────────────────────────
   On calcule un QI à DÉVIATION (la méthode réelle des tests modernes,
   WAIS/WISC) : IQ = 100 + 15·z, où z est l'écart normalisé de la
   capacité du joueur par rapport à une norme.

   Différences clés avec l'ancien système :
   - Le QI dépend de la PRÉCISION (bonnes réponses), pondérée par la
     DIFFICULTÉ des items — pas de la vitesse de tap (qui ne sert qu'au
     score de jeu / classement live).
   - La difficulté d'item est estimée par CTT (proportion de bonnes
     réponses du groupe = « p-value ») avec un lissage bayésien vers une
     difficulté a priori, pour rester stable même à 2 joueurs.
   - La norme (μ, σ) dégrade gracieusement : on fait confiance au groupe
     quand il est grand, et on retombe sur une norme fixe quand il est
     petit. Un intervalle de confiance (±) reflète le nombre de questions.
   ═══════════════════════════════════════════════════════════════ */

const SHRINK_K = 4;        // pseudo-observations vers la difficulté a priori
const NORM_K = 4;          // poids du groupe vs norme fixe (M/(M+NORM_K))
const POP_MEAN = 0.5;      // capacité moyenne supposée d'un « QI 100 »
const POP_SD = 0.17;       // dispersion supposée en population
const SD_FLOOR = 0.06;     // évite des QI explosifs sur groupes homogènes
const REL_K = 10;          // fiabilité = N/(N+REL_K) (N = questions vues)
const IQ_MIN = 55;
const IQ_MAX = 145;

// Difficulté déclarée (1..5) → proportion attendue de bonnes réponses.
function difficultyToP(difficulty) {
    const table = { 1: 0.85, 2: 0.72, 3: 0.6, 4: 0.45, 5: 0.3 };
    const d = Number(difficulty);
    return table[d] !== undefined ? table[d] : 0.6;
}

/**
 * Poids d'un item, calculé à la fin de chaque question avec les réponses
 * réelles du groupe. Un item plus difficile (peu de bonnes réponses) pèse
 * davantage. Lissage bayésien vers la difficulté a priori pour la stabilité.
 *
 * @returns {{ pBlend:number, weight:number }}
 */
function itemWeight({ correctCount = 0, answeredCount = 0, difficulty } = {}) {
    const p0 = difficultyToP(difficulty);
    const pEmp = answeredCount > 0 ? correctCount / answeredCount : p0;
    const pBlend = (answeredCount * pEmp + SHRINK_K * p0) / (answeredCount + SHRINK_K);
    const weight = 1 - 0.5 * pBlend; // ∈ [0.5, 0.85] environ
    return { pBlend, weight };
}

// erf(x) — approximation Abramowitz & Stegun 7.1.26 (|erreur| < 1.5e-7).
function erf(x) {
    const sign = x < 0 ? -1 : 1;
    const ax = Math.abs(x);
    const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741,
        a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
    const t = 1 / (1 + p * ax);
    const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
    return sign * y;
}

function normalCdf(z) {
    return 0.5 * (1 + erf(z / Math.SQRT2));
}

// Classification WAIS-IV réelle.
function classify(iq) {
    if (iq >= 130) return { label: 'Très supérieur', emoji: '🧠', blurb: 'Génie — top 2 %' };
    if (iq >= 120) return { label: 'Supérieur', emoji: '🎓', blurb: 'Brillant — top 10 %' };
    if (iq >= 110) return { label: 'Moyenne haute', emoji: '⭐', blurb: 'Au-dessus de la moyenne' };
    if (iq >= 90) return { label: 'Moyenne', emoji: '✅', blurb: 'Dans la norme' };
    if (iq >= 80) return { label: 'Moyenne basse', emoji: '📚', blurb: 'Un petit café et ça repart' };
    if (iq >= 70) return { label: 'Limite', emoji: '💪', blurb: 'La soirée était dure' };
    return { label: 'Très faible', emoji: '🫠', blurb: "C'est l'intention qui compte" };
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Calcule et écrit le QI sur chaque joueur. Mutation en place + renvoie la liste.
 * Chaque joueur doit porter les accumulateurs remplis pendant la partie :
 *   - weightedCorrect, weightSum  (précision pondérée difficulté)
 *   - correctCount, seenCount     (précision brute, fiabilité)
 */
function compute(players) {
    const list = Array.isArray(players) ? players : [];
    const M = list.length;

    // Capacité θ ∈ [0,1] de chaque joueur (précision pondérée par la difficulté).
    const thetas = list.map(p => (p.weightSum > 0 ? p.weightedCorrect / p.weightSum : 0));

    const mean = M > 0 ? thetas.reduce((a, b) => a + b, 0) / M : POP_MEAN;
    const variance = M > 0 ? thetas.reduce((a, b) => a + (b - mean) ** 2, 0) / M : 0;
    const sdGroup = Math.sqrt(variance);

    // Plus le groupe est grand, plus on lui fait confiance comme étalon.
    const wM = M / (M + NORM_K);
    const mu = wM * mean + (1 - wM) * POP_MEAN;
    const sigma = Math.max(SD_FLOOR, wM * sdGroup + (1 - wM) * POP_SD);

    list.forEach((p, i) => {
        const theta = thetas[i];
        const z = (theta - mu) / sigma;
        const iq = clamp(Math.round(100 + 15 * z), IQ_MIN, IQ_MAX);

        const N = p.seenCount || 0;
        const reliability = N / (N + REL_K);
        const margin = Math.round(1.96 * 15 * Math.sqrt(Math.max(0, 1 - reliability)));

        const tier = classify(iq);

        p.iq = iq;
        p.iqMargin = margin;
        p.iqPercentile = clamp(Math.round(normalCdf(z) * 100), 1, 99);
        p.iqLabel = tier.label;
        p.iqEmoji = tier.emoji;
        p.iqBlurb = tier.blurb;
        p.accuracy = N > 0 ? Math.round((p.correctCount / N) * 100) : 0;
    });

    return list;
}

module.exports = { compute, itemWeight, classify, difficultyToP, normalCdf };
