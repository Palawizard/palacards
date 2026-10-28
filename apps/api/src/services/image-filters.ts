import { and, desc, eq, inArray, schema, sql } from "@palacards/db";
import {
  IMAGE_FILTER_CATEGORIES,
  IMAGE_FILTER_SKIP_SUBCATEGORY,
  IMAGE_THEMES,
  isArthropod,
  isGore,
  isNudity,
  resolveImageThemes,
  type ImageTheme,
} from "@palacards/game";
import type { ImageFilterOverrideDTO } from "@palacards/shared";
import type { Ctx } from "../context.js";
import { notFound } from "../errors.js";
import type { DbOrTx, Player } from "./players.js";

const w = schema.wikiSummaries;
const fc = schema.imageFilterCards;
const fo = schema.imageFilterOverrides;

/** Thèmes que le joueur floute (Paramètres). */
export function hiddenThemes(p: Pick<Player, "hideArthropods" | "hideGore" | "hideNudity">): ImageTheme[] {
  return IMAGE_THEMES.filter((t) => (t === "arthropods" ? p.hideArthropods : t === "gore" ? p.hideGore : p.hideNudity));
}

export async function playerHiddenThemes(db: DbOrTx, userId: string): Promise<ImageTheme[]> {
  const [p] = await db
    .select({
      hideArthropods: schema.players.hideArthropods,
      hideGore: schema.players.hideGore,
      hideNudity: schema.players.hideNudity,
    })
    .from(schema.players)
    .where(eq(schema.players.userId, userId));
  return p ? hiddenThemes(p) : [];
}

/**
 * Thèmes des images de ces articles : indices du résumé en cache (le drapeau arthropode, calculé une fois, reste
 * gardé dans `wiki_summaries.arthropod`), membres des catégories (`image_filter_cards`), puis la liste Admin, qui
 * l'emporte. `pending` : articles sans résumé en cache (ni image) ; une carte de la liste Admin n'y est jamais.
 */
export async function imageThemesOf(
  db: DbOrTx,
  ids: number[],
): Promise<{ themes: Map<number, ImageTheme[]>; pending: number[] }> {
  const wanted = [...new Set(ids)];
  const themes = new Map<number, ImageTheme[]>();
  if (!wanted.length) return { themes, pending: [] };
  const [rows, members, overrides] = await Promise.all([
    db
      .select({ id: w.pageId, arthropod: w.arthropod, description: w.description, extract: w.extract })
      .from(w)
      .where(inArray(w.pageId, wanted)),
    db.select().from(fc).where(inArray(fc.cardId, wanted)),
    db.select().from(fo).where(inArray(fo.cardId, wanted)),
  ]);
  const todo = rows.filter((r) => r.arthropod === null).map((r) => ({ id: r.id, flag: isArthropod(r) }));
  if (todo.length) {
    const values = sql.join(
      todo.map((r) => sql`(${r.id}::bigint, ${r.flag}::boolean)`),
      sql`, `,
    );
    await db.execute(sql`
      update wiki_summaries s set arthropod = v.flag from (values ${values}) as v(id, flag)
      where s.page_id = v.id and s.arthropod is null
    `);
  }
  const computed = new Map(todo.map((r) => [r.id, r.flag]));
  const detected = new Map<number, Set<ImageTheme>>();
  const add = (id: number, t: ImageTheme) => detected.set(id, (detected.get(id) ?? new Set()).add(t));
  for (const r of rows) {
    if (computed.get(r.id) ?? r.arthropod) add(r.id, "arthropods");
    if (isGore(r)) add(r.id, "gore");
    if (isNudity(r)) add(r.id, "nudity");
  }
  for (const m of members) add(m.cardId, m.theme);
  const byCard = new Map<number, Map<ImageTheme, boolean>>();
  for (const o of overrides) byCard.set(o.cardId, (byCard.get(o.cardId) ?? new Map()).set(o.theme, o.flagged));
  for (const id of wanted) {
    const t = resolveImageThemes(detected.get(id) ?? [], byCard.get(id) ?? new Map());
    if (t.length) themes.set(id, t);
  }
  const known = new Set([...rows.map((r) => r.id), ...overrides.map((o) => o.cardId)]);
  return { themes, pending: wanted.filter((id) => !known.has(id)) };
}

