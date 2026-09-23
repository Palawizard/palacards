# PalaCards

Jeu de cartes à collectionner où chaque carte est un article du Wikipédia FR. Paquets, collection, marché aux enchères, échanges, guildes, duels quiz. Auto-hébergé, pour jouer entre potes sur `www.palawi.fr/palacards/`.

## Prérequis

- Node.js 22 (`.nvmrc`)
- pnpm 10 : `npm install -g pnpm@10.28.0` (sous Windows, `corepack enable` demande les droits admin)
- Docker Desktop lancé (Postgres local, exposé sur le port 5433)
- Python 3.11+ (pipeline d'import, `tools/import`)

## Démarrer

```sh
npm install -g pnpm@10.28.0
pnpm install
cp .env.example .env   # Windows : copy .env.example .env
pnpm db:up
pnpm db:migrate
pnpm dev
```

- Front : http://localhost:3000/palacards/pulls
- API : http://localhost:4000/palacards/api/health

## Structure

```
apps/web        Next.js (front)
apps/api        Fastify + Socket.IO (API temps réel)
packages/db     Schéma Drizzle + migrations
packages/game   Règles du jeu (pures, testées)
tools/import    Pipeline Python/DuckDB d'import Wikipédia
docker/         Dockerfiles et init Postgres
```

## Scripts

| Commande                               | Effet                   |
| -------------------------------------- | ----------------------- |
| `pnpm dev`                             | Front + API en mode dev |
| `pnpm test`                            | Tests Vitest            |
| `pnpm typecheck`                       | Vérification TypeScript |
| `pnpm build`                           | Build de production     |
| `pnpm db:up` / `pnpm db:down`          | Postgres local          |
| `pnpm db:generate` / `pnpm db:migrate` | Migrations Drizzle      |

## Branches

`main` (stable) ← `dev` (intégration) ← `feat/*`, `fix/*`, `chore/*`.

## Licence des contenus

Les textes et images des cartes proviennent de Wikipédia et Wikimedia Commons (CC BY-SA). Chaque carte crédite et lie son article.
