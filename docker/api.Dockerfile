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

FROM node:22.23.3-alpine
ENV NODE_ENV=production
COPY --from=build /repo /repo
WORKDIR /repo/apps/api
EXPOSE 4000
CMD ["node", "dist/server.js"]
