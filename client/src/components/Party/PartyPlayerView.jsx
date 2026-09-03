import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Crown, Dices, Loader2, MapPin, QrCode, Swords, Trophy, Users } from 'lucide-react';
import { socket } from '../../socket';
import TableDashboard from './TableDashboard';
import MinigameCard from './MinigameCard';
import ReflexePlayer from './minigames/ReflexePlayer';
import CroquisPlayer from './minigames/CroquisPlayer';
import PhaseBar from './PhaseBar';
import { usePhaseTimer } from './usePhaseTimer';
import './PartyStyles.css';

const NAME_KEY = 'party-player-name';

/**
 * Le téléphone. Une table n'en connecte qu'**un seul**, celui du capitaine :
 * tableau de bord, chrono, désignation du champion, photo et vote passent par lui.
 * Les coéquipiers n'apparaissent que le temps d'une épreuve à plusieurs, après
 * avoir scanné son QR, et sont relâchés à la fin de la manche.
 */
function PartyPlayerView() {
    const { roomCode: urlRoomCode } = useParams();
    const [searchParams] = useSearchParams();

    // On peut arriver sans code (bouton « rejoindre » du menu) : on le demande.
    const [typedCode, setTypedCode] = useState('');
    const roomCode = urlRoomCode || typedCode;

    // Arrivée par QR : le rattachement est porté par l'URL scannée.
    const scannedTable = searchParams.get('t');
    const scannedToken = searchParams.get('tk');

    const [name, setName] = useState(() => sessionStorage.getItem(NAME_KEY) || '');
    const [joined, setJoined] = useState(false);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    const [state, setState] = useState(null);
    const [myId, setMyId] = useState(socket.id);
    const [token, setToken] = useState(null);
    const [tableName, setTableName] = useState('');

    const [gallery, setGallery] = useState([]);
    const [chosenPid, setChosenPid] = useState(null);
    const [photoSubmitted, setPhotoSubmitted] = useState(false);
    const [notice, setNotice] = useState('');
    const [customChampion, setCustomChampion] = useState('');

    useEffect(() => {
        document.body.classList.add('party-theme');
        return () => document.body.classList.remove('party-theme');
    }, []);

    // ─── Connexion ───────────────────────────────────────────────────────────
    const join = useCallback((playerName) => {
        setBusy(true);
        setError('');
        socket.emit('party-join-room', {
            roomCode,
            playerName,
            tableId: scannedTable || undefined,
            token: scannedToken || undefined,
        }, (res) => {
            setBusy(false);
            if (!res || res.error) {
                setError(res?.error || 'Connexion impossible');
                return;
            }
            sessionStorage.setItem(NAME_KEY, playerName);
            setJoined(true);
            setMyId(res.playerId);
            setToken(res.token || null);
            setState(res.state);
            if (res.joinError) setError(res.joinError);
        });
    }, [roomCode, scannedTable, scannedToken]);

    useEffect(() => {
        const onState = (snapshot) => setState(snapshot);
        const onGallery = ({ entries }) => setGallery(entries || []);
        const onToken = ({ token: fresh }) => {
            // Le capitaine n'est pas revenu : c'est nous qui reprenons le flambeau.
            setToken(fresh);
            setNotice('Vous êtes désormais capitaine de la table.');
        };
        const onPulse = (payload) => {
            if (payload?.kind === 'captain-transfer') {
                setNotice(`${payload.captainName} reprend la tête de ${payload.tableName}.`);
            }
        };
        const onDeleted = () => setError('La partie a été fermée par l\'hôte.');
        const onConnect = () => {
            setMyId(socket.id);
            // Reconnexion : on retrouve sa place par pseudo, sans rien perdre.
            const saved = sessionStorage.getItem(NAME_KEY);
            if (saved && joined) join(saved);
        };

        socket.on('party-state', onState);
        socket.on('party-gallery', onGallery);
        socket.on('party-captain-token', onToken);
        socket.on('party-pulse', onPulse);
        socket.on('party-room-deleted', onDeleted);
        socket.on('connect', onConnect);

        return () => {
            socket.off('party-state', onState);
            socket.off('party-gallery', onGallery);
            socket.off('party-captain-token', onToken);
            socket.off('party-pulse', onPulse);
            socket.off('party-room-deleted', onDeleted);
            socket.off('connect', onConnect);
        };
    }, [join, joined]);

    // Nouvelle manche : on repart d'une ardoise propre.
    useEffect(() => {
        if (state?.state === 'ROUND_INTRO') {
            setGallery([]);
            setChosenPid(null);
            setPhotoSubmitted(false);
            setCustomChampion('');
        }
    }, [state?.state, state?.roundIndex]);

    // ─── Dérivés ─────────────────────────────────────────────────────────────
    const me = useMemo(
        () => state?.players.find((p) => p.id === myId) || null,
        [state, myId],
    );
    const myTable = useMemo(
        () => (me?.tableId ? state?.tables.find((t) => t.id === me.tableId) : null) || null,
        [state, me],
    );
    const members = useMemo(
        () => state?.players.filter((p) => p.tableId === me?.tableId) || [],
        [state, me],
    );

    const isCaptain = !!me?.isCaptain;
    const { seconds } = usePhaseTimer(state?.phaseRemainingMs, state?.phaseDuration);

    // ─── Actions ─────────────────────────────────────────────────────────────
    const createTable = () => {
        setBusy(true);
        socket.emit('party-create-table', { roomCode, tableName }, (res) => {
            setBusy(false);
            if (!res || res.error) { setError(res?.error || 'Création impossible'); return; }
            setToken(res.token);
            setError('');
        });
    };

    const regenerate = () => {
        socket.emit('party-regen-token', { roomCode }, (res) => {
            if (res?.token) setToken(res.token);
        });
    };

    const voteGame = (minigameId) => {
        socket.emit('party-vote-game', { roomCode, minigameId }, (res) => {
            if (res?.error) setNotice(res.error);
            else if (navigator.vibrate) navigator.vibrate(15);
        });
    };

    const designate = (championName) => {
        socket.emit('party-designate-champion', { roomCode, championName }, (res) => {
            if (res?.error) setNotice(res.error);
            else if (navigator.vibrate) navigator.vibrate(15);
        });
    };

    const submitPhoto = (dataUrl, done) => {
        socket.emit('party-submit-photo', { roomCode, dataUrl }, (res) => {
            if (res?.error) { done(res.error); return; }
            setPhotoSubmitted(true);
            done(null);
        });
    };

    const vote = (pid) => {
        socket.emit('party-vote', { roomCode, pid }, (res) => {
            if (res?.error) { setNotice(res.error); return; }
            setChosenPid(pid);
        });
    };

    // ─── Écrans ──────────────────────────────────────────────────────────────
    if (!joined) {
        return (
            <div className="pty-root flex items-center justify-center p-6">
                <div className="w-full max-w-sm flex flex-col gap-5">
                    <div className="text-center">
                        {urlRoomCode && <p className="pty-eyebrow mb-2">Salon {urlRoomCode}</p>}
                        <h1 className="pty-title text-4xl">Super LTN Party</h1>
                        {scannedTable && (
                            <p className="text-sm mt-3" style={{ color: 'var(--pty-accent)' }}>
                                Vous rejoignez une table pour l'épreuve en cours.
                            </p>
                        )}
                    </div>

                    {!urlRoomCode && (
                        <input
                            className="pty-input text-center"
                            style={{ fontSize: '1.6rem', letterSpacing: '0.3em' }}
                            placeholder="CODE"
                            inputMode="numeric"
                            value={typedCode}
                            maxLength={6}
                            onChange={(e) => setTypedCode(e.target.value.trim())}
                        />
                    )}

                    <input
                        className="pty-input"
                        placeholder="Votre prénom"
                        value={name}
                        maxLength={20}
                        onChange={(e) => setName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && name.trim() && roomCode && join(name.trim())}
                    />

                    {error && <p className="text-sm text-center" style={{ color: 'var(--pty-accent)' }}>{error}</p>}

                    <button
                        type="button"
                        className="pty-btn pty-btn-primary w-full"
                        disabled={!name.trim() || !roomCode || busy}
                        onClick={() => join(name.trim())}
                    >
                        {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Entrer'}
                    </button>
                </div>
            </div>
        );
    }

    if (!state) {
        return (
            <div className="pty-root flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin" />
            </div>
        );
    }

    // Sans table, on ne joue pas. Un coéquipier relâché après son épreuve passe
    // aussi par ici : il faut lui dire que c'est normal.
    if (!myTable) {
        const full = state.tables.length >= state.maxTables;
        const wasGuest = me?.role === 'guest';
        return (
            <div className="pty-root flex items-center justify-center p-6">
                <div className="w-full max-w-sm flex flex-col gap-5">
                    <div className="text-center">
                        <h1 className="pty-title text-3xl mb-2">
                            {wasGuest ? 'Épreuve terminée' : 'Rejoignez une table'}
                        </h1>
                        <p className="text-sm" style={{ color: 'var(--pty-muted)' }}>
                            {wasGuest
                                ? 'Merci ! Votre capitaine vous refera scanner son QR code à la prochaine épreuve à plusieurs.'
                                : 'Scannez le QR code du capitaine d\'une table, ou créez la vôtre si vous êtes le premier.'}
                        </p>
                    </div>

                    {state.state === 'LOBBY' && !full && !wasGuest && (
                        <>
                            <input
                                className="pty-input"
                                placeholder="Nom de votre table"
                                value={tableName}
                                maxLength={20}
                                onChange={(e) => setTableName(e.target.value)}
                            />
                            <button
                                type="button"
                                className="pty-btn pty-btn-primary w-full"
                                onClick={createTable}
                                disabled={busy}
                            >
                                <Crown className="w-5 h-5" />
                                Créer ma table
                            </button>
                            <p className="text-xs text-center" style={{ color: 'var(--pty-muted)' }}>
                                Un seul téléphone par table : le vôtre sera celui de l'équipe.
                            </p>
                        </>
                    )}

                    {full && !wasGuest && (
                        <p className="text-sm text-center" style={{ color: 'var(--pty-muted)' }}>
                            Les {state.maxTables} tables sont créées : faites-vous scanner par l'une d'elles.
                        </p>
                    )}
                    {state.state !== 'LOBBY' && !wasGuest && (
                        <p className="text-sm text-center" style={{ color: 'var(--pty-muted)' }}>
                            La partie a commencé — rejoignez une table par QR code.
                        </p>
                    )}

                    {error && <p className="text-sm text-center" style={{ color: 'var(--pty-accent)' }}>{error}</p>}

                    <div className="pty-panel p-4 flex flex-col gap-2">
                        <p className="pty-eyebrow">Tables en lice</p>
                        {state.tables.length === 0 && (
                            <p className="text-sm" style={{ color: 'var(--pty-muted)' }}>Aucune pour l'instant.</p>
                        )}
                        {state.tables.map((table) => (
                            <div key={table.id} className="flex items-center gap-2">
                                <span className="pty-dot" style={{ background: table.color }} />
                                <span className="font-bold flex-1 truncate">{table.name}</span>
                                <span className="text-xs truncate" style={{ color: 'var(--pty-muted)' }}>
                                    {table.captainName}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="pty-root flex flex-col p-4 gap-4" style={{ minHeight: '100dvh' }}>
            <TableDashboard
                roomCode={roomCode}
                table={myTable}
                token={token}
                members={members}
                onRegenerate={isCaptain ? regenerate : undefined}
                compact={state.state !== 'LOBBY'}
            />

            {state.state !== 'LOBBY' && state.state !== 'FINAL' && (
                <div className="flex flex-col gap-2">
                    <div className="flex justify-between text-xs" style={{ color: 'var(--pty-muted)' }}>
                        <span>Manche {state.roundIndex} / {state.totalRounds}</span>
                        <span>{seconds}s</span>
                    </div>
                    <PhaseBar remainingMs={state.phaseRemainingMs} duration={state.phaseDuration} />
                </div>
            )}

            {notice && (
                <p className="text-sm text-center pty-panel p-3" style={{ color: 'var(--pty-accent)' }}>
                    {notice}
                </p>
            )}

            <div className="flex-1 flex flex-col">
                {renderPhase()}
            </div>
        </div>
    );

    function renderPhase() {
        switch (state.state) {
            case 'LOBBY':
                return (
                    <div className="pty-panel p-6 text-center flex-1 flex flex-col justify-center gap-3">
                        <Users className="w-10 h-10 mx-auto" style={{ color: 'var(--pty-muted)' }} />
                        <p className="text-lg font-bold">En attente du lancement</p>
                        <p className="text-sm" style={{ color: 'var(--pty-muted)' }}>
                            {isCaptain
                                ? 'Gardez ce téléphone à portée : c\'est celui de la table.'
                                : 'L\'hôte lance la partie quand tout le monde est prêt.'}
                        </p>
                    </div>
                );

            case 'ROUND_INTRO':
                return (
                    <div className="pty-panel p-6 text-center flex-1 flex flex-col justify-center gap-3">
                        <p className="pty-eyebrow">Zone en jeu</p>
                        <p className="text-2xl font-black">{state.contestedZone?.name}</p>
                        <p className="text-sm mt-2" style={{ color: 'var(--pty-muted)' }}>
                            {state.contestedZone?.value} point{state.contestedZone?.value > 1 ? 's' : ''} à prendre
                        </p>
                    </div>
                );

            /**
             * Le vote de l'épreuve : une voix par table, portée par le capitaine.
             * Les autres téléphones (coéquipiers encore rattachés) suivent le
             * décompte sans pouvoir voter.
             */
            case 'GAME_VOTE': {
                const myVote = myTable.votedGameId;
                if (!isCaptain) {
                    return (
                        <div className="pty-panel p-6 text-center flex-1 flex flex-col justify-center gap-3">
                            <Dices className="w-10 h-10 mx-auto" style={{ color: 'var(--pty-accent)' }} />
                            <p className="text-lg font-bold">Votre capitaine choisit l'épreuve</p>
                            <p className="text-sm" style={{ color: 'var(--pty-muted)' }}>
                                Donnez-lui votre avis à voix haute.
                            </p>
                        </div>
                    );
                }
                return (
                    <div className="flex flex-col gap-3 flex-1">
                        <p className="text-center font-black text-lg">
                            {myVote ? 'Vote enregistré' : 'Quelle épreuve ?'}
                        </p>
                        <p className="text-center text-xs" style={{ color: 'var(--pty-muted)' }}>
                            Une voix par table · à égalité, le sort tranche
                        </p>
                        <div className="pty-game-grid">
                            {state.candidates.map((game) => (
                                <MinigameCard
                                    key={game.id}
                                    game={game}
                                    votes={game.votes}
                                    selected={myVote === game.id}
                                    onSelect={voteGame}
                                />
                            ))}
                        </div>
                    </div>
                );
            }

            /**
             * Le champion n'est pas un téléphone mais un prénom : le capitaine
             * désigne qui, à sa table, va s'y coller. L'épreuve exacte reste
             * cachée — c'est tout l'intérêt du moment.
             */
            case 'CHAMPION_PICK': {
                if (!isCaptain) {
                    return (
                        <div className="pty-panel p-6 text-center flex-1 flex flex-col justify-center gap-3">
                            <p className="pty-eyebrow">{state.discipline}</p>
                            <p className="text-3xl font-black">{state.minigame?.name}</p>
                            <p className="text-sm" style={{ color: 'var(--pty-muted)' }}>
                                Votre capitaine désigne le champion de la table.
                            </p>
                        </div>
                    );
                }
                if (myTable.championName) {
                    return (
                        <div className="pty-panel p-6 text-center flex-1 flex flex-col justify-center gap-3">
                            <p className="pty-eyebrow">Champion désigné</p>
                            <p className="text-3xl font-black" style={{ color: 'var(--pty-accent)' }}>
                                {myTable.championName}
                            </p>
                            <p className="text-sm" style={{ color: 'var(--pty-muted)' }}>
                                On attend les autres tables…
                            </p>
                        </div>
                    );
                }
                return (
                    <div className="pty-panel p-5 flex-1 flex flex-col gap-4">
                        <div className="text-center">
                            <p className="pty-eyebrow">{state.discipline}</p>
                            <p className="text-3xl font-black">{state.minigame?.name}</p>
                            <p className="text-sm mt-2" style={{ color: 'var(--pty-muted)' }}>
                                {state.minigame?.rule}
                            </p>
                            <p className="text-sm mt-3 font-bold">Qui, à votre table, s'y colle ?</p>
                        </div>

                        <div className="flex flex-wrap gap-2 justify-center">
                            {myTable.eligibleNames.map((champion) => (
                                <button
                                    key={champion}
                                    type="button"
                                    className="pty-btn pty-btn-ghost"
                                    onClick={() => designate(champion)}
                                >
                                    {champion}
                                </button>
                            ))}
                        </div>

                        {myTable.lastChampionName && myTable.roster.length > 1 && (
                            <p className="text-xs text-center" style={{ color: 'var(--pty-muted)' }}>
                                {myTable.lastChampionName} vient de jouer : on tourne.
                            </p>
                        )}

                        <div className="flex gap-2 mt-auto">
                            <input
                                className="pty-input flex-1"
                                placeholder="Un autre prénom"
                                value={customChampion}
                                maxLength={20}
                                onChange={(e) => setCustomChampion(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && customChampion.trim()) designate(customChampion.trim());
                                }}
                            />
                            <button
                                type="button"
                                className="pty-btn pty-btn-primary"
                                disabled={!customChampion.trim()}
                                onClick={() => designate(customChampion.trim())}
                            >
                                OK
                            </button>
                        </div>

                        <p className="text-xs text-center" style={{ color: 'var(--pty-muted)' }}>
                            Sans réponse, le sort décidera pour vous.
                        </p>
                    </div>
                );
            }

            /**
             * Épreuve à plusieurs : le capitaine sort son QR, ses coéquipiers le
             * scannent pour cette épreuve seulement.
             */
            case 'ENROL':
                return (
                    <div className="pty-panel p-6 text-center flex-1 flex flex-col justify-center gap-3">
                        {isCaptain ? (
                            <>
                                <QrCode className="w-10 h-10 mx-auto" style={{ color: 'var(--pty-accent)' }} />
                                <p className="text-xl font-black">Épreuve à plusieurs</p>
                                <p className="text-sm" style={{ color: 'var(--pty-muted)' }}>
                                    Faites scanner votre QR code (en haut de l'écran) à ceux
                                    de votre table qui veulent jouer cette manche.
                                </p>
                                <p className="pty-badge mx-auto">
                                    {myTable.enrolledCount} téléphone{myTable.enrolledCount > 1 ? 's' : ''} inscrit{myTable.enrolledCount > 1 ? 's' : ''}
                                </p>
                            </>
                        ) : (
                            <>
                                <Users className="w-10 h-10 mx-auto" style={{ color: 'var(--pty-accent)' }} />
                                <p className="text-xl font-black">Vous êtes dans la partie</p>
                                <p className="text-sm" style={{ color: 'var(--pty-muted)' }}>
                                    Tenez-vous prêt, l'épreuve va commencer.
                                </p>
                            </>
                        )}
                    </div>
                );

            case 'REVEAL':
                return (
                    <div className="pty-panel p-6 text-center flex-1 flex flex-col justify-center gap-3">
                        <p className="pty-eyebrow">L'épreuve</p>
                        <p className="text-3xl font-black">{state.minigame?.name}</p>
                        <p className="text-sm" style={{ color: 'var(--pty-muted)' }}>{state.minigame?.rule}</p>
                        {myTable.championName && (
                            <p className="pty-badge mx-auto mt-2">Champion : {myTable.championName}</p>
                        )}
                    </div>
                );

            case 'MINIGAME':
                if (state.minigame?.id === 'reflexe') {
                    return (
                        <ReflexePlayer
                            roomCode={roomCode}
                            canPlay={!myTable.frozen && me?.enrolled}
                        />
                    );
                }
                if (state.minigame?.id === 'croquis') {
                    return (
                        <CroquisPlayer
                            phase={state.minigamePhase}
                            theme={state.minigame?.theme}
                            remainingMs={state.phaseRemainingMs}
                            duration={state.phaseDuration}
                            isCaptain={isCaptain}
                            championName={myTable.championName}
                            photoSubmitted={photoSubmitted}
                            onSubmitPhoto={submitPhoto}
                            gallery={gallery}
                            chosenPid={chosenPid}
                            hasVoted={myTable.hasVoted}
                            onVote={vote}
                        />
                    );
                }
                return null;

            case 'ROUND_RESULT': {
                const result = state.roundResult;
                const won = result?.winnerTableId === myTable.id;
                return (
                    <div className="pty-panel p-6 text-center flex-1 flex flex-col justify-center gap-3">
                        <Swords className="w-10 h-10 mx-auto" style={{ color: won ? 'var(--pty-accent)' : 'var(--pty-muted)' }} />
                        <p className="text-2xl font-black">
                            {won ? 'Zone conquise !' : result?.winnerTableId ? 'Zone perdue' : 'Personne ne prend'}
                        </p>
                        <p className="text-sm" style={{ color: 'var(--pty-muted)' }}>{result?.zoneName}</p>
                        <div className="flex flex-col gap-1 mt-3">
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
                const rank = podium.findIndex((t) => t.id === myTable.id) + 1;
                return (
                    <div className="pty-panel p-6 text-center flex-1 flex flex-col justify-center gap-3">
                        <Trophy className="w-12 h-12 mx-auto" style={{ color: 'var(--pty-accent)' }} />
                        <p className="text-2xl font-black">
                            {rank === 1 ? 'Votre table gagne la soirée !' : `${rank}ᵉ place`}
                        </p>
                        <p className="text-sm" style={{ color: 'var(--pty-muted)' }}>
                            {myTable.score} point{myTable.score > 1 ? 's' : ''} de territoire
                        </p>
                        <div className="flex items-center justify-center gap-2 mt-2">
                            <MapPin className="w-4 h-4" style={{ color: 'var(--pty-muted)' }} />
                            <span className="text-sm">{myTable.zones.length} zone(s) contrôlée(s)</span>
                        </div>
                        {myTable.bestChampion && (
                            <p className="pty-badge mx-auto mt-2">
                                Champion de la table : {myTable.bestChampion.name} ({myTable.bestChampion.wins})
                            </p>
                        )}
                    </div>
                );
            }

            default:
                return null;
        }
    }
}

export default PartyPlayerView;
