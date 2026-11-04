import { eq, schema, sql } from "@palacards/db";
import { CASE_TIERS, type CaseTier } from "@palacards/game";
import type { Ctx } from "../context.js";
import { logMovement, type DbOrTx } from "./players.js";

type Tx = Parameters<Parameters<Ctx["db"]["transaction"]>[0]>[0];
const fc = schema.playerFreeCases;

export async function freeCases(db: DbOrTx, userId: string): Promise<Record<CaseTier, number>> {
  const rows = await db.select({ tier: fc.tier, count: fc.count }).from(fc).where(eq(fc.userId, userId));
  const out = Object.fromEntries(CASE_TIERS.map((t) => [t, 0])) as Record<CaseTier, number>;
  for (const r of rows) out[r.tier] = r.count;
  return out;
}

/** Caisses gratuites gagnées (roues, passe) : un compteur par niveau. */
export async function addFreeCases(
  tx: Tx,
  userId: string,
  tier: CaseTier,
  count: number,
  reason: "wheel" | "season_pass",
  ref: string,
) {
  if (count <= 0) return;
  const [row] = await tx
    .insert(fc)
    .values({ userId, tier, count })
    .onConflictDoUpdate({ target: [fc.userId, fc.tier], set: { count: sql`${fc.count} + ${count}` } })
    .returning({ count: fc.count });
  await logMovement(tx, userId, "free_case", count, row!.count, reason, `${ref}:${tier}`);
}
