import { addDays } from "./market.js";
import {
  PERFECT_PARRY_MS,
  definitionDecoys,
  descriptionHead,
  maskYear,
  pick,
  seededRandom,
  shuffle,
  titlesClash,
  unusableQuizImage,
  yearCandidates,
  type QuizArticle,
} from "./battle.js";
import { ARTICLE_CATEGORIES, type ArticleCategory } from "./category.js";
import type { Rarity } from "./rarity.js";

// ---------------------------------------------------------------------------
// Boss du jour (coopératif) : une Légendaire de la saison, la même pour tout le monde, avec des PV partagés.
// Le boss ne meurt plus : quand une phase tombe, la suivante arrive aussitôt, avec 40 % de PV en plus, et
// le combat dure jusqu'à minuit.
//
// Chaque joueur a 2 assauts par jour ; un assaut = 5 articles de sa collection, 5 questions sur ces articles.
// Une carte qui touche frappe de 40 + ATK ÷ 100, multiplié par :
//   - la règle du jour : ×2 pour la catégorie en faiblesse, ×0,5 pour celle en résistance ;
//   - la question : QCM juste ×1 (×1,5 en moins de 4 s, critique) ; année tapée ×1,5 (exacte, critique) à
//     ×0,25 (à 25 ans près) ; duel à deux choix contre le boss ×0,75 sans critique.
// Un article joué contre le boss se repose 3 jours, et le même couple article + type de question n'est
// jamais reposé au même joueur tant qu'il en reste d'autres : plus de mémorisation d'un jour à l'autre.
//
// Équilibrage (estimation, à recaler sur les données) : les joueurs jouent leurs plus fortes cartes
// (≈ 7 000 ATK, 110 par coup). Taux de bonnes réponses visés : définition ≈ 85 %, image (leurres du même
// genre, hors sélection) ≈ 70 %, année tapée ≈ 35 % à 2 ans près et ≈ 60 % à 10 ans près, duels ≈ 65 %, soit
// ≈ 60 à 65 % en moyenne. Multiplicateur moyen d'une question ≈ 0,75 (contre ≈ 1,25 avant : 90 % de bonnes
// réponses, 80 % de critiques), ≈ 1,05 avec les faiblesses jouées en priorité : un assaut fait ≈ 550 dégâts
// (≈ 720 mesurés avant), ≈ 1 100 par joueur et par jour.
//
// PV : la phase 1 vaut 35 % des dégâts quotidiens moyens des 7 derniers jours, la phase k 1,4^(k−1) fois plus.
// Les phases tombent donc vers 35 %, 84 % et 153 % des dégâts d'un jour moyen : la 1 en cours de journée, la 2
// un bon jour, la 3 un très bon jour. Les jours de l'ancien format (questions plus faciles) comptent pour 60 %.
// ---------------------------------------------------------------------------

/** PV minimaux de la phase 1 (peu de joueurs, ou aucun historique). */
export const BOSS_MIN_HP = 3_000;
/** Part des dégâts quotidiens moyens donnée en PV à la phase 1. */
export const BOSS_PHASE1_SHARE = 0.35;
/** Chaque phase a 40 % de PV de plus que la précédente. */
export const BOSS_PHASE_GROWTH = 1.4;
/** Plafond des PV de la phase 1 (garde-fou si l'historique est aberrant). */
export const BOSS_HP_CAP = 100_000;
/** Jours d'historique pris en compte pour les PV. */
export const BOSS_HP_WINDOW_DAYS = 7;
/** Poids des jours de l'ancien format dans l'historique (questions plus faciles, dégâts surestimés). */
export const BOSS_LEGACY_HISTORY_FACTOR = 0.6;
/** Version du boss : 1 = boss qui tombe une fois (avant les phases), 2 = boss à phases. */
export const BOSS_VERSION = 2;

