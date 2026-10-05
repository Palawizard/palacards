"use client";

import type { Rarity } from "@palacards/game";
import { motion, type MotionValue, useTransform } from "motion/react";

const SIZE = 300;
const C = SIZE / 2;
/** Rayon de la piste où s'inscrit l'arc de chance. */
const TRACK = 102;
const TRACK_WIDTH = 24;
const CIRC = 2 * Math.PI * TRACK;
/** Graduations : 72 traits (tous les 5°), un plus long tous les 30°, les plus longs aux quatre points cardinaux. */
const TICKS = 72;

export type DialState = "idle" | "spinning" | "win" | "lose";

/** 4 090 → « 40,90 ». */
export const chanceText = (bp: number) =>
  (bp / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Arrondi au centième : cos/sin diffèrent au dernier chiffre entre Node et le navigateur (erreur d'hydratation). */
const round = (n: number) => Math.round(n * 100) / 100;

function polar(deg: number, radius: number) {
  const a = ((deg - 90) * Math.PI) / 180;
  return [round(C + radius * Math.cos(a)), round(C + radius * Math.sin(a))] as const;
}

/**
 * Cadran de l'upgrader : la chance de réussite est un arc à la couleur de la rareté visée, qui part du
 * haut dans le sens horaire. L'aiguille tourne puis s'arrête sur le tirage du serveur : dans l'arc,
 * c'est gagné. Graduations de pendule autour, pastille pointillée au centre comme le dos des vignettes.
 */
export function UpgradeDial({
  chance,
  target,
  rotation,
  state,
}: {
  /** Chance en points de base (null : aucune carte posée). */
  chance: number | null;
  target: Rarity;
  /** Angle de l'aiguille, en degrés (0 = en haut). */
  rotation: MotionValue<number>;
  state: DialState;
}) {
  const needle = useTransform(rotation, (r) => `rotate(${r}deg)`);
  const bp = chance ?? 0;
  const arc = (bp / 10_000) * CIRC;
  const r = `var(--color-rarity-${target.toLowerCase()})`;
  const lost = state === "lose";

  return (
    <div
      className="relative aspect-square w-full select-none [container-type:inline-size]"
      role="img"
      aria-label={chance === null ? "Aucune carte posée" : `Chance de réussite : ${chanceText(bp)} %`}
      style={{ ["--r" as string]: r }}
    >
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="absolute inset-0 size-full overflow-visible" aria-hidden>
        <defs>
          <linearGradient id="upgrade-arc" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" style={{ stopColor: "color-mix(in oklab, var(--r) 55%, var(--color-accent))" }} />
            <stop offset="100%" style={{ stopColor: "var(--r)" }} />
          </linearGradient>
          <radialGradient id="upgrade-face" cx="50%" cy="38%" r="65%">
            <stop offset="0%" style={{ stopColor: "var(--color-panel-2)" }} />
            <stop offset="100%" style={{ stopColor: "var(--color-bg)" }} />
          </radialGradient>
        </defs>

        {/* Graduations. */}
        {Array.from({ length: TICKS }, (_, i) => {
          const deg = (i * 360) / TICKS;
          const cardinal = i % 18 === 0;
          const major = i % 6 === 0;
          const [x1, y1] = polar(deg, 144);
          const [x2, y2] = polar(deg, cardinal ? 126 : major ? 131 : 137);
          return (
            <line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              strokeLinecap="round"
              strokeWidth={cardinal ? 3.5 : major ? 3 : 2}
              style={{ stroke: major ? "var(--color-faint)" : "var(--color-line-strong)" }}
            />
          );
        })}

        {/* Piste et arc de chance. */}
        <circle
          cx={C}
          cy={C}
          r={TRACK}
          fill="none"
          strokeWidth={TRACK_WIDTH}
          style={{ stroke: "var(--color-panel-2)" }}
        />
        <circle
          cx={C}
          cy={C}
          r={TRACK}
          fill="none"
          stroke="url(#upgrade-arc)"
          strokeWidth={TRACK_WIDTH}
          strokeDasharray={`${arc} ${CIRC}`}
          transform={`rotate(-90 ${C} ${C})`}
          className="transition-[stroke-dasharray,opacity,filter] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]"
          style={{
            opacity: lost ? 0.35 : 1,
            filter:
              state === "win" ? "drop-shadow(0 0 10px var(--r)) saturate(1.2)" : lost ? "saturate(0.2)" : undefined,
          }}
        />

        {/* Cadran intérieur et perforation. */}
        <circle cx={C} cy={C} r={TRACK - TRACK_WIDTH / 2 - 3} fill="url(#upgrade-face)" />
        <circle
          cx={C}
          cy={C}
          r={TRACK - TRACK_WIDTH / 2 - 11}
          fill="none"
          strokeWidth="1.5"
          strokeDasharray="4 5"
          style={{ stroke: "var(--color-line-strong)" }}
        />
      </svg>

      {/* Aiguille : trait blanc sur la piste et flèche jaune au bord, tournent ensemble autour du centre. */}
      <motion.div className="absolute inset-0 will-change-transform" style={{ transform: needle }} aria-hidden>
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="size-full overflow-visible">
          <line
            x1={C}
            y1={C - TRACK - TRACK_WIDTH / 2 - 2}
            x2={C}
            y2={C - TRACK + TRACK_WIDTH / 2 + 12}
            stroke="#fff"
            strokeWidth="3.5"
            strokeLinecap="round"
            style={{ filter: "drop-shadow(0 0 3px rgb(0 0 0 / 0.6))" }}
          />
          <path
            d={`M ${C - 11} ${C - 150} L ${C + 11} ${C - 150} L ${C} ${C - 132} Z`}
            strokeLinejoin="round"
            strokeWidth="2"
            style={{ fill: "var(--color-accent)", stroke: "color-mix(in oklab, var(--color-accent) 60%, #000)" }}
          />
        </svg>
      </motion.div>

      {/* Chance au centre. */}
      <div className="absolute inset-0 grid place-items-center">
        <div className="flex flex-col items-center leading-none">
          <p
            className={`font-display tnum text-[clamp(1.9rem,11cqi,3.1rem)] leading-none transition-colors duration-300 ${
              chance === null ? "text-faint" : ""
            }`}
            style={
              chance === null
                ? undefined
                : { color: lost ? "var(--color-faint)" : "color-mix(in oklab, var(--r) 64%, var(--color-text))" }
            }
          >
            {chance === null ? (
              "—"
            ) : (
              <>
                {chanceText(bp)}
                <span className="ml-0.5 text-[0.6em]">%</span>
              </>
            )}
          </p>
          <p
            className={`mt-1.5 font-display text-lg uppercase tracking-[0.06em] ${
              state === "win" ? "text-good" : lost ? "text-danger" : "text-muted"
            }`}
          >
            {state === "win" ? "Réussi !" : lost ? "Raté" : state === "spinning" ? "…" : "chance"}
          </p>
        </div>
      </div>
    </div>
  );
}
