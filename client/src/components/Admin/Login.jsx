import { useState } from 'react';

// Même logique d'URL que le reste de l'admin : relatif en prod (servi par le serveur),
// origine API (3443 en HTTPS, 3005 en HTTP) en dev. Le port 3001 codé en dur était faux.
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
        <div className="container text-light d-flex align-items-center justify-content-center" style={{ minHeight: '80vh' }}>
            <div className="card p-5 shadow-lg border-secondary text-center" style={{ maxWidth: '400px', width: '100%', backgroundColor: 'rgba(26, 26, 46, 0.8)', backdropFilter: 'blur(10px)', borderRadius: '15px' }}>
                <div className="fs-1 mb-3">🔒</div>
                <h2 className="mb-4 fw-bold text-primary" style={{ fontFamily: 'var(--font-display)', letterSpacing: '2px' }}>ADMINISTRATION</h2>
                
                {error && (
                    <div className="alert alert-danger py-2 text-center small" role="alert">
                        {error}
                    </div>
                )}

                <form onSubmit={handleSubmit}>
                    <div className="mb-4 text-start">
                        <label className="form-label text-muted small" htmlFor="password-field">MOT DE PASSE</label>
                        <input
                            id="password-field"
                            type="password"
                            className="form-control bg-dark text-light border-secondary text-center fs-5 py-2"
                            placeholder="••••••••"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            disabled={loading}
                            autoFocus
                        />
                    </div>

                    <button
                        type="submit"
                        className="btn btn-primary btn-lg w-100 py-2 fs-6"
                        disabled={loading}
                    >
                        {loading ? (
                            <><span className="spinner-border spinner-border-sm me-2" role="status"></span>Connexion...</>
                        ) : (
                            'SE CONNECTER'
                        )}
                    </button>
                </form>
            </div>
        </div>
    );
}

export default Login;