/** Articles à cacher pour ce joueur parmi `ids` : ceux d'un thème qu'il floute. */
export async function hiddenFor(db: DbOrTx, userId: string, ids: number[]): Promise<Set<number>> {
  const hidden = await playerHiddenThemes(db, userId);
  if (!hidden.length || !ids.length) return new Set();
  const { themes } = await imageThemesOf(db, ids);
  return new Set([...themes].filter(([, t]) => t.some((x) => hidden.includes(x))).map(([id]) => id));
}

// ---------------------------------------------------------------------------
// Catégories Wikipédia (job hebdomadaire et bouton Admin)
// ---------------------------------------------------------------------------

export const IMAGE_FILTER_REFRESH_JOB = "image-filter-refresh";

/** Recharge les membres des catégories de chaque thème. Un thème sans réponse garde ses anciens membres. */
export async function refreshImageFilterCards(ctx: Ctx) {
  const summary: Record<string, number> = {};
  for (const [theme, categories] of Object.entries(IMAGE_FILTER_CATEGORIES) as [
    ImageTheme,
    typeof IMAGE_FILTER_CATEGORIES.gore,
  ][]) {
    const ids = new Set<number>();
    for (const c of categories) {
      try {
        for (const id of await ctx.wiki.categoryMembers(c.name, c.depth, IMAGE_FILTER_SKIP_SUBCATEGORY)) ids.add(id);
      } catch (err) {
        ctx.log.warn({ err, category: c.name }, "catégorie de filtre d'images illisible");
      }
      // Politesse envers l'API Wikimédia : une catégorie à la fois, avec une pause.
      await new Promise((r) => setTimeout(r, 500));
    }
    summary[theme] = ids.size;
    if (!ids.size) continue;
    await ctx.db.transaction(async (tx) => {
      await tx.delete(fc).where(eq(fc.theme, theme));
      const list = [...ids];
      for (let i = 0; i < list.length; i += 5_000)
        await tx
          .insert(fc)
          .values(list.slice(i, i + 5_000).map((cardId) => ({ cardId, theme })))
          .onConflictDoNothing();
    });
  }
  ctx.log.info(summary, "catégories des filtres d'images rechargées");
  return summary;
}

/** Aucune carte encore repérée par catégorie (jamais rechargé). */
export async function imageFilterCardsEmpty(ctx: Ctx): Promise<boolean> {
  const [row] = await ctx.db.select({ id: fc.cardId }).from(fc).limit(1);
  return !row;
}

let refreshing = false;
/** Lance le rechargement en arrière-plan (un seul à la fois) ; false s'il tourne déjà. */
export function startImageFilterRefresh(ctx: Ctx): boolean {
  if (refreshing) return false;
  refreshing = true;
  void refreshImageFilterCards(ctx)
    .catch((err) => ctx.log.error({ err }, "catégories des filtres d'images"))
    .finally(() => (refreshing = false));
  return true;
}

// ---------------------------------------------------------------------------
// Admin : liste manuelle
// ---------------------------------------------------------------------------

