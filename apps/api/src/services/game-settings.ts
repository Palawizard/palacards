import { eq, schema, sql } from "@palacards/db";
import { DAILY_LOGIN_LAUNCH, DAILY_LOGIN_MAX_PW, ECONOMY, type DailyLoginRates } from "@palacards/game";
import type { AdminDailyLoginDTO } from "@palacards/shared";
import { z } from "zod";
import type { Ctx } from "../context.js";
import type { DbOrTx } from "./players.js";

/** Clé du réglage du bonus de connexion quotidienne dans `game_settings`. */
const DAILY_LOGIN_KEY = "daily_login";

const pw = z.number().int().min(0).max(DAILY_LOGIN_MAX_PW);

/** Montants du bonus de connexion saisis dans la page Admin. */
export const dailyLoginRatesSchema = z
  .object({ base: pw.min(1), perStreakDay: pw, max: pw.min(1) })
  .refine((r) => r.max >= r.base, {
    message: "Le plafond doit être au moins égal au bonus du premier jour",
    path: ["max"],
  });

async function readDailyLogin(db: DbOrTx) {
  const [row] = await db.select().from(schema.gameSettings).where(eq(schema.gameSettings.key, DAILY_LOGIN_KEY));
  // Valeur illisible (réglage d'une ancienne version, par exemple) : les montants par défaut.
  const parsed = row ? dailyLoginRatesSchema.safeParse(row.value) : null;
  return {
    rates: parsed?.success ? parsed.data : ECONOMY.dailyLogin,
    updatedAt: parsed?.success ? row!.updatedAt : null,
  };
}

/** Montants du bonus de connexion en vigueur : le réglage de la page Admin, sinon ceux du code. */
export async function dailyLoginRates(db: DbOrTx): Promise<DailyLoginRates> {
  return (await readDailyLogin(db)).rates;
}

export async function adminDailyLogin(ctx: Ctx): Promise<AdminDailyLoginDTO> {
  const { rates, updatedAt } = await readDailyLogin(ctx.db);
  return {
    rates: { ...rates },
    defaults: { ...ECONOMY.dailyLogin },
    launch: DAILY_LOGIN_LAUNCH,
    updatedAt: updatedAt?.toISOString() ?? null,
  };
}

/** Nouveaux montants, appliqués dès la prochaine connexion quotidienne (rien de rétroactif). */
export async function setDailyLogin(ctx: Ctx, adminId: string, rates: DailyLoginRates) {
  await ctx.db
    .insert(schema.gameSettings)
    .values({ key: DAILY_LOGIN_KEY, value: rates, updatedBy: adminId })
    .onConflictDoUpdate({
      target: schema.gameSettings.key,
      set: { value: rates, updatedBy: adminId, updatedAt: sql`now()` },
    });
  return adminDailyLogin(ctx);
}
