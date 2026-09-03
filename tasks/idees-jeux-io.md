# Catalogue d'idées — jeux .io adaptés au bar

> Troisième volet, après [idees-jeux.md](idees-jeux.md) (formats sociaux) et
> [idees-fonctionnalites.md](idees-fonctionnalites.md) (socle de plateforme).
> Ici : les mécaniques des jeux **.io**, transposées à la contrainte
> « un grand écran + N téléphones » des Toiles Noires.

## Pourquoi les .io sont le bon modèle

Un .io réussi respecte déjà, par construction, les quatre contraintes du bar :

| Contrainte du bar | Ce que le .io fait nativement |
|---|---|
| Les gens arrivent et partent | **Rejoindre en cours est la norme**, pas une exception. Tu apparais, tu joues |
| Zéro explication possible | Une seule règle, comprise en regardant l'écran 5 secondes |
| Manches courtes | Tu meurs, tu réapparais. Pas de partie à finir |
| Écran lisible de loin | Formes simples, couleurs franches, pas de texte |

C'est exactement le cahier des charges. La transposition ne demande donc pas
d'inventer : elle demande de **retirer** ce qui ne passe pas sur un téléphone
tenu debout avec une bière dans l'autre main.

---

## La vraie difficulté technique : le tick

**Constat.** Le dépôt n'a **aucune boucle de jeu temps réel**. Tous les
`setInterval` du serveur sont du nettoyage de salons (`cleanupRooms`, toutes les
5 à 10 min). Les jeux existants sont *tour par tour* : un événement, une réponse,
un résultat. Draw diffuse bien des traits en continu, mais il relaie des
événements client — il ne simule rien.

Un .io demande l'inverse : une **simulation autoritaire côté serveur** à 15–30
tours/seconde, qui diffuse un état à tout le monde. C'est le seul vrai
investissement de ce catalogue, et il est **payé une fois pour tous les jeux ci-dessous**.

### Le socle `TickEngine` (prérequis commun) — **M**

- Boucle à pas fixe (`setInterval` 50 ms → 20 Hz), état autoritaire côté serveur,
  entrées client réduites à une intention (`{ angle }`, `{ x, y }`, `{ tap: true }`).
- Diffusion en `socket.volatile.emit` : un paquet perdu n'est jamais rejoué, ce
  qui est le comportement correct pour de la position — et c'est ce qui protège
  le wifi du bar (cf. item 12 des fonctionnalités).
- **Budget réseau** : 20 Hz × 25 joueurs, c'est le point de rupture. Deux
  garde-fous dès le départ — n'envoyer que le **delta** et arrondir les
  coordonnées à l'entier (pas de flottants sur le fil).
- **Le téléphone n'affiche rien du jeu.** Il n'est qu'un **joystick** : un pouce,
  une direction. Toute la simulation se regarde sur le grand écran. C'est ce qui
  divise le coût par trois et ce qui fait que la salle regarde au même endroit.

> **Où le brancher.** Le registre de micro-jeux de Super LTN Party est déjà le
> bon hôte : `server/party/minigames/index.js` documente qu'« ajouter un
> micro-jeu ne demande jamais de toucher à la machine à états », et le contexte
> fourni (`ctx.broadcast`, `ctx.toPlayer`, `ctx.schedule`, `ctx.finishEarly` —
> `partyController.js:79`) est déjà exactement l'API dont une boucle a besoin.
> Chaque .io ci-dessous devient une épreuve de la famille `DIGITAL`, jouable
> aussi bien seule qu'en manche de Party.

---

# TIER S — une fois le TickEngine écrit

### 1. TERRITOIRE — le Splatoon / Paper.io du bar ⭐
- **Modèle** : `paper.io` / `splix.io`.
- **Gameplay** : chaque joueur est un point coloré qui laisse une traînée. Refermer
  sa boucle conquiert la surface. Traverser la traînée de quelqu'un l'élimine ;
  il réapparaît 3 s plus tard ailleurs. Manche de 3 min, gagne celui qui tient le
  plus de surface.
- **Écran** : la carte entière, les territoires en aplats de couleur franche, le
  pourcentage de chacun en bandeau. Spectaculaire de loin, zéro texte.
  **Téléphone** : un joystick au pouce. Rien d'autre.
