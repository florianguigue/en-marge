# En marge

Une bibliothèque d’envies de lecture : sélection de livres, recherche Open Library,
fiches détaillées, ajout manuel, modification, statuts de lecture, tags, filtres, tri et export JSON.
L’interface existante est conservée, sur ordinateur et mobile.

L’application est écrite en JavaScript natif : modules ES côté navigateur et serveur
HTTP Bun et base SQLite intégrée via `bun:sqlite`. Aucun framework, TypeScript,
service de base de données externe ou dépendance de production. Aucune compilation n’est nécessaire.

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
de santé. Compose utilise un système de fichiers en lecture seule, avec un volume
nommé `en-marge-data` accessible en écriture pour SQLite. La bibliothèque survit
aux redémarrages et aux recréations des conteneurs. `docker compose down` conserve
le volume ; `docker compose down -v` le supprime avec toutes les données.

Le Dockerfile peut également être utilisé directement :

```sh
docker build -t en-marge .
docker run --rm -p 4173:4173 -v en-marge-data:/app/data en-marge
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
Ils vérifient aussi le partage entre navigateurs indépendants, la reprise des
anciennes listes et les pannes du serveur. Les tests Bun vérifient la persistance
après redémarrage et la protection contre les écritures concurrentes.
Les services externes sont simulés pour rendre ces tests indépendants du réseau.

## Organisation

```text
public/
  index.html            Structure et formulaires
  style.css             Styles et adaptation mobile
  js/
    app.js              Interface, navigation et interactions
    catalogue.js        Sélection de fantasy et éditions françaises/anglaises
    book-editions.js    Affichage des livres dans la langue sélectionnée
    icons.js            Icônes SVG
    i18n.js             Choix de langue et traduction de l’interface
    messages.js         Textes français et anglais
    open-library.js     Recherche et normalisation des métadonnées
    reading-status.js   Statuts de lecture et valeurs par défaut
    storage.js          Validation et reprise des anciennes listes
    api.js              Client HTTP du stockage serveur
    utils.js            Échappement HTML et normalisation du texte
src/server.js           Serveur HTTP Bun et API
src/database.js         Base SQLite et transactions
tests/unit/             Tests Bun
tests/browser/          Tests Playwright
Dockerfile
compose.yaml
```

Les anciens fichiers `En-marge.html`, `dist/` et `.openai/` sont conservés localement
comme références et ignorés par Git. Ils ne sont plus utilisés pour le lancement.
Les sources à modifier sont désormais dans `public/` et `src/`.

## Langues et page d’accueil

La page d’accueil ouvre **Ma bibliothèque**. Les liens directs `#discover` et
`#wishlist` continuent d’ouvrir les onglets correspondants.

L’interface est disponible en français et en anglais. Sans choix manuel, elle
utilise la première langue française ou anglaise reconnue dans les préférences
du navigateur (`navigator.languages`, puis `navigator.language`). Si aucune
langue prise en charge n’est identifiée, le français prévaut. La locale française
est explicitement `fr-FR`, y compris pour le document HTML et le formatage des
nombres, quelle que soit la variante de français du navigateur.

Le sélecteur de la barre latérale permet de changer la langue immédiatement,
sur ordinateur et mobile. Le choix est enregistré dans SQLite côté serveur et
prévaut sur la langue du navigateur. Il est commun à cette instance. En cas
d’échec d’enregistrement, la langue précédente est conservée.

Les livres de la sélection disposent de titres, résumés, couvertures et références
d’édition en français et en anglais. Le changement de langue adapte aussi leur
affichage dans la bibliothèque, en conservant leurs statuts et tags personnels.

La recherche Open Library privilégie les éditions dans la langue sélectionnée
sans exclure les livres dont la langue est absente ou différente. Elle utilise
le titre, la couverture et l’ISBN de l’édition correspondante lorsqu’elle existe,
sinon ceux de l’édition proposée par Open Library. Une langue absente est
signalée, sans être déduite de la langue de l’interface. La recherche d’une
traduction d’un livre déjà enregistré conserve, elle, un filtre strict pour
éviter d’associer une édition dans la mauvaise langue. Une
recherche déjà affichée est relancée lors d’un changement de langue. Pour les
autres livres enregistrés, les éditions correspondantes sont recherchées à
l’ouverture et lors du changement de langue, puis mises en cache en mémoire.
Si aucune édition n’est disponible, l’édition d’origine reste visible avec la
mention « Édition d’origine ». Les fiches saisies manuellement conservent leur
contenu. Les métadonnées enregistrées et l’export restent fidèles aux livres
ajoutés ; les versions affichées ne réécrivent pas la liste.

## Statuts de lecture

Les livres ajoutés à la liste commencent au statut **À lire**. Un menu sur chaque
livre de la liste et dans sa fiche permet de passer à **En cours**, **Lu** ou
**Abandonné**, et de revenir à un statut précédent si nécessaire. Les filtres de
statut permettent de retrouver chaque groupe de livres.

Les listes existantes sont conservées : un livre sans statut est considéré comme
**À lire**. Les statuts sont enregistrés avec les livres dans la base du serveur et
inclus dans l’export JSON (`to-read`, `reading`, `read`, `abandoned`).

## Données

La bibliothèque est conservée dans une base SQLite côté serveur, par défaut
`./data/en-marge.sqlite`. `DATABASE_PATH` permet de changer ce chemin. Son dossier
est créé au démarrage et doit être accessible en écriture. Aucun contenu de livre
numérique n’est hébergé. Les données ne sont plus enregistrées dans le navigateur.

L’application n’a pas de comptes utilisateurs : tous les visiteurs de cette
instance partagent la même bibliothèque et la même préférence de langue.
Les autres onglets et appareils actualisent la bibliothèque toutes les trois
secondes lorsqu’ils sont visibles, ainsi qu’au retour sur la fenêtre. Une
modification concurrente est refusée et la bibliothèque actualisée pour permettre
de réessayer, sans écraser les changements d’un autre appareil.

Les anciennes listes `en-marge-wishlist-v1` sont importées automatiquement lors de
la première visite depuis chaque navigateur d’origine. Les livres déjà présents
(même identifiant) côté serveur sont conservés. Les anciennes clés locales sont
supprimées uniquement après succès du transfert ; en cas d’échec, la liste reste
disponible pour une nouvelle tentative après actualisation. Il faut ouvrir la
même origine qu’avant pour permettre la reprise des données locales existantes.

API JSON : `GET /api/library`, `PUT /api/library` avec `{ books, revision }`,
`POST /api/library/import` avec `{ books }`, et `GET`/`PUT /api/settings` pour la
langue (`{ language: "fr" }` ou `"en"`). Les écritures de bibliothèque sont
transactionnelles. Une révision périmée renvoie `409`. Les corps invalides sont
refusés ; les requêtes sont limitées à 10 Mio. Une panne serveur ne déclenche
aucun repli vers un stockage navigateur.

Pour sauvegarder la base, arrêter l’application puis copier le dossier de données
complet (incluant les éventuels fichiers SQLite `-wal` et `-shm`). Avec Docker,
sauvegarder le volume `en-marge-data`. L’export JSON reste accessible depuis
l’icône d’information.

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
