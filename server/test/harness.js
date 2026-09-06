/**
 * Harnais de test — monte un vrai serveur Socket.IO avec les contrôleurs réels
 * et fournit de quoi piloter des clients.
 *
 * Aucune dépendance de test externe : le dépôt n'en a pas, et en ajouter une
 * pour ce chantier serait un changement non demandé.
 */

const http = require('http');
const { Server } = require('socket.io');
const ioc = require('../../client/node_modules/socket.io-client');

let nextPort = 3910;

/* ── Compteurs et rapport ──────────────────────────────────────────── */

const state = { pass: 0, fail: 0, failures: [] };

function ok(label, condition, detail = '') {
    if (condition) {
        state.pass++;
        console.log(`  \x1b[32mOK\x1b[0m   ${label}`);
    } else {
        state.fail++;
        state.failures.push(label);
        console.log(`  \x1b[31mFAIL\x1b[0m ${label}${detail ? ` — ${detail}` : ''}`);
    }
    return condition;
}

function section(title) {
    console.log(`\n\x1b[1m── ${title}\x1b[0m`);
}

function report() {
    const total = state.pass + state.fail;
    console.log(`\n${'─'.repeat(58)}`);
    if (state.fail === 0) {
        console.log(`\x1b[32m✓ ${state.pass}/${total} assertions vertes\x1b[0m`);
    } else {
        console.log(`\x1b[31m✗ ${state.fail} échec(s) sur ${total}\x1b[0m`);
        state.failures.forEach(f => console.log(`  · ${f}`));
    }
    return state.fail === 0;
}

/* ── Serveur ───────────────────────────────────────────────────────── */

/**
 * Démarre un serveur isolé branché sur les contrôleurs fournis.
 * @param {Array<{handleConnection: Function}>} controllers
 */
async function startServer(controllers) {
    const port = nextPort++;
    const httpServer = http.createServer();
    // Même limite que la production, pour que les tests de charge soient fidèles
    const io = new Server(httpServer, { cors: { origin: '*' }, maxHttpBufferSize: 1e8 });

    io.on('connection', socket => {
        for (const c of controllers) c.handleConnection(io, socket);
    });

    await new Promise(resolve => httpServer.listen(port, resolve));

    return {
        port,
        io,
        close: () => new Promise(resolve => {
            io.close();
            httpServer.close(resolve);
        })
    };
}

/* ── Clients ───────────────────────────────────────────────────────── */

const sockets = [];

/** Ouvre un client et attend sa connexion. */
async function connect(port) {
    const s = ioc(`http://localhost:${port}`, {
        transports: ['websocket'],
        forceNew: true,
        reconnection: false
    });
    sockets.push(s);
    await once(s, 'connect');
    return s;
}

/** Attend un évènement, avec délai maximal. */
function once(socket, event, timeoutMs = 4000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new Error(`Timeout sur "${event}" après ${timeoutMs} ms`)),
            timeoutMs
        );
        // Un évènement sans charge utile doit rester distinguable d'une absence
        // de réception : on résout sur `true` plutôt que sur `undefined`.
        socket.once(event, data => { clearTimeout(timer); resolve(data === undefined ? true : data); });
    });
}

/** Comme `once`, mais renvoie null au lieu de rejeter. */
async function maybe(socket, event, timeoutMs = 1200) {
    try { return await once(socket, event, timeoutMs); } catch { return null; }
}

/**
 * Émet en attendant l'accusé de réception.
 * `payload === undefined` émet sans argument : certains handlers (le quiz)
 * attendent le callback en première position.
 */
function emit(socket, event, payload, timeoutMs = 4000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new Error(`Pas de réponse à "${event}" après ${timeoutMs} ms`)),
            timeoutMs
        );
        const done = res => { clearTimeout(timer); resolve(res); };
        if (payload === undefined) socket.emit(event, done);
        else socket.emit(event, payload, done);
    });
}

const wait = ms => new Promise(r => setTimeout(r, ms));

/** Ferme tous les clients ouverts. */
function closeAll() {
    for (const s of sockets) { try { s.close(); } catch { /* déjà fermé */ } }
    sockets.length = 0;
}

module.exports = { startServer, connect, once, maybe, emit, wait, closeAll, ok, section, report, state };
