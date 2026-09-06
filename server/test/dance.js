/**
 * Tests de DANCE_DANCE — chorégraphie, jugement et anti-triche.
 *
 * L'anti-triche est la partie la plus scrutée : le jeu délègue le jugement au
 * téléphone pour la réactivité, donc la seule chose qui protège le classement
 * est la validation serveur de `registerHit`. Chaque garde y a son test.
 *
 * Usage :  node test/dance.js
 */

const chart = require('../dance/chart');
const judge = require('../dance/judge');
const manager = require('../danceGameManager');
const { ok, section, report } = require('./harness');

/* ── Chorégraphie ──────────────────────────────────────────────────── */

section('Génération de chorégraphies');
{
    const base = { bpm: 128, durationMs: 120000, seed: 'test' };

    const levels = ['facile', 'normal', 'difficile', 'expert'].map((d) =>
        chart.generateChart({ ...base, difficulty: d })
    );

    ok('la difficulté est strictement croissante en nombre de notes',
        levels.every((c, i) => i === 0 || c.count > levels[i - 1].count),
        levels.map((c) => c.count).join(' < '));

    ok('« Facile » reste sous 1,5 note par seconde',
        levels[0].count / 117 < 1.5,
        `${(levels[0].count / 117).toFixed(2)} nps`);

    ok('« Expert » dépasse 4 notes par seconde',
        levels[3].count / 117 > 4,
        `${(levels[3].count / 117).toFixed(2)} nps`);

    // Deux notes trop rapprochées sur la même colonne sont injouables au pouce.
    const tooClose = levels.map((c) => {
        const last = {};
        let min = Infinity;
        for (const n of c.notes) {
            if (last[n.column] !== undefined) min = Math.min(min, n.timeMs - last[n.column]);
            last[n.column] = n.timeMs;
        }
        return min;
    });
    ok('aucune colonne ne redemande une frappe en moins de 100 ms',
        tooClose.every((m) => m >= 100),
        tooClose.join(' / '));

    // Une chart doit être rejouable à l'identique : le serveur la génère une
    // fois, les téléphones la reçoivent — mais un rejeu doit donner le même jeu.
    const a = chart.generateChart({ ...base, difficulty: 'normal' });
    const b = chart.generateChart({ ...base, difficulty: 'normal' });
    ok('même graine → chorégraphie identique',
        JSON.stringify(a.notes) === JSON.stringify(b.notes));
    ok('graine différente → chorégraphie différente',
        JSON.stringify(a.notes) !== JSON.stringify(
            chart.generateChart({ ...base, seed: 'autre', difficulty: 'normal' }).notes));

    // Toutes les colonnes doivent servir : une chart qui ignore une flèche est
    // ratée, et le déséquilibre se voit à l'œil sur le grand écran.
    const perCol = [0, 0, 0, 0];
    for (const n of a.notes) perCol[n.column]++;
    const spread = Math.max(...perCol) / Math.min(...perCol);
    ok('les quatre colonnes sont équilibrées (écart < 2×)', spread < 2, perCol.join('/'));

    ok('aucune note ne dépasse la fin du morceau',
        a.notes.every((n) => n.timeMs <= a.durationMs));
    ok('aucune note avant la fin du décompte',
        a.notes.every((n) => n.timeMs >= a.leadInMs));

    // La normalisation par tempo : « Normal » doit rester « Normal ».
    const slow = chart.generateChart({ bpm: 80, durationMs: 120000, seed: 's', difficulty: 'normal' });
    const fast = chart.generateChart({ bpm: 190, durationMs: 120000, seed: 's', difficulty: 'normal' });
    const ratio = (fast.count / slow.count);
    ok('un morceau rapide n\'est pas deux fois plus chargé qu\'un lent',
        ratio < 1.8, `rapport ${ratio.toFixed(2)}`);
}

/* ── Jugement ──────────────────────────────────────────────────────── */