export const BOSS_ASSAULTS_PER_DAY = 2;
export const BOSS_CARDS_PER_ASSAULT = 5;
export const BOSS_QUESTION_MS = 12_000;
/** Année à taper : un peu plus de temps qu'un QCM. */
export const BOSS_YEAR_QUESTION_MS = 18_000;
/** Marge réseau tolérée au-delà du chrono. */
export const BOSS_ANSWER_GRACE_MS = 1_500;
export const BOSS_CRIT_MS = PERFECT_PARRY_MS;
export const BOSS_CRIT_MULT = 1.5;
/** Catégorie en faiblesse : dégâts doublés ; en résistance : divisés par deux. */
export const BOSS_WEAKNESS_MULT = 2;
export const BOSS_RESISTANCE_MULT = 0.5;
/** Un article joué le jour J redevient jouable le jour J + 3 (jours de Paris). */
export const BOSS_FATIGUE_DAYS = 3;
/** Duel à deux choix (50 % au hasard) : dégâts réduits, jamais de critique. */
export const BOSS_DUEL_MULT = 0.75;
/** Écarts minimaux pour poser un duel : 10 ans, ou un article lu 1,5 fois plus que l'autre. */
export const BOSS_DUEL_MIN_YEARS = 10;
export const BOSS_DUEL_MIN_VIEWS_RATIO = 1.5;
/** Année tapée : multiplicateur selon l'écart (exacte, puis à 2, 10 et 25 ans près, au-delà 0). */
export const BOSS_YEAR_BANDS: { maxGap: number; mult: number }[] = [
  { maxGap: 0, mult: 1.5 },
  { maxGap: 2, mult: 1 },
  { maxGap: 10, mult: 0.5 },
  { maxGap: 25, mult: 0.25 },
];
/** Dégâts à infliger dans la journée pour toucher la récompense des phases tombées. */
export const BOSS_PHASE_MIN_DAMAGE = 200;

/**
 * Récompenses, versées à minuit : pour chaque phase tombée dans la journée, à chaque joueur qui a infligé au
 * moins BOSS_PHASE_MIN_DAMAGE dégâts (phases 1 et 2 : PW et un paquet bonus ; les suivantes : PW seuls).
 * Un paquet de plus au meilleur assaillant ; lot de consolation à ceux qui ont touché le boss sans récompense
 * de phase.
 */
export const BOSS_REWARDS = {
  phases: [
    { pw: 50, packs: 1 },
    { pw: 50, packs: 1 },
  ],
  laterPhase: { pw: 75, packs: 0 },
  mvpPacks: 1,
  consolationPw: 30,
} as const;

// ---------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------

/** Arrondi au multiple de 50 (affichage propre des PV). */
const round50 = (n: number) => Math.round(n / 50) * 50;

/**
 * PV de la phase 1 d'après les dégâts totaux des derniers jours (jours sans assaut ignorés), les jours de
 * l'ancien format pondérés par BOSS_LEGACY_HISTORY_FACTOR, arrondis au quart de millier supérieur.
 */
export function bossPhase1Hp(history: { damage: number; legacy: boolean }[]): number {
  const days = history.filter((d) => Number.isFinite(d.damage) && d.damage > 0);
  if (!days.length) return BOSS_MIN_HP;
  const avg = days.reduce((s, d) => s + d.damage * (d.legacy ? BOSS_LEGACY_HISTORY_FACTOR : 1), 0) / days.length;
  const hp = Math.ceil((avg * BOSS_PHASE1_SHARE) / 250) * 250;
  return Math.min(BOSS_HP_CAP, Math.max(BOSS_MIN_HP, hp));
}

/** PV de la phase `k` (1-indexée). */
export function bossPhaseHp(phase1: number, k: number): number {
  return k <= 1 ? phase1 : round50(phase1 * BOSS_PHASE_GROWTH ** (k - 1));
}

export interface BossPhaseState {
  /** Phase en cours (1-indexée). */
  phase: number;
  /** PV de la phase en cours. */
  maxHp: number;
  /** PV restants de la phase en cours. */
  hp: number;
  /** Phases déjà tombées. */
  fallen: number;
}

/** État du boss d'après les dégâts de la journée : le surplus d'un coup qui fait tomber une phase passe à la suivante. */
export function bossPhaseState(phase1: number, totalDamage: number): BossPhaseState {
  let left = Math.max(0, Math.floor(totalDamage));
  let k = 1;
  // Garde-fou : jamais plus de 100 phases (PV absurdes).
  while (k < 100 && left >= bossPhaseHp(phase1, k)) {
    left -= bossPhaseHp(phase1, k);
    k++;
  }
  const maxHp = bossPhaseHp(phase1, k);
  return { phase: k, maxHp, hp: maxHp - left, fallen: k - 1 };
}

// ---------------------------------------------------------------------------
// Règle du jour : faiblesse et résistance
// ---------------------------------------------------------------------------

