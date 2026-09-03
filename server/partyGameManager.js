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

const ROUND_CHOICES = [6, 10, 15];

const DEFAULT_SETTINGS = {
    totalRounds: 10,
    families: ['DIGITAL', 'CREATIVE'],
    maxTables: tables.MAX_TABLES,
};

class PartyGameManager {
    constructor() {
        this.rooms = new Map(); // Map<roomCode, PartyRoom>
        this.ROUND_CHOICES = ROUND_CHOICES;
        setInterval(() => this.cleanupRooms(), 10 * 60 * 1000);
        console.log('[PARTY] Game manager initialized');
    }

    cleanupRooms() {
        const now = Date.now();
        const ENDED_TTL = 30 * 60 * 1000;
        const STALE_TTL = 2 * 60 * 60 * 1000;
        for (const [code, room] of this.rooms) {
            const ref = room.lastActivity || 0;
            if (room.state === 'FINAL' && (now - ref) > ENDED_TTL) {
                this.deleteRoom(code);
                continue;
            }
            if ((now - ref) > STALE_TTL) this.deleteRoom(code);
        }
    }

    generateRoomCode() {
        let code;
        do {
            code = Math.floor(1000 + Math.random() * 9000).toString();
        } while (this.rooms.has(code));
        return code;
    }

    createRoom(hostId, settings = {}) {
        const roomCode = this.generateRoomCode();
        const merged = { ...DEFAULT_SETTINGS, ...settings };

        // Garde-fous : l'hôte pilote l'interface, le serveur reste maître des bornes.
        if (!ROUND_CHOICES.includes(merged.totalRounds)) merged.totalRounds = DEFAULT_SETTINGS.totalRounds;
        if (!Array.isArray(merged.families) || merged.families.length === 0) {
            merged.families = DEFAULT_SETTINGS.families;
        }
        merged.families = merged.families.filter((f) => minigames.availableFamilies().includes(f));
        if (merged.families.length === 0) merged.families = ['DIGITAL'];
        merged.maxTables = Math.min(Math.max(Number(merged.maxTables) || tables.MAX_TABLES, 2), tables.MAX_TABLES);

        this.rooms.set(roomCode, {
            code: roomCode,
            hostId,
            hostDisconnected: false,
            players: new Map(),   // Map<socketId, PlayerData>
            tables: new Map(),    // Map<tableId, TableData>
            ownership: map.createOwnership(),
            // LOBBY ROUND_INTRO GAME_VOTE CHAMPION_PICK ENROL REVEAL MINIGAME ROUND_RESULT FINAL
            state: 'LOBBY',
            settings: merged,
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
            lastActivity: Date.now(),
        });

        console.log(`[PARTY] Room created: ${roomCode}`);
        return roomCode;
    }

    getRoom(roomCode) {
        return this.rooms.get(roomCode);
    }

    deleteRoom(roomCode) {
        const room = this.rooms.get(roomCode);
        if (room) this.clearTimers(room);
        photos.clearRoom(roomCode);
        if (this.rooms.delete(roomCode)) console.log(`[PARTY] Room ${roomCode} deleted`);
    }

    clearTimers(room) {
        for (const timer of room.timers) clearTimeout(timer);
        room.timers = [];
    }

    /**
     * Arrivée d'un téléphone. La reconnexion se fait par pseudo, comme partout
     * ailleurs dans le hub : le capitaine retrouve sa table, son rôle et sa place.
     */
    joinRoom(roomCode, playerId, playerName, avatar) {
        const room = this.rooms.get(roomCode);
        if (!room) return { error: 'Salon introuvable' };
        room.lastActivity = Date.now();

        const name = (playerName || '').trim().slice(0, 20);
        if (!name) return { error: 'Pseudo invalide' };

        for (const [id, player] of room.players) {
            if (player.name.toLowerCase() !== name.toLowerCase()) continue;

            // Reconnexion : le socket change, la place reste.
            room.players.delete(id);
            player.id = playerId;
            player.disconnected = false;
            if (avatar) player.avatar = avatar;
            room.players.set(playerId, player);

            const table = player.tableId ? room.tables.get(player.tableId) : null;
            if (table) {
                if (table.captainId === id) {
                    table.captainId = playerId;
                    table.captainName = player.name;
                    table.disconnectedAt = null; // le capitaine est revenu
                }
                if (table.enrolled.delete(id)) table.enrolled.add(playerId);
            }

            return { room, player, reconnected: true };
        }

        // Nouvelle arrivée : possible à tout moment de la soirée, c'est le principe.
        const player = {
            id: playerId,
            name,
            avatar: avatar || null,
            tableId: null,
            role: 'visitor',      // visitor → captain (crée une table) ou guest (scanne)
            disconnected: false,
            joinedAt: Date.now(),
        };
        room.players.set(playerId, player);
        return { room, player, reconnected: false };
    }

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
