# Projet — Catalogue de livres et suivi des sagas littéraires

## 1. Présentation du projet

Développer une application permettant de rechercher, consulter et organiser un catalogue de livres, enrichi automatiquement à partir de plusieurs API bibliographiques.

L'application devra également permettre de consulter les sagas littéraires, connaître l'ordre de lecture des tomes et suivre les prochaines parutions.

L'objectif est de disposer d'un catalogue riche, fiable et agréable à consulter, tout en privilégiant des services gratuits et une architecture auto-hébergeable.

## 2. Objectifs et priorités

### Objectif principal : catalogue de livres

- Rechercher des livres par titre, auteur ou ISBN.
- Afficher les couvertures.
- Consulter les résumés.
- Afficher les auteurs et les informations bibliographiques.
- Identifier les différentes éditions d'un même livre.
- Privilégier les éditions françaises lorsqu'elles existent.
- Agréger plusieurs sources pour obtenir les métadonnées les plus complètes possible.

### Objectif secondaire : suivi des sagas

- Identifier les sagas auxquelles appartiennent les livres.
- Consulter les différents tomes d'une saga.
- Afficher l'ordre de lecture.
- Distinguer les tomes originaux de leurs éventuels découpages en plusieurs volumes français.
- Identifier les tomes déjà publiés et ceux à venir.
- Suivre les prochaines parutions.
- Prévoir un système de notifications pour les nouvelles sorties.

**Priorité : catalogue de livres > suivi des sagas > notifications de parution.**

## 3. Sources de données

Le système reposera sur deux fournisseurs de métadonnées bibliographiques.

| Fournisseur  | Rôle principal                                                    | Priorité  |
| ------------ | ----------------------------------------------------------------- | --------- |
| Hardcover    | Recherche, œuvres, éditions, sagas, tomes et ordre de lecture     | Principal |
| Google Books | Recherche, couvertures, résumés, ISBN et éditions en cas de repli | Repli     |

### Stratégie d'utilisation

1. Interroger Hardcover pour la recherche initiale par titre, auteur ou ISBN.
2. Normaliser les résultats dans un modèle commun.
3. Interroger Google Books uniquement si Hardcover est indisponible, désactivé ou ne renvoie aucun résultat.
4. Enrichir les fiches avec les données complémentaires disponibles lorsque nécessaire.
5. Détecter les doublons et fusionner les métadonnées sur correspondance fiable.
6. Conserver la provenance des informations.
7. Mettre en cache les données afin de limiter les appels externes.

### Contraintes sur les API

- Privilégier les API gratuites.
- Accepter les quotas gratuits limités.
- Respecter les limitations de débit.
- Prévoir des mécanismes de retry et de gestion des erreurs.
- Ne pas rendre l'application dépendante d'un seul fournisseur.
- Vérifier les licences et conditions d'utilisation des métadonnées et des images.
- Prévoir un fonctionnement dégradé lorsqu'un fournisseur est indisponible.

## 4. Architecture technique

L'application sera constituée de composants indépendants.

```text
                Frontend
    Catalogue / Recherche / Sagas
                   |
                   v
              Backend API
                   |
                   v
        Agrégateur de métadonnées
                   |
           +-------+-------+
           |               |
           v               v
       Hardcover      Google Books
       (principal)       (repli)
           |               |
           +-------+-------+
                   |
          Normalisation / Fusion
                   |
                   v
             PostgreSQL
                   |
                   v
                 Cache
```

### Backend

Responsabilités :

- Fournir une API unifiée au frontend.
- Interroger les fournisseurs externes.
- Normaliser les réponses.
- Fusionner les métadonnées.
- Détecter les doublons.
- Gérer les erreurs et quotas.
- Persister les informations nécessaires.
- Organiser les mises à jour périodiques.

Le backend utilisera une abstraction commune pour les fournisseurs :

```java
public interface BookMetadataProvider {

    List<BookSearchResult> search(BookSearchCriteria criteria);

    Optional<BookMetadata> findByIsbn(String isbn);

    Optional<BookMetadata> findByExternalId(String externalId);
}
```

Les capacités spécifiques, notamment la récupération des séries, pourront être exposées par des interfaces complémentaires.

### Frontend

Fonctionnalités envisagées :

- Moteur de recherche.
- Résultats avec couvertures.
- Fiches détaillées des livres.
- Affichage des éditions.
- Navigation par auteur.
- Navigation par saga.
- Liste ordonnée des tomes.
- Visualisation des prochaines parutions.

### Base de données

**PostgreSQL** est retenu comme choix initial pour stocker les métadonnées normalisées et les relations entre les entités.

