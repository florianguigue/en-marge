# Migration du catalogue vers plusieurs fournisseurs

## Lecture du document de projet

Le document `projet-catalogue-livres-sagas.md` définit une cible plus large que
l’application actuelle : catalogue général, œuvres et éditions, sagas, puis
parutions et notifications. La migration réalisée couvre le remplacement des
appels bibliographiques et le socle d’agrégation des versions V1 et V1.1.

L’application existante possède déjà une bibliothèque personnelle, des statuts,
des tags, un choix de langue partagé et une API MCP. Ces fonctions et leurs données
sont conservées. Bun et SQLite restent adaptés à cette étape ; la migration vers
PostgreSQL n’est pas nécessaire au remplacement d’Open Library. La section 4 du
document retient PostgreSQL, tandis que la section 11 le présente encore comme un
choix à confirmer : cette décision doit être clarifiée avant une migration de base.
L’interface Java du document sert de contrat conceptuel, transposé en modules JS.

## Mise en place

| Besoin du projet      | Réalisation                                                                                                                               |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Modèle indépendant    | Métadonnées normalisées avec identité interne, `workId`, `editionId`, ISBN, langue, éditions, sagas et identifiants externes              |
| Google Books de repli | Recherche titre/auteur/ISBN lorsque Hardcover échoue, ne donne aucun résultat ou est désactivé                                            |
| Hardcover principal   | Recherche principale, résolution d’une œuvre et de ses éditions, enrichissement ISBN, relations de sagas avec position                    |
| Éditions françaises   | Priorité à la langue sélectionnée dans une page ; aucune exclusion des langues inconnues                                                  |
| Fusion prudente       | Identité d’édition ou ISBN validé ; conversion ISBN-10/ISBN-13 ; aucune fusion automatique par titre/auteur                               |
| Provenance            | Sources horodatées et origine des champs ; priorité de la source principale pour l’édition et de Hardcover pour les sagas                 |
| Résilience            | Délais bornés, une nouvelle tentative après panne transitoire, espacements, gestion de `429`, repli et avertissements                     |
| Cache et persistance  | Cache SQLite limité, indépendant de la bibliothèque, recherches et fiches avec durées distinctes                                          |
| Compatibilité         | Données existantes inchangées ; parseur historique réservé aux anciennes réponses de tests ; enrichissement des anciennes fiches par ISBN |

Le navigateur appelle uniquement `/api/catalogue/*` pour les métadonnées. Les
jetons restent sur le serveur. Les images sont chargées directement chez leur
hébergeur, avec une couverture de remplacement en cas d’échec. Le catalogue local
conserve ses références et couvertures historiques Open Library pour rester
compatible ; il ne déclenche aucun appel à leur API bibliographique.

Hardcover est le fournisseur de recherche principal. Google Books est interrogé
uniquement en cas d’erreur, de résultat vide ou de désactivation de Hardcover.
Cette règle s’applique aussi aux recherches ISBN. Le fournisseur de la première
page est conservé pour la pagination. Les fiches peuvent toujours combler des
métadonnées absentes auprès de l’autre source, sur correspondance ISBN vérifiée.
Le cache utilise une nouvelle version pour ignorer les anciens résultats de
recherche sans modifier les livres enregistrés.

## Choix de rapprochement

Un volume Google Books décrit une édition ; aucun identifiant d’œuvre n’est
inventé. Une œuvre Hardcover ne reçoit pas l’ensemble des ISBN de ses éditions
comme s’il s’agissait d’une seule édition. Les traductions reposent sur les
relations explicites entre une œuvre Hardcover et ses éditions.

Un titre traduit ne prouve pas l’existence d’une édition dans cette langue. Les traductions ne sont affichées que lorsque le
fournisseur fournit une édition et une langue explicites. Les ISBN différents
restent des éditions distinctes. Les découpages français, préquelles, hors-séries
et autres relations ambiguës ne sont pas déduits automatiquement.

Les pages et les dates d’une édition ne sont pas celles de l’œuvre par défaut.
Les positions de saga restent absentes si le fournisseur ne les donne pas. Aucun
calendrier ni ordre chronologique n’est fabriqué à partir d’un numéro de tome.

## Configuration et validation

Voir le README et `.env.example`. Hardcover est désactivé en l’absence de jeton.
Chaque fournisseur peut être désactivé indépendamment. Google Books peut refuser
les tentatives sans clé ou lorsque son quota est atteint ; les autres sources
restent utilisables. Les quotas exacts et conditions des offres peuvent évoluer.

Les tests couvrent le modèle, les connecteurs avec réponses simulées, les fusions,
les erreurs, le cache durable, les routes HTTP, les langues et les parcours
navigateur. La validation authentifiée de Hardcover nécessite le jeton du compte
d’hébergement ; un test simulé ne confirme pas l’accès à ce compte.

## Étapes suivantes du projet

- Persister des entités métier `Work`, `Edition`, `Author`, `Series` séparées,
  au-delà des fiches JSON et du cache actuel ; décider alors de PostgreSQL.
- Ajouter les écrans de navigation entre éditions, auteurs et sagas, avec des
  tomes ordonnés et plusieurs ordres de lecture explicites.
- Modéliser les volumes français découpés et les appartenances multiples.
- Ajouter `Release`, les vérifications auprès de sources officielles, puis le
  suivi des sagas, les tâches périodiques et les notifications de la V3.
- Définir une politique de conservation et de redistribution adaptée à chaque
  source avant d’étendre le cache à un catalogue public durable.

## Références consultées

- [Google Books : recherches et volumes](https://developers.google.com/books/docs/v1/using)
- [Hardcover : accès, jetons et limites](https://docs.hardcover.app/api/getting-started/)
- [Schéma GraphQL publié par Hardcover](https://github.com/hardcoverapp/hardcover-docs/blob/main/schema.graphql)
