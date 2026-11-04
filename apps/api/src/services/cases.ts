import { and, asc, desc, eq, gt, gte, lte, schema, sql } from "@palacards/db";
import {
  buildReel,
  CASE_MULTI_OPEN,
  CASE_ODDS,
  CASE_PRICES,
  CASE_TIERS,
  CASE_TOTAL,
  caseExpectedValue,
  pickLot,
  REEL_WIN_INDEX,
  recycleValue,
  rollCase,
  rollSourceShiny,
  type CaseTier,
  type Rarity,
  type ReelTile,
} from "@palacards/game";
import type {
  CardDTO,
  CaseCardDTO,
  CaseCollectionDTO,
  CaseDTO,
  CaseOpenDTO,
  CaseResultDTO,
  CasesDTO,
  CaseWinDTO,
} from "@palacards/shared";
import type { Ctx } from "../context.js";
import { badRequest, conflict, notFound } from "../errors.js";
import { instancesByIds, loadMediaInBackground } from "./cards.js";
import { announcePulls, logPulls } from "./feed.js";
import { afterCommit } from "./notifications.js";
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
import { freeCases } from "./free-cases.js";
import { emit } from "./progression.js";
import { articleUrl } from "./wiki.js";

type CaseRow = typeof schema.caseBoxes.$inferSelect;

const cb = schema.caseBoxes;
const fc = schema.playerFreeCases;

/** Ouvertures montrées dans « Gros tirages » : une légendaire ou mieux. */
const BIG_WIN_VALUE = 1_000;
const RECENT_WINS = 12;

const tierRank = (t: CaseTier) => CASE_TIERS.indexOf(t);

/** Caisses en vente maintenant dans la saison active, du Bronze à la Légendaire. */
async function onSale(db: DbOrTx, now: Date, season: number): Promise<CaseRow[]> {
  const rows = await db
    .select()
    .from(cb)
    .where(and(eq(cb.season, season), lte(cb.startsAt, now), gt(cb.endsAt, now)))
    .orderBy(asc(cb.endsAt), asc(cb.collection));
  return rows.sort((a, b) => a.collection.localeCompare(b.collection) || tierRank(a.tier) - tierRank(b.tier));
}

type ContentRow = {
  case_id: string;
  card_id: string;
  rarity: Rarity;
  title: string;
  atk: number;
  def: number;
  views_12m: string;
  thumb_url: string | null;
  page_url: string | null;
  owned: boolean;
};

/** Contenu des caisses, dans l'ordre d'affichage (rareté décroissante, puis le plus lu). */
async function contents(db: DbOrTx, caseIds: number[], season: number, viewerId: string) {
  if (!caseIds.length) return new Map<number, ContentRow[]>();
  const rows = await db.execute<ContentRow>(sql`
    select k.case_id, k.card_id, k.rarity, c.title, c.atk, c.def, c.views_12m, w.thumb_url, w.page_url,
           exists (select 1 from card_instances o where o.owner_id = ${viewerId} and o.card_id = k.card_id) as owned
    from case_cards k
    join cards c on c.season = ${season} and c.id = k.card_id
    left join wiki_summaries w on w.page_id = k.card_id
    where k.case_id in (${sql.join(
      caseIds.map((id) => sql`${id}`),
      sql`, `,
    )})
    order by k.case_id, k.pos
  `);
  const out = new Map<number, ContentRow[]>(caseIds.map((id) => [id, []]));
  for (const r of rows) out.get(Number(r.case_id))!.push(r);
  return out;
}

const catalogCard = (r: ContentRow, season: number): CardDTO => ({
  instanceId: null,
  cardId: Number(r.card_id),
  season,
  title: r.title,
  rarity: r.rarity,
  atk: r.atk,
  def: r.def,
  level: 1,
  views12m: Number(r.views_12m),
  thumbUrl: r.thumb_url,
  pageUrl: r.page_url ?? articleUrl(r.title),
  owned: r.owned,
});

function caseDTO(c: CaseRow, cards: ContentRow[], season: number): CaseDTO {
  const count = (r: Rarity) => cards.filter((x) => x.rarity === r).length;
  const single = (r: Rarity) =>
    CASE_ODDS[c.tier].filter((o) => o.rarity === r && o.lot === 1).reduce((s, o) => s + o.weight, 0) / CASE_TOTAL;
  return {
    id: c.id,
    collection: c.collection,
    tier: c.tier,
    price: CASE_PRICES[c.tier],
    startsAt: c.startsAt.toISOString(),
    endsAt: c.endsAt.toISOString(),
    cards: cards.map((r): CaseCardDTO => ({ ...catalogCard(r, season), chance: single(r.rarity) / count(r.rarity) })),
    outcomes: CASE_ODDS[c.tier].map((o) => ({ rarity: o.rarity, lot: o.lot, chance: o.weight / CASE_TOTAL })),
    expectedValue: Math.round(caseExpectedValue(c.tier)),
  };
}

