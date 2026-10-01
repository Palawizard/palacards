import { and, eq, lt, or, schema, sql } from "@palacards/db";
import type { Ctx } from "../context.js";
import { conflict } from "../errors.js";
import { forceFinish, refuseChallenge } from "./battles.js";
import { leaveGuild, membership } from "./guilds.js";
import { cancelAuction } from "./market.js";
import { closeTrade } from "./trades.js";

/** Notifications gardées 6 mois : au-delà, elles ne servent plus à rien (minimisation RGPD). */
export const NOTIFICATION_RETENTION_DAYS = 180;
export const PRIVACY_PURGE_JOB = "privacy-purge";

const TECHNICAL_EMAIL = /@palacards\.local$/;

/**
 * Droit d'accès et à la portabilité : tout ce qui concerne le joueur, en JSON.
 * Les secrets (hash du mot de passe, jetons de session et d'OAuth) ne sortent jamais.
 */
export async function exportData(ctx: Ctx, userId: string) {
  const db = ctx.db;
  const s = schema;
  const [user] = await db
    .select({
      id: s.user.id,
      username: s.user.displayUsername,
      email: s.user.email,
      createdAt: s.user.createdAt,
      updatedAt: s.user.updatedAt,
      isAdmin: s.user.isAdmin,
    })
    .from(s.user)
    .where(eq(s.user.id, userId));
  const [avatar] = await db.select().from(s.playerAvatars).where(eq(s.playerAvatars.userId, userId));
  const dm = or(
    sql`${s.messages.channel} like ${`dm:${userId}:%`}`,
    sql`${s.messages.channel} like ${`dm:%:${userId}`}`,
  );

  return {
    exportedAt: ctx.now().toISOString(),
    // L'adresse technique (inscription sans email) n'est pas une donnée fournie par le joueur.
    account: user && { ...user, email: TECHNICAL_EMAIL.test(user.email) ? null : user.email },
    sessions: await db
      .select({
        createdAt: s.session.createdAt,
        expiresAt: s.session.expiresAt,
        ipAddress: s.session.ipAddress,
        userAgent: s.session.userAgent,
      })
      .from(s.session)
      .where(eq(s.session.userId, userId)),
    loginProviders: await db
      .select({ providerId: s.account.providerId, createdAt: s.account.createdAt })
      .from(s.account)
      .where(eq(s.account.userId, userId)),
    player: (await db.select().from(s.players).where(eq(s.players.userId, userId)))[0] ?? null,
    avatarImage: avatar
      ? { mime: avatar.mime, base64: avatar.image.toString("base64"), updatedAt: avatar.updatedAt }
      : null,
    cards: await db.select().from(s.cardInstances).where(eq(s.cardInstances.ownerId, userId)),
    tags: await db
      .select({ instanceId: s.userTags.instanceId, tag: s.userTags.tag })
      .from(s.userTags)
      .innerJoin(s.cardInstances, eq(s.cardInstances.id, s.userTags.instanceId))
      .where(eq(s.cardInstances.ownerId, userId)),
    ledger: await db.select().from(s.ledger).where(eq(s.ledger.userId, userId)),
    auctions: await db
      .select()
      .from(s.auctions)
      .where(or(eq(s.auctions.sellerId, userId), eq(s.auctions.currentBidderId, userId))),
    bids: await db.select().from(s.bids).where(eq(s.bids.bidderId, userId)),
    trades: await db
      .select()
      .from(s.trades)
      .where(or(eq(s.trades.fromId, userId), eq(s.trades.toId, userId))),
    wishlist: await db.select().from(s.wishlist).where(eq(s.wishlist.userId, userId)),
    notifications: await db.select().from(s.notifications).where(eq(s.notifications.userId, userId)),
    themePacks: await db.select().from(s.playerThemePacks).where(eq(s.playerThemePacks.userId, userId)),
    promoRedemptions: await db.select().from(s.promoRedemptions).where(eq(s.promoRedemptions.userId, userId)),
    friendships: await db
      .select()
      .from(s.friendships)
      .where(or(eq(s.friendships.userA, userId), eq(s.friendships.userB, userId))),
    // Conversations privées auxquelles le joueur participe, et ses propres messages de guilde.
    messages: await db
      .select()
      .from(s.messages)
      .where(or(dm, eq(s.messages.senderId, userId))),
    messageReads: await db.select().from(s.messageReads).where(eq(s.messageReads.userId, userId)),
    guild: await membership(db, userId),
    battles: await db
      .select()
      .from(s.battles)
      .where(or(eq(s.battles.challengerId, userId), eq(s.battles.opponentId, userId))),
    battleDecks: await db.select().from(s.battleDecks).where(eq(s.battleDecks.userId, userId)),
    battleTurns: await db
      .select()
      .from(s.battleTurns)
      .where(or(eq(s.battleTurns.attackerId, userId), eq(s.battleTurns.defenderId, userId))),
    achievements: await db.select().from(s.achievementsProgress).where(eq(s.achievementsProgress.userId, userId)),
    seasonArchives: await db.select().from(s.seasonArchives).where(eq(s.seasonArchives.userId, userId)),
  };
}

