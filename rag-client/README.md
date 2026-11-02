# Base de connaissances client (RAG par projet)

Un dossier par projet, créé automatiquement à la création du projet, avec une première **fiche projet** (objectif, dates, livrables, parties prenantes, équipe). On y ajoute tous les éléments du projet : comptes rendus de réunion, échanges avec le client, exigences, décisions, contrats (en texte).

Quand on pose une question sur un projet, l'assistant de ce projet cherche dans **son** dossier et cite le document source.

## Cloisonnement

L'assistant d'un projet ne lit **que le dossier de ce projet**, jamais celui d'un autre client. Le nom du dossier est enregistré avec le projet (champ `docs_dir`).

## Ajouter un document

- **Depuis l'application** : onglet « Documents » du projet. On colle un texte ou on importe un fichier `.md` ou `.txt` (200 Ko au maximum). Les noms de fichiers sont nettoyés, et un fichier existant n'est jamais écrasé.
- **Sur le serveur** : on dépose un fichier `.md` ou `.txt` dans `rag-client/<dossier-du-projet>/`. Il est pris en compte au plus tard une minute après.

Format conseillé : un en-tête (`titre`, `tags`, `source`) et des sections `##`, comme dans `rag-metier/README.md`. Un texte collé tel quel fonctionne aussi : il est découpé par paragraphes.

## Confidentialité et sauvegarde

- **Ces documents ne sont pas versionnés dans Git** : ce sont des données clients. Seul ce fichier l'est (voir `.gitignore`).
- Ils sont envoyés au modèle d'IA quand ils sont pertinents pour une question. Il ne faut pas y mettre de secrets (mots de passe, clés d'accès).
- Sur le VPS, ce dossier doit être **sauvegardé avec la base de données** (voir `docs/plan-operations.md`).
