/**
 * DANCE_DANCE — moteur de jeu côté client
 *
 * C'est la pièce qui rend le jeu jouable. Trois problèmes s'y règlent, et
 * aucun n'est évident :
 *
 * 1. **L'horloge du morceau.** On ne compte pas le temps avec `Date.now()` ni
 *    avec l'horloge de l'animation : les deux dérivent de la musique. La seule
 *    référence fiable est `AudioContext.currentTime`, l'horloge du matériel
 *    audio — celle qui fait réellement avancer le son dans les écouteurs. Un
 *    décalage de 40 ms entre la musique entendue et les flèches vues rend le
 *    jeu inconfortable sans qu'on sache pourquoi.
 *
 * 2. **Le départ synchronisé.** Le serveur annonce un instant absolu dans *son*
 *    horloge. Chaque téléphone a mesuré son décalage (`connection:syncTime`),
 *    donc il sait à quel moment de *sa* montre lancer la musique. Tout le monde
 *    démarre ensemble, quelle que soit la latence de chacun.
 *
 * 3. **Le jugement local.** Le téléphone possède la chorégraphie et juge sur
 *    place : le retour est instantané, et un joueur mal connecté n'est pas
 *    pénalisé. Le serveur revalide tout (cf. `danceGameManager.registerHit`) ;
 *    ce module ne fait donc jamais autorité sur le score.
 */

/* ── Table de jugement ──────────────────────────────────────────────
 * Copie exacte de `server/dance/judge.js`. Les deux doivent rester
 * identiques : un client plus indulgent que le serveur afficherait des points
 * que le classement ne compterait pas, ce qui est le pire des retours.
 */
export const WINDOWS = [
    { id: 'PERFECT', maxMs: 25,  points: 100, label: 'PARFAIT', color: '#22d3ee' },
    { id: 'GREAT',   maxMs: 55,  points: 70,  label: 'SUPER',   color: '#a3e635' },
    { id: 'GOOD',    maxMs: 95,  points: 40,  label: 'BIEN',    color: '#facc15' },
    { id: 'BAD',     maxMs: 145, points: 10,  label: 'BOF',     color: '#fb923c' },
];

export const MISS_WINDOW = 180;
export const MISS_JUDGEMENT = { id: 'MISS', points: 0, label: 'RATÉ', color: '#ef4444' };

export const COLUMNS = 4;
export const COLUMN_LABELS = ['←', '↓', '↑', '→'];

export function judgeOffset(offsetMs) {
    const abs = Math.abs(offsetMs);
    for (const w of WINDOWS) {
        if (abs <= w.maxMs) return w;
    }
    return MISS_JUDGEMENT;
}

const COMBO_STEPS = [
    { min: 100, mult: 2.0 },
    { min: 50,  mult: 1.75 },
    { min: 25,  mult: 1.5 },
    { min: 10,  mult: 1.25 },
];

export function comboMultiplier(combo) {
    for (const step of COMBO_STEPS) {
        if (combo >= step.min) return step.mult;
    }
    return 1;
}

/**
 * Mesure du décalage entre l'horloge locale et celle du serveur.
 *
 * On répète la mesure et on garde l'aller-retour le plus court : c'est celui
 * qui a le moins souffert de la file d'attente réseau, donc celui dont
 * l'estimation est la plus juste. Même principe que NTP.
 *
 * @returns {Promise<number>} décalage en ms, à ajouter à l'horloge locale
 */
export async function measureClockOffset(socket, samples = 5) {
    let best = { rtt: Infinity, offset: 0 };

    for (let i = 0; i < samples; i++) {
        const sent = Date.now();
        const reply = await new Promise((resolve) => {
            const timer = setTimeout(() => resolve(null), 1500);
            socket.emit('connection:syncTime', { clientTime: sent }, (res) => {
                clearTimeout(timer);
                resolve(res);
            });
        });
        if (!reply) continue;

        const received = Date.now();
        const rtt = received - sent;
        // On suppose le trajet symétrique : le serveur a répondu au milieu.
        const offset = reply.serverTime + rtt / 2 - received;
        if (rtt < best.rtt) best = { rtt, offset };
    }

    return best.rtt === Infinity ? 0 : best.offset;
}

/**
 * Moteur d'une chanson : horloge, notes actives, jugement.
 *
 * Il ne touche pas au DOM et ne connaît pas React — la vue l'interroge à chaque
 * image. C'est ce qui permet de le tester et de le réutiliser pour l'écran
 * hôte comme pour le téléphone.
 */
