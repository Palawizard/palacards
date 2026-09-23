import { ECONOMY } from "./economy.js";

export const BATTLE_ROUNDS = 5;
export const ROUNDS_TO_WIN = 3;
export const DECK_SIZE = 5;
/** Temps de réponse par question, mesuré par le serveur. */
export const QUESTION_TIME_MS = 10_000;
/** Marge réseau tolérée au-delà des 10 s avant de compter la réponse comme absente. */
export const ANSWER_GRACE_MS = 1_500;
export const ELO_K = 32;
export const ELO_START = 1_000;
/** Un défi non accepté expire au bout de 48 h ; un duel asynchrone doit être fini en 72 h. */
export const CHALLENGE_TTL_MS = 48 * 60 * 60_000;
export const ASYNC_BATTLE_TTL_MS = 72 * 60 * 60_000;
/** Anti-farm : au-delà de ce nombre de duels terminés dans la journée entre deux joueurs, plus de PW (l'Elo compte toujours). */
export const BATTLE_REWARDED_PER_PAIR_PER_DAY = 3;

// ---------------------------------------------------------------------------
// Aléatoire à graine (duels asynchrones : mêmes questions pour les deux joueurs)
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

function shuffle<T>(items: T[], rand: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

export type QuestionType = "who_am_i" | "most_viewed" | "longest";

export interface QuizCard {
  cardId: number;
  title: string;
  views12m: number;
  pageLen: number;
  extract: string | null;
}

export interface Question {
  type: QuestionType;
  prompt: string;
  choices: string[];
  /** Index de la bonne réponse : ne quitte jamais le serveur avant la réponse du joueur. */
  answer: number;
}

const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/** Masque le titre (et ses mots significatifs) dans le résumé, puis le tronque proprement. */
export function maskExtract(extract: string, title: string, maxLength = 260): string {
  const base = title.replace(/\s*\(.*\)\s*$/, "");
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
  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), maxLength - 30))}…`;
}

/**
 * Question d'une manche, identique pour les deux joueurs : dépend seulement de la graine,
 * des deux cartes et des titres leurres fournis par le serveur.
 */
export function makeQuestion(seed: string, round: number, a: QuizCard, b: QuizCard, decoys: string[]): Question {
  const rand = seededRandom(`${seed}:${round}`);
  const withExtract = [a, b].filter((c) => c.extract && c.extract.length > 60);
  const sameArticle = a.title === b.title;
  const types: QuestionType[] = [];
  if (withExtract.length && decoys.length >= 3) types.push("who_am_i");
  if (!sameArticle && a.views12m !== b.views12m) types.push("most_viewed");
  if (!sameArticle && a.pageLen !== b.pageLen) types.push("longest");
  const type = types.length ? types[Math.floor(rand() * types.length)]! : "who_am_i";

  if (type === "who_am_i" && (withExtract.length || decoys.length >= 3)) {
    const target = withExtract.length ? withExtract[Math.floor(rand() * withExtract.length)]! : a;
    // L'autre carte de la manche figure parmi les leurres : la réponse n'est jamais « la seule carte connue ».
    const other = target === a ? b : a;
    const pool = [...(other.title !== target.title ? [other.title] : []), ...shuffle(decoys, rand)].filter(
      (d, i, all) => d !== target.title && all.indexOf(d) === i,
    );
    const choices = shuffle([target.title, ...pool.slice(0, 3)], rand);
    const prompt = target.extract
      ? maskExtract(target.extract, target.title)
      : `Quel article compte ${target.pageLen.toLocaleString("fr-FR")} octets et a été lu ${target.views12m.toLocaleString("fr-FR")} fois cette année ?`;
    return { type: "who_am_i", prompt, choices, answer: choices.indexOf(target.title) };
  }
  if (type === "longest") {
    const choices = shuffle([a.title, b.title], rand);
    const longest = a.pageLen > b.pageLen ? a.title : b.title;
    return { type, prompt: "Lequel de ces deux articles est le plus long ?", choices, answer: choices.indexOf(longest) };
  }
  // most_viewed (et repli si aucune autre question n'est possible)
  const choices = shuffle([a.title, b.title], rand);
  const top = a.views12m >= b.views12m ? a.title : b.title;
  return { type: "most_viewed", prompt: "Lequel de ces deux articles a été le plus lu cette année ?", choices, answer: choices.indexOf(top) };
}

// ---------------------------------------------------------------------------
// Combat
// ---------------------------------------------------------------------------

/**
 * puissance = ATK × (1 + 0,5·juste + 0,25·(t_restant / 10 s)) − 0,3 × DEF_adverse
 * Le bonus de vitesse ne compte que pour une bonne réponse.
 */
export function roundPower(atk: number, opponentDef: number, correct: boolean, timeLeftMs: number): number {
  const t = Math.max(0, Math.min(QUESTION_TIME_MS, timeLeftMs));
  const speed = correct ? 0.25 * (t / QUESTION_TIME_MS) : 0;
  return Math.round(atk * (1 + (correct ? 0.5 : 0) + speed) - 0.3 * opponentDef);
}

/** Vainqueur d'une manche : plus grosse puissance, puis plus grosse DEF ; sinon manche nulle. */
export function roundWinner(p1: { power: number; def: number }, p2: { power: number; def: number }): 1 | 2 | 0 {
  if (p1.power !== p2.power) return p1.power > p2.power ? 1 : 2;
  if (p1.def !== p2.def) return p1.def > p2.def ? 1 : 2;
  return 0;
}

/** Le duel s'arrête dès 3 manches gagnées, ou après 5 manches. */
export function battleOver(score1: number, score2: number, roundsPlayed: number): boolean {
  return score1 >= ROUNDS_TO_WIN || score2 >= ROUNDS_TO_WIN || roundsPlayed >= BATTLE_ROUNDS;
}

/** Résultat final : au score, puis à la puissance cumulée ; égalité parfaite = nul. */
export function battleResult(score1: number, score2: number, power1: number, power2: number): 1 | 2 | 0 {
  if (score1 !== score2) return score1 > score2 ? 1 : 2;
  if (power1 !== power2) return power1 > power2 ? 1 : 2;
  return 0;
}

/** Nouveaux Elo (K = 32). `outcome` = score du joueur 1 : 1 victoire, 0,5 nul, 0 défaite. */
export function eloUpdate(r1: number, r2: number, outcome: 1 | 0.5 | 0): { r1: number; r2: number } {
  const expected1 = 1 / (1 + 10 ** ((r2 - r1) / 400));
  const delta = Math.round(ELO_K * (outcome - expected1));
  return { r1: r1 + delta, r2: r2 - delta };
}

/** Récompense en PW d'un duel terminé. */
export function battleReward(outcome: "win" | "loss" | "draw"): number {
  if (outcome === "win") return ECONOMY.battle.win;
  if (outcome === "loss") return ECONOMY.battle.loss;
  return Math.round((ECONOMY.battle.win + ECONOMY.battle.loss) / 2);
}
