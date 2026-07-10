import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { QRCodeSVG } from 'qrcode.react';
import confetti from 'canvas-confetti';
import {
    Palette, Users, Minus, Plus, Play, ArrowRight, Trophy, Crown,
    Clock, Check, X, RotateCcw, LogOut, Hash, Shapes
} from 'lucide-react';
import { socket } from '../../socket';
import { renderSilhouette, hsbToCss } from './ColorSilhouettes';
import { getCategoryMeta, sortCategories } from './colorCategories';
import './ColorStyles.css';

function getImageUrl(imagePath) {
    if (!imagePath) return '';
    if (imagePath.startsWith('http') || imagePath.startsWith('data:')) return imagePath;
    if (imagePath.startsWith('/color/')) return imagePath;
    const isHttps = window.location.protocol === 'https:';
    const serverPort = isHttps ? 3443 : 3005;
    const base = import.meta.env.VITE_SERVER_URL
        ? import.meta.env.VITE_SERVER_URL
        : (!import.meta.env.DEV ? '' : `${window.location.protocol}//${window.location.hostname}:${serverPort}`);
    return `${base}${imagePath}`;
}

// Base des routes REST (liste des univers). Aligné sur ColorAdmin.
const API_BASE = (() => {
    if (import.meta.env.VITE_SERVER_URL) return `${import.meta.env.VITE_SERVER_URL}/api`;
    if (!import.meta.env.DEV) return '/api';
    const port = window.location.protocol === 'https:' ? 3443 : 3005;
    return `${window.location.protocol}//${window.location.hostname}:${port}/api`;
})();

// Cyclic palette to differentiate players' avatar rings.
const PLAYER_COLORS = ['#f59e0b','#34d399','#60a5fa','#c084fc','#fb7185','#22d3ee','#a3e635','#f472b6'];
const SPRING = { type: 'spring', stiffness: 120, damping: 16 };
const MEDALS = ['#f5b544', '#c9cdd6', '#cd8b5a']; // gold, silver, bronze

// ─── Session hôte (persistance + reconnexion, pattern GeoTrackr) ───
const HOST_SESSION_KEY = 'color-host-session';
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

function Avatar({ src, name, idx, size = 36, ring }) {
    return (
        <div className="cm-avatar grid place-items-center overflow-hidden shrink-0 font-bold text-[#0b0b11]"
             style={{ width: size, height: size, background: PLAYER_COLORS[idx % PLAYER_COLORS.length],
                      borderColor: ring || 'var(--cm-line-strong)', borderWidth: ring ? 2 : 1, fontSize: size * 0.4 }}>
            {src ? <img src={src} alt={name} className="w-full h-full object-cover" /> : (name?.charAt(0).toUpperCase() || '?')}
        </div>
    );
}

