# Catalogue d'idées — nouveaux jeux GAME_HUB

> Contexte : animation du bar **Les Toiles Noires**. Contraintes permanentes :
> grand écran lisible de loin, joueurs qui arrivent/partent en cours de soirée,
> manches de 3 à 8 minutes, règles compréhensibles sans explication, fidélisation
> des habitués.
>
> **Périmètre.** Tout ce qui relève du **quiz** est hors de ce catalogue : c'est le
> domaine de **LTNHoot** (`c:/ai/LTNhout`), qui gère déjà QCM, vrai/faux, réponse
> libre, curseur, date, remise en ordre (`puzzle`), pointage sur image
> (`drop_pin`), grille d'images, séquence d'images, média audio/vidéo, révélation
> progressive (`pixelate`, grilles) et mort subite. Neuf idées ont été retirées à
> ce titre — voir « Ce qui est couvert par LTNHoot » en fin de document.
> Ne restent ici que les formats que LTNHoot **ne peut pas** produire : rôles
> cachés, écriture entre joueurs, dessin, vote social, coopératif asymétrique.
>
> **Voir aussi** : [idees-jeux-io.md](idees-jeux-io.md) pour les mécaniques .io
> (temps réel, le téléphone en simple joystick) et
> [idees-fonctionnalites.md](idees-fonctionnalites.md) pour le socle de plateforme.

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

### 1. UNDERCOVER — le Fake Artist sans crayon
- **Gameplay** : tout le monde reçoit le même mot secret… sauf un joueur qui en reçoit
  un proche (« Batman » vs « Iron Man »). Chacun décrit son mot à voix haute en un seul
  mot, à tour de rôle, puis vote. L'imposteur gagne s'il survit ou s'il devine le mot.
- **Écran** : le tour de parole, un chrono par joueur, la grille de votes.
  **Téléphone** : ton mot secret + le vote.
- **Style** : film noir — clair-obscur, néon rouge, typo condensée.
- **Réutilise** : **80 % de `fakeArtistGameManager`** (rôles, vote, résolution, guess)
  en retirant le canvas. C'est la reprise la plus directe du dépôt.
- **Coût** : **S**. Excellent rapport rire/lignes de code.

---

# TIER M — mécaniques neuves, grosses soirées

### 2. LE MENSONGE — le Fibbage maison ⭐
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

