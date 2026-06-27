import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { socket } from '../../socket';

// ─── Session hôte (persistance + reconnexion, pattern GeoTrackr) ───
const HOST_SESSION_KEY = 'qi-host-session';
const HOST_SESSION_TTL = 4 * 60 * 60 * 1000; // 4 h : au-delà, le serveur a probablement redémarré
const readHostSession = () => {
    try { return JSON.parse(localStorage.getItem(HOST_SESSION_KEY) || 'null'); } catch { return null; }
};
const writeHostSession = (roomCode) => {
    try { localStorage.setItem(HOST_SESSION_KEY, JSON.stringify({ roomCode, createdAt: Date.now() })); } catch { /* noop */ }
};
const clearHostSession = () => {
    try { localStorage.removeItem(HOST_SESSION_KEY); } catch { /* noop */ }
};

function HostView() {
    const navigate = useNavigate();
    const [roomCode, setRoomCode] = useState(null);
    const [players, setPlayers] = useState([]);
    const [gameState, setGameState] = useState('INIT'); // INIT, LOBBY, GAME, RESULT
    const [currentQuestion, setCurrentQuestion] = useState(null);

    const [answeredPlayers, setAnsweredPlayers] = useState(new Set());

    const [timeLeft, setTimeLeft] = useState(20);
    const [leaderboard, setLeaderboard] = useState([]);
    const [correctAnswer, setCorrectAnswer] = useState(null);

    const [quizzes, setQuizzes] = useState([]);
    const [selectedQuizId, setSelectedQuizId] = useState('');
    const [stats, setStats] = useState(null);

    // Garde le code de salon courant accessible dans le handler `connect` (closures).
    const roomCodeRef = useRef('');
    useEffect(() => { roomCodeRef.current = roomCode; }, [roomCode]);

    // Init : reconnexion au salon mémorisé sinon création. + reconnexion auto sur `connect`.
    useEffect(() => {
        // Charger la liste des quiz (sélecteur du lobby / séries suivantes)
        fetch(`${window.location.protocol}//${window.location.hostname}:3001/api/quizzes`)
            .then(res => res.json())
            .then(data => { setQuizzes(data); if (data.length > 0) setSelectedQuizId(prev => prev || data[0].id); })
            .catch(err => console.error("Erreur chargement quiz", err));

        const applyReconnect = (resp) => {
            roomCodeRef.current = resp.roomCode;
            setRoomCode(resp.roomCode);
            setPlayers(resp.players || []);
            writeHostSession(resp.roomCode);

            if (resp.gameState === 'QUESTION') {
                setCurrentQuestion(resp.question);
                if (resp.questionEnded) {
                    setCorrectAnswer(resp.correctAnswer);
                    setLeaderboard(resp.leaderboard || []);
                    setGameState('RESULT');
                } else {
                    setAnsweredPlayers(new Set(resp.answeredPlayerIds || []));
                    const elapsed = resp.questionStartTime ? (Date.now() - resp.questionStartTime) / 1000 : 0;
                    setTimeLeft(Math.max(0, Math.ceil(20 - elapsed)));
                    setGameState('GAME');
                }
            } else if (resp.gameState === 'SERIES_END' || resp.gameState === 'END') {
                setLeaderboard(resp.leaderboard || []);
                setStats(resp.stats || null);
                setGameState(resp.gameState);
            } else {
                setGameState('LOBBY');
            }
        };

        const createFreshRoom = () => {
            socket.emit('create-room', (response) => {
                setRoomCode(response.roomCode);
                roomCodeRef.current = response.roomCode;
                setGameState('LOBBY');
                writeHostSession(response.roomCode);
            });
        };

        const reconnectHost = (code, onFail) => {
            let handled = false;
            const t = setTimeout(() => { if (!handled) { handled = true; onFail(); } }, 4000);
            socket.emit('quiz-host-reconnect', { roomCode: code }, (resp) => {
                clearTimeout(t);
                if (handled) return;
                handled = true;
                if (!resp || resp.error) onFail();
                else applyReconnect(resp);
            });
        };

        const saved = readHostSession();
        const sessionFresh = saved && saved.roomCode && (Date.now() - (saved.createdAt || 0) < HOST_SESSION_TTL);
        if (sessionFresh) {
            reconnectHost(saved.roomCode, () => { clearHostSession(); createFreshRoom(); });
        } else {
            if (saved) clearHostSession();
            createFreshRoom();
        }

        const handleReconnect = () => {
            const code = roomCodeRef.current;
            if (!code) return; // pas encore de salle créée → rien à reconnecter
            reconnectHost(code, () => { clearHostSession(); createFreshRoom(); });
        };
        socket.on('connect', handleReconnect);
        return () => socket.off('connect', handleReconnect);
    }, []);

    useEffect(() => {
        socket.on('player-joined', (updatedPlayers) => {
            setPlayers(updatedPlayers);
        });

        socket.on('player-left', (updatedPlayers) => {
            setPlayers(updatedPlayers);
        });

        socket.on('game-started', ({ question }) => {
            setGameState('GAME');
            setCurrentQuestion(question);
            setAnsweredPlayers(new Set()); // Reset pour la nouvelle question
            setTimeLeft(20); // Reset timer
        });

        socket.on('player-answered', ({ playerId }) => {
            setAnsweredPlayers(prev => new Set(prev).add(playerId));
        });

        socket.on('round-results', ({ leaderboard, correctAnswer }) => {
            setGameState('RESULT');
            setLeaderboard(leaderboard);
            setCorrectAnswer(correctAnswer);
        });

        socket.on('series-end', ({ leaderboard, stats }) => {
            setGameState('SERIES_END');
            setLeaderboard(leaderboard);
            setStats(stats);
        });

        socket.on('game-over', ({ leaderboard, stats }) => {
            setGameState('END');
            setLeaderboard(leaderboard);
            setStats(stats);
        });

        return () => {
            socket.off('player-joined');
            socket.off('player-left');
            socket.off('game-started');
            socket.off('player-answered');
            socket.off('round-results');
            socket.off('series-end');
            socket.off('game-over');
        };
    }, [gameState]);

    // Timer Logic
    useEffect(() => {
        if (gameState === 'GAME' && timeLeft > 0) {
            const timer = setTimeout(() => setTimeLeft(timeLeft - 1), 1000);
            return () => clearTimeout(timer);
        } else if (gameState === 'GAME' && timeLeft === 0) {
            socket.emit('end-question', { roomCode });
        }
    }, [gameState, timeLeft, roomCode]);

    // Auto-end if all players answered
    useEffect(() => {
        if (gameState === 'GAME' && players.length > 0 && answeredPlayers.size === players.length) {
            socket.emit('end-question', { roomCode });
        }
    }, [answeredPlayers, players.length, gameState, roomCode]);

    const startGame = () => {
        socket.emit('start-game', { roomCode, quizId: selectedQuizId });
    };

    const nextQuestion = () => {
        socket.emit('next-question', { roomCode });
    };

    if (gameState === 'INIT') return <div className="text-center mt-5"><h3>Initialisation du système...</h3></div>;

    return (
        <div className="host-view min-vh-100 text-light">
            <div className="d-flex justify-content-between align-items-center p-3 border-bottom border-secondary" style={{ background: 'rgba(0,0,0,0.8)' }}>
                <button className="btn btn-outline-secondary" onClick={() => { clearHostSession(); navigate('/quiz'); }}>&lt; RETOUR</button>
                <div className="h3 mb-0 text-primary glitch-text" data-text={`PIN: ${roomCode}`}>
                    PIN: {roomCode}
                </div>
            </div>

            {gameState === 'LOBBY' && (
                <div className="container mt-5 text-center">
                    <h2 className="display-4 mb-4 glitch-text" data-text="EN ATTENTE DES JOUEURS...">EN ATTENTE DES JOUEURS...</h2>

                    <div className="mb-4">
                        <label className="form-label me-2 text-info">SÉLECTION DU QUIZ :</label>
                        <select
                            className="form-select d-inline-block w-auto bg-dark text-light border-secondary"
                            value={selectedQuizId}
                            onChange={(e) => setSelectedQuizId(e.target.value)}
                        >
                            {quizzes.map(q => (
                                <option key={q.id} value={q.id}>{q.title}</option>
                            ))}
                        </select>
                    </div>

                    <div className="row row-cols-2 row-cols-md-4 row-cols-lg-6 g-4 mb-5">
                        {players.map((p) => (
                            <div key={p.id} className="col">
                                <div className="card h-100 player-card border-primary bg-transparent">
                                    <div className="card-body text-center">
                                        {p.avatar ? (
                                            <img src={p.avatar} alt="avatar" className="avatar-preview mb-2" />
                                        ) : (
                                            <div className="avatar-preview mb-2 bg-secondary d-inline-block"></div>
                                        )}
                                        <div className="fw-bold text-truncate text-light">{p.name}</div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="fixed-bottom p-3 border-top border-secondary text-center" style={{ background: 'rgba(0,0,0,0.9)' }}>
                        <button className="btn btn-primary btn-lg px-5" onClick={startGame} disabled={players.length === 0}>
                            LANCER LE QUIZ
                        </button>
                    </div>
                </div>
            )}

            {gameState === 'GAME' && currentQuestion && (
                <div className="container mt-4">
                    <div className="d-flex justify-content-between align-items-center mb-4">
                        <h2 className="flex-grow-1 me-3 text-light">{currentQuestion.text}</h2>
                        <div className={`rounded-circle d-flex align-items-center justify-content-center border border-4 ${timeLeft < 5 ? 'border-danger text-danger' : 'border-primary text-primary'}`}
                            style={{ width: '80px', height: '80px', fontSize: '2.5rem', fontWeight: 'bold', boxShadow: `0 0 15px ${timeLeft < 5 ? 'red' : 'var(--neon-green)'}` }}>
                            {timeLeft}
                        </div>
                    </div>

                    {currentQuestion.image && (
                        <div className="text-center mb-4">
                            <img src={currentQuestion.image} alt="Question" className="img-fluid rounded border border-primary" style={{ maxHeight: '300px', boxShadow: '0 0 20px rgba(0, 255, 65, 0.3)' }} />
                        </div>
                    )}

                    <div className="row g-3">
                        {currentQuestion.options.map((opt, idx) => {
                            const colors = ['danger', 'primary', 'warning', 'success']; // Bootstrap colors mapped to neon in CSS
                            const color = colors[idx % colors.length];
                            return (
                                <div key={idx} className="col-6">
                                    <div className={`card h-100 text-center text-white bg-transparent border-${color} shadow-sm`} style={{ borderWidth: '2px' }}>
                                        <div className="card-body d-flex align-items-center justify-content-center">
                                            <h3 className="card-title mb-0">{opt}</h3>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                    <div className="text-center mt-4 h4 text-muted">
                        RÉPONSES : <span className="text-light">{answeredPlayers.size}</span> / {players.length}
                    </div>
                </div>
            )}

            {gameState === 'RESULT' && (
                <div className="container mt-5 text-center">
                    <h2 className="display-4 mb-4 glitch-text" data-text="RÉSULTATS">RÉSULTATS</h2>
                    <div className="alert alert-info fs-4 mb-4 bg-transparent border-info text-info">
                        La bonne réponse était : <strong>{currentQuestion.options[correctAnswer]}</strong>
                    </div>

                    <div className="card shadow-sm mx-auto bg-transparent border-secondary" style={{ maxWidth: '600px' }}>
                        <div className="list-group list-group-flush">
                            {leaderboard.slice(0, 5).map((p, idx) => (
                                <div key={p.id} className="list-group-item d-flex justify-content-between align-items-center bg-transparent text-light border-secondary">
                                    <div className="d-flex align-items-center">
                                        <span className="badge bg-secondary me-3">#{idx + 1}</span>
                                        {p.avatar && <img src={p.avatar} alt="av" className="rounded-circle me-2" style={{ width: '40px', height: '40px', objectFit: 'cover', border: '1px solid #fff' }} />}
                                        <span className="fw-bold">{p.name}</span>
                                    </div>
                                    <span className="badge bg-primary rounded-pill">{p.score} pts</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="mt-5">
                        <button className="btn btn-primary btn-lg" onClick={nextQuestion}>QUESTION SUIVANTE &gt;</button>
                    </div>
                </div>
            )}

            {gameState === 'SERIES_END' && (
                <div className="container mt-5 text-center">
                    <h1 className="display-3 mb-4 glitch-text" data-text="FIN DE SÉRIE">📊 FIN DE SÉRIE</h1>

                    <div className="card shadow mx-auto mb-5 bg-transparent border-secondary" style={{ maxWidth: '700px' }}>
                        <div className="card-header bg-transparent border-secondary">
                            <h3 className="mb-0 text-light">CLASSEMENT ACTUEL</h3>
                        </div>
                        <div className="list-group list-group-flush">
                            {leaderboard.slice(0, 5).map((p, idx) => (
                                <div key={p.id} className="list-group-item d-flex justify-content-between align-items-center p-3 bg-transparent text-light border-secondary">
                                    <div className="d-flex align-items-center">
                                        <span className="badge bg-secondary me-3">#{idx + 1}</span>
                                        {p.avatar && <img src={p.avatar} alt="av" className="rounded-circle me-2" style={{ width: '40px', height: '40px', objectFit: 'cover' }} />}
                                        <span className="fw-bold">{p.name}</span>
                                    </div>
                                    <span className="badge bg-primary rounded-pill fs-6">{p.score} pts</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {stats && stats.correlations && stats.correlations.length > 0 && (
                        <div className="mb-5">
                            <h2 className="mb-4 text-info">📊 STATISTIQUES RIGOLOTES</h2>
                            <div className="card mx-auto bg-transparent border-info" style={{ maxWidth: '700px' }}>
                                <div className="card-body">
                                    {stats.correlations.map((fact, idx) => (
                                        <div key={idx} className="alert alert-success mb-2 bg-transparent border-success text-success">
                                            {fact}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="d-flex justify-content-center gap-3 mb-5">
                        <button className="btn btn-primary btn-lg" onClick={() => socket.emit('start-game', { roomCode, quizId: selectedQuizId })}>
                            SÉRIE SUIVANTE
                        </button>
                        <button className="btn btn-danger btn-lg" onClick={() => socket.emit('end-evening', { roomCode })}>
                            TERMINER LA SOIRÉE (Calculer QI)
                        </button>
                    </div>
                </div>
            )}

            {gameState === 'END' && (
                <div className="container mt-5 text-center">
                    <h1 className="display-3 mb-5 text-warning glitch-text" data-text="CLASSEMENT FINAL">🏆 CLASSEMENT FINAL 🏆</h1>

                    <div className="card shadow mx-auto mb-5 bg-transparent border-warning" style={{ maxWidth: '700px' }}>
                        <div className="list-group list-group-flush">
                            {leaderboard.map((p, idx) => {
                                const podiumClass = idx === 0 ? 'bg-warning bg-opacity-10' : idx === 1 ? 'bg-secondary bg-opacity-10' : idx === 2 ? 'bg-danger bg-opacity-10' : 'bg-transparent';

                                return (
                                    <div key={p.id} className={`list-group-item d-flex justify-content-between align-items-center p-3 ${podiumClass} border-secondary text-light`}>
                                        <div className="d-flex align-items-center">
                                            <span className="fs-4 me-3">
                                                {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`}
                                            </span>
                                            {p.avatar && <img src={p.avatar} alt="av" className="rounded-circle me-3 border border-2 border-light" style={{ width: '50px', height: '50px', objectFit: 'cover' }} />}
                                            <span className="fs-5 fw-bold">{p.name}</span>
                                        </div>
                                        <div className="text-end">
                                            <div className="fs-4 fw-bold text-primary">{p.score} pts</div>
                                            {p.iq && <div className="text-info small">QI: {p.iq}</div>}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {stats && stats.correlations && stats.correlations.length > 0 && (
                        <div className="mb-5">
                            <h2 className="mb-4 text-info">📊 STATISTIQUES RIGOLOTES</h2>
                            <div className="card mx-auto bg-transparent border-info" style={{ maxWidth: '700px' }}>
                                <div className="card-body">
                                    {stats.correlations.map((fact, idx) => (
                                        <div key={idx} className="alert alert-success mb-2 bg-transparent border-success text-success">
                                            {fact}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="mb-5">
                        <button className="btn btn-outline-light btn-lg" onClick={() => { clearHostSession(); navigate('/'); }}>RETOUR À L'ACCUEIL</button>
                    </div>
                </div>
            )}
        </div>
    );
}

export default HostView;
