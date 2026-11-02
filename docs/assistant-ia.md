# L'assistant IA

> État au 2 novembre 2026 (fin de la phase A). Pour la vision et la feuille de route, voir `vision.md`.

## Ce qu'il fait aujourd'hui

L'assistant est un chat attaché à un projet. Il connaît le contexte du projet et l'état de ses tâches, répond aux questions et modifie le projet à la demande.

- **Questions :** résumé, blocages, charge par personne, glissements par rapport au plan de référence, priorités.
- **Actions :** créer un groupe, planifier plusieurs tâches d'un coup, modifier une tâche (statut, responsable, échéance, priorité, groupe), supprimer, commenter avec @mentions, créer une automatisation.

Il ne fait encore rien de lui-même : pas de suivi quotidien, de relances ni de demandes d'explication. Ce sont les phases C à E de la feuille de route.

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

### Configuration (`.env.local` en local, `.env` sur le VPS)

| Variable | Rôle | Défaut |
|---|---|---|
| `OPENROUTER_API_KEY` | Clé OpenRouter (obligatoire) | — |
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
