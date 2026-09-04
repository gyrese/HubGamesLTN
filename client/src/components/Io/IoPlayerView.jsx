import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { socket } from '../../socket';
import { IoArena } from './pixiArena';
import './IoStyles.css';

const SESSION_KEY = 'io-session';

// Cadence d'envoi des intentions. 15 Hz suffit : au-delà, on paie du réseau
// pour une précision que le pouce ne produit pas. Le serveur simule à 20 Hz et
// conserve le dernier cap reçu entre deux messages.
const INPUT_HZ = 15;

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
 * IO_ARENA — le téléphone.
 *
 * Chaque joueur voit **sa portion de terrain**, caméra centrée sur lui, comme
 * dans un vrai .io : sur une grande carte, personne ne voit tout. Le grand écran
 * garde la vue d'ensemble pour la salle.
 *
 * Le serveur n'envoie à chaque téléphone qu'une fenêtre d'une vingtaine de cases
 * (`io-view`), pas la carte entière : le coût réseau reste borné quelle que soit
 * la taille du terrain, et on ne révèle pas la position de joueurs hors de portée.
 */
function IoPlayerView() {
    const { roomCode: urlRoomCode } = useParams();
    const saved = readSession();

    const [typedCode, setTypedCode] = useState('');
    const roomCode = urlRoomCode || typedCode;
    const [name, setName] = useState(saved?.pseudo || '');
    const [joined, setJoined] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [state, setState] = useState(null);

    const padRef = useRef(null);
    const [stick, setStick] = useState(null);   // position du pouce, en pixels
    const angleRef = useRef(null);              // dernier cap voulu
    const sentRef = useRef(null);               // dernier cap réellement envoyé
    const joinedRef = useRef(false);

    // Vue rapprochée : la fenêtre de terrain autour de soi, reçue 10 fois par
    // seconde. Dans une ref, car elle ne doit jamais déclencher de rendu React.
    const [stageEl, setStageEl] = useState(null);
    const arenaRef = useRef(null);
    const viewRef = useRef(null);
    const prevViewRef = useRef(null);
    const lastRawRef = useRef(null);       // empreinte de la grille déjà dessinée
    const [percent, setPercent] = useState(0);
    const [dead, setDead] = useState(false);
    const [hud, setHud] = useState({ top: [], seconds: null, minimap: null });

    useEffect(() => { joinedRef.current = joined; }, [joined]);

    useEffect(() => {
        document.body.classList.add('io-theme');
        return () => document.body.classList.remove('io-theme');
    }, []);

    const join = useCallback((playerName, silent = false) => {
        if (!roomCode) { setError('Entrez un code de salon'); return; }
        if (!silent) setBusy(true);
        socket.emit('io-join-room', { roomCode, playerName }, (res) => {
            setBusy(false);
            if (!res || res.error) {
                if (!silent) setError(res?.error || 'Connexion impossible');
                return;
            }
            writeSession({ roomCode, pseudo: playerName });
            setJoined(true);
            setState(res.state);
            setError('');
        });
    }, [roomCode]);

    // Reprise de session : même pattern que les autres jeux du hub — on rejoint
    // par pseudo, silencieusement, dès que le socket revient.
    useEffect(() => {
        const session = readSession();
        const mismatch = session && urlRoomCode && session.roomCode !== urlRoomCode;
        if (session?.roomCode && session?.pseudo && !mismatch) {
            const rejoin = () => join(session.pseudo, true);
            if (socket.connected) rejoin();
            else socket.once('connect', rejoin);
        }

        const onConnect = () => {
            if (!joinedRef.current) return;
            const s = readSession();
            if (s?.roomCode && s?.pseudo) join(s.pseudo, true);
        };
        const onState = (snapshot) => setState(snapshot);
        const onDeleted = () => { setError('La partie a été fermée.'); setJoined(false); };

        // Sa propre fenêtre de terrain : ce que ce joueur voit autour de lui.
        const onView = (view) => {
            prevViewRef.current = viewRef.current;
            view.at = performance.now();

            // Les traînées se décodent ici, une fois par paquet (10 Hz), et non
            // à chaque image (60 Hz) : c'est du travail identique répété six fois
            // pour rien. Elles arrivent en coordonnées monde, donc stables quel
            // que soit le cadrage — c'est ce qui empêche la courbe d'onduler.
            for (const pl of view.players) {
                if (!pl.t) { pl.cells = null; continue; }
                const parts = pl.t.split('.');
                const cells = new Array(parts.length);
                cells[0] = Number(parts[0]);
                for (let k = 1; k < parts.length; k += 1) cells[k] = cells[k - 1] + Number(parts[k]);
                pl.cells = cells;
            }
            // Index par identifiant : évite un `.find()` par joueur et par image.
            view.byId = new Map(view.players.map((pl) => [pl.i, pl]));
            // Empreinte de la grille : sert à ne la redessiner que si elle a
            // vraiment changé, plutôt qu'à chaque image.
            view.raw = `${view.x0},${view.y0},${view.cells.length},${view.cells.slice(0, 40)}`;
            viewRef.current = view;
            // Le pourcentage du terrain reste sous 1 % pendant toute la
            // première moitié de la manche : il ne bouge jamais à l'œil et
            // n'encourage personne. Le nombre de cases, lui, progresse
            // visiblement à chaque capture.
            setPercent(view.score || 0);
            setDead(!view.alive);
            // Classement et mini-carte n'arrivent que deux fois par seconde :
            // entre deux envois, on garde ce qu'on avait plutôt que de faire
            // clignoter le HUD.
            setHud((prev) => ({
                top: view.top ?? prev.top,
                radar: view.radar ?? prev.radar,
                seconds: view.remaining != null ? Math.ceil(view.remaining / 1000) : prev.seconds,
            }));
        };

        socket.on('connect', onConnect);
        socket.on('io-state', onState);
        socket.on('io-view', onView);
        socket.on('io-room-deleted', onDeleted);
        return () => {
            socket.off('connect', onConnect);
            socket.off('io-state', onState);
            socket.off('io-view', onView);
            socket.off('io-room-deleted', onDeleted);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [join]);

    // ── Envoi du cap ─────────────────────────────────────────────────────────
    //
    // On n'émet que si le cap a changé, et au plus INPUT_HZ fois par seconde :
    // envoyer le même angle vingt fois d'affilée ne rendrait pas le jeu plus
    // précis, seulement plus coûteux pour le wifi de la salle.
    useEffect(() => {
        if (!joined || state?.state !== 'PLAYING') return undefined;
        const interval = setInterval(() => {
            const angle = angleRef.current;
            if (angle === null || angle === sentRef.current) return;
            sentRef.current = angle;
            socket.emit('io-input', { roomCode, angle });
        }, 1000 / INPUT_HZ);
        return () => clearInterval(interval);
    }, [joined, state?.state, roomCode]);

    // ── Rendu PixiJS de la vue rapprochée ────────────────────────────────────
    //
    // Le téléphone affiche sa portion de terrain, caméra centrée sur le joueur.
    // Même moteur que le grand écran, seul le cadrage diffère : le zoom est
    // calculé pour qu'une fenêtre de 27 cases remplisse la largeur de l'écran.
    useEffect(() => {
        if (!stageEl) return undefined;

        let disposed = false;
        const arena = new IoArena();
        arenaRef.current = arena;

        arena.init(stageEl, {
            width: stageEl.clientWidth || 390,
            height: stageEl.clientHeight || 780,
            // Halo légèrement réduit : sur un écran de téléphone, la scène est
            // vue de près, un flou trop large noierait les détails. Mesuré à
            // 60 fps stables avec cette valeur sur un GPU réel.
            glow: 14,
        }).then(() => {
            if (disposed) { arena.destroy(); return; }

            arena.app.ticker.add(() => {
                const view = viewRef.current;
                if (!view) return;

                // La scène affiche une fenêtre, mais la bordure mortelle doit
                // se tracer sur les limites réelles du terrain.
                arena.setWorld(view.w, view.h, view.cell, view.cols, view.rows, view.x0, view.y0);

                if (view.raw !== lastRawRef.current) {
                    lastRawRef.current = view.raw;
                    const grid = new Uint8Array(view.w * view.h);
                    const runs = view.cells.split(',');
                    let at = 0;
                    for (let i = 0; i < runs.length; i += 2) {
                        const value = Number(runs[i]);
                        const len = Number(runs[i + 1]);
                        if (value !== 0) grid.fill(value, at, at + len);
                        at += len;
                    }
                    const colorOf = (o) => view.byId.get(o)?.c || '#3b82f6';
                    arena.updateTerritories(grid, colorOf);
                }

                // Joueurs visibles, interpolés entre deux instantanés.
                const prev = prevViewRef.current;
                const now = performance.now();
                const seen = new Set();
                let meX = 0;
                let meY = 0;

                for (const p of view.players) {
                    seen.add(p.i);
                    let wx = p.x;
                    let wy = p.y;
                    const before = prev?.byId?.get(p.i);
                    if (before) {
                        const span = view.at - prev.at;
                        // On **extrapole** au lieu de s'arrêter au dernier
                        // instantané reçu : le serveur en envoie dix par seconde,
                        // l'écran en affiche soixante. Se figer entre deux
                        // paquets donnait exactement les à-coups constatés. On
                        // borne à 2 pour qu'un paquet perdu ne projette pas le
                        // point à l'autre bout de la carte.
                        const t = span > 0
                            ? Math.min(2, (now - view.at) / span + 1)
                            : 1;
                        wx = before.x + (p.x - before.x) * t;
                        wy = before.y + (p.y - before.y) * t;
                    }
                    // Coordonnées relatives à la fenêtre. `wx` et `wy` sont
                    // absolus (terrain), l'origine de la fenêtre les ramène dans
                    // le repère de la scène.
                    const lx = wx - view.x0 * view.cell;
                    const ly = wy - view.y0 * view.cell;
                    if (p.me) { meX = lx; meY = ly; }

                    arena.updateHead(p.i, lx, ly, {
                        color: p.c,
                        shape: p.f || 'circle',
                        dead: p.d,
                        shielded: p.p,
                        isMe: Boolean(p.me),
                    });

                    // La traînée : elle dit où l'on est passé et ce qui tue.
                    // La version est la chaîne brute — elle identifie le CONTENU,
                    // jamais le cadrage : inclure x0/y0 forçait un relissage à
                    // chaque pas de caméra, et Douglas-Peucker ne rendant pas la
                    // même courbe selon le point d'arrivée, le tracé ondulait.
                    if (p.cells) {
                        arena.updateTrail(p.i, p.cells, p.t, p.c, view.cols, view.x0, view.y0);
                    } else {
                        arena.removeTrail(p.i);
                    }
                }
                for (const owner of [...arena.heads.keys()]) {
                    if (!seen.has(owner)) { arena.removeHead(owner); arena.removeTrail(owner); }
                }

                // Caméra centrée sur soi. Le zoom doit couvrir la plus grande
                // des deux dimensions : cadrer sur la largeur seule laissait la
                // moitié haute de l'écran vide sur un téléphone, qui est bien
                // plus haut que large.
                const vw = arena.app.renderer.width;
                const vh = arena.app.renderer.height;
                const zoom = Math.max(vw / (view.w * view.cell), vh / (view.h * view.cell));

                // La caméra suit simplement la position du joueur dans la
                // fenêtre. Aucun lissage supplémentaire : la position est déjà
                // interpolée image par image, et corriger en plus le décalage de
                // fenêtre faisait osciller toute l'image à chaque paquet reçu —
                // c'est ce qui rendait le jeu saccadé.
                arena.setCamera(meX, meY, zoom, vw, vh);
                arena.tickEffects();
            });
        });

        const observer = new ResizeObserver(() => {
            if (!arena.ready) return;
            arena.resize(stageEl.clientWidth, stageEl.clientHeight);
        });
        observer.observe(stageEl);

        return () => {
            disposed = true;
            observer.disconnect();
            arena.destroy();
            arenaRef.current = null;
        };
    }, [stageEl]);


    // ── Joystick ─────────────────────────────────────────────────────────────
    // Le joystick n'a pas de position fixe : il naît là où le pouce se pose.
    // Sur un jeu de mouvement, chercher un pad fixe des yeux coûte une seconde
    // d'attention qu'on n'a pas — surtout quand on regarde la carte.
    const originRef = useRef(null);

    const updateStick = useCallback((clientX, clientY) => {
        const origin = originRef.current;
        if (!origin) return;
        const dx = clientX - origin.x;
        const dy = clientY - origin.y;
        const dist = Math.hypot(dx, dy);

        // Zone morte : un appui pile au centre n'a pas de direction lisible.
        if (dist < 10) return;

        angleRef.current = Math.atan2(dy, dx);
        const clamped = Math.min(dist, 54);
        setStick({
            x: origin.x + Math.cos(angleRef.current) * clamped,
            y: origin.y + Math.sin(angleRef.current) * clamped,
        });
    }, []);

    const onPointerDown = (e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        originRef.current = { x: e.clientX, y: e.clientY };
        updateStick(e.clientX, e.clientY);
        if (navigator.vibrate) navigator.vibrate(8);
    };
    const onPointerMove = (e) => {
        if (e.buttons === 0 && e.pointerType === 'mouse') return;
        updateStick(e.clientX, e.clientY);
    };
    // Au relâchement, le cap est conservé : on continue tout droit, comme dans
    // tous les .io. Relâcher n'est pas freiner.
    const onPointerUp = () => setStick(null);

    // ── Écran de connexion ───────────────────────────────────────────────────
    if (!joined) {
        return (
            <div className="ioa-root flex items-center justify-center p-6">
                <div className="ioa-panel p-6 flex flex-col gap-4" style={{ width: 'min(92vw, 400px)' }}>
                    <div>
                        <p className="ioa-eyebrow">IO Arena</p>
                        <h1 className="ioa-title" style={{ fontSize: '2rem' }}>Rejoindre</h1>
                    </div>

                    {!urlRoomCode && (
                        <input
                            className="ioa-input"
                            style={{ textAlign: 'center', letterSpacing: '0.3em', fontSize: '1.5rem' }}
                            value={typedCode}
                            onChange={(e) => setTypedCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                            placeholder="CODE"
                            inputMode="numeric"
                            maxLength={6}
                        />
                    )}

                    <input
                        className="ioa-input"
                        value={name}
                        onChange={(e) => setName(e.target.value.slice(0, 20))}
                        onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) join(name.trim()); }}
                        placeholder="Ton pseudo"
                    />

                    {error && <p style={{ color: '#f87171' }}>{error}</p>}

                    <button
                        className="ioa-btn ioa-btn-primary w-full"
                        disabled={busy || !name.trim() || !roomCode}
                        onClick={() => join(name.trim())}
                    >
                        {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Entrer dans l\'arène'}
                    </button>
                </div>
            </div>
        );
    }

    // ── En jeu : vue rapprochée + manette ────────────────────────────────────
    const playing = state?.state === 'PLAYING';

    if (playing) {
        const mm = 74;   // côté de la mini-carte, en pixels
        return (
            <div
                className="ioa-root ioa-play-root"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
            >
                {/* La carte, centrée sur soi. Le doigt dirige depuis n'importe
                    où : viser un joystick fixe coûte une seconde d'attention
                    qu'on n'a pas dans un jeu de mouvement. */}
                <div className="ioa-play-stage" ref={setStageEl} />

                <div className="ioa-play-hud">
                    <div className="ioa-play-hud-left">
                        <span className="ioa-play-name">{name}</span>
                        <span className="ioa-play-score">{percent}</span>
                        <span className="ioa-play-unit">cases</span>
                    </div>

                    {hud.seconds != null && (
                        <span className={`ioa-play-timer${hud.seconds <= 10 ? ' ioa-play-timer-urgent' : ''}`}>
                            {String(Math.floor(hud.seconds / 60)).padStart(2, '0')}:
                            {String(hud.seconds % 60).padStart(2, '0')}
                        </span>
                    )}
                </div>

                {/* Classement : se situer sans lever les yeux vers l'écran. */}
                {hud.top?.length > 0 && (
                    <ol className="ioa-play-top">
                        {hud.top.map((t, i) => (
                            <li key={`${t.n}-${i}`}>
                                <span className="ioa-play-dot" style={{ background: t.c }} />
                                <span className="ioa-play-top-name">{t.n}</span>
                                <span className="ioa-play-top-score">{t.s}</span>
                            </li>
                        ))}
                    </ol>
                )}

                {/* Mini-carte : sur une grande carte, c'est le seul moyen de
                    savoir où sont les autres et où il reste du terrain. */}
                {hud.radar?.length > 0 && (
                    <div className="ioa-play-minimap" style={{ width: mm, height: mm }}>
                        {hud.radar.map((r, i) => (
                            <span
                                key={i}
                                className={`ioa-play-blip${r.me ? ' ioa-play-blip-me' : ''}`}
                                style={{ background: r.c, left: `${r.x}%`, top: `${r.y}%` }}
                            />
                        ))}
                    </div>
                )}

                {stick && (
                    <div className="ioa-play-stick" style={{ left: stick.x, top: stick.y }} />
                )}

                {dead && (
                    <div className="ioa-play-dead">
                        <span>Éliminé</span>
                        <small>retour dans un instant</small>
                    </div>
                )}
            </div>
        );
    }

    // ── Hors manche : salle d'attente ────────────────────────────────────────
    return (
        <div className="ioa-root flex flex-col items-center justify-center gap-6 p-5" style={{ minHeight: '100dvh' }}>
            <div className="ioa-panel ioa-player-status">
                <div>
                    <p className="ioa-eyebrow">{state?.mode?.name || 'IO Arena'}</p>
                    <p style={{ fontSize: '1.3rem', fontWeight: 700 }}>{name}</p>
                </div>
                <p style={{ color: 'var(--ioa-muted)', textAlign: 'right', fontSize: '0.9rem' }}>
                    En attente de l'hôte
                </p>
            </div>

            <div className="ioa-pad">
                <div className="ioa-pad-hint">La manche va commencer</div>
            </div>

            <p style={{ color: 'var(--ioa-muted)', fontSize: '0.85rem', textAlign: 'center', maxWidth: 320 }}>
                {state?.mode?.rule}
            </p>
        </div>
    );
}

export default IoPlayerView;
