# Catalogue d'idées — nouveaux jeux GAME_HUB

> Contexte : animation du bar **Les Toiles Noires**. Contraintes permanentes :
> grand écran lisible de loin, joueurs qui arrivent/partent en cours de soirée,
> manches de 3 à 8 minutes, règles compréhensibles sans explication, fidélisation
> des habitués.

## Barème de coût

Unité de référence = un jeu complet existant (ex. Fake Artist) :
`gameManager.js` (~570 l.) + `controller.js` (~440 l.) + `SelectPage` + `HostView` (~770 l.)
+ `PlayerView` (~870 l.) + `Styles.css` (~220 l.) ≈ **2 900 lignes / 6 fichiers**.

| Taille | Effort | Description |
|--------|--------|-------------|
| **S** | ~1 soirée | Réutilise un moteur existant, aucune mécanique réseau neuve |
| **M** | 2 à 4 soirées | Nouveau manager + 2 vues + thème CSS, mécanique inédite |
| **L** | ~1 semaine | Machine à états complexe, rôles, assets, modération |
| **XL** | chantier | Plusieurs semaines, contenu à produire en continu |

---

# TIER S — rentabilité immédiate

### 1. ZOOM_OUT — « c'est quoi ce pixel ? »
- **Gameplay** : une image démarre zoomée à 4000 % et dézoome lentement. Les joueurs
  buzzent dès qu'ils reconnaissent (affiche de film, screenshot de jeu, personnage
  d'anime). Points dégressifs : 1000 pts à 2 s, 200 pts à 20 s. Une mauvaise réponse
  = verrouillé jusqu'à la fin de la manche.
- **Écran** : l'image plein cadre qui dézoome + jauge de points qui fond.
  **Téléphone** : un gros bouton BUZZ, puis champ texte ou 4 choix.
- **Style** : « scanner d'analyse » — réticule, vignettage, scanlines, cyan sur noir.
- **Réutilise** : pipeline d'upload d'images de CouleurMoi (Multer + admin), fuzzy
  matching de Draw, scoring dégressif du Quiz.
- **Coût** : **S**. Variante gratuite : pixelisation qui se résorbe au lieu du zoom.

### 2. BLIND_TEST — génériques, OST et répliques
- **Gameplay** : extrait audio de 15 s (générique de série, thème de jeu vidéo,
  réplique culte). Premier qui buzze bloque la salle et a 5 s pour répondre.
  Manches thématiques : « OST Nintendo », « génériques des années 90 », « Ghibli ».
- **Écran** : spectre audio réactif + pochette floutée qui se révèle à la réponse.
  **Téléphone** : buzzer plein écran avec retour haptique.
- **Style** : platine vinyle / VU-mètre analogique, ambre chaud sur noir.
- **Réutilise** : `utils/audio.js` et `soundManager.js`, structure du quizManager,
  admin d'upload existant (ajouter le type `audio/mpeg` à Multer).
- **Coût** : **S+**. Le vrai travail est éditorial : constituer la banque d'extraits.

### 3. PLUS_OU_MOINS — duel de stats pop-culture
- **Gameplay** : deux œuvres face à face. « Quel film a fait le plus d'entrées ? »
  « Quel jeu s'est le plus vendu ? » « Quel anime a le plus d'épisodes ? ».
  Tout le monde répond en simultané en 5 s, série de bonnes réponses = multiplicateur.
- **Écran** : split-screen d'affiches, révélation des chiffres qui défilent en compteur.
  **Téléphone** : deux moitiés d'écran, gauche / droite.
- **Style** : affrontement type jeu de combat — VS central, flash à la révélation.
- **Réutilise** : boucle du quiz, contenu = simple JSON `{ a, b, valeurA, valeurB, unité }`.
- **Coût** : **S**. Idéal en jeu de transition entre deux gros formats.

### 4. LE JUSTE CHIFFRE — le curseur
- **Gameplay** : question numérique (« combien de morts dans la saison 1 de GoT ? »,
  « année de sortie de Half-Life ? », « durée de Titanic en minutes ? »). Chacun place
  un curseur, score = proximité, exactement comme la distance dans GeoTrackr.
