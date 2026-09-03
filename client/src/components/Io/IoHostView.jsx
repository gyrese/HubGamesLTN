import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { ArrowLeft, Loader2, Play, Square, Users } from 'lucide-react';
import { socket } from '../../socket';
import { IoArena } from './pixiArena';
import './IoStyles.css';

const ROOM_KEY = 'io-host-room';
const SHIELD_MS = 1500;   // doit refléter SPAWN_SHIELD_MS du serveur

/**
 * Pastille d'identité du classement : la même forme que la tête sur le terrain.
 * Dessinée en SVG plutôt qu'en canvas — c'est du DOM statique, autant laisser le
 * navigateur s'en charger.
 */
function ShapeChip({ shape, color, size = 16 }) {
    const c = size / 2;
    const r = size * 0.46;
    const poly = (n, rot = -90, inner = null) => {
        const pts = [];
        const steps = inner ? n * 2 : n;
        for (let i = 0; i < steps; i += 1) {
            const rad = inner && i % 2 ? inner : r;
            const a = ((Math.PI * 2 * i) / steps) + (rot * Math.PI) / 180;
            pts.push(`${(c + Math.cos(a) * rad).toFixed(2)},${(c + Math.sin(a) * rad).toFixed(2)}`);
        }
        return pts.join(' ');
    };

    let el;
    if (shape === 'square') el = <rect x={c - r * 0.85} y={c - r * 0.85} width={r * 1.7} height={r * 1.7} rx="1.5" fill={color} />;
    else if (shape === 'triangle') el = <polygon points={poly(3)} fill={color} />;
    else if (shape === 'diamond') el = <polygon points={poly(4)} fill={color} />;
    else if (shape === 'hexagon') el = <polygon points={poly(6)} fill={color} />;
    else if (shape === 'star') el = <polygon points={poly(5, -90, r * 0.45)} fill={color} />;
    else el = <circle cx={c} cy={c} r={r} fill={color} />;

    return (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="ioa-chip-svg" aria-hidden="true">
            {el}
        </svg>
    );
}

/**
 * IO_ARENA — le grand écran.
 *
 * Toute la partie se regarde ici : les téléphones ne sont que des manettes.
 * Quatre mécanismes portent le rendu, à comprendre avant d'y toucher.
 *
 * 1. **La grille arrive par différences.** Le serveur n'envoie la carte entière
 *    qu'au premier instantané ; ensuite, il ne transmet que les cases qui ont
 *    changé (`patch`). On maintient donc une copie locale qu'on rejoue.
 * 2. **On interpole.** Le serveur diffuse dix fois par seconde, l'écran redessine
 *    soixante fois : chaque position est lissée entre les deux derniers
 *    instantanés, sinon le mouvement serait saccadé.
 * 3. **Trois calques.** Le fond est peint une fois, le terrain seulement quand
 *    une case change, et seules les têtes et les effets sont redessinés à
 *    60 fps. C'est ce qui laisse le budget aux effets.
 * 4. **Chaque joueur a une forme.** La couleur ne suffit pas à en distinguer six
 *    pour toutes les visions ; la forme porte l'identité, la couleur la renforce.
 */
