import { eq, inArray, schema } from "@palacards/db";
import { BANNER_IMAGE_MAX_BYTES, type BannerDTO } from "@palacards/shared";
import type { Ctx } from "../context.js";
import { badRequest } from "../errors.js";
import { sniffImage } from "./avatars.js";
import type { DbOrTx } from "./players.js";

/** Côté maximal accepté : le navigateur envoie 1200 × 300 px, on laisse de la marge sans ouvrir la porte aux bombes. */
export const BANNER_MAX_SIDE = 2048;

const versionOf = (updatedAt: Date) => updatedAt.getTime().toString(36);

/** Bannière importée par chacun de ces joueurs (absent : bannière par défaut). Une seule requête pour tout un classement. */
export async function bannersOf(db: DbOrTx, userIds: string[]): Promise<Map<string, BannerDTO>> {
  if (!userIds.length) return new Map();
  const rows = await db
    .select({ userId: schema.playerBanners.userId, updatedAt: schema.playerBanners.updatedAt })
    .from(schema.playerBanners)
    .where(inArray(schema.playerBanners.userId, userIds));
  return new Map(rows.map((r) => [r.userId, { userId: r.userId, version: versionOf(r.updatedAt) }]));
}

/** Enregistre la bannière (remplace la précédente). */
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
  await ctx.db
    .insert(schema.playerBanners)
    .values({ userId, image: buf, mime: info.mime, updatedAt: now })
    .onConflictDoUpdate({
      target: schema.playerBanners.userId,
      set: { image: buf, mime: info.mime, updatedAt: now },
    });
  return { userId, version: versionOf(now) };
}

/** Retire la bannière (retour à la bannière par défaut). */
export async function deleteBannerImage(ctx: Ctx, userId: string) {
  await ctx.db.delete(schema.playerBanners).where(eq(schema.playerBanners.userId, userId));
}

export async function getBannerImage(ctx: Ctx, userId: string) {
  const [row] = await ctx.db
    .select({ image: schema.playerBanners.image, mime: schema.playerBanners.mime })
    .from(schema.playerBanners)
    .where(eq(schema.playerBanners.userId, userId));
  return row ?? null;
}
