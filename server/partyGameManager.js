/**
 * Super LTN Party — gestionnaire de salons
 *
 * Le jeu oppose des **tables**, pas des joueurs. Une table = **un seul téléphone**,
 * celui du capitaine. Les coéquipiers n'entrent en scène que le temps d'une épreuve
 * à plusieurs, en scannant le QR du capitaine, et sont relâchés ensuite. C'est ce
 * qui permet aux gens d'arriver et de partir en cours de soirée sans jamais casser
 * la partie : seul le capitaine compte, et même son absence est amortie.
 *
 * Ce module ne connaît que l'état ; l'enchaînement des phases et les timers
 * autoritaires vivent dans `controllers/partyController.js`.
 */

const map = require('./party/map');
const tables = require('./party/tables');
const champions = require('./party/champions');
const minigames = require('./party/minigames');
const photos = require('./party/photos');
const RoomBase = require('./core/RoomBase');

const ROUND_CHOICES = [6, 10, 15];

const DEFAULT_SETTINGS = {
    totalRounds: 10,
    families: ['DIGITAL', 'CREATIVE'],
    maxTables: tables.MAX_TABLES,
};

class PartyGameManager extends RoomBase {
    constructor() {
        super({
            logTag: 'PARTY',
            codeFormat: 'num4',
            stateField: 'state',        // Super LTN Party nomme son état `state`
            endStates: ['FINAL'],
            endedTtlMs: 30 * 60 * 1000,
            staleTtlMs: 2 * 60 * 60 * 1000
        });
        this.ROUND_CHOICES = ROUND_CHOICES;
    }

    /**
     * La soirée expire sur l'inactivité seule : des téléphones peuvent rester
     * connectés sans que personne ne joue.
     */
    cleanupRooms() {
        const now = Date.now();
        for (const [code, room] of this.rooms) {
            const ref = room.lastActivity || room.createdAt || 0;
            if (room.state === 'FINAL' && (now - ref) > this.endedTtlMs) {
                this.deleteRoom(code);
                continue;
            }
            if ((now - ref) > this.staleTtlMs) this.deleteRoom(code);
        }
    }

    defaultSettings() {
        return { ...DEFAULT_SETTINGS };
    }

    /**
     * Garde-fous : l'hôte pilote l'interface, le serveur reste maître des bornes.
     */
    createRoom(hostId, settings = {}) {
        const merged = { ...DEFAULT_SETTINGS, ...settings };

        if (!ROUND_CHOICES.includes(merged.totalRounds)) merged.totalRounds = DEFAULT_SETTINGS.totalRounds;
        if (!Array.isArray(merged.families) || merged.families.length === 0) {
            merged.families = DEFAULT_SETTINGS.families;
        }
        merged.families = merged.families.filter((f) => minigames.availableFamilies().includes(f));
        if (merged.families.length === 0) merged.families = ['DIGITAL'];
        merged.maxTables = Math.min(Math.max(Number(merged.maxTables) || tables.MAX_TABLES, 2), tables.MAX_TABLES);

        return super.createRoom(hostId, merged);
    }

    createRoomState() {
        return {
            tables: new Map(),    // Map<tableId, TableData>
            ownership: map.createOwnership(),
            // LOBBY ROUND_INTRO GAME_VOTE CHAMPION_PICK ENROL REVEAL MINIGAME ROUND_RESULT FINAL
            roundIndex: 0,        // 0 tant que la partie n'a pas commencé
            contestedZoneId: null,
            lastZoneId: null,
            candidates: [],       // les épreuves soumises au vote de la manche
            gameVotes: {},        // tableId → minigameId
            gameElection: null,   // { how: 'voted' | 'drawn', name }
            minigameId: null,
            minigamePhase: null,
            minigamePhaseIndex: 0,
            minigameState: {},
            lastMinigameId: null,
            lastCroquisTheme: null,
            revealed: false,      // l'épreuve exacte est-elle dévoilée ?
            phaseEndsAt: null,
            phaseDuration: 0,
            votes: {},            // tableId votant → tableId voté
            ballot: {},           // identifiant de bulletin → tableId (ne sort jamais)
            roundResult: null,
            finalResult: null,
            timers: [],
        };
    }

    /** Les minuteurs de phase et les photos partent avec le salon. */
    onRoomDisposed(room) {
        this.clearTimers(room);
        photos.clearRoom(room.code);
    }

    clearTimers(room) {
        for (const timer of room.timers) clearTimeout(timer);
        room.timers = [];
    }

    /**
     * Arrivée d'un téléphone. La reconnexion se fait par pseudo, comme partout
     * ailleurs dans le hub : le capitaine retrouve sa table, son rôle et sa place.
     */
    /** La soirée accueille les arrivants à tout moment : c'est le principe. */
    canJoinMidGame() {
        return true;
    }

    sanitizeName(playerName) {
        return super.sanitizeName(playerName, 20);
    }

    createPlayer(playerId, playerName, avatar) {
        return {
            id: playerId,
            name: playerName,
            avatar: avatar || null,
            tableId: null,
            role: 'visitor',      // visitor → captain (crée une table) ou guest (scanne)
            disconnected: false,
            joinedAt: Date.now(),
        };
    }