- **Écran** : ligne graduée où les avatars des joueurs se posent en temps réel, puis
  la vraie valeur tombe et les écarts s'affichent.
  **Téléphone** : gros slider + saisie fine au clavier.
- **Style** : thermomètre rétro-industriel, aiguille, graduations gravées.
- **Réutilise** : le scoring par proximité de `geoGameManager`, tel quel.
- **Coût** : **S**. Contenu quasi gratuit à écrire.

### 5. SURVIVOR — vrai/faux à élimination
- **Gameplay** : tout le bar joue debout. Une affirmation, 5 s, vrai ou faux. Les
  perdants sont éliminés et le compteur de survivants chute à l'écran. Dernier debout
  = tournée symbolique. Une partie dure 4 minutes, on peut la relancer dix fois.
- **Écran** : compteur géant de survivants + mur d'avatars qui s'éteignent un par un.
  **Téléphone** : deux boutons plein écran, vert / rouge.
- **Style** : néon rouge d'alerte, sirène douce, compte à rebours agressif.
- **Réutilise** : quizManager avec un mode `elimination`.
- **Coût** : **S**. Le meilleur format « drop-in » du catalogue : on rejoint la manche suivante.

### 6. EMOJI_MOVIE — traduis-moi ça
- **Gameplay** : une suite d'emojis décrit un film, une série, un jeu ou un anime.
  Réponse libre au clavier, fuzzy matching, points dégressifs. Un indice (première
  lettre, puis année) tombe toutes les 15 s.
- **Écran** : les emojis en très grand, qui pulsent. Les bonnes réponses arrivent en
  cascade avec le pseudo.
  **Téléphone** : champ texte + envoi.
- **Style** : bulle de messagerie géante, fond dégradé, typographie ronde.
- **Réutilise** : l'algorithme de similarité de `drawGameManager`, l'admin mots de Draw
  (import/export déjà en place).
- **Coût** : **S**. Zéro asset : le contenu est du texte.

### 7. UNDERCOVER — le Fake Artist sans crayon
- **Gameplay** : tout le monde reçoit le même mot secret… sauf un joueur qui en reçoit
  un proche (« Batman » vs « Iron Man »). Chacun décrit son mot à voix haute en un seul
  mot, à tour de rôle, puis vote. L'imposteur gagne s'il survit ou s'il devine le mot.
- **Écran** : le tour de parole, un chrono par joueur, la grille de votes.
  **Téléphone** : ton mot secret + le vote.
- **Style** : film noir — clair-obscur, néon rouge, typo condensée.
- **Réutilise** : **80 % de `fakeArtistGameManager`** (rôles, vote, résolution, guess)
  en retirant le canvas. C'est la reprise la plus directe du dépôt.
- **Coût** : **S**. Excellent rapport rire/lignes de code.

### 8. QUI A DIT ÇA ? — répliques cultes
- **Gameplay** : une réplique s'affiche en sous-titre, 4 films/séries proposés.
  Variante corsée : deviner le personnage, pas l'œuvre.
- **Écran** : letterbox 2.39:1, la réplique en sous-titre blanc sur bandes noires,
  grain de pellicule.
  **Téléphone** : 4 boutons colorés (déjà codés dans le Quiz).
- **Style** : projection cinéma — c'est littéralement l'identité du bar.
- **Réutilise** : moteur Quiz intégral, uniquement un thème CSS et un pack de contenu.
- **Coût** : **S−**. Presque un « skin » de NEURAL_QUIZ, mais l'effet en salle est fort.

---

# TIER M — mécaniques neuves, grosses soirées

### 9. LE MENSONGE — le Fibbage maison ⭐
- **Gameplay** : une question à réponse improbable (« Au Japon, il est interdit de… »).
  Phase 1 : chacun écrit une **fausse** réponse crédible. Phase 2 : toutes les fausses
  + la vraie sont mélangées et affichées, tout le monde vote. 500 pts si tu trouves la
  vraie, 250 pts par joueur piégé par ton mensonge.
- **Écran** : les propositions arrivent une par une, puis les avatars des votants se
  posent dessus, puis révélation animée du menteur.
  **Téléphone** : clavier en phase 1, liste de choix en phase 2.
