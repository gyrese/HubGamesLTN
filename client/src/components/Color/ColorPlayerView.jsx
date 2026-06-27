import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Palette, Check, Lightbulb, Send, Trophy, Loader2, Hourglass } from 'lucide-react';
import { socket } from '../../socket';
import { renderSilhouette, hsbToCss } from './ColorSilhouettes';
import './ColorStyles.css';

const PRESET_AVATARS = Array.from({ length: 12 }, (_, i) => `/avatars/avatar_${i + 1}.webp`);

const SPRING = { type: 'spring', stiffness: 130, damping: 17 };

// ─── Session de salon (persistance + reconnexion, pattern GeoTrackr) ───
const SESSION_KEY = 'color-session';
const readSession = () => {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
};
const writeSession = (patch) => {
    try {
        const prev = JSON.parse(localStorage.getItem(SESSION_KEY) || '{}');
        localStorage.setItem(SESSION_KEY, JSON.stringify({ ...prev, ...patch }));
    } catch { /* localStorage indisponible */ }
};
const clearSession = () => {
    try { localStorage.removeItem(SESSION_KEY); } catch { /* noop */ }
};

/**
 * 2D Saturation × Brightness field. Dragging adjusts S (left→right) and
 * B (top→bottom) — far more intuitive than three linear sliders.
 */
function SBField({ h, s, b, onChange }) {
    const ref = useRef(null);
    const apply = (clientX, clientY) => {
        const r = ref.current.getBoundingClientRect();
        const x = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
        const y = Math.min(1, Math.max(0, (clientY - r.top) / r.height));
        onChange(Math.round(x * 100), Math.round((1 - y) * 100)); // s, b
    };
    const onDown = (e) => { e.currentTarget.setPointerCapture(e.pointerId); apply(e.clientX, e.clientY); };
    const onMove = (e) => { if (e.buttons === 0) return; apply(e.clientX, e.clientY); };
    return (
        <div ref={ref} className="cm-field" onPointerDown={onDown} onPointerMove={onMove}
             style={{ background: `linear-gradient(to top, #000, rgba(0,0,0,0)), linear-gradient(to right, #fff, rgba(255,255,255,0)), hsl(${h}, 100%, 50%)` }}>
            <div className="cm-field-thumb" style={{ left: `${s}%`, top: `${100 - b}%`, background: hsbToCss(h, s, b) }} />
        </div>
    );
}

/** Black or white text, whichever stays readable over the given HSB color. */
function getContrastColor(h, s, b) {
    const isLightColor = b > 65 && (s < 40 || (h > 35 && h < 170));
    return isLightColor ? '#13131a' : '#ffffff';
}

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

function scoreLabel(score) {
    if (score >= 9.5) return 'Parfait';
    if (score >= 9.0) return 'Excellent';
    if (score >= 8.0) return 'Très proche';
    if (score >= 6.5) return 'Pas mal';
    if (score >= 4.0) return 'À côté';
    return 'Raté';
}

