import { and, desc, eq, gt, schema, sql } from "@palacards/db";
import { RARITIES, type Rarity } from "@palacards/game";
import type { ThemeDTO } from "@palacards/shared";
import type { Ctx } from "../context.js";
import { badRequest, conflict, notFound } from "../errors.js";
import { drawCard } from "./packs.js";
import { activeSeason, logMovement, type DbOrTx } from "./players.js";
import { articleUrl, cleanCategory } from "./wiki.js";

type Tx = Parameters<Parameters<Ctx["db"]["transaction"]>[0]>[0];
type Theme = typeof schema.themes.$inferSelect;

/** Un thème en dessous de ce nombre d'articles tirerait presque toujours hors thème. */
export const THEME_MIN_CARDS = 5;
/** Catégories Wikipédia par thème (chacune lue avec ses sous-catégories). */
export const THEME_MAX_CATEGORIES = 10;
/** Séparateur des catégories en base (colonne `category`) : « | » est interdit dans les titres MediaWiki. */
const CATEGORY_SEP = "|";
/** Catégories d'un thème telles qu'enregistrées. */
export const splitCategories = (stored: string | null) => (stored ? stored.split(CATEGORY_SEP).filter(Boolean) : []);
const PREVIEW_SIZE = 4;

export interface ThemeInput {
  name: string;
  description?: string;
  categories: string[];
  depth: number;
  titles: string[];
  price: number;
  /** Sans carte légendaire : les articles L de la saison sont écartés du thème et le tirage L devient UR. */
  noLegendary?: boolean;
  startsAt: Date;
  endsAt: Date;
  /** Essai à blanc : tout est calculé puis annulé (rien n'est créé). */
  dryRun?: boolean;
}

/** Annule la transaction d'un essai à blanc en emportant son résultat. */
class DryRun<T> extends Error {
  constructor(readonly result: T) {
    super("dry run");
  }
}

/**
 * Crée un booster à thème : articles des catégories Wikipédia (sous-catégories comprises jusqu'à `depth`)
 * et titres ajoutés à la main, gardés seulement s'ils existent dans les cartes de la saison active.
 */
export async function createTheme(ctx: Ctx, adminId: string, input: ThemeInput) {
  try {
    return await buildTheme(ctx, adminId, input);
  } catch (err) {
    if (err instanceof DryRun) return err.result as Awaited<ReturnType<typeof buildTheme>>;
    throw err;
  }
}

async function buildTheme(ctx: Ctx, adminId: string, input: ThemeInput) {
  const categories = [...new Set(input.categories.map(cleanCategory).filter(Boolean))].slice(0, THEME_MAX_CATEGORIES);
  if (!categories.length && !input.titles.length)
    throw badRequest("empty_theme", "Donne une catégorie Wikipédia ou une liste de titres.");
  const pageIds = new Set<number>();
  for (const category of categories) {
    try {
      for (const id of await ctx.wiki.categoryMembers(category, input.depth)) pageIds.add(id);
    } catch (err) {
      ctx.log.warn({ err, category }, "catégorie Wikipédia");
      throw conflict(
        "wiki_unavailable",
        `Impossible de lire la catégorie « ${category} » sur Wikipédia pour l'instant.`,
      );
    }
  }
  const season = await activeSeason(ctx.db);
  const titles = [...new Set(input.titles.map((t) => t.trim().replace(/_/g, " ")).filter(Boolean))];

  return ctx.db.transaction(async (tx) => {
    const [theme] = await tx
      .insert(schema.themes)
      .values({
        name: input.name,
        description: input.description ?? "",
        category: categories.length ? categories.join(CATEGORY_SEP) : null,
        price: input.price,
        noLegendary: !!input.noLegendary,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        createdBy: adminId,
      })
      .returning();
    // Les titres du dump ont leur première lettre en majuscule : « jeu vidéo » retrouve « Jeu vidéo ».
    const byTitle = titles.map((t) => t.charAt(0).toUpperCase() + t.slice(1));
    const inserted = await tx.execute<{ card_id: string }>(sql`
      insert into theme_cards (theme_id, card_id)
      select ${theme!.id}, id from cards
      where season = ${season}
        ${input.noLegendary ? sql`and rarity <> 'L'::rarity` : sql``}
        and (id in (select jsonb_array_elements_text(${JSON.stringify([...pageIds])}::jsonb)::bigint)
          or title in (select jsonb_array_elements_text(${JSON.stringify(byTitle)}::jsonb)))
      on conflict do nothing
      returning card_id
    `);
    if (inserted.length < THEME_MIN_CARDS)
      throw conflict(
        "theme_too_small",
        `Seulement ${inserted.length} article(s) de ce thème dans les cartes (minimum ${THEME_MIN_CARDS}) : élargis la catégorie ou la profondeur.`,
      );
    await tx.update(schema.themes).set({ cardCount: inserted.length }).where(eq(schema.themes.id, theme!.id));
    const result = {
      ...theme!,
      categories,
      cardCount: inserted.length,
      byRarity: await rarityCounts(tx, theme!.id, season),
      dryRun: !!input.dryRun,
    };
    if (input.dryRun) throw new DryRun(result);
    return result;
  });
}