/**
 * Avant l'effacement du compte (droit à l'effacement) : on dénoue ce qui engage d'autres joueurs,
 * sinon la suppression en cascade laisserait leurs PW ou leurs cartes bloqués.
 * Enchère avec offre (vendeur ou meilleur enchérisseur) : on refuse, le joueur doit attendre la fin.
 * ponytail: pas de verrou global entre ce nettoyage et le DELETE ; un échange proposé dans ces quelques
 * millisecondes serait supprimé avec ses verrous. Tolérable à 20 joueurs, sinon faire tout dans une transaction.
 */
export async function prepareAccountDeletion(ctx: Ctx, userId: string) {
  const a = schema.auctions;
  const open = await ctx.db
    .select({ id: a.id, sellerId: a.sellerId, currentBidderId: a.currentBidderId })
    .from(a)
    .where(and(eq(a.status, "open"), or(eq(a.sellerId, userId), eq(a.currentBidderId, userId))));
  if (open.some((x) => x.currentBidderId !== null)) {
    throw conflict(
      "auction_engaged",
      "Tu as une enchère en cours avec une offre (ta vente ou ta meilleure offre) : attends qu'elle se termine.",
    );
  }
  for (const x of open) await cancelAuction(ctx, userId, x.id);

  const t = schema.trades;
  const pending = await ctx.db
    .select({ id: t.id, fromId: t.fromId })
    .from(t)
    .where(and(eq(t.status, "pending"), or(eq(t.fromId, userId), eq(t.toId, userId))));
  for (const x of pending) {
    await closeTrade(ctx, x.id, { by: userId, kind: x.fromId === userId ? "cancel" : "decline" });
  }

  const b = schema.battles;
  const battles = await ctx.db
    .select({ id: b.id, status: b.status })
    .from(b)
    .where(
      and(
        or(eq(b.status, "pending"), eq(b.status, "active")),
        or(eq(b.challengerId, userId), eq(b.opponentId, userId)),
      ),
    );
  for (const x of battles) {
    if (x.status === "pending") await refuseChallenge(ctx, userId, x.id);
    else await forceFinish(ctx, x.id, userId);
  }

  if (await membership(ctx.db, userId)) await leaveGuild(ctx, userId);
}

/** Purge quotidienne : sessions et jetons expirés (avec leur IP), vieilles notifications. */
export async function purgeExpired(ctx: Ctx) {
  const now = ctx.now();
  const sessions = await ctx.db
    .delete(schema.session)
    .where(lt(schema.session.expiresAt, now))
    .returning({ id: schema.session.id });
  const verifications = await ctx.db
    .delete(schema.verification)
    .where(lt(schema.verification.expiresAt, now))
    .returning({ id: schema.verification.id });
  const cutoff = new Date(now.getTime() - NOTIFICATION_RETENTION_DAYS * 86_400_000);
  const notifications = await ctx.db
    .delete(schema.notifications)
    .where(lt(schema.notifications.createdAt, cutoff))
    .returning({ id: schema.notifications.id });
  return { sessions: sessions.length, verifications: verifications.length, notifications: notifications.length };
}
