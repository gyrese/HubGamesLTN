import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { socket } from '../../socket';
import { playCountdownSound, playSuccessSound, playFailSound, playWinnerSound } from '../../utils/audio';
import { BRUSHES, renderStroke, renderAction, createSurface } from './drawEngine';
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
    // Outil courant : une des brosses de drawEngine, 'fill' (pot) ou 'eraser'.
    // La gomme est un outil à part entière et n'écrase plus la couleur choisie :
    // on la quitte en retrouvant sa couleur et sa taille.
    const [tool, setTool] = useState('pen');
    const isEraser = tool === 'eraser';
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
    // Traits en cours reçus des autres (id → stroke), rendus avant leur validation finale
    const liveStrokesRef = useRef(new Map());
    // Émission throttlée du trait en cours quand c'est nous qui dessinons
    const liveSentCountRef = useRef(0);
    const lastLiveEmitRef = useRef(0);
    const liveEmitTimerRef = useRef(null);

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
            if (liveEmitTimerRef.current) clearTimeout(liveEmitTimerRef.current);
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

        const handleStroke = (stroke) => {
            // Le trait est finalisé : on abandonne sa version "en cours"
            if (stroke && stroke.id) liveStrokesRef.current.delete(stroke.id);
            drawStroke(stroke, true);
        };
        const handleLiveStroke = (data) => applyLiveStroke(data);
        const handleClear = () => clearCanvas(true);

        const handleUndoStroke = () => {
            strokesHistoryRef.current.pop();
            redrawAll();
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
        socket.on('draw-stroke-live', handleLiveStroke);
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
            socket.off('draw-stroke-live', handleLiveStroke);
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
            // La surface de base suit la taille du canvas visible ; l'appelant
            // rejoue l'historique dessus juste après (redrawAll).
            baseRef.current = createSurface(iw, ih);
        };

        const ro = new ResizeObserver(entries => {
            // Ne jamais réinitialiser (donc effacer) le canvas pendant un tracé en cours (mobile)
            if (isDrawingRef.current) return;
            for (const e of entries) {
                const prevW = canvas.width, prevH = canvas.height;
                initCanvas(e.contentRect.width, e.contentRect.height);
                if (canvas.width !== prevW || canvas.height !== prevH) {
                    redrawAll();
                }
            }
        });
        ro.observe(canvas);

        requestAnimationFrame(() => {
            const r = canvas.getBoundingClientRect();
            initCanvas(r.width, r.height);
            redrawAll();
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

    // ─── Pipeline de rendu ────────────────────────────────────────────
    // Deux surfaces : `base` (hors écran) porte les traits validés et les coups de
    // pot ; le canvas visible est recomposé à partir d'elle, plus les traits en
    // cours. Un trait en cours est ainsi toujours redessiné d'une seule passe sur
    // une surface vierge — sinon le halo du néon s'accumulerait à chaque point
    // ajouté et l'écran du dessinateur divergerait de celui de l'hôte.
    const baseRef = useRef(null);
    const composeFrameRef = useRef(null);

    const compose = () => {
        composeFrameRef.current = null;
        const ctx = canvasContextRef.current;
        const canvas = canvasRef.current;
        const base = baseRef.current;
        if (!ctx || !canvas || !base) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(base.canvas, 0, 0);
        liveStrokesRef.current.forEach(s => renderStroke(ctx, s));
        if (currentStrokeRef.current) renderStroke(ctx, currentStrokeRef.current);
    };

    // Au plus une recomposition par frame : touchmove tire bien plus vite que ça.
    const scheduleCompose = () => {
        if (composeFrameRef.current) return;
        composeFrameRef.current = requestAnimationFrame(compose);
    };

    // Rejoue tout l'historique sur la surface de base (démarrage, redimensionnement,
    // annulation). Les remplissages en dépendent : ils doivent revoir les traits
    // qui les bornaient, dans le même ordre.
    const rebuildBase = () => {
        const base = baseRef.current;
        if (!base) return;
        base.ctx.fillStyle = 'white';
        base.ctx.fillRect(0, 0, base.canvas.width, base.canvas.height);
        strokesHistoryRef.current.forEach(a => renderAction(base.ctx, a));
    };

    // Valide une action (trait ou remplissage) : elle passe dans la surface de base.
    const drawStroke = (action, saveToHistory = true) => {
        if (!action) return;
        if (saveToHistory) {
            const actionId = action.id || (action.points && action.points.length > 0 ? `${action.points.length}_${action.points[0].x}_${action.points[0].y}` : null);
            if (actionId) {
                if (drawnStrokeIdsRef.current.has(actionId)) return;
                drawnStrokeIdsRef.current.add(actionId);
            }
            strokesHistoryRef.current.push(action);
        }
        if (action.id) liveStrokesRef.current.delete(action.id);
        // Canvas pas encore dimensionné (historique reçu à la reconnexion, avant
        // le premier layout) : l'action est déjà dans l'historique, redrawAll la
        // rejouera dès l'initialisation.
        if (!baseRef.current) return;
        renderAction(baseRef.current.ctx, action);
        scheduleCompose();
    };

    // Trait en cours d'un autre joueur : on accumule les points reçus, la
    // recomposition se charge de l'afficher.
    const applyLiveStroke = (data) => {
        if (!data || !data.id || !Array.isArray(data.points) || data.points.length === 0) return;
        if (drawnStrokeIdsRef.current.has(data.id)) return; // trait déjà finalisé
        const existing = liveStrokesRef.current.get(data.id);
        const stroke = existing || { id: data.id, color: data.color, size: data.size, brush: data.brush, points: [] };
        stroke.points.push(...data.points);
        if (!existing) liveStrokesRef.current.set(data.id, stroke);
        scheduleCompose();
    };

    const redrawAll = () => {
        rebuildBase();
        scheduleCompose();
    };

    const clearCanvas = (clearHistory = true) => {
        if (clearHistory) {
            strokesHistoryRef.current = [];
            drawnStrokeIdsRef.current.clear();
            liveStrokesRef.current.clear();
        }
        rebuildBase();
        scheduleCompose();
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

    // Envoi des points du trait en cours (~16/s) pour que les autres voient le
    // dessin se tracer sans attendre le lever de doigt.
    const LIVE_EMIT_INTERVAL = 60; // ms

    const flushLiveStroke = (force = false) => {
        const stroke = currentStrokeRef.current;
        if (!stroke || !stroke.id) return;
        if (stroke.points.length <= liveSentCountRef.current) return;

        const now = Date.now();
        const elapsed = now - lastLiveEmitRef.current;
        if (!force && elapsed < LIVE_EMIT_INTERVAL) {
            // Programme un envoi différé pour ne pas perdre les derniers points
            if (!liveEmitTimerRef.current) {
                liveEmitTimerRef.current = setTimeout(() => {
                    liveEmitTimerRef.current = null;
                    flushLiveStroke(true);
                }, LIVE_EMIT_INTERVAL - elapsed);
            }
            return;
        }

        if (liveEmitTimerRef.current) {
            clearTimeout(liveEmitTimerRef.current);
            liveEmitTimerRef.current = null;
        }

        const points = stroke.points.slice(liveSentCountRef.current);
        liveSentCountRef.current = stroke.points.length;
        lastLiveEmitRef.current = now;
        socket.emit('draw-stroke-live', {
            roomCode,
            id: stroke.id,
            color: stroke.color,
            size: stroke.size,
            brush: stroke.brush,
            points
        });
    };

    const newActionId = () => `${socket.id || 'p'}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

    const handleDrawStart = (e) => {
        if (!isDrawer || countdownVal > 0) return;
        e.preventDefault();
        const coords = getCanvasCoords(e);

        // Pot de peinture : action ponctuelle, rien à tracer. Elle emprunte
        // 'draw-stroke' comme les traits — le serveur la stocke et la relaie sans
        // l'interpréter, donc annulation et reconnexion marchent sans code dédié.
        if (tool === 'fill') {
            const action = { id: newActionId(), type: 'fill', color: selectedColor, point: coords };
            drawStroke(action, true);
            socket.emit('draw-stroke', { roomCode, stroke: action });
            return;
        }

        isDrawingRef.current = true;
        // Trait en cours stocké dans un ref (rendu synchrone, fiable sur mobile où
        // touchmove est bien plus rapide que les re-render React).
        // L'id est généré dès le début : il identifie le trait pendant le streaming
        // puis lors de sa validation finale.
        currentStrokeRef.current = {
            id: newActionId(),
            color: isEraser ? '#ffffff' : selectedColor,
            size: isEraser ? Math.max(brushSize, 30) : brushSize,
            brush: isEraser ? 'pen' : tool,
            points: [coords]
        };
        liveSentCountRef.current = 0;
        lastLiveEmitRef.current = 0;
        scheduleCompose();
        flushLiveStroke(true);
    };

    const handleDrawMove = (e) => {
        if (!isDrawingRef.current || !isDrawer || countdownVal > 0) return;
        e.preventDefault();
        const stroke = currentStrokeRef.current;
        if (!stroke) return;
        stroke.points.push(getCanvasCoords(e));
        scheduleCompose();
        flushLiveStroke();
    };

    const handleDrawEnd = () => {
        if (!isDrawingRef.current || !isDrawer) return;
        isDrawingRef.current = false;
        const stroke = currentStrokeRef.current;
        currentStrokeRef.current = null;
        if (liveEmitTimerRef.current) {
            clearTimeout(liveEmitTimerRef.current);
            liveEmitTimerRef.current = null;
        }
        liveSentCountRef.current = 0;
        if (stroke && stroke.points.length > 0) {
            // Le trait quitte la couche « en cours » pour la surface de base.
            drawStroke(stroke, true);
            socket.emit('draw-stroke', { roomCode, stroke });
        } else {
            scheduleCompose();
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
            redrawAll();
            socket.emit('draw-undo', { roomCode });
        }
    };

    const handleSkipWord = () => {
        socket.emit('draw-skip-word', { roomCode }, (r) => {
            if (r.success) { 
                setMyWord({ word: r.word, category: r.category, hint: r.hint }); 
                clearCanvas(true);
                if (r.myScore !== undefined) {
                    setMyScore(r.myScore);
                    const stored = localStorage.getItem('draw-session');
                    if (stored) {
                        try {
                            const session = JSON.parse(stored);
                            session.myScore = r.myScore;
                            localStorage.setItem('draw-session', JSON.stringify(session));
                        } catch {}
                    }
                }
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
            <div className="dr-app min-h-[100dvh] flex flex-col justify-between overflow-y-auto"
                style={{
                    paddingTop: 'max(env(safe-area-inset-top), 16px)',
                    paddingBottom: 'max(env(safe-area-inset-bottom), 16px)',
                    paddingLeft: 'max(env(safe-area-inset-left), 16px)',
                    paddingRight: 'max(env(safe-area-inset-right), 16px)'
                }}>
                <span className="dr-orb dr-orb-v" /><span className="dr-orb dr-orb-m" />

                <div className="w-full max-w-sm mx-auto flex flex-col gap-3.5 dr-fade-up my-auto py-2">
                    {/* Logo */}
                    <div className="flex-shrink-0 flex items-center justify-center gap-3">
                        <div className="dr-logo-mark w-11 h-11">
                            <span className="material-symbols-outlined text-2xl">stylus_note</span>
                        </div>
                        <div>
                            <h1 className="dr-h text-2xl leading-none">DRAW <span className="dr-grad-text">ME</span></h1>
                            <p className="dr-eyebrow mt-1">Rejoindre une partie</p>
                        </div>
                    </div>

                    {error && (
                        <div className="dr-card-2 p-3 text-center text-sm font-semibold text-[color:var(--dr-red)] dr-pop"
                            style={{ borderColor: 'rgba(251,85,112,0.4)', background: 'rgba(251,85,112,0.1)' }}>
                            {error}
                        </div>
                    )}

                    {/* Code + pseudo */}
                    <div className="dr-card p-4 flex flex-col gap-3">
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

                    {/* Avatars */}
                    <div className="flex flex-col gap-1.5">
                        <label className="dr-eyebrow flex items-center justify-between">
                            <span>Choisis ton avatar</span>
                            <span className="w-6 h-6 dr-ava dr-ava-ring">
                                <img src={avatar} alt="" className="w-full h-full object-cover" />
                            </span>
                        </label>
                        <div className="dr-scroll max-h-40 overflow-y-auto grid grid-cols-5 gap-2 p-1.5 dr-card-2">
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

                    {/* Actions */}
                    <div className="flex flex-col gap-2 pt-1">
                        <button onClick={joinRoom} className="dr-btn dr-btn-primary w-full py-3 text-base">
                            <span className="material-symbols-outlined text-lg">bolt</span>
                            Rejoindre la partie
                        </button>
                        <button onClick={() => navigate('/draw')} className="dr-btn dr-btn-ghost py-2 text-sm mx-auto">
                            <span className="material-symbols-outlined text-base">arrow_back</span> Retour
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // ── LOBBY ─────────────────────────────────────────────────────────
    if (gameState === 'LOBBY') {
        return (
            <div className="dr-app min-h-[100dvh] flex items-center justify-center p-4 overflow-y-auto"
                style={{
                    paddingTop: 'max(env(safe-area-inset-top), 20px)',
                    paddingBottom: 'max(env(safe-area-inset-bottom), 20px)',
                    paddingLeft: 'max(env(safe-area-inset-left), 16px)',
                    paddingRight: 'max(env(safe-area-inset-right), 16px)'
                }}>
                <span className="dr-orb dr-orb-v" /><span className="dr-orb dr-orb-m" /><span className="dr-orb dr-orb-c" />

                <div className="flex flex-col items-center gap-5 max-w-xs w-full dr-fade-up my-auto">
                    <div className="w-24 h-24 dr-ava dr-ava-ring">
                        <img src={avatar} alt="" className="w-full h-full object-cover" />
                    </div>
                    <div className="text-center">
                        <h2 className="dr-h text-2xl">{playerName}</h2>
                        <div className="dr-pill dr-pill-violet mt-2">
                            <span className="material-symbols-outlined text-sm">tag</span>
                            <span className="dr-mono tracking-widest">{roomCode}</span>
                        </div>
                    </div>
                    <div className="dr-card w-full p-5 flex flex-col items-center gap-2.5">
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
            <div className="dr-app h-[100dvh] max-h-[100dvh] flex flex-col overflow-hidden relative"
                style={{
                    paddingTop: 'max(env(safe-area-inset-top), 6px)',
                    paddingBottom: 'max(env(safe-area-inset-bottom), 6px)',
                    paddingLeft: 'max(env(safe-area-inset-left), 8px)',
                    paddingRight: 'max(env(safe-area-inset-right), 8px)'
                }}>

                {countdownVal > 0 && (
                    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-[#08080F]/90 backdrop-blur-md">
                        <div key={countdownVal} className="dr-countdown text-[6rem] leading-none">{countdownVal}</div>
                        <div className="dr-h text-base mt-2 text-[color:var(--dr-muted)]">Prépare-toi à dessiner !</div>
                    </div>
                )}

                {/* Top Bar: Timer & Word Banner Combined */}
                <div className="flex items-center justify-between gap-2 px-1 py-1 flex-shrink-0">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                        <div className={`dr-mono font-bold text-lg leading-none ${timerClass} text-[color:var(--dr-text)]`}>{timer}s</div>
                        <div className="flex-1 max-w-[80px] sm:max-w-[120px] dr-timer-track" style={{ height: '6px' }}>
                            <div className={`dr-timer-fill ${timerFill}`} style={{ width: `${timerPct}%` }} />
                        </div>
                        <div className="dr-pill dr-pill-violet text-[10px] py-0.5 px-1.5"><span className="dr-mono">{currentRound}/{totalRounds}</span></div>
                    </div>

                    {myWord && (
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                            <div className="px-2.5 py-1 rounded-xl flex items-center gap-1.5 border"
                                style={{ background: 'var(--dr-grad)', borderColor: 'rgba(255,255,255,0.25)', boxShadow: 'var(--dr-glow-v)' }}>
                                <span className="dr-h text-sm sm:text-base text-white tracking-wide">{myWord.word}</span>
                                {myWord.hint && (
                                    <span className="text-[10px] text-white/90 font-medium hidden xs:inline">({myWord.hint})</span>
                                )}
                            </div>
                            <button
                                onClick={handleSkipWord}
                                className="dr-btn dr-btn-ghost text-[10px] sm:text-xs py-1 px-2 flex items-center gap-1"
                                style={{ background: 'rgba(255,255,255,0.08)', borderColor: 'rgba(255,255,255,0.2)' }}
                                title="Passer le mot (-40 pts)"
                            >
                                <span className="material-symbols-outlined text-sm">refresh</span>
                                <span>-40 pts</span>
                            </button>
                        </div>
                    )}
                </div>

                {/* Canvas Area */}
                <div className="flex-1 min-h-0 min-w-0 w-full flex items-center justify-center p-1 relative">
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

                {/* Compact Consolidated Toolbar */}
                <div className="flex-shrink-0 px-0.5 pt-1 pb-1 flex flex-col gap-1.5">
                    <div className="dr-card p-1.5 sm:p-2 flex flex-col gap-1.5">
                        {/* Row 1: Colors */}
                        <div className="flex items-center justify-between gap-1 px-1 overflow-x-auto">
                            {COLORS.map(c => {
                                const isSel = selectedColor === c.value && !isEraser;
                                return (
                                    <button
                                        key={c.value}
                                        type="button"
                                        onClick={() => {
                                            setSelectedColor(c.value);
                                            setTool(t => (t === 'eraser' ? 'pen' : t));
                                        }}
                                        className="dr-color-dot"
                                        style={{
                                            backgroundColor: c.value,
                                            transform: isSel ? 'scale(1.22)' : 'scale(1)',
                                            border: c.value === '#ffffff' ? '1px solid #ccc' : '1px solid rgba(0,0,0,0.25)',
                                            boxShadow: isSel ? '0 0 0 2px #fff, 0 0 10px rgba(255,255,255,0.8)' : undefined,
                                        }}
                                        aria-label={c.name}
                                        title={c.name}
                                    />
                                );
                            })}
                        </div>

                        {/* Row 2: Tools (Brushes, Fill, Eraser) + Sizes + Undo + Clear */}
                        <div className="flex items-center justify-between gap-1 pt-1 border-t border-[color:var(--dr-line)]">
                            {/* Brushes */}
                            <div className="flex items-center gap-1">
                                {BRUSHES.map(b => (
                                    <button
                                        key={b.id}
                                        type="button"
                                        onClick={() => setTool(b.id)}
                                        className={`dr-icon-btn-sm ${tool === b.id && !isEraser ? 'active' : ''}`}
                                        aria-label={b.label}
                                        title={b.label}
                                    >
                                        <span className="material-symbols-outlined text-base">{b.icon}</span>
                                    </button>
                                ))}
                                <button
                                    type="button"
                                    onClick={() => setTool('fill')}
                                    className={`dr-icon-btn-sm ${tool === 'fill' && !isEraser ? 'active' : ''}`}
                                    aria-label="Pot de peinture"
                                    title="Pot de peinture"
                                >
                                    <span className="material-symbols-outlined text-base">format_color_fill</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setTool('eraser')}
                                    className={`dr-icon-btn-sm ${isEraser ? 'active' : ''}`}
                                    aria-label="Gomme"
                                    title="Gomme"
                                >
                                    <span className="material-symbols-outlined text-base">ink_eraser</span>
                                </button>
                            </div>

                            {/* Separator */}
                            <div className="w-px h-5 bg-[color:var(--dr-line-2)] flex-shrink-0" />

                            {/* Sizes */}
                            <div className="flex items-center gap-1">
                                {BRUSH_SIZES.map((size, idx) => (
                                    <button
                                        key={size}
                                        type="button"
                                        onClick={() => setBrushSize(size)}
                                        disabled={tool === 'fill'}
                                        className={`dr-icon-btn-sm ${brushSize === size ? 'active' : ''}`}
                                        aria-label={`Taille ${size}`}
                                        title={`Taille ${size}`}
                                    >
                                        <div className="rounded-full bg-current"
                                            style={{ width: 4 + idx * 3.5, height: 4 + idx * 3.5 }} />
                                    </button>
                                ))}
                            </div>

                            {/* Separator */}
                            <div className="w-px h-5 bg-[color:var(--dr-line-2)] flex-shrink-0" />

                            {/* Actions */}
                            <div className="flex items-center gap-1">
                                <button
                                    type="button"
                                    onClick={handleUndo}
                                    disabled={strokesHistoryRef.current.length === 0}
                                    className="dr-icon-btn-sm"
                                    aria-label="Annuler"
                                    title="Annuler"
                                >
                                    <span className="material-symbols-outlined text-base">undo</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={handleClearCanvas}
                                    className="dr-icon-btn-sm"
                                    aria-label="Tout effacer"
                                    title="Tout effacer"
                                    style={{ color: 'var(--dr-red)', borderColor: 'rgba(251,85,112,0.4)' }}
                                >
                                    <span className="material-symbols-outlined text-base">delete</span>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // ── PLAYING — DEVINEUR ────────────────────────────────────────────
    if (gameState === 'PLAYING' && !isDrawer) {
        return (
            <div className="dr-app h-[100dvh] max-h-[100dvh] flex flex-col overflow-hidden relative"
                style={{
                    paddingTop: 'max(env(safe-area-inset-top), 6px)',
                    paddingBottom: 'max(env(safe-area-inset-bottom), 6px)',
                    paddingLeft: 'max(env(safe-area-inset-left), 8px)',
                    paddingRight: 'max(env(safe-area-inset-right), 8px)'
                }}>

                {countdownVal > 0 && (
                    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-[#08080F]/90 backdrop-blur-md">
                        <div key={countdownVal} className="dr-countdown text-[6rem] leading-none">{countdownVal}</div>
                        <div className="dr-h text-base mt-2 text-[color:var(--dr-muted)]">Prépare-toi à deviner !</div>
                    </div>
                )}

                {/* Header — timer + score + round */}
                <div className="flex items-center gap-2 px-1 py-1 flex-shrink-0 border-b border-[color:var(--dr-line)]">
                    <div className={`dr-mono font-bold text-lg leading-none ${timerClass} text-[color:var(--dr-text)]`}>{timer}s</div>
                    <div className="flex-1 dr-timer-track" style={{ height: '6px' }}>
                        <div className={`dr-timer-fill ${timerFill}`} style={{ width: `${timerPct}%` }} />
                    </div>
                    <div className="dr-pill dr-pill-violet text-[10px] py-0.5 px-1.5"><span className="dr-mono">{currentRound}/{totalRounds}</span></div>
                    <div className="dr-mono font-bold text-xs text-[color:var(--dr-lime)] px-1.5 py-0.5 rounded bg-[rgba(74,222,128,0.1)]">{myScore} pts</div>
                </div>

                {/* Drawer info + word blanks */}
                <div className="flex items-center justify-between gap-2 px-1 py-1 flex-shrink-0 bg-[rgba(139,92,246,0.06)] border-b border-[color:var(--dr-line)]">
                    <div className="text-xs text-[color:var(--dr-muted)] flex items-center gap-1 truncate">
                        <span className="material-symbols-outlined text-sm text-[color:var(--dr-violet-lt)]">stylus_note</span>
                        <span className="dr-h text-xs text-[color:var(--dr-text)] truncate">{drawerName}</span>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap justify-end">
                        <span className="dr-pill dr-pill-cyan text-[9px] py-0.5 px-1.5">{wordCategory}</span>
                        <div className="flex items-center gap-1">
                            {Array.from({ length: wordLength }).map((_, i) => (
                                <div key={i} className="dr-blank" style={{ width: '12px', height: '3px' }} />
                            ))}
                        </div>
                        <span className="dr-mono text-[10px] text-[color:var(--dr-dim)]">({wordLength})</span>
                    </div>
                </div>

                {/* Canvas Area */}
                <div className="flex-1 min-h-0 min-w-0 w-full flex items-center justify-center p-1 relative">
                    <div className={`canvas-container-4-3 draw-canvas-viewer ${hasGuessed ? 'opacity-90' : ''}`}>
                        <canvas ref={canvasRef} className="draw-canvas" />
                        {hasGuessed && (
                            <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#08080F]/85 backdrop-blur-sm dr-pop">
                                <span className="material-symbols-outlined text-5xl text-[color:var(--dr-lime)] mb-1" style={{ fontVariationSettings: "'FILL' 1", filter: 'drop-shadow(0 0 16px rgba(74,222,128,0.6))' }}>check_circle</span>
                                <h3 className="dr-h text-2xl dr-glow-lime">Bravo !</h3>
                                <div className="dr-pill dr-pill-lime mt-1.5 text-xs">
                                    +{guessResult?.points} pts · #{guessResult?.rank}
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Bottom Input Area */}
                {!hasGuessed && (
                    <div className="w-full flex-shrink-0 px-1 pt-1 pb-1">
                        {guessResult?.closeMatch && (
                            <div className="text-center text-[11px] font-bold text-[color:var(--dr-amber)] mb-1 flex items-center justify-center gap-1 dr-slide-in">
                                <span className="material-symbols-outlined text-xs">local_fire_department</span> Très proche ! Vérifie l'orthographe
                            </div>
                        )}
                        <div className={`flex gap-1.5 ${shakeGuess ? 'shake-input' : ''}`}>
                            <input
                                ref={guessInputRef}
                                type="text"
                                className="dr-input flex-1 text-sm py-2.5"
                                placeholder="Tape ta réponse…"
                                value={guess}
                                onChange={(e) => setGuess(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && submitGuess()}
                                disabled={hasGuessed || countdownVal > 0}
                                autoComplete="off"
                                autoCorrect="off"
                                autoCapitalize="none"
                                spellCheck="false"
                                style={shakeGuess ? { borderColor: 'var(--dr-amber)' } : undefined}
                            />
                            <button
                                onClick={submitGuess}
                                disabled={hasGuessed || !guess.trim() || countdownVal > 0}
                                className="dr-btn dr-btn-primary px-4 py-2"
                                aria-label="Valider ma réponse"
                            >
                                <span className="material-symbols-outlined text-base" style={{ fontVariationSettings: "'FILL' 1" }}>send</span>
                            </button>
                        </div>
                    </div>
                )}
            </div>
        );
    }

    // ── ROUND END ─────────────────────────────────────────────────────
    if (gameState === 'ROUND_END') {
        return (
            <div className="dr-app min-h-[100dvh] flex items-center justify-center p-4 overflow-y-auto"
                style={{
                    paddingTop: 'max(env(safe-area-inset-top), 20px)',
                    paddingBottom: 'max(env(safe-area-inset-bottom), 20px)',
                    paddingLeft: 'max(env(safe-area-inset-left), 16px)',
                    paddingRight: 'max(env(safe-area-inset-right), 16px)'
                }}>
                <span className="dr-orb dr-orb-v" /><span className="dr-orb dr-orb-m" />
                <div className="w-full max-w-xs flex flex-col items-center gap-4 dr-fade-up my-auto">
                    <div className="dr-card dr-card-glow w-full p-5 text-center">
                        <div className="dr-eyebrow">Le mot était</div>
                        <h2 className="dr-h text-3xl dr-grad-text mt-1">{revealedWord?.word}</h2>
                    </div>
                    <div className="dr-card w-full p-5 text-center">
                        <div className="dr-eyebrow">Ton score</div>
                        <div className="dr-mono text-5xl font-bold text-[color:var(--dr-text)] mt-1">{myScore}</div>
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
            <div className="dr-app min-h-[100dvh] flex items-center justify-center p-4 overflow-y-auto"
                style={{
                    paddingTop: 'max(env(safe-area-inset-top), 20px)',
                    paddingBottom: 'max(env(safe-area-inset-bottom), 20px)',
                    paddingLeft: 'max(env(safe-area-inset-left), 16px)',
                    paddingRight: 'max(env(safe-area-inset-right), 16px)'
                }}>
                <span className="dr-orb dr-orb-v" /><span className="dr-orb dr-orb-m" /><span className="dr-orb dr-orb-c" />

                <div className="w-full max-w-xs flex flex-col gap-3.5 dr-fade-up my-auto py-2">
                    {/* My result */}
                    <div className="dr-card dr-card-glow p-5 text-center dr-pop" style={{ borderColor: rankColor }}>
                        <div className="text-4xl mb-1">{medals[myRank - 1] || '🎨'}</div>
                        <h2 className="dr-h text-2xl" style={{ color: rankColor }}>
                            {myRank === 1 ? 'Victoire !' : `${myRank}ᵉ place`}
                        </h2>
                        <div className="dr-mono text-3xl font-bold text-[color:var(--dr-text)] mt-1">{myScore}<span className="text-base text-[color:var(--dr-muted)] ml-1">pts</span></div>
                        {myRank !== 1 && (
                            <div className="text-xs text-[color:var(--dr-muted)] mt-1.5">
                                Vainqueur : <span className="dr-h text-xs dr-grad-text">{winner?.name}</span>
                            </div>
                        )}
                    </div>

                    {/* Full ranking */}
                    <div className="dr-card p-3.5">
                        <div className="dr-eyebrow mb-2.5">Classement final</div>
                        <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto dr-scroll pr-1">
                            {finalResults.map((p, i) => {
                                const me = p.id === socket.id;
                                return (
                                    <div key={p.id} className={`flex items-center gap-2 p-2 rounded-xl text-sm dr-slide-in ${me ? 'dr-card-2' : ''}`}
                                        style={{ animationDelay: `${i * 40}ms`, ...(me ? { borderColor: 'rgba(139,92,246,0.5)', background: 'rgba(139,92,246,0.12)' } : {}) }}>
                                        <span className="dr-mono w-6 text-center font-bold text-[color:var(--dr-muted)]">{medals[i] || `${i + 1}`}</span>
                                        <span className={`flex-1 truncate ${me ? 'dr-h text-sm' : 'font-medium text-[color:var(--dr-text)]'}`}>{p.name}</span>
                                        <span className="dr-mono font-bold text-[color:var(--dr-lime)]">{p.score}</span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Awards */}
                    {awards.length > 0 && (
                        <div className="grid grid-cols-2 gap-2">
                            {awards.map((a, i) => (
                                <div key={i} className="dr-card-2 p-2.5 text-center">
                                    <div className="text-xl mb-0.5">{a.icon}</div>
                                    <div className="dr-eyebrow text-[color:var(--dr-violet-lt)]">{a.title}</div>
                                    <div className="text-xs font-semibold text-[color:var(--dr-text)] truncate mt-0.5">{a.playerName}</div>
                                </div>
                            ))}
                        </div>
                    )}

                    <button onClick={() => navigate('/')} className="dr-btn dr-btn-primary w-full py-3">
                        <span className="material-symbols-outlined text-lg">home</span> Retour au menu
                    </button>
                </div>
            </div>
        );
    }

    return null;
}

export default DrawPlayerView;
