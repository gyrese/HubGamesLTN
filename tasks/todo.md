# Plan — Dance Dance (jeu de rythme multi)

## Objectif
Ajouter un 8e jeu au hub : un jeu de rythme type StepMania/DDR où les joueurs
tapent des flèches en rythme sur leur téléphone, l'action se déroulant sur le
grand écran. Inspiration : stepfever (web) et Etterna (jugement/scoring).

## Décisions de conception (validées avec l'utilisateur)

### 1. Jugement client, validation serveur
Un jeu de rythme exige une fenêtre PERFECT à ±20 ms. La latence WiFi (30-80 ms,
variable) rend le jugement serveur strict injouable et injuste : le joueur avec
la meilleure connexion gagnerait. Donc :
- la chart est envoyée au téléphone AVANT le départ (préchargement) ;
- le téléphone juge localement, réaction instantanée ;
- le téléphone envoie `{ noteId, offset }` ; le serveur VALIDE (plausibilité)
  et fait autorité sur le classement.
Anti-triche par plausibilité, dans l'esprit du serveur autoritaire de .IO :
note existante, non rejouée, offset dans la fenêtre, cadence humaine.

### 2. Musique libre + chart auto-générée
Aucun fichier .sm/audio StepMania n'est redistribuable. L'admin téléverse un
MP3 ; le serveur détecte le tempo et génère la chorégraphie selon la
difficulté. Légal, extensible, autonome.

### 3. Contrôles : 4 zones tactiles fixes
Croix directionnelle plein écran (←↓↑→). Un swipe demande ~150 ms de
reconnaissance : incompatible avec les passages rapides.

### 4. Synchronisation temporelle
Réutiliser `connection:syncTime` (déjà dans index.js) : chaque téléphone
calcule son décalage avec le serveur. Le départ est annoncé à un timestamp
serveur absolu, donc tous les appareils démarrent la même chanson au même
instant, malgré des latences différentes.

## Tâches

### Serveur
- [x] `server/dance/chart.js` — génération de chorégraphie depuis un BPM +
      difficulté (patterns : croches, doubles, escaliers, jumps)
- [x] ~~`server/dance/audioAnalysis.js`~~ → analyse dans le navigateur (Web Audio API), aucune dépendance serveur — détection de tempo (énergie/onsets) sur
      le MP3 téléversé
- [x] `server/dance/judge.js` — fenêtres de jugement + scoring type Etterna
      (PERFECT/GREAT/GOOD/MISS, combo, multiplicateur)
- [x] `server/dance/songs.js` — catalogue des morceaux (persistance JSON)
- [x] `server/danceGameManager.js` — salon, hérite de `RoomBase`
- [x] `server/controllers/danceController.js` — machine à états
      LOBBY → COUNTDOWN → PLAYING → RESULT, validation anti-triche
- [x] Câblage : `index.js` (controller + /api/room/:code), `hubSession.js`
      (catalogue soirée), route d'upload admin

### Client
- [x] `client/src/pages/dance/DanceSelectPage.jsx` — choix morceau/difficulté
- [x] `client/src/components/Dance/DanceHostView.jsx` — grand écran :
      couloirs de flèches, scores live, combos
- [x] `client/src/components/Dance/DancePlayerView.jsx` — 4 zones tactiles +
      jugement local + feedback
- [x] `client/src/components/Dance/danceEngine.js` — horloge audio, jugement
      local, boucle de rendu
- [x] `client/src/components/Dance/DanceStyles.css` — thème néon arcade
- [x] Câblage : `App.jsx` (routes), `HomePage.jsx` (carte du jeu)

### Vérification
- [x] Test de la génération de chart (densité cohérente par difficulté)
- [x] Test du jugement (fenêtres, combos, scoring)
- [x] Test de la validation anti-triche (rejeu, offsets impossibles)

## Revue

### Ce qui a été livré
Huitième jeu du hub, complet et branché partout : accueil, routage par code,
catalogue de soirée (PASSEPORT), administration.

