import { eq, inArray, schema, sql } from "@palacards/db";
import type { Rarity } from "@palacards/game";
import { BANNER_IMAGE_MAX_BYTES, type BannerDTO } from "@palacards/shared";
import type { Ctx } from "../context.js";
import { badRequest, notFound } from "../errors.js";
import { sniffImage } from "./avatars.js";
import type { DbOrTx } from "./players.js";

/** Côté maximal accepté : le navigateur envoie 1200 × 300 px, on laisse de la marge sans ouvrir la porte aux bombes. */
export const BANNER_MAX_SIDE = 2048;

const versionOf = (updatedAt: Date) => updatedAt.getTime().toString(36);

/**
 * Carte choisie comme bannière par chacun de ces joueurs, s'il en possède encore un exemplaire (vendue, recyclée
 * ou échangée : on retombe sur l'image importée). Titre de la dernière édition, rareté du meilleur exemplaire.
 */
async function cardBannersOf(db: DbOrTx, userIds: string[]): Promise<Map<string, BannerDTO>> {
  const rows = await db.execute<{
    user_id: string;
    card_id: string;
    title: string | null;
    rarity: Rarity | null;
    thumb_url: string | null;
  }>(sql`
    select p.user_id, p.banner_card_id as card_id, w.thumb_url,
           (select c.title from cards c where c.id = p.banner_card_id order by c.season desc limit 1) as title,
           (select max(ci.rarity) from card_instances ci
             where ci.owner_id = p.user_id and ci.card_id = p.banner_card_id) as rarity
    from players p
    left join wiki_summaries w on w.page_id = p.banner_card_id
    where p.banner_card_id is not null and p.user_id in (${sql.join(
      userIds.map((id) => sql`${id}`),
      sql`, `,
    )})
  `);
  const out = new Map<string, BannerDTO>();
  for (const r of rows) {
    if (!r.rarity || !r.title) continue;
    out.set(r.user_id, {
      kind: "card",
      cardId: Number(r.card_id),
      title: r.title,
      rarity: r.rarity,
      thumbUrl: r.thumb_url,
    });
  }
  return out;
}

/** Image importée par chacun de ces joueurs. */
async function imageBannersOf(db: DbOrTx, userIds: string[]): Promise<Map<string, BannerDTO>> {
  const rows = await db
    .select({ userId: schema.playerBanners.userId, updatedAt: schema.playerBanners.updatedAt })
    .from(schema.playerBanners)
    .where(inArray(schema.playerBanners.userId, userIds));
  return new Map(rows.map((r) => [r.userId, { kind: "image", userId: r.userId, version: versionOf(r.updatedAt) }]));
}

/**
 * Bannière de chacun de ces joueurs : carte de sa collection, sinon image importée (absent : bannière par défaut).
 * Deux requêtes pour tout un classement.
 */
export async function bannersOf(db: DbOrTx, userIds: string[]): Promise<Map<string, BannerDTO>> {
  if (!userIds.length) return new Map();
  const [cards, images] = await Promise.all([cardBannersOf(db, userIds), imageBannersOf(db, userIds)]);
  return new Map(
    userIds.flatMap((id) => {
      const banner = cards.get(id) ?? images.get(id);
      return banner ? [[id, banner] as const] : [];
    }),
  );
}

/** Bannière d'un joueur (null : bannière par défaut). */
export async function bannerOf(db: DbOrTx, userId: string) {
  return (await bannersOf(db, [userId])).get(userId) ?? null;
}

/** Le joueur a-t-il une image importée (pour proposer d'y revenir quand une carte la remplace) ? */
export async function hasBannerImage(db: DbOrTx, userId: string): Promise<boolean> {
  return (await imageBannersOf(db, [userId])).has(userId);
}

/** Enregistre l'image importée (remplace la précédente) : elle devient la bannière, à la place d'une carte. */
export async function saveBannerImage(ctx: Ctx, userId: string, base64: string): Promise<BannerDTO> {
  const buf = Buffer.from(base64, "base64");
  if (buf.length === 0) throw badRequest("banner_empty", "Image vide.");
  if (buf.length > BANNER_IMAGE_MAX_BYTES) throw badRequest("banner_too_big", "Image trop lourde (180 ko maximum).");
  const info = sniffImage(buf);
  if (!info) throw badRequest("banner_format", "Format non reconnu : envoie une image WebP, JPEG ou PNG.");
  if (!info.width || !info.height || info.width > BANNER_MAX_SIDE || info.height > BANNER_MAX_SIDE) {
    throw badRequest("banner_size", `Image trop grande (${BANNER_MAX_SIDE} px de côté maximum).`);
  }
  const now = ctx.now();
  await ctx.db.transaction(async (tx) => {
    await tx
      .insert(schema.playerBanners)
      .values({ userId, image: buf, mime: info.mime, updatedAt: now })
      .onConflictDoUpdate({
        target: schema.playerBanners.userId,
        set: { image: buf, mime: info.mime, updatedAt: now },
      });
    await tx.update(schema.players).set({ bannerCardId: null }).where(eq(schema.players.userId, userId));
  });
  return { kind: "image", userId, version: versionOf(now) };
}

/** Prend une carte de sa collection comme bannière (l'image importée reste enregistrée pour y revenir). */
export async function setBannerCard(ctx: Ctx, userId: string, cardId: number): Promise<BannerDTO> {
  const [owned] = await ctx.db.execute(
    sql`select 1 from card_instances where owner_id = ${userId} and card_id = ${cardId} limit 1`,
  );
  if (!owned) throw notFound("Tu ne possèdes pas cette carte.");
  await ctx.db.update(schema.players).set({ bannerCardId: cardId }).where(eq(schema.players.userId, userId));
  const banner = await bannerOf(ctx.db, userId);
  if (banner?.kind !== "card") throw notFound("Carte introuvable.");
  return banner;
}

/** Quitte la carte : retour à l'image importée, s'il y en a une, sinon à la bannière par défaut. */
export async function clearBannerCard(ctx: Ctx, userId: string): Promise<BannerDTO | null> {
  await ctx.db.update(schema.players).set({ bannerCardId: null }).where(eq(schema.players.userId, userId));
  return bannerOf(ctx.db, userId);
}

/** Retire la bannière, carte comme image (retour à la bannière par défaut). */
export async function deleteBanner(ctx: Ctx, userId: string) {
  await ctx.db.transaction(async (tx) => {
    await tx.delete(schema.playerBanners).where(eq(schema.playerBanners.userId, userId));
    await tx.update(schema.players).set({ bannerCardId: null }).where(eq(schema.players.userId, userId));
  });
}

export async function getBannerImage(ctx: Ctx, userId: string) {
  const [row] = await ctx.db
    .select({ image: schema.playerBanners.image, mime: schema.playerBanners.mime })
    .from(schema.playerBanners)
    .where(eq(schema.playerBanners.userId, userId));
  return row ?? null;
}
