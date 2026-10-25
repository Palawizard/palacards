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
      byRarity: (await indexTheme(tx, theme!.id, season)).byRarity,
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

/** Clé (premier entier) des verrous consultatifs « index d'un thème ». */
const THEME_INDEX_LOCK = 7_301;

/** Index de tirage d'un thème pour une saison : articles par rareté et cartes phares. */
export interface ThemeIndex {
  byRarity: Record<Rarity, number>;
  previewIds: number[];
}

const fullCounts = (partial: Partial<Record<Rarity, number>> | null | undefined): Record<Rarity, number> =>
  Object.fromEntries(RARITIES.map((r) => [r, partial?.[r] ?? 0])) as Record<Rarity, number>;

type IndexedTheme = Pick<Theme, "id" | "indexedSeason" | "byRarity" | "previewIds">;

/** L'index enregistré du thème vaut-il pour cette saison ? */
const indexFresh = (t: IndexedTheme, season: number) =>
  t.indexedSeason === season && t.byRarity != null && t.previewIds != null;

/**
 * Index de tirage d'un thème, recalculé s'il date d'une autre saison (ou s'il a été remis à null, par
 * exemple après un ajout d'articles en SQL : `update themes set indexed_season = null where id = …`).
 *
 * Avant cet index, chaque ouverture comptait les articles par rareté puis tirait chaque carte par un décalage
 * aléatoire, en joignant tout le thème aux 2,6 millions de cartes : 3 à 4 s de calcul par booster sur 2 cœurs,
 * et la liste des boosters refaisait ces comptes pour chaque thème. Ici, une seule fois par saison : chaque
 * article reçoit sa rareté et son rang (0, 1, 2…) parmi ceux de sa rareté, et le tirage lit un rang au hasard.
 */
export async function themeIndex(db: DbOrTx, theme: IndexedTheme, season: number): Promise<ThemeIndex> {
  if (indexFresh(theme, season)) return { byRarity: fullCounts(theme.byRarity), previewIds: theme.previewIds! };
  return db.transaction((tx) => indexTheme(tx, theme.id, season));
}

