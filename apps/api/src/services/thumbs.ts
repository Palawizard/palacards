import type { Ctx } from "../context.js";
import { GameError } from "../errors.js";
import { ThumbCache } from "./thumb-cache.js";

const MAX_THUMB_BYTES = 4 * 1024 * 1024;

/** Cache disque des vignettes (THUMB_CACHE_DIR), un par processus ; null sans dossier configuré. */
const caches = new WeakMap<Ctx["config"], ThumbCache | null>();
function cacheOf(ctx: Ctx): ThumbCache | null {
  if (!caches.has(ctx.config))
    caches.set(
      ctx.config,
      ctx.config.THUMB_CACHE_DIR
        ? new ThumbCache(ctx.config.THUMB_CACHE_DIR, ctx.config.THUMB_CACHE_MAX_MB * 1024 * 1024)
        : null,
    );
  return caches.get(ctx.config)!;
}

/**
 * Vignette Wikimedia relayée : lue sur le disque si elle y est, sinon téléchargée (puis gardée sur le disque,
 * en tâche de fond). `url` est déjà validée (hôtes Wikimedia seulement).
 */
export async function fetchThumb(ctx: Ctx, url: URL): Promise<{ type: string; body: Buffer; hit: boolean }> {
  const cache = cacheOf(ctx);
  const key = url.toString();
  const cached = await cache?.get(key);
  if (cached) return { ...cached, hit: true };
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": ctx.config.WIKIMEDIA_USER_AGENT },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new GameError(502, "thumb_unavailable", "Image indisponible.");
  }
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok || !type.startsWith("image/")) {
    throw new GameError(res.status === 404 ? 404 : 502, "thumb_unavailable", "Image indisponible.");
  }
  const body = Buffer.from(await res.arrayBuffer());
  if (body.length > MAX_THUMB_BYTES) throw new GameError(502, "thumb_unavailable", "Image trop lourde.");
  // Écriture en tâche de fond : la réponse n'attend pas le disque.
  if (cache) void cache.put(key, type, body);
  return { type, body, hit: false };
}

const WIKIMEDIA_HOST = /^(upload|thumb)\.wikimedia\.org$/;

/**
 * Préchauffe le cache disque avec des vignettes qui vont être demandées (images de la prochaine question du boss) :
 * le joueur les reçoit du disque, sans attendre Wikimedia. Sans cache, ou Wikimedia coupé (tests) : rien.
 */
export function warmThumbs(ctx: Ctx, urls: string[]) {
  if (!cacheOf(ctx) || ctx.config.WIKIMEDIA_DISABLED) return;
  for (const raw of new Set(urls)) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      continue;
    }
    if (url.protocol !== "https:" || !WIKIMEDIA_HOST.test(url.hostname)) continue;
    void fetchThumb(ctx, url).catch(() => {});
  }
}