export interface BossRule {
  weakness: ArticleCategory;
  resistance: ArticleCategory;
}

/**
 * Faiblesse (×2) et résistance (×0,5) du jour, tirées d'après le jour, jamais les mêmes que la veille
 * (ni la même faiblesse, ni la même résistance), et toujours différentes l'une de l'autre.
 */
export function bossDayRule(day: string, previous: BossRule | null = null): BossRule {
  const rand = seededRandom(`boss-rule:${day}`);
  const weakness = pick(
    ARTICLE_CATEGORIES.filter((c) => c !== previous?.weakness),
    rand,
  );
  const resistance = pick(
    ARTICLE_CATEGORIES.filter((c) => c !== weakness && c !== previous?.resistance),
    rand,
  );
  return { weakness, resistance };
}

/** Multiplicateur de dégâts d'une catégorie d'article ce jour-là. */
export function categoryMult(category: ArticleCategory, rule: BossRule): number {
  if (category === rule.weakness) return BOSS_WEAKNESS_MULT;
  if (category === rule.resistance) return BOSS_RESISTANCE_MULT;
  return 1;
}

// ---------------------------------------------------------------------------
// Cartes fatiguées
// ---------------------------------------------------------------------------

/** Jours de repos restants d'un article joué le jour `playedDay` (0 : jouable aujourd'hui). */
export function fatigueRestDays(playedDay: string, today: string): number {
  const back = addDays(playedDay, BOSS_FATIGUE_DAYS);
  if (back <= today) return 0;
  const ms = Date.parse(`${back}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

/** Premier jour encore « fatigué » : un article joué à partir de ce jour n'est pas jouable aujourd'hui. */
export const fatigueSince = (today: string) => addDays(today, 1 - BOSS_FATIGUE_DAYS);

// ---------------------------------------------------------------------------
// Dégâts
// ---------------------------------------------------------------------------

/** Dégâts d'une carte qui touche, avant multiplicateurs (41 à 140). */
export function bossHitBase(atk: number): number {
  return Math.round(40 + Math.max(0, atk) / 100);
}

export type BossHit = "miss" | "hit" | "crit";

/** Multiplicateur d'une année tapée selon l'écart avec la bonne (1,5 exacte … 0 au-delà de 25 ans). */
export function bossYearMult(guess: number | null, answer: number): number {
  if (guess === null || !Number.isFinite(guess)) return 0;
  const gap = Math.abs(Math.round(guess) - answer);
  return BOSS_YEAR_BANDS.find((b) => gap <= b.maxGap)?.mult ?? 0;
}

/**
 * Qualité d'un coup. QCM : juste en moins de 4 s, critique. Duel : jamais de critique. Année tapée : exacte,
 * critique ; à 25 ans près, touché (dégâts réduits selon l'écart).
 */
export function bossHit(
  input:
    | { kind: "choice"; correct: boolean; answerMs: number | null }
    | { kind: "duel"; correct: boolean; answerMs: number | null }
    | { kind: "year"; guess: number | null; answer: number },
): BossHit {
  if (input.kind === "year") {
    const mult = bossYearMult(input.guess, input.answer);
    return mult >= BOSS_CRIT_MULT ? "crit" : mult > 0 ? "hit" : "miss";
  }
  if (!input.correct || input.answerMs === null) return "miss";
  if (input.kind === "duel") return "hit";
  return input.answerMs <= BOSS_CRIT_MS ? "crit" : "hit";
}

/** Multiplicateur de la question (avant faiblesse ou résistance). */
export function bossQuestionMult(
  type: BossQuestionType,
  hit: BossHit,
  year?: { guess: number | null; answer: number },
): number {
  if (hit === "miss") return 0;
  if (type === "year_input") return year ? bossYearMult(year.guess, year.answer) : 0;
  if (isDuel(type)) return BOSS_DUEL_MULT;
  return hit === "crit" ? BOSS_CRIT_MULT : 1;
}

/** Dégâts d'un coup : base × question × catégorie, arrondis (au moins 1 dès qu'il touche). */
export function bossDamage(atk: number, questionMult: number, catMult = 1): number {
  if (questionMult <= 0) return 0;
  return Math.max(1, Math.round(bossHitBase(atk) * questionMult * catMult));
}

// ---------------------------------------------------------------------------
// Récompenses
// ---------------------------------------------------------------------------

/** Récompense de la phase `k` (1-indexée). */
export function bossPhaseReward(k: number): { pw: number; packs: number } {
  return BOSS_REWARDS.phases[k - 1] ?? BOSS_REWARDS.laterPhase;
}

/**
 * Ce que touche un joueur pour une journée : phases tombées pas encore payées (`paidPhases` : phases déjà
 * payées, 2 pour une chute de l'ancien format), s'il a atteint le seuil de dégâts ; sinon, consolation s'il a
 * touché le boss. Le paquet du meilleur assaillant est versé à part.
 */
export function bossDayReward(input: { fallen: number; damage: number; paidPhases: number }): {
  phases: number[];
  pw: number;
  packs: number;
  consolation: boolean;
} {
  const eligible = input.damage >= BOSS_PHASE_MIN_DAMAGE && input.fallen > 0;
  if (!eligible) {
    const consolation = input.damage > 0 && input.paidPhases === 0;
    return { phases: [], pw: consolation ? BOSS_REWARDS.consolationPw : 0, packs: 0, consolation };
  }
  const phases: number[] = [];
  for (let k = input.paidPhases + 1; k <= input.fallen; k++) phases.push(k);
  const total = phases.reduce(
    (s, k) => {
      const r = bossPhaseReward(k);
      return { pw: s.pw + r.pw, packs: s.packs + r.packs };
    },
    { pw: 0, packs: 0 },
  );
  return { phases, ...total, consolation: false };
}

// ---------------------------------------------------------------------------
// Questions du boss : sur l'article de la carte jouée, jamais reposées au même joueur
// ---------------------------------------------------------------------------

/**
 * - `definition` : « Qu'est-ce que X ? », 4 descriptions courtes (leurres du même genre) ;
 * - `image` : « Quelle image illustre X ? », 4 vignettes d'articles du même genre (carte face cachée) ;
 * - `year_input` : une année à taper (phrase de l'extrait, ou date Wikidata) ;
 * - `duel_older` / `duel_popular` : « Lequel est le plus ancien / le plus lu ? », la carte contre le boss ;
 * - `popular` : repli sans résumé, « lequel est le plus lu ? », 4 titres.
 */
export type BossQuestionType = "definition" | "image" | "year_input" | "duel_older" | "duel_popular" | "popular";

export const BOSS_QUESTION_LABELS: Record<BossQuestionType, string> = {
  definition: "C'est quoi ?",
  image: "Quelle image ?",
  year_input: "Quelle année ?",
  duel_older: "Le plus ancien",
  duel_popular: "Le plus lu",
  popular: "Le plus lu",
};

export const isDuel = (type: string) => type === "duel_older" || type === "duel_popular";

/** Date Wikidata retenue pour un article : naissance, création ou fondation, publication, début. */
export type YearKind = "birth" | "inception" | "publication" | "start";

export interface BossQuizArticle extends QuizArticle {
  rarity: Rarity;
  /** Année Wikidata (null : inconnue). */
  year: number | null;
  yearKind: YearKind | null;
}

export interface BossQuestion {
  type: BossQuestionType;
  /** Variante (une année de l'extrait, la date Wikidata…) : avec le type, ce qu'on ne repose pas au joueur. */
  key: string;
  prompt: string;
  /** Choix (titres, descriptions ou URL d'images) ; vide pour une année à taper. */
  choices: string[];
  /** Index de la bonne réponse, ou l'année pour `year_input`. Ne quitte jamais le serveur avant la réponse. */
  answer: number;
  /** La carte donnerait la réponse (image) : face cachée jusqu'à la réponse. */
  cardHidden: boolean;
  durationMs: number;
}

/** Chrono d'une question. */
export const bossQuestionMs = (type: string) => (type === "year_input" ? BOSS_YEAR_QUESTION_MS : BOSS_QUESTION_MS);

const YEAR_PROMPTS: Record<YearKind, (t: string) => string> = {
  birth: (t) => `En quelle année est né·e « ${t} » ?`,
  inception: (t) => `En quelle année a été créé ou fondé « ${t} » ?`,
  publication: (t) => `En quelle année est sorti « ${t} » ?`,
  start: (t) => `En quelle année a commencé « ${t} » ?`,
};

const capitalize = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

interface Variant {
  type: BossQuestionType;
  key: string;
  build: (rand: () => number) => Omit<BossQuestion, "type" | "key" | "durationMs">;
}

/** Variantes possibles pour cet article (chacune posable une fois au joueur avant toute redite). */
export function bossQuestionVariants(
  seed: string,
  target: BossQuizArticle,
  decoys: QuizArticle[],
  options: { boss: BossQuizArticle | null; maxYear: number },
): Variant[] {
  const pool = decoys.filter(
    (d, i) => d.cardId !== target.cardId && decoys.findIndex((x) => x.cardId === d.cardId) === i,
  );
  const head = descriptionHead(target.description);
  const sameKindFirst = (items: QuizArticle[]) => [
    ...items.filter((d) => head && descriptionHead(d.description) === head),
    ...items.filter((d) => !head || descriptionHead(d.description) !== head),
  ];
  const out: Variant[] = [];

  const desc = target.description?.trim() || null;
  const defDecoys = desc
    ? definitionDecoys(
        desc,
        pool.map((d) => d.description?.trim() ?? "").filter(Boolean),
        seededRandom(`${seed}:definition`),
      )
    : null;
  if (desc && defDecoys)
    out.push({
      type: "definition",
      key: "definition",
      build: (rand) => {
        const choices = shuffle([desc, ...defDecoys], rand);
        return {
          prompt: `Qu'est-ce que « ${target.title} » ?`,
          choices: choices.map(capitalize),
          answer: choices.indexOf(desc),
          cardHidden: false,
        };
      },
    });

  const thumb = unusableQuizImage(target.thumbUrl) ? null : target.thumbUrl;
  const withThumb = sameKindFirst(
    pool.filter(
      (d, i, all) =>
        !unusableQuizImage(d.thumbUrl) &&
        d.thumbUrl !== target.thumbUrl &&
        all.findIndex((x) => x.thumbUrl === d.thumbUrl) === i,
    ),
  );
  if (thumb && withThumb.length >= 3)
    out.push({
      type: "image",
      key: "image",
      build: (rand) => {
        const others = shuffle(withThumb.slice(0, 6), rand).slice(0, 3);
        const choices = shuffle([thumb, ...others.map((d) => d.thumbUrl!)], rand);
        return {
          prompt: `Quelle image illustre « ${target.title} » ?`,
          choices,
          answer: choices.indexOf(thumb),
          cardHidden: true,
        };
      },
    });

  // Années de l'extrait : une variante par année (une même phrase peut en masquer plusieurs).
  const seenYears = new Set<number>();
  for (const { sentence, year } of target.extract ? yearCandidates(target.extract, options.maxYear) : []) {
    if (seenYears.has(year)) continue;
    seenYears.add(year);
    out.push({
      type: "year_input",
      key: `extract:${year}`,
      build: () => ({ prompt: maskYear(sentence, year), choices: [], answer: year, cardHidden: false }),
    });
  }
  if (target.year !== null && target.yearKind && target.year <= options.maxYear) {
    const year = target.year;
    const kind = target.yearKind;
    out.push({
      type: "year_input",
      key: "wikidata",
      build: () => ({ prompt: YEAR_PROMPTS[kind](target.title), choices: [], answer: year, cardHidden: false }),
    });
  }

  const boss = options.boss && options.boss.cardId !== target.cardId ? options.boss : null;
  if (boss && duelPossible("duel_older", target, boss)) {
    out.push({
      type: "duel_older",
      key: "older",
      build: (rand) =>
        duelQuestion(
          "Lequel est le plus ancien ? (naissance, création ou sortie)",
          target,
          boss,
          rand,
          (a, b) => a.year! < b.year!,
        ),
    });
  }
  if (boss && duelPossible("duel_popular", target, boss)) {
    out.push({
      type: "duel_popular",
      key: "popular",
      build: (rand) =>
        duelQuestion("Lequel a été le plus lu cette année ?", target, boss, rand, (a, b) => a.views12m > b.views12m),
    });
  }

  if (!out.length) {
    // Repli (article sans résumé ni date) : lequel est le plus lu ? Leurres aux vues distinctes.
    const distinct = pool.filter(
      (d, i, all) =>
        d.views12m !== target.views12m &&
        !titlesClash(d.title, target.title) &&
        all.findIndex((x) => x.views12m === d.views12m) === i,
    );
    if (distinct.length >= 1)
      out.push({
        type: "popular",
        key: "popular4",
        build: (rand) => {
          const all = [target, ...shuffle(distinct, rand).slice(0, 3)];
          const top = all.reduce((best, d) => (d.views12m > best.views12m ? d : best), target);
          const choices = shuffle(
            all.map((d) => d.title),
            rand,
          );
          return {
            prompt: "Lequel de ces articles a été le plus lu cette année ?",
            choices,
            answer: choices.indexOf(top.title),
            cardHidden: false,
          };
        },
      });
  }
  return out;
}

