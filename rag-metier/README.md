# Base de connaissances métier (RAG)

Ce dossier contient les **connaissances métier communes à tous les projets** que l'IA consulte avant de répondre : méthodes de gestion de projet, règles du PMO, glossaire, modèles. L'assistant y cherche les passages utiles (recherche plein texte, sans service externe) et cite le fichier source.

## Métier ou client ?

- **Ici (`rag-metier/`)** : ce qui vaut pour tous les projets (méthodes, règles du PMO, glossaire, modèles).
- **Dans `rag-client/<projet>/`** : ce qui concerne un seul projet ou un seul client (comptes rendus, échanges, exigences, contrats). Voir `rag-client/README.md`.

## Ajouter un document

1. Créez un fichier `.md` dans un sous-dossier (`methodes/`, `pmo/`, ou un nouveau dossier).
2. Commencez-le par un en-tête :

   ```markdown
   ---
   titre: Gestion des risques
   tags: risques, registre, probabilité, impact
   source: Rédaction interne PMO, 2026
   ---
   ```

3. Découpez le contenu en sections `##`. **Chaque section est un « extrait » que l'IA peut retrouver** : une idée par section, avec un titre clair et les mots que les gens emploient vraiment.
4. Rechargez la page Paramètres : la section « Base de connaissances » liste les documents chargés et permet de tester une recherche.

## Bonnes pratiques

- Écrivez des règles concrètes (« au-delà de 3 jours de blocage, escalader au PMO ») plutôt que des généralités.
- Pas de données personnelles ni de secrets : ces textes sont envoyés au modèle d'IA.
- Indiquez la source dans l'en-tête. Ne copiez pas de textes protégés par le droit d'auteur (normes, livres) : résumez-les avec vos propres mots.
- Ce fichier `README.md` n'est pas indexé.

## Sur le serveur

Le dossier est monté dans le conteneur (`./rag-metier` → `/app/rag-metier`, en lecture seule). On peut donc modifier les documents sur le VPS sans reconstruire l'application : ils sont relus au plus tard une minute après.
