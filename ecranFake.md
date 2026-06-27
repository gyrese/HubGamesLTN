# Fake Artist — Inventaire complet des écrans

> Document de référence pour la refonte design globale par Stitch.
> Contexte : Fake Artist est un jeu de dessin, de bluff et d'enquête multijoueur en temps réel (inspiré de *A Fake Artist Goes to New York*). 
> Identité visuelle actuelle : Style Comic Book BD (néo-brutalisme, contours noirs épais, ombres décalées, couleurs rétro vives). La refonte vise à lui donner un aspect plus premium, ludique ou moderne selon les directives de Stitch.

---

## Architecture des vues

Le jeu se compose de deux parcours parallèles synchronisés via WebSockets :

```
HÔTE (FakeArtistHostView)        JOUEUR (FakeArtistPlayerView)
─────────────────────────        ─────────────────────────────
    CREATING                          JOIN FORM
       ↓                                  ↓
    LOBBY             ←→              LOBBY
       ↓                                  ↓
       │                              ROLE_REVEAL (Rôle secret)
       │                                  ↓
    PLAYING           ←→              PLAYING (Dessin actif/passif)
       ↓                                  ↓
    VOTING            ←→              VOTING (Vote suspect)
       ↓                                  ↓
    GUESSING (Devinette) ←→           GUESSING (Saisie mot si démasqué)
       ↓                                  ↓
    GAME_END          ←→              GAME_END
```

---

## Écran 1 — Page de sélection / Accueil Fake Artist

**Fichier :** `client/src/pages/fakeArtist/FakeArtistSelectPage.jsx`  
**Route :** `/fakeartist`

### Rôle
Point d'entrée du jeu. L'utilisateur choisit d'héberger la partie (affichage grand écran) ou de la rejoindre sur son mobile.

### Éléments UI actuels
- Logo avec emojis 🕵️‍♂️🎨
- Titre : « Fake Artist » avec ombre décalée rouge
- Tagline : « Un seul dessin · Un imposteur · Saurez-vous le trouver ? »
- Mots d'action style BD flottants (IMPOSTEUR ?, TRAIT UNIQUE !, DÉMASQUÉ !, INTRIGUE...)
- Bouton rouge « Créer une partie (Hôte) »
- Bouton bleu « Rejoindre une partie »
- Bouton de retour au menu principal

### Transitions
- → `/fakeartist/host` (créer)
- → `/fakeartist/play` (rejoindre)
- → `/` (retour accueil)

---

## Écran 2 — Hôte : Création de salle (état transitoire)

**Fichier :** `client/src/components/FakeArtist/FakeArtistHostView.jsx` — état `CREATING`  
**Route :** `/fakeartist/host`

### Rôle
Écran de chargement court pendant que le serveur génère le code du salon.

### Éléments UI actuels
- Icône de sablier tournant
- Message : « Création du salon... »

### Transitions
- → état LOBBY (automatique à la réception du code)

---

## Écran 3 — Hôte : Salon d'attente (Lobby)

**Fichier :** `client/src/components/FakeArtist/FakeArtistHostView.jsx` — état `LOBBY`  
**Route :** `/fakeartist/host`

### Rôle
L'hôte attend que tous les joueurs rejoignent, configure la partie (nombre de manches, temps de dessin, catégories), puis la lance.

### Éléments UI actuels
- **En-tête** : Titre « Fake Artist » et code de salon à 6 caractères en très grand (fond rouge).
- **QR Code et URL** : QRCode SVG pour permettre aux joueurs de scanner et rejoindre directement avec l'URL de connexion.
- **Liste des Joueurs** : Grille affichant les joueurs connectés avec leur pseudo, leur avatar et leur couleur de dessin attitrée.
- **Panneau de Réglages** :
  - Nombre de passages (1 à 3 traits par joueur, défaut : 2).
  - Temps par trait (20s, 30s, 45s, 60s, défaut : 30s).
- **Bouton Lancement** : Bouton vert « Lancer la partie », désactivé si moins de 3 joueurs.

### Transitions
- → état PLAYING (au clic du bouton, émet `fakeartist-start-game`)

---

## Écran 4 — Hôte : Partie en cours (Dessin / Playing)

**Fichier :** `client/src/components/FakeArtist/FakeArtistHostView.jsx` — état `PLAYING`  
**Route :** `/fakeartist/host`

### Rôle
Affiche le canvas commun à toute l'assemblée. Les traits apparaissent en temps réel à mesure que le dessinateur actif trace sa ligne. Le mot secret reste masqué sur cet écran pour que les spectateurs puissent aussi enquêter !

### Éléments UI actuels
- **Barre supérieure** : Manche en cours (ex: 1/2), Catégorie du mot secret (en grand), minuteur de tour avec barre de progression jaune/rouge.
- **Canvas central** : Grand cadre blanc entouré de noir affichant le tracé commun en temps réel.
- **Barre latérale (Sidebar)** : Ordre de dessin des joueurs avec indicateur visuel (fond jaune) et mention « Dessine... » clignotante pour le joueur dont c'est le tour.
- **Bandeau inférieur** : Alerte rouge indiquant quel joueur est en train d'ajouter son trait.

