import { and, eq, isNull, schema, sql } from "@palacards/db";
import { AUTO_RECYCLE_RARITIES, RARITIES, TRADE_MAX_CARDS_PER_SIDE } from "@palacards/game";
import { avatarSchema, type MeDTO } from "@palacards/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser, type Ctx } from "../context.js";
import { conflict, notFound, parse } from "../errors.js";
import { deleteAvatarImage, getAvatarImage, saveAvatarImage } from "../services/avatars.js";
import { answeringQuestion } from "../services/battles.js";
import { arthropodFlags, cardSheet, catalog } from "../services/cards.js";
import {
  bulkTag,
  completion,
  duplicateIds,
  fuse,
  fuseDuplicates,
  fusionPreview,
  listCollection,
  loadOwnedSummaries,
  ownInstances,
  recycle,
  selectableIds,
  SELECT_ALL_MAX,
  setFavorite,
  setFavorites,
  setPinned,
  setShowcase,
  setTags,
  SHOWCASE_SIZE,
  tagCounts,
} from "../services/collection.js";
import { getPackState, openPack } from "../services/packs.js";
import { themesOnSale } from "../services/themes.js";
import { articleReady } from "../services/article.js";
import { bossSummary } from "../services/boss.js";
import { emit, ensureBackfill, passState } from "../services/progression.js";
import { activeSeason, getPlayer, packState, wallet } from "../services/players.js";
import { ensureQuests } from "../services/quests.js";
import { getProfile, searchPlayers } from "../services/profiles.js";
import { newSuggestionsCount, showSuggestionBanner } from "../services/suggestions.js";
import { playerWheelSchedule } from "../services/wheel.js";

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

/**
 * Nouveautés annoncées par une pastille « Nouveau » dans le menu, jusqu'à la première visite de la page
 * (ou la date de fin). La clé est retenue par joueur (`players.seen_features`), sur tous ses appareils.
 */
export const FEATURE_ANNOUNCEMENTS: { key: string; until: string }[] = [
  { key: "battle-v2", until: "2026-11-15T00:00:00+01:00" },
  { key: "quests", until: "2026-12-01T00:00:00+01:00" },
  { key: "article", until: "2026-12-01T00:00:00+01:00" },
  { key: "boss", until: "2026-12-01T00:00:00+01:00" },
  { key: "feed", until: "2026-12-01T00:00:00+01:00" },
  { key: "achievements-v2", until: "2026-12-01T00:00:00+01:00" },
  { key: "suggestions", until: "2026-12-01T00:00:00+01:00" },
  { key: "updates", until: "2026-12-01T00:00:00+01:00" },
  { key: "wheels", until: "2026-12-01T00:00:00+01:00" },
];

/** Boosters à thème achetés ou reçus, pas encore ouverts. */
async function unopenedThemePacks(ctx: Ctx, userId: string): Promise<number> {
  const [row] = await ctx.db.execute<{ n: number }>(
    sql`select coalesce(sum(count), 0)::int as n from player_theme_packs where user_id = ${userId}`,
  );
  return row?.n ?? 0;
}

