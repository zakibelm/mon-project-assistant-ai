# L'assistant IA

> État au 2 novembre 2026 (fin de la phase A). Pour la vision et la feuille de route, voir `vision.md`.

## Ce qu'il fait aujourd'hui

L'assistant est un chat attaché à un projet. Il connaît le contexte du projet et l'état de ses tâches, répond aux questions et modifie le projet à la demande.

- **Questions :** résumé, blocages, charge par personne, glissements par rapport au plan de référence, priorités.
- **Actions :** créer un groupe, planifier plusieurs tâches d'un coup, modifier une tâche (statut, responsable, échéance, priorité, groupe), supprimer, commenter avec @mentions, créer une automatisation.

Il ne fait encore rien de lui-même : pas de suivi quotidien, de relances ni de demandes d'explication. Ce sont les phases C à E de la feuille de route.

## Le point du jour (page d'accueil)

`lib/brief.ts` calcule, sans appel à l'IA, ce qui demande l'attention du PMO sur tous les projets actifs :

| Type | Règle | Priorité |
|---|---|---|
| Bloqué | Tâche au statut Bloqué ; le dernier message de la tâche est cité | À traiter aujourd'hui |
| En retard | Tâche non terminée dont l'échéance est passée | À traiter aujourd'hui |
| Échéance proche | Tâche pas commencée à 3 jours ou moins de son échéance | Cette semaine |
| Glissement | Échéance postérieure à la date du plan de référence | Cette semaine si 5 jours ou plus, sinon à surveiller |
| Surcharge | Une personne avec 4 tâches ouvertes ou plus, tous projets confondus | Cette semaine si plusieurs projets |
| Livrable | Livrable dans 14 jours ou moins avec des tâches ouvertes | Aujourd'hui si 5 jours ou moins |

Chaque point se règle d'abord **sur place, sans IA** : reprendre la tâche, la débloquer, la terminer, changer sa date, la réassigner dans l'équipe du projet, ou relancer le responsable. La carte affiche alors « ✓ Réglé » avec « Annuler ». En option, le lien « Ou demander à l'assistant » ouvre le projet et envoie à l'assistant une consigne déjà rédigée, par exemple « Ajoute un commentaire courtois pour relancer Sami… ». Les consignes qui pourraient modifier beaucoup de choses, comme le rééquilibrage de charge, demandent explicitement de ne rien modifier sans accord.

Le « rythme » d'un projet compare la part des tâches terminées à la part du temps écoulé entre le début et la fin du projet.

Le bouton « Plus tard » masque un point jusqu'au lendemain, dans le navigateur seulement.

Le point du jour préfigure la phase C : le même calcul, lancé chaque matin, alimentera le point envoyé par courriel.

## Cadrage d'un nouveau projet

`lib/ai/draft.ts` transforme un texte libre en brouillon de projet, en un seul appel au modèle :

- **Entrée :** la date du jour, la liste des membres déjà connus du PMO (pour réutiliser leurs noms), puis le texte.
- **Sortie :** l'outil `propose_project`, appelé une fois : nom, description, dates, livrables, parties prenantes, équipe, phases et tâches (responsable, échéance, priorité, sous-tâches), et les questions à préciser. Le prompt interdit d'inventer des faits : une information manquante devient une hypothèse prudente, plus une question.
- **Validation :** le brouillon est vérifié par zod. Un responsable qui n'est pas dans l'équipe est retiré (« à assigner »). Si le modèle n'appelle pas l'outil, l'utilisateur voit « L'assistant n'a pas produit de plan… » (HTTP 422).
- **Rien n'est enregistré** à cette étape. Le chef de projet corrige tout dans l'écran de relecture, puis `POST /api/projects` crée le projet en une transaction (`createProjectFromDraft`) :
  - les membres de même nom sont réutilisés (casse ignorée), les autres sont créés ;
  - chaque échéance devient la date du plan de référence ;
  - chaque tâche reçoit son événement de création dans l'historique.
- La demande compte dans la limite quotidienne d'IA et ses tokens sont enregistrés.

## Base de connaissances métier (RAG)

Les documents du dossier `rag/` (voir `rag/README.md`) sont découpés par section `##` et indexés en mémoire (BM25, `lib/rag/index.ts`). La recherche est plein texte, avec une racinisation légère : on garde le début des mots. Le titre de section pèse plus que le corps du texte.

