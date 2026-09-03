# Illustrations des mini-jeux

Chaque mini-jeu s'affiche au vote de début de manche avec une illustration, un
titre et une description.

Par défaut l'illustration est **procédurale** : un aplat de la couleur déclarée
par le module, un damier discret et une grande icône. Un nouveau mini-jeu est
donc jouable sans attendre qu'on lui dessine quoi que ce soit.

## Fournir une vraie illustration

1. Déposer le fichier ici, par exemple `reflexe.jpg`.
2. Déclarer son chemin dans le module correspondant
   (`server/party/minigames/<id>.js`) :

   ```js
   image: '/party/reflexe.jpg',
   ```

`image` prend le pas sur l'illustration procédurale, sans autre changement de
code.

## Format

- **Ratio 16/9**, recadré en `cover` — ne pas mettre de texte près des bords.
- **1280 × 720 px** suffit largement : l'image ne dépasse jamais le tiers d'un
  écran, même sur le grand écran du bar.
- JPEG de préférence, ces images partent sur des téléphones en 4G.
- Le coin haut droit accueille le compteur de voix et le coin haut gauche la
  coche de sélection : garder ces deux zones lisibles.
