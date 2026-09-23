// Préparation des E2E (avant `playwright test`, qui lance ensuite les serveurs) :
// base palacards_e2e neuve (migrée, 3 000 cartes synthétiques, saison 1), builds des packages,
// de l'API et du front (dans .next-e2e, pointant sur l'API de test).
import { execSync } from "node:child_process";
import postgres from "postgres";

const root = new URL("../..", import.meta.url);
const run = (cmd, env = {}) => execSync(cmd, { cwd: root, stdio: "inherit", env: { ...process.env, ...env } });

try {
  process.loadEnvFile(new URL("../../.env", import.meta.url));
} catch {
  // CI : variables déjà présentes
}
const adminUrl = process.env.DATABASE_URL;
if (!adminUrl) throw new Error("DATABASE_URL manquant (pnpm db:up + .env)");

run("pnpm --filter ./packages/* build");
const { ensureActiveSeason, fillSyntheticCards, migrateDatabase, recreateDatabase } = await import("@palacards/db");
const url = await recreateDatabase(adminUrl, "palacards_e2e");
await migrateDatabase(url);
const sql = postgres(url, { max: 1, onnotice: () => {} });
await sql.begin(async (tx) => {
  await fillSyntheticCards(tx, 3_000);
  await tx`select * from finish_card_load(1::smallint)`;
});
await ensureActiveSeason(sql, 1);
await sql.end();
console.log(`Base E2E prête : ${url.replace(/:[^:@/]+@/, ":***@")}`);

run("pnpm --filter @palacards/api build");
if (!process.env.E2E_SKIP_WEB_BUILD) {
  run("pnpm --filter @palacards/web exec next build", {
    NEXT_DIST_DIR: ".next-e2e",
    NEXT_PUBLIC_API_URL: "http://localhost:4100",
  });
}
