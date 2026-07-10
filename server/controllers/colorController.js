/**
 * CouleurMoi (Toon Tone clone) Controller
 * Handles Socket.IO events and Express API routes for admin CRUD / upload
 */

const colorGameManager = require('../colorGameManager');
const colorCharacters = require('../colorCharacters');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const authMiddleware = require('../middleware/authMiddleware');

// Ensure upload directory exists
const UPLOAD_DIR = path.join(__dirname, '../uploads/color');
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Multer Storage configuration
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, UPLOAD_DIR);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'char-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Seules les images sont autorisées !'));
        }
    }
});

// Multer en mémoire pour la segmentation IA : l'image transite vers Gemini sans être
// persistée sur le disque (on ne garde que l'image détourée finale, uploadée séparément).
const memUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 6 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) cb(null, true);
        else cb(new Error('Seules les images sont autorisées !'));
    }
});

// Modèle Gemini utilisé pour la localisation (« pointing »). Surchargage possible via l'env.
// NB : les masques pixel (base64 PNG) ne sont pas fiables sur l'API publique — les points le sont.
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

// Extrait tous les points [y, x] (normalisés 0-1000) d'une réponse Gemini, de façon
// tolérante aux petites erreurs de formatage JSON que le modèle produit parfois.
function extractPoints(text) {
    const points = [];
    const re = /"point"\s*:\s*\[\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*\]/g;
    let m;
    while ((m = re.exec(text)) !== null) {
        const y = parseFloat(m[1]);
        const x = parseFloat(m[2]);
        if (y >= 0 && y <= 1000 && x >= 0 && x <= 1000) points.push({ x, y });
    }
    return points;
}

// Extrait la bounding-box du personnage [ymin, xmin, ymax, xmax] (normalisée 0-1000)
// si le modèle l'a renvoyée. Elle borne la passe couleur globale côté client.
function extractBox(text) {
    const m = /"box(?:_2d)?"\s*:\s*\[\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*\]/.exec(text);
    if (!m) return null;
    const box = m.slice(1, 5).map(parseFloat);
    if (box.some(v => v < 0 || v > 1000) || box[2] <= box[0] || box[3] <= box[1]) return null;
    return box;
}

// Helper for safe callbacks
const safeCallback = (callback, data) => {
    if (typeof callback === 'function') callback(data);
};

const HOST_GRACE_PERIOD_MS = 120000; // 2 minutes grace period for host disconnect
const hostDisconnectTimers = new Map();