Comment l'IA s'en sert :
- **Assistant :** l'outil `search_knowledge` (premier de la liste) renvoie 4 extraits avec leur fichier source. Le prompt système demande de le consulter pour toute question de méthode (retards, blocages, escalade, planification, estimation, rapports, leçons) et de citer la source entre parenthèses.
- **Cadrage d'un projet :** 4 extraits liés au texte du brief sont joints au message. Consigne : appliquer leurs règles (ordre des tâches, marges, dépendances, validations).
- **Leçons apprises :** 4 extraits liés aux problèmes des notes sont joints. Consigne : s'en servir pour les recommandations, sans les présenter comme des faits observés.

Limites et évolution :
- la recherche est lexicale : le bon extrait arrive le plus souvent dans les 3 premiers, mais pas toujours en tête. C'est pourquoi on en transmet 4 ;
- si la base dépasse quelques centaines d'extraits, il faudra passer à une recherche par le sens (plongements vectoriels, par exemple pgvector dans PostgreSQL) ;
- les textes de `rag/` sont envoyés au modèle : ils ne doivent contenir ni données personnelles ni secrets.

## Leçons apprises

`lib/ai/lessons.ts` analyse les **notes validées par les chefs de projet** (case « Validé » cochée), d'un projet ou de toute l'organisation, en un seul appel :

- **Entrée :** pour chaque note, le projet, la tâche, le type de problème, l'évaluation de 1 à 5, le problème, la résolution, la date prévue et l'échéance.
- **Consigne :** pondérer par l'évaluation. Une leçon s'appuie surtout sur des notes à 4 ou 5 ; une note à 1 ou 2 ne justifie une leçon que si d'autres la confirment. Ne rien inventer et citer les notes sources.
- **Sortie :** l'outil `record_lessons`, avec par leçon le type de problème, un titre, le problème type, ce qui a marché, une recommandation pour le cadrage, et les identifiants des notes sources.
- **Contrôles côté serveur :** les sources inventées par le modèle sont écartées, et une leçon sans source valable est retirée. **Le poids d'une leçon est recalculé par le serveur** : c'est la moyenne des évaluations réelles de ses sources. Une nouvelle synthèse remplace la précédente pour la même portée.
- Les statistiques par type de problème (nombre de notes, moyenne et somme des évaluations) sont calculées sans IA (`problemStats`).

Règles des notes (`lib/db/repo.ts`) :
- la note est écrite par le responsable de la tâche ou par le chef de projet ;
- l'évaluation de 1 à 5 est proposée par l'un ou l'autre ;
- la case « Validé » est réservée au chef de projet et demande une note et une évaluation ;
- toute modification de la note ou de l'évaluation décoche la validation ;
- tout est journalisé dans l'historique de la tâche.

## Parcours d'une demande

```
Interface (app/page.tsx)
  └─ POST /api/assistant { projectId, message, history }
       ├─ vérifie que le projet appartient à l'organisation courante
       ├─ compte la demande dans la limite quotidienne (table ai_usage)
       ├─ lit le projet en base (getBoard)
       └─ runAssistant (lib/ai/assistant.ts)
            ├─ envoie au modèle : prompt système + outils + historique + contexte du projet + message
            ├─ boucle (8 tours au plus) :
            │    le modèle appelle des outils → validation (zod) → écriture en base (repo.ts),
            │    journalisée dans task_events → résultats renvoyés au modèle
            └─ renvoie la réponse, les actions faites et l'usage en tokens
       └─ enregistre les tokens, renvoie la réponse et le projet à jour
```

## Fichiers

| Fichier | Rôle |
|---|---|
| `lib/ai/client.ts` | Client du SDK officiel Anthropic, branché sur OpenRouter |
| `lib/ai/assistant.ts` | Prompt système et boucle d'appels d'outils |
| `lib/ai/tools.ts` | Définition des outils, validation des entrées, exécution, résumé du projet envoyé au modèle |
| `app/api/assistant/route.ts` | Route HTTP : contrôles, limite quotidienne, erreurs en français |
| `lib/db/repo.ts` | Écritures en base, journalisation, automatisations, notifications |
| `lib/session.ts` | Utilisateur et organisation courants (provisoire, en attendant la connexion) |

## Passerelle et modèle