Un cache permettra de réduire les appels aux fournisseurs externes. La technologie de cache reste à définir.

## 5. Modèle de données

Le système doit distinguer les œuvres, leurs éditions et leur appartenance éventuelle à une saga.

### Work (Œuvre)

Représente une œuvre indépendamment de ses éditions.

Champs envisagés :

- Identifiant interne
- Titre original
- Titre principal
- Description / résumé
- Langue originale
- Auteurs
- Date de première publication
- Identifiants externes

### Edition

Représente une édition particulière d'une œuvre.

Champs envisagés :

- Identifiant interne
- Œuvre associée
- Titre
- ISBN-10 / ISBN-13
- Langue
- Éditeur
- Date de publication
- Couverture
- Format
- Nombre de pages
- Identifiants externes

### Author

Représente un auteur.

Champs envisagés :

- Identifiant interne
- Nom
- Biographie
- Identifiants externes
- Œuvres associées

### Series

Représente une saga littéraire.

Champs envisagés :

- Identifiant interne
- Nom
- Description
- Auteur(s)
- Liste des œuvres
- Identifiants externes

### SeriesEntry

Représente la position d'une œuvre dans une saga.

Champs envisagés :

- Saga associée
- Œuvre associée
- Numéro du tome
- Type : principal, préquelle, nouvelle, hors-série
- Ordre de lecture

Cette relation doit permettre de représenter plusieurs ordres de lecture si nécessaire.

### Release

Représente une parution annoncée ou publiée.

Champs envisagés :

- Œuvre ou édition associée
- Date de sortie
- Pays
- Langue
- Statut de publication
- Source de l'information
- Date de dernière vérification

### MetadataSource

Permet de tracer l'origine des métadonnées.

Informations envisagées :

- Fournisseur
- Identifiant externe
- Entité associée
- Date de récupération
- Date de dernière mise à jour
- Métadonnées de provenance

## 6. Gestion des métadonnées

### Normalisation

Chaque fournisseur possède son propre modèle de données. Les réponses seront transformées dans un modèle commun, indépendant des API externes.

### Fusion

Lorsqu'un même livre est trouvé auprès de plusieurs fournisseurs :

- Identifier les correspondances par ISBN lorsque cela s'applique.
- Utiliser les identifiants externes et les relations entre œuvres.
- Effectuer des rapprochements prudents par titre et auteur.
- Éviter les fusions automatiques ambiguës.
- Définir une priorité par fournisseur et par type de métadonnée.
- Conserver la provenance des informations.

### Couvertures

- Privilégier les couvertures françaises.
- Sélectionner la meilleure résolution disponible.
- Prévoir une image de substitution lorsqu'aucune couverture n'est disponible.
- Respecter les conditions d'utilisation et de stockage des images.

### Cache et actualisation

- Mettre en cache les recherches et fiches.
- Éviter les appels répétés aux fournisseurs.
- Prévoir une durée de validité adaptée aux données.
- Permettre l'actualisation des métadonnées.
- Utiliser les données locales lorsqu'un fournisseur est indisponible, dans les limites des droits de conservation applicables.

## 7. Suivi des sagas

Le système devra gérer plusieurs situations :

- Saga avec tomes numérotés.
- Saga avec préquelles.
- Saga avec hors-séries.
- Différence entre ordre de publication et ordre chronologique.
- Tome original publié en plusieurs volumes dans une édition française.
- Œuvre appartenant à plusieurs séries ou univers.

Une saga pourra présenter :

- Son titre et sa description.
- Ses auteurs.
- Les tomes disponibles.
- Leur ordre de lecture.
- Les éditions françaises.
- Les prochaines parutions connues.

## 8. Suivi des prochaines sorties

Les dates de sortie devront être récupérées et vérifiées auprès des sources disponibles parmi les deux fournisseurs retenus : Hardcover et Google Books. Les catalogues des éditeurs ainsi que les annonces officielles des auteurs ou maisons d'édition pourront compléter cette veille lorsqu'une date doit être confirmée.

Le système devra distinguer :

- Date confirmée.
- Date provisoire.
- Date inconnue.
- Publication disponible.
- Publication reportée ou annulée.

À terme, un utilisateur pourra suivre une saga et recevoir une notification lorsqu'une nouvelle parution est identifiée ou qu'une date change. Une tâche périodique pourra assurer la vérification des parutions.

## 9. Roadmap

### V1 — Catalogue de livres

**Objectif : proposer une recherche fonctionnelle et des fiches bibliographiques de qualité.**

