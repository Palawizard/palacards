import { schema, type Db } from "@palacards/db";
import { isArthropod } from "@palacards/game";
import type { CardMedia } from "@palacards/shared";
import { and, eq, inArray, sql } from "@palacards/db";
import type { FastifyBaseLogger } from "fastify";
import type { Config } from "../config.js";

const MAX_PARALLEL = 5;
/** Version du cache `wiki_summaries` : 2 = avec la description courte. */
const SUMMARY_VERSION = 2;

/** Résumé d'article en cache, description comprise. */
export interface ArticleSummary {
  extract: string | null;
  description: string | null;
  thumbUrl: string | null;
  pageUrl: string | null;
}
const REST = "https://fr.wikipedia.org/api/rest_v1/page/summary/";
const ACTION_API = "https://fr.wikipedia.org/w/api.php";
const WIKIDATA_API = "https://www.wikidata.org/w/api.php";
/** Éléments par appel à l'API (plafond de MediaWiki pour `pageids` et `ids`). */
const BATCH = 50;

/** Attributs Wikidata d'un article (article du jour, dates des questions du boss). */
export interface WikiAttributes {
  qid: string | null;
  human: boolean;
  countryId: string | null;
  country: string | null;
  continents: string[];
  year: number | null;
  yearKind: "birth" | "inception" | "publication" | "start" | null;
}

type Claim = {
  rank?: string;
  mainsnak?: { datavalue?: { value?: { id?: string; time?: string } | string } };
};
type Entity = { claims?: Record<string, Claim[]>; labels?: Record<string, { value: string }>; missing?: string };

/** Valeurs d'une propriété, rang « préféré » d'abord, sans les valeurs dépréciées. */
function claimValues(entity: Entity | undefined, prop: string): (string | { id?: string; time?: string })[] {
  const claims = (entity?.claims?.[prop] ?? []).filter((c) => c.rank !== "deprecated");
  claims.sort((a, b) => Number(b.rank === "preferred") - Number(a.rank === "preferred"));
  return claims.map((c) => c.mainsnak?.datavalue?.value).filter((v): v is NonNullable<typeof v> => v !== undefined);
}

const firstId = (entity: Entity | undefined, prop: string) => {
  for (const v of claimValues(entity, prop)) if (typeof v === "object" && v.id) return v.id;
  return null;
};

/** Année d'une date Wikidata (« +1952-03-11T00:00:00Z », « -0052-00-00T00:00:00Z »). */
export function wikidataYear(time: string | undefined): number | null {
  const m = time?.match(/^([+-])0*(\d{1,4})-/);
  if (!m) return null;
  const year = Number(m[2]) * (m[1] === "-" ? -1 : 1);
  return year === 0 || Math.abs(year) > 9_999 ? null : year;
}

/** Date retenue : naissance pour une personne ; sinon sortie, création ou fondation, début. */
const YEAR_PROPS: { prop: string; kind: NonNullable<WikiAttributes["yearKind"]>; human?: boolean }[] = [
  { prop: "P569", kind: "birth", human: true },
  { prop: "P577", kind: "publication" },
  { prop: "P571", kind: "inception" },
  { prop: "P580", kind: "start" },
];

/** Attributs d'un élément Wikidata (pays et continents résolus à part). */
export function entityAttributes(entity: Entity | undefined): Omit<WikiAttributes, "qid" | "country" | "continents"> {
  const natures = claimValues(entity, "P31").map((v) => (typeof v === "object" ? v.id : null));
  const human = natures.includes("Q5");
  const countryId = human
    ? (firstId(entity, "P27") ?? firstId(entity, "P17"))
    : (firstId(entity, "P17") ?? firstId(entity, "P495") ?? firstId(entity, "P27"));
  let year: number | null = null;
  let yearKind: WikiAttributes["yearKind"] = null;
  for (const { prop, kind, human: forHuman } of YEAR_PROPS) {
    if (forHuman !== undefined && forHuman !== human) continue;
    for (const v of claimValues(entity, prop)) {
      const y = typeof v === "object" ? wikidataYear(v.time) : null;
      if (y !== null) {
        year = y;
        yearKind = kind;
        break;
      }
    }
    if (year !== null) break;
  }
  return { human, countryId, year, yearKind };
}
/** Plafonds d'une catégorie de booster à thème : articles gardés et appels à l'API. */
export const CATEGORY_MAX_PAGES = 5_000;
const CATEGORY_MAX_REQUESTS = 60;

