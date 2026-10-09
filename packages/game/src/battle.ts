import { ECONOMY } from "./economy.js";
import type { Rarity } from "./rarity.js";

// ---------------------------------------------------------------------------
// Règles du duel « Attaque / Bouclier » (en direct uniquement)
//
// Chaque joueur a un deck de 5 cartes et 100 PV. Les joueurs attaquent à tour de rôle (4 fois chacun).
// Tour : l'attaquant choisit une carte (face cachée : rareté et dégâts seulement), le défenseur choisit
// un bouclier, puis répond à une question sur l'article de la carte attaquante.
//   - juste : attaque parée (0 dégât) ; juste et rapide : parade parfaite, une partie des dégâts revient ;
//   - faux ou temps écoulé : dégâts de la carte, réduits par le bouclier.
// Chaque carte attaque au plus une fois et défend au plus une fois.
// ---------------------------------------------------------------------------

export const DECK_SIZE = 5;
export const BATTLE_HP = 100;
export const ATTACKS_PER_PLAYER = 4;
export const TOTAL_TURNS = ATTACKS_PER_PLAYER * 2;

/** Durées des phases d'un tour, mesurées par le serveur. */
export const ATTACK_TIME_MS = 15_000;
export const SHIELD_TIME_MS = 10_000;
export const QUESTION_TIME_MS = 12_000;
/** Affichage du résultat d'un tour avant le suivant. */
export const REVEAL_TIME_MS = 4_500;
/** Marge réseau tolérée au-delà du chrono de la question avant de compter la réponse comme absente. */
export const ANSWER_GRACE_MS = 1_500;
/** Après l'acceptation, les deux joueurs ont ce délai pour ouvrir l'écran du duel. */
export const LOBBY_TIMEOUT_MS = 2 * 60_000;
/** Un joueur qui laisse filer ce nombre d'actions d'affilée (chrono écoulé) abandonne. */
export const AFK_FORFEIT = 3;

/** Réponse juste en moins de ce temps : parade parfaite. */
export const PERFECT_PARRY_MS = 4_000;
/** Part des dégâts (avant bouclier) renvoyée à l'attaquant par une parade parfaite. */
export const PERFECT_PARRY_REFLECT = 0.2;
/** Réduction maximale d'un bouclier, en %. */
export const SHIELD_MAX_PCT = 50;

/**
 * Multiplicateur de dégâts par rareté, à ajuster avec les taux d'erreur mesurés en jeu : on vise des
 * dégâts moyens par attaque (dégâts × taux d'erreur) proches d'une rareté à l'autre. Les cartes rares
 * sont les plus lues, donc les mieux connues : elles frappent fort mais sont souvent parées.
 */
export const RARITY_DAMAGE_MULT: Record<Rarity, number> = { C: 1, PC: 1, R: 1, SR: 1, UR: 1, L: 1 };

export const ELO_K = 32;
export const ELO_START = 1_000;
/** Un défi non accepté expire au bout de 48 h. */
export const CHALLENGE_TTL_MS = 48 * 60 * 60_000;
/** Attente maximale dans la file de matchmaking : sans adversaire au bout de 5 minutes, le joueur en sort. */
export const BATTLE_QUEUE_TTL_MS = 5 * 60_000;
/** Anti-farm : au-delà de ce nombre de duels terminés dans la journée entre deux joueurs, plus de PW ni d'Elo. */
export const BATTLE_REWARDED_PER_PAIR_PER_DAY = 3;

export type BattlePhase = "lobby" | "attack" | "shield" | "question" | "reveal";

// ---------------------------------------------------------------------------
// Aléatoire à graine (questions reproductibles)
// ---------------------------------------------------------------------------

