# Plan d'exploitation : Assistant Projet

> Version 0.1 du 2 novembre 2026. Statut : **à valider par Zakaria Belmeddah**.
> Ce plan couvre la phase de prototype (un VPS, un PMO). Il sera revu avant toute ouverture à des clients.

## 1. Environnements

| Environnement | Où | Base de données | Données | Usage |
|---|---|---|---|---|
| Local | Poste du développeur ou session Claude | PGlite (`./.data/pglite`) | Démonstration | Développement |
| Tests | Local ou CI | PGlite en mémoire ; PostgreSQL de test avec `TEST_DATABASE_URL` | Démonstration, recréées à chaque test | `npm test` |
| Production | VPS, Docker | PostgreSQL 17 (volume `pgdata`) | Réelles (membres numérotés pendant le prototype) | Utilisation |

Il n'y a pas d'environnement de préproduction pendant le prototype. Une version est testée en local, puis déployée par étiquette. On peut revenir en arrière en redéployant l'étiquette précédente (section 3).

## 2. Composants en production

```
Internet ──HTTPS──► nginx (VPS, auth_basic tant qu'il n'y a pas de connexion)
                      └──► 127.0.0.1:3000  conteneur app (Next.js)
                                └──► conteneur db (PostgreSQL 17, non exposé)
                      app ──HTTPS──► OpenRouter ──► Claude
```

| Composant | Responsable | Redémarrage automatique |
|---|---|---|
| nginx | Zakaria (VPS) | Oui (systemd) |
| Conteneur `app` | Docker | Oui (`restart: unless-stopped`) |
| Conteneur `db` | Docker | Oui, avec contrôle de santé |
| OpenRouter / Claude | Fournisseur externe | — |

## 3. Déploiement

Procédure détaillée : `deploiement-vps.md`. Règles :

1. On ne déploie qu'une **étiquette** (`vX.Y.Z`) posée sur `main` après fusion, jamais une branche.
2. Avant de déployer : `npm test` vert sur la version étiquetée.
3. Déploiement : `git checkout vX.Y.Z && APP_VERSION=vX.Y.Z docker compose up -d --build`.
4. Les migrations de base s'appliquent au démarrage. **Faire une sauvegarde juste avant** tout déploiement qui contient une migration (nouveau fichier dans `drizzle/`).
5. Après le déploiement : vérification rapide (section 5).

**Retour arrière :** `git checkout <étiquette précédente> && docker compose up -d --build`. Si la version fautive contenait une migration, restaurer aussi la sauvegarde faite juste avant (section 6). Les migrations ne sont pas annulées automatiquement.

## 4. Configuration et secrets

| Secret | Où | Rotation |
|---|---|---|
| `OPENROUTER_API_KEY` | `.env` sur le VPS (`chmod 600`) | Tous les 6 mois, ou immédiatement en cas de doute |
| `POSTGRES_PASSWORD` | `.env` sur le VPS | En cas de doute (demande un arrêt court) |
| Mot de passe nginx (`auth_basic`) | Fichier htpasswd sur le VPS | À chaque départ d'une personne |

Règles :

- **Jamais de secret dans le dépôt, les tickets, les journaux ou les messages d'erreur.**
- `.env.example` documente les variables, sans valeurs.
- Une limite de dépense est configurée sur le compte OpenRouter, en plus de la limite quotidienne de l'application.

## 5. Surveillance

### Vérifications après chaque déploiement

```bash
docker compose ps                                   # app et db « running », db « healthy »
curl -s http://127.0.0.1:3000/api/projects | head  # liste des projets
docker compose logs --since 10m app | grep -i error # aucune erreur
```

Puis une demande à l'assistant depuis l'interface, en vérifiant que le compteur de tokens augmente.

### Surveillance continue (à mettre en place à la mise en ligne)

| Quoi | Comment | Seuil d'alerte |
|---|---|---|
| Site accessible | Sonde HTTP externe (UptimeRobot ou équivalent) sur la page d'accueil | 2 échecs de suite |
| Erreurs de l'assistant | `docker compose logs app \| grep "\[assistant\] erreur"` | Plus de 5 par jour |
| Coût de l'IA | Table `ai_usage` et tableau de bord OpenRouter | Plus de 80 % du budget mensuel |
| Espace disque | `df -h` (cron + courriel) | Plus de 80 % utilisé |
| Sauvegardes | Présence du fichier du jour | Fichier absent ou vide |

Requête de suivi des coûts :

```sql
select day, requests, input_tokens, cache_read_tokens, output_tokens
from ai_usage order by day desc limit 14;
```