/**
 * Un duel n'est posé que si les deux valeurs existent et diffèrent nettement. « Le plus lu » exige aussi la
 * même rareté que le boss : la rareté vient des vues, une carte plus commune serait forcément moins lue.
 */
export function duelPossible(
  type: "duel_older" | "duel_popular",
  a: Pick<BossQuizArticle, "year" | "views12m" | "rarity" | "title">,
  b: Pick<BossQuizArticle, "year" | "views12m" | "rarity" | "title">,
): boolean {
  if (titlesClash(a.title, b.title)) return false;
  if (type === "duel_older")
    return a.year !== null && b.year !== null && Math.abs(a.year - b.year) >= BOSS_DUEL_MIN_YEARS;
  if (a.rarity !== b.rarity || a.views12m <= 0 || b.views12m <= 0) return false;
  return Math.max(a.views12m, b.views12m) / Math.min(a.views12m, b.views12m) >= BOSS_DUEL_MIN_VIEWS_RATIO;
}

function duelQuestion(
  prompt: string,
  target: BossQuizArticle,
  boss: BossQuizArticle,
  rand: () => number,
  wins: (a: BossQuizArticle, b: BossQuizArticle) => boolean,
) {
  const winner = wins(target, boss) ? target : boss;
  const choices = shuffle([target.title, boss.title], rand);
  return { prompt, choices, answer: choices.indexOf(winner.title), cardHidden: false };
}

