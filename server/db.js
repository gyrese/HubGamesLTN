const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const DB_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DB_DIR, 'database.sqlite');

// S'assurer que le dossier data existe
if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
}

// Ouvrir la base de données SQLite
const dbInstance = new sqlite3.Database(DB_FILE, (err) => {
    if (err) {
        console.error('[DATABASE] Erreur lors de l\'ouverture de SQLite :', err.message);
    } else {
        console.log('[DATABASE] Connecté à la base de données SQLite.');
    }
});

// Wrapper asynchrone pour faciliter l'utilisation avec async/await
const db = {
    run: (sql, params = []) => {
        return new Promise((resolve, reject) => {
            dbInstance.run(sql, params, function (err) {
                if (err) reject(err);
                else resolve({ lastID: this.lastID, changes: this.changes });
            });
        });
    },
    get: (sql, params = []) => {
        return new Promise((resolve, reject) => {
            dbInstance.get(sql, params, (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    },
    all: (sql, params = []) => {
        return new Promise((resolve, reject) => {
            dbInstance.all(sql, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    },
    exec: (sql) => {
        return new Promise((resolve, reject) => {
            dbInstance.exec(sql, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }
};

// Fonction pour initialiser le schéma de la base de données et importer l'ancien JSON
async function initDatabase() {
    try {
        // Table des Quizzes Classiques (Neural Quiz)
        await db.run(`
            CREATE TABLE IF NOT EXISTS quizzes (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                description TEXT,
                questions TEXT NOT NULL -- Tableau JSON sérialisé
            )
        `);

        // Table des Apero Quizzes
        await db.run(`
            CREATE TABLE IF NOT EXISTS apero_quizzes (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                description TEXT,
                slides TEXT NOT NULL, -- Tableau JSON sérialisé
                createdAt TEXT,
                updatedAt TEXT
            )
        `);

        // Table des mots Draw Up (Pictionary)
        await db.run(`
            CREATE TABLE IF NOT EXISTS draw_words (
                categoryKey TEXT,
                word TEXT,
                category TEXT,
                hint TEXT,
                PRIMARY KEY (categoryKey, word)
            )
        `);

        // Table des lieux GeoTrackr
        await db.run(`
            CREATE TABLE IF NOT EXISTS geo_locations (
                city TEXT PRIMARY KEY,
                lat REAL NOT NULL,
                lng REAL NOT NULL,
                country TEXT NOT NULL
            )
        `);

        // Table des personnages de CouleurMoi
        await db.run(`
            CREATE TABLE IF NOT EXISTS color_characters (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                part TEXT NOT NULL,
                source TEXT NOT NULL,
                category TEXT,
                target_h INTEGER NOT NULL,
                target_s INTEGER NOT NULL,
                target_b INTEGER NOT NULL,
                image_path TEXT NOT NULL
            )
        `);

        // Migration : ajoute la colonne `category` sur les bases déjà créées sans elle
        // (permet de lancer les parties par univers : Disney, Nickelodeon, Anime…).
        const colorCols = await db.all(`PRAGMA table_info(color_characters)`);
        if (!colorCols.some(c => c.name === 'category')) {
            await db.run(`ALTER TABLE color_characters ADD COLUMN category TEXT`);
            console.log('[DATABASE] Migration : colonne color_characters.category ajoutée.');
        }

        console.log('[DATABASE] Schéma de la base SQLite initialisé.');

        // Exécuter l'import automatique des fichiers JSON (Seeding)
        await seedFromJSON();

    } catch (err) {
        console.error('[DATABASE] Erreur lors de l\'initialisation de la base :', err);
    }
}

// Fonction de migration / peuplement initial
async function seedFromJSON() {
    try {
        // 1. Seeding Quizzes classiques (Neural Quiz)
        // Reseed piloté par un hash du JSON (comme CouleurMoi) : dès que quizzes.json
        // change (questions, explications, difficulté), les séries canoniques (ids
        // « serie-* » du fichier) sont resynchronisées — y compris sur un volume déjà
        // peuplé. Les quiz créés via l'admin (ids timestamp) sont préservés.
        const quizJsonFile = path.join(__dirname, 'quizzes.json');
        if (fs.existsSync(quizJsonFile)) {
            const rawData = fs.readFileSync(quizJsonFile, 'utf8');
            const quizzes = JSON.parse(rawData);
            const hash = crypto.createHash('sha1').update(rawData).digest('hex');

            await db.run(`CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT)`);
            const meta = await db.get(`SELECT value FROM app_meta WHERE key = 'quiz_seed_hash'`);
            const countQuiz = await db.get('SELECT COUNT(*) as count FROM quizzes');

            if (countQuiz.count === 0 || !meta || meta.value !== hash) {
                const reason = countQuiz.count === 0 ? 'table vide' : 'quizzes.json modifié';
                console.log(`[DATABASE] Migration : (re)synchronisation de quizzes.json vers SQLite (${reason})...`);
                for (const quiz of quizzes) {
                    await db.run(
                        'INSERT OR REPLACE INTO quizzes (id, title, description, questions) VALUES (?, ?, ?, ?)',
                        [quiz.id, quiz.title, quiz.description, JSON.stringify(quiz.questions)]
                    );
                }
                await db.run(`INSERT OR REPLACE INTO app_meta (key, value) VALUES ('quiz_seed_hash', ?)`, [hash]);
                console.log(`[DATABASE] Migration : ${quizzes.length} quizzes synchronisés.`);
            }
        }

        // 2. Seeding Apéro Quizzes
        const aperoJsonFile = path.join(__dirname, 'data', 'apero', 'quizzes.json');
        const countApero = await db.get('SELECT COUNT(*) as count FROM apero_quizzes');
        if (countApero.count === 0 && fs.existsSync(aperoJsonFile)) {
            console.log('[DATABASE] Migration : Importation de apero/quizzes.json vers SQLite...');
            const rawData = fs.readFileSync(aperoJsonFile, 'utf8');
            const data = JSON.parse(rawData);
            const quizzes = data.quizzes || [];
            for (const quiz of quizzes) {
                await db.run(
                    'INSERT OR REPLACE INTO apero_quizzes (id, title, description, slides, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)',
                    [quiz.id, quiz.title, quiz.description, JSON.stringify(quiz.slides), quiz.createdAt, quiz.updatedAt]
                );
            }
            console.log(`[DATABASE] Migration : ${quizzes.length} quiz apéro importés.`);
        }

        // 3. Seeding Draw Words
        // Note : hors de server/data/ (volume Docker) — comme colorCharacters.json. Dans le volume,
        // le fichier de l'image n'écrase jamais la copie figée au premier démarrage : les mots ajoutés
        // au JSON n'arrivaient donc jamais en prod. Ici le fichier vient de l'image à chaque déploiement,
        // et le hash ci-dessous déclenche la resynchronisation. Les mots créés via l'admin sont conservés
        // (INSERT OR REPLACE, aucun DELETE).
        const drawWordsJsonFile = path.join(__dirname, 'drawWords.json');
        if (fs.existsSync(drawWordsJsonFile)) {
            const rawData = fs.readFileSync(drawWordsJsonFile, 'utf8');
            const hash = crypto.createHash('sha1').update(rawData).digest('hex');

            await db.run(`CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT)`);
            const meta = await db.get(`SELECT value FROM app_meta WHERE key = 'draw_words_seed_hash'`);
            const countWords = await db.get('SELECT COUNT(*) as count FROM draw_words');

            if (countWords.count === 0 || !meta || meta.value !== hash) {
                const reason = countWords.count === 0 ? 'table vide' : 'drawWords.json modifié';
                console.log(`[DATABASE] Migration : (re)synchronisation de drawWords.json vers SQLite (${reason})...`);
                const data = JSON.parse(rawData);
                let totalWords = 0;
                for (const categoryKey of Object.keys(data)) {
                    const wordsList = data[categoryKey] || [];
                    for (const item of wordsList) {
                        await db.run(
                            'INSERT OR REPLACE INTO draw_words (categoryKey, word, category, hint) VALUES (?, ?, ?, ?)',
                            [categoryKey, item.word, item.category, item.hint || '']
                        );
                        totalWords++;
                    }
                }
                await db.run(`INSERT OR REPLACE INTO app_meta (key, value) VALUES ('draw_words_seed_hash', ?)`, [hash]);
                console.log(`[DATABASE] Migration : ${totalWords} mots pictionary synchronisés.`);
            }
        }

        // 4. Seeding Geo Locations
        const geoJsonFile = path.join(__dirname, 'data', 'geoLocations.json');
        const countLocations = await db.get('SELECT COUNT(*) as count FROM geo_locations');
        if (countLocations.count === 0 && fs.existsSync(geoJsonFile)) {
            console.log('[DATABASE] Migration : Importation de geoLocations.json vers SQLite...');
            const rawData = fs.readFileSync(geoJsonFile, 'utf8');
            const locations = JSON.parse(rawData);
            for (const loc of locations) {
                await db.run(
                    'INSERT OR REPLACE INTO geo_locations (city, lat, lng, country) VALUES (?, ?, ?, ?)',
                    [loc.city, loc.lat, loc.lng, loc.country]
                );
            }
            console.log(`[DATABASE] Migration : ${locations.length} lieux GeoTrackr importés.`);
        }

        // 5. Seeding Color Characters
        // Note : hors de server/data/ (volume Docker) pour être présent dans l'image et seeder même sur un volume existant.
        // Reseed piloté par un hash du JSON : dès que colorCharacters.json change (roster, couleurs, chemins),
        // la base est resynchronisée — y compris sur un volume déjà peuplé (VPS). Les personnages ajoutés via
        // l'admin (image /uploads/color/char-*.webp) sont préservés ; seuls les anciens persos canoniques
        // disparus du JSON (renommés/retirés) sont nettoyés.
        const colorJsonFile = path.join(__dirname, 'colorCharacters.json');
        if (fs.existsSync(colorJsonFile)) {
            const rawData = fs.readFileSync(colorJsonFile, 'utf8');
            const characters = JSON.parse(rawData);
            const ids = characters.map(c => c.id);
            const hash = crypto.createHash('sha1').update(rawData).digest('hex');

            await db.run(`CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT)`);
            const meta = await db.get(`SELECT value FROM app_meta WHERE key = 'color_seed_hash'`);
            const countColors = await db.get('SELECT COUNT(*) as count FROM color_characters');

            if (countColors.count === 0 || !meta || meta.value !== hash) {
                const reason = countColors.count === 0 ? 'table vide' : 'colorCharacters.json modifié';
                console.log(`[DATABASE] Migration : (re)synchronisation de colorCharacters.json vers SQLite (${reason})...`);
                for (const char of characters) {
                    await db.run(
                        'INSERT OR REPLACE INTO color_characters (id, name, part, source, category, target_h, target_s, target_b, image_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                        [char.id, char.name, char.part, char.source, char.category || null, char.target_h, char.target_s, char.target_b, char.image_path]
                    );
                }
                // Nettoyage des anciens persos canoniques absents du JSON (préserve les uploads admin char-*)
                const placeholders = ids.map(() => '?').join(',');
                const cleanup = await db.run(
                    `DELETE FROM color_characters WHERE id NOT IN (${placeholders}) AND (image_path LIKE '/color/%' OR (image_path LIKE '/uploads/color/%' AND image_path NOT LIKE '/uploads/color/char-%'))`,
                    ids
                );
                await db.run(`INSERT OR REPLACE INTO app_meta (key, value) VALUES ('color_seed_hash', ?)`, [hash]);
                console.log(`[DATABASE] Migration : ${characters.length} personnages CouleurMoi synchronisés (${cleanup.changes} ancien(s) retiré(s)).`);
            }
        }

    } catch (error) {
        console.error('[DATABASE] Erreur lors du seeding SQLite :', error);
    }
}

// Initialiser en arrière-plan au chargement du module
initDatabase();

module.exports = db;
