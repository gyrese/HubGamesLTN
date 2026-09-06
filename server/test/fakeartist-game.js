/**
 * Partie complète de Fake Artist, de la création au verdict.
 * Vérifie que la migration vers RoomBase n'a rien changé au jeu lui-même.
 */
const { startServer, connect, once, emit, wait, closeAll, ok, section, report } = require('./harness');
const ctrl = require('../controllers/fakeArtistController');
const mgr = require('../fakeArtistGameManager');

(async () => {
  const server = await startServer([ctrl]);
  try {
    section('Partie complète');
    const host = await connect(server.port);
    const { roomCode } = await emit(host, 'fakeartist-create-room', { settings: { roundsCount: 1, timePerRound: 60 } });
    ok('salon créé', !!roomCode);

    const players = [];
    for (const n of ['Alice', 'Bob', 'Carla']) {
      const p = await connect(server.port);
      const r = await emit(p, 'fakeartist-join-room', { roomCode, playerName: n, avatar: '/a.webp' });
      p._color = r.color;
      players.push(p);
    }
    ok('3 joueurs', players.length === 3);
    ok('couleurs distinctes', new Set(players.map(p => p._color.value)).size === 3);

    const rolesP = players.map(p => once(p, 'fakeartist-role-assigned'));
    host.emit('fakeartist-start-game', { roomCode });
    const roles = await Promise.all(rolesP);
    const impostors = roles.filter(r => r.role === 'impostor');
    ok('un seul imposteur', impostors.length === 1);
    ok('le mot ne fuite pas vers l\'imposteur', impostors[0].secretWord === null);
    ok('les artistes ont le mot', roles.filter(r => r.role === 'artist').every(r => !!r.secretWord));

    const room = mgr.getRoom(roomCode);

    section('Dessin');
    for (const id of [...room.drawQueue]) {
      const d = players.find(p => p.id === id);
      await emit(d, 'fakeartist-validate-stroke', { roomCode, stroke: { size: 8, points: [{x:.2,y:.2},{x:.8,y:.8}] } });
      await wait(120);
    }
    ok('phase de vote atteinte', room.gameState === 'VOTING');
    ok('3 traits enregistrés', room.canvasHistory.length === 3);
    ok('couleur imposée par le serveur',
       room.canvasHistory.every(s => players.some(p => p._color.value === s.color)));

    section('Vote et verdict');
    const impId = room.impostorIds[0];
    const selfVote = await emit(players[0], 'fakeartist-submit-vote', { roomCode, votedId: players[0].id });
    ok('auto-vote refusé', !!selfVote.error);

    const revealP = once(players[0], 'fakeartist-game-state-updated');
    for (const p of players) {
      const target = p.id === impId ? players.find(x => x.id !== impId).id : impId;
      await emit(p, 'fakeartist-submit-vote', { roomCode, votedId: target });
    }
    const reveal = await revealP;
    ok('REVEAL diffusé', reveal.gameState === 'REVEAL');
    ok('imposteur démasqué', reveal.isImpostorAccused === true);

    const guessP = once(players[0], 'fakeartist-game-state-updated');
    host.emit('fakeartist-skip-reveal', { roomCode });
    ok('GUESSING atteint', (await guessP).gameState === 'GUESSING');

    const hostGuessP = once(host, 'fakeartist-guess-received');
    const imp = players.find(p => p.id === impId);
    await emit(imp, 'fakeartist-submit-guess', { roomCode, guess: room.currentWord.word });
    const g = await hostGuessP;
    ok('bonne réponse détectée', g.autoCorrect === true);

    const endP = once(players[0], 'fakeartist-game-state-updated');
    host.emit('fakeartist-host-decision', { roomCode, isCorrect: true });
    const end = await endP;
    ok('GAME_END diffusé', end.gameState === 'GAME_END');
    ok('imposteur vainqueur', end.winner === 'impostor');
    ok('mot révélé en fin de partie', end.secretWord === room.currentWord.word);

    section('Sécurité et relance');
    const before = room.gameState;
    players[0].emit('fakeartist-restart-game', { roomCode });
    await wait(250);
    ok('relance refusée aux joueurs', room.gameState === before);

    const lobbyP = once(players[0], 'fakeartist-game-state-updated');
    host.emit('fakeartist-restart-game', { roomCode });
    const lobby = await lobbyP;
    ok('retour au lobby', lobby.gameState === 'LOBBY');
    ok('scores conservés', lobby.players.some(p => p.score > 0));
    ok('couleurs stables entre manches',
       lobby.players.every(lp => players.find(p => p.id === lp.id)?._color.value === lp.color.value));
  } catch (e) {
    ok('scénario complet', false, e.message);
  } finally {
    closeAll();
    await server.close();
  }
  process.exit(report() ? 0 : 1);
})();
