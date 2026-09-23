import { ensureActiveSeason, fillSyntheticCards, migrateDatabase, recreateDatabase } from "@palacards/db";
import postgres from "postgres";

// Base `palacards_test` recréée et migrée à chaque lancement, sur le Postgres de dev (.env racine).
export default async function setup() {
  try {
    process.loadEnvFile("../../.env");
  } catch {
    // variables déjà dans l'environnement (CI)
  }
  const adminUrl = process.env.DATABASE_URL;
  if (!adminUrl) throw new Error("DATABASE_URL manquant : lance `pnpm db:up` et copie .env.example en .env");
  const url = await recreateDatabase(adminUrl, "palacards_test");
  await migrateDatabase(url);
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  await sql.begin(async (tx) => {
    await fillSyntheticCards(tx, 5_000);
    await tx`select * from finish_card_load(1::smallint)`;
  });
  await ensureActiveSeason(sql, 1);
  await sql.end();
}
