import { eq, schema, sql } from "@palacards/db";
import { ECONOMY, MAX_PRICE } from "@palacards/game";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdmin, requireUser, type Ctx } from "../context.js";
import { parse } from "../errors.js";
import { adminOverview, grant, ledgerLog } from "../services/admin.js";
import { createCode, listCodes, setCodeDisabled } from "../services/codes.js";
import { adminThemes, createTheme, endTheme, THEME_MAX_CATEGORIES } from "../services/themes.js";
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
        board: z.enum(["collection", "elo", "wealth", "guilds", "pass"]).default("collection"),
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
  // Boosters à thème : lecture de la catégorie sur Wikipédia (jusqu'à 60 appels), d'où la limite.
  api.get("/admin/themes", admin, async () => adminThemes(ctx));
  api.post("/admin/themes", { ...admin, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => {
    const body = parse(
      z
        .object({
          name: z.string().trim().min(2).max(40),
          description: z.string().trim().max(200).optional(),
          // Une ou plusieurs catégories (`category` : ancien champ, une seule).
          categories: z.array(z.string().trim().min(1).max(200)).max(THEME_MAX_CATEGORIES).default([]),
          category: z.string().trim().max(200).optional(),
          depth: z.number().int().min(0).max(2).default(1),
          titles: z.array(z.string().trim().min(1).max(300)).max(500).default([]),
          price: z.number().int().min(1).max(MAX_PRICE).default(ECONOMY.themePackPrice),
          startsAt: z.coerce.date(),
          endsAt: z.coerce.date(),
        })
        .refine((b) => b.endsAt > b.startsAt, { message: "La fin doit être après le début", path: ["endsAt"] }),
      req.body,
    );
    const { category, ...rest } = body;
    return createTheme(ctx, req.user.id, {
      ...rest,
      categories: category ? [category, ...rest.categories] : rest.categories,
    });
  });
  api.post("/admin/themes/:id/end", admin, async (req) => {
    const { id } = parse(z.object({ id: z.coerce.number().int().positive() }), req.params);
    await endTheme(ctx, id);
    return { ok: true };
  });

  // Codes promo.
  api.get("/admin/codes", admin, async () => listCodes(ctx));
  api.post("/admin/codes", admin, async (req) => {
    const body = parse(
      z.object({
        code: z.string().trim().min(3).max(32),
        pw: z.number().int().min(0).max(MAX_PRICE).default(0),
        packs: z.number().int().min(0).max(100).default(0),
        themeId: z.number().int().positive().nullable().default(null),
        themePacks: z.number().int().min(0).max(20).default(0),
        maxUses: z.number().int().min(1).max(100_000).nullable().default(null),
        expiresAt: z.coerce.date().nullable().default(null),
      }),
      req.body,
    );
    return createCode(ctx, req.user.id, body);
  });
  api.post("/admin/codes/:code/disabled", admin, async (req) => {
    const { code } = parse(z.object({ code: z.string().min(1).max(40) }), req.params);
    const { disabled } = parse(z.object({ disabled: z.boolean() }), req.body);
    await setCodeDisabled(ctx, code, disabled);
    return { ok: true };
  });

  api.post("/admin/season", admin, async (req) => {
    const { from } = parse(z.object({ from: z.number().int().positive() }), req.body);
    const res = await rolloverSeason(ctx, { expectedFrom: from });
    // Nettoyage des vieilles cartes en tâche de fond (job pg-boss dédié).
    await ctx.jobs.sendAt(CARDS_PURGE_JOB, {}, ctx.now());
    return res;
  });
}
