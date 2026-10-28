import {
  PORTFOLIO_ACCENT_KEYS,
  PORTFOLIO_CARDS_MAX,
  PORTFOLIO_DESCRIPTION_MAX,
  PORTFOLIO_NAME_MAX,
  PORTFOLIO_PROFILE_SLOTS,
} from "@palacards/game";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdmin, requireUser, type Ctx } from "../context.js";
import { notFound, parse } from "../errors.js";
import {
  adminPortfolioBackgrounds,
  buyDesign,
  communityPortfolios,
  createPortfolio,
  deletePortfolio,
  deletePortfolioBackground,
  designCatalog,
  getPortfolio,
  getPortfolioBackground,
  likePortfolio,
  myPortfolios,
  profilePortfolios,
  savePortfolioBackground,
  setPortfolioCards,
  setProfilePortfolios,
  updatePortfolio,
} from "../services/portfolios.js";
import { findUserByName } from "../services/profiles.js";

/** Portfolios (suggestions n° 3 et 116) : sélections de cartes décorées, page publique, likes sans récompense. */
export function portfolioRoutes(api: FastifyInstance, ctx: Ctx) {
  const auth = { preHandler: requireUser(ctx) };
  const admin = { preHandler: requireAdmin(ctx) };
  const limited = (max: number) => ({ ...auth, config: { rateLimit: { max, timeWindow: "1 minute" } } });
  const idParams = z.object({ id: z.coerce.number().int().positive() });
  const name = z.string().trim().min(1).max(PORTFOLIO_NAME_MAX);
  const description = z.string().trim().max(PORTFOLIO_DESCRIPTION_MAX);

  api.get("/portfolios", auth, async (req) => {
    const q = parse(
      z.object({
        sort: z.enum(["recent", "likes"]).default("recent"),
        page: z.coerce.number().int().min(0).default(0),
      }),
      req.query,
    );
    return communityPortfolios(ctx, req.user.id, q.sort, q.page);
  });
  api.get("/portfolios/mine", auth, async (req) => myPortfolios(ctx, req.user.id));
  api.get("/portfolios/designs", auth, async (req) => designCatalog(ctx, req.user.id));
  api.post("/portfolios/designs/:key/buy", limited(20), async (req) => {
    const { key } = parse(z.object({ key: z.string().min(1).max(40) }), req.params);
    return buyDesign(ctx, req.user.id, key);
  });
  // Portfolios affichés sur le profil, dans l'ordre (les autres en sortent).
  api.put("/portfolios/profile", auth, async (req) => {
    const { ids } = parse(
      z.object({ ids: z.array(z.number().int().positive()).max(PORTFOLIO_PROFILE_SLOTS) }),
      req.body,
    );
    await setProfilePortfolios(ctx, req.user.id, ids);
    return { ok: true };
  });
  api.get("/players/:username/portfolios", auth, async (req) => {
    const { username } = parse(z.object({ username: z.string().min(1).max(30) }), req.params);
    return profilePortfolios(ctx, req.user.id, (await findUserByName(ctx.db, username)).id);
  });
  api.post("/portfolios", limited(20), async (req) => {
    const b = parse(z.object({ name, description: description.default("") }), req.body);
    return createPortfolio(ctx, req.user.id, b);
  });
  api.get("/portfolios/:id", auth, async (req) => getPortfolio(ctx, req.user.id, parse(idParams, req.params).id));
  api.patch("/portfolios/:id", auth, async (req) => {
    const { id } = parse(idParams, req.params);
    const b = parse(
      z
        .object({
          name: name.optional(),
          description: description.optional(),
          background: z.string().min(1).max(40).optional(),
          frame: z.string().min(1).max(40).optional(),
          accent: z.enum(PORTFOLIO_ACCENT_KEYS).optional(),
        })
        .refine((v) => Object.keys(v).length > 0, "Rien à modifier"),
      req.body,
    );
    await updatePortfolio(ctx, req.user.id, id, b);
    return getPortfolio(ctx, req.user.id, id);
  });
  // Toutes les cartes d'un coup, dans l'ordre d'affichage (ajout, retrait, ordre, vedette).
  api.put("/portfolios/:id/cards", auth, async (req) => {
    const { id } = parse(idParams, req.params);
    const { cards } = parse(
      z.object({
        cards: z
          .array(z.object({ instanceId: z.number().int().positive(), featured: z.boolean().optional() }))
          .max(PORTFOLIO_CARDS_MAX),
      }),
      req.body,
    );
    await setPortfolioCards(ctx, req.user.id, id, cards);
    return getPortfolio(ctx, req.user.id, id);
  });
  api.delete("/portfolios/:id", auth, async (req) => {
    await deletePortfolio(ctx, req.user.id, parse(idParams, req.params).id);
    return { ok: true };
  });
  api.post("/portfolios/:id/like", limited(60), async (req) =>
    likePortfolio(ctx, req.user.id, parse(idParams, req.params).id, true),
  );
  api.delete("/portfolios/:id/like", limited(60), async (req) =>
    likePortfolio(ctx, req.user.id, parse(idParams, req.params).id, false),
  );

  // Fond envoyé par le joueur : mêmes contrôles que les bannières (format, poids, dimensions).
  api.put("/portfolios/:id/background", limited(10), async (req) => {
    const { id } = parse(idParams, req.params);
    const { image } = parse(z.object({ image: z.base64().min(1).max(245_000) }), req.body);
    return savePortfolioBackground(ctx, req.user.id, id, image);
  });
  api.delete("/portfolios/:id/background", auth, async (req) => {
    await deletePortfolioBackground(ctx, parse(idParams, req.params).id, req.user.id);
    return { ok: true };
  });
  api.get("/portfolios/:id/background", auth, async (req, reply) => {
    const row = await getPortfolioBackground(ctx, parse(idParams, req.params).id);
    if (!row) throw notFound("Pas d'image de fond.");
    return reply
      .header("content-type", row.mime)
      .header("cache-control", "private, max-age=31536000, immutable")
      .header("x-content-type-options", "nosniff")
      .header("content-security-policy", "default-src 'none'; sandbox")
      .header("cross-origin-resource-policy", "same-site")
      .send(row.image);
  });

  // Modération : images de fond envoyées, suppression.
  api.get("/admin/portfolio-backgrounds", admin, async () => adminPortfolioBackgrounds(ctx));
  api.delete("/admin/portfolio-backgrounds/:id", admin, async (req) => {
    await deletePortfolioBackground(ctx, parse(idParams, req.params).id, null);
    return { ok: true };
  });
}
