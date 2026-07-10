import { useState } from 'react';
import { Lock, Loader2, KeyRound } from 'lucide-react';

const isHttps = window.location.protocol === 'https:';
const serverPort = isHttps ? 3443 : 3005;
const API_URL = import.meta.env.VITE_SERVER_URL
    ? `${import.meta.env.VITE_SERVER_URL}/api`
    : (!import.meta.env.DEV ? '/api' : `${window.location.protocol}//${window.location.hostname}:${serverPort}/api`);

function Login({ onLoginSuccess }) {
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!password) {
            setError('Veuillez entrer un mot de passe.');
            return;
        }

        setLoading(true);
        setError('');

        try {
            const response = await fetch(`${API_URL}/admin/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password })
            });

            const data = await response.json();

            if (response.ok && data.token) {
                localStorage.setItem('admin_token', data.token);
                onLoginSuccess(data.token);
            } else {
                setError(data.error || 'Mot de passe incorrect.');
            }
        } catch (err) {
            console.error('Login error:', err);
            setError('Impossible de se connecter au serveur.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="relative min-h-[85vh] w-full flex items-center justify-center p-4 overflow-hidden select-none">
            {/* Background decorative glowing blur elements */}
            <div className="absolute top-1/4 left-1/4 -translate-x-1/2 -translate-y-1/2 w-72 h-72 rounded-full bg-purple-600/20 blur-3xl pointer-events-none animate-pulse duration-[6000ms]"></div>
            <div className="absolute bottom-1/4 right-1/4 translate-x-1/2 translate-y-1/2 w-80 h-80 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none animate-pulse duration-[8000ms]"></div>

            <div className="relative w-full max-w-[420px] bg-slate-950/40 backdrop-blur-xl border border-slate-800/80 rounded-2xl p-8 md:p-10 shadow-2xl shadow-purple-950/20 hover:border-slate-700/60 transition-all duration-500">
                {/* Header Lock Icon */}
                <div className="flex justify-center mb-6">
                    <div className="relative flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-tr from-purple-600 to-indigo-600 shadow-lg shadow-purple-500/30 ring-1 ring-white/20">
                        <Lock className="w-8 h-8 text-white animate-[bounce_3s_infinite]" />
                        <KeyRound className="absolute -bottom-1 -right-1 w-5 h-5 text-emerald-400 bg-slate-950 rounded-lg p-0.5 border border-emerald-500/30" />
                    </div>
                </div>

                <div className="text-center mb-8">
                    <h2 className="text-2xl font-black tracking-[0.15em] bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent font-display uppercase">
                        Administration
                    </h2>
                    <p className="text-xs text-slate-500 tracking-wider mt-1.5 uppercase font-medium">
                        Accès sécurisé
                    </p>
                </div>

                {error && (
                    <div className="mb-6 p-3 bg-red-950/40 border border-red-500/30 rounded-xl text-red-200 text-xs text-center font-medium animate-shake">
                        {error}
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-6">
                    <div className="space-y-2">
                        <label className="block text-[10px] font-bold tracking-widest text-slate-400 uppercase" htmlFor="password-field">
                            Mot de passe
                        </label>
                        <div className="relative group">
                            <input
                                id="password-field"
                                type="password"
                                className="w-full bg-slate-900/60 text-white placeholder-slate-600 border border-slate-800 focus:border-purple-500 rounded-xl px-4 py-3.5 text-center text-lg tracking-[0.3em] font-mono focus:outline-none focus:ring-4 focus:ring-purple-500/10 transition-all duration-300"
                                placeholder="••••••••"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                disabled={loading}
                                autoFocus
                            />
                            <div className="absolute inset-x-0 -bottom-px h-px bg-gradient-to-r from-transparent via-purple-500 to-transparent scale-x-0 group-focus-within:scale-x-100 transition-transform duration-500"></div>
                        </div>
                    </div>

                    <button
                        type="submit"
                        className="relative w-full overflow-hidden rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 active:scale-[0.98] transition-all duration-300 text-white font-bold py-3.5 text-sm uppercase tracking-widest shadow-lg shadow-purple-500/20 hover:shadow-purple-500/30"
                        disabled={loading}
                    >
                        <span className="flex items-center justify-center gap-2">
                            {loading ? (
                                <>
                                    <Loader2 className="w-4 h-4 animate-spin text-white" />
                                    Connexion...
                                </>
                            ) : (
                                'Se Connecter'
                            )}
                        </span>
                    </button>
                </form>
            </div>
        </div>
    );
}

export default Login;
