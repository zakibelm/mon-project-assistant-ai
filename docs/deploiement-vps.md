# Déploiement sur le VPS

L'application et PostgreSQL tournent dans Docker (`docker-compose.yml`). nginx, déjà en place sur le VPS, fait le HTTPS et transmet à `127.0.0.1:3000`.

## Première installation

```bash
git clone https://github.com/zakibelm/mon-project-assistant-ai.git /srv/assistant-projet
cd /srv/assistant-projet
cp .env.example .env
chmod 600 .env
# Dans .env : OPENROUTER_API_KEY, POSTGRES_PASSWORD (long et aléatoire : openssl rand -base64 32),
# APP_URL (l'adresse publique), SEED_DEMO=1 pendant la phase de prototype.
docker compose up -d --build
docker compose logs -f app     # attendre « Ready »
curl -s http://127.0.0.1:3000/api/projects
```

Les migrations de la base sont appliquées automatiquement au démarrage de l'application.

## nginx

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 130s;   # une demande à l'assistant peut durer jusqu'à 120 s
}
```

Tant qu'il n'y a pas de connexion utilisateur dans l'application, protéger le site par mot de passe (`auth_basic`, comme pour Boussole).

## Mise à jour

```bash
cd /srv/assistant-projet
git fetch --tags && git checkout <étiquette>      # par exemple v0.2.0
APP_VERSION=<étiquette> docker compose up -d --build
```

## Sauvegarde

La base vit dans le volume Docker `pgdata`. Sauvegarde quotidienne conseillée (cron) :

```bash
docker compose -f /srv/assistant-projet/docker-compose.yml exec -T db \
  pg_dump -U assistant -d assistant --format=custom > /srv/backups/assistant-$(date +%F).dump
find /srv/backups -name 'assistant-*.dump' -mtime +14 -delete
```

Restauration :

```bash
docker compose exec -T db pg_restore -U assistant -d assistant --clean < /srv/backups/assistant-AAAA-MM-JJ.dump
```

Vérifier une restauration au moins une fois, sur une base de test, avant d'en avoir besoin.

## Mettre à jour les images figées

Les images `node` et `postgres` sont figées par empreinte sha256 dans `Dockerfile` et `docker-compose.yml`. Pour les mettre à jour : `docker pull <image>:<tag>`, relever l'empreinte avec `docker inspect --format '{{index .RepoDigests 0}}' <image>:<tag>`, la remplacer, tester, puis committer ce changement seul.
