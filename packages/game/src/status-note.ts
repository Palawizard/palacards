/**
 * Note de statut d'un joueur (comme les notes Discord) : une courte phrase sur son profil
 * et dans la liste d'amis des autres. Texte brut : l'affichage l'échappe, on refuse en plus
 * les balises, les liens et quelques mots interdits.
 */

/** Longueur maximale, en caractères (un emoji compte pour un). */
export const STATUS_NOTE_MAX = 100;

/** Durée de vie d'une note, en heures (null : elle reste jusqu'à ce que le joueur la change). */
export const STATUS_NOTE_TTL_HOURS: number | null = null;

export type StatusNoteError = "too_long" | "markup" | "link" | "banned";

export const STATUS_NOTE_ERRORS: Record<StatusNoteError, string> = {
  too_long: `Ta note dépasse ${STATUS_NOTE_MAX} caractères.`,
  markup: "Pas de balises dans ta note.",
  link: "Pas de liens dans ta note.",
  banned: "Ta note contient un mot interdit.",
};

/**
 * Mots refusés (insultes et injures discriminatoires), sans accents ni majuscules.
 * Comparés mot à mot, au singulier comme au pluriel : « dispute » ne bloque pas « pute ».
 */
export const STATUS_NOTE_BANNED_WORDS: readonly string[] = [
  "batard",
  "bougnoul",
  "bougnoule",
  "connard",
  "connasse",
  "encule",
  "enculer",
  "fdp",
  "gouine",
  "negre",
  "negro",
  "nique",
  "niquer",
  "ntm",
  "pd",
  "pede",
  "pouffiasse",
  "pute",
  "salope",
  "tafiole",
  "tapette",
  "youpin",
];

const BANNED = new Set(STATUS_NOTE_BANNED_WORDS);
const SUFFIXES = ["", "s", "e", "es"];

/** Caractères invisibles ou de contrôle (sauf la liaison des emojis composés, U+200D). */
const INVISIBLE = new RegExp(
  "[\\p{Cc}\\u00AD\\u180E\\u200B\\u200C\\u200E\\u200F\\u202A-\\u202E\\u2060-\\u2069\\uFEFF]",
  "gu",
);
const MARKUP = /<\s*\/?\s*[a-z!?][^>]*>/i;
const LINK =
  /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|fr|net|org|io|gg|be|ch|ca|xyz|me|tv|ly|co|app|dev|link|info|eu|ru|to|sh)\b)/i;
/** Chiffres et symboles qui remplacent des lettres pour contourner le filtre. */
const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", $: "s" };

/** Longueur en caractères visibles (points de code), pas en unités UTF-16. */
export const statusNoteLength = (note: string) => [...note].length;

/** Espaces et retours à la ligne réduits à une espace, caractères invisibles retirés. */
export function cleanStatusNote(raw: string): string {
  return raw.normalize("NFC").replace(/\s+/g, " ").replace(INVISIBLE, "").trim();
}

function hasBannedWord(note: string): boolean {
  const plain = note
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[013457@$]/g, (c) => LEET[c] ?? c);
  return plain
    .split(/[^a-z]+/)
    .some((word) => SUFFIXES.some((s) => word.endsWith(s) && BANNED.has(word.slice(0, word.length - s.length))));
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
  if (hasBannedWord(note)) return { ok: false, error: "banned" };
  return { ok: true, note };
}

/** Note encore visible à `now` (null si absente ou expirée). */
export function visibleStatusNote(note: string | null, setAt: Date | null, now: Date): string | null {
  if (!note) return null;
  if (STATUS_NOTE_TTL_HOURS === null || !setAt) return note;
  return now.getTime() - setAt.getTime() < STATUS_NOTE_TTL_HOURS * 3_600_000 ? note : null;
}
