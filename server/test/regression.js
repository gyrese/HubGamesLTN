/**
 * Non-régression du cycle de vie des salons, pour les 7 jeux.
 *
 * Ce fichier est le filet de sécurité du chantier « socle commun » : il fige le
 * comportement observable AVANT toute extraction, pour que la migration de
 * chaque gestionnaire puisse être vérifiée et non supposée.
 *
 * Usage :  node test/regression.js  [nom-du-jeu]
 */

const { startServer, connect, emit, maybe, wait, closeAll, ok, section, report } = require('./harness');

/* ── Description des 7 jeux ────────────────────────────────────────── */

/**
 * `createArgs` : le quiz attend `(callback)`, les autres `(payload, callback)`.
 * `codeFormat` : IO et Party émettent des codes numériques à 4 chiffres.
 */
const GAMES = [
    {
        name: 'quiz',
        controller: '../controllers/quizController',
        manager: '../gameManager',
        create: 'create-room',
        join: 'join-room',
        createArgs: null,           // callback en premier argument
        codeFormat: 'num4'
    },
    {
        name: 'geo',
        allowsMidGameJoin: true,
        signalsLateJoin: true,
        controller: '../controllers/geoController',
        manager: '../geoGameManager',
        create: 'geo-create-room',
        join: 'geo-join-room',
        createArgs: { settings: {} },
        codeFormat: 'alpha6'
    },
    {
        name: 'draw',
        allowsMidGameJoin: true,
        signalsLateJoin: true,
        controller: '../controllers/drawController',
        manager: '../drawGameManager',
        create: 'draw-create-room',
        join: 'draw-join-room',
        createArgs: { settings: {} },
        codeFormat: 'alpha6'
    },
    {
        name: 'color',
        allowsMidGameJoin: true,
        signalsLateJoin: true,
        controller: '../controllers/colorController',
        manager: '../colorGameManager',
        create: 'color-create-room',
        join: 'color-join-room',
        createArgs: { settings: {} },
        codeFormat: 'alpha6'
    },
    {
        name: 'fakeartist',
        controller: '../controllers/fakeArtistController',
        manager: '../fakeArtistGameManager',
        create: 'fakeartist-create-room',
        join: 'fakeartist-join-room',
        createArgs: { settings: {} },
        codeFormat: 'alpha6'
    },
    {
        name: 'party',
        allowsMidGameJoin: true,
        controller: '../controllers/partyController',
        manager: '../partyGameManager',
        create: 'party-create-room',
        join: 'party-join-room',
        createArgs: { settings: {} },
        codeFormat: 'num4'
    },
    {
        name: 'io',
        allowsMidGameJoin: true,
        controller: '../controllers/ioController',
        manager: '../ioGameManager',
        create: 'io-create-room',
        join: 'io-join-room',
        createArgs: { settings: {} },
        codeFormat: 'num4'
    }
];

const CODE_SHAPES = {
    alpha6: /^[A-HJ-NP-Z2-9]{6}$/,
    num4: /^[0-9]{4}$/
};

/* ── Scénario appliqué à chaque jeu ────────────────────────────────── */

