import { and, desc, eq, inArray, isNull, lt, schema, sql } from "@palacards/db";
import type { NotificationDTO } from "@palacards/shared";
import type { Ctx } from "../context.js";
import type { DbOrTx } from "./players.js";

export type NotificationType =
  | "outbid"
  | "auction_won"
  | "auction_sold"
  | "auction_expired"
  | "trade_received"
  | "trade_accepted"
  | "trade_declined"
  | "trade_countered"
  | "trade_expired"
  | "friend_request"
  | "friend_accepted"
  | "wishlist_listed"
  | "battle_challenge"
  | "battle_result"
  | "packs_full"
  | "achievement"
  | "guild_objective";

/** Catégories réglables dans les paramètres (une notification désactivée n'est ni stockée ni envoyée). */
export const NOTIFICATION_GROUPS: Record<string, NotificationType[]> = {
  market: ["outbid", "auction_won", "auction_sold", "auction_expired", "wishlist_listed"],
  trades: ["trade_received", "trade_accepted", "trade_declined", "trade_countered", "trade_expired"],
  social: ["friend_request", "friend_accepted", "guild_objective"],
  battles: ["battle_challenge", "battle_result"],
  packs: ["packs_full"],
  achievements: ["achievement"],
};

const groupOf = (type: NotificationType) =>
  Object.entries(NOTIFICATION_GROUPS).find(([, types]) => types.includes(type))?.[0] ?? "other";

/**
 * Effets à déclencher après le commit : notifications (insérées dans la transaction,
 * poussées par socket seulement si elle aboutit) et autres événements temps réel.
 */
export class Effects {
  private notified: { userId: string; id: number }[] = [];
  private after: (() => void)[] = [];

  /** Insère une notification dans la transaction (sauf si le joueur a coupé cette catégorie). */
  async notify(tx: DbOrTx, userId: string, type: NotificationType, payload: Record<string, unknown>) {
    const [p] = await tx
      .select({ prefs: schema.players.notificationPrefs })
      .from(schema.players)
      .where(eq(schema.players.userId, userId));
    if (p?.prefs?.[groupOf(type)] === false) return;
    const [row] = await tx
      .insert(schema.notifications)
      .values({ userId, type, payload })
      .returning({ id: schema.notifications.id });
    if (row) this.notified.push({ userId, id: row.id });
  }

  /** Action temps réel à lancer après le commit. */
  then(fn: () => void) {
    this.after.push(fn);
  }

  /** À appeler après le commit. */
  async flush(ctx: Ctx) {
    for (const fn of this.after) {
      try {
        fn();
      } catch (err) {
        ctx.log.error(err);
      }
    }
    if (this.notified.length === 0) return;
    const rows = await ctx.db
      .select()
      .from(schema.notifications)
      .where(
        inArray(
          schema.notifications.id,
          this.notified.map((n) => n.id),
        ),
      );
    for (const r of rows) {
      const unread = await unreadCount(ctx.db, r.userId);
      ctx.rt.toUser(r.userId, "notification:new", { ...toDTO(r), unread });
    }
  }
}

function toDTO(r: typeof schema.notifications.$inferSelect): NotificationDTO {
  return {
    id: r.id,
    type: r.type,
    payload: r.payload,
    readAt: r.readAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

export async function unreadCount(db: DbOrTx, userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.notifications)
    .where(and(eq(schema.notifications.userId, userId), isNull(schema.notifications.readAt)));
  return row?.n ?? 0;
}

export async function listNotifications(ctx: Ctx, userId: string, before?: number, limit = 30) {
  const rows = await ctx.db
    .select()
    .from(schema.notifications)
    .where(
      before
        ? and(eq(schema.notifications.userId, userId), lt(schema.notifications.id, before))
        : eq(schema.notifications.userId, userId),
    )
    .orderBy(desc(schema.notifications.id))
    .limit(limit + 1);
  return {
    items: rows.slice(0, limit).map(toDTO),
    nextCursor: rows.length > limit ? String(rows[limit - 1]!.id) : null,
    unread: await unreadCount(ctx.db, userId),
  };
}

export async function markRead(ctx: Ctx, userId: string, ids?: number[]) {
  await ctx.db
    .update(schema.notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(schema.notifications.userId, userId),
        isNull(schema.notifications.readAt),
        ids?.length ? inArray(schema.notifications.id, ids) : undefined,
      ),
    );
  return { unread: await unreadCount(ctx.db, userId) };
}