async function indexTheme(tx: Tx, themeId: number, season: number): Promise<ThemeIndex> {
  // Deux requêtes simultanées sur un thème à indexer : la seconde attend puis lit l'index de la première.
  await tx.execute(sql`select pg_advisory_xact_lock(${THEME_INDEX_LOCK}, ${themeId}::int)`);
  const [t] = await tx
    .select({
      id: schema.themes.id,
      indexedSeason: schema.themes.indexedSeason,
      byRarity: schema.themes.byRarity,
      previewIds: schema.themes.previewIds,
    })
    .from(schema.themes)
    .where(eq(schema.themes.id, themeId));
  if (!t) throw notFound("Ce booster à thème n'existe pas.");
  if (indexFresh(t, season)) return { byRarity: fullCounts(t.byRarity), previewIds: t.previewIds! };

  await tx.execute(sql`update theme_cards set rarity = null, pos = null where theme_id = ${themeId}`);
  await tx.execute(sql`
    with ranked as (
      select tc.card_id, c.rarity,
        (row_number() over (partition by c.rarity order by tc.card_id) - 1)::int as pos
      from theme_cards tc join cards c on c.season = ${season} and c.id = tc.card_id
      where tc.theme_id = ${themeId}
    )
    update theme_cards tc set rarity = r.rarity, pos = r.pos
    from ranked r where tc.theme_id = ${themeId} and tc.card_id = r.card_id
  `);
  const counts = await tx.execute<{ rarity: Rarity; n: number }>(sql`
    select rarity, count(*)::int as n from theme_cards
    where theme_id = ${themeId} and rarity is not null group by rarity
  `);
  const byRarity = fullCounts(Object.fromEntries(counts.map((r) => [r.rarity, r.n])));
  const preview = await tx.execute<{ id: string }>(sql`
    select c.id from theme_cards tc join cards c on c.season = ${season} and c.id = tc.card_id
    where tc.theme_id = ${themeId}
    order by c.rarity desc, c.views_12m desc
    limit ${PREVIEW_SIZE}
  `);
  const previewIds = preview.map((r) => Number(r.id));
  await tx
    .update(schema.themes)
    .set({ indexedSeason: season, byRarity, previewIds })
    .where(eq(schema.themes.id, themeId));
  return { byRarity, previewIds };
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
    starts_at: Date;
    ends_at: Date;
    card_count: number;
    indexed_season: number | null;
    by_rarity: Partial<Record<Rarity, number>> | null;
    preview_ids: number[] | null;
    owned: number | null;
    opened: number | null;
  }>(sql`
    select t.id, t.name, t.description, t.category, t.price, t.starts_at, t.ends_at, t.card_count,
      t.indexed_season, t.by_rarity, t.preview_ids, p.count as owned, p.opened
    from themes t
    left join player_theme_packs p on p.theme_id = t.id and p.user_id = ${userId}
    where (t.ends_at > ${now.toISOString()}::timestamptz
       and t.starts_at < ${new Date(now.getTime() + 7 * 86_400_000).toISOString()}::timestamptz)
      or p.count > 0
    order by t.starts_at, t.id
  `);
  const indexes = new Map<number, ThemeIndex>();
  for (const r of rows) {
    const id = Number(r.id);
    indexes.set(
      id,
      await themeIndex(
        ctx.db,
        { id, indexedSeason: r.indexed_season, byRarity: r.by_rarity, previewIds: r.preview_ids },
        season,
      ),
    );
  }
  // Les cartes phares de tous les thèmes en une requête (par clé primaire).
  const ids = [...new Set([...indexes.values()].flatMap((i) => i.previewIds))];
  const cards = ids.length
    ? await ctx.db.execute<{
        id: string;
        title: string;
        rarity: Rarity;
        atk: number;
        def: number;
        thumb_url: string | null;
        page_url: string | null;
      }>(sql`
        select c.id, c.title, c.rarity, c.atk, c.def, s.thumb_url, s.page_url
        from cards c left join wiki_summaries s on s.page_id = c.id
        where c.season = ${season}
          and c.id in (select jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb)::bigint)
      `)
    : [];
  const byId = new Map(cards.map((c) => [Number(c.id), c]));
  return rows.map((r) => {
    const id = Number(r.id);
    const index = indexes.get(id)!;
    const startsAt = new Date(r.starts_at);
    const endsAt = new Date(r.ends_at);
    return {
      id,
      name: r.name,
      description: r.description,
      categories: splitCategories(r.category),
      price: r.price,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      onSale: isOnSale({ startsAt, endsAt }, now),
      cardCount: r.card_count,
      owned: r.owned ?? 0,
      opened: r.opened ?? 0,
      byRarity: index.byRarity,
      preview: index.previewIds.flatMap((cardId) => {
        const c = byId.get(cardId);
        return c
          ? [
              {
                instanceId: null,
                cardId,
                season,
                title: c.title,
                rarity: c.rarity,
                atk: c.atk,
                def: c.def,
                level: 1,
                thumbUrl: c.thumb_url,
                pageUrl: c.page_url ?? articleUrl(c.title),
              },
            ]
          : [];
      }),
    };
  });
}

/** Thèmes pour l'admin (les plus récents d'abord), avec les ventes. */
export async function adminThemes(ctx: Ctx) {
  const rows = await ctx.db
    .select({
      id: schema.themes.id,
      name: schema.themes.name,
      category: schema.themes.category,
      price: schema.themes.price,
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
 * Tire un article du thème de cette rareté : un rang au hasard, lu par l'index (thème, rareté, rang).
 * Aucun article du thème à cette rareté : tirage dans toute la saison.
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
      where tc.theme_id = ${themeId} and tc.rarity = ${rarity}::rarity and tc.pos = ${random(n)}
    `);
    if (row) return { id: Number(row.id), title: row.title, atk: row.atk, def: row.def, themed: true };
  }
  return { ...(await drawCard(tx, season, rarity, random)), themed: false };
}