export async function me(
  ctx: Ctx,
  user: { id: string; username: string; displayName: string; isAdmin: boolean },
): Promise<MeDTO> {
  const p = await getPlayer(ctx.db, user.id);
  // Succès à paliers : rattrapage des anciens joueurs à leur première visite (en arrière-plan).
  ensureBackfill(ctx, p);
  const season = await activeSeason(ctx.db);
  const quests = await ensureQuests(ctx.db, user.id, ctx.now());
  const pass = passState(p, season);
  const [notif] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.notifications)
    .where(and(eq(schema.notifications.userId, user.id), isNull(schema.notifications.readAt)));
  return {
    ...user,
    avatar: p.avatar,
    animationSpeed: p.animationSpeed,
    hideArthropods: p.hideArthropods,
    publicTags: p.publicTags,
    autoRecycle: { max: p.autoRecycleMax, keepNew: p.autoRecycleKeepNew },
    wallet: wallet(p),
    packs: packState(p, ctx.now()),
    unreadNotifications: notif?.n ?? 0,
    unreadMessages: await unreadMessages(ctx, user.id),
    season,
    elo: p.elo,
    wheelReady: playerWheelSchedule(p, ctx.now()).ready,
    themesOnSale: await themesOnSale(ctx),
    themePacks: await unopenedThemePacks(ctx, user.id),
    newFeatures: FEATURE_ANNOUNCEMENTS.filter(
      (f) => ctx.now() < new Date(f.until) && !p.seenFeatures.includes(f.key),
    ).map((f) => f.key),
    suggestionBanner: showSuggestionBanner(p, ctx.now()),
    newSuggestions: user.isAdmin ? await newSuggestionsCount(ctx) : 0,
    pass: { level: pass.level, into: pass.into, need: pass.need, xp: pass.xp },
    quests: { done: quests.filter((q) => q.completedAt).length, total: quests.length },
    articleReady: await articleReady(ctx, user.id),
    boss: await bossSummary(ctx, user.id),
  };
}