/** Nom de catégorie sans préfixe (« Catégorie:Jeu vidéo », URL ou « Jeu vidéo » → « Jeu vidéo »). */
export function cleanCategory(input: string): string {
  let name = input.trim();
  try {
    if (/^https?:\/\//.test(name)) name = decodeURIComponent(new URL(name).pathname.split("/").pop() ?? "");
  } catch {
    // pas une URL valide : on garde la saisie
  }
  return name
    .replace(/^(catégorie|category)\s*:/i, "")
    .replace(/_/g, " ")
    .trim();
}

interface Summary {
  extract?: string;
  description?: string;
  thumbnail?: { source?: string };
  content_urls?: { desktop?: { page?: string } };
  type?: string;
}

/** Retire les paramètres de suivi (utm_…) ajoutés par l'API aux URL d'images. */
export function cleanUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    u.search = "";
    return u.toString();
  } catch {
    return null;
  }
}

export const articleUrl = (title: string) =>
  `https://fr.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;

/**
 * Résumés et images Wikipédia : chargés à la demande (jamais en masse), au plus 5 requêtes
 * simultanées, mis en cache dans `wiki_summaries`. Le tirage n'attend jamais ces appels.
 */
export function createWiki(db: Db, config: Config, log: FastifyBaseLogger) {
  let active = 0;
  const queue: (() => void)[] = [];
  const inflight = new Map<number, Promise<CardMedia>>();

  async function limited<T>(fn: () => Promise<T>): Promise<T> {
    // Le créneau libéré passe directement au suivant : jamais plus de 5 appels simultanés.
    if (active >= MAX_PARALLEL) await new Promise<void>((r) => queue.push(r));
    else active++;
    try {
      return await fn();
    } finally {
      const next = queue.shift();
      if (next) next();
      else active--;
    }
  }

  async function fetchOne(cardId: number, title: string): Promise<CardMedia> {
    let status: "ok" | "missing" | "error" = "error";
    let media: CardMedia = { cardId, thumbUrl: null, extract: null, pageUrl: articleUrl(title) };
    let description: string | null = null;
    try {
      const res = await limited(() =>
        fetch(REST + encodeURIComponent(title.replace(/ /g, "_")), {
          headers: { "User-Agent": config.WIKIMEDIA_USER_AGENT, Accept: "application/json" },
          signal: AbortSignal.timeout(8_000),
        }),
      );
      if (res.status === 404) status = "missing";
      else if (res.ok) {
        const body = (await res.json()) as Summary;
        media = {
          cardId,
          thumbUrl: cleanUrl(body.thumbnail?.source),
          extract: body.extract?.trim() || null,
          pageUrl: cleanUrl(body.content_urls?.desktop?.page) ?? articleUrl(title),
        };
        description = body.description?.trim() || null;
        status = "ok";
      }
    } catch (err) {
      log.warn({ err, cardId }, "résumé Wikipédia indisponible");
    }
    const arthropod = isArthropod({ description, extract: media.extract });
    if (status === "ok") media.arthropod = arthropod;
    // Les erreurs réseau ne sont pas mises en cache définitivement : on réessaiera au prochain affichage.
    if (status !== "error") {
      await db
        .insert(schema.wikiSummaries)
        .values({
          pageId: cardId,
          extract: media.extract,
          thumbUrl: media.thumbUrl,
          pageUrl: media.pageUrl,
          description,
          arthropod,
          version: SUMMARY_VERSION,
          status,
        })
        .onConflictDoUpdate({
          target: schema.wikiSummaries.pageId,
          set: {
            extract: media.extract,
            thumbUrl: media.thumbUrl,
            pageUrl: media.pageUrl,
            description,
            arthropod,
            version: SUMMARY_VERSION,
            status,
            fetchedAt: sql`now()`,
          },
        });
    }
    return media;
  }

  /** Médias en cache pour ces articles (absents = pas encore chargés). */
  async function cached(cardIds: number[]): Promise<Map<number, CardMedia>> {
    const out = new Map<number, CardMedia>();
    if (cardIds.length === 0) return out;
    const rows = await db
      .select()
      .from(schema.wikiSummaries)
      .where(inArray(schema.wikiSummaries.pageId, [...new Set(cardIds)]));
    for (const r of rows)
      out.set(r.pageId, { cardId: r.pageId, thumbUrl: r.thumbUrl, extract: r.extract, pageUrl: r.pageUrl });
    return out;
  }

  /** Résumés complets en cache (description comprise) : questions des duels. */
  async function summaries(cardIds: number[]): Promise<Map<number, ArticleSummary>> {
    const out = new Map<number, ArticleSummary>();
    if (cardIds.length === 0) return out;
    const rows = await db
      .select()
      .from(schema.wikiSummaries)
      .where(inArray(schema.wikiSummaries.pageId, [...new Set(cardIds)]));
    for (const r of rows)
      out.set(r.pageId, { extract: r.extract, description: r.description, thumbUrl: r.thumbUrl, pageUrl: r.pageUrl });
    return out;
  }

  /**
   * Charge les médias manquants (dédoublonné), et appelle `onLoaded` pour chacun.
   * `fresh` : recharge aussi les résumés mis en cache avant l'ajout de la description (duels).
   */
  async function load(
    cards: { cardId: number; title: string }[],
    onLoaded?: (m: CardMedia) => void,
    options: { fresh?: boolean } = {},
  ): Promise<CardMedia[]> {
    if (config.WIKIMEDIA_DISABLED || cards.length === 0) return [];
    const ids = [...new Set(cards.map((c) => c.cardId))];
    const have = new Set<number>();
    if (ids.length) {
      const rows = await db
        .select({ pageId: schema.wikiSummaries.pageId, version: schema.wikiSummaries.version })
        .from(schema.wikiSummaries)
        .where(inArray(schema.wikiSummaries.pageId, ids));
      for (const r of rows) if (!options.fresh || r.version >= SUMMARY_VERSION) have.add(r.pageId);
    }
    const missing = cards.filter((c, i) => !have.has(c.cardId) && cards.findIndex((d) => d.cardId === c.cardId) === i);
    return Promise.all(
      missing.map(async (c) => {
        let p = inflight.get(c.cardId);
        if (!p) {
          p = fetchOne(c.cardId, c.title).finally(() => inflight.delete(c.cardId));
          inflight.set(c.cardId, p);
        }
        const media = await p;
        onLoaded?.(media);
        return media;
      }),
    );
  }

  async function getJson<T>(url: URL): Promise<T> {
    const res = await limited(() =>
      fetch(url, {
        headers: { "User-Agent": config.WIKIMEDIA_USER_AGENT, Accept: "application/json" },
        signal: AbortSignal.timeout(8_000),
      }),
    );
    if (!res.ok) throw new Error(`API Wikimedia : HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  const api = (base: string, params: Record<string, string>) => {
    const url = new URL(base);
    url.search = new URLSearchParams({ format: "json", formatversion: "2", ...params }).toString();
    return url;
  };

  /** Entités Wikidata (par lots de 50). */
  async function entities(ids: string[], props: string): Promise<Record<string, Entity>> {
    const out: Record<string, Entity> = {};
    for (let i = 0; i < ids.length; i += BATCH) {
      const body = await getJson<{ entities?: Record<string, Entity> }>(
        api(WIKIDATA_API, {
          action: "wbgetentities",
          ids: ids.slice(i, i + BATCH).join("|"),
          props,
          languages: "fr",
        }),
      );
      Object.assign(out, body.entities ?? {});
    }
    return out;
  }

  /** Charge un lot d'attributs : élément Wikidata de chaque page, puis ses pays et leurs continents. */
  async function fetchAttributes(pageIds: number[]) {
    const qids = new Map<number, string>();
    const missing = new Set<number>();
    for (let i = 0; i < pageIds.length; i += BATCH) {
      const chunk = pageIds.slice(i, i + BATCH);
      const body = await getJson<{
        query?: { pages?: { pageid?: number; missing?: boolean; pageprops?: { wikibase_item?: string } }[] };
      }>(api(ACTION_API, { action: "query", prop: "pageprops", ppprop: "wikibase_item", pageids: chunk.join("|") }));
      for (const p of body.query?.pages ?? []) {
        if (!p.pageid) continue;
        if (p.pageprops?.wikibase_item) qids.set(p.pageid, p.pageprops.wikibase_item);
        else missing.add(p.pageid);
      }
    }
    const items = await entities([...new Set(qids.values())], "claims");
    const base = new Map([...qids].map(([page, qid]) => [page, { qid, ...entityAttributes(items[qid]) }]));
    const countryIds = [...new Set([...base.values()].map((a) => a.countryId).filter((c): c is string => !!c))];
    const countries = countryIds.length ? await entities(countryIds, "labels|claims") : {};
    const rows = [
      ...[...base].map(([pageId, a]) => {
        const c = a.countryId ? countries[a.countryId] : undefined;
        const continents = claimValues(c, "P30")
          .map((v) => (typeof v === "object" ? v.id : undefined))
          .filter((v): v is string => !!v);
        return {
          pageId,
          qid: a.qid,
          human: a.human,
          countryId: a.countryId,
          country: c?.labels?.fr?.value ?? null,
          continents,
          year: a.year,
          yearKind: a.yearKind,
          status: "ok" as const,
        };
      }),
      ...[...missing].map((pageId) => ({
        pageId,
        qid: null,
        human: false,
        countryId: null,
        country: null,
        continents: [],
        year: null,
        yearKind: null,
        status: "missing" as const,
      })),
    ];
    if (!rows.length) return;
    await db
      .insert(schema.wikiAttributes)
      .values(rows)
      .onConflictDoUpdate({
        target: schema.wikiAttributes.pageId,
        set: {
          qid: sql`excluded.qid`,
          human: sql`excluded.human`,
          countryId: sql`excluded.country_id`,
          country: sql`excluded.country`,
          continents: sql`excluded.continents`,
          year: sql`excluded.year`,
          yearKind: sql`excluded.year_kind`,
          status: sql`excluded.status`,
          fetchedAt: sql`now()`,
        },
      });
  }

  const inflightAttrs = new Map<number, Promise<void>>();

  /**
   * Charge les attributs Wikidata manquants (dédoublonné, par lots). Les erreurs réseau ne sont pas mises en
   * cache : on réessaiera au prochain besoin.
   */
  async function loadAttributes(cardIds: number[]): Promise<void> {
    if (config.WIKIMEDIA_DISABLED || cardIds.length === 0) return;
    const ids = [...new Set(cardIds)];
    const rows = await db
      .select({ pageId: schema.wikiAttributes.pageId })
      .from(schema.wikiAttributes)
      .where(inArray(schema.wikiAttributes.pageId, ids));
    const have = new Set(rows.map((r) => r.pageId));
    const waits: Promise<void>[] = [];
    const todo: number[] = [];
    for (const id of ids) {
      if (have.has(id)) continue;
      const p = inflightAttrs.get(id);
      if (p) waits.push(p);
      else todo.push(id);
    }
    if (todo.length) {
      const p = fetchAttributes(todo)
        .catch((err) => log.warn({ err, count: todo.length }, "attributs Wikidata indisponibles"))
        .finally(() => {
          for (const id of todo) inflightAttrs.delete(id);
        });
      for (const id of todo) inflightAttrs.set(id, p);
      waits.push(p);
    }
    await Promise.all(waits);
  }

  /** Attributs Wikidata en cache (absents : pas encore chargés, ou page sans élément). */
  async function attributes(cardIds: number[]): Promise<Map<number, WikiAttributes>> {
    const out = new Map<number, WikiAttributes>();
    if (cardIds.length === 0) return out;
    const rows = await db
      .select()
      .from(schema.wikiAttributes)
      .where(inArray(schema.wikiAttributes.pageId, [...new Set(cardIds)]));
    for (const r of rows)
      if (r.status === "ok")
        out.set(r.pageId, {
          qid: r.qid,
          human: !!r.human,
          countryId: r.countryId,
          country: r.country,
          continents: r.continents,
          year: r.year,
          yearKind: r.yearKind,
        });
    return out;
  }

  /** Titre d'un article (saison la plus récente où il existe). */
  async function titleOf(cardId: number): Promise<string | null> {
    const [row] = await db
      .select({ title: schema.cards.title })
      .from(schema.cards)
      .where(and(eq(schema.cards.id, cardId)))
      .orderBy(sql`${schema.cards.season} desc`)
      .limit(1);
    return row?.title ?? null;
  }

  /**
   * Articles d'une catégorie Wikipédia et de ses sous-catégories jusqu'à `depth` niveaux (API MediaWiki,
   * parcours en largeur). Au plus CATEGORY_MAX_PAGES articles et CATEGORY_MAX_REQUESTS appels.
   */
  async function categoryMembers(category: string, depth: number): Promise<number[]> {
    if (config.WIKIMEDIA_DISABLED) throw new Error("API Wikipédia désactivée (WIKIMEDIA_DISABLED)");
    const pages = new Set<number>();
    const seen = new Set<string>();
    let level = [cleanCategory(category)];
    let requests = 0;
    for (let d = 0; d <= depth && level.length && pages.size < CATEGORY_MAX_PAGES; d++) {
      const next: string[] = [];
      for (const cat of level) {
        if (seen.has(cat)) continue;
        seen.add(cat);
        let cont: string | undefined;
        do {
          if (++requests > CATEGORY_MAX_REQUESTS || pages.size >= CATEGORY_MAX_PAGES) break;
          const url = new URL(ACTION_API);
          url.search = new URLSearchParams({
            action: "query",
            list: "categorymembers",
            cmtitle: `Catégorie:${cat}`,
            cmtype: d < depth ? "page|subcat" : "page",
            cmlimit: "500",
            format: "json",
            formatversion: "2",
            ...(cont ? { cmcontinue: cont } : {}),
          }).toString();
          const res = await fetch(url, {
            headers: { "User-Agent": config.WIKIMEDIA_USER_AGENT, Accept: "application/json" },
            signal: AbortSignal.timeout(10_000),
          });
          if (!res.ok) throw new Error(`API Wikipédia : HTTP ${res.status}`);
          const body = (await res.json()) as {
            query?: { categorymembers?: { pageid: number; ns: number; title: string }[] };
            continue?: { cmcontinue?: string };
          };
          for (const m of body.query?.categorymembers ?? []) {
            if (m.ns === 0) pages.add(m.pageid);
            else if (m.ns === 14) next.push(cleanCategory(m.title));
          }
          cont = body.continue?.cmcontinue;
        } while (cont);
      }
      level = next;
    }
    return [...pages].slice(0, CATEGORY_MAX_PAGES);
  }

  return { cached, summaries, load, titleOf, categoryMembers, loadAttributes, attributes };
}

export type Wiki = ReturnType<typeof createWiki>;
