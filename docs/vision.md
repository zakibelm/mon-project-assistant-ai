# Vision : Assistant Projet

> Version du 2 novembre 2026, à valider par Zakaria Belmeddah.

## En une phrase

Un assistant qui reçoit le contexte d'un projet, répartit le travail, suit chaque tâche, demande pourquoi elle est en retard et apprend de ces explications pour éviter les prochains retards.

Le board (tableau, Kanban, calendrier) reste utile, mais il n'est qu'un moyen. Le produit, c'est le suivi et l'apprentissage.

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
| A. Base de données | SQLite (un fichier, hébergé sur un serveur avec disque permanent), accès via Drizzle pour pouvoir passer à PostgreSQL sans réécrire le code ; historique des changements de statut et de date | Les données survivent au redémarrage ; on sait quand chaque tâche a changé |
| B. Contexte et plan | Fiche projet (description, livrables, faits saillants, parties prenantes, équipe), génération du plan, plan de référence figé | À partir d'une fiche projet, l'assistant propose un plan validable en un clic |
| C. Suivi quotidien | Tâche planifiée chaque matin, détection des retards, point du matin | Chaque matin, un point liste ce qui avance, ce qui glisse et ce qu'il faut décider |
| D. Explications | Demande de cause au responsable, catégories, nouvelle date ; évaluation par le chef de projet (poids 1 à 5, catégorie corrigée) | Chaque retard a une cause enregistrée et évaluée |
| E. Apprentissage | Statistiques des causes, ajustement des estimations, registre des leçons | Au cadrage suivant, l'assistant cite les leçons pertinentes |
| F. Canaux | Courriel, puis Slack ou Teams | Les membres répondent sans ouvrir l'application |

Les essais se font avec des membres numérotés jusqu'à la fin de la phase E.

## Décisions prises

- 2026-11-02 : l'explication d'un retard est donnée par le responsable de la tâche, puis évaluée par le chef de projet (poids de 1 à 5, catégorie corrigeable).
- 2026-11-02 : SQLite pour commencer, avec une couche d'accès compatible PostgreSQL ; passage à PostgreSQL quand plusieurs organisations utiliseront l'outil.

## Questions encore ouvertes

- Quel délai avant une relance, et combien de relances ?
- Faut-il une catégorie de cause propre au domaine de chaque projet (construction, logiciel, événementiel) ?
