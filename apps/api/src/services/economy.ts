import { and, desc, eq, schema, sql } from "@palacards/db";
import { dailyLoginReward, ECONOMY, MAX_STORED_PACKS, nextLoginStreak, PACK_REGEN_MS, parisDay } from "@palacards/game";
import type { CardDTO } from "@palacards/shared";
import type { Ctx } from "../context.js";
import { notFound } from "../errors.js";
import { articleUrl } from "./wiki.js";
import { Effects } from "./notifications.js";
import { emit } from "./progression.js";
import { activeSeason, lockPlayer, logMovement, movePw, packState, pushWallet } from "./players.js";

export const PACKS_FULL_JOB = "packs-full";

/**
 * Bonus de connexion quotidienne (jour calendaire de Paris) : 20 PW, +5 par jour de série, max 50.
 * Idempotent : un second appel le même jour ne donne rien.
 */
export async function claimDaily(ctx: Ctx, userId: string) {
  const today = parisDay(ctx.now());
  const res = await ctx.db.transaction(async (tx) => {
    const p = await lockPlayer(tx, userId);
    const streak = nextLoginStreak(p.lastLoginDay, today, p.loginStreak);
    if (streak === null) return null;
    const reward = dailyLoginReward(streak);
    await tx
      .update(schema.players)
      .set({ loginStreak: streak, lastLoginDay: today, lastSeenAt: ctx.now() })
      .where(eq(schema.players.userId, userId));
    await movePw(tx, p, reward, "daily_login", today);
    return { reward, streak, player: p };
  });
  if (!res) return { claimed: false as const };
  pushWallet(ctx, res.player);
  void emit(ctx, userId, { type: "login_streak", days: res.streak });
  return { claimed: true as const, reward: res.reward, streak: res.streak };
}

/** Achat d'un paquet bonus (hors plafond de stock) contre des PW. */
export async function buyBonusPack(ctx: Ctx, userId: string) {
  const res = await ctx.db.transaction(async (tx) => {
    const p = await lockPlayer(tx, userId);
    await movePw(tx, p, -ECONOMY.bonusPackPrice, "bonus_pack");
    const bonusPacks = p.bonusPacks + 1;
    await tx.update(schema.players).set({ bonusPacks }).where(eq(schema.players.userId, userId));
    await logMovement(tx, userId, "bonus_pack", 1, bonusPacks, "bonus_pack");
    return { ...p, bonusPacks };
  });
  pushWallet(ctx, res);
  const packs = packState(res, ctx.now());
  ctx.rt.toUser(userId, "packs:update", packs);
  return { packs };
}

/** Programme la notification « stock plein » au moment où le minuteur remplira le stock. */
export async function schedulePacksFull(ctx: Ctx, userId: string, stored: number, updatedAt: Date) {
  if (stored >= MAX_STORED_PACKS) return;
  const fullAt = new Date(updatedAt.getTime() + (MAX_STORED_PACKS - stored) * PACK_REGEN_MS);
  await ctx.jobs.sendAt(PACKS_FULL_JOB, { userId, fullAt: fullAt.toISOString() }, fullAt);
}

/** Job : prévient si le stock est bien plein à l'heure prévue (sinon un paquet a été ouvert entre-temps). */
export async function notifyPacksFull(ctx: Ctx, userId: string, fullAt: string) {
  const [p] = await ctx.db.select().from(schema.players).where(eq(schema.players.userId, userId));
  if (!p) return;
  const expected = new Date(p.packsUpdatedAt.getTime() + (MAX_STORED_PACKS - p.packsStored) * PACK_REGEN_MS);
  if (p.packsStored >= MAX_STORED_PACKS || Math.abs(expected.getTime() - new Date(fullAt).getTime()) > 1000) return;
  const fx = new Effects();
  await fx.notify(ctx.db, userId, "packs_full", { max: MAX_STORED_PACKS });
  await fx.flush(ctx);
}

// ---------------------------------------------------------------------------
// Wishlist
// ---------------------------------------------------------------------------

export async function setWishlist(ctx: Ctx, userId: string, cardId: number, wanted: boolean) {
  if (wanted) {
    const [exists] = await ctx.db
      .select({ id: schema.cards.id })
      .from(schema.cards)
      .where(eq(schema.cards.id, cardId))
      .limit(1);
    if (!exists) throw notFound("Cette carte n'existe pas.");
    await ctx.db.insert(schema.wishlist).values({ userId, cardId }).onConflictDoNothing();
  } else {
    await ctx.db
      .delete(schema.wishlist)
      .where(and(eq(schema.wishlist.userId, userId), eq(schema.wishlist.cardId, cardId)));
  }
  return { wishlisted: wanted };
}

export async function listWishlist(ctx: Ctx, userId: string): Promise<(CardDTO & { onSale: number | null })[]> {
  const season = await activeSeason(ctx.db);
  const rows = await ctx.db.execute<{
    card_id: string;
    season: number;
    title: string;
    rarity: CardDTO["rarity"];
    atk: number;
    def: number;
    views_12m: string;
    thumb_url: string | null;
    page_url: string | null;
    auction_id: string | null;
    owned: boolean;
  }>(sql`
    select distinct on (w.card_id) w.card_id, c.season, c.title, c.rarity, c.atk, c.def, c.views_12m,
           s.thumb_url, s.page_url,
           (select a.id from auctions a where a.card_id = w.card_id and a.status = 'open' order by a.ends_at limit 1) as auction_id,
           exists (select 1 from card_instances o where o.owner_id = ${userId} and o.card_id = w.card_id) as owned
    from wishlist w
    join cards c on c.id = w.card_id
    left join wiki_summaries s on s.page_id = w.card_id
    where w.user_id = ${userId}
    order by w.card_id, (c.season = ${season}) desc, c.season desc
  `);
  return rows.map((r) => ({
    instanceId: null,
    cardId: Number(r.card_id),
    season: r.season,
    title: r.title,
    rarity: r.rarity,
    atk: r.atk,
    def: r.def,
    level: 1,
    views12m: Number(r.views_12m),
    thumbUrl: r.thumb_url,
    pageUrl: r.page_url ?? articleUrl(r.title),
    owned: r.owned,
    onSale: r.auction_id ? Number(r.auction_id) : null,
  }));
}

/** Historique du grand livre du joueur (page Paramètres / portefeuille). */
export async function ledgerHistory(ctx: Ctx, userId: string, limit = 50) {
  return ctx.db
    .select()
    .from(schema.ledger)
    .where(and(eq(schema.ledger.userId, userId), eq(schema.ledger.kind, "pw")))
    .orderBy(desc(schema.ledger.id))
    .limit(limit);
}
