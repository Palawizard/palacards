import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export * as schema from "./schema.js";

export function createDb(url: string, options: { max?: number } = {}) {
  const client = postgres(url, { max: options.max ?? 10 });
  const db = drizzle(client, { schema });
  return { db, client };
}

export type Db = ReturnType<typeof createDb>["db"];

// Opérateurs réexportés : l'API les importe d'ici pour partager la même instance de drizzle-orm.
export { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, lte, ne, notInArray, or, sql } from "drizzle-orm";
export type { SQL } from "drizzle-orm";
export { ensureActiveSeason, fillSyntheticCards, migrateDatabase, recreateDatabase } from "./setup.js";
