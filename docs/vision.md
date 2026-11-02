# Vision : Assistant Projet

> Version du 2 novembre 2026, à valider par Zakaria Belmeddah.

## En une phrase

Un assistant qui reçoit le contexte d'un projet, répartit le travail, suit chaque tâche, demande pourquoi elle est en retard et apprend de ces explications pour éviter les prochains retards.

Le board (tableau, Kanban, calendrier) reste utile, mais il n'est qu'un moyen. Le produit, c'est le suivi et l'apprentissage.

## Cible : un outil de PMO

L'outil sert à un bureau de projets (PMO) qui gère **plusieurs projets en même temps**. Le prototype actuel ne montre qu'un tableau de bord de projet, mais tout est construit pour le multi-projets :

```
Organisation (le PMO)
 ├── Membres (une personne peut travailler sur plusieurs projets)
 ├── Registre des leçons apprises (commun à tous les projets)
 └── Portefeuille
      └── Projets (contexte, livrables, parties prenantes, plan de référence)
           └── Tâches → historique, explications des retards, évaluations
```

Ce que cela permet, sans refonte :

- **vue portefeuille** : l'état de chaque projet (à l'heure, en glissement, en retard) ;
- **charge d'une personne sur tous ses projets** ;
- **leçons d'un projet réutilisées dans les suivants**.

## Le cycle

| Étape | Ce que fait l'assistant | Ce que fait le chef de projet |
|---|---|---|
| 1. Contexte | Pose les questions qui manquent | Donne la description, les dates des livrables, les faits saillants, les parties prenantes et l'équipe |
| 2. Plan | Découpe en tâches, estime les durées, propose les dépendances et les assignations | Valide ou corrige |
| 3. Référence | Fige le plan validé comme référence | — |
| 4. Suivi quotidien | Repère les retards, les blocages, les surcharges ; envoie un point du matin | Lit le point, tranche les décisions |
| 5. Explications | Quand une tâche est en retard, demande la cause au responsable | — |
| 6. Apprentissage | Classe les causes (pondérées par le poids du chef de projet), ajuste les estimations, propose des parades | Note chaque explication de 1 à 5, corrige la cause si besoin, valide les leçons retenues |
| 7. Replanification | Calcule l'effet d'un retard sur la suite et propose un nouveau plan | Accepte ou refuse |

### 1. Contexte du projet

- Description et objectif
- Livrables et leurs dates
- Faits saillants (contraintes, risques connus, décisions déjà prises)
- Parties prenantes (qui décide, qui doit être informé)
- Équipe : membres, rôles, disponibilités. Pendant les essais, des identifiants (« Membre 1 », « Membre 2 ») ; ensuite les vrais noms.

### 5. Demande d'explication

Une tâche est en retard quand elle n'est pas terminée à sa date prévue dans le plan de référence. L'assistant demande alors au responsable :

- **une catégorie de cause**, choisie dans une liste :
  - dépendance externe ;
  - sous-estimation ;
  - information manquante ;
  - changement de périmètre ;
  - surcharge ;
  - problème technique ;
  - autre ;
- **une explication libre** ;
- **une nouvelle date réaliste.**

Le ton vise la cause, jamais la personne. Si les gens se sentent jugés, ils donnent des excuses au lieu des vraies causes, et l'outil apprend des choses fausses.

**Évaluation par le chef de projet.** Le chef de projet, qui connaît la réalité du terrain, relit chaque explication :

- il donne un **poids de 1 à 5** à sa fiabilité (« est-ce la vraie cause ? ») ; ce poids note l'explication, pas la personne ;
- il peut **corriger la catégorie de cause** ;
- il peut ajouter une note.

L'IA apprend de la cause retenue, pondérée par ce poids : une explication notée 1 ne compte presque pas, une explication notée 5 compte pleinement. L'équipe sait que les explications sont relues ; le poids n'est visible que du chef de projet.

### 6. Apprentissage

- **Pendant le projet :** si les tâches d'un même type glissent toutes, l'assistant propose d'allonger les estimations des tâches semblables qui restent.
- **D'un projet à l'autre :** un registre des leçons apprises (cause, contexte, parade qui a marché) est consulté lors du cadrage du projet suivant. Par exemple : « Sur les 3 derniers projets, les accès des fournisseurs ont causé des retards : je prévois une tâche de demande d'accès en semaine 1. »
- Une leçon n'entre dans le registre qu'après validation du chef de projet.

