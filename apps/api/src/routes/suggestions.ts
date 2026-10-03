import { SUGGESTION_LIMITS, SUGGESTION_STATUSES, suggestionInputSchema } from "@palacards/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdmin, requireUser, type Ctx } from "../context.js";
import { parse } from "../errors.js";
import {
  adminSuggestions,
  createSuggestion,
  deleteSuggestion,
  markSuggestionsSeen,
  mySuggestions,
  pauseSuggestionBanner,
  updateSuggestion,
} from "../services/suggestions.js";

/** Suggestions des joueurs (page Suggestions) et leur suivi par l'admin. */
export function suggestionRoutes(api: FastifyInstance, ctx: Ctx) {
  const auth = { preHandler: requireUser(ctx) };
  const admin = { preHandler: requireAdmin(ctx) };
  const idParams = z.object({ id: z.coerce.number().int().positive() });

  api.get("/suggestions", auth, async (req) => mySuggestions(ctx, req.user.id));
  api.post("/suggestions", { ...auth, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) =>
    createSuggestion(ctx, req.user.id, parse(suggestionInputSchema, req.body)),
  );
  /** Bandeau « Une idée ? » fermé : il revient dans une semaine. */
  api.post("/suggestions/banner/dismiss", auth, async (req) => pauseSuggestionBanner(ctx, req.user.id));

  api.get("/admin/suggestions", admin, async () => adminSuggestions(ctx));
  api.post("/admin/suggestions/seen", admin, async () => {
    await markSuggestionsSeen(ctx);
    return { ok: true };
  });
  api.patch("/admin/suggestions/:id", admin, async (req) => {
    const { id } = parse(idParams, req.params);
    const patch = parse(
      z
        .object({
          status: z.enum(SUGGESTION_STATUSES).optional(),
          reply: z.string().max(SUGGESTION_LIMITS.reply).nullable().optional(),
        })
        .refine((p) => p.status !== undefined || p.reply !== undefined, "Rien à modifier."),
      req.body,
    );
    return updateSuggestion(ctx, id, patch);
  });
  api.delete("/admin/suggestions/:id", admin, async (req) => {
    const { id } = parse(idParams, req.params);
    await deleteSuggestion(ctx, id);
    return { ok: true };
  });
}
