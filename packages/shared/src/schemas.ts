import { z } from "zod";

/** Pseudo : 3 à 20 caractères, lettres, chiffres, _ et . (règle du plugin username de Better Auth). */
export const usernameSchema = z
  .string()
  .trim()
  .min(3, "3 caractères minimum")
  .max(20, "20 caractères maximum")
  .regex(/^[a-zA-Z0-9_.]+$/, "Lettres, chiffres, _ et . uniquement");

export const passwordSchema = z.string().min(8, "8 caractères minimum").max(128);

/** Avatars proposés dans les Paramètres (le serveur refuse tout le reste). */
export const AVATARS = [
  "🦉",
  "🐉",
  "🦊",
  "🐺",
  "🦁",
  "🐙",
  "🦄",
  "🐢",
  "🦋",
  "🌋",
  "🗿",
  "🎭",
  "🧭",
  "📜",
  "🪐",
  "⚓",
] as const;
export const avatarSchema = z.enum(AVATARS);

/**
 * Photo de profil importée : `players.avatar` vaut alors `img:<userId>.<version>` (posé par le serveur
 * seulement, PATCH /me/settings n'accepte que les emojis). L'image est servie par GET /avatars/:userId.
 */
export const AVATAR_IMAGE_PREFIX = "img:";
/** Côté du carré envoyé par le navigateur (recadré et réduit avant l'envoi). */
export const AVATAR_IMAGE_SIZE = 256;
/** Poids maximal accepté par le serveur, image décodée. */
export const AVATAR_IMAGE_MAX_BYTES = 150_000;

/** Référence d'une photo importée, ou null pour un emoji / l'initiale. */
export function avatarImage(avatar: string | null | undefined): { userId: string; version: string } | null {
  if (!avatar?.startsWith(AVATAR_IMAGE_PREFIX)) return null;
  const [userId, version] = avatar.slice(AVATAR_IMAGE_PREFIX.length).split(".");
  return userId && version ? { userId, version } : null;
}
