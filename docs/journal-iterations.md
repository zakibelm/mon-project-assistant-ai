# Journal des itérations d'expérience utilisateur

> Notes de travail : ce qui a été changé, mesuré et appris à chaque itération.
> Règles : un seul changement structurant à la fois ; on part toujours de la meilleure version connue ; on ne refait pas un essai déjà tranché.

## Méthode de mesure (réutilisable)

Il n'y a pas encore d'utilisateurs réels ni d'analytique. On mesure donc un **indicateur de remplacement reproductible** : des parcours scriptés dans un navigateur (Playwright) sur des tâches types, comparés entre la version de référence et la nouvelle.

- **Indicateurs :**
  - réussite des tâches, vérifiée en base via l'API ;
  - clics ;
  - messages à taper ;
  - changements d'écran ;
  - appels d'IA ;
  - durée.
- **Référence dans son meilleur cas :** l'IA est simulée par un faux OpenRouter « parfait », qui exécute exactement l'action demandée, sans latence (`scripts/ux/mock-ai-perfect.mjs`). Les écarts mesurés sont donc des **minorations** : un vrai modèle ajoute plusieurs secondes par appel et peut se tromper.
- **Script :** `scripts/ux/measure-decisions.cjs <url> <base|inline> <libellé>`, à lancer contre des serveurs autonomes (`.next/standalone`) démarrés avec une base en mémoire (`PGLITE_DIR=memory://`). On prend la version de référence au commit précédent et la nouvelle version au commit courant.
- **Piège déjà rencontré :** les tâches modifient l'état. L'ordre compte : reprendre une tâche peut faire passer la surcharge d'une personne à une autre. Il faut toujours partir de serveurs neufs et fixer l'ordre des tâches, identique pour les deux versions.

## Itérations

### 1. Accueil « Aujourd'hui » (commit c412bb7)
- **Changement :** le point du jour remplace le tableau comme page d'entrée.
- **Mesure :** aucune comparaison chiffrée (méthode pas encore en place). Vérification qualitative en navigateur seulement.
- **Appris :** l'accueil donne la bonne question (« que dois-je décider ? »), mais chaque réponse renvoie ailleurs. La friction s'est déplacée vers l'action. C'est ce qui a motivé l'itération 3.

### 2. Nouveau projet du brief au plan (commit dd83217)
- **Changement :** création d'un projet à partir d'un texte, avec relecture avant enregistrement.
- **Mesure :** pas de version de référence comparable, puisque la fonction n'existait pas. Tests fonctionnels et parcours en navigateur.
- **Appris :** les exemples de démonstration hors du domaine de l'utilisateur (la clinique) brouillent la compréhension. Il faut garder des exemples universels, étiquetés « exemple ».

### 3. Résolution des décisions sur place (cette itération)
- **Diagnostic :** dans le point du jour, chaque carte envoyait l'utilisateur dans le projet, attendait l'IA, demandait un deuxième message pour agir, puis il fallait revenir. Sans clé d'IA, aucune carte ne pouvait être traitée.
- **Changement :** chaque carte se règle sur place, sans IA. Selon le cas :
  - « Je m'en occupe », « C'est débloqué », « C'est terminé », « Marquer En cours » ;
  - nouvelle date, avec le plan de référence conservé ;
  - réassignation dans l'équipe du projet ;
  - relance dans le fil de la tâche.

  La carte affiche alors « ✓ Réglé » avec « Annuler ». L'assistant reste disponible en lien secondaire.
- **Mesure :** 2 tâches types (rééquilibrer Sami, puis débloquer la tâche SSL), serveurs neufs, même ordre :

| | Référence, IA parfaite | Référence, sans clé | Nouvelle version (avec ou sans clé) |
|---|---|---|---|
| Tâches réussies | 2/2 | 0/2 | **2/2** |
| Clics | 4 | 4 | **3** |
| Messages à taper | 2 | 2 | **0** |
| Changements d'écran | 4 | 4 | **0** |
| Appels d'IA | 6 | 0 | **0** |
| Durée (IA instantanée) | 2,1 s | — | **0,65 s** |

- **Décision :** livrée. Elle gagne sur tous les indicateurs.
- **Appris :**
  - une décision courante ne devrait jamais dépendre de l'IA. L'IA sert à l'analyse, pas à l'exécution d'un choix déjà clair ;
  - montrer la conséquence tout de suite est un gain qualitatif : la surcharge passe de Sami à Zaki dès qu'il reprend une tâche ;
  - mesurer la référence avec une IA parfaite reste honnête et laisse quand même un écart net.

## Prochaines pistes (non testées)

- **Collecte des explications de retard (phase D).** Le cœur de la vision n'a pas encore d'interface : aujourd'hui, « Demander la cause » ne poste qu'un message. À mesurer : part des retards ayant une cause catégorisée et évaluée.
- **Point du jour par courriel.** L'utilisateur n'a plus à ouvrir l'application pour décider. À mesurer : délai entre l'apparition d'un point et sa résolution.