**Serveur** — `dance/judge.js` (fenêtres et score), `dance/chart.js`
(chorégraphies), `dance/songs.js` (catalogue), `danceGameManager.js`,
`controllers/danceController.js`.
**Client** — `danceEngine.js` (horloge audio, jugement local, détection de
tempo), vues hôte et joueur, page de sélection, feuille de style `.dd-*`.

### Décisions notables

**Le jugement est local, la validation serveur.** C'est la seule entorse à la
règle « serveur autoritaire » du hub, et elle est délibérée : un jeu de rythme
distingue une frappe parfaite à 25 ms près, alors que la latence du wifi varie
de 30 à 80 ms. Juger côté serveur aurait noté la qualité de la connexion, pas
le sens du rythme. Le téléphone juge donc pour la réactivité ; le serveur
**rejuge** chaque frappe avec la même table (`registerHit`). Le client
transmet un écart, jamais un verdict ni des points.

**Quatre gardes anti-triche**, chacune fermant une fraude distincte : note
inexistante, note rejouée, écart hors fenêtre, incohérence entre l'écart
annoncé et l'instant d'arrivée du paquet. Plus un plafond de 25 frappes par
seconde et par joueur. Toutes testées.

**Départ synchronisé par instant absolu.** Le serveur n'envoie jamais « pars
maintenant » mais un horodatage ; chaque téléphone connaît son décalage
d'horloge (`connection:syncTime`, déjà présent) et convertit. Un joueur dont
l'annonce arrive 200 ms plus tard démarre malgré tout à l'heure.

**L'analyse du tempo se fait dans le navigateur.** Décoder du MP3 côté serveur
aurait imposé ffmpeg ou un module natif dans l'image Docker, pour un seul jeu.
La Web Audio API le fait déjà ; le serveur borne les valeurs reçues.

**Aucun fichier StepMania.** Les packs de chansons sont sous copyright et non
redistribuables : le catalogue est alimenté par l'hôte, et la chorégraphie est
générée à partir du tempo.

### Deux corrections en cours de route
- **Difficultés inversées.** Les temps forts étant joués inconditionnellement,
  toute densité inférieure à 1 note/temps était inatteignable : « Facile »
  sortait plus dense que « Normal ». Corrigé à la racine — les temps forts sont
  désormais *prioritaires* et non obligatoires, et l'on retient exactement le
  nombre de notes voulu. Progression obtenue : 1,0 / 1,9 / 3,8 / 5,1 notes/s.
- **Densité dépendante du tempo.** À 200 BPM, « Normal » valait « Expert ».
  Ajout d'une normalisation vers un tempo de référence.

### Vérification
- `npm test` : **321 assertions vertes** sur 6 suites, aucune régression.
- `server/test/dance.js` (44) : chorégraphies, jugement, anti-triche, cycle de vie.
- `server/test/dance-game.js` (24) : partie complète sur de vraies sockets —
  départ synchronisé, frappes en temps réel, matraquage bloqué, classement.
- Tables de jugement client et serveur prouvées identiques (risque principal de
  l'architecture retenue).
- Build client et ESLint propres ; démarrage serveur vérifié ; routes REST
  testées, upload protégé (401 sans authentification).

### Reste à faire par l'utilisateur
1. **Redémarrer le serveur** (le processus en cours date d'avant ces modifications).
2. **Ajouter au moins un morceau** via `/dance`, connecté à l'administration.
   Sans morceau, le jeu s'ouvre mais ne peut rien lancer.
3. **Fournir la vignette** `client/public/assets/games/dance_dance.webp`, comme
   pour les autres jeux (la carte d'accueil la référence déjà).

### Piste laissée de côté
Les notes longues (*hold*) de StepMania ne sont pas implémentées : elles
demandent un suivi d'appui continu et une seconde logique de jugement. Le jeu
est complet sans elles ; c'est un ajout naturel si l'envie vient.
