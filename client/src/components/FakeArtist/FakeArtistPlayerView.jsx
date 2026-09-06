import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { socket } from '../../socket';
import { playCountdownSound, playSuccessSound, playFailSound, playWinnerSound } from '../../utils/audio';
import './FakeArtistStyles.css';

const ALL_AVATARS = Array.from({ length: 60 }, (_, i) => `/avatars/avatar_${i + 1}.webp`);
const SESSION_KEY = 'fakeartist-session';
const LIVE_THROTTLE_MS = 45;   // cadence d'envoi du tracé en direct
const STROKE_SIZE = 8;

/** Trace un tracé normalisé sur un contexte 2D. */
function paintStroke(ctx, canvas, stroke) {
    if (!stroke?.points?.length) return;
    ctx.strokeStyle = stroke.color || '#1a1a1a';
    ctx.lineWidth = stroke.size || STROKE_SIZE;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    stroke.points.forEach((pt, i) => {
        const x = pt.x * canvas.width;
        const y = pt.y * canvas.height;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });
    if (stroke.points.length === 1) {
        ctx.lineTo(stroke.points[0].x * canvas.width + 0.1, stroke.points[0].y * canvas.height + 0.1);
    }
    ctx.stroke();
}

function FakeArtistPlayerView() {
    const navigate = useNavigate();
    const { roomCode: urlRoomCode } = useParams();

    // Identité
    const [playerName, setPlayerName] = useState('');
    const [avatar, setAvatar] = useState(ALL_AVATARS[0]);
    const [roomCode, setRoomCode] = useState(urlRoomCode || '');
    const [isJoined, setIsJoined] = useState(false);
    const [joining, setJoining] = useState(false);
    const [error, setError] = useState('');

    // Partie
    const [gameState, setGameState] = useState('LOBBY');
    const [players, setPlayers] = useState([]);
    const [role, setRole] = useState(null);
    const [secretWord, setSecretWord] = useState(null);
    const [category, setCategory] = useState(null);
    const [hint, setHint] = useState(null);
    const [playerColor, setPlayerColor] = useState(null);
    const [impostorCount, setImpostorCount] = useState(1);
    const [myScore, setMyScore] = useState(0);

    // Dessin
    const [currentDrawerId, setCurrentDrawerId] = useState(null);
    const [currentRound, setCurrentRound] = useState(0);
    const [totalRounds, setTotalRounds] = useState(0);
    const [hasDrawnStroke, setHasDrawnStroke] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    // Minuteur
    const [timer, setTimer] = useState(0);
    const [timerPct, setTimerPct] = useState(100);

    // Vote
    const [votedId, setVotedId] = useState(null);
    const [accusedName, setAccusedName] = useState('');
    const [isTie, setIsTie] = useState(false);
    const [isImpostorAccused, setIsImpostorAccused] = useState(false);
    const [voteTallies, setVoteTallies] = useState({});

    // Devinette
    const [guessInput, setGuessInput] = useState('');
    const [guessSubmitted, setGuessSubmitted] = useState(false);
    const [isGuessingImpostor, setIsGuessingImpostor] = useState(false);

    // Fin
    const [winner, setWinner] = useState(null);
    const [impostors, setImpostors] = useState([]);
    const [endReason, setEndReason] = useState(null);

    // Connectivité
    const [hostGone, setHostGone] = useState(false);
    const [offline, setOffline] = useState(false);
    const [toast, setToast] = useState(null);

    const canvasRef = useRef(null);
    const canvasContextRef = useRef(null);
    const timerRef = useRef(null);
    const strokesHistoryRef = useRef([]);
    const strokePointsRef = useRef([]);
    const isDrawingRef = useRef(false);
    const lastLiveSentRef = useRef(0);
    const roleRef = useRef(null);

    useEffect(() => { roleRef.current = role; }, [role]);

    const isMyTurn = currentDrawerId === socket.id;

    useEffect(() => {
        document.body.classList.add('fa-noir');
        return () => {
            document.body.classList.remove('fa-noir');
            if (timerRef.current) clearInterval(timerRef.current);
        };
    }, []);

    /* ─── Minuteur ─────────────────────────────────────────────────── */

    const startTimer = useCallback((duration, startTime, graceMs = 0) => {
        if (timerRef.current) clearInterval(timerRef.current);
        if (!duration || !startTime) { setTimer(0); return; }

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

    /* ─── Canevas ──────────────────────────────────────────────────── */

    const initAndDrawHistory = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const r = canvas.getBoundingClientRect();
        if (r.width < 10 || r.height < 10) return;

        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.round(r.width * dpr);
        canvas.height = Math.round(r.height * dpr);

        const ctx = canvas.getContext('2d');
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        canvasContextRef.current = ctx;

        ctx.fillStyle = '#FDFCF7';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        strokesHistoryRef.current.forEach(s => paintStroke(ctx, canvas, s));

        // Redessiner le trait en cours si le joueur avait commencé
        if (strokePointsRef.current.length > 0) {
            paintStroke(ctx, canvas, {
                color: playerColor?.value,
                size: STROKE_SIZE,
                points: strokePointsRef.current
            });
        }
    }, [playerColor]);

    useEffect(() => {
        if (gameState !== 'PLAYING') return;
        const raf = requestAnimationFrame(() => initAndDrawHistory());
        const onResize = () => initAndDrawHistory();
        window.addEventListener('resize', onResize);
        window.addEventListener('orientationchange', onResize);
        return () => {
            cancelAnimationFrame(raf);
            window.removeEventListener('resize', onResize);
            window.removeEventListener('orientationchange', onResize);
        };
    }, [gameState, initAndDrawHistory]);

    /* ─── Connexion ────────────────────────────────────────────────── */

    const doJoin = useCallback((code, name, userAvatar, silent = false) => {
        if (!name?.trim() || !code?.trim()) return;
        if (!silent) { setError(''); setJoining(true); }

        socket.emit('fakeartist-join-room', {
            roomCode: code.toUpperCase(),
            playerName: name.trim(),
            avatar: userAvatar
        }, (response) => {
            setJoining(false);
            if (response.error) {
                if (!silent) {
                    setError(response.error);
                    localStorage.removeItem(SESSION_KEY);
                }
                return;
            }

            setIsJoined(true);
            setHostGone(false);
            localStorage.setItem(SESSION_KEY, JSON.stringify({
                name: name.trim(),
                avatar: userAvatar,
                roomCode: code.toUpperCase(),
                isJoined: true
            }));

            setGameState(response.gameState);
            if (response.color) setPlayerColor(response.color);
            if (response.players) setPlayers(response.players);
            if (response.myScore !== undefined) setMyScore(response.myScore);

            if (response.reconnected) {
                setRole(response.role);
                roleRef.current = response.role;
                setSecretWord(response.secretWord);
                setCategory(response.category);
                setImpostorCount(response.impostorCount || 1);
                setCurrentRound(response.currentRound);
                setTotalRounds(response.totalRounds);
                setCurrentDrawerId(response.currentDrawerId);
                setVotedId(response.votedId || null);
                setAccusedName(response.accusedName || '');
                setIsGuessingImpostor(!!response.isGuessingImpostor);
                setGuessSubmitted(!!response.impostorGuess);
                if (response.impostorGuess) setGuessInput(response.impostorGuess);
                setWinner(response.winner || null);
                strokesHistoryRef.current = response.canvasHistory || [];

                const st = response.gameState;
                if (st === 'PLAYING') {
                    startTimer(response.timePerRound, response.turnStartTime);
                } else if (st === 'VOTING') {
                    startTimer(response.voteDuration, response.voteStartTime);
                } else if (st === 'GUESSING') {
                    startTimer(response.guessDuration, response.guessStartTime);
                }
                requestAnimationFrame(() => initAndDrawHistory());
            }
        });
    }, [startTimer, initAndDrawHistory]);

    // Reprise de session au montage
    useEffect(() => {
        const stored = localStorage.getItem(SESSION_KEY);
        if (stored) {
            try {
                const session = JSON.parse(stored);
                if (session.name) setPlayerName(session.name);
                if (session.avatar) setAvatar(session.avatar);
                const rc = urlRoomCode || session.roomCode;
                if (rc) setRoomCode(rc.toUpperCase());
                if (session.isJoined && rc && session.name) {
                    doJoin(rc, session.name, session.avatar);
                }
            } catch { /* ignore */ }
        } else if (urlRoomCode) {
            setRoomCode(urlRoomCode.toUpperCase());
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [urlRoomCode]);

    // Reconnexion socket
    useEffect(() => {
        const handleConnect = () => {
            setOffline(false);
            const stored = localStorage.getItem(SESSION_KEY);
            if (!stored) return;
            try {
                const session = JSON.parse(stored);
                if (session.isJoined && session.roomCode && session.name) {
                    doJoin(session.roomCode, session.name, session.avatar, true);
                }
            } catch { /* ignore */ }
        };
        const handleDisconnect = () => setOffline(true);

        socket.on('connect', handleConnect);
        socket.on('disconnect', handleDisconnect);
        return () => {
            socket.off('connect', handleConnect);
            socket.off('disconnect', handleDisconnect);
        };
    }, [doJoin]);

    /* ─── Écouteurs de jeu ─────────────────────────────────────────── */

    useEffect(() => {
        if (!isJoined) return;

        const handlePlayersUpdated = (list) => {
            setPlayers(list);
            const me = list.find(p => p.id === socket.id);
            if (me) {
                setMyScore(me.score);
                if (me.color) setPlayerColor(me.color);
            }
        };

        const handleRoleAssigned = (data) => {
            playCountdownSound();
            setRole(data.role);
            roleRef.current = data.role;
            setSecretWord(data.secretWord);
            setCategory(data.category);
            setHint(data.hint || null);
            setPlayerColor(data.color);
            setImpostorCount(data.impostorCount || 1);
            setGameState('ROLE_REVEAL');
            strokesHistoryRef.current = [];
            strokePointsRef.current = [];
            setHasDrawnStroke(false);
            setVotedId(null);
            setGuessSubmitted(false);
            setGuessInput('');
            setIsGuessingImpostor(false);
            setWinner(null);
            setImpostors([]);
            setVoteTallies({});
            stopTimer();
            if (navigator.vibrate) navigator.vibrate(30);
        };

        const handleTurnUpdated = (data) => {
            const mine = data.currentDrawerId === socket.id;
            setCurrentDrawerId(data.currentDrawerId);
            setCurrentRound(data.currentRound);
            strokesHistoryRef.current = data.canvasHistory || [];
            strokePointsRef.current = [];
            isDrawingRef.current = false;
            setHasDrawnStroke(false);
            setSubmitting(false);
            startTimer(data.timePerRound, data.turnStartTime, data.graceMs || 0);
            requestAnimationFrame(() => initAndDrawHistory());
            if (mine) {
                playSuccessSound();
                if (navigator.vibrate) navigator.vibrate([20, 60, 20]);
            }
        };

        const handleGameStateUpdated = (data) => {
            setGameState(data.gameState);
            if (data.players) {
                setPlayers(data.players);
                const me = data.players.find(p => p.id === socket.id);
                if (me) setMyScore(me.score);
            }
            if (data.canvasHistory) {
                strokesHistoryRef.current = data.canvasHistory;
                requestAnimationFrame(() => initAndDrawHistory());
            }

            if (data.gameState === 'PLAYING') {
                setCurrentDrawerId(data.currentDrawerId);
                setCurrentRound(data.currentRound);
                setTotalRounds(data.totalRounds);
                startTimer(data.timePerRound, data.turnStartTime, 5000);
            } else if (data.gameState === 'VOTING') {
                playCountdownSound();
                stopTimer();
                startTimer(data.voteDuration, data.voteStartTime);
            } else if (data.gameState === 'REVEAL') {
                stopTimer();
                setIsTie(!!data.isTie);
                setAccusedName(data.accusedName || '');
                setIsImpostorAccused(!!data.isImpostorAccused);
                setVoteTallies(data.voteTallies || {});
            } else if (data.gameState === 'GUESSING') {
                setAccusedName(data.accusedName || '');
                setIsGuessingImpostor(data.accusedId === socket.id);
                startTimer(data.guessDuration, data.guessStartTime);
                if (data.accusedId === socket.id) {
                    playFailSound();
                    if (navigator.vibrate) navigator.vibrate([50, 80, 50]);
                } else {
                    playSuccessSound();
                }
            } else if (data.gameState === 'GAME_END') {
                stopTimer();
                setWinner(data.winner);
                setEndReason(data.reason);
                setSecretWord(data.secretWord);
                setImpostors(data.impostors || []);
                const iAmImpostor = roleRef.current === 'impostor';
                const iWon = (data.winner === 'impostor') === iAmImpostor;
                if (iWon) {
                    playWinnerSound();
                    if (navigator.vibrate) navigator.vibrate([30, 50, 30, 50, 80]);
                } else {
                    playFailSound();
                }
            } else if (data.gameState === 'LOBBY') {
                stopTimer();
                strokesHistoryRef.current = [];
                strokePointsRef.current = [];
                setRole(null);
                roleRef.current = null;
                setSecretWord(null);
                setVotedId(null);
                setWinner(null);
                setImpostors([]);
                setGuessInput('');
                setGuessSubmitted(false);
            }
        };

        const handleGuessSubmitted = () => setGuessSubmitted(true);

        const handleHostDisconnected = () => setHostGone(true);
        const handleHostReconnected = () => setHostGone(false);

        const handleRoomDeleted = () => {
            setError('La table a été fermée par l\'hôte.');
            setIsJoined(false);
            stopTimer();
            localStorage.removeItem(SESSION_KEY);
        };

        const handleError = ({ message }) => setToast(message || 'Erreur');

        socket.on('fakeartist-players-updated', handlePlayersUpdated);
        socket.on('fakeartist-role-assigned', handleRoleAssigned);
        socket.on('fakeartist-turn-updated', handleTurnUpdated);
        socket.on('fakeartist-game-state-updated', handleGameStateUpdated);
        socket.on('fakeartist-guess-submitted', handleGuessSubmitted);
        socket.on('fakeartist-host-disconnected', handleHostDisconnected);
        socket.on('fakeartist-host-reconnected', handleHostReconnected);
        socket.on('fakeartist-room-deleted', handleRoomDeleted);
        socket.on('fakeartist-error', handleError);

        return () => {
            socket.off('fakeartist-players-updated', handlePlayersUpdated);
            socket.off('fakeartist-role-assigned', handleRoleAssigned);
            socket.off('fakeartist-turn-updated', handleTurnUpdated);
            socket.off('fakeartist-game-state-updated', handleGameStateUpdated);
            socket.off('fakeartist-guess-submitted', handleGuessSubmitted);
            socket.off('fakeartist-host-disconnected', handleHostDisconnected);
            socket.off('fakeartist-host-reconnected', handleHostReconnected);
            socket.off('fakeartist-room-deleted', handleRoomDeleted);
            socket.off('fakeartist-error', handleError);
        };
    }, [isJoined, startTimer, stopTimer, initAndDrawHistory]);

    useEffect(() => {
        if (!toast) return;
        const t = setTimeout(() => setToast(null), 3200);
        return () => clearTimeout(t);
    }, [toast]);

    /* ─── Dessin ───────────────────────────────────────────────────── */

    const getCanvasCoords = (e) => {
        const canvas = canvasRef.current;
        const rect = canvas.getBoundingClientRect();
        const src = e.touches?.[0] || e.changedTouches?.[0] || e;
        return {
            x: Math.min(1, Math.max(0, (src.clientX - rect.left) / rect.width)),
            y: Math.min(1, Math.max(0, (src.clientY - rect.top) / rect.height))
        };
    };

    /** Envoie le tracé en cours à l'hôte, au plus une fois par LIVE_THROTTLE_MS. */
    const emitLive = useCallback((force = false) => {
        const now = Date.now();
        if (!force && now - lastLiveSentRef.current < LIVE_THROTTLE_MS) return;
        lastLiveSentRef.current = now;
        socket.emit('fakeartist-draw-stroke-live', {
            roomCode,
            stroke: {
                color: playerColor?.value,
                size: STROKE_SIZE,
                points: strokePointsRef.current
            }
        });
    }, [roomCode, playerColor]);

    const handleDrawStart = (e) => {
        if (!isMyTurn || hasDrawnStroke || submitting) return;
        e.preventDefault();
        isDrawingRef.current = true;

        const coords = getCanvasCoords(e);
        strokePointsRef.current = [coords];

        const ctx = canvasContextRef.current;
        const canvas = canvasRef.current;
        if (ctx && canvas) {
            paintStroke(ctx, canvas, { color: playerColor?.value, size: STROKE_SIZE, points: [coords] });
        }
        emitLive(true);
    };

    const handleDrawMove = (e) => {
        if (!isDrawingRef.current || !isMyTurn || hasDrawnStroke) return;
        e.preventDefault();

        const coords = getCanvasCoords(e);
        const prev = strokePointsRef.current[strokePointsRef.current.length - 1];
        if (!prev) return;

        // Ignorer les micro-déplacements : moins de points, tracé plus fluide
        if (Math.abs(coords.x - prev.x) < 0.002 && Math.abs(coords.y - prev.y) < 0.002) return;

        strokePointsRef.current.push(coords);

        const ctx = canvasContextRef.current;
        const canvas = canvasRef.current;
        if (ctx && canvas) {
            ctx.strokeStyle = playerColor?.value || '#1a1a1a';
            ctx.lineWidth = STROKE_SIZE;
            ctx.beginPath();
            ctx.moveTo(prev.x * canvas.width, prev.y * canvas.height);
            ctx.lineTo(coords.x * canvas.width, coords.y * canvas.height);
            ctx.stroke();
        }
        emitLive();
    };

    const handleDrawEnd = () => {
        if (!isDrawingRef.current || !isMyTurn || hasDrawnStroke) return;
        isDrawingRef.current = false;
        if (strokePointsRef.current.length > 0) {
            setHasDrawnStroke(true);
            emitLive(true); // garantir que l'hôte a bien le tracé complet
        }
    };

    const handleClearStroke = () => {
        strokePointsRef.current = [];
        isDrawingRef.current = false;
        setHasDrawnStroke(false);
        initAndDrawHistory();
        socket.emit('fakeartist-clear-stroke-live', { roomCode });
    };

    const handleValidateStroke = () => {
        if (strokePointsRef.current.length === 0 || submitting) return;
        setSubmitting(true);

        socket.emit('fakeartist-validate-stroke', {
            roomCode,
            stroke: { size: STROKE_SIZE, points: strokePointsRef.current }
        }, (res) => {
            if (res?.error) {
                // Le serveur a refusé : on rend la main au joueur plutôt que
                // de le laisser bloqué sur un écran inerte.
                setSubmitting(false);
                setToast(res.error);
                return;
            }
            setHasDrawnStroke(false);
            strokePointsRef.current = [];
        });
    };

    /* ─── Vote & devinette ─────────────────────────────────────────── */

    const handleVote = (candidateId) => {
        if (votedId) return;
        socket.emit('fakeartist-submit-vote', { roomCode, votedId: candidateId }, (res) => {
            if (res?.error) { setToast(res.error); return; }
            setVotedId(candidateId);
            if (navigator.vibrate) navigator.vibrate(20);
        });
    };

    const handleImpostorGuess = (e) => {
        e.preventDefault();
        if (!guessInput.trim() || guessSubmitted) return;
        socket.emit('fakeartist-submit-guess', { roomCode, guess: guessInput.trim() }, (res) => {
            if (res?.error) { setToast(res.error); return; }
            setGuessSubmitted(true);
        });
    };

    /** Le joueur a lu son rôle : on prévient le serveur et on passe au jeu. */
    const handleConfirmRole = () => {
        setGameState('PLAYING');
        socket.emit('fakeartist-confirm-role', { roomCode }, () => { /* le serveur diffuse le compteur */ });
    };

    const handleLeave = () => {
        localStorage.removeItem(SESSION_KEY);
        setIsJoined(false);
        stopTimer();
        navigate('/fakeartist');
    };

    /* ─── Enveloppe commune ────────────────────────────────────────── */

    const timerClass = timerPct > 50 ? 'fa-timer-ok' : timerPct > 22 ? 'fa-timer-mid' : 'fa-timer-low';

    const Shell = ({ children, className = '' }) => (
        <div className={`fa-app min-h-screen flex flex-col ${className}`}>
            {children}

            {(hostGone || offline) && (
                <div className="fa-overlay">
                    <div className="fa-card p-7 text-center max-w-xs flex flex-col items-center gap-4">
                        <div className="fa-spinner" />
                        <h3 className="fa-h text-lg">
                            {offline ? 'Connexion perdue' : 'L\'hôte s\'est déconnecté'}
                        </h3>
                        <p className="text-sm fa-text-muted">
                            {offline
                                ? <>Reconnexion en cours<span className="fa-dots" /></>
                                : <>La partie reprendra dès son retour<span className="fa-dots" /></>}
                        </p>
                    </div>
                </div>
            )}

            {toast && (
                <div className="fixed bottom-24 left-4 right-4 z-[95] fa-card px-4 py-3 text-sm font-semibold text-center">
                    {toast}
                </div>
            )}
        </div>
    );

    /* ═══ CONNEXION ══════════════════════════════════════════════════ */
    if (!isJoined) {
        return (
            <Shell className="items-center justify-center p-5">
                <div className="fa-orb fa-orb-a" style={{ width: 320, height: 320, top: '-8%', left: '-14%' }} />

                <div className="w-full max-w-sm relative z-10 my-auto">
                    <div className="text-center mb-6">
                        <div className="fa-label mb-2">Bureau des faussaires</div>
                        <h1 className="fa-h text-4xl">
                            <span className="fa-title-glow">Fake</span> Artist
                        </h1>
                    </div>

                    <div className="fa-card p-5 flex flex-col gap-4">
                        {error && (
                            <div className="fa-card-inset fa-card-accent-red p-3.5 text-sm font-semibold fa-text-red fa-shake">
                                {error}
                            </div>
                        )}

                        <div>
                            <label className="fa-label block mb-1.5">Votre pseudo</label>
                            <input
                                type="text"
                                className="fa-input"
                                placeholder="Comment on vous appelle ?"
                                value={playerName}
                                onChange={e => setPlayerName(e.target.value)}
                                maxLength={14}
                                autoComplete="off"
                            />
                        </div>

                        <div>
                            <label className="fa-label block mb-1.5">Code de la table</label>
                            <input
                                type="text"
                                inputMode="text"
                                className="fa-input fa-input-code"
                                placeholder="······"
                                value={roomCode}
                                onChange={e => setRoomCode(e.target.value.toUpperCase().slice(0, 6))}
                                maxLength={6}
                                autoComplete="off"
                            />
                        </div>

                        <div>
                            <label className="fa-label block mb-1.5">Votre visage</label>
                            <div className="fa-avatar-grid">
                                {ALL_AVATARS.map(a => (
                                    <button
                                        key={a}
                                        type="button"
                                        onClick={() => setAvatar(a)}
                                        className={`fa-avatar-pick ${avatar === a ? 'fa-avatar-pick-on' : ''}`}
                                    >
                                        <img src={a} alt="" loading="lazy" />
                                    </button>
                                ))}
                            </div>
                        </div>

                        <button
                            onClick={() => doJoin(roomCode, playerName, avatar)}
                            disabled={!playerName.trim() || roomCode.trim().length < 4 || joining}
                            className="fa-btn fa-btn-primary fa-btn-lg w-full"
                        >
                            {joining ? 'Connexion…' : 'Prendre place'}
                        </button>
                    </div>

                    <button onClick={() => navigate('/fakeartist')} className="fa-btn fa-btn-ghost fa-btn-sm mx-auto mt-5 flex">
                        <span className="material-symbols-outlined text-[16px]">arrow_back</span>
                        Retour
                    </button>
                </div>
            </Shell>
        );
    }

    /* ═══ LOBBY ══════════════════════════════════════════════════════ */
    if (gameState === 'LOBBY') {
        return (
            <Shell className="p-5">
                <header className="flex items-center justify-between flex-shrink-0 pt-2">
                    <span className="fa-pill fa-pill-amber fa-mono">{roomCode}</span>
                    <button onClick={handleLeave} className="fa-btn fa-btn-ghost fa-btn-sm">
                        Quitter
                    </button>
                </header>

                <div className="flex-1 flex flex-col items-center justify-center gap-6 py-8">
                    <div className="text-center">
                        <img src={avatar} alt="" className="fa-avatar fa-avatar-xl mx-auto mb-4" />
                        <h2 className="fa-h text-2xl">{playerName}</h2>
                        {playerColor && (
                            <div className="fa-pill mt-3 mx-auto w-fit">
                                <span
                                    className="fa-ink"
                                    style={{ backgroundColor: playerColor.value, color: playerColor.value }}
                                />
                                Votre encre : {playerColor.name}
                            </div>
                        )}
                    </div>

                    <div className="fa-card p-5 w-full max-w-sm">
                        <div className="flex items-baseline justify-between mb-3.5">
                            <h3 className="fa-h text-base">À table</h3>
                            <span className="fa-mono text-sm fa-text-amber">{players.length}</span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {players.map(p => (
                                <div
                                    key={p.id}
                                    className={`fa-pill !py-1.5 !pl-1.5 ${p.disconnected ? 'opacity-40' : ''}`}
                                >
                                    <img src={p.avatar} alt="" className="w-6 h-6 rounded-md object-cover" />
                                    {p.name}
                                    <span
                                        className="fa-ink !w-2.5 !h-2.5"
                                        style={{ backgroundColor: p.color?.value, color: p.color?.value }}
                                    />
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="flex items-center gap-2.5 fa-text-muted text-sm">
                        <div className="fa-spinner !w-4 !h-4 !border-2" />
                        En attente du lancement<span className="fa-dots" />
                    </div>
                </div>

                <p className="text-center text-xs fa-text-dim pb-3 flex-shrink-0">
                    Gardez votre écran pour vous — il contiendra bientôt un secret.
                </p>
            </Shell>
        );
    }

    /* ═══ ROLE_REVEAL ════════════════════════════════════════════════ */
    if (gameState === 'ROLE_REVEAL') {
        const isImpostor = role === 'impostor';

        return (
            <Shell className="p-5 justify-center">
                <div className="w-full max-w-sm mx-auto">
                    <p className="fa-label text-center mb-4">
                        <span className="material-symbols-outlined text-[14px] align-middle mr-1">lock</span>
                        Pour vos yeux uniquement
                    </p>

                    <div className={`fa-card fa-role-card p-7 text-center flex flex-col items-center gap-6 ${isImpostor ? 'fa-role-impostor' : 'fa-role-artist'}`}>
                        <div>
                            <div className="fa-label mb-2">Votre rôle</div>
                            <h2 className={`fa-h text-4xl ${isImpostor ? 'fa-text-red' : 'fa-text-cyan'}`}>
                                {isImpostor ? 'Le faussaire' : 'Artiste'}
                            </h2>
                            {isImpostor && impostorCount > 1 && (
                                <div className="fa-pill fa-pill-red mt-3">
                                    Vous n'êtes pas seul — 2 faussaires
                                </div>
                            )}
                        </div>

                        <div className="fa-word-slab w-full">
                            <div className="fa-label mb-2">
                                {isImpostor ? 'Le mot vous échappe' : 'Le mot à dessiner'}
                            </div>
                            {isImpostor ? (
                                <div className="fa-word-hidden">?</div>
                            ) : (
                                <div className="fa-word fa-text-cyan">{secretWord}</div>
                            )}
                            <div className="fa-pill fa-pill-amber mt-4">{category}</div>
                            {isImpostor && hint && (
                                <p className="text-xs fa-text-muted mt-3">Indice : {hint}</p>
                            )}
                        </div>

                        <p className="text-sm fa-text-muted leading-relaxed">
                            {isImpostor
                                ? "Vous ignorez le mot. Observez les autres, tracez juste ce qu'il faut pour ne pas détonner — et devinez."
                                : "Prouvez que vous savez, sans être trop clair : le faussaire vous regarde dessiner."}
                        </p>

                        <div className="fa-pill w-full justify-center">
                            <span
                                className="fa-ink fa-ink-lg"
                                style={{ backgroundColor: playerColor?.value, color: playerColor?.value }}
                            />
                            Votre encre : {playerColor?.name}
                        </div>

                        <button
                            onClick={handleConfirmRole}
                            className="fa-btn fa-btn-primary fa-btn-lg w-full"
                        >
                            C'est noté
                        </button>
                    </div>
                </div>
            </Shell>
        );
    }

    /* ═══ PLAYING ════════════════════════════════════════════════════ */
    if (gameState === 'PLAYING') {
        const activeDrawer = players.find(p => p.id === currentDrawerId);
        const others = players.filter(p => p.id !== socket.id);

        return (
            <Shell className="h-screen overflow-hidden">
                {/* En-tête */}
                <header className="flex items-center justify-between px-4 py-2.5 flex-shrink-0 border-b border-[var(--fa-line)]">
                    <div className="flex items-center gap-2">
                        <span className="fa-pill !py-1 !px-2.5 !text-[0.6875rem] fa-mono">
                            {currentRound}/{totalRounds}
                        </span>
                        <span className="fa-pill fa-pill-amber !py-1 !px-2.5 !text-[0.6875rem]">
                            {category}
                        </span>
                    </div>
                    <div className="text-right">
                        <div className="fa-label !text-[0.5625rem]">Votre mot</div>
                        <div className={`text-sm font-bold ${role === 'impostor' ? 'fa-text-red' : 'fa-text-cyan'}`}>
                            {role === 'impostor' ? '???' : secretWord}
                        </div>
                    </div>
                </header>

                {/* Barre de tour + minuteur */}
                <div className={`px-4 py-3 flex-shrink-0 ${isMyTurn ? 'bg-[rgba(245,165,36,0.12)]' : ''}`}>
                    <div className="flex items-center justify-between gap-3 mb-2">
                        <span className="font-bold text-sm truncate">
                            {isMyTurn
                                ? '✍️ À vous — un seul trait'
                                : `${activeDrawer?.name || 'Quelqu\'un'} dessine…`}
                        </span>
                        <span className={`fa-timer-value text-lg ${timer <= 5 ? 'fa-timer-danger' : timer <= 10 ? 'fa-timer-warn' : ''}`}>
                            {timer}s
                        </span>
                    </div>
                    <div className="fa-timer-track">
                        <div className={`fa-timer-fill ${timerClass}`} style={{ width: `${timerPct}%` }} />
                    </div>
                </div>

                {/* Zone centrale */}
                {isMyTurn ? (
                    <>
                        <div className="flex-1 min-h-0 flex items-center justify-center p-3">
                            <div
                                className="fa-canvas-sheet"
                                style={{ '--fa-ink': playerColor?.value }}
                            >
                                <canvas
                                    ref={canvasRef}
                                    className="fa-canvas fa-canvas--draw"
                                    onMouseDown={handleDrawStart}
                                    onMouseMove={handleDrawMove}
                                    onMouseUp={handleDrawEnd}
                                    onMouseLeave={handleDrawEnd}
                                    onTouchStart={handleDrawStart}
                                    onTouchMove={handleDrawMove}
                                    onTouchEnd={handleDrawEnd}
                                    onTouchCancel={handleDrawEnd}
                                />
                            </div>
                        </div>

                        <div className="fa-draw-bar flex-shrink-0">
                            {hasDrawnStroke ? (
                                <>
                                    <button onClick={handleClearStroke} disabled={submitting} className="fa-btn flex-1">
                                        <span className="material-symbols-outlined text-[18px]">undo</span>
                                        Recommencer
                                    </button>
                                    <button
                                        onClick={handleValidateStroke}
                                        disabled={submitting}
                                        className="fa-btn fa-btn-primary flex-[1.4]"
                                    >
                                        <span className="material-symbols-outlined text-[18px]">check</span>
                                        {submitting ? 'Envoi…' : 'Valider'}
                                    </button>
                                </>
                            ) : (
                                <div className="fa-hint flex-1">
                                    Posez le doigt et tracez — un trait continu, sans lever
                                </div>
                            )}
                        </div>
                    </>
                ) : (
                    /* Spectateur : plutôt que de fixer un dessin figé, on prépare l'enquête */
                    <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 flex flex-col gap-4">
                        <div className="fa-card p-4">
                            <h3 className="fa-h text-base mb-3">Qui dessine avec quelle encre</h3>
                            <div className="flex flex-col gap-2">
                                {others.map(p => (
                                    <div
                                        key={p.id}
                                        className={`fa-player ${p.id === currentDrawerId ? 'fa-player-active' : ''} ${p.disconnected ? 'fa-player-out' : ''}`}
                                    >
                                        <img src={p.avatar} alt="" className="fa-avatar" />
                                        <div className="flex-1 min-w-0">
                                            <div className="font-bold text-sm truncate">{p.name}</div>
                                            {p.id === currentDrawerId && (
                                                <div className="text-[0.625rem] font-bold fa-text-amber uppercase tracking-wide">
                                                    en train de tracer<span className="fa-dots" />
                                                </div>
                                            )}
                                        </div>
                                        <span
                                            className="fa-ink fa-ink-lg"
                                            style={{ backgroundColor: p.color?.value, color: p.color?.value }}
                                        />
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="fa-card-inset p-4">
                            <div className="fa-label mb-2">Pendant ce temps</div>
                            <p className="text-sm fa-text-muted leading-relaxed">
                                {role === 'impostor'
                                    ? "Regardez le grand écran et devinez ce qui se dessine. Chaque trait est un indice — et bientôt, ce sera votre tour de faire semblant."
                                    : "Repérez qui hésite, qui trace trop vaguement, qui recopie ce qui existe déjà. Le faussaire se trahit toujours un peu."}
                            </p>
                        </div>
                    </div>
                )}
            </Shell>
        );
    }

    /* ═══ VOTING ═════════════════════════════════════════════════════ */
    if (gameState === 'VOTING') {
        const suspects = players.filter(p => p.id !== socket.id);

        return (
            <Shell className="p-5">
                <header className="flex items-center justify-between flex-shrink-0 mb-4">
                    <div>
                        <div className="fa-label">Délibération</div>
                        <h2 className="fa-h text-2xl mt-0.5">Qui est le faussaire ?</h2>
                    </div>
                    <span className={`fa-timer-value text-xl ${timer <= 15 ? 'fa-timer-warn' : ''}`}>
                        {Math.floor(timer / 60)}:{String(timer % 60).padStart(2, '0')}
                    </span>
                </header>

                <div className="fa-timer-track mb-5 flex-shrink-0">
                    <div className={`fa-timer-fill ${timerClass}`} style={{ width: `${timerPct}%` }} />
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto">
                    {votedId ? (
                        <div className="fa-card fa-card-accent-lime p-7 text-center flex flex-col items-center gap-4">
                            <span className="material-symbols-outlined text-5xl fa-text-lime">how_to_vote</span>
                            <h3 className="fa-h text-xl">Bulletin déposé</h3>
                            <p className="text-sm fa-text-muted">
                                Vous accusez{' '}
                                <strong className="fa-text-red">
                                    {players.find(p => p.id === votedId)?.name}
                                </strong>
                            </p>
                            <div className="flex items-center gap-2 text-xs fa-text-dim mt-2">
                                <div className="fa-spinner !w-3.5 !h-3.5 !border-2" />
                                En attente des autres<span className="fa-dots" />
                            </div>
                        </div>
                    ) : (
                        <>
                            <p className="text-sm fa-text-muted text-center mb-4">
                                Repensez aux traits : lesquels sonnaient faux ?
                            </p>
                            <div className="fa-vote-grid">
                                {suspects.map(p => (
                                    <button
                                        key={p.id}
                                        onClick={() => handleVote(p.id)}
                                        disabled={p.disconnected}
                                        className="fa-suspect"
                                    >
                                        <img src={p.avatar} alt="" className="fa-avatar fa-avatar-lg !w-14 !h-14" />
                                        <span className="fa-suspect-name">{p.name}</span>
                                        <span
                                            className="fa-ink fa-ink-lg"
                                            style={{ backgroundColor: p.color?.value, color: p.color?.value }}
                                        />
                                    </button>
                                ))}
                            </div>
                        </>
                    )}
                </div>

                <p className="text-center text-xs fa-text-dim pt-4 flex-shrink-0">
                    Débattez à voix haute avant de trancher.
                </p>
            </Shell>
        );
    }

    /* ═══ REVEAL ═════════════════════════════════════════════════════ */
    if (gameState === 'REVEAL') {
        const iWasAccused = accusedName && players.find(p => p.id === socket.id)?.name === accusedName;

        return (
            <Shell className="p-5 justify-center">
                <div className="w-full max-w-sm mx-auto fa-verdict text-center">
                    <div className="fa-card p-7 flex flex-col items-center gap-5">
                        {isTie ? (
                            <>
                                <div className="fa-stamp fa-stamp-red text-lg">Égalité</div>
                                <h2 className="fa-h text-2xl">Pas de majorité</h2>
                                <p className="text-sm fa-text-muted">
                                    Le doute profite au faussaire.
                                </p>
                            </>
                        ) : (
                            <>
                                <div className="fa-label">Désigné à la majorité</div>
                                <h2 className="fa-h text-3xl fa-text-red">{accusedName}</h2>
                                <div className={`fa-stamp text-lg ${isImpostorAccused ? 'fa-stamp-lime' : 'fa-stamp-red'}`}>
                                    {isImpostorAccused ? 'Bien vu' : 'Raté'}
                                </div>
                                <p className="text-sm fa-text-muted">
                                    {iWasAccused
                                        ? 'C’est vous qu’ils accusent.'
                                        : isImpostorAccused
                                            ? 'Le faussaire est démasqué.'
                                            : 'Un innocent tombe. Le faussaire respire.'}
                                </p>
                            </>
                        )}

                        {Object.keys(voteTallies).length > 0 && (
                            <div className="w-full flex flex-col gap-2 mt-2">
                                {Object.entries(voteTallies)
                                    .map(([id, count]) => ({ p: players.find(x => x.id === id), count }))
                                    .filter(e => e.p)
                                    .sort((a, b) => b.count - a.count)
                                    .map(e => (
                                        <div key={e.p.id} className="flex items-center gap-2.5 text-sm">
                                            <img src={e.p.avatar} alt="" className="w-7 h-7 rounded-lg object-cover" />
                                            <span className="flex-1 text-left truncate">{e.p.name}</span>
                                            <span className="fa-mono font-bold fa-text-amber">{e.count}</span>
                                        </div>
                                    ))}
                            </div>
                        )}
                    </div>

                    <p className="text-xs fa-text-dim mt-5">Regardez le grand écran.</p>
                </div>
            </Shell>
        );
    }

    /* ═══ GUESSING ═══════════════════════════════════════════════════ */
    if (gameState === 'GUESSING') {
        return (
            <Shell className="p-5 justify-center">
                <div className="w-full max-w-sm mx-auto">
                    {isGuessingImpostor ? (
                        <form onSubmit={handleImpostorGuess} className="fa-card fa-card-accent-red p-7 flex flex-col gap-5 text-center">
                            <div>
                                <div className="fa-stamp fa-stamp-red text-lg mb-4">Démasqué</div>
                                <h2 className="fa-h text-2xl">Une dernière carte</h2>
                                <p className="text-sm fa-text-muted mt-2 leading-relaxed">
                                    Nommez le mot qu'ils dessinaient et vous emportez tout.
                                </p>
                            </div>

                            <div className="flex items-center justify-center gap-3">
                                <span className="fa-pill fa-pill-amber">{category}</span>
                                {!guessSubmitted && (
                                    <span className={`fa-timer-value text-lg ${timer <= 10 ? 'fa-timer-warn' : ''}`}>
                                        {timer}s
                                    </span>
                                )}
                            </div>

                            {guessSubmitted ? (
                                <div className="fa-card-inset p-5">
                                    <div className="fa-label mb-2">Votre réponse</div>
                                    <div className="fa-word fa-text-red !text-2xl">{guessInput}</div>
                                    <p className="text-xs fa-text-dim mt-4">
                                        L'hôte arbitre<span className="fa-dots" />
                                    </p>
                                </div>
                            ) : (
                                <>
                                    <input
                                        type="text"
                                        className="fa-input fa-input-guess"
                                        placeholder="Le mot…"
                                        value={guessInput}
                                        onChange={e => setGuessInput(e.target.value)}
                                        maxLength={40}
                                        autoComplete="off"
                                        autoFocus
                                    />
                                    <button
                                        type="submit"
                                        disabled={!guessInput.trim()}
                                        className="fa-btn fa-btn-danger fa-btn-lg w-full"
                                    >
                                        Tenter ma chance
                                    </button>
                                </>
                            )}
                        </form>
                    ) : (
                        <div className="fa-card fa-card-accent-lime p-7 text-center flex flex-col items-center gap-5">
                            <span className="material-symbols-outlined text-5xl fa-text-lime">gavel</span>
                            <h2 className="fa-h text-2xl fa-text-lime">Faussaire démasqué</h2>
                            <p className="text-sm fa-text-muted leading-relaxed">
                                <strong className="fa-text-red">{accusedName}</strong> était bien l'imposteur.
                                Il tente maintenant de deviner le mot pour renverser la partie.
                            </p>
                            <div className="fa-card-inset p-4 w-full flex flex-col items-center gap-2.5">
                                <div className="fa-spinner !w-6 !h-6 !border-2" />
                                <p className="text-xs fa-text-dim">
                                    {guessSubmitted ? 'Réponse envoyée, arbitrage en cours' : 'Il réfléchit'}<span className="fa-dots" />
                                </p>
                            </div>
                        </div>
                    )}

                    <p className="text-center text-xs fa-text-dim mt-5">
                        Le verdict s'affiche sur le grand écran.
                    </p>
                </div>
            </Shell>
        );
    }

    /* ═══ GAME_END ═══════════════════════════════════════════════════ */
    if (gameState === 'GAME_END') {
        const iAmImpostor = role === 'impostor';
        const impostorWon = winner === 'impostor';
        const iWon = impostorWon === iAmImpostor;
        const me = players.find(p => p.id === socket.id);

        const reasonText = {
            'tie': 'Aucune majorité ne s\'est dégagée.',
            'wrong-accusation': 'Un innocent a été accusé.',
            'impostor-guessed': 'Démasqué, il a pourtant trouvé le mot.',
            'impostor-failed': 'Démasqué, il n\'a pas su trouver le mot.'
        }[endReason] || '';

        return (
            <Shell className="p-5">
                <div className="flex-1 flex flex-col items-center justify-center gap-5">
                    <div className={`fa-card p-7 w-full max-w-sm text-center flex flex-col items-center gap-5 fa-verdict ${iWon ? 'fa-card-accent-lime' : 'fa-card-accent-red'}`}>
                        <div className={`fa-stamp text-xl ${iWon ? 'fa-stamp-lime' : 'fa-stamp-red'}`}>
                            {iWon ? 'Gagné' : 'Perdu'}
                        </div>

                        <div>
                            <p className="text-sm fa-text-muted">
                                {impostorWon ? 'Le faussaire l\'emporte' : 'Les artistes l\'emportent'}
                            </p>
                            <p className="text-xs fa-text-dim mt-1">{reasonText}</p>
                        </div>

                        <div className="fa-word-slab w-full">
                            <div className="fa-label mb-2">Le mot était</div>
                            <div className="fa-word fa-text-cyan">{secretWord}</div>
                        </div>

                        {impostors.length > 0 && (
                            <div className="w-full">
                                <div className="fa-label mb-2.5">
                                    {impostors.length > 1 ? 'Les faussaires' : 'Le faussaire'}
                                </div>
                                <div className="flex items-center justify-center gap-2 flex-wrap">
                                    {impostors.map(i => (
                                        <div key={i.id} className="fa-pill fa-pill-red !py-1.5 !pl-1.5">
                                            <img src={i.avatar} alt="" className="w-6 h-6 rounded-md object-cover" />
                                            {i.name}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className="flex items-center justify-center gap-6 w-full pt-1">
                            <div>
                                <div className="fa-label">Total</div>
                                <div className="fa-mono text-2xl font-bold fa-text-amber">{myScore}</div>
                            </div>
                            {me?.roundScore > 0 && (
                                <div>
                                    <div className="fa-label">Cette manche</div>
                                    <div className="fa-mono text-2xl font-bold fa-text-lime">+{me.roundScore}</div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Classement compact */}
                    <div className="fa-card p-4 w-full max-w-sm">
                        <div className="fa-label mb-3">Classement</div>
                        <div className="flex flex-col gap-1.5">
                            {[...players].sort((a, b) => b.score - a.score).map((p, i) => (
                                <div
                                    key={p.id}
                                    className={`flex items-center gap-2.5 text-sm ${p.id === socket.id ? 'fa-text-amber font-bold' : ''}`}
                                >
                                    <span className="fa-mono text-xs fa-text-dim w-4">{i + 1}</span>
                                    <img src={p.avatar} alt="" className="w-6 h-6 rounded-md object-cover" />
                                    <span className="flex-1 truncate">{p.name}</span>
                                    <span className="fa-mono font-semibold">{p.score}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="flex items-center justify-center gap-2 text-xs fa-text-dim pb-3 flex-shrink-0">
                    <div className="fa-spinner !w-3.5 !h-3.5 !border-2" />
                    En attente de la manche suivante<span className="fa-dots" />
                </div>
            </Shell>
        );
    }

    return null;
}

export default FakeArtistPlayerView;