export function coreRoutes(api: FastifyInstance, ctx: Ctx) {
  const auth = { preHandler: requireUser(ctx) };

  api.get("/me", auth, async (req) => me(ctx, req.user));
  /** Nouveauté vue (page visitée) : la pastille « Nouveau » du menu disparaît, sur tous les appareils. */
  api.post("/me/seen-feature", auth, async (req) => {
    const { key } = parse(
      z.object({ key: z.enum(FEATURE_ANNOUNCEMENTS.map((f) => f.key) as [string, ...string[]]) }),
      req.body,
    );
    await ctx.db
      .update(schema.players)
      .set({ seenFeatures: sql`array_append(${schema.players.seenFeatures}, ${key})` })
      .where(and(eq(schema.players.userId, req.user.id), sql`not (${key} = any(${schema.players.seenFeatures}))`));
    return { ok: true };
  });
  api.patch("/me/settings", auth, async (req) => {
    const body = parse(
      z
        .object({
          animationSpeed: z.enum(["normal", "fast", "instant"]).optional(),
          avatar: avatarSchema.nullable().optional(),
          autoRecycleMax: z.enum(AUTO_RECYCLE_RARITIES).nullable().optional(),
          autoRecycleKeepNew: z.boolean().optional(),
          hideArthropods: z.boolean().optional(),
          publicTags: z.boolean().optional(),
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
  api.post("/packs/open", { ...auth, config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req) => {
    const body = parse(
      z.object({ themeId: z.number().int().positive().optional(), buy: z.boolean().optional() }),
      req.body ?? {},
    );
    return openPack(ctx, req.user.id, body);
  });

  // --- Collection ---
  const collectionFilters = z.object({
    rarity: rarityList,
    season: intParam.positive().optional(),
    tag: z.string().max(24).optional(),
    theme: intParam.positive().optional(),
    // `true` : ancienne forme de « seulement les favorites ».
    favorites: z
      .enum(["true", "only", "exclude"])
      .optional()
      .transform((v) => (v === "true" ? "only" : v)),
    shiny: z.stringbool().optional(),
    duplicates: z.stringbool().optional(),
    q: z.string().max(100).optional(),
    inSummary: z.stringbool().optional(),
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
    if (q.inSummary && q.q?.trim()) loadOwnedSummaries(ctx, req.user.id);
    return listCollection(ctx, req.user.id, q, req.user.id);
  });
  // « Tout sélectionner » : les exemplaires recyclables du filtre en cours (paramètres de GET /collection).
  api.get("/collection/selectable", auth, async (req) =>
    selectableIds(ctx, req.user.id, parse(collectionFilters, req.query)),
  );
  // Ses propres exemplaires par id (échange ouvert depuis une fiche carte : la carte proposée d'office).
  api.get("/collection/instances", auth, async (req) => {
    const { ids } = parse(
      z.object({
        ids: z
          .string()
          .max(400)
          .transform((v) => v.split(",").map(Number))
          .pipe(z.array(z.number().int().positive()).min(1).max(TRADE_MAX_CARDS_PER_SIDE)),
      }),
      req.query,
    );
    return ownInstances(ctx, req.user.id, ids);
  });
  api.get("/collection/summary", auth, async (req) => completion(ctx, req.user.id));
  api.get("/collection/tags", auth, async (req) => tagCounts(ctx, req.user.id));
  // Vitrine entière d'un coup (ajout, retrait, nouvel ordre) : les identifiants dans l'ordre d'affichage.
  api.put("/collection/showcase", auth, async (req) => {
    const { instanceIds } = parse(
      z.object({ instanceIds: z.array(z.number().int().positive()).max(SHOWCASE_SIZE) }),
      req.body,
    );
    return setShowcase(ctx, req.user.id, instanceIds);
  });
  // Actions en masse sur une sélection (jusqu'à « Tout sélectionner ») : favoris et tags.
  const bulkIds = z.array(z.number().int().positive()).min(1).max(SELECT_ALL_MAX);
  api.post("/collection/favorite", auth, async (req) => {
    const { instanceIds, favorite } = parse(z.object({ instanceIds: bulkIds, favorite: z.boolean() }), req.body);
    return setFavorites(ctx, req.user.id, instanceIds, favorite);
  });
  api.post("/collection/tags", auth, async (req) => {
    const tag = z.string().trim().min(1).max(24);
    const body = parse(
      z.union([z.object({ instanceIds: bulkIds, add: tag }), z.object({ instanceIds: bulkIds, remove: tag })]),
      req.body,
    );
    return bulkTag(ctx, req.user.id, body.instanceIds, "add" in body ? { add: body.add } : { remove: body.remove });
  });
  // Fusion en masse des doublons du filtre en cours : aperçu (GET), puis application (POST, mêmes filtres).
  api.get("/collection/fusions", auth, async (req) =>
    fusionPreview(ctx, req.user.id, parse(collectionFilters, req.query)),
  );
  api.post("/collection/fusions", auth, async (req) =>
    fuseDuplicates(ctx, req.user.id, parse(collectionFilters, req.query)),
  );
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
        theme: intParam.positive().optional(),
        inSummary: z.stringbool().optional(),
        sort: z.enum(["views", "atk", "def", "title"]).default("views"),
        cursor: z.string().max(200).optional(),
        limit: intParam.min(1).max(100).default(48),
      }),
      req.query,
    );
    if (await answeringQuestion(ctx, req.user.id)) throw duelInProgress();
    return catalog(ctx, req.user.id, q);
  });
  // Option « flouter les arthropodes » : lesquelles de ces cartes en montrent un (par lots, depuis l'affichage).
  api.get("/cards/arthropods", auth, async (req) => {
    const { ids } = parse(
      z.object({
        ids: z
          .string()
          .max(4000)
          .transform((v) => v.split(",").map(Number))
          .pipe(z.array(z.number().int().positive()).min(1).max(200)),
      }),
      req.query,
    );
    return arthropodFlags(ctx, req.user.id, ids);
  });
  api.get("/cards/:id", { ...auth, config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req) => {
    const { id } = parse(idParams, req.params);
    if (await answeringQuestion(ctx, req.user.id)) throw duelInProgress();
    return cardSheet(ctx, req.user.id, id);
  });

  // --- Profils ---
  // Pseudos proposés pendant la saisie (« Avec qui ? » d'un échange, adversaire d'un duel, ajout d'ami).
  api.get("/players", { ...auth, config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (req) => {
    const { q, exclude } = parse(
      z.object({ q: z.string().trim().min(1).max(30), exclude: z.enum(["friends"]).optional() }),
      req.query,
    );
    return searchPlayers(ctx, req.user.id, q, { excludeFriends: exclude === "friends" });
  });
  api.get("/players/:username", auth, async (req) => {
    const { username } = parse(z.object({ username: z.string().min(1).max(30) }), req.params);
    return getProfile(ctx, req.user.id, username);
  });
}
