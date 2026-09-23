import { eq, schema, sql } from "@palacards/db";
import { consumeFreePack, PITY_THRESHOLD, rollPack, type Rarity } from "@palacards/game";
import type { CardDTO, PackState } from "@palacards/shared";
import type { Ctx } from "../context.js";
import { conflict } from "../errors.js";
import { instancesByIds, loadMediaInBackground } from "./cards.js";
import { schedulePacksFull } from "./economy.js";
import { activeSeason, getPlayer, lockPlayer, logMovement, ownedCount, packState, type DbOrTx } from "./players.js";

type Tx = Parameters<Parameters<Ctx["db"]["transaction"]>[0]>[0];

const RAND_SCALE = 2 ** 30;

/**
 * Tire un article d'une rareté via l'index (season, rarity, rand_key) : on part d'une clé aléatoire
 * et on prend la suivante, en rebouclant sur 0. Jamais d'ORDER BY random().
 */
export async function drawCard(db: DbOrTx, season: number, rarity: Rarity, random: Ctx["random"]) {
  const key = random(RAND_SCALE) / RAND_SCALE;
  for (const from of [key, 0]) {
    const [row] = await db.execute<{ id: string; title: string; atk: number; def: number }>(sql`
      select id, title, atk, def from cards
      where season = ${season} and rarity = ${rarity}::rarity and rand_key >= ${from}
      order by rand_key limit 1
    `);
    if (row) return { id: Number(row.id), title: row.title, atk: row.atk, def: row.def };
  }
  throw conflict("empty_tier", `Aucune carte ${rarity} dans la saison ${season}.`);
}

export async function getPackState(ctx: Ctx, userId: string): Promise<PackState> {
  return packState(await getPlayer(ctx.db, userId), ctx.now());
}

export interface OpenedPack {
  cards: CardDTO[];
  packs: PackState;
  usedBonus: boolean;
  pityTriggered: boolean;
}

/** Hook appelé dans la transaction après un tirage (succès, objectifs de guilde…). */
export type AfterPackHook = (tx: Tx, userId: string, rarities: Rarity[]) => Promise<void>;
const afterPackHooks: AfterPackHook[] = [];
export const onPackOpened = (hook: AfterPackHook) => afterPackHooks.push(hook);

/**
 * Ouvre un paquet : une seule transaction (joueur verrouillé, stock décrémenté, 5 exemplaires,
 * pity, ledger). La réponse part tout de suite ; les images manquantes arrivent ensuite par socket.
 */
export async function openPack(ctx: Ctx, userId: string): Promise<OpenedPack> {
  const now = ctx.now();
  const result = await ctx.db.transaction(async (tx) => {
    const p = await lockPlayer(tx, userId);
    const season = await activeSeason(tx);
    const free = consumeFreePack(p.packsStored, p.packsUpdatedAt, now);
    let usedBonus = false;
    const update: Partial<typeof schema.players.$inferInsert> = {};
    if (free) {
      update.packsStored = free.stored;
      update.packsUpdatedAt = free.updatedAt;
    } else if (p.bonusPacks > 0) {
      update.bonusPacks = p.bonusPacks - 1;
      usedBonus = true;
    } else {
      throw conflict("no_packs", "Plus de paquet : le prochain arrive bientôt.");
    }

    const roll = rollPack(p.pityCounter, ctx.random);
    update.pityCounter = roll.pityCounter;
    const drawn = [];
    for (const rarity of roll.rarities) drawn.push({ rarity, ...(await drawCard(tx, season, rarity, ctx.random)) });

    const inserted = await tx
      .insert(schema.cardInstances)
      .values(
        drawn.map((d) => ({
          ownerId: userId,
          cardId: d.id,
          season,
          rarity: d.rarity,
          atk: d.atk,
          def: d.def,
          source: "pack" as const,
          obtainedAt: now,
        })),
      )
      .returning({ id: schema.cardInstances.id });
    await tx.update(schema.players).set(update).where(eq(schema.players.userId, userId));

    const ids = inserted.map((r) => r.id);
    if (usedBonus) await logMovement(tx, userId, "bonus_pack", -1, update.bonusPacks!, "pack_open", ids.join(","));
    else await logMovement(tx, userId, "pack", -1, free!.stored, "pack_open", ids.join(","));
    await logMovement(tx, userId, "card", ids.length, await ownedCount(tx, userId), "pack_open", ids.join(","));

    for (const hook of afterPackHooks) await hook(tx, userId, roll.rarities);

    return {
      ids,
      drawn,
      usedBonus,
      pityTriggered: p.pityCounter >= PITY_THRESHOLD,
      state: { ...p, ...update } as typeof p,
    };
  });

  const cards = await instancesByIds(ctx.db, result.ids);
  const packs = packState(result.state, now);
  ctx.rt.toUser(userId, "packs:update", packs);
  await schedulePacksFull(ctx, userId, result.state.packsStored, result.state.packsUpdatedAt);
  loadMediaInBackground(
    ctx,
    userId,
    result.drawn.map((d) => ({ cardId: d.id, title: d.title })),
  );
  return { cards, packs, usedBonus: result.usedBonus, pityTriggered: result.pityTriggered };
}
