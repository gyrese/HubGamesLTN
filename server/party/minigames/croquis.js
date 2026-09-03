/**
 * LE CROQUIS — famille CREATIVE, chemin de résolution `vote`
 *
 * Le champion de chaque table dessine sur papier, photographie son œuvre, et le bar
 * départage. Le module ne fait que fournir le thème et le rythme : la capture, la
 * galerie, la modération et le dépouillement sont génériques, portés par le
 * contrôleur pour tout `resolution: 'vote'`.
 */

const THEMES = [
    'Le pire poster de film jamais imprimé',
    'Un super-héros dont le pouvoir est inutile',
    'Le monstre qui vit derrière le comptoir',
    'Dark Vador en vacances',
    'Un Pokémon inventé à la dernière minute',
    'La créature du Lagon Noir, mais en mignon',
    'Le vaisseau spatial le plus mal conçu de la galaxie',
    'Un boss de fin de niveau ridicule',
    'Le remake trop ambitieux d\'un classique',
    'Une scène culte, dessinée de mémoire',
    'Le chevalier le moins équipé du royaume',
    'Un robot ménager qui a mal tourné',
];

module.exports = {
    id: 'croquis',
    name: 'Le Croquis',
    rule: 'Le champion dessine le thème sur papier, puis le photographie. Le bar vote.',
    description: 'Un thème imposé, trois minutes, une feuille de papier. Le champion de la table dessine, le capitaine photographie, et tout le bar départage.',
    art: { icon: 'pencil', color: '#E45BA0' },
    family: 'CREATIVE',
    discipline: 'CRÉATIVITÉ',
    scope: 'champion',
    resolution: 'vote',
    materials: ['1 feuille de papier et un stylo par table'],
    phases: [
        { id: 'brief', duration: 10 },
        { id: 'draw', duration: 180 },
        { id: 'capture', duration: 60 },
        { id: 'vote', duration: 45 },
    ],

    start(ctx, phaseId) {
        if (phaseId !== 'brief') return;
        const previous = ctx.room.lastCroquisTheme;
        const pool = THEMES.filter((t) => t !== previous);
        const theme = pool[Math.floor(Math.random() * pool.length)];
        ctx.room.lastCroquisTheme = theme;
        ctx.state.theme = theme;
        ctx.broadcast({ kind: 'theme', theme });
    },

    /** Le classement vient du dépouillement, pas du module. */
    publicState(ctx) {
        return { theme: ctx.state.theme || null };
    },
};
