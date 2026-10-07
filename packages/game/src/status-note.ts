/**
 * Note de statut d'un joueur (comme les notes Discord) : une courte phrase sur son profil,
 * dans la liste d'amis des autres et dans les classements. Texte brut : l'affichage l'échappe,
 * on refuse en plus les balises et les liens. Pas de modération automatique : un abus se signale
 * à la main.
 */

/** Longueur maximale, en caractères (un emoji compte pour un). */
export const STATUS_NOTE_MAX = 100;

/** Durée de vie d'une note, en heures (null : elle reste jusqu'à ce que le joueur la change). */
export const STATUS_NOTE_TTL_HOURS: number | null = null;

export type StatusNoteError = "too_long" | "markup" | "link";

export const STATUS_NOTE_ERRORS: Record<StatusNoteError, string> = {
  too_long: `Ta note dépasse ${STATUS_NOTE_MAX} caractères.`,
  markup: "Pas de balises dans ta note.",
  link: "Pas de liens dans ta note.",
};

/** Caractères invisibles ou de contrôle (sauf la liaison des emojis composés, U+200D). */
const INVISIBLE = new RegExp(
  "[\\p{Cc}\\u00AD\\u180E\\u200B\\u200C\\u200E\\u200F\\u202A-\\u202E\\u2060-\\u2069\\uFEFF]",
  "gu",
);
const MARKUP = /<\s*\/?\s*[a-z!?][^>]*>/i;
const LINK =
  /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|fr|net|org|io|gg|be|ch|ca|xyz|me|tv|ly|co|app|dev|link|info|eu|ru|to|sh)\b)/i;

/** Longueur en caractères visibles (points de code), pas en unités UTF-16. */
export const statusNoteLength = (note: string) => [...note].length;

/** Espaces et retours à la ligne réduits à une espace, caractères invisibles retirés. */
export function cleanStatusNote(raw: string): string {
  return raw.normalize("NFC").replace(/\s+/g, " ").replace(INVISIBLE, "").trim();
}

/** Note prête à enregistrer (null : note effacée), ou la raison du refus. */
export function checkStatusNote(
  raw: string | null,
): { ok: true; note: string | null } | { ok: false; error: StatusNoteError } {
  const note = cleanStatusNote(raw ?? "");
  if (!note) return { ok: true, note: null };
  if (statusNoteLength(note) > STATUS_NOTE_MAX) return { ok: false, error: "too_long" };
  if (MARKUP.test(note)) return { ok: false, error: "markup" };
  if (LINK.test(note)) return { ok: false, error: "link" };
  return { ok: true, note };
}

/** Note encore visible à `now` (null si absente ou expirée). */
export function visibleStatusNote(note: string | null, setAt: Date | null, now: Date): string | null {
  if (!note) return null;
  if (STATUS_NOTE_TTL_HOURS === null || !setAt) return note;
  return now.getTime() - setAt.getTime() < STATUS_NOTE_TTL_HOURS * 3_600_000 ? note : null;
}
