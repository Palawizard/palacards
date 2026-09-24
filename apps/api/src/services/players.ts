import { schema } from "@palacards/db";
import { availablePacks, MAX_STORED_PACKS, msUntilNextPack, PITY_THRESHOLD } from "@palacards/game";
import type { PackState, Wallet } from "@palacards/shared";
import { eq, inArray, sql } from "@palacards/db";
import type { Ctx } from "../context.js";
import { GameError } from "../errors.js";

type Tx = Parameters<Parameters<Ctx["db"]["transaction"]>[0]>[0];
export type DbOrTx = Ctx["db"] | Tx;
export type Player = typeof schema.players.$inferSelect;

/**
 * Ordre de verrouillage des joueurs côté SQL (verrous en masse, ex. bascule de saison) : id croissant
 * octet par octet (collation "C"), identique à `lockOrder`. Jamais la collation de la base (en_US),
 * qui classe `a` < `B` alors que l'ordre des unités de code JS donne `B` < `a`.
 */
export const PLAYER_LOCK_ORDER = sql`user_id collate "C"`;

/**
 * Ordre de verrouillage côté JS : unités de code UTF-16 croissantes (tri par défaut de `Array#sort`),
 * égal à l'ordre de la collation "C" pour les ids Better Auth (ASCII alphanumériques).
 */
export function lockOrder(userIds: string[]): string[] {
  return [...new Set(userIds)].sort();
}

/**
 * Verrouille des joueurs (`SELECT … FOR UPDATE`) dans un ordre déterministe (`lockOrder`, id croissant
 * au sens de la collation "C", comme `PLAYER_LOCK_ORDER`) pour éviter les interblocages quand une
 * opération touche plusieurs joueurs.
 */
export async function lockPlayers(tx: Tx, userIds: string[]): Promise<Map<string, Player>> {
  const ids = lockOrder(userIds);
  const out = new Map<string, Player>();
  for (const id of ids) {
    const [p] = await tx.select().from(schema.players).where(eq(schema.players.userId, id)).for("update");
    if (!p) throw new GameError(404, "player_not_found", "Joueur introuvable.");
    out.set(id, p);
  }
  return out;
}

export async function lockPlayer(tx: Tx, userId: string): Promise<Player> {
  return (await lockPlayers(tx, [userId])).get(userId)!;
}

export type LedgerReason =
  | "signup"
  | "recycle"
  | "daily_login"
  | "battle"
  | "achievement"
  | "bonus_pack"
  | "market_fee"
  | "market_purchase"
  | "market_sale"
  | "market_tax"
  | "trade"
  | "admin"
  | "guild_objective"
  | "pack_open"
  | "fusion";

/**
 * Change le solde de PW d'un joueur verrouillé et écrit la ligne de ledger correspondante.
 * C'est la seule façon de modifier `balance`.
 */
export async function movePw(tx: Tx, player: Player, delta: number, reason: LedgerReason, refId?: string | number) {
  if (delta === 0) return player;
  const balance = player.balance + delta;
  if (balance < player.lockedBalance) {
    throw new GameError(409, "insufficient_funds", "Pas assez de points wiki.");
  }
  await tx.update(schema.players).set({ balance }).where(eq(schema.players.userId, player.userId));
  await tx.insert(schema.ledger).values({
    userId: player.userId,
    kind: "pw",
    delta,
    balanceAfter: balance,
    reason,
    refId: refId === undefined ? null : String(refId),
  });
  player.balance = balance;
  return player;
}

/**
 * Bloque (delta > 0) ou débloque (delta < 0) des PW d'un joueur verrouillé : enchères en cours,
 * échanges proposés. Pas de ligne de ledger : le solde total ne bouge pas.
 */
export async function moveLocked(tx: Tx, player: Player, delta: number) {
  if (delta === 0) return player;
  const locked = player.lockedBalance + delta;
  if (locked < 0) throw new GameError(500, "locked_negative", "Solde bloqué incohérent.");
  if (locked > player.balance) throw new GameError(409, "insufficient_funds", "Pas assez de points wiki disponibles.");
  await tx.update(schema.players).set({ lockedBalance: locked }).where(eq(schema.players.userId, player.userId));
  player.lockedBalance = locked;
  return player;
}

/** Donne des exemplaires à un nouveau propriétaire (vente, échange) : verrous, épingle, favori et tags remis à zéro. */
export async function transferInstances(tx: Tx, instanceIds: number[], newOwner: string, source: "market" | "trade") {
  if (instanceIds.length === 0) return;
  await tx
    .update(schema.cardInstances)
    .set({ ownerId: newOwner, lockedBy: null, pinnedSlot: null, favorite: false, source, obtainedAt: new Date() })
    .where(inArray(schema.cardInstances.id, instanceIds));
  await tx.delete(schema.userTags).where(inArray(schema.userTags.instanceId, instanceIds));
}

/** Trace un mouvement de cartes ou de paquets (sans solde de PW) dans le ledger. */
export async function logMovement(
  tx: Tx,
  userId: string,
  kind: "card" | "pack" | "bonus_pack",
  delta: number,
  balanceAfter: number,
  reason: LedgerReason,
  refId?: string | number,
) {
  if (delta === 0) return;
  await tx.insert(schema.ledger).values({
    userId,
    kind,
    delta,
    balanceAfter,
    reason,
    refId: refId === undefined ? null : String(refId),
  });
}

export async function ownedCount(tx: DbOrTx, userId: string): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.cardInstances)
    .where(eq(schema.cardInstances.ownerId, userId));
  return row?.n ?? 0;
}

export function packState(
  p: Pick<Player, "packsStored" | "packsUpdatedAt" | "bonusPacks" | "pityCounter">,
  now: Date,
): PackState {
  return {
    available: availablePacks(p.packsStored, p.packsUpdatedAt, now),
    bonus: p.bonusPacks,
    max: MAX_STORED_PACKS,
    nextInMs: msUntilNextPack(p.packsStored, p.packsUpdatedAt, now),
    pity: p.pityCounter,
    pityThreshold: PITY_THRESHOLD,
  };
}

export function wallet(p: Pick<Player, "balance" | "lockedBalance">): Wallet {
  return { balance: p.balance, locked: p.lockedBalance, available: p.balance - p.lockedBalance };
}

export async function getPlayer(db: DbOrTx, userId: string): Promise<Player> {
  const [p] = await db.select().from(schema.players).where(eq(schema.players.userId, userId));
  if (!p) throw new GameError(404, "player_not_found", "Joueur introuvable.");
  return p;
}

/** Pousse le solde à jour aux onglets ouverts du joueur. */
export function pushWallet(ctx: Ctx, p: Player) {
  ctx.rt.toUser(p.userId, "wallet:update", wallet(p));
}

export async function activeSeason(db: DbOrTx): Promise<number> {
  const [s] = await db
    .select({ id: schema.seasons.id })
    .from(schema.seasons)
    .where(eq(schema.seasons.status, "active"));
  if (!s) throw new GameError(503, "no_season", "Aucune saison active : charge des cartes (pnpm db:seed).");
  return s.id;
}
