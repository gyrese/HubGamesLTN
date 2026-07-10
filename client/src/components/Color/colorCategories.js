/**
 * Métadonnées d'affichage des catégories (univers) de Couleur Moi.
 *
 * La liste des catégories est pilotée par les données (une catégorie « existe » tant
 * qu'au moins un personnage la porte, cf. /api/color/categories) : on peut donc en
 * ajouter / renommer / supprimer librement depuis l'admin. Ce fichier ne fait que
 * décorer les catégories connues (emoji + couleur d'accent). Toute catégorie inconnue
 * retombe proprement sur un rendu générique via getCategoryMeta().
 */

export const CATEGORY_META = {
    'Disney': { emoji: '🏰', accent: '#f5b544' },
    'Nickelodeon': { emoji: '🟠', accent: '#ff7a1a' },
    'Cartoon Network': { emoji: '🔵', accent: '#3b82f6' },
    'Sitcoms animés': { emoji: '📺', accent: '#f472b6' },
    'Manga & Anime': { emoji: '🥋', accent: '#ef4444' },
    'Classiques & Rétro': { emoji: '🎩', accent: '#a78bfa' },
};

// Ordre d'affichage préféré des catégories canoniques (les inconnues suivent, triées par le serveur).
export const CATEGORY_ORDER = Object.keys(CATEGORY_META);

const FALLBACK = { emoji: '🎨', accent: '#f59e0b' };

export function getCategoryMeta(label) {
    return CATEGORY_META[label] || FALLBACK;
}

/** Trie une liste de catégories { category, count } selon l'ordre canonique puis alphabétiquement. */
export function sortCategories(list = []) {
    return [...list].sort((a, b) => {
        const ia = CATEGORY_ORDER.indexOf(a.category);
        const ib = CATEGORY_ORDER.indexOf(b.category);
        if (ia !== -1 && ib !== -1) return ia - ib;
        if (ia !== -1) return -1;
        if (ib !== -1) return 1;
        return a.category.localeCompare(b.category);
    });
}
