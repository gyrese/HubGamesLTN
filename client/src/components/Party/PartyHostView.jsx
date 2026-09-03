import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { Crown, Dices, Loader2, MapPin, Play, Swords, Trophy, Users } from 'lucide-react';
import { socket } from '../../socket';
import PartyMap from './PartyMap';
import MinigameCard from './MinigameCard';
import ReflexeHost from './minigames/ReflexeHost';
import CroquisHost from './minigames/CroquisHost';
import PhaseBar from './PhaseBar';
import { usePhaseTimer } from './usePhaseTimer';
import './PartyStyles.css';

const ROOM_KEY = 'party-host-room';

/**
 * Le grand écran. Tout y est calibré pour être lu depuis le fond de la salle :
 * la carte occupe la moitié gauche, les tables et la phase en cours la droite.
 */
function PartyHostView() {
    const navigate = useNavigate();
    const location = useLocation();

    const [roomCode, setRoomCode] = useState(null);
    const [state, setState] = useState(null);
    const [gallery, setGallery] = useState([]);
    const [error, setError] = useState('');
    const [toast, setToast] = useState('');

    useEffect(() => {
        document.body.classList.add('party-theme');
        return () => document.body.classList.remove('party-theme');
    }, []);

    // ─── Création / reprise du salon ─────────────────────────────────────────
    const createRoom = useCallback(() => {
        const settings = location.state?.settings || {};
        socket.emit('party-create-room', { settings }, (res) => {
            if (!res || res.error) { setError(res?.error || 'Création impossible'); return; }
            sessionStorage.setItem(ROOM_KEY, res.roomCode);
            setRoomCode(res.roomCode);
            setState(res.state);
        });
    }, [location.state]);

    useEffect(() => {
        const existing = sessionStorage.getItem(ROOM_KEY);
        if (existing) {
            socket.emit('party-host-reconnect', { roomCode: existing }, (res) => {
                if (res?.success) {
                    setRoomCode(existing);
                    setState(res.state);
                } else {
                    // Le salon a expiré côté serveur : on en ouvre un neuf.
                    sessionStorage.removeItem(ROOM_KEY);
                    createRoom();
                }
            });
        } else {
            createRoom();
        }
    }, [createRoom]);

    useEffect(() => {
        const onState = (snapshot) => setState(snapshot);
        const onGallery = ({ entries }) => setGallery(entries || []);
        const onError = ({ message }) => { setToast(message); setTimeout(() => setToast(''), 4000); };
        const onPulse = (payload) => {
            if (payload?.kind === 'captain-transfer') {
                setToast(`${payload.tableName} : ${payload.captainName} reprend le flambeau`);
                setTimeout(() => setToast(''), 5000);
            }
            // Vote des tables à égalité : le sort a tranché, l'écran doit le dire.
            if (payload?.kind === 'game-drawn') {
                setToast(`Égalité — le sort désigne : ${payload.name}`);
                setTimeout(() => setToast(''), 5000);
            }
            // Personne ne s'est dévoué : le sort a tranché, et ça mérite d'être dit.
            if (payload?.kind === 'champion-drawn' && payload.drawn?.length) {
                const drawn = payload.drawn
                    .map((d) => `${d.championName} (${d.tableName})`)
                    .join(' · ');
                setToast(`Tirage au sort : ${drawn}`);
                setTimeout(() => setToast(''), 5000);
            }
        };
        const onConnect = () => {
            const existing = sessionStorage.getItem(ROOM_KEY);
            if (existing) socket.emit('party-host-reconnect', { roomCode: existing }, () => {});
        };

        socket.on('party-state', onState);
        socket.on('party-gallery', onGallery);
        socket.on('party-error', onError);
        socket.on('party-pulse', onPulse);
        socket.on('connect', onConnect);

        return () => {
            socket.off('party-state', onState);
            socket.off('party-gallery', onGallery);
            socket.off('party-error', onError);
            socket.off('party-pulse', onPulse);
            socket.off('connect', onConnect);
        };
    }, []);

    useEffect(() => {
        if (state?.state === 'ROUND_INTRO') setGallery([]);
    }, [state?.state, state?.roundIndex]);

    const { seconds } = usePhaseTimer(state?.phaseRemainingMs, state?.phaseDuration);

    const joinUrl = useMemo(
        () => (roomCode ? `${window.location.origin}/party/play/${roomCode}` : ''),
        [roomCode],
    );

    const start = () => socket.emit('party-start-game', { roomCode });
    const discard = (pid) => socket.emit('party-discard-photo', { roomCode, pid }, () => {});

    if (error) {
        return (
            <div className="pty-root flex flex-col items-center justify-center gap-4 p-8">
                <p className="text-xl font-bold">{error}</p>
                <button type="button" className="pty-btn" onClick={() => navigate('/party')}>
                    Retour
                </button>
            </div>
        );
    }

    if (!state) {
        return (
            <div className="pty-root flex items-center justify-center">
                <Loader2 className="w-10 h-10 animate-spin" />
            </div>
        );
    }

    const playableTables = state.tables.filter((t) => !t.frozen);

    return (
        <div className="pty-root flex flex-col" style={{ height: '100dvh' }}>
            {/* ─── Bandeau ─────────────────────────────────────────────────── */}
            <header className="flex items-center justify-between px-8 py-4 border-b" style={{ borderColor: 'var(--pty-border)' }}>
                <div>
                    <h1 className="pty-title text-3xl">Super LTN Party</h1>
                    <p className="pty-eyebrow mt-1">Les Toiles Noires</p>
                </div>

                {state.state !== 'LOBBY' && state.state !== 'FINAL' && (
                    <div className="flex flex-col items-center gap-2 flex-1 max-w-md mx-8">
                        <div className="flex justify-between w-full text-sm" style={{ color: 'var(--pty-muted)' }}>
                            <span>Manche {state.roundIndex} / {state.totalRounds}</span>
                            <span>{seconds}s</span>
                        </div>
                        <PhaseBar remainingMs={state.phaseRemainingMs} duration={state.phaseDuration} />
                    </div>
                )}

                <div className="text-right">
                    <p className="pty-eyebrow">Code</p>
                    <p className="pty-title text-4xl" style={{ color: 'var(--pty-accent)' }}>{roomCode}</p>
                </div>
            </header>

            {toast && (
                <div
                    className="pty-panel px-5 py-3 mx-8 mt-3 text-center font-bold"
                    style={{ color: 'var(--pty-accent)' }}
                >
                    {toast}
                </div>
            )}

            {/* ─── Corps ───────────────────────────────────────────────────── */}
            <div className="flex-1 flex gap-6 px-8 py-5 min-h-0">
                {/* L'épreuve et le vote qui la choisit occupent le grand écran ;
                    le reste du temps, la carte raconte la partie. */}
                <section className="pty-panel flex-1 p-5 min-h-0 flex flex-col">
                    {state.state === 'MINIGAME' ? renderMinigame() : state.state === 'GAME_VOTE' ? renderGameVote() : (
                        <PartyMap
                            zones={state.zones}
                            viewBox={state.viewBox}
                            tables={state.tables}
                            contestedZoneId={state.contestedZoneId}
                            justCapturedZoneId={
                                state.state === 'ROUND_RESULT' && state.roundResult?.winnerTableId
                                    ? state.roundResult.zoneId
                                    : null
                            }
                        />
                    )}
                </section>

                <aside className="flex flex-col gap-4" style={{ width: 'clamp(340px, 30vw, 460px)' }}>
                    <div className="pty-panel p-5 flex-1 min-h-0 flex flex-col gap-3 pty-scroll">
                        <p className="pty-eyebrow">
                            {state.tables.length} table{state.tables.length > 1 ? 's' : ''} en lice
                        </p>
                        {state.tables.map((table, index) => (
                            <div
                                key={table.id}
                                className={`pty-table-row ${index === 0 && table.score > 0 ? 'pty-table-row-leader' : ''} ${table.frozen ? 'pty-table-row-frozen' : ''}`}
                                style={{ borderLeftColor: table.color }}
                            >
                                <span className="pty-dot" style={{ background: table.color }} />
                                <div className="flex-1 min-w-0">
                                    <p className="font-black truncate">{table.name}</p>
                                    <p className="text-xs" style={{ color: 'var(--pty-muted)' }}>
                                        {table.captainName}
                                        {table.championName && ` · ${table.championName}`}
                                        {table.frozen ? ' · hors course' : table.absent ? ' · reconnexion…' : ''}
                                    </p>
                                </div>
                                <span className="pty-title text-2xl">{table.score}</span>
                            </div>
                        ))}
                        {state.tables.length === 0 && (
                            <p className="text-sm" style={{ color: 'var(--pty-muted)' }}>
                                Aucune table pour l'instant.
                            </p>
                        )}
                    </div>

                    <div className="pty-panel p-5 flex flex-col gap-3" style={{ minHeight: 220 }}>
                        {renderSidePanel()}
                    </div>
                </aside>
            </div>
        </div>
    );

    /** Le vote occupe tout l'écran : c'est le moment où le bar décide. */
    function renderGameVote() {
        return (
            <div className="flex flex-col gap-5 flex-1 min-h-0 justify-center">
                <div className="text-center">
                    <p className="pty-eyebrow">Manche {state.roundIndex} · Chaque table vote</p>
                    <p className="pty-title mt-2" style={{ fontSize: 'clamp(1.8rem, 4vw, 3rem)' }}>
                        Quelle épreuve pour {state.contestedZone?.name} ?
                    </p>
                </div>
                <div className="pty-game-grid pty-stagger">
                    {state.candidates.map((game) => (
                        <MinigameCard key={game.id} game={game} votes={game.votes} />
                    ))}
                </div>
            </div>
        );
    }

    function renderMinigame() {
        if (state.minigame?.id === 'reflexe') return <ReflexeHost />;
        if (state.minigame?.id === 'croquis') {
            return (
                <CroquisHost
                    phase={state.minigamePhase}
                    theme={state.minigame?.theme}
                    remainingMs={state.phaseRemainingMs}
                    duration={state.phaseDuration}
                    gallery={gallery}
                    onDiscard={discard}
                    tables={state.tables}
                    votedCount={state.tables.filter((t) => t.hasVoted).length}
                />
            );
        }
        return null;
    }

    function renderSidePanel() {
        switch (state.state) {
            case 'LOBBY':
                return (
                    <div className="flex flex-col items-center gap-4">
                        <p className="pty-eyebrow text-center">
                            Un seul téléphone par table : la première personne qui scanne devient capitaine
                        </p>
                        <div className="pty-qr-frame">
                            <QRCodeSVG value={joinUrl} size={150} bgColor="#ffffff" fgColor="#17203a" />
                        </div>
                        <button
                            type="button"
                            className="pty-btn pty-btn-primary w-full"
                            onClick={start}
                            disabled={playableTables.length < 2}
                        >
                            <Play className="w-5 h-5" />
                            {playableTables.length < 2 ? 'Il faut deux tables' : 'Lancer la partie'}
                        </button>
                        <p className="text-xs text-center" style={{ color: 'var(--pty-muted)' }}>
                            {state.totalRounds} manches · {state.families.join(' · ')}
                        </p>
                        {state.materials.length > 0 && (
                            <div className="text-xs text-center" style={{ color: 'var(--pty-muted)' }}>
                                <p className="font-bold mb-1">À prévoir sur les tables</p>
                                {state.materials.map((item) => <p key={item}>{item}</p>)}
                            </div>
                        )}
                    </div>
                );

            case 'ROUND_INTRO':
                return (
                    <div className="flex flex-col items-center justify-center gap-3 text-center flex-1">
                        <MapPin className="w-8 h-8" style={{ color: 'var(--pty-accent)' }} />
                        <p className="pty-eyebrow">Zone mise en jeu</p>
                        <p className="pty-title text-3xl">{state.contestedZone?.name}</p>
                        <p className="text-sm" style={{ color: 'var(--pty-muted)' }}>
                            {state.contestedZone?.value} point{state.contestedZone?.value > 1 ? 's' : ''}
                        </p>
                    </div>
                );

            case 'GAME_VOTE': {
                const cast = Object.keys(state.gameVotes || {}).length;
                return (
                    <div className="flex flex-col items-center justify-center gap-3 text-center flex-1">
                        <Dices className="w-8 h-8" style={{ color: 'var(--pty-accent)' }} />
                        <p className="pty-eyebrow">Vote des tables</p>
                        <p className="pty-title text-2xl">
                            {cast} / {playableTables.length} ont choisi
                        </p>
                        <p className="text-sm" style={{ color: 'var(--pty-muted)' }}>
                            À égalité, le sort tranche
                        </p>
                    </div>
                );
            }

            case 'CHAMPION_PICK':
                return (
                    <div className="flex flex-col items-center justify-center gap-3 text-center flex-1">
                        <Crown className="w-8 h-8" style={{ color: 'var(--pty-accent)' }} />
                        <p className="pty-eyebrow">{state.discipline}</p>
                        <p className="pty-title text-3xl">{state.minigame?.name}</p>
                        <p className="text-sm" style={{ color: 'var(--pty-muted)' }}>
                            Chaque capitaine désigne son champion
                        </p>
                        <p className="text-sm font-bold">
                            {state.tables.filter((t) => t.championName).length} / {playableTables.length} prêtes
                        </p>
                    </div>
                );

            case 'ENROL':
                return (
                    <div className="flex flex-col items-center justify-center gap-3 text-center flex-1">
                        <Users className="w-8 h-8" style={{ color: 'var(--pty-accent)' }} />
                        <p className="pty-title text-2xl">Épreuve à plusieurs</p>
                        <p className="text-sm" style={{ color: 'var(--pty-muted)' }}>
                            Les capitaines font scanner leur QR à leurs coéquipiers
                        </p>
                        <p className="text-sm font-bold">
                            {state.tables.reduce((sum, t) => sum + t.enrolledCount, 0)} téléphones en jeu
                        </p>
                    </div>
                );

            case 'REVEAL':
                return (
                    <div className="flex flex-col items-center justify-center gap-2 text-center flex-1">
                        <p className="pty-eyebrow">L'épreuve</p>
                        <p className="pty-title text-3xl">{state.minigame?.name}</p>
                        <p className="text-sm mt-2" style={{ color: 'var(--pty-muted)' }}>
                            {state.minigame?.rule}
                        </p>
                    </div>
                );

            case 'MINIGAME':
                return (
                    <div className="flex flex-col gap-2 flex-1">
                        <p className="pty-eyebrow text-center">{state.minigame?.name}</p>
                        <div className="flex flex-col gap-1 flex-1 justify-center">
                            {state.tables.filter((t) => !t.frozen).map((table) => (
                                <div key={table.id} className="flex items-center gap-2 text-sm">
                                    <span className="pty-dot" style={{ background: table.color }} />
                                    <span className="flex-1 truncate">{table.name}</span>
                                    <span style={{ color: 'var(--pty-muted)' }}>
                                        {state.minigame?.scope === 'champion'
                                            ? (table.championName || '—')
                                            : `${table.enrolledCount} joueur(s)`}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                );

            case 'ROUND_RESULT': {
                const result = state.roundResult;
                const winner = state.tables.find((t) => t.id === result?.winnerTableId);
                return (
                    <div className="flex flex-col items-center justify-center gap-2 text-center flex-1">
                        <Swords className="w-8 h-8" style={{ color: 'var(--pty-accent)' }} />
                        {winner ? (
                            <>
                                <p className="pty-title text-2xl" style={{ color: winner.color }}>
                                    {winner.name}
                                </p>
                                <p className="text-sm">
                                    {result.stolen ? 'reprend' : 'conquiert'} {result.zoneName}
                                </p>
                                {result.tiebreak && (
                                    <p className="pty-badge">
                                        {result.tiebreak === 'holder'
                                            ? 'Égalité : la table tenante conserve'
                                            : 'Égalité : copie rendue la première'}
                                    </p>
                                )}
                            </>
                        ) : (
                            <p className="pty-title text-xl">{result?.zoneName} reste en l'état</p>
                        )}
                        <div className="flex flex-col gap-1 w-full mt-3">
                            {result?.ranking.map((row, index) => {
                                const table = state.tables.find((t) => t.id === row.tableId);
                                return (
                                    <div key={row.tableId} className="flex items-center gap-2 text-sm">
                                        <span className="pty-dot" style={{ background: table?.color }} />
                                        <span className="flex-1 text-left truncate">{index + 1}. {table?.name}</span>
                                        <span style={{ color: 'var(--pty-muted)' }}>{row.detail}</span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                );
            }

            case 'FINAL': {
                const podium = state.finalResult?.podium || [];
                return (
                    <div className="flex flex-col gap-3 flex-1 pty-scroll">
                        <div className="text-center">
                            <Trophy className="w-10 h-10 mx-auto" style={{ color: 'var(--pty-accent)' }} />
                            <p className="pty-title text-2xl mt-2">
                                {podium[0] ? podium[0].name : '—'}
                            </p>
                            <p className="text-sm" style={{ color: 'var(--pty-muted)' }}>
                                remporte la soirée
                            </p>
                        </div>
                        <div className="pty-stagger flex flex-col gap-2">
                            {podium.map((table, index) => (
                                <div key={table.id} className="pty-table-row" style={{ borderLeftColor: table.color }}>
                                    <span className="pty-title text-xl w-6">{index + 1}</span>
                                    <div className="flex-1 min-w-0">
                                        <p className="font-black truncate">{table.name}</p>
                                        {table.bestChampion && (
                                            <p className="text-xs" style={{ color: 'var(--pty-muted)' }}>
                                                {table.bestChampion.name} · {table.bestChampion.wins} victoire(s)
                                            </p>
                                        )}
                                    </div>
                                    <span className="pty-title text-2xl">{table.score}</span>
                                </div>
                            ))}
                        </div>
                        <button
                            type="button"
                            className="pty-btn w-full"
                            onClick={() => { sessionStorage.removeItem(ROOM_KEY); window.location.reload(); }}
                        >
                            Nouvelle partie
                        </button>
                    </div>
                );
            }

            default:
                return null;
        }
    }
}

export default PartyHostView;
