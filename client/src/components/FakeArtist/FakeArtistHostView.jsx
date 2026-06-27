import { useState, useEffect, useRef } from 'react';
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

function FakeArtistHostView() {
    const navigate = useNavigate();
    const [gameState, setGameState] = useState('CREATING');
    const [roomCode, setRoomCode] = useState('');
    const [players, setPlayers] = useState([]);
    const [settings, setSettings] = useState({ roundsCount: 2, timePerRound: 30, categories: ['all'] });

    const [currentRound, setCurrentRound] = useState(0);
    const [totalRounds, setTotalRounds] = useState(0);
    const [currentDrawerId, setCurrentDrawerId] = useState(null);
    const [category, setCategory] = useState('');
    const [drawOrder, setDrawOrder] = useState([]);
    
    // Phase de Vote & Révélation
    const [accusedName, setAccusedName] = useState('');
    const [isImpostorAccused, setIsImpostorAccused] = useState(false);
    const [voteTallies, setVoteTallies] = useState({});
    
    // Phase Devinette Imposteur
    const [impostorGuess, setImpostorGuess] = useState(null);
    const [secretWord, setSecretWord] = useState('');
    const [impostorName, setImpostorName] = useState('');
    const [winner, setWinner] = useState(null);

    // Timers
    const [timer, setTimer] = useState(0);
    const [timerPct, setTimerPct] = useState(100);
    const [availableCategories, setAvailableCategories] = useState([]);

    const canvasRef = useRef(null);
    const canvasContextRef = useRef(null);
    const timerRef = useRef(null);
    const strokesHistoryRef = useRef([]);
    const liveStrokeRef = useRef(null);

    useEffect(() => {
        document.body.classList.add('comic-theme');
        return () => document.body.classList.remove('comic-theme');
    }, []);

    const roomCodeRef = useRef('');
    useEffect(() => { roomCodeRef.current = roomCode; }, [roomCode]);

    // Initialisation et Reconnexion
    useEffect(() => {
        const applyReconnect = (response) => {
            setRoomCode(response.roomCode);
            roomCodeRef.current = response.roomCode;
            if (response.settings) setSettings(prev => ({ ...prev, ...response.settings }));
            setPlayers(response.players || []);
            setCurrentRound(response.currentRound || 0);
            setTotalRounds(response.totalRounds || 0);
            writeHostSession(response.roomCode);
            strokesHistoryRef.current = response.canvasHistory || [];

            if (response.gameState === 'PLAYING') {
                setGameState('PLAYING');
                setCurrentDrawerId(response.currentDrawerId);
                setCategory(response.category || '');
                setDrawOrder(response.players.map(p => p.name));
                // Redraw canvas
                setTimeout(() => redrawCanvas(), 100);
            } else if (response.gameState === 'VOTING') {
                setGameState('VOTING');
                setTimeout(() => redrawCanvas(), 100);
            } else if (response.gameState === 'GUESSING') {
                setGameState('GUESSING');
                setAccusedName(response.accusedName || '');
                setImpostorGuess(response.impostorGuess);
                setSecretWord(response.secretWord || '');
                setTimeout(() => redrawCanvas(), 100);
            } else if (response.gameState === 'GAME_END') {
                setGameState('GAME_END');
                setWinner(response.winner);
                setSecretWord(response.secretWord || '');
                setImpostorName(response.impostorName || '');
                setTimeout(() => redrawCanvas(), 100);
            } else {
                setGameState('LOBBY');
            }
        };

        const createFreshRoom = () => {
            socket.emit('fakeartist-create-room', { settings }, (response) => {
                if (response.roomCode) {
                    setRoomCode(response.roomCode);
                    roomCodeRef.current = response.roomCode;
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
        const sessionFresh = saved && saved.roomCode && (Date.now() - (saved.createdAt || 0) < HOST_SESSION_TTL);
        if (sessionFresh) {
            reconnectHost(saved.roomCode, () => { clearHostSession(); createFreshRoom(); });
        } else {
            if (saved) clearHostSession();
            createFreshRoom();
        }

        // Charger les catégories de mots
        socket.emit('draw-get-categories', {}, (response) => {
            if (response.categories) setAvailableCategories(response.categories);
        });

        const handleReconnect = () => {
            const code = roomCodeRef.current;
            if (!code) return;
            reconnectHost(code, () => { clearHostSession(); createFreshRoom(); });
        };
        socket.on('connect', handleReconnect);

        return () => {
            socket.off('connect', handleReconnect);
            if (timerRef.current) clearInterval(timerRef.current);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Canvas Resize & Ref
    useEffect(() => {
        if (!canvasRef.current || (gameState !== 'PLAYING' && gameState !== 'VOTING' && gameState !== 'GUESSING' && gameState !== 'GAME_END')) return;
        const canvas = canvasRef.current;

        const initCanvas = (w, h) => {
            if (w < 10 || h < 10) return;
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            canvasContextRef.current = ctx;
            redrawCanvas();
        };

        const ro = new ResizeObserver(entries => {
            for (const e of entries) {
                initCanvas(e.contentRect.width, e.contentRect.height);
            }
        });
        ro.observe(canvas);

        requestAnimationFrame(() => {
            const r = canvas.getBoundingClientRect();
            initCanvas(r.width, r.height);
        });

        return () => ro.disconnect();
    }, [gameState]);

    // Écouteurs d'événements Sockets
    useEffect(() => {
        const handlePlayersUpdated = (list) => setPlayers(list);
        
        const handleGameStarted = (data) => {
            playCountdownSound();
            setGameState('PLAYING');
            strokesHistoryRef.current = [];
            liveStrokeRef.current = null;
            setCurrentRound(data.currentRound);
            setTotalRounds(data.totalRounds);
            setCurrentDrawerId(data.currentDrawerId);
            setCategory(data.category);
            setDrawOrder(data.drawOrder);
            setWinner(null);
            setAccusedName('');
            setImpostorGuess(null);
            
            startTimer(data.timePerRound, data.turnStartTime);
        };

        const handleTurnUpdated = (data) => {
            liveStrokeRef.current = null;
            setCurrentDrawerId(data.currentDrawerId);
            setCurrentRound(data.currentRound);
            strokesHistoryRef.current = data.canvasHistory || [];
            redrawCanvas();
            
            startTimer(settings.timePerRound, data.turnStartTime);
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
                redrawCanvas();
            }

            if (data.gameState === 'VOTING') {
                playCountdownSound();
                if (timerRef.current) clearInterval(timerRef.current);
                setTimer(60); // 60s pour débattre
                setTimerPct(100);
            } else if (data.gameState === 'GUESSING') {
                playSuccessSound();
                setAccusedName(data.accusedName);
                setIsImpostorAccused(true);
                if (data.voteTallies) setVoteTallies(data.voteTallies);
            } else if (data.gameState === 'GAME_END') {
                if (data.winner === 'impostor') {
                    playFailSound();
                } else {
                    playWinnerSound();
                    triggerConfetti();
                }
                setWinner(data.winner);
                setSecretWord(data.secretWord);
                setImpostorName(data.impostorName);
                if (data.accusedName) setAccusedName(data.accusedName);
                if (data.voteTallies) setVoteTallies(data.voteTallies);
            }
        };

        const handleGuessReceived = (data) => {
            playSuccessSound();
            setImpostorGuess(data.guess);
            setSecretWord(data.secretWord);
            // Si autocorrect s'active, on peut ajouter une micro-animation ou confettis si correct
        };

        const handleHostDisconnected = () => {
            // Hôte déconnecté - peut être géré par un overlay
        };

        const handleHostReconnected = () => {
            // Hôte reconnecté
        };

        socket.on('fakeartist-players-updated', handlePlayersUpdated);
        socket.on('fakeartist-game-started', handleGameStarted);
        socket.on('fakeartist-turn-updated', handleTurnUpdated);
        socket.on('fakeartist-stroke-live', handleStrokeLive);
        socket.on('fakeartist-clear-live', handleClearLive);
        socket.on('fakeartist-game-state-updated', handleGameStateUpdated);
        socket.on('fakeartist-guess-received', handleGuessReceived);
        socket.on('fakeartist-host-disconnected', handleHostDisconnected);
        socket.on('fakeartist-host-reconnected', handleHostReconnected);

        return () => {
            socket.off('fakeartist-players-updated', handlePlayersUpdated);
            socket.off('fakeartist-game-started', handleGameStarted);
            socket.off('fakeartist-turn-updated', handleTurnUpdated);
            socket.off('fakeartist-stroke-live', handleStrokeLive);
            socket.off('fakeartist-clear-live', handleClearLive);
            socket.off('fakeartist-game-state-updated', handleGameStateUpdated);
            socket.off('fakeartist-guess-received', handleGuessReceived);
            socket.off('fakeartist-host-disconnected', handleHostDisconnected);
            socket.off('fakeartist-host-reconnected', handleHostReconnected);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [settings.timePerRound]);

    const startTimer = (duration, startTime) => {
        if (timerRef.current) clearInterval(timerRef.current);
        const update = () => {
            const elapsed = (Date.now() - startTime) / 1000;
            const remaining = Math.max(0, Math.ceil(duration - elapsed));
            setTimer(remaining);
            setTimerPct((remaining / duration) * 100);
        };
        update();
        timerRef.current = setInterval(update, 1000);
    };

    const redrawCanvas = () => {
        if (!canvasContextRef.current || !canvasRef.current) return;
        const ctx = canvasContextRef.current;
        const canvas = canvasRef.current;

        // Clear canvas
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Draw all completed strokes
        strokesHistoryRef.current.forEach(stroke => {
            drawStrokeOnContext(ctx, canvas, stroke);
        });

        // Draw live stroke
        if (liveStrokeRef.current) {
            drawStrokeOnContext(ctx, canvas, liveStrokeRef.current);
        }
    };

    const drawStrokeOnContext = (ctx, canvas, stroke) => {
        if (!stroke.points || stroke.points.length === 0) return;
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = stroke.size || 8;
        ctx.beginPath();
        stroke.points.forEach((pt, i) => {
            const x = pt.x * canvas.width;
            const y = pt.y * canvas.height;
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });
        ctx.stroke();
    };

    const handleStartGame = () => {
        if (players.length < 3) return;
        socket.emit('fakeartist-start-game', { roomCode });
    };

    const handleHostDecision = (isCorrect) => {
        socket.emit('fakeartist-host-decision', { roomCode, isCorrect });
    };

    const handleRestartGame = () => {
        socket.emit('fakeartist-restart-game', { roomCode });
    };

    const triggerConfetti = () => {
        confetti({
            particleCount: 150,
            spread: 80,
            origin: { y: 0.6 }
        });
    };

    const joinUrl = `${window.location.origin}/join/${roomCode}`;

    // ─── STATE: CREATING ───
    if (gameState === 'CREATING') {
        return (
            <div className="min-h-screen flex items-center justify-center bg-[#FFFBF0]">
                <div className="sk-box p-8 max-w-sm text-center">
                    <span className="material-symbols-outlined text-4xl text-[#FF3B30] animate-spin">hourglass_empty</span>
                    <h2 className="text-xl sk-h mt-4">Création du salon...</h2>
                </div>
            </div>
        );
    }

    // ─── STATE: LOBBY ───
    if (gameState === 'LOBBY') {
        return (
            <div className="min-h-screen p-8 bg-[#FFFBF0] flex flex-col justify-between select-none">
                {/* Header */}
                <div className="flex justify-between items-center bg-white border-4 border-[#161a33] p-4 rounded-xl shadow-[4px_4px_0_#161a33]">
                    <div>
                        <h1 className="text-3xl sk-h italic" style={{ textShadow: '2px 2px 0 #FFD60A' }}>Fake Artist</h1>
                        <p className="text-xs font-black uppercase text-[#161a33]/60">Écran Géant de l'Hôte</p>
                    </div>
                    <div className="flex items-center gap-3">
                        <span className="text-sm font-black uppercase text-[#161a33]">Code du Salon:</span>
                        <span className="text-4xl font-black bg-[#FF3B30] text-white px-4 py-1.5 border-3 border-[#161a33] shadow-[3px_3px_0_#161a33] rounded-lg tracking-widest">{roomCode}</span>
                    </div>
                </div>

                {/* Main Content */}
                <div className="grid grid-cols-12 gap-8 my-8 flex-1 items-stretch">
                    {/* Left: Connection instructions & QR Code */}
                    <div className="col-span-4 bg-white border-4 border-[#161a33] p-6 rounded-2xl shadow-[6px_6px_0_#161a33] flex flex-col items-center justify-center text-center gap-6">
                        <div className="border-3 border-[#161a33] p-3 bg-[#FFFBF0] shadow-[3px_3px_0_#161a33]">
                            <QRCodeSVG value={joinUrl} size={160} />
                        </div>
                        <div>
                            <h3 className="text-lg sk-h text-[#FF3B30]">Scanne pour jouer !</h3>
                            <p className="text-xs font-bold text-[#161a33] mt-2">Ou connecte-toi sur :</p>
                            <div className="text-md font-black bg-[#C2DCFF] border-2 border-[#161a33] py-1 px-3 mt-1.5 rounded-lg text-[#161a33] select-all">
                                {window.location.hostname}
                            </div>
                        </div>
                    </div>

                    {/* Middle: Players list */}
                    <div className="col-span-5 bg-white border-4 border-[#161a33] p-6 rounded-2xl shadow-[6px_6px_0_#161a33] flex flex-col">
                        <h3 className="text-xl sk-h mb-4 border-b-3 border-[#161a33] pb-2 flex items-center justify-between">
                            <span>Artistes connectés</span>
                            <span className="sk-pill sk-pill-blue py-0.5 px-2 text-xs">{players.length}</span>
                        </h3>
                        {players.length === 0 ? (
                            <div className="flex-1 flex flex-col items-center justify-center text-center text-[#161a33]/40 p-4">
                                <span className="material-symbols-outlined text-4xl animate-bounce">group</span>
                                <p className="text-sm font-black uppercase mt-2">En attente de joueurs...</p>
                            </div>
                        ) : (
                            <div className="flex-1 fa-lobby-list grid grid-cols-2 gap-3 content-start">
                                {players.map(p => (
                                    <div key={p.id} className="fa-player-card">
                                        <div className="fa-color-dot" style={{ backgroundColor: p.color?.value }} />
                                        <img src={p.avatar} alt="" className="w-8 h-8 rounded-full border-2 border-[#161a33]" />
                                        <span className="font-bold text-sm text-[#161a33] truncate">{p.name}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Right: Settings & Launch */}
                    <div className="col-span-3 bg-white border-4 border-[#161a33] p-6 rounded-2xl shadow-[6px_6px_0_#161a33] flex flex-col justify-between">
                        <div className="flex flex-col gap-5">
                            <h3 className="text-xl sk-h border-b-3 border-[#161a33] pb-2">Réglages</h3>
                            
                            <div>
                                <label className="text-xs font-black uppercase text-[#161a33]/60 block mb-1">Nombre de passages :</label>
                                <select 
                                    value={settings.roundsCount} 
                                    onChange={(e) => setSettings(prev => ({ ...prev, roundsCount: parseInt(e.target.value) }))}
                                    className="w-full bg-[#FFFBF0] border-2 border-[#161a33] py-2 px-3 rounded-lg font-bold text-sm text-[#161a33] outline-none"
                                >
                                    <option value={1}>1 trait par joueur</option>
                                    <option value={2}>2 traits par joueur (Recommandé)</option>
                                    <option value={3}>3 traits par joueur</option>
                                </select>
                            </div>

                            <div>
                                <label className="text-xs font-black uppercase text-[#161a33]/60 block mb-1">Temps par trait :</label>
                                <select 
                                    value={settings.timePerRound} 
                                    onChange={(e) => setSettings(prev => ({ ...prev, timePerRound: parseInt(e.target.value) }))}
                                    className="w-full bg-[#FFFBF0] border-2 border-[#161a33] py-2 px-3 rounded-lg font-bold text-sm text-[#161a33] outline-none"
                                >
                                    <option value={20}>20 secondes</option>
                                    <option value={30}>30 secondes (Standard)</option>
                                    <option value={45}>45 secondes</option>
                                    <option value={60}>60 secondes</option>
                                </select>
                            </div>
                        </div>

                        <div className="mt-6">
                            <button
                                onClick={handleStartGame}
                                disabled={players.length < 3}
                                className="w-full sk-btn sk-btn-primary py-3.5 flex items-center justify-center gap-2 text-md disabled:opacity-50"
                            >
                                <span className="material-symbols-outlined text-base">play_arrow</span>
                                Lancer la Partie
                            </button>
                            {players.length < 3 && (
                                <p className="text-[10px] font-bold text-[#FF3B30] uppercase text-center mt-2">
                                    3 joueurs minimum requis
                                </p>
                            )}
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="text-center text-xs font-black uppercase text-[#161a33]/40">
                    Artistes dessinez en couleur · Imposteur fondez-vous dans la masse
                </div>
            </div>
        );
    }

    // ─── STATE: PLAYING ───
    if (gameState === 'PLAYING') {
        const activeDrawer = players.find(p => p.id === currentDrawerId);

        return (
            <div className="min-h-screen p-6 bg-[#FFFBF0] flex flex-col justify-between select-none">
                {/* Header */}
                <div className="flex justify-between items-center bg-white border-4 border-[#161a33] px-6 py-3 rounded-xl shadow-[4px_4px_0_#161a33] mb-6">
                    <div className="flex items-center gap-3">
                        <span className="sk-pill sk-pill-blue py-1 px-3 text-xs">Manche {currentRound}/{totalRounds}</span>
                        <h2 className="text-xl font-bold uppercase text-[#161a33]">Catégorie : <span className="sk-pill sk-pill-active text-md py-1 px-4">{category}</span></h2>
                    </div>

                    <div className="flex items-center gap-4">
                        <div className="w-48 h-3.5 bg-[#161a33]/10 border-2 border-[#161a33] rounded-full overflow-hidden">
                            <div 
                                className={`h-full rounded-full transition-all duration-1000 ${timer <= 8 ? 'bg-[#FF3B30]' : 'bg-[#FFD60A]'}`}
                                style={{ width: `${timerPct}%` }}
                            />
                        </div>
                        <span className="font-black text-2xl text-[#161a33] min-w-[40px] text-right">{timer}s</span>
                    </div>
                </div>

                {/* Main Body */}
                <div className="fa-host-container flex-1">
                    {/* Left: Giant Canvas */}
                    <div className="fa-canvas-area">
                        <div className="fa-canvas-wrapper">
                            <canvas ref={canvasRef} className="fa-canvas" />
                        </div>
                    </div>

                    {/* Right: Players Sidebar */}
                    <div className="fa-sidebar">
                        <div className="bg-white border-4 border-[#161a33] p-4 rounded-xl shadow-[4px_4px_0_#161a33] flex-1 flex flex-col">
                            <h3 className="text-lg sk-h mb-3 border-b-2 border-[#161a33] pb-1.5 uppercase text-[#161a33]">Ordre de dessin</h3>
                            <div className="flex flex-col gap-2.5 overflow-y-auto pr-1 flex-1">
                                {players.map((p, idx) => {
                                    const isActive = p.id === currentDrawerId;
                                    return (
                                        <div key={p.id} className={`fa-player-card ${isActive ? 'active' : ''} ${p.disconnected ? 'disconnected' : ''}`}>
                                            <span className="font-black text-xs text-[#161a33]/50">#{idx + 1}</span>
                                            <div className="fa-color-dot" style={{ backgroundColor: p.color?.value }} />
                                            <img src={p.avatar} alt="" className="w-8 h-8 rounded-full border-2 border-[#161a33]" />
                                            <div className="flex-1 min-w-0">
                                                <div className="font-bold text-sm text-[#161a33] truncate">{p.name}</div>
                                                {isActive && <div className="text-[9px] font-black uppercase text-[#FF3B30] animate-pulse">Dessine...</div>}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Footer Banner */}
                {activeDrawer && (
                    <div className="bg-[#FF3B30] text-white font-black text-xl text-center py-3 border-4 border-[#161a33] rounded-xl shadow-[4px_4px_0_#161a33] mt-5 uppercase italic tracking-wider flex items-center justify-center gap-2">
                        <span className="material-symbols-outlined animate-bounce">brush</span>
                        {activeDrawer.name} ajoute un trait au dessin commun !
                    </div>
                )}
            </div>
        );
    }

    // ─── STATE: VOTING ───
    if (gameState === 'VOTING') {
        const votesComplete = players.filter(p => !p.disconnected).every(p => p.hasVoted);

        return (
            <div className="min-h-screen p-6 bg-[#FFFBF0] flex flex-col justify-between select-none">
                {/* Header */}
                <div className="flex justify-between items-center bg-white border-4 border-[#161a33] px-6 py-3 rounded-xl shadow-[4px_4px_0_#161a33] mb-6">
                    <h2 className="text-2xl sk-h text-[#FF3B30] italic" style={{ textShadow: '1px 1px 0 #FFD60A' }}>Délibération & Vote !</h2>
                    <div className="flex items-center gap-3">
                        <span className="text-xs font-black uppercase text-[#161a33]/60">Temps de débat restant:</span>
                        <span className="font-black text-xl bg-[#C2DCFF] px-3 py-1 border-2 border-[#161a33] rounded-lg text-[#161a33]">{timer}s</span>
                    </div>
                </div>

                <div className="fa-host-container flex-1">
                    {/* Left: Canvas Drawing */}
                    <div className="fa-canvas-area">
                        <div className="fa-canvas-wrapper">
                            <canvas ref={canvasRef} className="fa-canvas" />
                        </div>
                    </div>

                    {/* Right: Vote Status */}
                    <div className="fa-sidebar">
                        <div className="bg-white border-4 border-[#161a33] p-4 rounded-xl shadow-[4px_4px_0_#161a33] flex-1 flex flex-col">
                            <h3 className="text-lg sk-h mb-3 border-b-2 border-[#161a33] pb-1.5 uppercase text-[#161a33]">Qui a voté ?</h3>
                            <div className="flex flex-col gap-2.5 overflow-y-auto pr-1 flex-1">
                                {players.map(p => (
                                    <div key={p.id} className="fa-player-card justify-between">
                                        <div className="flex items-center gap-2.5 min-w-0">
                                            <div className="fa-color-dot" style={{ backgroundColor: p.color?.value }} />
                                            <img src={p.avatar} alt="" className="w-8 h-8 rounded-full border-2 border-[#161a33]" />
                                            <span className="font-bold text-sm text-[#161a33] truncate">{p.name}</span>
                                        </div>
                                        <div>
                                            {p.hasVoted ? (
                                                <span className="material-symbols-outlined text-[#00D26A] font-bold">check_circle</span>
                                            ) : (
                                                <span className="material-symbols-outlined text-[#FF3B30] font-bold animate-pulse">hourglass_empty</span>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Footer Banner */}
                <div className="bg-[#FFD60A] text-[#161a33] font-black text-lg text-center py-3 border-4 border-[#161a33] rounded-xl shadow-[4px_4px_0_#161a33] mt-5 uppercase tracking-wide">
                    {votesComplete ? "Calcul des votes en cours..." : "Votez sur vos téléphones pour désigner le Fake Artist !"}
                </div>
            </div>
        );
    }

    // ─── STATE: GUESSING ───
    if (gameState === 'GUESSING') {
        return (
            <div className="min-h-screen p-8 bg-[#FFFBF0] flex flex-col justify-between select-none">
                <div className="flex justify-between items-center bg-white border-4 border-[#161a33] p-4 rounded-xl shadow-[4px_4px_0_#161a33]">
                    <h2 className="text-2xl sk-h text-[#FF3B30]">L'Imposteur est Démasqué !</h2>
                    <span className="sk-pill sk-pill-blue py-1 px-3 text-xs">Verdict</span>
                </div>

                <div className="grid grid-cols-12 gap-8 my-8 flex-1 items-stretch">
                    {/* Left: Canvas */}
                    <div className="col-span-7 flex flex-col">
                        <div className="fa-canvas-wrapper flex-1">
                            <canvas ref={canvasRef} className="fa-canvas" />
                        </div>
                    </div>

                    {/* Right: Verdict panel */}
                    <div className="col-span-5 flex flex-col gap-6">
                        {/* Who was unmasked */}
                        <div className="bg-white border-4 border-[#161a33] p-6 rounded-2xl shadow-[6px_6px_0_#161a33] text-center flex flex-col items-center justify-center">
                            <div className="fa-badge fa-badge-red text-sm font-black mb-3">Accusé à la majorité</div>
                            <h2 className="text-3xl sk-h text-[#FF3B30] mt-1">{accusedName}</h2>
                            <p className="text-xs font-bold text-[#161a33]/60 uppercase mt-2">était bel et bien le Fake Artist !</p>
                        </div>

                        {/* Guess evaluation */}
                        <div className="bg-white border-4 border-[#161a33] p-6 rounded-2xl shadow-[6px_6px_0_#161a33] flex-1 flex flex-col justify-between">
                            <h3 className="text-lg sk-h border-b-2 border-[#161a33] pb-1.5 uppercase text-center text-[#161a33]">Chance de salut</h3>

                            {!impostorGuess ? (
                                <div className="flex-1 flex flex-col items-center justify-center text-center p-4 gap-3">
                                    <span className="material-symbols-outlined text-4xl text-[#FF3B30] animate-bounce">question_mark</span>
                                    <p className="text-sm font-black uppercase text-[#161a33]">L'imposteur devine le mot secret...</p>
                                </div>
                            ) : (
                                <div className="flex-1 flex flex-col justify-around py-4">
                                    <div className="text-center bg-[#FFFBF0] border-3 border-[#161a33] p-4 rounded-xl shadow-[3px_3px_0_#161a33]">
                                        <div className="text-[10px] font-black uppercase text-[#161a33]/60">Proposition de l'Imposteur:</div>
                                        <div className="text-2xl font-black text-[#FF3B30] uppercase mt-1 tracking-wider">"{impostorGuess}"</div>
                                    </div>

                                    <div className="text-center bg-[#C2DCFF] border-3 border-[#161a33] p-4 rounded-xl shadow-[3px_3px_0_#161a33] mt-4">
                                        <div className="text-[10px] font-black uppercase text-[#161a33]/60">Le mot secret était:</div>
                                        <div className="text-2xl font-black text-[#0055FF] uppercase mt-1 tracking-wider">"{secretWord}"</div>
                                    </div>

                                    <div className="mt-6 flex flex-col gap-3">
                                        <p className="text-xs font-bold text-center text-[#161a33]/80">Est-ce que cette réponse est correcte ?</p>
                                        <div className="grid grid-cols-2 gap-3">
                                            <button
                                                onClick={() => handleHostDecision(true)}
                                                className="sk-btn sk-btn-primary py-3 text-xs flex items-center justify-center gap-1.5"
                                            >
                                                <span className="material-symbols-outlined text-base">thumb_up</span>
                                                OUI, correct
                                            </button>
                                            <button
                                                onClick={() => handleHostDecision(false)}
                                                className="sk-btn sk-btn-danger py-3 text-xs flex items-center justify-center gap-1.5"
                                            >
                                                <span className="material-symbols-outlined text-base">thumb_down</span>
                                                NON, incorrect
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // ─── STATE: GAME_END ───
    if (gameState === 'GAME_END') {
        const isImpostorWin = winner === 'impostor';

        return (
            <div className="min-h-screen p-8 bg-[#FFFBF0] flex flex-col justify-between select-none">
                {/* Header */}
                <div className="flex justify-between items-center bg-white border-4 border-[#161a33] p-4 rounded-xl shadow-[4px_4px_0_#161a33]">
                    <h2 className="text-2xl sk-h italic">Fin de Partie</h2>
                    <span className="sk-pill sk-pill-blue py-1 px-3 text-xs">Tableau des scores</span>
                </div>

                <div className="grid grid-cols-12 gap-8 my-8 flex-1 items-stretch">
                    {/* Left: Canvas */}
                    <div className="col-span-7 flex flex-col">
                        <div className="fa-canvas-wrapper flex-1">
                            <canvas ref={canvasRef} className="fa-canvas" />
                        </div>
                    </div>

                    {/* Right: Results panel */}
                    <div className="col-span-5 flex flex-col gap-6">
                        {/* Winner announcement */}
                        <div className={`border-4 border-[#161a33] p-6 rounded-2xl shadow-[6px_6px_0_#161a33] text-center flex flex-col items-center justify-center ${isImpostorWin ? 'bg-[#FF3B30] text-white' : 'bg-[#00D26A] text-white'}`}>
                            <div className="text-[10px] font-black uppercase tracking-wider text-white/80">Vainqueur</div>
                            <h2 className="text-3xl sk-h mt-2 italic uppercase">
                                {isImpostorWin ? "L'Imposteur a gagné !" : "Les Artistes ont gagné !"}
                            </h2>
                            <p className="text-xs font-bold mt-3 text-white/95">
                                {isImpostorWin 
                                    ? `L'imposteur (${impostorName}) a triomphé !`
                                    : `L'imposteur (${impostorName}) a été démasqué sans pouvoir deviner le mot.`
                                }
                            </p>
                            <div className="mt-3 bg-white/20 border border-white/30 py-1.5 px-4 rounded-full text-xs font-black uppercase">
                                Mot secret : {secretWord}
                            </div>
                        </div>

                        {/* Leaderboard */}
                        <div className="bg-white border-4 border-[#161a33] p-6 rounded-2xl shadow-[6px_6px_0_#161a33] flex-1 flex flex-col justify-between">
                            <h3 className="text-lg sk-h border-b-2 border-[#161a33] pb-1.5 uppercase text-center text-[#161a33]">Classement</h3>
                            <div className="flex flex-col gap-2 overflow-y-auto flex-1 my-4 pr-1">
                                {[...players].sort((a, b) => b.score - a.score).map((p, idx) => {
                                    const isPlayerImpostor = p.name === impostorName;
                                    return (
                                        <div key={p.id} className="fa-player-card justify-between py-2.5">
                                            <div className="flex items-center gap-2 min-w-0">
                                                <span className="font-black text-xs text-[#161a33]/50">#{idx + 1}</span>
                                                <div className="fa-color-dot" style={{ backgroundColor: p.color?.value }} />
                                                <img src={p.avatar} alt="" className="w-7 h-7 rounded-full border-2 border-[#161a33]" />
                                                <span className="font-bold text-sm text-[#161a33] truncate">{p.name}</span>
                                                {isPlayerImpostor && <span className="fa-badge fa-badge-red text-[8px] px-1.5 py-0.5 ml-1">Imposteur</span>}
                                            </div>
                                            <div className="font-black text-sm text-[#161a33]">{p.score} pts</div>
                                        </div>
                                    );
                                })}
                            </div>

                            <button
                                onClick={handleRestartGame}
                                className="w-full sk-btn sk-btn-warning py-3 flex items-center justify-center gap-2"
                            >
                                <span className="material-symbols-outlined text-base">replay</span>
                                Rejouer / Retour au lobby
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return null;
}

export default FakeArtistHostView;
