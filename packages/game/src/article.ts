import { baseTitle, maskExtract } from "./battle.js";
import { CATEGORY_LABELS, typeStem, type ArticleCategory } from "./category.js";
import { RARITIES, type Rarity } from "./rarity.js";

// ---------------------------------------------------------------------------
// Article du jour : un article à deviner, le même pour tout le monde (jour de Paris), façon Loldle.
// Chaque essai est un vrai article du jeu (Super rare ou mieux), choisi dans une autocomplétion, et il est
// comparé à la réponse sur six attributs : catégorie, type, pays, année, rareté, popularité. Vert : identique ;
// orange : proche ; rouge : différent ; flèches pour les valeurs numériques. L'image de la réponse, pixelisée
// par le serveur, se précise à chaque essai. Huit essais ; indices de secours après les essais ratés :
// catégories Wikipédia (2e, 3e, 5e), description (4e), première lettre (6e).
// Gain : 70 PW pour avoir trouvé, plus un bonus de 30 PW qui perd 5 PW par essai (100 au premier, 70 au 7e).
// ---------------------------------------------------------------------------

export const ARTICLE_MAX_GUESSES = 8;
export const ARTICLE_BASE_REWARD = 70;
export const ARTICLE_BONUS_MAX = 30;
export const ARTICLE_BONUS_STEP = 5;
/** Catégories Wikipédia de la réponse : une de plus dévoilée après chacun de ces nombres d'essais ratés. */
export const ARTICLE_HINT_CATEGORIES_AFTER = [2, 3, 5] as const;
/** Description courte masquée dévoilée après ce nombre d'essais ratés. */
export const ARTICLE_HINT_DESCRIPTION_AFTER = 4;
/** Première lettre du titre dévoilée après ce nombre d'essais ratés. */
export const ARTICLE_HINT_LETTER_AFTER = 6;
/** Années « proches » (orange) : à 10 ans près. */
export const ARTICLE_YEAR_NEAR = 10;
/** Popularité « proche » (orange) : à 25 % près des vues de la réponse. */
export const ARTICLE_VIEWS_NEAR = 0.25;
/** Quête « Trouver l'article du jour en N essais ou moins ». */
export const ARTICLE_FAST_GUESSES = 4;
/** Longueur maximale d'une recherche dans l'autocomplétion. */
export const ARTICLE_SEARCH_MAX_LENGTH = 80;
/**
 * Largeur (px) de l'image pixelisée selon le nombre d'essais déjà faits (0 à 7) : quelques taches de couleur
 * au départ, une image floue mais lisible au dernier essai. Partie finie : l'image entière.
 */
export const ARTICLE_IMAGE_WIDTHS = [6, 8, 11, 15, 20, 28, 40, 56] as const;

/** Gain pour avoir trouvé au `guesses`-ième essai (0 si raté). */
export function articleReward(guesses: number, found = true): number {
  if (!found || guesses < 1 || guesses > ARTICLE_MAX_GUESSES) return 0;
  return ARTICLE_BASE_REWARD + Math.max(0, ARTICLE_BONUS_MAX - ARTICLE_BONUS_STEP * (guesses - 1));
}

/** Largeur de l'image pixelisée après `guesses` essais ; null : partie finie, image entière. */
export function articleImageWidth(guesses: number, finished: boolean): number | null {
  if (finished) return null;
  const i = Math.max(0, Math.min(ARTICLE_IMAGE_WIDTHS.length - 1, guesses));
  return ARTICLE_IMAGE_WIDTHS[i]!;
}

// ---------------------------------------------------------------------------
// Attributs et comparaison
// ---------------------------------------------------------------------------

/** Attributs d'un article, figés au moment de l'essai (null : inconnu, case « ? »). */
export interface ArticleAttrs {
  category: ArticleCategory | null;
  /** Premier mot de la description (« acteur », « commune », « film »). */
  type: string | null;
  /** Pays (élément Wikidata) et son nom. */
  countryId: string | null;
  country: string | null;
  /** Continents du pays (éléments Wikidata) : orange si l'un est commun. */
  continents: string[];
  /** Naissance, création, fondation ou publication selon l'article. */
  year: number | null;
  rarity: Rarity;
  /** Vues sur 12 mois. */
  views: number;
}

export const ATTR_KEYS = ["category", "type", "country", "year", "rarity", "views"] as const;
export type AttrKey = (typeof ATTR_KEYS)[number];
export type AttrState = "good" | "near" | "bad" | "unknown";
/** Flèche : la réponse est au-dessus (`up`, plus récente, plus rare, plus lue) ou en dessous. */
export interface AttrCell {
  state: AttrState;
  arrow: "up" | "down" | null;
}
export type AttrComparison = Record<AttrKey, AttrCell>;

export const ATTR_LABELS: Record<AttrKey, string> = {
  category: "Catégorie",
  type: "Type",
  country: "Pays",
  year: "Année",
  rarity: "Rareté",
  views: "Popularité",
};

const cell = (state: AttrState, arrow: AttrCell["arrow"] = null): AttrCell => ({ state, arrow });
const arrowOf = (guess: number, answer: number): AttrCell["arrow"] =>
  answer > guess ? "up" : answer < guess ? "down" : null;

