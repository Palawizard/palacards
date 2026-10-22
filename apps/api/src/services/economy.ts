import { and, desc, eq, schema, sql } from "@palacards/db";
import { dailyLoginReward, ECONOMY, MAX_STORED_PACKS, nextLoginStreak, PACK_REGEN_MS, parisDay } from "@palacards/game";
import type { CardDTO } from "@palacards/shared";
import type { Ctx } from "../context.js";
import { notFound } from "../errors.js";
import { dailyLoginRates } from "./game-settings.js";
import { articleUrl } from "./wiki.js";
import { Effects } from "./notifications.js";
import { emit } from "./progression.js";
import { activeSeason, lockPlayer, logMovement, movePw, packState, pushWallet } from "./players.js";

export const PACKS_FULL_JOB = "packs-full";

/**
 * Bonus de connexion quotidienne (jour calendaire de Paris) : base, + par jour de série, plafond
 * (réglables dans la page Admin, 30 PW, +8, max 75 par défaut).
 * Idempotent : un second appel le même jour ne donne rien.
 */
export async function claimDaily(ctx: Ctx, userId: string) {
  const today = parisDay(ctx.now());
  const res = await ctx.db.transaction(async (tx) => {
    const p = await lockPlayer(tx, userId);
    const streak = nextLoginStreak(p.lastLoginDay, today, p.loginStreak);
    if (streak === null) return null;
    const reward = dailyLoginReward(streak, await dailyLoginRates(tx));
    await tx
      .update(schema.players)
      .set({ loginStreak: streak, lastLoginDay: today, lastSeenAt: ctx.now() })
      .where(eq(schema.players.userId, userId));
    await movePw(tx, p, reward, "daily_login", today);
    return { reward, streak, player: p };
  });
  if (!res) return { claimed: false as const };
  pushWallet(ctx, res.player);
  void emit(ctx, userId, { type: "daily_login" }, { type: "login_streak", days: res.streak });
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

/**
 * Programme la notification « stock plein » au moment où le minuteur remplira le stock. À n'appeler que quand
 * le stock gratuit change : un paquet bonus ou un booster à thème laisse l'échéance identique, et chaque
 * ouverture programmait un job de plus pour la même heure (7 notifications d'un coup, suggestion n° 106).
 */
export async function schedulePacksFull(ctx: Ctx, userId: string, stored: number, updatedAt: Date) {
  if (stored >= MAX_STORED_PACKS) return;
  const fullAt = new Date(updatedAt.getTime() + (MAX_STORED_PACKS - stored) * PACK_REGEN_MS);
  await ctx.jobs.sendAt(PACKS_FULL_JOB, { userId, fullAt: fullAt.toISOString() }, fullAt);
}

/**
 * Job : prévient une seule fois par remplissage. Le drapeau `packs_full_notified` est posé par une mise à jour
 * conditionnelle (un seul appel gagne, même en parallèle ou en rattrapage de jobs en retard) et retombé à
 * l'ouverture d'un paquet du stock. Seul l'état du stock compte (le `fullAt` du job reste une trace).
 */
export async function notifyPacksFull(ctx: Ctx, userId: string) {
  const now = ctx.now();
  const fx = new Effects();
  await ctx.db.transaction(async (tx) => {
    const p = schema.players;
    const full = sql`${p.packsStored} + floor(extract(epoch from (${now.toISOString()}::timestamptz - ${p.packsUpdatedAt})) * 1000 / ${PACK_REGEN_MS}) >= ${MAX_STORED_PACKS}`;
    const [won] = await tx
      .update(p)
      .set({ packsFullNotified: true })
      .where(and(eq(p.userId, userId), eq(p.packsFullNotified, false), full))
      .returning({ userId: p.userId });
    if (won) await fx.notify(tx, userId, "packs_full", { max: MAX_STORED_PACKS });
  });
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
