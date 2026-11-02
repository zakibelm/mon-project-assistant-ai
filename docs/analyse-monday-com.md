# Analyse de Monday.com — base pour « mon-project-assistant-ai »

> Date : novembre 2026. Les prix et fonctionnalités IA viennent surtout de sources tierces (voir la fin du document). Vérifiez-les sur monday.com avant toute décision commerciale.

## 1. Ce qu'est Monday.com

Monday.com est un « Work OS », c'est-à-dire une plateforme no-code de gestion du travail. Tout repose sur une seule abstraction, le **board** (un tableau de données typées). On construit ensuite des vues, des automatisations et des produits par-dessus : Work Management, CRM, Dev, Service.

**Ce qui fait sa force :** un modèle de données très simple, mais assez flexible pour couvrir presque tous les cas d'usage d'équipe.

## 2. Modèle de données (le cœur à reproduire)

```
Account (organisation)
 └── Workspace
      └── Folder (optionnel)
           └── Board
                ├── Columns (schéma typé : status, person, date, timeline, number,
                │            text, dropdown, tags, file, link, formula, mirror,
                │            connect-boards, dependency, progress, rating…)
                ├── Groups (sections de lignes, ex. « Cette semaine »)
                │    └── Items (lignes)
                │         ├── column_values (valeur par colonne, stockée en JSON)
                │         ├── Subitems (mini-board enfant avec son propre schéma)
                │         └── Updates (fil de discussion, fichiers, mentions)
                ├── Views (Table, Kanban, Timeline/Gantt, Calendar, Chart,
                │          Workload, Form, Map, Files)
                └── Automations / Integrations (recettes « Quand X alors Y »)
Dashboards : widgets qui agrègent plusieurs boards.
Docs : documents collaboratifs reliés aux boards.
```

**Points clés à retenir pour un clone :**
- **Schéma dynamique.** Les colonnes sont définies par l'utilisateur, avec des valeurs stockées en JSON/JSONB et validées selon le type de colonne.
- **Relations entre boards.** La colonne *Connect boards* crée un lien entre items, et la colonne *Mirror* affiche un champ de l'item lié. C'est ce qui permet le CRM, les dépendances, etc.
- **Vues = projections.** Une vue enregistre seulement des filtres, des tris, un regroupement et des colonnes visibles. Les données restent uniques.
- **Permissions.** Elles se gèrent par board (main / privé / partageable), avec des rôles owner/member/viewer/guest et des restrictions par colonne.

## 3. Fonctionnalités par domaine

| Domaine | Fonctionnalités Monday | Priorité pour notre MVP |
|---|---|---|
| Boards & items | CRUD, groupes, sous-items, drag & drop, édition inline | **P0** |
| Colonnes | ~30 types, formules, mirror, dépendances | **P0** (status, person, date, text, number, tags), P1 pour les autres |
| Vues | Table, Kanban, Gantt, Calendar, Chart, Workload, Form | **P0** Table + Kanban, P1 Calendar + Timeline |
| Collaboration | Updates, @mentions, notifications, fichiers, inbox | **P0** updates + notifications |
| Automations | Recettes déclencheur → condition → action, quotas mensuels | **P1** |
| Intégrations | Slack, Gmail, Outlook, Teams, GitHub, Jira, Zapier, webhooks | P2 (webhooks + Slack en premier) |
| Dashboards | Widgets agrégés multi-boards | P1 |
| Docs | Éditeur collaboratif lié aux boards | P2 |
| API | GraphQL (API v2), apps marketplace, SDK | P1 (API REST/GraphQL interne) |
| IA | Sidekick, Agents, Magic, Vibe, MCP | **Différenciateur — P0** |

## 4. IA chez Monday (état 2026)

- **Sidekick** est l'assistant contextuel. Il est sorti de bêta en janvier 2026 et sert de point d'entrée IA, à travers les boards, les docs et les personnes.
- **monday Agents** est un constructeur d'agents autonomes, lancé en septembre 2025.
- **Magic** génère des boards et des workflows complets à partir d'une description.
- **Vibe** est un générateur d'apps no-code.
- **MCP** permet à des outils IA externes (Claude, etc.) de lire et d'écrire dans monday.
- **Monétisation :** des crédits IA sont inclus dans les plans payants. Le modèle passe à « sièges + crédits ».

