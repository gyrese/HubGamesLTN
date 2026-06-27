/* ═══════════════════════════════════════════════════════════════
   funStats — corrélations absurdes de fin de partie
   ───────────────────────────────────────────────────────────────
   À partir des profils déclarés par les joueurs et de leur perf, on
   fabrique des « faits scientifiques » totalement bidons mais drôles.
   On calcule sur le QI quand il est disponible (fin de soirée), sinon
   sur le score (fin de série). Garantit toujours ≥ 3 punchlines dès
   qu'il y a 2 joueurs grâce à des fallbacks basés sur le classement.

   Les clés de catégorie doivent rester alignées avec le profil joueur
   (cf. gameManager.createEmptyProfile / PlayerView).
   ═══════════════════════════════════════════════════════════════ */

const CATEGORIES = [
    'favoriteAnimal', 'zodiacSign', 'coffeesPerDay', 'bedtime',
    'isSportive', 'painChocolat', 'pineapplePizza', 'hairColor',
];

const round = (n) => Math.round(n);

// Métrique d'un joueur : QI si calculé (fin de soirée), sinon score (fin de série).
function pickMetric(players) {
    const hasIq = players.some(p => typeof p.iq === 'number');
    return {
        hasIq,
        unit: hasIq ? 'de QI' : 'pts',
        value: (p) => (hasIq ? (p.iq || 0) : (p.score || 0)),
    };
}

// Regroupe les joueurs par valeur d'une catégorie → { value: { avg, count, values[] } }
function groupBy(players, category, metric) {
    const groups = {};
    for (const p of players) {
        const v = p.profile && p.profile[category];
        if (!v) continue;
        (groups[v] = groups[v] || { sum: 0, count: 0, values: [] });
        const m = metric.value(p);
        groups[v].sum += m;
        groups[v].count += 1;
        groups[v].values.push(m);
    }
    for (const v of Object.keys(groups)) groups[v].avg = groups[v].sum / groups[v].count;
    return groups;
}

// Duel entre deux valeurs d'une même catégorie.
function duel(groups, a, b, winTpl, unit, minDiff = 1) {
    if (!groups[a] || !groups[b]) return null;
    const diff = round(Math.abs(groups[a].avg - groups[b].avg));
    if (diff < minDiff) return null;
    const winner = groups[a].avg >= groups[b].avg ? a : b;
    return winTpl(winner, diff, unit);
}

// Meilleure valeur d'une catégorie (avec un minimum d'effectif).
function bestOf(groups, minCount = 1) {
    const entries = Object.entries(groups).filter(([, g]) => g.count >= minCount);
    if (!entries.length) return null;
    entries.sort((x, y) => y[1].avg - x[1].avg);
    return { value: entries[0][0], data: entries[0][1] };
}

function calculateStats(players) {
    const list = (players || []).filter(p => p && p.profile);
    const metric = pickMetric(list);
    const unit = metric.unit;
    const facts = [];

    const G = {};
    for (const cat of CATEGORIES) G[cat] = groupBy(list, cat, metric);

    // 1. Chat vs Chien — le grand classique.
    {
        const f = duel(G.favoriteAnimal, 'Chat', 'Chien',
            (w, d) => w === 'Chat'
                ? `🐱 La Team Chat domine la Team Chien de ${d} ${unit}. La science a tranché.`
                : `🐶 La Team Chien écrase la Team Chat de ${d} ${unit}. Désolé les félins.`,
            unit, 1);
        if (f) facts.push(f);
    }

    // 2. Pain au chocolat vs Chocolatine — la guerre civile.
    {
        const f = duel(G.painChocolat, 'Pain au chocolat', 'Chocolatine',
            (w, d) => `🥐 Team « ${w} » l'emporte de ${d} ${unit}. Le débat national est clos (jusqu'à demain).`,
            unit, 1);
        if (f) facts.push(f);
    }

    // 3. Ananas sur la pizza.
    {
        const f = duel(G.pineapplePizza, 'Team Ananas', 'Jamais',
            (w, d) => w === 'Team Ananas'
                ? `🍍 Les mangeurs d'ananas-pizza ont ${d} ${unit} de plus. Des génies incompris.`
                : `🍕 Ceux qui refusent l'ananas mènent de ${d} ${unit}. Le bon goût paie.`,
            unit, 1);
        if (f) facts.push(f);
    }

    // 4. Sportifs vs canapé.
    {
        const f = duel(G.isSportive, 'Athlète', 'Canapé',
            (w, d) => w === 'Athlète'
                ? `🏃 Les sportifs caracolent à +${d} ${unit}. Le sport rend (apparemment) intelligent.`
                : `🛋️ La Team Canapé surclasse les sportifs de ${d} ${unit}. Bougez moins, pensez plus.`,
            unit, 1);
        if (f) facts.push(f);
    }

    // 5. Couche-tard vs couche-tôt.
    {
        const f = duel(G.bedtime, 'Couche-tard', 'Couche-tôt',
            (w, d) => w === 'Couche-tard'
                ? `🌙 Les couche-tard brillent de ${d} ${unit} de plus. La nuit porte conseil.`
                : `🌅 Les lève-tôt dominent de ${d} ${unit}. Le ver est dans la pomme.`,
            unit, 1);
        if (f) facts.push(f);
    }

    // 6. Café — meilleur dosage.
    {
        const best = bestOf(G.coffeesPerDay, 1);
        if (best) facts.push(`☕ Les buveurs de ${best.value} café(s)/jour culminent à ${round(best.data.avg)} ${unit}. Corrélation = causalité, c'est prouvé.`);
    }

    // 7. Astro — le signe le plus « brillant ».
    {
        const best = bestOf(G.zodiacSign, 1);
        if (best) facts.push(`♈ Les ${best.value} plafonnent à ${round(best.data.avg)} ${unit}. Les astres ne mentent jamais.`);
    }

    // 8. Couleur de cheveux.
    {
        const best = bestOf(G.hairColor, 1);
        if (best) facts.push(`💇 Avantage capillaire : les ${String(best.value).toLowerCase()}(e)s mènent avec ${round(best.data.avg)} ${unit}.`);
    }

    // ── Fallbacks garantis (basés sur le classement réel) ──────────
    if (list.length >= 2) {
        const sorted = list.slice().sort((a, b) => metric.value(b) - metric.value(a));
        const top = sorted[0];
        const last = sorted[sorted.length - 1];
        const gap = round(metric.value(top) - metric.value(last));

        const fallbacks = [];
        if (top && top.name) fallbacks.push(`👑 ${top.name} écrase la soirée avec ${round(metric.value(top))} ${unit}. Inclinez-vous.`);
        if (gap > 0) fallbacks.push(`📏 ${gap} ${unit} séparent le 1er du dernier. La vie est injuste.`);
        if (last && last.name) fallbacks.push(`🫶 ${last.name} ferme la marche mais reste dans nos cœurs.`);
        fallbacks.push(`🔬 Étude exclusive menée sur ${list.length} cobaye(s) consentant(s) ce soir.`);

        for (const f of fallbacks) {
            if (facts.length >= 5) break;
            if (facts.length < 3 || !facts.includes(f)) facts.push(f);
        }
    }

    return { correlations: facts.slice(0, 5) };
}

module.exports = { calculateStats, CATEGORIES };
