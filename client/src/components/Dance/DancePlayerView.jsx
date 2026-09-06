import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { socket } from '../../socket';
import {
    DanceEngine,
    measureClockOffset,
    COLUMN_LABELS,
    COLUMNS,
} from './danceEngine';
import './DanceStyles.css';

const SESSION_KEY = 'dance-session';

const readSession = () => {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
};
const writeSession = (patch) => {
    try {
        const prev = JSON.parse(localStorage.getItem(SESSION_KEY) || '{}');
        localStorage.setItem(SESSION_KEY, JSON.stringify({ ...prev, ...patch }));
    } catch { /* localStorage indisponible */ }
};

/**
 * DANCE_DANCE — le téléphone.
 *
 * Le joueur regarde son propre écran, contrairement à l'arène .IO où le
 * téléphone n'est qu'une manette : un jeu de rythme se joue à l'œil, sur les
 * flèches qui descendent, et il est impossible de suivre sa propre colonne sur
 * un écran partagé par vingt personnes.
 *
 * ── Pourquoi tout se joue ici ───────────────────────────────────────
 * Le jugement est local (cf. `danceEngine.js`) : la latence du wifi
 * détruirait la fenêtre « parfait » de 25 ms. Le serveur revalide chaque
 * frappe, donc tricher ne rapporte rien, mais le retour visuel, lui, est
 * immédiat. C'est ce qui sépare un jeu de rythme jouable d'un jeu frustrant.
 *
 * ── Rendu ───────────────────────────────────────────────────────────
 * Les flèches sont positionnées à chaque image à partir de l'horloge audio,
 * jamais par une animation CSS : le son est la référence, et une transition
 * finirait par s'en écarter. On écrit `style.top` directement sur des nœuds
 * réutilisés plutôt que de laisser React reconstruire la liste 60 fois par
 * seconde — le rendu React à cette cadence ferait tomber les images sur un
 * téléphone d'entrée de gamme.
 */
