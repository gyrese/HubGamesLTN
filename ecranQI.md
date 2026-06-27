# Test de QI (NEURAL_QUIZ) — Inventaire complet des écrans

> Document de référence pour une refonte design.
> Contexte : le **Test de QI** est un quiz de logique multijoueur en temps réel, de
> type **Kahoot** : l'hôte affiche la partie sur un **grand écran** (TV/projecteur),
> les joueurs se connectent avec leur **téléphone** qui sert de **manette** (4 formes
> colorées). À la fin, chaque joueur reçoit un **score de QI** calculé « façon vrai
> test », plus des **statistiques absurdes** sur le groupe.
>
> Le design actuel (premium dark, accent émeraude, design system `.nq-*`) **ne
> convient pas** et doit être repensé. Ce document décrit l'état actuel, les
> contraintes fonctionnelles à respecter, et les frictions à corriger.

---

## Stack & système actuel

- **Front** : React 19 + Vite, Tailwind CSS, **framer-motion** (animations), **lucide-react** (icônes), **qrcode.react** (QR du lobby).
- **Design system actuel** : classes scopées `.nq-*` dans `client/src/components/Quiz/QuizStyles.css` (surfaces near-black, bordures hairline, polices Space Grotesk + Plus Jakarta Sans, accent émeraude `#10b981`). Tout est scopé sous `.nq-root` pour ne pas fuir vers les autres jeux et neutraliser la règle globale qui met les titres en MAJUSCULES.
- **Temps réel** : Socket.IO. Le **serveur est autoritaire** sur le minuteur (début/fin de question, auto-avance) ; le client ne fait que refléter.
- **Polices disponibles** : `Space Grotesk` (titres), `Plus Jakarta Sans` (corps), `JetBrains Mono` (codes/chiffres).

---

## ⛓️ Contraintes fonctionnelles à respecter (NE PAS casser)

Ces points sont structurels : un nouveau design doit composer avec, pas les contourner.

1. **Modèle Kahoot** : la **question et le texte des réponses ne s'affichent QUE sur l'écran de l'hôte**. Le téléphone n'a jamais le texte de la question → les écrans joueur ne doivent pas en dépendre.
2. **Mapping forme ↔ couleur des 4 réponses** (identique hôte ET téléphone, défini dans `quizShared.js` → `OPTION_META`) :
   | Index | Forme | Couleur | Hex |
   |------|------|---------|-----|
   | 0 | ▲ Triangle | Rose | `#f43f5e` |
   | 1 | ◆ Losange | Bleu | `#3b82f6` |
   | 2 | ● Rond | Ambre | `#f59e0b` |
   | 3 | ■ Carré | Vert | `#22c55e` |
   L'hôte montre chaque réponse **précédée de sa forme/couleur** ; le téléphone montre **4 gros boutons** des mêmes formes/couleurs. Le joueur fait le lien visuel entre les deux écrans. **Ce mapping doit rester lisible et cohérent** entre les deux vues.
