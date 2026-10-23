import { and, eq, schema, sql } from "@palacards/db";
import {
  parisDay,
  planShop,
  rollSourceShiny,
  SHOP_PRICES,
  SHOP_RARITIES,
  SHOP_SIZE,
  type ShopPool,
  type ShopRarity,
} from "@palacards/game";
import type { ShopBuyDTO, ShopDTO } from "@palacards/shared";
import type { Ctx } from "../context.js";
import { conflict, notFound } from "../errors.js";
import { arthropodFlags, loadMediaInBackground } from "./cards.js";
import { announcePulls, logPulls } from "./feed.js";
import { afterCommit } from "./notifications.js";
import { emit } from "./progression.js";
import { activeSeason, lockPlayer, logMovement, movePw, ownedCount, pushWallet, wallet } from "./players.js";
import { nextParisMidnight } from "./wheel.js";
import { articleUrl } from "./wiki.js";

const o = schema.shopOffers;
/** Candidats examinés par rareté pour composer la boutique (tirés via l'index de tirage, jamais ORDER BY random()). */
const CANDIDATES = 60;
/** Boutiques gardées en base (historique des achats) avant la purge de nuit. */
const SHOP_KEEP_DAYS = 30;
const RAND_SCALE = 2 ** 30;

/**
 * Candidats d'une rareté à partir d'une clé aléatoire (index `season, rarity, rand_key`), en rebouclant sur 0.
 * `unowned` : seulement les cartes que le joueur ne possède pas.
 */
async function sample(ctx: Ctx, userId: string, season: number, rarity: ShopRarity, unowned: boolean) {
  const key = ctx.random(RAND_SCALE) / RAND_SCALE;
  const filter = unowned
    ? sql`and not exists (select 1 from card_instances i where i.owner_id = ${userId} and i.card_id = c.id)`
    : sql``;
  const out: number[] = [];
  for (const from of [key, 0]) {
    const rows = await ctx.db.execute<{ id: string }>(sql`
      select c.id from cards c
      where c.season = ${season} and c.rarity = ${rarity}::rarity and c.rand_key >= ${from} ${filter}
      order by c.rand_key limit ${CANDIDATES}
    `);
    for (const r of rows) if (!out.includes(Number(r.id))) out.push(Number(r.id));
    if (out.length >= CANDIDATES) break;
  }
  return out.slice(0, CANDIDATES);
}

/**
 * Compose et fige la boutique du jour du joueur (première visite du jour) : 20 cartes de la saison active
 * (présentées normales : la brillance se tire à l'achat), rareté tirée pour chaque emplacement (SR 50 %, UR 35 %, L 15 %), les cartes non possédées
 * d'abord. Option « masquer les arthropodes » : les arthropodes connus sont écartés (les autres restent
 * floutés à l'affichage comme partout). Tirage côté serveur avec `ctx.random`. Joueur verrouillé : deux
 * premières visites simultanées ne créent qu'une boutique.
 */
async function ensureShop(ctx: Ctx, userId: string, day: string) {
  const existing = await ctx.db
    .select()
    .from(o)
    .where(and(eq(o.userId, userId), eq(o.day, day)))
    .orderBy(o.slot);
  if (existing.length) return existing;

  const season = await activeSeason(ctx.db);
  const [player] = await ctx.db
    .select({ hide: schema.players.hideArthropods })
    .from(schema.players)
    .where(eq(schema.players.userId, userId));
  const pools = {} as Record<ShopRarity, ShopPool>;
  for (const rarity of SHOP_RARITIES) {
    const fresh = await sample(ctx, userId, season, rarity, true);
    // Peu de cartes nouvelles (collection presque complète) : on complète avec n'importe quelle carte.
    const any =
      fresh.length < SHOP_SIZE
        ? (await sample(ctx, userId, season, rarity, false)).filter((id) => !fresh.includes(id))
        : [];
    pools[rarity] = { unowned: fresh, owned: any };
  }
  if (player?.hide) {
    const all = SHOP_RARITIES.flatMap((r) => [...pools[r].unowned, ...pools[r].owned]);
    const bugs = new Set((await arthropodFlags(ctx, userId, all)).arthropods);
    for (const r of SHOP_RARITIES)
      pools[r] = {
        unowned: pools[r].unowned.filter((id) => !bugs.has(id)),
        owned: pools[r].owned.filter((id) => !bugs.has(id)),
      };
  }
  const plan = planShop(ctx.random, pools);

  await ctx.db.transaction(async (tx) => {
    await lockPlayer(tx, userId);
    const [again] = await tx
      .select({ slot: o.slot })
      .from(o)
      .where(and(eq(o.userId, userId), eq(o.day, day)))
      .limit(1);
    if (again || !plan.length) return;
    await tx.insert(o).values(
      plan.map((p, slot) => ({
        userId,
        day,
        slot,
        cardId: p.cardId,
        season,
        rarity: p.rarity,
        price: SHOP_PRICES[p.rarity],
      })),
    );
  });
  return ctx.db
    .select()
    .from(o)
    .where(and(eq(o.userId, userId), eq(o.day, day)))
    .orderBy(o.slot);
}

/**
 * Boutique du jour du joueur : cartes (rendu habituel), prix, état « Achetée », renouvellement à minuit. Une carte
 * achetée s'affiche comme l'exemplaire obtenu (brillant ou non).
 */