function ColorPlayerView() {
    const { roomCode: paramRoomCode } = useParams();
    const navigate = useNavigate();
    const reduce = useReducedMotion();

    // Connection state
    const [roomCode, setRoomCode] = useState(paramRoomCode || '');
    const [pseudo, setPseudo] = useState(() => localStorage.getItem('color-pseudo') || '');
    const [avatar, setAvatar] = useState(() => {
        const cached = localStorage.getItem('color-avatar');
        return (cached && PRESET_AVATARS.includes(cached)) ? cached : PRESET_AVATARS[0];
    });
    const [joined, setJoined] = useState(false);
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    // Game state
    const [gameState, setGameState] = useState('LOBBY');
    const [currentRound, setCurrentRound] = useState(0);
    const [totalRounds, setTotalRounds] = useState(5);
    const [character, setCharacter] = useState(null);
    const [myScore, setMyScore] = useState(0);
    const [roundScore, setRoundScore] = useState(null);

    // Color picker
    const [h, setH] = useState(180);
    const [s, setS] = useState(50);
    const [b, setB] = useState(50);
    const [hintUsed, setHintUsed] = useState(false);
    const [hintText, setHintText] = useState('');
    const [hasGuessed, setHasGuessed] = useState(false);

    // Social
    const [chatMsg, setChatMsg] = useState('');
    const [imageError, setImageError] = useState(false);

    const resetSliders = (char) => {
        const randomH = (char && char.random_h !== undefined) ? char.random_h : Math.floor(Math.random() * 360);
        const randomS = (char && char.random_s !== undefined) ? char.random_s : Math.floor(Math.random() * 60) + 30;
        const randomB = (char && char.random_b !== undefined) ? char.random_b : Math.floor(Math.random() * 60) + 30;
        setH(randomH); setS(randomS); setB(randomB);
        setHintUsed(false); setHintText(''); setHasGuessed(false);
        setRoundScore(null); setImageError(false);
    };

    // Reflète `joined` dans une ref pour le handler `connect` (évite les closures périmées)
    const joinedRef = useRef(false);
    useEffect(() => { joinedRef.current = joined; }, [joined]);

    // Jonction réutilisable. silent=true pour les reconnexions automatiques (aucune UI).
    const doJoin = (code, name, av, silent = false) => {
        const upperCode = (code || '').toUpperCase().trim();
        const cleanName = (name || '').trim();
        if (!upperCode || !cleanName) {
            if (!silent) setError('Code de salon et pseudo requis');
            return;
        }
        if (!silent) { setIsLoading(true); setError(''); }
        localStorage.setItem('color-pseudo', cleanName);
        localStorage.setItem('color-avatar', av);

        socket.emit('color-join-room', { roomCode: upperCode, playerName: cleanName, avatar: av }, (response) => {
            if (!silent) setIsLoading(false);
            if (response.error) {
                clearSession();                    // salon fermé/invalide → on repart propre
                if (!silent) setError(response.error);
                return;
            }
            setJoined(true);
            setRoomCode(upperCode);
            writeSession({ roomCode: upperCode, pseudo: cleanName, avatar: av });
            if (response.reconnected || response.lateJoin) {
                setGameState(response.gameState);
                setCurrentRound(response.currentRound);
                setTotalRounds(response.totalRounds);
                setCharacter(response.character);
                setMyScore(response.myScore || 0);
                writeSession({ myScore: response.myScore || 0 });
                if (response.gameState === 'PLAYING') resetSliders(response.character);
            }
        });
    };

    // Restauration au montage + reconnexion automatique à chaque (re)connexion socket.
    useEffect(() => {
        const saved = readSession();
        // Si l'URL porte un autre code que la session, c'est un nouveau salon → on ne restaure pas.
        const urlMismatch = saved && paramRoomCode && saved.roomCode !== paramRoomCode.toUpperCase();
        if (saved && saved.roomCode && saved.pseudo && !urlMismatch) {
            const rejoin = () => doJoin(saved.roomCode, saved.pseudo, saved.avatar, false);
            if (socket.connected) rejoin();
            else socket.once('connect', rejoin);
        }

        const handleConnect = () => {
            if (!joinedRef.current) return;        // pas encore en partie : rien à reconnecter
            const s = readSession();
            if (s && s.roomCode && s.pseudo) doJoin(s.roomCode, s.pseudo, s.avatar, true);
        };
        socket.on('connect', handleConnect);
        return () => socket.off('connect', handleConnect);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (!joined) return;

        socket.on('color-game-started', (data) => {
            setGameState('PLAYING'); setCurrentRound(data.round); setTotalRounds(data.total);
            setCharacter(data.character); resetSliders(data.character);
        });
        socket.on('color-round-ended', (data) => {
            setGameState('ROUND_END'); setCharacter(data.character);
            const myResult = data.results.find(r => r.id === socket.id);
            if (myResult) { setRoundScore(myResult.roundScore); setMyScore(myResult.totalScore); writeSession({ myScore: myResult.totalScore }); }
        });
        socket.on('color-next-round', (data) => {
            setGameState('PLAYING'); setCurrentRound(data.round); setTotalRounds(data.total);
            setCharacter(data.character); resetSliders(data.character);
        });
        socket.on('color-game-over', (data) => {
            setGameState('GAME_END');
            const myResult = data.results.find(r => r.id === socket.id);
            if (myResult) { setMyScore(myResult.totalScore); writeSession({ myScore: myResult.totalScore }); }
        });
        socket.on('color-game-restarted', () => { setGameState('LOBBY'); setMyScore(0); writeSession({ myScore: 0 }); resetSliders(); });
        socket.on('color-kicked', () => {
            clearSession();
            alert('Vous avez été exclu de la partie.');
            setJoined(false); setGameState('LOBBY'); navigate('/color');
        });
        socket.on('color-host-disconnected', () => {
            clearSession();
            alert("L'hôte s'est déconnecté. Fermeture du salon.");
            setJoined(false); setGameState('LOBBY'); navigate('/color');
        });

        return () => {
            ['color-game-started','color-round-ended','color-next-round','color-game-over',
             'color-game-restarted','color-kicked','color-host-disconnected'].forEach(e => socket.off(e));
        };
    }, [joined, navigate]);

    const handleJoin = (e) => {
        if (e) e.preventDefault();
        doJoin(roomCode, pseudo, avatar, false);
    };

    const handleGetHint = () => {
        if (hintUsed || !character) return;
        const choices = ['H', 'S', 'B'];
        const chosen = choices[Math.floor(Math.random() * choices.length)];
        let text = '';
        if (chosen === 'H') {
            const minH = Math.max(0, character.target_h - 25);
            const maxH = Math.min(360, character.target_h + 25);
            text = `Teinte entre ${minH}° et ${maxH}°`;
        } else if (chosen === 'S') {
            const minS = Math.max(0, character.target_s - 15);
            const maxS = Math.min(100, character.target_s + 15);
            text = `Saturation entre ${minS}% et ${maxS}%`;
        } else {
            const minB = Math.max(0, character.target_b - 15);
            const maxB = Math.min(100, character.target_b + 15);
            text = `Luminosité entre ${minB}% et ${maxB}%`;
        }
        setHintText(text); setHintUsed(true);
    };

    const handleSubmitGuess = () => {
        if (hasGuessed) return;
        socket.emit('color-submit-guess', {
            roomCode, h: parseInt(h), s: parseInt(s), b: parseInt(b), hintUsed
        }, (response) => {
            if (response.error) alert(response.error);
            else setHasGuessed(true);
        });
    };

    const sendReaction = (emoji) => {
        if (!joined) return;
        socket.emit('color-reaction', { roomCode, emoji, playerName: pseudo });
    };

    const sendChatMessage = (e) => {
        e.preventDefault();
        if (!chatMsg.trim() || !joined) return;
        socket.emit('color-chat-message', { roomCode, message: chatMsg.trim().slice(0, 40), playerName: pseudo });
        setChatMsg('');
    };

    const guessCssColor = hsbToCss(h, s, b);
    const contrastColor = getContrastColor(h, s, b);
    const isLive = gameState === 'PLAYING' || gameState === 'ROUND_END';
    const live = isLive ? guessCssColor : '#f59e0b';
    const liveInk = isLive ? contrastColor : '#20160a';

    return (
        <div className="cm-root cm-scroll relative w-full h-[100dvh] overflow-y-auto flex flex-col items-center px-3 py-3 sm:px-4 sm:py-5 select-none"
             style={{ '--live': live, '--live-ink': liveInk }}>
            <div className="cm-bg-grid" />
            <div className="cm-bg-pool" style={{ background: `radial-gradient(70% 45% at 50% 0%, ${live}1f, transparent 72%)` }} />

            {/* ════════ JOIN ════════ */}
            {!joined ? (
                <motion.main
                    initial={reduce ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={SPRING}
                    className="cm-panel relative z-10 w-full max-w-[420px] p-6 my-auto">
                    <div className="flex flex-col items-center text-center mb-6">
                        <div className="cm-glass w-14 h-14 rounded-2xl grid place-items-center mb-3"
                             style={{ boxShadow: '0 16px 44px -22px #f59e0b' }}>
                            <Palette className="w-6 h-6 text-[var(--cm-accent)]" />
                        </div>
                        <h2 className="text-2xl font-bold">Rejoindre la partie</h2>
                        <p className="text-sm text-[var(--cm-ink-2)] mt-1">Entre le code affiché sur le grand écran.</p>
                    </div>

                    <form onSubmit={handleJoin} className="flex flex-col gap-4">
                        <div className="flex flex-col gap-1.5">
                            <label className="cm-label">Code du salon</label>
                            <input type="text" maxLength={6} placeholder="ABCDEF" value={roomCode}
                                   onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                                   className="cm-input cm-mono text-center text-2xl font-bold uppercase tracking-[0.4em]" />
                        </div>

                        <div className="flex flex-col gap-1.5">
                            <label className="cm-label">Ton pseudo</label>
                            <input type="text" maxLength={14} placeholder="SuperJoueur" value={pseudo}
                                   onChange={(e) => setPseudo(e.target.value)} className="cm-input font-semibold" />
                        </div>

                        <div className="flex flex-col gap-2">
                            <label className="cm-label">Choisis un avatar</label>
                            <div className="cm-scroll flex gap-2.5 overflow-x-auto pb-1 -mx-1 px-1" style={{ scrollSnapType: 'x mandatory' }}>
                                {PRESET_AVATARS.map((avUrl, i) => {
                                    const sel = avatar === avUrl;
                                    return (
                                        <button key={i} type="button" onClick={() => setAvatar(avUrl)}
                                                className="relative shrink-0 rounded-full overflow-hidden transition-transform duration-200"
                                                style={{ width: 52, height: 52, scrollSnapAlign: 'start',
                                                         outline: sel ? '2px solid var(--cm-accent)' : '1px solid var(--cm-line-strong)',
                                                         outlineOffset: sel ? 2 : 0, transform: sel ? 'scale(1.04)' : 'scale(1)' }}>
                                            <img src={avUrl} alt={`avatar ${i + 1}`} className="w-full h-full object-cover" />
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        <AnimatePresence>
                            {error && (
                                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                                            className="text-sm font-semibold text-center px-3 py-2 rounded-[var(--cm-r-sm)]"
                                            style={{ background: 'rgba(251,113,133,0.1)', color: 'var(--cm-bad)', border: '1px solid rgba(251,113,133,0.3)' }}>
                                    {error}
                                </motion.div>
                            )}
                        </AnimatePresence>

                        <button type="submit" disabled={isLoading} className="cm-btn cm-btn-primary w-full py-3.5 mt-1">
                            {isLoading ? <><Loader2 className="w-4 h-4 cm-spin" /> Connexion</> : 'Rejoindre'}
                        </button>
                    </form>
                </motion.main>
            ) : (
                <div className="relative z-10 w-full max-w-[440px] flex flex-col gap-2.5 sm:gap-4 pb-4 sm:pb-10">

                    {/* ════════ LOBBY ════════ */}
                    {gameState === 'LOBBY' && (
                        <motion.div initial={reduce ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={SPRING}
                                    className="cm-panel p-7 mt-8 flex flex-col items-center text-center gap-3">
                            <div className="relative">
                                <div className="absolute -inset-2 rounded-full cm-breathe" style={{ background: 'radial-gradient(circle, #f59e0b40, transparent 70%)' }} />
                                <img src={avatar} alt="avatar" className="cm-avatar relative w-24 h-24" />
                            </div>
                            <h3 className="text-2xl font-bold">{pseudo}</h3>
                            <span className="cm-chip"><span className="cm-mono tracking-[0.2em] text-[var(--cm-accent)]">{roomCode}</span></span>
                            <p className="text-sm text-[var(--cm-ink-2)] mt-1 flex items-center">En attente de l'hôte<span className="cm-dots" /></p>
                        </motion.div>
                    )}

                    {/* ════════ PLAYING ════════ */}
                    {gameState === 'PLAYING' && character && (
                        <motion.div key={currentRound} initial={reduce ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={SPRING}
                                    className="flex flex-col gap-2.5 sm:gap-4 mt-0.5 sm:mt-1">
                            <div className="flex items-center justify-between">
                                <div className="flex flex-col">
                                    <span className="cm-label">Recrée la couleur de</span>
                                    <h3 className="text-lg font-bold leading-tight">
                                        {character.name} <span className="text-[var(--cm-ink-2)] font-medium">· {character.part}</span>
                                    </h3>
                                </div>
                                <span className="cm-chip cm-mono shrink-0">{currentRound}/{totalRounds}</span>
                            </div>

                            <div className="cm-viewport w-32 h-32 sm:w-40 sm:h-40 md:w-56 md:h-56 lg:w-64 lg:h-64 mx-auto">
                                <div className="cm-viewport-fill" style={{ backgroundColor: guessCssColor }} />
                                <img src={getImageUrl(character.image_path)} onError={() => setImageError(true)}
                                     className="cm-viewport-img" style={{ display: imageError ? 'none' : 'block' }} alt={character.name} />
                                {imageError && renderSilhouette(character.id, guessCssColor)}
                            </div>

                            <div className="relative">
                                <div className="cm-panel p-3 sm:p-4 flex flex-col gap-2.5 sm:gap-3.5">
                                    <SBField h={h} s={s} b={b} onChange={(ns, nb) => { setS(ns); setB(nb); }} />
                                    <input type="range" min={0} max={359} value={h}
                                           onChange={(e) => setH(parseInt(e.target.value))} className="cm-hue" aria-label="Teinte" />

                                    <div className="flex items-center gap-2.5">
                                        <span className="cm-swatch w-10 h-10 shrink-0" style={{ background: guessCssColor }} />
                                        <span className="cm-mono text-sm font-semibold text-[var(--cm-ink-2)] flex-1">H{h} · S{s} · B{b}</span>
                                        <button onClick={handleGetHint} disabled={hintUsed} title="Indice"
                                                className="cm-icon-btn w-11 h-11 disabled:opacity-40">
                                            <Lightbulb className="w-5 h-5" style={{ color: hintUsed ? undefined : 'var(--cm-accent)' }} />
                                        </button>
                                        <button onClick={handleSubmitGuess} className="cm-btn cm-btn-live h-11 px-5">
                                            <Check className="w-5 h-5" /> Valider
                                        </button>
                                    </div>

                                    <AnimatePresence>
                                        {hintText && (
                                            <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                                                        className="flex items-center gap-2 text-xs font-semibold rounded-[var(--cm-r-sm)] px-3 py-2"
                                                        style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.25)', color: '#fcd34d' }}>
                                                <Lightbulb className="w-3.5 h-3.5 shrink-0" /> {hintText}
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </div>

                                <AnimatePresence>
                                    {hasGuessed && (
                                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                                                    className="absolute inset-0 grid place-items-center text-center p-4 rounded-[var(--cm-r-lg)] z-[var(--z-overlay)]"
                                                    style={{ background: 'rgba(7,7,11,0.82)', backdropFilter: 'blur(8px)' }}>
                                            <motion.div initial={reduce ? false : { scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={SPRING}
                                                        className="flex flex-col items-center gap-2">
                                                <span className="w-14 h-14 rounded-full grid place-items-center" style={{ background: '#34d399', color: '#052e22' }}>
                                                    <Check className="w-7 h-7" strokeWidth={3} />
                                                </span>
                                                <span className="text-lg font-bold">Couleur validée</span>
                                                <span className="text-sm text-[var(--cm-ink-2)] flex items-center"><Hourglass className="w-3.5 h-3.5 mr-1.5" />En attente du grand écran</span>
                                            </motion.div>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
                        </motion.div>
                    )}

                    {/* ════════ ROUND END ════════ */}
                    {gameState === 'ROUND_END' && character && (
                        <motion.div initial={reduce ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={SPRING}
                                    className="flex flex-col gap-2.5 sm:gap-4 mt-0.5 sm:mt-1">
                            <div className="flex flex-col">
                                <span className="cm-label">Résultat · Manche {currentRound}</span>
                                <h3 className="text-lg font-bold">{character.name} <span className="text-[var(--cm-ink-2)] font-medium">· {character.part}</span></h3>
                            </div>

                            <div className="cm-panel overflow-hidden">
                                {/* Your guess */}
                                <div className="p-4 flex items-center justify-between" style={{ background: guessCssColor, color: contrastColor }}>
                                    <div className="flex flex-col">
                                        <span className="text-[11px] font-bold uppercase tracking-wide opacity-70">Ta proposition</span>
                                        <span className="cm-mono text-sm font-bold">H{h} S{s} B{b}</span>
                                    </div>
                                    <div className="flex flex-col items-end">
                                        <motion.span initial={reduce ? false : { scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ ...SPRING, delay: 0.15 }}
                                                     className="text-4xl font-bold leading-none">
                                            {roundScore !== null ? roundScore.toFixed(1) : '0.0'}
                                        </motion.span>
                                        <span className="text-[11px] font-bold uppercase tracking-wide">{roundScore !== null ? scoreLabel(roundScore) : ''}</span>
                                    </div>
                                </div>
                                {/* Real color */}
                                <div className="p-4 flex items-center justify-between border-t border-black/20"
                                     style={{ background: hsbToCss(character.target_h, character.target_s, character.target_b), color: getContrastColor(character.target_h, character.target_s, character.target_b) }}>
                                    <div className="flex flex-col">
                                        <span className="text-[11px] font-bold uppercase tracking-wide opacity-70">Couleur réelle</span>
                                        <span className="cm-mono text-sm font-bold">H{character.target_h} S{character.target_s} B{character.target_b}</span>
                                    </div>
                                    <Palette className="w-5 h-5 opacity-80" />
                                </div>
                            </div>
                        </motion.div>
                    )}

                    {/* ════════ GAME END ════════ */}
                    {gameState === 'GAME_END' && (
                        <motion.div initial={reduce ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={SPRING}
                                    className="cm-panel p-7 mt-8 flex flex-col items-center text-center gap-3">
                            <span className="w-16 h-16 rounded-2xl grid place-items-center" style={{ background: 'rgba(245,158,11,0.12)' }}>
                                <Trophy className="w-8 h-8 text-[var(--cm-accent)]" />
                            </span>
                            <h3 className="text-2xl font-bold">Partie terminée</h3>
                            <p className="text-sm text-[var(--cm-ink-2)]">Le classement final est sur le grand écran.</p>
                            <div className="mt-2 w-full rounded-[var(--cm-r-md)] py-4 flex flex-col items-center" style={{ background: 'var(--cm-bg-2)', border: '1px solid var(--cm-line)' }}>
                                <span className="cm-label">Ton score final</span>
                                <span className="text-4xl font-bold text-[var(--cm-accent)]">{myScore.toFixed(1)}</span>
                                <span className="text-xs text-[var(--cm-ink-2)]">points</span>
                            </div>
                        </motion.div>
                    )}

                    {/* ════════ SOCIAL ════════ */}
                    <div className="cm-panel p-2.5 sm:p-3.5 flex flex-col gap-2 sm:gap-3 mt-0.5 sm:mt-1">
                        <div className="flex justify-between gap-1">
                            {['👍','🔥','😂','😱','😮','🎉'].map(emoji => (
                                <button key={emoji} type="button" onClick={() => sendReaction(emoji)}
                                        className="flex-1 text-2xl py-1.5 rounded-[var(--cm-r-sm)] transition-transform duration-150 hover:scale-125 active:scale-90">
                                    {emoji}
                                </button>
                            ))}
                        </div>
                        <form onSubmit={sendChatMessage} className="flex gap-2">
                            <input type="text" maxLength={40} placeholder="Envoyer un message…" value={chatMsg}
                                   onChange={(e) => setChatMsg(e.target.value)} className="cm-input flex-1 py-2.5 text-sm" />
                            <button type="submit" className="cm-icon-btn w-11 shrink-0" aria-label="Envoyer">
                                <Send className="w-4 h-4" />
                            </button>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}

export default ColorPlayerView;
