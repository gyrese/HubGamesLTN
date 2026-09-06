// Charge le .env racine pour le dev local (cd server && npm run dev).
// En prod (Docker), les variables sont déjà injectées par docker-compose ; dotenv
// ne trouve pas de fichier et n'écrase jamais une variable déjà définie → sans effet.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const path = require('path');
const http = require('http');
const https = require('https');
const fs = require('fs');
const { Server } = require('socket.io');
const cors = require('cors');

// --- VALIDATION DES SECRETS (fail-fast) ---
// Refuser de démarrer si les secrets critiques ne sont pas fournis par l'environnement.
// Empêche tout déploiement avec des valeurs de repli prévisibles.
const REQUIRED_ENV = ['JWT_SECRET', 'ADMIN_PASSWORD'];
const missingEnv = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missingEnv.length > 0) {
    console.error(`[FATAL] Variables d'environnement requises manquantes : ${missingEnv.join(', ')}`);
    console.error('[FATAL] Définissez-les (ex. via docker-compose / .env) avant de démarrer le serveur.');
    process.exit(1);
}
if (process.env.ADMIN_PASSWORD.length < 8) {
    console.error('[FATAL] ADMIN_PASSWORD doit faire au moins 8 caractères.');
    process.exit(1);
}

const quizManager = require('./quizManager');
const authMiddleware = require('./middleware/authMiddleware');

// Controllers
const quizController = require('./controllers/quizController');
const geoController = require('./controllers/geoController');
const drawController = require('./controllers/drawController');
const adminController = require('./controllers/adminController');
const colorController = require('./controllers/colorController');
const fakeArtistController = require('./controllers/fakeArtistController');
const hubController = require('./controllers/hubController');
const partyController = require('./controllers/partyController');
const ioArenaController = require('./controllers/ioController');
const danceController = require('./controllers/danceController');

const rateLimit = require('express-rate-limit');

const app = express();
// Derrière Caddy (reverse proxy) : faire confiance au 1er proxy pour obtenir la vraie IP
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Rate limiting global sur l'API REST (protection DoS / abus)
const apiLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 300,            // 300 requêtes/min/IP
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Trop de requêtes. Réessayez dans un instant.' }
});
app.use('/api/', apiLimiter);

// Setup Admin Routes
adminController.setupRoutes(app);
// Setup Color API Routes
colorController.setupColorRoutes(app);
// Setup Dance API Routes (catalogue et téléversement des morceaux)
danceController.setupRoutes(app);

// Servir les fichiers uploadés (Images, etc.)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// API REST pour l'Admin
app.get('/api/quizzes', async (req, res) => {
    res.json(await quizManager.getAllQuizzes());
});

app.get('/api/quizzes/:id', async (req, res) => {
    const quiz = await quizManager.getQuiz(req.params.id);
    if (quiz) res.json(quiz);
    else res.status(404).json({ error: 'Quiz not found' });
});

app.post('/api/quizzes', authMiddleware, async (req, res) => {
    const newQuiz = await quizManager.createQuiz(req.body);
    res.json(newQuiz);
});

app.put('/api/quizzes/:id', authMiddleware, async (req, res) => {
    const updatedQuiz = await quizManager.updateQuiz(req.params.id, req.body);
    if (updatedQuiz) res.json(updatedQuiz);
    else res.status(404).json({ error: 'Quiz not found' });
});

app.delete('/api/quizzes/:id', authMiddleware, async (req, res) => {
    const success = await quizManager.deleteQuiz(req.params.id);
    if (success) res.json({ success: true });
    else res.status(404).json({ error: 'Quiz not found' });
});

