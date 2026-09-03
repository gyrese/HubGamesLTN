import { io } from 'socket.io-client';

// En production (NAS), le site est servi par le même serveur → undefined = même origine
// En dev, on cible le bon port serveur selon le protocole utilisé par Vite :
//   - Si la page est servie en HTTPS (ex: certificat auto-signé sur NAS), on pointe vers le port HTTPS du serveur (3443)
//   - Sinon on pointe vers le port HTTP (3005)
function getServerURL() {
    if (import.meta.env.VITE_SERVER_URL) return import.meta.env.VITE_SERVER_URL;
    if (!import.meta.env.DEV) return undefined;
    const isHttps = window.location.protocol === 'https:';
    const port = isHttps ? 3443 : 3005;
    const proto = isHttps ? 'https' : 'http';
    return `${proto}://${window.location.hostname}:${port}`;
}
const URL = getServerURL();

// Identité stable de l'appareil, indépendante du socket.id (qui change à chaque
// reconnexion). Elle survit au rechargement de page et sert de clé de reprise de
// session aux jeux temps réel. Reprise de LTNHoot (socket-context.tsx).
const CLIENT_ID_KEY = 'ltn-client-id';

function getClientId() {
    try {
        const stored = localStorage.getItem(CLIENT_ID_KEY);
        if (stored) return stored;
        const fresh = (crypto.randomUUID && crypto.randomUUID())
            || `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
        localStorage.setItem(CLIENT_ID_KEY, fresh);
        return fresh;
    } catch {
        // Navigation privée ou stockage refusé : identité valable le temps de l'onglet.
        return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    }
}

export const clientId = getClientId();

export const socket = io(URL, {
    autoConnect: true,
    // Polling d'abord, puis montée automatique en WebSocket si le réseau et le
    // proxy le permettent. WebSocket est nettement plus stable que le long-polling
    // sur mobile (pas une requête HTTP par message) et c'est la seule façon de
    // tenir la cadence d'un jeu temps réel. Si l'upgrade échoue (proxy qui ne
    // relaie pas l'en-tête Upgrade), le client RESTE en polling sans rupture :
    // aucune régression possible par rapport au mode polling-only précédent.
    transports: ['polling', 'websocket'],
    upgrade: true,
    rememberUpgrade: false,
    // Reconnexion robuste
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    // Plafond bas : sur le wifi d'une salle, 8 s de backoff = une manche ratée.
    reconnectionDelayMax: 3000,
    randomizationFactor: 0.5,
    timeout: 20000,
    forceNew: false,
    auth: { clientId },
});

// Exposition du socket pour les tests E2E uniquement (jamais en usage normal).
// Le flag window.__E2E__ est posé par Playwright via addInitScript avant le chargement.
if (typeof window !== 'undefined' && window.__E2E__) {
    window.__geoSocket = socket;
}

// Debug: Log connection events (toujours actif pour diagnostic mobile)
socket.on('connect', () => {
    const transport = socket.io?.engine?.transport?.name;
    console.log(`[SOCKET] Connecté socket=${socket.id} transport=${transport}`);
    // L'upgrade polling → websocket est asynchrone : on le trace quand il aboutit.
    socket.io?.engine?.once('upgrade', () => {
        console.log(`[SOCKET] Transport monté en ${socket.io?.engine?.transport?.name}`);
    });
});

// Quand le serveur répond 400 "Session ID unknown" (ex: redémarrage du serveur),
// forcer une reconnexion avec un nouvel identifiant de session.
socket.on('disconnect', (reason) => {
    console.log(`[SOCKET] Déconnecté: ${reason}`);
    // On ne force une reconnexion que si Socket.IO ne s'en charge pas déjà.
    // `io server disconnect` est le seul cas où il abandonne ; partout ailleurs,
    // appeler `connect()` en parallèle de sa propre tentative invalide la
    // session en cours de négociation.
    if (reason === 'io server disconnect') {
        socket.io.opts.query = {};   // efface le sid en cache
        socket.connect();
    }
});

socket.on('connect_error', (err) => {
    console.error(`[SOCKET] Erreur connexion: ${err.message}`);
    // Forcer une reconnexion propre sans l'ancien session ID
    if (err.message?.includes('Session ID unknown') || err.description === 400) {
        socket.io.opts.query = {};
        setTimeout(() => socket.connect(), 500);
    }
});
socket.io.on('reconnect_attempt', (attempt) => console.log(`[SOCKET] Tentative reconnexion #${attempt}`));
socket.io.on('reconnect_error', (err) => console.error(`[SOCKET] Erreur reconnexion: ${err.message}`));
socket.io.on('reconnect_failed', () => console.error('[SOCKET] Échec définitif de la reconnexion'));

// ─────────────────────────────────────────────────────────────────────────────
// Watchdog mobile (repris de LTNHoot)
//
// Quand l'app revient au premier plan (téléphone déverrouillé, retour d'onglet)
// ou que le réseau revient, on n'attend ni le backoff de Socket.IO (dont les
// timers sont gelés en arrière-plan par l'OS) ni le ping timeout pour découvrir
// que le lien est mort. On vérifie tout de suite : déconnecté → connect() ;
// « connecté » → sonde avec accusé de réception, sans réponse → on recycle.
// C'est ce qui ramène un joueur qui rallume son téléphone en ~1 s au lieu de 20 s.
// ─────────────────────────────────────────────────────────────────────────────
if (typeof window !== 'undefined') {
    let lastProbe = 0;

    const verifyLiveness = () => {
        if (document.visibilityState === 'hidden') return;

        if (!socket.connected) {
            // `active` est vrai dès qu'une tentative est en cours : forcer un
            // `connect()` par-dessus casserait la poignée de main en train de se
            // faire et invaliderait la session (« Session ID unknown »), ce qui
            // laissait l'écran hôte bloqué sur son chargement au premier accès.
            if (socket.active) return;
            console.log('[WATCHDOG] Premier plan et socket déconnecté → reconnexion immédiate');
            socket.connect();
            return;
        }

        // Anti-rafale : online + pageshow + visibilitychange peuvent tirer ensemble.
        const now = Date.now();
        if (now - lastProbe < 3000) return;
        lastProbe = now;

        socket.timeout(7000).emit('connection:ping', (err) => {
            if (err) {
                console.warn('[WATCHDOG] Sonde sans réponse → recyclage de la connexion');
                socket.disconnect();
                socket.connect();
            }
        });
    };

    window.addEventListener('online', verifyLiveness);
    window.addEventListener('pageshow', verifyLiveness);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') verifyLiveness();
    });
}
