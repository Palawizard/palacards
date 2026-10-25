import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { requireUser, type Ctx } from "../context.js";
import { GameError, parse } from "../errors.js";
import { exportData } from "../services/privacy.js";
import { ThumbCache } from "../services/thumb-cache.js";

/** Vignettes Wikipédia (les deux hôtes servent en prod) : le relais ne contacte rien d'autre. */
const thumbUrl = z
  .url({ protocol: /^https$/, hostname: /^(upload|thumb)\.wikimedia\.org$/ })
  .max(1024)
  .transform((s) => new URL(s))
  .refine((u) => !u.username && !u.password && !u.port, "Image non autorisée");
const MAX_THUMB_BYTES = 4 * 1024 * 1024;

export function privacyRoutes(api: FastifyInstance, ctx: Ctx) {
  const auth = { preHandler: requireUser(ctx) };

  // Droit d'accès et portabilité : téléchargement JSON de toutes les données du joueur.
  api.get("/me/export", { ...auth, config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (req, reply) => {
    const data = await exportData(ctx, req.user.id);
    const day = ctx.now().toISOString().slice(0, 10);
    return reply
      .header("content-disposition", `attachment; filename="palacards-${req.user.username}-${day}.json"`)
      .header("cache-control", "no-store")
      .send(data);
  });

  // Vignettes Wikimedia relayées : le navigateur du joueur ne contacte jamais Wikimedia (son IP reste ici).
  // Plafond large : une page de collection affiche des dizaines de cartes d'un coup.
  // Chaque vignette n'est téléchargée qu'une fois : ensuite elle est lue sur le disque (THUMB_CACHE_DIR).
  const cache = ctx.config.THUMB_CACHE_DIR
    ? new ThumbCache(ctx.config.THUMB_CACHE_DIR, ctx.config.THUMB_CACHE_MAX_MB * 1024 * 1024)
    : null;
  const send = (reply: FastifyReply, type: string, body: Buffer, hit: boolean) =>
    reply
      .header("content-type", type)
      .header("cache-control", "public, max-age=2592000, immutable")
      .header("x-content-type-options", "nosniff")
      .header("content-security-policy", "default-src 'none'; sandbox")
      .header("cross-origin-resource-policy", "same-site")
      .header("x-thumb-cache", hit ? "hit" : "miss")
      .send(body);
  api.get("/thumb", { ...auth, config: { rateLimit: { max: 1200, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { u } = parse(z.object({ u: thumbUrl }), req.query);
    const key = u.toString();
    const cached = await cache?.get(key);
    if (cached) return send(reply, cached.type, cached.body, true);
    let res: Response;
    try {
      res = await fetch(u, {
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
    return send(reply, type, body, false);
  });
}
