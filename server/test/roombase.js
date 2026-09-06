/**
 * Tests unitaires de RoomBase — le socle doit être sûr avant d'y brancher
 * sept jeux qui fonctionnent.
 *
 * Usage :  node test/roombase.js
 */

const RoomBase = require('../core/RoomBase');
const { ok, section, report } = require('./harness');

/* ── Codes ─────────────────────────────────────────────────────────── */

section('Génération des codes');
{
    const alpha = new RoomBase({ logTag: 'T-A', codeFormat: 'alpha6' });
    const codes = new Set();
    for (let i = 0; i < 400; i++) codes.add(alpha.generateRoomCode());
    ok('alpha6 : 6 caractères du bon alphabet',
        [...codes].every(c => /^[A-HJ-NP-Z2-9]{6}$/.test(c)));
    ok('alpha6 : pas de I, O, 0 ni 1 (illisibles de loin)',
        [...codes].every(c => !/[IO01]/.test(c)));

    const num = new RoomBase({ logTag: 'T-N', codeFormat: 'num4' });
    const nums = new Set();
    for (let i = 0; i < 200; i++) nums.add(num.generateRoomCode());
    ok('num4 : 4 chiffres, 1000-9999', [...nums].every(c => /^[0-9]{4}$/.test(c)));

    // Anti-collision : on sature la table et on vérifie qu'aucun code n'est réutilisé
    const tight = new RoomBase({ logTag: 'T-C', codeFormat: 'num4' });
    for (let i = 1000; i < 9999; i++) tight.rooms.set(String(i), {});
    const free = tight.generateRoomCode();
    ok('anti-collision : trouve le dernier code libre', free === '9999');

    tight.rooms.set('9999', {});
    let threw = false;
    try { tight.generateRoomCode(); } catch { threw = true; }
    ok('table saturée : échoue au lieu de boucler sans fin', threw);
}

/* ── Cycle de vie ──────────────────────────────────────────────────── */

section('Cycle de vie des salons');
{
    const m = new RoomBase({ logTag: 'T-L' });
    const code = m.createRoom('host-1', { rounds: 5 });
    const room = m.getRoom(code);

    ok('salon créé', !!room);
    ok('hôte mémorisé', room.hostId === 'host-1');
    ok('démarre en LOBBY', room.gameState === 'LOBBY');
    ok('réglages fusionnés', room.settings.rounds === 5);
    ok('horodatages posés', room.createdAt > 0 && room.lastActivity > 0);

    const before = room.lastActivity;
    room.lastActivity = 0;
    m.touch(room);
    ok('touch repousse l\'expiration', room.lastActivity >= before);

    ok('suppression effective', m.deleteRoom(code) === true && !m.getRoom(code));
    ok('suppression d\'un code inconnu', m.deleteRoom('XXXXXX') === false);
}

/* ── Inscription et reconnexion ────────────────────────────────────── */

section('Inscription et reconnexion');
{
    const m = new RoomBase({ logTag: 'T-J', maxPlayers: 3 });
    const code = m.createRoom('h');

    ok('salon inconnu rejeté', !!m.joinRoom('NOPE00', 's1', 'Alice').error);
    ok('pseudo vide rejeté', !!m.joinRoom(code, 's1', '   ').error);

    const a = m.joinRoom(code, 's1', 'Alice', '/a1.webp');
    ok('Alice inscrite', a.success && !a.reconnected);
    ok('champs de base présents',
        a.player.score === 0 && a.player.disconnected === false);

    // Pseudo trop long : borné, pas rejeté
    const long = m.joinRoom(code, 's2', 'UnPseudoBeaucoupTropLong', null);
    ok('pseudo borné à 14 caractères', long.player.name.length === 14);

    m.joinRoom(code, 's3', 'Carla');
    const full = m.joinRoom(code, 's4', 'Denis');
    ok('salon plein refusé', !!full.error, full.error);

    // Reconnexion : même pseudo, casse différente, nouvelle socket
    const room = m.getRoom(code);
    const back = m.joinRoom(code, 's1-bis', 'ALICE');
    ok('reconnexion détectée malgré la casse', back.reconnected === true);
    ok('ancien identifiant libéré', !room.players.has('s1'));
    ok('nouvel identifiant en place', room.players.has('s1-bis'));
    ok('effectif inchangé', room.players.size === 3);

    // L'avatar n'est écrasé que si un nouveau est fourni
    const keep = m.joinRoom(code, 's1-ter', 'Alice', null);
    ok('avatar conservé si non fourni', keep.player.avatar === '/a1.webp');
    const swap = m.joinRoom(code, 's1-quater', 'Alice', '/a9.webp');
    ok('avatar remplacé si fourni', swap.player.avatar === '/a9.webp');
}

