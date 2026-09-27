import { desc, eq, schema, sql } from "@palacards/db";
import type { Ctx } from "../context.js";
import { badRequest, conflict, notFound } from "../errors.js";
import { afterCommit } from "./notifications.js";
import { lockPlayer, logMovement, movePw, packState, pushWallet } from "./players.js";
import { addThemePacks, getTheme } from "./themes.js";

/** Codes en majuscules : lettres sans accent, chiffres, `-` et `_`, de 3 à 32 caractères. */
export const CODE_PATTERN = /^[A-Z0-9_-]{3,32}$/;
export const normalizeCode = (code: string) => code.trim().toUpperCase();

export interface CodeInput {
  code: string;
  pw: number;
  packs: number;
  themeId: number | null;
  themePacks: number;
  maxUses: number | null;
  expiresAt: Date | null;
}

export async function createCode(ctx: Ctx, adminId: string, input: CodeInput) {
  const code = normalizeCode(input.code);
  if (!CODE_PATTERN.test(code))
    throw badRequest("invalid_code", "Code : 3 à 32 caractères, lettres sans accent, chiffres, - et _.");
  if (!input.pw && !input.packs && !input.themePacks) throw badRequest("empty", "Ce code ne donne rien.");
  if (input.themePacks && !input.themeId) throw badRequest("theme_required", "Choisis le thème des boosters.");
  if (input.themeId) await getTheme(ctx.db, input.themeId);
  const [row] = await ctx.db
    .insert(schema.promoCodes)
    .values({ ...input, themeId: input.themePacks ? input.themeId : null, code, createdBy: adminId })
    .onConflictDoNothing()
    .returning();
  if (!row) throw conflict("code_taken", "Ce code existe déjà.");
  return row;
}

export async function setCodeDisabled(ctx: Ctx, code: string, disabled: boolean) {
  const [row] = await ctx.db
    .update(schema.promoCodes)
    .set({ disabled })
    .where(eq(schema.promoCodes.code, normalizeCode(code)))
    .returning({ code: schema.promoCodes.code });
  if (!row) throw notFound("Ce code n'existe pas.");
}

export async function listCodes(ctx: Ctx) {
  const rows = await ctx.db
    .select({
      code: schema.promoCodes.code,
      pw: schema.promoCodes.pw,
      packs: schema.promoCodes.packs,
      themeId: schema.promoCodes.themeId,
      themeName: schema.themes.name,
      themePacks: schema.promoCodes.themePacks,
      maxUses: schema.promoCodes.maxUses,
      uses: schema.promoCodes.uses,
      expiresAt: schema.promoCodes.expiresAt,
      disabled: schema.promoCodes.disabled,
      createdAt: schema.promoCodes.createdAt,
    })
    .from(schema.promoCodes)
    .leftJoin(schema.themes, eq(schema.themes.id, schema.promoCodes.themeId))
    .orderBy(desc(schema.promoCodes.createdAt))
    .limit(100);
  return rows.map((r) => ({
    ...r,
    expiresAt: r.expiresAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}

/**
 * Utilise un code promo : une fois par joueur, dans la limite d'utilisations et avant l'expiration.
 * Une transaction : code verrouillé (compteur d'utilisations), joueur verrouillé, ledger de chaque gain.
 * Même message pour un code inconnu, désactivé ou expiré : on ne confirme pas l'existence d'un code.
 */
export async function redeemCode(ctx: Ctx, userId: string, raw: string) {
  const code = normalizeCode(raw);
  const invalid = () => notFound("Ce code n'existe pas ou n'est plus valable.");
  if (!CODE_PATTERN.test(code)) throw invalid();
  const now = ctx.now();
  const res = await ctx.db.transaction(async (tx) => {
    const [c] = await tx.select().from(schema.promoCodes).where(eq(schema.promoCodes.code, code)).for("update");
    if (!c || c.disabled || (c.expiresAt && c.expiresAt <= now)) throw invalid();
    const [used] = await tx.execute<{ n: number }>(
      sql`select 1 as n from promo_redemptions where code = ${code} and user_id = ${userId}`,
    );
    if (used) throw conflict("code_used", "Tu as déjà utilisé ce code.");
    if (c.maxUses !== null && c.uses >= c.maxUses)
      throw conflict("code_exhausted", "Ce code a atteint son nombre d'utilisations.");

    await tx.insert(schema.promoRedemptions).values({ code, userId });
    await tx
      .update(schema.promoCodes)
      .set({ uses: sql`${schema.promoCodes.uses} + 1` })
      .where(eq(schema.promoCodes.code, code));
    const p = await lockPlayer(tx, userId);
    const ref = `code:${code}`;
    if (c.pw) await movePw(tx, p, c.pw, "promo_code", ref);
    if (c.packs) {
      const bonusPacks = p.bonusPacks + c.packs;
      await tx.update(schema.players).set({ bonusPacks }).where(eq(schema.players.userId, userId));
      await logMovement(tx, userId, "bonus_pack", c.packs, bonusPacks, "promo_code", ref);
      p.bonusPacks = bonusPacks;
    }
    let theme: { id: number; name: string } | null = null;
    if (c.themePacks && c.themeId) {
      const t = await getTheme(tx, c.themeId);
      await addThemePacks(tx, userId, t.id, c.themePacks, "promo_code", ref);
      theme = { id: t.id, name: t.name };
    }
    return { code: c, theme, player: p };
  });
  await afterCommit(ctx, async () => {
    pushWallet(ctx, res.player);
    ctx.rt.toUser(userId, "packs:update", packState(res.player, now));
  });
  return {
    pw: res.code.pw,
    packs: res.code.packs,
    themePacks: res.theme ? res.code.themePacks : 0,
    theme: res.theme,
  };
}