// Universal room resolver endpoint (checks all game managers)
app.get('/api/room/:code', (req, res) => {
    const roomCode = req.params.code.toUpperCase();

    // Code de soirée (PASSEPORT) : testé en premier, c'est le seul code qu'un
    // joueur est censé saisir quand une soirée est en cours.
    const hub = require('./core/hubSession');
    if (hub.getSession(roomCode)) {
        return res.json({ gameType: 'hub' });
    }

    // Check Neural Quiz
    const quizGameManager = require('./gameManager');
    if (quizGameManager.getRoom(roomCode)) {
        return res.json({ gameType: 'quiz' });
    }
    
    // Check GeoTrackr
    const geoGameManager = require('./geoGameManager');
    if (geoGameManager.getRoom(roomCode)) {
        return res.json({ gameType: 'geo' });
    }
    
    // Check DrawUp
    const drawGameManager = require('./drawGameManager');
    if (drawGameManager.getRoom(roomCode)) {
        return res.json({ gameType: 'draw' });
    }
    
    // Check CouleurMoi
    const colorGameManager = require('./colorGameManager');
    if (colorGameManager.getRoom(roomCode)) {
        return res.json({ gameType: 'color' });
    }
    
    // Check FakeArtist
    const fakeArtistGameManager = require('./fakeArtistGameManager');
    if (fakeArtistGameManager.getRoom(roomCode)) {
        return res.json({ gameType: 'fakeartist' });
    }

    // Check Super LTN Party
    const partyGameManager = require('./partyGameManager');
    if (partyGameManager.getRoom(roomCode)) {
        return res.json({ gameType: 'party' });
    }

    // Check IO Arena
    const ioGameManager = require('./ioGameManager');
    if (ioGameManager.getRoom(roomCode)) {
        return res.json({ gameType: 'io' });
    }

    // Check Dance Dance
    const danceGameManager = require('./danceGameManager');
    if (danceGameManager.getRoom(roomCode)) {
        return res.json({ gameType: 'dance' });
    }

    res.status(404).json({ error: 'Salon non trouvé' });
});

// --- HTTPS / HTTP SERVER SETUP ---
const HTTPS_PORT = process.env.HTTPS_PORT || 3443;
const PORT = process.env.PORT || 3005;

// Try to load SSL certificates
let sslOptions = null;
const certDir = path.join(__dirname, 'certs');
const keyPath = path.join(certDir, 'key.pem');
const certPath = path.join(certDir, 'cert.pem');

if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    try {
        sslOptions = {
            key: fs.readFileSync(keyPath),
            cert: fs.readFileSync(certPath)
        };
        console.log('[SERVER] SSL certificates loaded from server/certs/');
    } catch (err) {
        console.warn('[SERVER] Failed to load SSL certificates:', err.message);
    }
}

// Create main server: HTTPS if certs available, HTTP otherwise
let server;
if (sslOptions) {
    server = https.createServer(sslOptions, app);
    console.log('[SERVER] HTTPS mode enabled');
} else {
    server = http.createServer(app);
    console.log('[SERVER] HTTP mode (no SSL certificates)');
}

const io = new Server(server, {
    maxHttpBufferSize: 1e8,
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        credentials: true
    },
    // Polling d'abord, puis montée automatique en WebSocket si le réseau et le
    // proxy le permettent. WebSocket est nettement plus stable que le long-polling
    // sur mobile (pas une requête HTTP par message, pas de coupure de cycle de
    // poll en veille radio) et c'est le prérequis des jeux temps réel (IO).
    // Si l'upgrade échoue, le client RESTE en polling sans rupture : pas de
    // régression possible par rapport au mode polling-only précédent.
    transports: ["polling", "websocket"],
    allowUpgrades: true,
    // Hardening pour réseaux instables (mobile). Lien mort détecté en ≤20s
    // (pingInterval + pingTimeout) au lieu de ~85s. Un faux positif ne coûte
    // qu'un blip : la reconnexion se fait par pseudo avec resynchronisation.
    pingTimeout: 10000,
    pingInterval: 10000,
    connectTimeout: 45000,
    allowEIO3: false
});

// Logging Engine.IO (Focus Polling)
io.engine.on("connection_error", (err) => {
    console.error(`[POLLING_ERR] code=${err.code} message=${err.message} req_url=${err.req?.url}`);
});

io.engine.on("connection", (engineSocket) => {
    console.log(`[POLLING] Connexion active: sid=${engineSocket.id} transport=${engineSocket.transport.name} ip=${engineSocket.remoteAddress}`);
    engineSocket.on("close", (reason) => {
        console.log(`[POLLING] Connexion close: sid=${engineSocket.id} raison=${reason}`);
    });
});

