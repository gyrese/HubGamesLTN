import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Loader2, Music, Users } from 'lucide-react';
import { socket } from '../../socket';
import './DanceStyles.css';

const HOST_KEY = 'dance-host-room';

/**
 * DANCE_DANCE — le grand écran.
 *
 * Contrairement aux autres jeux du hub, l'écran n'est pas ici le support du
 * jeu : chaque joueur suit ses propres flèches sur son téléphone, parce qu'on
 * ne peut pas lire quatre couloirs partagés à vingt. L'écran sert donc à ce
 * que le téléphone ne peut pas faire — montrer où en est la salle : le
 * classement en direct, les combos qui montent, le morceau en cours.
 *
 * Il reçoit les scores agrégés à 5 Hz (`dance-scores`, en volatile) plutôt que
 * chaque frappe : à vingt joueurs et six notes par seconde, relayer les frappes
 * individuelles saturerait le réseau pour une information que personne ne lit.
 */
function DanceHostView() {
    const { roomCode: urlRoomCode } = useParams();
    const [searchParams] = useSearchParams();

    const [roomCode, setRoomCode] = useState(urlRoomCode || '');
    const [state, setState] = useState(null);
    const [songs, setSongs] = useState([]);
    const [difficulties, setDifficulties] = useState([]);
    const [selectedSong, setSelectedSong] = useState(searchParams.get('song') || null);
    const [difficulty, setDifficulty] = useState(searchParams.get('difficulty') || 'normal');
    const [liveScores, setLiveScores] = useState([]);
    const [countdown, setCountdown] = useState(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [connected, setConnected] = useState(socket.connected);

    const startAtRef = useRef(null);

    useEffect(() => {
        document.body.classList.add('dance-theme');
        return () => document.body.classList.remove('dance-theme');
    }, []);

    /* ── Ouverture ou reprise du salon ──────────────────────────── */

    useEffect(() => {
        const openRoom = () => {
            socket.emit('dance-create-room', { songId: selectedSong, difficulty }, (res) => {
                if (res?.error) return setError(res.error);
                setRoomCode(res.roomCode);
                setState(res.state);
                setSongs(res.songs || []);
                setDifficulties(res.difficulties || []);
                localStorage.setItem(HOST_KEY, res.roomCode);
            });
        };

        /**
         * Ouvre le salon, ou reprend celui qui existe déjà.
         *
         * Rejoué à chaque (re)connexion : après une coupure, le serveur ne
         * connaît plus notre socket, et sans cette reprise l'écran afficherait
         * un code que plus personne ne peut rejoindre.
         */
        const openOrResume = () => {
            const target = urlRoomCode || localStorage.getItem(HOST_KEY);
            if (!target) return openRoom();

            // Un vidéoprojecteur qui se rebranche doit retrouver sa partie, pas
            // en ouvrir une seconde à côté.
            socket.emit('dance-host-reconnect', { roomCode: target }, (res) => {
                if (res?.success) {
                    setRoomCode(target);
                    setState(res.state);
                    socket.emit('dance-list-songs', {}, (cat) => {
                        setSongs(cat?.songs || []);
                        setDifficulties(cat?.difficulties || []);
                    });
                } else {
                    localStorage.removeItem(HOST_KEY);
                    openRoom();
                }
            });
        };

        // Un `emit` lancé avant que la socket soit connectée part dans la file
        // d'attente, et **son accusé de réception ne revient jamais** : l'écran
        // resterait indéfiniment sur son chargement. On n'émet donc qu'une fois
        // le lien établi — le cas normal au premier affichage de la page, où le
        // composant se monte avant la fin de la poignée de main.
        const onConnect = () => { setConnected(true); openOrResume(); };
        const onDisconnect = () => setConnected(false);

        if (socket.connected) openOrResume();
        socket.on('connect', onConnect);
        socket.on('disconnect', onDisconnect);

        return () => {
            socket.off('connect', onConnect);
            socket.off('disconnect', onDisconnect);
        };
        // Volontairement au montage seulement : rouvrir un salon à chaque
        // changement de morceau créerait un salon par clic.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    /* ── Flux du salon ──────────────────────────────────────────── */

    useEffect(() => {
        const onState = (next) => {
            setState(next);
            startAtRef.current = next.startAt;
            if (next.state === 'LOBBY') {
                setLiveScores([]);
                setCountdown(null);
            }
        };
        const onScores = ({ players }) => setLiveScores(players || []);
        const onRoundEnd = ({ results }) => setLiveScores(results || []);
        const onClosed = () => {
            localStorage.removeItem(HOST_KEY);
            setError('Salon fermé');
        };

        socket.on('dance-state', onState);
        socket.on('dance-scores', onScores);
        socket.on('dance-round-end', onRoundEnd);
        socket.on('dance-room-closed', onClosed);

        return () => {
            socket.off('dance-state', onState);
            socket.off('dance-scores', onScores);
            socket.off('dance-round-end', onRoundEnd);
            socket.off('dance-room-closed', onClosed);
        };
    }, []);

    /* ── Décompte avant le départ ───────────────────────────────── */

    useEffect(() => {
        if (state?.state !== 'COUNTDOWN' || !state.startAt) return undefined;
        const timer = setInterval(() => {
            const remaining = Math.ceil((state.startAt - Date.now()) / 1000);
            setCountdown(remaining > 0 ? remaining : null);
        }, 100);
        return () => clearInterval(timer);
    }, [state?.state, state?.startAt]);

    const startRound = useCallback(() => {
        if (!selectedSong) return setError('Choisissez un morceau');
        setBusy(true);
        setError('');
        socket.emit('dance-start-round', { roomCode, songId: selectedSong, difficulty }, (res) => {
            setBusy(false);
            if (res?.error) setError(res.error);
        });
    }, [roomCode, selectedSong, difficulty]);

    const players = state?.players || [];
    const playing = state?.state === 'PLAYING' || state?.state === 'COUNTDOWN';
    const board = liveScores.length ? liveScores : players.filter((p) => !p.spectator);

    // Tant que le salon n'est pas ouvert, on dit *pourquoi* on attend : un
    // écran de bar bloqué sur une roue qui tourne ne permet à personne de
    // savoir s'il faut patienter ou relancer.
    if (!state) {
        return (
            <div className="dd-root flex flex-col items-center justify-center gap-4 p-6 text-center">
                <Loader2 className="animate-spin" size={32} />
                <p className="dd-eyebrow">
                    {error
                        ? error
                        : connected
                            ? 'Ouverture du salon…'
                            : 'Connexion au serveur…'}
                </p>
                {(error || !connected) && (
                    <button className="dd-btn dd-btn-ghost" onClick={() => window.location.reload()}>
                        Réessayer
                    </button>
                )}
            </div>
        );
    }

    return (
        <div className="dd-root" style={{ height: '100dvh', display: 'flex', flexDirection: 'column', padding: 24, gap: 16 }}>
            {/* En-tête : code du salon, toujours lisible de loin */}
            <header className="flex items-center justify-between" style={{ flexShrink: 0 }}>
                <div>
                    <p className="dd-eyebrow">Jeu de rythme · rejoignez avec le code</p>
                    <h1 className="dd-title">Dance <span className="dd-title-accent">Dance</span></h1>
                </div>
                <div className="dd-panel px-6 py-3 text-center">
                    <p className="dd-eyebrow">Code</p>
                    <div style={{ fontSize: 44, fontWeight: 900, letterSpacing: '0.12em', lineHeight: 1 }}>
                        {roomCode}
                    </div>
                </div>
            </header>

            {error && (
                <div className="dd-panel px-4 py-2" style={{ color: '#f87171', flexShrink: 0 }}>{error}</div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: playing ? '1fr' : '1.4fr 1fr', gap: 16, flex: 1, minHeight: 0 }}>
                {/* Sélection du morceau — masquée pendant la chanson : l'écran
                    doit alors montrer le classement, pas des réglages. */}
                {!playing && (
                    <section className="dd-panel p-5 flex flex-col gap-4" style={{ minHeight: 0 }}>
                        <div className="flex items-center gap-2">
                            <Music size={18} />
                            <p className="dd-eyebrow">Morceau</p>
                        </div>

                        {songs.length === 0 ? (
                            <div style={{ color: 'var(--dd-muted)', fontSize: 14 }}>
                                <p>Aucun morceau dans le catalogue.</p>
                                <p style={{ marginTop: 8 }}>
                                    Ajoutez-en depuis l'administration : le tempo est détecté
                                    automatiquement et la chorégraphie générée.
                                </p>
                            </div>
                        ) : (
                            <div className="dd-song-grid" style={{ overflowY: 'auto', minHeight: 0 }}>
                                {songs.map((s) => (
                                    <button
                                        key={s.id}
                                        className={`dd-song-card${selectedSong === s.id ? ' dd-selected' : ''}`}
                                        onClick={() => setSelectedSong(s.id)}
                                    >
                                        <div className="dd-song-title">{s.title}</div>
                                        <div className="dd-song-meta">{s.artist}</div>
                                        <div className="dd-song-meta">
                                            {s.bpm} BPM · {Math.floor(s.durationMs / 60000)}:
                                            {String(Math.floor((s.durationMs % 60000) / 1000)).padStart(2, '0')}
                                        </div>
                                    </button>
                                ))}
                            </div>
                        )}

                        <div>
                            <p className="dd-eyebrow" style={{ marginBottom: 8 }}>Difficulté</p>
                            <div className="dd-diff-row">
                                {difficulties.map((d) => (
                                    <button
                                        key={d.id}
                                        className={`dd-diff-btn${difficulty === d.id ? ' dd-diff-active' : ''}`}
                                        style={{ color: d.color }}
                                        onClick={() => setDifficulty(d.id)}
                                    >
                                        <span>{d.label} {'★'.repeat(d.stars)}</span>
                                    </button>
                                ))}
                            </div>
                        </div>

                        <button
                            className="dd-btn"
                            onClick={startRound}
                            disabled={busy || !selectedSong || players.length === 0}
                        >
                            {players.length === 0 ? 'En attente de joueurs' : 'Lancer le morceau'}
                        </button>
                    </section>
                )}

                {/* Classement en direct */}
                <section className="dd-panel p-5 flex flex-col gap-3" style={{ minHeight: 0 }}>
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Users size={18} />
                            <p className="dd-eyebrow">
                                {playing ? 'Classement en direct' : `${players.length} joueur${players.length > 1 ? 's' : ''}`}
                            </p>
                        </div>
                        {state.song && playing && (
                            <p className="dd-eyebrow">{state.song.title} · {state.difficulty}</p>
                        )}
                    </div>

                    <div className="dd-scoreboard" style={{ flex: 1, minHeight: 0 }}>
                        {board.length === 0 && (
                            <p style={{ color: 'var(--dd-muted)', fontSize: 14 }}>
                                Les joueurs scannent le code et entrent leur pseudo.
                            </p>
                        )}
                        {board.map((p, i) => (
                            <div key={p.id || p.playerId} className={`dd-score-row${i === 0 && playing ? ' dd-leader' : ''}`}>
                                <span className="dd-score-rank">{i + 1}</span>
                                <div style={{ minWidth: 0 }}>
                                    <div className="dd-score-name">{p.name}</div>
                                    {p.combo > 4 && <div className="dd-score-combo">combo {p.combo}</div>}
                                    {!playing && p.spectator && <div className="dd-score-combo">au prochain morceau</div>}
                                </div>
                                <div style={{ textAlign: 'right' }}>
                                    <div className="dd-score-value">{(p.score || 0).toLocaleString('fr-FR')}</div>
                                    {p.rank && <div className={`dd-score-combo dd-rank-${p.rank}`}>{p.rank}</div>}
                                </div>
                            </div>
                        ))}
                    </div>
                </section>
            </div>

            {countdown !== null && countdown > 0 && (
                <div className="dd-countdown">
                    <div className="dd-countdown-value">{countdown}</div>
                    <p className="dd-eyebrow">{state.song?.title}</p>
                    <p className="dd-eyebrow" style={{ marginTop: 12 }}>Préparez vos pouces</p>
                </div>
            )}
        </div>
    );
}

export default DanceHostView;
