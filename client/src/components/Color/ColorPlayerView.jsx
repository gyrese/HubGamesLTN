import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { socket } from '../../socket';
import { renderSilhouette, hsbToCss } from './ColorSilhouettes';
import './ColorStyles.css';

const PRESET_AVATARS = Array.from({ length: 12 }, (_, i) => `/avatars/avatar_${i + 1}.webp`);

/**
 * Champ 2D Saturation × Luminosité (façon sélecteur de couleur standard).
 * Glisser le curseur ajuste S (gauche→droite) et B (haut→bas). Bien plus
 * intuitif que trois sliders linéaires séparés pour atteindre une couleur.
 */
function SBField({ h, s, b, onChange }) {
    const ref = useRef(null);
    const apply = (clientX, clientY) => {
        const r = ref.current.getBoundingClientRect();
        const x = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
        const y = Math.min(1, Math.max(0, (clientY - r.top) / r.height));
        onChange(Math.round(x * 100), Math.round((1 - y) * 100)); // s, b
    };
    const onDown = (e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        apply(e.clientX, e.clientY);
    };
    const onMove = (e) => {
        if (e.buttons === 0) return; // uniquement pendant le glissé
        apply(e.clientX, e.clientY);
    };
    return (
        <div ref={ref} className="sb-square" onPointerDown={onDown} onPointerMove={onMove}
             style={{
                 background: `linear-gradient(to top, #000, rgba(0,0,0,0)), linear-gradient(to right, #fff, rgba(255,255,255,0)), hsl(${h}, 100%, 50%)`
             }}>
            <div className="sb-thumb" style={{ left: `${s}%`, top: `${100 - b}%`, background: hsbToCss(h, s, b) }} />
        </div>
    );
}

/**
 * Calculates a contrast color (black or white) based on HSB values
 * to ensure all text remains highly readable regardless of background color.
 */
function getContrastColor(h, s, b) {
    const isLightColor = b > 65 && (s < 40 || (h > 35 && h < 170));
    return isLightColor ? '#1A1A2E' : '#ffffff';
}

function getImageUrl(imagePath) {
    if (!imagePath) return '';
    if (imagePath.startsWith('http') || imagePath.startsWith('data:')) return imagePath;
    // Assets frontend (dossier client/public, buildés avec le client) : chemin relatif,
    // servi par Vite en dev et par le static en prod — surtout pas l'origine de l'API.
    if (imagePath.startsWith('/color/')) return imagePath;
    // Anciennes images uploadées via l'admin, servies par l'API (/uploads/...)
    const isHttps = window.location.protocol === 'https:';
    const serverPort = isHttps ? 3443 : 3005;
    const base = import.meta.env.VITE_SERVER_URL
        ? import.meta.env.VITE_SERVER_URL
        : (!import.meta.env.DEV ? '' : `${window.location.protocol}//${window.location.hostname}:${serverPort}`);
    return `${base}${imagePath}`;
}