3. **Données d'une question** : `text`, `options[4]`, `image?` (URL, optionnelle), `difficulty` (1–5), `explanation` (révélée après coup).
4. **Deux métriques distinctes** à présenter sans les confondre :
   - **Score de jeu** (classement live) = 1000 pts/bonne réponse + bonus de vitesse (jusqu'à 500). Récompense la rapidité.
   - **QI** (fin de soirée uniquement) = score à déviation (moyenne 100, écart-type 15), basé sur la **précision** (pas la vitesse), avec **marge ±**, **percentile** et **palier** (Très supérieur, Supérieur, Moyenne haute, Moyenne, Moyenne basse, Limite, Très faible).
5. **Réglages hôte au lobby** : durée par question (10/15/20/30 s) + toggle **auto-avance** (enchaînement automatique).
6. **Reconnexion** : hôte et joueurs peuvent rafraîchir/couper le réseau et retrouver leur état (le design ne doit pas casser les états transitoires).

---

## Architecture des vues

Deux parcours parallèles synchronisés via WebSocket :

```
HÔTE (HostView.jsx)            JOUEUR (PlayerView.jsx)
────────────────────          ────────────────────────
   INIT (création salon)
        ↓
   LOBBY              ←→         LOGIN (PIN + pseudo + avatar)
        │                            ↓
        │                        PROFILE (rapide, sautable)
        │                            ↓
        ↓                        WAITING (attente)
   GAME (question + timer) ←→    GAME (manette 4 formes)
        ↓                            ↓
   RESULT (réponse + explic.) ←→ RESULT (correct/raté + explic.)
        ↓                            ↓
        └──── [boucle N questions] ──┘
        ↓                            ↓
   SERIES_END (classement + ←→   SERIES_END (mon rang)
     stats absurdes)
        ↓  (Série suivante  OU  Terminer → QI)
   END (classement final + QI) ←→ END (CARTE QI partageable)
```

Point d'entrée commun : **`QuizSelectPage`** (`/quiz`) → choix Créer (hôte) / Rejoindre (joueur).

---

## Écran 0 — Page d'entrée du jeu

**Fichier :** `client/src/pages/quiz/QuizSelectPage.jsx` — **Route :** `/quiz`

### Rôle
Aiguillage : créer une partie (hôte, grand écran) ou rejoindre (téléphone).

### Éléments UI actuels
- Pastille icône cerveau (lucide `Brain`), titre « Test de **QI** », tagline « Un quiz de logique multijoueur… stats absurdes garanties ».
- Deux gros boutons empilés : **Créer une partie** (primaire émeraude) / **Rejoindre une partie** (ghost).
- Bouton retour « Accueil » en haut à gauche.
- Fond : grille faible + halo émeraude. Entrée animée (framer-motion, stagger).

### Transitions
→ `/quiz/host` · → `/quiz/play` · → `/` (retour)

### Notes design
Écran le plus simple, donne le **ton graphique** de toute l'expérience. C'est ici que se joue la première impression.

---

## Écran 1 — Hôte : Initialisation (transitoire)

**Fichier :** `HostView.jsx` — état `INIT` — **Route :** `/quiz/host`

### Rôle
Écran fantôme pendant la création/reconnexion du salon (quelques centaines de ms).

### Éléments UI actuels
- Pastille cerveau qui « respire » (animation breathe) + « Initialisation du salon… ».

### Notes design
Très court. Opportunité d'une **animation de chargement** soignée (ex. le code PIN qui se dessine).

---

## Écran 2 — Hôte : Salon d'attente (Lobby)

**Fichier :** `HostView.jsx` — état `LOBBY` — **Route :** `/quiz/host`

### Rôle
L'hôte attend les joueurs, choisit le quiz et les réglages, puis lance.

### Éléments UI actuels
**Colonne gauche — Connexion (carte) :**
- « Scannez pour rejoindre » + **QR code** (lien `…/quiz/play/<PIN>`).
- « Ou code PIN » + **PIN à 4 chiffres** en grand (émeraude).
- **Réglages** : sélecteur de **durée** (10/15/20/30 s, segmented) + bouton toggle **Auto-avance** (ACTIVÉ/MANUEL).

**Colonne droite — Joueurs :**
- Titre « Joueurs (N) » + **sélecteur de quiz** (dropdown des séries).
- Grille de cartes joueurs (avatar + pseudo), animées à l'arrivée. État vide : « En attente des premiers joueurs… ».
- **Bouton « Lancer le quiz »** (désactivé si 0 joueur).

### Transitions
→ état GAME (émet `start-game` avec `quizId`, `duration`, `autoAdvance`).

### Notes design
Écran **dense** : tension entre le code/QR (à voir de loin sur un grand écran) et les options. Le PIN et le QR doivent être **lisibles à 4-5 m**. La liste des joueurs doit **vivre** (arrivées animées) pour créer de l'attente. Piste : hiérarchie claire entre « comment rejoindre » (gros) et « réglages » (secondaire).

---

## Écran 3 — Hôte : Question en cours

**Fichier :** `HostView.jsx` — état `GAME` — **Route :** `/quiz/host`

### Rôle
Cœur du jeu côté grand écran : la question, les 4 réponses (taguées forme/couleur), le minuteur, le nombre de réponses reçues.

### Éléments UI actuels
- En-tête : **indicateur de difficulté** (5 points) + **énoncé de la question** (gros).
- **Minuteur circulaire** (émeraude, passe au rouge < 5 s).
- Image de la question si présente (optionnelle).
- **4 cartes réponses** : chacune = pastille **forme + couleur** (▲◆●■) + texte de la réponse.
- Bas : compteur « X / Y ont répondu » + bouton **« Révéler »** (passer manuellement).

### Transitions
→ état RESULT (réception `round-results`, déclenché par le minuteur serveur, « tous ont répondu », ou « Révéler »).

### Notes design
**L'écran le plus regardé de la salle.** L'énoncé doit être **très lisible de loin**. Le mapping forme/couleur des réponses est **critique** : c'est ce que les joueurs cherchent sur leur manette. Le minuteur doit créer de la **tension** (sans être anxiogène). Le compteur de réponses entretient le rythme.

---

## Écran 4 — Hôte : Révélation & résultats

**Fichier :** `HostView.jsx` — état `RESULT` — **Route :** `/quiz/host`

### Rôle
Révéler la bonne réponse, l'expliquer, montrer le classement, enchaîner.

### Éléments UI actuels
- Titre « La bonne réponse ».
- Les **4 réponses** réaffichées : la bonne **surlignée (vert + ✅)**, les autres atténuées (animation pop).
- **Bloc explication** (icône ampoule + texte court).
- **Mini-classement** top 5 (rang, avatar, pseudo, score).
- Bouton **« Question suivante »** ; si auto-avance actif, il affiche « Suivante dans Ns » (compte à rebours).

### Transitions
→ état GAME suivant (émet `next-question`) ou → SERIES_END (dernière question).

### Notes design
Moment de **récompense et de pédagogie**. La révélation de la bonne réponse est un **instant clé** (à dramatiser). L'explication valorise le côté « test de QI ». Le mini-classement crée de la compétition. Gérer joliment l'état **auto-avance** (compte à rebours visible).

---

## Écran 5 — Hôte : Fin de série

**Fichier :** `HostView.jsx` — état `SERIES_END` — **Route :** `/quiz/host`

### Rôle
Bilan d'une série : classement complet + **stats absurdes**, puis choix « série suivante » ou « terminer la soirée (calcul du QI) ».

### Éléments UI actuels
- Titre « Fin de série ».
- **Classement complet** (médailles 🥇🥈🥉 pour le top 3, avatar, pseudo, score).
- **Bloc « Stats absurdes »** : liste de punchlines générées (ex. « 🐱 Team Chat domine Team Chien de 36 pts… »).
- Boutons : **« Série suivante »** (primaire) / **« Terminer · Calculer le QI »** (danger).

### Notes design
Le score est cumulatif sur la soirée (plusieurs séries possibles). Les **stats absurdes sont un moment fun fort** — à mettre en valeur, pas reléguer en bas. Distinguer clairement l'action « continuer » de l'action « clore et révéler les QI » (irréversible).

---

## Écran 6 — Hôte : Classement final & QI

**Fichier :** `HostView.jsx` — état `END` — **Route :** `/quiz/host`

### Rôle
Apothéose : classement final avec **QI de chaque joueur** + stats absurdes (cadrées sur le QI).

### Éléments UI actuels
- Titre « Classement final » (icône trophée).
- Classement complet : médailles top 3, avatar, pseudo, **score** et **QI (± marge)**.
- Bloc « Stats absurdes » (version QI).
- Bouton « Retour à l'accueil ».

### Notes design
**Écran climax côté hôte.** Le QI est la récompense finale — il doit être **spectaculaire et lisible de loin**. Opportunités : podium, animation d'apparition des QI, célébration du vainqueur, confettis. Aujourd'hui c'est une simple liste → **sous-exploité**.

---

## Écran 7 — Joueur : Connexion

**Fichier :** `PlayerView.jsx` — étape `LOGIN` — **Route :** `/quiz/play` ou `/quiz/play/:roomCode`

### Rôle
Entrer dans la partie : PIN + pseudo + avatar.

### Éléments UI actuels
- Pastille cerveau + « Rejoindre la partie ».
- **Code PIN** (input chiffres centré, pré-rempli si arrivée par QR), **pseudo**.
- **Avatar** : grille de 12 avatars presets (`/avatars/avatar_N.webp`) + bouton « Importer une photo » (compressée en local).
- Bouton **« Rejoindre »**.

### Transitions
→ PROFILE (nouvelle entrée) ou état reconstruit (reconnexion).

### Notes design
**Premier contact mobile** : doit être **ultra-rapide** (< 20 s pour être en jeu). La grille d'avatars est un petit moment de **personnalisation**. Mobile-first strict (pouces, gros boutons).

---

## Écran 8 — Joueur : Profil (rapide, sautable)

**Fichier :** `PlayerView.jsx` — étape `PROFILE` — **Route :** `/quiz/play`

### Rôle
Collecter des infos **fun et inutiles** qui alimenteront les **stats absurdes** de fin. **Tout est optionnel**, un bouton « Passer » saute l'étape.

### Éléments UI actuels
- Titre « Petit profil 🤓 » + sous-titre « Pour des stats totalement absurdes… ».
- Série de questions en **boutons segmentés** : Chat/Chien, Pain au chocolat/Chocolatine, Ananas-pizza, Sport (Athlète/Canapé), Cafés/jour, Coucher (Tôt/Normal/Tard), Cheveux, **Signe astro** (12 options qui passent à la ligne).
- Boutons « Valider » / « Passer ».

### Notes design
Risque de **friction/longueur** (surtout l'astro à 12 options). Doit rester **ludique et expédié en quelques taps**. Pistes : tout sur un écran scrollable court, ou cartes une-par-une « façon sondage rigolo », micro-animations. Ne jamais donner l'impression d'un formulaire administratif.

---

## Écran 9 — Joueur : Attente

**Fichier :** `PlayerView.jsx` — étape `WAITING` — **Route :** `/quiz/play`

### Rôle
Le joueur est connecté, il attend le lancement.

### Éléments UI actuels
- Avatar (qui « respire »), « Tu es connecté ! », « En attente du lancement… ».

### Notes design
Moment **oisif potentiellement long**. Piste : montrer les autres joueurs qui arrivent, un petit teasing, une anticipation. Aujourd'hui **statique**.

---

## Écran 10 — Joueur : Manette (question)

**Fichier :** `PlayerView.jsx` — étape `GAME` — **Route :** `/quiz/play`

### Rôle
Répondre. **Le téléphone n'a PAS le texte** — le joueur lit la question sur le grand écran et **tape la forme/couleur** correspondante.

### Éléments UI actuels
- En-tête : « Question X/Y » + chrono « ⏱ Ns » + **barre de minuteur** (émeraude → rouge).
- Message contextuel : « Réponds sur l'écran principal 👀 » (avant réponse) / « ✅ Réponse envoyée » (après).
- **4 gros boutons** plein écran (▲ rose, ◆ bleu, ● ambre, ■ vert). Après réponse : le bouton choisi est **mis en avant**, les autres **atténués**, tout est verrouillé.

### Notes design
**L'écran le plus tapé du jeu.** Les 4 boutons doivent être **énormes, évidents, satisfaisants à presser** (feedback haptique visuel). Le mapping forme/couleur **doit correspondre exactement** à l'écran hôte. C'est le moment le plus « jeu » — doit être **fun et punchy**. Tout dépend de la lisibilité du lien entre les deux écrans.

---

## Écran 11 — Joueur : Feedback de réponse

**Fichier :** `PlayerView.jsx` — étape `RESULT` — **Route :** `/quiz/play`

### Rôle
Dire au joueur s'il a eu juste, combien de points, son rang, et **pourquoi**.

### Éléments UI actuels
- Grand **« Correct ! » (vert)** ou **« Raté » (rouge)** (animation d'apparition).
- Si correct : **« +X »** points, badge **« 🔥 Série de N »** si streak ≥ 2.
- **Bloc explication** (« 💡 … »).
- Carte Score + Rang. « En attente de la suite… ».

### Notes design
Moment de **récompense émotionnelle individuelle**. Le contraste correct/raté doit être **immédiat et jouissif**. L'explication doit être lisible vite. Piste : animations de score, célébration de streak, plus de « jus ». Important : sur reconnexion en plein résultat, on affiche une variante **neutre** (« Résultats », sans dire juste/faux).

---

## Écran 12 — Joueur : Fin de série

**Fichier :** `PlayerView.jsx` — étape `SERIES_END` — **Route :** `/quiz/play`

### Rôle
Bilan personnel d'une série : rang + score, en attendant la suite.

### Éléments UI actuels
- « Fin de série », carte « Classement #R / N », score total. « L'hôte va lancer la suite ou révéler les QI… ».

### Notes design
Écran d'attente, mais **occasion d'un peu de récompense** (évolution du rang ?). Aujourd'hui minimal.

---

## Écran 13 — Joueur : Carte QI (final)

**Fichier :** `PlayerView.jsx` — étape `END` — **Route :** `/quiz/play`

### Rôle
**LE moment fort côté joueur** : révéler le QI dans une **carte partageable** (capturable en screenshot).

### Éléments UI actuels
- **Carte QI** : « Ton QI estimé » + **gros chiffre** (émeraude) + « ± marge » + **emoji + palier** (ex. « 🧠 Très supérieur ») + « Plus malin que X% du groupe ».
- Ligne de stats : **Précision %**, **Rang #R/N**, **Score**.
- Disclaimer « Pour rire, pas pour Mensa ».
- Boutons **« Partager »** (Web Share / presse-papiers) + « Accueil ».

### Notes design
**Écran climax côté joueur** + **objet viral** (on le montre, on le partage). Doit être **superbe, fier, screenshot-friendly** (format carte, identité forte, peut-être personnalisé par palier/couleur de QI). C'est le souvenir que le joueur emporte. **À soigner au maximum.**

---

## Écran 14 — Administration des quiz (secondaire)

**Fichier :** `client/src/components/Admin/QuizEditor.jsx` — **Route :** `/admin`

### Rôle
CRUD des séries de questions (titre, description, et par question : texte, image URL, **difficulté 1–5**, **explication**, 4 options + bonne réponse).

### Notes design
Interface **interne**, encore en style Bootstrap. **Pas prioritaire** pour la refonte de l'expérience joueur, mais gagnerait à être harmonisée a minima.

---

## Synthèse des enjeux design

### Identité actuelle
Premium dark, accent émeraude, design system `.nq-*`. **Cohérent techniquement mais jugé non satisfaisant** → liberté de direction artistique, **dans le respect des contraintes fonctionnelles ci-dessus**.

### Points de friction identifiés

| Écran | Problème |
|-------|----------|
| Sélection (`/quiz`) | Très sobre, peu mémorable — c'est la 1re impression |
| Lobby hôte | Dense : équilibre code/QR (lisible de loin) vs réglages |
| Question hôte | Lisibilité de loin de l'énoncé + mapping formes/couleurs à rendre évident |
| Fin/QI hôte | Classement + QI sous-exploités : pas de podium, pas de célébration |
| Profil joueur | Risque de longueur (12 signes astro), doit rester ludique/rapide |
| Attente joueur | Statique, moment oisif sans feedback |
| Manette joueur | Doit être énorme/punchy ; lien visuel avec l'écran hôte critique |
| Feedback joueur | Récompense émotionnelle perfectible (peu de « jus ») |
| Carte QI joueur | Doit devenir un **objet viral magnifique** — actuellement trop sage |

### Moments à forte intensité (à dramatiser)
1. **Révélation de la bonne réponse** (hôte) + correct/raté (joueur).
2. **Lancement de la partie** (transition lobby → 1re question).
3. **Carte QI finale** (joueur) — souvenir + partage.
4. **Classement/QI final** (hôte) — célébration du groupe.

### Contraintes transverses
- **Deux écrans très différents** : grand écran (lisible à 4-5 m, ambiance) vs mobile (pouces, gros boutons, vertical).
- **Le mapping forme/couleur** est le pont entre les deux : il doit être **immédiatement compréhensible**.
- **Ne pas faire dépendre le téléphone du texte de la question** (modèle Kahoot).
- **Distinguer Score (jeu, vitesse) et QI (fin, précision)** sans les confondre dans l'UI.

---

*Document destiné à être lu par un agent design pour produire une refonte UI/UX complète du Test de QI. Les contraintes fonctionnelles (section ⛓️) doivent être préservées ; la direction artistique est libre.*
