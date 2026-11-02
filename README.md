# Assistant Projet

Gestion de projet IA-first, inspirée de Monday.com. Voir `docs/analyse-monday-com.md` (analyse) et `prototype/index.html` (maquette interactive et grille de décisions).

## Démarrer

```bash
npm install
cp .env.example .env.local   # puis renseigner OPENROUTER_API_KEY
npm run dev                  # http://localhost:3000
```

## L'assistant IA

- **Passerelle : OpenRouter**, via son point d'entrée compatible avec l'API Messages de Claude (`https://openrouter.ai/api`). Le code utilise le SDK officiel `@anthropic-ai/sdk` ; changer de passerelle (API Anthropic directe, Bedrock…) ne demande que de modifier `lib/ai/client.ts`.
- **Modèle :** `AI_MODEL` (défaut `anthropic/claude-opus-5.5`).
- **Route :** `POST /api/assistant` avec `{ message, history }`. Le serveur envoie l'état du board au modèle, exécute les outils qu'il appelle (`create_group`, `create_items`, `update_item`, `delete_item`, `add_comment`, `create_automation`) et renvoie la réponse, les actions faites et le board à jour.
- **Sécurité :** la clé reste côté serveur ; chaque entrée d'outil est validée (zod) avant exécution ; limite de demandes par espace et par jour (`AI_DAILY_LIMIT`).
- **Coûts :** le prompt système et les outils sont figés et mis en cache ; l'usage en tokens est compté par espace et affiché dans l'en-tête.

| Fichier | Rôle |
|---|---|
| `lib/ai/client.ts` | Client SDK branché sur OpenRouter |
| `lib/ai/tools.ts` | Définition, validation et exécution des outils |
| `lib/ai/assistant.ts` | Prompt système et boucle d'appels d'outils |
| `lib/ai/quota.ts` | Limite quotidienne et suivi des tokens |
| `lib/board/store.ts` | Données du board (en mémoire pour le MVP, PostgreSQL ensuite) |

## Tests

```bash
npm run build && npm run test:assistant
```

Le test lance l'app contre un faux serveur OpenRouter (aucun appel payant) et vérifie la planification avec outils, la validation des entrées, le refus du modèle, une clé refusée et une requête invalide.

## Limites actuelles

- Données en mémoire : elles sont perdues au redémarrage du serveur.
- Pas encore d'authentification : l'utilisateur courant est le premier membre du board.
- Réponse non streamée : la réponse arrive en une fois.
