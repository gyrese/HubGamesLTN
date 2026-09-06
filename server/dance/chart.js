/**
 * DANCE_DANCE — génération de chorégraphies
 *
 * Une chart n'est pas une suite de flèches aléatoires. Un placement au hasard
 * produit un morceau injouable et ennuyeux : les mains sautent sans logique et
 * rien ne « tombe sous les doigts ». Ce module génère donc des **motifs**
 * (escaliers, alternances, sauts), comme le ferait un auteur humain, puis les
 * enchaîne selon une courbe d'intensité.
 *
 * Le résultat est déterministe pour un couple (graine, difficulté) : deux
 * joueurs du même salon dansent exactement la même chose, et l'on peut rejouer
 * un morceau à l'identique. La graine dérive de l'identifiant du morceau.
 *
 * ── Vocabulaire ─────────────────────────────────────────────────────
 *   colonne  0=gauche, 1=bas, 2=haut, 3=droite (ordre d'une croix DDR)
 *   beat     pulsation musicale ; une noire au tempo donné
 *   note     { id, timeMs, column }
 */

const COLUMNS = 4;

/**
 * Profils de difficulté.
 *
 * `density` = notes par pulsation en moyenne. 1 = une note par temps (lent,
 * confortable) ; 4 = des doubles-croches soutenues (expert).
 * `jumpRate` = proportion de temps forts où deux flèches tombent ensemble.
 */
const DIFFICULTIES = {
    facile:    { id: 'facile',    label: 'Facile',    density: 0.55, jumpRate: 0,    color: '#4ade80', stars: 1 },
    normal:    { id: 'normal',    label: 'Normal',    density: 1.1,  jumpRate: 0.03, color: '#facc15', stars: 2 },
    difficile: { id: 'difficile', label: 'Difficile', density: 1.9,  jumpRate: 0.09, color: '#fb923c', stars: 3 },
    expert:    { id: 'expert',    label: 'Expert',    density: 2.8,  jumpRate: 0.16, color: '#ef4444', stars: 4 },
};

const DEFAULT_DIFFICULTY = 'normal';

/**
 * Générateur pseudo-aléatoire déterministe (mulberry32).
 * `Math.random()` ne convient pas : il faut pouvoir rejouer une chart à
 * l'identique sur le serveur comme sur les téléphones.
 */