/* ── Arrivée en cours de partie ────────────────────────────────────── */

section('Arrivée en cours de partie');
{
    const closed = new RoomBase({ logTag: 'T-M1' });
    const c1 = closed.createRoom('h');
    closed.getRoom(c1).gameState = 'PLAYING';
    ok('refusée par défaut', !!closed.joinRoom(c1, 's', 'Tardif').error);

    class OpenRoom extends RoomBase {
        canJoinMidGame() { return true; }
    }
    const open = new OpenRoom({ logTag: 'T-M2' });
    const c2 = open.createRoom('h');
    open.getRoom(c2).gameState = 'PLAYING';
    const late = open.joinRoom(c2, 's', 'Tardif');
    ok('autorisée si le jeu le permet', late.success === true);
    ok('signalée comme tardive', late.lateJoin === true);
}

/* ── Départs ───────────────────────────────────────────────────────── */

section('Départs et expulsions');
{
    const m = new RoomBase({ logTag: 'T-D' });
    const code = m.createRoom('host');
    const room = m.getRoom(code);
    m.joinRoom(code, 'p1', 'Alice');
    m.joinRoom(code, 'p2', 'Bob');

    // En lobby, le joueur disparaît
    const left = m.removePlayer('p1');
    ok('départ en lobby : type "left"', left.type === 'left');
    ok('départ en lobby : joueur retiré', !room.players.has('p1'));

    // En partie, il est conservé pour pouvoir revenir
    room.gameState = 'PLAYING';
    const dropped = m.removePlayer('p2');
    ok('départ en partie : type "disconnected"', dropped.type === 'disconnected');
    ok('départ en partie : joueur conservé', room.players.has('p2'));
    ok('départ en partie : marqué absent', room.players.get('p2').disconnected === true);
    ok('activePlayers ignore les absents', m.activePlayers(room).length === 0);

    // L'hôte n'est jamais retiré : le contrôleur lui laisse une grâce
    const host = m.removePlayer('host');
    ok('hôte signalé comme tel', host.isHost === true);
    ok('hôte marqué déconnecté', room.hostDisconnected === true);

    ok('socket inconnue : rien', m.removePlayer('fantome') === null);

    // Expulsion
    const kick = m.kickPlayer(code, 'p2');
    ok('expulsion effective', kick.success && !room.players.has('p2'));
    ok('expulsion d\'un absent rejetée', !!m.kickPlayer(code, 'p2').error);
}

/* ── Nettoyage ─────────────────────────────────────────────────────── */

