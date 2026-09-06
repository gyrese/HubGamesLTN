import { useEffect, useState } from 'react';
import { CheckCircle2, EyeOff, Loader2, Wrench } from 'lucide-react';

/**
 * Disponibilité des jeux du hub.
 *
 * Trois états, qui ne servent pas la même chose :
 *
 *   Actif        carte normale, jeu jouable.
 *   Maintenance  la carte reste visible mais grisée et non cliquable. C'est le
 *                bon choix pour un jeu que les habitués connaissent : ils voient
 *                qu'il existe et qu'il revient, plutôt que de le croire supprimé.
 *   Masqué       la carte disparaît de l'accueil. Pour un jeu pas encore
 *                présentable, dont l'existence n'a pas à être annoncée.
 *
 * L'accès direct par URL reste possible dans tous les cas : c'est volontaire,
 * ça permet de tester un jeu en maintenance sans le réactiver pour la salle.
 */

const GAMES = [
    { id: 'quiz', name: 'Neural Quiz' },
    { id: 'geo', name: 'Geo Trackr' },
    { id: 'draw', name: 'Draw Up' },
    { id: 'color', name: 'Couleur Moi' },
    { id: 'fakeartist', name: 'Fake Artist' },
    { id: 'party', name: 'Super LTN Party' },
    { id: 'io', name: 'IO Arena' },
    { id: 'dance', name: 'Dance Dance' },
    { id: 'apero', name: 'Apéro Quiz (LTNHoot)' },
];

const STATES = [
    { key: 'active', label: 'Actif', icon: CheckCircle2, classes: 'bg-emerald-500/15 border-emerald-500 text-emerald-400' },
    { key: 'maintenance', label: 'Maintenance', icon: Wrench, classes: 'bg-amber-500/15 border-amber-500 text-amber-400' },
    { key: 'hidden', label: 'Masqué', icon: EyeOff, classes: 'bg-slate-700/40 border-slate-500 text-slate-300' },
];

function GamesAdmin({ token, apiUrl }) {
    const [status, setStatus] = useState(null);
    const [saving, setSaving] = useState(null);
    const [error, setError] = useState('');

    useEffect(() => {
        fetch(`${apiUrl}/games/status`)
            .then((r) => r.json())
            .then(setStatus)
            .catch(() => setError('Impossible de charger les statuts'));
    }, [apiUrl]);

    const update = async (gameId, state) => {
        setSaving(gameId);
        setError('');
        // Mise à jour optimiste : le bouton répond tout de suite, on corrige si
        // le serveur refuse. L'admin est souvent utilisé en pleine soirée.
        const previous = status;
        setStatus((s) => ({ ...s, [gameId]: state }));
        try {
            const res = await fetch(`${apiUrl}/admin/games/status`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ gameId, state }),
            });
            if (!res.ok) throw new Error((await res.json()).error || 'Échec');
            setStatus(await res.json());
        } catch (err) {
            setStatus(previous);
            setError(err.message);
        } finally {
            setSaving(null);
        }
    };

    if (!status) {
        return (
            <div className="flex items-center justify-center py-16 text-slate-400">
                <Loader2 className="w-6 h-6 animate-spin" />
            </div>
        );
    }

    const counts = GAMES.reduce((acc, g) => {
        const s = status[g.id] || 'active';
        acc[s] = (acc[s] || 0) + 1;
        return acc;
    }, {});

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-lg font-black uppercase tracking-widest text-white m-0">
                    Disponibilité des jeux
                </h2>
                <p className="text-sm text-slate-400 mt-1 mb-0">
                    Ce que voient les clients sur la page d'accueil. Un jeu en maintenance
                    reste visible mais grisé ; un jeu masqué disparaît complètement.
                </p>
            </div>

            {error && (
                <p className="px-4 py-3 rounded-xl bg-red-950/30 border border-red-500/30 text-red-300 text-sm m-0">
                    {error}
                </p>
            )}

            <div className="flex flex-wrap gap-2 text-xs uppercase tracking-wider font-bold">
                <span className="px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-400">
                    {counts.active || 0} actif(s)
                </span>
                <span className="px-3 py-1.5 rounded-lg bg-amber-500/10 text-amber-400">
                    {counts.maintenance || 0} en maintenance
                </span>
                <span className="px-3 py-1.5 rounded-lg bg-slate-700/30 text-slate-400">
                    {counts.hidden || 0} masqué(s)
                </span>
            </div>

            <div className="space-y-2.5">
                {GAMES.map((game) => {
                    const current = status[game.id] || 'active';
                    return (
                        <div
                            key={game.id}
                            className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-2xl bg-slate-900/40 border border-slate-800"
                        >
                            <div className="flex items-center gap-3">
                                <span className="font-bold text-slate-100">{game.name}</span>
                                {saving === game.id && (
                                    <Loader2 className="w-4 h-4 animate-spin text-slate-500" />
                                )}
                            </div>

                            <div className="flex gap-2">
                                {STATES.map(({ key, label, icon: Icon, classes }) => (
                                    <button
                                        key={key}
                                        onClick={() => current !== key && update(game.id, key)}
                                        disabled={saving === game.id}
                                        className={`flex items-center gap-2 px-3.5 py-2 rounded-xl border text-xs font-bold uppercase tracking-wider transition-all active:scale-[0.97] disabled:opacity-50 ${
                                            current === key
                                                ? classes
                                                : 'bg-slate-950/40 border-slate-800 text-slate-500 hover:text-slate-300 hover:border-slate-700'
                                        }`}
                                    >
                                        <Icon className="w-4 h-4" />
                                        {label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>

            <p className="text-xs text-slate-500 m-0">
                L'accès direct par URL reste possible même en maintenance : de quoi tester
                un jeu sans le remettre en salle.
            </p>
        </div>
    );
}

export default GamesAdmin;
