# Charte du projet : Assistant Projet

> Version 0.1 du 2 novembre 2026. Statut : **à valider par Zakaria Belmeddah**.
> Les dates marquées « cible » sont des propositions à confirmer.

## 1. Raison d'être

Les outils de gestion de projet comme Monday.com enregistrent ce qui se passe, mais n'aident pas à le comprendre ni à s'améliorer. Les retards sont constatés, rarement expliqués, et les leçons se perdent d'un projet à l'autre.

**Assistant Projet** est un outil de PMO dont le cœur est un assistant IA qui :

1. reçoit le contexte des projets ;
2. répartit le travail ;
3. suit chaque tâche ;
4. demande pourquoi une tâche est en retard ;
5. apprend de ces explications, pondérées par le chef de projet, pour éviter les retards suivants.

## 2. Objectifs

| # | Objectif | Indicateur | Cible |
|---|---|---|---|
| O1 | Produire un plan exploitable à partir d'un contexte | Part des plans proposés acceptés avec peu de corrections | 70 % des tâches proposées gardées telles quelles |
| O2 | Détecter les retards sans saisie manuelle | Retards détectés par le suivi quotidien / retards réels | 100 % |
| O3 | Connaître la cause de chaque retard | Retards ayant une cause renseignée et évaluée | 90 % |
| O4 | Apprendre d'un projet à l'autre | Leçons citées au cadrage d'un nouveau projet | Au moins une leçon pertinente par cadrage, dès le 3e projet |
| O5 | Garder un coût d'IA soutenable | Coût d'IA par utilisateur actif et par mois | Moins de 2 $ US |

## 3. Périmètre

### Inclus

- Gestion multi-projets pour un PMO : portefeuilles, projets, équipes partagées.
- Contexte des projets : description, livrables, faits saillants, parties prenantes, équipe.
- Planification assistée et plan de référence.
- Suivi quotidien, point du matin, notifications.
- Explications des retards, évaluation par le chef de projet (poids de 1 à 5), registre des leçons apprises.
- Vues Tableau, Kanban et Calendrier, plus une vue portefeuille.
- Hébergement sur le VPS.

### Exclus (pour l'instant)

- Documents collaboratifs, marketplace d'applications, générateur d'applications.
- Facturation, CRM, gestion des temps détaillée.
- Applications mobiles natives : le site web adaptatif suffit.
- Plusieurs organisations clientes payantes. Le modèle de données le permet, mais l'offre commerciale n'est pas définie.

## 4. Parties prenantes

| Partie prenante | Rôle | Attentes |
|---|---|---|
| Zakaria Belmeddah | Commanditaire et PMO | Un outil qui suit les projets à sa place et en tire des leçons |
| Chefs de projet | Utilisateurs principaux | Moins de relances manuelles, une vue claire des retards |
| Membres des équipes | Utilisateurs | Des demandes courtes, un ton non accusateur, des données protégées |
| Claude (sessions de développement) | Développement | Des consignes claires ; les fusions restent une décision humaine |
| OpenRouter / Anthropic | Fournisseurs de l'IA | — |

## 5. Livrables et jalons

| Phase | Livrable | Statut | Date |
|---|---|---|---|
| 0 | Analyse de Monday.com, prototype interactif, grille garder / modifier / supprimer | ✅ Fait | 2026-11-02 |
| — | Assistant IA via OpenRouter (outils, quota, tests) | ✅ Fait | 2026-11-02 |
| A | Base PostgreSQL multi-projets, historique, déploiement Docker | ✅ Fait | 2026-11-02 |
| A+ | Mise en ligne sur le VPS et premier essai avec une vraie clé | À faire | Cible : semaine du 2 novembre |
| B | Fiche de contexte, plan proposé par l'assistant, plan de référence | À faire | Cible : mi-novembre |
| — | Connexion des utilisateurs (rôles PMO, chef de projet, membre) | À faire | Cible : avant tout essai avec une vraie équipe |
| C | Suivi quotidien, point du matin | À faire | Cible : fin novembre |
| D | Explications des retards et évaluation par le chef de projet | À faire | Cible : début décembre |
| E | Apprentissage et registre des leçons | À faire | Cible : décembre |
| F | Relances par courriel, puis Slack ou Teams | À faire | Cible : janvier 2027 |

