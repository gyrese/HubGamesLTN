import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { socket } from '../../socket';
import { QRCodeSVG } from 'qrcode.react';
import confetti from 'canvas-confetti';
import { playCountdownSound, playSuccessSound, playFailSound, playWinnerSound } from '../../utils/audio';
import './FakeArtistStyles.css';

const HOST_SESSION_KEY = 'fakeartist-host-session';
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

/** Trace un tracé normalisé sur un contexte 2D. */
function paintStroke(ctx, canvas, stroke, ratio = 1) {
    if (!stroke?.points?.length) return;
    const pts = ratio >= 1
        ? stroke.points
        : stroke.points.slice(0, Math.max(2, Math.ceil(stroke.points.length * ratio)));
    if (pts.length === 0) return;

    ctx.strokeStyle = stroke.color || '#1a1a1a';
    ctx.lineWidth = stroke.size || 8;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    pts.forEach((pt, i) => {
        const x = pt.x * canvas.width;
        const y = pt.y * canvas.height;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });
    // Un point isolé doit rester visible
    if (pts.length === 1) {
        ctx.lineTo(pts[0].x * canvas.width + 0.1, pts[0].y * canvas.height + 0.1);
    }
    ctx.stroke();
}

function FakeArtistHostView() {
    const navigate = useNavigate();

    const [gameState, setGameState] = useState('CREATING');
    const [roomCode, setRoomCode] = useState('');
    const [players, setPlayers] = useState([]);
    const [drawOrder, setDrawOrder] = useState([]);
    const [settings, setSettings] = useState({
        roundsCount: 2,
        timePerRound: 30,
        voteDuration: 90,
        guessDuration: 45,
        categories: ['all'],
        twoImpostors: 'auto'
    });

    const [currentRound, setCurrentRound] = useState(0);
    const [totalRounds, setTotalRounds] = useState(0);
    const [matchNumber, setMatchNumber] = useState(0);
    const [currentDrawerId, setCurrentDrawerId] = useState(null);
    const [category, setCategory] = useState('');
    const [impostorCount, setImpostorCount] = useState(1);

    // Mot secret : connu de l'hôte mais masqué par défaut
    const [hostWord, setHostWord] = useState(null);
    const [wordVisible, setWordVisible] = useState(false);

    // Dépouillement / verdict
    const [accusedName, setAccusedName] = useState('');
    const [accusedAvatar, setAccusedAvatar] = useState(null);
    const [accusedColor, setAccusedColor] = useState(null);
    const [isImpostorAccused, setIsImpostorAccused] = useState(false);
    const [isTie, setIsTie] = useState(false);
    const [voteTallies, setVoteTallies] = useState({});
    const [tallyReady, setTallyReady] = useState(false);

    // Devinette
    const [impostorGuess, setImpostorGuess] = useState(null);
    const [secretWord, setSecretWord] = useState('');
    const [impostors, setImpostors] = useState([]);
    const [winner, setWinner] = useState(null);
    const [endReason, setEndReason] = useState(null);

    // Minuteurs
    const [timer, setTimer] = useState(0);
    const [timerPct, setTimerPct] = useState(100);
    const [readyCount, setReadyCount] = useState({ ready: 0, total: 0 });

    // Catégories disponibles
    const [availableCategories, setAvailableCategories] = useState([]);

    // Connectivité
    const [hostOffline, setHostOffline] = useState(false);
    const [toast, setToast] = useState(null);

    // Replay du dessin pendant le vote
    const [replaying, setReplaying] = useState(false);

    const canvasRef = useRef(null);
    const canvasContextRef = useRef(null);
    const timerRef = useRef(null);
    const strokesHistoryRef = useRef([]);
    const liveStrokeRef = useRef(null);
    const replayRef = useRef(null);
    const roomCodeRef = useRef('');

    useEffect(() => { roomCodeRef.current = roomCode; }, [roomCode]);

    useEffect(() => {
        document.body.classList.add('fa-noir');
        return () => document.body.classList.remove('fa-noir');
    }, []);

    /* ─── Rendu du canevas ─────────────────────────────────────────── */

    const redrawCanvas = useCallback((upTo = Infinity, partialRatio = 1) => {
        const ctx = canvasContextRef.current;
        const canvas = canvasRef.current;
        if (!ctx || !canvas) return;

        ctx.fillStyle = '#FDFCF7';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const history = strokesHistoryRef.current;
        for (let i = 0; i < history.length && i < upTo; i++) {
            paintStroke(ctx, canvas, history[i]);
        }
        // Trait partiellement rejoué (replay)
        if (upTo < history.length && partialRatio < 1 && history[upTo]) {
            paintStroke(ctx, canvas, history[upTo], partialRatio);
        }
        if (liveStrokeRef.current) {
            paintStroke(ctx, canvas, liveStrokeRef.current);
        }
    }, []);

    // Dimensionnement du canevas
    useEffect(() => {
        const needsCanvas = ['PLAYING', 'VOTING', 'REVEAL', 'GUESSING', 'GAME_END'].includes(gameState);
        if (!canvasRef.current || !needsCanvas) return;

        const canvas = canvasRef.current;
        const initCanvas = (w, h) => {
            if (w < 10 || h < 10) return;
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            canvas.width = Math.round(w * dpr);
            canvas.height = Math.round(h * dpr);
            const ctx = canvas.getContext('2d');
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            canvasContextRef.current = ctx;
            redrawCanvas();
        };

        const ro = new ResizeObserver(entries => {
            for (const e of entries) initCanvas(e.contentRect.width, e.contentRect.height);
        });
        ro.observe(canvas);

        const raf = requestAnimationFrame(() => {
            const r = canvas.getBoundingClientRect();
            initCanvas(r.width, r.height);
        });

        return () => { ro.disconnect(); cancelAnimationFrame(raf); };
    }, [gameState, redrawCanvas]);

    /* ─── Minuteur ─────────────────────────────────────────────────── */

    const startTimer = useCallback((duration, startTime, graceMs = 0) => {
        if (timerRef.current) clearInterval(timerRef.current);
        if (!duration || !startTime) return;

        const total = duration + graceMs / 1000;
        const update = () => {
            const elapsed = (Date.now() - startTime) / 1000;
            const remaining = Math.max(0, Math.ceil(total - elapsed));
            setTimer(remaining);
            setTimerPct(Math.max(0, Math.min(100, (remaining / total) * 100)));
        };
        update();
        timerRef.current = setInterval(update, 250);
    }, []);

    const stopTimer = useCallback(() => {
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    }, []);

    useEffect(() => () => {
        stopTimer();
        if (replayRef.current) cancelAnimationFrame(replayRef.current);
    }, [stopTimer]);

    /* ─── Replay animé du dessin (phase de vote) ───────────────────── */

    const startReplay = useCallback(() => {
        const history = strokesHistoryRef.current.filter(s => s.points?.length);
        if (history.length === 0 || replaying) return;

        setReplaying(true);
        const PER_STROKE_MS = 700;
        const started = Date.now();

        const tick = () => {
            const elapsed = Date.now() - started;
            const idx = Math.floor(elapsed / PER_STROKE_MS);
            const ratio = (elapsed % PER_STROKE_MS) / PER_STROKE_MS;

            if (idx >= strokesHistoryRef.current.length) {
                redrawCanvas();
                setReplaying(false);
                replayRef.current = null;
                return;
            }
            redrawCanvas(idx, ratio);
            replayRef.current = requestAnimationFrame(tick);
        };
        replayRef.current = requestAnimationFrame(tick);
    }, [replaying, redrawCanvas]);

    /* ─── Export PNG du dessin ─────────────────────────────────────── */

    const exportDrawing = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        try {
            const link = document.createElement('a');
            link.download = `fake-artist-${secretWord || roomCode}.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();
        } catch {
            setToast('Export impossible sur ce navigateur');
        }
    }, [secretWord, roomCode]);

    /* ─── Connexion / reconnexion ──────────────────────────────────── */

    useEffect(() => {
        const applyReconnect = (response) => {
            setRoomCode(response.roomCode);
            roomCodeRef.current = response.roomCode;
            if (response.settings) setSettings(prev => ({ ...prev, ...response.settings }));
            setPlayers(response.players || []);
            setDrawOrder(response.drawOrder || []);
            setCurrentRound(response.currentRound || 0);
            setTotalRounds(response.totalRounds || 0);
            setMatchNumber(response.matchNumber || 0);
            setCategory(response.category || '');
            setHostWord(response.hostWord || null);
            setVoteTallies(response.voteTallies || {});
            writeHostSession(response.roomCode);
            strokesHistoryRef.current = response.canvasHistory || [];
            setHostOffline(false);

            const st = response.gameState;
            setGameState(st);

            if (st === 'PLAYING') {
                setCurrentDrawerId(response.currentDrawerId);
                startTimer(response.settings?.timePerRound, response.turnStartTime, 5000);
            } else if (st === 'VOTING') {
                startTimer(response.settings?.voteDuration, response.voteStartTime);
            } else if (st === 'GUESSING') {
                setAccusedName(response.accusedName || '');
                setImpostorGuess(response.impostorGuess);
                setSecretWord(response.secretWord || '');
                startTimer(response.settings?.guessDuration, response.guessStartTime);
            } else if (st === 'GAME_END') {
                setWinner(response.winner);
                setSecretWord(response.secretWord || '');
                setImpostors(response.impostors || []);
                stopTimer();
            }

            if (['PLAYING', 'VOTING', 'REVEAL', 'GUESSING', 'GAME_END'].includes(st)) {
                requestAnimationFrame(() => redrawCanvas());
            }
        };

        const createFreshRoom = () => {
            socket.emit('fakeartist-create-room', { settings }, (response) => {
                if (response.roomCode) {
                    setRoomCode(response.roomCode);
                    roomCodeRef.current = response.roomCode;
                    if (response.settings) setSettings(prev => ({ ...prev, ...response.settings }));
                    setGameState('LOBBY');
                    writeHostSession(response.roomCode);
                }
            });
        };

        const reconnectHost = (code, onFail) => {
            let handled = false;
            const t = setTimeout(() => { if (!handled) { handled = true; onFail(); } }, 4000);
            socket.emit('fakeartist-host-reconnect', { roomCode: code }, (response) => {
                clearTimeout(t);
                if (handled) return;
                handled = true;
                if (response.error) onFail();
                else applyReconnect(response);
            });
        };

        const saved = readHostSession();
        const fresh = saved?.roomCode && (Date.now() - (saved.createdAt || 0) < HOST_SESSION_TTL);
        if (fresh) {
            reconnectHost(saved.roomCode, () => { clearHostSession(); createFreshRoom(); });
        } else {
            if (saved) clearHostSession();
            createFreshRoom();
        }

        socket.emit('draw-get-categories', {}, (response) => {
            if (response?.categories) setAvailableCategories(response.categories);
        });

        const handleConnect = () => {
            const code = roomCodeRef.current;
            if (!code) return;
            reconnectHost(code, () => { clearHostSession(); createFreshRoom(); });
        };
        const handleDisconnect = () => setHostOffline(true);

        socket.on('connect', handleConnect);
        socket.on('disconnect', handleDisconnect);

        return () => {
            socket.off('connect', handleConnect);
            socket.off('disconnect', handleDisconnect);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    /* ─── Écouteurs de jeu ─────────────────────────────────────────── */

    useEffect(() => {
        const handlePlayersUpdated = (list) => setPlayers(list);

        const handleReadyUpdated = (status) => setReadyCount(status);

        const handleGameStarted = (data) => {
            playCountdownSound();
            setGameState('PLAYING');
            strokesHistoryRef.current = [];
            liveStrokeRef.current = null;
            setCurrentRound(data.currentRound);
            setTotalRounds(data.totalRounds);
            setMatchNumber(data.matchNumber || 1);
            setCurrentDrawerId(data.currentDrawerId);
            setCategory(data.category);
            setHostWord(data.hostWord || null);
            setWordVisible(false);
            setDrawOrder(data.drawOrder || []);
            setImpostorCount(data.impostorCount || 1);
            setWinner(null);
            setEndReason(null);
            setAccusedName('');
            setAccusedAvatar(null);
            setIsTie(false);
            setImpostorGuess(null);
            setImpostors([]);
            setVoteTallies({});
            setTallyReady(false);
            setReadyCount({ ready: 0, total: 0 });
            startTimer(data.timePerRound, data.turnStartTime, data.graceMs || 0);
        };

        const handleTurnUpdated = (data) => {
            liveStrokeRef.current = null;
            setCurrentDrawerId(data.currentDrawerId);
            setCurrentRound(data.currentRound);
            strokesHistoryRef.current = data.canvasHistory || [];
            redrawCanvas();
            startTimer(data.timePerRound ?? settings.timePerRound, data.turnStartTime, data.graceMs || 0);
        };

        const handleStrokeLive = (stroke) => {
            liveStrokeRef.current = stroke;
            redrawCanvas();
        };

        const handleClearLive = () => {
            liveStrokeRef.current = null;
            redrawCanvas();
        };

        const handleGameStateUpdated = (data) => {
            setGameState(data.gameState);
            if (data.players) setPlayers(data.players);
            if (data.canvasHistory) {
                strokesHistoryRef.current = data.canvasHistory;
                requestAnimationFrame(() => redrawCanvas());
            }

            if (data.gameState === 'VOTING') {
                playCountdownSound();
                liveStrokeRef.current = null;
                startTimer(data.voteDuration ?? settings.voteDuration, data.voteStartTime ?? Date.now());
            } else if (data.gameState === 'REVEAL') {
                stopTimer();
                playCountdownSound();
                setIsTie(!!data.isTie);
                setAccusedName(data.accusedName || '');
                setAccusedAvatar(data.accusedAvatar || null);
                setAccusedColor(data.accusedColor || null);
                setIsImpostorAccused(!!data.isImpostorAccused);
                setVoteTallies(data.voteTallies || {});
                setTallyReady(false);
                // Les barres partent de zéro puis se remplissent
                requestAnimationFrame(() => requestAnimationFrame(() => setTallyReady(true)));
            } else if (data.gameState === 'GUESSING') {
                playSuccessSound();
                setAccusedName(data.accusedName || '');
                startTimer(data.guessDuration ?? settings.guessDuration, data.guessStartTime ?? Date.now());
            } else if (data.gameState === 'GAME_END') {
                stopTimer();
                setWinner(data.winner);
                setEndReason(data.reason);
                setSecretWord(data.secretWord || '');
                setImpostors(data.impostors || []);
                if (data.impostorGuess) setImpostorGuess(data.impostorGuess);
                if (data.voteTallies) setVoteTallies(data.voteTallies);
                if (data.winner === 'impostor') {
                    playFailSound();
                } else {
                    playWinnerSound();
                    triggerConfetti();
                }
            } else if (data.gameState === 'LOBBY') {
                stopTimer();
                strokesHistoryRef.current = [];
                liveStrokeRef.current = null;
                setMatchNumber(data.matchNumber || 0);
                setWinner(null);
                setImpostorGuess(null);
                setImpostors([]);
                setVoteTallies({});
                setHostWord(null);
                setWordVisible(false);
            }
        };

        const handleGuessReceived = (data) => {
            playSuccessSound();
            setImpostorGuess(data.guess);
            setSecretWord(data.secretWord);
            stopTimer();
        };

        const handleError = ({ message }) => setToast(message || 'Erreur');

        socket.on('fakeartist-players-updated', handlePlayersUpdated);
        socket.on('fakeartist-ready-updated', handleReadyUpdated);
        socket.on('fakeartist-game-started', handleGameStarted);
        socket.on('fakeartist-turn-updated', handleTurnUpdated);
        socket.on('fakeartist-stroke-live', handleStrokeLive);
        socket.on('fakeartist-clear-live', handleClearLive);
        socket.on('fakeartist-game-state-updated', handleGameStateUpdated);
        socket.on('fakeartist-guess-received', handleGuessReceived);
        socket.on('fakeartist-error', handleError);

        return () => {
            socket.off('fakeartist-players-updated', handlePlayersUpdated);
            socket.off('fakeartist-ready-updated', handleReadyUpdated);
            socket.off('fakeartist-game-started', handleGameStarted);
            socket.off('fakeartist-turn-updated', handleTurnUpdated);
            socket.off('fakeartist-stroke-live', handleStrokeLive);
            socket.off('fakeartist-clear-live', handleClearLive);
            socket.off('fakeartist-game-state-updated', handleGameStateUpdated);
            socket.off('fakeartist-guess-received', handleGuessReceived);
            socket.off('fakeartist-error', handleError);
        };
    }, [settings.timePerRound, settings.voteDuration, settings.guessDuration, redrawCanvas, startTimer, stopTimer]);

    // Toast auto-effaçant
    useEffect(() => {
        if (!toast) return;
        const t = setTimeout(() => setToast(null), 3600);
        return () => clearTimeout(t);
    }, [toast]);

    /* ─── Actions ──────────────────────────────────────────────────── */

    const pushSettings = (patch) => {
        const next = { ...settings, ...patch };
        setSettings(next);
        socket.emit('fakeartist-update-settings', { roomCode, settings: patch });
    };

    const toggleCategory = (key) => {
        let next;
        if (key === 'all') {
            next = ['all'];
        } else {
            const base = settings.categories.filter(c => c !== 'all');
            next = base.includes(key) ? base.filter(c => c !== key) : [...base, key];
            if (next.length === 0) next = ['all'];
        }
        pushSettings({ categories: next });
    };

    const connectedPlayers = useMemo(() => players.filter(p => !p.disconnected), [players]);
    const canStart = connectedPlayers.length >= 3;

    const handleStartGame = () => {
        if (!canStart) return;
        socket.emit('fakeartist-start-game', { roomCode });
    };

    const handleForceVote = () => socket.emit('fakeartist-force-vote', { roomCode });
    const handleSkipReveal = () => socket.emit('fakeartist-skip-reveal', { roomCode });
    const handleHostDecision = (isCorrect) => socket.emit('fakeartist-host-decision', { roomCode, isCorrect });
    const handleRestartGame = (resetScores = false) => socket.emit('fakeartist-restart-game', { roomCode, resetScores });

    const handleQuit = () => {
        if (!window.confirm('Fermer cette table ? Les joueurs seront déconnectés.')) return;
        clearHostSession();
        navigate('/fakeartist');
    };

    const triggerConfetti = () => {
        confetti({ particleCount: 160, spread: 85, origin: { y: 0.6 }, colors: ['#F5A524', '#22D3EE', '#4ADE80', '#FFFFFF'] });
    };

    const joinUrl = `${window.location.origin}/fakeartist/play/${roomCode}`;
    const timerClass = timerPct > 50 ? 'fa-timer-ok' : timerPct > 22 ? 'fa-timer-mid' : 'fa-timer-low';

    /* ─── Fragments réutilisables ──────────────────────────────────── */

    const Shell = ({ children, stage = false }) => (
        <div className={`fa-app ${stage ? 'fa-app--stage' : ''} min-h-screen flex flex-col p-6 gap-5 select-none`}>
            <div className="fa-orb fa-orb-a" style={{ width: 460, height: 460, top: '-14%', left: '-6%' }} />
            <div className="fa-orb fa-orb-r" style={{ width: 400, height: 400, bottom: '-16%', right: '-5%' }} />
            {children}

            {hostOffline && (
                <div className="fa-overlay">
                    <div className="fa-card p-8 text-center max-w-sm flex flex-col items-center gap-4">
                        <div className="fa-spinner" />
                        <h3 className="fa-h text-xl">Connexion perdue</h3>
                        <p className="text-sm fa-text-muted">Reconnexion au serveur en cours<span className="fa-dots" /></p>
                    </div>
                </div>
            )}

            {toast && (
                <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[95] fa-card px-5 py-3 text-sm font-semibold">
                    {toast}
                </div>
            )}
        </div>
    );

    /** Bandeau supérieur commun aux écrans de jeu. */
    const TopBar = ({ title, right }) => (
        <header className="fa-card px-6 py-4 flex items-center justify-between gap-6 flex-shrink-0">
            <div className="flex items-center gap-4 min-w-0">
                <div>
                    <div className="fa-label fa-stage-label">Fake Artist</div>
                    <h2 className="fa-h text-2xl mt-0.5 truncate">{title}</h2>
                </div>
                {matchNumber > 0 && (
                    <span className="fa-pill fa-pill-cyan">Manche {matchNumber}</span>
                )}
            </div>
            <div className="flex items-center gap-3 flex-shrink-0">
                {right}
                <button onClick={handleQuit} className="fa-btn fa-btn-ghost fa-btn-sm" title="Fermer la table">
                    <span className="material-symbols-outlined text-[18px]">close</span>
                </button>
            </div>
        </header>
    );

    /** Le canevas, encadré. */
    const CanvasStage = () => (
        <div className="fa-canvas-frame">
            <div className="fa-canvas-sheet" style={{ '--fa-ink': currentDrawerColor || 'transparent' }}>
                <canvas ref={canvasRef} className="fa-canvas fa-canvas--locked" />
            </div>
        </div>
    );

    const currentDrawer = drawOrder.find(p => p.id === currentDrawerId)
        || players.find(p => p.id === currentDrawerId);
    const currentDrawerColor = currentDrawer?.color?.value;

    /* ═══ CREATING ═══════════════════════════════════════════════════ */
    if (gameState === 'CREATING') {
        return (
            <Shell>
                <div className="flex-1 grid place-items-center">
                    <div className="fa-card p-10 text-center flex flex-col items-center gap-5">
                        <div className="fa-spinner" />
                        <h2 className="fa-h text-2xl">Ouverture de la table<span className="fa-dots" /></h2>
                        <p className="text-sm fa-text-muted">Préparation du dossier d'enquête</p>
                    </div>
                </div>
            </Shell>
        );
    }

    /* ═══ LOBBY ══════════════════════════════════════════════════════ */
    if (gameState === 'LOBBY') {
        return (
            <Shell>
                <TopBar
                    title="Salle d'attente"
                    right={
                        <div className="text-right">
                            <div className="fa-label">Code de la table</div>
                            <div className="fa-roomcode text-4xl leading-none mt-1">{roomCode}</div>
                        </div>
                    }
                />

                <div className="fa-stage">
                    {/* Colonne gauche : joueurs */}
                    <div className="fa-card p-6 flex flex-col min-h-0">
                        <div className="flex items-baseline justify-between mb-5">
                            <h3 className="fa-h text-xl">Autour de la table</h3>
                            <span className="fa-pill fa-pill-amber fa-pill-lg fa-mono">
                                {connectedPlayers.length}/12
                            </span>
                        </div>

                        {players.length === 0 ? (
                            <div className="flex-1 grid place-items-center text-center px-6">
                                <div>
                                    <span className="material-symbols-outlined text-5xl fa-text-dim">group_add</span>
                                    <p className="fa-h text-lg mt-3">Personne pour l'instant</p>
                                    <p className="text-sm fa-text-muted mt-1.5">
                                        Scannez le code à droite pour rejoindre
                                    </p>
                                </div>
                            </div>
                        ) : (
                            <div className="grid grid-cols-2 gap-2.5 content-start overflow-y-auto fa-rail-scroll fa-stagger">
                                {players.map(p => (
                                    <div key={p.id} className={`fa-player ${p.disconnected ? 'fa-player-out' : ''}`}>
                                        <img src={p.avatar} alt="" className="fa-avatar" />
                                        <div className="flex-1 min-w-0">
                                            <div className="font-bold text-[0.9375rem] truncate">{p.name}</div>
                                            <div className="text-[0.6875rem] fa-text-dim">{p.color?.name}</div>
                                        </div>
                                        <span className="fa-ink" style={{ backgroundColor: p.color?.value, color: p.color?.value }} />
                                    </div>
                                ))}
                            </div>
                        )}

                        {connectedPlayers.length >= 7 && settings.twoImpostors === 'auto' && (
                            <div className="fa-card-inset p-3 mt-4 text-center text-[0.8125rem] fa-text-cyan">
                                <span className="material-symbols-outlined text-[16px] align-middle mr-1">groups</span>
                                À {connectedPlayers.length} joueurs, la partie comptera <strong>2 imposteurs</strong>
                            </div>
                        )}
                    </div>

                    {/* Colonne droite : QR + réglages */}
                    <div className="fa-rail">
                        <div className="fa-card p-5 flex flex-col items-center gap-4 flex-shrink-0">
                            <div className="fa-qr">
                                <QRCodeSVG value={joinUrl} size={148} bgColor="#FDFCF7" fgColor="#12101F" />
                            </div>
                            <div className="text-center">
                                <div className="fa-label">Ou rendez-vous sur</div>
                                <div className="fa-mono text-sm mt-1.5 select-all fa-text-amber">
                                    {window.location.host}/fakeartist
                                </div>
                            </div>
                        </div>

                        <div className="fa-card p-5 flex flex-col gap-4 flex-1 min-h-0 overflow-y-auto fa-rail-scroll">
                            <h3 className="fa-h text-lg">Réglages</h3>

                            <div>
                                <label className="fa-label block mb-1.5">Traits par joueur</label>
                                <select
                                    className="fa-select"
                                    value={settings.roundsCount}
                                    onChange={e => pushSettings({ roundsCount: parseInt(e.target.value, 10) })}
                                >
                                    <option value={1}>1 trait — partie éclair</option>
                                    <option value={2}>2 traits — recommandé</option>
                                    <option value={3}>3 traits — dessin abouti</option>
                                </select>
                            </div>

                            <div>
                                <label className="fa-label block mb-1.5">Temps par trait</label>
                                <select
                                    className="fa-select"
                                    value={settings.timePerRound}
                                    onChange={e => pushSettings({ timePerRound: parseInt(e.target.value, 10) })}
                                >
                                    <option value={20}>20 secondes</option>
                                    <option value={30}>30 secondes</option>
                                    <option value={45}>45 secondes</option>
                                    <option value={60}>60 secondes</option>
                                </select>
                            </div>

                            <div>
                                <label className="fa-label block mb-1.5">Temps de délibération</label>
                                <select
                                    className="fa-select"
                                    value={settings.voteDuration}
                                    onChange={e => pushSettings({ voteDuration: parseInt(e.target.value, 10) })}
                                >
                                    <option value={60}>1 minute</option>
                                    <option value={90}>1 min 30</option>
                                    <option value={120}>2 minutes</option>
                                    <option value={180}>3 minutes</option>
                                </select>
                            </div>

                            <div>
                                <label className="fa-label block mb-1.5">Imposteurs</label>
                                <select
                                    className="fa-select"
                                    value={settings.twoImpostors}
                                    onChange={e => pushSettings({ twoImpostors: e.target.value })}
                                >
                                    <option value="auto">2 imposteurs dès 7 joueurs</option>
                                    <option value="never">Toujours 1 seul imposteur</option>
                                </select>
                            </div>

                            {availableCategories.length > 0 && (
                                <div>
                                    <label className="fa-label block mb-1.5">
                                        Catégories de mots
                                    </label>
                                    <div className="fa-cat-grid">
                                        <button
                                            className={`fa-cat ${settings.categories.includes('all') ? 'fa-cat-on' : ''}`}
                                            onClick={() => toggleCategory('all')}
                                        >
                                            Toutes
                                        </button>
                                        {availableCategories.map(c => {
                                            const key = c.key || c.categoryKey || c;
                                            const label = c.name || c.category || key;
                                            return (
                                                <button
                                                    key={key}
                                                    className={`fa-cat ${settings.categories.includes(key) ? 'fa-cat-on' : ''}`}
                                                    onClick={() => toggleCategory(key)}
                                                    title={label}
                                                >
                                                    {label}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>

                        <button
                            onClick={handleStartGame}
                            disabled={!canStart}
                            className="fa-btn fa-btn-primary fa-btn-lg w-full flex-shrink-0"
                        >
                            <span className="material-symbols-outlined text-[20px]">play_arrow</span>
                            {canStart ? 'Lancer la partie' : `Encore ${3 - connectedPlayers.length} joueur${3 - connectedPlayers.length > 1 ? 's' : ''}`}
                        </button>
                    </div>
                </div>
            </Shell>
        );
    }

    /* ═══ PLAYING ════════════════════════════════════════════════════ */
    if (gameState === 'PLAYING') {
        const order = drawOrder.length > 0 ? drawOrder : players;

        return (
            <Shell stage>
                <TopBar
                    title={<>Tour de <span style={{ color: currentDrawerColor }}>{currentDrawer?.name || '…'}</span></>}
                    right={
                        <>
                            <span className="fa-pill fa-pill-cyan fa-pill-lg">
                                Passage {currentRound}/{totalRounds}
                            </span>
                            <span className="fa-pill fa-pill-amber fa-pill-lg">{category}</span>
                            {hostWord && (
                                <button
                                    onClick={() => setWordVisible(v => !v)}
                                    className="fa-btn fa-btn-ghost fa-btn-sm"
                                    title="Le mot secret, pour l'animateur uniquement"
                                >
                                    <span className="material-symbols-outlined text-[18px]">
                                        {wordVisible ? 'visibility_off' : 'visibility'}
                                    </span>
                                    {wordVisible ? hostWord : 'Mot'}
                                </button>
                            )}
                            <div className="flex items-center gap-3 w-52">
                                <div className="fa-timer-track flex-1">
                                    <div className={`fa-timer-fill ${timerClass}`} style={{ width: `${timerPct}%` }} />
                                </div>
                                <span className={`fa-timer-value text-2xl w-12 text-right ${timer <= 5 ? 'fa-timer-danger' : timer <= 10 ? 'fa-timer-warn' : ''}`}>
                                    {timer}
                                </span>
                            </div>
                        </>
                    }
                />

                <div className="fa-stage">
                    <CanvasStage />

                    <div className="fa-rail">
                        <div className="fa-card p-5 flex flex-col flex-1 min-h-0">
                            <h3 className="fa-h text-lg mb-4">Ordre de passage</h3>
                            <div className="fa-rail-scroll">
                                {order.map((p, idx) => {
                                    const isActive = p.id === currentDrawerId;
                                    const live = players.find(x => x.id === p.id);
                                    return (
                                        <div
                                            key={p.id}
                                            className={`fa-player ${isActive ? 'fa-player-active' : ''} ${live?.disconnected ? 'fa-player-out' : ''}`}
                                        >
                                            <span className="fa-order">{idx + 1}</span>
                                            <img src={p.avatar} alt="" className="fa-avatar" />
                                            <div className="flex-1 min-w-0">
                                                <div className="font-bold text-[0.9375rem] truncate">{p.name}</div>
                                                {isActive && (
                                                    <div className="text-[0.6875rem] font-bold fa-text-amber uppercase tracking-wide">
                                                        dessine<span className="fa-dots" />
                                                    </div>
                                                )}
                                            </div>
                                            <span className="fa-ink" style={{ backgroundColor: p.color?.value, color: p.color?.value }} />
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Tant que tout le monde n'a pas lu son rôle, on l'annonce */}
                {readyCount.total > 0 && readyCount.ready < readyCount.total ? (
                    <div className="fa-banner fa-banner-cyan flex-shrink-0">
                        <span className="material-symbols-outlined">visibility</span>
                        Lecture des rôles — {readyCount.ready}/{readyCount.total} joueurs prêts
                    </div>
                ) : (
                    <div className={`fa-banner ${timer <= 5 ? 'fa-banner-red' : 'fa-banner-amber'} flex-shrink-0`}>
                        <span className="material-symbols-outlined">brush</span>
                        {currentDrawer?.name || 'Un joueur'} ajoute un trait — un seul, sans lever le doigt
                        {impostorCount > 1 && (
                            <span className="fa-pill fa-pill-red ml-2">2 faussaires en jeu</span>
                        )}
                    </div>
                )}
            </Shell>
        );
    }

    /* ═══ VOTING ═════════════════════════════════════════════════════ */
    if (gameState === 'VOTING') {
        const voted = players.filter(p => p.hasVoted).length;
        const expected = connectedPlayers.length;

        return (
            <Shell stage>
                <TopBar
                    title="Délibération"
                    right={
                        <>
                            <span className="fa-pill fa-pill-cyan fa-pill-lg fa-mono">
                                {voted}/{expected} votes
                            </span>
                            <div className="flex items-center gap-3 w-52">
                                <div className="fa-timer-track flex-1">
                                    <div className={`fa-timer-fill ${timerClass}`} style={{ width: `${timerPct}%` }} />
                                </div>
                                <span className={`fa-timer-value text-2xl w-14 text-right ${timer <= 10 ? 'fa-timer-warn' : ''}`}>
                                    {Math.floor(timer / 60)}:{String(timer % 60).padStart(2, '0')}
                                </span>
                            </div>
                        </>
                    }
                />

                <div className="fa-stage">
                    <div className="flex flex-col gap-3 min-h-0">
                        <CanvasStage />
                        <div className="flex gap-3 flex-shrink-0">
                            <button
                                onClick={startReplay}
                                disabled={replaying}
                                className="fa-btn flex-1"
                            >
                                <span className="material-symbols-outlined text-[18px]">
                                    {replaying ? 'pause' : 'play_circle'}
                                </span>
                                {replaying ? 'Relecture en cours…' : 'Rejouer le dessin trait par trait'}
                            </button>
                            <button onClick={exportDrawing} className="fa-btn fa-btn-ghost" title="Enregistrer le dessin">
                                <span className="material-symbols-outlined text-[18px]">download</span>
                            </button>
                        </div>
                    </div>

                    <div className="fa-rail">
                        <div className="fa-card p-5 flex flex-col flex-1 min-h-0">
                            <h3 className="fa-h text-lg mb-4">Bulletins déposés</h3>
                            <div className="fa-rail-scroll">
                                {players.map(p => (
                                    <div
                                        key={p.id}
                                        className={`fa-player ${p.hasVoted ? 'fa-player-done' : ''} ${p.disconnected ? 'fa-player-out' : ''}`}
                                    >
                                        <img src={p.avatar} alt="" className="fa-avatar" />
                                        <span className="flex-1 min-w-0 font-bold text-[0.9375rem] truncate">{p.name}</span>
                                        <span className="fa-ink" style={{ backgroundColor: p.color?.value, color: p.color?.value }} />
                                        <span className={`material-symbols-outlined text-[22px] ${p.hasVoted ? 'fa-text-lime' : 'fa-text-dim'}`}>
                                            {p.hasVoted ? 'check_circle' : 'more_horiz'}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <button onClick={handleForceVote} className="fa-btn fa-btn-ghost w-full flex-shrink-0">
                            <span className="material-symbols-outlined text-[18px]">gavel</span>
                            Clore le vote maintenant
                        </button>
                    </div>
                </div>

                <div className="fa-banner fa-banner-cyan flex-shrink-0">
                    <span className="material-symbols-outlined">forum</span>
                    Débattez à voix haute, puis votez sur vos téléphones
                </div>
            </Shell>
        );
    }

    /* ═══ REVEAL — dépouillement ═════════════════════════════════════ */
    if (gameState === 'REVEAL') {
        const entries = Object.entries(voteTallies)
            .map(([id, count]) => ({ player: players.find(p => p.id === id), count }))
            .filter(e => e.player)
            .sort((a, b) => b.count - a.count);
        const top = entries[0]?.count || 1;

        return (
            <Shell stage>
                <TopBar
                    title="Dépouillement"
                    right={
                        <button onClick={handleSkipReveal} className="fa-btn fa-btn-ghost fa-btn-sm">
                            <span className="material-symbols-outlined text-[18px]">skip_next</span>
                            Passer
                        </button>
                    }
                />

                <div className="fa-stage">
                    <CanvasStage />

                    <div className="fa-rail">
                        <div className="fa-card p-5 flex flex-col flex-1 min-h-0">
                            <h3 className="fa-h text-lg mb-4">Les votes</h3>
                            <div className="fa-rail-scroll">
                                {entries.length === 0 ? (
                                    <p className="text-sm fa-text-muted text-center py-6">Aucun bulletin déposé.</p>
                                ) : entries.map((e, i) => (
                                    <div
                                        key={e.player.id}
                                        className={`fa-tally ${i === 0 && !isTie ? 'fa-tally-lead' : ''}`}
                                        style={{ animationDelay: `${i * 90}ms` }}
                                    >
                                        <img src={e.player.avatar} alt="" className="fa-avatar" />
                                        <div className="min-w-0 flex-1">
                                            <div className="font-bold text-[0.875rem] truncate mb-1.5">{e.player.name}</div>
                                            <div className="fa-tally-track">
                                                <div
                                                    className="fa-tally-bar"
                                                    style={{ width: tallyReady ? `${(e.count / top) * 100}%` : '0%' }}
                                                />
                                            </div>
                                        </div>
                                        <span className="fa-tally-count">{e.count}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Verdict du vote */}
                <div className="fa-card p-7 flex-shrink-0 fa-verdict text-center">
                    {isTie ? (
                        <>
                            <div className="fa-stamp fa-stamp-red text-2xl mb-4">Égalité</div>
                            <h2 className="fa-h text-3xl">Aucune majorité ne se dégage</h2>
                            <p className="text-base fa-text-muted mt-2">
                                Le doute profite au faussaire — il s'en sort.
                            </p>
                        </>
                    ) : (
                        <>
                            <div className="flex items-center justify-center gap-5 mb-4">
                                {accusedAvatar && (
                                    <img src={accusedAvatar} alt="" className="fa-avatar fa-avatar-lg" />
                                )}
                                <div className="text-left">
                                    <div className="fa-label fa-stage-label">Désigné à la majorité</div>
                                    <h2 className="fa-h text-4xl mt-1" style={{ color: accusedColor?.value }}>
                                        {accusedName}
                                    </h2>
                                </div>
                            </div>
                            <div className={`fa-stamp text-2xl ${isImpostorAccused ? 'fa-stamp-lime' : 'fa-stamp-red'}`}>
                                {isImpostorAccused ? 'Bien vu' : 'Erreur judiciaire'}
                            </div>
                            <p className="text-base fa-text-muted mt-4">
                                {isImpostorAccused
                                    ? 'C’était bien le faussaire. Il lui reste une chance de tout renverser…'
                                    : 'Un innocent condamné. Le faussaire jubile.'}
                            </p>
                        </>
                    )}
                </div>
            </Shell>
        );
    }

    /* ═══ GUESSING ═══════════════════════════════════════════════════ */
    if (gameState === 'GUESSING') {
        return (
            <Shell stage>
                <TopBar
                    title="Dernière chance du faussaire"
                    right={
                        !impostorGuess && (
                            <div className="flex items-center gap-3 w-44">
                                <div className="fa-timer-track flex-1">
                                    <div className={`fa-timer-fill ${timerClass}`} style={{ width: `${timerPct}%` }} />
                                </div>
                                <span className={`fa-timer-value text-2xl w-10 text-right ${timer <= 10 ? 'fa-timer-warn' : ''}`}>
                                    {timer}
                                </span>
                            </div>
                        )
                    }
                />

                <div className="fa-stage">
                    <CanvasStage />

                    <div className="fa-rail">
                        <div className="fa-card fa-card-accent-red p-6 flex-shrink-0 text-center">
                            <div className="fa-label fa-stage-label">Démasqué</div>
                            <h2 className="fa-h text-3xl fa-text-red mt-2">{accusedName}</h2>
                            <p className="text-sm fa-text-muted mt-2">
                                S'il devine le mot, il emporte la manche.
                            </p>
                        </div>

                        <div className="fa-card p-6 flex-1 flex flex-col justify-center gap-5 min-h-0">
                            {!impostorGuess ? (
                                <div className="text-center flex flex-col items-center gap-4">
                                    <div className="fa-spinner" />
                                    <p className="fa-h text-xl">Il réfléchit<span className="fa-dots" /></p>
                                    <p className="text-sm fa-text-muted">Sa proposition s'affichera ici</p>
                                </div>
                            ) : (
                                <>
                                    <div className="fa-word-slab">
                                        <div className="fa-label mb-2">Sa proposition</div>
                                        <div className="fa-word fa-text-red">{impostorGuess}</div>
                                    </div>

                                    <div className="fa-word-slab" style={{ borderColor: 'rgba(34,211,238,0.4)' }}>
                                        <div className="fa-label mb-2">Le mot était</div>
                                        <div className="fa-word fa-text-cyan">{secretWord}</div>
                                    </div>

                                    <div>
                                        <p className="text-sm fa-text-muted text-center mb-3">
                                            Vous arbitrez : la réponse compte-t-elle ?
                                        </p>
                                        <div className="grid grid-cols-2 gap-3">
                                            <button onClick={() => handleHostDecision(true)} className="fa-btn fa-btn-success">
                                                <span className="material-symbols-outlined text-[18px]">check</span>
                                                Correct
                                            </button>
                                            <button onClick={() => handleHostDecision(false)} className="fa-btn fa-btn-danger">
                                                <span className="material-symbols-outlined text-[18px]">close</span>
                                                Raté
                                            </button>
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </Shell>
        );
    }

    /* ═══ GAME_END ═══════════════════════════════════════════════════ */
    if (gameState === 'GAME_END') {
        const impostorWon = winner === 'impostor';
        const ranked = [...players].sort((a, b) => b.score - a.score);
        const impostorIds = new Set(impostors.map(i => i.id));

        const reasonText = {
            'tie': 'Aucune majorité : le doute lui a profité.',
            'wrong-accusation': 'Les artistes ont accusé un innocent.',
            'impostor-guessed': 'Démasqué, mais il a trouvé le mot.',
            'impostor-failed': 'Démasqué, et incapable de trouver le mot.'
        }[endReason] || '';

        return (
            <Shell stage>
                <TopBar
                    title="Fin de manche"
                    right={<span className="fa-pill fa-pill-amber fa-pill-lg">Manche {matchNumber}</span>}
                />

                <div className="fa-stage">
                    <div className="flex flex-col gap-3 min-h-0">
                        <CanvasStage />
                        <button onClick={exportDrawing} className="fa-btn fa-btn-ghost flex-shrink-0">
                            <span className="material-symbols-outlined text-[18px]">download</span>
                            Enregistrer le dessin
                        </button>
                    </div>

                    <div className="fa-rail">
                        {/* Vainqueur */}
                        <div className={`fa-card p-6 text-center flex-shrink-0 fa-verdict ${impostorWon ? 'fa-card-accent-red' : 'fa-card-accent-lime'}`}>
                            <div className={`fa-stamp text-xl mb-4 ${impostorWon ? 'fa-stamp-red' : 'fa-stamp-lime'}`}>
                                {impostorWon ? 'Le faussaire' : 'Les artistes'}
                            </div>
                            <p className="text-sm fa-text-muted">{reasonText}</p>

                            <div className="fa-word-slab mt-5">
                                <div className="fa-label mb-2">Le mot secret</div>
                                <div className="fa-word fa-text-cyan">{secretWord}</div>
                            </div>

                            {impostors.length > 0 && (
                                <div className="mt-4">
                                    <div className="fa-label mb-2.5">
                                        {impostors.length > 1 ? 'Les faussaires étaient' : 'Le faussaire était'}
                                    </div>
                                    <div className="flex items-center justify-center gap-3 flex-wrap">
                                        {impostors.map(i => (
                                            <div key={i.id} className="flex items-center gap-2 fa-pill fa-pill-red fa-pill-lg">
                                                <img src={i.avatar} alt="" className="w-7 h-7 rounded-lg object-cover" />
                                                {i.name}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Classement */}
                        <div className="fa-card p-5 flex flex-col flex-1 min-h-0">
                            <h3 className="fa-h text-lg mb-4">Classement</h3>
                            <div className="fa-rail-scroll">
                                {ranked.map((p, idx) => (
                                    <div key={p.id} className="fa-player">
                                        <span className="fa-order">{idx + 1}</span>
                                        <img src={p.avatar} alt="" className="fa-avatar" />
                                        <div className="flex-1 min-w-0">
                                            <div className="font-bold text-[0.9375rem] truncate flex items-center gap-2">
                                                {p.name}
                                                {impostorIds.has(p.id) && (
                                                    <span className="fa-pill fa-pill-red !py-0.5 !px-2 !text-[0.625rem]">faussaire</span>
                                                )}
                                            </div>
                                            {p.roundScore > 0 && (
                                                <div className="text-[0.6875rem] fa-text-lime fa-mono">+{p.roundScore}</div>
                                            )}
                                        </div>
                                        <span className="fa-mono font-bold text-lg">{p.score}</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="flex gap-3 flex-shrink-0">
                            <button onClick={() => handleRestartGame(false)} className="fa-btn fa-btn-primary flex-1">
                                <span className="material-symbols-outlined text-[18px]">replay</span>
                                Manche suivante
                            </button>
                            <button
                                onClick={() => handleRestartGame(true)}
                                className="fa-btn fa-btn-ghost"
                                title="Repartir de zéro"
                            >
                                <span className="material-symbols-outlined text-[18px]">restart_alt</span>
                            </button>
                        </div>
                    </div>
                </div>
            </Shell>
        );
    }

    return null;
}

export default FakeArtistHostView;