- Intégration de Hardcover comme moteur de recherche principal.
- Recherche par titre, auteur et ISBN.
- Affichage des couvertures.
- Affichage des résumés.
- Fiches détaillées.
- Identification des éditions françaises.
- Modèle de données initial.
- Persistance et cache.
- Architecture extensible pour les fournisseurs.

### V1.1 — Agrégation multi-fournisseurs

**Objectif : enrichir les fiches et améliorer la qualité du catalogue.**

- Intégration de Google Books comme fournisseur de repli.
- Intégration de Hardcover pour les données de séries et les relations entre œuvres disponibles.
- Enrichissement des métadonnées.
- Stratégie de fusion.
- Gestion des doublons.
- Provenance des données.
- Gestion des quotas et indisponibilités.

### V2 — Sagas littéraires

**Objectif : ajouter une navigation structurée par série.**

- Exploitation des données de séries de Hardcover.
- Identification des sagas.
- Fiches saga.
- Liste ordonnée des tomes.
- Ordres de lecture.
- Gestion des préquelles et hors-séries.
- Association des éditions françaises.
- Navigation entre livres et sagas.

### V3 — Parutions et suivi

**Objectif : anticiper les nouvelles publications.**

- Recherche des prochaines sorties dans les données disponibles des fournisseurs retenus.
- Vérification complémentaire auprès des éditeurs et des sources officielles.
- Gestion des dates de parution.
- Actualisation périodique.
- Suivi des sagas.
- Détection des nouvelles publications.
- Notifications.
- Détection des changements de date.

## 10. Principes techniques

Le projet respectera les principes suivants :

1. **Modularité** : chaque fournisseur doit pouvoir être ajouté, remplacé ou désactivé indépendamment.
2. **Indépendance des fournisseurs** : le modèle métier ne doit dépendre d'aucune API externe.
3. **Qualité des données** : privilégier la complétude et la fiabilité des fiches.
4. **Traçabilité** : conserver la provenance des métadonnées.
5. **Résilience** : gérer les quotas, les erreurs et les indisponibilités.
6. **Performance** : limiter les appels externes par le cache et la persistance.
7. **Évolutivité** : permettre l'ajout de nouvelles fonctionnalités sans refonte majeure.
8. **Auto-hébergement** : privilégier une architecture simple à déployer.
9. **Coût maîtrisé** : utiliser prioritairement les offres gratuites des fournisseurs.

## 11. Décisions actées et points restant à définir

### Décisions actées

- Priorité au catalogue de livres.
- Suivi des sagas comme deuxième objectif.
- Approche multi-API limitée à deux fournisseurs pour cette première étape.
- Hardcover comme fournisseur principal de recherche.
- Hardcover pour les sagas.
- Google Books comme fournisseur de repli.
- Modèle métier indépendant des fournisseurs.
- Distinction entre œuvres et éditions.
- Traçabilité des métadonnées.
- Développement progressif par versions.

### Choix proposés à confirmer

- PostgreSQL pour la persistance.
- Stratégie et technologie de cache.
- Langage et framework du backend.
- Stack du frontend.
- Méthode d'actualisation des métadonnées.
- Politique de stockage des couvertures.
- Stratégie précise de dédoublonnage.

### Points fonctionnels restant à préciser

- Catalogue généraliste ou périmètre initial limité à certains genres.
- Catalogue public uniquement ou bibliothèque personnelle.
- Gestion éventuelle des livres possédés, lus ou à lire.
- Comptes utilisateurs et authentification.
- Modalités de suivi et de notification des sagas.
- Critères de sélection et de fiabilité des sources de parution.

## 12. Vision cible

Construire progressivement une application auto-hébergeable proposant un **catalogue de livres riche et consolidé**, capable de réunir des informations provenant de Hardcover et Google Books.

À terme, l'application doit permettre de découvrir un livre, consulter ses différentes éditions, retrouver sa saga, connaître l'ordre de lecture et être informé de ses prochaines publications.

Le catalogue constitue le socle du projet ; le suivi des sagas et des parutions vient enrichir cette base sans remettre en cause son architecture.

## 13. Mise en œuvre dans En marge

Le remplacement des appels Open Library par l’API catalogue Hardcover /
Google Books est mis en place sur la stack Bun et SQLite existante.
L’[analyse de migration](docs/migration-catalogue.md) décrit le périmètre réalisé,
les décisions d’intégration, les limites et les étapes restant à développer. Le
[README](README.md#fournisseurs-de-métadonnées) documente la configuration des
fournisseurs et les nouvelles routes. Les écrans de sagas, les parutions et les
notifications restent des étapes distinctes de la roadmap.
