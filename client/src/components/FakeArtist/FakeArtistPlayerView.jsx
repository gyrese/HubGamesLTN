import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { socket } from '../../socket';
import { playCountdownSound, playSuccessSound, playFailSound, playWinnerSound } from '../../utils/audio';
import './FakeArtistStyles.css';

const ALL_AVATARS = Array.from({ length: 60 }, (_, i) => `/avatars/avatar_${i + 1}.webp`);

function FakeArtistPlayerView() {
    const navigate = useNavigate();
    const { roomCode: urlRoomCode } = useParams();

    const [playerName, setPlayerName] = useState('');
    const [avatar, setAvatar] = useState(ALL_AVATARS[0]);
    const [roomCode, setRoomCode] = useState(urlRoomCode || '');
    const [isJoined, setIsJoined] = useState(false);
    const [error, setError] = useState('');

    const [gameState, setGameState] = useState('LOBBY');
    const [players, setPlayers] = useState([]);
    
    // Rôle et mot secret
    const [role, setRole] = useState(null); // 'artist' or 'impostor'
    const [secretWord, setSecretWord] = useState(null);
    const [category, setCategory] = useState(null);
    const [playerColor, setPlayerColor] = useState(null);
    const [roleConfirmed, setRoleConfirmed] = useState(false);

    // Dessin
    const [isDrawer, setIsDrawer] = useState(false);
    const [currentDrawerId, setCurrentDrawerId] = useState(null);
    const [currentRound, setCurrentRound] = useState(0);
    const [totalRounds, setTotalRounds] = useState(0);
    const [timer, setTimer] = useState(0);
    
    const [isDrawing, setIsDrawing] = useState(false);
    const [currentStrokePoints, setCurrentStrokePoints] = useState([]);
    const [hasDrawnStroke, setHasDrawnStroke] = useState(false); // S'il a tracé un trait non validé
    const [myScore, setMyScore] = useState(0);

    // Vote
    const [votedId, setVotedId] = useState(null);
    const [accusedName, setAccusedName] = useState('');
    
    // Devinette Imposteur
    const [guessInput, setGuessInput] = useState('');
    const [guessSubmitted, setGuessSubmitted] = useState(false);
    const [winner, setWinner] = useState(null);

    const canvasRef = useRef(null);
    const canvasContextRef = useRef(null);
    const timerRef = useRef(null);
    const strokesHistoryRef = useRef([]);

    // Rejoindre la salle
    const doJoin = (code, name, userAvatar, silent = false) => {
        if (!name.trim() || !code.trim()) return;
        if (!silent) setError('');

        socket.emit('fakeartist-join-room', {
            roomCode: code.toUpperCase(),
            playerName: name.trim(),
            avatar: userAvatar
        }, (response) => {
            if (response.error) {
                if (!silent) {
                    setError(response.error);
                    localStorage.removeItem('fakeartist-session');
                }
            } else {
                setIsJoined(true);
                localStorage.setItem('fakeartist-session', JSON.stringify({
                    name: name.trim(),
                    avatar: userAvatar,
                    roomCode: code.toUpperCase(),
                    isJoined: true
                }));

                setGameState(response.gameState);
                if (response.myScore !== undefined) setMyScore(response.myScore);

                if (response.reconnected) {
                    setRole(response.role);
                    setSecretWord(response.secretWord);
                    setCategory(response.category);
                    setPlayerColor(response.color);
                    setRoleConfirmed(true);
                    
                    setCurrentRound(response.currentRound);
                    setTotalRounds(response.totalRounds);
                    setIsDrawer(response.isDrawer);
                    setCurrentDrawerId(response.currentDrawerId);
                    strokesHistoryRef.current = response.canvasHistory || [];
                    
                    if (response.accusedName) setAccusedName(response.accusedName);
                    
                    setTimeout(() => initAndDrawHistory(), 100);
                }
            }
        });
    };

    // Auto-join au montage si session sauvegardée
    useEffect(() => {
        const stored = localStorage.getItem('fakeartist-session');
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
    }, [urlRoomCode]);

    // Socket reconnect
    useEffect(() => {
        const handleConnect = () => {
            const stored = localStorage.getItem('fakeartist-session');
            if (stored) {
                try {
                    const session = JSON.parse(stored);
                    if (session.isJoined && session.roomCode && session.name) {
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
        document.body.classList.add('comic-theme');
        return () => {
            document.body.classList.remove('comic-theme');
            if (timerRef.current) clearInterval(timerRef.current);
        };
    }, []);

    // Socket listeners
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
            setSecretWord(data.secretWord);
            setCategory(data.category);
            setPlayerColor(data.color);
            setRoleConfirmed(false);
            setGameState('ROLE_REVEAL');
            strokesHistoryRef.current = [];
            setHasDrawnStroke(false);
            setVotedId(null);
            setGuessSubmitted(false);
            setGuessInput('');
        };

        const handleTurnUpdated = (data) => {
            const isMeDrawer = data.currentDrawerId === socket.id;
            setIsDrawer(isMeDrawer);
            setCurrentDrawerId(data.currentDrawerId);
            setCurrentRound(data.currentRound);
            strokesHistoryRef.current = data.canvasHistory || [];
            
            // Réinitialiser le tracé courant
            setHasDrawnStroke(false);
            setCurrentStrokePoints([]);
            
            setTimeout(() => {
                initAndDrawHistory();
            }, 100);
            
            if (isMeDrawer) {
                playSuccessSound();
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
                setTimeout(() => initAndDrawHistory(), 100);
            }

            if (data.gameState === 'VOTING') {
                playCountdownSound();
            } else if (data.gameState === 'GUESSING') {
                if (data.accusedId === socket.id) {
                    playFailSound();
                } else {
                    playSuccessSound();
                }
                setAccusedName(data.accusedName);
            } else if (data.gameState === 'GAME_END') {
                setWinner(data.winner);
                setSecretWord(data.secretWord);
                if (data.winner === 'impostor' && role === 'impostor') {
                    playWinnerSound();
                } else if (data.winner === 'artists' && role === 'artist') {
                    playWinnerSound();
                } else {
                    playFailSound();
                }
            } else if (data.gameState === 'LOBBY') {
                strokesHistoryRef.current = [];
            }
        };

        const handleRoomDeleted = () => {
            setError('Le salon a été supprimé.');
            setIsJoined(false);
            localStorage.removeItem('fakeartist-session');
        };

        socket.on('fakeartist-players-updated', handlePlayersUpdated);
        socket.on('fakeartist-role-assigned', handleRoleAssigned);
        socket.on('fakeartist-turn-updated', handleTurnUpdated);
        socket.on('fakeartist-game-state-updated', handleGameStateUpdated);
        socket.on('fakeartist-room-deleted', handleRoomDeleted);

        return () => {
            socket.off('fakeartist-players-updated', handlePlayersUpdated);
            socket.off('fakeartist-role-assigned', handleRoleAssigned);
            socket.off('fakeartist-turn-updated', handleTurnUpdated);
            socket.off('fakeartist-game-state-updated', handleGameStateUpdated);
            socket.off('fakeartist-room-deleted', handleRoomDeleted);
        };
    }, [isJoined, role]);

    // Initialiser le canvas et dessiner l'historique
    const initAndDrawHistory = () => {
        if (!canvasRef.current) return;
        const canvas = canvasRef.current;
        const r = canvas.getBoundingClientRect();
        canvas.width = r.width;
        canvas.height = r.height;
        
        const ctx = canvas.getContext('2d');
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        canvasContextRef.current = ctx;

        // Effacer
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Dessiner l'historique
        strokesHistoryRef.current.forEach(stroke => {
            drawStrokeOnContext(ctx, canvas, stroke);
        });
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

    // Resize canvas sur changement de taille
    useEffect(() => {
        if (!canvasRef.current || (gameState !== 'PLAYING' && gameState !== 'VOTING')) return;
        const handleResize = () => {
            initAndDrawHistory();
        };
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [gameState]);

    const handleJoin = () => {
        if (!playerName.trim()) { setError('Entrez votre pseudo'); return; }
        if (!roomCode.trim()) { setError('Entrez le code du salon'); return; }
        doJoin(roomCode, playerName, avatar);
    };

    const handleConfirmRole = () => {
        socket.emit('fakeartist-confirm-role', { roomCode }, (res) => {
            if (res.success) {
                setRoleConfirmed(true);
                setGameState('PLAYING');
            }
        });
    };

    // Coordonnées du canvas
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
        if (!isDrawer || hasDrawnStroke) return;
        e.preventDefault();
        setIsDrawing(true);
        const coords = getCanvasCoords(e);
        setCurrentStrokePoints([coords]);

        const ctx = canvasContextRef.current;
        const canvas = canvasRef.current;
        ctx.strokeStyle = playerColor?.value || '#000000';
        ctx.lineWidth = 8;
        ctx.beginPath();
        ctx.moveTo(coords.x * canvas.width, coords.y * canvas.height);
        ctx.lineTo(coords.x * canvas.width + 0.1, coords.y * canvas.height + 0.1);
        ctx.stroke();

        // Envoyer le trait temporaire en direct
        socket.emit('fakeartist-draw-stroke-live', {
            roomCode,
            stroke: { color: playerColor?.value || '#000000', size: 8, points: [coords] }
        });
    };

    const handleDrawMove = (e) => {
        if (!isDrawing || !isDrawer || hasDrawnStroke) return;
        e.preventDefault();
        const coords = getCanvasCoords(e);
        const prev = currentStrokePoints[currentStrokePoints.length - 1];
        if (!prev) return;
        
        setCurrentStrokePoints(prevPoints => {
            const nextPoints = [...prevPoints, coords];
            // Émettre le tracé live actualisé
            socket.emit('fakeartist-draw-stroke-live', {
                roomCode,
                stroke: { color: playerColor?.value || '#000000', size: 8, points: nextPoints }
            });
            return nextPoints;
        });

        const ctx = canvasContextRef.current;
        const canvas = canvasRef.current;
        ctx.strokeStyle = playerColor?.value || '#000000';
        ctx.lineWidth = 8;
        ctx.beginPath();
        ctx.moveTo(prev.x * canvas.width, prev.y * canvas.height);
        ctx.lineTo(coords.x * canvas.width, coords.y * canvas.height);
        ctx.stroke();
    };

    const handleDrawEnd = () => {
        if (!isDrawing || !isDrawer || hasDrawnStroke) return;
        setIsDrawing(false);
        if (currentStrokePoints.length > 0) {
            setHasDrawnStroke(true);
        }
    };

    const handleClearStroke = () => {
        setHasDrawnStroke(false);
        setCurrentStrokePoints([]);
        initAndDrawHistory();
        socket.emit('fakeartist-clear-stroke-live', { roomCode });
    };

    const handleValidateStroke = () => {
        if (currentStrokePoints.length === 0) return;
        const stroke = {
            color: playerColor?.value || '#000000',
            size: 8,
            points: currentStrokePoints
        };
        socket.emit('fakeartist-validate-stroke', { roomCode, stroke });
        setHasDrawnStroke(false);
        setIsDrawer(false);
    };

    const handleVote = (candidateId) => {
        if (votedId) return;
        socket.emit('fakeartist-submit-vote', { roomCode, votedId: candidateId }, (res) => {
            if (res.success) {
                setVotedId(candidateId);
            }
        });
    };

    const handleImpostorGuess = (e) => {
        e.preventDefault();
        if (!guessInput.trim() || guessSubmitted) return;
        socket.emit('fakeartist-submit-guess', { roomCode, guess: guessInput.trim() }, (res) => {
            if (res.success) {
                setGuessSubmitted(true);
            }
        });
    };

    // ─── STATE: CONNECT / LOGIN ───
    if (!isJoined) {
        return (
            <div className="min-h-screen flex items-center justify-center p-6 bg-[#FFFBF0]">
                <div className="sk-box p-6 w-full max-w-sm bg-white">
                    <h2 className="text-2xl sk-h mb-5 text-[#FF3B30] text-center italic">Fake Artist</h2>
                    
                    {error && (
                        <div className="mb-4 p-3 bg-[#FFE0DC] border-2 border-[#FF3B30] text-[#FF3B30] rounded-xl text-xs font-black uppercase text-center">
                            ⚠️ {error}
                        </div>
                    )}

                    <div className="flex flex-col gap-4">
                        <div>
                            <label className="text-xs font-black uppercase text-[#161a33]/60 block mb-1">Pseudo :</label>
                            <input
                                type="text"
                                className="w-full bg-[#FFFBF0] border-3 border-[#161a33] py-2.5 px-4 rounded-xl font-bold text-sm text-[#161a33] outline-none focus:border-[#FF3B30]"
                                placeholder="Ton pseudo..."
                                value={playerName}
                                onChange={(e) => setPlayerName(e.target.value)}
                                maxLength={12}
                            />
                        </div>

                        <div>
                            <label className="text-xs font-black uppercase text-[#161a33]/60 block mb-1">Code du Salon :</label>
                            <input
                                type="text"
                                className="w-full bg-[#FFFBF0] border-3 border-[#161a33] py-2.5 px-4 rounded-xl font-bold text-lg text-center tracking-[0.2em] text-[#0055FF] outline-none uppercase focus:border-[#0055FF]"
                                placeholder="CODE"
                                value={roomCode}
                                onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                                maxLength={6}
                            />
                        </div>

                        {/* Avatars */}
                        <div>
                            <label className="text-xs font-black uppercase text-[#161a33]/60 block mb-1">Avatar :</label>
                            <div className="flex items-center justify-between gap-3 bg-[#FFFBF0] border-3 border-[#161a33] p-3 rounded-xl">
                                <button 
                                    onClick={() => {
                                        const idx = ALL_AVATARS.indexOf(avatar);
                                        const prev = idx > 0 ? ALL_AVATARS[idx - 1] : ALL_AVATARS[ALL_AVATARS.length - 1];
                                        setAvatar(prev);
                                    }}
                                    className="sk-btn sk-btn-secondary p-1 w-8 h-8 rounded-lg"
                                >
                                    ◀
                                </button>
                                <img src={avatar} alt="" className="w-16 h-16 rounded-xl border-3 border-[#161a33] bg-white object-cover" />
                                <button 
                                    onClick={() => {
                                        const idx = ALL_AVATARS.indexOf(avatar);
                                        const next = idx < ALL_AVATARS.length - 1 ? ALL_AVATARS[idx + 1] : ALL_AVATARS[0];
                                        setAvatar(next);
                                    }}
                                    className="sk-btn sk-btn-secondary p-1 w-8 h-8 rounded-lg"
                                >
                                    ▶
                                </button>
                            </div>
                        </div>

                        <button
                            onClick={handleJoin}
                            disabled={!playerName.trim() || !roomCode.trim()}
                            className="sk-btn sk-btn-primary w-full py-3 mt-2 flex items-center justify-center gap-1"
                        >
                            <span className="material-symbols-outlined text-base">brush</span>
                            Rejoindre
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // ─── STATE: LOBBY (WAITING) ───
    if (gameState === 'LOBBY') {
        return (
            <div className="min-h-screen flex flex-col bg-[#FFFBF0] justify-between">
                {/* Status Bar */}
                <div className="flex justify-between items-center px-4 py-2 border-b-2 border-[#161a33]/10 text-xs font-bold text-[#161a33]/50 bg-white">
                    <span>Lobby</span>
                    <span className="uppercase font-black text-[#FF3B30]">Code : {roomCode}</span>
                </div>

                <div className="flex-1 flex flex-col items-center justify-center p-6 text-center gap-6">
                    <img src={avatar} alt="" className="w-24 h-24 rounded-2xl border-4 border-[#161a33] shadow-[4px_4px_0_#161a33] object-cover bg-white" />
                    <div>
                        <h2 className="text-2xl sk-h text-[#161a33]">{playerName}</h2>
                        <div className="inline-block mt-2 px-3 py-1 bg-[#C2DCFF] border-2 border-[#161a33] rounded-lg text-xs font-black uppercase text-[#161a33]">
                            Couleur assignée : {playerColor?.name || 'En cours...'}
                            {playerColor && (
                                <span className="inline-block w-3 h-3 rounded-full border border-[#161a33] ml-1.5 align-middle" style={{ backgroundColor: playerColor.value }} />
                            )}
                        </div>
                    </div>

                    <div className="sk-box p-6 w-full max-w-xs text-center flex flex-col items-center gap-2">
                        <span className="material-symbols-outlined text-[#FF3B30] text-3xl animate-pulse">hourglass_empty</span>
                        <p className="text-xs font-black text-[#161a33] uppercase">En attente de l'hôte...</p>
                    </div>
                </div>

                <div className="p-4 text-center text-[10px] font-black uppercase text-[#161a33]/40 border-t-2 border-[#161a33]/5 bg-white">
                    Prépare tes talents de détective et d'artiste !
                </div>
            </div>
        );
    }

    // ─── STATE: ROLE REVEAL ───
    if (gameState === 'ROLE_REVEAL') {
        const isImpostor = role === 'impostor';
        return (
            <div className="min-h-screen flex flex-col bg-[#FFFBF0] justify-between p-4">
                <div className="text-center text-xs font-black text-[#161a33]/40 uppercase mt-4">
                    Distribution des Rôles
                </div>

                <div className="flex-1 flex flex-col items-center justify-center max-w-sm mx-auto w-full">
                    <div className="fa-role-card bg-white border-4 border-[#161a33] p-8 rounded-2xl shadow-[8px_8px_0_#161a33] w-full text-center flex flex-col items-center gap-6">
                        <div className="w-16 h-16 rounded-full border-3 border-[#161a33] flex items-center justify-center bg-[#FFFBF0]">
                            <span className="text-3xl">{isImpostor ? '🕵️‍♂️' : '🎨'}</span>
                        </div>

                        <div>
                            <div className="text-xs font-black uppercase text-[#161a33]/60 mb-1">Votre rôle secret :</div>
                            <h2 className={`text-3xl sk-h ${isImpostor ? 'fa-impostor-text' : 'fa-artist-text'}`}>
                                {isImpostor ? "L'Imposteur" : "Artiste"}
                            </h2>
                        </div>

                        <div className="w-full bg-[#FFFBF0] border-3 border-[#161a33] p-5 rounded-xl text-center shadow-[3px_3px_0_#161a33]">
                            <div className="text-[10px] font-black uppercase text-[#161a33]/60 mb-2">Mot à dessiner :</div>
                            <div className="text-3xl font-black uppercase text-[#161a33] tracking-widest">
                                {isImpostor ? '?' : secretWord}
                            </div>
                        </div>

                        <div className="text-xs font-bold text-[#161a33]/80 leading-relaxed">
                            {isImpostor ? (
                                <>
                                    Vous ne connaissez pas le mot. Dessinez des traits vagues pour faire croire que vous savez, et devinez le mot secret !
                                </>
                            ) : (
                                <>
                                    Vous connaissez le mot. Dessinez de manière à ce que les artistes vous comprennent, sans être trop évident pour l'imposteur !
                                </>
                            )}
                            <div className="mt-3 font-black uppercase text-[#FF3B30]">
                                Catégorie : {category}
                            </div>
                            <div className="mt-2 text-[10px] text-[#161a33]/60">
                                Ta couleur de tracé : <span className="font-black text-[#161a33]" style={{ color: playerColor?.value }}>{playerColor?.name}</span>
                            </div>
                        </div>

                        <button
                            onClick={handleConfirmRole}
                            className="sk-btn sk-btn-primary w-full py-3.5 flex items-center justify-center gap-1"
                        >
                            <span className="material-symbols-outlined text-base">check_circle</span>
                            Compris, je suis prêt !
                        </button>
                    </div>
                </div>

                <div className="text-center text-[10px] font-black text-[#FF3B30] uppercase">
                    Ne montre ton écran à personne !
                </div>
            </div>
        );
    }

    // ─── STATE: PLAYING ───
    if (gameState === 'PLAYING') {
        const isMyTurn = currentDrawerId === socket.id;
        const activeDrawer = players.find(p => p.id === currentDrawerId);

        return (
            <div className="h-screen flex flex-col overflow-hidden bg-[#FFFBF0] relative"
                 style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
                
                {/* Header status */}
                <div className="flex justify-between items-center px-4 py-2 border-b-3 border-[#161a33] text-xs font-black bg-white flex-shrink-0">
                    <div className="flex items-center gap-1.5">
                        <span className="sk-pill sk-pill-blue py-0.5 px-2 text-[10px]">{currentRound}/{totalRounds}</span>
                        <span className="text-[#161a33]/60 font-bold">Cat :</span>
                        <span className="text-[#161a33] uppercase">{category}</span>
                    </div>
                    <div className="text-right">
                        <span className="text-[10px] font-black text-[#161a33]/60 uppercase">Mon mot : </span>
                        <span className="text-sm font-black uppercase text-[#FF3B30]">{role === 'impostor' ? '?' : secretWord}</span>
                    </div>
                </div>

                {/* Turn Info Bar */}
                <div className={`px-4 py-2.5 border-b-3 border-[#161a33] flex-shrink-0 text-center font-black uppercase text-sm ${isMyTurn ? 'bg-[#FFD60A] text-[#161a33]' : 'bg-[#C2DCFF] text-[#161a33]'}`}>
                    {isMyTurn ? (
                        <div className="flex items-center justify-center gap-1 animate-pulse">
                            <span className="material-symbols-outlined text-base">brush</span>
                            À TOI DE DESSINER ! (1 trait continu)
                        </div>
                    ) : (
                        <div>
                            🎨 {activeDrawer ? activeDrawer.name : 'Quelqu\'un'} dessine...
                        </div>
                    )}
                </div>

                {/* Drawing Canvas Area */}
                <div className="flex-1 min-h-0 flex items-center justify-center p-4 relative">
                    <div className={`canvas-container-4-3 ${!isMyTurn ? 'draw-canvas-viewer' : ''}`}>
                        <canvas
                            ref={canvasRef}
                            className="draw-canvas bg-white"
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

                {/* Bottom tools (active ONLY when it's my turn & I have drawn a stroke) */}
                {isMyTurn && (
                    <div className="flex-shrink-0 px-4 pb-4 flex flex-col gap-2.5 bg-[#FFFBF0]">
                        {hasDrawnStroke ? (
                            <div className="flex gap-3">
                                <button
                                    onClick={handleClearStroke}
                                    className="flex-1 sk-btn sk-btn-danger py-3 flex items-center justify-center gap-1"
                                >
                                    <span className="material-symbols-outlined text-base">delete</span>
                                    Recommencer
                                </button>
                                <button
                                    onClick={handleValidateStroke}
                                    className="flex-1 sk-btn sk-btn-primary py-3 flex items-center justify-center gap-1"
                                >
                                    <span className="material-symbols-outlined text-base">check</span>
                                    Valider le trait
                                </button>
                            </div>
                        ) : (
                            <div className="sk-box p-3 text-center bg-white text-xs font-black uppercase border-2 border-dashed border-[#161a33]/30 text-[#161a33]/60">
                                Pose ton doigt sur la zone blanche et trace ta ligne !
                            </div>
                        )}
                    </div>
                )}

                {/* Watch mode (when not my turn) */}
                {!isMyTurn && (
                    <div className="flex-shrink-0 px-4 pb-4 bg-[#FFFBF0]">
                        <div className="sk-box p-3 bg-white text-center text-xs font-black uppercase text-[#161a33]/70">
                            Regarde l'écran géant pour voir le dessin se former !
                        </div>
                    </div>
                )}
            </div>
        );
    }

    // ─── STATE: VOTING ───
    if (gameState === 'VOTING') {
        const otherPlayers = players.filter(p => p.id !== socket.id);

        return (
            <div className="min-h-screen flex flex-col bg-[#FFFBF0] justify-between p-4">
                <div>
                    <div className="text-center text-xs font-black text-[#161a33]/40 uppercase mt-2">
                        Phase de Délibération
                    </div>
                    <h2 className="text-2xl sk-h text-[#FF3B30] text-center mt-1 italic">Qui est l'imposteur ?</h2>
                </div>

                <div className="flex-1 flex flex-col items-center justify-center my-6 w-full max-w-sm mx-auto">
                    {votedId ? (
                        <div className="sk-box p-8 w-full text-center bg-white flex flex-col items-center gap-3">
                            <span className="material-symbols-outlined text-4xl text-[#00D26A]">check_circle</span>
                            <h3 className="text-lg sk-h">Vote enregistré !</h3>
                            <p className="text-xs font-bold text-[#161a33]/60 uppercase mt-1">
                                Tu as voté pour : <span className="font-black text-[#FF3B30]">{players.find(p => p.id === votedId)?.name}</span>
                            </p>
                            <p className="text-[10px] text-[#161a33]/50 mt-2">En attente des autres votes...</p>
                        </div>
                    ) : (
                        <div className="w-full flex flex-col gap-3">
                            <p className="text-xs font-bold text-center text-[#161a33]/70 mb-2">Sélectionnez le suspect :</p>
                            <div className="fa-vote-grid">
                                {otherPlayers.map(p => (
                                    <button
                                        key={p.id}
                                        onClick={() => handleVote(p.id)}
                                        className="fa-vote-btn"
                                        disabled={p.disconnected}
                                    >
                                        <img src={p.avatar} alt="" className="w-10 h-10 rounded-full border-2 border-[#161a33]" />
                                        <span className="truncate w-full text-center">{p.name}</span>
                                        <div className="fa-color-dot" style={{ backgroundColor: p.color?.value }} />
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                <div className="text-center text-[10px] font-black text-[#161a33]/40">
                    Débattez ensemble à haute voix avant de valider votre choix !
                </div>
            </div>
        );
    }

    // ─── STATE: GUESSING ───
    if (gameState === 'GUESSING') {
        const isMeImpostor = role === 'impostor';

        return (
            <div className="min-h-screen flex flex-col bg-[#FFFBF0] justify-between p-4">
                <div className="text-center text-xs font-black text-[#161a33]/40 uppercase mt-2">
                    Phase de Verdict
                </div>

                <div className="flex-1 flex flex-col items-center justify-center max-w-sm mx-auto w-full my-6">
                    {isMeImpostor ? (
                        <form onSubmit={handleImpostorGuess} className="bg-white border-4 border-[#161a33] p-6 rounded-2xl shadow-[6px_6px_0_#161a33] w-full text-center flex flex-col gap-5">
                            <div className="fa-badge fa-badge-red text-xs font-black w-fit mx-auto">Démasqué !</div>
                            <h2 className="text-xl sk-h text-[#FF3B30]">Dernière chance !</h2>
                            <p className="text-xs font-bold text-[#161a33]/80 leading-relaxed">
                                Les artistes vous ont trouvé. Mais si vous devinez le **mot secret**, vous volez la victoire !
                            </p>
                            <div className="text-[10px] font-black text-[#FF3B30] uppercase">
                                Catégorie : {category}
                            </div>

                            {guessSubmitted ? (
                                <div className="p-4 bg-[#C2DCFF] border-2 border-[#161a33] rounded-xl text-center">
                                    <div className="text-[10px] font-black uppercase text-[#161a33]/60">Proposition envoyée :</div>
                                    <div className="text-lg font-black text-[#161a33] uppercase mt-1">"{guessInput}"</div>
                                    <div className="text-[9px] font-bold text-[#161a33]/60 mt-3">En attente de la validation par l'Hôte...</div>
                                </div>
                            ) : (
                                <div className="flex flex-col gap-3">
                                    <input
                                        type="text"
                                        className="fa-impostor-input bg-[#FFFBF0]"
                                        placeholder="Le mot secret..."
                                        value={guessInput}
                                        onChange={(e) => setGuessInput(e.target.value)}
                                        disabled={guessSubmitted}
                                        required
                                        autoComplete="off"
                                    />
                                    <button
                                        type="submit"
                                        disabled={!guessInput.trim()}
                                        className="sk-btn sk-btn-primary py-3"
                                    >
                                        Soumettre ma devinette
                                    </button>
                                </div>
                            )}
                        </form>
                    ) : (
                        <div className="bg-white border-4 border-[#161a33] p-6 rounded-2xl shadow-[6px_6px_0_#161a33] w-full text-center flex flex-col items-center gap-4">
                            <span className="material-symbols-outlined text-[#00D26A] text-4xl">gavel</span>
                            <h2 className="text-xl sk-h text-[#00D26A]">Imposteur démasqué !</h2>
                            <p className="text-xs font-bold text-[#161a33]/80 leading-relaxed">
                                Vous avez correctement identifié <span className="font-black text-[#FF3B30]">{accusedName}</span> comme le Fake Artist !
                            </p>
                            <div className="sk-box p-4 w-full bg-[#FFFBF0] border-2 border-dashed border-[#161a33]/20 flex flex-col items-center gap-2">
                                <span className="material-symbols-outlined text-base animate-pulse text-[#FF3B30]">hourglass_empty</span>
                                <p className="text-[10px] font-black uppercase text-[#161a33]/60">L'imposteur propose un mot...</p>
                            </div>
                        </div>
                    )}
                </div>

                <div className="text-center text-[10px] font-black text-[#161a33]/40">
                    Regardez l'écran géant pour voir si la réponse est validée !
                </div>
            </div>
        );
    }

    // ─── STATE: GAME_END ───
    if (gameState === 'GAME_END') {
        const isImpostorWin = winner === 'impostor';
        const isMeWin = (isImpostorWin && role === 'impostor') || (!isImpostorWin && role === 'artist');

        return (
            <div className="min-h-screen flex flex-col bg-[#FFFBF0] justify-between p-4">
                <div className="text-center text-xs font-black text-[#161a33]/40 uppercase mt-2">
                    Partie Terminée
                </div>

                <div className="flex-1 flex flex-col items-center justify-center max-w-sm mx-auto w-full my-6">
                    <div className="bg-white border-4 border-[#161a33] p-6 rounded-2xl shadow-[6px_6px_0_#161a33] w-full text-center flex flex-col items-center gap-5">
                        <div className="w-16 h-16 rounded-full border-3 border-[#161a33] flex items-center justify-center bg-[#FFFBF0]">
                            <span className="text-4xl">{isMeWin ? '🏆' : '💀'}</span>
                        </div>

                        <div>
                            <h2 className="text-2xl sk-h italic">
                                {isMeWin ? "Victoire !" : "Défaite..."}
                            </h2>
                            <p className="text-xs font-bold text-[#161a33]/60 uppercase mt-1">
                                {isImpostorWin ? "L'imposteur a gagné" : "Les artistes ont gagné"}
                            </p>
                        </div>

                        <div className="w-full bg-[#FFFBF0] border-2 border-[#161a33] p-4 rounded-xl text-center">
                            <div className="text-[10px] font-black uppercase text-[#161a33]/60">Le mot secret était :</div>
                            <div className="text-xl font-black uppercase mt-1 text-[#0055FF] tracking-wider">"{secretWord}"</div>
                        </div>

                        <div className="text-xs font-bold text-[#161a33]/70">
                            Votre score actuel : <span className="font-black text-[#FF3B30] text-sm">{myScore} points</span>
                        </div>
                    </div>
                </div>

                <div className="sk-box p-3 bg-white text-center text-xs font-black uppercase text-[#161a33]/60 border-t-2 border-[#161a33]/5 w-full">
                    En attente du lancement d'une nouvelle partie par l'hôte...
                </div>
            </div>
        );
    }

    return null;
}

export default FakeArtistPlayerView;
