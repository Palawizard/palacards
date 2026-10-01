"use client";

// Pièces du duel « Attaque / Bouclier » : jauges de PV, dos de cartes adverses, cartes de la main, journal.
import { QUESTION_LABELS, RARITY_LABELS, type QuestionType } from "@palacards/game";
import type { BattleCardView, BattlePlayerView, BattleTurnView } from "@palacards/shared";
import { Shield, Swords, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Card } from "./Card";

/** Pourcentage avec l'espace insécable français (« 30 % » ne se coupe jamais). */
export const pct = (n: number) => `${n}\u00a0%`;

const rarityVar = (rarity: string) => ({ ["--r" as string]: `var(--color-rarity-${rarity.toLowerCase()})` });

/**
 * Jauge de PV : la barre pleine descend aussitôt, une traînée claire la suit avec un temps de retard
 * (on voit ce qui vient d'être perdu), et les dégâts s'affichent au-dessus le temps d'une lecture.
 */
export function HpBar({
  player,
  max,
  side,
  label,
}: {
  player: BattlePlayerView;
  max: number;
  side: "you" | "them";
  label: string;
}) {
  const hp = Math.max(0, player.hp ?? max);
  const ratio = hp / max;
  const prev = useRef(hp);
  const [hit, setHit] = useState<{ amount: number; key: number } | null>(null);
  useEffect(() => {
    if (hp < prev.current) setHit({ amount: prev.current - hp, key: Date.now() });
    prev.current = hp;
  }, [hp]);
  useEffect(() => {
    if (!hit) return;
    const t = setTimeout(() => setHit(null), 1400);
    return () => clearTimeout(t);
  }, [hit]);
  const tone = ratio > 0.5 ? "var(--color-good)" : ratio > 0.25 ? "var(--color-warn)" : "var(--color-danger)";
  const them = side === "them";
  return (
    <div className={`relative flex min-w-0 flex-1 flex-col gap-1.5 ${them ? "items-end text-right" : ""}`}>
      <div
        className={`flex w-full flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-2 ${them ? "items-end sm:flex-row-reverse" : ""}`}
      >
        <span className={`flex min-w-0 max-w-full items-center gap-1.5 ${them ? "flex-row-reverse" : ""}`}>
          <span className="truncate font-display text-lg uppercase leading-none sm:text-2xl">{label}</span>
          {them && (
            <span
              className={`size-2 shrink-0 rounded-full ${player.online ? "bg-good" : "bg-faint"}`}
              title={player.online ? "En ligne" : "Hors ligne"}
            >
              <span className="sr-only">{player.online ? "En ligne" : "Hors ligne"}</span>
            </span>
          )}
        </span>
        <span
          className={`tnum whitespace-nowrap font-display text-2xl leading-none sm:text-3xl ${them ? "sm:mr-auto" : "sm:ml-auto"}`}
        >
          {hp}
          <span className="text-base text-faint">{"\u00a0"}PV</span>
        </span>
      </div>
      <div
        className="duel-hp"
        role="meter"
        aria-label={`Points de vie de ${label}`}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={hp}
        data-side={side}
        style={{ ["--hp" as string]: ratio, ["--tone" as string]: tone }}
      >
        <span className="duel-hp-trail" />
        <span className="duel-hp-fill" />
      </div>
      {hit && (
        <span
          key={hit.key}
          className={`duel-hit tnum pointer-events-none absolute top-[-0.9rem] font-display text-3xl text-danger ${them ? "left-1" : "right-1"}`}
          aria-hidden
        >
          −{hit.amount}
        </span>
      )}
    </div>
  );
}

/** Dos de carte adverse : rareté, dégâts et bouclier visibles, titre caché tant qu'elle n'a pas attaqué. */
export function CardBackMini({ card, className = "" }: { card: BattleCardView; className?: string }) {
  return (
    <div
      className={`relative aspect-[5/7] w-full [container-type:inline-size] ${className}`}
      style={rarityVar(card.rarity)}
      title={`${RARITY_LABELS[card.rarity]} · ${card.damage} dégâts · bouclier ${pct(card.shieldPct)}`}
    >
      <span className="pc-back !shadow-[inset_0_0_0_3px_rgb(255_255_255/0.9),var(--shadow-lift)]">
        <span className="grid aspect-square w-[46%] rotate-[-12deg] place-items-center rounded-full bg-accent font-display text-[26cqi] uppercase leading-none text-cover shadow-[0_4px_10px_-4px_rgb(0_0_0/0.5)]">
          P
        </span>
      </span>
      <span className="absolute inset-0 rounded-[12px] shadow-[inset_0_0_0_3px_var(--r)]" aria-hidden />
      <span className="pc-sigil absolute left-1/2 top-[7%] -translate-x-1/2 text-[max(10px,13cqi)]">{card.rarity}</span>
    </div>
  );
}