/** Termine un thème tout de suite (la vente s'arrête ; les boosters déjà achetés restent ouvrables). */
export async function endTheme(ctx: Ctx, themeId: number) {
  const now = ctx.now();
  const [row] = await ctx.db
    .update(schema.themes)
    .set({ endsAt: sql`greatest(${schema.themes.startsAt} + interval '1 second', ${now.toISOString()}::timestamptz)` })
    .where(and(eq(schema.themes.id, themeId), gt(schema.themes.endsAt, now)))
    .returning({ id: schema.themes.id });
  if (!row) throw conflict("theme_ended", "Ce thème est déjà terminé.");
}

/** Nombre de boosters à thème en vente en ce moment. */
export async function themesOnSale(ctx: Ctx): Promise<number> {
  const now = ctx.now();
  const [row] = await ctx.db.execute<{ n: number }>(
    sql`select count(*)::int as n from themes where starts_at <= ${now.toISOString()}::timestamptz and ends_at > ${now.toISOString()}::timestamptz`,
  );
  return row?.n ?? 0;
}

export function isOnSale(theme: Pick<Theme, "startsAt" | "endsAt">, now: Date) {
  return theme.startsAt <= now && now < theme.endsAt;
}

/** Booster à thème en vente qui se termine le plus tôt (celui que donnent les roues du jour). */
export async function endingSoonestTheme(db: DbOrTx, now: Date): Promise<{ id: number; name: string } | null> {
  const [row] = await db
    .select({ id: schema.themes.id, name: schema.themes.name })
    .from(schema.themes)
    .where(and(sql`${schema.themes.startsAt} <= ${now.toISOString()}::timestamptz`, gt(schema.themes.endsAt, now)))
    .orderBy(schema.themes.endsAt, schema.themes.id)
    .limit(1);
  return row ?? null;
}

/** Articles du thème par rareté, dans la saison active. */
async function rarityCounts(db: DbOrTx, themeId: number, season: number): Promise<Record<Rarity, number>> {
  const rows = await db.execute<{ rarity: Rarity; n: number }>(sql`
    select c.rarity, count(*)::int as n
    from theme_cards tc join cards c on c.season = ${season} and c.id = tc.card_id
    where tc.theme_id = ${themeId}
    group by c.rarity
  `);
  const out = Object.fromEntries(RARITIES.map((r) => [r, 0])) as Record<Rarity, number>;
  for (const r of rows) out[r.rarity] = r.n;
  return out;
}

/**
 * Thèmes visibles par un joueur : en vente maintenant, à venir sous 7 jours, ou terminés dont il garde
 * des boosters. Avec les cartes phares (les plus rares, puis les plus lues) pour l'aperçu.
 */
export async function listThemes(ctx: Ctx, userId: string): Promise<ThemeDTO[]> {
  const now = ctx.now();
  const season = await activeSeason(ctx.db);
  const rows = await ctx.db.execute<{
    id: string;
    name: string;
    description: string;
    category: string | null;
    price: number;
    no_legendary: boolean;
    starts_at: Date;
    ends_at: Date;
    card_count: number;
    owned: number | null;
    opened: number | null;
  }>(sql`
    select t.id, t.name, t.description, t.category, t.price, t.no_legendary, t.starts_at, t.ends_at, t.card_count, p.count as owned,
      p.opened
    from themes t
    left join player_theme_packs p on p.theme_id = t.id and p.user_id = ${userId}
    where (t.ends_at > ${now.toISOString()}::timestamptz
       and t.starts_at < ${new Date(now.getTime() + 7 * 86_400_000).toISOString()}::timestamptz)
      or p.count > 0
    order by t.starts_at, t.id
  `);
  const out: ThemeDTO[] = [];
  for (const r of rows) {
    const id = Number(r.id);
    const preview = await ctx.db.execute<{
      id: string;
      title: string;
      rarity: Rarity;
      atk: number;
      def: number;
      thumb_url: string | null;
      page_url: string | null;
    }>(sql`
      select c.id, c.title, c.rarity, c.atk, c.def, s.thumb_url, s.page_url
      from theme_cards tc
      join cards c on c.season = ${season} and c.id = tc.card_id
      left join wiki_summaries s on s.page_id = c.id
      where tc.theme_id = ${id}
      order by c.rarity desc, c.views_12m desc
      limit ${PREVIEW_SIZE}
    `);
    const startsAt = new Date(r.starts_at);
    const endsAt = new Date(r.ends_at);
    out.push({
      id,
      name: r.name,
      description: r.description,
      categories: splitCategories(r.category),
      price: r.price,
      noLegendary: r.no_legendary,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      onSale: isOnSale({ startsAt, endsAt }, now),
      cardCount: r.card_count,
      owned: r.owned ?? 0,
      opened: r.opened ?? 0,
      byRarity: await rarityCounts(ctx.db, id, season),
      preview: preview.map((c) => ({
        instanceId: null,
        cardId: Number(c.id),
        season,
        title: c.title,
        rarity: c.rarity,
        atk: c.atk,
        def: c.def,
        level: 1,
        thumbUrl: c.thumb_url,
        pageUrl: c.page_url ?? articleUrl(c.title),
      })),
    });
  }
  return out;
}

