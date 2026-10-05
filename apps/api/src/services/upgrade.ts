import { and, eq, inArray, schema } from "@palacards/db";
import {
  nextRarity,
  rollShiny,
  UPGRADE_MAX_CARDS,
  UPGRADE_MIN_CARDS,
  UPGRADE_SERIES_MAX_LOTS,
  upgradeChance,
  upgradeRefund,
  upgradeSeriesLots,
  type Rarity,
} from "@palacards/game";
import type { UpgradeResultDTO, UpgradeSeriesPreviewDTO, UpgradeSeriesResultDTO } from "@palacards/shared";
import type { Ctx } from "../context.js";
import { badRequest, conflict, notFound } from "../errors.js";
import { instancesByIds, loadMediaInBackground } from "./cards.js";
import { duplicateIds, requestedInPendingTrades } from "./collection.js";
import { announcePulls, logPulls } from "./feed.js";
import { afterCommit } from "./notifications.js";
import { drawCard } from "./packs.js";
import {
  activeSeason,
  lockPlayer,
  logMovement,
  movePw,
  ownedCount,
  pushWallet,
  wallet,
  type DbOrTx,
} from "./players.js";
import { emit } from "./progression.js";

const ci = schema.cardInstances;

/**
 * Upgrader : 1 à 10 exemplaires d'une même rareté sont détruits pour tenter une carte aléatoire de la
 * rareté au-dessus, avec une chance au prorata de leur rareté (voir `upgradeChance`). Échec : un quart
 * de leur valeur de recyclage en PW. Une transaction : joueur puis exemplaires verrouillés, ledger des
 * cartes et des PW. Le tirage (0 à 9 999) est renvoyé : la roue de la page s'arrête dessus.
 */
export async function upgrade(ctx: Ctx, ownerId: string, instanceIds: number[]): Promise<UpgradeResultDTO> {
  const ids = [...new Set(instanceIds)];
  if (ids.length < UPGRADE_MIN_CARDS || ids.length > UPGRADE_MAX_CARDS)
    throw badRequest("upgrade_count", `Choisis entre ${UPGRADE_MIN_CARDS} et ${UPGRADE_MAX_CARDS} cartes.`);

  const res = await ctx.db.transaction(async (tx) => {
    const p = await lockPlayer(tx, ownerId);
    const rows = await tx
      .select({ id: ci.id, rarity: ci.rarity, lockedBy: ci.lockedBy })
      .from(ci)
      .where(and(inArray(ci.id, ids), eq(ci.ownerId, ownerId)))
      .orderBy(ci.id)
      .for("update");
    if (rows.length !== ids.length) throw notFound("Certaines cartes ne sont plus dans ta collection.");
    if (rows.some((r) => r.lockedBy))
      throw conflict("card_locked", "Une carte est engagée dans une vente ou un échange.");
    const from: Rarity = rows[0]!.rarity;
    if (rows.some((r) => r.rarity !== from))
      throw badRequest("mixed_rarities", "Toutes les cartes doivent avoir la même rareté.");
    const target = nextRarity(from);
    if (!target) throw badRequest("max_rarity", "Une légendaire ne peut pas être améliorée.");
    if ((await requestedInPendingTrades(tx, ids)).size)
      throw conflict("card_requested", "Une carte est demandée dans un échange en attente : refuse-le d'abord.");

    const chance = upgradeChance(from, ids.length);
    const roll = ctx.random(10_000);
    const success = roll < chance;
    const ref = `${from}>${target}:${ids.join(",")}`;
    await tx.delete(ci).where(inArray(ci.id, ids));
    await logMovement(tx, ownerId, "card", -ids.length, await ownedCount(tx, ownerId), "upgrade", ref);

    if (!success) {
      const refund = upgradeRefund(from, ids.length);
      if (refund) await movePw(tx, p, refund, "upgrade", ref);
      return { success, chance, roll, refund, instanceId: null, drawn: null, notable: [] as number[], player: p };
    }
    const season = await activeSeason(tx);
    const drawn = await drawCard(tx, season, target, ctx.random);
    const shiny = rollShiny(ctx.random);
    const [inserted] = await tx
      .insert(ci)
      .values({
        ownerId,
        cardId: drawn.id,
        season,
        rarity: target,
        atk: drawn.atk,
        def: drawn.def,
        shiny,
        source: "upgrade",
        obtainedAt: ctx.now(),
      })
      .returning({ id: ci.id });
    await logMovement(tx, ownerId, "card", 1, await ownedCount(tx, ownerId), "upgrade", ref);
    const notable = await logPulls(tx, ownerId, "upgrade", [
      { cardId: drawn.id, season, rarity: target, shiny, title: drawn.title },
    ]);
    return { success, chance, roll, refund: 0, instanceId: inserted!.id, drawn, notable, player: p };
  });

  const card = res.instanceId ? ((await instancesByIds(ctx.db, [res.instanceId], ownerId))[0] ?? null) : null;
  await afterCommit(ctx, async () => {
    pushWallet(ctx, res.player);
    void emit(ctx, ownerId, { type: "upgrade", success: res.success }, ...(res.drawn ? (["collection"] as const) : []));
    if (res.drawn) {
      loadMediaInBackground(ctx, ownerId, [{ cardId: res.drawn.id, title: res.drawn.title }]);
      await announcePulls(ctx, ownerId, res.notable);
    }
  });
  return {
    success: res.success,
    chance: res.chance,
    roll: res.roll,
    card,
    refund: res.refund,
    wallet: wallet(res.player),
  };
}