**Critère de fin du prototype :** un vrai projet, avec des membres numérotés, est suivi de bout en bout pendant 3 semaines. Les retards sont détectés, expliqués, évalués, et au moins une leçon est validée.

## 6. Gouvernance

- **Décisions :** prises par Zakaria Belmeddah et consignées, datées, dans la section « Décisions prises » de `vision.md`.
- **Code :** chaque changement passe par une branche et une demande de fusion. Les tests doivent passer avant la demande. La fusion reste un clic humain.
- **Versions :** étiquette `vX.Y.Z` sur `main` à chaque mise en production. Le VPS ne déploie que des versions étiquetées.
- **Revue de phase :** à la fin de chaque phase, un court rapport (fait, écarts, décisions, suite) est ajouté au dossier `docs/`.

## 7. Risques

| # | Risque | Probabilité | Impact | Réponse |
|---|---|---|---|---|
| R1 | Les membres donnent des excuses au lieu des vraies causes | Haute | Haut | Ton non accusateur ; poids de 1 à 5 donné par le chef de projet ; catégorie corrigeable |
| R2 | Le suivi des retards de personnes nommées pose un problème de confidentialité | Moyenne | Haut | Membres numérotés pendant les essais ; équipe informée ; aucun classement des personnes ; voir le plan d'exploitation, section données personnelles |
| R3 | Le coût de l'IA dépasse la cible | Moyenne | Moyen | Cache de prompt, limite quotidienne, suivi des tokens ; choix de modèle par usage si besoin |
| R4 | OpenRouter ne transmet pas une fonction (cache, repli en cas de refus) | Moyenne | Moyen | À vérifier au premier essai ; passage à l'API Anthropic directe en changeant un seul fichier |
| R5 | L'assistant fait une mauvaise modification | Moyenne | Moyen | Validation des entrées, historique complet, suppression seulement sur demande explicite ; validation humaine des plans |
| R6 | Perte de données sur le VPS | Faible | Haut | Sauvegarde quotidienne, restauration testée (plan d'exploitation) |
| R7 | Trop peu de données pour que l'apprentissage soit utile | Haute au début | Moyen | Règles simples d'abord ; leçons validées par le chef de projet ; statistiques seulement quand il y a assez de cas |
| R8 | Dépendance à un seul fournisseur d'IA | Faible | Moyen | Code fondé sur un SDK standard ; passerelle remplaçable |

## 8. Budget de fonctionnement (estimation)

| Poste | Estimation | Remarque |
|---|---|---|
| VPS | Déjà en place | Partagé avec Boussole ; vérifier la mémoire disponible pour PostgreSQL |
| IA (OpenRouter) | Environ 0,02 à 0,05 $ US par demande avec Claude Opus 5.5 | Plus la commission d'OpenRouter ; à mesurer au premier essai |
| Nom de domaine et HTTPS | Faible ou déjà en place | Let's Encrypt |

## 9. Hypothèses et contraintes

- Les utilisateurs sont francophones ; le français passe d'abord, l'anglais ensuite.
- Un seul VPS, sans haute disponibilité : une courte interruption est acceptable pendant le prototype.
- Le développement se fait avec des sessions Claude, sous la supervision de Zakaria Belmeddah.

## 10. Documents liés

- `vision.md` : vision, principes, feuille de route, décisions.
- `plan-operations.md` : exploitation, sécurité, sauvegardes, incidents.
- `assistant-ia.md` : fonctionnement de l'assistant.
- `deploiement-vps.md` : procédure de déploiement.