/** Thèmes pour l'admin (les plus récents d'abord), avec les ventes. */
export async function adminThemes(ctx: Ctx) {
  const rows = await ctx.db
    .select({
      id: schema.themes.id,
      name: schema.themes.name,
      category: schema.themes.category,
      price: schema.themes.price,
      noLegendary: schema.themes.noLegendary,
      startsAt: schema.themes.startsAt,
      endsAt: schema.themes.endsAt,
      cardCount: schema.themes.cardCount,
      sold: sql<number>`(select count(*)::int from ledger l where l.reason = 'theme_pack' and l.kind = 'pw' and l.ref_id = 'theme:' || ${schema.themes.id})`,
    })
    .from(schema.themes)
    .orderBy(desc(schema.themes.id))
    .limit(50);
  const now = ctx.now();
  return rows.map(({ category, ...r }) => ({
    ...r,
    categories: splitCategories(category),
    startsAt: r.startsAt.toISOString(),
    endsAt: r.endsAt.toISOString(),
    onSale: isOnSale(r, now),
  }));
}

export async function getTheme(db: DbOrTx, themeId: number): Promise<Theme> {
  const [t] = await db.select().from(schema.themes).where(eq(schema.themes.id, themeId));
  if (!t) throw notFound("Ce booster à thème n'existe pas.");
  return t;
}

/** Ajoute (ou retire) des boosters à thème au stock d'un joueur verrouillé, avec la ligne de ledger. */
export async function addThemePacks(
  tx: Tx,
  userId: string,
  themeId: number,
  delta: number,
  reason: "promo_code" | "pack_open" | "wheel",
  refId?: string,
) {
  const pt = schema.playerThemePacks;
  // Retrait : mise à jour seule (la ligne proposée d'un upsert négatif violerait déjà la contrainte count >= 0).
  const [row] =
    delta < 0
      ? await tx
          .update(pt)
          .set({ count: sql`${pt.count} + ${delta}` })
          .where(and(eq(pt.userId, userId), eq(pt.themeId, themeId)))
          .returning({ count: pt.count })
      : await tx
          .insert(pt)
          .values({ userId, themeId, count: delta })
          .onConflictDoUpdate({ target: [pt.userId, pt.themeId], set: { count: sql`${pt.count} + ${delta}` } })
          .returning({ count: pt.count });
  if (!row) throw conflict("no_theme_packs", "Tu n'as pas de booster de ce thème.");
  await logMovement(tx, userId, "theme_pack", delta, row!.count, reason, refId ?? `theme:${themeId}`);
  return row!.count;
}

/** Stock de boosters d'un thème pour un joueur (ligne verrouillée). */
export async function lockThemeStock(tx: Tx, userId: string, themeId: number): Promise<number> {
  const [row] = await tx
    .select({ count: schema.playerThemePacks.count })
    .from(schema.playerThemePacks)
    .where(and(eq(schema.playerThemePacks.userId, userId), eq(schema.playerThemePacks.themeId, themeId)))
    .for("update");
  return row?.count ?? 0;
}

/**
 * Tire un article du thème de cette rareté (tirage uniforme par décalage : le thème compte au plus
 * quelques milliers d'articles). Aucun article du thème à cette rareté : tirage dans toute la saison.
 */
export async function drawThemeCard(
  tx: DbOrTx,
  season: number,
  themeId: number,
  rarity: Rarity,
  counts: Record<Rarity, number>,
  random: Ctx["random"],
) {
  const n = counts[rarity];
  if (n > 0) {
    const [row] = await tx.execute<{ id: string; title: string; atk: number; def: number }>(sql`
      select c.id, c.title, c.atk, c.def
      from theme_cards tc join cards c on c.season = ${season} and c.id = tc.card_id
      where tc.theme_id = ${themeId} and c.rarity = ${rarity}::rarity
      order by c.id offset ${random(n)} limit 1
    `);
    if (row) return { id: Number(row.id), title: row.title, atk: row.atk, def: row.def, themed: true };
  }
  return { ...(await drawCard(tx, season, rarity, random)), themed: false };
}

export { rarityCounts as themeRarityCounts };
