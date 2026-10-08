import { eq, schema } from "@palacards/db";
import {
  ARTICLE_GUESS_MAX_LENGTH,
  BOSS_CARDS_PER_ASSAULT,
  FEED_REACTIONS,
  PASS_MAX_LEVEL,
  passReward,
  WEIRD_GENRES,
  XP,
} from "@palacards/game";
import type { PassDTO } from "@palacards/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdmin, requireUser, type Ctx } from "../context.js";
import { parse } from "../errors.js";
import { articleState, guessArticle } from "../services/article.js";
import { answerBoss, bossState, serveNext, startAssault } from "../services/boss.js";
import {
  adminBroadcasts,
  archiveBroadcast,
  createBroadcast,
  deleteBroadcast,
  markBroadcastRead,
  pendingBroadcasts,
  recentBroadcasts,
  sendBroadcast,
  updateBroadcast,
} from "../services/broadcasts.js";
import { listFeed, startWeirdRefresh, toggleReaction } from "../services/feed.js";
import { getPlayer, activeSeason } from "../services/players.js";
import { passState } from "../services/progression.js";
import { listQuests, rerollQuest } from "../services/quests.js";

const XP_TABLE: PassDTO["xpTable"] = [
  { label: "Paquet ouvert", xp: XP.pack },
  { label: "Booster à thème ouvert", xp: XP.themedPack },
  { label: "Connexion du jour", xp: XP.login },
  { label: "Tour de roue", xp: XP.wheel },
  { label: "Upgrade tenté", xp: XP.upgrade },
  { label: "Article du jour trouvé", xp: XP.articleFound },
  { label: "Article du jour raté", xp: XP.articlePlayed },
  { label: "Assaut contre le boss", xp: XP.bossAssault },
  { label: "Boss vaincu", xp: XP.bossKill },
  { label: "Duel gagné", xp: XP.battleWin },
  { label: "Duel perdu", xp: XP.battleLoss },
  { label: "Échange conclu", xp: XP.trade },
  { label: "Vente au marché", xp: XP.sale },
  { label: "Quête du jour", xp: 150 },
  { label: "Quête de la semaine", xp: 1_500 },
  { label: "Objectif de guilde atteint", xp: XP.guildObjective },
];