/** Liste manuelle (les plus récents d'abord) et nombre de cartes repérées par catégorie, par thème. */
export async function adminImageFilters(ctx: Ctx) {
  const rows = await ctx.db.execute<{
    card_id: string;
    theme: ImageTheme;
    flagged: boolean;
    created_at: Date | string;
    title: string | null;
    thumb_url: string | null;
    by: string | null;
  }>(sql`
    select o.card_id, o.theme, o.flagged, o.created_at, w.thumb_url,
           (select c.title from cards c where c.id = o.card_id order by c.season desc limit 1) as title,
           (select coalesce(u.display_username, u.name) from "user" u where u.id = o.created_by) as by
    from image_filter_overrides o left join wiki_summaries w on w.page_id = o.card_id
    order by o.created_at desc
  `);
  const counts = await ctx.db
    .select({ theme: fc.theme, n: sql<number>`count(*)::int` })
    .from(fc)
    .groupBy(fc.theme);
  return {
    overrides: rows.map((r): ImageFilterOverrideDTO => ({
      cardId: Number(r.card_id),
      title: r.title ?? `Article ${r.card_id}`,
      thumbUrl: r.thumb_url,
      theme: r.theme,
      flagged: r.flagged,
      by: r.by,
      createdAt: new Date(r.created_at).toISOString(),
    })),
    categoryCounts: Object.fromEntries(IMAGE_THEMES.map((t) => [t, counts.find((c) => c.theme === t)?.n ?? 0])),
  };
}

/** Ajoute (`true`) ou retire (`false`) une carte d'un thème, ou rend la main à la détection (`null`). */
export async function setImageFilterOverride(
  ctx: Ctx,
  adminId: string,
  cardId: number,
  theme: ImageTheme,
  flagged: boolean | null,
) {
  const [card] = await ctx.db
    .select({ id: schema.cards.id })
    .from(schema.cards)
    .where(eq(schema.cards.id, cardId))
    .limit(1);
  if (!card) throw notFound("Cette carte n'existe pas.");
  if (flagged === null) {
    await ctx.db.delete(fo).where(and(eq(fo.cardId, cardId), eq(fo.theme, theme)));
  } else {
    await ctx.db
      .insert(fo)
      .values({ cardId, theme, flagged, createdBy: adminId, createdAt: ctx.now() })
      .onConflictDoUpdate({
        target: [fo.cardId, fo.theme],
        set: { flagged, createdBy: adminId, createdAt: ctx.now() },
      });
  }
  return (await imageThemesOf(ctx.db, [cardId])).themes.get(cardId) ?? [];
}

/** Cartes trouvées par titre pour la liste Admin (titre exact d'abord). */
export async function searchFilterCards(ctx: Ctx, q: string) {
  const term = q.trim();
  if (/^\d+$/.test(term)) {
    const rows = await ctx.db
      .selectDistinctOn([schema.cards.id], { id: schema.cards.id, title: schema.cards.title })
      .from(schema.cards)
      .where(eq(schema.cards.id, Number(term)))
      .orderBy(schema.cards.id, desc(schema.cards.season));
    return withThemes(ctx, rows);
  }
  const rows = await ctx.db.execute<{ id: string; title: string }>(sql`
    select distinct on (c.id) c.id, c.title from cards c
    where c.search_title like '%' || lower(f_unaccent(${term.replace(/[\\%_]/g, "\\$&")})) || '%'
    order by c.id, c.season desc
    limit 200
  `);
  const sorted = rows
    .map((r) => ({ id: Number(r.id), title: r.title }))
    .sort(
      (a, b) =>
        Number(b.title.toLowerCase() === term.toLowerCase()) - Number(a.title.toLowerCase() === term.toLowerCase()) ||
        a.title.length - b.title.length,
    )
    .slice(0, 12);
  return withThemes(ctx, sorted);
}

async function withThemes(ctx: Ctx, rows: { id: number; title: string }[]) {
  const { themes } = await imageThemesOf(
    ctx.db,
    rows.map((r) => r.id),
  );
  const media = await ctx.wiki.cached(rows.map((r) => r.id));
  return rows.map((r) => ({
    cardId: r.id,
    title: r.title,
    thumbUrl: media.get(r.id)?.thumbUrl ?? null,
    themes: themes.get(r.id) ?? [],
  }));
}
