# Assistant Projet

Outil de PMO IA-first : l'assistant reçoit le contexte des projets, répartit le travail, suit les tâches, demande pourquoi elles sont en retard et apprend de ces explications. Voir `docs/vision.md`.

Documentation : voir [`docs/README.md`](docs/README.md) (charte du projet, vision, plan d'exploitation, assistant IA, déploiement).

## Démarrer en local

```bash
npm install
cp .env.example .env.local   # renseigner OPENROUTER_API_KEY
npm run dev                  # http://localhost:3000
```

Sans `DATABASE_URL`, l'app utilise PGlite, un vrai PostgreSQL embarqué stocké dans `./.data/pglite` : aucun serveur à installer. Une organisation de démonstration avec deux projets est créée au premier lancement.

## Données

- **PostgreSQL** (PGlite en local et dans les tests, PostgreSQL 17 sur le VPS), accès via Drizzle. Schéma : `lib/db/schema.ts` ; migrations : `drizzle/` (générées par `npm run db:generate`, appliquées au démarrage).
- **Multi-projets** : organisation (le PMO) → membres partagés entre projets, portefeuilles → projets (description, livrables, parties prenantes, équipe) → tâches.
- **Historique** : chaque création, modification ou suppression de tâche est journalisée dans `task_events`, avec son auteur (membre, assistant ou système). Les tâches gardent leur date du plan de référence (`baseline_due_date`), ce qui permet de mesurer les glissements.
- Toutes les écritures passent par `lib/db/repo.ts`.

## L'assistant IA

Documentation complète : `docs/assistant-ia.md`.

- **Passerelle : OpenRouter**, via son point d'entrée compatible avec l'API Messages de Claude. Le code utilise le SDK officiel `@anthropic-ai/sdk` ; changer de passerelle ne touche que `lib/ai/client.ts`.
- **Modèle :** `AI_MODEL` (défaut `anthropic/claude-opus-5.5`).
- **Contexte envoyé :** description du projet, livrables, parties prenantes, équipe, tâches avec leur glissement.
- **Outils :** `create_group`, `create_items`, `update_item`, `delete_item`, `add_comment`, `create_automation`. Chaque entrée est validée (zod) avant exécution.
- **Limite quotidienne** par organisation (`AI_DAILY_LIMIT`) et suivi des tokens, en base.

## API

| Route | Rôle |
|---|---|
| `GET /api/projects` | Portefeuille : projets et indicateurs (terminées, en retard, bloquées, glissées) |
| `GET /api/projects/:id` | Tableau d'un projet |
| `GET /api/tasks/:id/history` | Historique d'une tâche |
| `POST /api/assistant` | `{ projectId, message, history }` |

## Tests

```bash
npm test
```

- `test:db` : la couche de données sur PGlite (ou sur un vrai PostgreSQL avec `TEST_DATABASE_URL`).
- `test:assistant` : l'app complète contre un faux serveur OpenRouter (aucun appel payant).

## Limites actuelles

- Pas encore de connexion utilisateur : on agit comme le chef de projet de l'organisation de démonstration (`lib/session.ts`).
- Réponse de l'assistant non streamée.
- Le plan de référence n'est pas encore figé explicitement (phase B) : la première date d'une tâche sert de référence.