- **Style** : plateau de télé-crochet — velours sombre, dorures, spots.
- **Réutilise** : la structure à deux phases de Fake Artist (soumission puis vote).
- **Coût** : **M**. Attention : filtrage anti-doublon (une fausse réponse identique à la
  vraie doit être renvoyée à l'auteur) et bouton de modération hôte.
- **Pourquoi en premier** : c'est le format qui génère le plus de rires par minute en bar,
  et il tourne indéfiniment avec du contenu écrit à la volée.

### 10. PUNCHLINE — duels d'humour
- **Gameplay** : chaque joueur reçoit 2 prompts (« la pire réplique de drague d'un Jedi »).
  Chaque prompt oppose 2 joueurs, le reste du bar vote. 3 manches, la dernière compte double.
- **Écran** : le duel côte à côte, barre de vote qui se remplit en direct, gagnant en confettis.
  **Téléphone** : saisie libre puis vote.
- **Style** : scène de stand-up — rideau rouge, projecteur, micro.
- **Réutilise** : même socle que LE MENSONGE (soumission → vote) : si tu fais le 9,
  le 10 coûte moitié prix.
- **Coût** : **M** seul, **S+** si construit après LE MENSONGE.
- **Prévoir** : bouton hôte « censurer cette réponse » — indispensable en bar.

### 11. TOP 8 — « une famille en or » geek
- **Gameplay** : « Citez un personnage de Star Wars », 8 cases cachées classées par
  popularité. Les joueurs proposent en continu, chaque bonne réponse retourne une case
  et rapporte selon son rang. Chrono commun de 90 s, jeu coopératif ou par équipes.
- **Écran** : le tableau des 8 cases qui se retournent avec un son satisfaisant.
  **Téléphone** : champ texte, envoi rapide en rafale.
- **Style** : plateau télé années 80 — ampoules, chrome, bleu électrique.
- **Réutilise** : fuzzy matching de Draw (déjà éprouvé), admin de contenu.
- **Coût** : **M**. Le contenu est facile à produire (listes de 8).

### 12. CHRONOLOGIE — remets ça dans l'ordre
- **Gameplay** : 5 cartes (sorties de films, consoles, événements historiques, épisodes)
  à ordonner par glisser-déposer sur le téléphone. Score = nombre de paires dans le bon
  ordre, pas tout-ou-rien. Bonus rapidité.
- **Écran** : les 5 cartes qui se réordonnent en direct, puis la vraie frise se déplie.
  **Téléphone** : liste réordonnable au doigt (touch drag).
- **Style** : frise muséale — parchemin sombre, sérif, dorure.
- **Réutilise** : rien de spécifique, mais le drag mobile est un composant réutilisable
  ensuite pour d'autres jeux.
- **Coût** : **M**. Le drag tactile fiable est le seul vrai point dur.

### 13. TÉLÉPHONE ARABE ILLUSTRÉ — le Gartic Phone maison ⭐
- **Gameplay** : chacun écrit une phrase. Elle passe au voisin qui la dessine. Le dessin
  passe au suivant qui écrit ce qu'il voit. Et ainsi de suite. À la fin, **restitution de
  chaque album sur le grand écran**, étape par étape.
- **Écran** : phase de jeu = simple avancement. Puis le moment fort : l'album se déroule
  en diaporama commenté, le bar hurle.
  **Téléphone** : alternance clavier / canvas.
- **Style** : carnet de croquis — papier texturé, ruban adhésif, polaroïds épinglés.
- **Réutilise** : **le canvas de DRAW_UP intégralement**, y compris le lissage de traits
  récemment ajouté.
- **Coût** : **M+**. Points durs : la rotation en anneau quand un joueur se déconnecte
  (prévoir un remplissage automatique) et le stockage des dessins (base64 en mémoire,
  purge à la fin de partie).
- **Pourquoi** : c'est le jeu qui produit le meilleur souvenir de soirée. Le reveal final
  est imbattable sur grand écran.

### 14. DÉCRIS-MOI — Time's Up numérique
- **Gameplay** : par équipes. Un joueur voit un mot sur son téléphone et le fait deviner
  **à voix haute** au bar. Les autres buzzent. 45 s par manche, 3 manches avec des
  contraintes croissantes : description libre → un seul mot → mime.
- **Écran** : chrono géant, score des équipes, mots trouvés qui s'empilent.
  **Téléphone** : le mot + boutons « trouvé » / « passe » (2 passes max).
- **Style** : sablier, sarcelle et corail, très lisible de loin.
- **Réutilise** : banque de mots de Draw, système d'équipes à créer (réutilisable ailleurs).
- **Coût** : **M**. Le jeu le plus « physique » du catalogue, parfait pour ambiancer.

### 15. ARÈNE — tournoi 1v1 à élimination
- **Gameplay** : bracket affiché sur grand écran. Duels de 20 s tirés au sort parmi des
  micro-épreuves : buzzer de réaction, séquence de couleurs à mémoriser, tap le plus
  rapide, question éclair, « trouve l'intrus ». Le vainqueur monte dans l'arbre.
- **Écran** : l'arbre de tournoi qui se remplit, gros plan sur le duel en cours.
  **Téléphone** : contrôle qui change à chaque épreuve.
- **Style** : arcade de combat — barres de vie, KO, effets d'impact.
- **Réutilise** : peu, mais chaque micro-épreuve est minuscule et s'ajoute au fil du temps.
- **Coût** : **M** pour le socle + bracket, puis **S−** par micro-épreuve ajoutée.
  C'est un jeu qui grossit tout seul.

### 16. QUI EST-CE ? DU BAR — le jeu sur les gens présents
- **Gameplay** : « Qui, dans cette salle, est le plus susceptible de survivre à une
  apocalypse zombie ? » Chacun vote pour un joueur présent. La révélation affiche le
  podium des votes. Aucun bon ou mauvais choix — pure ambiance. Optionnel : deviner qui
  a le plus de votes pour marquer des points.
- **Écran** : les avatars, les votes qui atterrissent, le « gagnant » couronné.
  **Téléphone** : liste des joueurs présents.
- **Style** : chaleureux, néon rose, façon polaroid de soirée.
- **Réutilise** : le vote de Fake Artist.
- **Coût** : **M−**. Zéro contenu à produire hors les questions. Redoutable pour les habitués.

---

# TIER L — événements de soirée

### 17. LES TOILES NOIRES : NUIT — loup-garou assisté
- **Gameplay** : le serveur est le maître du jeu. Distribution des rôles sur les
  téléphones (Loup, Voyante, Sorcière, Chasseur, Cupidon…), phases nuit/jour
  chronométrées, narration audio et ambiance sur le grand écran, votes anonymes,
  élimination théâtrale. 15 à 30 joueurs.
- **Écran** : ambiance nocturne, lune, brouillard, silhouettes des joueurs qui
  s'éteignent. Le jour : le débat avec le chrono et la grille de vote.
  **Téléphone** : ton rôle, tes actions de nuit.
- **Style** : gothique — village enneigé, gravure, rouge sang sur gris.
- **Coût** : **L**. Machine à états lourde (rôles × phases × interactions), gestion des
  morts qui doivent rester spectateurs. Mais c'est *le* jeu qui remplit un bar un soir de
  semaine et qui devient un rendez-vous mensuel.

### 18. BRAQUAGE — coopératif asymétrique
- **Gameplay** : le grand écran affiche la salle des coffres et une alarme qui monte.
  Chaque téléphone reçoit **un panneau de contrôle différent** (leviers, codes, câbles)
  et **des instructions destinées à quelqu'un d'autre**. Il faut crier les bonnes infos
  aux bonnes personnes avant la fin du chrono. Type Spaceteam / Keep Talking.
- **Écran** : plan du coffre, jauge d'alerte, actions réussies/ratées en direct.
  **Téléphone** : interface différente pour chacun, boutons gros et tactiles.
- **Style** : thriller technique — vert phosphore sur noir, schémas d'ingénieur, glitch.
- **Coût** : **L**. Génération procédurale des puzzles + synchronisation serrée.
  Effet garanti : c'est du bruit, du stress et du rire collectif.

### 19. ENQUÊTE — escape game de comptoir (30 min)
- **Gameplay** : une affaire à résoudre par tables. Chaque table reçoit des indices
  différents sur ses téléphones et doit échanger avec les autres tables. Le grand écran
  tient le compte à rebours, l'ambiance sonore et le tableau d'enquête.
- **Écran** : tableau de liège avec fils rouges, photos, chrono.
  **Téléphone** : indices, carnet de notes, soumission de l'accusation finale.
- **Style** : polar — dossier confidentiel, tampons, machine à écrire.
- **Coût** : **L** pour le moteur, **XL** avec la production de contenu (chaque enquête
  est un scénario à écrire). Modèle : un moteur + un scénario par trimestre.

### 20. SOIRÉE PLATEAU — le Mario Party du bar
- **Gameplay** : un plateau affiché sur le grand écran, les avatars avancent selon les
  résultats des mini-jeux, cases bonus/malus, 45 minutes de partie. Le liant entre tous
  les jeux courts du Tier S.
- **Coût** : **XL**, mais il ne se justifie qu'après avoir 6 à 8 mini-jeux du Tier S.
  À garder en horizon, pas en priorité.

---

# SYSTÈMES TRANSVERSAUX — ce qui fidélise vraiment

### A. LA LIGUE DES TOILES NOIRES — saison persistante ⭐
- Profil habitué (pseudo + avatar, reconnu d'un soir à l'autre), points de saison, ELO,
  badges (« 10 blind-tests gagnés », « imposteur invaincu »), classement du mois.
- **Écran** : podium du mois affiché entre deux parties, montée de niveau annoncée en jeu.
- **Réutilise** : SQLite déjà en place (`server/db.js`), il ne manque que les tables
  `profiles`, `matches`, `badges` et un module de scoring.
- **Coût** : **M**. C'est le meilleur investissement long terme du dépôt : ça transforme
  un jeu ponctuel en raison de revenir la semaine suivante.

### B. MODE VEILLE — l'écran qui travaille tout seul
- Quand aucune partie ne tourne : rotation automatique entre classement du mois, QR code
  géant pour rejoindre, teasers des jeux, « record de la soirée », meilleurs dessins de
  la veille. Sans intervention de l'hôte.
- **Coût** : **S**. Une page, un carrousel, quelques requêtes. Rentabilité maximale :
  l'écran vend le jeu aux clients qui viennent juste boire un verre.

### C. LES PARIS DU COMPTOIR — couche méta sur tous les jeux
- Les spectateurs qui ne jouent pas (téléphone en mode « public ») misent des jetons
  virtuels sur qui va gagner la manche. Cotes calculées sur le classement en cours.
  Classement des parieurs séparé.
- **Coût** : **M**, mais s'accroche à **tous** les jeux existants d'un coup.
- **Pourquoi** : ça donne un rôle aux gens debout au bar, qui sont souvent la majorité.

### D. MODE SOIRÉE (déjà planifié dans CLAUDE.md)
- Enchaînement de plusieurs jeux avec score cumulé et podium global. Le plan existe déjà,
  il gagne à être étendu à tous les jeux du hub, pas seulement au quiz.

---

# Ordre de bataille recommandé

| Priorité | Item | Pourquoi |
|----------|------|----------|
| 1 | **ZOOM_OUT** (S) | Une soirée de dev, jouable dès le lendemain, réutilise l'upload d'images |
| 2 | **LE MENSONGE** (M) | Le meilleur ratio rires/effort, contenu infini écrit à la volée |
| 3 | **MODE VEILLE** (S) | L'écran recrute des joueurs tout seul pendant les creux |
| 4 | **LA LIGUE** (M) | Transforme les soirs isolés en habitude |
| 5 | **TÉLÉPHONE ARABE ILLUSTRÉ** (M+) | Le souvenir de soirée le plus marquant |
| 6 | **BLIND_TEST** (S+) | À lancer tôt car la banque d'extraits se constitue dans la durée |

Puis, au fil des semaines, ajouter les jeux du Tier S un par un (chacun tient dans une
soirée) et garder **LES TOILES NOIRES : NUIT** comme gros lancement d'événement.
