"use client";

import { RARITY_LABELS, type Rarity } from "@palacards/game";
import { useMemo, type CSSProperties } from "react";
import { SparkStar } from "./Card";
import "./reveal-fx.css";

export type FxTier = "SR" | "UR" | "L";

export const FX_TIERS: readonly Rarity[] = ["SR", "UR", "L"];
export const isFxTier = (r: Rarity): r is FxTier => FX_TIERS.includes(r);

/** Durée totale de l'effet (ms), pour le démonter une fois fini. */
export const FX_DURATION: Record<FxTier, number> = { SR: 1300, UR: 2500, L: 3000 };

const STAMP: Partial<Record<FxTier, string>> = { UR: "Ultra rare", L: "Légendaire" };

/** Réglages par palier : plus la carte est rare, plus il y a de lumière et de matière. */
const TIER = {
  SR: { sparks: 10, dist: [34, 58], confetti: 0, halo: "1s", rays: null, rings: 0 },
  UR: { sparks: 18, dist: [45, 78], confetti: 0, halo: "1.3s", rays: "1.7s", rings: 1 },
  L: { sparks: 26, dist: [55, 95], confetti: 18, halo: "1.7s", rays: "2.3s", rings: 2 },
} as const;

type Var = CSSProperties & Record<`--${string}`, string>;

const rand = (min: number, max: number) => min + Math.random() * (max - min);

/**
 * Couche d'effets posée derrière (`layer="back"`) et devant (`layer="front"`) une carte qui se
 * retourne. `delay` cale le pic de lumière sur l'instant où la face apparaît (mi-retournement).
 */
export function RevealFx({ tier, delay, layer }: { tier: FxTier; delay: number; layer: "back" | "front" }) {
  const t = TIER[tier];
  // Tirées une fois par révélation : chaque carte a sa propre gerbe.
  const sparks = useMemo(
    () =>
      Array.from({ length: t.sparks }, (_, i) => {
        const hue = i % 3 === 0 ? "#fff" : i % 3 === 1 ? "var(--r)" : "color-mix(in oklab, var(--r) 45%, #fff)";
        return {
          "--a": `${(360 / t.sparks) * i + rand(-10, 10)}deg`,
          "--dist": `${rand(t.dist[0], t.dist[1])}cqi`,
          "--spin": `${rand(90, 400)}deg`,
          "--sz": `${rand(4, tier === "L" ? 9 : 7)}px`,
          "--dur": `${Math.round(rand(650, tier === "L" ? 1300 : 1000))}ms`,
          "--c": hue,
        } as Var;
      }),
    [t, tier],
  );
  const confetti = useMemo(
    () =>
      Array.from({ length: t.confetti }, (_, i) => {
        const side = i % 2 === 0 ? -1 : 1;
        const palette = ["var(--r)", "#fff", "var(--color-accent)", "var(--color-cover)", "var(--color-rarity-ur)"];
        return {
          "--x": `${side * rand(25, 85)}cqi`,
          "--y": `${-rand(45, 95)}cqi`,
          "--fall": `${rand(110, 170)}cqi`,
          "--spin": `${side * rand(360, 900)}deg`,
          "--sz": `${rand(7, 11)}px`,
          "--dur": `${Math.round(rand(1600, 2300))}ms`,
          "--c": palette[i % palette.length]!,
          animationDelay: `${delay + rand(0, 160)}ms`,
        } as Var;
      }),
    [t, delay],
  );

  const root = {
    "--fx-delay": `${delay}ms`,
    "--fx-halo": t.halo,
    ...(t.rays ? { "--fx-rays": t.rays } : {}),
    "--fx-stamp": tier === "L" ? "2.7s" : "2.2s",
  } as Var;

  if (layer === "back")
    return (
      <div aria-hidden className="pc-fx" data-rarity={tier} style={root}>
        {tier === "L" && <span className="pc-fx-dim" style={{ animationDelay: `${Math.max(0, delay - 200)}ms` }} />}
        {t.rays && <span className="pc-fx-rays" />}
        <span className="pc-fx-halo" />
      </div>
    );

  return (
    <div aria-hidden className="pc-fx" data-rarity={tier} style={root}>
      <span className="pc-fx-sweep" />
      {Array.from({ length: t.rings }, (_, i) => (
        <span key={`r${i}`} className="pc-fx-ring" style={{ animationDelay: `${delay + i * 180}ms` }} />
      ))}
      {sparks.map((s, i) => (
        <span key={`s${i}`} className="pc-fx-spark" style={s} />
      ))}
      {confetti.map((s, i) => (
        <span key={`c${i}`} className="pc-fx-confetti" style={s} />
      ))}
      {STAMP[tier] && <span className="pc-fx-stamp">{STAMP[tier]}</span>}
    </div>
  );
}

/** Durée de la révélation d'une brillante (ms). */
export const SHINY_FX_DURATION = 3400;

/**
 * Révélation d'une brillante, quelle que soit sa rareté : la page s'assombrit, un éventail de rayons
 * prismatiques tourne derrière la carte, une bande arc-en-ciel la balaie, des éclats à quatre branches
 * jaillissent et un tampon holographique « Brillante » se pose. Même calage que `RevealFx`.
 */
export function ShinyFx({ rarity, delay, layer }: { rarity: Rarity; delay: number; layer: "back" | "front" }) {
  const stars = useMemo(
    () =>
      Array.from({ length: 14 }, (_, i) => {
        const hue = (i * 360) / 14;
        return {
          "--a": `${(360 / 14) * i + rand(-8, 8)}deg`,
          "--dist": `${rand(48, 92)}cqi`,
          "--sz": `${rand(9, i % 3 === 0 ? 20 : 14)}px`,
          "--dur": `${Math.round(rand(900, 1500))}ms`,
          "--c": `hsl(${hue} 95% 78%)`,
          animationDelay: `${delay + 60 + rand(0, 220)}ms`,
        } as Var;
      }),
    [delay],
  );
  const root = { "--fx-delay": `${delay}ms` } as Var;
  if (layer === "back")
    return (
      <div aria-hidden className="pc-fx pc-shiny-fx" style={root}>
        <span className="pc-fx-dim pc-shiny-dim" style={{ animationDelay: `${Math.max(0, delay - 200)}ms` }} />
        <span className="pc-shiny-rays" />
        <span className="pc-shiny-halo" />
      </div>
    );
  return (
    <div aria-hidden className="pc-fx pc-shiny-fx" style={root}>
      <span className="pc-shiny-sweep" />
      {stars.map((s, i) => (
        <span key={i} className="pc-shiny-star" style={s}>
          <SparkStar />
        </span>
      ))}
      <span className="pc-shiny-stamp">
        Brillante
        {(rarity === "UR" || rarity === "L") && <small>{RARITY_LABELS[rarity]}</small>}
      </span>
    </div>
  );
}
