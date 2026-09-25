"use client";

import { ECONOMY, RARITY_LABELS, rarityRank } from "@palacards/game";
import type { CardDTO, PackState } from "@palacards/shared";
import { Recycle, Scissors } from "lucide-react";
import {
  AnimatePresence,
  motion,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from "motion/react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { useMe } from "@/lib/game";
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
        aria-label="Ouvrir un paquet"
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
            <span className="absolute inset-x-[8%] top-[36%] block text-left font-display uppercase leading-[0.82] text-cover-ink [text-shadow:0_2px_0_#0b1f66,0_4px_14px_rgb(0_0_0/0.35)]">
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

/** Une carte du paquet : face cachée, puis retournée en 3D. */
function FlipCard({
  card,
  revealed,
  onReveal,
  index,
  speed,
}: {
  card: CardDTO;
  revealed: boolean;
  onReveal: () => void;
  index: number;
  speed: Speed;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className="relative [perspective:1100px]"
      initial={speed === "instant" ? false : { opacity: 0, transform: "translateY(24px) scale(0.96)" }}
      animate={{ opacity: 1, transform: "translateY(0px) scale(1)" }}
      transition={{ duration: 0.4, ease: EASE_OUT, delay: speed === "instant" ? 0 : index * 0.07 }}
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
          <Card card={card} priority />
        </div>
        <button
          type="button"
          onClick={onReveal}
          disabled={revealed}
          className="absolute inset-0 aspect-[5/7] [backface-visibility:hidden] [transform:rotateY(180deg)]"
          aria-label={`Retourner la carte ${index + 1}`}
        >
          <span className="pc-back">
            <span className="relative grid aspect-square w-[44%] rotate-[-12deg] place-items-center rounded-full bg-accent font-display text-[2.4rem] uppercase leading-none text-cover shadow-[0_4px_10px_-4px_rgb(0_0_0/0.5)]">
              <span className="absolute inset-[5px] rounded-full border-2 border-dashed border-accent-ink/25" />P
            </span>
          </span>
        </button>
      </motion.div>
    </motion.div>
  );
}

export function PackOpener({ packs, season }: { packs: PackState; season: number }) {
  const { me, mutateMe } = useMe();
  const speed: Speed = me?.animationSpeed ?? "normal";
  const [phase, setPhase] = useState<Phase>("sealed");
  const [cards, setCards] = useState<CardDTO[]>([]);
  const [revealed, setRevealed] = useState<boolean[]>([]);
  const [recycled, setRecycled] = useState<Record<number, true>>({});
  const [busy, setBusy] = useState(false);
  const [announce, setAnnounce] = useState("");
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const canOpen = packs.available + packs.bonus > 0;

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  function revealAll(list: CardDTO[]) {
    setRevealed(list.map(() => true));
  }

  /** Retourne les cartes une à une, dans l'ordre du paquet (la garantie « Rare ou mieux » en dernier). */
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
      setPhase("dealt");
      if (speed !== "instant") autoReveal(res.cards);
      else {
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

  return (
    <section aria-label="Ouverture de paquet" className="flex flex-col items-center gap-6">
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
            <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-5">
              {cards.map((card, i) => {
                const isRecycled = !!card.instanceId && recycled[card.instanceId];
                return (
                  <li
                    key={card.instanceId ?? i}
                    className={`flex flex-col gap-2 ${i === 4 ? "col-span-2 mx-auto w-[calc(50%-0.375rem)] sm:col-span-1 sm:w-full" : ""}`}
                  >
                    <div
                      className={`transition-[opacity,filter] duration-300 ${isRecycled ? "opacity-35 grayscale" : ""}`}
                    >
                      <FlipCard
                        card={card}
                        index={i}
                        speed={speed}
                        revealed={revealed[i] ?? false}
                        onReveal={() => setRevealed((r) => r.map((v, j) => (j === i ? true : v)))}
                      />
                    </div>
                    <div
                      inert={!revealed[i]}
                      className={`flex justify-center transition-opacity duration-200 ${revealed[i] ? "opacity-100" : "pointer-events-none opacity-0"}`}
                    >
                      {isRecycled ? (
                        <span className="text-center text-xs text-muted">
                          Recyclée · +{ECONOMY.recycleValue[card.rarity]} PW
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-sm w-full gap-1 px-1.5 text-xs"
                          onClick={() => recycleOne(card)}
                          aria-label={`Recycler ${card.title} pour ${ECONOMY.recycleValue[card.rarity]} PW`}
                        >
                          <Recycle aria-hidden className="size-3.5 shrink-0" />
                          <span className="tnum">+{ECONOMY.recycleValue[card.rarity]}</span>
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex flex-wrap items-center justify-center gap-2">
        {phase === "dealt" && !allRevealed && (
          <button type="button" className="btn" onClick={() => revealAll(cards)}>
            Tout retourner
          </button>
        )}
        <button type="button" className="btn btn-primary min-w-44" onClick={open} disabled={busy || !canOpen}>
          {busy ? "Ouverture…" : phase === "dealt" ? "Ouvrir le suivant" : "Ouvrir un paquet"}
        </button>
        {phase === "dealt" && allRevealed && (
          <Link href="/collection" className="btn btn-ghost">
            Voir ma collection
          </Link>
        )}
      </div>
    </section>
  );
}
