import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Camera, Check, Share2, Brain } from 'lucide-react';
import { socket } from '../../socket';
import { OPTION_META } from '../Quiz/quizShared';
import '../Quiz/QuizStyles.css';

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

const PRESET_AVATARS = Array.from({ length: 12 }, (_, i) => `/avatars/avatar_${i + 1}.webp`);

// Profil : tout est optionnel/sautable, sert aux « stats absurdes ».
// Les valeurs doivent rester alignées avec funStats.js (serveur).
const ZODIAC = ['Bélier', 'Taureau', 'Gémeaux', 'Cancer', 'Lion', 'Vierge', 'Balance', 'Scorpion', 'Sagittaire', 'Capricorne', 'Verseau', 'Poissons'];
const PROFILE_QUESTIONS = [
    { key: 'favoriteAnimal', label: 'Plutôt…', opts: [['Chat 🐱', 'Chat'], ['Chien 🐶', 'Chien'], ['Autre', 'Autre'], ['Aucun', 'Aucun']] },
    { key: 'painChocolat', label: 'On dit…', opts: [['Pain au chocolat', 'Pain au chocolat'], ['Chocolatine', 'Chocolatine']] },
    { key: 'pineapplePizza', label: 'Ananas sur la pizza ?', opts: [['Team Ananas 🍍', 'Team Ananas'], ['Jamais 🚫', 'Jamais']] },
    { key: 'isSportive', label: 'Le sport et toi…', opts: [['Athlète 🏃', 'Athlète'], ['Canapé 🛋️', 'Canapé']] },
    { key: 'coffeesPerDay', label: 'Cafés par jour ☕', opts: [['0', '0'], ['1-2', '1-2'], ['3-4', '3-4'], ['5+', '5+']] },
    { key: 'bedtime', label: 'Tu te couches…', opts: [['Tôt 🌅', 'Couche-tôt'], ['Normal', 'Normal'], ['Tard 🌙', 'Couche-tard']] },
    { key: 'hairColor', label: 'Cheveux', opts: [['Blond', 'Blond'], ['Brun', 'Brun'], ['Roux', 'Roux'], ['Noir', 'Noir'], ['Autre', 'Autre']] },
    { key: 'zodiacSign', label: 'Signe astro ♈', opts: ZODIAC.map(z => [z, z]) },
];

