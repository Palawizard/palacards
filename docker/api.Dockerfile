FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile --filter @palacards/api... \
 && pnpm --filter @palacards/api... build \
 && pnpm deploy --filter @palacards/api --prod --legacy /out

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /out .
EXPOSE 4000
CMD ["node", "dist/server.js"]
