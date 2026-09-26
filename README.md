# PalaCards

Jeu de cartes à collectionner où chaque carte est un article du Wikipédia FR (~2,7 M cartes). Paquets, collection, catalogue, marché aux enchères, échanges, amis, messages, guildes, duels quiz, succès, classements et saisons mensuelles. Auto-hébergé, pour jouer entre potes sur `palawi.fr/palacards/`.

## Prérequis

- Node.js 22 (`.nvmrc`)
- pnpm 10 : `npm install -g pnpm@10.28.0` (sous Windows, `corepack enable` demande les droits admin)
- Docker Desktop lancé (Postgres local, exposé sur `127.0.0.1:5433`)
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

Pour jouer à plusieurs en local, ouvre un second navigateur (ou une fenêtre privée) et crée un autre compte. Pseudo : 3 à 20 caractères, lettres sans accent, chiffres, `_` et `.` uniquement (pas d'espace ni de `-`). Pour accéder à la page Admin, donne-toi le rôle : `pnpm --filter @palacards/api admin:grant <pseudo>` (en prod : `docker compose exec api node dist/cli/admin.js grant <pseudo>`).

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

| Commande                               | Effet                                                         |
| -------------------------------------- | ------------------------------------------------------------- |
| `pnpm dev`                             | Front + API en mode dev                                       |
| `pnpm test`                            | Vitest (règles du jeu + intégration API sur `palacards_test`) |
| `pnpm e2e`                             | Playwright (base `palacards_e2e`, ports 3100/4100)            |
| `pnpm bench`                           | Benchmark sur 2,7 M cartes synthétiques (`palacards_bench`)   |
| `pnpm typecheck` / `pnpm lint`         | TypeScript, ESLint                                            |
| `pnpm build`                           | Build de production                                           |
| `pnpm db:up` / `pnpm db:down`          | Postgres local                                                |
| `pnpm db:generate` / `pnpm db:migrate` | Migrations Drizzle                                            |
| `pnpm db:seed`                         | Cartes de développement                                       |

La première exécution de `pnpm e2e` demande les navigateurs Playwright : `pnpm --filter @palacards/e2e exec playwright install chromium`.

`pnpm typecheck` et `pnpm test` construisent d'abord `packages/*` (comme `pnpm dev`) : ils marchent sur un clone neuf.

## Import des cartes (`tools/import`)

```sh
cd tools/import
python -m venv .venv && . .venv/bin/activate   # Windows : .venv\Scripts\activate
pip install -e ".[dev]"                        # installation éditable : données dans tools/import/data/
palacards-import all --limit 20000             # échantillon (lu en flux), repris par `pnpm db:seed`
pytest -q
```

Installer en mode éditable (`-e`) : les données vont alors dans `tools/import/data/` et le `.env` racine est lu. Variables (environnement ou `.env`) : `PALACARDS_DATA` pour mettre les dumps et intermédiaires (plusieurs dizaines de Go pour un import complet) ailleurs, `PALACARDS_ENV_FILE` pour lire un autre fichier `.env`, `WIKIMEDIA_USER_AGENT` (obligatoire). Hors dépôt, sans `PALACARDS_DATA`, les données vont dans `./data` du dossier courant.

## Production

Sur vm-apps, dans `/opt/dockpanel/stacks/palacards/` (`docker-compose.yml` : Postgres, migrations, API, front ; healthchecks et limites mémoire) :

```sh
docker compose build
docker compose run --rm migrate                         # migrations (service one-shot)
docker compose up -d --wait --no-deps postgres api web  # `up --wait` échoue sur le conteneur migrate terminé
```

- `.env` : `POSTGRES_PASSWORD` doit pouvoir figurer tel quel dans une URL, car `docker-compose.yml` en construit `DATABASE_URL` (pas de `@ : / ? # %`…) : `openssl rand -hex 32`.
- Caddy (déjà en Docker sur vm-apps, derrière Cloudflare Tunnel) : snippet `deploy/Caddyfile.palacards`, importé dans le site `palawi.fr` (`www.palawi.fr` redirige vers l'apex). Sur vm-apps, seul le Caddyfile est monté dans le conteneur : le snippet y est collé, et le fichier s'édite en place (pas de `sed -i` ni de `mv`, voir l'en-tête du snippet).
- Connexion : en production, les comptes sont ceux d'Authentik (`auth.palawi.fr`, connexion unique de palawi.fr). `AUTHENTIK_ISSUER`, `AUTHENTIK_CLIENT_ID` et `AUTHENTIK_CLIENT_SECRET` dans le `.env` activent le bouton Authentik et coupent les routes mot de passe (inscription, connexion, changement). URL de retour déclarée dans Authentik : `https://palawi.fr/palacards/api/auth/callback/authentik`. Avec `AUTHENTIK_ENROLLMENT_URL` (page d'inscription, même hôte), « Créer mon compte » ouvre directement l'inscription puis revient connecté. Un joueur est retrouvé par son identifiant Authentik (table `account`, fournisseur `authentik`), jamais par son email. Sans ces variables (dev, CI, E2E), pseudo + mot de passe comme avant.
- Réseau Docker partagé avec Caddy : `CADDY_NETWORK` dans le `.env` (`caddy` par défaut, `web` sur vm-apps).
- Cartes : `deploy/load-cards.sh` ; sauvegardes quotidiennes : `deploy/backup.sh` (timer systemd fourni) ; restauration : `deploy/restore.sh` (recharge aussi la saison suivante déjà importée ; avec `PG_CONTAINER=<postgres de test>`, test de restauration sans arrêter l'API ni le front de prod).

## CI

`.github/workflows/ci.yml` (push et PR vers `dev` et `main`) : build, typecheck, lint, tests Vitest et Playwright sur un Postgres 17 de service, plus `pytest` du pipeline d'import, et `pnpm format:check` (Prettier).

## Branches

`main` (stable, déployée) ← `dev` (intégration) ← `feat/*`, `fix/*`, `chore/*`.

La prod suit `main` : sur vm-apps, un timer systemd vérifie toutes les 5 minutes si `main` a avancé et déploie le nouveau commit une fois sa CI verte (sauvegarde avant, retour aux images précédentes si le contrôle de santé échoue). `dev` n'est jamais déployée.

## Licence des contenus

Les textes et images des cartes proviennent de Wikipédia et Wikimedia Commons (CC BY-SA). Chaque carte crédite et lie son article.
