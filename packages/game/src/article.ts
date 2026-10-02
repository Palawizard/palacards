import { baseTitle, maskExtract, unusableQuizImage } from "./battle.js";
import type { Rarity } from "./rarity.js";

// ---------------------------------------------------------------------------
// Article du jour : un article populaire à deviner, le même pour tout le monde (jour de Paris).
// Six essais ; chaque erreur dévoile un indice de plus. Gain : 100 PW au premier essai, 10 de moins
// par essai, 50 PW au sixième.
// ---------------------------------------------------------------------------

export const ARTICLE_MAX_GUESSES = 6;
export const ARTICLE_GUESS_MAX_LENGTH = 120;

export function articleReward(guesses: number): number {
  if (guesses < 1 || guesses > ARTICLE_MAX_GUESSES) return 0;
  return 100 - 10 * (guesses - 1);
}

export type ClueKind = "description" | "extract" | "image" | "more" | "letters" | "half" | "rarity" | "stats" | "size";

export interface Clue {
  kind: ClueKind;
  label: string;
  /** Texte de l'indice (absent pour une image). */
  text?: string;
  /** Vignette de l'article (indice « image »). */
  image?: string;
}

const LABELS: Record<ClueKind, string> = {
  description: "Ce que c'est",
  extract: "Première phrase",
  image: "Illustration",
  more: "Un peu plus",
  letters: "Le titre",
  half: "Moitié du titre",
  rarity: "Rareté",
  stats: "Statistiques",
  size: "Longueur du titre",
};

const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’'`]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Déterminants en tête ignorés (« La Joconde » = « Joconde »). */
const stripArticle = (s: string) => s.replace(/^(le|la|les|l|un|une|des|the)\s+/, "");

/** Forme comparable d'un titre ou d'une réponse. */
export function guessKey(s: string): string {
  return stripArticle(normalize(s));
}

/** Distance d'édition (Levenshtein), bornée : au-delà de `max`, renvoie `max + 1`. */
export function editDistance(a: string, b: string, max = 3): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      best = Math.min(best, v);
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length]!;
}

/**
 * Bonne réponse : titre exact, ou sans la précision entre parenthèses (« Mercure (planète) » → « Mercure »),
 * sans accents ni déterminant ; une faute de frappe tolérée à partir de 6 lettres, deux à partir de 12.
 */
export function isCorrectGuess(guess: string, title: string): boolean {
  const g = guessKey(guess);
  if (!g) return false;
  for (const t of new Set([guessKey(title), guessKey(baseTitle(title))])) {
    if (!t) continue;
    if (g === t || g.replace(/ /g, "") === t.replace(/ /g, "")) return true;
    const tolerance = t.length >= 12 ? 2 : t.length >= 6 ? 1 : 0;
    if (tolerance && editDistance(g, t, tolerance) <= tolerance) return true;
  }
  return false;
}

/** Motif du titre : lettres en tirets bas, espaces et ponctuation gardés (« P _ _ _ _   _ _ _ _ »). */
export function titlePattern(title: string, reveal: "none" | "first" | "half" | "all"): string {
  const base = baseTitle(title);
  const letters = [...base].filter((c) => /[\p{L}\p{N}]/u.test(c)).length;
  const keep = reveal === "all" ? letters : reveal === "half" ? Math.ceil(letters / 2) : reveal === "first" ? 1 : 0;
  let seen = 0;
  return [...base]
    .map((c) => {
      if (!/[\p{L}\p{N}]/u.test(c)) return c === " " ? "  " : c;
      seen++;
      return seen <= keep ? c.toUpperCase() : "_";
    })
    .join(" ")
    .replace(/\s{3,}/g, "   ");
}

const sentences = (text: string) => text.split(/(?<=[.!?])\s+(?=[A-ZÀ-Ý«])/);

export interface ArticleSource {
  title: string;
  rarity: Rarity;
  atk: number;
  def: number;
  description: string | null;
  extract: string | null;
  thumbUrl: string | null;
}

/** Le titre et ses mots significatifs masqués dans un texte court (description). */
function maskShort(text: string, title: string): string {
  return maskExtract(text, title, 200);
}

/**
 * Les six indices, du plus vague au plus parlant. Il en faut toujours six : les indices absents
 * (article sans résumé, sans image) sont remplacés par la rareté et les statistiques de la carte.
 */
export function buildClues(a: ArticleSource): Clue[] {
  const out: Clue[] = [];
  const parts = a.extract ? sentences(a.extract) : [];
  const first = parts[0] ? maskExtract(parts[0], a.title, 220) : null;
  const more = parts.length > 1 ? maskExtract(parts.slice(0, 3).join(" "), a.title, 420) : null;
  const image = a.thumbUrl && !unusableQuizImage(a.thumbUrl) ? a.thumbUrl : null;
  const description = a.description ? maskShort(a.description, a.title) : null;

  if (description) out.push({ kind: "description", label: LABELS.description, text: description });
  if (first) out.push({ kind: "extract", label: LABELS.extract, text: first });
  if (image) out.push({ kind: "image", label: LABELS.image, image });
  if (more && more !== first) out.push({ kind: "more", label: LABELS.more, text: more });
  out.push({ kind: "letters", label: LABELS.letters, text: titlePattern(a.title, "first") });
  out.push({ kind: "half", label: LABELS.half, text: titlePattern(a.title, "half") });

  const base = baseTitle(a.title);
  const words = base.split(/\s+/).filter(Boolean).length;
  const letters = [...base].filter((c) => /[\p{L}\p{N}]/u.test(c)).length;
  const fillers: Clue[] = [
    { kind: "rarity", label: LABELS.rarity, text: a.rarity },
    { kind: "stats", label: LABELS.stats, text: `ATK ${a.atk} · DEF ${a.def}` },
    {
      kind: "size",
      label: LABELS.size,
      text: `${words} mot${words > 1 ? "s" : ""}, ${letters} lettre${letters > 1 ? "s" : ""}`,
    },
  ];
  // Indices de remplissage en tête (les plus vagues), pour garder les lettres pour la fin.
  while (out.length < ARTICLE_MAX_GUESSES && fillers.length) out.unshift(fillers.pop()!);
  return out.slice(0, ARTICLE_MAX_GUESSES);
}

/** Ligne de partage façon Wordle : un carré par essai. */
export function shareLine(guesses: number, found: boolean): string {
  const squares = Array.from({ length: guesses }, (_, i) => (found && i === guesses - 1 ? "🟩" : "🟥"));
  return `${squares.join("")}${"⬜".repeat(ARTICLE_MAX_GUESSES - guesses)}`;
}
