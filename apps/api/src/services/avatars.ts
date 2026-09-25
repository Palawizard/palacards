import { eq, schema } from "@palacards/db";
import { AVATAR_IMAGE_MAX_BYTES, AVATAR_IMAGE_PREFIX } from "@palacards/shared";
import type { Ctx } from "../context.js";
import { badRequest } from "../errors.js";

export type AvatarMime = "image/webp" | "image/jpeg" | "image/png";

/** Côté maximal accepté : le navigateur envoie un carré de 256 px, on laisse de la marge sans ouvrir la porte aux bombes. */
export const AVATAR_MAX_SIDE = 1024;

/**
 * Type et dimensions d'une image d'après ses octets (jamais d'après ce que déclare le client).
 * Reconnaît PNG, JPEG et WebP (VP8, VP8L, VP8X) ; null pour tout le reste.
 */
export function sniffImage(buf: Buffer): { mime: AvatarMime; width: number; height: number } | null {
  if (buf.length < 30) return null;
  // PNG : signature, puis le bloc IHDR (largeur et hauteur sur 4 octets).
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    if (buf.toString("latin1", 12, 16) !== "IHDR") return null;
    return { mime: "image/png", width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  // JPEG : SOI, puis les segments jusqu'au premier SOFn qui porte les dimensions.
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) return null;
      const marker = buf[i + 1]!;
      if (marker === 0xff) {
        i++;
        continue;
      }
      const len = buf.readUInt16BE(i + 2);
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) return { mime: "image/jpeg", height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      if (len < 2) return null;
      i += 2 + len;
    }
    return null;
  }
  // WebP : conteneur RIFF, puis le premier bloc selon le format.
  if (buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "WEBP") {
    const chunk = buf.toString("latin1", 12, 16);
    if (chunk === "VP8 " && buf[23] === 0x9d && buf[24] === 0x01 && buf[25] === 0x2a) {
      return { mime: "image/webp", width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    }
    if (chunk === "VP8L" && buf[20] === 0x2f) {
      const bits = buf.readUInt32LE(21);
      return { mime: "image/webp", width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (chunk === "VP8X") {
      return { mime: "image/webp", width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 };
    }
  }
  return null;
}

/** Enregistre la photo de profil (remplace la précédente) et fait pointer `players.avatar` dessus. */
export async function saveAvatarImage(ctx: Ctx, userId: string, base64: string): Promise<string> {
  const buf = Buffer.from(base64, "base64");
  if (buf.length === 0) throw badRequest("avatar_empty", "Image vide.");
  if (buf.length > AVATAR_IMAGE_MAX_BYTES) throw badRequest("avatar_too_big", "Image trop lourde (150 ko maximum).");
  const info = sniffImage(buf);
  if (!info) throw badRequest("avatar_format", "Format non reconnu : envoie une image WebP, JPEG ou PNG.");
  if (!info.width || !info.height || info.width > AVATAR_MAX_SIDE || info.height > AVATAR_MAX_SIDE) {
    throw badRequest("avatar_size", `Image trop grande (${AVATAR_MAX_SIDE} px de côté maximum).`);
  }
  const now = ctx.now();
  const avatar = `${AVATAR_IMAGE_PREFIX}${userId}.${now.getTime().toString(36)}`;
  await ctx.db.transaction(async (tx) => {
    await tx
      .insert(schema.playerAvatars)
      .values({ userId, image: buf, mime: info.mime, updatedAt: now })
      .onConflictDoUpdate({
        target: schema.playerAvatars.userId,
        set: { image: buf, mime: info.mime, updatedAt: now },
      });
    await tx.update(schema.players).set({ avatar }).where(eq(schema.players.userId, userId));
  });
  return avatar;
}

/** Supprime la photo importée (retour à l'initiale, ou à l'emoji choisi à la place). */
export async function deleteAvatarImage(ctx: Ctx, userId: string) {
  await ctx.db.delete(schema.playerAvatars).where(eq(schema.playerAvatars.userId, userId));
}

export async function getAvatarImage(ctx: Ctx, userId: string) {
  const [row] = await ctx.db
    .select({ image: schema.playerAvatars.image, mime: schema.playerAvatars.mime })
    .from(schema.playerAvatars)
    .where(eq(schema.playerAvatars.userId, userId));
  return row ?? null;
}
