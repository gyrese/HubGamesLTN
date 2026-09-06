/**
 * DANCE_DANCE — partie complète de bout en bout, sur de vraies sockets.
 *
 * Les tests unitaires () valident les règles ; celui-ci valide
 * l'enchaînement réel : ouverture, arrivée des joueurs, distribution de la
 * chorégraphie, départ synchronisé, frappes en temps réel, classement.
 *
 * Le morceau est factice : dépendre d'un vrai fichier audio rendrait la suite
 * non reproductible, alors que rien ici ne teste le décodage du son.
 *
 * Usage :  node test/dance-game.js
 */
const danceController = require('../controllers/danceController');
const songsModule = require('../dance/songs');
const { startServer, connect, once, emit, wait, closeAll, ok, section, report } =
    require('./harness');

// Morceau factice : on ne veut pas dependre d'un fichier audio reel.
const FAKE = {
    id: 'e2e-song', title: 'Test Track', artist: 'QA',
    bpm: 120, durationMs: 12000, offsetMs: 0,
    audioUrl: '/uploads/dance/fake.mp3', addedAt: Date.now(),
};
const realGet = songsModule.get;
const realList = songsModule.list;
songsModule.get = (id) => (id === FAKE.id ? FAKE : null);
songsModule.list = () => [songsModule.publicCard(FAKE)];

(async () => {
    const server = await startServer([danceController]);

    section('Ouverture du salon');
    const host = await connect(server.port);
    const created = await emit(host, 'dance-create-room', { songId: FAKE.id, difficulty: 'facile' });
    ok('salon ouvert', created.success === true && /^[0-9]{4}$/.test(created.roomCode));
    const room = created.roomCode;
    ok('catalogue transmis a l ecran', Array.isArray(created.songs) && created.songs.length === 1);
    ok('difficultes transmises', created.difficulties.length === 4);

    section('Arrivee des joueurs');
    const p1 = await connect(server.port);
    const p2 = await connect(server.port);
    const j1 = await emit(p1, 'dance-join-room', { roomCode: room, playerName: 'Alice' });
    const j2 = await emit(p2, 'dance-join-room', { roomCode: room, playerName: 'Bob' });
    ok('Alice entre', j1.success === true && j1.spectator === false);
    ok('Bob entre', j2.success === true);

    const badCode = await emit(p1, 'dance-join-room', { roomCode: '0000', playerName: 'X' });
    ok('un code inconnu est refuse', !!badCode.error);

    section('Lancement du morceau');
    // On ecoute la choregraphie AVANT de lancer.
    const chartP1 = once(p1, 'dance-chart', 5000);
    const chartP2 = once(p2, 'dance-chart', 5000);
    const started = await emit(host, 'dance-start-round', { roomCode: room, songId: FAKE.id, difficulty: 'facile' });
    ok('la manche demarre', started.success === true);

    const c1 = await chartP1;
    const c2 = await chartP2;
    ok('la choregraphie part vers les telephones', Array.isArray(c1.chart.notes) && c1.chart.notes.length > 0);
    ok('tous les joueurs recoivent la MEME choregraphie',
        JSON.stringify(c1.chart.notes) === JSON.stringify(c2.chart.notes));
    ok('le depart est un instant serveur absolu', typeof c1.startAt === 'number' && c1.startAt > Date.now());
    ok('l heure serveur accompagne l annonce', typeof c1.serverTime === 'number');

    // Un joueur non-hote ne doit pas pouvoir lancer.
    const usurp = await emit(p1, 'dance-start-round', { roomCode: room });
    ok('un joueur ne peut pas lancer la manche', !!usurp.error);

    section('Frappes pendant le morceau');
    // On attend le depart reel (compte a rebours de 5s).
    const untilStart = c1.startAt - Date.now();
    await wait(Math.max(0, untilStart) + 300);

    const notes = c1.chart.notes;
    const startAt = c1.startAt;

    // Alice joue proprement les notes qui tombent, en temps reel.
    let played = 0;
    const deadline = Date.now() + 6000;
    for (const note of notes) {
        if (Date.now() > deadline) break;
        const target = startAt + note.timeMs;
        const delay = target - Date.now();
        if (delay < -100) continue;            // note deja passee
        if (delay > 0) await wait(delay);
        p1.emit('dance-hit', { roomCode: room, noteId: note.id, offsetMs: 5 });
        played++;
        if (played >= 8) break;
    }
    ok('des notes ont ete jouees en temps reel', played > 0, String(played));

    await wait(400);

    // Verification directe de l'etat serveur.
    const manager = require('../danceGameManager');
    const liveRoom = manager.getRoom(room);
    const alice = [...liveRoom.players.values()].find(p => p.name === 'Alice');
    const bob = [...liveRoom.players.values()].find(p => p.name === 'Bob');
    ok('le serveur a compte les frappes d Alice', alice.live.score > 0, 'score=' + alice.live.score);
    ok('Bob qui ne joue pas reste a zero', bob.live.score === 0);
    ok('le combo d Alice a monte', alice.live.maxCombo > 0, String(alice.live.maxCombo));

    section('Anti-triche en conditions reelles');
    // Rejeu massif de la meme note
    const target = notes[0];
    for (let i = 0; i < 30; i++) {
        p2.emit('dance-hit', { roomCode: room, noteId: target.id, offsetMs: 0 });
    }
    await wait(300);
    const bobAfter = [...liveRoom.players.values()].find(p => p.name === 'Bob');
    ok('le matraquage de frappes ne fait pas monter le score',
        bobAfter.live.score === 0, 'score=' + bobAfter.live.score);

    section('Fin du morceau');
    const roundEnd = await once(host, 'dance-round-end', 15000);
    ok('la manche se termine seule', Array.isArray(roundEnd.results));
    ok('les deux joueurs sont classes', roundEnd.results.length === 2);
    ok('Alice devance Bob', roundEnd.results[0].name === 'Alice');
    ok('chaque resultat porte un rang', roundEnd.results.every(r => typeof r.rank === 'string'));
    ok('les notes non jouees comptent comme ratees',
        roundEnd.results.find(r => r.name === 'Bob').counts.MISS === notes.length);

    section('Retour au lobby');
    // RESULT_MS vaut 20s : trop long pour un test, on verifie juste l etat courant.
    ok('le salon est en RESULT', liveRoom.state === 'RESULT');
    ok('le ticker de scores est arrete', liveRoom.scoreTicker === null);

    closeAll();
    await server.close();
    songsModule.get = realGet;
    songsModule.list = realList;

    const success = report();
    process.exit(success ? 0 : 1);
})().catch((err) => {
    console.error('ERREUR', err);
    closeAll();
    process.exit(1);
});
