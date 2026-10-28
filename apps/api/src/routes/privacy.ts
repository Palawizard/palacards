import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser, type Ctx } from "../context.js";
import { parse } from "../errors.js";
import { exportData } from "../services/privacy.js";
import { fetchThumb } from "../services/thumbs.js";

/** Vignettes Wikipédia (les deux hôtes servent en prod) : le relais ne contacte rien d'autre. */
const thumbUrl = z
  .url({ protocol: /^https$/, hostname: /^(upload|thumb)\.wikimedia\.org$/ })
  .max(1024)
  .transform((s) => new URL(s))
  .refine((u) => !u.username && !u.password && !u.port, "Image non autorisée");

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
  api.get("/thumb", { ...auth, config: { rateLimit: { max: 1200, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { u } = parse(z.object({ u: thumbUrl }), req.query);
    const { type, body, hit } = await fetchThumb(ctx, u);
    return reply
      .header("content-type", type)
      .header("cache-control", "public, max-age=2592000, immutable")
      .header("x-content-type-options", "nosniff")
      .header("content-security-policy", "default-src 'none'; sandbox")
      .header("cross-origin-resource-policy", "same-site")
      .header("x-thumb-cache", hit ? "hit" : "miss")
      .send(body);
  });
}