### Transitions
- → état VOTING (automatique une fois tous les tours terminés)

---

## Écran 5 — Hôte : Phase de vote (Voting)

**Fichier :** `client/src/components/FakeArtist/FakeArtistHostView.jsx` — état `VOTING`  
**Route :** `/fakeartist/host`

### Rôle
Affiche le dessin terminé. Un compte à rebours de 60 secondes s'enclenche pour le débat. L'écran affiche en temps réel qui a validé son vote.

### Éléments UI actuels
- **En-tête** : Alerte rouge « Délibération & Vote ! » et décompte de discussion.
- **Canvas central** : Affiche le dessin complet figé.
- **Sidebar de vote** : Liste des joueurs avec une icône de validation verte (Check) dès qu'ils ont soumis leur vote sur leur mobile.
- **Bandeau inférieur** : Invite de vote.

### Transitions
- → état GUESSING (si l'imposteur a reçu le plus de votes)
- → état GAME_END (si un artiste innocent a été accusé)

---

## Écran 6 — Hôte : Verdict & Devinette de l'imposteur (Guessing)

**Fichier :** `client/src/components/FakeArtist/FakeArtistHostView.jsx` — état `GUESSING`  
**Route :** `/fakeartist/host`

### Rôle
Si l'imposteur est démasqué par les joueurs, il a une dernière chance. Cet écran affiche sa proposition de mot secret, et l'hôte doit décider si elle est correcte ou non.

### Éléments UI actuels
- **Panneau de verdict** : Affiche le nom du joueur accusé en rouge avec la mention « Accusé à la majorité ».
- **Zone de Devinette** :
  - Affiche « L'imposteur réfléchit... » puis la proposition de l'imposteur (ex: "PIKACHU") en grand.
  - Affiche le mot secret d'origine à titre de comparaison pour l'hôte.
- **Boutons d'arbitrage** : Bouton vert « OUI, correct » et bouton rouge « NON, incorrect » que l'hôte doit cliquer pour clore le jeu.

### Transitions
- → état GAME_END (au clic sur l'un des boutons d'arbitrage, émet `fakeartist-host-decision`)

---

## Écran 7 — Hôte : Fin de partie (Game End)

**Fichier :** `client/src/components/FakeArtist/FakeArtistHostView.jsx` — état `GAME_END`  
**Route :** `/fakeartist/host`

### Rôle
Affiche le dénouement : l'équipe gagnante (Artistes ou Imposteur), le mot secret, l'identité de l'imposteur et le tableau des scores final.

### Éléments UI actuels
- **Bannière de victoire** : Grand bandeau coloré (vert pour les Artistes, rouge pour l'Imposteur) avec confettis animés.
- **Révélation** : Identité de l'imposteur et le mot secret.
- **Tableau des scores** : Classement complet des joueurs par points décroissants avec badges distinctifs (ex: badge rouge "Imposteur").
- **Bouton d'action** : Bouton jaune « Rejouer / Retour au lobby » pour réinitialiser la salle.

### Transitions
- → état LOBBY (au clic sur Rejouer, émet `fakeartist-restart-game`)

---

## Écran 8 — Joueur : Connexion / Rejointe

**Fichier :** `client/src/components/FakeArtist/FakeArtistPlayerView.jsx` — état `!isJoined`  
**Route :** `/fakeartist/play` ou `/fakeartist/play/:roomCode`

### Rôle
Le joueur saisit son pseudo, sélectionne son avatar (parmi 60 visuels) et le code du salon pour entrer dans la partie.

### Éléments UI actuels
- En-tête « Fake Artist »
- Zone d'erreur (si le salon est plein, inexistant ou si la partie a commencé)
- Input de pseudo
- Input de code de salon (lettres majuscules)
- Carrousel de sélection d'avatar (boutons fléchés gauche/droite)
- Bouton jaune « Rejoindre »

### Transitions
- → état LOBBY (en cas de succès)

---

## Écran 9 — Joueur : Salon d'attente (Lobby)

**Fichier :** `client/src/components/FakeArtist/FakeArtistPlayerView.jsx` — état `LOBBY`  
**Route :** `/fakeartist/play`

### Rôle
Attente du lancement du jeu par l'hôte.

### Éléments UI actuels
- Affichage de l'avatar et du pseudo du joueur.
- Badge bleu indiquant la couleur de tracé assignée au joueur pour la partie (ex: « Couleur assignée : Vert » avec pastille colorée).
- Message d'attente animé : « En attente de l'hôte... »

### Transitions
- → état ROLE_REVEAL (automatique à la réception de `fakeartist-role-assigned`)

---

## Écran 10 — Joueur : Révélation du rôle secret

**Fichier :** `client/src/components/FakeArtist/FakeArtistPlayerView.jsx` — état `ROLE_REVEAL`  
**Route :** `/fakeartist/play`

### Rôle
Écran hautement confidentiel montrant le rôle du joueur (Artiste ou Imposteur), la catégorie, et le mot secret.

### Éléments UI actuels
- **Titre** : « Votre rôle secret »
- **Rôle** : « Artiste » (en vert) ou « L'Imposteur » (en rouge avec emoji 🕵️‍♂️).
- **Mot secret** : Affiche le mot en grand pour les Artistes, ou un point d'interrogation « ? » pour l'Imposteur.
- **Catégorie** : Rappel de la catégorie en rouge.
- **Couleur** : Rappel de la couleur de tracé.
- **Instructions de jeu** : Textes explicatifs spécifiques au rôle.
- **Bouton d'action** : Bouton vert « Compris, je suis prêt ! » pour fermer la modale.

### Transitions
- → état PLAYING (au clic sur le bouton, émet `fakeartist-confirm-role`)

---

## Écran 11 — Joueur : Dessin en cours (Playing)

**Fichier :** `client/src/components/FakeArtist/FakeArtistPlayerView.jsx` — état `PLAYING`  
**Route :** `/fakeartist/play`

### Rôle
Deux sous-états selon le tour de rôle :

#### Sous-état A : Joueur inactif (Spectateur)
- **UI** : En-tête avec la catégorie et rappel du mot secret (ou `?`). Mention « [Nom] dessine... » dans la barre d'information. Cadre central montrant une version statique du canvas pour voir le dessin progresser. Zone inférieure indiquant de regarder l'écran géant.

#### Sous-état B : Joueur actif (Dessinateur)
- **UI** : Message clignotant jaune « À TOI DE DESSINER ! ».
- **Canvas interactif** : Le joueur peut dessiner **un seul trait continu** sur la zone blanche. Le tracé apparaît en temps réel sur l'écran de l'hôte (via socket `fakeartist-draw-stroke-live`).
- **Options de validation (après avoir levé le doigt)** :
  - Bouton rouge « Recommencer » : Efface le trait tracé localement et sur l'hôte, permettant de recommencer son tracé.
  - Bouton vert « Valider le trait » : Soumet définitivement le tracé au serveur (socket `fakeartist-validate-stroke`), verrouille le trait et passe le tour au joueur suivant.

### Transitions
- → état VOTING (automatique à la fin des rounds de dessin)

---

## Écran 12 — Joueur : Phase de vote (Voting)

**Fichier :** `client/src/components/FakeArtist/FakeArtistPlayerView.jsx` — état `VOTING`  
**Route :** `/fakeartist/play`

### Rôle
Les joueurs votent pour le suspect de leur choix sur leur téléphone.

### Éléments UI actuels
- **État non-voté** : Grille de boutons contenant la liste des autres joueurs. Chaque bouton montre l'avatar du suspect, son pseudo et sa couleur de dessin (pour faire le lien avec les tracés suspects du dessin commun). Cliquer sur un bouton émet le vote.
- **État voté** : Écran de confirmation vert « Vote enregistré ! » indiquant pour qui le joueur a voté, en attente des autres joueurs.

### Transitions
- → état GUESSING (si l'imposteur est désigné par les votes)
- → état GAME_END (si un artiste innocent est désigné)

---

## Écran 13 — Joueur : Verdict & Devinette de l'imposteur (Guessing)

**Fichier :** `client/src/components/FakeArtist/FakeArtistPlayerView.jsx` — état `GUESSING`  
**Route :** `/fakeartist/play`

### Rôle
Deux sous-états selon le rôle :

#### Sous-état A : Le joueur est l'Imposteur
- **UI** : Affiche un badge rouge « Démasqué ! ». Un texte explique qu'il peut encore voler la victoire en trouvant le mot. Un champ de saisie texte (input) s'affiche pour taper sa proposition, avec un bouton « Soumettre ma devinette ». Une fois soumis, l'écran passe en attente de la validation de l'hôte.

#### Sous-état B : Le joueur est un Artiste
- **UI** : Message vert « Imposteur démasqué ! ». Zone d'attente indiquant « L'imposteur propose un mot... » avec une animation de sablier.

### Transitions
- → état GAME_END (automatique à la validation de l'hôte)

---

## Écran 14 — Joueur : Fin de partie (Game End)

**Fichier :** `client/src/components/FakeArtist/FakeArtistPlayerView.jsx` — état `GAME_END`  
**Route :** `/fakeartist/play`

### Rôle
Affiche les résultats de fin de partie.

### Éléments UI actuels
- Icône de trophée (Victoire) ou de crâne (Défaite).
- Mention « Victoire ! » ou « Défaite... » en grand.
- Rappel du mot secret d'origine.
- Score final accumulé par le joueur.
- Message d'attente de relance : « En attente du lancement d'une nouvelle partie par l'hôte... »

### Transitions
- → état LOBBY (lorsque l'hôte relance une partie)
