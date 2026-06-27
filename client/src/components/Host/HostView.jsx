import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { QRCodeSVG } from 'qrcode.react';
import {
    ArrowLeft, ArrowRight, Brain, Users, Timer, Zap, Play, Lightbulb,
    Trophy, Sparkles, SkipForward, Flag,
} from 'lucide-react';
import { socket } from '../../socket';
import { OPTION_META, apiBase } from '../Quiz/quizShared';
import '../Quiz/QuizStyles.css';

// ─── Session hôte (persistance + reconnexion, pattern GeoTrackr) ───
const HOST_SESSION_KEY = 'qi-host-session';
const HOST_SESSION_TTL = 4 * 60 * 60 * 1000; // 4 h
const readHostSession = () => {
    try { return JSON.parse(localStorage.getItem(HOST_SESSION_KEY) || 'null'); } catch { return null; }
};
const writeHostSession = (roomCode) => {
    try { localStorage.setItem(HOST_SESSION_KEY, JSON.stringify({ roomCode, createdAt: Date.now() })); } catch { /* noop */ }
};
const clearHostSession = () => {
    try { localStorage.removeItem(HOST_SESSION_KEY); } catch { /* noop */ }
};

const DURATIONS = [10, 15, 20, 30];

function HostView() {
    const navigate = useNavigate();
    const [roomCode, setRoomCode] = useState(null);
    const [players, setPlayers] = useState([]);
    const [gameState, setGameState] = useState('INIT'); // INIT, LOBBY, GAME, RESULT, SERIES_END, END
    const [currentQuestion, setCurrentQuestion] = useState(null);
    const [answeredPlayers, setAnsweredPlayers] = useState(new Set());

    const [questionStartTime, setQuestionStartTime] = useState(null);
    const [duration, setDuration] = useState(20);
    const [timeLeft, setTimeLeft] = useState(20);

    const [leaderboard, setLeaderboard] = useState([]);
    const [correctAnswer, setCorrectAnswer] = useState(null);
    const [explanation, setExplanation] = useState(null);
    const [autoAdvanceActive, setAutoAdvanceActive] = useState(false);
    const [resultCountdown, setResultCountdown] = useState(null);

    const [quizzes, setQuizzes] = useState([]);
    const [selectedQuizId, setSelectedQuizId] = useState('');
    const [stats, setStats] = useState(null);

    // Réglages de partie (lobby)
    const [durationSetting, setDurationSetting] = useState(20);
    const [autoAdvanceSetting, setAutoAdvanceSetting] = useState(false);

    const roomCodeRef = useRef('');
    useEffect(() => { roomCodeRef.current = roomCode; }, [roomCode]);

    const joinUrl = roomCode ? `${window.location.origin}/quiz/play/${roomCode}` : '';

    // ── Init : reconnexion ou création + reconnexion auto sur `connect` ──
    useEffect(() => {
        fetch(`${apiBase()}/quizzes`)
            .then(res => res.json())
            .then(data => { setQuizzes(data); if (data.length > 0) setSelectedQuizId(prev => prev || data[0].id); })
            .catch(err => console.error("Erreur chargement quiz", err));

        const applyReconnect = (resp) => {
            roomCodeRef.current = resp.roomCode;
            setRoomCode(resp.roomCode);
            setPlayers(resp.players || []);
            writeHostSession(resp.roomCode);
            if (typeof resp.duration === 'number') { setDuration(resp.duration); setDurationSetting(resp.duration); }
            if (typeof resp.autoAdvance === 'boolean') setAutoAdvanceSetting(resp.autoAdvance);

            if (resp.gameState === 'QUESTION') {
                setCurrentQuestion(resp.question);
                if (resp.questionEnded) {
                    setCorrectAnswer(resp.correctAnswer);
                    setExplanation(resp.explanation || null);
                    setLeaderboard(resp.leaderboard || []);
                    setAutoAdvanceActive(!!resp.autoAdvance);
                    setGameState('RESULT');
                } else {
                    setAnsweredPlayers(new Set(resp.answeredPlayerIds || []));
                    setQuestionStartTime(resp.questionStartTime || Date.now());
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
            if (!code) return;
            reconnectHost(code, () => { clearHostSession(); createFreshRoom(); });
        };
        socket.on('connect', handleReconnect);
        return () => socket.off('connect', handleReconnect);
    }, []);

    // ── Événements de jeu ──
    useEffect(() => {
        socket.on('player-joined', (updated) => setPlayers(updated));
        socket.on('player-left', (updated) => setPlayers(updated));

        socket.on('game-started', ({ question, duration: d, autoAdvance }) => {
            setGameState('GAME');
            setCurrentQuestion(question);
            setAnsweredPlayers(new Set());
            if (typeof d === 'number') setDuration(d);
            if (typeof autoAdvance === 'boolean') setAutoAdvanceActive(autoAdvance);
            setQuestionStartTime(Date.now());
            setResultCountdown(null);
        });

        socket.on('player-answered', ({ playerId }) => {
            setAnsweredPlayers(prev => new Set(prev).add(playerId));
        });

        socket.on('round-results', ({ leaderboard, correctAnswer, explanation, autoAdvance, resultDuration }) => {
            setGameState('RESULT');
            setLeaderboard(leaderboard);
            setCorrectAnswer(correctAnswer);
            setExplanation(explanation || null);
            setAutoAdvanceActive(!!autoAdvance);
            setResultCountdown(resultDuration ? Math.round(resultDuration / 1000) : null);
        });

        socket.on('series-end', ({ leaderboard, stats }) => {
            setGameState('SERIES_END'); setLeaderboard(leaderboard); setStats(stats);
        });
        socket.on('game-over', ({ leaderboard, stats }) => {
            setGameState('END'); setLeaderboard(leaderboard); setStats(stats);
        });

        return () => {
            socket.off('player-joined'); socket.off('player-left');
            socket.off('game-started'); socket.off('player-answered');
            socket.off('round-results'); socket.off('series-end'); socket.off('game-over');
        };
    }, []);

    // ── Timer visuel (synchronisé sur l'horloge serveur, non autoritaire) ──
    useEffect(() => {
        if (gameState !== 'GAME' || !questionStartTime) return;
        const tick = () => {
            const elapsed = (Date.now() - questionStartTime) / 1000;
            setTimeLeft(Math.max(0, Math.ceil(duration - elapsed)));
        };
        tick();
        const id = setInterval(tick, 250);
        return () => clearInterval(id);
    }, [gameState, questionStartTime, duration]);

    // ── Compte à rebours d'auto-avance (affichage) ──
    useEffect(() => {
        if (gameState !== 'RESULT' || !autoAdvanceActive || resultCountdown === null) return;
        if (resultCountdown <= 0) return;
        const id = setTimeout(() => setResultCountdown((c) => (c > 0 ? c - 1 : 0)), 1000);
        return () => clearTimeout(id);
    }, [gameState, autoAdvanceActive, resultCountdown]);

    const startGame = () => socket.emit('start-game', {
        roomCode, quizId: selectedQuizId, duration: durationSetting, autoAdvance: autoAdvanceSetting,
    });
    const nextQuestion = () => socket.emit('next-question', { roomCode });
    const skipQuestion = () => socket.emit('end-question', { roomCode });

    if (gameState === 'INIT') {
        return (
            <div className="nq-root w-full h-[100dvh] grid place-items-center">
                <div className="nq-bg-grid" />
                <div className="flex flex-col items-center gap-4 relative z-10">
                    <div className="nq-glass w-14 h-14 rounded-2xl grid place-items-center nq-breathe">
                        <Brain className="w-6 h-6" style={{ color: 'var(--nq-accent)' }} />
                    </div>
                    <p style={{ color: 'var(--nq-ink-2)' }}>Initialisation du salon<span className="nq-dots" /></p>
                </div>
            </div>
        );
    }

    const answeredCount = answeredPlayers.size;
    const totalPlayers = players.length;

    return (
        <div className="nq-root nq-scroll relative w-full h-[100dvh] overflow-y-auto">
            <div className="nq-bg-grid" />
            <div className="nq-bg-pool" />

            {/* Topbar */}
            <div className="relative z-10 flex items-center justify-between px-4 sm:px-6 py-3 border-b" style={{ borderColor: 'var(--nq-line)' }}>
                <button className="nq-icon-btn h-10 px-3.5 gap-2 text-sm" onClick={() => { clearHostSession(); navigate('/quiz'); }}>
                    <ArrowLeft className="w-4 h-4" /> <span className="hidden sm:inline">Quitter</span>
                </button>
                <div className="flex items-center gap-2">
                    <Brain className="w-5 h-5" style={{ color: 'var(--nq-accent)' }} />
                    <span className="font-semibold tracking-tight">Test de QI</span>
                </div>
                <div className="nq-chip">PIN <span className="nq-room-code ml-1 text-base">{roomCode}</span></div>
            </div>

            {/* ───────────────────────── LOBBY ───────────────────────── */}
            {gameState === 'LOBBY' && (
                <div className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 py-8 grid lg:grid-cols-[320px_1fr] gap-6">
                    {/* Carte de connexion */}
                    <div className="nq-panel p-6 flex flex-col items-center text-center h-fit">
                        <span className="nq-label">Scannez pour rejoindre</span>
                        <div className="bg-white rounded-2xl p-3 mt-3 mb-4">
                            {joinUrl && <QRCodeSVG value={joinUrl} size={170} />}
                        </div>
                        <span className="nq-label">Ou code PIN</span>
                        <div className="text-5xl mt-1 nq-room-code" style={{ color: 'var(--nq-accent)' }}>{roomCode}</div>

                        {/* Réglages */}
                        <div className="w-full mt-6 text-left">
                            <span className="nq-label flex items-center gap-1.5"><Timer className="w-3.5 h-3.5" /> Temps par question</span>
                            <div className="nq-seg mt-2">
                                {DURATIONS.map(d => (
                                    <button key={d} className="nq-seg-item" data-active={durationSetting === d}
                                        onClick={() => setDurationSetting(d)}>{d}s</button>
                                ))}
                            </div>

                            <button
                                className="nq-status w-full mt-4 justify-between"
                                data-done={autoAdvanceSetting}
                                onClick={() => setAutoAdvanceSetting(v => !v)}
                            >
                                <span className="flex items-center gap-2 text-sm font-semibold">
                                    <Zap className="w-4 h-4" style={{ color: autoAdvanceSetting ? 'var(--nq-good)' : 'var(--nq-faint)' }} />
                                    Auto-avance
                                </span>
                                <span className="text-xs font-bold" style={{ color: autoAdvanceSetting ? 'var(--nq-good)' : 'var(--nq-faint)' }}>
                                    {autoAdvanceSetting ? 'ACTIVÉ' : 'MANUEL'}
                                </span>
                            </button>
                        </div>
                    </div>

                    {/* Joueurs + lancement */}
                    <div className="flex flex-col">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-2xl font-bold flex items-center gap-2">
                                <Users className="w-6 h-6" style={{ color: 'var(--nq-accent)' }} />
                                Joueurs <span style={{ color: 'var(--nq-faint)' }}>({totalPlayers})</span>
                            </h2>
                            <select
                                className="nq-input w-auto py-2"
                                value={selectedQuizId}
                                onChange={(e) => setSelectedQuizId(e.target.value)}
                            >
                                {quizzes.map(q => <option key={q.id} value={q.id}>{q.title}</option>)}
                            </select>
                        </div>

                        {totalPlayers === 0 ? (
                            <div className="nq-glass flex-1 min-h-[240px] rounded-2xl grid place-items-center text-center p-8">
                                <div>
                                    <div className="nq-breathe text-4xl mb-2">📲</div>
                                    <p style={{ color: 'var(--nq-ink-2)' }}>En attente des premiers joueurs<span className="nq-dots" /></p>
                                </div>
                            </div>
                        ) : (
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                                <AnimatePresence>
                                    {players.map((p) => (
                                        <motion.div key={p.id} layout
                                            initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}
                                            className="nq-glass rounded-2xl p-3 flex flex-col items-center gap-2"
                                        >
                                            {p.avatar
                                                ? <img src={p.avatar} alt="" className="nq-avatar w-14 h-14" />
                                                : <div className="nq-avatar w-14 h-14 grid place-items-center text-xl">🙂</div>}
                                            <span className="text-sm font-semibold truncate max-w-full">{p.name}</span>
                                        </motion.div>
                                    ))}
                                </AnimatePresence>
                            </div>
                        )}

                        <div className="mt-6">
                            <button className="nq-btn nq-btn-primary w-full py-4 text-lg gap-2" onClick={startGame} disabled={totalPlayers === 0}>
                                <Play className="w-5 h-5" /> Lancer le quiz
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ───────────────────────── GAME ───────────────────────── */}
            {gameState === 'GAME' && currentQuestion && (
                <div className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 py-6">
                    <div className="flex items-start justify-between gap-4 mb-6">
                        <div className="flex-1">
                            {typeof currentQuestion.difficulty === 'number' && (
                                <div className="flex items-center gap-1 mb-2">
                                    <span className="nq-label mr-1">Difficulté</span>
                                    {[1, 2, 3, 4, 5].map(i => <span key={i} className="nq-diff-dot" data-on={i <= currentQuestion.difficulty} />)}
                                </div>
                            )}
                            <h2 className="text-2xl sm:text-3xl font-bold leading-tight">{currentQuestion.text}</h2>
                        </div>
                        <div className="nq-timer-ring"
                            style={{
                                color: timeLeft < 5 ? 'var(--nq-bad)' : 'var(--nq-accent)',
                                border: `4px solid ${timeLeft < 5 ? 'var(--nq-bad)' : 'var(--nq-accent)'}`,
                                boxShadow: `0 0 18px ${timeLeft < 5 ? 'rgba(251,113,133,0.5)' : 'rgba(16,185,129,0.45)'}`,
                            }}>
                            {timeLeft}
                        </div>
                    </div>

                    {currentQuestion.image && (
                        <div className="text-center mb-6">
                            <img src={currentQuestion.image} alt="" className="inline-block max-h-[300px] rounded-2xl border" style={{ borderColor: 'var(--nq-line-strong)' }} />
                        </div>
                    )}

                    <div className="grid sm:grid-cols-2 gap-3">
                        {currentQuestion.options.map((opt, idx) => {
                            const meta = OPTION_META[idx % 4];
                            return (
                                <div key={idx} className="nq-option">
                                    <div className="nq-option-shape" style={{ background: meta.color, color: meta.ink }}>{meta.shape}</div>
                                    <span className="text-lg font-semibold">{opt}</span>
                                </div>
                            );
                        })}
                    </div>

                    <div className="mt-6 flex items-center justify-between">
                        <div className="nq-chip text-sm">
                            <Users className="w-4 h-4" /> {answeredCount} / {totalPlayers} ont répondu
                        </div>
                        <button className="nq-btn nq-btn-ghost gap-2" onClick={skipQuestion}>
                            <SkipForward className="w-4 h-4" /> Révéler
                        </button>
                    </div>
                </div>
            )}

            {/* ───────────────────────── RESULT ───────────────────────── */}
            {gameState === 'RESULT' && currentQuestion && (
                <div className="relative z-10 max-w-3xl mx-auto px-4 sm:px-6 py-6">
                    <h2 className="text-center text-xl font-bold mb-4" style={{ color: 'var(--nq-faint)' }}>La bonne réponse</h2>

                    <div className="grid sm:grid-cols-2 gap-3 mb-5">
                        {currentQuestion.options.map((opt, idx) => {
                            const meta = OPTION_META[idx % 4];
                            const isCorrect = idx === correctAnswer;
                            return (
                                <div key={idx} className="nq-option nq-pop" data-correct={isCorrect} data-dim={!isCorrect}
                                    style={isCorrect ? { borderColor: 'var(--nq-good)', boxShadow: '0 0 26px rgba(52,211,153,0.3)' } : undefined}>
                                    <div className="nq-option-shape" style={{ background: meta.color, color: meta.ink }}>{meta.shape}</div>
                                    <span className="text-lg font-semibold">{opt}</span>
                                    {isCorrect && <span className="ml-auto text-xl">✅</span>}
                                </div>
                            );
                        })}
                    </div>

                    {explanation && (
                        <div className="nq-glass rounded-2xl p-4 mb-6 flex gap-3">
                            <Lightbulb className="w-5 h-5 shrink-0 mt-0.5" style={{ color: 'var(--nq-warn)' }} />
                            <p className="text-sm leading-relaxed" style={{ color: 'var(--nq-ink-2)' }}>{explanation}</p>
                        </div>
                    )}

                    <div className="nq-panel overflow-hidden mb-6">
                        {leaderboard.slice(0, 5).map((p, idx) => (
                            <div key={p.id} className="flex items-center justify-between px-4 py-3 border-b last:border-b-0" style={{ borderColor: 'var(--nq-line)' }}>
                                <div className="flex items-center gap-3">
                                    <span className="nq-chip w-7 h-7 justify-center p-0">{idx + 1}</span>
                                    {p.avatar && <img src={p.avatar} alt="" className="nq-avatar w-9 h-9" />}
                                    <span className="font-semibold">{p.name}</span>
                                </div>
                                <span className="font-bold" style={{ color: 'var(--nq-accent)' }}>{p.score} pts</span>
                            </div>
                        ))}
                    </div>

                    <div className="flex justify-center">
                        <button className="nq-btn nq-btn-primary gap-2 px-6 py-3" onClick={nextQuestion}>
                            {autoAdvanceActive && resultCountdown !== null
                                ? <>Suivante dans {resultCountdown}s</>
                                : <>Question suivante <ArrowRight className="w-4 h-4" /></>}
                        </button>
                    </div>
                </div>
            )}

            {/* ─────────────────── SERIES_END / END ─────────────────── */}
            {(gameState === 'SERIES_END' || gameState === 'END') && (
                <div className="relative z-10 max-w-3xl mx-auto px-4 sm:px-6 py-8">
                    <div className="text-center mb-6">
                        {gameState === 'END'
                            ? <h1 className="text-3xl sm:text-4xl font-bold flex items-center justify-center gap-3"><Trophy className="w-8 h-8" style={{ color: 'var(--nq-warn)' }} /> Classement final</h1>
                            : <h1 className="text-3xl font-bold">Fin de série</h1>}
                    </div>

                    <div className="nq-panel overflow-hidden mb-6">
                        {leaderboard.map((p, idx) => (
                            <div key={p.id} className="flex items-center justify-between px-4 py-3 border-b last:border-b-0"
                                style={{ borderColor: 'var(--nq-line)', background: idx < 3 ? 'rgba(var(--nq-accent-rgb),0.05)' : 'transparent' }}>
                                <div className="flex items-center gap-3 min-w-0">
                                    <span className="text-xl w-7 text-center">{idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx + 1}`}</span>
                                    {p.avatar && <img src={p.avatar} alt="" className="nq-avatar w-10 h-10" />}
                                    <span className="font-semibold truncate">{p.name}</span>
                                </div>
                                <div className="text-right shrink-0">
                                    <div className="font-bold" style={{ color: 'var(--nq-accent)' }}>{p.score} pts</div>
                                    {gameState === 'END' && p.iq && (
                                        <div className="text-xs" style={{ color: 'var(--nq-ink-2)' }}>QI {p.iq} <span style={{ color: 'var(--nq-faint)' }}>±{p.iqMargin}</span></div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>

                    {stats && stats.correlations && stats.correlations.length > 0 && (
                        <div className="mb-8">
                            <h3 className="text-center text-lg font-bold mb-3 flex items-center justify-center gap-2">
                                <Sparkles className="w-5 h-5" style={{ color: 'var(--nq-warn)' }} /> Stats absurdes
                            </h3>
                            <div className="flex flex-col gap-2">
                                {stats.correlations.map((fact, idx) => (
                                    <div key={idx} className="nq-glass rounded-xl px-4 py-3 text-sm" style={{ color: 'var(--nq-ink-2)' }}>{fact}</div>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="flex flex-wrap justify-center gap-3">
                        {gameState === 'SERIES_END' ? (
                            <>
                                <button className="nq-btn nq-btn-primary gap-2 px-5 py-3" onClick={startGame}>
                                    <Play className="w-4 h-4" /> Série suivante
                                </button>
                                <button className="nq-btn nq-btn-danger gap-2 px-5 py-3" onClick={() => socket.emit('end-evening', { roomCode })}>
                                    <Flag className="w-4 h-4" /> Terminer · Calculer le QI
                                </button>
                            </>
                        ) : (
                            <button className="nq-btn nq-btn-ghost px-5 py-3" onClick={() => { clearHostSession(); navigate('/'); }}>
                                Retour à l'accueil
                            </button>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

export default HostView;