export class DanceEngine {
    /**
     * @param {object} opts
     * @param {object} opts.chart        chorégraphie reçue du serveur
     * @param {number} opts.clockOffset  décalage horloge locale → serveur
     * @param {number} opts.startAt      instant serveur du départ (ms epoch)
     * @param {function} [opts.onJudge]  (judgement, note, offsetMs) → void
     * @param {function} [opts.onMiss]   (note) → void
     */
    constructor({ chart, clockOffset = 0, startAt, onJudge, onMiss }) {
        this.chart = chart;
        this.notes = chart.notes;
        this.clockOffset = clockOffset;
        this.startAt = startAt;
        this.onJudge = onJudge || (() => {});
        this.onMiss = onMiss || (() => {});

        this.audio = null;
        this.audioCtx = null;
        this.audioStartTime = 0;   // repère AudioContext du début du morceau

        // Une note ne peut être jugée qu'une fois.
        this.resolved = new Set();

        // Index de la première note encore susceptible d'être frappée. Les
        // notes étant triées, on n'a jamais à parcourir la chorégraphie entière
        // à chaque frappe — ce qui compte : un balayage complet à chaque appui
        // ferait tomber les images sur un téléphone d'entrée de gamme.
        this.cursor = 0;

        this.state = {
            score: 0,
            combo: 0,
            maxCombo: 0,
            counts: { PERFECT: 0, GREAT: 0, GOOD: 0, BAD: 0, MISS: 0 },
        };
    }

    /**
     * Prépare l'audio et programme sa lecture pour l'instant voulu.
     * `AudioContext` doit être créé après un geste de l'utilisateur, sinon les
     * navigateurs mobiles refusent de jouer le son.
     */
    async prepare(audioUrl) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        this.audioCtx = new Ctx();
        if (this.audioCtx.state === 'suspended') await this.audioCtx.resume();

        const response = await fetch(audioUrl);
        const buffer = await response.arrayBuffer();
        this.buffer = await this.audioCtx.decodeAudioData(buffer);
    }

    /**
     * Lance la musique à l'instant convenu.
     *
     * On programme la lecture dans le futur avec `start(when)` plutôt que de
     * dormir puis jouer : le planificateur audio est bien plus précis qu'un
     * `setTimeout`, qui peut dériver de plusieurs dizaines de millisecondes.
     */
    start() {
        const localStart = this.startAt - this.clockOffset;   // départ, horloge locale
        const delayMs = localStart - Date.now();

        const source = this.audioCtx.createBufferSource();
        source.buffer = this.buffer;
        source.connect(this.audioCtx.destination);

        // Le morceau commence après le décompte : au moment du départ, la
        // musique doit être à zéro et les premières notes tomber `leadInMs`
        // plus tard.
        const when = this.audioCtx.currentTime + Math.max(0, delayMs / 1000);
        source.start(when);

        this.source = source;
        this.audioStartTime = when;
        this.playing = true;
    }

    /**
     * Position actuelle dans le morceau, en millisecondes.
     * Négative avant le départ (pendant le décompte).
     */
    position() {
        if (!this.audioCtx) return 0;
        return (this.audioCtx.currentTime - this.audioStartTime) * 1000;
    }

    /**
     * Notes à afficher dans la fenêtre de visibilité.
     * @param {number} lookAheadMs durée couverte par la hauteur de l'écran
     */
    visibleNotes(lookAheadMs = 1600) {
        const now = this.position();
        const out = [];
        for (let i = this.cursor; i < this.notes.length; i++) {
            const note = this.notes[i];
            if (note.timeMs > now + lookAheadMs) break;
            if (this.resolved.has(note.id)) continue;
            if (note.timeMs < now - MISS_WINDOW) continue;
            out.push(note);
        }
        return out;
    }

    /**
     * Marque comme ratées les notes définitivement passées.
     * Appelé à chaque image : c'est ce qui casse le combo quand on ne joue pas.
     */
    collectMisses() {
        const now = this.position();
        while (this.cursor < this.notes.length) {
            const note = this.notes[this.cursor];
            if (note.timeMs >= now - MISS_WINDOW) break;

            if (!this.resolved.has(note.id)) {
                this.resolved.add(note.id);
                this.state.counts.MISS += 1;
                this.state.combo = 0;
                this.onMiss(note);
            }
            this.cursor += 1;
        }
    }

    /**
     * Traite un appui sur une colonne.
     *
     * On retient la note **la plus proche** dans la fenêtre, pas la première
     * venue : sur un passage dense, viser la plus ancienne ferait rater la
     * suivante en cascade.
     *
     * @returns {{judgement, note, offsetMs}|null} null si l'appui ne visait rien
     */
    hit(column) {
        const now = this.position();

        let best = null;
        for (let i = this.cursor; i < this.notes.length; i++) {
            const note = this.notes[i];
            const offset = now - note.timeMs;
            if (offset < -MISS_WINDOW) break;          // trop tôt, et la suite est pire
            if (note.column !== column) continue;
            if (this.resolved.has(note.id)) continue;
            if (Math.abs(offset) > MISS_WINDOW) continue;

            if (!best || Math.abs(offset) < Math.abs(best.offsetMs)) {
                best = { note, offsetMs: offset };
            }
        }

        if (!best) return null;

        const judgement = judgeOffset(best.offsetMs);
        this.resolved.add(best.note.id);

        this.state.counts[judgement.id] += 1;
        if (judgement.id === 'BAD' || judgement.id === 'MISS') {
            this.state.combo = 0;
        } else {
            this.state.combo += 1;
            if (this.state.combo > this.state.maxCombo) this.state.maxCombo = this.state.combo;
        }
        this.state.score += Math.round(judgement.points * comboMultiplier(this.state.combo));

        this.onJudge(judgement, best.note, best.offsetMs);
        return { judgement, note: best.note, offsetMs: best.offsetMs };
    }

    /** Précision courante, même définition que le serveur. */
    accuracy() {
        const judged = Object.values(this.state.counts).reduce((a, b) => a + b, 0);
        if (!judged) return 0;
        const best = WINDOWS[0].points * judged;
        const raw = WINDOWS.reduce((s, w) => s + w.points * this.state.counts[w.id], 0);
        return Math.round((raw / best) * 1000) / 10;
    }

    /** Le morceau est-il terminé ? */
    finished() {
        return this.position() > this.chart.durationMs;
    }

    stop() {
        try { this.source?.stop(); } catch { /* déjà arrêtée */ }
        try { this.audioCtx?.close(); } catch { /* déjà fermé */ }
        this.playing = false;
    }
}

