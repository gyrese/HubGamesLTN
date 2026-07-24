import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { socket } from '../../socket';
import { QRCodeSVG } from 'qrcode.react';
import confetti from 'canvas-confetti';
import { playCountdownSound, playTickSound, playSuccessSound, playFailSound, playWinnerSound } from '../../utils/audio';
import './DrawStyles.css';

// ─── Session hôte (persistance + reconnexion, pattern GeoTrackr) ───
const HOST_SESSION_KEY = 'draw-host-session';
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

function DrawHostView() {
    const navigate = useNavigate();
    const [gameState, setGameState] = useState('CREATING');
    const [roomCode, setRoomCode] = useState('');
    const [players, setPlayers] = useState([]);
    const [settings, setSettings] = useState({ roundsPerPlayer: 2, timePerRound: 90, categories: ['all'] });

    const [currentRound, setCurrentRound] = useState(0);
    const [totalRounds, setTotalRounds] = useState(0);
    const [currentDrawerId, setCurrentDrawerId] = useState(null);
    const [drawerName, setDrawerName] = useState('');
    const [wordCategory, setWordCategory] = useState('');
    const [wordLength, setWordLength] = useState(0);
    const [revealedWord, setRevealedWord] = useState(null);
    const [timer, setTimer] = useState(0);
    const [roundStartTime, setRoundStartTime] = useState(null);
    const [guessedPlayers, setGuessedPlayers] = useState(new Set());
    const [guessFeed, setGuessFeed] = useState([]);
    const [roundResults, setRoundResults] = useState([]);
    const [finalResults, setFinalResults] = useState([]);
    const [awards, setAwards] = useState([]);
    const [nextRoundCountdown, setNextRoundCountdown] = useState(0);
    const [copied, setCopied] = useState(false);
    const [availableCategories, setAvailableCategories] = useState([]);

    const [countdownVal, setCountdownVal] = useState(0);
    const [drawerLeftWarning, setDrawerLeftWarning] = useState(false);

    const canvasRef = useRef(null);
    const canvasContextRef = useRef(null);
    const timerRef = useRef(null);
    const countdownRef = useRef(null);
    const strokesHistoryRef = useRef([]);
    const countdownIntervalRef = useRef(null);

    useEffect(() => {
        document.body.classList.add('draw-neon');
        return () => document.body.classList.remove('draw-neon');
    }, []);

    // Garde le code de salon courant accessible dans le handler `connect` (closures).
    const roomCodeRef = useRef('');
    useEffect(() => { roomCodeRef.current = roomCode; }, [roomCode]);

    useEffect(() => {
        const applyReconnect = (response) => {
            roomCodeRef.current = response.roomCode;
            setRoomCode(response.roomCode);
            if (response.settings) setSettings(prev => ({ ...prev, ...response.settings }));
            setPlayers(response.players || []);
            setCurrentRound(response.currentRound || 0);
            setTotalRounds(response.totalRounds || 0);
            writeHostSession(response.roomCode);

            if (response.gameState === 'PLAYING') {
                setCurrentDrawerId(response.currentDrawerId);
                setDrawerName(response.drawerName || '');
                setWordCategory(response.wordCategory || '');
                setWordLength(response.wordLength || 0);
                setRoundStartTime(response.roundStartTime);
                strokesHistoryRef.current = response.canvasHistory || [];
                setGameState('PLAYING'); // déclenche le redraw du canvas depuis l'historique
                if (response.roundStartTime && response.timePerRound) {
                    startTimer(response.timePerRound, response.roundStartTime);
                }
            } else {
                setGameState(response.gameState === 'GAME_END' ? 'GAME_END' : 'LOBBY');
            }
        };

        const createFreshRoom = () => {
            socket.emit('draw-create-room', { settings }, (response) => {
                if (response.roomCode) {
                    setRoomCode(response.roomCode);
                    roomCodeRef.current = response.roomCode;
                    setGameState('LOBBY');
                    writeHostSession(response.roomCode);
                }
            });
        };

        // Reconnexion à un salon existant avec timeout de secours → fallback (nouvelle salle).
        const reconnectHost = (code, onFail) => {
            let handled = false;
            const t = setTimeout(() => { if (!handled) { handled = true; onFail(); } }, 4000);
            socket.emit('draw-host-reconnect', { roomCode: code }, (response) => {
                clearTimeout(t);
                if (handled) return;
                handled = true;
                if (response.error) onFail();
                else applyReconnect(response);
            });
        };

        // Décision au montage : session locale fraîche > nouvelle salle.
        const saved = readHostSession();
        const sessionFresh = saved && saved.roomCode && (Date.now() - (saved.createdAt || 0) < HOST_SESSION_TTL);
        if (sessionFresh) {
            reconnectHost(saved.roomCode, () => { clearHostSession(); createFreshRoom(); });
        } else {
            if (saved) clearHostSession();
            createFreshRoom();
        }

        // Charger les catégories disponibles
        socket.emit('draw-get-categories', {}, (response) => {
            if (response.categories) setAvailableCategories(response.categories);
        });

        // Reconnexion automatique sur coupure réseau / veille (le socket revient).
        const handleReconnect = () => {
            const code = roomCodeRef.current;
            if (!code) return; // pas encore de salle créée → rien à reconnecter
            reconnectHost(code, () => { clearHostSession(); createFreshRoom(); });
        };
        socket.on('connect', handleReconnect);

        return () => {
            socket.off('connect', handleReconnect);
            if (timerRef.current) clearInterval(timerRef.current);
            if (countdownRef.current) clearInterval(countdownRef.current);
            if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const triggerRoundCountdown = () => {
        setCountdownVal(3);
        playCountdownSound();
        if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
        let val = 3;
        countdownIntervalRef.current = setInterval(() => {
            val--;
            if (val <= 0) {
                clearInterval(countdownIntervalRef.current);
                setCountdownVal(0);
            } else {
                setCountdownVal(val);
                playCountdownSound();
            }
        }, 1000);
    };

    const triggerConfetti = () => {
        confetti({
            particleCount: 80,
            spread: 70,
            origin: { y: 0.6 }
        });
    };

    const triggerPodiumConfetti = () => {
        playWinnerSound();
        const end = Date.now() + (5 * 1000);
        const colors = ['#8B5CF6', '#F0398B', '#22D3EE', '#4ADE80'];

        (function frame() {
            confetti({
                particleCount: 2,
                angle: 60,
                spread: 55,
                origin: { x: 0 },
                colors: colors
            });
            confetti({
                particleCount: 2,
                angle: 120,
                spread: 55,
                origin: { x: 1 },
                colors: colors
            });

            if (Date.now() < end) {
                requestAnimationFrame(frame);
            }
        }());
    };

    useEffect(() => {
        const handlePlayerJoined = (list) => setPlayers(list);
        const handlePlayerLeft = (list) => setPlayers(list);

        const handleGameStarted = (data) => {
            setGameState('PLAYING');
            setCurrentRound(data.round);
            setTotalRounds(data.totalRounds);
            setCurrentDrawerId(data.drawerId);
            setDrawerName(data.drawerName);
            setWordCategory(data.wordCategory);
            setWordLength(data.wordLength);
            setRoundStartTime(data.roundStartTime);
            setTimer(data.timePerRound);
            setGuessedPlayers(new Set());
            setGuessFeed([]);
            setDrawerLeftWarning(false);
            clearCanvas(true);
            
            const elapsed = Date.now() - data.roundStartTime;
            if (elapsed < 3000) {
                triggerRoundCountdown();
            }
            startTimer(data.timePerRound, data.roundStartTime);
        };

        const handleNextRound = (data) => {
            setGameState('PLAYING');
            setCurrentRound(data.round);
            setTotalRounds(data.totalRounds);
            setCurrentDrawerId(data.drawerId);
            setDrawerName(data.drawerName);
            setWordCategory(data.wordCategory);
            setWordLength(data.wordLength);
            setRoundStartTime(data.roundStartTime);
            setTimer(data.timePerRound);
            setGuessedPlayers(new Set());
            setGuessFeed([]);
            setDrawerLeftWarning(false);
            clearCanvas(true);
            
            const elapsed = Date.now() - data.roundStartTime;
            if (elapsed < 3000) {
                triggerRoundCountdown();
            }
            startTimer(data.timePerRound, data.roundStartTime);
        };

        const handleStroke = (stroke) => drawStroke(stroke, true);
        const handleClear = () => clearCanvas(true);

        const handleUndoStroke = () => {
            strokesHistoryRef.current.pop();
            clearCanvas(false);
            strokesHistoryRef.current.forEach(s => drawStroke(s, false));
        };

        const handlePlayerGuessed = (data) => {
            setGuessedPlayers(prev => new Set([...prev, data.playerId]));
            setGuessFeed(prev => [{ type: 'correct', playerName: data.playerName, rank: data.rank, points: data.points, id: Date.now() }, ...prev]);
            // Scores à jour → le classement live ne reste plus figé à 0
            if (data.players) setPlayers(data.players);
        };
        const handleCloseGuess = (data) => {
            setGuessFeed(prev => [{ type: 'close', playerName: data.playerName, id: Date.now() }, ...prev]);
        };
        const handleIncorrectGuess = (data) => {
            setGuessFeed(prev => [{ type: 'incorrect', playerName: data.playerName, guess: data.guess, id: Date.now() }, ...prev]);
        };
        const handleAllGuessed = () => endRound();

        const handleRoundEnded = (data) => {
            setGameState('ROUND_END');
            setRevealedWord(data.word);
            setRoundResults(data.results);
            if (timerRef.current) clearInterval(timerRef.current);

            // Reporter les scores de la manche dans la liste des joueurs (classement live)
            if (Array.isArray(data.results)) {
                setPlayers(prev => prev.map(pl => {
                    const r = data.results.find(x => x.id === pl.id);
                    return r ? { ...pl, score: r.score } : pl;
                }));
            }
            
            if (data.drawerLeft) {
                setDrawerLeftWarning(true);
                playFailSound();
            } else {
                setDrawerLeftWarning(false);
                const anyoneGuessed = data.results.some(p => !p.wasDrawer && p.guessedThisRound);
                if (anyoneGuessed) {
                    playSuccessSound();
                    triggerConfetti();
                } else {
                    playFailSound();
                }
            }

            setNextRoundCountdown(8);
            countdownRef.current = setInterval(() => {
                setNextRoundCountdown(prev => {
                    if (prev <= 1) { clearInterval(countdownRef.current); nextRound(); return 0; }
                    return prev - 1;
                });
            }, 1000);
        };

        const handleGameOver = (data) => {
            setGameState('GAME_END');
            setFinalResults(data.results);
            setAwards(data.awards || []);
            if (timerRef.current) clearInterval(timerRef.current);
            if (countdownRef.current) clearInterval(countdownRef.current);
            triggerPodiumConfetti();
        };

        const handleWordSkipped = (data) => { setWordCategory(data.wordCategory); setWordLength(data.wordLength); clearCanvas(true); };
        const handleGameRestarted = () => { setGameState('LOBBY'); setCurrentRound(0); setGuessedPlayers(new Set()); setGuessFeed([]); };

        socket.on('draw-player-joined', handlePlayerJoined);
        socket.on('draw-player-left', handlePlayerLeft);
        socket.on('draw-game-started', handleGameStarted);
        socket.on('draw-next-round', handleNextRound);
        socket.on('draw-stroke', handleStroke);
        socket.on('draw-clear', handleClear);
        socket.on('draw-undo-stroke', handleUndoStroke);
        socket.on('draw-player-guessed', handlePlayerGuessed);
        socket.on('draw-close-guess', handleCloseGuess);
        socket.on('draw-incorrect-guess', handleIncorrectGuess);
        socket.on('draw-all-guessed', handleAllGuessed);
        socket.on('draw-round-ended', handleRoundEnded);
        socket.on('draw-game-over', handleGameOver);
        socket.on('draw-word-skipped', handleWordSkipped);
        socket.on('draw-game-restarted', handleGameRestarted);

        return () => {
            socket.off('draw-player-joined', handlePlayerJoined);
            socket.off('draw-player-left', handlePlayerLeft);
            socket.off('draw-game-started', handleGameStarted);
            socket.off('draw-next-round', handleNextRound);
            socket.off('draw-stroke', handleStroke);
            socket.off('draw-clear', handleClear);
            socket.off('draw-undo-stroke', handleUndoStroke);
            socket.off('draw-player-guessed', handlePlayerGuessed);
            socket.off('draw-close-guess', handleCloseGuess);
            socket.off('draw-incorrect-guess', handleIncorrectGuess);
            socket.off('draw-all-guessed', handleAllGuessed);
            socket.off('draw-round-ended', handleRoundEnded);
            socket.off('draw-game-over', handleGameOver);
            socket.off('draw-word-skipped', handleWordSkipped);
            socket.off('draw-game-restarted', handleGameRestarted);
        };
    }, [roomCode]);

    useEffect(() => {
        if (!canvasRef.current || gameState !== 'PLAYING') return;
        const canvas = canvasRef.current;

        const initCanvas = (w, h) => {
            if (w < 10 || h < 10) return;
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.fillStyle = 'white';
            ctx.fillRect(0, 0, w, h);
            canvasContextRef.current = ctx;
        };

        const ro = new ResizeObserver(entries => {
            for (const e of entries) {
                initCanvas(e.contentRect.width, e.contentRect.height);
                strokesHistoryRef.current.forEach(s => drawStroke(s, false));
            }
        });
        ro.observe(canvas);

        // Fallback : forcer après un cycle de layout
        requestAnimationFrame(() => {
            const r = canvas.getBoundingClientRect();
            initCanvas(r.width, r.height);
            strokesHistoryRef.current.forEach(s => drawStroke(s, false));
        });

        return () => ro.disconnect();
    }, [gameState]);

    const startTimer = (duration, startTime) => {
        if (timerRef.current) clearInterval(timerRef.current);
        let lastLoggedTick = -1;
        const update = () => {
            const elapsed = (Date.now() - startTime) / 1000;
            const remaining = Math.max(0, duration - elapsed);
            const ceilRemaining = Math.ceil(remaining);
            setTimer(ceilRemaining);
            
            if (ceilRemaining <= 10 && ceilRemaining > 0 && ceilRemaining !== lastLoggedTick) {
                lastLoggedTick = ceilRemaining;
                playTickSound();
            }

            if (remaining <= 0) { 
                clearInterval(timerRef.current); 
                endRound(); 
            }
        };
        update();
        timerRef.current = setInterval(update, 1000);
    };

    const drawnStrokeIdsRef = useRef(new Set());

    const renderSmoothStroke = (ctx, canvas, stroke) => {
        if (!ctx || !canvas || !stroke || !stroke.points || stroke.points.length === 0) return;

        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = stroke.size;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        const points = stroke.points.map(pt => ({
            x: pt.x * canvas.width,
            y: pt.y * canvas.height
        }));

        ctx.beginPath();

        if (points.length === 1) {
            ctx.fillStyle = stroke.color;
            ctx.arc(points[0].x, points[0].y, stroke.size / 2, 0, Math.PI * 2);
            ctx.fill();
            return;
        }

        if (points.length === 2) {
            ctx.moveTo(points[0].x, points[0].y);
            ctx.lineTo(points[1].x, points[1].y);
            ctx.stroke();
            return;
        }

        // 3+ points: Courbes de Bézier quadratiques passant par les points médians
        ctx.moveTo(points[0].x, points[0].y);

        for (let i = 1; i < points.length - 1; i++) {
            const midX = (points[i].x + points[i + 1].x) / 2;
            const midY = (points[i].y + points[i + 1].y) / 2;
            ctx.quadraticCurveTo(points[i].x, points[i].y, midX, midY);
        }

        const last = points[points.length - 1];
        const prevLast = points[points.length - 2];
        ctx.quadraticCurveTo(prevLast.x, prevLast.y, last.x, last.y);

        ctx.stroke();
    };

    const drawStroke = (stroke, saveToHistory = true) => {
        if (!canvasContextRef.current || !canvasRef.current) return;
        if (saveToHistory) {
            const strokeId = stroke.id || (stroke.points && stroke.points.length > 0 ? `${stroke.points.length}_${stroke.points[0].x}_${stroke.points[0].y}` : null);
            if (strokeId) {
                if (drawnStrokeIdsRef.current.has(strokeId)) return;
                drawnStrokeIdsRef.current.add(strokeId);
            }
            strokesHistoryRef.current.push(stroke);
        }
        renderSmoothStroke(canvasContextRef.current, canvasRef.current, stroke);
    };

    const clearCanvas = (clearHistory = true) => {
        if (clearHistory) {
            strokesHistoryRef.current = [];
            drawnStrokeIdsRef.current.clear();
        }
        if (!canvasContextRef.current || !canvasRef.current) return;
        const ctx = canvasContextRef.current;
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    };

    const startGame = () => {
        if (players.length < 2) return;
        socket.emit('draw-start-game', { roomCode, settings }, (response) => {
            if (response.error) console.error('[DRAW] Start game error:', response.error);
        });
    };

    const endRound = () => socket.emit('draw-end-round', { roomCode }, (r) => { if (r.error) console.error(r.error); });
    const nextRound = () => socket.emit('draw-next-round', { roomCode }, (r) => { if (r.error) console.error(r.error); });
    const restartGame = () => socket.emit('draw-restart-game', { roomCode }, (r) => { if (r.success) setGameState('LOBBY'); });

    const CATEGORY_LABELS = {
        actions: '🏃 Actions', animals: '🐾 Animaux', celebrities: '⭐ Célébrités',
        expressions: '😄 Expressions', jobs: '💼 Métiers', movies: '🎬 Films',
        objects_easy: '📦 Objets Facile', objects_medium: '🧩 Objets Moyen',
        places: '🌍 Lieux', sports: '⚽ Sports',
    };

    const toggleCategory = (key) => {
        setSettings(s => {
            const current = s.categories.filter(c => c !== 'all');
            if (current.includes(key)) {
                const next = current.filter(c => c !== key);
                return { ...s, categories: next.length === 0 ? ['all'] : next };
            }
            return { ...s, categories: [...current, key] };
        });
    };

    const getSortedPlayers = () => [...players].sort((a, b) => b.score - a.score);
    const timerPct = settings.timePerRound > 0 ? (timer / settings.timePerRound) * 100 : 0;
    const timerClass = timer <= 10 ? 'timer-danger' : timer <= 30 ? 'timer-warning' : '';
    const timerFill = timer <= 10 ? 'dr-timer-low' : timer <= 30 ? 'dr-timer-mid' : 'dr-timer-ok';

    const copyCode = () => {
        navigator.clipboard?.writeText(roomCode).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const joinUrl = `${window.location.origin}/draw/play/${roomCode}`;

    // ── CREATING ──────────────────────────────────────────────────────
    if (gameState === 'CREATING') {
        return (
            <div className="dr-app min-h-dvh flex items-center justify-center overflow-hidden">
                <span className="dr-orb dr-orb-v" /><span className="dr-orb dr-orb-m" />
                <div className="text-center flex flex-col items-center gap-4">
                    <div className="dr-logo text-3xl">
                        <span className="dr-logo-mark w-12 h-12"><span className="material-symbols-outlined text-2xl">stylus_note</span></span>
                        DRAW <span className="accent dr-grad-text">ME</span>
                    </div>
                    <div className="flex items-center gap-2 dr-eyebrow">
                        <span className="material-symbols-outlined text-base animate-spin" style={{ animationDuration: '1.5s' }}>progress_activity</span>
                        Création du salon…
                    </div>
                </div>
            </div>
        );
    }

    // ── LOBBY ─────────────────────────────────────────────────────────
    if (gameState === 'LOBBY') {
        return (
            <div className="dr-app min-h-dvh flex flex-col p-5 relative overflow-y-auto overflow-x-hidden">
                <span className="dr-orb dr-orb-v" /><span className="dr-orb dr-orb-m" /><span className="dr-orb dr-orb-c" />

                {/* Header */}
                <div className="flex items-center justify-between mb-6 max-w-5xl w-full mx-auto">
                    <button onClick={() => { clearHostSession(); navigate('/draw'); }} className="dr-btn dr-btn-ghost py-2 px-3 text-xs">
                        <span className="material-symbols-outlined text-base">arrow_back</span> Retour
                    </button>
                    <div className="dr-logo text-xl">
                        <span className="dr-logo-mark w-9 h-9"><span className="material-symbols-outlined text-lg">stylus_note</span></span>
                        DRAW <span className="accent dr-grad-text">ME</span>
                    </div>
                    <div className="w-[92px]" />
                </div>

                <div className="w-full max-w-5xl mx-auto flex flex-col gap-5 dr-fade-up">
                    {/* Split-screen: Code + QR vs Players */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                        {/* Code + QR (Left panel) */}
                        <div className="dr-card dr-card-glow p-7 flex flex-col items-center justify-center text-center gap-5">
                            <div className="w-full">
                                <div className="dr-eyebrow mb-2">Code du salon</div>
                                <div className="dr-mono text-7xl font-bold dr-grad-text tracking-[0.1em] leading-none mb-4 select-all">
                                    {roomCode}
                                </div>
                                <button onClick={copyCode} className="dr-btn dr-btn-ghost text-xs py-2 px-4 mx-auto">
                                    <span className="material-symbols-outlined text-base">{copied ? 'check' : 'content_copy'}</span>
                                    {copied ? 'Copié !' : 'Copier le code'}
                                </button>
                            </div>
                            <div className="rounded-2xl p-3 bg-white" style={{ boxShadow: 'var(--dr-glow-v)' }}>
                                <QRCodeSVG value={joinUrl} size={140} bgColor="#ffffff" fgColor="#08080F" />
                            </div>
                            <div className="text-xs text-[color:var(--dr-muted)] flex items-center gap-1.5">
                                <span className="material-symbols-outlined text-sm">qr_code_scanner</span>
                                Scanne pour rejoindre sur mobile
                            </div>
                        </div>

                        {/* Players (Right panel) */}
                        <div className="dr-card p-6 flex flex-col">
                            <div className="flex items-center justify-between mb-4 pb-3 border-b border-[color:var(--dr-line)]">
                                <h2 className="dr-h text-base">Les artistes <span className="dr-grad-text">{players.length}</span></h2>
                                <span className="material-symbols-outlined text-xl text-[color:var(--dr-violet-lt)]">groups</span>
                            </div>
                            {players.length === 0 ? (
                                <div className="flex-1 flex flex-col items-center justify-center py-10 gap-2">
                                    <span className="material-symbols-outlined text-4xl text-[color:var(--dr-dim)]">person_add</span>
                                    <p className="text-sm text-[color:var(--dr-muted)]">En attente de joueurs…</p>
                                </div>
                            ) : (
                                <div className="dr-scroll grid grid-cols-3 sm:grid-cols-4 gap-2.5 overflow-y-auto max-h-[280px] p-1">
                                    {players.map((p, i) => (
                                        <div key={p.id} className="dr-card-2 flex flex-col items-center gap-1.5 p-2.5 dr-pop" style={{ animationDelay: `${i * 50}ms` }}>
                                            <div className="w-12 h-12 dr-ava">
                                                {p.avatar?.startsWith('/') ? (
                                                    <img src={p.avatar} alt="" className="w-full h-full object-cover" />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center text-xl">{p.avatar || '👤'}</div>
                                                )}
                                            </div>
                                            <span className="text-[10px] font-semibold truncate w-full text-center text-[color:var(--dr-text)]">{p.name}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Settings & Word categories */}
                    <div className="dr-card p-6 flex flex-col gap-5">
                        <div className="flex items-center gap-2 pb-3 border-b border-[color:var(--dr-line)]">
                            <span className="material-symbols-outlined text-lg text-[color:var(--dr-violet-lt)]">tune</span>
                            <h2 className="dr-h text-base">Paramètres de la partie</h2>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                            <div>
                                <div className="dr-eyebrow mb-3">Manches par joueur</div>
                                <div className="flex items-center gap-3">
                                    <button onClick={() => setSettings(s => ({ ...s, roundsPerPlayer: Math.max(1, s.roundsPerPlayer - 1) }))}
                                        className="dr-icon-btn text-xl">−</button>
                                    <span className="dr-mono font-bold text-2xl text-[color:var(--dr-text)] min-w-[2.5rem] text-center">{settings.roundsPerPlayer}</span>
                                    <button onClick={() => setSettings(s => ({ ...s, roundsPerPlayer: Math.min(5, s.roundsPerPlayer + 1) }))}
                                        className="dr-icon-btn text-xl">+</button>
                                </div>
                            </div>
                            <div>
                                <div className="dr-eyebrow mb-3">Temps par manche</div>
                                <div className="flex items-center gap-3">
                                    <button onClick={() => setSettings(s => ({ ...s, timePerRound: Math.max(30, s.timePerRound - 15) }))}
                                        className="dr-icon-btn text-xl">−</button>
                                    <span className="dr-mono font-bold text-2xl text-[color:var(--dr-text)] min-w-[4rem] text-center">{settings.timePerRound}s</span>
                                    <button onClick={() => setSettings(s => ({ ...s, timePerRound: Math.min(180, s.timePerRound + 15) }))}
                                        className="dr-icon-btn text-xl">+</button>
                                </div>
                            </div>
                        </div>

                        {/* Word Categories */}
                        {availableCategories.length > 0 && (
                            <div>
                                <div className="dr-eyebrow mb-3 flex items-center justify-between">
                                    <span>Thèmes de mots</span>
                                    <button
                                        onClick={() => setSettings(s => ({ ...s, categories: ['all'] }))}
                                        className="text-[10px] font-bold text-[color:var(--dr-violet-lt)] hover:text-[color:var(--dr-text)] transition-colors normal-case tracking-normal"
                                    >
                                        {settings.categories.includes('all') ? '✓ Tous sélectionnés' : 'Tout sélectionner'}
                                    </button>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    {availableCategories.map(key => {
                                        const isAll = settings.categories.includes('all');
                                        const isActive = isAll || settings.categories.includes(key);
                                        return (
                                            <button
                                                key={key}
                                                onClick={() => toggleCategory(key)}
                                                className={`dr-pill ${isActive ? 'dr-pill-active' : ''}`}
                                            >
                                                {CATEGORY_LABELS[key] || key}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Start Button */}
                    <button
                        onClick={startGame}
                        disabled={players.length < 2}
                        className="dr-btn dr-btn-primary w-full py-4 text-base"
                    >
                        <span className="material-symbols-outlined text-lg">play_arrow</span>
                        {players.length < 2 ? `Minimum 2 joueurs (${players.length}/2)` : 'Lancer la partie'}
                    </button>
                </div>
            </div>
        );
    }

    // ── PLAYING ───────────────────────────────────────────────────────
    if (gameState === 'PLAYING') {
        const guessersCount = guessedPlayers.size;
        const nonDrawers = players.filter(p => p.id !== currentDrawerId).length;

        const drawer = players.find(p => p.id === currentDrawerId);
        return (
            <div className="dr-app h-dvh flex flex-col overflow-hidden relative">
                {countdownVal > 0 && (
                    <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#08080F]/80 backdrop-blur-md">
                        <div key={countdownVal} className="dr-countdown text-[9rem] leading-none">{countdownVal}</div>
                    </div>
                )}

                {/* Header */}
                <div className="flex items-center gap-3 px-5 py-3 flex-shrink-0 border-b border-[color:var(--dr-line)]">
                    <div className="dr-logo text-base">
                        <span className="dr-logo-mark w-8 h-8"><span className="material-symbols-outlined text-base">stylus_note</span></span>
                        <span className="hidden sm:inline">DRAW <span className="accent dr-grad-text">ME</span></span>
                    </div>
                    <div className="dr-pill dr-pill-violet"><span className="dr-mono">Manche {currentRound}/{totalRounds}</span></div>

                    {/* Word blanks */}
                    <div className="flex-1 flex items-center justify-center gap-2 flex-wrap">
                        <span className="dr-pill dr-pill-cyan">{wordCategory}</span>
                        {Array.from({ length: wordLength }).map((_, i) => (
                            <div key={i} className="dr-blank" style={{ width: '22px' }} />
                        ))}
                        <span className="dr-mono text-xs text-[color:var(--dr-dim)]">{wordLength} lettres</span>
                    </div>

                    {/* Timer */}
                    <div className={`flex flex-col items-center gap-1 ${timerClass}`}>
                        <span className="dr-mono font-bold text-2xl leading-none text-[color:var(--dr-text)]">{timer}</span>
                        <div className="w-20 dr-timer-track" style={{ height: '6px' }}>
                            <div className={`dr-timer-fill ${timerFill}`} style={{ width: `${timerPct}%` }} />
                        </div>
                    </div>

                    {/* End round manually */}
                    <button onClick={endRound} className="dr-btn dr-btn-danger py-2 px-3 text-xs">
                        <span className="material-symbols-outlined text-base">stop_circle</span> Terminer
                    </button>
                </div>

                {/* Body */}
                <div className="flex flex-1 min-h-0 gap-4 p-4">
                    {/* Canvas area */}
                    <div className="flex-1 flex flex-col min-w-0 gap-3">
                        <div className="dr-card-2 px-4 py-2.5 flex items-center gap-3">
                            <div className="w-8 h-8 dr-ava dr-ava-ring">
                                {drawer?.avatar?.startsWith('/') ? (
                                    <img src={drawer.avatar} alt="" className="w-full h-full object-cover" />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center text-sm">{drawer?.avatar || '🎨'}</div>
                                )}
                            </div>
                            <span className="text-sm text-[color:var(--dr-muted)] flex items-center gap-1.5">
                                <span className="dr-h text-sm dr-grad-text">{drawerName}</span> dessine…
                            </span>
                            <div className="ml-auto dr-pill dr-pill-lime">
                                <span className="material-symbols-outlined text-sm">check_circle</span>
                                {guessersCount}/{nonDrawers} ont trouvé
                            </div>
                        </div>
                        <div className="flex-1 min-h-0 flex items-center justify-center relative">
                            <div className="canvas-container-4-3">
                                <canvas ref={canvasRef} className="draw-canvas" />
                            </div>
                        </div>
                    </div>

                    {/* Sidebar */}
                    <div className="w-72 flex-shrink-0 flex flex-col gap-4 min-h-0">
                        {/* Leaderboard */}
                        <div className="dr-card p-4 flex flex-col flex-shrink-0">
                            <h3 className="dr-eyebrow mb-3 flex items-center gap-1.5">
                                <span className="material-symbols-outlined text-sm text-[color:var(--dr-violet-lt)]">leaderboard</span> Classement
                            </h3>
                            <div className="dr-scroll flex flex-col gap-1.5 overflow-y-auto max-h-[240px] pr-1">
                                {getSortedPlayers().map((p, i) => {
                                    const isDrawing = p.id === currentDrawerId;
                                    const found = guessedPlayers.has(p.id);
                                    return (
                                        <div key={p.id} className="flex items-center gap-2 p-2 rounded-xl text-sm border"
                                            style={{
                                                borderColor: isDrawing ? 'rgba(139,92,246,0.5)' : found ? 'rgba(74,222,128,0.4)' : 'var(--dr-line)',
                                                background: isDrawing ? 'rgba(139,92,246,0.12)' : found ? 'rgba(74,222,128,0.1)' : 'transparent',
                                            }}>
                                            <span className="dr-mono font-bold text-[color:var(--dr-muted)] w-5 text-center">{i + 1}</span>
                                            <div className="w-6 h-6 dr-ava">
                                                {p.avatar?.startsWith('/') ? (
                                                    <img src={p.avatar} alt="" className="w-full h-full object-cover" />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center text-[10px]">{p.avatar || '👤'}</div>
                                                )}
                                            </div>
                                            <span className="flex-1 font-medium truncate text-[color:var(--dr-text)]">{p.name}</span>
                                            <span className="dr-mono font-bold text-[color:var(--dr-lime)]">{p.score}</span>
                                            <span className="material-symbols-outlined text-base" style={{
                                                color: isDrawing ? 'var(--dr-violet-lt)' : found ? 'var(--dr-lime)' : 'var(--dr-dim)',
                                                fontVariationSettings: found ? "'FILL' 1" : undefined,
                                            }}>
                                                {isDrawing ? 'stylus_note' : found ? 'check_circle' : 'more_horiz'}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Guess feed */}
                        <div className="dr-card p-4 flex-1 flex flex-col min-h-0">
                            <h3 className="dr-eyebrow mb-3 flex items-center gap-1.5">
                                <span className="material-symbols-outlined text-sm text-[color:var(--dr-violet-lt)]">forum</span> Réponses
                            </h3>
                            <div className="dr-scroll flex flex-col gap-1.5 overflow-y-auto flex-1 pr-1">
                                {guessFeed.slice(0, 20).map(g => (
                                    <div key={g.id} className="text-xs p-2 rounded-lg border dr-slide-in"
                                        style={
                                            g.type === 'correct'
                                                ? { background: 'rgba(74,222,128,0.12)', borderColor: 'rgba(74,222,128,0.4)', color: 'var(--dr-lime)' }
                                                : g.type === 'close'
                                                    ? { background: 'rgba(251,191,36,0.12)', borderColor: 'rgba(251,191,36,0.4)', color: 'var(--dr-amber)' }
                                                    : { background: 'rgba(255,255,255,0.03)', borderColor: 'var(--dr-line)', color: 'var(--dr-muted)' }
                                        }>
                                        {g.type === 'correct'
                                            ? <span className="font-semibold">✅ {g.playerName} a trouvé ! (+{g.points})</span>
                                            : g.type === 'close'
                                                ? <span className="font-semibold">🔥 {g.playerName} s'approche…</span>
                                                : <><span className="font-semibold text-[color:var(--dr-text)]">{g.playerName}</span> : {g.guess}</>
                                        }
                                    </div>
                                ))}
                                {guessFeed.length === 0 && (
                                    <p className="text-xs text-[color:var(--dr-dim)] italic text-center py-3">En attente des réponses…</p>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // ── ROUND END ─────────────────────────────────────────────────────
    if (gameState === 'ROUND_END') {
        return (
            <div className="dr-app min-h-dvh flex flex-col items-center justify-center p-5 relative overflow-y-auto overflow-x-hidden">
                <span className="dr-orb dr-orb-v" /><span className="dr-orb dr-orb-m" />
                <div className="w-full max-w-lg flex flex-col gap-5 dr-fade-up">
                    {drawerLeftWarning && (
                        <div className="dr-card-2 p-4 text-center dr-h text-sm dr-pop flex items-center justify-center gap-2"
                            style={{ color: 'var(--dr-red)', borderColor: 'rgba(251,85,112,0.5)', background: 'rgba(251,85,112,0.1)' }}>
                            <span className="material-symbols-outlined">warning</span>
                            Le dessinateur s'est déconnecté ! Tour suivant…
                        </div>
                    )}

                    {/* Word reveal */}
                    <div className="dr-card dr-card-glow p-8 text-center dr-pop">
                        <div className="dr-eyebrow">Le mot était</div>
                        <h2 className="dr-h text-6xl dr-grad-text mt-2">{revealedWord?.word}</h2>
                        <div className="dr-pill dr-pill-cyan mt-4 inline-flex">{revealedWord?.category}</div>
                    </div>

                    {/* Results */}
                    <div className="dr-card p-4 flex flex-col gap-2">
                        {roundResults.map((p, i) => (
                            <div key={p.id} className="flex items-center gap-3 p-2.5 rounded-xl border dr-slide-in"
                                style={{
                                    animationDelay: `${i * 40}ms`,
                                    borderColor: p.wasDrawer ? 'rgba(139,92,246,0.5)' : p.guessedThisRound ? 'rgba(74,222,128,0.4)' : 'var(--dr-line)',
                                    background: p.wasDrawer ? 'rgba(139,92,246,0.12)' : p.guessedThisRound ? 'rgba(74,222,128,0.1)' : 'transparent',
                                }}>
                                <div className="w-9 h-9 dr-ava">
                                    {p.avatar?.startsWith('/') ? (
                                        <img src={p.avatar} alt="" className="w-full h-full object-cover" />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center text-base">{p.avatar || '👤'}</div>
                                    )}
                                </div>
                                <span className="flex-1 dr-h text-sm">{p.name}</span>
                                <span className="text-xs font-medium flex items-center gap-1"
                                    style={{ color: p.wasDrawer ? 'var(--dr-violet-lt)' : p.guessedThisRound ? 'var(--dr-lime)' : 'var(--dr-dim)' }}>
                                    <span className="material-symbols-outlined text-sm" style={{ fontVariationSettings: p.guessedThisRound ? "'FILL' 1" : undefined }}>
                                        {p.wasDrawer ? 'stylus_note' : p.guessedThisRound ? 'check_circle' : 'cancel'}
                                    </span>
                                    {p.wasDrawer ? 'Dessinateur' : p.guessedThisRound ? 'Trouvé !' : 'Pas trouvé'}
                                </span>
                                <span className="dr-mono font-bold text-sm text-[color:var(--dr-text)]">{p.score}</span>
                            </div>
                        ))}
                    </div>

                    {/* Countdown */}
                    <div className="dr-card p-6 text-center flex flex-col items-center gap-3">
                        <div className="dr-eyebrow">Prochain tour dans</div>
                        <div className="dr-mono text-6xl font-bold dr-grad-text">{nextRoundCountdown}</div>
                        <button
                            onClick={() => { if (countdownRef.current) clearInterval(countdownRef.current); nextRound(); }}
                            className="dr-btn dr-btn-ghost text-sm py-2.5 px-5"
                        >
                            <span className="material-symbols-outlined text-base">skip_next</span> Passer maintenant
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // ── GAME END ──────────────────────────────────────────────────────
    if (gameState === 'GAME_END') {
        const winner = finalResults[0];
        const podium = finalResults.slice(0, 3);
        const rest = finalResults.slice(3);

        const podiumStyles = [
            { grad: 'linear-gradient(135deg,#FBBF24,#F0398B)', glow: '0 0 30px rgba(251,191,36,0.5)', h: 'h-24', medal: '🥇', ava: 'w-16 h-16' },
            { grad: 'var(--dr-grad-cyan)', glow: 'var(--dr-glow-c)', h: 'h-16', medal: '🥈', ava: 'w-12 h-12' },
            { grad: 'var(--dr-grad)', glow: 'var(--dr-glow-m)', h: 'h-12', medal: '🥉', ava: 'w-12 h-12' },
        ];
        const renderPodium = (p, rank) => {
            if (!p) return <div className="flex-1" />;
            const st = podiumStyles[rank];
            return (
                <div className="flex flex-col items-center gap-2 flex-1 dr-pop" style={{ animationDelay: `${rank * 120}ms` }}>
                    <div className={`${st.ava} dr-ava`} style={{ borderColor: 'transparent', boxShadow: st.glow }}>
                        {p.avatar?.startsWith('/') ? <img src={p.avatar} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-2xl">{p.avatar || '👤'}</div>}
                    </div>
                    <div className="dr-h text-sm text-center truncate w-full">{p.name}</div>
                    <div className="dr-mono font-bold text-sm text-[color:var(--dr-lime)]">{p.score}</div>
                    <div className={`${st.h} w-full rounded-t-2xl flex items-start justify-center pt-2 text-3xl`} style={{ background: st.grad, boxShadow: st.glow }}>
                        {st.medal}
                    </div>
                </div>
            );
        };

        return (
            <div className="dr-app min-h-dvh flex flex-col items-center justify-center p-5 relative overflow-y-auto overflow-x-hidden">
                <span className="dr-orb dr-orb-v" /><span className="dr-orb dr-orb-m" /><span className="dr-orb dr-orb-c" />
                <div className="w-full max-w-lg flex flex-col gap-5 dr-fade-up">
                    {/* Winner */}
                    <div className="dr-card dr-card-glow p-7 text-center dr-pop">
                        <div className="text-5xl mb-2">👑</div>
                        <div className="dr-eyebrow">Champion·ne</div>
                        <h2 className="dr-h text-4xl dr-grad-text mt-1">{winner?.name}</h2>
                        <div className="dr-mono text-sm text-[color:var(--dr-muted)] mt-2">{winner?.score} points de génie</div>
                    </div>

                    {/* Podium */}
                    <div className="dr-card p-6">
                        <div className="flex items-end justify-center gap-3">
                            {renderPodium(podium[1], 1)}
                            {renderPodium(podium[0], 0)}
                            {renderPodium(podium[2], 2)}
                        </div>
                        {rest.length > 0 && (
                            <div className="mt-5 flex flex-col gap-1.5 border-t border-[color:var(--dr-line)] pt-4">
                                {rest.map((p, i) => (
                                    <div key={p.id} className="flex items-center gap-2.5 text-sm">
                                        <span className="dr-mono font-bold text-[color:var(--dr-dim)] w-6">{i + 4}</span>
                                        <span className="flex-1 font-medium truncate text-[color:var(--dr-text)]">{p.name}</span>
                                        <span className="dr-mono font-bold text-[color:var(--dr-lime)]">{p.score}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Awards */}
                    {awards.length > 0 && (
                        <div className="grid grid-cols-2 gap-3">
                            {awards.map((a, i) => (
                                <div key={i} className="dr-card-2 p-4 text-center flex flex-col items-center">
                                    <div className="text-3xl mb-1">{a.icon}</div>
                                    <div className="dr-eyebrow text-[color:var(--dr-violet-lt)]">{a.title}</div>
                                    <div className="text-sm font-semibold text-[color:var(--dr-text)] truncate mt-0.5">{a.playerName}</div>
                                    <div className="dr-mono text-xs text-[color:var(--dr-muted)] mt-0.5">{a.value}</div>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Buttons */}
                    <div className="flex gap-3">
                        <button onClick={restartGame} className="dr-btn dr-btn-primary flex-1 py-3.5">
                            <span className="material-symbols-outlined text-lg">replay</span> Rejouer
                        </button>
                        <button onClick={() => { clearHostSession(); navigate('/'); }} className="dr-btn dr-btn-ghost flex-1 py-3.5">
                            <span className="material-symbols-outlined text-lg">home</span> Menu
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return null;
}

export default DrawHostView;