// ================================================
// Express REST API Routes
// ================================================
function setupColorRoutes(app) {
    // List all characters (used by Admin & client optionally)
    app.get('/api/color/characters', async (req, res) => {
        try {
            res.json(await colorCharacters.getAll());
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // List available categories (univers) with a character count — used by the host lobby
    app.get('/api/color/categories', async (req, res) => {
        try {
            res.json(await colorCharacters.getCategories());
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Get single character
    app.get('/api/color/characters/:id', async (req, res) => {
        try {
            const char = await colorCharacters.getById(req.params.id);
            if (!char) return res.status(404).json({ error: 'Personnage non trouvé' });
            res.json(char);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Upload character WebP image
    app.post('/api/admin/color/upload', authMiddleware, upload.single('image'), (req, res) => {
        try {
            if (!req.file) {
                return res.status(400).json({ error: 'Aucun fichier uploadé' });
            }
            // Return relative URL for static service
            const fileUrl = `/uploads/color/${req.file.filename}`;
            res.json({ url: fileUrl });
        } catch (error) {
            console.error('[COLOR] Upload error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // Détourage assisté par IA : reçoit une image + le nom de la partie ("la peau",
    // "le t-shirt"…), demande à Gemini de pointer les zones correspondantes, et renvoie
    // ces points au client qui lance son flood-fill existant depuis chacun.
    app.post('/api/admin/color/segment', authMiddleware, memUpload.single('image'), async (req, res) => {
        try {
            const apiKey = process.env.GEMINI_API_KEY;
            if (!apiKey) {
                return res.status(500).json({ error: 'GEMINI_API_KEY non configurée sur le serveur' });
            }
            if (!req.file) {
                return res.status(400).json({ error: 'Image manquante' });
            }
            const part = (req.body.part || '').trim();
            if (!part) {
                return res.status(400).json({ error: 'Précise la partie à détecter (champ « Partie à colorer »)' });
            }

            const base64 = req.file.buffer.toString('base64');
            const mimeType = req.file.mimetype || 'image/png';
            const prompt =
                `Point to all distinct regions of "${part}" of the main character in this image ` +
                `(include every separated area, e.g. face, arms, hands, legs). Return up to 6 points. ` +
                `Also give the bounding box of the whole main character. Answer ONLY with compact JSON: ` +
                `{"points": [{"point": [y, x]}], "box": [ymin, xmin, ymax, xmax]} where all values are ` +
                `integers normalized to 0-1000 (y = vertical from top, x = horizontal from left). No prose.`;

            const geminiBody = {
                contents: [{
                    parts: [
                        { inline_data: { mime_type: mimeType, data: base64 } },
                        { text: prompt }
                    ]
                }],
                generationConfig: { temperature: 0, thinkingConfig: { thinkingBudget: 0 } }
            };

            const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
            const gemRes = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
                body: JSON.stringify(geminiBody)
            });

            if (!gemRes.ok) {
                const detail = await gemRes.text().catch(() => '');
                console.error('[COLOR] Gemini segment error', gemRes.status, detail.slice(0, 300));
                return res.status(502).json({ error: `Le service IA a répondu ${gemRes.status}`, detail: detail.slice(0, 200) });
            }

            const data = await gemRes.json();
            const text = (data.candidates?.[0]?.content?.parts || [])
                .map(p => p.text).filter(Boolean).join('');
            const points = extractPoints(text);

            if (points.length === 0) {
                return res.status(422).json({
                    error: `L'IA n'a pas localisé « ${part} ». Reformule (ex. « la peau », « le t-shirt ») ou détoure à la main.`,
                    raw: text.slice(0, 160)
                });
            }

            res.json({ points, box: extractBox(text), model: GEMINI_MODEL });
        } catch (error) {
            console.error('[COLOR] segment error:', error);
            res.status(500).json({ error: 'Erreur serveur lors de la segmentation IA' });
        }
    });

    // Create a new character
    app.post('/api/admin/color/characters', authMiddleware, async (req, res) => {
        try {
            const charData = req.body;
            // Validate unique ID
            const existing = await colorCharacters.getById(charData.id);
            if (existing) {
                return res.status(400).json({ error: 'Cet identifiant existe déjà' });
            }
            const success = await colorCharacters.addCharacter(charData);
            if (success) {
                res.json({ success: true, character: charData });
            } else {
                res.status(500).json({ error: 'Erreur lors de la création en base' });
            }
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Update character
    app.put('/api/admin/color/characters/:id', authMiddleware, async (req, res) => {
        try {
            const success = await colorCharacters.updateCharacter(req.params.id, req.body);
            if (success) {
                res.json({ success: true });
            } else {
                res.status(404).json({ error: 'Personnage non trouvé ou aucune modification' });
            }
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Delete character
    app.delete('/api/admin/color/characters/:id', authMiddleware, async (req, res) => {
        try {
            // Optional: delete associated file from filesystem
            const char = await colorCharacters.getById(req.params.id);
            if (char && char.image_path.startsWith('/uploads/color/')) {
                const filePath = path.join(__dirname, '..', char.image_path);
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
            }

            const success = await colorCharacters.deleteCharacter(req.params.id);
            if (success) {
                res.json({ success: true });
            } else {
                res.status(404).json({ error: 'Personnage non trouvé' });
            }
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    console.log('[COLOR] REST API routes initialized');
}

// ================================================
// Socket.IO Connection Handler
// ================================================
function handleConnection(io, socket) {
    
    // 1. Host Create Room
    socket.on('color-create-room', (data, callback) => {
        try {
            const { settings } = data || {};
            const roomCode = colorGameManager.createRoom(socket.id, settings);
            const room = colorGameManager.getRoom(roomCode);
            socket.join(`color-${roomCode}`);
            safeCallback(callback, { roomCode, remoteToken: room.remoteToken });
            console.log(`[COLOR] Room created: ${roomCode} by host socket ${socket.id}`);
        } catch (error) {
            console.error('[COLOR] Error in color-create-room:', error);
            safeCallback(callback, { error: 'Erreur serveur' });
        }
    });

    // 2. Host Reconnect
    socket.on('color-host-reconnect', (data, callback) => {
        try {
            const { roomCode } = data || {};
            const room = colorGameManager.getRoom(roomCode);
            if (room) {
                // Cancel deletion timer if host returned in time
                if (hostDisconnectTimers.has(roomCode)) {
                    clearTimeout(hostDisconnectTimers.get(roomCode));
                    hostDisconnectTimers.delete(roomCode);
                    console.log(`[COLOR] Host reconnected: cancelled cleanup timer for ${roomCode}`);
                }
                
                room.hostId = socket.id;
                room.hostDisconnected = false;
                socket.join(`color-${roomCode}`);
                console.log(`[COLOR] Host reconnected to room ${roomCode}`);

                const players = colorGameManager.getPlayersInRoom(roomCode).map(p => ({
                    id: p.id,
                    name: p.name,
                    avatar: p.avatar,
                    totalScore: p.totalScore || 0,
                    disconnected: p.disconnected || false
                }));

                safeCallback(callback, {
                    success: true,
                    roomCode,
                    gameState: room.gameState,
                    currentRound: room.currentRound,
                    totalRounds: room.totalRounds,
                    players,
                    timePerRound: room.timePerRound,
                    character: room.currentCharacter,
                    roundStartTime: room.roundStartTime
                });

                // Notify players
                socket.to(`color-${roomCode}`).emit('color-host-reconnected');
            } else {
                safeCallback(callback, { error: 'Salon non trouvé' });
            }
        } catch (error) {
            console.error('[COLOR] Error in color-host-reconnect:', error);
            safeCallback(callback, { error: 'Erreur serveur' });
        }
    });

    // 3. Player Join Room
    socket.on('color-join-room', (data, callback) => {
        try {
            const { roomCode, playerName, avatar } = data || {};
            const result = colorGameManager.joinRoom(roomCode, socket.id, playerName, avatar);
            if (result.error) {
                safeCallback(callback, { error: result.error });
            } else {
                socket.join(`color-${roomCode}`);

                if (result.reconnected) {
                    safeCallback(callback, {
                        success: true,
                        reconnected: true,
                        gameState: result.gameState,
                        currentRound: result.currentRound,
                        totalRounds: result.totalRounds,
                        character: result.character,
                        roundStartTime: result.roundStartTime,
                        timePerRound: result.timePerRound,
                        myScore: result.myScore
                    });
                    console.log(`[COLOR] Player ${playerName} reconnected to room ${roomCode}`);
                } else if (result.lateJoin) {
                    safeCallback(callback, {
                        success: true,
                        lateJoin: true,
                        gameState: result.gameState,
                        currentRound: result.currentRound,
                        totalRounds: result.totalRounds,
                        character: result.character,
                        roundStartTime: result.roundStartTime,
                        timePerRound: result.timePerRound,
                        missedRounds: result.missedRounds
                    });
                    console.log(`[COLOR] Player ${playerName} late joined room ${roomCode}`);
                } else {
                    safeCallback(callback, { success: true });
                    console.log(`[COLOR] Player ${playerName} joined room ${roomCode}`);
                }

                // Broadcast player list update to room
                io.to(`color-${roomCode}`).emit('color-player-joined', colorGameManager.getPlayersInRoom(roomCode));
            }
        } catch (error) {
            console.error('[COLOR] Error in color-join-room:', error);
            safeCallback(callback, { error: 'Erreur serveur lors de la connexion' });
        }
    });

    // 4. Host Update Settings (e.g. rounds count, time limits)
    socket.on('color-update-settings', (data) => {
        try {
            const { roomCode, settings } = data || {};
            const room = colorGameManager.getRoom(roomCode);
            if (!room || room.hostId !== socket.id) return;

            if (settings) {
                room.totalRounds = settings.roundsCount || room.totalRounds;
                room.timePerRound = settings.timePerRound || room.timePerRound;
                room.settings = { ...room.settings, ...settings };

                io.to(`color-${roomCode}`).emit('color-settings-updated', {
                    roundsCount: room.totalRounds,
                    timePerRound: room.timePerRound,
                    category: room.settings.category || null
                });
            }
        } catch (error) {
            console.error('[COLOR] Error in color-update-settings:', error);
        }
    });

    // 5. Host Start Game
    socket.on('color-start-game', async (data, callback) => {
        try {
            const { roomCode, settings } = data || {};
            const room = colorGameManager.getRoom(roomCode);
            if (!room || room.hostId !== socket.id) {
                safeCallback(callback, { error: 'Salon non trouvé ou droit insuffisant' });
                return;
            }

            if (room.gameState !== 'LOBBY') {
                safeCallback(callback, { error: 'Partie déjà démarrée' });
                return;
            }

            if (settings) {
                room.totalRounds = settings.roundsCount || room.totalRounds;
                room.timePerRound = settings.timePerRound || room.timePerRound;
                room.settings = { ...room.settings, ...settings };
            }

            const result = await colorGameManager.startGame(roomCode);
            if (result.success) {
                safeCallback(callback, {
                    success: true,
                    character: result.character,
                    round: result.round,
                    total: result.total,
                    timePerRound: room.timePerRound,
                    roundStartTime: room.roundStartTime
                });

                io.to(`color-${roomCode}`).emit('color-game-started', {
                    round: result.round,
                    total: result.total,
                    character: result.character,
                    timePerRound: room.timePerRound,
                    roundStartTime: room.roundStartTime
                });

                // Server security timer (auto-end round if client lags)
                setupServerRoundTimer(io, roomCode, room);

                console.log(`[COLOR] Game started in room ${roomCode}`);
            } else {
                safeCallback(callback, { error: result.error });
            }
        } catch (error) {
            console.error('[COLOR] Error in color-start-game:', error);
            safeCallback(callback, { error: 'Erreur serveur' });
        }
    });

    // 6. Player submit color guess
    socket.on('color-submit-guess', (data, callback) => {
        try {
            const { roomCode, h, s, b, hintUsed } = data || {};
            const result = colorGameManager.submitGuess(roomCode, socket.id, h, s, b, hintUsed);
            if (result.success) {
                safeCallback(callback, {
                    success: true,
                    score: result.score
                });

                // Notify room that player has submitted
                io.to(`color-${roomCode}`).emit('color-player-guessed', { playerId: socket.id });

                if (result.allGuessed) {
                    console.log(`[COLOR] All players guessed in room ${roomCode}`);
                    io.to(`color-${roomCode}`).emit('color-all-guessed');
                }
            } else {
                safeCallback(callback, { error: result.error });
            }
        } catch (error) {
            console.error('[COLOR] Error in color-submit-guess:', error);
            safeCallback(callback, { error: 'Erreur serveur' });
        }
    });

    // 7. End Round (reveal answers and scores)
    socket.on('color-end-round', (data, callback) => {
        try {
            const { roomCode } = data || {};
            const room = colorGameManager.getRoom(roomCode);
            if (!room || room.hostId !== socket.id) {
                safeCallback(callback, { error: 'Non autorisé' });
                return;
            }

            if (room.roundTimer) {
                clearTimeout(room.roundTimer);
                room.roundTimer = null;
            }

            const result = colorGameManager.endRound(roomCode);
            if (result.success) {
                safeCallback(callback, result);

                io.to(`color-${roomCode}`).emit('color-round-ended', {
                    results: result.results,
                    character: result.character,
                    currentRound: result.currentRound,
                    totalRounds: result.totalRounds
                });

                console.log(`[COLOR] Round ${result.currentRound} ended in room ${roomCode}`);
            } else {
                safeCallback(callback, { error: result.error });
            }
        } catch (error) {
            console.error('[COLOR] Error in color-end-round:', error);
            safeCallback(callback, { error: 'Erreur serveur' });
        }
    });

    // 8. Next Round (next character or show game over)
    socket.on('color-next-round', (data, callback) => {
        try {
            const { roomCode } = data || {};
            const room = colorGameManager.getRoom(roomCode);
            if (!room || room.hostId !== socket.id) {
                safeCallback(callback, { error: 'Non autorisé' });
                return;
            }

            const result = colorGameManager.nextRound(roomCode);
            if (result.gameOver) {
                safeCallback(callback, result);
                io.to(`color-${roomCode}`).emit('color-game-over', {
                    results: result.results,
                    awards: result.awards
                });
                console.log(`[COLOR] Game over in room ${roomCode}`);
            } else if (result.success) {
                safeCallback(callback, result);
                io.to(`color-${roomCode}`).emit('color-next-round', {
                    round: result.round,
                    total: result.total,
                    character: result.character,
                    timePerRound: room.timePerRound,
                    roundStartTime: room.roundStartTime
                });

                setupServerRoundTimer(io, roomCode, room);

                console.log(`[COLOR] Round ${result.round} started in room ${roomCode}`);
            } else {
                safeCallback(callback, { error: result.error });
            }
        } catch (error) {
            console.error('[COLOR] Error in color-next-round:', error);
            safeCallback(callback, { error: 'Erreur serveur' });
        }
    });

    // 9. Restart Game
    socket.on('color-restart-game', (data, callback) => {
        try {
            const { roomCode } = data || {};
            const room = colorGameManager.getRoom(roomCode);
            if (!room || room.hostId !== socket.id) {
                safeCallback(callback, { error: 'Non autorisé' });
                return;
            }

            const result = colorGameManager.restartGame(roomCode);
            if (result.success) {
                safeCallback(callback, { success: true });
                io.to(`color-${roomCode}`).emit('color-game-restarted');
            } else {
                safeCallback(callback, { error: result.error });
            }
        } catch (error) {
            console.error('[COLOR] Error in color-restart-game:', error);
            safeCallback(callback, { error: 'Erreur serveur' });
        }
    });

    // 10. Kick Player
    socket.on('color-kick-player', (data, callback) => {
        try {
            const { roomCode, playerId } = data || {};
            const room = colorGameManager.getRoom(roomCode);
            if (!room || room.hostId !== socket.id) {
                safeCallback(callback, { error: 'Non autorisé' });
                return;
            }

            const result = colorGameManager.kickPlayer(roomCode, playerId);
            if (result.success) {
                safeCallback(callback, { success: true });
                io.to(playerId).emit('color-kicked');
                io.sockets.sockets.get(playerId)?.leave(`color-${roomCode}`);
                io.to(`color-${roomCode}`).emit('color-player-left', colorGameManager.getPlayersInRoom(roomCode));
            } else {
                safeCallback(callback, { error: result.error });
            }
        } catch (error) {
            console.error('[COLOR] Error in color-kick-player:', error);
            safeCallback(callback, { error: 'Erreur serveur' });
        }
    });

    // 11. Delete Room
    socket.on('color-delete-room', (data, callback) => {
        try {
            const { roomCode } = data || {};
            const room = colorGameManager.getRoom(roomCode);
            if (!room || room.hostId !== socket.id) {
                safeCallback(callback, { error: 'Non autorisé' });
                return;
            }

            if (hostDisconnectTimers.has(roomCode)) {
                clearTimeout(hostDisconnectTimers.get(roomCode));
                hostDisconnectTimers.delete(roomCode);
            }

            io.to(`color-${roomCode}`).emit('color-host-disconnected');
            colorGameManager.deleteRoom(roomCode);
            safeCallback(callback, { success: true });
        } catch (error) {
            console.error('[COLOR] Error in color-delete-room:', error);
            safeCallback(callback, { error: 'Erreur serveur' });
        }
    });

    // 12. Emoji Reactions
    socket.on('color-reaction', (data) => {
        try {
            const { roomCode, emoji, playerName } = data || {};
            const room = colorGameManager.getRoom(roomCode);
            if (room) {
                io.to(`color-${roomCode}`).emit('color-reaction', {
                    emoji,
                    playerName,
                    playerId: socket.id
                });
            }
        } catch (error) {
            console.error('[COLOR] Error in color-reaction:', error);
        }
    });

    // 13. Chat messages
    socket.on('color-chat-message', (data) => {
        try {
            const { roomCode, message, playerName } = data || {};
            const room = colorGameManager.getRoom(roomCode);
            if (room) {
                io.to(`color-${roomCode}`).emit('color-chat-message', {
                    message,
                    playerName,
                    playerId: socket.id,
                    id: Date.now() + Math.random().toString(36).substring(2, 7)
                });
            }
        } catch (error) {
            console.error('[COLOR] Error in color-chat-message:', error);
        }
    });

    // 14. Handle disconnection
    socket.on('disconnect', () => {
        const result = colorGameManager.removePlayer(socket.id);
        if (result) {
            const { roomCode, isHost } = result;
            if (isHost) {
                // Grace period: host disconnected, wait 2 mins before deletion
                const timer = setTimeout(() => {
                    hostDisconnectTimers.delete(roomCode);
                    io.to(`color-${roomCode}`).emit('color-host-disconnected');
                    colorGameManager.deleteRoom(roomCode);
                    console.log(`[COLOR] Room ${roomCode} deleted after host grace period`);
                }, HOST_GRACE_PERIOD_MS);
                hostDisconnectTimers.set(roomCode, timer);
                console.log(`[COLOR] Host disconnected from ${roomCode}, grace period active`);
            } else {
                io.to(`color-${roomCode}`).emit('color-player-left', colorGameManager.getPlayersInRoom(roomCode));
            }
        }
    });
}

// Server security timer (auto-ends round if host fails to click)
function setupServerRoundTimer(io, roomCode, room) {
    if (room.roundTimer) {
        clearTimeout(room.roundTimer);
    }
    // +5s margin for network lag
    const delay = (room.timePerRound + 5) * 1000;
    room.roundTimer = setTimeout(() => {
        room.roundTimer = null;
        const currentRoom = colorGameManager.getRoom(roomCode);
        if (!currentRoom || currentRoom.gameState !== 'PLAYING') return;

        console.log(`[COLOR] Server timer: auto-end round ${currentRoom.currentRound} for room ${roomCode}`);
        const result = colorGameManager.endRound(roomCode);
        if (result.success) {
            io.to(`color-${roomCode}`).emit('color-round-ended', {
                results: result.results,
                character: result.character,
                currentRound: result.currentRound,
                totalRounds: result.totalRounds
            });
        }
    }, delay);
}

module.exports = { setupColorRoutes, handleConnection };
