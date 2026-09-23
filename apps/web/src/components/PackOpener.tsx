"use client";

import { ECONOMY, RARITY_LABELS, rarityRank } from "@palacards/game";
import type { CardDTO, PackState } from "@palacards/shared";
import { Check, Recycle } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { useMe } from "@/lib/game";
import { Card } from "./Card";

type Speed = "normal" | "fast" | "instant";
type Phase = "sealed" | "tearing" | "dealt";
type Decision = "kept" | "recycled";

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

/** Pochette scellée au format carte. */
function Sleeve({ tearing, season }: { tearing: boolean; season: number }) {
  const reduce = useReducedMotion();
  return (
    <div className="relative mx-auto aspect-[5/7] w-[min(15rem,62vw)] select-none" aria-hidden>
      {/* Corps de la pochette. */}
      <motion.div
        className="absolute inset-0 overflow-hidden rounded-[12px] border border-line-strong"
        style={{
          clipPath: "inset(11% 0 0 0 round 0 0 12px 12px)",
          background:
            "repeating-linear-gradient(135deg, rgb(255 255 255 / 0.03) 0 1px, transparent 1px 7px), radial-gradient(120% 90% at 30% 20%, #26303d 0%, #151a21 60%, #0f1216 100%)",
          boxShadow: "0 24px 50px -24px rgb(0 0 0 / 0.9)",
        }}
        animate={
          tearing
            ? { transform: reduce ? "none" : "translateY(18%)", opacity: 0 }
            : { transform: "translateY(0%)", opacity: 1 }
        }
        transition={{ duration: 0.42, ease: EASE_OUT, delay: tearing ? 0.16 : 0 }}
      >
        <div className="absolute inset-x-5 top-[22%] border-t border-line-strong" />
        <div className="absolute inset-x-0 top-[34%] flex flex-col items-center gap-2 px-4 text-center">
          <span className="font-serif text-[2.1rem] leading-none tracking-[-0.01em]">
            Pala<span className="text-accent">Cards</span>
          </span>
          <span className="text-xs text-muted">5 articles de Wikipédia</span>
        </div>
        <div className="absolute inset-x-5 bottom-[18%] border-t border-line" />
        <span className="tnum absolute bottom-[8%] left-0 right-0 text-center text-[0.7rem] text-faint">
          Édition saison {season}
        </span>
      </motion.div>
      {/* Bande à arracher, séparée par des pointillés. */}
      <motion.div
        className="absolute inset-0 rounded-[12px] border border-line-strong bg-[#232b36]"
        style={{ clipPath: "inset(0 0 89% 0 round 12px 12px 0 0)", transformOrigin: "85% 11%" }}
        animate={
          tearing
            ? { transform: reduce ? "none" : "translate(18%, -30%) rotate(14deg)", opacity: 0 }
            : { transform: "translate(0%, 0%) rotate(0deg)", opacity: 1 }
        }
        transition={{ duration: 0.36, ease: EASE_OUT }}
      />
      <div className="absolute inset-x-3 top-[11%] border-t border-dashed border-faint/60" />
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
  const rare = rarityRank(card.rarity) >= rarityRank("SR");
  const glow = `var(--color-rarity-${card.rarity.toLowerCase()})`;
  return (
    <motion.div
      className="relative [perspective:1100px]"
      initial={speed === "instant" ? false : { opacity: 0, transform: "translateY(24px) scale(0.96)" }}
      animate={{ opacity: 1, transform: "translateY(0px) scale(1)" }}
      transition={{ duration: 0.4, ease: EASE_OUT, delay: speed === "instant" ? 0 : index * 0.07 }}
    >
      {/* Lueur de rareté, allumée au retournement. */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute -inset-3 rounded-[18px] blur-xl"
        style={{ background: `radial-gradient(closest-side, ${glow}, transparent)` }}
        initial={false}
        animate={{ opacity: revealed ? (card.rarity === "L" ? 0.75 : rare ? 0.5 : card.rarity === "R" ? 0.22 : 0) : 0 }}
        transition={{ duration: 0.6, ease: EASE_OUT }}
      />
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
            <span className="font-serif text-4xl text-muted">P</span>
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
  const [decisions, setDecisions] = useState<Record<number, Decision>>({});
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
    setDecisions({});
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
    setDecisions((d) => ({ ...d, [card.instanceId!]: "recycled" }));
    try {
      const res = await api<{ gain: number }>("/collection/recycle", { body: { instanceIds: [card.instanceId] } });
      toast.success(`+${res.gain} PW : ${card.title} recyclée.`);
    } catch (err) {
      setDecisions(({ [card.instanceId!]: _, ...rest }) => rest);
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
            <Sleeve tearing={phase === "tearing"} season={season} />
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
                const decision = card.instanceId ? decisions[card.instanceId] : undefined;
                return (
                  <li
                    key={card.instanceId ?? i}
                    className={`flex flex-col gap-2 ${i === 4 ? "col-span-2 mx-auto w-[calc(50%-0.375rem)] sm:col-span-1 sm:w-full" : ""}`}
                  >
                    <div
                      className={`transition-[opacity,filter] duration-300 ${decision === "recycled" ? "opacity-35 grayscale" : ""}`}
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
                      className={`grid grid-cols-2 gap-1.5 transition-opacity duration-200 ${revealed[i] ? "opacity-100" : "pointer-events-none opacity-0"}`}
                    >
                      {decision === "recycled" ? (
                        <span className="col-span-2 text-center text-xs text-muted">
                          Recyclée · +{ECONOMY.recycleValue[card.rarity]} PW
                        </span>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="btn btn-sm gap-1 px-1.5 text-xs"
                            onClick={() => recycleOne(card)}
                            aria-label={`Recycler ${card.title} pour ${ECONOMY.recycleValue[card.rarity]} PW`}
                          >
                            <Recycle aria-hidden className="size-3.5 shrink-0" />
                            <span className="tnum">+{ECONOMY.recycleValue[card.rarity]}</span>
                          </button>
                          <button
                            type="button"
                            aria-pressed={decision === "kept"}
                            className={`btn btn-sm gap-1 px-1.5 text-xs ${decision === "kept" ? "border-accent text-accent" : ""}`}
                            onClick={() =>
                              card.instanceId && setDecisions((d) => ({ ...d, [card.instanceId!]: "kept" }))
                            }
                          >
                            <Check aria-hidden className="size-3.5 shrink-0" />
                            {decision === "kept" ? "Gardée" : "Garder"}
                          </button>
                        </>
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
