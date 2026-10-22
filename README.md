# En marge

Une bibliothèque d’envies de lecture : sélection de livres, recherche Open Library,
fiches détaillées, ajout manuel, modification, tags, filtres, tri et export JSON.
L’interface existante est conservée, sur ordinateur et mobile.

L’application est écrite en JavaScript natif : modules ES côté navigateur et serveur
HTTP Bun. Aucun framework, TypeScript, service de base de données ou dépendance
de production. Aucune compilation n’est nécessaire.

## Démarrer avec Bun

Installer [Bun 1.4.4 ou une version ultérieure](https://bun.com/docs/installation), puis :

```sh
bun install --frozen-lockfile
bun run dev
```

Ouvrir <http://localhost:4173>. Le serveur redémarre lorsque son code change.
Après une modification du JavaScript ou du CSS de l’interface, actualiser le
navigateur. Redémarrer le serveur après l’ajout d’un nouveau fichier public.

Pour un lancement simple, sans surveillance :

```sh
bun run start
```

Le serveur n’a besoin d’aucune installation de dépendance pour démarrer ;
`bun install` fournit seulement les outils de développement et de test.

Le port par défaut est `4173`, l’adresse d’écoute locale `127.0.0.1`.
Pour les modifier :

```sh
HOST=0.0.0.0 PORT=8080 bun run start
```

Le point de contrôle `GET /healthz` renvoie `{"status":"ok"}`.

## Démarrer avec Docker Compose

Docker et son plugin Compose suffisent ; Bun est inclus dans l’image.

```sh
docker compose up --build -d --wait
docker compose logs -f
```

Ouvrir <http://localhost:4173>. Pour utiliser un autre port :

```sh
PORT=8080 docker compose up --build -d --wait
```

On peut aussi copier `.env.example` vers `.env` et y renseigner `PORT`.
Cette variable définit le port publié par Compose ; le conteneur écoute sur `4173`.

```sh
docker compose down
```

L’image utilise Bun 1.4.4, s’exécute avec l’utilisateur `bun` et inclut un contrôle
de santé. Compose utilise un système de fichiers en lecture seule. Aucun volume
n’est nécessaire : les listes restent dans les navigateurs des utilisateurs.

Le Dockerfile peut également être utilisé directement :

```sh
docker build -t en-marge .
docker run --rm -p 4173:4173 en-marge
```

## Développement et vérifications

```sh
bun run format        # formater les sources
bun run check         # formatage et tests Bun du serveur, du stockage et des métadonnées
bunx playwright install chromium
bun run test:e2e      # parcours Chromium sur ordinateur et mobile
```

Les tests navigateur couvrent les ajouts/retraits, la persistance après
actualisation, l’annulation d’un retrait, les fiches manuelles, les tags, l’export,
la recherche, la pagination, le repli local et l’annulation d’une recherche.
Les services externes sont simulés pour rendre ces tests indépendants du réseau.

## Organisation

```text
public/
  index.html            Structure et formulaires
  style.css             Styles et adaptation mobile
  js/
    app.js              Interface, navigation et interactions
    catalogue.js        Sélection de livres et palette
    icons.js            Icônes SVG
    open-library.js     Recherche et normalisation des métadonnées
    storage.js          Lecture et validation des listes existantes
    utils.js            Échappement HTML et normalisation du texte
src/server.js           Serveur HTTP Bun
tests/unit/             Tests Bun
tests/browser/          Tests Playwright
Dockerfile
compose.yaml
```

Les anciens fichiers `En-marge.html`, `dist/` et `.openai/` sont conservés localement
comme références et ignorés par Git. Ils ne sont plus utilisés pour le lancement.
Les sources à modifier sont désormais dans `public/` et `src/`.

## Données

La liste reste enregistrée dans `localStorage`, avec la clé d’origine
`en-marge-wishlist-v1`. Elle n’est ni synchronisée entre appareils, ni envoyée au
serveur Bun. Aucun contenu de livre numérique n’est hébergé.

Le stockage dépend de l’origine du navigateur : protocole, hôte et port. Pour
retrouver une ancienne liste, utiliser la même adresse qu’auparavant.
`localhost`, `127.0.0.1`, une ouverture `file://` ou un changement de port
correspondent à des espaces distincts. L’export JSON reste accessible depuis
l’icône d’information. Effacer les données du navigateur efface la liste.

Une connexion Internet est nécessaire pour Open Library, les couvertures et les
polices Google Fonts. En cas d’échec d’une recherche, la sélection locale est
utilisée et un message l’indique.

## Git

Le dépôt local utilise la branche `main` et le remote `origin` :

```text
https://github.com/florianguigue/en-marge.git
```

Pour publier le premier commit, après vérification du dépôt distant :

```sh
git push -u origin main
```