- **OpenRouter**, via son point d'entrée compatible avec l'API Messages de Claude : `https://openrouter.ai/api`, auquel le SDK ajoute `/v1/messages`. La clé OpenRouter est envoyée en `Authorization: Bearer`.
- **SDK officiel `@anthropic-ai/sdk`** : on garde l'usage natif des outils et le cache de prompt. Changer de passerelle (API Anthropic directe, Amazon Bedrock…) ne touche que `lib/ai/client.ts`.
- **Modèle par défaut :** `anthropic/claude-opus-5.5`. Autres choix : `anthropic/claude-sonnet-5.5`, `anthropic/claude-haiku-5.5`.
- En-têtes `HTTP-Referer` et `X-Title` : ils identifient l'app dans le tableau de bord OpenRouter.

### Configuration

La clé OpenRouter, le modèle et la limite quotidienne se règlent dans la **page Paramètres** :
- la clé y est chiffrée en base (AES-256-GCM, avec `APP_SECRET`) ;
- `lib/ai/client.ts` (`resolveAi`) lit ces réglages par organisation ;
- les variables ci-dessous servent de valeurs par défaut et de secours (`.env.local` en local, `.env` sur le VPS).

| Variable | Rôle | Défaut |
|---|---|---|
| `OPENROUTER_API_KEY` | Clé OpenRouter de secours (si aucune n'est saisie dans Paramètres) | — |
| `APP_SECRET` | Secret de chiffrement de la clé saisie dans Paramètres (obligatoire en production) | fichier `.data/app-secret` généré en développement |
| `AI_MODEL` | Identifiant OpenRouter du modèle | `anthropic/claude-opus-5.5` |
| `AI_BASE_URL` | Point d'entrée de la passerelle | `https://openrouter.ai/api` |
| `AI_DAILY_LIMIT` | Demandes par organisation et par jour | `200` |
| `APP_URL` | Adresse de l'app, envoyée à OpenRouter | `http://localhost:3000` |

## Ce que le modèle reçoit

1. **Prompt système** (`SYSTEM` dans `lib/ai/assistant.ts`). Il est figé : aucune date ni donnée variable, pour que le cache de prompt reste valide. Il fixe le rôle, les règles d'action (agir avec les outils, demander en cas d'ambiguïté, ne supprimer que sur demande explicite, ne jamais inventer d'identifiant) et le style (français, court, dates JJ/MM, pas de jargon).
2. **Outils** (`TOOLS` dans `lib/ai/tools.ts`), dans un ordre fixe, toujours pour le cache.
3. **Historique de la conversation :** les 10 derniers échanges.
4. **Dernier message :** la date du jour, le nom de l'utilisateur, le contexte du projet en JSON (`boardSnapshot`), puis la demande.

Contexte du projet envoyé :

```json
{
  "project": "…", "description": "…", "period": { "start": "…", "end": "…" },
  "deliverables": [{ "name": "…", "due": "AAAA-MM-JJ" }],
  "stakeholders": [{ "name": "…", "role": "…" }],
  "members": [{ "name": "…", "role": "…" }],
  "groups": [{ "id": "…", "name": "…" }],
  "items": [{ "id": "…", "group_id": "…", "name": "…", "status": "todo|doing|block|done",
              "owner": "…", "due": "…", "baseline_due": "présent seulement si différent de due",
              "priority": "…", "subtasks": "2/4", "last_comment": "…" }],
  "automations": ["block → Zaki"]
}
```

## Outils

| Outil | Effet | Garde-fous |
|---|---|---|
| `create_group` | Crée un groupe de tâches | — |
| `create_items` | Crée 1 à 30 tâches d'un coup (responsable, échéance, priorité, sous-tâches) | Groupe et responsable doivent appartenir au projet ; tout ou rien (transaction) |
| `update_item` | Modifie nom, statut, responsable, échéance, priorité ou groupe | Un événement d'historique par champ réellement changé ; le changement de statut déclenche les automatisations |
| `delete_item` | Supprime une tâche | Seulement sur demande explicite (prompt) ; l'historique est conservé |
| `add_comment` | Ajoute un message au nom de l'utilisateur | Les @mentions de membres du projet créent une notification |
| `create_automation` | « Quand une tâche passe à tel statut, prévenir telle personne » | La personne doit être membre du projet |

Chaque entrée du modèle est validée par un schéma zod avant d'être exécutée. Une entrée invalide, ou une erreur métier comme « n'est pas membre du projet », est renvoyée au modèle comme erreur d'outil : il peut corriger son appel, et rien n'est écrit.

Toutes les écritures de l'assistant sont journalisées dans `task_events` avec `actor_kind = "assistant"` et l'identifiant du membre pour le compte duquel il agit.

## Fins de tour gérées

| Fin de tour (`stop_reason`) | Comportement |
|---|---|
| `end_turn` | Réponse renvoyée à l'utilisateur |
| `tool_use` | Outils exécutés, résultats renvoyés au modèle dans un seul message, tour suivant |
| `refusal` | Aucun outil exécuté ; « Je ne peux pas traiter cette demande. Pouvez-vous la reformuler ? » |
| `max_tokens` | Réponse partielle, avec un message invitant à une demande plus ciblée |
| `pause_turn` | Le tour est relancé |
| 8 tours atteints | Arrêt ; l'utilisateur est invité à vérifier le projet |

## Erreurs renvoyées à l'utilisateur

| Cas | Code HTTP | Message |
|---|---|---|
| Clé absente | 500 | `OPENROUTER_API_KEY manquante…` |
| Clé refusée | 502 | « Clé OpenRouter refusée… » |
| Crédits OpenRouter épuisés (402) | 502 | « Crédits OpenRouter insuffisants… » |
| Trop de demandes vers le modèle | 429 | « Trop de demandes vers le modèle… » |
| Limite quotidienne de l'organisation atteinte | 429 | « Limite quotidienne atteinte… » |
| OpenRouter injoignable | 502 | « Impossible de joindre OpenRouter… » |
| Projet inconnu ou d'une autre organisation | 404 | « Projet introuvable. » |
| Requête mal formée | 400 | « Requête invalide. » |

Le SDK réessaie deux fois de lui-même les erreurs temporaires. Le délai maximal d'une demande est de 120 s ; nginx doit donc attendre au moins 130 s (voir `deploiement-vps.md`).

## Coûts et cache

- Le prompt système et les outils sont marqués pour le cache (`cache_control` sur le système), ce qui couvre outils et système. Le contexte du projet, qui change à chaque demande, est placé après, dans le message.
- L'usage est enregistré par organisation et par jour dans `ai_usage` : demandes, tokens lus, tokens lus depuis le cache, tokens écrits. Il est affiché en haut de l'interface.
- **À vérifier avec une vraie clé :** que le compteur « depuis le cache » augmente dès la deuxième demande. Sinon, le prompt est sous le seuil minimal de mise en cache du modèle, ou OpenRouter ne transmet pas le cache.

## Limites connues

- **Pas de repli automatique** vers un autre modèle en cas de refus : on ne sait pas si OpenRouter transmet ce paramètre. Un refus se traduit par un message demandant de reformuler.
- **Réponse non streamée :** elle arrive en une fois.
- **Pas de connexion utilisateur :** l'assistant agit pour le compte du chef de projet de l'organisation de démonstration (`lib/session.ts`).
- **L'assistant ne voit qu'un projet à la fois.** La vue portefeuille n'est pas encore interrogeable par l'IA.
- **Jamais testé contre le vrai modèle** dans ce dépôt : les tests utilisent un faux OpenRouter. Premier essai à faire avec une vraie clé.

## Tests

```bash
npm test     # base de données + build + assistant de bout en bout
```

`scripts/test-assistant.mjs` lance l'application contre un faux serveur OpenRouter, sans aucun appel payant. Il vérifie :

- la planification avec outils ;
- le rejet d'une entrée invalide ;
- l'historique « assistant » ;
- le contexte envoyé (livrables) ;
- le chemin `/v1/messages`, l'authentification, le modèle, le cache et la liste des outils ;
- la gestion d'un refus, d'une clé refusée, d'une requête mal formée et d'un projet inconnu.

## Évolutions prévues (voir `vision.md`)

| Phase | Ajout à l'assistant |
|---|---|
| B | Lire une fiche de contexte, proposer un plan complet, faire figer le plan de référence après validation |
| C | Tâche planifiée quotidienne : détection des retards et point du matin |
| D | Demande d'explication au responsable, évaluation par le chef de projet (poids de 1 à 5) |
| E | Apprentissage à partir des causes pondérées, registre des leçons apprises consulté au cadrage |
| F | Relances par courriel, puis Slack ou Teams |