function makeRng(seed) {
    let a = seed >>> 0;
    return function rng() {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Graine stable dérivée d'une chaîne (identifiant du morceau). */
function seedFromString(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

/* ── Motifs ─────────────────────────────────────────────────────────
 * Chaque motif rend une suite de colonnes. Ils sont volontairement courts :
 * c'est leur enchaînement qui crée la variété, pas leur longueur.
 */

/** Escalier : 0,1,2,3 — le motif le plus lisible, bon pour respirer. */
function stair(rng, length) {
    const ascending = rng() < 0.5;
    const out = [];
    for (let i = 0; i < length; i++) {
        const step = i % COLUMNS;
        out.push(ascending ? step : COLUMNS - 1 - step);
    }
    return out;
}

/** Alternance entre deux colonnes — le motif « course ». */
function alternate(rng, length) {
    const a = Math.floor(rng() * COLUMNS);
    let b = Math.floor(rng() * COLUMNS);
    if (b === a) b = (a + 1 + Math.floor(rng() * (COLUMNS - 1))) % COLUMNS;
    const out = [];
    for (let i = 0; i < length; i++) out.push(i % 2 === 0 ? a : b);
    return out;
}

/**
 * Marche aléatoire contrainte : jamais deux fois la même colonne d'affilée,
 * et on privilégie les colonnes voisines. C'est ce qui « tombe sous les
 * doigts » — un saut gauche→droite répété est désagréable à jouer.
 */
function walk(rng, length, lastColumn) {
    const out = [];
    let prev = lastColumn ?? Math.floor(rng() * COLUMNS);
    for (let i = 0; i < length; i++) {
        const candidates = [];
        for (let c = 0; c < COLUMNS; c++) {
            if (c === prev) continue;
            // Une colonne voisine compte double dans le tirage.
            const weight = Math.abs(c - prev) === 1 ? 2 : 1;
            for (let w = 0; w < weight; w++) candidates.push(c);
        }
        const next = candidates[Math.floor(rng() * candidates.length)];
        out.push(next);
        prev = next;
    }
    return out;
}

const PATTERNS = [
    { name: 'stair', fn: stair, weight: 2 },
    { name: 'alternate', fn: alternate, weight: 2 },
    { name: 'walk', fn: walk, weight: 3 },
];

function pickPattern(rng) {
    const total = PATTERNS.reduce((s, p) => s + p.weight, 0);
    let roll = rng() * total;
    for (const p of PATTERNS) {
        roll -= p.weight;
        if (roll <= 0) return p;
    }
    return PATTERNS[PATTERNS.length - 1];
}

/**
 * Courbe d'intensité sur la durée du morceau : on commence doucement, on monte
 * vers les deux tiers, on redescend un peu à la fin. Un morceau à densité
 * constante est monotone, quelle que soit sa difficulté.
 */
function intensityAt(progress) {
    if (progress < 0.12) return 0.55;              // introduction
    if (progress > 0.92) return 0.75;              // sortie
    // Montée régulière avec un sommet vers 70 % du morceau.
    const peak = 0.7;
    const d = Math.abs(progress - peak) / peak;
    return 0.8 + 0.35 * (1 - d);
}

/**
 * Construit la chorégraphie complète d'un morceau.
 *
 * @param {object} opts
 * @param {number} opts.bpm             tempo détecté ou déclaré
 * @param {number} opts.durationMs      durée du morceau
 * @param {string} opts.difficulty      clé de DIFFICULTIES
 * @param {string} opts.seed            identifiant du morceau (déterminisme)
 * @param {number} [opts.offsetMs=0]    décalage du premier temps
 * @param {number} [opts.leadInMs=3000] silence avant la première note
 * @returns {{notes, bpm, difficulty, durationMs, leadInMs, count}}
 */
function generateChart({
    bpm,
    durationMs,
    difficulty = DEFAULT_DIFFICULTY,
    seed = 'default',
    offsetMs = 0,
    leadInMs = 3000,
}) {
    const profile = DIFFICULTIES[difficulty] || DIFFICULTIES[DEFAULT_DIFFICULTY];
    const rng = makeRng(seedFromString(`${seed}:${profile.id}`));

    const beatMs = 60000 / bpm;

    // La densité est exprimée en notes par pulsation. Telle quelle, un morceau
    // à 180 BPM serait deux fois plus chargé qu'un morceau à 90 BPM pour la
    // même difficulté affichée — « Normal » ne voudrait plus rien dire. On
    // ramène donc la densité vers un tempo de référence, sans l'aplatir tout à
    // fait : un morceau rapide doit rester un peu plus soutenu.
    const REFERENCE_BPM = 128;
    const tempoScale = Math.min(1.35, Math.max(0.7, Math.pow(REFERENCE_BPM / bpm, 0.7)));
    const density = profile.density * tempoScale;

    const notes = [];
    let noteId = 0;
    let lastColumn = null;

    // On avance par phrases de 4 temps : c'est la maille naturelle de la
    // musique populaire, et cela évite qu'un motif chevauche une mesure.
    const phraseBeats = 4;
    let beat = 0;
    const totalBeats = (durationMs - leadInMs) / beatMs;

    while (beat < totalBeats) {
        const progress = beat / totalBeats;
        const intensity = intensityAt(progress);

        // Notes visées pour cette phrase, selon densité et intensité.
        const targetNotes = Math.max(1, Math.round(density * intensity * phraseBeats));

        // Subdivision : on répartit `targetNotes` sur `phraseBeats` temps, en
        // se limitant aux subdivisions musicales (1, 2 ou 4 par temps).
        const perBeat = targetNotes / phraseBeats;
        let subdivision = 1;
        if (perBeat > 1.4) subdivision = 2;
        if (perBeat > 2.6) subdivision = 4;

        const slots = phraseBeats * subdivision;
        const stepMs = beatMs / subdivision;

        // Une pause d'une phrase de temps en temps : sans respiration, un
        // morceau expert devient un mur illisible.
        const isRest = rng() < 0.08 && progress > 0.15 && progress < 0.9;
        if (isRest) {
            beat += phraseBeats;
            continue;
        }

        const pattern = pickPattern(rng);
        const columns = pattern.fn(rng, slots, lastColumn);

        // Choix des slots joués.
        //
        // On ne peut pas se contenter de « jouer tout temps fort et filtrer le
        // reste » : quand la subdivision vaut 1, tous les slots sont des temps
        // forts, et la phrase se retrouve pleine quelle que soit la difficulté
        // — « Facile » deviendrait aussi dense que « Difficile ». On retient
        // donc exactement `targetNotes` slots, en les tirant par ordre de force
        // musicale : le premier temps d'abord, puis les autres temps, puis les
        // contretemps. La densité demandée est ainsi toujours respectée, et les
        // notes tombent quand même sur les appuis naturels de la mesure.
        const ranked = [];
        for (let i = 0; i < slots; i++) {
            const inBeat = i % subdivision;          // 0 = sur le temps
            const beatIndex = Math.floor(i / subdivision);
            let strength;
            if (inBeat !== 0) strength = 3;          // contretemps
            else if (beatIndex === 0) strength = 0;  // premier temps de la phrase
            else if (beatIndex % 2 === 0) strength = 1;
            else strength = 2;
            // Le bruit départage les slots de même force sans favoriser
            // toujours le même endroit de la mesure.
            ranked.push({ i, key: strength + rng() * 0.9 });
        }
        ranked.sort((a, b) => a.key - b.key);

        const chosen = ranked.slice(0, Math.min(targetNotes, slots)).map((r) => r.i);
        chosen.sort((a, b) => a - b);

        for (const i of chosen) {
            const timeMs = Math.round(leadInMs + offsetMs + (beat * beatMs) + (i * stepMs));
            if (timeMs > durationMs - 500) break;

            const column = columns[i];
            notes.push({ id: noteId++, timeMs, column });
            lastColumn = column;

            // Saut : deux flèches simultanées, réservé aux temps forts pour
            // rester jouable à deux pouces.
            const isDownbeat = (i % subdivision) === 0;
            if (isDownbeat && rng() < profile.jumpRate) {
                const other = (column + 2) % COLUMNS;
                notes.push({ id: noteId++, timeMs, column: other });
            }
        }

        beat += phraseBeats;
    }

    notes.sort((a, b) => a.timeMs - b.timeMs || a.column - b.column);

    return {
        notes,
        bpm,
        difficulty: profile.id,
        durationMs,
        leadInMs,
        count: notes.length,
    };
}

/** Vue publique d'une difficulté, pour l'écran de sélection. */
function listDifficulties() {
    return Object.values(DIFFICULTIES).map((d) => ({
        id: d.id,
        label: d.label,
        color: d.color,
        stars: d.stars,
    }));
}

module.exports = {
    COLUMNS,
    DIFFICULTIES,
    DEFAULT_DIFFICULTY,
    generateChart,
    listDifficulties,
    makeRng,
    seedFromString,
};