const broadcastBody = z.object({
  title: z.string().trim().min(2).max(80),
  body: z.string().trim().min(1).max(2_000),
  tone: z.enum(["info", "update", "event", "warning"]).default("info"),
  linkUrl: z
    .string()
    .trim()
    .max(300)
    .refine((v) => v.startsWith("/") || /^https:\/\//.test(v), "Lien : une page du jeu (/…) ou une adresse https://")
    .nullable()
    .default(null),
  linkLabel: z.string().trim().max(40).nullable().default(null),
  expiresAt: z.coerce.date().nullable().default(null),
});

export function contentRoutes(api: FastifyInstance, ctx: Ctx) {
  const auth = { preHandler: requireUser(ctx) };
  const admin = { preHandler: requireAdmin(ctx) };
  const idParams = z.object({ id: z.coerce.number().int().positive() });

  // --- Quêtes et passe de saison ---
  api.get("/quests", auth, async (req) => listQuests(ctx, req.user.id));
  api.post("/quests/:slot/reroll", auth, async (req) => {
    const { slot } = parse(z.object({ slot: z.coerce.number().int().min(1).max(3) }), req.params);
    return rerollQuest(ctx, req.user.id, slot);
  });
  api.get("/pass", auth, async (req): Promise<PassDTO> => {
    const season = await activeSeason(ctx.db);
    const p = await getPlayer(ctx.db, req.user.id);
    const [s] = await ctx.db.select().from(schema.seasons).where(eq(schema.seasons.id, season));
    return {
      ...passState(p, season),
      maxLevel: PASS_MAX_LEVEL,
      levels: Array.from({ length: PASS_MAX_LEVEL }, (_, i) => ({ level: i + 1, reward: passReward(i + 1) })),
      endsAt: s?.endsAt?.toISOString() ?? null,
      xpTable: XP_TABLE,
    };
  });

  // --- Article du jour ---
  api.get("/article", auth, async (req) => articleState(ctx, req.user.id));
  api.post("/article/guess", { ...auth, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    const { guess } = parse(z.object({ guess: z.string().max(ARTICLE_GUESS_MAX_LENGTH * 2) }), req.body);
    return guessArticle(ctx, req.user.id, guess);
  });

  // --- Boss du jour ---
  api.get("/boss", auth, async (req) => bossState(ctx, req.user.id));
  api.post("/boss/assault", auth, async (req) => {
    const { instanceIds } = parse(
      z.object({ instanceIds: z.array(z.number().int().positive()).length(BOSS_CARDS_PER_ASSAULT) }),
      req.body,
    );
    return startAssault(ctx, req.user.id, instanceIds);
  });
  api.post("/boss/assault/:id/next", auth, async (req) => {
    const { id } = parse(idParams, req.params);
    return serveNext(ctx, req.user.id, id);
  });
  api.post("/boss/assault/:id/answer", auth, async (req) => {
    const { id } = parse(idParams, req.params);
    const { idx, choice } = parse(
      z.object({
        idx: z
          .number()
          .int()
          .min(0)
          .max(BOSS_CARDS_PER_ASSAULT - 1),
        choice: z.number().int().min(0).max(5),
      }),
      req.body,
    );
    return answerBoss(ctx, req.user.id, id, idx, choice);
  });

  // --- Fil d'activité ---
  api.get("/feed", auth, async (req) => {
    const q = parse(
      z.object({
        kind: z.enum(["best", "weird", "shiny"]).default("best"),
        genre: z.string().max(20).optional(),
        cursor: z.string().max(10).optional(),
        limit: z.coerce.number().int().min(1).max(60).optional(),
      }),
      req.query,
    );
    return listFeed(ctx, req.user.id, q.kind, q);
  });
  api.get("/feed/genres", auth, async () => WEIRD_GENRES.map((g) => ({ key: g.key, label: g.label, emoji: g.emoji })));
  api.post("/feed/:id/react", auth, async (req) => {
    const { id } = parse(idParams, req.params);
    const { emoji } = parse(z.object({ emoji: z.enum(FEED_REACTIONS) }), req.body);
    return toggleReaction(ctx, req.user.id, id, emoji);
  });

  // --- Messages serveur ---
  api.get("/broadcasts/pending", auth, async (req) => pendingBroadcasts(ctx, req.user.id));
  api.get("/broadcasts", auth, async () => recentBroadcasts(ctx));
  api.post("/broadcasts/:id/read", auth, async (req) => {
    const { id } = parse(idParams, req.params);
    await markBroadcastRead(ctx, req.user.id, id);
    return { ok: true };
  });

  api.get("/admin/broadcasts", admin, async () => adminBroadcasts(ctx));
  api.post("/admin/broadcasts", admin, async (req) => {
    const body = parse(broadcastBody.extend({ send: z.boolean().default(false) }), req.body);
    const { send, ...input } = body;
    return createBroadcast(ctx, req.user.id, input, send);
  });
  api.put("/admin/broadcasts/:id", admin, async (req) => {
    const { id } = parse(idParams, req.params);
    return updateBroadcast(ctx, id, parse(broadcastBody, req.body));
  });
  api.post("/admin/broadcasts/:id/send", admin, async (req) => {
    const { id } = parse(idParams, req.params);
    return sendBroadcast(ctx, id);
  });
  api.post("/admin/broadcasts/:id/archive", admin, async (req) => {
    const { id } = parse(idParams, req.params);
    await archiveBroadcast(ctx, id);
    return { ok: true };
  });
  api.delete("/admin/broadcasts/:id", admin, async (req) => {
    const { id } = parse(idParams, req.params);
    await deleteBroadcast(ctx, id);
    return { ok: true };
  });

  // Catégories « bizarres » du fil : rechargement en tâche de fond (long : plusieurs centaines d'appels).
  api.post("/admin/feed/refresh", admin, async () => ({ started: startWeirdRefresh(ctx) }));
}
