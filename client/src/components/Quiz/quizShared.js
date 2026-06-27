// Mapping forme + couleur des 4 réponses, partagé par l'hôte (carte option)
// et le joueur (bouton manette). Le modèle « Kahoot » repose entièrement sur
// ce mapping : la question est lue sur l'écran de l'hôte, le joueur tape la
// forme/couleur correspondante sur son téléphone. Index = answerIndex.
export const OPTION_META = [
    { shape: '▲', name: 'Triangle', color: '#f43f5e', ink: '#2b060f' }, // rose
    { shape: '◆', name: 'Losange', color: '#3b82f6', ink: '#06122b' }, // bleu
    { shape: '●', name: 'Rond', color: '#f59e0b', ink: '#2a1c03' }, // ambre
    { shape: '■', name: 'Carré', color: '#22c55e', ink: '#052010' }, // vert
];

// Origine de l'API REST (port serveur en dev, même origine en prod).
// Aligné sur Login.jsx / AdminView : le port 3001 codé en dur était faux.
export function apiBase() {
    const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';
    const serverPort = isHttps ? 3443 : 3005;
    if (import.meta.env.VITE_SERVER_URL) return `${import.meta.env.VITE_SERVER_URL}/api`;
    if (!import.meta.env.DEV) return '/api';
    return `${window.location.protocol}//${window.location.hostname}:${serverPort}/api`;
}
