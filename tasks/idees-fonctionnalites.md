# Catalogue d'idées — fonctionnalités de plateforme GAME_HUB

> Complément de [idees-jeux.md](idees-jeux.md), qui couvre les **nouveaux jeux**,
> et de [idees-jeux-io.md](idees-jeux-io.md), qui couvre les mécaniques **.io**.
> Ce document ne propose **aucun jeu** : uniquement le socle, les systèmes
> transversaux et les outils qui rendent la soirée jouable, réutilisable et
> rentable. Même barème de coût (S / M / L / XL).
>
> Contexte inchangé : bar Les Toiles Noires, grand écran lisible de loin,
> joueurs qui arrivent et partent, hôte qui a un bar à tenir en parallèle.

## État des lieux (ce sur quoi on s'appuie)

| Constat | Fichier | Conséquence |
|---|---|---|
| 7 jeux, **7 gestionnaires de salon quasi identiques** (create / join / reconnect / cleanup) | `server/gameManager.js`, `geoGameManager.js`, `drawGameManager.js`, `colorGameManager.js`, `fakeArtistGameManager.js`, `partyGameManager.js` | Chaque nouveau jeu repaie le même socle |
| **Tout est en mémoire** (`this.rooms = new Map()`) | idem | Un redémarrage serveur = soirée perdue |
| Aucune table joueur / partie en base | `server/db.js` (quizzes, apero_quizzes, draw_words, geo_locations, color_characters) | Rien ne survit d'un soir à l'autre |
| Reconnexion **par pseudo**, réécrite 6 fois | ex. `drawGameManager.js:95`, `colorGameManager.js:160` | Comportement légèrement différent selon le jeu |
| `funStats.js` (161 l.) branché **uniquement sur le quiz** | `server/funStats.js` | Un module drôle qui ne sert qu'à un jeu sur sept |
| Un code de salon **par jeu**, saisi à chaque fois | `client/src/pages/JoinPage.jsx` | Le joueur ressaisit un code à chaque changement de jeu |
| Photos déjà capturées dans Party | `components/Party/PhotoCapture.jsx` | Une matière première inexploitée après la partie |

---

# TIER 1 — le socle qui manque

### 1. PASSEPORT — un seul code pour toute la soirée ⭐
- **Idée** : le joueur saisit un code **une seule fois**. Quand l'hôte lance un
  autre jeu, tous les téléphones **basculent tout seuls** sur la nouvelle vue,
  pseudo et avatar conservés. Plus jamais « ressortez vos téléphones, nouveau
  code, ABZK ».
- **Technique** : un `hubSession` côté serveur (code de soirée stable + liste des
  participants) au-dessus des salons de jeu existants ; `deviceId` tiré une fois
  et stocké en `localStorage` (déjà utilisé par les 6 vues joueur) ; un event
  `hub-switch-game` qui pousse la redirection. `JoinPage` sait déjà router par
  type de jeu — il suffit de lui donner la source.
- **Pourquoi c'est le n°1** : c'est la friction n°1 en salle, elle se paie à
  chaque changement de jeu, et elle est le prérequis de la Ligue, du Mode Soirée
  et du Mur de réactions.
