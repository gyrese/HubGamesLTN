# Draw Me — pot de peinture + types de crayon

## Objectif
Donner au dessinateur un pot de peinture (remplissage de zone) et quatre types de
crayon : Crayon (net, défaut), Pinceau (largeur variable), Néon (halo lumineux),
Spray (aérographe).

## Contrainte technique découverte
Le rendu actuel repasse **le trait entier** à chaque nouveau point
(`renderSmoothStroke` appelé dans `handleDrawMove`). Invisible avec un trait
opaque, mais rédhibitoire pour le Néon : le halo s'accumule à chaque repassage,
si bien que le dessinateur verrait un trait bien plus lumineux que l'hôte, qui le
rejoue une seule fois depuis l'historique. Les écrans divergeraient.

D'où le passage à un pipeline à deux surfaces, condition préalable au Néon :
- **base** (canvas hors écran) : les traits validés + les remplissages ;
- **visible** : recomposé à chaque frame = `drawImage(base)` + les traits en cours.

Le trait en cours est donc toujours rendu d'une seule passe sur une surface
vierge : identique chez tout le monde, quelle que soit la brosse.

## Tâches
- [x] `drawEngine.js` — catalogue des brosses, rendu par brosse, flood fill
- [x] Pipeline base/visible + composition en rAF dans les deux vues
- [x] `DrawPlayerView` — état `tool`, barre d'outils, émission des remplissages
- [x] `DrawHostView` — rendu des brosses et des remplissages via le moteur
- [x] `drawController` — relayer `brush` dans `draw-stroke-live`
- [x] Vérification : build, déterminisme du spray, rejeu à la reconnexion

## Décisions
- **Le remplissage passe par `draw-stroke`**, en tant qu'action
  `{ id, type: 'fill', color, point }`. Le serveur relaie et stocke sans rien
  interpréter : l'annulation, l'effacement et le rejeu à la reconnexion
  fonctionnent sans une ligne de serveur en plus.
- **Spray déterministe** : le tirage est semé sur l'id du trait (mulberry32), donc
  identique sur tous les écrans et stable au redimensionnement.
- **La gomme n'écrase plus la couleur choisie** : c'est un outil à part entière,
  plus un détournement de `selectedColor = '#ffffff'` + `brushSize = 30`.

## Revue

### Ce qui a été fait
- `client/src/components/Draw/drawEngine.js` (nouveau) — catalogue des brosses,
  rendu par brosse, remplissage par diffusion, surface hors écran. Il dédouble
  aussi `renderSmoothStroke`, qui était recopié à l'identique dans les deux vues.
- Les deux vues passent au pipeline base/visible, recomposition en `requestAnimationFrame`.
- Barre d'outils joueur : les quatre brosses, le pot, la gomme sur une rangée ;
  tailles + annuler + effacer sur la suivante.
- Serveur : une ligne, `brush` ajouté au relais de `draw-stroke-live`.

### Vérifications
- `vite build` passe. `eslint` : 5 erreurs, **toutes déjà présentes sur `HEAD`**
  (`roundStartTime`, `playFailSound`, `playWinnerSound`, deux `catch {}`) ;
  `drawEngine.js` n'en produit aucune.
- 21 assertions sur le moteur avec un contexte canvas simulé : déterminisme du
  spray (même graine, même tirage sur un canvas de taille différente), halo néon
  en deux passes puis cœur clair, chaque brosse gère le tap à un seul point, le
  remplissage ne franchit pas un trait, refuse un second coup de la même couleur
  et un clic hors canvas, et un trait sans champ `brush` retombe sur le crayon.
- 13 assertions de convergence rejouant le scénario réel : le dessinateur trace
  point par point (12 recompositions), l'hôte reçoit trois paquets de fragments
  puis le trait final. Les deux produisent une séquence de dessin **identique**,
  pour les quatre brosses, et le rejeu est stable. C'est la propriété qui
  justifiait la refonte du pipeline.

### Limites connues
- **Échelle** : `size` est en pixels absolus dans tout le jeu (`ctx.lineWidth =
  stroke.size`), le rendu n'est donc pas mis à l'échelle du canvas. Un trait de
  12 px fait 12 px sur le mobile comme sur l'écran du bar, donc paraît
  proportionnellement plus fin en grand. Comportement préexistant, non modifié :
  le changer toucherait l'aspect de tous les traits.
- **Pot sur une zone non close** : chaque écran recalcule le remplissage sur son
  propre canvas. Un contour laissé ouvert d'un pixel peut fuir sur un écran et
  pas sur l'autre. Fermer les formes reste la règle, comme dans tous les
  pictionary en ligne.
- **Liseré** : l'anticrénelage des traits laisse un fin contour non peint. La
  tolérance de 60 le réduit sans le supprimer.
- `CANVAS_HISTORY_MAX` écarte les actions les plus anciennes quand l'historique
  déborde : si un remplissage disparaît ainsi, le rejeu après reconnexion diverge.
  Défaut préexistant, désormais partagé par les remplissages.