## 6. Sauvegardes et restauration

| Élément | Fréquence | Conservation | Où |
|---|---|---|---|
| Base PostgreSQL (`pg_dump`, format custom) | Quotidienne (cron) et avant chaque migration | 14 jours | `/srv/backups` sur le VPS |
| Copie hors serveur | Hebdomadaire | 8 semaines | Stockage distinct du VPS (à choisir) |
| `.env` | À chaque modification | — | Gestionnaire de mots de passe |

- **Objectif de reprise :** perte de données de 24 h au plus, remise en service en moins de 2 h.
- **Test de restauration :** une fois par mois, sur une base de test. Le résultat est noté dans le journal d'exploitation.
- Les commandes sont dans `deploiement-vps.md`.

## 7. Gestion des incidents

| Gravité | Exemple | Délai de prise en charge |
|---|---|---|
| Critique | Site inaccessible, perte de données, fuite de secret | Dès que possible |
| Majeure | Assistant hors service, suivi quotidien qui ne passe pas | Dans la journée |
| Mineure | Message d'erreur maladroit, lenteur ponctuelle | Prochaine version |

### Fiches réflexes

**Site inaccessible**
1. `docker compose ps`, puis `docker compose logs --tail 100 app db`.
2. `docker compose restart app`.
3. Si la base est en cause, vérifier l'espace disque, puis `docker compose restart db`.
4. Si ça ne repart pas, revenir à l'étiquette précédente (section 3).

**L'assistant répond « Clé OpenRouter refusée » ou « Crédits insuffisants »**
1. Vérifier le compte OpenRouter (crédits, limite de dépense, clé active).
2. Si la clé a changé : mettre à jour `.env`, puis `docker compose up -d app`.

**L'assistant a fait une mauvaise modification**
1. `GET /api/tasks/<id>/history` montre ce qui a changé, quand, et pour le compte de qui.
2. Corriger à la main ou demander à l'assistant de remettre les valeurs.
3. Si le problème vient du comportement du modèle, noter l'exemple et ajuster le prompt dans une version suivante.

**Fuite possible d'un secret**
1. Révoquer immédiatement le secret (OpenRouter, mot de passe).
2. En créer un nouveau, mettre à jour `.env`, redémarrer.
3. Chercher l'origine (journaux, historique Git) et la corriger.

Après chaque incident critique ou majeur : une note courte dans le journal d'exploitation (cause, effet, correction, prévention). Ces notes sont aussi des leçons apprises.

## 8. Données personnelles

L'outil enregistre des noms de membres, leurs tâches, leurs retards et leurs explications. Ce sont des données personnelles au sens de la loi fédérale canadienne (LPRPDE). Si l'outil sert à des équipes ou des clients au Québec, la Loi 25 s'applique aussi.

| Mesure | Prototype | Avant usage avec de vraies personnes nommées |
|---|---|---|
| Membres identifiés par un numéro | ✅ | — |
| Équipe informée de ce qui est collecté et pourquoi | — | Obligatoire |
| Explications et poids visibles seulement du chef de projet | À construire (phase D) | Obligatoire |
| Aucun classement ni score individuel | ✅ Principe de conception | Vérifié à chaque version |
| Suppression des explications nominatives à la fin du projet ; leçons gardées sans nom | — | Obligatoire |
| Responsable de la protection des renseignements désigné | — | Obligatoire |
| Données envoyées à l'IA limitées au nécessaire | ✅ Contexte du projet seulement | Revoir la politique de conservation d'OpenRouter et d'Anthropic |

## 9. Maintenance

| Tâche | Fréquence |
|---|---|
| Mises à jour de sécurité du VPS | Mensuelle, ou immédiate pour une faille critique |
| Mise à jour des dépendances npm (`npm audit`, `npm outdated`) | Mensuelle, dans une branche dédiée |
| Mise à jour des images figées (`node`, `postgres`) | Trimestrielle, dans un commit séparé |
| Revue des coûts d'IA | Mensuelle |
| Test de restauration | Mensuel |
| Revue de ce plan | À chaque fin de phase |

## 10. Journal d'exploitation

À tenir dans `docs/journal-exploitation.md`, une ligne par événement :

```
AAAA-MM-JJ | type (déploiement, incident, restauration, rotation) | version | ce qui a été fait | résultat
```

## 11. Points ouverts

- Choisir le stockage des copies de sauvegarde hors serveur.
- Choisir l'outil de sonde HTTP externe.
- Fixer le budget mensuel d'IA et la limite de dépense OpenRouter.
- Vérifier que la mémoire du VPS suffit pour PostgreSQL à côté de Boussole.