**Lecture stratégique.** L'IA de Monday a été greffée sur un produit conçu à l'origine pour des humains qui cliquent. Un assistant pensé *IA-first* (l'agent est l'interface principale, les vues servent de contrôle) peut se distinguer sur ce point.

## 5. Modèle économique

- **Free :** jusqu'à 2 sièges.
- **Basic :** ~9 $/siège/mois. **Standard :** ~12 $. **Pro :** ~19 $ (facturation annuelle). **Enterprise :** sur devis.
- **Minimum de 3 sièges** sur les plans payants. Une source parle aussi de paliers de sièges imposés (ex. 6 personnes paient 10 sièges), ce qui reste à vérifier sur monday.com. Ces règles reviennent souvent dans les plaintes d'utilisateurs.
- **Automations et intégrations :** soumises à des quotas mensuels et réservées aux plans Standard et supérieurs.
- **Crédits IA :** inclus par palier selon une source unique, à vérifier.

## 6. Forces et faiblesses

**Forces**
- UX visuelle très accessible.
- Un seul modèle de données réutilisé pour tous les produits.
- Large écosystème d'intégrations.

**Faiblesses (et opportunités pour nous)**
1. **Prix.** Le minimum de sièges et les quotas d'automatisations pénalisent les petites équipes et les freelances.
2. **Complexité croissante.** Il faut configurer beaucoup de choses avant d'obtenir de la valeur.
3. **IA ajoutée a posteriori,** et facturée en crédits.
4. **Peu adapté au solo ou au francophone.** Il n'y a pas de positionnement « assistant personnel de projet ».
5. **Reporting avancé et dépendances inter-projets** limités sur les petits plans.

## 7. Architecture proposée pour notre clone IA-first

```
Frontend : Next.js (React) + TanStack Table + dnd-kit + Tailwind
Temps réel : WebSockets (ou Supabase Realtime) pour la co-édition et les notifications
Backend : Node/TypeScript (API GraphQL ou tRPC)
BDD : PostgreSQL (boards/groups/items relationnels, column_values en JSONB)
Jobs : file de tâches (BullMQ / pg-boss) pour automations et agents
IA : Claude (tool use) avec outils = opérations du modèle (create_item, update_status,
     assign, summarize_board, plan_project…) + serveur MCP exposé aux clients externes
Auth : Supabase Auth / Clerk ; RBAC par workspace et board
```

**Schéma minimal :**
- `workspaces(id, name)`
- `boards(id, workspace_id, name, kind)`
- `columns(id, board_id, type, title, settings jsonb, position)`
- `groups(id, board_id, title, color, position)`
- `items(id, board_id, group_id, parent_item_id, name, position)`
- `item_values(item_id, column_id, value jsonb)`
- `updates(id, item_id, author_id, body)`
- `views(id, board_id, type, config jsonb)`
- `automations(id, board_id, trigger jsonb, actions jsonb)`

## 8. Feuille de route MVP

1. **Semaine 1–2 :** auth, workspaces, boards, groupes, items, colonnes de base, vue Table.
2. **Semaine 3 :** vue Kanban, updates et commentaires, notifications, temps réel.
3. **Semaine 4 :** assistant IA, pour créer un projet depuis une phrase, mettre à jour en langage naturel et produire un résumé quotidien.
4. **Semaine 5–6 :** automations simples (status → notify / assign / move), vue Calendar, serveur MCP.

**Différenciateurs à viser :**
- IA incluse sans système de crédits opaque.
- Pas de minimum de sièges.
- Interface en français d'abord.
- Agent capable de *planifier* (découpage en tâches, estimation, dépendances) et pas seulement d'exécuter.

## Sources
- https://www.activepieces.com/blog/monday-com-pricing-2026-plans-costs-automation-limits.md
- https://tinycommand.com/blogs/monday-pricing-explained
- https://automationatlas.io/answers/monday-com-pricing-explained-2026/
- https://monday.com/blog/ai-agents/everything-monday-ai-can-do/
- https://support.monday.com/hc/en-us/articles/26701503726610
- https://till-freitag.com/en/blog/monday-ai-features-en
- https://www.businesswire.com/news/home/20250710642619/en/monday.com-unveils-platform-wide-ai-shift-the-work-execution-era-arrives
