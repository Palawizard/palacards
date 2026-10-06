import { SUGGESTION_LIMITS, SUGGESTION_STATUSES, suggestionInputSchema } from "@palacards/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdmin, requireUser, type Ctx } from "../context.js";
import { parse } from "../errors.js";
import {
  adminCancelBuild,
  adminQueueBuild,
  checkAutomationToken,
  enqueueTriage,
  reportBuild,
} from "../services/automation.js";
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

  // --- Automatisation : tri par Claude et branches GitHub ---
  /** (Re)lance le tri d'une suggestion (même si l'automatisation est coupée : utile pour essayer). */
  api.post("/admin/suggestions/:id/triage", admin, async (req) => {
    const { id } = parse(idParams, req.params);
    await enqueueTriage(ctx, id);
    return { ok: true };
  });
  /** Construit la branche d'une suggestion triée, même si le tri ne la proposait pas. */
  api.post("/admin/suggestions/:id/build", admin, async (req) => adminQueueBuild(ctx, parse(idParams, req.params).id));
  api.post("/admin/suggestions/:id/build/cancel", admin, async (req) =>
    adminCancelBuild(ctx, parse(idParams, req.params).id),
  );

  /** Comptes rendus des workflows GitHub (jeton partagé, jamais de session). */
  const report = z.object({
    status: z.enum(["running", "ready", "failed", "merged", "closed"]),
    issueNumber: z.number().int().positive().optional(),
    prNumber: z.number().int().positive().optional(),
    branch: z
      .string()
      .regex(/^(feat|fix)\/suggestion-\d+$/)
      .optional(),
    ciConclusion: z.string().max(40).optional(),
    playerReply: z.string().trim().max(SUGGESTION_LIMITS.reply).optional(),
    announcement: z.string().trim().max(500).optional(),
    title: z.string().trim().max(200).optional(),
    openQuestions: z.number().int().min(0).max(20).optional(),
    runUrl: z.url().startsWith("https://github.com/").optional(),
  });
  api.post(
    "/automation/suggestions/:id/build",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (req) => {
      checkAutomationToken(ctx, req.headers.authorization);
      return reportBuild(ctx, parse(idParams, req.params).id, parse(report, req.body));
    },
  );
}