- **Coût** : **M** (dont la moitié est l'item 3).

### 2. TÉLÉCOMMANDE HÔTE — ne plus jamais toucher la TV
- **Idée** : une vue `/remote/<code>` sur le téléphone de l'hôte : lancer /
  sauter / relancer une manche, `+10 s`, couper le son, exclure un joueur,
  changer de jeu. La TV devient un écran passif qu'on branche et qu'on oublie.
- **Technique** : jeton de télécommande tiré en `crypto.randomBytes(16)` —
  exactement le motif du `remoteToken` de `geoGameManager.js:67` — encodé dans un
  QR affiché 5 s au démarrage de l'écran hôte. `qrcode.react` est déjà installé.
- **Pourquoi** : l'hôte tient un bar. Chaque aller-retour vers le clavier de la
  TV est une bière non servie et un temps mort à l'écran.
- **Coût** : **S+**.

### 3. SOCLE COMMUN DE SALON (`RoomBase`)
- **Idée** : extraire des 7 gestionnaires ce qui est déjà identique : génération
  de code, join / reconnexion par pseudo, période de grâce hôte, `lastActivity`,
  `cleanupRooms`, liste des joueurs, avatars.
- **Pourquoi** : ce n'est pas du confort de développeur, c'est le prix d'entrée
  de tout le reste. Chaque jeu du catalogue coûte aujourd'hui ~400 lignes de
  plomberie recopiée ; après, il en coûte zéro. Et les comportements de
  reconnexion cessent de diverger d'un jeu à l'autre.
- **Méthode** : extraction **jeu par jeu**, en commençant par les deux plus
  simples (`quizManager` + `fakeArtist`), sans jamais casser les autres.
- **Coût** : **M**. À faire en même temps que le PASSEPORT, pas avant, pas après.

### 4. FILET DE SÉCURITÉ — la soirée survit à un crash
- **Idée** : instantané des salons actifs sur disque toutes les 10 s ; au
  redémarrage, les parties en cours sont restaurées et les téléphones se
  reconnectent seuls. Plus un jeu de **contrôles de secours** pour l'hôte :
  « rejouer la question », « annuler le dernier point », « corriger un score »,
  « figer la partie ».
- **Pourquoi** : aujourd'hui un `docker compose restart` en pleine soirée efface
  20 joueurs et 40 minutes de scores. Et il y aura toujours une question mal
  posée, un buzz injuste, un pseudo insultant à corriger en direct.
- **Coût** : **S** pour les contrôles de secours, **M** avec la persistance.

---

# TIER 2 — ce qui fait revenir la semaine suivante

### 5. BOÎTE NOIRE + ALBUM DE SOIRÉE ⭐
- **Idée** : chaque partie écrit une trace en base (jeu, date, joueurs, scores,
  temps forts). À la fin de la soirée, l'écran affiche un **QR géant** : chacun
  scanne et repart avec sa page souvenir — ses dessins de DRAW_UP, les photos de
  SUPER_LTN_PARTY, son score, ses funStats, le podium.
- **Technique** : tables `sessions`, `matches`, `results` dans `db.js` (SQLite
  déjà en place) ; les dessins et photos existent déjà en base64 en mémoire, il
  s'agit de les écrire au lieu de les jeter. Page publique en lecture seule,
  purge automatique à 30 jours.
- **Pourquoi** : c'est ce qui part sur les réseaux le lendemain et ramène du
  monde. C'est aussi la matière première de la Ligue (catalogue jeux, § A) et du
  Mode Veille (§ B) : sans historique, ni l'une ni l'autre n'existe.
- **Coût** : **M−**.

### 6. FUNSTATS PARTOUT
- **Idée** : `funStats.js` fabrique des corrélations absurdes (« les Verseaux
  marquent 23 % de moins ») et ne tourne que sur NEURAL_QUIZ. Le brancher sur
  Draw, Geo, Fake Artist, Color et Party — le module prend déjà n'importe quelle
  métrique via `pickMetric`.
- **Pourquoi** : 161 lignes déjà écrites, déjà drôles, qui ne servent qu'à un jeu
  sur sept. Meilleur rapport rires / lignes du dépôt.
- **Coût** : **S** (une métrique à exposer par gestionnaire).

### 7. LA TOURNÉE — récompense réelle
- **Idée** : le vainqueur reçoit sur son téléphone un QR à usage unique
  (« −1 € sur la prochaine pinte », « le shot du champion »), validé par le staff
  depuis une page `/staff`. Expire à la fermeture.
- **Pourquoi** : c'est le seul point du catalogue qui relie directement le jeu au
  chiffre d'affaires du bar, et un enjeu réel change radicalement l'intensité des
  dernières manches.
- **Technique** : table `rewards` (code, partie, joueur, état, expiration),
  page staff protégée par le JWT admin existant.
- **Coût** : **S+**. Décision côté patron, pas côté code.

### 8. PACKS DE SOIRÉE CLÉ EN MAIN
- **Idée** : un fichier de soirée = une playlist de jeux + les packs de contenu +
  l'habillage. « Soirée Halloween », « Spécial 90s », « Nuit Ghibli ». L'hôte
  choisit une soirée, tout s'enchaîne.
- **Pourquoi** : ça étend le Mode Soirée (planifié dans `CLAUDE.md`) du quiz seul
  à **tout le hub**, et ça transforme la programmation du bar en un objet
  éditorial qu'on peut annoncer une semaine à l'avance sur une affiche.
- **Coût** : **M**, dont l'essentiel est l'écran de sélection hôte.

---

# TIER 3 — ce qui rend le jeu jouable dans un vrai bar

### 9. RATTRAPAGE — l'arrivant n'est jamais hors course
- **Idée** : score affiché **normalisé par manche jouée** (moyenne, pas cumul),
  et un joueur qui rejoint en cours démarre à la médiane du groupe. Option
  « dernière manche à points doubles » déjà prévue côté Party.
- **Pourquoi** : c'est la contrainte structurelle du lieu. Aujourd'hui, arriver à
  23 h veut dire jouer pour la 12ᵉ place — donc décrocher, donc reposer le
  téléphone. Une trentaine de lignes par jeu, un effet massif sur la rétention
  en cours de soirée.
- **Coût** : **S**.

### 10. MUR DE RÉACTIONS — un rôle pour les gens debout
- **Idée** : n'importe qui scanne le QR et obtient, sans s'inscrire, une palette
  de 6 emojis. Les réactions **traversent le grand écran** en temps réel pendant
  les parties. Optionnel : sondages express de l'hôte (« on rejoue ou on change
  de jeu ? »).