export async function getShop(ctx: Ctx, userId: string): Promise<ShopDTO> {
  const now = ctx.now();
  const day = parisDay(now);
  const offers = await ensureShop(ctx, userId, day);
  const rows = offers.length
    ? await ctx.db.execute<{
        slot: number;
        card_id: string;
        season: number;
        title: string;
        rarity: ShopRarity;
        atk: number;
        def: number;
        views_12m: string;
        thumb_url: string | null;
        page_url: string | null;
        price: number;
        purchased_at: Date | string | null;
        owned: boolean;
        shiny: boolean;
      }>(sql`
        select o.slot, o.card_id, o.season, c.title, o.rarity, c.atk, c.def, c.views_12m, s.thumb_url, s.page_url,
               o.price, o.purchased_at,
               exists (select 1 from card_instances i where i.owner_id = ${userId} and i.card_id = o.card_id) as owned,
               coalesce(b.shiny, false) as shiny
        from shop_offers o
        join cards c on c.season = o.season and c.id = o.card_id
        left join wiki_summaries s on s.page_id = o.card_id
        left join card_instances b on b.id = o.instance_id
        where o.user_id = ${userId} and o.day = ${day}
        order by o.slot
      `)
    : [];
  const missing = rows.filter((r) => !r.thumb_url).map((r) => ({ cardId: Number(r.card_id), title: r.title }));
  if (missing.length) loadMediaInBackground(ctx, userId, missing);
  return {
    day,
    resetsAt: nextParisMidnight(now).toISOString(),
    items: rows.map((r) => ({
      slot: r.slot,
      price: r.price,
      purchased: !!r.purchased_at,
      card: {
        instanceId: null,
        cardId: Number(r.card_id),
        season: r.season,
        title: r.title,
        rarity: r.rarity,
        atk: r.atk,
        def: r.def,
        level: 1,
        shiny: r.shiny,
        views12m: Number(r.views_12m),
        thumbUrl: r.thumb_url,
        pageUrl: r.page_url ?? articleUrl(r.title),
        owned: r.owned,
      },
    })),
  };
}

/**
 * Achat d'une carte de la boutique du jour : une transaction (joueur verrouillé, offre verrouillée, solde
 * vérifié par `movePw`). Une offre déjà achetée est refusée : un double clic ou deux requêtes simultanées
 * n'achètent qu'une fois. La carte peut sortir brillante (tirée à l'achat, `SHINY_SOURCE_CHANCE.shop`) : elle
 * fait alors avancer les succès « Ça brille ! » (`SHINY_SOURCE_COUNTS.shop`). Elle
 * arrive avec la source `shop` : elle ne compte pas comme un tirage (succès de collection et de part de saison,
 * classement « Chance », objectif communautaire). Une légendaire ou une brillante apparaît dans le fil
 * d'activité comme « achetée en boutique ».
 */
export async function buyShopItem(ctx: Ctx, userId: string, slot: number): Promise<ShopBuyDTO> {
  const now = ctx.now();
  const day = parisDay(now);
  const res = await ctx.db.transaction(async (tx) => {
    const p = await lockPlayer(tx, userId);
    const [offer] = await tx
      .select()
      .from(o)
      .where(and(eq(o.userId, userId), eq(o.day, day), eq(o.slot, slot)))
      .for("update");
    if (!offer) throw notFound("Cette carte n'est plus en boutique : la sélection a changé à minuit.");
    if (offer.purchasedAt) throw conflict("already_bought", "Tu as déjà acheté cette carte.");
    const [card] = await tx
      .select()
      .from(schema.cards)
      .where(and(eq(schema.cards.season, offer.season), eq(schema.cards.id, offer.cardId)));
    if (!card) throw notFound("Cette carte n'existe plus.");
    const ref = `shop:${day}:${offer.cardId}`;
    await movePw(tx, p, -offer.price, "shop_purchase", ref);
    const shiny = rollSourceShiny("shop", ctx.random);
    const [inst] = await tx
      .insert(schema.cardInstances)
      .values({
        ownerId: userId,
        cardId: card.id,
        season: card.season,
        rarity: card.rarity,
        atk: card.atk,
        def: card.def,
        shiny,
        source: "shop",
        obtainedAt: now,
      })
      .returning({ id: schema.cardInstances.id });
    await tx
      .update(o)
      .set({ purchasedAt: now, instanceId: inst!.id })
      .where(and(eq(o.userId, userId), eq(o.day, day), eq(o.slot, slot)));
    await logMovement(tx, userId, "card", 1, await ownedCount(tx, userId), "shop_purchase", ref);
    const notable =
      card.rarity === "L" || shiny
        ? await logPulls(tx, userId, "shop", [
            { cardId: card.id, season: card.season, rarity: card.rarity, shiny, title: card.title },
          ])
        : [];
    return { player: p, instanceId: inst!.id, shiny, card, notable };
  });
  await afterCommit(ctx, async () => {
    pushWallet(ctx, res.player);
    if (res.shiny) void emit(ctx, userId, { type: "shiny_obtained", source: "shop", count: 1 });
    loadMediaInBackground(ctx, userId, [{ cardId: res.card.id, title: res.card.title }]);
    await announcePulls(ctx, userId, res.notable);
  });
  return { slot, instanceId: res.instanceId, shiny: res.shiny, wallet: wallet(res.player) };
}

/** Purge de nuit : boutiques de plus de 30 jours. */
export async function purgeOldShops(ctx: Ctx) {
  const rows = await ctx.db.execute(
    sql`delete from shop_offers where day < (now() at time zone 'Europe/Paris')::date - ${SHOP_KEEP_DAYS}::int`,
  );
  return rows.count;
}
