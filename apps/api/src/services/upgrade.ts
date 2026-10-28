import { and, desc, eq, inArray, schema, sql } from "@palacards/db";
import {
  nextRarity,
  rollSourceShiny,
  UPGRADE_MAX_CARDS,
  UPGRADE_MIN_CARDS,
  UPGRADE_SERIES_MAX_LOTS,
  upgradeChance,
  upgradeRefund,
  upgradeSeriesLots,
  upgradeSeriesSummary,
  type Rarity,
} from "@palacards/game";
import type {
  UpgradeResultDTO,
  UpgradeSeriesCardDTO,
  UpgradeSeriesLotDTO,
  UpgradeSeriesPreviewDTO,
  UpgradeSeriesResultDTO,
  UpgradeSeriesRunDTO,
} from "@palacards/shared";
import type { Ctx } from "../context.js";
import { badRequest, conflict, notFound } from "../errors.js";
import { instancesByIds, loadMediaInBackground } from "./cards.js";
import { freeCopies, requestedInPendingTrades } from "./collection.js";
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
  retireInstances,
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
    await retireInstances(tx, ids, "upgraded");
    await logMovement(tx, ownerId, "card", -ids.length, await ownedCount(tx, ownerId), "upgrade", ref);

    if (!success) {
      const refund = upgradeRefund(from, ids.length);
      if (refund) await movePw(tx, p, refund, "upgrade", ref);
      return {
        success,
        chance,
        roll,
        refund,
        instanceId: null,
        shiny: false,
        drawn: null,
        notable: [] as number[],
        player: p,
      };
    }
    const season = await activeSeason(tx);
    const drawn = await drawCard(tx, season, target, ctx.random);
    const shiny = rollSourceShiny("upgrade", ctx.random);
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
    return { success, chance, roll, refund: 0, instanceId: inserted!.id, shiny, drawn, notable, player: p };
  });

  const card = res.instanceId ? ((await instancesByIds(ctx.db, [res.instanceId], ownerId))[0] ?? null) : null;
  await afterCommit(ctx, async () => {
    pushWallet(ctx, res.player);
    void emit(
      ctx,
      ownerId,
      { type: "upgrade", success: res.success },
      ...(res.shiny ? [{ type: "shiny_obtained" as const, source: "upgrade" as const, count: 1 }] : []),
      ...(res.drawn ? (["collection"] as const) : []),
    );
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

/** Séries gardées dans l'historique de la page Upgrader. */
export const UPGRADE_SERIES_HISTORY = 10;
/** Cartes choisies à la main au plus : 50 lots de 10. */
export const UPGRADE_SERIES_MAX_CARDS = UPGRADE_SERIES_MAX_LOTS * UPGRADE_MAX_CARDS;

/**
 * Cartes d'une rareté pour l'upgrade en série (mêmes protections que le recyclage des doublons) : les doublons
 * d'abord, puis, si le joueur l'a demandé, le dernier exemplaire libre de chaque article (`singles`).
 */
async function seriesCandidates(ctx: Ctx, ownerId: string, from: Rarity, singles: boolean, db: DbOrTx = ctx.db) {
  const copies = await freeCopies(ctx, ownerId, [from], db);
  const ids = (rows: { id: number }[]) => rows.map((r) => r.id).sort((a, b) => a - b);
  const duplicates = ids(copies.duplicates);
  const best = ids(copies.best);
  return { ids: singles ? [...duplicates, ...best] : duplicates, duplicates: duplicates.length, singles: best.length };
}

interface SeriesRow extends UpgradeSeriesCardDTO {
  favorite: boolean;
  lastCopy: boolean;
  lockedBy: "auction" | "trade" | null;
  pinned: boolean;
}

/**
 * Détail des exemplaires `ids` (dans cet ordre), avec ce qui demande une confirmation : favori, épinglé,
 * brillante, ou dernier exemplaire de l'article (aucun autre exemplaire hors de `ids`). `lock` : verrouillés.
 */
async function seriesRows(db: DbOrTx, ownerId: string, ids: number[], lock = false): Promise<SeriesRow[]> {
  if (!ids.length) return [];
  const list = sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  );
  const rows = await db.execute<{
    id: string;
    card_id: string;
    title: string;
    rarity: Rarity;
    shiny: boolean;
    favorite: boolean;
    locked_by: "auction" | "trade" | null;
    pinned: boolean;
    others: number;
  }>(sql`
    select ci.id, ci.card_id, c.title, ci.rarity, ci.shiny, ci.favorite, ci.locked_by,
           ci.pinned_slot is not null as pinned,
           (select count(*)::int from card_instances o
             where o.owner_id = ${ownerId} and o.card_id = ci.card_id and o.id not in (${list})) as others
    from card_instances ci
    join cards c on c.id = ci.card_id and c.season = ci.season
    where ci.owner_id = ${ownerId} and ci.id in (${list})
    ${lock ? sql`for update of ci` : sql``}
  `);
  const byId = new Map(rows.map((r) => [Number(r.id), r]));
  return ids.flatMap((id) => {
    const r = byId.get(id);
    if (!r) return [];
    return [
      {
        instanceId: id,
        cardId: Number(r.card_id),
        title: r.title,
        rarity: r.rarity,
        shiny: r.shiny,
        favorite: r.favorite,
        lastCopy: r.others === 0,
        lockedBy: r.locked_by,
        pinned: r.pinned,
      },
    ];
  });
}

const cardDTO = (r: UpgradeSeriesCardDTO): UpgradeSeriesCardDTO => ({
  instanceId: r.instanceId,
  cardId: r.cardId,
  title: r.title,
  rarity: r.rarity,
  shiny: r.shiny,
});

/** Aperçu de l'upgrade en série : lots, chances, réussites attendues, PW rendus si tout échoue, cartes prises. */
export async function upgradeSeriesPreview(
  ctx: Ctx,
  ownerId: string,
  from: Rarity,
  singles = false,
): Promise<UpgradeSeriesPreviewDTO> {
  const target = seriesTarget(from);
  const c = await seriesCandidates(ctx, ownerId, from, singles);
  const plan = upgradeSeriesLots(from, c.ids.length);
  const summary = upgradeSeriesSummary(from, plan);
  const used = c.ids.slice(0, summary.cards);
  return {
    rarity: from,
    target,
    available: c.ids.length,
    duplicates: c.duplicates,
    singles: c.singles,
    singlesUsed: Math.max(0, summary.cards - c.duplicates),
    lots: plan.map((cards) => ({ cards, chance: upgradeChance(from, cards) })),
    ...summary,
    maxLots: UPGRADE_SERIES_MAX_LOTS,
    candidates: (await seriesRows(ctx.db, ownerId, used)).map((r) => ({
      ...cardDTO(r),
      favorite: r.favorite,
      lastCopy: r.lastCopy,
    })),
  };
}

export interface UpgradeSeriesOptions {
  /** Mode automatique : prendre aussi le dernier exemplaire de chaque article. */
  singles?: boolean;
  /** Nombre d'upgrades voulu, ramené à ce que les cartes permettent (tous par défaut). */
  maxLots?: number;
  /** Cartes choisies par le joueur, dans l'ordre des lots (remplace le choix automatique). */
  instanceIds?: number[];
  /** Le joueur a confirmé les favoris, brillantes, cartes épinglées et derniers exemplaires de sa sélection. */
  confirm?: boolean;
}

/**
 * Upgrade en série. Mode automatique : les doublons d'une rareté (jamais favoris, brillantes, épinglées ni
 * cartes engagées ; le meilleur exemplaire de chaque article reste, sauf avec `singles`). Mode manuel
 * (`instanceIds`) : les cartes choisies par le joueur, jamais engagées ; une favorite, une brillante, une
 * épinglée ou un dernier exemplaire exigent `confirm`. Les cartes partent en lots au rendement maximal, chacun
 * tiré comme un upgrade normal. Une transaction pour tout le lancement ; une ligne de ledger par lot, et une
 * ligne d'historique avec le détail des cartes parties et obtenues.
 */
export async function upgradeSeries(
  ctx: Ctx,
  ownerId: string,
  from: Rarity,
  options: UpgradeSeriesOptions = {},
): Promise<UpgradeSeriesResultDTO> {
  const { singles = false, maxLots = UPGRADE_SERIES_MAX_LOTS, instanceIds, confirm = false } = options;
  const target = seriesTarget(from);
  const res = await ctx.db.transaction(async (tx) => {
    const p = await lockPlayer(tx, ownerId);
    let rows: SeriesRow[];
    let plan: number[];
    if (instanceIds) {
      const ids = [...new Set(instanceIds)];
      if (ids.length < UPGRADE_MIN_CARDS || ids.length > UPGRADE_SERIES_MAX_CARDS)
        throw badRequest("upgrade_count", `Choisis entre ${UPGRADE_MIN_CARDS} et ${UPGRADE_SERIES_MAX_CARDS} cartes.`);
      plan = upgradeSeriesLots(from, ids.length, maxLots);
      const used = ids.slice(
        0,
        plan.reduce((s, n) => s + n, 0),
      );
      rows = await seriesRows(tx, ownerId, used, true);
      if (rows.length !== used.length) throw notFound("Certaines cartes ne sont plus dans ta collection.");
      if (rows.some((r) => r.rarity !== from))
        throw badRequest("mixed_rarities", "Toutes les cartes doivent avoir la même rareté.");
      if (rows.some((r) => r.lockedBy))
        throw conflict("card_locked", "Une carte est engagée dans une vente ou un échange.");
      if ((await requestedInPendingTrades(tx, used)).size)
        throw conflict("card_requested", "Une carte est demandée dans un échange en attente : refuse-le d'abord.");
      if (!confirm && rows.some((r) => r.favorite || r.shiny || r.pinned || r.lastCopy))
        throw conflict(
          "series_confirm",
          "Ta sélection contient des favoris, des brillantes ou des derniers exemplaires : confirme d'abord.",
        );
    } else {
      const candidates = (await seriesCandidates(ctx, ownerId, from, singles, tx)).ids;
      plan = upgradeSeriesLots(from, candidates.length, maxLots);
      if (!plan.length)
        throw badRequest(
          "no_duplicates",
          singles ? "Aucune carte à upgrader dans cette rareté." : "Aucun doublon à upgrader dans cette rareté.",
        );
      const used = candidates.slice(
        0,
        plan.reduce((s, n) => s + n, 0),
      );
      rows = await seriesRows(tx, ownerId, used, true);
      if (
        rows.length !== used.length ||
        rows.some((r) => r.rarity !== from || r.lockedBy || r.favorite || r.shiny || r.pinned)
      )
        throw conflict("series_changed", "Ta collection vient de changer : relance l'aperçu.");
    }
    const used = rows.map((r) => r.instanceId);

    await retireInstances(tx, used, "upgraded");
    let owned = await ownedCount(tx, ownerId);
    // Le ledger rejoue le lancement lot par lot : on part du total d'avant suppression.
    owned += used.length;
    const season = await activeSeason(tx);
    const lots: UpgradeSeriesLotDTO[] = [];
    const won: { instanceId: number; cardId: number; title: string }[] = [];
    let notable: number[] = [];
    let refund = 0;
    let offset = 0;
    for (const count of plan) {
      const consumed = rows.slice(offset, offset + count);
      const ids = consumed.map((r) => r.instanceId);
      offset += count;
      const chance = upgradeChance(from, count);
      const roll = ctx.random(10_000);
      const success = roll < chance;
      const ref = `${from}>${target}:${ids.join(",")}`;
      owned -= count;
      await logMovement(tx, ownerId, "card", -count, owned, "upgrade", ref);
      if (!success) {
        const r = upgradeRefund(from, count);
        if (r) await movePw(tx, p, r, "upgrade", ref);
        refund += r;
        lots.push({ cards: count, chance, roll, success, refund: r, consumed: consumed.map(cardDTO), won: null });
        continue;
      }
      const drawn = await drawCard(tx, season, target, ctx.random);
      const shiny = rollSourceShiny("upgrade", ctx.random);
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
      lots.push({
        cards: count,
        chance,
        roll,
        success,
        refund: 0,
        consumed: consumed.map(cardDTO),
        won: { instanceId: inserted!.id, cardId: drawn.id, title: drawn.title, rarity: target, shiny },
      });
    }
    const successes = lots.filter((l) => l.success).length;
    const [run] = await tx
      .insert(schema.upgradeSeriesRuns)
      .values({ userId: ownerId, rarity: from, target, lots, successes, refund, createdAt: ctx.now() })
      .returning({ id: schema.upgradeSeriesRuns.id });
    const remaining = (await seriesCandidates(ctx, ownerId, from, singles, tx)).ids.length;
    const shinies = lots.filter((l) => l.won?.shiny).length;
    return { id: run!.id, lots, won, notable, refund, remaining, successes, shinies, player: p };
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
      ...(res.shinies ? [{ type: "shiny_obtained" as const, source: "upgrade" as const, count: res.shinies }] : []),
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
    id: res.id,
    rarity: from,
    target,
    lots: res.lots,
    successes: res.successes,
    cards: res.won.map((w) => byId.get(w.instanceId)).filter((c) => !!c),
    refund: res.refund,
    wallet: wallet(res.player),
    remaining: res.remaining,
  };
}

/** Dernières séries lancées par le joueur (récapitulatif consultable après coup). */
export async function upgradeSeriesHistory(ctx: Ctx, ownerId: string): Promise<UpgradeSeriesRunDTO[]> {
  const t = schema.upgradeSeriesRuns;
  const rows = await ctx.db
    .select()
    .from(t)
    .where(eq(t.userId, ownerId))
    .orderBy(desc(t.createdAt), desc(t.id))
    .limit(UPGRADE_SERIES_HISTORY);
  return rows.map((r) => ({
    id: r.id,
    rarity: r.rarity,
    target: r.target,
    createdAt: r.createdAt.toISOString(),
    successes: r.successes,
    refund: r.refund,
    lots: r.lots.map((l) => ({ ...l, cards: l.consumed.length })),
  }));
}
