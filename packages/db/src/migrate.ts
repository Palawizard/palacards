import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

// Remplace `drizzle-kit migrate`, qui masque les erreurs de connexion.
// Attend que Postgres soit prêt (utile juste après `pnpm db:up`).

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL manquant : copie .env.example en .env à la racine du repo.");
  process.exit(1);
}

const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));
const RETRYABLE = new Set(["ECONNREFUSED", "ECONNRESET", "57P03"]); // 57P03 = base en cours de démarrage
const MAX_ATTEMPTS = 20;

const target = url.replace(/\/\/([^:@]+):[^@]*@/, "//$1:***@");

for (let attempt = 1; ; attempt++) {
  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(client), { migrationsFolder });
    console.log(`Migrations appliquées sur ${target}`);
    await client.end();
    break;
  } catch (err) {
    await client.end({ timeout: 1 }).catch(() => {});
    const e = err as { code?: string; cause?: { code?: string } };
    const code = e.code ?? e.cause?.code ?? "";
    if (RETRYABLE.has(code) && attempt < MAX_ATTEMPTS) {
      console.log(`Postgres pas encore prêt (${code}), nouvel essai ${attempt}/${MAX_ATTEMPTS - 1}…`);
      await new Promise((r) => setTimeout(r, 1000));
      continue;
    }
    console.error(`Échec des migrations sur ${target}`);
    console.error(err);
    process.exit(1);
  }
}
