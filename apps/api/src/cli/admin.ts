/**
 * CLI du rôle admin (le rôle est en base, jamais déduit du pseudo) :
 *   dev  : pnpm --filter @palacards/api admin:grant <pseudo>   (admin:revoke, admin:list)
 *   prod : docker compose exec api node dist/cli/admin.js grant <pseudo>
 * Lit DATABASE_URL dans l'environnement.
 */
import { createDb } from "@palacards/db";
import { adminCommand } from "../services/roles.js";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL manquant.");
  process.exit(2);
}
const { db, client } = createDb(url, { max: 1 });
try {
  const { code, message } = await adminCommand(db, process.argv.slice(2));
  (code === 0 ? console.log : console.error)(message);
  process.exitCode = code;
} catch (err) {
  console.error("Échec :", err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await client.end({ timeout: 5 });
}