/* ── Analyse d'un morceau téléversé ─────────────────────────────────
 * Le tempo est mesuré dans le navigateur : décoder du MP3 côté serveur
 * demanderait ffmpeg ou un module natif, pour un seul jeu du hub.
 */

/**
 * Estime le tempo d'un fichier audio.
 *
 * Méthode : on isole les basses (où frappe la grosse caisse), on relève les
 * pics d'énergie, puis on cherche l'intervalle qui revient le plus souvent
 * entre ces pics. C'est l'approche classique de détection par autocorrélation
 * des attaques, suffisante pour de la musique à pulsation régulière — ce qui
 * est précisément le répertoire d'un jeu de danse.
 *
 * @returns {Promise<{bpm:number, durationMs:number}>}
 */
export async function analyzeAudioFile(file) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();

    try {
        const buffer = await file.arrayBuffer();
        const audio = await ctx.decodeAudioData(buffer);
        const durationMs = Math.round(audio.duration * 1000);

        // Mixage mono : la pulsation est présente sur les deux canaux.
        const raw = audio.getChannelData(0);
        const sampleRate = audio.sampleRate;

        // Enveloppe d'énergie par fenêtres de ~10 ms. On ne travaille pas sur
        // l'échantillon brut : ce qui compte est l'attaque, pas la forme d'onde.
        const windowSize = Math.floor(sampleRate * 0.01);
        const windows = Math.floor(raw.length / windowSize);
        const energy = new Float32Array(windows);
        for (let i = 0; i < windows; i++) {
            let sum = 0;
            const start = i * windowSize;
            for (let j = 0; j < windowSize; j++) sum += raw[start + j] * raw[start + j];
            energy[i] = Math.sqrt(sum / windowSize);
        }

        // Détection d'attaques : une hausse nette par rapport à la moyenne
        // glissante. Le seuil relatif évite de tout rater sur un morceau doux.
        const onsets = [];
        const historySize = 43;   // ~430 ms de contexte
        for (let i = historySize; i < energy.length; i++) {
            let mean = 0;
            for (let j = i - historySize; j < i; j++) mean += energy[j];
            mean /= historySize;
            if (energy[i] > mean * 1.35 && energy[i] > 0.01) {
                // Une seule attaque par groupe : on ignore les 5 fenêtres qui suivent.
                if (!onsets.length || i - onsets[onsets.length - 1] > 5) onsets.push(i);
            }
        }

        if (onsets.length < 8) return { bpm: 120, durationMs };

        // Histogramme des intervalles, exprimés en tempo. On teste chaque paire
        // d'attaques proches et on vote pour le tempo correspondant.
        const votes = new Map();
        for (let i = 0; i < onsets.length; i++) {
            for (let j = i + 1; j < Math.min(i + 10, onsets.length); j++) {
                const deltaMs = (onsets[j] - onsets[i]) * 10;
                if (deltaMs < 200 || deltaMs > 2000) continue;

                let bpm = 60000 / deltaMs;
                // Repli dans une plage dansante : un intervalle peut valoir une
                // demi-mesure ou deux, sans changer le tempo perçu.
                while (bpm < 90) bpm *= 2;
                while (bpm > 180) bpm /= 2;

                const key = Math.round(bpm);
                votes.set(key, (votes.get(key) || 0) + 1);
            }
        }

        let bestBpm = 120;
        let bestVotes = 0;
        for (const [bpm, count] of votes) {
            if (count > bestVotes) {
                bestVotes = count;
                bestBpm = bpm;
            }
        }

        return { bpm: bestBpm, durationMs };
    } finally {
        try { await ctx.close(); } catch { /* déjà fermé */ }
    }
}
