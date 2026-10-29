FROM node:22.23.3-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
ENV NEXT_PUBLIC_API_URL=""
# Chemin et adresse publics, figés dans le build (production : racine de palacards.fr, voir docker-compose.yml).
ARG NEXT_PUBLIC_BASE_PATH=/palacards
ARG NEXT_PUBLIC_SITE_URL=https://palacards.fr/palacards
ENV NEXT_PUBLIC_BASE_PATH=$NEXT_PUBLIC_BASE_PATH NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
RUN pnpm install --frozen-lockfile --filter @palacards/web... \
 && pnpm --filter @palacards/web... build

FROM node:22.23.3-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
