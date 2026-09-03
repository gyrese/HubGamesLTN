# IO_ARENA — socle temps réel

> Le chantier précédent (Super LTN Party) reste en cours dans l'arbre de travail ;
> ce document décrit le chantier courant. Catalogue d'origine :
> [idees-jeux-io.md](idees-jeux-io.md).

## Objectif

Doter le hub de sa **première boucle de simulation temps réel**, sous la forme
d'un jeu `IO` à part entière, et prouver le socle avec un mode jouable de bout
en bout (TERRITOIRE, façon Paper.io).

Jusqu'ici le dépôt n'avait aucune simulation : tous les `setInterval` du serveur
étaient du nettoyage de salons, les jeux fonctionnaient au tour par tour, et Draw
relayait des évènements clients sans rien calculer. Les 8 jeux .io du catalogue
partageaient donc tous le même prérequis manquant.

## Décisions actées

| Sujet | Choix |
|---|---|
| Transport | **Upgrade WebSocket pour tout le hub**, aligné sur LTNHoot, avec repli polling automatique |
| Mode de démonstration | **TERRITOIRE** (Paper.io) — le plus lisible de loin |
| Portée | Socle **+ un mode complet**, jouable de bout en bout |
| Rôle du téléphone | **Manette seule** : il n'affiche jamais le jeu |

## Tâches

- [x] Aligner le transport client/serveur sur LTNHoot (upgrade WS + repli)
- [x] Watchdog mobile de retour au premier plan (sonde `connection:ping`)
- [x] Handlers communs `connection:ping` et `connection:syncTime`
- [x] `server/io/tickEngine.js` — boucle à pas fixe, budget réseau, arrêt propre
- [x] `server/io/modes/index.js` — registre, contrat d'un mode
- [x] `server/io/modes/territoire.js` — conquête par diffusion sur grille
- [x] `server/ioGameManager.js` — salons, reconnexion par pseudo, période de grâce
- [x] `server/controllers/ioController.js` — machine à états, diffusion `volatile`
- [x] Vues client : SelectPage, HostView (canvas + interpolation), PlayerView (joystick)
- [x] Câblage : routes, HomePage, JoinPage, `/api/room/:code`
- [x] Tests de bout en bout + non-régression des 6 jeux existants

## Ce qui a été construit

**Serveur** (1 280 lignes)

| Fichier | Rôle |
|---|---|
| `server/io/tickEngine.js` | Boucle à pas fixe 20 Hz, diffusion 10 Hz, mesure du débit |
| `server/io/modes/index.js` | Registre : ajouter un mode ne touche jamais la machine à états |
| `server/io/modes/territoire.js` | Le gameplay : traînées, capture, collisions, réapparition |
| `server/ioGameManager.js` | Salons, arrivée en pleine manche, reconnexion par pseudo |
| `server/controllers/ioController.js` | `LOBBY → PLAYING → RESULT`, relais des intentions |

**Client** (1 002 lignes) : `components/Io/{IoHostView,IoPlayerView,IoStyles.css}`,
`pages/io/IoSelectPage.jsx`.

## Les trois règles du socle

1. **Le serveur est autoritaire.** Le téléphone n'envoie qu'un cap (`{ angle }`),
   jamais une position — même logique anti-triche que GeoTrackr.
2. **Les instantanés partent en `volatile`.** Un paquet de position perdu ne doit
   jamais être rejoué : le suivant le remplace. C'est ce qui protège le wifi.
3. **Le téléphone n'affiche pas le jeu.** Il est une manette ; les instantanés ne
   vont qu'aux grands écrans, jamais aux joueurs.

## Revue

### Ce qui a été mesuré, pas supposé

| Indicateur | Seuil visé | Mesuré |
|---|---|---|
| Temps de simulation par tick (20 joueurs) | < 10 ms | **0,04 ms** (pire relevé : 6 ms) |
| Débit vers l'écran (20 joueurs, pire cas) | tenable en salle | **19,5 Ko/s** |
| Débit vers l'écran (8 joueurs, cas typique) | — | **8,1 Ko/s** |
| Débit en conditions réelles (7 joueurs) | < 40 Ko/s | **7,7 Ko/s** |

### Trois défauts trouvés par les tests, corrigés

1. **Suicide sur sa propre traînée.** À 130 unités/s et 20 Hz, plusieurs pas
   tiennent dans une même case : le joueur posait sa traînée puis se tuait dessus
   au pas suivant. Corrigé par un test `lastCell` — rester sur la case qu'on
   occupe déjà n'est jamais un évènement.
2. **Hécatombe au lancement.** Les apparitions par anneaux de 3 cases plaçaient
   cinq paires de joueurs à moins de 6 cases ; 18 joueurs sur 20 mouraient en six
   secondes. Corrigé par une distance minimale relâchée par paliers (14 → 10 → 7)
   plus une invulnérabilité de 1,5 s à l'apparition. **Résultat : 20/20 survivants.**
3. **Reconnexion cassée.** `removePlayer` supprimait le joueur, donc il n'y avait
   plus aucun pseudo à retrouver. Corrigé en le marquant absent (comme le
   capitaine dans Party), avec purge différée entre deux manches et corps figé
   pendant l'absence.

### Optimisations réseau

La traînée et la grille étaient renvoyées intégralement dix fois par seconde.
Désormais : la grille ne part en entier qu'au premier instantané (puis par
différences `[index, propriétaire]`), et les traînées ne transmettent que les
cases ajoutées, un numéro de version indiquant au client quand repartir de zéro.
Mesure : **41 → 19,5 Ko/s** dans le pire cas.

> Une correction méthodologique mérite d'être notée : une première mesure
> annonçait 64 Ko/s après cette optimisation. Le banc d'essai n'appelait
> `snapshot` qu'un tick sur dix, laissant les différences s'accumuler — le test
> était faux, pas le code. À la cadence réelle du moteur, le gain est bien réel.

### Vérifications passées

- **18 tests de bout en bout** contre le vrai serveur : création de salon, six
  joueurs, manche complète, arrivée en pleine manche, reconnexion par pseudo,
  classement trié, refus d'un joueur qui tente de piloter la manche.
- **Non-régression des 6 jeux existants** : tous créent un salon, acceptent un
  joueur, sont résolus par `/api/room/:code` — et **montent tous en WebSocket**.
- **Repli polling** vérifié en forçant `transports: ['polling']` : le jeu reste
  jouable, ce qui valide la garantie « aucune régression possible ».

### Le comparatif Paper.io-2 (Unity)

Le dépôt de référence transmis emploie un **maillage polygonal triangulé** et des
`SphereCollider` posés le long de la traînée. Rien n'en a été repris : c'est du
solo local sans serveur, la triangulation est intransposable à Node et
insérialisable à 10 Hz, et le jeu **n'a pas de réapparition** (`Die()` → `GameOver`)
— l'inverse exact de ce qu'exige un bar où l'on rejoint en cours. Seul détail
retenu : la traînée semi-transparente, reprise pour la lisibilité de l'écran.

## Reste à faire

- [ ] **Test en salle** : 6 téléphones réels. Rien ne remplace cette étape.
- [ ] Les 7 autres modes .io, un par un (~150 lignes chacun désormais)

## Point de vigilance signalé (hors périmètre)

`quizController.js:145` appelle `callback({ roomCode })` sans vérifier que le
callback existe : un client qui émet `create-room` sans fonction de rappel fait
**tomber le serveur entier** (`TypeError: callback is not a function`, constaté
pendant les tests). Les autres contrôleurs utilisent un `safeCallback` qui s'en
protège. À corriger dans un chantier dédié.