- **Pourquoi** : la majorité de la salle ne joue pas. Aujourd'hui elle n'a
  strictement rien à faire, et c'est un mur invisible entre le jeu et le bar.
  Distinct des « Paris du comptoir » (catalogue jeux, § C) : ici, zéro règle,
  zéro score, zéro apprentissage.
- **Coût** : **S**.

### 11. MODE 10 MÈTRES — lisibilité et daltonisme
- **Idée** : un réglage global qui bascule l'écran hôte en typographie et
  contrastes « fond de salle », plus une page de calibration à afficher une fois
  lors de l'installation du vidéoprojecteur. Et un audit des jeux où **la couleur
  seule** porte l'information (COULEUR_MOI, les 4 boutons du quiz, les pions de
  Party) → doubler par une forme ou un symbole.
- **Pourquoi** : le plan Party a déjà tiré la bonne conclusion (« le contour
  d'encre est constant, c'est lui qui sépare les territoires à dix mètres »).
  Cette règle mérite d'être appliquée aux sept jeux, pas à un seul.
- **Coût** : **S**, étalé.

### 12. RÉSEAU DE BAR — survivre à un wifi saturé
- **Idée** : file d'attente d'événements côté client avec réémission, indicateur
  discret de latence sur l'écran hôte, et allègement des gros paquets (les traits
  de canvas de DRAW_UP et de Fake Artist, les images base64).
- **Pourquoi** : 25 téléphones sur une box de bar, c'est le point de rupture le
  plus probable d'une soirée réussie — et le plus difficile à diagnostiquer en
  direct sans indicateur.
- **Coût** : **M**.

---

# TIER 4 — le contenu, seul vrai coût récurrent

### 13. GÉNÉRATEUR DE PACKS ASSISTÉ ⭐
- **Idée** : dans l'admin, l'hôte écrit « 20 questions Ghibli, difficulté
  moyenne, 4 choix » et obtient un pack **relu et éditable** avant publication.
  Idem pour les mots de Draw, les questions du MENSONGE et les prompts de
  PUNCHLINE. Pour les quiz, la génération vit dans **LTNHoot**
  (`packages/socket/src/services/ai-prompt.ts`), qui la fait déjà — l'enjeu ici
  est le contenu des jeux du hub, pas celui des quiz.
