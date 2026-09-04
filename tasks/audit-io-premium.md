# IO_ARENA — audit premium (mécanique, performance, esthétique)

> Trois audits menés en parallèle par des agents spécialisés, puis correctifs
> appliqués et vérifiés. Le socle technique était sain ; la **boucle de jeu**
> était cassée.

## Le défaut central : mourir rapportait des points

Mesuré : un joueur qui meurt passait de **25 à 50 cases**. `kill()` n'effaçait
pas le territoire, et `respawn()` ajoutait un carré neuf par-dessus l'ancien.
Se suicider en boucle était donc la stratégie optimale — 1 525 cases en trois
minutes sans jamais piloter, et le tueur ne gagnait rien.

**Correction** : la mort coûte tout le territoire ; le tueur hérite de la moitié
des cases les plus proches de lui, le reste redevient neutre.
Vérifié : victime 25 → **0**, tueur 25 → **37**.

La règle affichée (« coupe la traînée des autres pour les renvoyer au point de
départ ») était mensongère ; elle est désormais vraie.

## Déni de service : un téléphone pouvait éteindre tout le hub

`{ angle: 1e308 }` envoyé depuis une console de navigateur bloquait le serveur
dans une **boucle infinie** — à cette magnitude, soustraire 2π ne change plus
rien en virgule flottante. Tout le hub (Quiz, Draw, Party) tourne sur le même
processus.

**Correction** : normalisation en temps constant via `atan2(sin, cos)`, à
l'entrée et dans le tick. Plus une limite de fréquence serveur à 25 Hz, absente
jusque-là (seul le client s'auto-limitait, ce qu'un client modifié ignore).
Vérifié : 40 ticks avec `1e308` en **0 ms**.

## Autres correctifs de mécanique

| Défaut | Effet | Correction |
|---|---|---|
| Collision d'identité | Après 254 arrivées, deux joueurs partageaient couleur, territoire et scores faussés | Allocation d'un index réellement libre |
| Bouclier létal | Invulnérable **et** capable de tuer → mourir exprès pour faucher la mêlée | Sous bouclier, on traverse sans couper |
| Traînée orpheline | Un déconnecté laissait un mur invisible mortel pendant toute la manche | Traînée effacée, territoire conservé |
| Joueur dépossédé | À 0 case, plus aucune boucle possible : errance jusqu'à la mort | Nouvelle base immédiate |
| 6 identités pour 20 joueurs | Jusqu'à 4 joueurs strictement identiques | 36 paires uniques, 6 formes distinctes dès les 6 premiers |

## Performance : le problème n'existait pas

Les 9-18 fps mesurés venaient de **mon banc d'essai**, qui tournait en rendu
logiciel (SwiftShader). Avec le GPU réel : **60 fps stables**, pire image à
19,3 ms, zéro saccade — sur les deux écrans. Le halo dégradé « pour la
performance » a donc été rétabli.

Leçon : ne jamais conclure d'une mesure sans vérifier que l'environnement de
test ressemble à la cible.

## Esthétique

- **Lobby visuel** : les joueurs apparaissent avec pseudo, couleur et forme, les
  places libres en pointillés. Un compteur « 3 joueur(s) » ne prouvait à
  personne que son téléphone était connecté.
- **Décompte 3-2-1-GO** : le jeu basculait du lobby au terrain sans prévenir.
- **Titre** : suppression du dégradé cyan-violet-orange, remplacé par un aplat
  et un mot accentué. Le camaïeu trichrome est la signature visuelle qu'on
  repère immédiatement comme générique.
- Bouton de lancement avec état de chargement, `prefers-reduced-motion`.

## Reste à faire

- Boucles de jeu manquantes : bonus, récompense du risque, zone qui rétrécit,
  statistiques de fin de manche (les données sont déjà collectées)
- Podium en trois marches (l'écran de fin reste une liste)
- Coût de capture sur carte `immense` : 12,6 ms mesurés, à borner à la boîte
  englobante de la boucle avant d'ouvrir cette taille en production
- Usurpation de pseudo à la reconnexion (risque social, pas technique)

## Vérifications

18 tests IO · 10 tests caméra · 6 tests d'identité · non-régression des 6 autres
jeux — tous au vert. Réseau : 5,5 Ko/s écran, 2,2 Ko/s téléphone.
