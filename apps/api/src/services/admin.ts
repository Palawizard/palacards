import { desc, eq, schema, sql } from "@palacards/db";
import type { Ctx } from "../context.js";
import { badRequest } from "../errors.js";
import { afterCommit, Effects } from "./notifications.js";
import { lockPlayer, logMovement, movePw, packState, PLAYER_LOCK_ORDER, pushWallet, type Player } from "./players.js";
import { findUserByName } from "./profiles.js";
import { seasonStatus } from "./seasons.js";

/** Pseudo spécial du formulaire de don : tous les joueurs (aucun pseudo valide ne contient `*`). */
export const ALL_PLAYERS = "*";

/**
 * Don (ou retrait) de PW et de paquets bonus par un admin : tracé dans le ledger avec l'auteur.
 * Pseudo `*` : don à tous les joueurs (jamais de retrait), une ligne de ledger et une notification chacun.
 */
export async function grant(
  ctx: Ctx,
  adminId: string,
  input: { username: string; pw: number; packs: number; note?: string },
) {
  if (input.pw === 0 && input.packs === 0) throw badRequest("empty", "Rien à donner.");
  if (input.username.trim() === ALL_PLAYERS) return grantAll(ctx, adminId, input);
  const target = await findUserByName(ctx.db, input.username);
  const ref = `admin:${adminId}${input.note ? `:${input.note.slice(0, 80)}` : ""}`;
  const player = await ctx.db.transaction(async (tx) => {
    const p = await lockPlayer(tx, target.id);
    if (input.pw) await movePw(tx, p, input.pw, "admin", ref);
    if (input.packs) {
      const bonusPacks = p.bonusPacks + input.packs;
      if (bonusPacks < 0) throw badRequest("negative_packs", "Le joueur n'a pas assez de paquets bonus.");
      await tx.update(schema.players).set({ bonusPacks }).where(eq(schema.players.userId, target.id));
      await logMovement(tx, target.id, "bonus_pack", input.packs, bonusPacks, "admin", ref);
      p.bonusPacks = bonusPacks;
    }
    return p;
  });
  await afterCommit(ctx, async () => {
    pushWallet(ctx, player);
    ctx.rt.toUser(target.id, "packs:update", packState(player, ctx.now()));
  });
  return { balance: player.balance, bonusPacks: player.bonusPacks };
}

/**
 * Cadeau à tous les joueurs : une transaction, joueurs verrouillés dans l'ordre (comme la bascule de saison),
 * puis soldes et stocks poussés aux onglets ouverts. Moins de quelques centaines de joueurs : une boucle suffit.
 */
async function grantAll(ctx: Ctx, adminId: string, input: { pw: number; packs: number; note?: string }) {
  if (input.pw < 0 || input.packs < 0)
    throw badRequest("negative_gift", "Pas de retrait sur tous les joueurs : seulement des dons.");
  const note = input.note?.slice(0, 80);
  const ref = `admin:${adminId}${note ? `:${note}` : ""}`;
  const fx = new Effects();
  const players = await ctx.db.transaction(async (tx) => {
    const ids = await tx.execute<{ user_id: string }>(sql`select user_id from players order by ${PLAYER_LOCK_ORDER}`);
    const out: Player[] = [];
    for (const { user_id } of ids) {
      const p = await lockPlayer(tx, user_id);
      if (input.pw) await movePw(tx, p, input.pw, "admin", ref);
      if (input.packs) {
        const bonusPacks = p.bonusPacks + input.packs;
        await tx.update(schema.players).set({ bonusPacks }).where(eq(schema.players.userId, user_id));
        await logMovement(tx, user_id, "bonus_pack", input.packs, bonusPacks, "admin", ref);
        p.bonusPacks = bonusPacks;
      }
      await fx.notify(tx, user_id, "gift", { pw: input.pw, packs: input.packs, ...(note ? { note } : {}) });
      out.push(p);
    }
    return out;
  });
  await afterCommit(ctx, async () => {
    for (const p of players) {
      pushWallet(ctx, p);
      ctx.rt.toUser(p.userId, "packs:update", packState(p, ctx.now()));
    }
    await fx.flush(ctx);
  });
  return { players: players.length, pw: input.pw, packs: input.packs };
}

/** Masse monétaire et flux des 30 derniers jours, pour repérer l'inflation. */
export async function economyStats(ctx: Ctx) {
  const [supply] = await ctx.db.execute<{ total: string; locked: string; players: number; packs: string }>(sql`
    select coalesce(sum(balance), 0) as total, coalesce(sum(locked_balance), 0) as locked, count(*)::int as players,
           coalesce(sum(bonus_packs), 0) as packs
    from players
  `);
  const flows = await ctx.db.execute<{ reason: string; created: string; destroyed: string }>(sql`
    select reason, coalesce(sum(delta) filter (where delta > 0), 0) as created, coalesce(-sum(delta) filter (where delta < 0), 0) as destroyed
    from ledger where kind = 'pw' and created_at > now() - interval '30 days'
    group by reason order by reason
  `);
  const [cards] = await ctx.db.execute<{ instances: number; auctions: number; trades: number }>(sql`
    select (select count(*)::int from card_instances) as instances,
           (select count(*)::int from auctions where status = 'open') as auctions,
           (select count(*)::int from trades where status = 'pending') as trades
  `);
  return {
    supply: {
      total: Number(supply?.total ?? 0),
      locked: Number(supply?.locked ?? 0),
      players: supply?.players ?? 0,
      bonusPacks: Number(supply?.packs ?? 0),
    },
    // Échanges entre joueurs (trade, market_sale, market_purchase) se compensent ; la taxe est détruite.
    flows: flows.map((f) => ({ reason: f.reason, created: Number(f.created), destroyed: Number(f.destroyed) })),
    cards: cards ?? { instances: 0, auctions: 0, trades: 0 },
  };
}

/** Journal : dernières lignes du ledger, tous joueurs confondus. */
export async function ledgerLog(ctx: Ctx, before?: number) {
  const rows = await ctx.db
    .select({
      id: schema.ledger.id,
      kind: schema.ledger.kind,
      delta: schema.ledger.delta,
      balanceAfter: schema.ledger.balanceAfter,
      reason: schema.ledger.reason,
      refId: schema.ledger.refId,
      createdAt: schema.ledger.createdAt,
      username: schema.user.username,
    })
    .from(schema.ledger)
    .innerJoin(schema.user, eq(schema.user.id, schema.ledger.userId))
    .where(before ? sql`${schema.ledger.id} < ${before}` : undefined)
    .orderBy(desc(schema.ledger.id))
    .limit(100);
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}

export async function adminOverview(ctx: Ctx) {
  return {
    economy: await economyStats(ctx),
    season: await seasonStatus(ctx),
    jobs: await ctx.jobs.status(),
  };
}