/** Ce que la carte apporte au duel : dégâts en attaque, réduction en bouclier, et ce qui a déjà servi. */
export function CardStats({ card, compact = false }: { card: BattleCardView; compact?: boolean }) {
  return (
    <div
      className={`tnum flex justify-center ${compact ? "flex-col items-center gap-0 text-xs sm:flex-row sm:gap-2" : "items-center gap-2.5 text-sm"}`}
    >
      <span
        className={`inline-flex items-center gap-1 font-semibold ${card.attacked ? "text-faint line-through decoration-2" : ""}`}
        title={card.attacked ? "A déjà attaqué" : `${card.damage} dégâts si elle touche`}
      >
        <Swords aria-hidden className="size-3.5" />
        {card.damage}
      </span>
      <span
        className={`inline-flex items-center gap-1 font-semibold ${card.shielded ? "text-faint line-through decoration-2" : ""}`}
        title={card.shielded ? "A déjà servi de bouclier" : `Bouclier : −${pct(card.shieldPct)} de dégâts`}
      >
        <Shield aria-hidden className="size-3.5" />
        {pct(card.shieldPct)}
      </span>
    </div>
  );
}

/**
 * Carte de la main : vignette complète, relevée quand elle est choisie, grisée quand elle a déjà servi
 * pour l'action demandée.
 */
export function HandCard({
  card,
  mode,
  selected,
  onSelect,
}: {
  card: BattleCardView;
  /** Action demandée en ce moment (sinon simple affichage). */
  mode: "attack" | "shield" | null;
  selected: boolean;
  onSelect?: () => void;
}) {
  const spent = mode === "attack" ? card.attacked : mode === "shield" ? card.shielded : false;
  const selectable = !!mode && !spent && !!onSelect;
  const inner = (
    <>
      {card.card ? <Card card={card.card} href={null} /> : <CardBackMini card={card} />}
      <CardStats card={card} />
    </>
  );
  if (!selectable) {
    return (
      <div className={`duel-hand-card flex flex-col gap-1.5 ${mode && spent ? "opacity-40 grayscale-[0.6]" : ""}`}>
        {inner}
      </div>
    );
  }
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className="duel-hand-card duel-pick flex w-full flex-col gap-1.5 rounded-[14px] text-left"
      aria-label={`${card.card?.title ?? RARITY_LABELS[card.rarity]} : ${
        mode === "attack" ? `${card.damage} dégâts` : `bouclier ${pct(card.shieldPct)}`
      }`}
    >
      {inner}
    </button>
  );
}

export const questionLabel = (type: string) => QUESTION_LABELS[type as QuestionType] ?? "Question";

/** Une ligne du journal : qui attaque avec quoi, bouclier, réponse et dégâts. */
export function TurnLine({ t, youId, theirName }: { t: BattleTurnView; youId: string; theirName: string }) {
  const youAttack = t.attackerId === youId;
  const o = t.outcome;
  const title = t.attack.card?.title ?? RARITY_LABELS[t.attack.rarity];
  return (
    <li className="flex gap-3 py-2.5">
      <span className="tnum w-6 shrink-0 pt-0.5 text-center font-display text-lg leading-none text-faint">
        {t.turn}
      </span>
      <div className="min-w-0 flex-1 text-sm">
        <p className="leading-snug">
          <span className="font-semibold">{youAttack ? "Tu attaques" : `${theirName} attaque`}</span> avec{" "}
          <span className="font-semibold" style={rarityVar(t.attack.rarity)}>
            {title}
          </span>
          {t.shield && (
            <span className="text-muted">
              {" "}
              · bouclier {t.shield.card?.title ?? RARITY_LABELS[t.shield.rarity]} (−{pct(t.shield.shieldPct)})
            </span>
          )}
        </p>
        {o && (
          <p className="tnum mt-0.5 flex flex-wrap items-center gap-x-2 text-muted">
            {o.parry === "perfect" ? (
              <span className="inline-flex items-center gap-1 font-semibold text-good">
                <Zap aria-hidden className="size-3.5" /> Parade parfaite, {o.reflected} renvoyés
              </span>
            ) : o.parry === "parry" ? (
              <span className="font-semibold text-good">Paré</span>
            ) : (
              <span className="font-semibold text-danger">
                {o.choice === null ? "Pas de réponse" : "Raté"} : −{o.damage} PV
              </span>
            )}
            {t.question && t.question.type !== "image" && <span>Réponse : {t.question.choices[o.correctIndex]}</span>}
          </p>
        )}
      </div>
    </li>
  );
}