/** Générateur déterministe (mulberry32) à partir d'une graine texte (hachage FNV-1a). */
export function seededRandom(seed: string): () => number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(items: T[], rand: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export const pick = <T>(items: T[], rand: () => number): T => items[Math.floor(rand() * items.length)]!;

// ---------------------------------------------------------------------------
// Dégâts
// ---------------------------------------------------------------------------

/** Dégâts d'une carte qui touche, avant bouclier : ATK ÷ 100 (1 à 100). */
export function attackDamage(atk: number, rarity: Rarity): number {
  return Math.max(1, Math.round((atk / 100) * RARITY_DAMAGE_MULT[rarity]));
}

/** Réduction d'un bouclier, en % : DEF ÷ 200, plafonnée à 50 %. */
export function shieldPercent(def: number): number {
  return Math.max(0, Math.min(SHIELD_MAX_PCT, Math.round(def / 200)));
}

export type Parry = "none" | "parry" | "perfect";

export interface HitResult {
  /** Dégâts de la carte avant bouclier. */
  raw: number;
  /** Réduction du bouclier en % (appliquée seulement si l'attaque touche). */
  shieldPct: number;
  /** Dégâts subis par le défenseur. */
  damage: number;
  /** Dégâts renvoyés à l'attaquant (parade parfaite). */
  reflected: number;
  parry: Parry;
}

/**
 * Résout une attaque. `answerMs` : temps de réponse mesuré par le serveur (null : pas de réponse).
 * Juste → 0 dégât ; juste en moins de 4 s → 20 % des dégâts bruts renvoyés ; faux → dégâts − bouclier.
 */
export function resolveHit(input: {
  atk: number;
  rarity: Rarity;
  shieldDef: number | null;
  correct: boolean;
  answerMs: number | null;
}): HitResult {
  const raw = attackDamage(input.atk, input.rarity);
  const shieldPct = input.shieldDef === null ? 0 : shieldPercent(input.shieldDef);
  if (input.correct) {
    const perfect = input.answerMs !== null && input.answerMs <= PERFECT_PARRY_MS;
    return {
      raw,
      shieldPct,
      damage: 0,
      reflected: perfect ? Math.max(1, Math.round(raw * PERFECT_PARRY_REFLECT)) : 0,
      parry: perfect ? "perfect" : "parry",
    };
  }
  const damage = Math.max(1, Math.round(raw * (1 - shieldPct / 100)));
  return { raw, shieldPct, damage, reflected: 0, parry: "none" };
}

// ---------------------------------------------------------------------------
// Déroulé
// ---------------------------------------------------------------------------

/** Qui attaque au tour `turn` (1-indexé) : le premier attaquant aux tours impairs. */
export function attackerOfTurn<T>(turn: number, first: T, second: T): T {
  return turn % 2 === 1 ? first : second;
}

/** Le duel s'arrête quand un joueur tombe à 0 PV ou après le dernier tour. */
export function battleOver(hp1: number, hp2: number, turnsPlayed: number): boolean {
  return hp1 <= 0 || hp2 <= 0 || turnsPlayed >= TOTAL_TURNS;
}

/** Résultat : le plus de PV restants, puis le plus de dégâts infligés ; sinon nul. */
export function battleResult(hp1: number, hp2: number, dealt1: number, dealt2: number): 1 | 2 | 0 {
  const a = Math.max(0, hp1);
  const b = Math.max(0, hp2);
  if (a !== b) return a > b ? 1 : 2;
  if (dealt1 !== dealt2) return dealt1 > dealt2 ? 1 : 2;
  return 0;
}

/** Nouveaux Elo (K = 32). `outcome` = score du joueur 1 : 1 victoire, 0,5 nul, 0 défaite. */
export function eloUpdate(r1: number, r2: number, outcome: 1 | 0.5 | 0): { r1: number; r2: number } {
  const expected1 = 1 / (1 + 10 ** ((r2 - r1) / 400));
  const delta = Math.round(ELO_K * (outcome - expected1));
  return { r1: r1 + delta, r2: r2 - delta };
}

/**
 * Le duel compte-t-il pour l'Elo ? (anti-farm avec des comptes secondaires)
 * - seulement les `BATTLE_REWARDED_PER_PAIR_PER_DAY` premiers duels de la paire dans la journée, comme les PW ;
 * - jamais si le perdant n'a rien joué lui-même (abandon, absence) : rien ne se gagne sur un compte inactif.
 *   Pour un nul, il suffit qu'un des deux n'ait pas joué.
 * `result` : 1 le joueur 1 gagne, 2 le joueur 2, 0 nul ; `played1/2` : le joueur a fait au moins une action.
 */
export function battleRated(input: {
  pairFinishedToday: number;
  result: 1 | 2 | 0;
  played1: boolean;
  played2: boolean;
}): boolean {
  if (input.pairFinishedToday >= BATTLE_REWARDED_PER_PAIR_PER_DAY) return false;
  if (input.result === 1) return input.played2;
  if (input.result === 2) return input.played1;
  return input.played1 && input.played2;
}

/** Récompense en PW d'un duel terminé. */
export function battleReward(outcome: "win" | "loss" | "draw"): number {
  if (outcome === "win") return ECONOMY.battle.win;
  if (outcome === "loss") return ECONOMY.battle.loss;
  return Math.round((ECONOMY.battle.win + ECONOMY.battle.loss) / 2);
}

// ---------------------------------------------------------------------------
// Questions : toujours sur l'article de la carte attaquante, 4 choix
// ---------------------------------------------------------------------------

/**
 * - `definition` : « Qu'est-ce que X ? », 4 descriptions courtes (Wikidata) ;
 * - `year` : extrait avec une année masquée, 4 années proches ;
 * - `image` : « Quelle image illustre X ? », 4 vignettes ;
 * - `who_am_i` : extrait au titre masqué, 4 titres (la carte reste cachée jusqu'à la réponse) ;
 * - `popular` : repli sans résumé, « lequel est le plus lu ? », 4 titres.
 */
export type QuestionType = "definition" | "year" | "image" | "who_am_i" | "popular";

export const QUESTION_LABELS: Record<QuestionType, string> = {
  definition: "C'est quoi ?",
  year: "Quelle année ?",
  image: "Quelle image ?",
  who_am_i: "Qui suis-je ?",
  popular: "Le plus lu",
};

/** Article utilisable pour une question (la cible ou un leurre). */
export interface QuizArticle {
  cardId: number;
  title: string;
  views12m: number;
  extract: string | null;
  description: string | null;
  thumbUrl: string | null;
}

export interface Question {
  type: QuestionType;
  /** Texte de la question (extrait masqué, phrase à trou…). */
  prompt: string;
  /** Choix : textes, ou URL d'images pour `image`. */
  choices: string[];
  /** Index de la bonne réponse : ne quitte jamais le serveur avant la réponse du défenseur. */
  answer: number;
  /** Le titre de la carte attaquante reste caché jusqu'à la réponse (« Qui suis-je ? »). */
  titleHidden: boolean;
}

const normalize = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Titre sans précision entre parenthèses (« Valmy (Marne) » → « Valmy »). */
export const baseTitle = (title: string) => title.replace(/\s*\(.*\)\s*$/, "").trim();

/** Deux titres trop proches pour servir de leurre l'un à l'autre (l'un contient l'autre). */
export function titlesClash(a: string, b: string): boolean {
  const x = normalize(baseTitle(a));
  const y = normalize(baseTitle(b));
  return x === y || x.includes(y) || y.includes(x);
}

/** Masque le titre (et ses mots significatifs) dans le résumé, puis le tronque proprement. */
export function maskExtract(extract: string, title: string, maxLength = 260): string {
  const base = baseTitle(title);
  const words = [base, ...base.split(/[\s'’-]+/).filter((w) => w.length >= 4)];
  let text = extract;
  for (const w of words.sort((x, y) => y.length - x.length)) {
    const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    text = text.replace(new RegExp(escaped, "gi"), "▢▢▢");
    // Variante sans accents (« Elan » pour « Élan »).
    const plain = normalize(w);
    if (plain !== w.toLowerCase()) {
      const idx = normalize(text).indexOf(plain);
      if (idx >= 0) text = text.slice(0, idx) + "▢▢▢" + text.slice(idx + w.length);
    }
  }
  return truncate(text, maxLength);
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), maxLength - 30))}…`;
}

const capitalize = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

const YEAR = /(?<![\d,.])(1[0-9]{3}|20[0-9]{2})(?![\d,])/g;

/** Années exploitables d'un extrait (phrases d'au moins 30 caractères, années passées) : questions « Quelle année ? ». */
export function yearCandidates(extract: string, maxYear: number): { sentence: string; year: number }[] {
  const sentences = extract.split(/(?<=[.!?])\s+(?=[A-ZÀ-Ý«])/);
  const candidates: { sentence: string; year: number }[] = [];
  for (const sentence of sentences) {
    for (const m of sentence.matchAll(YEAR)) {
      const year = Number(m[1]);
      if (year <= maxYear && sentence.length >= 30) candidates.push({ sentence, year });
    }
  }
  return candidates;
}

/** La phrase avec cette année masquée (▢▢▢▢), tronquée proprement. */
export function maskYear(sentence: string, year: number, maxLength = 280): string {
  return truncate(sentence.replace(new RegExp(`(?<![\\d,.])${year}(?![\\d,])`, "g"), "▢▢▢▢"), maxLength);
}

/**
 * Phrase à trou : une année de l'extrait est masquée, 4 années proches proposées (petit, moyen et grand écart).
 * Renvoie null s'il n'y a pas d'année exploitable.
 */
export function yearQuestion(
  extract: string,
  rand: () => number,
  maxYear: number,
): Omit<Question, "titleHidden"> | null {
  const candidates = yearCandidates(extract, maxYear);
  if (candidates.length === 0) return null;
  const { sentence, year } = pick(candidates, rand);
  const masked = maskYear(sentence, year);
  const seen = new Set([year, ...[...sentence.matchAll(YEAR)].map((m) => Number(m[1]))]);
  const bands = [
    [1, 2, 3],
    [4, 6, 8, 10, 12],
    [15, 20, 25, 30, 40, 50],
  ];
  const decoys: number[] = [];
  for (const band of bands) {
    for (let attempt = 0; attempt < 12; attempt++) {
      const sign = rand() < 0.5 ? -1 : 1;
      let y = year + sign * pick(band, rand);
      if (y > maxYear) y = year - (y - year);
      if (!seen.has(y) && y > 0) {
        seen.add(y);
        decoys.push(y);
        break;
      }
    }
  }
  if (decoys.length < 3) return null;
  const choices = [year, ...decoys].sort((x, y) => x - y);
  return {
    type: "year",
    prompt: masked,
    choices: choices.map(String),
    answer: choices.indexOf(year),
  };
}

/** Mots significatifs d'un texte (minuscules, sans accents, 3 lettres et plus). */
const words = (s: string) =>
  normalize(s)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3);

/**
 * « Genre » d'un article d'après le premier mot de sa description Wikidata (« chaîne de télévision… »
 * → `chaine`, « homme politique… » → `homme`) : sert à choisir des leurres du même genre.
 */
export function descriptionHead(description: string | null | undefined): string | null {
  const first = description?.trim().split(/\s+/)[0];
  return first ? normalize(first).replace(/[^a-z0-9]/g, "") || null : null;
}

/**
 * Vignette inutilisable dans une question « Quelle image ? » : SVG (logos et blasons écrivent souvent le
 * nom en toutes lettres) et images de remplacement (« Défaut », silhouettes, points d'interrogation).
 */
export function unusableQuizImage(url: string | null | undefined): boolean {
  if (!url) return true;
  let file = url;
  try {
    file = decodeURIComponent(url);
  } catch {
    // URL mal encodée : on garde le texte brut
  }
  return /\.svg|d[ée]faut|silhouette|placeholder|no[ _-]?image|image[ _-]manquante|question[ _-]?(mark|book)/i.test(
    file,
  );
}

/** Mots communs aux deux descriptions sur l'ensemble de leurs mots (Jaccard) : doublon de sens au-delà de 0,6. */
function wordOverlap(a: string, b: string): number {
  const x = new Set(words(a));
  const y = new Set(words(b));
  if (!x.size || !y.size) return 0;
  let common = 0;
  for (const w of x) if (y.has(w)) common++;
  return common / (x.size + y.size - common);
}

/**
 * Trois leurres de description pour « C'est quoi ? », sans indice de longueur : on tire au sort combien
 * de leurres seront plus longs que la bonne réponse (0 à 3), puis on les prend du même genre d'abord.
 * Les leurres restent dans une fourchette de longueur (½ à 2×) et ne répètent pas la bonne réponse.
 */
export function definitionDecoys(target: string, pool: string[], rand: () => number): string[] | null {
  const len = target.length;
  const head = descriptionHead(target);
  const ok = pool.filter((d, i) => {
    const n = d.length;
    return (
      n >= len * 0.5 &&
      n <= len * 2 &&
      normalize(d) !== normalize(target) &&
      wordOverlap(d, target) < 0.6 &&
      pool.findIndex((x) => normalize(x) === normalize(d)) === i
    );
  });
  // Même genre d'abord (ordre tiré au sort dans chaque groupe).
  const ranked = [
    ...shuffle(
      ok.filter((d) => descriptionHead(d) === head),
      rand,
    ),
    ...shuffle(
      ok.filter((d) => descriptionHead(d) !== head),
      rand,
    ),
  ];
  const longer = ranked.filter((d) => d.length > len);
  const shorter = ranked.filter((d) => d.length <= len);
  const order = shuffle([0, 1, 2, 3], rand);
  for (const nLonger of order) {
    if (longer.length >= nLonger && shorter.length >= 3 - nLonger) {
      return [...longer.slice(0, nLonger), ...shorter.slice(0, 3 - nLonger)];
    }
  }
  return null;
}

/**
 * Question sur la carte attaquante. Déterministe : ne dépend que de la graine, de la cible et des leurres.
 * `decoys` : articles candidats, les plus proches d'abord (même genre, puis titres voisins, puis hasard).
 * `avoid` : types déjà posés dans ce duel, évités quand un autre type est possible.
 * `known` : articles que le joueur sait être en jeu (ses autres cartes au boss). S'il est fourni, les questions
 * où l'on reconnaît un titre ou une image (image, « Qui suis-je ? », le plus lu) ne prennent leurs leurres
 * que là : la cible ne se distingue plus comme « la carte que je connais » parmi des inconnues.
 */
export function makeQuestion(
  seed: string,
  target: QuizArticle,
  decoys: QuizArticle[],
  options: { avoid?: QuestionType[]; maxYear?: number; known?: QuizArticle[] } = {},
): Question {
  const rand = seededRandom(seed);
  const unique = (list: QuizArticle[]) =>
    list.filter((d, i) => d.cardId !== target.cardId && list.findIndex((x) => x.cardId === d.cardId) === i);
  const pool = unique(decoys);
  /** Leurres des questions de reconnaissance. */
  const recog = options.known ? unique(options.known) : pool;
  const maxYear = options.maxYear ?? new Date().getFullYear();
  const head = descriptionHead(target.description);
  /** Même genre que la cible (description qui commence par le même mot) : en tête de liste. */
  const sameKindFirst = (items: QuizArticle[]) => [
    ...items.filter((d) => head && descriptionHead(d.description) === head),
    ...items.filter((d) => !head || descriptionHead(d.description) !== head),
  ];

  const descTarget = target.description?.trim() || null;
  const defDecoys = descTarget
    ? definitionDecoys(
        descTarget,
        pool.map((d) => d.description?.trim() ?? "").filter(Boolean),
        seededRandom(`${seed}:definition`),
      )
    : null;
  const targetThumb = unusableQuizImage(target.thumbUrl) ? null : target.thumbUrl;
  const withThumb = sameKindFirst(
    recog.filter(
      (d, i, all) =>
        !unusableQuizImage(d.thumbUrl) &&
        d.thumbUrl !== target.thumbUrl &&
        all.findIndex((x) => x.thumbUrl === d.thumbUrl) === i,
    ),
  );
  const titled = sameKindFirst(recog.filter((d) => !titlesClash(d.title, target.title)));
  const year = target.extract ? yearQuestion(target.extract, seededRandom(`${seed}:year`), maxYear) : null;

  const possible: QuestionType[] = [];
  if (descTarget && defDecoys) possible.push("definition");
  if (year) possible.push("year");
  if (targetThumb && withThumb.length >= 3) possible.push("image");
  if (target.extract && target.extract.length > 60 && titled.length >= 3) possible.push("who_am_i");
  const fresh = possible.filter((t) => !options.avoid?.includes(t));
  const types = fresh.length ? fresh : possible;
  const type: QuestionType = types.length ? pick(types, rand) : "popular";

  if (type === "definition") {
    const choices = shuffle([descTarget!, ...defDecoys!], rand);
    return {
      type,
      prompt: `Qu'est-ce que « ${target.title} » ?`,
      choices: choices.map(capitalize),
      answer: choices.indexOf(descTarget!),
      titleHidden: false,
    };
  }
  if (type === "year") return { ...year!, titleHidden: false };
  if (type === "image") {
    // Les leurres du même genre d'abord : on en tire 3 parmi les 6 premiers.
    const others = shuffle(withThumb.slice(0, 6), rand).slice(0, 3);
    const choices = shuffle([targetThumb!, ...others.map((d) => d.thumbUrl!)], rand);
    return {
      type,
      prompt: `Quelle image illustre « ${target.title} » ?`,
      choices,
      answer: choices.indexOf(targetThumb!),
      titleHidden: false,
    };
  }
  if (type === "who_am_i") {
    // Les leurres les plus proches (même genre, titres voisins) d'abord : 3 parmi les 6 premiers.
    const others = shuffle(titled.slice(0, 6), rand).slice(0, 3);
    const choices = shuffle([target.title, ...others.map((d) => d.title)], rand);
    return {
      type,
      prompt: maskExtract(target.extract!, target.title),
      choices,
      answer: choices.indexOf(target.title),
      titleHidden: true,
    };
  }
  // Repli (article sans résumé ni description) : lequel est le plus lu ? Leurres aux vues distinctes.
  const distinctViews = (list: QuizArticle[]) =>
    list.filter((d, i, all) => d.views12m !== target.views12m && all.findIndex((x) => x.views12m === d.views12m) === i);
  let distinct = distinctViews(titled);
  if (distinct.length < 3) distinct = distinctViews(pool.filter((d) => !titlesClash(d.title, target.title)));
  const others = shuffle(distinct, rand).slice(0, 3);
  const all = [target, ...others];
  const top = all.reduce((best, d) => (d.views12m > best.views12m ? d : best), target);
  const choices = shuffle(
    all.map((d) => d.title),
    rand,
  );
  return {
    type: "popular",
    prompt: "Lequel de ces articles a été le plus lu cette année ?",
    choices,
    answer: choices.indexOf(top.title),
    titleHidden: false,
  };
}

/**
 * La carte attaquante reste face cachée jusqu'à la réponse : son titre est la réponse (« Qui suis-je ? »)
 * ou son image l'est (« Quelle image ? »).
 */
export const cardHiddenUntilAnswer = (q: Pick<Question, "type" | "titleHidden">) => q.titleHidden || q.type === "image";
