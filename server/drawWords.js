const db = require('./db');

// Get all words flattened
async function getAllWords() {
    try {
        const rows = await db.all('SELECT word, category, hint FROM draw_words WHERE word != "__INIT__"');
        return rows;
    } catch (error) {
        console.error('[DrawWords] Error getting all words:', error);
        return [];
    }
}

// Get words by category
async function getWordsByCategory(categoryKey) {
    try {
        const rows = await db.all('SELECT word, category, hint FROM draw_words WHERE categoryKey = ? AND word != "__INIT__"', [categoryKey]);
        return rows;
    } catch (error) {
        console.error('[DrawWords] Error getting words by category:', error);
        return [];
    }
}

// Get random word from selected categories, excluding already played words
async function getRandomWord(categories = null, excludeWords = []) {
    try {
        let rows = [];
        let query = 'SELECT word, category, hint FROM draw_words WHERE word != "__INIT__"';
        const params = [];

        if (categories && categories.length > 0 && !categories.includes('all')) {
            const placeholders = categories.map(() => '?').join(',');
            query += ` AND categoryKey IN (${placeholders})`;
            params.push(...categories);
        }

        if (excludeWords && excludeWords.length > 0) {
            const excludePlaceholders = excludeWords.map(() => '?').join(',');
            query += ` AND word NOT IN (${excludePlaceholders})`;
            params.push(...excludeWords);
        }

        rows = await db.all(query, params);

        // Fallback 1: Si tous les mots de la catégorie sélectionnée ont été joués, ignorer les mots exclus
        if (rows.length === 0 && excludeWords.length > 0) {
            let fallbackQuery = 'SELECT word, category, hint FROM draw_words WHERE word != "__INIT__"';
            const fallbackParams = [];
            if (categories && categories.length > 0 && !categories.includes('all')) {
                const placeholders = categories.map(() => '?').join(',');
                fallbackQuery += ` AND categoryKey IN (${placeholders})`;
                fallbackParams.push(...categories);
            }
            rows = await db.all(fallbackQuery, fallbackParams);
        }

        // Fallback 2: Si toujours aucun mot (ex: catégorie vide), prendre n'importe quel mot de la DB
        if (rows.length === 0) {
            rows = await db.all('SELECT word, category, hint FROM draw_words WHERE word != "__INIT__"');
        }

        if (rows.length === 0) return null;
        return rows[Math.floor(Math.random() * rows.length)];
    } catch (error) {
        console.error('[DrawWords] Error getting random word:', error);
        return null;
    }
}

// Bulk import words from array of { categoryKey, word, category, hint }
async function importWordsBatch(wordsArray) {
    if (!Array.isArray(wordsArray) || wordsArray.length === 0) return { imported: 0 };
    let imported = 0;
    try {
        for (const item of wordsArray) {
            if (!item.categoryKey || !item.word) continue;
            // Supprimer le mot factice si nécessaire
            await db.run('DELETE FROM draw_words WHERE categoryKey = ? AND word = "__INIT__"', [item.categoryKey]);
            const res = await db.run(
                'INSERT OR IGNORE INTO draw_words (categoryKey, word, category, hint) VALUES (?, ?, ?, ?)',
                [item.categoryKey.trim(), item.word.trim(), item.category || 'Divers', item.hint || '']
            );
            if (res.changes > 0) imported++;
        }
        return { imported };
    } catch (error) {
        console.error('[DrawWords] Error importing batch words:', error);
        return { imported, error: error.message };
    }
}

// Get available categories
async function getCategories() {
    try {
        const rows = await db.all('SELECT DISTINCT categoryKey FROM draw_words');
        return rows.map(r => r.categoryKey);
    } catch (error) {
        console.error('[DrawWords] Error getting categories:', error);
        return [];
    }
}

// Reconstruire la base de données au format d'origine (groupé par catégorie) pour l'admin
async function getFullDatabase() {
    try {
        const rows = await db.all('SELECT categoryKey, word, category, hint FROM draw_words');
        const dbGrouped = {};
        for (const row of rows) {
            if (!dbGrouped[row.categoryKey]) {
                dbGrouped[row.categoryKey] = [];
            }
            if (row.word !== '__INIT__') {
                dbGrouped[row.categoryKey].push({
                    word: row.word,
                    category: row.category,
                    hint: row.hint
                });
            }
        }
        return dbGrouped;
    } catch (error) {
        console.error('[DrawWords] Error getting full database:', error);
        return {};
    }
}

// --- CRUD Operations ---

async function addCategory(categoryKey, categoryName) {
    try {
        const existing = await db.get('SELECT COUNT(*) as count FROM draw_words WHERE categoryKey = ?', [categoryKey]);
        if (existing && existing.count > 0) return false;
        
        await db.run(
            'INSERT OR IGNORE INTO draw_words (categoryKey, word, category, hint) VALUES (?, ?, ?, ?)',
            [categoryKey, '__INIT__', categoryName || 'Divers', '']
        );
        return true;
    } catch (err) {
        console.error('[DrawWords] Error adding category:', err);
        return false;
    }
}

async function deleteCategory(categoryKey) {
    try {
        const result = await db.run('DELETE FROM draw_words WHERE categoryKey = ?', [categoryKey]);
        return result.changes > 0;
    } catch (err) {
        console.error('[DrawWords] Error deleting category:', err);
        return false;
    }
}

async function addWord(categoryKey, wordObj) {
    try {
        // Supprimer le mot d'initialisation factice si présent
        await db.run('DELETE FROM draw_words WHERE categoryKey = ? AND word = "__INIT__"', [categoryKey]);

        const result = await db.run(
            'INSERT OR IGNORE INTO draw_words (categoryKey, word, category, hint) VALUES (?, ?, ?, ?)',
            [categoryKey, wordObj.word, wordObj.category, wordObj.hint || '']
        );
        return result.changes > 0;
    } catch (err) {
        console.error('[DrawWords] Error adding word:', err);
        return false;
    }
}

async function updateWord(categoryKey, originalWord, newWordObj) {
    try {
        const result = await db.run(
            'UPDATE draw_words SET word = ?, category = ?, hint = ? WHERE categoryKey = ? AND word = ?',
            [newWordObj.word, newWordObj.category, newWordObj.hint || '', categoryKey, originalWord]
        );
        return result.changes > 0;
    } catch (err) {
        console.error('[DrawWords] Error updating word:', err);
        return false;
    }
}

async function deleteWord(categoryKey, word) {
    try {
        const result = await db.run(
            'DELETE FROM draw_words WHERE categoryKey = ? AND word = ?',
            [categoryKey, word]
        );
        return result.changes > 0;
    } catch (err) {
        console.error('[DrawWords] Error deleting word:', err);
        return false;
    }
}

module.exports = {
    getAllWords,
    getWordsByCategory,
    getRandomWord,
    importWordsBatch,
    getCategories,
    getFullDatabase,
    addCategory,
    deleteCategory,
    addWord,
    updateWord,
    deleteWord
};