/** Compare un essai à la réponse, attribut par attribut. Un attribut inconnu d'un côté n'est jamais compté faux. */
export function compareAttrs(guess: ArticleAttrs, answer: ArticleAttrs): AttrComparison {
  const category =
    guess.category === null || answer.category === null
      ? cell("unknown")
      : cell(guess.category === answer.category ? "good" : "bad");

  let type = cell("unknown");
  if (guess.type && answer.type) {
    const g = guess.type.toLowerCase();
    const a = answer.type.toLowerCase();
    type = cell(g === a ? "good" : typeStem(g) === typeStem(a) ? "near" : "bad");
  }

  let country = cell("unknown");
  if (guess.countryId && answer.countryId) {
    const shared = guess.continents.some((c) => answer.continents.includes(c));
    country = cell(guess.countryId === answer.countryId ? "good" : shared ? "near" : "bad");
  }

  let year = cell("unknown");
  if (guess.year !== null && answer.year !== null) {
    const gap = Math.abs(guess.year - answer.year);
    year = cell(gap === 0 ? "good" : gap <= ARTICLE_YEAR_NEAR ? "near" : "bad", arrowOf(guess.year, answer.year));
  }

  const gr = RARITIES.indexOf(guess.rarity);
  const ar = RARITIES.indexOf(answer.rarity);
  const rarity = cell(gr === ar ? "good" : "bad", arrowOf(gr, ar));

  let views = cell("unknown");
  if (guess.views > 0 && answer.views > 0) {
    const near = Math.abs(guess.views - answer.views) <= answer.views * ARTICLE_VIEWS_NEAR;
    views = cell(guess.views === answer.views ? "good" : near ? "near" : "bad", arrowOf(guess.views, answer.views));
  }
  return { category, type, country, year, rarity, views };
}

/** Valeurs affichées dans les cases (« ? » si inconnu). */
export function attrValues(a: ArticleAttrs): Record<AttrKey, string> {
  return {
    category: a.category ? CATEGORY_LABELS[a.category] : "?",
    type: a.type ?? "?",
    country: a.country ?? "?",
    year: a.year === null ? "?" : a.year < 0 ? `${-a.year} av. J.-C.` : String(a.year),
    rarity: a.rarity,
    views: a.views > 0 ? compactViews(a.views) : "?",
  };
}

/** « 1,2 M », « 850 k », « 900 » (vues sur 12 mois, à la française). */
export function compactViews(n: number): string {
  const fr = (x: number) => x.toLocaleString("fr-FR", { maximumFractionDigits: 1 });
  if (n >= 1_000_000) return `${fr(Math.round(n / 100_000) / 10)} M`;
  if (n >= 1_000) return `${fr(Math.round(n / 1_000))} k`;
  return String(n);
}

// ---------------------------------------------------------------------------
// Indices de secours, motif du titre, partage
// ---------------------------------------------------------------------------

/** Indices dévoilés après `guesses` essais ratés (tous une fois la partie finie). */
export function articleHints(guesses: number, finished: boolean) {
  return {
    categories: finished
      ? ARTICLE_HINT_CATEGORIES_AFTER.length
      : ARTICLE_HINT_CATEGORIES_AFTER.filter((n) => guesses >= n).length,
    description: finished || guesses >= ARTICLE_HINT_DESCRIPTION_AFTER,
    firstLetter: finished || guesses >= ARTICLE_HINT_LETTER_AFTER,
  };
}

/** Catégories de maintenance ou de portail : aucune information sur l'article. */
const META_CATEGORY =
  /^(article|page|portail|projet|homonymie|bon article|wikipédia|catégorie)|wiki(pédia|data|media)|ébauche|\bà (sourcer|recycler|vérifier|illustrer|wikifier)\b|\bmodèle\b/i;

const plain = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Catégories Wikipédia montrées en indice (cachées déjà écartées par l'API) : sans préfixe, sans les catégories
 * de maintenance, et jamais une qui contient le titre ou un mot commençant par l'un de ses mots significatifs
 * (4 lettres et plus), accents ignorés. Les plus courtes (les plus générales) d'abord : la première dévoilée est la plus vague.
 */
export function hintCategories(raw: string[], title: string): string[] {
  const base = plain(baseTitle(title));
  const words = base.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4);
  const out = new Set<string>();
  for (const r of raw) {
    const name = r
      .replace(/^(catégorie|category)\s*:/i, "")
      .replace(/_/g, " ")
      .trim();
    if (!name || META_CATEGORY.test(name)) continue;
    const p = plain(name);
    const tokens = p.split(/[^\p{L}\p{N}]+/u);
    const named =
      (base.length >= 4 && p.includes(base)) ||
      tokens.includes(base) ||
      words.some((w) => tokens.some((t) => t.startsWith(w)));
    if (named) continue;
    out.add(name);
  }
  return [...out]
    .sort((a, b) => a.length - b.length || a.localeCompare(b, "fr"))
    .slice(0, ARTICLE_HINT_CATEGORIES_AFTER.length);
}

/** Description courte de la réponse, titre et mots du titre masqués (jamais une phrase de l'article). */
export function maskedDescription(description: string | null, title: string): string | null {
  return description ? maskExtract(description, title, 200) : null;
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

const SQUARES: Record<AttrState, string> = { good: "🟩", near: "🟧", bad: "🟥", unknown: "⬜" };

/** Grille de partage façon Wordle : une ligne par essai, une case par attribut, sans rien dévoiler. */
export function shareGrid(rows: AttrComparison[], found: boolean, number: number): string {
  const score = found ? `${rows.length}/${ARTICLE_MAX_GUESSES}` : `X/${ARTICLE_MAX_GUESSES}`;
  return [
    `PalaCards · Article du jour n° ${number} · ${score}`,
    ...rows.map((r) => ATTR_KEYS.map((k) => SQUARES[r[k].state]).join("")),
  ].join("\n");
}

/** Toutes les cases vertes : c'est la réponse. */
export const allGood = (c: AttrComparison) => ATTR_KEYS.every((k) => c[k].state === "good");
