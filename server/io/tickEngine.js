/**
 * IO_ARENA — moteur de boucle temps réel
 *
 * C'est le socle commun à tous les modes .io du hub, et la seule pièce du dépôt
 * qui simule au lieu de relayer : les autres jeux sont tour par tour, ici le
 * serveur fait autorité sur un monde qui avance tout seul.
 *
 * Trois règles non négociables, qui expliquent la forme du code :
 *
 *   1. Le serveur est autoritaire. Le client n'envoie qu'une *intention*
 *      (`{ angle }`), jamais une position — même logique anti-triche que
 *      GeoTrackr, qui ne confie au client que des coordonnées floutées.
 *   2. Les instantanés partent en `volatile` : un paquet de position perdu ne
 *      doit jamais être rejoué, le suivant le remplace. C'est ce qui protège le
 *      wifi du bar quand 20 téléphones jouent en même temps.
 *   3. Simulation et diffusion sont découplées (20 Hz / 10 Hz par défaut) :
 *      l'écran interpole entre deux instantanés, donc 60 fps visuels ne coûtent
 *      que 10 paquets par seconde.
 *
 * Un mode ne connaît que son gameplay ; il ne voit ni socket, ni timer, ni
 * réseau. Voir le contrat dans `modes/index.js`.
 */

// Pas de simulation fixe : la physique ne doit jamais dépendre de la charge
// machine, sinon deux parties identiques divergent.
const DEFAULT_TICK_HZ = 20;
const DEFAULT_BROADCAST_HZ = 10;

// Si le processus a été bloqué (GC, veille, pic de charge), on refuse de
// rattraper plus de 5 pas d'un coup : mieux vaut un ralenti passager qu'une
// spirale de la mort où chaque tick en déclenche cinq autres.
const MAX_CATCHUP_STEPS = 5;

class TickEngine {
    /**
     * @param {object} mode   Le module de gameplay (cf. modes/index.js)
     * @param {object} ctx    Contexte partagé avec le mode : { state, players, world, emit }
     * @param {object} hooks  { onSnapshot(payload), onEnd(results) }
     */
    constructor(mode, ctx, hooks = {}) {
        this.mode = mode;
        this.ctx = ctx;
        this.hooks = hooks;

        this.tickHz = mode.tickHz || DEFAULT_TICK_HZ;
        this.broadcastHz = mode.broadcastHz || DEFAULT_BROADCAST_HZ;
        this.stepMs = 1000 / this.tickHz;
        this.broadcastEveryMs = 1000 / this.broadcastHz;

        this.timer = null;
        this.running = false;
        this.startedAt = 0;
        this.lastTickAt = 0;
        this.accumulator = 0;
        this.sinceBroadcast = 0;

        // Diagnostic : ces chiffres décident si le jeu est jouable en salle, donc
        // ils sont mesurés dès le premier jour plutôt qu'ajoutés après coup.
        this.stats = {
            ticks: 0,
            bytesOut: 0,
            bytesPerSec: 0,
            worstTickMs: 0,
            lastTickMs: 0,
            skippedSteps: 0,
        };
        this._statsWindowStart = 0;
        this._bytesThisWindow = 0;
    }

    start() {
        if (this.running) return;
        this.running = true;
        this.startedAt = Date.now();
        this.lastTickAt = this.startedAt;
        this._statsWindowStart = this.startedAt;
        this.accumulator = 0;
        this.sinceBroadcast = 0;

        if (typeof this.mode.init === 'function') this.mode.init(this.ctx);

        // setInterval plutôt que setTimeout récursif : la dérive est absorbée par
        // l'accumulateur ci-dessous, et un intervalle se nettoie d'un seul appel.
        this.timer = setInterval(() => this._loop(), this.stepMs);
    }

    stop() {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
        this.running = false;
    }

    /** Temps écoulé depuis le début de la manche, en millisecondes. */
    elapsed() {
        return Date.now() - this.startedAt;
    }

    /** Temps restant, en millisecondes (0 si la manche est finie). */
    remaining() {
        return Math.max(0, (this.mode.durationMs || 0) - this.elapsed());
    }

    _loop() {
        if (!this.running) return;

        const now = Date.now();
        let frame = now - this.lastTickAt;
        this.lastTickAt = now;

        // Un onglet mis en veille peut rendre `frame` énorme : on plafonne pour
        // ne pas simuler une minute d'un coup au réveil.
        const maxFrame = this.stepMs * MAX_CATCHUP_STEPS;
        if (frame > maxFrame) {
            this.stats.skippedSteps += Math.round((frame - maxFrame) / this.stepMs);
            frame = maxFrame;
        }

        this.accumulator += frame;

        const t0 = Date.now();
        let steps = 0;
        // Pas fixe : la simulation avance toujours par tranches de `stepMs`,
        // quelle que soit la régularité réelle du timer.
        while (this.accumulator >= this.stepMs && steps < MAX_CATCHUP_STEPS) {
            try {
                this.mode.tick(this.ctx, this.stepMs / 1000);
            } catch (err) {
                console.error(`[IO_ARENA] Erreur dans tick(${this.mode.id}):`, err);
                // Un mode qui plante ne doit pas bloquer la salle : on arrête la
                // manche proprement plutôt que de boucler sur l'erreur.
                this._finish();
                return;
            }
            this.accumulator -= this.stepMs;
            steps += 1;
            this.stats.ticks += 1;
        }

        const tickMs = Date.now() - t0;
        this.stats.lastTickMs = tickMs;
        if (tickMs > this.stats.worstTickMs) this.stats.worstTickMs = tickMs;

        this.sinceBroadcast += frame;
        if (this.sinceBroadcast >= this.broadcastEveryMs) {
            this.sinceBroadcast = 0;
            this._broadcast();
        }

        if (this.mode.durationMs && this.elapsed() >= this.mode.durationMs) {
            this._finish();
        }
    }

    _broadcast() {
        let payload;
        try {
            payload = this.mode.snapshot(this.ctx);
        } catch (err) {
            console.error(`[IO_ARENA] Erreur dans snapshot(${this.mode.id}):`, err);
            return;
        }
        if (!payload) return;

        payload.t = Date.now();
        payload.remaining = this.remaining();

        this._measure(payload);
        if (typeof this.hooks.onSnapshot === 'function') this.hooks.onSnapshot(payload);
    }

    /**
     * Mesure du débit sortant. On sérialise une fois pour compter les octets ;
     * c'est le prix d'un chiffre qui, en salle, est la seule façon de savoir si
     * le réseau tient ou si c'est le jeu qui rame.
     */
    _measure(payload) {
        let size = 0;
        try {
            size = Buffer.byteLength(JSON.stringify(payload), 'utf8');
        } catch {
            return;
        }
        this.stats.bytesOut += size;
        this._bytesThisWindow += size;

        const now = Date.now();
        const windowMs = now - this._statsWindowStart;
        if (windowMs >= 1000) {
            this.stats.bytesPerSec = Math.round((this._bytesThisWindow * 1000) / windowMs);
            this._bytesThisWindow = 0;
            this._statsWindowStart = now;
        }
    }

    _finish() {
        this.stop();
        let results = [];
        try {
            results = this.mode.results(this.ctx) || [];
        } catch (err) {
            console.error(`[IO_ARENA] Erreur dans results(${this.mode.id}):`, err);
        }
        if (typeof this.hooks.onEnd === 'function') this.hooks.onEnd(results);
    }
}

module.exports = { TickEngine, DEFAULT_TICK_HZ, DEFAULT_BROADCAST_HZ };