// HTTP server (when HTTPS is enabled) — Socket.IO accessible en HTTP ET HTTPS
// On n'utilise PAS de redirection : Socket.IO ne suit pas les redirections 301
let httpServer = null;
if (sslOptions) {
    httpServer = http.createServer(app);
    // Attacher Socket.IO aussi au serveur HTTP pour les clients Vite (dev)
    io.attach(httpServer);
}

io.on('connection', (socket) => {
    const transport = socket.conn.transport.name;
    console.log(`[IO] Client connecté: socketId=${socket.id} transport=${transport}`);

    socket.on('error', (err) => {
        console.error(`[IO_ERR] socketId=${socket.id}: ${err.message}`);
    });

    // Sonde de vivacité du watchdog client (retour d'arrière-plan mobile) : on
    // acquitte immédiatement pour prouver que le lien est réellement vivant.
    socket.on('connection:ping', (ack) => {
        if (typeof ack === 'function') ack();
    });

    // Synchronisation d'horloge (SNTP) : le client calcule son décalage avec le
    // serveur pour interpoler correctement les états temps réel et aligner les
    // comptes à rebours entre appareils.
    socket.on('connection:syncTime', (data, ack) => {
        if (typeof ack === 'function') {
            ack({
                clientTime: typeof data?.clientTime === 'number' ? data.clientTime : Date.now(),
                serverTime: Date.now(),
            });
        }
    });

    try {
        // Delegate execution to game controllers
        // Each controller will register its own event listeners on the socket
        quizController.handleConnection(io, socket);
        geoController.handleConnection(io, socket);
        drawController.handleConnection(io, socket);
        colorController.handleConnection(io, socket);
        fakeArtistController.handleConnection(io, socket);
        partyController.handleConnection(io, socket);
        ioArenaController.handleConnection(io, socket);
        danceController.handleConnection(io, socket);
        hubController.handleConnection(io, socket);
        console.log('[SERVER] All controllers initialized for socket:', socket.id);
    } catch (error) {
        console.error('[SERVER] ERROR initializing controllers for socket', socket.id, ':', error);
    }

    socket.on('disconnect', (reason) => {
        console.log(`[IO] Client déconnecté: socketId=${socket.id} raison=${reason}`);
    });
});

// --- SERVITUDE STATIQUE (POUR LE NAS/PROD) ---
// Sert les fichiers du frontend buildé s'ils existent
app.use(express.static(path.join(__dirname, '../client/dist')));

// Pour toutes les autres requêtes (SPA), renvoyer index.html
// Note: Commenté en dev car Vite gère le routing. Décommenter pour la production.
app.get(/(.*)/, (req, res) => {
    const indexPath = path.join(__dirname, '../client/dist/index.html');
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        res.status(404).send("Frontend build not found. Did you run 'npm run build' in the client folder?");
    }
});

if (sslOptions) {
    // HTTPS mode: serveur principal sur HTTPS_PORT, HTTP sur PORT (sans redirection — Socket.IO doit fonctionner en HTTP aussi)
    server.listen(HTTPS_PORT, () => {
        console.log(`[SERVER] HTTPS en écoute sur le port ${HTTPS_PORT}`);
        console.log(`[SERVER] Accès sécurisé: https://localhost:${HTTPS_PORT}`);
    });
    if (httpServer) {
        httpServer.listen(PORT, () => {
            console.log(`[SERVER] HTTP en écoute sur le port ${PORT} (Socket.IO accessible en HTTP et HTTPS)`);
        });
    }
} else {
    // HTTP mode: main server on PORT
    server.listen(PORT, () => {
        console.log(`[SERVER] HTTP en écoute sur le port ${PORT}`);
    });
    console.log('[SERVER] Pour activer HTTPS, placez key.pem et cert.pem dans server/certs/');
    console.log('[SERVER] Générer un certificat auto-signé:');
    console.log('  openssl req -x509 -newkey rsa:2048 -keyout server/certs/key.pem -out server/certs/cert.pem -days 365 -nodes -subj "/CN=LTNhout"');
}