function seriesTarget(from: Rarity): Rarity {
  const target = nextRarity(from);
  if (!target) throw badRequest("max_rarity", "Une légendaire ne peut pas être améliorée.");
  return target;
}

/** Doublons d'une rareté pour l'upgrade en série (mêmes protections que le recyclage des doublons). */
async function seriesCandidates(ctx: Ctx, ownerId: string, from: Rarity, db: DbOrTx = ctx.db) {
  return (await duplicateIds(ctx, ownerId, [from], db)).instanceIds.sort((a, b) => a - b);
}

/** Aperçu de l'upgrade en série : lots, chances, réussites attendues, PW rendus si tout échoue. */
export async function upgradeSeriesPreview(ctx: Ctx, ownerId: string, from: Rarity): Promise<UpgradeSeriesPreviewDTO> {
  const target = seriesTarget(from);
  const available = (await seriesCandidates(ctx, ownerId, from)).length;
  const lots = upgradeSeriesLots(from, available).map((cards) => ({ cards, chance: upgradeChance(from, cards) }));
  return {
    rarity: from,
    target,
    available,
    lots,
    cards: lots.reduce((s, l) => s + l.cards, 0),
    expectedSuccesses: Math.round(lots.reduce((s, l) => s + l.chance, 0) / 1_000) / 10,
    refundIfAllFail: lots.reduce((s, l) => s + upgradeRefund(from, l.cards), 0),
    maxLots: UPGRADE_SERIES_MAX_LOTS,
  };
}

/**
 * Upgrade en série : les doublons d'une rareté (jamais favoris, brillantes, épinglées ni cartes engagées ;
 * le meilleur exemplaire de chaque article reste) partent en lots au rendement maximal, chacun tiré comme un
 * upgrade normal. Une transaction pour tout le lancement ; une ligne de ledger par lot, comme à l'unité.
 */