function ColorHostView() {
    const navigate = useNavigate();
    const reduce = useReducedMotion();
    const [searchParams] = useSearchParams();
    const [roomCode, setRoomCode] = useState('');
    const [gameState, setGameState] = useState('LOBBY');
    const [players, setPlayers] = useState([]);
    const [currentRound, setCurrentRound] = useState(0);
    const [totalRounds, setTotalRounds] = useState(5);
    const [timePerRound, setTimePerRound] = useState(60);
    const [timer, setTimer] = useState(60);
    const [character, setCharacter] = useState(null);
    const [roundResults, setRoundResults] = useState([]);
    const [finalResults, setFinalResults] = useState([]);
    const [awards, setAwards] = useState([]);
    const [imageError, setImageError] = useState(false);
    const [reactions, setReactions] = useState([]);
    const [chatMessages, setChatMessages] = useState([]);
    const [categories, setCategories] = useState([]);
    const [selectedCategory, setSelectedCategory] = useState(null); // null = tous les univers

    // Charge la liste des univers disponibles (avec compte de personnages) pour le lobby.
    useEffect(() => {
        fetch(`${API_BASE}/color/categories`)
            .then(r => (r.ok ? r.json() : []))
            .then(data => setCategories(sortCategories(Array.isArray(data) ? data : [])))
            .catch(() => { /* liste vide → seul "Toutes" sera proposé */ });
    }, []);

    const playSound = (type) => {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            if (type === 'tick' && timer <= 5) {
                osc.frequency.setValueAtTime(440, ctx.currentTime);
                gain.gain.setValueAtTime(0.05, ctx.currentTime);
                osc.start(); osc.stop(ctx.currentTime + 0.08);
            } else if (type === 'timeup') {
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(220, ctx.currentTime);
                gain.gain.setValueAtTime(0.1, ctx.currentTime);
                osc.start(); osc.stop(ctx.currentTime + 0.35);
            } else if (type === 'reveal') {
                osc.type = 'sine';
                osc.frequency.setValueAtTime(660, ctx.currentTime);
                osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.2);
                gain.gain.setValueAtTime(0.15, ctx.currentTime);
                osc.start(); osc.stop(ctx.currentTime + 0.25);
            }
        } catch { /* AudioContext unavailable */ }
    };

    const triggerEndRound = () => socket.emit('color-end-round', { roomCode });

    // Garde le code de salon courant accessible dans le handler `connect` (closures).
    const roomCodeRef = useRef('');
    useEffect(() => { roomCodeRef.current = roomCode; }, [roomCode]);

    useEffect(() => {
        const applyReconnect = (response) => {
            setRoomCode(response.roomCode);
            setGameState(response.gameState);
            setCurrentRound(response.currentRound);
            setTotalRounds(response.totalRounds);
            setPlayers(response.players || []);
            setTimePerRound(response.timePerRound);
            setCharacter(response.character);
            if (response.roundStartTime) {
                const elapsed = Math.round((Date.now() - response.roundStartTime) / 1000);
                setTimer(Math.max(0, response.timePerRound - elapsed));
            }
            writeHostSession(response.roomCode);
        };

        const createFreshRoom = () => {
            socket.emit('color-create-room', { settings: { roundsCount: 5, timePerRound: 60 } }, (response) => {
                if (response.error) { alert('Erreur lors de la création de la salle'); clearHostSession(); navigate('/color'); }
                else { setRoomCode(response.roomCode); writeHostSession(response.roomCode); }
            });
        };

        // Reconnexion à un salon existant avec timeout de secours → fallback (ex. nouvelle salle).
        const reconnectHost = (code, onFail) => {
            let handled = false;
            const t = setTimeout(() => { if (!handled) { handled = true; onFail(); } }, 4000);
            socket.emit('color-host-reconnect', { roomCode: code.toUpperCase() }, (response) => {
                clearTimeout(t);
                if (handled) return;
                handled = true;
                if (response.error) onFail();
                else applyReconnect(response);
            });
        };

        // Décision au montage : URL ?code= > session locale fraîche > nouvelle salle.
        const urlCode = searchParams.get('code');
        const saved = readHostSession();
        const sessionFresh = saved && saved.roomCode && (Date.now() - (saved.createdAt || 0) < HOST_SESSION_TTL);

        if (urlCode) {
            reconnectHost(urlCode, createFreshRoom);
        } else if (sessionFresh) {
            reconnectHost(saved.roomCode, () => { clearHostSession(); createFreshRoom(); });
        } else {
            if (saved) clearHostSession();
            createFreshRoom();
        }

        // Reconnexion automatique sur coupure réseau / veille (le socket revient).
        const handleReconnect = () => {
            const code = roomCodeRef.current;
            if (!code) return; // pas encore de salle créée → rien à reconnecter
            reconnectHost(code, () => { clearHostSession(); createFreshRoom(); });
        };
        socket.on('connect', handleReconnect);
        return () => socket.off('connect', handleReconnect);
    }, [searchParams, navigate]);

    useEffect(() => {
        socket.on('color-player-joined', (playersList) => setPlayers(playersList));
        socket.on('color-player-left', (playersList) => setPlayers(playersList));
        socket.on('color-settings-updated', ({ roundsCount, timePerRound, category }) => {
            setTotalRounds(roundsCount); setTimePerRound(timePerRound); setTimer(timePerRound);
            if (category !== undefined) setSelectedCategory(category || null);
        });
        socket.on('color-game-started', (data) => {
            setGameState('PLAYING'); setCurrentRound(data.round); setTotalRounds(data.total);
            setCharacter(data.character); setTimer(data.timePerRound);
            setImageError(false); setRoundResults([]);
            setPlayers(prev => prev.map(p => ({ ...p, hasGuessed: false })));
        });
        socket.on('color-player-guessed', ({ playerId }) => {
            setPlayers(prev => prev.map(p => p.id === playerId ? { ...p, hasGuessed: true } : p));
        });
        socket.on('color-all-guessed', () => { if (gameState === 'PLAYING') triggerEndRound(); });
        socket.on('color-round-ended', (data) => {
            setGameState('ROUND_END'); setCharacter(data.character);
            setRoundResults(data.results); setCurrentRound(data.currentRound);
            setTotalRounds(data.totalRounds); playSound('reveal');
            setPlayers(prev => prev.map(p => {
                const r = data.results.find(r => r.id === p.id);
                return r ? { ...p, totalScore: r.totalScore, hasGuessed: false } : p;
            }));
            if (data.results.filter(r => r.roundScore >= 9.5).length > 0)
                confetti({ particleCount: 80, spread: 60, origin: { y: 0.6 } });
        });
        socket.on('color-next-round', (data) => {
            setGameState('PLAYING'); setCurrentRound(data.round); setTotalRounds(data.total);
            setCharacter(data.character); setTimer(data.timePerRound);
            setImageError(false); setRoundResults([]);
            setPlayers(prev => prev.map(p => ({ ...p, hasGuessed: false })));
        });
        socket.on('color-game-over', (data) => {
            setGameState('GAME_END'); setFinalResults(data.results); setAwards(data.awards);
            confetti({ particleCount: 150, spread: 80, origin: { y: 0.4 } });
            setTimeout(() => confetti({ particleCount: 100, spread: 100, origin: { y: 0.6 } }), 500);
        });
        socket.on('color-game-restarted', () => {
            setGameState('LOBBY'); setRoundResults([]); setFinalResults([]);
            setAwards([]); setCharacter(null);
            setPlayers(prev => prev.map(p => ({ ...p, totalScore: 0, hasGuessed: false })));
        });
        socket.on('color-reaction', ({ emoji, playerName }) => {
            const id = Date.now() + Math.random();
            const left = Math.random() * 76 + 12;
            const drift = `${(Math.random() - 0.5) * 120}px`;
            setReactions(prev => [...prev, { id, emoji, playerName, left, drift }]);
            setTimeout(() => setReactions(prev => prev.filter(r => r.id !== id)), 4200);
        });
        socket.on('color-chat-message', (msg) => {
            setChatMessages(prev => [msg, ...prev].slice(0, 5));
            setTimeout(() => setChatMessages(prev => prev.filter(m => m.id !== msg.id)), 6000);
        });
        return () => {
            ['color-player-joined','color-player-left','color-settings-updated','color-game-started',
             'color-player-guessed','color-all-guessed','color-round-ended','color-next-round',
             'color-game-over','color-game-restarted','color-reaction','color-chat-message']
            .forEach(e => socket.off(e));
        };
    }, [gameState]);

    useEffect(() => {
        if (gameState !== 'PLAYING') return;
        const interval = setInterval(() => {
            setTimer(prev => {
                if (prev <= 1) { clearInterval(interval); triggerEndRound(); return 0; }
                if (prev <= 6) playSound('tick');
                return prev - 1;
            });
        }, 1000);
        return () => clearInterval(interval);
    }, [gameState, timer]);

    const handleStartGame = () => socket.emit('color-start-game', { roomCode, settings: { roundsCount: totalRounds, timePerRound, category: selectedCategory } });
    const handleNextRound = () => socket.emit('color-next-round', { roomCode });
    const handleRestartGame = () => socket.emit('color-restart-game', { roomCode });
    const handleKickPlayer = (id) => socket.emit('color-kick-player', { roomCode, playerId: id });
    const selectCategory = (cat) => {
        if (gameState !== 'LOBBY') return;
        setSelectedCategory(cat);
        socket.emit('color-update-settings', { roomCode, settings: { roundsCount: totalRounds, timePerRound, category: cat } });
    };
    const adjustSetting = (field, amount) => {
        if (gameState !== 'LOBBY') return;
        let newRounds = totalRounds, newTime = timePerRound;
        if (field === 'rounds') newRounds = Math.max(3, Math.min(10, totalRounds + amount));
        else if (field === 'time') newTime = Math.max(15, Math.min(120, timePerRound + amount));
        socket.emit('color-update-settings', { roomCode, settings: { roundsCount: newRounds, timePerRound: newTime } });
    };

    const joinUrl = `${window.location.protocol}//${window.location.host}/join/${roomCode}`;
    const targetColor = character ? hsbToCss(character.target_h, character.target_s, character.target_b) : '#f59e0b';
    const timerPct = (timer / timePerRound) * 100;
    const timerColor = timer <= 10 ? '#fb7185' : timer <= 20 ? '#f59e0b' : '#34d399';
    // The room is lit by the target color only at the reveal; neutral otherwise.
    const live = gameState === 'ROUND_END' ? targetColor : '#f59e0b';

    return (
        <div className="cm-root cm-scroll relative w-full h-[100dvh] overflow-y-auto flex flex-col select-none"
             style={{ '--live': live }}>
            <div className="cm-bg-grid" />
            <div className="cm-bg-pool" style={{ background: `radial-gradient(55% 45% at 50% 0%, ${live}1c, transparent 70%)` }} />

            {/* Floating reactions */}
            <div className="pointer-events-none fixed inset-0" style={{ zIndex: 'var(--z-reaction)' }}>
                {reactions.map(r => (
                    <div key={r.id} className="cm-reaction" style={{ left: `${r.left}%`, '--drift': r.drift }}>
                        <span className="text-5xl">{r.emoji}</span>
                        <span className="cm-chip mt-1 !py-0.5 !text-[10px]">{r.playerName}</span>
                    </div>
                ))}
            </div>

            {/* Chat ticker */}
            <div className="fixed bottom-5 left-5 w-[300px] max-h-[250px] flex flex-col-reverse gap-2 pointer-events-none" style={{ zIndex: 'var(--z-sticky)' }}>
                <AnimatePresence>
                    {chatMessages.map(m => (
                        <motion.div key={m.id} layout initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
                                    className="cm-glass px-3 py-2 rounded-[var(--cm-r-sm)] text-sm">
                            <span className="font-bold text-[var(--cm-accent)] mr-1.5">{m.playerName}</span>
                            <span className="text-[var(--cm-ink-2)]">{m.message}</span>
                        </motion.div>
                    ))}
                </AnimatePresence>
            </div>

            {/* ── HEADER ── */}
            <header className="relative z-10 px-6 lg:px-10 h-16 flex items-center justify-between border-b border-[var(--cm-line)] shrink-0">
                <div className="flex items-center gap-3">
                    <Palette className="w-6 h-6 text-[var(--cm-accent)]" />
                    <h1 className="text-xl font-bold">Couleur Moi</h1>
                    {gameState !== 'LOBBY' && (
                        <span className="cm-chip ml-1">Manche <span className="cm-mono text-[var(--cm-ink)] ml-1">{currentRound}/{totalRounds}</span></span>
                    )}
                </div>
                <div className="cm-chip gap-2">
                    <Hash className="w-3.5 h-3.5 text-[var(--cm-faint)]" />
                    <span className="cm-room-code text-base">{roomCode || '·····'}</span>
                </div>
            </header>

            {/* ── MAIN ── */}
            <main className="relative z-10 flex-1 w-full max-w-[1280px] mx-auto px-6 lg:px-10 py-8 flex flex-col justify-center">

                {/* ════════ LOBBY ════════ */}
                {gameState === 'LOBBY' && (
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch w-full">
                        <div className="lg:col-span-7 flex flex-col gap-5">
                            <div className="cm-panel p-7">
                                <h2 className="text-2xl font-bold">Rejoindre la partie</h2>
                                <p className="text-sm text-[var(--cm-ink-2)] mt-1 mb-6">Scanne le QR code ou saisis le code sur ton téléphone.</p>

                                <div className="flex flex-col sm:flex-row gap-6 items-center">
                                    <div className="p-3 rounded-[var(--cm-r-md)] bg-white shrink-0">
                                        <QRCodeSVG value={joinUrl} size={150} />
                                    </div>
                                    <div className="flex flex-col gap-4 w-full">
                                        <div className="rounded-[var(--cm-r-md)] py-4 text-center" style={{ background: 'var(--cm-bg-2)', border: '1px solid var(--cm-line)' }}>
                                            <div className="cm-label mb-1">Code du salon</div>
                                            <div className="cm-room-code text-4xl">{roomCode || '·····'}</div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-3">
                                            {[
                                                { label: 'Manches', field: 'rounds', value: totalRounds, step: 1, suffix: '' },
                                                { label: 'Temps', field: 'time', value: timePerRound, step: 5, suffix: 's' },
                                            ].map(({ label, field, value, step, suffix }) => (
                                                <div key={field} className="rounded-[var(--cm-r-md)] py-3 px-3 flex flex-col items-center gap-2" style={{ background: 'var(--cm-bg-2)', border: '1px solid var(--cm-line)' }}>
                                                    <span className="cm-label">{label}</span>
                                                    <div className="flex items-center gap-3">
                                                        <button onClick={() => adjustSetting(field, -step)} className="cm-icon-btn w-8 h-8"><Minus className="w-4 h-4" /></button>
                                                        <span className="cm-mono font-bold text-xl w-12 text-center">{value}{suffix}</span>
                                                        <button onClick={() => adjustSetting(field, step)} className="cm-icon-btn w-8 h-8"><Plus className="w-4 h-4" /></button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Sélecteur d'univers : lance une partie thématique (Disney, Anime…) */}
                            <div className="cm-panel p-6">
                                <div className="flex items-center justify-between mb-4">
                                    <h2 className="font-bold flex items-center gap-2">
                                        <Shapes className="w-4 h-4 text-[var(--cm-faint)]" /> Univers
                                    </h2>
                                    <span className="cm-chip !text-[11px]">
                                        {selectedCategory || 'Tout le catalogue'}
                                    </span>
                                </div>
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                                    <button
                                        type="button"
                                        onClick={() => selectCategory(null)}
                                        data-active={selectedCategory === null}
                                        className="cm-cat-chip"
                                    >
                                        <span className="text-xl shrink-0">🎲</span>
                                        <span className="flex flex-col min-w-0 leading-tight">
                                            <span className="text-sm font-semibold truncate">Toutes</span>
                                            <span className="text-[11px] text-[var(--cm-faint)]">Mélange</span>
                                        </span>
                                    </button>
                                    {categories.map((c) => {
                                        const meta = getCategoryMeta(c.category);
                                        const active = selectedCategory === c.category;
                                        return (
                                            <button
                                                key={c.category}
                                                type="button"
                                                onClick={() => selectCategory(c.category)}
                                                data-active={active}
                                                className="cm-cat-chip"
                                                style={active ? { borderColor: meta.accent, background: `${meta.accent}1f` } : undefined}
                                            >
                                                <span className="text-xl shrink-0">{meta.emoji}</span>
                                                <span className="flex flex-col min-w-0 leading-tight">
                                                    <span className="text-sm font-semibold truncate">{c.category}</span>
                                                    <span className="text-[11px] text-[var(--cm-faint)]">{c.count} perso{c.count > 1 ? 's' : ''}</span>
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            <button onClick={handleStartGame} disabled={players.length === 0} className="cm-btn cm-btn-primary w-full py-4 text-lg">
                                <Play className="w-5 h-5" /> Commencer la partie
                            </button>
                        </div>

                        {/* Players */}
                        <div className="lg:col-span-5 cm-panel p-6 flex flex-col" style={{ minHeight: 400 }}>
                            <div className="flex items-center justify-between pb-3 mb-3 border-b border-[var(--cm-line)]">
                                <h2 className="font-bold flex items-center gap-2"><Users className="w-4 h-4 text-[var(--cm-faint)]" /> Joueurs</h2>
                                <span className="cm-chip cm-mono !text-sm text-[var(--cm-ink)]">{players.length}</span>
                            </div>
                            <div className="cm-scroll flex-1 overflow-y-auto flex flex-col gap-2 -mr-2 pr-2">
                                {players.length === 0 ? (
                                    <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center py-10">
                                        <span className="w-16 h-16 rounded-2xl grid place-items-center cm-breathe" style={{ background: 'rgba(245,158,11,0.1)' }}>
                                            <Users className="w-7 h-7 text-[var(--cm-accent)]" />
                                        </span>
                                        <p className="text-sm text-[var(--cm-ink-2)] flex items-center">En attente de joueurs<span className="cm-dots" /></p>
                                    </div>
                                ) : (
                                    <AnimatePresence>
                                        {players.map((p, i) => (
                                            <motion.div key={p.id} layout initial={reduce ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9 }} transition={SPRING}
                                                        className="cm-status group" data-done="false">
                                                <Avatar src={p.avatar} name={p.name} idx={i} size={36} />
                                                <span className="font-semibold flex-1 truncate">{p.name}</span>
                                                <button onClick={() => handleKickPlayer(p.id)} aria-label={`Exclure ${p.name}`}
                                                        className="cm-icon-btn w-8 h-8 opacity-0 group-hover:opacity-100 hover:!text-[var(--cm-bad)]">
                                                    <X className="w-4 h-4" />
                                                </button>
                                            </motion.div>
                                        ))}
                                    </AnimatePresence>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* ════════ PLAYING ════════ */}
                {gameState === 'PLAYING' && character && (
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center w-full">
                        <div className="lg:col-span-5 flex flex-col items-center gap-5">
                            <div className="cm-viewport w-full max-w-[380px]">
                                <div className="cm-viewport-fill" style={{ backgroundColor: hsbToCss(character.random_h || 180, character.random_s || 50, character.random_b || 50) }} />
                                <img src={getImageUrl(character.image_path)} onError={() => setImageError(true)}
                                     className="cm-viewport-img" style={{ display: imageError ? 'none' : 'block' }} alt={character.name} />
                                {imageError && renderSilhouette(character.id, hsbToCss(character.random_h || 180, character.random_s || 50, character.random_b || 50))}
                            </div>
                            <div className="w-full max-w-[380px]">
                                <div className="flex items-center justify-between mb-1.5 text-sm font-semibold">
                                    <span className="flex items-center gap-1.5 text-[var(--cm-ink-2)]"><Clock className="w-4 h-4" /> Temps restant</span>
                                    <span className="cm-mono text-lg font-bold" style={{ color: timerColor }}>{timer}s</span>
                                </div>
                                <div className="cm-timer-track">
                                    <div className="cm-timer-fill" style={{ width: `${timerPct}%`, background: timerColor }} />
                                </div>
                            </div>
                        </div>

                        <div className="lg:col-span-7 flex flex-col gap-5">
                            <div>
                                <span className="cm-label">{character.source}</span>
                                <h2 className="text-3xl lg:text-4xl font-bold leading-tight mt-1 text-balance">
                                    Quelle est la couleur de <span style={{ color: 'var(--cm-accent)' }}>{character.part}</span> de {character.name} ?
                                </h2>
                            </div>

                            <div className="cm-panel p-5">
                                <h3 className="cm-label mb-3">Réponses · {players.filter(p => p.hasGuessed).length}/{players.length}</h3>
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                    {players.map((p, i) => (
                                        <div key={p.id} className="cm-status" data-done={String(!!p.hasGuessed)}>
                                            <Avatar src={p.avatar} name={p.name} idx={i} size={28} />
                                            <span className="text-sm font-semibold truncate flex-1" style={{ color: p.hasGuessed ? 'var(--cm-good)' : 'var(--cm-ink-2)' }}>{p.name}</span>
                                            {p.hasGuessed && <Check className="w-4 h-4 text-[var(--cm-good)] shrink-0" strokeWidth={3} />}
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <button onClick={triggerEndRound} className="cm-btn cm-btn-ghost w-full py-3">
                                Terminer la manche <ArrowRight className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                )}

                {/* ════════ ROUND END ════════ */}
                {gameState === 'ROUND_END' && character && (
                    <div className="flex flex-col gap-6 w-full">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                            <motion.div initial={reduce ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={SPRING}
                                        className="cm-panel p-6 flex flex-col items-center">
                                <span className="cm-chip mb-4" style={{ borderColor: 'rgba(52,211,153,0.4)', color: 'var(--cm-good)' }}>
                                    <Check className="w-3.5 h-3.5" /> Couleur cible révélée
                                </span>
                                <div className="cm-viewport w-[230px] mb-4">
                                    <div className="cm-viewport-fill" style={{ backgroundColor: targetColor }} />
                                    <img src={getImageUrl(character.image_path)} onError={() => setImageError(true)}
                                         className="cm-viewport-img" style={{ display: imageError ? 'none' : 'block' }} alt={character.name} />
                                    {imageError && renderSilhouette(character.id, targetColor)}
                                </div>
                                <h3 className="text-xl font-bold text-center">{character.name} <span className="text-[var(--cm-ink-2)] font-medium">· {character.part}</span></h3>
                                <div className="flex gap-2 mt-3">
                                    {[['H', character.target_h, '°'], ['S', character.target_s, '%'], ['B', character.target_b, '%']].map(([l, v, u]) => (
                                        <span key={l} className="cm-chip cm-mono">{l} {v}{u}</span>
                                    ))}
                                </div>
                            </motion.div>

                            <div className="cm-panel p-6 flex flex-col" style={{ maxHeight: 420 }}>
                                <h3 className="font-bold flex items-center gap-2 pb-3 mb-3 border-b border-[var(--cm-line)]"><Trophy className="w-4 h-4 text-[var(--cm-accent)]" /> Classement de la manche</h3>
                                <div className="cm-scroll flex-1 overflow-y-auto flex flex-col gap-2 -mr-2 pr-2">
                                    {roundResults.map((r, i) => {
                                        const guessColor = r.guess ? hsbToCss(r.guess.h, r.guess.s, r.guess.b) : '#333';
                                        return (
                                            <motion.div key={r.id} initial={reduce ? false : { opacity: 0, x: 14 }} animate={{ opacity: 1, x: 0 }} transition={{ ...SPRING, delay: i * 0.05 }}
                                                        className="cm-status">
                                                <span className="cm-mono text-sm font-bold w-5 text-center" style={{ color: i < 3 ? MEDALS[i] : 'var(--cm-faint)' }}>{i + 1}</span>
                                                <Avatar src={r.avatar} name={r.name} idx={i} size={32} />
                                                <div className="flex-1 min-w-0">
                                                    <p className="font-semibold text-sm truncate">{r.name}</p>
                                                    {r.hintUsed && <p className="text-[10px] text-[var(--cm-accent)] font-semibold">Indice utilisé</p>}
                                                </div>
                                                {r.guess && <span className="cm-swatch w-7 h-7 shrink-0" style={{ background: guessColor }} />}
                                                <span className="cm-mono font-bold text-sm w-14 text-right">{r.roundScore.toFixed(2)}</span>
                                            </motion.div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>

                        <button onClick={handleNextRound} className="cm-btn cm-btn-primary w-full py-4 text-lg">
                            {currentRound === totalRounds ? <><Trophy className="w-5 h-5" /> Voir le classement final</> : <>Manche suivante <ArrowRight className="w-5 h-5" /></>}
                        </button>
                    </div>
                )}

                {/* ════════ GAME END ════════ */}
                {gameState === 'GAME_END' && (
                    <div className="flex flex-col gap-8 w-full items-center">
                        <motion.h2 initial={reduce ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={SPRING}
                                   className="text-4xl lg:text-5xl font-bold text-center flex items-center gap-3">
                            <Trophy className="w-9 h-9 text-[var(--cm-accent)]" /> Classement final
                        </motion.h2>

                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 w-full items-start">
                            <div className="lg:col-span-7 flex flex-col gap-6 items-center">
                                {/* Podium */}
                                <div className="flex items-end justify-center gap-3 w-full max-w-[520px] h-[300px]">
                                    {[1, 0, 2].map((rank) => {
                                        const p = finalResults[rank];
                                        if (!p) return <div key={rank} className="w-1/3" />;
                                        const heights = { 0: 200, 1: 150, 2: 120 };
                                        const delays = { 0: 0.15, 1: 0.3, 2: 0.45 };
                                        return (
                                            <motion.div key={p.id} initial={reduce ? false : { opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} transition={{ ...SPRING, delay: delays[rank] }}
                                                        className="flex flex-col items-center w-1/3">
                                                {rank === 0 && <Crown className="w-7 h-7 mb-1" style={{ color: MEDALS[0] }} />}
                                                <Avatar src={p.avatar} name={p.name} idx={rank} size={rank === 0 ? 60 : 46} ring={MEDALS[rank]} />
                                                <span className="font-bold text-sm truncate max-w-full mt-2 mb-2 px-1">{p.name}</span>
                                                <div className="w-full rounded-t-[var(--cm-r-md)] flex flex-col items-center justify-start pt-4 cm-panel !border-b-0"
                                                     style={{ height: heights[rank], borderColor: `${MEDALS[rank]}55`, background: `linear-gradient(180deg, ${MEDALS[rank]}1f, var(--cm-surface))` }}>
                                                    <span className="text-3xl font-bold" style={{ color: MEDALS[rank] }}>{rank === 0 ? 1 : rank === 1 ? 2 : 3}</span>
                                                    <span className="cm-mono text-sm text-[var(--cm-ink-2)] mt-1">{p.totalScore.toFixed(1)} pts</span>
                                                </div>
                                            </motion.div>
                                        );
                                    })}
                                </div>

                                {awards.length > 0 && (
                                    <div className="flex flex-wrap gap-3 justify-center">
                                        {awards.map(aw => (
                                            <div key={aw.type} className="cm-glass flex items-center gap-3 px-4 py-2.5 rounded-[var(--cm-r-md)]">
                                                <span className="text-2xl">{aw.icon}</span>
                                                <div>
                                                    <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--cm-accent)]">{aw.title}</p>
                                                    <p className="text-sm font-bold">{aw.playerName}</p>
                                                    <p className="text-[10px] text-[var(--cm-faint)]">{aw.value}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div className="lg:col-span-5 cm-panel p-6 flex flex-col" style={{ maxHeight: 400 }}>
                                <h3 className="font-bold pb-3 mb-3 border-b border-[var(--cm-line)]">Scores finaux</h3>
                                <div className="cm-scroll flex-1 overflow-y-auto flex flex-col gap-2 -mr-2 pr-2">
                                    {finalResults.map((r, i) => (
                                        <div key={r.id} className="cm-status">
                                            <span className="cm-mono text-sm font-bold w-5 text-center" style={{ color: i < 3 ? MEDALS[i] : 'var(--cm-faint)' }}>{i + 1}</span>
                                            <Avatar src={r.avatar} name={r.name} idx={i} size={32} />
                                            <span className="font-semibold text-sm flex-1 truncate">{r.name}</span>
                                            <span className="cm-mono font-bold text-sm">{r.totalScore.toFixed(2)}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        <div className="flex gap-3 w-full max-w-[520px]">
                            <button onClick={handleRestartGame} className="cm-btn cm-btn-primary flex-1 py-3.5"><RotateCcw className="w-4 h-4" /> Rejouer</button>
                            <button onClick={() => { clearHostSession(); navigate('/color'); }} className="cm-btn cm-btn-ghost flex-1 py-3.5"><LogOut className="w-4 h-4" /> Quitter</button>
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}

export default ColorHostView;
