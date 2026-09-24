/**
 * Benchmark (`pnpm bench`) : base `palacards_bench` avec 2,7 M cartes synthétiques
 * (generate_series, mêmes paliers que l'import complet), puis mesure côté serveur :
 * - ouverture d'un paquet (transaction complète, 5 tirages indexés) : objectif < 50 ms ;
 * - recherche floue dans le catalogue : objectif < 150 ms.
 * La base n'est recréée que si elle n'a pas encore ses cartes (BENCH_RESET=1 pour forcer).
 */
import { eq, ensureActiveSeason, fillSyntheticCards, migrateDatabase, recreateDatabase, schema } from "@palacards/db";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { Ctx } from "../src/context.js";
import { catalog } from "../src/services/cards.js";
import { openPack } from "../src/services/packs.js";

const CARDS = 2_700_000;

try {
  process.loadEnvFile("../../.env");
} catch {
  // variables déjà présentes
}
const adminUrl = process.env.DATABASE_URL;
if (!adminUrl) throw new Error("DATABASE_URL manquant (pnpm db:up + .env)");
const benchUrl = new URL(adminUrl);
benchUrl.pathname = "/palacards_bench";

async function prepare() {
  const probe = postgres(adminUrl!, { max: 1, onnotice: () => {} });
  const [exists] = await probe`select 1 from pg_database where datname = 'palacards_bench'`;
  await probe.end();
  if (exists && !process.env.BENCH_RESET) {
    const sql = postgres(benchUrl.toString(), { max: 1, onnotice: () => {} });
    const [n] = await sql<{ n: number }[]>`select count(*)::int as n from cards`;
    await sql.end();
    if ((n?.n ?? 0) >= CARDS) {
      console.log(`Base palacards_bench déjà prête (${n!.n.toLocaleString("fr-FR")} cartes).`);
      return;
    }
  }
  console.log("Création de palacards_bench et de 2,7 M cartes synthétiques (quelques minutes)…");
  const url = await recreateDatabase(adminUrl!, "palacards_bench");
  await migrateDatabase(url);
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  const t0 = performance.now();
  await sql.begin(async (tx) => {
    await tx`set local maintenance_work_mem = '512MB'`;
    await fillSyntheticCards(tx, CARDS, { variedTitles: true });
    await tx`select * from finish_card_load(1::smallint)`;
  });
  await ensureActiveSeason(sql, 1);
  await sql`vacuum analyze cards`;
  console.log(`Cartes chargées en ${Math.round((performance.now() - t0) / 1000)} s.`);
  await sql.end();
}

const stats = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const at = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
  return { p50: at(0.5), p95: at(0.95), max: s[s.length - 1]! };
};
const ms = (n: number) => `${n.toFixed(1)} ms`;

await prepare();
const config = loadConfig({ ...process.env, DATABASE_URL: benchUrl.toString(), WIKIMEDIA_DISABLED: "1", LOG_LEVEL: "error", NODE_ENV: "test" });
const { app, ctx } = await buildApp(config);
await app.ready();
const c = ctx as Ctx;

const signUp = await app.inject({
  method: "POST",
  url: "/palacards/api/auth/sign-up/email",
  headers: { origin: config.WEB_ORIGIN },
  payload: { username: `bench${Date.now().toString(36)}`, password: "motdepasse123" },
});
const userId = (JSON.parse(signUp.body) as { user: { id: string } }).user.id;
await (await import("../src/auth.js")).ensurePlayer(c.db, userId);

// Ouverture de paquets : on remet du stock bonus pour enchaîner les mesures.
await c.db.update(schema.players).set({ bonusPacks: 1_000 }).where(eq(schema.players.userId, userId));
for (let i = 0; i < 5; i++) await openPack(c, userId); // échauffement (plans en cache)
const packTimes: number[] = [];
for (let i = 0; i < 100; i++) {
  const t = performance.now();
  await openPack(c, userId);
  packTimes.push(performance.now() - t);
}

// Recherche floue sans accents et navigation paginée.
// Requêtes réalistes : mot très fréquent, expression, sans accents, faute de frappe, préfixe, titre exact.
const queries = ["chateau", "bataille de paris", "eglise saint-martin", "revolution", "musée de lyon", "chatteau", "cathéd", "Opéra Rouge de Nantes 1234567"];
const searchTimes: number[] = [];
const perQuery = new Map<string, number[]>();
for (const q of queries) await catalog(c, userId, { q, sort: "views", limit: 48 });
for (let round = 0; round < 5; round++) {
  for (const q of queries) {
    const t = performance.now();
    await catalog(c, userId, { q, sort: "views", limit: 48 });
    const d = performance.now() - t;
    searchTimes.push(d);
    perQuery.set(q, [...(perQuery.get(q) ?? []), d]);
  }
}
const browseTimes: number[] = [];
let cursor: string | undefined;
for (let i = 0; i < 20; i++) {
  const t = performance.now();
  const page = await catalog(c, userId, { sort: "atk", limit: 48, cursor, rarity: ["C", "PC"] });
  browseTimes.push(performance.now() - t);
  cursor = page.nextCursor ?? undefined;
}

const pack = stats(packTimes);
const search = stats(searchTimes);
const browse = stats(browseTimes);
console.log("\nRésultats (temps serveur, base de 2,7 M cartes) :");
console.log(`  Ouverture de paquet : p50 ${ms(pack.p50)} · p95 ${ms(pack.p95)} · max ${ms(pack.max)}  (objectif < 50 ms)`);
console.log(`  Recherche catalogue : p50 ${ms(search.p50)} · p95 ${ms(search.p95)} · max ${ms(search.max)}  (objectif < 150 ms)`);
console.log(`  Catalogue paginé    : p50 ${ms(browse.p50)} · p95 ${ms(browse.p95)} · max ${ms(browse.max)}`);
for (const [q, times] of perQuery) console.log(`    « ${q} » : p50 ${ms(stats(times).p50)}`);
await app.close();
const ok = pack.p95 < 50 && search.p95 < 150;
console.log(ok ? "\nObjectifs atteints." : "\nObjectifs NON atteints.");
process.exitCode = ok ? 0 : 1;