function PlayerView() {
    const navigate = useNavigate();
    const { roomCode: urlRoomCode } = useParams();
    const [step, setStep] = useState('LOGIN'); // LOGIN, PROFILE, WAITING, GAME, RESULT, SERIES_END, END
    const [roomCode, setRoomCode] = useState(urlRoomCode || '');
    const [pseudo, setPseudo] = useState('');
    const [avatar, setAvatar] = useState(null);
    const [error, setError] = useState('');

    const [profile, setProfile] = useState({});
    const [qInfo, setQInfo] = useState({ current: 0, total: 0 });
    const [duration, setDuration] = useState(20);
    const [questionStartTime, setQuestionStartTime] = useState(null);
    const [timeLeft, setTimeLeft] = useState(20);

    const [selectedAnswer, setSelectedAnswer] = useState(null);
    const [result, setResult] = useState(null);
    const [myScore, setMyScore] = useState(0);
    const [streak, setStreak] = useState(0);

    const stepRef = useRef('LOGIN');
    useEffect(() => { stepRef.current = step; }, [step]);
    const myScoreRef = useRef(0);
    useEffect(() => { myScoreRef.current = myScore; }, [myScore]);
    const streakRef = useRef(0);
    useEffect(() => { streakRef.current = streak; }, [streak]);

    const handleAvatarChange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const MAX = 300;
                let { width, height } = img;
                if (width > height) { if (width > MAX) { height *= MAX / width; width = MAX; } }
                else { if (height > MAX) { width *= MAX / height; height = MAX; } }
                canvas.width = width; canvas.height = height;
                canvas.getContext('2d').drawImage(img, 0, 0, width, height);
                setAvatar(canvas.toDataURL('image/jpeg', 0.7));
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    };

    // Jonction réutilisable. silent=true pour les reconnexions automatiques.
    const doJoin = (code, name, av, silent = false) => {
        const cleanCode = (code || '').trim();
        const cleanName = (name || '').trim();
        if (!cleanCode || !cleanName) { if (!silent) setError('Code et pseudo requis'); return; }

        socket.emit('join-room', { roomCode: cleanCode, playerName: cleanName, avatar: av }, (response) => {
            if (response.error) {
                clearSession();
                if (!silent) setError(response.error);
                return;
            }
            setRoomCode(cleanCode);
            writeSession({ roomCode: cleanCode, pseudo: cleanName, avatar: av || null });

            if (response.reconnected) {
                if (response.myScore !== undefined) { setMyScore(response.myScore); writeSession({ myScore: response.myScore }); }
                if (typeof response.duration === 'number') setDuration(response.duration);
                if (response.gameState === 'LOBBY') {
                    setStep(response.profileComplete ? 'WAITING' : 'PROFILE');
                } else if (response.gameState === 'QUESTION') {
                    setQInfo({ current: response.current || 0, total: response.total || 0 });
                    setQuestionStartTime(response.questionStartTime || Date.now());
                    if (response.questionEnded) {
                        // Reconnexion pendant les résultats : vue neutre (on ignore si c'était juste).
                        setResult({
                            isCorrect: null, score: response.myScore || 0, rank: response.rank,
                            explanation: response.explanation || null, correctAnswer: response.correctAnswer,
                        });
                        setStep('RESULT');
                    } else {
                        setResult(null);
                        setSelectedAnswer(response.alreadyAnswered ? -1 : null);
                        setStep('GAME');
                    }
                } else if (response.gameState === 'SERIES_END') {
                    setResult({ score: response.myScore || 0, rank: response.rank, totalPlayers: response.totalPlayers });
                    setStep('SERIES_END');
                } else if (response.gameState === 'END') {
                    setResult({
                        score: response.myScore || 0, rank: response.rank, totalPlayers: response.totalPlayers,
                        iq: response.iq, iqMargin: response.iqMargin, iqPercentile: response.iqPercentile,
                        iqLabel: response.iqLabel, iqEmoji: response.iqEmoji, accuracy: response.accuracy,
                    });
                    setStep('END');
                }
            } else if (!silent) {
                setStep('PROFILE');
            }
        });
    };

    const joinRoom = () => doJoin(roomCode, pseudo, avatar, false);

    const submitProfile = (skip = false) => {
        socket.emit('submit-profile', { roomCode, profile: skip ? {} : profile });
        setStep('WAITING');
        setError('');
    };

    // Restauration de session au montage + reconnexion auto sur (re)connexion socket.
    useEffect(() => {
        const saved = readSession();
        const urlMismatch = saved && urlRoomCode && saved.roomCode !== urlRoomCode;
        if (saved && saved.roomCode && saved.pseudo && !urlMismatch) {
            setPseudo(saved.pseudo);
            if (saved.avatar) setAvatar(saved.avatar);
            if (saved.myScore !== undefined) setMyScore(saved.myScore);
            const rejoin = () => doJoin(saved.roomCode, saved.pseudo, saved.avatar, false);
            if (socket.connected) rejoin();
            else socket.once('connect', rejoin);
        }

        const handleConnect = () => {
            if (stepRef.current === 'LOGIN') return;
            const s = readSession();
            if (s && s.roomCode && s.pseudo) doJoin(s.roomCode, s.pseudo, s.avatar, true);
        };
        socket.on('connect', handleConnect);
        return () => socket.off('connect', handleConnect);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const submitAnswer = (index) => {
        if (selectedAnswer !== null) return;
        setSelectedAnswer(index);
        socket.emit('submit-answer', { roomCode, answerIndex: index });
    };

    // ── Événements de jeu ──
    useEffect(() => {
        socket.on('game-started', ({ total, current, duration: d }) => {
            setStep('GAME');
            setSelectedAnswer(null);
            setResult(null);
            setQInfo({ current: current || 0, total: total || 0 });
            if (typeof d === 'number') setDuration(d);
            setQuestionStartTime(Date.now());
        });

        socket.on('round-results', ({ leaderboard, correctAnswer, explanation }) => {
            const myEntry = leaderboard.find(p => p.id === socket.id);
            const newScore = myEntry ? myEntry.score : myScoreRef.current;
            const gained = Math.max(0, newScore - myScoreRef.current);
            const isCorrect = selectedAnswer !== null && selectedAnswer !== -1 && selectedAnswer === correctAnswer;
            const nextStreak = isCorrect ? streakRef.current + 1 : 0;
            setStreak(nextStreak);
            setMyScore(newScore);
            writeSession({ myScore: newScore });
            setResult({
                isCorrect, pointsGained: gained, score: newScore,
                rank: leaderboard.findIndex(p => p.id === socket.id) + 1,
                explanation: explanation || null, correctAnswer, streak: nextStreak,
            });
            setStep('RESULT');
        });

        socket.on('series-end', ({ leaderboard }) => {
            const myEntry = leaderboard.find(p => p.id === socket.id);
            if (myEntry) { setMyScore(myEntry.score); writeSession({ myScore: myEntry.score }); }
            setResult({
                score: myEntry ? myEntry.score : 0,
                rank: leaderboard.findIndex(p => p.id === socket.id) + 1,
                totalPlayers: leaderboard.length,
            });
            setStep('SERIES_END');
        });

        socket.on('game-over', ({ leaderboard }) => {
            const myEntry = leaderboard.find(p => p.id === socket.id);
            if (myEntry) { setMyScore(myEntry.score); writeSession({ myScore: myEntry.score }); }
            setResult({
                score: myEntry ? myEntry.score : 0,
                rank: leaderboard.findIndex(p => p.id === socket.id) + 1,
                totalPlayers: leaderboard.length,
                iq: myEntry?.iq, iqMargin: myEntry?.iqMargin, iqPercentile: myEntry?.iqPercentile,
                iqLabel: myEntry?.iqLabel, iqEmoji: myEntry?.iqEmoji, accuracy: myEntry?.accuracy,
            });
            setStep('END');
        });

        socket.on('host-disconnected', () => {
            clearSession(); setStep('LOGIN'); setSelectedAnswer(null); setResult(null);
            setError("L'hôte a quitté la partie.");
        });

        return () => {
            socket.off('game-started'); socket.off('round-results');
            socket.off('series-end'); socket.off('game-over'); socket.off('host-disconnected');
        };
    }, [selectedAnswer]);

    // ── Timer miroir (manette) ──
    useEffect(() => {
        if (step !== 'GAME' || !questionStartTime) return;
        const tick = () => setTimeLeft(Math.max(0, Math.ceil(duration - (Date.now() - questionStartTime) / 1000)));
        tick();
        const id = setInterval(tick, 250);
        return () => clearInterval(id);
    }, [step, questionStartTime, duration]);

    const shareIq = async () => {
        if (!result?.iq) return;
        const text = `Mon QI au Test de QI : ${result.iq} (${result.iqLabel}) — top ${100 - result.iqPercentile}% ! 🧠`;
        try {
            if (navigator.share) await navigator.share({ title: 'Mon QI', text });
            else { await navigator.clipboard.writeText(text); setError('Copié dans le presse-papiers !'); setTimeout(() => setError(''), 2000); }
        } catch { /* annulé */ }
    };

    return (
        <div className="nq-root nq-scroll relative w-full h-[100dvh] overflow-y-auto flex flex-col">
            <div className="nq-bg-grid" />
            <div className="nq-bg-pool" />

            {/* Topbar */}
            <div className="relative z-10 flex items-center justify-between px-4 py-3">
                <button className="nq-icon-btn h-9 px-3 gap-1.5 text-sm" onClick={() => { clearSession(); navigate('/quiz'); }}>
                    <ArrowLeft className="w-4 h-4" /> Quitter
                </button>
                {step !== 'LOGIN' && roomCode && <div className="nq-chip">PIN <span className="nq-room-code ml-1">{roomCode}</span></div>}
            </div>

            {/* ───────────── LOGIN ───────────── */}
            {step === 'LOGIN' && (
                <div className="relative z-10 flex-1 flex items-center justify-center px-5 pb-8">
                    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-sm">
                        <div className="flex flex-col items-center mb-6">
                            <div className="nq-glass w-14 h-14 rounded-2xl grid place-items-center mb-3">
                                <Brain className="w-6 h-6" style={{ color: 'var(--nq-accent)' }} />
                            </div>
                            <h1 className="text-2xl font-bold">Rejoindre la partie</h1>
                        </div>

                        <div className="flex flex-col gap-3">
                            <div>
                                <label className="nq-label">Code PIN</label>
                                <input className="nq-input mt-1 text-center text-2xl tracking-[0.3em] nq-mono" placeholder="0000"
                                    value={roomCode} onChange={(e) => setRoomCode(e.target.value)} />
                            </div>
                            <div>
                                <label className="nq-label">Pseudo</label>
                                <input className="nq-input mt-1" placeholder="Ton nom" value={pseudo} onChange={(e) => setPseudo(e.target.value)} maxLength={20} />
                            </div>

                            <div>
                                <label className="nq-label">Avatar</label>
                                <div className="grid grid-cols-6 gap-2 mt-1">
                                    {PRESET_AVATARS.map(a => (
                                        <button key={a} className="nq-avatar-btn" data-active={avatar === a} onClick={() => setAvatar(a)}>
                                            <img src={a} alt="" />
                                        </button>
                                    ))}
                                </div>
                                <input type="file" accept="image/*" onChange={handleAvatarChange} className="hidden" id="avatar-upload" />
                                <label htmlFor="avatar-upload" className="nq-btn nq-btn-ghost w-full mt-2 gap-2 py-2 text-sm cursor-pointer">
                                    <Camera className="w-4 h-4" /> Importer une photo
                                </label>
                                {avatar && avatar.startsWith('data:') && (
                                    <img src={avatar} alt="" className="nq-avatar w-16 h-16 mx-auto mt-3" />
                                )}
                            </div>

                            {error && <div className="text-sm text-center" style={{ color: 'var(--nq-bad)' }}>{error}</div>}

                            <button className="nq-btn nq-btn-primary w-full py-3.5 text-base mt-2" onClick={joinRoom}>Rejoindre</button>
                        </div>
                    </motion.div>
                </div>
            )}

            {/* ───────────── PROFILE ───────────── */}
            {step === 'PROFILE' && (
                <div className="relative z-10 flex-1 overflow-y-auto nq-scroll px-5 pb-10">
                    <div className="w-full max-w-sm mx-auto">
                        <div className="text-center mb-5">
                            <h1 className="text-2xl font-bold">Petit profil 🤓</h1>
                            <p className="text-sm mt-1" style={{ color: 'var(--nq-ink-2)' }}>Pour des stats totalement absurdes en fin de partie. Tout est optionnel.</p>
                        </div>

                        <div className="flex flex-col gap-4">
                            {PROFILE_QUESTIONS.map(q => (
                                <div key={q.key}>
                                    <label className="nq-label">{q.label}</label>
                                    <div className="nq-seg mt-1.5">
                                        {q.opts.map(([labelTxt, val]) => (
                                            <button key={val} className="nq-seg-item" data-active={profile[q.key] === val}
                                                onClick={() => setProfile(p => ({ ...p, [q.key]: p[q.key] === val ? undefined : val }))}>
                                                {labelTxt}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className="flex flex-col gap-2 mt-6">
                            <button className="nq-btn nq-btn-primary w-full py-3.5 text-base" onClick={() => submitProfile(false)}>Valider</button>
                            <button className="nq-btn nq-btn-ghost w-full py-2.5 text-sm" onClick={() => submitProfile(true)}>Passer</button>
                        </div>
                    </div>
                </div>
            )}

            {/* ───────────── WAITING ───────────── */}
            {step === 'WAITING' && (
                <div className="relative z-10 flex-1 flex flex-col items-center justify-center text-center px-5">
                    {avatar && <img src={avatar} alt="" className="nq-avatar w-24 h-24 mb-5 nq-breathe" />}
                    <h2 className="text-3xl font-bold" style={{ color: 'var(--nq-accent)' }}>Tu es connecté !</h2>
                    <p className="mt-2" style={{ color: 'var(--nq-ink-2)' }}>En attente du lancement<span className="nq-dots" /></p>
                </div>
            )}

            {/* ───────────── GAME (manette) ───────────── */}
            {step === 'GAME' && (
                <div className="relative z-10 flex-1 flex flex-col px-4 pb-4">
                    <div className="flex items-center justify-between py-2">
                        <span className="nq-chip text-sm">Question {qInfo.current}/{qInfo.total}</span>
                        <span className="nq-chip text-sm nq-mono" style={{ color: timeLeft < 5 ? 'var(--nq-bad)' : 'var(--nq-ink)' }}>⏱ {timeLeft}s</span>
                    </div>
                    <div className="nq-timer-track mb-3">
                        <div className="nq-timer-fill" style={{
                            width: `${Math.max(0, Math.min(100, (timeLeft / (duration || 1)) * 100))}%`,
                            background: timeLeft < 5 ? 'var(--nq-bad)' : 'var(--nq-accent)',
                        }} />
                    </div>

                    {selectedAnswer !== null ? (
                        <div className="text-center mb-3">
                            <span className="text-lg font-bold" style={{ color: 'var(--nq-accent)' }}>
                                {selectedAnswer === -1 ? '🔒 Réponse verrouillée' : '✅ Réponse envoyée'}
                            </span>
                            <p className="text-sm" style={{ color: 'var(--nq-faint)' }}>Regarde l'écran principal</p>
                        </div>
                    ) : (
                        <p className="text-center text-sm mb-3" style={{ color: 'var(--nq-faint)' }}>Réponds sur l'écran principal 👀</p>
                    )}

                    <div className="grid grid-cols-2 gap-3 flex-1 min-h-[55vh]">
                        {OPTION_META.map((meta, idx) => (
                            <button key={idx} className="nq-pad-btn"
                                style={{ background: meta.color }}
                                data-dim={selectedAnswer !== null && selectedAnswer !== idx}
                                data-picked={selectedAnswer === idx}
                                disabled={selectedAnswer !== null}
                                onClick={() => submitAnswer(idx)}>
                                {meta.shape}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* ───────────── RESULT (feedback) ───────────── */}
            {step === 'RESULT' && result && (
                <div className="relative z-10 flex-1 flex flex-col items-center justify-center text-center px-5">
                    {result.isCorrect === null ? (
                        <h1 className="text-4xl font-bold mb-2">Résultats</h1>
                    ) : (
                        <motion.h1 key={result.isCorrect ? 'ok' : 'no'} initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                            className="text-5xl font-bold mb-2"
                            style={{ color: result.isCorrect ? 'var(--nq-good)' : 'var(--nq-bad)' }}>
                            {result.isCorrect ? 'Correct !' : 'Raté'}
                        </motion.h1>
                    )}

                    {result.isCorrect && result.pointsGained > 0 && (
                        <div className="text-2xl font-bold mb-1" style={{ color: 'var(--nq-accent)' }}>+{result.pointsGained}</div>
                    )}
                    {result.isCorrect && result.streak >= 2 && (
                        <div className="nq-chip mb-2" style={{ color: 'var(--nq-warn)' }}>🔥 Série de {result.streak}</div>
                    )}

                    {result.explanation && (
                        <div className="nq-glass rounded-2xl p-4 my-3 max-w-sm text-sm leading-relaxed" style={{ color: 'var(--nq-ink-2)' }}>
                            💡 {result.explanation}
                        </div>
                    )}

                    <div className="nq-panel px-6 py-4 mt-2 flex gap-8">
                        <div>
                            <div className="nq-label">Score</div>
                            <div className="text-2xl font-bold">{result.score}</div>
                        </div>
                        <div>
                            <div className="nq-label">Rang</div>
                            <div className="text-2xl font-bold" style={{ color: 'var(--nq-accent)' }}>#{result.rank}</div>
                        </div>
                    </div>
                    <p className="mt-5 text-sm" style={{ color: 'var(--nq-faint)' }}>En attente de la suite<span className="nq-dots" /></p>
                </div>
            )}

            {/* ───────────── SERIES_END ───────────── */}
            {step === 'SERIES_END' && result && (
                <div className="relative z-10 flex-1 flex flex-col items-center justify-center text-center px-5">
                    <h1 className="text-3xl font-bold mb-4">Fin de série</h1>
                    <div className="nq-panel px-8 py-6">
                        <div className="text-lg" style={{ color: 'var(--nq-ink-2)' }}>Classement</div>
                        <div className="text-4xl font-bold my-1" style={{ color: 'var(--nq-accent)' }}>#{result.rank} <span className="text-xl" style={{ color: 'var(--nq-faint)' }}>/ {result.totalPlayers}</span></div>
                        <div className="text-2xl font-bold mt-2">{result.score} pts</div>
                    </div>
                    <p className="mt-6 text-sm" style={{ color: 'var(--nq-faint)' }}>L'hôte va lancer la suite ou révéler les QI<span className="nq-dots" /></p>
                </div>
            )}

            {/* ───────────── END (carte QI) ───────────── */}
            {step === 'END' && result && (
                <div className="relative z-10 flex-1 flex flex-col items-center justify-center text-center px-5 py-8">
                    <motion.div initial={{ opacity: 0, y: 20, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }}
                        className="nq-iq-card w-full max-w-sm p-7">
                        <div className="flex items-center justify-center gap-2 mb-1" style={{ color: 'var(--nq-faint)' }}>
                            <Brain className="w-4 h-4" /> <span className="nq-label">Ton QI estimé</span>
                        </div>

                        {result.iq ? (
                            <>
                                <div className="text-7xl font-bold leading-none my-2" style={{ color: 'var(--nq-accent)' }}>{result.iq}</div>
                                <div className="text-sm" style={{ color: 'var(--nq-faint)' }}>± {result.iqMargin} · intervalle de confiance</div>
                                <div className="text-xl font-bold mt-3">{result.iqEmoji} {result.iqLabel}</div>
                                <div className="text-sm mt-1" style={{ color: 'var(--nq-ink-2)' }}>
                                    Plus malin que <b style={{ color: 'var(--nq-ink)' }}>{result.iqPercentile}%</b> du groupe
                                </div>

                                <div className="flex justify-center gap-8 mt-5 pt-5 border-t" style={{ borderColor: 'var(--nq-line)' }}>
                                    <div>
                                        <div className="nq-label">Précision</div>
                                        <div className="text-xl font-bold">{result.accuracy}%</div>
                                    </div>
                                    <div>
                                        <div className="nq-label">Rang</div>
                                        <div className="text-xl font-bold">#{result.rank}/{result.totalPlayers}</div>
                                    </div>
                                    <div>
                                        <div className="nq-label">Score</div>
                                        <div className="text-xl font-bold">{result.score}</div>
                                    </div>
                                </div>
                            </>
                        ) : (
                            <div className="text-2xl font-bold my-4">{result.score} pts · #{result.rank}/{result.totalPlayers}</div>
                        )}
                    </motion.div>

                    <div className="text-[11px] mt-3 max-w-xs" style={{ color: 'var(--nq-faint)' }}>
                        QI à déviation (moyenne 100, écart-type 15) estimé sur {result.totalPlayers > 1 ? 'le groupe' : 'la session'}. Pour rire, pas pour Mensa.
                    </div>

                    <div className="flex gap-3 mt-5">
                        {result.iq && (
                            <button className="nq-btn nq-btn-primary gap-2 px-5 py-3" onClick={shareIq}>
                                <Share2 className="w-4 h-4" /> Partager
                            </button>
                        )}
                        <button className="nq-btn nq-btn-ghost px-5 py-3" onClick={() => { clearSession(); navigate('/'); }}>Accueil</button>
                    </div>
                    {error && <div className="text-sm mt-3" style={{ color: 'var(--nq-good)' }}>{error}</div>}
                </div>
            )}
        </div>
    );
}

export default PlayerView;
