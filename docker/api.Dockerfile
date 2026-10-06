FROM node:22.23.3-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS build
# Pas de TTY pendant le build : pnpm doit pouvoir recréer node_modules sans confirmation.
ENV CI=true
COPY . .
# Installation limitée à l'API et à ses paquets du monorepo, build, puis dépendances de prod seulement.
RUN pnpm install --frozen-lockfile --filter @palacards/api... \
 && pnpm --filter @palacards/api... build \
 && pnpm install --frozen-lockfile --prod --filter @palacards/api... \
 && rm -rf apps/web apps/e2e tools docs \
 # Dépendances « peer » optionnelles de Better Auth et outillage, jamais chargées par l'API (~700 Mo).
 # ponytail: élagage par motif ; si un module manque au démarrage, le retirer de cette liste.
 && cd node_modules/.pnpm && rm -rf next@* @next+* @playwright+* playwright* typescript@* eslint* @eslint* \
    @rolldown+* rolldown@* @img+* sharp@* @babel+* @esbuild* esbuild@* drizzle-kit@* @swc+* vitest@* @vitest+* vite@*

# Service de tri des suggestions (profil Docker « automation ») : même code que l'API, plus Claude Code (CLI),
# lancé sans aucun outil pour lire chaque suggestion et rendre un verdict structuré.
FROM node:22.23.3-alpine AS triage
ARG CLAUDE_CODE_VERSION=2.1.291
ENV NODE_ENV=production \
    DISABLE_AUTOUPDATER=1 \
    USE_BUILTIN_RIPGREP=0
RUN apk add --no-cache libgcc libstdc++ ripgrep \
 && npm install -g --omit=dev "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
 && npm cache clean --force \
 && claude --version
COPY --from=build /repo /repo
WORKDIR /repo/apps/api
USER node
CMD ["node", "dist/automation/worker.js"]

# API (dernière étape : cible par défaut de `docker compose build`).
FROM node:22.23.3-alpine AS api
ENV NODE_ENV=production
COPY --from=build /repo /repo
WORKDIR /repo/apps/api
USER node
EXPOSE 4000
CMD ["node", "dist/server.js"]