- **Pourquoi c'est le n°1** : c'est le .io le plus lisible à dix mètres — des
  aplats de couleur qui grandissent, un enfant comprend en trois secondes. Et il
  s'accommode parfaitement des arrivées/départs.
- **Réutilise** : la palette des tables de Party (rouge/vert/bleu/jaune/rose/violet),
  déjà choisie « assez foncée pour porter du texte blanc ».
- **Coût** : **S** après le TickEngine (le remplissage de zone est l'algorithme le
  plus délicat — un simple *flood fill* sur grille, déjà écrit dans le détourage
  de CouleurMoi).

### 2. ESSAIM — le Agar.io coopératif
- **Modèle** : `agar.io`.
- **Gameplay** : on gobe les petits points pour grossir, on avale plus petit que
  soi, on fuit plus gros. Variante bar : **par tables**, toutes les billes d'une
  même table partagent la couleur et le score.
- **Écran** : la masse de chaque table en direct, caméra qui dézoome à mesure que
  les blobs grossissent.
  **Téléphone** : joystick. Option « se scinder » sur tap.
- **Pourquoi** : la mécanique la plus universellement comprise du genre, et le
  gros-mange-petit produit une hiérarchie visible en permanence à l'écran.
- **Attention** : sans limite de temps, un joueur dominant écrase la manche.
  Manche de 3 min **et** décroissance de masse au fil du temps.
- **Coût** : **S** après le socle.

### 3. SERPENT DE COMPTOIR — le Slither.io
- **Modèle** : `slither.io`.
- **Gameplay** : un serpent qui allonge, on meurt en touchant le corps d'un autre,
  et le mort se transforme en pastilles à ramasser — donc **tuer nourrit tout le
  monde autour**, ce qui crée l'attroupement.
- **Écran** : les serpents colorés par table sur fond sombre, néon.
  **Téléphone** : joystick + tap pour l'accélération (qui consomme de la longueur).
- **Pourquoi** : la mort y est spectaculaire et immédiatement rentable pour les
  autres — exactement l'inverse d'un jeu où se faire éliminer est punitif.
- **Coût** : **S** après le socle.

### 4. LE DERNIER SUR LA PLAQUE — .io d'élimination
- **Modèle** : `hole.io` / les jeux de poussée type Stumble.
- **Gameplay** : une plateforme qui **rétrécit**. On se pousse, on tombe. Le dernier
  debout marque. Manches de 45 s, enchaînées en rafale.
- **Écran** : vue du dessus, la plateforme qui s'érode, les chutes en gerbe.
  **Téléphone** : joystick + tap pour la poussée (avec temps de recharge).
- **Pourquoi** : le format le plus « drop-in » du catalogue — 45 s, on rejoint à
  la manche suivante, et c'est bruyant. Et c'est **la boucle d'élimination**
  qui manquait à SURVIVOR, réutilisable ailleurs.
- **Coût** : **S** après le socle. Collision cercle/cercle : dix lignes.

---

# TIER M — les .io qui ne sont pas des jeux de déplacement

### 5. CROISSANCE — le .io de gestion, sans joystick ⭐
- **Modèle** : les *idle/clicker* multijoueurs et `bloble.io`.
- **Gameplay** : chaque table gère une petite base qui produit des ressources en
  continu. On choisit où investir, on peut lancer une attaque sur la base d'une
  autre table. **Tout est asynchrone** : personne n'a besoin de réflexes, et on
  peut poser son téléphone deux minutes sans perdre.
- **Écran** : les bases côte à côte qui grossissent visiblement, les attaques en
  trajectoires.
  **Téléphone** : trois ou quatre boutons d'investissement.
- **Pourquoi ce format mérite l'attention** : c'est le **seul du catalogue qui
  tolère qu'on ne regarde pas**. Il tourne en fond pendant une soirée entière,
  entre deux autres jeux, sans monopoliser l'attention — un « jeu d'ambiance »
  plutôt qu'un jeu de manche.
- **Coût** : **M**. Tick lent (1 Hz suffit), donc **il ne dépend même pas du
  TickEngine complet**.

### 6. MOTS EMPILÉS — le .io de vocabulaire
- **Modèle** : `wordle`-like compétitif / `skribbl` sans dessin.
- **Gameplay** : une grille de lettres commune à toute la salle. Chacun compose
  des mots dessus depuis son téléphone ; un mot validé retire ses lettres et en
  fait tomber d'autres. Tout le monde joue sur **la même grille en même temps**,
  donc voler une bonne combinaison sous le nez d'un autre est le cœur du jeu.