### 3. PUNCHLINE — duels d'humour
- **Gameplay** : chaque joueur reçoit 2 prompts (« la pire réplique de drague d'un Jedi »).
  Chaque prompt oppose 2 joueurs, le reste du bar vote. 3 manches, la dernière compte double.
- **Écran** : le duel côte à côte, barre de vote qui se remplit en direct, gagnant en confettis.
  **Téléphone** : saisie libre puis vote.
- **Style** : scène de stand-up — rideau rouge, projecteur, micro.
- **Réutilise** : même socle que LE MENSONGE (soumission → vote) : si tu fais le n°2,
  celui-ci coûte moitié prix.
- **Coût** : **M** seul, **S+** si construit après LE MENSONGE.
- **Prévoir** : bouton hôte « censurer cette réponse » — indispensable en bar.

### 4. TÉLÉPHONE ARABE ILLUSTRÉ — le Gartic Phone maison ⭐
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

### 5. DÉCRIS-MOI — Time's Up numérique
- **Gameplay** : par équipes. Un joueur voit un mot sur son téléphone et le fait deviner
  **à voix haute** au bar. Les autres buzzent. 45 s par manche, 3 manches avec des
  contraintes croissantes : description libre → un seul mot → mime.
- **Écran** : chrono géant, score des équipes, mots trouvés qui s'empilent.
  **Téléphone** : le mot + boutons « trouvé » / « passe » (2 passes max).
- **Style** : sablier, sarcelle et corail, très lisible de loin.
- **Réutilise** : banque de mots de Draw, système d'équipes à créer (réutilisable ailleurs).
- **Coût** : **M**. Le jeu le plus « physique » du catalogue, parfait pour ambiancer.

### 6. ARÈNE — tournoi 1v1 à élimination
- **Gameplay** : bracket affiché sur grand écran. Duels de 20 s tirés au sort parmi des
  micro-épreuves : buzzer de réaction, séquence de couleurs à mémoriser, tap le plus
  rapide, question éclair, « trouve l'intrus ». Le vainqueur monte dans l'arbre.
- **Écran** : l'arbre de tournoi qui se remplit, gros plan sur le duel en cours.
  **Téléphone** : contrôle qui change à chaque épreuve.
- **Style** : arcade de combat — barres de vie, KO, effets d'impact.
- **Réutilise** : peu, mais chaque micro-épreuve est minuscule et s'ajoute au fil du temps.
- **Coût** : **M** pour le socle + bracket, puis **S−** par micro-épreuve ajoutée.
  C'est un jeu qui grossit tout seul.

### 7. QUI EST-CE ? DU BAR — le jeu sur les gens présents
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

### 8. LES TOILES NOIRES : NUIT — loup-garou assisté
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

### 9. BRAQUAGE — coopératif asymétrique
- **Gameplay** : le grand écran affiche la salle des coffres et une alarme qui monte.
  Chaque téléphone reçoit **un panneau de contrôle différent** (leviers, codes, câbles)
  et **des instructions destinées à quelqu'un d'autre**. Il faut crier les bonnes infos
  aux bonnes personnes avant la fin du chrono. Type Spaceteam / Keep Talking.
- **Écran** : plan du coffre, jauge d'alerte, actions réussies/ratées en direct.
  **Téléphone** : interface différente pour chacun, boutons gros et tactiles.
- **Style** : thriller technique — vert phosphore sur noir, schémas d'ingénieur, glitch.
- **Coût** : **L**. Génération procédurale des puzzles + synchronisation serrée.
  Effet garanti : c'est du bruit, du stress et du rire collectif.

### 10. ENQUÊTE — escape game de comptoir (30 min)
- **Gameplay** : une affaire à résoudre par tables. Chaque table reçoit des indices
  différents sur ses téléphones et doit échanger avec les autres tables. Le grand écran
  tient le compte à rebours, l'ambiance sonore et le tableau d'enquête.
- **Écran** : tableau de liège avec fils rouges, photos, chrono.
  **Téléphone** : indices, carnet de notes, soumission de l'accusation finale.
- **Style** : polar — dossier confidentiel, tampons, machine à écrire.
- **Coût** : **L** pour le moteur, **XL** avec la production de contenu (chaque enquête
  est un scénario à écrire). Modèle : un moteur + un scénario par trimestre.

### 11. SOIRÉE PLATEAU — le Mario Party du bar
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
| 1 | **UNDERCOVER** (S) | Une soirée de dev : 80 % de `fakeArtistGameManager` est réutilisé tel quel |
| 2 | **LE MENSONGE** (M) | Le meilleur ratio rires/effort, contenu infini écrit à la volée |
| 3 | **MODE VEILLE** (S) | L'écran recrute des joueurs tout seul pendant les creux |
| 4 | **LA LIGUE** (M) | Transforme les soirs isolés en habitude |
| 5 | **TÉLÉPHONE ARABE ILLUSTRÉ** (M+) | Le souvenir de soirée le plus marquant |
| 6 | **QUI EST-CE ? DU BAR** (M−) | Zéro contenu à produire, redoutable sur les habitués |

Puis **PUNCHLINE** (moitié prix après LE MENSONGE) et **ARÈNE**, qui grossit tout seul
d'une micro-épreuve à la fois. **LES TOILES NOIRES : NUIT** reste le gros lancement
d'événement.

---

# Ce qui est couvert par LTNHoot (retiré de ce catalogue)

Ces neuf formats ne justifient pas un jeu dédié dans le hub : ils se produisent
en créant un quiz dans LTNHoot, sans une ligne de code.

| Idée retirée | Comment la faire dans LTNHoot |
|---|---|
| ZOOM_OUT | `revelationEnabled` + `revelationStyle: "pixelate"` sur une question `mcq` ou `open` |
| BLIND_TEST | `media.type: "audio"` (ou champ `audio`) + `suddenDeath` pour l'effet buzzer |
| PLUS_OU_MOINS | `mcq` à 2 réponses, l'affiche de chaque œuvre en `elements` de slide |
| LE JUSTE CHIFFRE | `slider` (`correctValue`, `min`, `max`, `tolerance`) — et `date` pour les années |
| SURVIVOR | `true_false` + `time` court. **Manque** : l'élimination progressive |
| EMOJI_MOVIE | `open` avec `correctAnswers[]` (plusieurs orthographes acceptées) |
| QUI A DIT ÇA ? | `mcq` + habillage letterbox ; c'était déjà décrit comme un simple skin |
| TOP 8 | `open`. **Manque** : les 8 cases classées et la saisie en rafale |
| CHRONOLOGIE | `puzzle` (`items[]` à remettre dans l'ordre) — exactement la mécanique décrite |

**Deux exceptions à garder en tête.** *SURVIVOR* et *TOP 8* ne sont couverts qu'à
moitié : la boucle d'élimination et le tableau à 8 cases n'existent pas dans
LTNHoot. Si ces deux formats comptent, l'investissement juste est de les ajouter
**comme un mode de LTNHoot**, pas de recréer un moteur de quiz dans le hub.