- **Technique** : appel à l'API Claude côté serveur (clé jamais exposée au
  client), sortie contrainte au schéma JSON déjà utilisé par `quizzes.json` et
  `drawWords.json`, import dans l'éditeur admin existant. **Jamais de publication
  directe** : l'humain valide, sinon les erreurs factuelles arrivent sur l'écran
  du bar.
- **Pourquoi** : ce qui limite l'exploitation du catalogue n'est pas le code,
  c'est le contenu à écrire chaque semaine. C'est le multiplicateur de tout le
  reste — et le motif est déjà éprouvé côté LTNHoot.
- **Coût** : **M**.

### 14. LE CARNET DES HABITUÉS — contenu proposé par la salle
- **Idée** : entre deux parties, un bouton « propose une question » sur le
  téléphone. Ça part dans une file de modération admin ; validée, elle apparaît
  la semaine suivante **signée du pseudo de son auteur**, et l'écran l'annonce
  (« question de Marion »).
- **Pourquoi** : contenu gratuit, et surtout la meilleure raison de revenir
  vérifier si sa question est passée. Ça transforme le client en auteur.
- **Coût** : **M−** (file + modération ; réutilise l'admin de contenu existant).

---

# TIER 5 — petites choses, gros effet

| # | Idée | Détail | Coût |
|---|---|---|---|
| 15 | **Bots de test** | Peupler un salon de 12 faux joueurs pour répéter une soirée seul et détecter les blocages avant le public | **S** |
| 16 | **Voix off** | Synthèse vocale sur l'écran hôte : annonce des noms, décompte, punchlines de fin. Rend l'hôte inutile pendant les transitions | **S** |
| 17 | **Signature joueur** | Un emoji ou un son choisi à l'inscription, rejoué à chaque buzz gagnant. Coût quasi nul, identité forte | **S−** |
| 18 | **Fil de soirée** | Sur la télécommande : temps écoulé, jeux déjà joués, suggestion du prochain format selon l'heure et le nombre de joueurs | **S** |
| 19 | **Bandeau d'arrivée** | Un nouveau joueur rejoint → son avatar traverse l'écran. La salle voit la partie grossir, c'est contagieux | **S−** |
| 20 | **Purge et RGPD** | Effacement automatique des pseudos, photos et dessins à 30 jours + page « ce qu'on garde ». Nécessaire dès que la boîte noire existe | **S** |

---

# Ordre de bataille recommandé

| Priorité | Item | Pourquoi maintenant |
|---|---|---|
| 1 | **TÉLÉCOMMANDE HÔTE** (S+) | Gain immédiat dès la prochaine soirée, ne dépend de rien |
| 2 | **FUNSTATS PARTOUT** (S) | Le module est écrit ; c'est du rire déjà payé qu'on n'utilise pas |
| 3 | **SOCLE COMMUN + PASSEPORT** (M) | Le vrai chantier : supprime la friction n°1 et rend tous les jeux suivants deux fois moins chers |
| 4 | **BOÎTE NOIRE + ALBUM** (M−) | Débloque la Ligue, le Mode Veille et le bouche-à-oreille du lendemain |
| 5 | **GÉNÉRATEUR DE PACKS** (M) | Sans lui, le catalogue de 20 jeux restera à moitié vide |
| 6 | **RATTRAPAGE** (S) | Trente lignes par jeu, la moitié de la salle cesse de décrocher à 23 h |

**Deux pièges à éviter** : commencer par le PASSEPORT sans le socle commun (ça
recopie une septième fois la même plomberie), et écrire la BOÎTE NOIRE sans la
purge de l'item 20 (des photos de clients qui traînent indéfiniment sur un VPS).
