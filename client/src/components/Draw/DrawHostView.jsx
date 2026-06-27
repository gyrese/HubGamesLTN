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
        document.body.classList.add('comic-theme');
        return () => document.body.classList.remove('comic-theme');
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
        const colors = ['#FFD60A', '#FF3B30', '#C2DCFF', '#FFE0DC'];

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

    const drawStroke = (stroke, saveToHistory = true) => {
        if (!canvasContextRef.current || !canvasRef.current) return;
        if (saveToHistory) {
            const strokePointsStr = JSON.stringify(stroke.points);
            if (!strokesHistoryRef.current.some(s => JSON.stringify(s.points) === strokePointsStr)) {
                strokesHistoryRef.current.push(stroke);
            }
        }
        const ctx = canvasContextRef.current;
        const canvas = canvasRef.current;
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = stroke.size;
        ctx.beginPath();
        stroke.points.forEach((pt, i) => {
            const x = pt.x * canvas.width;
            const y = pt.y * canvas.height;
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });
        ctx.stroke();
    };

    const clearCanvas = (clearHistory = true) => {
        if (clearHistory) {
            strokesHistoryRef.current = [];
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

    const copyCode = () => {
        navigator.clipboard?.writeText(roomCode).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const joinUrl = `${window.location.origin}/draw/play/${roomCode}`;

    // ── CREATING ──────────────────────────────────────────────────────
    if (gameState === 'CREATING') {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="text-center">
                    <div className="text-4xl font-black text-on-background uppercase italic mb-4">🎨 DrawUp</div>
                    <div className="text-[#FF3B30] font-bold uppercase text-sm">Création du salon...</div>
                </div>
            </div>
        );
    }

    // ── LOBBY ─────────────────────────────────────────────────────────
    if (gameState === 'LOBBY') {
        return (
            <div className="min-h-screen flex flex-col p-4 text-[#161a33] relative overflow-auto">

                {/* Header */}
                <div className="relative z-10 flex items-center justify-between mb-4">
                    <button onClick={() => { clearHostSession(); navigate('/draw'); }} className="sk-btn sk-btn-secondary py-1.5 px-3 text-[10px] flex items-center gap-1">
                        <span className="material-symbols-outlined text-sm">arrow_back</span> Retour
                    </button>
                    <div className="bg-[#FF3B30] text-white font-black text-xs uppercase px-4 py-1.5 border-3 border-[#161a33] rounded-full shadow-[3px_3px_0px_0px_#161a33]">
                        🎨 DrawUp
                    </div>
                    <div className="w-16" />
                </div>

                <div className="relative z-10 w-full max-w-4xl mx-auto flex flex-col gap-4">
                    {/* Split-screen: Code + QR vs Players */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Code + QR (Left panel) */}
                        <div className="sk-box p-5 bg-white flex flex-col items-center justify-center text-center gap-4">
                            <div className="w-full">
                                <div className="text-[10px] font-black uppercase text-[#FF3B30] tracking-wider mb-1">Code du salon</div>
                                <div className="text-6xl font-black text-[#161a33] tracking-widest uppercase select-all leading-none mb-3">
                                    {roomCode}
                                </div>
                                <button
                                    onClick={copyCode}
                                    className="sk-btn sk-btn-secondary text-[11px] py-1.5 px-3 mx-auto flex items-center gap-1.5"
                                >
                                    <span className="material-symbols-outlined text-sm">{copied ? 'check' : 'content_copy'}</span>
                                    {copied ? 'Copié !' : 'Copier'}
                                </button>
                            </div>
                            <div className="border-3 border-[#161a33] rounded-xl p-3 bg-white shadow-[3px_3px_0px_0px_#161a33]">
                                <QRCodeSVG value={joinUrl} size={130} />
                            </div>
                            <div className="text-[10px] font-bold text-[#161a33]/60">Scanne le QR Code pour rejoindre sur mobile</div>
                        </div>

                        {/* Players (Right panel) */}
                        <div className="sk-box p-5 bg-white flex flex-col">
                            <div className="flex items-center justify-between mb-3 border-b-3 border-[#161a33] pb-2">
                                <h2 className="text-xs font-black uppercase text-[#FF3B30]">Les Artistes ({players.length})</h2>
                                <span className="material-symbols-outlined text-base text-[#FF3B30] animate-pulse">groups</span>
                            </div>
                            {players.length === 0 ? (
                                <div className="flex-1 flex flex-col items-center justify-center py-8">
                                    <p className="text-xs text-[#FF3B30] font-bold italic animate-pulse">En attente de joueurs...</p>
                                </div>
                            ) : (
                                <div className="grid grid-cols-3 gap-2 overflow-y-auto max-h-[260px] p-1">
                                    {players.map(p => (
                                        <div key={p.id} className="flex flex-col items-center gap-1 bg-[#FFFBF0] border-2 border-[#161a33]/20 rounded-xl p-2.5">
                                            <div className="w-12 h-12 sk-ava">
                                                {p.avatar?.startsWith('/') ? (
                                                    <img src={p.avatar} alt="" className="w-full h-full object-cover" />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center text-xl bg-[#C2DCFF]">{p.avatar || '👤'}</div>
                                                )}
                                            </div>
                                            <span className="text-[9px] font-black uppercase truncate w-full text-center text-[#161a33]">{p.name}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Settings & Word categories */}
                    <div className="sk-box p-5 bg-white flex flex-col gap-4">
                        <div className="flex items-center gap-2 mb-1 border-b-3 border-[#161a33] pb-2">
                            <span className="material-symbols-outlined text-sm text-[#FF3B30]">tune</span>
                            <h2 className="text-xs font-black uppercase text-[#FF3B30]">Paramètres de la partie</h2>
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <div className="text-[10px] font-black uppercase text-[#FF3B30]/80 mb-2">Manches par joueur</div>
                                <div className="flex items-center gap-3">
                                    <button onClick={() => setSettings(s => ({ ...s, roundsPerPlayer: Math.max(1, s.roundsPerPlayer - 1) }))}
                                        className="sk-btn sk-btn-secondary w-9 h-9 p-0 flex items-center justify-center text-lg">-</button>
                                    <span className="font-black text-xl text-[#161a33] min-w-[2rem] text-center">{settings.roundsPerPlayer}</span>
                                    <button onClick={() => setSettings(s => ({ ...s, roundsPerPlayer: Math.min(5, s.roundsPerPlayer + 1) }))}
                                        className="sk-btn sk-btn-secondary w-9 h-9 p-0 flex items-center justify-center text-lg">+</button>
                                </div>
                            </div>
                            <div>
                                <div className="text-[10px] font-black uppercase text-[#FF3B30]/80 mb-2">Temps par manche</div>
                                <div className="flex items-center gap-3">
                                    <button onClick={() => setSettings(s => ({ ...s, timePerRound: Math.max(30, s.timePerRound - 15) }))}
                                        className="sk-btn sk-btn-secondary w-9 h-9 p-0 flex items-center justify-center text-lg">-</button>
                                    <span className="font-black text-xl text-[#161a33] min-w-[4rem] text-center">{settings.timePerRound}s</span>
                                    <button onClick={() => setSettings(s => ({ ...s, timePerRound: Math.min(180, s.timePerRound + 15) }))}
                                        className="sk-btn sk-btn-secondary w-9 h-9 p-0 flex items-center justify-center text-lg">+</button>
                                </div>
                            </div>
                        </div>

                        {/* Word Categories */}
                        {availableCategories.length > 0 && (
                            <div className="mt-2">
                                <div className="text-[10px] font-black uppercase text-[#FF3B30]/80 mb-2.5 flex items-center justify-between">
                                    <span>Thèmes de mots</span>
                                    <button
                                        onClick={() => setSettings(s => ({ ...s, categories: ['all'] }))}
                                        className="text-[9px] font-black text-[#FF3B30]/60 hover:text-[#FF3B30] transition-colors"
                                    >
                                        {settings.categories.includes('all') ? '✓ Tous' : 'Tout sélectionner'}
                                    </button>
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                    {availableCategories.map(key => {
                                        const isAll = settings.categories.includes('all');
                                        const isActive = isAll || settings.categories.includes(key);
                                        return (
                                            <button
                                                key={key}
                                                onClick={() => toggleCategory(key)}
                                                className={`sk-pill ${isActive ? 'sk-pill-active' : ''}`}
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
                        className="sk-btn sk-btn-primary w-full py-4 text-sm mt-2 flex items-center justify-center gap-2"
                    >
                        <span className="material-symbols-outlined text-base">play_arrow</span>
                        {players.length < 2 ? `Minimum 2 joueurs (${players.length}/2)` : '🎨 Lancer la Partie'}
                    </button>
                </div>
            </div>
        );
    }

    // ── PLAYING ───────────────────────────────────────────────────────
    if (gameState === 'PLAYING') {
        const guessersCount = guessedPlayers.size;
        const nonDrawers = players.filter(p => p.id !== currentDrawerId).length;

        return (
            <div className="h-screen flex flex-col overflow-hidden bg-[#FFFBF0] relative">
                {countdownVal > 0 && (
                    <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#161a33]/40 backdrop-blur-sm">
                        <div className="comic-countdown-container">
                            <div className="comic-countdown-text font-black italic text-8xl">
                                {countdownVal}
                            </div>
                        </div>
                    </div>
                )}

                {/* Header */}
                <div className="flex items-center gap-3 px-4 py-2 bg-white border-b-3 border-[#161a33] flex-shrink-0">
                    <div className="bg-[#FF3B30] text-white font-black text-xs uppercase px-3 py-1.5 border-3 border-[#161a33] rounded-full shadow-[2px_2px_0px_0px_#161a33]">
                        🎨 DrawUp
                    </div>
                    <div className="bg-[#C2DCFF] text-[#161a33] font-black text-xs uppercase px-3 py-1.5 border-3 border-[#161a33] rounded-full shadow-[2px_2px_0px_0px_#161a33]">
                        Manche {currentRound}/{totalRounds}
                    </div>

                    {/* Word blanks */}
                    <div className="flex-1 flex items-center justify-center gap-1.5 flex-wrap">
                        <span className="sk-pill sk-pill-active py-0.5 px-2.5 text-[10px] mr-1">{wordCategory}</span>
                        {Array.from({ length: wordLength }).map((_, i) => (
                            <div key={i} className="w-5 h-1 bg-[#161a33] rounded-full" />
                        ))}
                        <span className="text-[10px] font-black text-[#161a33]/50 ml-1">({wordLength} lettres)</span>
                    </div>

                    {/* Timer */}
                    <div className={`flex flex-col items-center ${timerClass} text-[#161a33]`}>
                        <span className="font-black text-2xl leading-none tabular-nums">{timer}</span>
                        <div className="w-16 h-2 bg-[#161a33]/10 border-2 border-[#161a33] rounded-full overflow-hidden mt-1">
                            <div
                                className={`h-full rounded-full transition-all duration-1000 ${timer <= 10 ? 'bg-[#FF3B30]' : timer <= 30 ? 'bg-[#ff9f1c]' : 'bg-[#FFD60A]'}`}
                                style={{ width: `${timerPct}%` }}
                            />
                        </div>
                    </div>

                    {/* End round manually */}
                    <button onClick={endRound} className="sk-btn sk-btn-danger py-1.5 px-3 text-[10px] flex items-center gap-1">
                        ⏹ Terminer
                    </button>
                </div>

                {/* Body */}
                <div className="flex flex-1 min-h-0 gap-3 p-3">
                    {/* Canvas area */}
                    <div className="flex-1 flex flex-col min-w-0 gap-2">
                        <div className="sk-box px-4 py-2 bg-[#C2DCFF] flex items-center gap-2" style={{ borderRadius: '12px', boxShadow: '3px 3px 0px 0px #161a33' }}>
                            <div className="w-7 h-7 sk-ava">
                                {players.find(p => p.id === currentDrawerId)?.avatar?.startsWith('/') ? (
                                    <img src={players.find(p => p.id === currentDrawerId)?.avatar} alt="" className="w-full h-full object-cover" />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center text-sm">
                                        {players.find(p => p.id === currentDrawerId)?.avatar || '🎨'}
                                    </div>
                                )}
                            </div>
                            <span className="font-black text-xs uppercase text-[#161a33]">
                                <span className="text-[#FF3B30]">{drawerName}</span> dessine...
                            </span>
                            <div className="ml-auto sk-pill sk-pill-yellow py-0.5 px-2.5 text-[9px]">
                                {guessersCount}/{nonDrawers} ont trouvé
                            </div>
                        </div>
                        <div className="flex-1 min-h-0 flex items-center justify-center p-2 relative">
                            <div className="canvas-container-4-3">
                                <canvas ref={canvasRef} className="draw-canvas" />
                            </div>
                        </div>
                    </div>

                    {/* Sidebar */}
                    <div className="w-60 flex-shrink-0 flex flex-col gap-3 overflow-y-auto">
                        {/* Leaderboard */}
                        <div className="sk-box p-3 bg-white flex flex-col">
                            <h3 className="text-[10px] font-black uppercase text-[#FF3B30] mb-2 flex items-center gap-1">
                                <span className="material-symbols-outlined text-xs">leaderboard</span> Classement
                            </h3>
                            <div className="flex flex-col gap-1.5 overflow-y-auto max-h-[200px] p-0.5">
                                {getSortedPlayers().map((p, i) => (
                                    <div key={p.id} className={`flex items-center gap-1.5 p-1.5 rounded-lg border-2 text-[10px] ${
                                        p.id === currentDrawerId
                                            ? 'border-[#FF3B30] bg-[#FF3B30]/15'
                                            : guessedPlayers.has(p.id)
                                                ? 'border-[#00D26A] bg-[#00D26A]/15'
                                                : 'border-[#161a33]/15 bg-[#FFFBF0]'
                                    }`}>
                                        <span className="font-black text-[#161a33] w-4 text-center">{i + 1}</span>
                                        <div className="w-5 h-5 sk-ava">
                                            {p.avatar?.startsWith('/') ? (
                                                <img src={p.avatar} alt="" className="w-full h-full object-cover" />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center text-[9px]">{p.avatar || '👤'}</div>
                                            )}
                                        </div>
                                        <span className="flex-1 font-bold truncate text-[#161a33]">{p.name}</span>
                                        <span className="font-black text-[#161a33]">{p.score}</span>
                                        <span className="text-sm">{p.id === currentDrawerId ? '🎨' : guessedPlayers.has(p.id) ? '✅' : '💭'}</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Guess feed */}
                        <div className="sk-box p-3 bg-white flex-1 flex flex-col min-h-0">
                            <h3 className="text-[10px] font-black uppercase text-[#FF3B30] mb-2 flex items-center gap-1">
                                <span className="material-symbols-outlined text-xs">chat</span> Réponses
                            </h3>
                            <div className="flex flex-col gap-1.5 overflow-y-auto flex-1 p-0.5">
                                {guessFeed.slice(0, 20).map(g => (
                                    <div key={g.id} className={`text-[10px] p-1.5 rounded-lg border-2 ${
                                        g.type === 'correct'
                                            ? 'bg-[#00D26A]/15 border-[#00D26A] font-black text-[#161a33]'
                                            : g.type === 'close'
                                                ? 'bg-[#FFD60A]/15 border-[#FFD60A] font-bold text-[#FF3B30]'
                                                : 'bg-[#161a33]/5 border-[#161a33]/10 text-[#161a33]/70 font-medium'
                                    }`}>
                                        {g.type === 'correct'
                                            ? `✅ ${g.playerName} a trouvé ! (+${g.points})`
                                            : g.type === 'close'
                                                ? `🔥 ${g.playerName} s'approche...`
                                                : `${g.playerName}: ${g.guess}`
                                        }
                                    </div>
                                ))}
                                {guessFeed.length === 0 && (
                                    <p className="text-[9px] text-[#161a33]/40 italic text-center py-2">En attente...</p>
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
            <div className="min-h-screen flex flex-col items-center justify-center p-4 relative overflow-hidden bg-[#FFFBF0]">
                <div className="relative z-10 w-full max-w-lg flex flex-col gap-4">
                    {drawerLeftWarning && (
                        <div className="bg-[#FFE0DC] border-3 border-[#FF3B30] text-[#FF3B30] font-black text-sm uppercase p-4 text-center rounded-xl animate-pulse shadow-[3px_3px_0px_0px_#FF3B30]">
                            ⚠️ Le dessinateur s'est déconnecté ! Passage au tour suivant...
                        </div>
                    )}

                    {/* Word reveal — style bulle BD */}
                    <div className="bg-[#FF3B30] border-4 border-[#161a33] p-6 shadow-[6px_6px_0_#161a33] text-center -rotate-1 rounded-xl">
                        <div className="text-[10px] font-black uppercase text-white/80 tracking-wider mb-1">Le mot était</div>
                        <h2 className="text-5xl sk-h text-white tracking-tight">{revealedWord?.word}</h2>
                        <div className="sk-pill sk-pill-yellow py-0.5 px-3 text-[10px] mt-2">{revealedWord?.category}</div>
                    </div>

                    {/* Results */}
                    <div className="sk-box p-4 bg-white flex flex-col gap-2">
                        {roundResults.map(p => (
                            <div key={p.id} className={`flex items-center gap-3 p-2 rounded-xl border-2 ${
                                p.wasDrawer ? 'border-[#FF3B30] bg-[#FF3B30]/15' :
                                p.guessedThisRound ? 'border-[#00D26A] bg-[#00D26A]/15' :
                                'border-[#161a33]/15 bg-[#FFFBF0]'
                            }`}>
                                <div className="w-8 h-8 sk-ava">
                                    {p.avatar?.startsWith('/') ? (
                                        <img src={p.avatar} alt="" className="w-full h-full object-cover" />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center text-base">{p.avatar || '👤'}</div>
                                    )}
                                </div>
                                <span className="flex-1 font-black text-xs uppercase text-[#161a33]">{p.name}</span>
                                <span className="text-xs font-bold text-[#161a33]/70">
                                    {p.wasDrawer ? '🎨 Dessinateur' : p.guessedThisRound ? '✅ Trouvé !' : '❌ Pas trouvé'}
                                </span>
                                <span className="font-black text-sm text-[#161a33]">{p.score} pts</span>
                            </div>
                        ))}
                    </div>

                    {/* Countdown */}
                    <div className="sk-box p-5 bg-white text-center flex flex-col items-center gap-2">
                        <div className="text-[10px] font-black uppercase text-[#FF3B30] tracking-wider">Prochain tour dans</div>
                        <div className="text-5xl font-black text-[#161a33]">{nextRoundCountdown}</div>
                        <button
                            onClick={() => { if (countdownRef.current) clearInterval(countdownRef.current); nextRound(); }}
                            className="sk-btn sk-btn-warning text-xs py-2 px-4"
                        >
                            ⏭ Passer maintenant
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

        return (
            <div className="min-h-screen flex flex-col items-center justify-center p-4 relative overflow-hidden bg-[#FFFBF0]">
                <div className="relative z-10 w-full max-w-lg flex flex-col gap-4">
                    {/* Winner */}
                    <div className="bg-[#FFD60A] border-4 border-[#161a33] p-5 shadow-[6px_6px_0_#161a33] text-center -rotate-1 rounded-xl">
                        <div className="text-4xl mb-2">👑</div>
                        <h2 className="text-2xl sk-h text-[#161a33]">{winner?.name}</h2>
                        <div className="text-sm font-bold text-[#161a33]/70 mt-1">{winner?.score} points de génie</div>
                    </div>

                    {/* Podium */}
                    <div className="sk-box p-5 bg-white">
                        <div className="flex items-end justify-center gap-3">
                            {/* 2nd */}
                            {podium[1] && (
                                <div className="flex flex-col items-center gap-2 flex-1">
                                    <div className="w-12 h-12 sk-ava bg-[#C2DCFF]">
                                        {podium[1].avatar?.startsWith('/') ? <img src={podium[1].avatar} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-xl">{podium[1].avatar || '👤'}</div>}
                                    </div>
                                    <div className="text-[10px] font-black uppercase text-[#161a33] text-center truncate w-full">{podium[1].name}</div>
                                    <div className="text-xs font-black text-[#FF3B30]">{podium[1].score} pts</div>
                                    <div className="bg-[#C2DCFF] border-3 border-[#161a33] rounded-t-xl w-full h-14 flex items-center justify-center font-black text-lg shadow-[2px_2px_0px_0px_#161a33]">🥈</div>
                                </div>
                            )}
                            {/* 1st */}
                            {podium[0] && (
                                <div className="flex flex-col items-center gap-2 flex-1">
                                    <div className="w-14 h-14 sk-ava bg-[#FFD60A]">
                                        {podium[0].avatar?.startsWith('/') ? <img src={podium[0].avatar} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-2xl">{podium[0].avatar || '👤'}</div>}
                                    </div>
                                    <div className="text-[10px] font-black uppercase text-[#161a33] text-center truncate w-full">{podium[0].name}</div>
                                    <div className="text-xs font-black text-[#FF3B30]">{podium[0].score} pts</div>
                                    <div className="bg-[#FFD60A] border-3 border-[#161a33] rounded-t-xl w-full h-18 flex items-center justify-center font-black text-xl shadow-[2px_2px_0px_0px_#161a33]">🥇</div>
                                </div>
                            )}
                            {/* 3rd */}
                            {podium[2] && (
                                <div className="flex flex-col items-center gap-2 flex-1">
                                    <div className="w-12 h-12 sk-ava bg-[#FFE0DC]">
                                        {podium[2].avatar?.startsWith('/') ? <img src={podium[2].avatar} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-xl">{podium[2].avatar || '👤'}</div>}
                                    </div>
                                    <div className="text-[10px] font-black uppercase text-[#161a33] text-center truncate w-full">{podium[2].name}</div>
                                    <div className="text-xs font-black text-[#FF3B30]">{podium[2].score} pts</div>
                                    <div className="bg-[#FFE0DC] border-3 border-[#161a33] rounded-t-xl w-full h-10 flex items-center justify-center font-black text-base shadow-[2px_2px_0px_0px_#161a33]">🥉</div>
                                </div>
                            )}
                        </div>
                        {rest.length > 0 && (
                            <div className="mt-4 flex flex-col gap-1 border-t-3 border-[#161a33]/20 pt-3">
                                {rest.map((p, i) => (
                                    <div key={p.id} className="flex items-center gap-2 text-[10px] text-[#161a33]">
                                        <span className="font-black text-[#161a33]/50 w-4">#{i + 4}</span>
                                        <span className="flex-1 font-bold truncate">{p.name}</span>
                                        <span className="font-black">{p.score} pts</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Awards */}
                    {awards.length > 0 && (
                        <div className="grid grid-cols-2 gap-3">
                            {awards.map((a, i) => (
                                <div key={i} className="sk-box p-3 bg-white text-center flex flex-col items-center">
                                    <div className="text-2xl mb-1">{a.icon}</div>
                                    <div className="text-[10px] font-black uppercase text-[#FF3B30]">{a.title}</div>
                                    <div className="text-xs font-bold text-[#161a33] truncate">{a.playerName}</div>
                                    <div className="text-[9px] text-[#161a33]/60 font-bold mt-0.5">{a.value}</div>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Buttons */}
                    <div className="flex gap-3">
                        <button onClick={restartGame}
                            className="sk-btn sk-btn-primary flex-1 py-3 text-xs flex items-center justify-center gap-1">
                            🔄 Rejouer
                        </button>
                        <button onClick={() => { clearHostSession(); navigate('/'); }}
                            className="sk-btn sk-btn-secondary flex-1 py-3 text-xs flex items-center justify-center gap-1">
                            🏠 Menu
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return null;
}

export default DrawHostView;
