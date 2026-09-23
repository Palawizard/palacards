import { and, eq, isNull, schema, sql } from "@palacards/db";
import { RARITIES } from "@palacards/game";
import type { MeDTO } from "@palacards/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser, type Ctx } from "../context.js";
import { parse } from "../errors.js";
import { cardSheet, catalog } from "../services/cards.js";
import { completion, duplicateIds, listCollection, recycle, setFavorite, setTags } from "../services/collection.js";
import { getPackState, openPack } from "../services/packs.js";
import { activeSeason, getPlayer, packState, wallet } from "../services/players.js";
import { getProfile } from "../services/profiles.js";

const rarityList = z
  .string()
  .optional()
  .transform((v) => (v ? v.split(",") : undefined))
  .pipe(z.array(z.enum(RARITIES)).optional());
const intParam = z.coerce.number().int();
const idParams = z.object({ id: z.coerce.number().int().positive() });

/** Nombre de messages non lus (MP + guilde), utilisé par l'en-tête. */
export async function unreadMessages(ctx: Ctx, userId: string): Promise<number> {
  const [row] = await ctx.db.execute<{ n: number }>(sql`
    select count(*)::int as n from messages m
    left join message_reads r on r.user_id = ${userId} and r.channel = m.channel
    where m.sender_id <> ${userId}
      and (m.created_at > coalesce(r.last_read_at, 'epoch'))
      and (
        (m.channel like 'dm:%' and (m.channel like ${`dm:${userId}:%`} or m.channel like ${`dm:%:${userId}`}))
        or m.channel = (select 'guild:' || gm.guild_id from guild_members gm where gm.user_id = ${userId})
      )
  `);
  return row?.n ?? 0;
}

export async function me(
  ctx: Ctx,
  user: { id: string; username: string; displayName: string; isAdmin: boolean },
): Promise<MeDTO> {
  const p = await getPlayer(ctx.db, user.id);
  const [notif] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.notifications)
    .where(and(eq(schema.notifications.userId, user.id), isNull(schema.notifications.readAt)));
  return {
    ...user,
    avatar: p.avatar,
    animationSpeed: p.animationSpeed,
    wallet: wallet(p),
    packs: packState(p, ctx.now()),
    unreadNotifications: notif?.n ?? 0,
    unreadMessages: await unreadMessages(ctx, user.id),
    season: await activeSeason(ctx.db),
  };
}

export function coreRoutes(api: FastifyInstance, ctx: Ctx) {
  const auth = { preHandler: requireUser(ctx) };

  api.get("/me", auth, async (req) => me(ctx, req.user));
  api.patch("/me/settings", auth, async (req) => {
    const body = parse(
      z.object({
        animationSpeed: z.enum(["normal", "fast", "instant"]).optional(),
        avatar: z.string().trim().min(1).max(4).nullable().optional(),
      })
        .refine((b) => Object.keys(b).length > 0, "Aucun réglage à modifier"),
      req.body,
    );
    await ctx.db.update(schema.players).set(body).where(eq(schema.players.userId, req.user.id));
    return me(ctx, req.user);
  });

  // --- Paquets ---
  api.get("/packs", auth, async (req) => getPackState(ctx, req.user.id));
  api.post("/packs/open", { ...auth, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) =>
    openPack(ctx, req.user.id),
  );

  // --- Collection ---
  api.get("/collection", auth, async (req) => {
    const q = parse(
      z.object({
        rarity: rarityList,
        season: intParam.positive().optional(),
        tag: z.string().max(24).optional(),
        favorites: z.stringbool().optional(),
        duplicates: z.stringbool().optional(),
        q: z.string().max(100).optional(),
        sort: z.enum(["date", "atk", "def", "views", "rarity", "title"]).default("date"),
        page: intParam.min(0).default(0),
        limit: intParam.min(1).max(120).default(60),
      }),
      req.query,
    );
    return listCollection(ctx, req.user.id, q);
  });
  api.get("/collection/summary", auth, async (req) => completion(ctx, req.user.id));
  api.post("/collection/:id/favorite", auth, async (req) => {
    const { id } = parse(idParams, req.params);
    const { favorite } = parse(z.object({ favorite: z.boolean() }), req.body);
    await setFavorite(ctx, req.user.id, id, favorite);
    return { ok: true };
  });
  api.put("/collection/:id/tags", auth, async (req) => {
    const { id } = parse(idParams, req.params);
    const { tags } = parse(z.object({ tags: z.array(z.string().trim().min(1).max(24)).max(10) }), req.body);
    return { tags: await setTags(ctx, req.user.id, id, tags) };
  });
  api.post("/collection/recycle", auth, async (req) => {
    const { instanceIds } = parse(
      z.object({ instanceIds: z.array(z.number().int().positive()).min(1).max(500) }),
      req.body,
    );
    return recycle(ctx, req.user.id, instanceIds);
  });
  api.get("/collection/duplicates", auth, async (req) => {
    const { rarity } = parse(z.object({ rarity: rarityList }), req.query);
    return duplicateIds(ctx, req.user.id, rarity);
  });

  // --- Catalogue et fiche carte ---
  api.get("/cards", auth, async (req) => {
    const q = parse(
      z.object({
        q: z.string().trim().min(3, "3 caractères minimum pour chercher").max(100).optional(),
        rarity: rarityList,
        minAtk: intParam.optional(),
        maxAtk: intParam.optional(),
        minDef: intParam.optional(),
        maxDef: intParam.optional(),
        owned: z.enum(["yes", "no"]).optional(),
        sort: z.enum(["views", "atk", "def", "title"]).default("views"),
        cursor: z.string().max(200).optional(),
        limit: intParam.min(1).max(100).default(48),
      }),
      req.query,
    );
    return catalog(ctx, req.user.id, q);
  });
  api.get("/cards/:id", auth, async (req) => {
    const { id } = parse(idParams, req.params);
    return cardSheet(ctx, req.user.id, id);
  });

  // --- Profils ---
  api.get("/players/:username", auth, async (req) => {
    const { username } = parse(z.object({ username: z.string().min(1).max(30) }), req.params);
    return getProfile(ctx, req.user.id, username);
  });
}