## Principes

1. **L'assistant propose, l'humain décide** : assignations, replanification et leçons sont validées par le chef de projet, au moins au début.
2. **Apprendre des causes, pas noter les personnes** : aucun classement des membres, aucun score individuel.
3. **Données personnelles** : avant de passer aux vrais noms, on informe l'équipe de ce qui est collecté et pourquoi, on limite l'accès aux explications au chef de projet, et on prévoit leur suppression à la fin du projet, les leçons étant gardées sans nom.
4. **Transparence** : chaque proposition de l'assistant dit sur quoi elle s'appuie.

## Feuille de route

| Phase | Contenu | Résultat vérifiable |
|---|---|---|
| A. Base de données ✅ | PostgreSQL (PGlite en développement et en tests, PostgreSQL sur le VPS ou un service géré en production), accès via Drizzle ; modèle multi-projets (organisation, portefeuille, projets, membres partagés) ; historique des changements de statut et de date | Les données survivent au redémarrage ; on sait quand chaque tâche a changé ; deux projets coexistent dans la même organisation |
| B. Contexte et plan ✅ (première version) | Fiche projet (description, livrables, faits saillants, parties prenantes, équipe), génération du plan, plan de référence figé | À partir d'une fiche projet, l'assistant propose un plan validable en un clic |
| C. Suivi quotidien | Tâche planifiée chaque matin, détection des retards, point du matin | Chaque matin, un point liste ce qui avance, ce qui glisse et ce qu'il faut décider |
| D. Explications ✅ (première version) | Demande de cause au responsable, catégories, nouvelle date ; évaluation par le chef de projet (poids 1 à 5, catégorie corrigée) | Chaque retard a une cause enregistrée et évaluée |
| E. Apprentissage ✅ (première version) | Statistiques des causes, ajustement des estimations, registre des leçons | Au cadrage suivant, l'assistant cite les leçons pertinentes |
| F. Canaux | Courriel, puis Slack ou Teams | Les membres répondent sans ouvrir l'application |

Les essais se font avec des membres numérotés jusqu'à la fin de la phase E.

## Avancement

- 2026-11-02 : phase B, première version : « Nouveau projet » transforme un brief en contexte et en plan, relus et corrigés par le chef de projet, puis fige le plan de référence à la création. Reste à faire : refigé du plan de référence après une replanification validée.
- 2026-11-02 : nouvelle page d'accueil « Aujourd'hui » : le point du jour sur tout le portefeuille, avec des actions en un clic confiées à l'assistant. L'outil s'ouvre sur les décisions à prendre, plus sur un tableau. Premier pas de la phase C, sans tâche planifiée ni envoi pour l'instant.
- 2026-11-02 : phase A livrée (schéma multi-projets, historique des tâches, PGlite en local, PostgreSQL 17 sur le VPS via Docker, tests sur les deux).

## Décisions prises

- 2026-11-02 : l'explication d'un retard est donnée par le responsable de la tâche, puis évaluée par le chef de projet (poids de 1 à 5, catégorie corrigeable).
- 2026-11-02 : la cible est un outil de PMO multi-projets ; le modèle de données est multi-projets dès la phase A.
- 2026-11-02 : hébergement de production sur le VPS (Docker : PostgreSQL + application, nginx devant).
- 2026-11-02 : PostgreSQL dès le départ (remplace le choix initial de SQLite), à cause des écritures simultanées du suivi multi-projets et d'un futur usage par plusieurs organisations. PGlite garde la simplicité d'un fichier en développement et en tests.

- 2026-11-02 : dans le tableau des tâches, colonnes **Notes**, **Évaluation (1 à 5)** et **Validé**. Le responsable écrit la note (type de problème, problème, résolution) et propose une évaluation. Le chef de projet peut la corriger et il est le seul à cocher « Validé ». Seules les notes validées alimentent les leçons apprises ; toute modification décoche la validation.

## Questions encore ouvertes

- Quel délai avant une relance, et combien de relances ?
- Faut-il une catégorie de cause propre au domaine de chaque projet (construction, logiciel, événementiel) ?