export async function upgradeSeries(ctx: Ctx, ownerId: string, from: Rarity): Promise<UpgradeSeriesResultDTO> {
  const target = seriesTarget(from);
  const res = await ctx.db.transaction(async (tx) => {
    const p = await lockPlayer(tx, ownerId);
    const candidates = await seriesCandidates(ctx, ownerId, from, tx);
    const plan = upgradeSeriesLots(from, candidates.length);
    if (!plan.length) throw badRequest("no_duplicates", "Aucun doublon à upgrader dans cette rareté.");
    const used = candidates.slice(
      0,
      plan.reduce((s, n) => s + n, 0),
    );
    const locked = await tx
      .select({ id: ci.id, lockedBy: ci.lockedBy, favorite: ci.favorite, shiny: ci.shiny })
      .from(ci)
      .where(and(inArray(ci.id, used), eq(ci.ownerId, ownerId), eq(ci.rarity, from)))
      .for("update");
    if (locked.length !== used.length || locked.some((r) => r.lockedBy || r.favorite || r.shiny))
      throw conflict("series_changed", "Ta collection vient de changer : relance l'aperçu.");

    await tx.delete(ci).where(inArray(ci.id, used));
    let owned = await ownedCount(tx, ownerId);
    // Le ledger rejoue le lancement lot par lot : on part du total d'avant suppression.
    owned += used.length;
    const season = await activeSeason(tx);
    const lots: UpgradeSeriesResultDTO["lots"] = [];
    const won: { instanceId: number; cardId: number; title: string }[] = [];
    let notable: number[] = [];
    let refund = 0;
    let offset = 0;
    for (const count of plan) {
      const ids = used.slice(offset, offset + count);
      offset += count;
      const chance = upgradeChance(from, count);
      const roll = ctx.random(10_000);
      const success = roll < chance;
      const ref = `${from}>${target}:${ids.join(",")}`;
      owned -= count;
      await logMovement(tx, ownerId, "card", -count, owned, "upgrade", ref);
      lots.push({ cards: count, chance, roll, success });
      if (!success) {
        const r = upgradeRefund(from, count);
        if (r) await movePw(tx, p, r, "upgrade", ref);
        refund += r;
        continue;
      }
      const drawn = await drawCard(tx, season, target, ctx.random);
      const shiny = rollShiny(ctx.random);
      const [inserted] = await tx
        .insert(ci)
        .values({
          ownerId,
          cardId: drawn.id,
          season,
          rarity: target,
          atk: drawn.atk,
          def: drawn.def,
          shiny,
          source: "upgrade",
          obtainedAt: ctx.now(),
        })
        .returning({ id: ci.id });
      owned += 1;
      await logMovement(tx, ownerId, "card", 1, owned, "upgrade", ref);
      notable = notable.concat(
        await logPulls(tx, ownerId, "upgrade", [
          { cardId: drawn.id, season, rarity: target, shiny, title: drawn.title },
        ]),
      );
      won.push({ instanceId: inserted!.id, cardId: drawn.id, title: drawn.title });
    }
    const remaining = (await seriesCandidates(ctx, ownerId, from, tx)).length;
    return { lots, won, notable, refund, remaining, player: p };
  });

  const byId = new Map(
    (
      await instancesByIds(
        ctx.db,
        res.won.map((w) => w.instanceId),
        ownerId,
      )
    ).map((c) => [c.instanceId, c]),
  );
  await afterCommit(ctx, async () => {
    pushWallet(ctx, res.player);
    void emit(
      ctx,
      ownerId,
      ...res.lots.map((l) => ({ type: "upgrade" as const, success: l.success })),
      ...(res.won.length ? (["collection"] as const) : []),
    );
    if (res.won.length) {
      loadMediaInBackground(
        ctx,
        ownerId,
        res.won.map((w) => ({ cardId: w.cardId, title: w.title })),
      );
      await announcePulls(ctx, ownerId, res.notable);
    }
  });
  return {
    rarity: from,
    target,
    lots: res.lots,
    successes: res.lots.filter((l) => l.success).length,
    cards: res.won.map((w) => byId.get(w.instanceId)).filter((c) => !!c),
    refund: res.refund,
    wallet: wallet(res.player),
    remaining: res.remaining,
  };
}