section('Fenêtres de jugement et score');
{
    ok('0 ms → PARFAIT', judge.judgeOffset(0).id === 'PERFECT');
    ok('une frappe en avance est jugée comme une frappe en retard',
        judge.judgeOffset(-40).id === judge.judgeOffset(40).id);
    ok('au-delà de la dernière fenêtre → RATÉ', judge.judgeOffset(500).id === 'MISS');
    ok('les fenêtres se suivent sans trou',
        judge.judgeOffset(26).id === 'GREAT' && judge.judgeOffset(56).id === 'GOOD');

    const s = judge.createScoreState();
    for (let i = 0; i < 20; i++) judge.applyJudgement(s, judge.judgeOffset(5), 5);
    ok('20 frappes parfaites → 100 % de précision', judge.accuracy(s) === 100);
    ok('le combo suit les frappes réussies', s.combo === 20 && s.maxCombo === 20);

    const beforeMiss = s.score;
    judge.applyJudgement(s, judge.judgeOffset(9999), 0);
    ok('une frappe ratée casse le combo', s.combo === 0);
    ok('une frappe ratée ne rapporte aucun point', s.score === beforeMiss);
    ok('le meilleur combo est conservé après une erreur', s.maxCombo === 20);

    // Le multiplicateur doit récompenser la régularité sans permettre à un seul
    // morceau d'écraser le classement d'une soirée.
    ok('le multiplicateur de combo est plafonné',
        judge.comboMultiplier(1000) === judge.comboMultiplier(100));

    const perfect = judge.createScoreState();
    for (let i = 0; i < 50; i++) judge.applyJudgement(perfect, judge.judgeOffset(2), 2);
    ok('un sans-faute décroche le rang SSS', judge.rank(perfect) === 'SSS');
}

/* ── Anti-triche ───────────────────────────────────────────────────── */

section('Validation serveur des frappes (anti-triche)');
{
    // Un salon en cours de chanson, monté à la main pour maîtriser le temps.
    const code = manager.createRoom('host-test', {});
    const room = manager.getRoom(code);
    manager.joinRoom(code, 'player-1', 'Testeur', null);
    const player = room.players.get('player-1');

    room.chart = chart.generateChart({
        bpm: 120, durationMs: 60000, difficulty: 'normal', seed: 'anticheat',
    });
    room.song = { id: 'anticheat', title: 'Test', bpm: 120, durationMs: 60000 };
    room.state = 'PLAYING';

    const note = room.chart.notes[10];
    // On place l'horloge du salon pour que `note` vienne d'être jouée.
    room.startAt = Date.now() - note.timeMs;

    const first = manager.registerHit(room, player, { noteId: note.id, offsetMs: 10 });
    ok('une frappe honnête est acceptée', first.ok === true);
    ok('le serveur rejuge lui-même le verdict', first.judgement.id === 'PERFECT');

    const replay = manager.registerHit(room, player, { noteId: note.id, offsetMs: 10 });
    ok('rejouer la même note est refusé', replay.ok === false && replay.reason === 'duplicate');

    const ghost = manager.registerHit(room, player, { noteId: 999999, offsetMs: 0 });
    ok('une note inexistante est refusée', ghost.ok === false && ghost.reason === 'unknown-note');

    const wild = manager.registerHit(room, player, { noteId: room.chart.notes[11].id, offsetMs: 5000 });
    ok('un écart hors fenêtre est refusé', wild.ok === false && wild.reason === 'out-of-range');

    // La fraude la plus tentante : prétendre « parfait » sur une note passée
    // depuis longtemps. L'écart annoncé est plausible, mais l'instant d'arrivée
    // du paquet le contredit.
    const stale = room.chart.notes.find((n) => n.timeMs < note.timeMs - 3000);
    const lie = manager.registerHit(room, player, { noteId: stale.id, offsetMs: 0 });
    ok('annoncer « parfait » sur une note ancienne est refusé',
        lie.ok === false && lie.reason === 'implausible');

    const junk = manager.registerHit(room, player, { noteId: 'x', offsetMs: null });
    ok('une charge utile malformée est refusée', junk.ok === false && junk.reason === 'malformed');

    // Hors manche, plus rien n'est accepté.
    room.state = 'RESULT';
    const late = manager.registerHit(room, player, { noteId: room.chart.notes[12].id, offsetMs: 0 });
    ok('une frappe hors manche est refusée', late.ok === false && late.reason === 'inactive');
    room.state = 'PLAYING';

    // Un spectateur regarde, il ne marque pas.
    player.spectator = true;
    const watcher = manager.registerHit(room, player, { noteId: room.chart.notes[13].id, offsetMs: 0 });
    ok('un spectateur ne marque pas de points',
        watcher.ok === false && watcher.reason === 'spectator');
    player.spectator = false;

    ok('le client ne peut pas imposer de points : seul l\'écart est transmis',
        typeof first.judgement.points === 'number' && first.live.score > 0);

    manager.deleteRoom(code);
}