    /** Le capitaine qui revient doit retrouver sa table et son inscription. */
    onPlayerRejoin(room, oldId, newId) {
        const player = room.players.get(newId);
        const table = player?.tableId ? room.tables.get(player.tableId) : null;
        if (!table) return;

        if (table.captainId === oldId) {
            table.captainId = newId;
            table.captainName = player.name;
            table.disconnectedAt = null; // le capitaine est revenu
        }
        if (table.enrolled.delete(oldId)) table.enrolled.add(newId);
    }

    // Le contrôleur Party lit `{ room, player, reconnected }` : `describeRejoin`
    // et `describeJoin` n'ajoutent donc rien au retour de RoomBase.
    describeRejoin() { return {}; }
    describeJoin() { return {}; }

    /**
     * Déconnexion. On ne supprime jamais un capitaine : il est marqué absent, sa
     * table entre en période de grâce, et il peut revenir sous le même pseudo.
     */
    removePlayer(playerId) {
        for (const [roomCode, room] of this.rooms) {
            if (room.hostId === playerId) {
                room.hostDisconnected = true;
                return { roomCode, room, isHost: true };
            }
            const player = room.players.get(playerId);
            if (!player) continue;

            room.lastActivity = Date.now();
            const table = player.tableId ? room.tables.get(player.tableId) : null;

            if (!table) {
                room.players.delete(playerId);
                return { roomCode, room, isHost: false, player, type: 'left' };
            }

            player.disconnected = true;
            table.enrolled.delete(playerId);

            const wasCaptain = table.captainId === playerId;
            if (wasCaptain && table.disconnectedAt === null) table.disconnectedAt = Date.now();

            return { roomCode, room, isHost: false, player, table, wasCaptain, type: 'disconnected' };
        }
        return null;
    }

    /** Score d'une table = valeur cumulée des territoires qu'elle contrôle. */
    tableScore(room, tableId) {
        return map.scoreOfTable(room.ownership, tableId);
    }

    /** Les tables encore en course pour la manche en cours. */
    activeTables(room) {
        return Array.from(room.tables.values()).filter((t) => !tables.isFrozen(t));
    }

    publicTables(room) {
        return Array.from(room.tables.values()).map((table) => ({
            id: table.id,
            name: table.name,
            color: table.color,
            captainId: table.captainId,
            captainName: table.captainName,
            roster: table.roster,
            enrolledCount: table.enrolled.size,
            votedGameId: room.gameVotes[table.id] || null,
            championName: table.championName,
            lastChampionName: table.lastChampionName,
            eligibleNames: champions.eligibleNames(table),
            zones: map.zonesOfTable(room.ownership, table.id),
            score: this.tableScore(room, table.id),
            absent: tables.isAbsent(table),
            frozen: tables.isFrozen(table),
            hasVoted: Object.prototype.hasOwnProperty.call(room.votes, table.id),
            bestChampion: champions.bestChampion(table),
        })).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    }

    publicPlayers(room) {
        return Array.from(room.players.values()).map((player) => {
            const table = player.tableId ? room.tables.get(player.tableId) : null;
            return {
                id: player.id,
                name: player.name,
                avatar: player.avatar,
                tableId: player.tableId,
                role: player.role,
                isCaptain: !!table && table.captainId === player.id,
                enrolled: !!table && table.enrolled.has(player.id),
                disconnected: player.disconnected,
            };
        });
    }

    /**
     * Instantané complet de la partie, unique source de vérité côté client.
     * Il ne contient jamais les jetons de table ni les photos : les premiers sont
     * secrets, les secondes trop lourdes pour un message diffusé en continu.
     */
    snapshot(room) {
        const game = room.minigameId ? minigames.get(room.minigameId) : null;
        const remaining = room.phaseEndsAt ? Math.max(0, room.phaseEndsAt - Date.now()) : 0;

        return {
            code: room.code,
            state: room.state,
            roundIndex: room.roundIndex,
            totalRounds: room.settings.totalRounds,
            families: room.settings.families,
            maxTables: room.settings.maxTables,
            materials: minigames.materialsFor(room.settings.families),
            viewBox: map.VIEW_BOX,
            zones: map.publicZones(room.ownership),
            contestedZoneId: room.contestedZoneId,
            contestedZone: room.contestedZoneId ? map.getZone(room.contestedZoneId) : null,
            tables: this.publicTables(room),
            players: this.publicPlayers(room),
            // Les trois épreuves soumises au vote, avec le décompte en direct.
            candidates: room.candidates.map((id) => ({
                ...minigames.publicCard(minigames.get(id)),
                votes: Object.values(room.gameVotes).filter((v) => v === id).length,
            })),
            gameVotes: room.gameVotes,
            gameElection: room.gameElection || null,
            discipline: game ? game.discipline : null,
            // L'épreuve exacte ne se dévoile qu'après le choix des champions.
            minigame: game && room.revealed ? {
                id: game.id,
                name: game.name,
                rule: game.rule,
                family: game.family,
                scope: game.scope,
                resolution: game.resolution,
                materials: game.materials,
                theme: room.minigameState?.theme || null,
            } : null,
            minigamePhase: room.minigamePhase,
            phaseRemainingMs: remaining,
            phaseDuration: room.phaseDuration,
            roundResult: room.roundResult,
            finalResult: room.finalResult,
            hostDisconnected: room.hostDisconnected,
        };
    }
}

module.exports = new PartyGameManager();