function IoHostView() {
    const navigate = useNavigate();
    const location = useLocation();
    const arenaRef = useRef(null);    // moteur PixiJS

    const [roomCode, setRoomCode] = useState(null);
    const [state, setState] = useState(null);
    const [error, setError] = useState('');
    const [feed, setFeed] = useState([]);
    const [scores, setScores] = useState([]);
    const [remaining, setRemaining] = useState(null);

    // Données de rendu : dans des refs, car elles changent 10 à 60 fois par
    // seconde et ne doivent jamais provoquer de re-rendu React.
    const gridRef = useRef(null);          // Uint8Array de la carte
    const dimsRef = useRef({ cols: 0, rows: 0, cell: 20 });
    const trailsRef = useRef(new Map());   // owner → { version, cells:Set }
    const prevRef = useRef(new Map());     // owner → { x, y, at }
    const currRef = useRef(new Map());     // owner → { x, y, at, ...reste }
    const colorsRef = useRef(new Map());   // owner → couleur
    const shapesRef = useRef(new Map());   // owner → forme d'identité
    const terrainDirty = useRef(true);     // le terrain doit-il être repeint ?
    const effectsRef = useRef([]);         // effets à jouer à la prochaine image

    useEffect(() => {
        document.body.classList.add('io-theme');
        return () => document.body.classList.remove('io-theme');
    }, []);

    // L'ouverture du salon ne doit avoir lieu qu'UNE fois. Sans ce garde-fou,
    // toute nouvelle référence de `createRoom` relance l'effet et ouvre un
    // second salon : le premier reste orphelin et l'écran attend indéfiniment un
    // état qui ne vient jamais. (Le mode strict de React monte deux fois en dev,
    // ce qui déclenche systématiquement le problème.)
    const bootstrapped = useRef(false);
    // Les réglages sont figés au montage : ils viennent de la navigation et ne
    // changent plus, mais les lire via une dépendance recréerait le salon.
    const settingsRef = useRef(location.state?.settings || {});

    const createRoom = useCallback(() => {
        const settings = settingsRef.current;
        socket.emit('io-create-room', { settings }, (res) => {
            if (!res || res.error) { setError(res?.error || 'Création impossible'); return; }
            sessionStorage.setItem(ROOM_KEY, res.roomCode);
            setRoomCode(res.roomCode);
            setState(res.state);
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (bootstrapped.current) return;
        bootstrapped.current = true;

        const existing = sessionStorage.getItem(ROOM_KEY);
        if (existing) {
            socket.emit('io-host-reconnect', { roomCode: existing }, (res) => {
                if (res?.success) { setRoomCode(existing); setState(res.state); }
                else { sessionStorage.removeItem(ROOM_KEY); createRoom(); }
            });
        } else {
            createRoom();
        }
    }, [createRoom]);

    // ── Réception des instantanés ────────────────────────────────────────────
    useEffect(() => {
        const onState = (snapshot) => {
            setState(snapshot);
            if (snapshot.state === 'LOBBY') {
                // Nouvelle manche à venir : on repart d'une carte vierge.
                gridRef.current = null;
                trailsRef.current.clear();
                prevRef.current.clear();
                currRef.current.clear();
                effectsRef.current = [];
                terrainDirty.current = true;
                setScores([]);
            }
        };

        const onFrame = (frame) => {
            const { cols, rows, cell } = frame;
            dimsRef.current = { cols, rows, cell };

            // Carte complète (premier instantané, ou écran qui rejoint en cours).
            if (frame.grid) {
                const grid = new Uint8Array(cols * rows);
                const runs = frame.grid.split(',');
                let at = 0;
                for (let i = 0; i < runs.length; i += 2) {
                    const value = Number(runs[i]);
                    const length = Number(runs[i + 1]);
                    grid.fill(value, at, at + length);
                    at += length;
                }
                gridRef.current = grid;
                terrainDirty.current = true;
            }

            // Différences : les seules cases qui ont changé depuis l'instantané
            // précédent, sous forme de paires [index, propriétaire].
            if (frame.patch?.length && gridRef.current) {
                const grid = gridRef.current;
                for (let i = 0; i < frame.patch.length; i += 2) {
                    grid[frame.patch[i]] = frame.patch[i + 1];
                }
                terrainDirty.current = true;

                // Une capture se voit : on fait partir une onde depuis le centre
                // des cases conquises. C'est le signal qui se lit du fond de la
                // salle, bien avant que le classement n'ait bougé.
                if (frame.patch.length >= 24) {
                    let sx = 0, sy = 0, n = 0, owner = 0;
                    for (let i = 0; i < frame.patch.length; i += 2) {
                        const key = frame.patch[i];
                        sx += key % cols;
                        sy += Math.floor(key / cols);
                        owner = frame.patch[i + 1] || owner;
                        n += 1;
                    }
                    const color = colorsRef.current.get(owner);
                    if (color && n > 0) {
                        effectsRef.current.push({
                            kind: 'capture', color,
                            gx: sx / n, gy: sy / n,
                            start: performance.now(), duration: 620,
                        });
                    }
                }
            }

            // Positions : on décale l'instantané courant vers le précédent, ce
            // qui donne les deux bornes entre lesquelles interpoler.
            const now = performance.now();
            const prev = prevRef.current;
            const curr = currRef.current;
            for (const [owner, body] of curr) prev.set(owner, body);

            const nextCurr = new Map();
            for (const p of frame.players) {
                colorsRef.current.set(p.i, p.c);
                if (p.f) shapesRef.current.set(p.i, p.f);

                // Passage vivant → mort : c'est là qu'on déclenche l'éclat, pas
                // à la réception d'un état déjà mort (sinon il se rejouerait).
                const was = curr.get(p.i);
                if (p.d && was && !was.d) {
                    effectsRef.current.push({
                        kind: 'death', color: p.c,
                        gx: p.x / frame.cell, gy: p.y / frame.cell,
                        start: now, duration: 420,
                    });
                }

                nextCurr.set(p.i, { x: p.x, y: p.y, a: p.a, d: p.d, p: p.p, at: now });

                // Traînées : `v` est la version. Si elle change, le tracé
                // précédent est caduc (mort ou capture) et on repart de zéro.
                // Un tableau, pas un ensemble : l'ordre de passage est ce qui
                // permet de tracer un chemin continu au lieu de cases isolées.
                let trail = trailsRef.current.get(p.i);
                if (!trail || trail.version !== p.v) {
                    trail = { version: p.v, cells: [] };
                    trailsRef.current.set(p.i, trail);
                }
                if (p.t?.length) trail.cells.push(...p.t);
            }
            currRef.current = nextCurr;

            // Les joueurs partis n'ont plus de traînée à afficher.
            for (const owner of [...trailsRef.current.keys()]) {
                if (!nextCurr.has(owner)) trailsRef.current.delete(owner);
            }

            setScores(frame.players.map((p) => ({
                owner: p.i, name: p.n, color: p.c, shape: p.f, score: p.s, dead: p.d,
            })));
            setRemaining(frame.remaining);

            if (frame.deaths?.length) {
                setFeed((old) => [
                    ...frame.deaths.map((d) => ({
                        id: `${d.at}-${d.name}`,
                        text: d.by ? `${d.by} élimine ${d.name}` : `${d.name} s'est raté`,
                    })),
                    ...old,
                ].slice(0, 5));
            }
        };

        const onRoundEnd = ({ stats }) => {
            if (stats?.bytesPerSec) {
                console.log(`[IO_ARENA] Bilan réseau: ${(stats.bytesPerSec / 1024).toFixed(1)} Ko/s, `
                    + `pire tick ${stats.worstTickMs} ms, ${stats.ticks} ticks`);
            }
        };

        const onDeleted = () => setError('La partie a été fermée.');

        const onConnect = () => {
            const saved = sessionStorage.getItem(ROOM_KEY);
            if (saved) {
                socket.emit('io-host-reconnect', { roomCode: saved }, (res) => {
                    if (res?.success) setState(res.state);
                });
            }
        };

        socket.on('io-state', onState);
        socket.on('io-frame', onFrame);
        socket.on('io-round-end', onRoundEnd);
        socket.on('io-room-deleted', onDeleted);
        socket.on('connect', onConnect);

        return () => {
            socket.off('io-state', onState);
            socket.off('io-frame', onFrame);
            socket.off('io-round-end', onRoundEnd);
            socket.off('io-room-deleted', onDeleted);
            socket.off('connect', onConnect);
        };
    }, []);

    // ── Rendu PixiJS ─────────────────────────────────────────────────────────
    //
    // Le rendu passe par le GPU : traînées en chemins continus, halos par filtre
    // de flou, particules. Le Canvas 2D dessinait case par case, d'où l'aspect
    // en escalier ; ici, une traînée est une polyligne avec jointures arrondies.
    // `stageEl` plutôt qu'une ref : au premier rendu, le composant affiche encore
    // l'écran de chargement et le conteneur n'existe pas. Une ref ne préviendrait
    // jamais de son arrivée, et le rendu ne démarrerait pas du tout.
    const [stageEl, setStageEl] = useState(null);

    useEffect(() => {
        const stage = stageEl;
        if (!stage) return undefined;

        let disposed = false;
        const arena = new IoArena();
        arenaRef.current = arena;

        arena.init(stage, {
            width: stage.clientWidth || 1280,
            height: stage.clientHeight || 720,
        }).then(() => {
            if (disposed) { arena.destroy(); return; }

            // Boucle d'affichage : la simulation vient du serveur, on ne fait
            // qu'interpoler entre deux instantanés pour lisser le mouvement.
            arena.app.ticker.add(() => {
                const grid = gridRef.current;
                const { cols, rows, cell } = dimsRef.current;
                if (!grid || !cols) return;

                arena.setWorld(cols, rows, cell);

                if (terrainDirty.current) {
                    arena.updateTerritories(grid, (o) => colorsRef.current.get(o));
                    terrainDirty.current = false;
                }

                const now = performance.now();
                const seen = new Set();
                for (const [owner, curr] of currRef.current) {
                    seen.add(owner);
                    const prev = prevRef.current.get(owner);
                    let x = curr.x;
                    let y = curr.y;
                    if (prev) {
                        const span = curr.at - prev.at;
                        // Extrapolation bornée : sans elle, le mouvement se fige
                        // entre deux instantanés et l'écran saccade à 10 Hz au
                        // lieu de couler à 60.
                        const t = span > 0 ? Math.min(2, (now - curr.at) / span + 1) : 1;
                        x = prev.x + (curr.x - prev.x) * t;
                        y = prev.y + (curr.y - prev.y) * t;
                    }
                    arena.updateHead(owner, x, y, {
                        color: colorsRef.current.get(owner) || '#ffffff',
                        shape: shapesRef.current.get(owner) || 'circle',
                        dead: curr.d,
                        shielded: curr.p,
                        isMe: false,
                    });

                    const trail = trailsRef.current.get(owner);
                    if (trail) {
                        arena.updateTrail(owner, trail.cells, trail.version,
                            colorsRef.current.get(owner) || '#ffffff');
                    }
                }

                // Les joueurs partis quittent la scène.
                for (const owner of [...arena.heads.keys()]) {
                    if (!seen.has(owner)) { arena.removeHead(owner); arena.removeTrail(owner); }
                }

                // Effets en attente, produits à la réception des instantanés.
                for (const e of effectsRef.current) {
                    if (e.kind === 'capture') arena.addShockwave(e.gx * cell, e.gy * cell, e.color);
                    else arena.addBurst(e.gx * cell, e.gy * cell, e.color);
                }
                effectsRef.current = [];

                arena.tickEffects();
                arena.fitWorld(arena.app.renderer.width, arena.app.renderer.height);
            });
        });

        // La zone disponible change (plein écran, projecteur branché en cours de
        // soirée) : on suit sans rechargement.
        const observer = new ResizeObserver(() => {
            if (!arena.ready) return;
            arena.resize(stage.clientWidth, stage.clientHeight);
        });
        observer.observe(stage);

        return () => {
            disposed = true;
            observer.disconnect();
            arena.destroy();
            arenaRef.current = null;
        };
    }, [stageEl]);


    const joinUrl = useMemo(
        () => (roomCode ? `${window.location.origin}/io/play/${roomCode}` : ''),
        [roomCode],
    );

    const start = () => socket.emit('io-start-round', { roomCode }, (res) => {
        if (res?.error) setError(res.error);
    });
    const stop = () => socket.emit('io-stop-round', { roomCode }, () => {});

    if (error) {
        return (
            <div className="ioa-root flex items-center justify-center p-6">
                <div className="ioa-panel p-8 text-center flex flex-col gap-4">
                    <p className="text-lg">{error}</p>
                    <button className="ioa-btn" onClick={() => { sessionStorage.removeItem(ROOM_KEY); window.location.reload(); }}>
                        Ouvrir un nouveau salon
                    </button>
                    <button className="ioa-btn" onClick={() => navigate('/')}>
                        <ArrowLeft className="w-4 h-4" /> Retour au menu
                    </button>
                </div>
            </div>
        );
    }

    if (!state) {
        return (
            <div className="ioa-root flex items-center justify-center">
                <Loader2 className="w-10 h-10 animate-spin" />
            </div>
        );
    }

    const playing = state.state === 'PLAYING';
    const seconds = remaining !== null ? Math.ceil(remaining / 1000) : null;

    return (
        <div className="ioa-root flex flex-col" style={{ height: '100dvh' }}>
            {/* En-tête : disparaît pendant la manche pour laisser toute la place au jeu. */}
            {!playing && (
                <header className="flex items-center justify-between gap-6 p-5">
                    <div>
                        <p className="ioa-eyebrow">IO Arena</p>
                        <h1 className="ioa-title">{state.mode?.name}</h1>
                        <p style={{ color: 'var(--ioa-muted)', maxWidth: 620 }}>{state.mode?.rule}</p>
                    </div>
                    <div className="flex items-center gap-5">
                        <div className="text-right">
                            <p className="ioa-eyebrow">Code</p>
                            <p style={{ fontSize: '2.6rem', fontWeight: 800, letterSpacing: '0.14em' }}>
                                {roomCode}
                            </p>
                            <p className="flex items-center gap-2 justify-end" style={{ color: 'var(--ioa-muted)' }}>
                                <Users className="w-4 h-4" /> {state.players.length} joueur(s)
                            </p>
                        </div>
                        {joinUrl && (
                            <div className="ioa-qr-frame">
                                <QRCodeSVG value={joinUrl} size={132} bgColor="#ffffff" fgColor="#05070d" level="M" />
                            </div>
                        )}
                    </div>
                </header>
            )}

            <main className="ioa-stage flex-1">
                {/* PixiJS s'attache ici et gère lui-même son canvas WebGL. */}
                <div className="ioa-pixi-stage" ref={setStageEl} />

                {playing && seconds !== null && (
                    <div className={`ioa-timer ioa-panel${seconds <= 10 ? ' ioa-timer-urgent' : ''}`}>
                        {String(Math.floor(seconds / 60)).padStart(2, '0')}
                        :
                        {String(seconds % 60).padStart(2, '0')}
                    </div>
                )}

                {playing && scores.length > 0 && (
                    <aside className="ioa-scoreboard ioa-panel">
                        <p className="ioa-eyebrow">Classement</p>
                        {scores.slice(0, 8).map((s) => (
                            <div key={s.owner} className="ioa-score-row" style={{ opacity: s.dead ? 0.45 : 1 }}>
                                {/* Même forme que sur le terrain : c'est elle qui
                                    identifie le joueur quand la couleur ne suffit pas. */}
                                <ShapeChip shape={s.shape} color={s.color} />
                                <span className="flex-1 truncate">{s.name}</span>
                                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{s.score}</span>
                            </div>
                        ))}
                    </aside>
                )}

                {playing && feed.length > 0 && (
                    <div className="ioa-feed">
                        {feed.map((f) => <div key={f.id} className="ioa-feed-item">{f.text}</div>)}
                    </div>
                )}

                {state.state === 'RESULT' && state.results && (
                    <div className="ioa-panel p-8 flex flex-col gap-3" style={{ position: 'absolute', minWidth: 420 }}>
                        <p className="ioa-eyebrow">Fin de manche</p>
                        {state.results.slice(0, 5).map((r, i) => (
                            <div key={r.playerId} className="ioa-score-row">
                                <span style={{ width: 28, opacity: 0.6 }}>{i + 1}</span>
                                <ShapeChip shape={r.shape} color={r.color} size={18} />
                                <span className="flex-1">{r.name}</span>
                                <span>{r.percent}%</span>
                            </div>
                        ))}
                    </div>
                )}
            </main>

            <footer className="flex items-center justify-center gap-4 p-5">
                {playing ? (
                    <button className="ioa-btn" onClick={stop}>
                        <Square className="w-5 h-5" /> Arrêter la manche
                    </button>
                ) : (
                    <button
                        className="ioa-btn ioa-btn-primary"
                        onClick={start}
                        disabled={state.players.length < (state.mode?.minPlayers || 1)}
                    >
                        <Play className="w-5 h-5" /> Lancer la manche
                    </button>
                )}
            </footer>
        </div>
    );
}

export default IoHostView;