- **Écran** : la grille commune, les mots validés qui remontent avec le pseudo.
  **Téléphone** : la grille en petit + saisie.
- **Pourquoi** : le seul .io de ce catalogue qui ne demande **aucune dextérité** —
  il rééquilibre une soirée trop orientée réflexes, et il parle à un autre public.
- **Réutilise** : la validation de mots et le fuzzy matching de `drawGameManager`.
- **Coût** : **M** (le dictionnaire français est le vrai sujet).

### 7. LA MÊLÉE — .io par équipes, drapeau
- **Modèle** : capture-the-flag façon `zombs.io`.
- **Gameplay** : deux à six camps (les tables), un drapeau à ramener. Porter le
  drapeau ralentit. Se faire toucher le fait tomber.
- **Écran** : le terrain, les drapeaux, le score par table.
  **Téléphone** : joystick + tap.
- **Pourquoi** : c'est le format qui **fait crier les tables entre elles**, donc
  celui qui sert le mieux le cadrage « la table est l'unité de jeu » déjà retenu
  pour Super LTN Party.
- **Coût** : **M** après le socle (états d'équipe, respawn, drapeau).

---

# TIER L — l'ambition

### 8. LE BAR OUVERT — un .io permanent
- **Idée** : une carte qui **tourne en permanence** sur le grand écran pendant
  toute la soirée. Les gens rejoignent quand ils veulent, jouent trois minutes,
  repartent. Aucune manche, aucun début, aucune fin — le score de la soirée
  s'accumule et se solde à la fermeture.
- **Pourquoi c'est le vrai aboutissement** : ça résout le problème du **Mode
  Veille** (fonctionnalités § B) par le haut. Au lieu d'un carrousel qui affiche
  des teasers pendant les creux, l'écran affiche **un jeu réellement en cours**
  que n'importe qui peut rejoindre en scannant. L'écran ne fait plus la publicité
  du jeu : il *est* le jeu.
- **Coût** : **L**, mais essentiellement de la robustesse (tourner 6 h sans fuite
  mémoire, purger les joueurs partis, absorber les pics) — pas du gameplay neuf
  si l'un des Tier S existe déjà.

---

# Ce que je déconseille de transposer

Autant dire ce qui **ne marchera pas**, pour ne pas y passer une soirée :

| Écarté | Pourquoi |
|---|---|
| `krunker` / FPS .io | La visée à la souris est intransposable au pouce, et la vue subjective sur grand écran ne montre qu'un seul joueur |
| `diep.io` et ses arbres de progression | Trop de règles à lire ; le joueur qui arrive à 23 h est déjà largué |
| Tout ce qui demande de **lire son propre téléphone** en jouant | La salle cesse de regarder l'écran commun, et l'effet collectif s'effondre |
| Les .io à partie longue (30 min+) | Incompatible avec des gens qui vont et viennent |

---

# Ordre de bataille

| Priorité | Item | Pourquoi |
|---|---|---|
| 0 | **TickEngine** (M) | Prérequis de tout le reste. Rien n'est jouable avant |
| 1 | **TERRITOIRE** (S) | Le plus lisible de loin, le plus spectaculaire, la meilleure vitrine du socle |
| 2 | **LE DERNIER SUR LA PLAQUE** (S) | 45 s par manche : le meilleur format d'appoint, et il livre la boucle d'élimination réutilisable |
| 3 | **CROISSANCE** (M) | Ne dépend pas du socle complet, et c'est le seul jeu qui tourne en fond toute la soirée |
| 4 | **SERPENT DE COMPTOIR** (S) | Une fois TERRITOIRE écrit, c'est la même boucle avec une autre règle |
| 5 | **LE BAR OUVERT** (L) | L'aboutissement : l'écran de veille devient un jeu vivant |

**Le piège à éviter** : écrire TERRITOIRE avec sa propre boucle « juste pour
voir », puis en écrire une deuxième pour SERPENT. Le TickEngine se fait **avant**
le premier jeu, sinon le dépôt gagne une septième plomberie recopiée — c'est
exactement l'erreur que le socle commun de salon (fonctionnalités § 3) cherche
déjà à réparer sur les gestionnaires existants.
