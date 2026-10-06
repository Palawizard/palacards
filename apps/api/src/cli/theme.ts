/**
 * CLI des boosters à thème (mêmes règles que la page Admin) :
 *   dev  : pnpm --filter @palacards/api theme:create -- --name "Voix françaises" --category "Chanteur français" …
 *   prod : docker compose exec api node dist/cli/theme.js create --name … [--dry-run]
 *
 * Options : --name, --category (répétable), --depth 0|1|2, --title (répétable), --titles-file <fichier>,
 * --description, --price, --no-legendary (aucune carte légendaire), --days (durée depuis maintenant, 7 par défaut), --starts / --ends (ISO),
 * --by <pseudo admin> (auteur, facultatif), --dry-run (compte les articles par rareté sans rien créer).
 * Lit DATABASE_URL et WIKIMEDIA_USER_AGENT dans l'environnement.
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { createDb, eq, schema } from "@palacards/db";
import { ECONOMY, RARITIES } from "@palacards/game";
import type { FastifyBaseLogger } from "fastify";
import { loadConfig } from "../config.js";
import type { Ctx } from "../context.js";
import { createTheme } from "../services/themes.js";
import { createWiki } from "../services/wiki.js";

const { positionals, values: v } = parseArgs({
  allowPositionals: true,
  options: {
    name: { type: "string" },
    category: { type: "string", multiple: true, default: [] },
    depth: { type: "string", default: "1" },
    title: { type: "string", multiple: true, default: [] },
    "titles-file": { type: "string" },
    description: { type: "string" },
    price: { type: "string", default: String(ECONOMY.themePackPrice) },
    "no-legendary": { type: "boolean", default: false },
    days: { type: "string", default: "7" },
    starts: { type: "string" },
    ends: { type: "string" },
    by: { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
});

if (positionals[0] !== "create" || !v.name) {
  console.error(
    "Usage : theme.js create --name <nom> [--category <catégorie>]… [--dry-run] (voir l'en-tête du fichier)",
  );
  process.exit(2);
}

const config = loadConfig();
if (!config.DATABASE_URL) {
  console.error("DATABASE_URL manquant.");
  process.exit(2);
}

/** Journal minimal pour le terminal (les erreurs gardent leur message). */
const say = (level: string) => (obj: unknown, msg?: string) =>
  console.error(
    `[${level}]`,
    msg ?? "",
    JSON.stringify(obj, (_k, val: unknown) => (val instanceof Error ? val.message : val)),
  );
const log = {
  info: () => {},
  debug: () => {},
  trace: () => {},
  warn: say("warn"),
  error: say("erreur"),
  fatal: say("erreur"),
  child: () => log,
} as unknown as FastifyBaseLogger;

const { db, client } = createDb(config.DATABASE_URL, { max: 2 });
try {
  const titles = [...v.title, ...(v["titles-file"] ? readFileSync(v["titles-file"], "utf8").split("\n") : [])]
    .map((t) => t.trim())
    .filter(Boolean);
  let adminId = "cli";
  if (v.by) {
    const [u] = await db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.username, v.by));
    if (!u) throw new Error(`Pseudo inconnu : ${v.by}`);
    adminId = u.id;
  }
  const startsAt = v.starts ? new Date(v.starts) : new Date();
  const endsAt = v.ends ? new Date(v.ends) : new Date(startsAt.getTime() + Number(v.days) * 86_400_000);
  const ctx = { db, log, config, wiki: createWiki(db, config, log), now: () => new Date() } as unknown as Ctx;
  const res = await createTheme(ctx, adminId, {
    name: v.name,
    description: v.description,
    categories: v.category,
    depth: Math.min(2, Math.max(0, Number(v.depth))),
    titles,
    price: Number(v.price),
    noLegendary: v["no-legendary"],
    startsAt,
    endsAt,
    dryRun: v["dry-run"],
  });
  console.log(
    `${res.dryRun ? "Essai à blanc (rien n'est créé)" : `Booster n° ${res.id} créé`} : « ${res.name} », ${res.cardCount} articles` +
      ` (${RARITIES.map((r) => `${r} ${res.byRarity[r]}`).join(", ")}), du ${startsAt.toISOString()} au ${endsAt.toISOString()}.`,
  );
} catch (err) {
  console.error("Échec :", err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await client.end({ timeout: 5 });
}
