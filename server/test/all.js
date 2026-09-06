/**
 * Lance toutes les suites de test du serveur, l'une après l'autre.
 * Usage :  npm test   (ou  node test/all.js)
 */
const { spawnSync } = require('child_process');
const path = require('path');

const SUITES = [
    ['Socle RoomBase', 'roombase.js'],
    ['Cycle de vie des 8 jeux', 'regression.js'],
    ['Fake Artist — partie complète', 'fakeartist-game.js'],
    ['Passeport de soirée', 'hub.js'],
    ['Dance Dance — rythme et anti-triche', 'dance.js'],
    ['Dance Dance — partie complète', 'dance-game.js']
];

let failed = 0;
for (const [label, file] of SUITES) {
    console.log(`\n\x1b[1m━━━ ${label} ━━━\x1b[0m`);
    const res = spawnSync(process.execPath, [path.join(__dirname, file)], {
        stdio: 'inherit',
        cwd: path.join(__dirname, '..')
    });
    if (res.status !== 0) failed++;
}

console.log(`\n${'═'.repeat(58)}`);
if (failed === 0) {
    console.log('\x1b[32m✓ Toutes les suites sont vertes\x1b[0m');
} else {
    console.log(`\x1b[31m✗ ${failed} suite(s) en échec\x1b[0m`);
}
process.exit(failed === 0 ? 0 : 1);
