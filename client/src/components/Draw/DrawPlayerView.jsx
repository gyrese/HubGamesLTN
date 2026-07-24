import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { socket } from '../../socket';
import { playCountdownSound, playSuccessSound, playFailSound, playWinnerSound } from '../../utils/audio';
import './DrawStyles.css';

// Avatars partagés avec GeoTrackr (60 webp)
const ALL_AVATARS = Array.from({ length: 60 }, (_, i) => `/avatars/avatar_${i + 1}.webp`);

const COLORS = [
    { name: 'Noir',   value: '#000000' },
    { name: 'Rouge',  value: '#e71d36' },
    { name: 'Orange', value: '#ff9f1c' },
    { name: 'Jaune',  value: '#ffe66d' },
    { name: 'Vert',   value: '#00d26a' },
    { name: 'Bleu',   value: '#4ecdc4' },
    { name: 'Violet', value: '#9b59b6' },
    { name: 'Marron', value: '#8b4513' },
    { name: 'Blanc',  value: '#ffffff' },
];

const BRUSH_SIZES = [3, 8, 16, 30];

function DrawPlayerView() {
    const navigate = useNavigate();
    const { roomCode: urlRoomCode } = useParams();

    const [playerName, setPlayerName] = useState('');
    const [avatar, setAvatar] = useState(ALL_AVATARS[0]);
    const [roomCode, setRoomCode] = useState(urlRoomCode || '');
    const [isJoined, setIsJoined] = useState(false);
    const [error, setError] = useState('');

    const [gameState, setGameState] = useState('LOBBY');
    const [isDrawer, setIsDrawer] = useState(false);
    const [currentRound, setCurrentRound] = useState(0);
    const [totalRounds, setTotalRounds] = useState(0);
    const [drawerName, setDrawerName] = useState('');
    const [wordCategory, setWordCategory] = useState('');
    const [wordLength, setWordLength] = useState(0);
    const [myWord, setMyWord] = useState(null);
    const [timer, setTimer] = useState(0);
    const [timePerRound, setTimePerRound] = useState(90);

    const [guess, setGuess] = useState('');
    const [hasGuessed, setHasGuessed] = useState(false);
    const [guessResult, setGuessResult] = useState(null);
    const [myScore, setMyScore] = useState(0);
    const [shakeGuess, setShakeGuess] = useState(false);

    const [selectedColor, setSelectedColor] = useState('#000000');
    const [brushSize, setBrushSize] = useState(8);
    const isDrawingRef = useRef(false);
    const currentStrokeRef = useRef(null);
    const [isEraser, setIsEraser] = useState(false);
    const [countdownVal, setCountdownVal] = useState(0);

    const [revealedWord, setRevealedWord] = useState(null);
    const [finalResults, setFinalResults] = useState([]);
    const [awards, setAwards] = useState([]);

    const canvasRef = useRef(null);
    const canvasContextRef = useRef(null);
    const timerRef = useRef(null);
    const guessInputRef = useRef(null);
    const strokesHistoryRef = useRef([]);
    const countdownIntervalRef = useRef(null);

    // Reuse doJoin for mount, manually joining, and silent socket reconnects
    const doJoin = (code, name, userAvatar, silent = false) => {
        if (!name.trim() || !code.trim()) return;
        if (!silent) setError('');
        
        socket.emit('draw-join-room', { 
            roomCode: code.toUpperCase(), 
            playerName: name.trim(), 
            avatar: userAvatar 
        }, (response) => {
            if (response.error) {
                if (!silent) {
                    setError(response.error);
                    localStorage.removeItem('draw-session');
                }
            } else {
                setIsJoined(true);
                localStorage.setItem('draw-session', JSON.stringify({ 
                    name: name.trim(), 
                    avatar: userAvatar, 
                    roomCode: code.toUpperCase(), 
                    isJoined: true 
                }));
                
                if (response.gameState === 'PLAYING') {
                    setGameState('PLAYING');
                    setCurrentRound(response.currentRound);
                    setTotalRounds(response.totalRounds);
                    setDrawerName(response.currentDrawerName || '');
                    if (response.currentWord) {
                        setWordCategory(response.currentWord.category);
                        setWordLength(response.currentWord.wordLength);
                    }
                    setTimePerRound(response.timePerRound);
                    setIsDrawer(response.currentDrawerId === socket.id);
                    
                    if (response.hasGuessed) {
                        setHasGuessed(true);
                    }
                    if (response.myScore !== undefined) {
                        setMyScore(response.myScore);
                    }

                    if (response.canvasHistory) {
                        setTimeout(() => {
                            clearCanvas(true);
                            response.canvasHistory.forEach(s => drawStroke(s, true));
                        }, 100);
                    }
                    startTimer(response.timePerRound, response.roundStartTime);
                } else {
                    setGameState(response.gameState || 'LOBBY');
                }
            }
        });
    };

    // Load stored session & handle auto-join on mount
    useEffect(() => {
        const stored = localStorage.getItem('draw-session');
        if (stored) {
            try {
                const session = JSON.parse(stored);
                if (session.name) setPlayerName(session.name);
                if (session.avatar) setAvatar(session.avatar);

                const rc = urlRoomCode || session.roomCode;
                if (rc) setRoomCode(rc.toUpperCase());

                if (session.isJoined && rc && session.name) {
                    console.log('[DRAW] Auto-rejoining session on mount...');
                    doJoin(rc, session.name, session.avatar);
                }
            } catch { /* ignore */ }
        } else {
            if (urlRoomCode) setRoomCode(urlRoomCode.toUpperCase());
        }
    }, [urlRoomCode]);

    // Handle connection/reconnection flow (style GeoTrackr)
    useEffect(() => {
        const handleConnect = () => {
            const stored = localStorage.getItem('draw-session');
            if (stored) {
                try {
                    const session = JSON.parse(stored);
                    if (session.isJoined && session.roomCode && session.name) {
                        console.log('[DRAW] Auto-rejoining silently on socket reconnect...');
                        doJoin(session.roomCode, session.name, session.avatar, true);
                    }
                } catch { /* ignore */ }
            }
        };

        socket.on('connect', handleConnect);
        return () => {
            socket.off('connect', handleConnect);
        };
    }, []);

    useEffect(() => {
        document.body.classList.add('draw-neon');
        return () => {
            document.body.classList.remove('draw-neon');
            if (timerRef.current) clearInterval(timerRef.current);
            if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
        };
    }, []);

    // Socket listeners
    useEffect(() => {
        if (!isJoined) return;

        const handleGameStarted = (data) => {
            setGameState('PLAYING');
            setCurrentRound(data.round);
            setTotalRounds(data.totalRounds);
            setDrawerName(data.drawerName);
            setWordCategory(data.wordCategory);
            setWordLength(data.wordLength);
            setTimePerRound(data.timePerRound);
            setIsDrawer(data.drawerId === socket.id);
            setHasGuessed(false);
            setGuessResult(null);
            setMyWord(null);
            clearCanvas(true);
            
            const elapsed = Date.now() - data.roundStartTime;
            if (elapsed < 3000) {
                triggerRoundCountdown();
            }
            startTimer(data.timePerRound, data.roundStartTime);
        };

        const handleYourWord = (data) => { setMyWord(data); setIsDrawer(true); };

        const handleNextRound = (data) => {
            setGameState('PLAYING');
            setCurrentRound(data.round);
            setTotalRounds(data.totalRounds);
            setDrawerName(data.drawerName);
            setWordCategory(data.wordCategory);
            setWordLength(data.wordLength);
            setTimePerRound(data.timePerRound);
            setIsDrawer(data.drawerId === socket.id);
            setHasGuessed(false);
            setGuessResult(null);
            setMyWord(null);
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

        const handleWordSkipped = (data) => { 
            setWordCategory(data.wordCategory); 
            setWordLength(data.wordLength); 
            clearCanvas(true); 
        };

        const handleRoundEnded = (data) => {
            setGameState('ROUND_END');
            setRevealedWord(data.word);
            if (timerRef.current) clearInterval(timerRef.current);
            const me = data.results.find(p => p.id === socket.id);
            if (me) setMyScore(me.score);
            if (data.drawerLeft) {
                setError("Le dessinateur s'est déconnecté ! Passage au tour suivant...");
                setTimeout(() => setError(''), 4000);
            }
        };

        const handleGameOver = (data) => {
            setGameState('GAME_END');
            setFinalResults(data.results);
            setAwards(data.awards || []);
            if (timerRef.current) clearInterval(timerRef.current);
            const me = data.results.find(p => p.id === socket.id);
            if (me) setMyScore(me.score);
            
            // Clean draw session on game over
            const stored = localStorage.getItem('draw-session');
            if (stored) {
                try {
                    const session = JSON.parse(stored);
                    session.isJoined = false;
                    localStorage.setItem('draw-session', JSON.stringify(session));
                } catch {}
            }
        };

        const handleGameRestarted = () => {
            setGameState('LOBBY');
            setCurrentRound(0);
            setMyScore(0);
            setHasGuessed(false);
            setIsDrawer(false);
            setMyWord(null);
        };

        const handleKicked = () => { 
            setIsJoined(false); 
            setError('Vous avez été expulsé de la partie'); 
            localStorage.removeItem('draw-session');
        };

        socket.on('draw-game-started', handleGameStarted);
        socket.on('draw-your-word', handleYourWord);
        socket.on('draw-next-round', handleNextRound);
        socket.on('draw-stroke', handleStroke);
        socket.on('draw-clear', handleClear);
        socket.on('draw-undo-stroke', handleUndoStroke);
        socket.on('draw-word-skipped', handleWordSkipped);
        socket.on('draw-round-ended', handleRoundEnded);
        socket.on('draw-game-over', handleGameOver);
        socket.on('draw-game-restarted', handleGameRestarted);
        socket.on('draw-kicked', handleKicked);

        return () => {
            socket.off('draw-game-started', handleGameStarted);
            socket.off('draw-your-word', handleYourWord);
            socket.off('draw-next-round', handleNextRound);
            socket.off('draw-stroke', handleStroke);
            socket.off('draw-clear', handleClear);
            socket.off('draw-undo-stroke', handleUndoStroke);
            socket.off('draw-word-skipped', handleWordSkipped);
            socket.off('draw-round-ended', handleRoundEnded);
            socket.off('draw-game-over', handleGameOver);
            socket.off('draw-game-restarted', handleGameRestarted);
            socket.off('draw-kicked', handleKicked);
        };
    }, [isJoined, roomCode]);

    const triggerRoundCountdown = () => {
        setCountdownVal(3);
        playCountdownSound();
        
        if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
        let currentVal = 3;
        countdownIntervalRef.current = setInterval(() => {
            currentVal--;
            if (currentVal <= 0) {
                clearInterval(countdownIntervalRef.current);
                setCountdownVal(0);
            } else {
                setCountdownVal(currentVal);
                playCountdownSound();
            }
        }, 1000);
    };

    // Init canvas — ResizeObserver pour éviter le canvas étiré sur mobile
    useEffect(() => {
        if (!canvasRef.current || gameState !== 'PLAYING') return;
        const canvas = canvasRef.current;

        const initCanvas = (w, h) => {
            if (w < 10 || h < 10) return;
            const iw = Math.round(w), ih = Math.round(h);
            // Si la taille n'a pas réellement changé, ne pas réinitialiser (éviter d'effacer le canvas)
            if (canvasContextRef.current && canvas.width === iw && canvas.height === ih) return;
            canvas.width = iw;
            canvas.height = ih;
            const ctx = canvas.getContext('2d');
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.fillStyle = 'white';
            ctx.fillRect(0, 0, iw, ih);
            canvasContextRef.current = ctx;
        };

        const ro = new ResizeObserver(entries => {
            // Ne jamais réinitialiser (donc effacer) le canvas pendant un tracé en cours (mobile)
            if (isDrawingRef.current) return;
            for (const e of entries) {
                const prevW = canvas.width, prevH = canvas.height;
                initCanvas(e.contentRect.width, e.contentRect.height);
                if (canvas.width !== prevW || canvas.height !== prevH) {
                    strokesHistoryRef.current.forEach(s => drawStroke(s, false));
                }
            }
        });
        ro.observe(canvas);

        requestAnimationFrame(() => {
            const r = canvas.getBoundingClientRect();
            initCanvas(r.width, r.height);
            strokesHistoryRef.current.forEach(s => drawStroke(s, false));
        });

        return () => ro.disconnect();
    }, [gameState]);

    const startTimer = (duration, startTime) => {
        if (timerRef.current) clearInterval(timerRef.current);
        const update = () => {
            const elapsed = (Date.now() - startTime) / 1000;
            setTimer(Math.max(0, Math.ceil(duration - elapsed)));
        };
        update();
        timerRef.current = setInterval(update, 1000);
    };

    const joinRoom = () => {
        if (!playerName.trim()) { setError('Entrez votre nom'); return; }
        if (!roomCode.trim()) { setError('Entrez le code du salon'); return; }
        doJoin(roomCode, playerName, avatar);
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

    const getCanvasCoords = (e) => {
        const canvas = canvasRef.current;
        const rect = canvas.getBoundingClientRect();
        const src = e.touches ? e.touches[0] : e;
        return {
            x: (src.clientX - rect.left) / rect.width,
            y: (src.clientY - rect.top) / rect.height
        };
    };

    const handleDrawStart = (e) => {
        if (!isDrawer || countdownVal > 0) return;
        e.preventDefault();
        isDrawingRef.current = true;
        const coords = getCanvasCoords(e);
        // Trait en cours stocké dans un ref (rendu synchrone, fiable sur mobile où
        // touchmove est bien plus rapide que les re-render React).
        currentStrokeRef.current = { color: selectedColor, size: brushSize, points: [coords] };
        renderSmoothStroke(canvasContextRef.current, canvasRef.current, currentStrokeRef.current);
    };

    const handleDrawMove = (e) => {
        if (!isDrawingRef.current || !isDrawer || countdownVal > 0) return;
        e.preventDefault();
        const stroke = currentStrokeRef.current;
        if (!stroke) return;
        stroke.points.push(getCanvasCoords(e));
        renderSmoothStroke(canvasContextRef.current, canvasRef.current, stroke);
    };

    const handleDrawEnd = () => {
        if (!isDrawingRef.current || !isDrawer) return;
        isDrawingRef.current = false;
        const stroke = currentStrokeRef.current;
        currentStrokeRef.current = null;
        if (stroke && stroke.points.length > 0) {
            const strokeId = `${socket.id || 'p'}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
            stroke.id = strokeId;
            if (drawnStrokeIdsRef.current) drawnStrokeIdsRef.current.add(strokeId);
            strokesHistoryRef.current.push(stroke);
            socket.emit('draw-stroke', { roomCode, stroke });

            // Re-render final smooth stroke
            renderSmoothStroke(canvasContextRef.current, canvasRef.current, stroke);
        }
    };

    const handleClearCanvas = () => { 
        clearCanvas(true); 
        socket.emit('draw-clear', { roomCode }); 
    };

    const handleUndo = () => {
        if (!isDrawer) return;
        if (strokesHistoryRef.current.length > 0) {
            strokesHistoryRef.current.pop();
            clearCanvas(false);
            strokesHistoryRef.current.forEach(s => drawStroke(s, false));
            socket.emit('draw-undo', { roomCode });
        }
    };

    const handleSkipWord = () => {
        socket.emit('draw-skip-word', { roomCode }, (r) => {
            if (r.success) { 
                setMyWord({ word: r.word, category: r.category, hint: r.hint }); 
                clearCanvas(true); 
            }
        });
    };

    const submitGuess = () => {
        if (!guess.trim() || hasGuessed || countdownVal > 0) return;
        socket.emit('draw-submit-guess', { roomCode, guess: guess.trim() }, (r) => {
            if (r.correct) {
                setHasGuessed(true);
                setGuessResult({ correct: true, points: r.points, rank: r.rank });
                setMyScore(prev => prev + r.points);
                playSuccessSound();
                
                // Update score in local storage
                const stored = localStorage.getItem('draw-session');
                if (stored) {
                    try {
                        const session = JSON.parse(stored);
                        session.myScore = myScore + r.points;
                        localStorage.setItem('draw-session', JSON.stringify(session));
                    } catch {}
                }
            } else if (r.closeMatch) {
                setGuessResult({ closeMatch: true, message: r.message });
                setShakeGuess(true);
                setTimeout(() => { setShakeGuess(false); setGuessResult(null); }, 1500);
            }
            setGuess('');
        });
    };

    const timerPct = timePerRound > 0 ? (timer / timePerRound) * 100 : 0;
    const timerClass = timer <= 10 ? 'timer-danger' : timer <= 30 ? 'timer-warning' : '';
    const timerFill = timer <= 10 ? 'dr-timer-low' : timer <= 30 ? 'dr-timer-mid' : 'dr-timer-ok';

    // ── JOIN ──────────────────────────────────────────────────────────
    if (!isJoined) {
        return (
            <div className="dr-app h-svh flex flex-col overflow-hidden"
                style={{ paddingTop: 'max(env(safe-area-inset-top), 10px)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
                <span className="dr-orb dr-orb-v" /><span className="dr-orb dr-orb-m" />

                <div className="flex-1 min-h-0 w-full max-w-sm mx-auto flex flex-col px-5 pt-3 pb-3 gap-3 dr-fade-up">
                    {/* Logo (compact, une ligne) */}
                    <div className="flex-shrink-0 flex items-center justify-center gap-3 pt-1">
                        <div className="dr-logo-mark w-11 h-11">
                            <span className="material-symbols-outlined text-2xl">stylus_note</span>
                        </div>
                        <div>
                            <h1 className="dr-h text-2xl leading-none">DRAW <span className="dr-grad-text">ME</span></h1>
                            <p className="dr-eyebrow mt-1">Rejoindre une partie</p>
                        </div>
                    </div>

                    {error && (
                        <div className="flex-shrink-0 dr-card-2 p-3 text-center text-sm font-semibold text-[color:var(--dr-red)] dr-pop"
                            style={{ borderColor: 'rgba(251,85,112,0.4)', background: 'rgba(251,85,112,0.1)' }}>
                            {error}
                        </div>
                    )}

                    {/* Code + pseudo */}
                    <div className="flex-shrink-0 dr-card p-4 flex flex-col gap-3">
                        <div className="flex flex-col gap-1.5">
                            <label className="dr-eyebrow">Code du salon</label>
                            <input
                                type="text"
                                className="dr-input dr-mono text-center text-xl uppercase tracking-[0.3em] py-2.5"
                                placeholder="ABCDE1"
                                value={roomCode}
                                onChange={(e) => !urlRoomCode && setRoomCode(e.target.value.toUpperCase())}
                                maxLength={6}
                                readOnly={!!urlRoomCode}
                            />
                        </div>
                        <div className="flex flex-col gap-1.5">
                            <label className="dr-eyebrow">Ton pseudo</label>
                            <input
                                type="text"
                                className="dr-input text-sm py-2.5"
                                placeholder="Picasso"
                                value={playerName}
                                onChange={(e) => setPlayerName(e.target.value)}
                                maxLength={20}
                                onKeyDown={(e) => e.key === 'Enter' && joinRoom()}
                            />
                        </div>
                    </div>

                    {/* Avatars — seule zone qui défile (interne), la page ne scrolle jamais */}
                    <div className="flex-1 min-h-0 flex flex-col gap-1.5">
                        <label className="dr-eyebrow flex-shrink-0 flex items-center justify-between">
                            <span>Choisis ton avatar</span>
                            <span className="w-6 h-6 dr-ava dr-ava-ring">
                                <img src={avatar} alt="" className="w-full h-full object-cover" />
                            </span>
                        </label>
                        <div className="dr-scroll flex-1 min-h-0 overflow-y-auto grid grid-cols-5 gap-2 content-start p-0.5">
                            {ALL_AVATARS.slice(0, 30).map((url) => (
                                <button
                                    key={url}
                                    type="button"
                                    onClick={() => setAvatar(url)}
                                    className={`aspect-square dr-ava ${avatar === url ? 'active' : ''}`}
                                    aria-label="Choisir cet avatar"
                                    style={{ width: '100%', height: 'auto' }}
                                >
                                    <img src={url} alt="" className="w-full h-full object-cover" />
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Actions (toujours visibles) */}
                    <button onClick={joinRoom} className="flex-shrink-0 dr-btn dr-btn-primary w-full py-3 text-base">
                        <span className="material-symbols-outlined text-lg">bolt</span>
                        Rejoindre la partie
                    </button>
                    <button onClick={() => navigate('/draw')} className="flex-shrink-0 dr-btn dr-btn-ghost py-2 text-sm mx-auto">
                        <span className="material-symbols-outlined text-base">arrow_back</span> Retour
                    </button>
                </div>
            </div>
        );
    }

    // ── LOBBY ─────────────────────────────────────────────────────────
    if (gameState === 'LOBBY') {
        return (
            <div className="dr-app min-h-svh flex items-center justify-center p-6 overflow-hidden">
                <span className="dr-orb dr-orb-v" /><span className="dr-orb dr-orb-m" /><span className="dr-orb dr-orb-c" />

                <div className="flex flex-col items-center gap-6 max-w-xs w-full dr-fade-up">
                    <div className="w-28 h-28 dr-ava dr-ava-ring">
                        <img src={avatar} alt="" className="w-full h-full object-cover" />
                    </div>
                    <div className="text-center">
                        <h2 className="dr-h text-3xl">{playerName}</h2>
                        <div className="dr-pill dr-pill-violet mt-3">
                            <span className="material-symbols-outlined text-sm">tag</span>
                            <span className="dr-mono tracking-widest">{roomCode}</span>
                        </div>
                    </div>
                    <div className="dr-card w-full p-7 flex flex-col items-center gap-3">
                        <div className="flex gap-1.5">
                            <span className="w-2.5 h-2.5 rounded-full bg-[color:var(--dr-violet)] animate-bounce" style={{ animationDelay: '0ms' }} />
                            <span className="w-2.5 h-2.5 rounded-full bg-[color:var(--dr-magenta)] animate-bounce" style={{ animationDelay: '150ms' }} />
                            <span className="w-2.5 h-2.5 rounded-full bg-[color:var(--dr-cyan)] animate-bounce" style={{ animationDelay: '300ms' }} />
                        </div>
                        <p className="dr-h text-base text-center">En attente du lancement…</p>
                        <p className="text-xs text-[color:var(--dr-muted)] text-center">L'hôte va bientôt démarrer la partie.</p>
                    </div>
                </div>
            </div>
        );
    }

    // ── PLAYING — DESSINATEUR ─────────────────────────────────────────
    if (gameState === 'PLAYING' && isDrawer) {
        return (
            <div className="dr-app h-svh flex flex-col overflow-hidden relative"
                style={{ paddingTop: 'max(env(safe-area-inset-top), 10px)', paddingBottom: 'env(safe-area-inset-bottom)' }}>

                {countdownVal > 0 && (
                    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-[#08080F]/85 backdrop-blur-md">
                        <div key={countdownVal} className="dr-countdown text-[7rem] leading-none">{countdownVal}</div>
                        <div className="dr-h text-lg mt-3 text-[color:var(--dr-muted)]">Prépare-toi à dessiner !</div>
                    </div>
                )}

                {/* Header — timer */}
                <div className="flex items-center gap-3 px-4 py-2.5 flex-shrink-0 border-b border-[color:var(--dr-line)]">
                    <div className={`dr-mono font-bold text-2xl ${timerClass} text-[color:var(--dr-text)]`}>{timer}</div>
                    <div className="flex-1 dr-timer-track">
                        <div className={`dr-timer-fill ${timerFill}`} style={{ width: `${timerPct}%` }} />
                    </div>
                    <div className="dr-pill dr-pill-violet"><span className="dr-mono">{currentRound}/{totalRounds}</span></div>
                </div>

                {/* Word banner */}
                {myWord && (
                    <div className="dr-pop mx-3 mt-3 flex-shrink-0 flex items-center justify-between gap-3 rounded-2xl p-3.5"
                        style={{ background: 'var(--dr-grad)', boxShadow: 'var(--dr-glow-v)' }}>
                        <div className="min-w-0">
                            <div className="dr-eyebrow text-white/85">À toi de dessiner</div>
                            <div className="dr-h text-2xl text-white truncate">{myWord.word}</div>
                            {myWord.hint && (
                                <div className="text-[11px] text-white/85 font-medium flex items-center gap-1 mt-0.5">
                                    <span className="material-symbols-outlined text-sm">lightbulb</span>{myWord.hint}
                                </div>
                            )}
                        </div>
                        <button onClick={handleSkipWord}
                            className="dr-btn dr-btn-ghost flex-shrink-0 text-xs py-2 px-3"
                            style={{ background: 'rgba(255,255,255,0.16)', borderColor: 'rgba(255,255,255,0.35)', color: '#fff' }}>
                            <span className="material-symbols-outlined text-base">refresh</span> Passer
                        </button>
                    </div>
                )}

                {/* Canvas */}
                <div className="flex-1 min-h-0 flex items-center justify-center p-3 relative">
                    <div className="canvas-container-4-3">
                        <canvas
                            ref={canvasRef}
                            className="draw-canvas"
                            onMouseDown={handleDrawStart}
                            onMouseMove={handleDrawMove}
                            onMouseUp={handleDrawEnd}
                            onMouseLeave={handleDrawEnd}
                            onTouchStart={handleDrawStart}
                            onTouchMove={handleDrawMove}
                            onTouchEnd={handleDrawEnd}
                        />
                    </div>
                </div>

                {/* Tools */}
                <div className="flex-shrink-0 px-3 pb-3 flex flex-col gap-2.5">
                    {/* Colors */}
                    <div className="dr-card-2 p-2.5 grid grid-cols-9 gap-1.5">
                        {COLORS.map(c => {
                            const isSel = selectedColor === c.value && !isEraser;
                            return (
                                <button
                                    key={c.value}
                                    onClick={() => { setSelectedColor(c.value); setIsEraser(false); }}
                                    className="aspect-square rounded-full transition-transform duration-100"
                                    style={{
                                        backgroundColor: c.value,
                                        transform: isSel ? 'scale(1.18)' : undefined,
                                        border: c.value === '#ffffff' ? '1px solid #ccc' : '1px solid rgba(0,0,0,0.2)',
                                        boxShadow: isSel ? '0 0 0 2px #fff, 0 0 14px rgba(255,255,255,0.7)' : undefined,
                                    }}
                                    aria-label={c.name}
                                    title={c.name}
                                />
                            );
                        })}
                    </div>

                    {/* Sizes + actions */}
                    <div className="dr-card-2 p-2 flex items-center justify-center gap-2">
                        {BRUSH_SIZES.map(size => (
                            <button
                                key={size}
                                onClick={() => { setBrushSize(size); setIsEraser(false); }}
                                className={`dr-icon-btn ${brushSize === size && !isEraser ? 'active' : ''}`}
                                aria-label={`Taille ${size}`}
                            >
                                <div className="rounded-full bg-current"
                                    style={{ width: Math.min(size * 0.7, 20), height: Math.min(size * 0.7, 20) }} />
                            </button>
                        ))}
                        <div className="w-px h-6 bg-[color:var(--dr-line-2)]" />
                        <button
                            onClick={() => {
                                const nextEraser = !isEraser;
                                setIsEraser(nextEraser);
                                if (nextEraser) {
                                    setSelectedColor('#ffffff');
                                    setBrushSize(30);
                                } else {
                                    setSelectedColor('#000000');
                                    setBrushSize(8);
                                }
                            }}
                            className={`dr-icon-btn ${isEraser ? 'active' : ''}`}
                            aria-label="Gomme"
                        >
                            <span className="material-symbols-outlined text-lg">ink_eraser</span>
                        </button>
                        <button
                            onClick={handleUndo}
                            disabled={strokesHistoryRef.current.length === 0}
                            className="dr-icon-btn"
                            aria-label="Annuler"
                        >
                            <span className="material-symbols-outlined text-lg">undo</span>
                        </button>
                        <button
                            onClick={handleClearCanvas}
                            className="dr-icon-btn"
                            aria-label="Tout effacer"
                            style={{ color: 'var(--dr-red)', borderColor: 'rgba(251,85,112,0.4)' }}
                        >
                            <span className="material-symbols-outlined text-lg">delete</span>
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // ── PLAYING — DEVINEUR ────────────────────────────────────────────
    if (gameState === 'PLAYING' && !isDrawer) {
        return (
            <div className="dr-app h-svh flex flex-col overflow-hidden relative"
                style={{ paddingTop: 'max(env(safe-area-inset-top), 10px)', paddingBottom: 'env(safe-area-inset-bottom)' }}>

                {countdownVal > 0 && (
                    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-[#08080F]/85 backdrop-blur-md">
                        <div key={countdownVal} className="dr-countdown text-[7rem] leading-none">{countdownVal}</div>
                        <div className="dr-h text-lg mt-3 text-[color:var(--dr-muted)]">Prépare-toi à deviner !</div>
                    </div>
                )}

                {/* Header — timer + score */}
                <div className="flex items-center gap-3 px-4 py-2.5 flex-shrink-0 border-b border-[color:var(--dr-line)]">
                    <div className={`dr-mono font-bold text-xl ${timerClass} text-[color:var(--dr-text)]`}>{timer}</div>
                    <div className="flex-1 dr-timer-track">
                        <div className={`dr-timer-fill ${timerFill}`} style={{ width: `${timerPct}%` }} />
                    </div>
                    <div className="dr-pill dr-pill-violet"><span className="dr-mono">{currentRound}/{totalRounds}</span></div>
                    <div className="dr-mono font-bold text-sm text-[color:var(--dr-lime)]">{myScore}</div>
                </div>

                {/* Drawer info + word blanks */}
                <div className="flex flex-col items-center gap-2 px-4 py-3 flex-shrink-0 bg-[rgba(139,92,246,0.06)] border-b border-[color:var(--dr-line)]">
                    <div className="text-xs text-[color:var(--dr-muted)] flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-sm text-[color:var(--dr-violet-lt)]">stylus_note</span>
                        <span className="dr-h text-sm text-[color:var(--dr-text)]">{drawerName}</span> dessine…
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap justify-center">
                        <span className="dr-pill dr-pill-cyan">{wordCategory}</span>
                        {Array.from({ length: wordLength }).map((_, i) => (
                            <div key={i} className="dr-blank" />
                        ))}
                        <span className="dr-mono text-[11px] text-[color:var(--dr-dim)]">{wordLength}</span>
                    </div>
                </div>

                {/* Canvas + réponse regroupés et centrés (évite le grand vide en portrait) */}
                <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-3 px-3 py-3 relative">
                    <div className={`canvas-container-4-3 draw-canvas-viewer w-full ${hasGuessed ? 'opacity-90' : ''}`}>
                        <canvas ref={canvasRef} className="draw-canvas" />
                        {hasGuessed && (
                            <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#08080F]/80 backdrop-blur-sm dr-pop">
                                <span className="material-symbols-outlined text-6xl text-[color:var(--dr-lime)] mb-1" style={{ fontVariationSettings: "'FILL' 1", filter: 'drop-shadow(0 0 16px rgba(74,222,128,0.6))' }}>check_circle</span>
                                <h3 className="dr-h text-3xl dr-glow-lime">Bravo !</h3>
                                <div className="dr-pill dr-pill-lime mt-2 text-sm">
                                    +{guessResult?.points} pts · #{guessResult?.rank}
                                </div>
                            </div>
                        )}
                    </div>

                    {!hasGuessed && (
                        <div className="w-full flex-shrink-0">
                            {guessResult?.closeMatch && (
                                <div className="text-center text-[11px] font-bold text-[color:var(--dr-amber)] mb-1.5 flex items-center justify-center gap-1 dr-slide-in">
                                    <span className="material-symbols-outlined text-sm">local_fire_department</span> Très proche ! Vérifie l'orthographe
                                </div>
                            )}
                            <div className={`flex gap-2 ${shakeGuess ? 'shake-input' : ''}`}>
                                <input
                                    ref={guessInputRef}
                                    type="text"
                                    className="dr-input flex-1 text-base"
                                    placeholder="Tape ta réponse…"
                                    value={guess}
                                    onChange={(e) => setGuess(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && submitGuess()}
                                    disabled={hasGuessed || countdownVal > 0}
                                    autoComplete="off"
                                    style={shakeGuess ? { borderColor: 'var(--dr-amber)' } : undefined}
                                />
                                <button
                                    onClick={submitGuess}
                                    disabled={hasGuessed || !guess.trim() || countdownVal > 0}
                                    className="dr-btn dr-btn-primary px-5"
                                    aria-label="Valider ma réponse"
                                >
                                    <span className="material-symbols-outlined text-lg" style={{ fontVariationSettings: "'FILL' 1" }}>send</span>
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // ── ROUND END ─────────────────────────────────────────────────────
    if (gameState === 'ROUND_END') {
        return (
            <div className="dr-app min-h-svh flex items-center justify-center p-6 overflow-hidden">
                <span className="dr-orb dr-orb-v" /><span className="dr-orb dr-orb-m" />
                <div className="w-full max-w-xs flex flex-col items-center gap-5 dr-fade-up">
                    <div className="dr-card dr-card-glow w-full p-6 text-center">
                        <div className="dr-eyebrow">Le mot était</div>
                        <h2 className="dr-h text-4xl dr-grad-text mt-1.5">{revealedWord?.word}</h2>
                    </div>
                    <div className="dr-card w-full p-6 text-center">
                        <div className="dr-eyebrow">Ton score</div>
                        <div className="dr-mono text-6xl font-bold text-[color:var(--dr-text)] mt-1">{myScore}</div>
                        <div className="text-xs text-[color:var(--dr-muted)] mt-1">points</div>
                    </div>
                    <p className="dr-eyebrow flex items-center gap-1.5 mt-1">
                        <span className="material-symbols-outlined text-sm animate-spin" style={{ animationDuration: '2s' }}>progress_activity</span>
                        Prochain tour bientôt
                    </p>
                </div>
            </div>
        );
    }

    // ── GAME END ──────────────────────────────────────────────────────
    if (gameState === 'GAME_END') {
        const myRank = finalResults.findIndex(p => p.id === socket.id) + 1;
        const winner = finalResults[0];
        const medals = ['🥇', '🥈', '🥉'];
        const rankColor = myRank === 1 ? 'var(--dr-amber)' : myRank === 2 ? 'var(--dr-cyan)' : myRank === 3 ? 'var(--dr-magenta)' : 'var(--dr-violet)';

        return (
            <div className="dr-app min-h-svh flex items-center justify-center p-6 overflow-y-auto overflow-x-hidden"
                style={{ paddingTop: 'calc(env(safe-area-inset-top) + 20px)', paddingBottom: 'calc(env(safe-area-inset-bottom) + 20px)' }}>
                <span className="dr-orb dr-orb-v" /><span className="dr-orb dr-orb-m" /><span className="dr-orb dr-orb-c" />

                <div className="w-full max-w-xs flex flex-col gap-4 dr-fade-up">
                    {/* My result */}
                    <div className="dr-card dr-card-glow p-6 text-center dr-pop" style={{ borderColor: rankColor }}>
                        <div className="text-5xl mb-1">{medals[myRank - 1] || '🎨'}</div>
                        <h2 className="dr-h text-2xl" style={{ color: rankColor }}>
                            {myRank === 1 ? 'Victoire !' : `${myRank}ᵉ place`}
                        </h2>
                        <div className="dr-mono text-4xl font-bold text-[color:var(--dr-text)] mt-1">{myScore}<span className="text-lg text-[color:var(--dr-muted)] ml-1">pts</span></div>
                        {myRank !== 1 && (
                            <div className="text-xs text-[color:var(--dr-muted)] mt-2">
                                Vainqueur : <span className="dr-h text-xs dr-grad-text">{winner?.name}</span>
                            </div>
                        )}
                    </div>

                    {/* Full ranking */}
                    <div className="dr-card p-4">
                        <div className="dr-eyebrow mb-3">Classement final</div>
                        <div className="flex flex-col gap-1.5">
                            {finalResults.map((p, i) => {
                                const me = p.id === socket.id;
                                return (
                                    <div key={p.id} className={`flex items-center gap-2.5 p-2 rounded-xl text-sm dr-slide-in ${me ? 'dr-card-2' : ''}`}
                                        style={{ animationDelay: `${i * 40}ms`, ...(me ? { borderColor: 'rgba(139,92,246,0.5)', background: 'rgba(139,92,246,0.12)' } : {}) }}>
                                        <span className="dr-mono w-7 text-center font-bold text-[color:var(--dr-muted)]">{medals[i] || `${i + 1}`}</span>
                                        <span className={`flex-1 truncate ${me ? 'dr-h text-sm' : 'font-medium text-[color:var(--dr-text)]'}`}>{p.name}</span>
                                        <span className="dr-mono font-bold text-[color:var(--dr-lime)]">{p.score}</span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Awards */}
                    {awards.length > 0 && (
                        <div className="grid grid-cols-2 gap-2.5">
                            {awards.map((a, i) => (
                                <div key={i} className="dr-card-2 p-3 text-center">
                                    <div className="text-2xl mb-1">{a.icon}</div>
                                    <div className="dr-eyebrow text-[color:var(--dr-violet-lt)]">{a.title}</div>
                                    <div className="text-xs font-semibold text-[color:var(--dr-text)] truncate mt-0.5">{a.playerName}</div>
                                </div>
                            ))}
                        </div>
                    )}

                    <button onClick={() => navigate('/')} className="dr-btn dr-btn-primary w-full py-3.5">
                        <span className="material-symbols-outlined text-lg">home</span> Retour au menu
                    </button>
                </div>
            </div>
        );
    }

    return null;
}

export default DrawPlayerView;
