import { and, eq, inArray, schema } from "@palacards/db";
import {
  nextRarity,
  rollShiny,
  UPGRADE_MAX_CARDS,
  UPGRADE_MIN_CARDS,
  upgradeChance,
  upgradeRefund,
  type Rarity,
} from "@palacards/game";
import type { UpgradeResultDTO } from "@palacards/shared";
import type { Ctx } from "../context.js";
import { badRequest, conflict, notFound } from "../errors.js";
import { instancesByIds, loadMediaInBackground } from "./cards.js";
import { requestedInPendingTrades } from "./collection.js";
import { announcePulls, logPulls } from "./feed.js";
import { afterCommit } from "./notifications.js";
import { drawCard } from "./packs.js";
import { activeSeason, lockPlayer, logMovement, movePw, ownedCount, pushWallet, wallet } from "./players.js";
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
