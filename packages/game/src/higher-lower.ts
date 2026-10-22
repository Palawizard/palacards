import type { RandomInt } from "./packs.js";

// ---------------------------------------------------------------------------
// « Plus ou moins vu » (remplace l'article du jour)
//
// Trois essais par jour (heure de Paris). Un essai oppose deux articles : le joueur choisit celui qui a eu le
// plus de vues sur 12 mois. Bonne réponse : la série monte de 1, l'article le plus vu reste et un nouveau
// arrive en face, avec un écart de vues de plus en plus serré. Mauvaise réponse ou temps écoulé : l'essai
// s'arrête et rapporte selon la série atteinte. Le serveur garde la paire, l'échéance et les vues.
// ---------------------------------------------------------------------------

export const HL_TRIES_PER_DAY = 3;
/** Temps pour choisir, contrôlé par le serveur. */
export const HL_CHOICE_MS = 15_000;
/** Vues révélées à l'écran avant la paire suivante : ajouté à son échéance, le chrono ne perd rien. */
export const HL_REVEAL_MS = 1_600;
/** Marge accordée à la latence au-delà de l'échéance. */
export const HL_GRACE_MS = 1_000;
/** Écart de vues minimal entre les deux articles : jamais d'égalité. */
export const HL_MIN_RATIO = 1.05;
/** Raretés du pool (la rareté vient des vues : elle n'est jamais montrée au joueur). */
export const HL_RARITIES = ["SR", "UR", "L"] as const;

/** PW gagnés à la fin d'un essai selon la série atteinte (0 à 10) ; au-delà, +60 par réussite. */
export const HL_REWARDS = [0, 10, 25, 45, 70, 100, 135, 175, 220, 270, 325] as const;
export const HL_REWARD_PER_EXTRA = 60;
/** Gain plafonné à cette série (1 225 PW). */
export const HL_REWARD_CAP = 25;

export function hlReward(streak: number): number {
  const s = Math.max(0, Math.min(Math.floor(streak), HL_REWARD_CAP));
  if (s < HL_REWARDS.length) return HL_REWARDS[s]!;
  return HL_REWARDS[HL_REWARDS.length - 1]! + (s - (HL_REWARDS.length - 1)) * HL_REWARD_PER_EXTRA;
}

/** Fourchette du rapport de vues (plus vu / moins vu) selon la série actuelle. */
export interface HlBand {
  /** Série jusqu'à laquelle la fourchette s'applique (incluse). */
  upTo: number;
  min: number;
  max: number;
}

export const HL_BANDS: readonly HlBand[] = [
  { upTo: 2, min: 2, max: 20 },
  { upTo: 5, min: 1.4, max: 3 },
  { upTo: 9, min: 1.15, max: 1.8 },
  { upTo: Infinity, min: 1.05, max: 1.4 },
];

export function hlBand(streak: number): HlBand {
  return HL_BANDS.find((b) => streak <= b.upTo) ?? HL_BANDS[HL_BANDS.length - 1]!;
}

/**
 * Fourchettes essayées pour une série, de la voulue à la plus large : à chaque étape, le minimum se rapproche
 * de ×1,05 et le maximum s'éloigne (base trop petite pour la fourchette voulue). Jamais sous `HL_MIN_RATIO`.
 */
export function hlWidenedBands(streak: number, steps = 6): { min: number; max: number }[] {
  const b = hlBand(streak);
  const out = [{ min: b.min, max: b.max }];
  let { min, max } = b;
  for (let i = 0; i < steps; i++) {
    min = Math.max(HL_MIN_RATIO, 1 + (min - 1) / 1.6);
    max = max * 1.8;
    out.push({ min, max });
  }
  out.push({ min: HL_MIN_RATIO, max: Infinity });
  return out;
}

/** Rapport de vues d'un candidat par rapport à l'article gardé (toujours ≥ 1). */
const ratio = (a: number, b: number) => Math.max(a, b) / Math.max(1, Math.min(a, b));

/**
 * Bornes de vues à chercher pour le nouvel article face à un article gardé de `views` vues : plus vu (avec
 * la probabilité 1/2) ou moins vu, dans la fourchette donnée.
 */
export function hlViewRange(views: number, band: { min: number; max: number }, higher: boolean) {
  return higher
    ? {
        from: Math.ceil(views * band.min),
        to: band.max === Infinity ? Number.MAX_SAFE_INTEGER : Math.floor(views * band.max),
      }
    : { from: Math.ceil(views / band.max), to: Math.floor(views / band.min) };
}

/** Le nouvel article est-il plus vu que l'article gardé ? 50 % de chances. */
export const hlNewIsHigher = (random: RandomInt) => random(2) === 0;

/**
 * Choisit le nouvel article parmi des candidats (déjà filtrés : pool, pas encore vus aujourd'hui) : le premier
 * de la fourchette voulue dans le sens tiré, sinon dans les fourchettes élargies, sinon n'importe quel candidat
 * à au moins ×1,05. `null` : aucun candidat possible.
 */
export function pickChallenger<T extends { views: number }>(
  keptViews: number,
  candidates: readonly T[],
  streak: number,
  random: RandomInt,
): T | null {
  const higher = hlNewIsHigher(random);
  for (const band of hlWidenedBands(streak)) {
    for (const dir of [higher, !higher]) {
      const fits = candidates.filter((c) => {
        if (dir ? c.views <= keptViews : c.views >= keptViews) return false;
        const r = ratio(c.views, keptViews);
        return r >= band.min && r <= band.max;
      });
      if (fits.length) return fits[random(fits.length)]!;
    }
  }
  return null;
}

/** Bonne réponse : le choix a strictement plus de vues que l'autre article. */
export const hlCorrect = (pickedViews: number, otherViews: number) => pickedViews > otherViews;

/** Échéance dépassée (marge de latence comprise) : la réponse compte comme une défaite. */
export const hlExpired = (deadline: Date, now: Date) => now.getTime() > deadline.getTime() + HL_GRACE_MS;

/** Pas de liste ni de page d'homonymie dans le pool (titres sans vraie « chose » à comparer). */
export function hlEligibleTitle(title: string): boolean {
  return !/^(liste|listes|chronologie) (de|des|du|d['’])|\(homonymie\)|^homonymie\b/i.test(title.trim());
}

/** Description courte d'une page d'homonymie (Wikidata) : écartée aussi. */
export const hlEligibleDescription = (description: string | null | undefined) =>
  !description || !/page d['’]homonymie|liste (de|des|d['’])|wikimedia/i.test(description);

/** Texte à partager en fin de journée, sans spoiler (aucun titre d'article). */
export function hlShareText(day: string, streaks: readonly number[], best: number): string {
  const tries = streaks.map((s, i) => `Essai ${i + 1} : ${"🟩".repeat(Math.min(s, 10))}${s > 10 ? "+" : ""} ${s}`);
  return [
    `PalaCards · Plus ou moins vu · ${day}`,
    ...tries,
    `Meilleure série du jour : ${Math.max(0, ...streaks)} · record : ${best}`,
  ].join("\n");
}
