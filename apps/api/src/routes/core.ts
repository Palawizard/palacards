import { and, eq, isNull, schema, sql } from "@palacards/db";
import { RARITIES } from "@palacards/game";
import { avatarSchema, type MeDTO } from "@palacards/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser, type Ctx } from "../context.js";
import { conflict, notFound, parse } from "../errors.js";
import { deleteAvatarImage, getAvatarImage, saveAvatarImage } from "../services/avatars.js";
import { answeringQuestion } from "../services/battles.js";
import { cardSheet, catalog } from "../services/cards.js";
import {
  completion,
  duplicateIds,
  fuse,
  listCollection,
  recycle,
  selectableIds,
  setFavorite,
  setPinned,
  setTags,
} from "../services/collection.js";
import { getPackState, openPack } from "../services/packs.js";
import { emit } from "../services/progression.js";
import { activeSeason, getPlayer, packState, wallet } from "../services/players.js";
import { getProfile } from "../services/profiles.js";

const rarityList = z
  .string()
  .optional()
  .transform((v) => (v ? v.split(",") : undefined))
  .pipe(z.array(z.enum(RARITIES)).optional());
const intParam = z.coerce.number().int();
/** ATK / DEF : colonnes smallint, bornées pour ne jamais déborder côté SQL. */
const statParam = intParam.min(0).max(32_767);
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
    elo: p.elo,
  };
}

export function coreRoutes(api: FastifyInstance, ctx: Ctx) {
  const auth = { preHandler: requireUser(ctx) };

  api.get("/me", auth, async (req) => me(ctx, req.user));
  api.patch("/me/settings", auth, async (req) => {
    const body = parse(
      z
        .object({
          animationSpeed: z.enum(["normal", "fast", "instant"]).optional(),
          avatar: avatarSchema.nullable().optional(),
        })
        .refine((b) => Object.keys(b).length > 0, "Aucun réglage à modifier"),
      req.body,
    );
    await ctx.db.update(schema.players).set(body).where(eq(schema.players.userId, req.user.id));
    // Un emoji ou l'initiale remplace la photo importée : on ne garde pas d'image orpheline.
    if (body.avatar !== undefined) await deleteAvatarImage(ctx, req.user.id);
    return me(ctx, req.user);
  });

  // Photo de profil : image recadrée et réduite par le navigateur, envoyée en base64 (sous la limite de corps).
  api.put("/me/avatar", { ...auth, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => {
    const { image } = parse(z.object({ image: z.base64().min(1).max(210_000) }), req.body);
    await saveAvatarImage(ctx, req.user.id, image);
    return me(ctx, req.user);
  });
  api.delete("/me/avatar", auth, async (req) => {
    await deleteAvatarImage(ctx, req.user.id);
    await ctx.db.update(schema.players).set({ avatar: null }).where(eq(schema.players.userId, req.user.id));
    return me(ctx, req.user);
  });
  // L'URL porte la version (?v=…) : réponse immuable, remplacée dès que l'avatar change.
  api.get("/avatars/:userId", auth, async (req, reply) => {
    const { userId } = parse(z.object({ userId: z.string().min(1).max(64) }), req.params);
    const row = await getAvatarImage(ctx, userId);
    if (!row) throw notFound("Pas de photo de profil.");
    return reply
      .header("content-type", row.mime)
      .header("cache-control", "private, max-age=31536000, immutable")
      .header("x-content-type-options", "nosniff")
      .header("content-security-policy", "default-src 'none'; sandbox")
      .header("cross-origin-resource-policy", "same-site")
      .send(row.image);
  });

  // --- Paquets ---
  api.get("/packs", auth, async (req) => getPackState(ctx, req.user.id));
  // Limite au-dessus du stock plein (MAX_STORED_PACKS) : vider son stock en mode instantané doit passer.
  api.post("/packs/open", { ...auth, config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req) =>
    openPack(ctx, req.user.id),
  );

  // --- Collection ---
  const collectionFilters = z.object({
    rarity: rarityList,
    season: intParam.positive().optional(),
    tag: z.string().max(24).optional(),
    favorites: z.stringbool().optional(),
    duplicates: z.stringbool().optional(),
    q: z.string().max(100).optional(),
  });
  api.get("/collection", auth, async (req) => {
    const q = parse(
      collectionFilters.extend({
        sort: z.enum(["date", "atk", "def", "views", "rarity", "title"]).default("date"),
        page: intParam.min(0).default(0),
        limit: intParam.min(1).max(120).default(60),
      }),
      req.query,
    );
    return listCollection(ctx, req.user.id, q, req.user.id);
  });
  // « Tout sélectionner » : les exemplaires recyclables du filtre en cours (paramètres de GET /collection).
  api.get("/collection/selectable", auth, async (req) =>
    selectableIds(ctx, req.user.id, parse(collectionFilters, req.query)),
  );
  api.get("/collection/summary", auth, async (req) => completion(ctx, req.user.id));
  api.post("/collection/:id/favorite", auth, async (req) => {
    const { id } = parse(idParams, req.params);
    const { favorite } = parse(z.object({ favorite: z.boolean() }), req.body);
    await setFavorite(ctx, req.user.id, id, favorite);
    return { ok: true };
  });
  api.post("/collection/:id/pin", auth, async (req) => {
    const { id } = parse(idParams, req.params);
    const { slot } = parse(
      z.object({ slot: z.union([z.number().int().min(1).max(5), z.literal("auto")]).nullable() }),
      req.body,
    );
    await setPinned(ctx, req.user.id, id, slot);
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
  api.post("/collection/:id/fuse", auth, async (req) => {
    const { id } = parse(z.object({ id: z.coerce.number().int().positive() }), req.params);
    const { sourceId } = parse(z.object({ sourceId: z.number().int().positive() }), req.body);
    const res = await fuse(ctx, req.user.id, id, sourceId);
    void emit(ctx, req.user.id, { type: "card_level", level: res.level });
    return res;
  });
  api.get("/collection/duplicates", auth, async (req) => {
    const { rarity } = parse(z.object({ rarity: rarityList }), req.query);
    return duplicateIds(ctx, req.user.id, rarity);
  });

  // --- Catalogue et fiche carte ---
  const duelInProgress = () => conflict("duel_question", "Réponds d'abord à ta question de duel.");
  api.get("/cards", auth, async (req) => {
    const q = parse(
      z.object({
        q: z.string().trim().min(3, "3 caractères minimum pour chercher").max(100).optional(),
        rarity: rarityList,
        minAtk: statParam.optional(),
        maxAtk: statParam.optional(),
        minDef: statParam.optional(),
        maxDef: statParam.optional(),
        owned: z.enum(["yes", "no"]).optional(),
        sort: z.enum(["views", "atk", "def", "title"]).default("views"),
        cursor: z.string().max(200).optional(),
        limit: intParam.min(1).max(100).default(48),
      }),
      req.query,
    );
    if (await answeringQuestion(ctx, req.user.id)) throw duelInProgress();
    return catalog(ctx, req.user.id, q);
  });
  api.get("/cards/:id", { ...auth, config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req) => {
    const { id } = parse(idParams, req.params);
    if (await answeringQuestion(ctx, req.user.id)) throw duelInProgress();
    return cardSheet(ctx, req.user.id, id);
  });

  // --- Profils ---
  api.get("/players/:username", auth, async (req) => {
    const { username } = parse(z.object({ username: z.string().min(1).max(30) }), req.params);
    return getProfile(ctx, req.user.id, username);
  });
}