async function recentWins(db: DbOrTx, viewerId: string): Promise<CaseWinDTO[]> {
  const rows = await db
    .select({
      id: schema.caseOpenings.id,
      userId: schema.caseOpenings.userId,
      rarity: schema.caseOpenings.rarity,
      lot: schema.caseOpenings.lot,
      value: schema.caseOpenings.value,
      instanceIds: schema.caseOpenings.instanceIds,
      createdAt: schema.caseOpenings.createdAt,
      collection: cb.collection,
      tier: cb.tier,
      username: schema.user.username,
      displayName: sql<string>`coalesce(${schema.user.displayUsername}, ${schema.user.name})`,
      avatar: schema.players.avatar,
    })
    .from(schema.caseOpenings)
    .innerJoin(cb, eq(cb.id, schema.caseOpenings.caseId))
    .innerJoin(schema.user, eq(schema.user.id, schema.caseOpenings.userId))
    .innerJoin(schema.players, eq(schema.players.userId, schema.caseOpenings.userId))
    .where(gte(schema.caseOpenings.value, BIG_WIN_VALUE))
    .orderBy(desc(schema.caseOpenings.createdAt))
    .limit(RECENT_WINS);
  const firstIds = rows.map((r) => r.instanceIds[0]).filter((id): id is number => id !== undefined);
  const cards = new Map((await instancesByIds(db, firstIds, viewerId)).map((c) => [c.instanceId!, c]));
  return rows.map((r) => ({
    id: r.id,
    player: { username: r.username ?? "", displayName: r.displayName, avatar: r.avatar },
    collection: r.collection,
    tier: r.tier,
    rarity: r.rarity,
    lot: r.lot,
    value: r.value,
    card: cards.get(r.instanceIds[0]!) ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function casesState(ctx: Ctx, userId: string): Promise<CasesDTO> {
  const season = await activeSeason(ctx.db);
  const list = await onSale(ctx.db, ctx.now(), season);
  const content = await contents(
    ctx.db,
    list.map((c) => c.id),
    season,
    userId,
  );
  const collections = new Map<string, CaseCollectionDTO>();
  for (const c of list) {
    const col = collections.get(c.collection) ?? { name: c.collection, endsAt: c.endsAt.toISOString(), cases: [] };
    col.cases.push(caseDTO(c, content.get(c.id)!, season));
    if (c.endsAt.toISOString() < col.endsAt) col.endsAt = c.endsAt.toISOString();
    collections.set(c.collection, col);
  }
  // Vignettes pas encore en cache : chargées en arrière-plan, la page se met à jour toute seule.
  const missing = [...content.values()].flat().filter((r) => !r.thumb_url);
  if (missing.length)
    loadMediaInBackground(
      ctx,
      userId,
      missing.slice(0, 60).map((r) => ({ cardId: Number(r.card_id), title: r.title })),
    );
  return {
    collections: [...collections.values()],
    free: await freeCases(ctx.db, userId),
    recent: await recentWins(ctx.db, userId),
  };
}

/**
 * Ouvre une caisse (`count` = 1 ou 5), avec des PW ou avec les caisses gratuites du joueur de ce niveau. Le
 * résultat est tiré ici, avant toute animation ; la bande renvoyée est tirée selon les vraies chances.
 */
export async function openCase(
  ctx: Ctx,
  userId: string,
  caseId: number,
  count: number,
  useFree: boolean,
): Promise<CaseOpenDTO> {
  if (count !== 1 && count !== CASE_MULTI_OPEN) throw badRequest("case_count", "Une ou cinq caisses à la fois.");
  const now = ctx.now();
  const res = await ctx.db.transaction(async (tx) => {
    const player = await lockPlayer(tx, userId);
    const season = await activeSeason(tx);
    const [box] = await tx.select().from(cb).where(eq(cb.id, caseId));
    if (!box || box.season !== season || box.startsAt > now || box.endsAt <= now)
      throw notFound("Cette caisse n'est plus en vente.");
    const content = (await contents(tx, [box.id], season, userId)).get(box.id)!;
    const byRarity: Partial<Record<Rarity, ContentRow[]>> = {};
    content.forEach((r) => (byRarity[r.rarity] ??= []).push(r));
    const price = CASE_PRICES[box.tier];
    const ref = `case:${box.id}`;

    if (useFree) {
      const used = await tx
        .update(fc)
        .set({ count: sql`${fc.count} - ${count}` })
        .where(and(eq(fc.userId, userId), eq(fc.tier, box.tier), gte(fc.count, count)))
        .returning({ count: fc.count });
      if (!used.length)
        throw conflict(
          "no_free_case",
          count > 1 ? "Pas assez de caisses gratuites de ce niveau." : "Plus de caisse gratuite de ce niveau.",
        );
      await logMovement(tx, userId, "free_case", -count, used[0]!.count, "case_open", ref);
    } else {
      if (player.balance - player.lockedBalance < price * count)
        throw conflict(
          "insufficient_pw",
          `Il faut ${price * count} PW pour ${count > 1 ? "ces caisses" : "cette caisse"}.`,
        );
      await movePw(tx, player, -price * count, "case_purchase", ref);
    }

    const indexOf = new Map(content.map((r, i) => [Number(r.card_id), i]));
    const indices: Partial<Record<Rarity, number[]>> = {};
    for (const [r, list] of Object.entries(byRarity))
      indices[r as Rarity] = list.map((x) => indexOf.get(Number(x.card_id))!);

    const opened: { tiles: ReelTile[]; rarity: Rarity; lot: number; instanceIds: number[]; value: number }[] = [];
    const pulls: Parameters<typeof logPulls>[3] = [];
    let shinies = 0;
    for (let i = 0; i < count; i++) {
      const outcome = CASE_ODDS[box.tier][rollCase(box.tier, ctx.random)]!;
      const pool = byRarity[outcome.rarity] ?? [];
      if (!pool.length) throw conflict("case_empty", "Cette caisse est vide pour cette rareté : préviens l'admin.");
      const won = outcome.lot > 1 ? pickLot(pool, outcome.lot, ctx.random) : [pool[ctx.random(pool.length)]!];
      const values = won.map((card) => ({ card, shiny: rollSourceShiny("case", ctx.random) }));
      const rows = await tx
        .insert(schema.cardInstances)
        .values(
          values.map(({ card, shiny }) => ({
            ownerId: userId,
            cardId: Number(card.card_id),
            season,
            rarity: card.rarity,
            atk: card.atk,
            def: card.def,
            shiny,
            source: "case" as const,
            obtainedAt: now,
          })),
        )
        .returning({ id: schema.cardInstances.id });
      shinies += values.filter((v) => v.shiny).length;
      for (const { card, shiny } of values)
        pulls.push({ cardId: Number(card.card_id), season, rarity: card.rarity, shiny, title: card.title });
      const win: ReelTile =
        outcome.lot > 1
          ? { kind: "lot", lot: outcome.lot }
          : { kind: "card", index: indexOf.get(Number(won[0]!.card_id))! };
      const value = values.reduce((s, v) => s + recycleValue(v.card.rarity, v.shiny), 0);
      const instanceIds = rows.map((r) => r.id);
      await tx.insert(schema.caseOpenings).values({
        userId,
        caseId: box.id,
        free: useFree,
        price: useFree ? 0 : price,
        rarity: outcome.rarity,
        lot: outcome.lot,
        value,
        instanceIds,
        createdAt: now,
      });
      opened.push({
        tiles: buildReel(box.tier, indices, win, ctx.random),
        rarity: outcome.rarity,
        lot: outcome.lot,
        instanceIds,
        value,
      });
    }
    await logMovement(tx, userId, "card", pulls.length, await ownedCount(tx, userId), "case_open", ref);
    const notable = await logPulls(tx, userId, "case", pulls);
    return { player, content, opened, pulls, notable, shinies, tier: box.tier };
  });

  const all = await instancesByIds(
    ctx.db,
    res.opened.flatMap((o) => o.instanceIds),
    userId,
  );
  const byId = new Map(all.map((c) => [c.instanceId!, c]));
  const cardIdAt = (index: number) => Number(res.content[index]!.card_id);
  await afterCommit(ctx, async () => {
    pushWallet(ctx, res.player);
    void emit(
      ctx,
      userId,
      { type: "case_opened", count: res.opened.length },
      ...(res.shinies ? [{ type: "shiny_obtained" as const, source: "case" as const, count: res.shinies }] : []),
      "collection",
    );
    loadMediaInBackground(
      ctx,
      userId,
      res.pulls.map((p) => ({ cardId: p.cardId, title: p.title })),
    );
    await announcePulls(ctx, userId, res.notable);
  });
  const results: CaseResultDTO[] = res.opened.map((o) => ({
    tiles: o.tiles.map((t) => (t.kind === "lot" ? t : { kind: "card", cardId: cardIdAt(t.index) })),
    winIndex: REEL_WIN_INDEX,
    rarity: o.rarity,
    lot: o.lot,
    cards: o.instanceIds.map((id) => byId.get(id)).filter((c): c is CardDTO => !!c),
    value: o.value,
  }));
  return { results, free: await freeCases(ctx.db, userId), wallet: wallet(res.player), usedFree: useFree };
}
