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

/**
 * Bannière importée (haut du profil, fond de sa ligne aux classements) : image recadrée en 4:1 et réduite par le
 * navigateur, servie par GET /banners/:userId?v=<version>. Le poids reste sous la limite de corps de l'API en base64.
 */
export const BANNER_IMAGE_WIDTH = 1200;
export const BANNER_IMAGE_HEIGHT = 300;
export const BANNER_IMAGE_MAX_BYTES = 180_000;

/** Suggestions des joueurs (page Suggestions) : même liste que `suggestions.kind` en base. */
export const SUGGESTION_KINDS = ["bug", "feature", "content", "balance", "other"] as const;
export type SuggestionKind = (typeof SUGGESTION_KINDS)[number];
export const SUGGESTION_STATUSES = ["new", "accepted", "done", "declined"] as const;
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];
/** Longueurs maximales. Pas de plafond par jour : seul l'anti-spam de la route (10 envois par minute) limite le rythme. */
export const SUGGESTION_LIMITS = { title: 100, body: 2_000, reply: 1_000 } as const;

export const suggestionInputSchema = z.object({
  kind: z.enum(SUGGESTION_KINDS),
  title: z.string().trim().min(4, "4 caractères minimum").max(SUGGESTION_LIMITS.title),
  body: z.string().trim().min(10, "10 caractères minimum").max(SUGGESTION_LIMITS.body),
});
