"use client";

import { ECONOMY, RARITY_LABELS, rarityRank } from "@palacards/game";
import type { CardDTO, PackState } from "@palacards/shared";
import { ChevronRight, Recycle, Scissors } from "lucide-react";
import {
  animate,
  AnimatePresence,
  motion,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from "motion/react";
import Link from "next/link";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { fmt } from "@/lib/format";
import { useMe } from "@/lib/game";
import { useCardMedia } from "@/lib/media";
import { PHONE_QUERY, useMediaQuery } from "@/lib/use-media-query";
import { Card } from "./Card";

type Speed = "normal" | "fast" | "instant";
type Phase = "sealed" | "tearing" | "dealt";

interface OpenResponse {
  cards: CardDTO[];
  packs: PackState;
  usedBonus: boolean;
  pityTriggered: boolean;
}

const EASE_OUT = [0.23, 1, 0.32, 1] as const;
/** Pauses entre deux retournements : plus longues avant une carte rare, pour laisser monter la tension. */
const flipDelay = (card: CardDTO, speed: Speed) => {
  const base = speed === "fast" ? 170 : 380;
  return rarityRank(card.rarity) >= rarityRank("SR") ? base * 2.2 : base;
};

const SIGILS = ["C", "PC", "R", "SR", "UR", "L"] as const;

/**
 * Pochette alu d'album de vignettes : soudures dentelées, languette à déchirer en haut.
 * Elle s'incline vers la souris (ressort) et son reflet suit ; un clic l'ouvre.
 */
function Sleeve({
  tearing,
  season,
  stock,
  onOpen,
  disabled,
}: {
  tearing: boolean;
  season: number;
  stock: number;
  onOpen: () => void;
  disabled: boolean;
}) {
  const reduce = useReducedMotion();
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const spring = { stiffness: 170, damping: 18, mass: 0.6 };
  const sx = useSpring(px, spring);
  const sy = useSpring(py, spring);
  const tilt = useMotionTemplate`perspective(900px) rotateX(${useTransform(sy, (v) => v * -16)}deg) rotateY(${useTransform(sx, (v) => v * 16)}deg)`;
  const sheen = useMotionTemplate`translate(${useTransform(sx, (v) => v * 55)}%, ${useTransform(sy, (v) => v * 40)}%)`;

  function track(e: React.PointerEvent<HTMLButtonElement>) {
    if (reduce || disabled || e.pointerType !== "mouse") return;
    const r = e.currentTarget.getBoundingClientRect();
    px.set((e.clientX - r.left) / r.width - 0.5);
    py.set((e.clientY - r.top) / r.height - 0.5);
  }
  function reset() {
    px.set(0);
    py.set(0);
  }

  return (
    <div className="relative mx-auto w-[min(16rem,64vw)] select-none">
      {/* Paquets suivants du stock, empilés derrière. */}
      {Array.from({ length: Math.min(stock - 1, 2) }, (_, i) => (
        <div
          key={i}
          aria-hidden
          className="pc-pack pc-pack-foil absolute inset-0 opacity-70"
          style={{ transform: `translate(${(i + 1) * 7}px, ${(i + 1) * 4}px) rotate(${(i + 1) * 3}deg)` }}
        />
      ))}
      <button
        type="button"
        onClick={onOpen}
        disabled={disabled}
        onPointerMove={track}
        onPointerLeave={reset}
        // Raccourci souris : le bouton « Ouvrir un paquet » sous la pochette reste l'action accessible.
        aria-hidden
        tabIndex={-1}
        className="group relative block aspect-[5/7.3] w-full [filter:drop-shadow(0_22px_24px_rgb(4_8_30/0.45))] disabled:cursor-default"
      >
        <motion.span className="absolute inset-0 block" style={{ transform: tilt }}>
          {/* Corps de la pochette. */}
          <motion.span
            className="pc-pack pc-pack-foil absolute inset-0 block overflow-hidden"
            style={{ clipPath: "inset(9% 0 0 0)" }}
            animate={
              tearing
                ? { transform: reduce ? "none" : "translateY(14%) scale(0.96)", opacity: 0 }
                : { transform: "translateY(0%) scale(1)", opacity: 1 }
            }
            transition={{ duration: 0.42, ease: EASE_OUT, delay: tearing ? 0.18 : 0 }}
          >
            {/* Reflet qui suit la souris. */}
            <motion.span
              aria-hidden
              className="pointer-events-none absolute -inset-1/2 block bg-[radial-gradient(closest-side,rgb(255_255_255/0.4),transparent)] mix-blend-soft-light"
              style={{ transform: sheen }}
            />
            {/* Pastille de saison, comme une étiquette de prix. */}
            <span className="absolute right-[7%] top-[14%] grid size-[4.4rem] rotate-[-12deg] place-items-center rounded-full bg-accent text-accent-ink shadow-[0_4px_10px_-4px_rgb(0_0_0/0.5)]">
              <span className="absolute inset-[5px] rounded-full border-2 border-dashed border-accent-ink/25" />
              <span className="font-display text-center text-[0.72rem] uppercase leading-none">
                Saison
                <span className="tnum block text-[1.9rem] leading-[0.9]">{season}</span>
              </span>
            </span>
            <span className="absolute inset-x-[8%] top-[36%] block text-left font-display uppercase leading-[0.82] text-cover-ink [text-shadow:0_2px_0_var(--color-cover-2),0_4px_14px_rgb(0_0_0/0.35)]">
              <span className="block text-[3.7rem]">Pala</span>
              <span className="block text-[3.7rem] text-accent">Cards</span>
            </span>
            {/* Les six raretés à tirer. */}
            <span className="absolute inset-x-[8%] bottom-[12%] flex justify-between gap-1 text-[0.72rem]">
              {SIGILS.map((r) => (
                <span key={r} data-rarity={r} className="pc-sigil shadow-[0_2px_4px_-1px_rgb(0_0_0/0.4)]">
                  {r}
                </span>
              ))}
            </span>
          </motion.span>

          {/* Languette dentelée à déchirer. */}
          <motion.span
            aria-hidden
            className="pc-pack pc-pack-foil pc-pack-strip absolute inset-0 block"
            style={{ clipPath: "inset(0 0 91% 0)", transformOrigin: "88% 9%" }}
            animate={
              tearing
                ? { transform: reduce ? "none" : "translate(16%, -40%) rotate(12deg)", opacity: 0 }
                : { transform: "translate(0%, 0%) rotate(0deg)", opacity: 1 }
            }
            transition={{ duration: 0.38, ease: EASE_OUT }}
          />
          <motion.span
            aria-hidden
            className="absolute inset-x-[5%] top-[9%] flex items-center gap-1.5 text-cover-ink/70"
            animate={{ opacity: tearing ? 0 : 1 }}
            transition={{ duration: 0.12 }}
          >
            <Scissors className="size-3.5 shrink-0 -scale-x-100" strokeWidth={2} />
            <span className="flex-1 border-t-2 border-dashed border-current" />
          </motion.span>
        </motion.span>
      </button>
    </div>
  );
}

/** Dos de vignette (couverture de l'album et monogramme). */
function CardBack() {
  return (
    <span className="pc-back">
      <span className="relative grid aspect-square w-[44%] rotate-[-12deg] place-items-center rounded-full bg-accent font-display text-[2.4rem] uppercase leading-none text-cover shadow-[0_4px_10px_-4px_rgb(0_0_0/0.5)]">
        <span className="absolute inset-[5px] rounded-full border-2 border-dashed border-accent-ink/25" />P
      </span>
    </span>
  );
}

/** Une carte du paquet : face cachée, puis retournée en 3D. */
function FlipCard({
  card,
  revealed,
  onReveal,
  index,
  speed,
  stagger = true,
}: {
  card: CardDTO;
  revealed: boolean;
  onReveal: () => void;
  index: number;
  speed: Speed;
  /** Distribution en cascade (grille). La pile du téléphone gère elle-même l'arrivée des cartes. */
  stagger?: boolean;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className="relative [perspective:1100px]"
      initial={speed === "instant" || !stagger ? false : { opacity: 0, transform: "translateY(24px) scale(0.96)" }}
      animate={{ opacity: 1, transform: "translateY(0px) scale(1)" }}
      transition={{ duration: 0.4, ease: EASE_OUT, delay: speed === "instant" ? 0 : index * 0.06 }}
    >
      <motion.div
        className="relative [transform-style:preserve-3d]"
        initial={false}
        animate={{ transform: revealed ? "rotateY(0deg)" : "rotateY(180deg)" }}
        transition={
          reduce || speed === "instant"
            ? { duration: 0 }
            : { duration: speed === "fast" ? 0.32 : 0.55, ease: [0.77, 0, 0.175, 1] }
        }
      >
        <div className="[backface-visibility:hidden]">
          <Card card={card} priority prefetch={false} />
        </div>
        <button
          type="button"
          onClick={onReveal}
          disabled={revealed}
          className="absolute inset-0 aspect-[5/7] [backface-visibility:hidden] [transform:rotateY(180deg)]"
          aria-label={`Retourner la carte ${index + 1}`}
        >
          <CardBack />
        </button>
      </motion.div>
    </motion.div>
  );
}

/** Recycler une carte du paquet, ou le rappel de ce qu'elle a rapporté. */
function RecycleAction({
  card,
  recycled,
  onRecycle,
  className = "",
}: {
  card: CardDTO;
  recycled: boolean;
  onRecycle: (card: CardDTO) => void;
  className?: string;
}) {
  const gain = ECONOMY.recycleValue[card.rarity];
  if (recycled)
    return <span className={`tnum text-center text-xs text-muted ${className}`}>Recyclée · +{gain} PW</span>;
  return (
    <button
      type="button"
      className={`btn btn-sm gap-1 px-2 text-xs ${className}`}
      onClick={() => onRecycle(card)}
      aria-label={`Recycler ${card.title} pour ${gain} PW`}
    >
      <Recycle aria-hidden className="size-3.5 shrink-0" />
      <span className="tnum">+{gain}</span>
    </button>
  );
}

interface DealtProps {
  cards: CardDTO[];
  revealed: boolean[];
  onReveal: (i: number) => void;
  recycled: Record<number, true>;
  onRecycle: (card: CardDTO) => void;
  speed: Speed;
}

const isRecycled = (card: CardDTO, recycled: Record<number, true>) => !!card.instanceId && !!recycled[card.instanceId];

/** Tablette et ordinateur : deux rangées de cinq vignettes, comme une page d'album. */
function PackGrid({ cards, revealed, onReveal, recycled, onRecycle, speed }: DealtProps) {
  return (
    <ol className="grid grid-cols-5 gap-2.5 md:gap-3 lg:gap-4">
      {cards.map((card, i) => {
        const gone = isRecycled(card, recycled);
        return (
          <li key={card.instanceId ?? i} className="flex min-w-0 flex-col gap-2">
            <div className={`transition-[opacity,filter] duration-300 ${gone ? "opacity-35 grayscale" : ""}`}>
              <FlipCard
                card={card}
                index={i}
                speed={speed}
                revealed={revealed[i] ?? false}
                onReveal={() => onReveal(i)}
              />
            </div>
            <div
              inert={!revealed[i]}
              className={`flex justify-center transition-opacity duration-200 ${revealed[i] ? "opacity-100" : "pointer-events-none opacity-0"}`}
            >
              <RecycleAction card={card} recycled={gone} onRecycle={onRecycle} className="w-full" />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Largeur de la carte sur téléphone : elle doit tenir en entier avec la barre du haut, la frise de
 * progression et les boutons (~16 rem au total), sans défilement, du petit iPhone au grand Android.
 */
const DECK_CARD_WIDTH = "min(17rem, 76vw, calc((100svh - 16rem) * 5 / 7))";

/**
 * Entrée et sortie des cartes de la pile : translation, rotation et opacité seulement (composées par le
 * GPU). Pas d'échelle : sur téléphone, elle fait re-rastériser le texte de la vignette à chaque image.
 */
const deckMotion = {
  enter: (dir: number) =>
    dir > 0 ? { opacity: 0, x: 0, y: 12, rotate: 0 } : { opacity: 0, x: -140, y: 0, rotate: -6 },
  center: { opacity: 1, x: 0, y: 0, rotate: 0 },
  exit: (dir: number) => (dir > 0 ? { opacity: 0, x: -360, y: 0, rotate: -9 } : { opacity: 0, x: 0, y: 12, rotate: 0 }),
};

/** Seuils du glissement : distance (px) ou vitesse (px/ms) pour passer à la carte voisine. */
const SWIPE_DISTANCE = 64;
const SWIPE_SPEED = 0.45;

/**
 * La carte au sommet de la pile. Le glissement est géré à la main (événements pointeur + une valeur
 * `x`) plutôt qu'avec `drag` de motion : `drag` active la projection de mise en page, qui mesure la
 * page (layout forcé) à chaque rendu React, d'où la saccade à chaque carte sur téléphone.
 */
function DeckCard({
  card,
  dir,
  index,
  speed,
  shown,
  gone,
  onReveal,
  onSwipe,
}: {
  card: CardDTO;
  /** Sens de navigation : 1 vers la suivante, -1 vers la précédente (variantes d'entrée). */
  dir: number;
  index: number;
  speed: Speed;
  shown: boolean;
  gone: boolean;
  onReveal: () => void;
  onSwipe: (direction: "next" | "prev") => void;
}) {
  const x = useMotionValue(0);
  const start = useRef<{ x: number; y: number; t: number } | null>(null);
  const dragging = useRef(false);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    start.current = { x: e.clientX, y: e.clientY, t: e.timeStamp };
    dragging.current = false;
  }
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const s = start.current;
    if (!s) return;
    const dx = e.clientX - s.x;
    if (!dragging.current) {
      // Geste horizontal franc seulement : le défilement vertical reste au navigateur.
      if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(e.clientY - s.y)) return;
      dragging.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    x.set(dx);
  }
  function onPointerEnd(e: React.PointerEvent<HTMLDivElement>) {
    const s = start.current;
    start.current = null;
    if (!s || !dragging.current) return;
    const dx = e.clientX - s.x;
    const speedX = dx / Math.max(1, e.timeStamp - s.t);
    if (e.type === "pointerup" && (dx < -SWIPE_DISTANCE || speedX < -SWIPE_SPEED)) onSwipe("next");
    else if (e.type === "pointerup" && (dx > SWIPE_DISTANCE || speedX > SWIPE_SPEED)) onSwipe("prev");
    // Pas de changement de carte (ou retour impossible) : la carte revient se poser.
    void animate(x, 0, { type: "spring", stiffness: 520, damping: 38 });
  }

  return (
    <motion.div
      custom={dir}
      variants={deckMotion}
      initial="enter"
      animate="center"
      exit="exit"
      transition={{ duration: 0.3, ease: EASE_OUT }}
      style={{ x }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      // Un glissement ne doit pas ouvrir la fiche de la carte (lien sur toute la vignette).
      onClickCapture={(e) => {
        if (!dragging.current) return;
        dragging.current = false;
        e.preventDefault();
        e.stopPropagation();
      }}
      className="absolute inset-0 z-10 touch-pan-y will-change-transform"
    >
      <div className={`transition-[opacity,filter] duration-300 ${gone ? "opacity-40 grayscale" : ""}`}>
        <FlipCard card={card} index={index} speed={speed} stagger={false} revealed={shown} onReveal={onReveal} />
      </div>
    </motion.div>
  );
}

/** Précharge l'image d'une carte à venir : elle est déjà décodée quand la carte arrive au sommet. */
function PreloadThumb({ card }: { card: CardDTO }) {
  const live = useCardMedia(card.cardId);
  const src = live?.thumbUrl ?? card.thumbUrl;
  useEffect(() => {
    if (!src) return;
    const img = new Image();
    img.decoding = "async";
    img.src = src;
    void img.decode?.().catch(() => {});
  }, [src]);
  return null;
}

/**
 * Téléphone : les cartes sortent de la pile une par une. Chaque carte posée se retourne seule (pause
 * plus longue avant une rare) ; « Suivante » ou un glissement vers la gauche passe à la suivante.
 */
function PackDeck({
  cards,
  revealed,
  onReveal,
  onRevealAll,
  recycled,
  onRecycle,
  speed,
  cursor,
  onCursor,
}: DealtProps & { onRevealAll: () => void; cursor: number; onCursor: (i: number) => void }) {
  const [dir, setDir] = useState(1);
  const n = cards.length;
  const card = cards[cursor]!;
  const shown = revealed[cursor] ?? false;
  const last = cursor === n - 1;

  // Retournement automatique de la carte qui vient d'être posée.
  useEffect(() => {
    if (shown || speed === "instant") return;
    const t = setTimeout(() => onReveal(cursor), 160 + flipDelay(card, speed));
    return () => clearTimeout(t);
  }, [card, cursor, shown, speed, onReveal]);

  function go(to: number) {
    setDir(to > cursor ? 1 : -1);
    onCursor(to);
  }
  /** Action principale : retourner la carte, puis passer à la suivante (ou au récapitulatif). */
  function advance() {
    if (!shown) onReveal(cursor);
    else go(cursor + 1);
  }

  const gone = isRecycled(card, recycled);
  const pile = Math.min(n - cursor - 1, 3);

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex items-center gap-3" style={{ width: DECK_CARD_WIDTH }}>
        {/* Frise du paquet : une case par carte, à la couleur de sa rareté une fois vue. */}
        <ol className="flex flex-1 gap-1" aria-hidden>
          {cards.map((c, i) => (
            <li
              key={c.instanceId ?? i}
              data-rarity={revealed[i] ? c.rarity : undefined}
              // Sans transition : un fondu de couleur repeindrait toute la page à chaque image, en pleine animation.
              className={`h-2 flex-1 rounded-full border ${
                revealed[i] ? "border-transparent bg-[var(--r)]" : "border-line-strong"
              } ${i === cursor ? "outline outline-2 outline-offset-2 outline-accent" : ""}`}
            />
          ))}
        </ol>
        <span className="tnum shrink-0 text-sm font-semibold text-muted">
          <span className="text-text">{cursor + 1}</span>/{n}
        </span>
      </div>

      {/*
       * Scène de taille fixe (format vignette) : les cartes y sont posées en absolu, l'entrante et la
       * sortante se croisent sans rien mesurer. Marge basse : la pile déborde sous la carte en cours.
       */}
      <div className={`relative isolate aspect-[5/7] ${pile ? "mb-3" : ""}`} style={{ width: DECK_CARD_WIDTH }}>
        {/* Le reste du paquet, face cachée, sous la carte en cours. */}
        {Array.from({ length: pile }, (_, i) => pile - i).map((depth) => (
          <div
            key={depth}
            aria-hidden
            className="absolute inset-0"
            style={{ transform: `translate(${depth * 5}px, ${depth * 5}px) rotate(${depth * 2.2}deg)` }}
          >
            <CardBack />
          </div>
        ))}
        <AnimatePresence initial={false} custom={dir}>
          <DeckCard
            key={cursor}
            card={card}
            dir={dir}
            index={cursor}
            speed={speed}
            shown={shown}
            gone={gone}
            onReveal={() => onReveal(cursor)}
            onSwipe={(d) => (d === "next" ? advance() : cursor > 0 && go(cursor - 1))}
          />
        </AnimatePresence>
        {cards.slice(cursor + 1, cursor + 3).map((c) => (
          <PreloadThumb key={c.instanceId ?? c.cardId} card={c} />
        ))}
      </div>

      <div
        inert={!shown}
        className={`flex min-h-11 items-center justify-center transition-opacity duration-200 will-change-[opacity] ${shown ? "opacity-100" : "opacity-0"}`}
      >
        <RecycleAction card={card} recycled={gone} onRecycle={onRecycle} className="min-w-28" />
      </div>

      <div className="flex w-full max-w-sm items-center gap-2">
        <button
          type="button"
          className="btn btn-ghost min-h-12 shrink-0"
          onClick={() => {
            onRevealAll();
            go(n);
          }}
        >
          Tout voir
        </button>
        <button type="button" className="btn btn-primary min-h-12 flex-1 text-base" onClick={advance}>
          {!shown ? "Retourner" : last ? "Voir le paquet" : "Suivante"}
          {shown && !last && <ChevronRight aria-hidden className="-mr-1 size-5" strokeWidth={2.5} />}
        </button>
      </div>
    </div>
  );
}

/** Miniature de l'image de l'article, bordée à la couleur de la rareté. */
function Thumb({ card }: { card: CardDTO }) {
  const live = useCardMedia(card.cardId);
  const src = live?.thumbUrl ?? card.thumbUrl;
  return (
    <span
      data-rarity={card.rarity}
      className="relative block aspect-[5/7] w-9 shrink-0 overflow-hidden rounded-[5px] bg-sticker shadow-[0_0_0_2px_var(--r),var(--shadow-lift)]"
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- vignettes Wikimedia servies telles quelles
        <img src={src} alt="" loading="lazy" decoding="async" className="absolute inset-0 size-full object-cover" />
      ) : (
        <span className="grid size-full place-items-center font-display text-lg uppercase text-sticker-muted">
          {card.title.slice(0, 1)}
        </span>
      )}
    </span>
  );
}

/** Téléphone, fin du paquet : les dix cartes en liste compacte ; toucher une ligne la remontre en grand. */
function DeckRecap({
  cards,
  recycled,
  onRecycle,
  onShow,
}: Pick<DealtProps, "cards" | "recycled" | "onRecycle"> & { onShow: (i: number) => void }) {
  const best = cards.reduce((a, b) => (rarityRank(b.rarity) > rarityRank(a.rarity) ? b : a));
  return (
    <div className="flex w-full flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-2xl uppercase leading-none">Ce paquet</h2>
        <p className="text-sm text-muted">
          Meilleure : <span className="font-semibold text-text">{RARITY_LABELS[best.rarity]}</span>
        </p>
      </div>
      <ol className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-panel">
        {cards.map((card, i) => {
          const gone = isRecycled(card, recycled);
          return (
            <li
              key={card.instanceId ?? i}
              data-rarity={card.rarity}
              className={`flex items-center gap-2 py-1 pl-2.5 pr-2 transition-opacity duration-300 ${
                rarityRank(card.rarity) >= rarityRank("SR") ? "bg-[color-mix(in_oklab,var(--r)_12%,transparent)]" : ""
              } ${gone ? "opacity-55" : ""}`}
            >
              <button
                type="button"
                onClick={() => onShow(i)}
                className="flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-lg text-left"
                aria-label={`Revoir ${card.title}`}
              >
                <Thumb card={card} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold leading-snug">{card.title}</span>
                  <span className="tnum flex items-center gap-2 text-xs text-muted">
                    <span className="pc-sigil">{card.rarity}</span>
                    <span>
                      ATK {fmt(card.atk)} · DEF {fmt(card.def)}
                    </span>
                  </span>
                </span>
              </button>
              <RecycleAction card={card} recycled={gone} onRecycle={onRecycle} className="shrink-0" />
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/**
 * Mémoïsé : la page Paquets se redessine chaque seconde (compte à rebours du prochain paquet) ; sans
 * `memo`, tout l'ouvreur et ses vignettes suivaient, en pleine animation.
 */
export const PackOpener = memo(function PackOpener({ packs, season }: { packs: PackState; season: number }) {
  const { me, mutateMe } = useMe();
  const speed: Speed = me?.animationSpeed ?? "normal";
  const phone = useMediaQuery(PHONE_QUERY);
  const reduce = useReducedMotion();
  const [phase, setPhase] = useState<Phase>("sealed");
  const [cards, setCards] = useState<CardDTO[]>([]);
  const [revealed, setRevealed] = useState<boolean[]>([]);
  const [recycled, setRecycled] = useState<Record<number, true>>({});
  const [cursor, setCursor] = useState(0);
  const [busy, setBusy] = useState(false);
  const [announce, setAnnounce] = useState("");
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const region = useRef<HTMLElement>(null);
  const canOpen = packs.available + packs.bonus > 0;

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const reveal = useCallback(
    (i: number) => {
      setRevealed((r) => (r[i] ? r : r.map((v, j) => (j === i ? true : v))));
      const card = cards[i];
      if (card && rarityRank(card.rarity) >= rarityRank("UR"))
        setAnnounce(`${RARITY_LABELS[card.rarity]} : ${card.title} !`);
    },
    [cards],
  );

  function revealAll() {
    setRevealed(cards.map(() => true));
  }

  /** Grille : retourne les cartes une à une, dans l'ordre du paquet (la garantie « Rare ou mieux » en dernier). */
  function autoReveal(list: CardDTO[]) {
    let t = speed === "fast" ? 250 : 500;
    list.forEach((card, i) => {
      t += flipDelay(card, speed);
      timers.current.push(
        setTimeout(() => {
          setRevealed((r) => r.map((v, j) => (j === i ? true : v)));
          if (rarityRank(card.rarity) >= rarityRank("UR"))
            setAnnounce(`${RARITY_LABELS[card.rarity]} : ${card.title} !`);
        }, t),
      );
    });
  }

  async function open() {
    if (busy || !canOpen) return;
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setBusy(true);
    setAnnounce("");
    setRecycled({});
    if (speed !== "instant") setPhase("tearing");
    try {
      const [res] = await Promise.all([
        api<OpenResponse>("/packs/open", { method: "POST" }),
        new Promise((r) => setTimeout(r, speed === "instant" ? 0 : speed === "fast" ? 280 : 560)),
      ]);
      setCards(res.cards);
      setRevealed(res.cards.map(() => speed === "instant"));
      setCursor(0);
      setPhase("dealt");
      // Sur téléphone, la pile se cale sous la barre du haut : la carte tient à l'écran sans défiler.
      if (phone)
        requestAnimationFrame(() =>
          region.current?.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" }),
        );
      if (speed !== "instant") {
        if (!phone) autoReveal(res.cards);
      } else {
        const best = res.cards.reduce((a, b) => (rarityRank(b.rarity) > rarityRank(a.rarity) ? b : a));
        setAnnounce(`Meilleure carte : ${best.title} (${RARITY_LABELS[best.rarity]})`);
      }
      if (res.pityTriggered) toast("Pity déclenchée : UR ou mieux garantie !");
      void mutateMe((m) => (m ? { ...m, packs: res.packs } : m), { revalidate: false });
    } catch (err) {
      setPhase("sealed");
      toast.error(err instanceof ApiError ? err.message : "Impossible d'ouvrir le paquet.");
    } finally {
      setBusy(false);
    }
  }

  async function recycleOne(card: CardDTO) {
    if (!card.instanceId) return;
    setRecycled((d) => ({ ...d, [card.instanceId!]: true }));
    try {
      const res = await api<{ gain: number }>("/collection/recycle", { body: { instanceIds: [card.instanceId] } });
      toast.success(`+${res.gain} PW : ${card.title} recyclée.`);
    } catch (err) {
      setRecycled(({ [card.instanceId!]: _, ...rest }) => rest);
      toast.error(err instanceof ApiError ? err.message : "Recyclage impossible.");
    }
  }

  const allRevealed = revealed.length > 0 && revealed.every(Boolean);
  const dealt = { cards, revealed, onReveal: reveal, recycled, onRecycle: recycleOne, speed };
  /** Téléphone, cartes encore en pile : la pile porte ses propres boutons. */
  const decking = phone && phase === "dealt" && cursor < cards.length;

  return (
    <section
      ref={region}
      aria-label="Ouverture de paquet"
      className={`flex scroll-mt-16 flex-col items-center ${decking ? "gap-3" : "gap-6"}`}
    >
      <p aria-live="polite" className="sr-only">
        {announce}
      </p>

      <AnimatePresence mode="wait" initial={false}>
        {phase !== "dealt" ? (
          <motion.div key="sleeve" exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="w-full py-2">
            <Sleeve
              tearing={phase === "tearing"}
              season={season}
              stock={packs.available + packs.bonus}
              onOpen={open}
              disabled={!canOpen}
            />
          </motion.div>
        ) : (
          <motion.div
            key="cards"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2 }}
            className="w-full"
          >
            {!phone ? (
              <PackGrid {...dealt} />
            ) : cursor < cards.length ? (
              <PackDeck {...dealt} onRevealAll={revealAll} cursor={cursor} onCursor={setCursor} />
            ) : (
              <DeckRecap cards={cards} recycled={recycled} onRecycle={recycleOne} onShow={setCursor} />
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {!decking && (
        <div className="flex w-full flex-wrap items-center justify-center gap-2">
          {phase === "dealt" && !allRevealed && (
            <button type="button" className="btn" onClick={revealAll}>
              Tout retourner
            </button>
          )}
          <button
            type="button"
            className={`btn btn-primary ${phone ? "min-h-12 w-full max-w-sm text-base" : "min-w-44"}`}
            onClick={open}
            disabled={busy || !canOpen}
          >
            {busy ? "Ouverture…" : phase === "dealt" ? "Ouvrir le suivant" : "Ouvrir un paquet"}
          </button>
          {phase === "dealt" && allRevealed && (
            <Link href="/collection" className="btn btn-ghost">
              Voir ma collection
            </Link>
          )}
        </div>
      )}
    </section>
  );
});
