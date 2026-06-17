import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { socket } from '../../socket';
import { QRCodeSVG } from 'qrcode.react';
import confetti from 'canvas-confetti';
import { renderSilhouette, hsbToCss } from './ColorSilhouettes';
import './ColorStyles.css';

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

// Palette cyclique pour les joueurs
const PLAYER_COLORS = ['#FF5263','#00C2B3','#FFD93D','#C084FC','#4ADE80','#FF9A3C','#60A5FA','#F472B6'];

function ColorHostView() {
    const navigate = useNavigate();
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
    const [isRestored, setIsRestored] = useState(false);

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
        } catch (e) {}
    };

    useEffect(() => {
        const urlCode = searchParams.get('code');
        if (urlCode) {
            socket.emit('color-host-reconnect', { roomCode: urlCode.toUpperCase() }, (response) => {
                if (response.error) { createFreshRoom(); }
                else {
                    setRoomCode(response.roomCode);
                    setGameState(response.gameState);
                    setCurrentRound(response.currentRound);
                    setTotalRounds(response.totalRounds);
                    setPlayers(response.players);
                    setTimePerRound(response.timePerRound);
                    setCharacter(response.character);
                    if (response.roundStartTime) {
                        const elapsed = Math.round((Date.now() - response.roundStartTime) / 1000);
                        setTimer(Math.max(0, response.timePerRound - elapsed));
                    }
                    setIsRestored(true);
                }
            });
        } else { createFreshRoom(); }

        function createFreshRoom() {
            socket.emit('color-create-room', { settings: { roundsCount: 5, timePerRound: 60 } }, (response) => {
                if (response.error) { alert('Erreur lors de la création de la salle'); navigate('/color'); }
                else { setRoomCode(response.roomCode); }
            });
        }
    }, [searchParams, navigate]);

    useEffect(() => {
        socket.on('color-player-joined', (playersList) => setPlayers(playersList));
        socket.on('color-player-left', (playersList) => setPlayers(playersList));
        socket.on('color-settings-updated', ({ roundsCount, timePerRound }) => {
            setTotalRounds(roundsCount); setTimePerRound(timePerRound); setTimer(timePerRound);
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
            const left = Math.random() * 80 + 10;
            const driftX1 = (Math.random() - 0.5) * 60;
            const driftX2 = (Math.random() - 0.5) * 80;
            const driftX3 = (Math.random() - 0.5) * 40;
            const rot1 = (Math.random() - 0.5) * 30;
            const rot2 = (Math.random() - 0.5) * 45;
            setReactions(prev => [...prev, { id, emoji, playerName, left, driftX1, driftX2, driftX3, rot1, rot2 }]);
            setTimeout(() => setReactions(prev => prev.filter(r => r.id !== id)), 4500);
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

    const triggerEndRound = () => socket.emit('color-end-round', { roomCode });
    const handleStartGame = () => socket.emit('color-start-game', { roomCode, settings: { roundsCount: totalRounds, timePerRound } });
    const handleNextRound = () => socket.emit('color-next-round', { roomCode });
    const handleRestartGame = () => socket.emit('color-restart-game', { roomCode });
    const handleKickPlayer = (id) => socket.emit('color-kick-player', { roomCode, playerId: id });
    const adjustSetting = (field, amount) => {
        if (gameState !== 'LOBBY') return;
        let newRounds = totalRounds, newTime = timePerRound;
        if (field === 'rounds') newRounds = Math.max(3, Math.min(10, totalRounds + amount));
        else if (field === 'time') newTime = Math.max(15, Math.min(120, timePerRound + amount));
        socket.emit('color-update-settings', { roomCode, settings: { roundsCount: newRounds, timePerRound: newTime } });
    };

    const joinUrl = `${window.location.protocol}//${window.location.host}/join/${roomCode}`;
    const targetHslColor = character ? hsbToCss(character.target_h, character.target_s, character.target_b) : '#fff';
    const timerPct = (timer / timePerRound) * 100;
    const timerColor = timer <= 10 ? '#FF5263' : timer <= 20 ? '#FF9A3C' : '#00C2B3';

    return (
        <div className="color-game-bg flex flex-col min-h-screen relative overflow-hidden">
            <div className="toon-dots" />

            {/* Floating reactions */}
            <div className="pointer-events-none fixed inset-0 z-50">
                {reactions.map(r => (
                    <div key={r.id} className="floating-reaction flex flex-col items-center"
                         style={{ left:`${r.left}%`, '--reaction-drift-x-1':`${r.driftX1}px`, '--reaction-drift-x-2':`${r.driftX2}px`, '--reaction-drift-x-3':`${r.driftX3}px`, '--reaction-rot-1':`${r.rot1}deg`, '--reaction-rot-2':`${r.rot2}deg` }}>
                        <span>{r.emoji}</span>
                        <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded-full mt-1 uppercase"
                              style={{ background:'#1A1A2E', color:'#fff', border:'1.5px solid #1A1A2E' }}>
                            {r.playerName}
                        </span>
                    </div>
                ))}
            </div>

            {/* Chat ticker */}
            <div className="host-chat-container">
                {chatMessages.map(m => (
                    <div key={m.id} className="host-chat-bubble">
                        <span className="font-extrabold text-xs uppercase mr-1" style={{ color:'#FF5263' }}>{m.playerName} :</span>
                        <span className="text-xs font-bold" style={{ color:'#1A1A2E' }}>{m.message}</span>
                    </div>
                ))}
            </div>

            {/* ── HEADER ── */}
            <header className="relative z-10 px-6 py-3 flex justify-between items-center"
                    style={{ background:'#1A1A2E', borderBottom:'3px solid #1A1A2E' }}>
                <div className="flex items-center gap-3">
                    <span className="text-2xl toon-bounce">🎨</span>
                    <h1 className="text-2xl font-black text-white tracking-tight"
                        style={{ fontFamily:"'Fredoka One','Nunito',sans-serif", textShadow:'2px 2px 0px #FF5263' }}>
                        CouleurMoi
                    </h1>
                    {gameState !== 'LOBBY' && (
                        <span className="text-xs font-extrabold uppercase px-3 py-1 rounded-full"
                              style={{ background:'#FFD93D', color:'#1A1A2E', border:'2px solid #FFD93D', boxShadow:'2px 2px 0px rgba(0,0,0,0.3)' }}>
                            Manche {currentRound} / {totalRounds}
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-2 px-4 py-2 rounded-xl"
                     style={{ background:'rgba(255,255,255,0.08)', border:'2px solid rgba(255,255,255,0.15)' }}>
                    <span className="text-xs font-extrabold uppercase tracking-widest text-gray-400">Salon</span>
                    <span className="text-xl font-black tracking-widest font-mono text-white">{roomCode || '…'}</span>
                </div>
            </header>

            {/* ── MAIN ── */}
            <main className="flex-1 color-container flex flex-col justify-center py-8 z-10 w-full">

                {/* ════ LOBBY ════ */}
                {gameState === 'LOBBY' && (
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start w-full">

                        {/* Left: QR + Settings + Start */}
                        <div className="lg:col-span-7 flex flex-col gap-5">
                            <div className="toon-card p-8">
                                <h2 className="text-xl font-black uppercase mb-1" style={{ color:'#1A1A2E' }}>
                                    Rejoindre la partie
                                </h2>
                                <p className="text-sm font-bold text-gray-400 mb-6">Scannez le QR code ou saisissez le code</p>

                                <div className="flex flex-col sm:flex-row gap-6 items-center">
                                    {/* QR */}
                                    <div className="p-3 rounded-xl flex-shrink-0"
                                         style={{ background:'#fff', border:'3px solid #1A1A2E', boxShadow:'4px 4px 0px #1A1A2E' }}>
                                        <QRCodeSVG value={joinUrl} size={140} />
                                    </div>

                                    <div className="flex flex-col gap-3 w-full">
                                        {/* Room code big display */}
                                        <div className="text-center py-3 px-4 rounded-xl font-black font-mono text-3xl tracking-[0.2em]"
                                             style={{ background:'#FFD93D', border:'3px solid #1A1A2E', boxShadow:'3px 3px 0px #1A1A2E', color:'#1A1A2E' }}>
                                            {roomCode || '…'}
                                        </div>

                                        {/* Settings */}
                                        <div className="flex gap-3">
                                            {[
                                                { label:'Manches', field:'rounds', value:totalRounds, step:1, suffix:'' },
                                                { label:'Temps', field:'time', value:timePerRound, step:5, suffix:'s' },
                                            ].map(({ label, field, value, step, suffix }) => (
                                                <div key={field} className="flex-1 flex flex-col items-center py-2 px-3 rounded-xl"
                                                     style={{ background:'#F9FAFB', border:'2px solid #1A1A2E', boxShadow:'2px 2px 0px #1A1A2E' }}>
                                                    <span className="text-[9px] font-extrabold uppercase tracking-wider text-gray-400 mb-1">{label}</span>
                                                    <div className="flex items-center gap-2">
                                                        <button onClick={() => adjustSetting(field, -step)}
                                                                className="w-7 h-7 rounded-full font-black text-lg flex items-center justify-center hover:opacity-70 transition-opacity"
                                                                style={{ background:'#FF5263', color:'#fff', border:'2px solid #1A1A2E' }}>−</button>
                                                        <span className="font-black text-lg" style={{ color:'#1A1A2E', minWidth:32, textAlign:'center' }}>{value}{suffix}</span>
                                                        <button onClick={() => adjustSetting(field, step)}
                                                                className="w-7 h-7 rounded-full font-black text-lg flex items-center justify-center hover:opacity-70 transition-opacity"
                                                                style={{ background:'#4ADE80', color:'#1A1A2E', border:'2px solid #1A1A2E' }}>+</button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Start button */}
                            <button onClick={handleStartGame} disabled={players.length === 0}
                                    className="toon-btn w-full py-5 text-xl"
                                    style={{ background: players.length > 0 ? '#FF5263' : undefined, color: players.length > 0 ? '#fff' : undefined }}>
                                🚀 Commencer la partie
                            </button>
                        </div>

                        {/* Right: Players */}
                        <div className="lg:col-span-5 toon-card p-6 flex flex-col"
                             style={{ minHeight: 380 }}>
                            <div className="flex justify-between items-center border-b-2 border-gray-100 pb-3 mb-4">
                                <h2 className="font-black uppercase text-sm tracking-wide" style={{ color:'#1A1A2E' }}>Joueurs</h2>
                                <span className="text-lg font-black px-3 py-0.5 rounded-full"
                                      style={{ background:'#FFD93D', color:'#1A1A2E', border:'2px solid #1A1A2E', boxShadow:'1px 1px 0px #1A1A2E' }}>
                                    {players.length}
                                </span>
                            </div>
                            <div className="flex-1 overflow-y-auto flex flex-col gap-2">
                                {players.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center h-full gap-3 py-8">
                                        <span className="text-5xl float-up">👀</span>
                                        <p className="text-sm font-bold text-gray-400">En attente de joueurs <span className="dots" /></p>
                                    </div>
                                ) : players.map((p, i) => (
                                    <div key={p.id} className="flex items-center justify-between p-3 rounded-xl"
                                         style={{ background:'#F9FAFB', border:'2px solid #1A1A2E', boxShadow:'2px 2px 0px #1A1A2E' }}>
                                        <div className="flex items-center gap-3">
                                            <div className="w-9 h-9 rounded-full flex items-center justify-center font-black text-sm text-white border-2 border-[#1A1A2E] overflow-hidden flex-shrink-0"
                                                 style={{ background: PLAYER_COLORS[i % PLAYER_COLORS.length] }}>
                                                {p.avatar
                                                    ? <img src={p.avatar} alt="av" className="w-full h-full object-cover" />
                                                    : p.name.charAt(0).toUpperCase()}
                                            </div>
                                            <span className="font-extrabold text-sm" style={{ color:'#1A1A2E' }}>{p.name}</span>
                                        </div>
                                        <button onClick={() => handleKickPlayer(p.id)}
                                                className="w-7 h-7 rounded-full flex items-center justify-center text-gray-400 hover:text-white hover:bg-[#FF5263] transition-all border-2 border-gray-200 hover:border-[#FF5263]">
                                            <span className="material-symbols-outlined text-[16px]">close</span>
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {/* ════ PLAYING ════ */}
                {gameState === 'PLAYING' && character && (
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start w-full">

                        {/* Character box */}
                        <div className="lg:col-span-5 flex flex-col items-center gap-4">
                            <div className="character-box w-full max-w-[340px]">
                                <div className="absolute inset-0 z-0"
                                     style={{ backgroundColor: hsbToCss(character.random_h||180, character.random_s||50, character.random_b||50) }} />
                                <img src={getImageUrl(character.image_path)}
                                     onError={() => setImageError(true)}
                                     style={{ display: imageError ? 'none':'block', width:'100%', height:'100%', objectFit:'contain', position:'relative', zIndex:5 }}
                                     alt="character" />
                                {imageError && renderSilhouette(character.id, hsbToCss(character.random_h||180, character.random_s||50, character.random_b||50))}
                            </div>
                            {/* Timer */}
                            <div className="w-full max-w-[340px]">
                                <div className="flex justify-between text-xs font-extrabold mb-1" style={{ color:'#1A1A2E' }}>
                                    <span>⏱ Temps restant</span>
                                    <span style={{ color: timerColor, fontSize:'1rem' }}>{timer}s</span>
                                </div>
                                <div className="timer-container">
                                    <div className="timer-bar" style={{ width:`${timerPct}%`, background: timerColor }} />
                                </div>
                            </div>
                        </div>

                        {/* Right: Question + Players */}
                        <div className="lg:col-span-7 flex flex-col gap-5">
                            {/* Speech bubble question */}
                            <div className="speech-bubble mb-4">
                                <p className="text-[10px] font-extrabold uppercase tracking-widest text-gray-400 mb-1">{character.source}</p>
                                <h2 className="text-xl font-black" style={{ color:'#1A1A2E', fontFamily:"'Nunito',sans-serif" }}>
                                    Quelle est la couleur de{' '}
                                    <span style={{ color:'#FF5263' }}>{character.part}</span>
                                    {' '}de{' '}
                                    <span style={{ color:'#00C2B3' }}>{character.name}</span> ?
                                </h2>
                            </div>

                            {/* Player statuses */}
                            <div className="toon-card p-5">
                                <h3 className="text-xs font-extrabold uppercase tracking-widest text-gray-400 border-b border-gray-100 pb-2 mb-3">
                                    Réponses
                                </h3>
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                    {players.map((p, i) => (
                                        <div key={p.id}
                                             className="flex items-center gap-2 p-2.5 rounded-xl transition-all"
                                             style={{
                                                 background: p.hasGuessed ? '#F0FDF4' : '#F9FAFB',
                                                 border: `2px solid ${p.hasGuessed ? '#4ADE80' : '#E5E7EB'}`,
                                                 boxShadow: p.hasGuessed ? '2px 2px 0px #4ADE80' : '2px 2px 0px #E5E7EB',
                                             }}>
                                            <div className="w-7 h-7 rounded-full border-2 border-[#1A1A2E] flex items-center justify-center font-black text-xs text-white flex-shrink-0 overflow-hidden"
                                                 style={{ background: PLAYER_COLORS[i % PLAYER_COLORS.length] }}>
                                                {p.avatar
                                                    ? <img src={p.avatar} alt="av" className="w-full h-full object-cover" />
                                                    : p.name.charAt(0).toUpperCase()}
                                            </div>
                                            <span className="text-xs font-extrabold truncate" style={{ color: p.hasGuessed ? '#16A34A' : '#6B7280' }}>
                                                {p.hasGuessed ? '✓ ' : ''}{p.name}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* End round early */}
                            <button onClick={triggerEndRound}
                                    className="toon-btn w-full py-3 text-sm"
                                    style={{ background:'#1A1A2E', color:'#fff' }}>
                                Terminer la manche →
                            </button>
                        </div>
                    </div>
                )}

                {/* ════ ROUND END ════ */}
                {gameState === 'ROUND_END' && character && (
                    <div className="flex flex-col gap-6 w-full">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">

                            {/* Target reveal */}
                            <div className="toon-card p-6 flex flex-col items-center">
                                <span className="text-[10px] font-extrabold uppercase tracking-widest mb-2 px-3 py-1 rounded-full"
                                      style={{ background:'#4ADE80', color:'#1A1A2E', border:'2px solid #1A1A2E', boxShadow:'1px 1px 0px #1A1A2E' }}>
                                    ✓ Couleur Cible
                                </span>
                                <div className="character-box w-[210px] mb-4">
                                    <div className="absolute inset-0 z-0" style={{ backgroundColor: targetHslColor }} />
                                    <img src={getImageUrl(character.image_path)} onError={() => setImageError(true)}
                                         style={{ display: imageError ? 'none':'block', width:'100%', height:'100%', objectFit:'contain', position:'relative', zIndex:5 }} alt="character" />
                                    {imageError && renderSilhouette(character.id, targetHslColor)}
                                </div>
                                <h3 className="font-black text-lg text-center" style={{ color:'#1A1A2E' }}>
                                    {character.name} <span className="text-gray-400 font-bold">·</span> {character.part}
                                </h3>
                                <div className="flex gap-3 mt-2">
                                    {[['H', character.target_h, '°'], ['S', character.target_s, '%'], ['B', character.target_b, '%']].map(([l, v, u]) => (
                                        <span key={l} className="font-mono text-xs font-extrabold px-2 py-1 rounded-lg"
                                              style={{ background:'#F9FAFB', border:'2px solid #1A1A2E', boxShadow:'1px 1px 0px #1A1A2E', color:'#1A1A2E' }}>
                                            {l}: {v}{u}
                                        </span>
                                    ))}
                                </div>
                            </div>

                            {/* Round scores */}
                            <div className="toon-card p-6 flex flex-col" style={{ maxHeight:380 }}>
                                <h3 className="font-black uppercase text-sm tracking-wide mb-4 border-b-2 border-gray-100 pb-3"
                                    style={{ color:'#FF5263' }}>
                                    🏅 Classement manche
                                </h3>
                                <div className="flex-1 overflow-y-auto flex flex-col gap-2">
                                    {roundResults.map((r, i) => {
                                        const guessColor = r.guess ? hsbToCss(r.guess.h, r.guess.s, r.guess.b) : '#ccc';
                                        const medal = ['🥇','🥈','🥉'][i] || `${i+1}.`;
                                        return (
                                            <div key={r.id} className="flex items-center justify-between p-3 rounded-xl"
                                                 style={{ background:'#F9FAFB', border:'2px solid #1A1A2E', boxShadow:'2px 2px 0px #1A1A2E' }}>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-lg">{medal}</span>
                                                    <div className="w-8 h-8 rounded-full border-2 border-[#1A1A2E] flex-shrink-0 overflow-hidden flex items-center justify-center font-black text-xs text-white"
                                                         style={{ background: PLAYER_COLORS[i % PLAYER_COLORS.length] }}>
                                                        {r.avatar ? <img src={r.avatar} alt="av" className="w-full h-full object-cover" /> : r.name.charAt(0)}
                                                    </div>
                                                    <div>
                                                        <p className="font-extrabold text-sm" style={{ color:'#1A1A2E' }}>{r.name}</p>
                                                        {r.hintUsed && <p className="text-[9px] font-bold text-amber-500 uppercase">💡 Indice utilisé</p>}
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    {r.guess && (
                                                        <div className="w-7 h-7 rounded-lg border-2 border-[#1A1A2E]" style={{ background: guessColor, boxShadow:'1px 1px 0px #1A1A2E' }} />
                                                    )}
                                                    <span className="font-black text-sm px-2.5 py-1 rounded-lg"
                                                          style={{ background:'#FFD93D', color:'#1A1A2E', border:'2px solid #1A1A2E', boxShadow:'1px 1px 0px #1A1A2E', minWidth:60, textAlign:'center' }}>
                                                        {r.roundScore.toFixed(2)}
                                                    </span>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>

                        <button onClick={handleNextRound}
                                className="toon-btn w-full py-5 text-xl"
                                style={{ background:'#00C2B3', color:'#1A1A2E' }}>
                            {currentRound === totalRounds ? '🏆 Voir les résultats finaux' : '➡ Manche Suivante'}
                        </button>
                    </div>
                )}

                {/* ════ GAME END ════ */}
                {gameState === 'GAME_END' && (
                    <div className="flex flex-col gap-8 w-full items-center">
                        <h2 className="text-5xl font-black text-center pulse-title"
                            style={{ fontFamily:"'Fredoka One','Nunito',sans-serif", color:'#1A1A2E', textShadow:'4px 4px 0px #FFD93D' }}>
                            🏆 Classement Final
                        </h2>

                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 w-full items-start">

                            {/* Podium */}
                            <div className="lg:col-span-7 flex flex-col gap-6 items-center">
                                <div className="flex items-end justify-center w-full max-w-[500px] h-[320px] rounded-2xl p-6 relative"
                                     style={{ background:'#FFFFFF', border:'3px solid #1A1A2E', boxShadow:'6px 6px 0px #1A1A2E' }}>

                                    {/* 2nd */}
                                    {finalResults[1] && (
                                        <div className="flex flex-col items-center w-1/3">
                                            <div className="w-12 h-12 rounded-full border-3 border-[#1A1A2E] overflow-hidden mb-1 flex items-center justify-center font-black text-white"
                                                 style={{ background:'#C0C0C0', boxShadow:'2px 2px 0px #1A1A2E' }}>
                                                {finalResults[1].avatar ? <img src={finalResults[1].avatar} alt="av" className="w-full h-full object-cover" /> : finalResults[1].name.charAt(0)}
                                            </div>
                                            <span className="text-xs font-black truncate max-w-[70px] mb-1" style={{ color:'#1A1A2E' }}>{finalResults[1].name}</span>
                                            <div className="w-full rounded-t-xl flex flex-col items-center justify-center py-4 h-[90px]"
                                                 style={{ background:'#C0C0C0', border:'3px solid #1A1A2E', borderBottom:'none', boxShadow:'2px 2px 0px #1A1A2E' }}>
                                                <span className="text-2xl font-black" style={{ color:'#1A1A2E' }}>2</span>
                                                <span className="text-[10px] font-bold" style={{ color:'#1A1A2E' }}>{finalResults[1].totalScore.toFixed(1)} pts</span>
                                            </div>
                                        </div>
                                    )}

                                    {/* 1st */}
                                    {finalResults[0] && (
                                        <div className="flex flex-col items-center w-1/3 z-10">
                                            <span className="text-3xl mb-1">👑</span>
                                            <div className="w-16 h-16 rounded-full border-4 overflow-hidden mb-1 flex items-center justify-center font-black text-white text-lg"
                                                 style={{ borderColor:'#FFD93D', background:'#FFD93D', boxShadow:'3px 3px 0px #1A1A2E' }}>
                                                {finalResults[0].avatar ? <img src={finalResults[0].avatar} alt="av" className="w-full h-full object-cover" /> : finalResults[0].name.charAt(0)}
                                            </div>
                                            <span className="text-sm font-black truncate max-w-[90px] mb-1" style={{ color:'#1A1A2E' }}>{finalResults[0].name}</span>
                                            <div className="w-full rounded-t-xl flex flex-col items-center justify-center py-6 h-[130px]"
                                                 style={{ background:'#FFD93D', border:'3px solid #1A1A2E', borderBottom:'none', boxShadow:'3px 3px 0px #1A1A2E' }}>
                                                <span className="text-4xl font-black" style={{ color:'#1A1A2E' }}>1</span>
                                                <span className="text-xs font-extrabold" style={{ color:'#1A1A2E' }}>{finalResults[0].totalScore.toFixed(1)} pts</span>
                                            </div>
                                        </div>
                                    )}

                                    {/* 3rd */}
                                    {finalResults[2] && (
                                        <div className="flex flex-col items-center w-1/3">
                                            <div className="w-10 h-10 rounded-full border-2 border-[#1A1A2E] overflow-hidden mb-1 flex items-center justify-center font-black text-white"
                                                 style={{ background:'#CD7F32', boxShadow:'2px 2px 0px #1A1A2E' }}>
                                                {finalResults[2].avatar ? <img src={finalResults[2].avatar} alt="av" className="w-full h-full object-cover" /> : finalResults[2].name.charAt(0)}
                                            </div>
                                            <span className="text-xs font-black truncate max-w-[70px] mb-1" style={{ color:'#6B7280' }}>{finalResults[2].name}</span>
                                            <div className="w-full rounded-t-xl flex flex-col items-center justify-center py-3 h-[65px]"
                                                 style={{ background:'#CD7F32', border:'3px solid #1A1A2E', borderBottom:'none', boxShadow:'2px 2px 0px #1A1A2E' }}>
                                                <span className="text-xl font-black text-white">3</span>
                                                <span className="text-[9px] font-bold text-white">{finalResults[2].totalScore.toFixed(1)} pts</span>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Awards */}
                                {awards.length > 0 && (
                                    <div className="flex flex-wrap gap-3 justify-center">
                                        {awards.map(aw => (
                                            <div key={aw.type} className="flex items-center gap-3 px-4 py-3 rounded-xl"
                                                 style={{ background:'#fff', border:'2px solid #1A1A2E', boxShadow:'3px 3px 0px #1A1A2E' }}>
                                                <span className="text-2xl">{aw.icon}</span>
                                                <div>
                                                    <p className="text-[9px] font-extrabold uppercase tracking-wider" style={{ color:'#FF5263' }}>{aw.title}</p>
                                                    <p className="text-sm font-black" style={{ color:'#1A1A2E' }}>{aw.playerName}</p>
                                                    <p className="text-[9px] text-gray-400">{aw.value}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Full leaderboard */}
                            <div className="lg:col-span-5 toon-card p-6 flex flex-col" style={{ maxHeight:380 }}>
                                <h3 className="font-black uppercase text-sm mb-4 border-b-2 border-gray-100 pb-3" style={{ color:'#1A1A2E' }}>
                                    Scores finaux
                                </h3>
                                <div className="flex-1 overflow-y-auto flex flex-col gap-2">
                                    {finalResults.map((r, i) => (
                                        <div key={r.id} className="flex items-center justify-between p-3 rounded-xl"
                                             style={{ background:'#F9FAFB', border:'2px solid #1A1A2E', boxShadow:'2px 2px 0px #1A1A2E' }}>
                                            <div className="flex items-center gap-2">
                                                <span className="text-base">{['🥇','🥈','🥉'][i] || `${i+1}.`}</span>
                                                <div className="w-8 h-8 rounded-full border-2 border-[#1A1A2E] flex-shrink-0 overflow-hidden flex items-center justify-center font-black text-xs text-white"
                                                     style={{ background: PLAYER_COLORS[i % PLAYER_COLORS.length] }}>
                                                    {r.avatar ? <img src={r.avatar} alt="av" className="w-full h-full object-cover" /> : r.name.charAt(0)}
                                                </div>
                                                <span className="font-extrabold text-sm" style={{ color:'#1A1A2E' }}>{r.name}</span>
                                            </div>
                                            <span className="font-black text-sm px-2.5 py-1 rounded-lg"
                                                  style={{ background:'#FFD93D', color:'#1A1A2E', border:'2px solid #1A1A2E', boxShadow:'1px 1px 0px #1A1A2E' }}>
                                                {r.totalScore.toFixed(2)} pts
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        <div className="flex gap-4 w-full max-w-[560px]">
                            <button onClick={handleRestartGame}
                                    className="toon-btn flex-1 py-4 text-lg"
                                    style={{ background:'#FF5263', color:'#fff' }}>
                                🔄 Rejouer
                            </button>
                            <button onClick={() => navigate('/color')}
                                    className="toon-btn flex-1 py-4 text-lg"
                                    style={{ background:'#1A1A2E', color:'#fff' }}>
                                🚪 Quitter
                            </button>
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}

export default ColorHostView;