async function testGame(game) {
    section(`${game.name.toUpperCase()}`);

    const controller = require(game.controller);
    const manager = require(game.manager);
    const server = await startServer([controller]);

    try {
        /* 1. Création du salon */
        const host = await connect(server.port);
        const created = game.createArgs === null
            ? await emit(host, game.create, undefined)
            : await emit(host, game.create, game.createArgs);

        const code = created?.roomCode;
        ok(`${game.name}: salon créé`, !!code, JSON.stringify(created));
        if (!code) return;

        ok(`${game.name}: format de code préservé (${game.codeFormat})`,
            CODE_SHAPES[game.codeFormat].test(code), `reçu "${code}"`);

        const room = manager.getRoom(code);
        ok(`${game.name}: salon présent côté gestionnaire`, !!room);
        ok(`${game.name}: hôte enregistré`, room?.hostId === host.id);

        /* 2. Deux joueurs rejoignent */
        const alice = await connect(server.port);
        const joinA = await emit(alice, game.join, {
            roomCode: code, playerName: 'Alice', avatar: '/avatars/avatar_1.webp'
        });
        ok(`${game.name}: Alice rejoint`, !joinA?.error, joinA?.error);

        const bob = await connect(server.port);
        const joinB = await emit(bob, game.join, {
            roomCode: code, playerName: 'Bob', avatar: '/avatars/avatar_2.webp'
        });
        ok(`${game.name}: Bob rejoint`, !joinB?.error, joinB?.error);

        await wait(150);
        ok(`${game.name}: 2 joueurs dans le salon`, room.players.size === 2,
            `taille=${room.players.size}`);

        /* 3. Code inconnu refusé */
        const ghost = await connect(server.port);
        const badCode = game.codeFormat === 'num4' ? '0000' : 'ZZZZZZ';
        const joinBad = await emit(ghost, game.join, {
            roomCode: badCode, playerName: 'Fantome', avatar: null
        });
        ok(`${game.name}: code inconnu rejeté`, !!joinBad?.error, JSON.stringify(joinBad));

        /* 3bis. Politique d'arrivée en cours de partie — propre à chaque jeu */
        const savedState = room.gameState;
        room.gameState = 'PLAYING';
        const latecomer = await connect(server.port);
        const joinLate = await emit(latecomer, game.join, {
            roomCode: code, playerName: 'Tardif', avatar: null
        });
        if (game.allowsMidGameJoin) {
            ok(`${game.name}: arrivée en cours acceptée`, !joinLate?.error, joinLate?.error);
            // Les jeux à manches signalent l'arrivée tardive pour rattraper les
            // tableaux de scores ; Party et IO sont à flux continu et n'ont pas
            // cette notion.
            if (game.signalsLateJoin) {
                ok(`${game.name}: arrivée signalée comme tardive`, joinLate?.lateJoin === true);
            }
            room.players.delete(latecomer.id);
        } else {
            ok(`${game.name}: arrivée en cours refusée`, !!joinLate?.error);
        }
        latecomer.close();
        room.gameState = savedState;
        await wait(150);

        /* 4. Reconnexion par pseudo : Alice revient sur une nouvelle socket */
        const oldAliceId = alice.id;
        alice.close();
        await wait(250);

        const alice2 = await connect(server.port);
        const rejoin = await emit(alice2, game.join, {
            roomCode: code, playerName: 'Alice', avatar: '/avatars/avatar_1.webp'
        });
        ok(`${game.name}: Alice se reconnecte`, !rejoin?.error, rejoin?.error);
        await wait(150);

        ok(`${game.name}: toujours 2 joueurs après reconnexion`,
            room.players.size === 2, `taille=${room.players.size}`);
        ok(`${game.name}: nouvel identifiant adopté`,
            room.players.has(alice2.id) && !room.players.has(oldAliceId));

        const aliceData = room.players.get(alice2.id);
        ok(`${game.name}: Alice n'est plus marquée absente`,
            aliceData && !aliceData.disconnected);

        /* 5. Déconnexion en lobby : Bob s'en va */
        bob.close();
        await wait(300);
        const bobGone = !room.players.has(bob.id) || room.players.get(bob.id)?.disconnected;
        ok(`${game.name}: départ de Bob pris en compte`, bobGone);

        /* 6. Le salon survit à tout ça */
        ok(`${game.name}: salon toujours vivant`, !!manager.getRoom(code));

        /* 7. Suppression */
        manager.deleteRoom(code);
        ok(`${game.name}: salon supprimé`, !manager.getRoom(code));

    } finally {
        closeAll();
        await server.close();
        await wait(120);
    }
}

/* ── Exécution ─────────────────────────────────────────────────────── */

(async () => {
    const only = process.argv[2];
    const list = only ? GAMES.filter(g => g.name === only) : GAMES;

    if (list.length === 0) {
        console.error(`Jeu inconnu : "${only}". Choix : ${GAMES.map(g => g.name).join(', ')}`);
        process.exit(1);
    }

    console.log(`\n\x1b[1mNON-RÉGRESSION — cycle de vie des salons\x1b[0m`);
    console.log(`${list.length} jeu(x) : ${list.map(g => g.name).join(', ')}`);

    for (const game of list) {
        try {
            await testGame(game);
        } catch (err) {
            ok(`${game.name}: scénario complet`, false, err.message);
        }
    }

    const green = report();
    process.exit(green ? 0 : 1);
})();
