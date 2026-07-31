## Plan — Refonte Interface Manager

### Objectif
Remplacer la Card modale centrée (`max-w-md`) par un dashboard plein écran en CSS Grid, sans scroll, avec gestion de dossiers intégrée.

### Layout cible
```
┌─────────────────────────────────────────────────────────┐
│  [Logo ~h-20 centré]              [🌐 Lang] [⎋ Logout]  │  ← Header glassmorphism
├──────────────┬──────────────────────────────────────────┤
│              │  [🔍 Recherche]                [+ ] [↑]  │
│  📁 Tous     │  ┌──────┐ ┌──────┐ ┌──────┐            │
│  📁 Maths    │  │Image │ │Image │ │Image │  CSS Grid   │
│  📁 Science  │  │Titre │ │Titre │ │Titre │  auto-fill  │
│  📁 Culture  │  └──────┘ └──────┘ └──────┘            │
│  ──────────  │  ┌──────┐ ┌──────┐                      │
│  🏷 Histoire │  │Image │ │Image │                      │
│  🏷 Fun      │  │Titre │ │Titre │                      │
│  ──────────  │  └──────┘ └──────┘                      │
│  📊 Résultats│                                          │
├──────────────┴──────────────────────────────────────────┤
│  Quiz sélectionné : [Nom]      [▶ Démarrer la partie]   │  ← Footer action
└─────────────────────────────────────────────────────────┘
```

### Fichiers à modifier / créer
1. `components/Background.tsx` — opacité image fond : 0.5 → 0.65 ✅
2. `pages/manager/config.tsx` — remplacer `<Background>` par layout custom plein écran ✅
3. `features/manager/components/ManagerDashboard/index.tsx` — nouveau composant principal ✅
4. `features/manager/components/ManagerDashboard/DashboardSidebar.tsx` — sidebar dossiers/tags/résultats ✅
5. `features/manager/components/ManagerDashboard/QuizzPanel.tsx` — grille cartes quiz ✅
6. `features/manager/components/ManagerDashboard/ResultsPanel.tsx` — liste résultats ✅

### Règles visuelles
- Fond : image + overlay sombre, `backdrop-blur` sur les panneaux
- Panneaux : `bg-black/30 backdrop-blur-md border border-white/10` (glass)
- Cartes quiz : image cover 100%, gradient bas, titre blanc en bas, hover scale+shadow
- Dossiers sidebar : pill cliquable avec badge count, actif = orange
- Sélection quiz : ring orange sur la carte, nom affiché dans le footer
- Démarrer : bouton orange désactivé si rien sélectionné

---

## Plan — Refonte Présentation (jeu)

### Problèmes identifiés
- Fond garage (`fixed`) empilé visuellement avec fond de la slide → remplacé par `absolute`, uniquement SHOW_ROOM
- Barre blanche du haut (compteur question) coupait l'image → transformée en overlay `absolute` glassmorphism
- Barre blanche joueur en bas → overlay `absolute` glassmorphism
- `h-full` sur enfants flex sans hauteur fixe du parent → section passe à `h-dvh`
- `slideBg` (image marron) comme fond par défaut → remplacé par dégradé bleu nuit
- `CSSProperties` non importé dans `Question.tsx` → corrigé
- `elements?: SlideElement[]` présent dans les données SHOW_QUESTION / SELECT_ANSWER mais jamais rendu → à faire

### Fichiers modifiés
1. `features/game/components/GameWrapper.tsx` — fond `absolute`, overlay compteur/joueur, `h-dvh` ✅
2. `features/game/components/states/Question.tsx` — import CSSProperties, fond dégradé ✅
3. `features/game/components/states/Answers.tsx` — fond dégradé, layout flex ✅
4. `features/game/components/states/Responses.tsx` — layout flex ✅

### À faire
5. `features/game/components/states/Question.tsx` — rendu des `elements` (SlideCanvas read-only) 🔲
6. `features/game/components/states/Answers.tsx` — rendu des `elements` (SlideCanvas read-only) 🔲
7. Vérifier `Start.tsx`, `Podium.tsx`, `PlayerFinished.tsx` — cohérence visuelle 🔲

---

## Plan — Mode Soirée (multi-quiz cumulatif)

### Objectif
Permettre à l'hôte de sélectionner plusieurs quiz dans le manager pour créer une "soirée" où les points s'accumulent de quiz en quiz, avec un classement global final.

### UX Manager — Sélection soirée