function ColorPlayerView() {
    const { roomCode: paramRoomCode } = useParams();
    const navigate = useNavigate();

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

    // Color Sliders
    const [h, setH] = useState(180);
    const [s, setS] = useState(50);
    const [b, setB] = useState(50);
    const [hintUsed, setHintUsed] = useState(false);
    const [hintText, setHintText] = useState('');
    const [hasGuessed, setHasGuessed] = useState(false);

    // Reactions and chat
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

    useEffect(() => {
        if (!joined) return;

        socket.on('color-game-started', (data) => {
            setGameState('PLAYING'); setCurrentRound(data.round); setTotalRounds(data.total);
            setCharacter(data.character); resetSliders(data.character);
        });
        socket.on('color-round-ended', (data) => {
            setGameState('ROUND_END'); setCharacter(data.character);
            const myResult = data.results.find(r => r.id === socket.id);
            if (myResult) { setRoundScore(myResult.roundScore); setMyScore(myResult.totalScore); }
        });
        socket.on('color-next-round', (data) => {
            setGameState('PLAYING'); setCurrentRound(data.round); setTotalRounds(data.total);
            setCharacter(data.character); resetSliders(data.character);
        });
        socket.on('color-game-over', (data) => {
            setGameState('GAME_END');
            const myResult = data.results.find(r => r.id === socket.id);
            if (myResult) setMyScore(myResult.totalScore);
        });
        socket.on('color-game-restarted', () => { setGameState('LOBBY'); setMyScore(0); resetSliders(); });
        socket.on('color-kicked', () => {
            alert('Vous avez été exclu de la partie.');
            setJoined(false); setGameState('LOBBY'); navigate('/color');
        });
        socket.on('color-host-disconnected', () => {
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
        if (!roomCode.trim() || !pseudo.trim()) { setError('Code de salon et pseudo requis'); return; }
        setIsLoading(true); setError('');
        localStorage.setItem('color-pseudo', pseudo.trim());
        localStorage.setItem('color-avatar', avatar);

        socket.emit('color-join-room', {
            roomCode: roomCode.toUpperCase().trim(), playerName: pseudo.trim(), avatar
        }, (response) => {
            setIsLoading(false);
            if (response.error) { setError(response.error); }
            else {
                setJoined(true); setRoomCode(roomCode.toUpperCase().trim());
                if (response.reconnected || response.lateJoin) {
                    setGameState(response.gameState);
                    setCurrentRound(response.currentRound);
                    setTotalRounds(response.totalRounds);
                    setCharacter(response.character);
                    setMyScore(response.myScore || 0);
                    if (response.gameState === 'PLAYING') resetSliders(response.character);
                }
            }
        });
    };

    const handleGetHint = () => {
        if (hintUsed || !character) return;
        const choices = ['H', 'S', 'B'];
        const chosen = choices[Math.floor(Math.random() * choices.length)];
        let text = '';
        if (chosen === 'H') {
            const minH = Math.max(0, character.target_h - 25);
            const maxH = Math.min(360, character.target_h + 25);
            text = `💡 Teinte : entre ${minH}° et ${maxH}°`;
        } else if (chosen === 'S') {
            const minS = Math.max(0, character.target_s - 15);
            const maxS = Math.min(100, character.target_s + 15);
            text = `💡 Saturation : entre ${minS}% et ${maxS}%`;
        } else {
            const minB = Math.max(0, character.target_b - 15);
            const maxB = Math.min(100, character.target_b + 15);
            text = `💡 Luminosité : entre ${minB}% et ${maxB}%`;
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

    return (
        <div className="color-game-bg w-full h-[100dvh] overflow-y-auto py-5 px-4 flex flex-col justify-start items-center relative">
            <div className="toon-dots" />

            {/* ════ JOIN FORM ════ */}
            {!joined ? (
                <main className="w-full max-w-[420px] toon-card p-6 my-auto z-10">
                    <div className="text-center mb-6">
                        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-3 toon-bounce"
                             style={{ background:'#FFD93D', border:'3px solid #1A1A2E', boxShadow:'3px 3px 0px #1A1A2E' }}>
                            <span style={{ fontSize:32 }}>🎨</span>
                        </div>
                        <h2 className="text-2xl font-black"
                            style={{ fontFamily:"'Fredoka One','Nunito',sans-serif", color:'#1A1A2E' }}>
                            Rejoindre la partie
                        </h2>
                    </div>

                    <form onSubmit={handleJoin} className="flex flex-col gap-4">
                        <div className="flex flex-col gap-1.5">
                            <label className="text-xs font-extrabold uppercase tracking-wider text-gray-400">Code du salon</label>
                            <input type="text" maxLength={6} placeholder="ABCDEF" value={roomCode}
                                   onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                                   className="w-full p-3 rounded-xl font-mono text-center font-black text-2xl uppercase focus:outline-none tracking-[0.2em]"
                                   style={{ background:'#F9FAFB', border:'3px solid #1A1A2E', color:'#1A1A2E', boxShadow:'2px 2px 0px #1A1A2E' }} />
                        </div>

                        <div className="flex flex-col gap-1.5">
                            <label className="text-xs font-extrabold uppercase tracking-wider text-gray-400">Votre pseudo</label>
                            <input type="text" maxLength={14} placeholder="SuperJoueur" value={pseudo}
                                   onChange={(e) => setPseudo(e.target.value)}
                                   className="w-full p-3 rounded-xl font-extrabold text-sm focus:outline-none"
                                   style={{ background:'#F9FAFB', border:'3px solid #1A1A2E', color:'#1A1A2E', boxShadow:'2px 2px 0px #1A1A2E' }} />
                        </div>

                        <div className="flex flex-col gap-1.5">
                            <label className="text-xs font-extrabold uppercase tracking-wider text-gray-400">Choisissez un avatar</label>
                            <div className="grid grid-cols-6 gap-2 p-3 rounded-xl max-h-[120px] overflow-y-auto"
                                 style={{ background:'#F9FAFB', border:'3px solid #1A1A2E' }}>
                                {PRESET_AVATARS.map((avUrl, i) => (
                                    <button key={i} type="button" onClick={() => setAvatar(avUrl)}
                                            className="relative rounded-full overflow-hidden aspect-square transition-transform"
                                            style={{
                                                border: avatar === avUrl ? '3px solid #FF5263' : '2px solid #1A1A2E',
                                                transform: avatar === avUrl ? 'scale(1.08)' : 'scale(1)',
                                            }}>
                                        <img src={avUrl} alt={`avatar-${i}`} className="w-full h-full object-cover" />
                                    </button>
                                ))}
                            </div>
                        </div>

                        {error && (
                            <div className="px-3 py-2 rounded-xl text-xs font-extrabold text-center"
                                 style={{ background:'#FEF2F2', color:'#DC2626', border:'2px solid #FF5263' }}>
                                {error}
                            </div>
                        )}

                        <button type="submit" disabled={isLoading}
                                className="toon-btn w-full py-4 text-base"
                                style={{ background:'#FF5263', color:'#fff' }}>
                            {isLoading ? 'Connexion…' : '🚀 Rejoindre'}
                        </button>
                    </form>
                </main>
            ) : (
                <div className="w-full max-w-[440px] flex flex-col gap-4 z-10 pb-12">

                    {/* ════ LOBBY ════ */}
                    {gameState === 'LOBBY' && (
                        <div className="toon-card p-6 text-center flex flex-col items-center gap-3">
                            <img src={avatar} alt="avatar" className="w-24 h-24 rounded-full object-cover float-up"
                                 style={{ border:'4px solid #1A1A2E', boxShadow:'3px 3px 0px #1A1A2E' }} />
                            <h3 className="text-2xl font-black" style={{ fontFamily:"'Fredoka One','Nunito',sans-serif", color:'#1A1A2E' }}>{pseudo}</h3>
                            <span className="text-xs font-extrabold uppercase tracking-widest px-4 py-1.5 rounded-full"
                                  style={{ background:'#FFD93D', color:'#1A1A2E', border:'2px solid #1A1A2E', boxShadow:'2px 2px 0px #1A1A2E' }}>
                                Salon · {roomCode}
                            </span>
                            <p className="text-sm font-bold text-gray-400 mt-2">
                                Prêt à jouer ! En attente de l'hôte <span className="dots" />
                            </p>
                        </div>
                    )}

                    {/* ════ PLAYING ════ */}
                    {gameState === 'PLAYING' && character && (
                        <div className="flex flex-col gap-4">
                            {/* Question */}
                            <div className="speech-bubble text-center mb-3">
                                <p className="text-[10px] font-extrabold uppercase tracking-widest text-gray-400 mb-0.5">Recrée la couleur de</p>
                                <h3 className="text-lg font-black leading-tight" style={{ color:'#1A1A2E' }}>
                                    <span style={{ color:'#00C2B3' }}>{character.name}</span>
                                    {' · '}
                                    <span style={{ color:'#FF5263' }}>{character.part}</span>
                                </h3>
                            </div>

                            {/* Live character */}
                            <div className="character-box w-full max-w-[260px] mx-auto">
                                <div className="absolute inset-0 z-0" style={{ backgroundColor: guessCssColor }} />
                                <img src={getImageUrl(character.image_path)} onError={() => setImageError(true)}
                                     style={{ display: imageError ? 'none':'block', width:'100%', height:'100%', objectFit:'contain', position:'relative', zIndex:5 }} alt="character" />
                                {imageError && renderSilhouette(character.id, guessCssColor)}
                            </div>

                            {/* Picker panel */}
                            <div className="relative">
                                <div className="toon-card p-4 flex flex-col gap-3 relative">
                                    {/* Round badge */}
                                    <div className="absolute top-3 right-4 text-xs font-black opacity-40" style={{ color:'#1A1A2E' }}>{currentRound}/{totalRounds}</div>

                                    {/* 2D Saturation × Brightness field */}
                                    <SBField h={h} s={s} b={b} onChange={(ns, nb) => { setS(ns); setB(nb); }} />

                                    {/* Hue slider */}
                                    <input type="range" min={0} max={359} value={h}
                                           onChange={(e) => setH(parseInt(e.target.value))}
                                           className="hue-slider" aria-label="Teinte" />

                                    {/* Readout + actions */}
                                    <div className="flex items-center gap-2">
                                        <div className="flex items-center gap-2 flex-1 min-w-0">
                                            <span className="w-9 h-9 rounded-lg flex-shrink-0" style={{ background: guessCssColor, border:'3px solid #1A1A2E', boxShadow:'2px 2px 0px #1A1A2E' }} />
                                            <span className="font-mono font-black text-sm truncate" style={{ color:'#1A1A2E' }}>H{h} S{s} B{b}</span>
                                        </div>
                                        <button onClick={handleGetHint} disabled={hintUsed}
                                                className="w-11 h-11 rounded-full flex items-center justify-center font-black text-lg transition-transform hover:scale-110 active:scale-95 disabled:opacity-40 flex-shrink-0"
                                                style={{ background:'#FFD93D', color:'#1A1A2E', border:'3px solid #1A1A2E', boxShadow:'2px 2px 0px #1A1A2E' }}>
                                            💡
                                        </button>
                                        <button onClick={handleSubmitGuess}
                                                className="h-11 px-5 rounded-full flex items-center justify-center gap-1 font-black text-sm uppercase transition-transform hover:scale-105 active:scale-95 flex-shrink-0"
                                                style={{ background:'#4ADE80', color:'#1A1A2E', border:'3px solid #1A1A2E', boxShadow:'3px 3px 0px #1A1A2E' }}>
                                            <span className="material-symbols-outlined text-xl font-black">check</span>
                                            Valider
                                        </button>
                                    </div>

                                    {hintText && (
                                        <div className="rounded-xl p-2 text-[11px] font-extrabold text-center"
                                             style={{ background:'#1A1A2E', color:'#fff' }}>
                                            {hintText}
                                        </div>
                                    )}
                                </div>

                                {/* Validated overlay */}
                                {hasGuessed && (
                                    <div className="absolute inset-0 backdrop-blur-sm rounded-[24px] flex flex-col items-center justify-center text-center p-4 z-20"
                                         style={{ background:'rgba(26,26,46,0.85)' }}>
                                        <span className="text-5xl mb-2 toon-bounce">✅</span>
                                        <span className="text-white font-black text-base uppercase tracking-wide">Validé !</span>
                                        <span className="text-gray-300 text-xs mt-0.5">En attente du grand écran…</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* ════ ROUND END ════ */}
                    {gameState === 'ROUND_END' && character && (
                        <div className="flex flex-col gap-4">
                            <div className="speech-bubble text-center mb-3">
                                <p className="text-[10px] font-extrabold uppercase tracking-widest text-gray-400 mb-0.5">Résultat manche {currentRound}</p>
                                <h3 className="text-lg font-black" style={{ color:'#1A1A2E' }}>
                                    {character.name} · <span style={{ color:'#FF5263' }}>{character.part}</span>
                                </h3>
                            </div>

                            <div className="character-box w-full max-w-[260px] mx-auto">
                                <div className="absolute inset-0 z-0" style={{ backgroundColor: guessCssColor }} />
                                <img src={getImageUrl(character.image_path)} onError={() => setImageError(true)}
                                     style={{ display: imageError ? 'none':'block', width:'100%', height:'100%', objectFit:'contain', position:'relative', zIndex:5 }} alt="character" />
                                {imageError && renderSilhouette(character.id, guessCssColor)}
                            </div>

                            {/* Split compare card */}
                            <div className="rounded-[24px] overflow-hidden flex flex-col relative"
                                 style={{ border:'3px solid #1A1A2E', boxShadow:'4px 4px 0px #1A1A2E', minHeight:200 }}>
                                {/* Your selection */}
                                <div className="flex-1 p-4 flex justify-between items-center"
                                     style={{ background: guessCssColor, color: contrastColor }}>
                                    <div className="flex flex-col">
                                        <span className="text-[10px] font-extrabold uppercase tracking-wider opacity-75">Ta proposition</span>
                                        <span className="text-base font-black font-mono">H{h} S{s} B{b}</span>
                                    </div>
                                    <div className="flex flex-col items-end">
                                        <span className="text-4xl font-black">{roundScore !== null ? roundScore.toFixed(1) : '0.0'}</span>
                                        <span className="text-[10px] font-extrabold uppercase tracking-wider">
                                            {roundScore >= 9.5 ? '🎯 Parfait !' :
                                             roundScore >= 9.0 ? '🔥 Excellent !' :
                                             roundScore >= 8.0 ? '😎 Très proche !' :
                                             roundScore >= 6.5 ? '👍 Pas mal !' :
                                             roundScore >= 4.0 ? '😅 À côté' : '😬 Oups !'}
                                        </span>
                                    </div>
                                </div>
                                {/* Original */}
                                <div className="flex-1 p-4 flex justify-between items-center"
                                     style={{ background: hsbToCss(character.target_h, character.target_s, character.target_b), color: getContrastColor(character.target_h, character.target_s, character.target_b), borderTop:'3px solid #1A1A2E' }}>
                                    <div className="flex flex-col">
                                        <span className="text-[10px] font-extrabold uppercase tracking-wider opacity-75">Couleur réelle</span>
                                        <span className="text-base font-black font-mono">H{character.target_h} S{character.target_s} B{character.target_b}</span>
                                    </div>
                                    <span className="text-2xl">🎨</span>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ════ GAME END ════ */}
                    {gameState === 'GAME_END' && (
                        <div className="toon-card p-6 text-center flex flex-col items-center gap-3">
                            <span className="text-6xl toon-bounce">🏆</span>
                            <h3 className="text-2xl font-black uppercase" style={{ fontFamily:"'Fredoka One','Nunito',sans-serif", color:'#1A1A2E' }}>
                                Partie terminée !
                            </h3>
                            <p className="text-sm font-bold text-gray-400">Le classement est sur le grand écran 📺</p>
                            <div className="px-6 py-4 rounded-2xl flex flex-col items-center mt-2"
                                 style={{ background:'#FFD93D', border:'3px solid #1A1A2E', boxShadow:'3px 3px 0px #1A1A2E' }}>
                                <span className="text-[10px] font-extrabold uppercase tracking-wider" style={{ color:'#1A1A2E' }}>Ton score final</span>
                                <span className="text-4xl font-black" style={{ color:'#1A1A2E' }}>{myScore.toFixed(1)}</span>
                                <span className="text-xs font-extrabold" style={{ color:'#1A1A2E' }}>points</span>
                            </div>
                        </div>
                    )}

                    {/* ════ SOCIAL PANEL ════ */}
                    <div className="toon-card p-4 flex flex-col gap-3">
                        <div className="flex justify-between gap-1.5 p-2 rounded-xl"
                             style={{ background:'#F9FAFB', border:'2px solid #1A1A2E' }}>
                            {['👍','🔥','😂','😱','😮','🎉'].map(emoji => (
                                <button key={emoji} type="button" onClick={() => sendReaction(emoji)}
                                        className="text-2xl flex-1 hover:scale-125 active:scale-90 transition-transform">
                                    {emoji}
                                </button>
                            ))}
                        </div>
                        <form onSubmit={sendChatMessage} className="flex gap-2">
                            <input type="text" maxLength={40} placeholder="Message…" value={chatMsg}
                                   onChange={(e) => setChatMsg(e.target.value)}
                                   className="flex-1 px-3 py-2.5 rounded-xl font-extrabold text-xs focus:outline-none"
                                   style={{ background:'#F9FAFB', border:'2px solid #1A1A2E', color:'#1A1A2E' }} />
                            <button type="submit" className="toon-btn px-4 py-2.5 text-xs"
                                    style={{ background:'#00C2B3', color:'#1A1A2E' }}>
                                Envoyer
                            </button>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}

export default ColorPlayerView;