/* ── Fin de manche ─────────────────────────────────────────────────── */

section('Clôture d\'une chanson');
{
    const code = manager.createRoom('host-end', {});
    const room = manager.getRoom(code);
    manager.joinRoom(code, 'p-actif', 'Actif', null);
    manager.joinRoom(code, 'p-passif', 'Passif', null);

    room.chart = chart.generateChart({
        bpm: 120, durationMs: 30000, difficulty: 'facile', seed: 'fin',
    });
    room.state = 'PLAYING';
    room.startAt = Date.now();

    // Un joueur frappe la moitié des notes parfaitement, l'autre ne touche rien.
    const actif = room.players.get('p-actif');
    const half = Math.floor(room.chart.notes.length / 2);
    for (let i = 0; i < half; i++) {
        actif.hitNotes.add(room.chart.notes[i].id);
        judge.applyJudgement(actif.live, judge.judgeOffset(5), 5);
    }

    const results = manager.finalizeScores(room);

    ok('les notes jamais frappées comptent comme ratées',
        room.players.get('p-passif').live.counts.MISS === room.chart.notes.length);
    ok('celui qui ne joue pas n\'a pas 100 % de précision',
        judge.accuracy(room.players.get('p-passif').live) === 0);
    ok('le classement est trié par score décroissant',
        results[0].name === 'Actif' && results[0].score > results[1].score);
    ok('chaque joueur reçoit un rang', results.every((r) => typeof r.rank === 'string'));
    ok('le score de la manche s\'ajoute au cumul de la soirée',
        actif.totalScore === actif.live.score);

    manager.deleteRoom(code);
}

/* ── Cycle de vie du salon ─────────────────────────────────────────── */

section('Cycle de vie du salon');
{
    const code = manager.createRoom('host-life', {});
    const room = manager.getRoom(code);
    ok('le code du salon est à 4 chiffres', /^[0-9]{4}$/.test(code));

    manager.joinRoom(code, 'a', 'Alice', null);
    room.state = 'PLAYING';

    // Arrivée en pleine chanson : accepté, mais en spectateur.
    const late = manager.joinRoom(code, 'b', 'Bob', null);
    ok('on peut entrer pendant une chanson', late.success === true);
    ok('l\'arrivant est spectateur jusqu\'à la chanson suivante',
        room.players.get('b').spectator === true);

    // La chanson suivante remet tout le monde à égalité.
    room.state = 'LOBBY';
    const songsModule = require('../dance/songs');
    const fake = { id: 'fake-song', title: 'X', artist: 'Y', bpm: 120, durationMs: 40000, offsetMs: 0 };
    const originalGet = songsModule.get;
    songsModule.get = () => fake;
    manager.prepareRound(room, { songId: 'fake-song', difficulty: 'normal' });
    songsModule.get = originalGet;

    ok('la chanson suivante fait entrer les spectateurs',
        room.players.get('b').spectator === false);
    ok('les scores repartent de zéro à chaque chanson',
        room.players.get('a').live.score === 0);
    ok('la chorégraphie est prête pour la manche', room.chart && room.chart.notes.length > 0);

    // Reconnexion par pseudo — le socle RoomBase, vérifié ici pour ce jeu.
    room.state = 'PLAYING';
    room.players.get('a').live.score = 4200;
    const back = manager.joinRoom(code, 'a-new-socket', 'Alice', null);
    ok('la reconnexion par pseudo conserve le score',
        back.reconnected === true && room.players.get('a-new-socket').live.score === 4200);

    manager.deleteRoom(code);
    ok('le salon supprimé disparaît', manager.getRoom(code) === undefined);
}

process.exit(report() ? 0 : 1);
