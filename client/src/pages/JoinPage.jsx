import { useState, useEffect } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';

/**
 * Universal Join Page
 * Detects game type from the room code and redirects to the appropriate player view
 * 
 * URLs:
 * - /join?code=ABC123&game=apero
 * - /join/ABC123 (auto-detect game type from server)
 */
function JoinPage() {
    const { roomCode: urlRoomCode } = useParams();
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();

    const [roomCode, setRoomCode] = useState(urlRoomCode || searchParams.get('code') || '');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');

    // Auto-redirect if code is present in URL
    useEffect(() => {
        const game = searchParams.get('game');
        const code = urlRoomCode || searchParams.get('code');

        if (code) {
            if (game) {
                redirectToGame(game, code);
            } else {
                const autoDetect = async () => {
                    setIsLoading(true);
                    setError('');
                    try {
                        const isHttps = window.location.protocol === 'https:';
                        const port = isHttps ? 3443 : 3005;
                        const serverUrl = import.meta.env.VITE_SERVER_URL || 
                            (!import.meta.env.DEV ? '' : `${window.location.protocol}//${window.location.hostname}:${port}`);
                        
                        const res = await fetch(`${serverUrl}/api/room/${code.toUpperCase()}`);
                        if (res.ok) {
                            const data = await res.json();
                            redirectToGame(data.gameType, code.toUpperCase());
                        } else {
                            // Fallback
                            navigate(`/apero/play/${code.toUpperCase()}`);
                        }
                    } catch (err) {
                        navigate(`/apero/play/${code.toUpperCase()}`);
                    } finally {
                        setIsLoading(false);
                    }
                };
                autoDetect();
            }
        }
    }, [searchParams, urlRoomCode, navigate]);

    const redirectToGame = (game, code) => {
        switch (game) {
            case 'quiz':
                navigate(`/quiz/play/${code}`);
                break;
            case 'geo':
                navigate(`/geo/play/${code}`);
                break;
            case 'draw':
                navigate(`/draw/play/${code}`);
                break;
            case 'apero':
                navigate(`/apero/play/${code}`);
                break;
            case 'color':
                navigate(`/color/play/${code}`);
                break;
            case 'fakeartist':
                navigate(`/fakeartist/play/${code}`);
                break;
            case 'party':
                navigate(`/party/play/${code}`);
                break;
            case 'dance':
                navigate(`/dance/play/${code}`);
                break;
            case 'io':
                navigate(`/io/play/${code}`);
                break;
            case 'remote':
                navigate(`/geo/remote/${code}`);
                break;
            default:
                setError('Type de jeu inconnu');
        }
    };

    const handleJoin = async () => {
        if (!roomCode.trim()) {
            setError('Veuillez entrer un code');
            return;
        }

        setIsLoading(true);
        setError('');

        try {
            // Try to detect game type from server
            const isHttps = window.location.protocol === 'https:';
            const port = isHttps ? 3443 : 3005;
            const serverUrl = import.meta.env.VITE_SERVER_URL || 
                (!import.meta.env.DEV ? '' : `${window.location.protocol}//${window.location.hostname}:${port}`);
            
            const res = await fetch(`${serverUrl}/api/room/${roomCode.toUpperCase()}`);

            if (res.ok) {
                const data = await res.json();
                redirectToGame(data.gameType, roomCode.toUpperCase());
            } else {
                // If no API endpoint, try apero by default (most common)
                navigate(`/apero/play/${roomCode.toUpperCase()}`);
            }
        } catch (err) {
            // Fallback: try apero
            navigate(`/apero/play/${roomCode.toUpperCase()}`);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="container d-flex flex-column align-items-center justify-content-center" style={{ minHeight: '100vh' }}>
            <h1 className="text-primary mb-4">🎮 Rejoindre une partie</h1>

            <div className="card bg-dark border-secondary p-4" style={{ width: '100%', maxWidth: '400px' }}>
                <div className="mb-3">
                    <label className="form-label text-muted">Code de la partie</label>
                    <input
                        type="text"
                        className="form-control form-control-lg bg-black text-white border-secondary text-center"
                        placeholder="ABC123"
                        value={roomCode}
                        onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                        maxLength={6}
                        style={{ fontSize: '2rem', letterSpacing: '0.3em' }}
                        onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
                    />
                </div>

                {error && (
                    <div className="alert alert-danger">{error}</div>
                )}

                <button
                    className="btn btn-primary btn-lg w-100"
                    onClick={handleJoin}
                    disabled={isLoading || !roomCode.trim()}
                >
                    {isLoading ? 'Connexion...' : 'Rejoindre'}
                </button>
            </div>

            <a href="/" className="btn btn-link text-muted mt-4">
                ← Retour à l'accueil
            </a>
        </div>
    );
}

export default JoinPage;
