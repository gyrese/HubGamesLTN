const drawWords = require('../drawWords');
const geoLocations = require('../geoLocations');
const authMiddleware = require('../middleware/authMiddleware');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');

// Anti brute-force : limiter les tentatives de login (par IP)
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10,                  // 10 tentatives par fenêtre
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Trop de tentatives de connexion. Réessayez plus tard.' }
});

// Aucune valeur de repli : présence garantie au démarrage (voir index.js, validation fail-fast)
const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

module.exports = {
    setupRoutes: (app) => {
        // ================================================
        // ADMIN - LOGIN
        // ================================================
        app.post('/api/admin/login', loginLimiter, (req, res) => {
            const { password } = req.body;
            if (!password) {
                return res.status(400).json({ error: 'Mot de passe requis' });
            }

            if (password === ADMIN_PASSWORD) {
                // Générer un token JWT valide pour 24h
                const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '24h' });
                return res.json({ success: true, token });
            } else {
                return res.status(401).json({ error: 'Mot de passe incorrect' });
            }
        });

        // ================================================
        // ADMIN - GEO TRACKR
        // ================================================

        // Get all locations
        app.get('/api/admin/geo/locations', authMiddleware, async (req, res) => {
            try {
                const locations = await geoLocations.getAll();
                res.json(locations);
            } catch (error) {
                console.error('Error getting geo locations:', error);
                res.status(500).json({ error: 'Failed to load locations' });
            }
        });

        // Expand Google Maps short URL
        app.get('/api/admin/geo/expand-url', authMiddleware, async (req, res) => {
            const { url } = req.query;

            if (!url) {
                return res.status(400).json({ error: 'URL is required' });
            }

            try {
                // Fix SSRF: valider que l'URL appartient bien à Google Maps
                const parsedUrl = new URL(url);
                const allowedHostnames = [
                    'maps.app.goo.gl',
                    'goo.gl',
                    'google.com',
                    'www.google.com',
                    'google.fr',
                    'www.google.fr'
                ];

                if (!allowedHostnames.includes(parsedUrl.hostname)) {
                    return res.status(400).json({ error: 'URL non autorisée. Seuls les liens Google Maps sont permis.' });
                }

                // Use fetch to follow redirects and get the final URL
                const https = require('https');
                const http = require('http');

                const expandUrl = (shortUrl) => {
                    return new Promise((resolve, reject) => {
                        const protocol = shortUrl.startsWith('https') ? https : http;

                        const request = protocol.get(shortUrl, {
                            timeout: 5000,
                            headers: {
                                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                            }
                        }, (response) => {
                            // Check for redirect
                            if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                                try {
                                    const redirectUrl = response.headers.location;
                                    const parsedRedirect = new URL(redirectUrl, shortUrl);
                                    
                                    // Valider le domaine de redirection pour éviter les vulnérabilités SSRF
                                    if (parsedRedirect.hostname && !allowedHostnames.includes(parsedRedirect.hostname)) {
                                        return reject(new Error('Redirection non autorisée vers un domaine externe.'));
                                    }
                                    
                                    // Follow redirect
                                    expandUrl(parsedRedirect.toString()).then(resolve).catch(reject);
                                } catch (err) {
                                    reject(err);
                                }
                            } else {
                                // Final URL - return what we have
                                resolve(shortUrl);
                            }
                        });

                        request.on('error', reject);
                        request.on('timeout', () => {
                            request.destroy();
                            reject(new Error('Timeout'));
                        });
                    });
                };

                const expandedUrl = await expandUrl(url);
                res.json({ expandedUrl });
            } catch (error) {
                console.error('Error expanding URL:', error);
                res.status(500).json({ error: 'Could not expand URL', expandedUrl: url });
            }
        });

        // Add a new location
        app.post('/api/admin/geo/locations', authMiddleware, async (req, res) => {
            const { lat, lng, country, city } = req.body;

            if (!lat || !lng || !country || !city) {
                return res.status(400).json({ error: 'Lat, Lng, Country and City are required' });
            }

            // Validation des coordonnées
            const parsedLat = parseFloat(lat);
            const parsedLng = parseFloat(lng);
            if (isNaN(parsedLat) || parsedLat < -90 || parsedLat > 90) {
                return res.status(400).json({ error: 'Latitude invalide (-90 à 90)' });
            }
            if (isNaN(parsedLng) || parsedLng < -180 || parsedLng > 180) {
                return res.status(400).json({ error: 'Longitude invalide (-180 à 180)' });
            }

            const newLocation = { lat: parsedLat, lng: parsedLng, country, city };
            const success = await geoLocations.add(newLocation);

            if (success) {
                res.json({ success: true, location: newLocation });
            } else {
                res.status(500).json({ error: 'Failed to add location (duplicate city?)' });
            }
        });

        // Update a location
        app.put('/api/admin/geo/locations', authMiddleware, async (req, res) => {
            const { originalCity, lat, lng, country, city } = req.body;

            if (!originalCity || !lat || !lng || !country || !city) {
                return res.status(400).json({ error: 'OriginalCity, Lat, Lng, Country and City are required' });
            }

            const newLocation = { lat: parseFloat(lat), lng: parseFloat(lng), country, city };
            const success = await geoLocations.update(originalCity, newLocation);

            if (success) {
                res.json({ success: true, location: newLocation });
            } else {
                res.status(500).json({ error: 'Failed to update location' });
            }
        });

        // Delete a location
        app.delete('/api/admin/geo/locations', authMiddleware, async (req, res) => {
            const { city } = req.body;

            if (!city) {
                return res.status(400).json({ error: 'City is required' });
            }

            const success = await geoLocations.remove(city);
            if (success) {
                res.json({ success: true });
            } else {
                res.status(500).json({ error: 'Failed to delete location' });
            }
        });

        // ================================================
        // ADMIN - DRAW UP (PICTIONARY)
        // ================================================

        // Get all words (grouped by category key)
        app.get('/api/admin/draw/words', authMiddleware, async (req, res) => {
            try {
                const dbGrouped = await drawWords.getFullDatabase();
                res.json(dbGrouped);
            } catch (error) {
                console.error('Error getting draw words:', error);
                res.status(500).json({ error: 'Failed to load words' });
            }
        });

        // Add a new word
        app.post('/api/admin/draw/words', authMiddleware, async (req, res) => {
            const { categoryKey, word, hint, categoryLabel } = req.body;

            if (!categoryKey || !word) {
                return res.status(400).json({ error: 'CategoryKey and Word are required' });
            }

            const newWord = {
                word,
                category: categoryLabel || 'Divers', // Visual category label
                hint
            };

            const success = await drawWords.addWord(categoryKey, newWord);
            if (success) {
                res.json({ success: true, word: newWord });
            } else {
                res.status(500).json({ error: 'Failed to add word (duplicate or invalid category)' });
            }
        });

        // Update a word
        app.put('/api/admin/draw/words', authMiddleware, async (req, res) => {
            const { categoryKey, originalWord, newWord, newHint, newCategoryLabel } = req.body;

            if (!categoryKey || !originalWord || !newWord) {
                return res.status(400).json({ error: 'CategoryKey, OriginalWord and NewWord are required' });
            }

            const newWordObj = {
                word: newWord,
                category: newCategoryLabel || 'Divers',
                hint: newHint
            };

            const success = await drawWords.updateWord(categoryKey, originalWord, newWordObj);
            if (success) {
                res.json({ success: true, word: newWordObj });
            } else {
                res.status(500).json({ error: 'Failed to update word' });
            }
        });

        // Delete a word
        app.delete('/api/admin/draw/words', authMiddleware, async (req, res) => {
            const { categoryKey, word } = req.body;

            if (!categoryKey || !word) {
                return res.status(400).json({ error: 'CategoryKey and Word are required' });
            }

            const success = await drawWords.deleteWord(categoryKey, word);
            if (success) {
                res.json({ success: true });
            } else {
                res.status(500).json({ error: 'Failed to delete word' });
            }
        });

        // Add a new category
        app.post('/api/admin/draw/categories', authMiddleware, async (req, res) => {
            const { key, label } = req.body;
            if (!key) return res.status(400).json({ error: 'Key is required' });

            const success = await drawWords.addCategory(key, label);
            if (success) {
                res.json({ success: true });
            } else {
                res.status(500).json({ error: 'Failed to add category (key might exist)' });
            }
        });

        // Delete a category
        app.delete('/api/admin/draw/categories/:key', authMiddleware, async (req, res) => {
            const { key } = req.params;
            const success = await drawWords.deleteCategory(key);
            if (success) {
                res.json({ success: true });
            } else {
                res.status(500).json({ error: 'Failed to delete category' });
            }
        });

        // Batch Import words (JSON array)
        app.post('/api/admin/draw/words/import', authMiddleware, async (req, res) => {
            try {
                const { words } = req.body;
                if (!Array.isArray(words) || words.length === 0) {
                    return res.status(400).json({ error: 'Le champ "words" doit être un tableau JSON non vide.' });
                }
                const result = await drawWords.importWordsBatch(words);
                res.json({ success: true, imported: result.imported });
            } catch (error) {
                console.error('[ADMIN] Error importing words batch:', error);
                res.status(500).json({ error: 'Erreur lors de l\'importation des mots.' });
            }
        });

        // Export all words as JSON
        app.get('/api/admin/draw/words/export', authMiddleware, async (req, res) => {
            try {
                const allWords = await drawWords.getAllWords();
                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Content-Disposition', 'attachment; filename=draw_words_export.json');
                res.json(allWords);
            } catch (error) {
                console.error('[ADMIN] Error exporting words:', error);
                res.status(500).json({ error: 'Erreur lors de l\'exportation des mots.' });
            }
        });
    }
};

