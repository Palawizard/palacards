import { schema, type Db } from "@palacards/db";
import type { CardMedia } from "@palacards/shared";
import { and, eq, inArray, sql } from "@palacards/db";
import type { FastifyBaseLogger } from "fastify";
import type { Config } from "../config.js";

const MAX_PARALLEL = 5;
const REST = "https://fr.wikipedia.org/api/rest_v1/page/summary/";

interface Summary {
  extract?: string;
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
        status = "ok";
      }
    } catch (err) {
      log.warn({ err, cardId }, "résumé Wikipédia indisponible");
    }
    // Les erreurs réseau ne sont pas mises en cache définitivement : on réessaiera au prochain affichage.
    if (status !== "error") {
      await db
        .insert(schema.wikiSummaries)
        .values({ pageId: cardId, extract: media.extract, thumbUrl: media.thumbUrl, pageUrl: media.pageUrl, status })
        .onConflictDoUpdate({
          target: schema.wikiSummaries.pageId,
          set: {
            extract: media.extract,
            thumbUrl: media.thumbUrl,
            pageUrl: media.pageUrl,
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

  /** Charge les médias manquants (dédoublonné), et appelle `onLoaded` pour chacun. */
  async function load(
    cards: { cardId: number; title: string }[],
    onLoaded?: (m: CardMedia) => void,
  ): Promise<CardMedia[]> {
    if (config.WIKIMEDIA_DISABLED || cards.length === 0) return [];
    const have = await cached(cards.map((c) => c.cardId));
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

  return { cached, load, titleOf };
}

export type Wiki = ReturnType<typeof createWiki>;
