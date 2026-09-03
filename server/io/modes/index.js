/**
 * IO_ARENA — registre des modes
 *
 * Même principe que le registre des micro-jeux de Super LTN Party : le
 * contrôleur ne connaît que ce contrat, donc **ajouter un mode ne demande
 * jamais de toucher à la machine à états ni au moteur**.
 *
 * Contrat d'un mode :
 *
 *   id, name, rule        identité et règle en une phrase (lisible de loin)
 *   art                   { icon, color } pour la carte de sélection
 *   durationMs            durée d'une manche
 *   tickHz                cadence de simulation (défaut 20)
 *   broadcastHz           cadence de diffusion (défaut 10, l'écran interpole)
 *   world                 { width, height } repère logique, jamais des pixels
 *   minPlayers            en dessous, la manche ne démarre pas
 *
 *   init(ctx)                    prépare ctx.state
 *   onJoin(ctx, player)          apparition — peut survenir en pleine manche
 *   onLeave(ctx, playerId)       départ — idem
 *   onInput(ctx, playerId, data) intention du joueur, jamais une position
 *   tick(ctx, dt)                la simulation, dt en secondes
 *   snapshot(ctx)                état public destiné au grand écran
 *   results(ctx)                 [{ playerId, name, score }] triés
 *
 * `ctx` est fourni par le contrôleur : { state, players, world, mode }.
 * `ctx.players` est une Map<playerId, { id, name, color, connected, ... }>.
 */

const territoire = require('./territoire');

const MODES = [territoire];

const REGISTRY = new Map(MODES.map((m) => [m.id, m]));

function get(id) {
    return REGISTRY.get(id) || null;
}

/** Mode par défaut : le premier déclaré, pour ne jamais rendre `null`. */
function fallback() {
    return MODES[0];
}

/** Vue publique d'un mode : ce qu'affiche la page de sélection. */
function publicCard(mode) {
    return {
        id: mode.id,
        name: mode.name,
        rule: mode.rule,
        description: mode.description || mode.rule,
        durationMs: mode.durationMs,
        minPlayers: mode.minPlayers || 1,
        art: mode.art || { icon: 'gamepad', color: '#22d3ee' },
    };
}

function list() {
    return MODES.map(publicCard);
}

module.exports = { MODES, get, fallback, list, publicCard };