function DancePlayerView() {
    const { roomCode: urlRoomCode } = useParams();
    const saved = readSession();

    const [typedCode, setTypedCode] = useState('');
    const roomCode = urlRoomCode || typedCode;
    const [name, setName] = useState(saved?.pseudo || '');
    const [joined, setJoined] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const [phase, setPhase] = useState('LOBBY');     // LOBBY | COUNTDOWN | PLAYING | RESULT
    const [countdown, setCountdown] = useState(null);
    const [spectator, setSpectator] = useState(false);
    const [song, setSong] = useState(null);
    const [result, setResult] = useState(null);
    const [loadingAudio, setLoadingAudio] = useState(false);

    // Affichage du score : rafraîchi à cadence réduite, l'œil ne lit pas
    // un chiffre qui change 60 fois par seconde.
    const [hud, setHud] = useState({ score: 0, combo: 0, accuracy: 0 });
    const [verdict, setVerdict] = useState(null);

    const engineRef = useRef(null);
    const clockOffsetRef = useRef(0);
    const fieldRef = useRef(null);
    const noteNodesRef = useRef(new Map());   // noteId → élément DOM
    const rafRef = useRef(null);
    const frameRef = useRef(null);   // dernière version de la boucle de rendu
    const roomRef = useRef(roomCode);

    useEffect(() => { roomRef.current = roomCode; }, [roomCode]);

    useEffect(() => {
        document.body.classList.add('dance-theme');
        return () => document.body.classList.remove('dance-theme');
    }, []);

    /* ── Horloge ────────────────────────────────────────────────────
     * Mesurée dès l'arrivée, puis rafraîchie régulièrement : l'horloge d'un
     * téléphone dérive, et une dérive de 100 ms suffit à décaler la musique
     * par rapport aux flèches des autres joueurs.
     */
    useEffect(() => {
        if (!joined) return undefined;

        let cancelled = false;
        const sync = async () => {
            const offset = await measureClockOffset(socket);
            if (!cancelled) clockOffsetRef.current = offset;
        };
        sync();
        const timer = setInterval(sync, 30_000);
        return () => { cancelled = true; clearInterval(timer); };
    }, [joined]);

    /* ── Entrée dans le salon ───────────────────────────────────── */

    const join = useCallback(() => {
        const cleanName = name.trim();
        if (!roomCode || !cleanName) return;

        setBusy(true);
        setError('');

        // `timeout` plutôt qu'un `emit` nu : si le joueur appuie pendant une
        // micro-coupure, la demande partirait dans la file d'attente et son
        // accusé de réception ne reviendrait jamais — le bouton resterait à
        // tourner sans que rien n'explique pourquoi.
        socket.timeout(8000).emit('dance-join-room',
            { roomCode, playerName: cleanName, avatar: saved?.avatar || null },
            (err, res) => {
                setBusy(false);
                if (err) return setError('Serveur injoignable, réessayez');
                if (res?.error) return setError(res.error);
                setJoined(true);
                setSpectator(!!res.spectator);
                setPhase(res.state?.state || 'LOBBY');
                writeSession({ pseudo: cleanName, roomCode });
            });
    }, [name, roomCode, saved]);

    /* ── Boucle de rendu ────────────────────────────────────────── */

    const stopLoop = useCallback(() => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
    }, []);

    /**
     * Une image : on avance l'horloge, on repositionne les flèches visibles,
     * on retire celles qui sont sorties.
     */
    const renderFrame = useCallback(() => {
        const engine = engineRef.current;
        const field = fieldRef.current;
        if (!engine || !field) return;

        engine.collectMisses();

        const height = field.clientHeight;
        // La ligne de frappe est aux trois quarts de la hauteur : il faut de la
        // place au-dessus pour lire les flèches qui arrivent, et un peu en
        // dessous pour voir celles qu'on vient de rater.
        const targetY = height * 0.76;
        // Durée que couvre la portion visible au-dessus de la cible. Plus elle
        // est courte, plus les flèches vont vite — 1,5 s est le compromis
        // habituel des jeux de rythme sur petit écran.
        const lookAheadMs = 1500;

        const visible = engine.visibleNotes(lookAheadMs);
        const now = engine.position();
        const seen = new Set();

        for (const note of visible) {
            seen.add(note.id);
            let node = noteNodesRef.current.get(note.id);

            if (!node) {
                node = document.createElement('div');
                node.className = `dd-note dd-note-${note.column}`;
                node.textContent = COLUMN_LABELS[note.column];
                const lane = field.children[note.column];
                if (!lane) continue;
                lane.appendChild(node);
                noteNodesRef.current.set(note.id, node);
            }

            // Progression de la note : 0 à l'entrée de l'écran, 1 sur la cible.
            const progress = 1 - (note.timeMs - now) / lookAheadMs;
            node.style.top = `${progress * targetY}px`;
        }

        // Nettoyage des flèches sorties de l'écran.
        for (const [id, node] of noteNodesRef.current) {
            if (seen.has(id)) continue;
            node.remove();
            noteNodesRef.current.delete(id);
        }

        if (engine.finished()) {
            stopLoop();
            return;
        }
        // La boucle se replanifie via une référence plutôt qu'en se nommant
        // elle-même : une fonction qui se capture à sa déclaration figerait la
        // première version pour toute la durée du morceau.
        rafRef.current = requestAnimationFrame(() => frameRef.current());
    }, [stopLoop]);

    // La ref pointe toujours vers la boucle courante, sans la recréer à chaque image.
    useEffect(() => { frameRef.current = renderFrame; }, [renderFrame]);

    /* ── Réception de la chorégraphie ───────────────────────────── */

    useEffect(() => {
        const onChart = async ({ chart, song: songData, startAt, serverTime, spectator: asSpectator }) => {
            setSong(songData);
            setResult(null);
            setSpectator(!!asSpectator);

            // Dernier calage : l'écart entre l'heure serveur annoncée et la
            // nôtre affine le décalage mesuré par sondage.
            if (typeof serverTime === 'number') {
                const naive = serverTime - Date.now();
                // On ne remplace pas brutalement : une valeur aberrante
                // (paquet retardé) casserait la synchronisation.
                if (Math.abs(naive - clockOffsetRef.current) < 400) {
                    clockOffsetRef.current = (clockOffsetRef.current + naive) / 2;
                }
            }

            engineRef.current?.stop();
            noteNodesRef.current.forEach((n) => n.remove());
            noteNodesRef.current.clear();

            const engine = new DanceEngine({
                chart,
                clockOffset: clockOffsetRef.current,
                startAt,
                onJudge: (judgement, note, offsetMs) => {
                    // Le serveur reçoit l'écart, jamais le verdict ni les points.
                    socket.emit('dance-hit', {
                        roomCode: roomRef.current,
                        noteId: note.id,
                        offsetMs: Math.round(offsetMs),
                    });
                    setVerdict({ ...judgement, key: Date.now() + Math.random() });
                },
                onMiss: () => {
                    setVerdict({ id: 'MISS', label: 'RATÉ', color: '#ef4444', key: Date.now() + Math.random() });
                },
            });
            engineRef.current = engine;

            setPhase('COUNTDOWN');
            setLoadingAudio(true);

            try {
                await engine.prepare(songData.audioUrl);
                setLoadingAudio(false);
                socket.emit('dance-ready', { roomCode: roomRef.current });
                engine.start();
                stopLoop();
                rafRef.current = requestAnimationFrame(renderFrame);
            } catch (err) {
                console.error('[DANCE] Audio impossible à préparer', err);
                setLoadingAudio(false);
                setError('Impossible de charger la musique');
            }
        };

        const onState = (state) => {
            setPhase(state.state);
            if (state.state === 'LOBBY') {
                setCountdown(null);
                setResult(null);
            }
        };

        const onRoundEnd = ({ results }) => {
            stopLoop();
            engineRef.current?.stop();
            noteNodesRef.current.forEach((n) => n.remove());
            noteNodesRef.current.clear();
            setPhase('RESULT');
            const mine = results.find((r) => r.playerId === socket.id);
            setResult(mine || null);
        };

        const onKicked = () => {
            setJoined(false);
            setError('Vous avez été retiré du salon');
        };

        socket.on('dance-chart', onChart);
        socket.on('dance-state', onState);
        socket.on('dance-round-end', onRoundEnd);
        socket.on('dance-kicked', onKicked);

        return () => {
            socket.off('dance-chart', onChart);
            socket.off('dance-state', onState);
            socket.off('dance-round-end', onRoundEnd);
            socket.off('dance-kicked', onKicked);
        };
    }, [renderFrame, stopLoop]);

    /* ── Compte à rebours et HUD ────────────────────────────────── */

    useEffect(() => {
        if (phase !== 'COUNTDOWN' && phase !== 'PLAYING') return undefined;

        const timer = setInterval(() => {
            const engine = engineRef.current;
            if (!engine) return;

            const pos = engine.position();
            if (pos < 0) {
                setCountdown(Math.ceil(-pos / 1000));
            } else {
                setCountdown(null);
                setHud({
                    score: engine.state.score,
                    combo: engine.state.combo,
                    accuracy: engine.accuracy(),
                });
            }
        }, 100);

        return () => clearInterval(timer);
    }, [phase]);

    /* ── Nettoyage ──────────────────────────────────────────────── */

    useEffect(() => () => {
        stopLoop();
        engineRef.current?.stop();
    }, [stopLoop]);

    /* ── Saisie ─────────────────────────────────────────────────── */

    /**
     * Un appui. `pointerdown` plutôt que `click` : le clic attend la fin du
     * geste, ce qui ajouterait des dizaines de millisecondes au moment précis
     * où elles comptent le plus.
     */
    const press = useCallback((column) => {
        const engine = engineRef.current;
        if (!engine || spectator) return;

        engine.hit(column);

        // Retour tactile : le pouce sent la frappe même sans regarder.
        if (navigator.vibrate) navigator.vibrate(8);

        const el = document.getElementById(`dd-pad-${column}`);
        if (el) {
            el.classList.add('dd-pad-active');
            setTimeout(() => el.classList.remove('dd-pad-active'), 90);
        }
    }, [spectator]);

    // Le clavier sert au test sur ordinateur et à l'accessibilité.
    useEffect(() => {
        if (phase !== 'PLAYING') return undefined;
        const KEYS = { ArrowLeft: 0, ArrowDown: 1, ArrowUp: 2, ArrowRight: 3 };
        const onKey = (e) => {
            const col = KEYS[e.key];
            if (col === undefined || e.repeat) return;
            e.preventDefault();
            press(col);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [phase, press]);

    /* ── Rendu ──────────────────────────────────────────────────── */

    if (!joined) {
        return (
            <div className="dd-root flex items-center justify-center p-6">
                <div className="dd-panel p-6 w-full max-w-sm flex flex-col gap-4">
                    <div className="text-center">
                        <p className="dd-eyebrow">Jeu de rythme</p>
                        <h1 className="dd-title">Dance <span className="dd-title-accent">Dance</span></h1>
                    </div>

                    {!urlRoomCode && (
                        <input
                            className="dd-panel px-4 py-3 text-center text-2xl tracking-widest"
                            style={{ background: 'rgba(255,255,255,0.05)' }}
                            placeholder="CODE"
                            inputMode="numeric"
                            maxLength={4}
                            value={typedCode}
                            onChange={(e) => setTypedCode(e.target.value.replace(/\D/g, ''))}
                        />
                    )}

                    <input
                        className="dd-panel px-4 py-3"
                        style={{ background: 'rgba(255,255,255,0.05)' }}
                        placeholder="Votre pseudo"
                        maxLength={16}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && join()}
                    />

                    {error && <p style={{ color: '#f87171', fontSize: 13 }}>{error}</p>}

                    <button className="dd-btn" onClick={join} disabled={busy || !roomCode || !name.trim()}>
                        {busy ? <Loader2 className="animate-spin mx-auto" size={18} /> : 'Rejoindre'}
                    </button>
                </div>
            </div>
        );
    }

    if (phase === 'RESULT' && result) {
        return (
            <div className="dd-root flex items-center justify-center p-6">
                <div className="dd-panel p-6 w-full max-w-sm flex flex-col gap-4 text-center">
                    <p className="dd-eyebrow">{song?.title}</p>
                    <div className={`dd-rank dd-rank-${result.rank}`}>{result.rank}</div>
                    <div>
                        <div style={{ fontSize: 32, fontWeight: 800 }}>{result.score.toLocaleString('fr-FR')}</div>
                        <p className="dd-eyebrow">{result.accuracy} % · combo max {result.maxCombo}</p>
                    </div>
                    <div className="flex flex-col">
                        {['PERFECT', 'GREAT', 'GOOD', 'BAD', 'MISS'].map((k) => (
                            <div key={k} className="dd-judge-line">
                                <span style={{ color: 'var(--dd-muted)' }}>{k}</span>
                                <span>{result.counts[k] || 0}</span>
                            </div>
                        ))}
                    </div>
                    <p className="dd-eyebrow">En attente du prochain morceau…</p>
                </div>
            </div>
        );
    }

    // En jeu : couloirs, cibles et pavé tactile.
    return (
        <div className="dd-root" style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
            {/* Bandeau de score, compact pour laisser la place au jeu */}
            <div className="flex items-center justify-between px-4 py-2" style={{ flexShrink: 0 }}>
                <div>
                    <div style={{ fontSize: 20, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                        {hud.score.toLocaleString('fr-FR')}
                    </div>
                    <p className="dd-eyebrow">{hud.accuracy} %</p>
                </div>
                {hud.combo >= 5 && (
                    <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--dd-accent)' }}>{hud.combo}</div>
                        <p className="dd-eyebrow">combo</p>
                    </div>
                )}
            </div>

            {/* Zone de défilement des flèches */}
            <div style={{ position: 'relative', flex: '1 1 55%', minHeight: 0 }}>
                <div className="dd-field" ref={fieldRef}>
                    {Array.from({ length: COLUMNS }, (_, col) => (
                        <div className="dd-lane" key={col}>
                            <div
                                className={`dd-target dd-pad-${col}`}
                                style={{ top: '76%' }}
                            >
                                {COLUMN_LABELS[col]}
                            </div>
                        </div>
                    ))}
                </div>

                {verdict && (
                    <div className="dd-verdict" key={verdict.key} style={{ color: verdict.color }}>
                        {verdict.label}
                    </div>
                )}

                {countdown !== null && countdown > 0 && (
                    <div className="dd-countdown">
                        <div className="dd-countdown-value">{countdown}</div>
                        <p className="dd-eyebrow">{song?.title}</p>
                        {loadingAudio && <p className="dd-eyebrow">chargement…</p>}
                    </div>
                )}

                {phase === 'LOBBY' && (
                    <div className="dd-countdown">
                        <p className="dd-eyebrow">En attente de l'hôte</p>
                        <div style={{ fontSize: 40, marginTop: 8 }}>🕺</div>
                    </div>
                )}

                {spectator && phase === 'PLAYING' && (
                    <div className="dd-countdown" style={{ background: 'rgba(5,6,14,0.5)' }}>
                        <p className="dd-eyebrow">Vous jouerez au prochain morceau</p>
                    </div>
                )}
            </div>

            {/* Pavé tactile : quatre grandes zones, deux pouces */}
            <div style={{ flex: '1 1 45%', minHeight: 0, flexShrink: 0 }}>
                <div className="dd-pad">
                    {/* Ordre visuel d'une croix : ← ↑ / ↓ → */}
                    {[0, 2, 1, 3].map((col) => (
                        <button
                            key={col}
                            id={`dd-pad-${col}`}
                            className={`dd-pad-btn dd-pad-${col}`}
                            onPointerDown={(e) => { e.preventDefault(); press(col); }}
                            aria-label={`Flèche ${COLUMN_LABELS[col]}`}
                        >
                            {COLUMN_LABELS[col]}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}

export default DancePlayerView;
