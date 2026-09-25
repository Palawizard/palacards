import { eq, schema, sql } from "@palacards/db";
import { MAX_PRICE } from "@palacards/game";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdmin, requireUser, type Ctx } from "../context.js";
import { parse } from "../errors.js";
import { adminOverview, grant, ledgerLog } from "../services/admin.js";
import { NOTIFICATION_GROUPS } from "../services/notifications.js";
import { leaderboard, listAchievements } from "../services/progression.js";
import { CARDS_PURGE_JOB, rolloverSeason } from "../services/seasons.js";
import { changeUsername } from "../services/settings.js";
import { me } from "./core.js";

export function progressionRoutes(api: FastifyInstance, ctx: Ctx) {
  const auth = { preHandler: requireUser(ctx) };
  const admin = { preHandler: requireAdmin(ctx) };

  // --- Succès et classements ---
  api.get("/achievements", auth, async (req) => listAchievements(ctx, req.user.id));
  api.get("/leaderboard", auth, async (req) => {
    const q = parse(
      z.object({
        board: z.enum(["collection", "elo", "wealth", "guilds"]).default("collection"),
        period: z.enum(["season", "all"]).default("season"),
      }),
      req.query,
    );
    return leaderboard(ctx, req.user.id, q.board, q.period);
  });

  // --- Paramètres ---
  api.get("/settings/notifications", auth, async (req) => {
    const [p] = await ctx.db.execute<{ prefs: Record<string, boolean> }>(
      sql`select notification_prefs as prefs from players where user_id = ${req.user.id}`,
    );
    return Object.keys(NOTIFICATION_GROUPS).map((group) => ({ group, enabled: p?.prefs?.[group] !== false }));
  });
  api.put("/settings/notifications", auth, async (req) => {
    const body = parse(
      z.record(z.enum(Object.keys(NOTIFICATION_GROUPS) as [string, ...string[]]), z.boolean()),
      req.body,
    );
    // Fusion (et non remplacement) : deux cases cochées coup sur coup ne s'écrasent pas.
    await ctx.db
      .update(schema.players)
      .set({
        notificationPrefs: sql`coalesce(${schema.players.notificationPrefs}, '{}'::jsonb) || ${JSON.stringify(body)}::jsonb`,
      })
      .where(eq(schema.players.userId, req.user.id));
    return { ok: true };
  });
  api.post("/settings/username", { ...auth, config: { rateLimit: { max: 5, timeWindow: "1 hour" } } }, async (req) => {
    const { username } = parse(z.object({ username: z.string() }), req.body);
    const res = await changeUsername(ctx, req.user.id, req.user.username, username);
    return me(ctx, { ...req.user, username: res.username, displayName: res.displayName });
  });

  // --- Admin ---
  api.get("/admin", admin, async () => adminOverview(ctx));
  api.get("/admin/ledger", admin, async (req) => {
    const { before } = parse(z.object({ before: z.coerce.number().int().positive().optional() }), req.query);
    return ledgerLog(ctx, before);
  });
  api.post("/admin/grant", admin, async (req) => {
    const body = parse(
      z.object({
        username: z.string().trim().min(1).max(30),
        pw: z.number().int().min(-MAX_PRICE).max(MAX_PRICE).default(0),
        packs: z.number().int().min(-100).max(100).default(0),
        note: z.string().trim().max(80).optional(),
      }),
      req.body,
    );
    return grant(ctx, req.user.id, body);
  });
  api.post("/admin/season", admin, async (req) => {
    const { from } = parse(z.object({ from: z.number().int().positive() }), req.body);
    const res = await rolloverSeason(ctx, { expectedFrom: from });
    // Nettoyage des vieilles cartes en tâche de fond (job pg-boss dédié).
    await ctx.jobs.sendAt(CARDS_PURGE_JOB, {}, ctx.now());
    return res;
  });
}