section('Nettoyage automatique');
{
    const m = new RoomBase({
        logTag: 'T-C',
        cleanupIntervalMs: 3_600_000,   // jamais déclenché tout seul pendant le test
        endedTtlMs: 1000,
        staleTtlMs: 2000
    });

    // Salon terminé depuis longtemps
    const ended = m.createRoom('h1');
    m.getRoom(ended).gameState = 'GAME_END';
    m.getRoom(ended).lastActivity = Date.now() - 5000;

    // Salon vide depuis longtemps
    const stale = m.createRoom('h2');
    m.getRoom(stale).lastActivity = Date.now() - 5000;

    // Salon vide mais récent
    const fresh = m.createRoom('h3');

    // Salon ancien mais encore peuplé
    const busy = m.createRoom('h4');
    m.joinRoom(busy, 'p', 'Alice');
    m.getRoom(busy).lastActivity = Date.now() - 5000;

    m.cleanupRooms();
    ok('salon terminé supprimé', !m.getRoom(ended));
    ok('salon inactif supprimé', !m.getRoom(stale));
    ok('salon récent conservé', !!m.getRoom(fresh));
    ok('salon encore peuplé conservé', !!m.getRoom(busy));

    // Les ressources du jeu sont bien relâchées
    let disposed = 0;
    class Timed extends RoomBase {
        onRoomDisposed() { disposed++; }
    }
    const t = new Timed({ logTag: 'T-T', cleanupIntervalMs: 3_600_000, endedTtlMs: 1 });
    const tc = t.createRoom('h');
    t.getRoom(tc).gameState = 'GAME_END';
    t.getRoom(tc).lastActivity = Date.now() - 100;
    t.cleanupRooms();
    ok('onRoomDisposed appelé au nettoyage', disposed === 1);

    const tc2 = t.createRoom('h');
    t.deleteRoom(tc2);
    ok('onRoomDisposed appelé à la suppression', disposed === 2);
}

/* ── Points d'extension ────────────────────────────────────────────── */

section('Points d\'extension');
{
    class Chess extends RoomBase {
        defaultSettings() { return { clock: 300 }; }
        createRoomState() { return { board: 'initial' }; }
        createPlayer(id, name, avatar) {
            return { ...super.createPlayer(id, name, avatar), elo: 1200, wins: 0 };
        }
        describePlayer(p) { return { id: p.id, name: p.name, elo: p.elo }; }
        onPlayerRejoin(room, oldId, newId) {
            room.seats = room.seats.map(s => s === oldId ? newId : s);
        }
        describeRejoin(room, player) { return { board: room.board, elo: player.elo }; }
    }

    const m = new Chess({ logTag: 'T-X' });
    const code = m.createRoom('h');
    const room = m.getRoom(code);

    ok('defaultSettings appliqués', room.settings.clock === 300);
    ok('createRoomState fusionné', room.board === 'initial');

    m.joinRoom(code, 'p1', 'Alice');
    ok('createPlayer enrichi', room.players.get('p1').elo === 1200);
    ok('createPlayer garde la base', room.players.get('p1').disconnected === false);

    const view = m.getPlayersInRoom(code);
    ok('describePlayer respecté', view[0].elo === 1200 && view[0].score === undefined);

    room.seats = ['p1', null];
    const back = m.joinRoom(code, 'p1-bis', 'Alice');
    ok('onPlayerRejoin réécrit les références', room.seats[0] === 'p1-bis');
    ok('describeRejoin fusionné', back.board === 'initial' && back.elo === 1200);
}

/* ── Utilitaires ───────────────────────────────────────────────────── */

section('Utilitaires partagés');
{
    const m = new RoomBase({ logTag: 'T-U' });

    ok('normalize : accents et ponctuation',
        m.normalizeText('Éléphant !') === 'elephant');
    ok('normalize : comparaison insensible',
        m.normalizeText('CRÈME BRÛLÉE') === m.normalizeText('creme brulee'));
    ok('normalize : entrée vide', m.normalizeText(null) === '');

    const src = [1, 2, 3, 4, 5, 6, 7, 8];
    const out = m.shuffleArray([...src]);
    ok('shuffle conserve les éléments',
        out.length === src.length && src.every(v => out.includes(v)));

    // Le mélange doit produire des ordres différents (probabilité d'échec ~ nulle)
    const orders = new Set();
    for (let i = 0; i < 40; i++) orders.add(m.shuffleArray([...src]).join(','));
    ok('shuffle produit des ordres variés', orders.size > 5);
}

process.exit(report() ? 0 : 1);
