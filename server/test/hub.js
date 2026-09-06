/**
 * PASSEPORT — test de bout en bout.
 *
 * Le critère d'acceptation du chantier : trois joueurs saisissent un code une
 * seule fois, l'hôte enchaîne trois jeux différents, et personne ne ressaisit
 * jamais son pseudo ni ne rechoisit son avatar.
 *
 * Usage :  node test/hub.js
 */

const { startServer, connect, once, maybe, emit, wait, closeAll, ok, section, report } = require('./harness');

const hubController = require('../controllers/hubController');
const hub = require('../core/hubSession');

const CONTROLLERS = [
    hubController,
    require('../controllers/quizController'),
    require('../controllers/drawController'),
    require('../controllers/fakeArtistController'),
    require('../controllers/colorController'),
    require('../controllers/geoController'),
    require('../controllers/partyController'),
    require('../controllers/ioController')
];

(async () => {
    const server = await startServer(CONTROLLERS);

    try {
        /* ── Ouverture ─────────────────────────────────────────────── */
        section('Ouverture de la soirée');

        const host = await connect(server.port);
        const created = await emit(host, 'hub-create-session', { name: 'Jeudi aux Toiles Noires' });
        const hubCode = created.hubCode;

        ok('soirée ouverte', created.success === true && !!hubCode);
        ok('code à 6 caractères lisibles', /^[A-HJ-NP-Z2-9]{6}$/.test(hubCode));
        // On vérifie le contenu du catalogue plutôt que sa taille : compter les
        // jeux ferait échouer ce test à chaque nouveau jeu du hub, sans rien
        // révéler de cassé.
        const gameKeys = (created.games || []).map(g => g.key);
        ok('catalogue des jeux fourni', gameKeys.length > 0);
        ok('le catalogue couvre tous les jeux du hub',
            ['quiz', 'geo', 'draw', 'color', 'fakeartist', 'party', 'io', 'dance']
                .every(k => gameKeys.includes(k)),
            gameKeys.join(', '));
        ok('aucun jeu en cours au départ', created.session.currentGame === null);

        /* ── Entrée des joueurs ────────────────────────────────────── */
        section('Les joueurs entrent — une seule fois');

        const people = [
            { deviceId: 'dev-alice', name: 'Alice', avatar: '/avatars/avatar_3.webp' },
            { deviceId: 'dev-bob',   name: 'Bob',   avatar: '/avatars/avatar_7.webp' },
            { deviceId: 'dev-carla', name: 'Carla', avatar: '/avatars/avatar_9.webp' }
        ];

        for (const p of people) {
            p.socket = await connect(server.port);
            const res = await emit(p.socket, 'hub-join', {
                hubCode, deviceId: p.deviceId, name: p.name, avatar: p.avatar
            });
            ok(`${p.name} rejoint la soirée`, res.success === true, res.error);
            p.joined = res;
        }

        ok('identité mémorisée dès l\'entrée',
            people.every(p => p.joined.identity?.name === p.name));
        ok('aucune destination tant qu\'aucun jeu n\'est lancé',
            people.every(p => p.joined.destination === null));

        const session = hub.getSession(hubCode);
        ok('3 participants côté serveur', session.participants.size === 3);

        /* ── Code inconnu ──────────────────────────────────────────── */
        const stray = await connect(server.port);
        const bad = await emit(stray, 'hub-join', {
            hubCode: 'ZZZZZZ', deviceId: 'dev-x', name: 'Egare', avatar: null
        });
        ok('code de soirée inconnu rejeté', !!bad.error);

        /* ── Enchaînement de trois jeux ────────────────────────────── */
        section('Trois jeux enchaînés, zéro ressaisie');

        const sequence = [
            { key: 'quiz',       path: '/quiz/play' },
            { key: 'fakeartist', path: '/fakeartist/play' },
            { key: 'draw',       path: '/draw/play' }
        ];

        for (const step of sequence) {
            // Tous les téléphones écoutent la bascule
            const switchedP = people.map(p => once(p.socket, 'hub-game-switched'));
            const res = await emit(host, 'hub-switch-game', { hubCode, gameKey: step.key });
            ok(`${step.key} : lancé par l'hôte`, res.success === true, res.error);

            const notices = await Promise.all(switchedP);
            ok(`${step.key} : les 3 téléphones sont prévenus`,
                notices.length === 3 && notices.every(n => n.gameKey === step.key));
            ok(`${step.key} : destination correcte`,
                notices.every(n => n.path === `${step.path}/${res.roomCode}`),
                notices[0]?.path);

            // Le salon existe vraiment côté gestionnaire du jeu
            const manager = {
                quiz: require('../gameManager'),
                fakeartist: require('../fakeArtistGameManager'),
                draw: require('../drawGameManager')
            }[step.key];
            ok(`${step.key} : salon réellement créé`, !!manager.getRoom(res.roomCode));
            ok(`${step.key} : l'écran hôte possède le salon`,
                manager.getRoom(res.roomCode).hostId === host.id);

            step.roomCode = res.roomCode;
        }

        ok('les 3 salons sont distincts',
            new Set(sequence.map(s => s.roomCode)).size === 3);
        ok('historique de la soirée tenu',
            hub.describeSession(hubCode).gamesPlayed === 2);

        /* ── L'identité a survécu aux trois jeux ───────────────────── */
        section('L\'identité traverse toute la soirée');

        for (const p of people) {
            const view = await emit(p.socket, 'hub-peek', { hubCode, deviceId: p.deviceId });
            ok(`${p.name} : pseudo conservé`, view.identity?.name === p.name);
            ok(`${p.name} : avatar conservé`, view.identity?.avatar === p.avatar);
        }

        /* ── Reprise après coupure ─────────────────────────────────── */
        section('Un téléphone qui redémarre retrouve sa place');

        const alice = people[0];
        alice.socket.close();
        await wait(300);

        const aliceBack = await connect(server.port);
        // Le téléphone ne renvoie QUE son deviceId : ni pseudo, ni avatar.
        const back = await emit(aliceBack, 'hub-join', { hubCode, deviceId: alice.deviceId });
        ok('retour reconnu comme tel', back.returning === true);
        ok('pseudo restitué sans ressaisie', back.identity?.name === 'Alice');
        ok('avatar restitué sans ressaisie', back.identity?.avatar === alice.avatar);
        ok('renvoyée vers le jeu en cours', back.destination?.path === `/draw/play/${sequence[2].roomCode}`);
        ok('toujours 3 participants', hub.getSession(hubCode).participants.size === 3);
        alice.socket = aliceBack;

        /* ── Changement d'identité volontaire ──────────────────────── */
        section('Changer de pseudo en cours de soirée');

        const renamed = await emit(alice.socket, 'hub-set-identity', {
            hubCode, deviceId: alice.deviceId, name: 'Alicia'
        });
        ok('pseudo modifié', renamed.identity?.name === 'Alicia');
        ok('avatar inchangé', renamed.identity?.avatar === alice.avatar);

        /* ── Autorisations ─────────────────────────────────────────── */
        section('Seul l\'hôte pilote');

        const usurp = await emit(people[1].socket, 'hub-switch-game', { hubCode, gameKey: 'io' });
        ok('un joueur ne peut pas changer de jeu', !!usurp.error);
        ok('le jeu en cours n\'a pas bougé',
            hub.getSession(hubCode).currentGame === 'draw');

        const badGame = await emit(host, 'hub-switch-game', { hubCode, gameKey: 'echecs' });
        ok('jeu inconnu refusé', !!badGame.error);

        const usurpKick = await emit(people[1].socket, 'hub-kick', {
            hubCode, deviceId: people[2].deviceId
        });
        ok('un joueur ne peut expulser personne', !!usurpKick.error);

        /* ── Retour au salon d'attente ─────────────────────────────── */
        section('Retour au salon de la soirée');

        const backP = people.map(p => maybe(p.socket, 'hub-returned-lobby', 2000));
        const lobby = await emit(host, 'hub-return-lobby', { hubCode });
        ok('retour au lobby accepté', lobby.success === true);
        ok('les téléphones sont prévenus', (await Promise.all(backP)).filter(Boolean).length === 3);
        ok('plus aucun jeu en cours', hub.getSession(hubCode).currentGame === null);
        ok('les 3 parties sont à l\'historique', hub.describeSession(hubCode).gamesPlayed === 3);

        /* ── Expulsion et fermeture ────────────────────────────────── */
        section('Expulsion et fermeture');

        const kickedP = maybe(people[2].socket, 'hub-kicked', 2000);
        const kick = await emit(host, 'hub-kick', { hubCode, deviceId: people[2].deviceId });
        ok('hôte expulse un participant', kick.success === true);
        ok('le téléphone expulsé est prévenu', (await kickedP) !== null);
        ok('participant retiré', hub.getSession(hubCode).participants.size === 2);

        const closedP = people.slice(0, 2).map(p => maybe(p.socket, 'hub-session-closed', 2000));
        const closed = await emit(host, 'hub-close-session', { hubCode });
        ok('soirée fermée', closed.success === true);
        ok('les téléphones sont prévenus', (await Promise.all(closedP)).filter(Boolean).length === 2);
        ok('soirée effacée', !hub.getSession(hubCode));

        /* ── Reconnexion de l'écran hôte ───────────────────────────── */
        section('L\'écran hôte survit à un rechargement');

        const h2 = await connect(server.port);
        const s2 = await emit(h2, 'hub-create-session', { name: 'Test reprise' });
        const code2 = s2.hubCode;
        await emit(people[0].socket, 'hub-join', {
            hubCode: code2, deviceId: 'dev-alice', name: 'Alice', avatar: '/a.webp'
        });

        h2.close();
        await wait(300);

        const h3 = await connect(server.port);
        const resumed = await emit(h3, 'hub-host-reconnect', { hubCode: code2 });
        ok('écran hôte reconnecté', resumed.success === true, resumed.error);
        ok('participants retrouvés', resumed.session.participants.length === 1);
        ok('la soirée a bien changé de socket hôte', hub.getSession(code2).hostId === h3.id);

        const gone = await emit(h3, 'hub-host-reconnect', { hubCode: 'AAAAAA' });
        ok('reconnexion à une soirée inexistante refusée', !!gone.error);

    } catch (err) {
        ok('scénario complet', false, err.message);
        console.error(err);
    } finally {
        closeAll();
        await server.close();
    }

    process.exit(report() ? 0 : 1);
})();
