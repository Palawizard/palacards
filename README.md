# PalaCards

Jeu de cartes à collectionner où chaque carte est un article du Wikipédia FR (~2,7 M cartes). Paquets, collection, catalogue, marché aux enchères, échanges, amis, messages, guildes, duels quiz, succès, classements et saisons mensuelles. Auto-hébergé, pour jouer entre potes sur `www.palawi.fr/palacards/`.

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
pnpm db:seed           # ~18 000 vraies cartes (échantillon d'import) ou 20 000 synthétiques
pnpm dev
```

- Front : http://localhost:3000/palacards/pulls
- API : http://localhost:4000/palacards/api/health

Pour jouer à plusieurs en local, ouvre un second navigateur (ou une fenêtre privée) et crée un autre compte. Le pseudo listé dans `ADMIN_USERNAMES` (`.env`) a accès à la page Admin.

## Structure

```
apps/web        Next.js 16 (front, basePath /palacards)
apps/api        Fastify 5 + Socket.IO + pg-boss (API temps réel et jobs)
apps/e2e        Parcours Playwright
packages/db     Schéma Drizzle, migrations, seed
packages/game   Règles du jeu (pures, testées) : rareté, paquets, économie, marché, bataille, succès
packages/shared Schémas Zod et types partagés API / front
tools/import    Pipeline Python/DuckDB d'import des dumps Wikipédia
docker/         Dockerfiles et init Postgres
deploy/         Caddy, sauvegarde (timer systemd), restauration, chargement des cartes
```

## Scripts

| Commande | Effet |
| --- | --- |
| `pnpm dev` | Front + API en mode dev |
| `pnpm test` | Vitest (règles du jeu + intégration API sur `palacards_test`) |
| `pnpm e2e` | Playwright (base `palacards_e2e`, ports 3100/4100) |
| `pnpm bench` | Benchmark sur 2,7 M cartes synthétiques (`palacards_bench`) |
| `pnpm typecheck` / `pnpm lint` | TypeScript, ESLint |
| `pnpm build` | Build de production |
| `pnpm db:up` / `pnpm db:down` | Postgres local |
| `pnpm db:generate` / `pnpm db:migrate` | Migrations Drizzle |
| `pnpm db:seed` | Cartes de développement |

La première exécution de `pnpm e2e` demande les navigateurs Playwright : `pnpm --filter @palacards/e2e exec playwright install chromium`.

## Production

`docker compose build && docker compose up -d --wait` avec `docker-compose.yml` (Postgres, migrations, API, front ; healthchecks et limites mémoire). Les cartes se chargent avec `deploy/load-cards.sh`, les sauvegardes quotidiennes avec `deploy/backup.sh` (timer systemd fourni).

## Branches

`main` (stable) ← `dev` (intégration) ← `feat/*`, `fix/*`, `chore/*`.

## Licence des contenus

Les textes et images des cartes proviennent de Wikipédia et Wikimedia Commons (CC BY-SA). Chaque carte crédite et lie son article.
