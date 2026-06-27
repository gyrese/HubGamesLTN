import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { socket } from '../../socket';

// ─── Session de salon (persistance + reconnexion, pattern GeoTrackr) ───
const SESSION_KEY = 'qi-session';
const readSession = () => {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
};
const writeSession = (patch) => {
    try {
        const prev = JSON.parse(localStorage.getItem(SESSION_KEY) || '{}');
        localStorage.setItem(SESSION_KEY, JSON.stringify({ ...prev, ...patch }));
    } catch { /* localStorage indisponible */ }
};
const clearSession = () => {
    try { localStorage.removeItem(SESSION_KEY); } catch { /* noop */ }
};

function PlayerView() {
    const navigate = useNavigate();
    const { roomCode: urlRoomCode } = useParams();
    const [step, setStep] = useState('LOGIN'); // LOGIN, PROFILE, WAITING, GAME, RESULT, END
    const [roomCode, setRoomCode] = useState(urlRoomCode || '');
    const [pseudo, setPseudo] = useState('');
    const [avatar, setAvatar] = useState(null); // Base64 string
    const [error, setError] = useState('');
    const [currentQuestion, setCurrentQuestion] = useState(null);

    // États du profil
    const [profile, setProfile] = useState({
        hairColor: '',
        profession: '',
        isSportive: '',
        isVegetarian: '',
        zodiacSign: '',
        favoriteDrink: '',
        favoriteAnimal: '',
        bedtime: '',
        coffeesPerDay: ''
    });

    useEffect(() => {
        socket.on('game-started', () => {
            setStep('GAME');
        });

        return () => {
            socket.off('game-started');
        };
    }, []);

    const handleAvatarChange = (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    const MAX_WIDTH = 300;
                    const MAX_HEIGHT = 300;
                    let width = img.width;
                    let height = img.height;

                    if (width > height) {
                        if (width > MAX_WIDTH) {
                            height *= MAX_WIDTH / width;
                            width = MAX_WIDTH;
                        }
                    } else {
                        if (height > MAX_HEIGHT) {
                            width *= MAX_HEIGHT / height;
                            height = MAX_HEIGHT;
                        }
                    }

                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);
                    const dataUrl = canvas.toDataURL('image/jpeg', 0.7); // Compression JPEG 70%
                    setAvatar(dataUrl);
                };
                img.src = event.target.result;
            };
            reader.readAsDataURL(file);
        }
    };

    // Jonction réutilisable. silent=true pour les reconnexions automatiques (aucune UI).
    const doJoin = (code, name, av, silent = false) => {
        const cleanCode = (code || '').trim();
        const cleanName = (name || '').trim();
        if (!cleanCode || !cleanName) { if (!silent) setError("Code et Pseudo requis"); return; }

        socket.emit('join-room', { roomCode: cleanCode, playerName: cleanName, avatar: av }, (response) => {
            if (response.error) {
                clearSession();                      // salon fermé/invalide → on repart propre
                if (!silent) setError(response.error);
                return;
            }
            setRoomCode(cleanCode);
            writeSession({ roomCode: cleanCode, pseudo: cleanName, avatar: av || null });

            if (response.reconnected) {
                if (response.myScore !== undefined) writeSession({ myScore: response.myScore });
                if (response.gameState === 'LOBBY') {
                    setStep(response.profileComplete ? 'WAITING' : 'PROFILE');
                } else if (response.gameState === 'QUESTION') {
                    setCurrentQuestion(response.question);
                    setResult(null);
                    // -1 = répondu/verrouillé (on ne connaît pas le choix exact après coup)
                    setSelectedAnswer((response.alreadyAnswered || response.questionEnded) ? -1 : null);
                    setStep('GAME');
                } else if (response.gameState === 'SERIES_END') {
                    setResult({ score: response.myScore || 0, rank: response.rank, totalPlayers: response.totalPlayers });
                    setStep('SERIES_END');
                } else if (response.gameState === 'END') {
                    setResult({ score: response.myScore || 0, rank: response.rank, totalPlayers: response.totalPlayers, iq: response.iq || null });
                    setStep('END');
                }
            } else if (!silent) {
                setStep('PROFILE'); // nouvelle entrée : profil avant l'attente
            }
        });
    };

    const joinRoom = () => doJoin(roomCode, pseudo, avatar, false);

    const submitProfile = () => {
        // Vérifier que tous les champs sont remplis
        const allFilled = Object.values(profile).every(val => val !== '');
        if (!allFilled) {
            setError("Merci de répondre à toutes les questions");
            return;
        }
        socket.emit('submit-profile', { roomCode, profile });
        setStep('WAITING');
        setError('');
    };

    const [selectedAnswer, setSelectedAnswer] = useState(null);
    const [result, setResult] = useState(null); // { score, isCorrect, rank }

    // Reflète `step` dans une ref pour le handler `connect` (évite les closures périmées)
    const stepRef = useRef('LOGIN');
    useEffect(() => { stepRef.current = step; }, [step]);

    // Restauration de session au montage + reconnexion automatique sur (re)connexion socket.
    useEffect(() => {
        const saved = readSession();
        // L'URL (QR) peut imposer un autre code que la session → on privilégie l'URL.
        const urlMismatch = saved && urlRoomCode && saved.roomCode !== urlRoomCode;
        if (saved && saved.roomCode && saved.pseudo && !urlMismatch) {
            setPseudo(saved.pseudo);
            if (saved.avatar) setAvatar(saved.avatar);
            const rejoin = () => doJoin(saved.roomCode, saved.pseudo, saved.avatar, false);
            if (socket.connected) rejoin();
            else socket.once('connect', rejoin);
        }

        const handleConnect = () => {
            if (stepRef.current === 'LOGIN') return; // pas encore en partie : rien à reconnecter
            const s = readSession();
            if (s && s.roomCode && s.pseudo) doJoin(s.roomCode, s.pseudo, s.avatar, true);
        };
        socket.on('connect', handleConnect);
        return () => socket.off('connect', handleConnect);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const submitAnswer = (index) => {
        if (selectedAnswer !== null) return; // Empêcher de répondre plusieurs fois
        setSelectedAnswer(index);
        socket.emit('submit-answer', { roomCode, answerIndex: index });
    };

    // Reset selected answer when new question arrives
    useEffect(() => {
        socket.on('game-started', () => {
            setStep('GAME');
            setSelectedAnswer(null);
            setResult(null);
        });

        socket.on('round-results', ({ leaderboard, correctAnswer }) => {
            setStep('RESULT');
            const myEntry = leaderboard.find(p => p.id === socket.id);
            const isCorrect = selectedAnswer === correctAnswer;
            setResult({
                score: myEntry ? myEntry.score : 0,
                isCorrect: isCorrect,
                rank: leaderboard.findIndex(p => p.id === socket.id) + 1
            });
            if (myEntry) writeSession({ myScore: myEntry.score });
        });

        socket.on('series-end', ({ leaderboard }) => {
            setStep('SERIES_END');
            const myEntry = leaderboard.find(p => p.id === socket.id);
            setResult({
                score: myEntry ? myEntry.score : 0,
                rank: leaderboard.findIndex(p => p.id === socket.id) + 1,
                totalPlayers: leaderboard.length
            });
            if (myEntry) writeSession({ myScore: myEntry.score });
        });

        socket.on('game-over', ({ leaderboard }) => {
            setStep('END');
            const myEntry = leaderboard.find(p => p.id === socket.id);
            setResult({
                score: myEntry ? myEntry.score : 0,
                rank: leaderboard.findIndex(p => p.id === socket.id) + 1,
                totalPlayers: leaderboard.length,
                iq: myEntry ? myEntry.iq : null
            });
            if (myEntry) writeSession({ myScore: myEntry.score });
        });

        socket.on('host-disconnected', () => {
            clearSession();
            setStep('LOGIN');
            setSelectedAnswer(null);
            setResult(null);
            setError("L'hôte a quitté la partie.");
        });

        return () => {
            socket.off('game-started');
            socket.off('round-results');
            socket.off('series-end');
            socket.off('game-over');
            socket.off('host-disconnected');
        };
    }, [selectedAnswer]);

    return (
        <div className="player-view min-vh-100 d-flex flex-column text-light">
            <div className="p-2 d-flex justify-content-between align-items-center">
                <button className="btn btn-sm btn-outline-secondary" onClick={() => { clearSession(); navigate('/quiz'); }}>RETOUR</button>
                {step !== 'LOGIN' && roomCode && <span className="badge bg-dark border border-secondary text-light">PIN: {roomCode}</span>}
            </div>

            {step === 'LOGIN' && (
                <div className="container mt-4">
                    <div className="row justify-content-center">
                        <div className="col-md-6 col-lg-4">
                            <div className="card shadow-sm border-primary bg-transparent">
                                <div className="card-body p-4 text-center">
                                    <h2 className="mb-4 fw-bold text-primary glitch-text" data-text="CONNEXION">CONNEXION</h2>
                                    <div className="mb-3">
                                        <input
                                            className="form-control form-control-lg text-center bg-dark text-light border-secondary"
                                            placeholder="CODE PIN"
                                            value={roomCode}
                                            onChange={(e) => setRoomCode(e.target.value)}
                                        />
                                    </div>
                                    <div className="mb-4">
                                        <input
                                            className="form-control form-control-lg text-center bg-dark text-light border-secondary"
                                            placeholder="PSEUDO"
                                            value={pseudo}
                                            onChange={(e) => setPseudo(e.target.value)}
                                        />
                                    </div>

                                    <div className="mb-4">
                                        <label className="form-label text-info small">AVATAR (Optionnel)</label>
                                        <input type="file" accept="image/*" onChange={handleAvatarChange} className="d-none" id="avatar-upload" />
                                        <div className="d-grid">
                                            <label htmlFor="avatar-upload" className="btn btn-outline-secondary btn-sm">CHOISIR IMAGE</label>
                                        </div>
                                        {avatar && <img src={avatar} alt="Preview" className="avatar-preview mt-3 mx-auto d-block" />}
                                    </div>

                                    {error && <div className="alert alert-danger py-2 bg-transparent border-danger text-danger">{error}</div>}

                                    <div className="d-grid">
                                        <button className="btn btn-primary btn-lg" onClick={joinRoom}>REJOINDRE</button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {step === 'PROFILE' && (
                <div className="container mt-4 pb-5">
                    <div className="row justify-content-center">
                        <div className="col-md-8 col-lg-6">
                            <div className="card shadow-sm border-secondary bg-transparent">
                                <div className="card-body p-4">
                                    <h2 className="text-center mb-2 text-primary glitch-text" data-text="PROFIL JOUEUR">PROFIL JOUEUR</h2>
                                    <p className="text-center text-info mb-4">Quelques infos pour des stats rigolotes ! 😄</p>

                                    <div className="mb-3">
                                        <label className="form-label text-light">Couleur de cheveux</label>
                                        <select className="form-select bg-dark text-light border-secondary" value={profile.hairColor} onChange={(e) => setProfile({ ...profile, hairColor: e.target.value })}>
                                            <option value="">Choisir...</option>
                                            <option value="Blond">Blond</option>
                                            <option value="Brun">Brun</option>
                                            <option value="Roux">Roux</option>
                                            <option value="Noir">Noir</option>
                                            <option value="Autre">Autre</option>
                                        </select>
                                    </div>

                                    <div className="mb-3">
                                        <label className="form-label text-light">Profession</label>
                                        <select className="form-select bg-dark text-light border-secondary" value={profile.profession} onChange={(e) => setProfile({ ...profile, profession: e.target.value })}>
                                            <option value="">Choisir...</option>
                                            <option value="Étudiant">Étudiant</option>
                                            <option value="Chef d'entreprise">Chef d'entreprise</option>
                                            <option value="Salarié">Salarié</option>
                                            <option value="Sans emploi">Sans emploi</option>
                                        </select>
                                    </div>

                                    <div className="mb-3">
                                        <label className="form-label text-light">Sportif ?</label>
                                        <select className="form-select bg-dark text-light border-secondary" value={profile.isSportive} onChange={(e) => setProfile({ ...profile, isSportive: e.target.value })}>
                                            <option value="">Choisir...</option>
                                            <option value="Oui">Oui</option>
                                            <option value="Non">Non</option>
                                        </select>
                                    </div>

                                    <div className="mb-3">
                                        <label className="form-label text-light">Végétarien ?</label>
                                        <select className="form-select bg-dark text-light border-secondary" value={profile.isVegetarian} onChange={(e) => setProfile({ ...profile, isVegetarian: e.target.value })}>
                                            <option value="">Choisir...</option>
                                            <option value="Oui">Oui</option>
                                            <option value="Non">Non</option>
                                        </select>
                                    </div>

                                    <div className="mb-3">
                                        <label className="form-label text-light">Signe astrologique</label>
                                        <select className="form-select bg-dark text-light border-secondary" value={profile.zodiacSign} onChange={(e) => setProfile({ ...profile, zodiacSign: e.target.value })}>
                                            <option value="">Choisir...</option>
                                            <option value="Bélier">Bélier</option>
                                            <option value="Taureau">Taureau</option>
                                            <option value="Gémeaux">Gémeaux</option>
                                            <option value="Cancer">Cancer</option>
                                            <option value="Lion">Lion</option>
                                            <option value="Vierge">Vierge</option>
                                            <option value="Balance">Balance</option>
                                            <option value="Scorpion">Scorpion</option>
                                            <option value="Sagittaire">Sagittaire</option>
                                            <option value="Capricorne">Capricorne</option>
                                            <option value="Verseau">Verseau</option>
                                            <option value="Poissons">Poissons</option>
                                        </select>
                                    </div>

                                    <div className="mb-3">
                                        <label className="form-label text-light">Boisson préférée</label>
                                        <select className="form-select bg-dark text-light border-secondary" value={profile.favoriteDrink} onChange={(e) => setProfile({ ...profile, favoriteDrink: e.target.value })}>
                                            <option value="">Choisir...</option>
                                            <option value="Café">Café</option>
                                            <option value="Thé">Thé</option>
                                            <option value="Eau">Eau</option>
                                            <option value="Soda">Soda</option>
                                            <option value="Bière">Bière</option>
                                        </select>
                                    </div>

                                    <div className="mb-3">
                                        <label className="form-label text-light">Animal préféré</label>
                                        <select className="form-select bg-dark text-light border-secondary" value={profile.favoriteAnimal} onChange={(e) => setProfile({ ...profile, favoriteAnimal: e.target.value })}>
                                            <option value="">Choisir...</option>
                                            <option value="Chat">Chat 🐱</option>
                                            <option value="Chien">Chien 🐶</option>
                                            <option value="Autre">Autre</option>
                                            <option value="Aucun">Aucun</option>
                                        </select>
                                    </div>

                                    <div className="mb-3">
                                        <label className="form-label text-light">Heure de coucher</label>
                                        <select className="form-select bg-dark text-light border-secondary" value={profile.bedtime} onChange={(e) => setProfile({ ...profile, bedtime: e.target.value })}>
                                            <option value="">Choisir...</option>
                                            <option value="Avant 22h">Avant 22h</option>
                                            <option value="22h-minuit">22h-minuit</option>
                                            <option value="Après minuit">Après minuit</option>
                                        </select>
                                    </div>

                                    <div className="mb-3">
                                        <label className="form-label text-light">Cafés par jour</label>
                                        <select className="form-select bg-dark text-light border-secondary" value={profile.coffeesPerDay} onChange={(e) => setProfile({ ...profile, coffeesPerDay: e.target.value })}>
                                            <option value="">Choisir...</option>
                                            <option value="0">0</option>
                                            <option value="1-2">1-2</option>
                                            <option value="3-4">3-4</option>
                                            <option value="5+">5+</option>
                                        </select>
                                    </div>

                                    {error && <div className="alert alert-danger bg-transparent border-danger text-danger">{error}</div>}

                                    <div className="d-grid mt-4">
                                        <button className="btn btn-primary btn-lg" onClick={submitProfile}>VALIDER</button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {step === 'WAITING' && (
                <div className="container mt-5 text-center flex-grow-1 d-flex flex-column justify-content-center">
                    <h2 className="display-4 text-success mb-4 glitch-text" data-text="CONNECTÉ">CONNECTÉ</h2>
                    <p className="lead text-info">En attente de l'hôte...</p>
                    <div className="spinner-border text-primary mx-auto my-4" role="status" style={{ width: '3rem', height: '3rem' }}>
                        <span className="visually-hidden">Loading...</span>
                    </div>
                    {avatar && <img src={avatar} alt="My Avatar" className="avatar-preview mx-auto" />}
                </div>
            )}

            {step === 'GAME' && (
                <div className="container flex-grow-1 d-flex flex-column justify-content-center py-4">
                    {selectedAnswer !== null && <h2 className="text-center text-primary mb-4 glitch-text" data-text="RÉPONSE ENVOYÉE">RÉPONSE ENVOYÉE</h2>}
                    <div className="row g-3 h-100" style={{ minHeight: '50vh' }}>
                        {['danger', 'primary', 'warning', 'success'].map((color, idx) => (
                            <div key={idx} className="col-6">
                                <button
                                    className={`btn btn-${color} w-100 h-100 shadow d-flex align-items-center justify-content-center`}
                                    style={{
                                        fontSize: '3rem',
                                        opacity: selectedAnswer === null ? 1 : (selectedAnswer === idx ? 1 : 0.4),
                                        transform: selectedAnswer === idx ? 'scale(1.02)' : 'scale(1)',
                                        border: selectedAnswer === idx ? '5px solid white' : 'none'
                                    }}
                                    onClick={() => submitAnswer(idx)}
                                    disabled={selectedAnswer !== null}
                                >
                                    {['▲', '◆', '●', '■'][idx]}
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {step === 'RESULT' && result && (
                <div className={`container flex-grow-1 d-flex flex-column justify-content-center text-center ${result.isCorrect ? 'bg-success bg-opacity-10' : 'bg-danger bg-opacity-10'}`}>
                    <h1 className={`display-1 fw-bold mb-4 glitch-text ${result.isCorrect ? 'text-success' : 'text-danger'}`} data-text={result.isCorrect ? 'CORRECT' : 'FAUX'}>
                        {result.isCorrect ? 'CORRECT' : 'FAUX'}
                    </h1>
                    <div className="card shadow-sm mx-auto w-100 bg-transparent border-secondary" style={{ maxWidth: '400px' }}>
                        <div className="card-body">
                            <div className="fs-2 fw-bold mb-2 text-light">Score: {result.score}</div>
                            <div className="fs-4 text-info">Rang: #{result.rank}</div>
                        </div>
                    </div>
                    <p className="mt-4 text-muted">En attente de la prochaine question...</p>
                </div>
            )}

            {step === 'SERIES_END' && result && (
                <div className="container flex-grow-1 d-flex flex-column justify-content-center text-center">
                    <h1 className="display-3 mb-4 glitch-text" data-text="FIN DE SÉRIE">FIN DE SÉRIE</h1>

                    <div className="card shadow mx-auto w-100 bg-transparent border-primary" style={{ maxWidth: '400px' }}>
                        <div className="card-body p-4">
                            <h2 className="text-primary mb-4">Série terminée !</h2>
                            <div className="fs-3 mb-3 text-light">
                                Classement : <span className="fw-bold">#{result.rank}</span> / {result.totalPlayers}
                            </div>
                            <div className="display-4 fw-bold text-primary">
                                {result.score} pts
                            </div>
                        </div>
                    </div>

                    <div className="mt-5 text-muted">
                        <p className="lead">En attente de la prochaine série...</p>
                        <small>L'hôte va lancer la série suivante ou terminer la soirée</small>
                    </div>
                </div>
            )}

            {step === 'END' && result && (
                <div className="container flex-grow-1 d-flex flex-column justify-content-center text-center py-5">
                    <h1 className="display-4 mb-4 glitch-text" data-text="PARTIE TERMINÉE">PARTIE TERMINÉE</h1>

                    <div className="display-1 mb-4">
                        {result.rank === 1 ? '🥇' : result.rank === 2 ? '🥈' : result.rank === 3 ? '🥉' : '🎮'}
                    </div>

                    <div className="card shadow mx-auto w-100 bg-transparent border-warning" style={{ maxWidth: '400px' }}>
                        <div className="card-body p-4">
                            <h2 className="text-primary mb-4">
                                {result.rank === 1 ? 'CHAMPION !' : result.rank === 2 ? 'VICE-CHAMPION !' : result.rank === 3 ? 'PODIUM !' : 'BIEN JOUÉ !'}
                            </h2>

                            {result.iq && (
                                <div className="mb-4">
                                    <div className="display-3 fw-bold text-primary mb-2">
                                        QI: {result.iq}
                                    </div>
                                    <div className="alert alert-success py-2 small bg-transparent border-success text-success">
                                        {result.iq >= 135 ? '🧠 Très Supérieur (Génie) - Top 2%' :
                                            result.iq >= 120 ? '🎓 Supérieur - Top 10%' :
                                                result.iq >= 110 ? '⭐ Moyen Supérieur - Top 25%' :
                                                    result.iq >= 90 ? '✅ Moyen - 50% de la population' :
                                                        result.iq >= 80 ? '📚 Moyen Faible' : '💪 Limite'}
                                        <div className="text-muted mt-1" style={{ fontSize: '0.75rem' }}>
                                            Basé sur 50 questions - Échelle de Wechsler
                                        </div>
                                    </div>
                                </div>
                            )}

                            <div className="fs-3 mb-2 text-light">
                                Classement : <span className="fw-bold">#{result.rank}</span> / {result.totalPlayers}
                            </div>
                            <div className="display-4 fw-bold text-primary">
                                {result.score} pts
                            </div>
                        </div>
                    </div>

                    <div className="mt-5">
                        <button className="btn btn-outline-primary btn-lg" onClick={() => { clearSession(); navigate('/'); }}>RETOUR À L'ACCUEIL</button>
                    </div>
                </div>
            )}
        </div>
    );
}

export default PlayerView;