```
┌──────────────┬───────────────────────────────────────────────────┐
│  Sidebar     │  [🔍]              [+ Créer]  [↑]  [🎉 Soirée]   │
│              │  ┌──────┐ ┌──────┐ ┌──────┐                       │
│              │  │  ①   │ │  ②   │ │      │  ← badges ordre       │
│              │  │Image │ │Image │ │Image │                       │
│              │  │Titre │ │Titre │ │Titre │                       │
│              │  └──────┘ └──────┘ └──────┘                       │
├──────────────┴───────────────────────────────────────────────────┤
│ [🎉 Mode Soirée]  1.Quiz A  →  2.Quiz B  →  3.Quiz C  [×Quiz B] │
│                   ~45 min · 42 questions    [▶ Démarrer la soirée]│
└──────────────────────────────────────────────────────────────────┘
```

**Comportements :**
- Bouton `🎉 Mode Soirée` dans l'header du QuizzPanel → active la sélection multiple
- En mode soirée : chaque carte affiche un badge numéroté en haut à gauche (ring orange + n° d'ordre)
- Re-clic sur une carte sélectionnée → retire de la liste
- Footer soirée : liste ordonnée cliquable, `×` pour retirer, durée/nb questions estimés
- Bouton `▶ Démarrer la soirée` orange, désactivé si < 2 quiz sélectionnés
- Mode soirée OFF → retour sélection simple classique

### UX In-Game — Soirée

```
[Quiz 1/3 ████░░░░░░]  ← barre de progression soirée (glassmorphism, en haut)

... quiz normal ...

─── Fin du Quiz 1 ───
     Classement Soirée
     🥇 Alice   1 240 pts
     🥈 Bob       980 pts
     🥉 Carla     750 pts
     [Prochain quiz dans  5  ...]   ← countdown
─── Début du Quiz 2 ───
```

**Interstitiel entre chaque quiz :**
- Composant `EveningInterstitiel.tsx` plein écran, glassmorphism
- Top 5 avec scores cumulés + delta du quiz qui vient de finir (`+320 pts`)
- Countdown 10s auto, bouton "Continuer" pour l'hôte
- Animation : cards fly-in en stagger 50ms (translateY + fade)

**Podium final :**
- `Podium.tsx` reçoit `isFinalEveningPodium: true` → affiche "Gagnant de la soirée !" + confettis renforcés

### Architecture Technique

```typescript
// packages/socket/src/types/game.ts
interface EveningSession {
  quizIds: string[]
  currentQuizIndex: number
  cumulativeScores: Record<string, number>  // playerId → points cumulés
}

// Nouveaux events socket
EVENING_START          → { quizIds: string[], roomCode: string }
EVENING_QUIZ_COMPLETE  → { quizIndex: number, quizScores: Record<string,number>, cumulativeScores: Record<string,number> }
EVENING_COMPLETE       → { finalCumulativeScores: Record<string,number>, podium: PodiumEntry[] }
```

### Fichiers à créer / modifier

| # | Fichier | Action |
|---|---------|--------|
| 1 | `packages/socket/src/types/game.ts` | Ajouter `EveningSession` |
| 2 | `packages/socket/src/services/game/index.ts` | Gérer `eveningSession` dans `GameService`, émettre events soirée |
| 3 | `packages/socket/src/services/game/round-manager.ts` | Hook post-quiz → incrémenter `cumulativeScores`, déclencher `EVENING_QUIZ_COMPLETE` ou `EVENING_COMPLETE` |
| 4 | `packages/web/src/features/manager/components/ManagerDashboard/index.tsx` | State `eveningMode`, `eveningQuizIds[]` |
| 5 | `packages/web/src/features/manager/components/ManagerDashboard/EveningFooter.tsx` | **Nouveau** — footer soirée avec liste ordonnée + CTA |
| 6 | `packages/web/src/features/manager/components/ManagerDashboard/QuizzPanel.tsx` | Multi-select + badges d'ordre sur les cartes |
| 7 | `packages/web/src/features/game/components/states/EveningInterstitiel.tsx` | **Nouveau** — classement cumulatif intermédiaire |
| 8 | `packages/web/src/features/game/components/states/Podium.tsx` | Prop `eveningMode` → label "Gagnant de la soirée" |
| 9 | `packages/web/src/features/game/components/GameWrapper.tsx` | Gérer state `EVENING_QUIZ_COMPLETE` → afficher `EveningInterstitiel` |

### Règles visuelles soirée
- Badge d'ordre sur carte : `bg-orange-500 text-white rounded-full w-6 h-6 text-xs font-bold` en position `absolute top-2 left-2`
- Footer soirée : `bg-black/40 backdrop-blur-md border-t border-white/10`, hauteur `h-20`
- Pills quiz dans le footer : `bg-white/10 hover:bg-white/20 rounded-full px-3 py-1 text-sm` avec `×` orange
- Barre progression soirée in-game : `bg-orange-500/30` track, `bg-orange-500` fill, `h-1.5 rounded-full`
- Interstitiel : fond `bg-black/70 backdrop-blur-xl`, cards classement avec `border-l-4 border-orange-500` pour le leader

---

## Plan — Système de Power-ups

### Objectif
Permettre aux joueurs de gagner des power-ups en jeu (combo, dernière place) et de les utiliser stratégiquement pour modifier les scores.

### Catalogue des power-ups

| Power-up | Icône | Couleur | Effet | Comment gagner |
|----------|-------|---------|-------|----------------|
| `DOUBLE_POINTS` | ⚡ SVG éclair | `#F59E0B` orange | ×2 points sur la prochaine question | Combo 3 bonnes réponses |
| `STEAL_POINTS` | SVG dague | `#EF4444` rouge | Vole 200pts au 1er → toi | Combo 5 bonnes réponses |
| `SHIELD` | SVG bouclier | `#3B82F6` bleu | Bloque le prochain STEAL/BOMB | Dernier du classement (consolation) |
| `FREEZE` | SVG flocon | `#06B6D4` cyan | Timer des adversaires +3s sur prochaine question | 1er à répondre (1 chance/4) |
| `BOMB` | SVG bombe | `#8B5CF6` violet | -150pts à un joueur au choix | Combo 5 bonnes réponses ou consolation |

**Règles d'attribution :**
- Dernier du classement après une question → 1 power-up aléatoire parmi `[SHIELD, DOUBLE_POINTS]`
- 3 bonnes réponses d'affilée → `FREEZE`
- 5 bonnes réponses d'affilée → `STEAL_POINTS` ou `DOUBLE_POINTS` (aléatoire)
- 1er à répondre correctement → `FREEZE` ou `BOMB` (1 chance sur 4, max 1x par round)
- Maximum **3 power-ups stockés** par joueur (le plus ancien est perdu si plein)

### UX Joueur (écran mobile)

```
┌────────────────────────────────┐
│   [Question / Zone réponse]    │
│                                │
│                                │
│  ╔══════════════════════════╗  │
│  ║  [⚡]  [🛡]  [❄]       ║  ← Power-up bar (max 3, 48px touch)
│  ╚══════════════════════════╝  │
└────────────────────────────────┘
```

**Interaction tap sur un power-up :**
1. Drawer slide-up depuis le bas (spring 200ms)
2. Nom + description + cible si besoin (BOMB → liste joueurs)
3. Bouton `Utiliser` orange + bouton `Annuler` ghost
4. Confirmation → dismiss drawer → animation d'activation (scale pulse + glow)

**Animation d'obtention :**
- Card power-up fly-in depuis le bas : `translateY(100%) → translateY(0)` en 300ms spring
- Glow pulse ×2 dans la couleur du power-up
- Badge "NOUVEAU !" en haut de la card, disparaît après 2s
- Haptic feedback (`navigator.vibrate(15)`)

**États visuels :**
- Power-up disponible : `opacity-100`, glow subtil dans sa couleur
- Power-up non-utilisable maintenant (ex: FREEZE déjà actif) : `opacity-40 grayscale`
- Aucun power-up : slot vide `bg-white/5 border border-white/10 rounded-xl` (pas de texte inutile)

### UX Hôte/Présentateur

- Toast en bas à gauche quand un power-up est utilisé :
  `[Avatar] Pierre utilise ⚡ Double Points !` — 3s auto-dismiss, `bg-black/80 backdrop-blur-md`
- Si FREEZE activé : indicateur visuel sur le timer (`border-cyan-400 animate-pulse`)
- Pas d'UI de gestion hôte — l'hôte observe seulement

### Architecture Technique

```typescript
// packages/socket/src/types/powerup.ts  (NOUVEAU)
export enum PowerUpType {
  DOUBLE_POINTS = 'DOUBLE_POINTS',
  STEAL_POINTS  = 'STEAL_POINTS',
  SHIELD        = 'SHIELD',
  FREEZE        = 'FREEZE',
  BOMB          = 'BOMB',
}

export interface PowerUp {
  id: string           // uuid
  type: PowerUpType
  earnedAt: number     // timestamp
}

// Extension de PlayerState (packages/socket/src/types/game.ts)
powerUps: PowerUp[]    // max 3

// Active effects pour le round courant
activeEffects: {
  doublePoints?: string    // playerId
  freeze?: boolean
  shields: string[]        // playerIds protégés
}

// Nouveaux events socket
POWER_UP_EARNED     → { playerId, powerUp: PowerUp }
POWER_UP_USED       → { playerId, type: PowerUpType, targetId?: string }
POWER_UP_EFFECT     → { type, affectedPlayers: { id: string, pointsDelta: number }[] }
POWER_UP_BLOCKED    → { attackerId, defenderId, powerUpType }  // SHIELD a bloqué
```

**Logique serveur — `PowerUpManager` :**
- `evaluateEarnings(roundResult)` → calcule qui gagne quoi après chaque question
- `applyPowerUp(playerId, type, targetId?)` → valide + applique l'effet
- SHIELD annule STEAL/BOMB et se consomme (les deux power-ups disparaissent)
- DOUBLE_POINTS appliqué côté serveur uniquement lors du calcul du score (anti-triche)
- FREEZE : un seul actif à la fois, stocké dans `activeEffects.freeze`

### Fichiers à créer / modifier

| # | Fichier | Action |
|---|---------|--------|
| 1 | `packages/socket/src/types/powerup.ts` | **Nouveau** — enum + interfaces |
| 2 | `packages/socket/src/types/game.ts` | Étendre `PlayerState` avec `powerUps[]` + `activeEffects` |
| 3 | `packages/socket/src/services/game/powerup-manager.ts` | **Nouveau** — earn/use/validate/apply logic |
| 4 | `packages/socket/src/services/game/round-manager.ts` | Appel `PowerUpManager.evaluateEarnings()` post-round, émettre `POWER_UP_EARNED` |
| 5 | `packages/socket/src/services/game/index.ts` | Handler `POWER_UP_USED`, instancier `PowerUpManager` |
| 6 | `packages/web/src/features/game/components/PowerUpBar.tsx` | **Nouveau** — HUD joueur (barre 3 slots) |
| 7 | `packages/web/src/features/game/components/PowerUpEarnedToast.tsx` | **Nouveau** — animation obtention (fly-in + glow) |
| 8 | `packages/web/src/features/game/components/PowerUpConfirmDrawer.tsx` | **Nouveau** — drawer confirmation + cible |
| 9 | `packages/web/src/features/game/components/states/Answers.tsx` | Intégrer `<PowerUpBar />` en bas |
| 10 | `packages/web/src/features/game/components/states/Question.tsx` | Intégrer `<PowerUpBar />` en bas |
| 11 | `packages/web/src/features/game/components/GameWrapper.tsx` | Toast hôte `POWER_UP_EFFECT`, listen `POWER_UP_EARNED` |

### Règles visuelles power-ups
- Barre power-up : `fixed bottom-4 left-1/2 -translate-x-1/2 flex gap-3 z-50`
- Slot : `w-14 h-14 rounded-2xl bg-black/50 backdrop-blur-sm border border-white/20 flex items-center justify-center cursor-pointer active:scale-95 transition-transform`
- Icône active : couleur SVG spécifique au type + `drop-shadow` dans sa couleur
- Drawer : `fixed inset-x-0 bottom-0 rounded-t-3xl bg-black/80 backdrop-blur-xl border-t border-white/10 p-6`
- Animation earn : `@keyframes powerup-enter { from: translateY(80px) opacity(0) scale(0.8); to: translateY(0) opacity(1) scale(1) }` — 300ms `cubic-bezier(0.16, 1, 0.3, 1)`
- Touch targets : tous les éléments interactifs `min-w-[44px] min-h-[44px]`

---

## Workflow Orchestration

### 1. Plan Mode Default
- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately
- Use plan mode for verification steps, not just building
- Write detailed specs upfront to reduce ambiguity

### 2. Subagent Strategy
- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One task per subagent for focused execution

### 3. Self-Improvement Loop
- After ANY correction from the user: update tasks/lessons.md with the pattern
- Write rules for yourself that prevent the same mistake
- Ruthlessly iterate on these lessons until mistake rate drops
- Review lessons at session start for relevant project

### 4. Verification Before Done
- Never mark a task complete without proving it works
- Diff behavior between main and your changes when relevant
- Ask yourself: "Would a staff engineer approve this?"
- Run tests, check logs, demonstrate correctness

### 5. Demand Elegance (Balanced)
- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky: "Knowing everything I know now, implement the elegant solution"
- Skip this for simple, obvious fixes -- don't over-engineer
- Challenge your own work before presenting it

### 6. Autonomous Bug Fixing
- When given a bug report: just fix it. Don't ask for hand-holding
- Point at logs, errors, failing tests -- then resolve them
- Zero context switching required from the user
- Go fix failing CI tests without being told how


## Task Management

1. Plan First: Write plan to tasks/todo.md with checkable items
2. Verify Plan: Check in before starting implementation
3. Track Progress: Mark items complete as you go
4. Explain Changes: High-level summary at each step
5. Document Results: Add review section to tasks/todo.md
6. Capture Lessons: Update tasks/lessons.md after corrections


## Core Principles

- Simplicity First: Make every change as simple as possible. Impact minimal code.
- No Laziness: Find root causes. No temporary fixes. Senior developer standards.
- Minimal Impact: Only touch what's necessary. No side effects with new bugs.


## Language

- All outputs, explanations, comments, and documentation MUST be written in French
- Do not mix languages unless explicitly requested by the user

