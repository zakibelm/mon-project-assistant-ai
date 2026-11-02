# Image de production de l'Assistant Projet (Next.js en mode standalone).
# Images figées par empreinte : mettre à jour volontairement, jamais implicitement.
FROM node:22-bookworm-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:22-bookworm-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-bookworm-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
# Migrations appliquées au démarrage de l'app.
COPY --from=build --chown=node:node /app/drizzle ./drizzle
# Bases de connaissances : métier (copie de secours, remplacée par le dossier monté) et client (dossier monté).
COPY --from=build --chown=node:node /app/rag-metier ./rag-metier
RUN mkdir -p ./rag-client && chown node:node ./rag-client
USER node
EXPOSE 3000
CMD ["node", "server.js"]