/**
 * Question du boss sur un article. Déterministe : ne dépend que de la graine (joueur, jour, assaut), de la
 * cible, des leurres et de l'historique du joueur.
 * - Variantes jamais posées au joueur d'abord, en évitant les types déjà posés dans l'assaut (`avoid`), le
 *   type tiré avant la variante (une phrase riche en années ne fait pas que des questions d'année) ;
 * - tout est épuisé : la variante posée il y a le plus longtemps.
 */
export function makeBossQuestion(
  seed: string,
  target: BossQuizArticle,
  decoys: QuizArticle[],
  options: {
    boss: BossQuizArticle | null;
    /** Variantes déjà posées au joueur sur cet article, avec leur date (ms). */
    history?: { type: string; key: string; askedAt: number }[];
    avoid?: string[];
    maxYear?: number;
  },
): BossQuestion {
  const rand = seededRandom(seed);
  const variants = bossQuestionVariants(seed, target, decoys, {
    boss: options.boss,
    maxYear: options.maxYear ?? new Date().getFullYear(),
  });
  const asked = new Map((options.history ?? []).map((h) => [`${h.type}:${h.key}`, h.askedAt]));
  let chosen: Variant | undefined;
  const fresh = variants.filter((v) => !asked.has(`${v.type}:${v.key}`));
  if (fresh.length) {
    const notAvoided = fresh.filter((v) => !options.avoid?.includes(v.type));
    const from = notAvoided.length ? notAvoided : fresh;
    const types = [...new Set(from.map((v) => v.type))];
    const type = pick(types, rand);
    chosen = pick(
      from.filter((v) => v.type === type),
      rand,
    );
  } else if (variants.length) {
    chosen = [...variants].sort((a, b) => asked.get(`${a.type}:${a.key}`)! - asked.get(`${b.type}:${b.key}`)!)[0];
  }
  if (!chosen) {
    // Rien de posable (aucun leurre, en pratique jamais : l'API fournit toujours des articles au hasard).
    return {
      type: "popular",
      key: "none",
      prompt: `Cet article est-il une Légendaire ?`,
      choices: ["Oui", "Non"],
      answer: target.rarity === "L" ? 0 : 1,
      cardHidden: false,
      durationMs: BOSS_QUESTION_MS,
    };
  }
  return {
    type: chosen.type,
    key: chosen.key,
    ...chosen.build(seededRandom(`${seed}:${chosen.type}:${chosen.key}`)),
    durationMs: bossQuestionMs(chosen.type),
  };
}
