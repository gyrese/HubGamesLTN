# FAKE ARTIST — Refonte complète (design + fonctionnel)

> Audit initial : 29 points relevés (3 bloquants, 13 bugs, 13 UX).
> Ce chantier les traite tous.

## Direction artistique — « NOIR INTERROGATION »

Sombre, cinématique, thème enquête criminelle. Cohérent avec le design system
`.dr-*` de Draw Me (Neon Arcade) mais identité propre :

| Rôle | Couleur | Usage |
|---|---|---|
| Fond | `#07070E` → `#12101F` | profondeur, vignettage |
| Ambre dossier | `#F5A524` | accent principal, hôte, CTA |
| Rouge sang | `#FF4757` | imposteur, danger, accusation |
| Cyan preuve | `#22D3EE` | artistes, validation, indices |
| Vert innocent | `#4ADE80` | succès, vote enregistré |

Namespace CSS : `.fa-*`, thème body `body.fa-noir`.
Polices : Space Grotesk (display), Inter (UI), JetBrains Mono (timers/codes).

## Tâches

### Bloquants design
- [x] 1. Design system `.fa-*` complet (remplace les 47 `sk-*` fantômes)
- [x] 2. Thème `body.fa-noir` (remplace `comic-theme` inexistant)
- [x] 3. Purger `border-3`, `border-b-3`, `rotate-8` (15 occurrences mortes)

### Bugs serveur
- [x] 4. Interdire le vote pour soi-même
- [x] 5. Égalité de vote → l'imposteur s'en sort (règle du jeu original)
- [x] 6. Comptage des votes robuste aux déconnexions
- [x] 7. Timer serveur VOTING + auto-résolution + forçage hôte
- [x] 8. Timer serveur GUESSING + auto-échec + forçage hôte
- [x] 9. Exploiter `hasConfirmedRole` (compteur "prêts" + départ du timer)
- [x] 11. Valider/borner les strokes (anti-DoS)
- [x] 12. Couleurs stables entre manches
- [x] 22. Scores enrichis (vote correct, survie, devinette)

### Bugs client
- [x] 10. Throttle du trait live (40 ms)
- [x] 13. QR direct `/fakeartist/play/:code`
- [x] 14. Gérer l'échec de validation de trait + handler `fakeartist-error`
- [x] 15. Timer visible sur le mobile du dessinateur
- [x] 16. Aligner marge timer client/serveur
- [x] 18. Sidebar hôte ordonnée selon `drawOrder` réel
- [x] 26. Overlays déconnexion hôte (2 côtés)

### UX / contenu
- [x] 19. Toggle « révéler le mot à l'hôte »
- [x] 20. Écran de dépouillement des votes (`fa-tally-bar` animées)
- [x] 21. Phase REVEAL (suspense avant le verdict)
- [x] 23. Liste des joueurs dans le lobby joueur
- [x] 24. Grille d'avatars (au lieu du carrousel 60 taps)
- [x] 25. Sélecteur de catégories dans le lobby hôte
- [x] 27. Bouton quitter sur les écrans hôte
- [x] 28. Échelle typographique lisible de loin (écran projeté)
- [x] 29. Écran spectateur utile (suspects + règles au lieu du canvas figé)

### Gameplay
- [x] 19b. Deux imposteurs au-delà de 7 joueurs
- [x] 23b. Replay animé du dessin trait par trait en phase de vote
- [x] Multi-manches avec cumul + podium final
- [x] Export PNG du dessin

## Revue
_(à compléter en fin de chantier)_

---

## Revue

### Ce qui a été fait

**Design — refonte complète en « Noir Interrogation »**

Le jeu était visuellement cassé : 47 classes `sk-*`, la classe de thème
`comic-theme` et 15 utilitaires Tailwind (`border-3`, `rotate-8`) n'étaient
définis nulle part. Concrètement, tous les boutons du jeu s'affichaient nus et
la page d'accueil était illisible (texte quasi-noir sur le fond noir du body).

Un design system `.fa-*` de 700 lignes remplace le tout : jetons de couleur,
surfaces, boutons, minuteurs, cartes joueur, dépouillement, tampons de verdict,
grilles d'avatars et de catégories, superpositions, animations — avec prise en
charge de `prefers-reduced-motion`. Direction : sombre et cinématique, ambre
dossier / rouge sang / cyan preuve, cohérente avec le `.dr-*` de Draw Me.

**Serveur — 10 correctifs**

- Vote pour soi-même désormais refusé (la garde n'existait qu'en façade côté UI)
- Égalité : le doute profite au faussaire, conformément au jeu original.
  L'ancienne règle désignait *systématiquement* l'imposteur en cas d'égalité,
  ce qui le pénalisait au lieu de l'avantager comme le commentaire le prétendait
- Décompte des votes robuste aux départs (ni blocage, ni résolution prématurée)
- **Minuteur de délibération** + bouton hôte « clore le vote » : un seul joueur
  silencieux figeait la partie pour toujours — c'était le pire bug en soirée
- **Minuteur de devinette** : même blocage si l'imposteur démasqué se taisait
- Tracés bornés (1200 points, épaisseur 2-24, coordonnées dans [0,1]),
  sur le chemin validé **et** sur le direct — 80 000 points traités en 122 ms
- Couleurs conservées d'une manche à l'autre (« le trait rouge, c'était Pierre »)
- Barème enrichi : +50 par vote juste, 200 si le faussaire survit, 150 s'il devine
- Deux faussaires dès 7 joueurs, réglable
- Codes de salon sans collision possible, réglages bornés côté serveur,
  autorisations hôte vérifiées sur chaque action sensible

**Client — 8 correctifs + 9 apports UX**

- Minuteur enfin visible sur le téléphone du dessinateur (l'état existait mais
  n'était jamais rendu)
- Échec de validation de trait géré : le joueur reprend la main au lieu de rester
  bloqué sur un écran inerte
- Tracé direct limité à ~22 envois/s au lieu d'un par `mousemove` avec le tableau
  complet à chaque fois (charge quadratique)
- Rail hôte trié selon le vrai ordre de passage (il affichait l'ordre d'arrivée)
- Superpositions de déconnexion des deux côtés (les handlers étaient vides)
- Canvas en résolution écran (`devicePixelRatio`)
- QR code pointant directement vers `/fakeartist/play/:code`
- Marges de minuteur alignées client/serveur

Apports : écran de dépouillement animé, phase REVEAL avec tampons, replay du
dessin trait par trait pendant le vote, sélection de catégories, grille
d'avatars (au lieu de 59 taps), liste des joueurs au lobby, révélation du mot
à l'hôte sur demande, export PNG, écran spectateur utile.

### Vérification

- `vite build` : succès
- `eslint` sur les 4 fichiers : aucun avertissement
- Logique métier : 30 assertions (votes, égalités, déconnexions, barème,
  2 imposteurs, stabilité des couleurs, normalisation des accents)
- Bout-en-bout réseau, partie complète : 23/23 — le mot ne fuite jamais vers
  l'imposteur, les couleurs sont imposées par le serveur, l'usurpation d'hôte
  est bloquée
- Scénarios de blocage : partie sans aucun dessin, votants silencieux,
  imposteur muet, tracés abusifs — tous se débloquent seuls

### Reste ouvert

L'indice pour l'imposteur (point 20 de l'audit) est câblé côté serveur et
affiché côté client, mais dépend du champ `hint` de `draw_words`, souvent vide
en base. À alimenter si l'on veut vraiment s'en servir.
