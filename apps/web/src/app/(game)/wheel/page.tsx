"use client";

import type { WheelTier } from "@palacards/game";
import type { WheelDTO, WheelFaceDTO, WheelPrizeDTO, WheelRewardDTO, WheelSpinDTO } from "@palacards/shared";
import { Check, Clock, Lock, Moon } from "lucide-react";
import { animate, AnimatePresence, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { RaritySigil } from "@/components/Card";
import { FlipCard } from "@/components/PackOpener";
import { ErrorBox } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { countdown, fmt } from "@/lib/format";
import { useSeenFeature } from "@/lib/features";
import { useMe } from "@/lib/game";
import { play } from "@/lib/sfx";
import { useNow } from "@/lib/use-now";
import "@/components/content.css";

const SIZE = 340;
const C = SIZE / 2;
const R = 150;

const TIER: Record<WheelTier, { name: string; short: string }> = {
  small: { name: "Petite roue", short: "Petite" },
  medium: { name: "Moyenne roue", short: "Moyenne" },
  large: { name: "Grande roue", short: "Grande" },
};
const ORDER: WheelTier[] = ["small", "medium", "large"];

/** Libellé court d'une case (dans la roue) et long (résultat, tableau des chances). */
function label(
  r: WheelRewardDTO | WheelPrizeDTO,
  themeName?: string | null,
): { big: string; small: string; long: string } {
  if (r.kind === "pw") return { big: fmt(r.amount), small: "PW", long: `${fmt(r.amount)} points wiki` };
  if (r.kind === "packs")
    return {
      big: String(r.amount),
      small: r.amount > 1 ? "paquets" : "paquet",
      long: `${r.amount} paquet${r.amount > 1 ? "s" : ""} bonus`,
    };
  if (r.kind === "theme") {
    const name = "themeName" in r ? r.themeName : themeName;
    const n = `${r.amount} booster${r.amount > 1 ? "s" : ""}`;
    return {
      big: String(r.amount),
      small: r.amount > 1 ? "boosters" : "booster",
      long: name ? `${n} « ${name} »` : `${n} à thème`,
    };
  }
  return {
    big: r.rarity,
    small: "carte",
    long: r.rarity === "L" ? "Une légendaire au hasard" : "Une ultra rare au hasard",
  };
}

/** Lot au pluriel (plusieurs paquets ou boosters). */
const plural = (p: WheelPrizeDTO) => "amount" in p && p.amount > 1;

const pct = (w: number) => `${(w / 100).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %`;

/** Point du cercle à `deg` degrés (0 = en haut, sens horaire). */
function polar(deg: number, radius: number) {
  const a = ((deg - 90) * Math.PI) / 180;
  return [C + radius * Math.cos(a), C + radius * Math.sin(a)] as const;
}

function wedge(from: number, to: number) {
  const [x1, y1] = polar(from, R);
  const [x2, y2] = polar(to, R);
  return `M ${C} ${C} L ${x1} ${y1} A ${R} ${R} 0 ${to - from > 180 ? 1 : 0} 1 ${x2} ${y2} Z`;
}

/**
 * Une roue : un disque de pochette, aux couleurs de son rang (bleu couverture, violet, nuit et or). Les
 * cases de cartes prennent la couleur de leur rareté ; ampoules sur la jante, moyeu « P » des vignettes.
 */
function WheelFace({ tier, segments }: { tier: WheelTier; segments: WheelFaceDTO["segments"] }) {
  const seg = 360 / segments.length;
  const bulbs = tier === "large" ? 4 : 2;
  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="block size-full" aria-hidden>
      <defs>
        <radialGradient id={`wheel-rim-${tier}`} cx="50%" cy="40%" r="60%">
          <stop offset="0%" style={{ stopColor: "var(--wheel-rim-hi)" }} />
          <stop offset="100%" style={{ stopColor: "var(--wheel-rim-lo)" }} />
        </radialGradient>
        <linearGradient id={`wheel-sheen-${tier}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.22" />
          <stop offset="45%" stopColor="#fff" stopOpacity="0" />
          <stop offset="100%" stopColor="#000" stopOpacity="0.2" />
        </linearGradient>
      </defs>
      <circle cx={C} cy={C} r={R + 14} fill={`url(#wheel-rim-${tier})`} />
      <circle cx={C} cy={C} r={R + 14} fill="none" stroke="rgb(0 0 0 / 0.25)" strokeWidth="1" />
      {segments.map(({ reward }, i) => {
        const card = reward.kind === "card";
        const fill = card
          ? `var(--color-rarity-${reward.rarity.toLowerCase()})`
          : i % 2
            ? "var(--wheel-b)"
            : "var(--wheel-a)";
        const mid = i * seg + seg / 2;
        const l = label(reward);
        const long = l.big.length > 3;
        return (
          <g key={i}>
            <path d={wedge(i * seg, (i + 1) * seg)} fill={fill} stroke="rgb(255 255 255 / 0.55)" strokeWidth="1.5" />
            <g transform={`rotate(${mid} ${C} ${C})`}>
              <text
                x={C}
                y={C - R + 44}
                textAnchor="middle"
                className="font-display"
                style={{ fontStretch: "62%", fontWeight: 800 }}
                fontSize={card ? 34 : long ? 28 : 36}
                fill={card ? (reward.rarity === "L" ? "#1f1600" : "#fff") : "var(--wheel-ink)"}
              >
                {l.big}
              </text>
              <text
                x={C}
                y={C - R + 62}
                textAnchor="middle"
                fontSize="12"
                fontWeight="700"
                letterSpacing="0.06em"
                fill={card && reward.rarity === "L" ? "#1f1600" : "#fff"}
                opacity="0.85"
                style={{ textTransform: "uppercase" }}
              >
                {l.small}
              </text>
            </g>
          </g>
        );
      })}
      {/* Reflet, fixe par rapport à la roue. */}
      <circle cx={C} cy={C} r={R} fill={`url(#wheel-sheen-${tier})`} pointerEvents="none" />
      {/* Ampoules de la jante : plus nombreuses sur la grande roue. */}
      {Array.from({ length: segments.length * bulbs }, (_, i) => {
        const [x, y] = polar((i * seg) / bulbs, R + 7);
        const big = i % bulbs === 0;
        return <circle key={i} cx={x} cy={y} r={big ? 3.6 : 2.4} fill="var(--wheel-bulb)" opacity={big ? 1 : 0.7} />;
      })}
      {/* Moyeu : la pastille jaune du dos des vignettes. */}
      <circle cx={C} cy={C} r="34" fill="var(--color-accent)" />
      <circle cx={C} cy={C} r="28" fill="none" stroke="rgb(31 22 0 / 0.25)" strokeWidth="2" strokeDasharray="4 4" />
      <text
        x={C}
        y={C + 13}
        textAnchor="middle"
        fontSize="38"
        fill="var(--wheel-hub)"
        style={{ fontStretch: "62%", fontWeight: 800 }}
      >
        P
      </text>
    </svg>
  );
}

/** Ce que dit la vignette d'une roue dans le programme de la journée. */
function stationText(
  w: WheelFaceDTO,
  prev: WheelTier | null,
  now: number,
): { text: string; icon: typeof Check | null } {
  if (w.status === "done") return { text: "Tournée", icon: Check };
  if (w.status === "ready") return { text: "Prête", icon: null };
  if (w.status === "waiting" && w.availableAt)
    return { text: `Dans ${countdown(new Date(w.availableAt).getTime() - now)}`, icon: Clock };
  if (w.status === "missed") return { text: "Demain", icon: Moon };
  return { text: prev ? `2 h 30 après la ${TIER[prev].short.toLowerCase()}` : "Dès minuit", icon: Lock };
}

export default function WheelPage() {
  useSeenFeature("wheels");
  const { me, mutateMe } = useMe();
  const wheel = useSWR<WheelDTO>("/wheel");
  const reduce = useReducedMotion();
  const rotation = useMotionValue(0);
  const transform = useTransform(rotation, (r) => `rotate(${r}deg)`);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<WheelSpinDTO | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [picked, setPicked] = useState<WheelTier | null>(null);
  const now = useNow(1000);
  const lastTick = useRef(0);

  const data = wheel.data;
  // Le dernier lot s'efface quand la roue suivante est prête (on la montre) ou quand minuit est passé.
  const live =
    result && new Date(result.wheel.resetAt).getTime() > now && !(data?.ready && data.next !== result.tier)
      ? result
      : null;
  // Roue affichée : celle choisie dans le programme, sinon celle qu'on vient de tourner, sinon la prochaine
  // (la grande quand tout est fait).
  const tier: WheelTier = picked ?? live?.tier ?? data?.next ?? "large";
  const face = data?.wheels.find((w) => w.tier === tier);
  const segments = face?.segments ?? [];
  const seg = segments.length ? 360 / segments.length : 0;
  const canSpin = !!data?.ready && data.next === tier && !spinning && !!me;

  // Cliquetis à chaque case qui passe sous le repère (un ressort de fête foraine).
  useEffect(
    () =>
      rotation.on("change", (r) => {
        if (!seg || !spinning) return;
        const n = Math.floor(r / seg);
        if (n !== lastTick.current) {
          lastTick.current = n;
          play("deal");
        }
      }),
    [rotation, seg, spinning],
  );

  // Une roue devient prête, ou minuit passe : on recharge l'état sans recharger la page.
  const dueAt = data
    ? Math.min(...[data.availableAt, data.resetAt].filter(Boolean).map((t) => new Date(t!).getTime()))
    : 0;
  const due = !!data && dueAt <= now && !spinning;
  useEffect(() => {
    if (!due) return;
    void wheel.mutate();
    void mutateMe();
  }, [due, wheel, mutateMe]);

  function choose(t: WheelTier) {
    if (spinning || t === tier) return;
    setPicked(t);
    setResult(null);
    rotation.set(0);
  }

  async function spin() {
    if (!canSpin) return;
    setSpinning(true);
    setResult(null);
    setRevealed(false);
    lastTick.current = Math.floor(rotation.get() / seg);
    try {
      const res = await api<WheelSpinDTO>("/wheel/spin", { method: "POST" });
      // Case gagnante sous le repère (en haut), décalée au hasard dans la case, après plusieurs tours.
      const current = rotation.get();
      const jitter = (Math.random() - 0.5) * seg * 0.6;
      const target = -(res.segment * seg + seg / 2) + jitter;
      const base = current - (((current % 360) + 360) % 360);
      let end = base + 360 * 6 + (((target % 360) + 360) % 360);
      if (end - current < 360 * 5) end += 360;
      // Mouvement réduit : pas de tours, un court glissement jusqu'à la case gagnante.
      await animate(
        rotation,
        reduce ? end - 360 * Math.floor((end - current) / 360) : end,
        reduce ? { duration: 0.6, ease: [0.23, 1, 0.32, 1] } : { duration: 4.8, ease: [0.12, 0.72, 0.16, 1] },
      );
      setResult(res);
      setPicked(null);
      void mutateMe((m) => (m ? { ...m, wallet: res.wallet, packs: res.packs, wheelReady: res.wheel.ready } : m), {
        revalidate: false,
      });
      void wheel.mutate(res.wheel, { revalidate: false });
      if (res.prize.kind === "card") setTimeout(() => setRevealed(true), reduce ? 0 : 450);
      else play("coin");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "La roue est coincée, réessaie.");
      void wheel.mutate();
    } finally {
      setSpinning(false);
    }
  }

  const shown = live && live.tier === tier ? live : null;
  const nextName = data?.next ? TIER[data.next].name.toLowerCase() : null;
  const button = spinning
    ? "La roue tourne…"
    : canSpin
      ? `Tourner la ${TIER[tier].name.toLowerCase()}`
      : face?.status === "done"
        ? "Déjà tournée aujourd'hui"
        : face?.status === "waiting" && face.availableAt
          ? `Prête dans ${countdown(new Date(face.availableAt).getTime() - now)}`
          : face?.status === "missed"
            ? "Trop tard aujourd'hui"
            : `Tourne d'abord la ${nextName ?? "roue précédente"}`;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="page-title">Roues du jour</h1>
        <p className="hatnote mt-2 max-w-[62ch]">
          Trois roues par jour, de plus en plus généreuses. La petite est prête dès minuit, la moyenne 2 h 30 après
          l&apos;avoir tournée, la grande 2 h 30 après la moyenne. Tout repart à minuit (heure de Paris).
        </p>
      </div>

      {wheel.error && <ErrorBox error={wheel.error} retry={() => wheel.mutate()} />}

      <ol className="pc-wheel-day" aria-label="Les roues de la journée">
        {ORDER.map((t, i) => {
          const w = data?.wheels.find((x) => x.tier === t);
          const st = w ? stationText(w, i ? ORDER[i - 1]! : null, now) : null;
          const Icon = st?.icon;
          return (
            <li key={t}>
              <button
                type="button"
                className="pc-wheel-station"
                data-tier={t}
                data-status={w?.status ?? "locked"}
                aria-pressed={t === tier}
                onClick={() => choose(t)}
                disabled={spinning}
              >
                <span className="pc-wheel-glyph" aria-hidden />
                <span className="min-w-0">
                  <span className="block font-display text-[1.15rem] uppercase leading-none">{TIER[t].short}</span>
                  <span className="pc-wheel-state tnum mt-1 flex items-center gap-1 text-xs font-semibold">
                    {Icon && <Icon aria-hidden className="size-3.5 shrink-0" strokeWidth={2.5} />}
                    {st?.text ?? "…"}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      <div className="grid items-start gap-8 md:grid-cols-[minmax(0,26rem)_minmax(0,22rem)] md:justify-center">
        <div className="flex flex-col items-center gap-5">
          <div className="pc-wheel-stage" data-tier={tier}>
            {/* Repère : une languette jaune qui pointe la case gagnante. */}
            <svg
              viewBox="0 0 40 46"
              aria-hidden
              className="absolute left-1/2 top-[-6px] z-10 w-10 -translate-x-1/2 [filter:drop-shadow(0_4px_4px_rgb(4_8_30/0.5))]"
            >
              <path
                d="M4 4 H36 V20 L20 42 L4 20 Z"
                fill="var(--color-accent)"
                stroke="var(--color-accent-ink)"
                strokeOpacity="0.25"
                strokeWidth="2"
                strokeLinejoin="round"
              />
              <circle cx="20" cy="14" r="4" fill="var(--color-cover)" />
            </svg>
            <div className="aspect-square [filter:drop-shadow(0_22px_24px_rgb(4_8_30/0.45))]">
              <AnimatePresence mode="wait" initial={false}>
                {segments.length ? (
                  <motion.div
                    key={tier}
                    className="size-full"
                    initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.94, filter: "blur(3px)" }}
                    animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                    exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97, filter: "blur(2px)" }}
                    transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
                  >
                    <motion.div className="size-full" style={{ transform }}>
                      <WheelFace tier={tier} segments={segments} />
                    </motion.div>
                  </motion.div>
                ) : (
                  <div className="size-full animate-pulse rounded-full bg-panel" />
                )}
              </AnimatePresence>
            </div>
          </div>

          <button
            type="button"
            className="btn btn-primary min-h-12 w-full max-w-xs text-base"
            onClick={spin}
            disabled={!canSpin}
          >
            {button}
          </button>
        </div>

        <div className="flex flex-col gap-4">
          <section className="infobox" aria-live="polite">
            <h2 className="infobox-head">{shown ? "Gagné" : TIER[tier].name}</h2>
            <div className="p-4">
              {shown ? (
                shown.card ? (
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-44">
                      <FlipCard
                        card={shown.card}
                        revealed={revealed}
                        onReveal={() => setRevealed(true)}
                        index={0}
                        speed="normal"
                        stagger={false}
                      />
                    </div>
                    <p className="text-center text-sm text-muted">
                      {revealed ? (
                        <>
                          <strong className="text-text">{shown.card.title}</strong> rejoint ta{" "}
                          <Link href="/collection" className="article-link">
                            collection
                          </Link>
                          .
                        </>
                      ) : (
                        "Retourne la carte."
                      )}
                    </p>
                  </div>
                ) : (
                  <div className="flex items-center gap-4">
                    <span className="relative grid size-24 shrink-0 rotate-[-10deg] place-items-center rounded-full bg-accent text-accent-ink shadow-[0_4px_10px_-4px_rgb(0_0_0/0.5)]">
                      <span className="absolute inset-[5px] rounded-full border-2 border-dashed border-accent-ink/25" />
                      <span className="font-display text-center text-[1.9rem] leading-[0.85]">
                        +{label(shown.prize).big}
                        <span className="block text-[0.8rem] uppercase">{label(shown.prize).small}</span>
                      </span>
                    </span>
                    <p className="text-sm text-muted">
                      <strong className="text-text">{label(shown.prize).long}</strong>{" "}
                      {shown.prize.kind === "pw" ? (
                        "sur ton compte."
                      ) : (
                        <>
                          {plural(shown.prize) ? "ajoutés" : "ajouté"} à ton stock.{" "}
                          <Link href="/pulls" className="article-link">
                            {plural(shown.prize) ? "Les ouvrir" : "L'ouvrir"}
                          </Link>
                        </>
                      )}
                    </p>
                  </div>
                )
              ) : (
                <p className="text-sm text-muted">
                  {face?.status === "done"
                    ? data?.next
                      ? `Tournée aujourd’hui. Prochaine étape : la ${nextName}.`
                      : "Les trois roues sont tournées. Elles reviennent à minuit."
                    : face?.status === "missed"
                      ? "Elle ne serait prête qu’après minuit : reviens demain dès minuit pour recommencer par la petite."
                      : tier === "small"
                        ? "Des points wiki, des paquets bonus, et parfois une ultra rare ou une légendaire."
                        : tier === "medium"
                          ? "Plus de points, plus de paquets, un booster à thème, et une chance de légendaire plus grande."
                          : "Le gros lot de la journée : jusqu’à 1 000 PW, 10 paquets, deux boosters à thème ou une légendaire."}
                </p>
              )}
              {!data?.next && data && (
                <p className="tnum mt-2 text-sm font-semibold">
                  Nouvelles roues dans {countdown(new Date(data.resetAt).getTime() - now)}
                </p>
              )}
            </div>
          </section>

          <section className="infobox">
            <h2 className="infobox-head">Chances</h2>
            <table className="tnum w-full text-sm">
              <tbody>
                {[...segments]
                  .sort((a, b) => b.weight - a.weight)
                  .map((s, i) => (
                    <tr key={i} className="border-t border-line first:border-0">
                      <td className="px-4 py-1.5">
                        {s.reward.kind === "card" ? (
                          <span className="inline-flex items-center gap-2">
                            <RaritySigil rarity={s.reward.rarity} />
                            {label(s.reward).long}
                          </span>
                        ) : (
                          label(s.reward, data?.theme?.name).long
                        )}
                      </td>
                      <td className="px-4 py-1.5 text-right text-muted">{pct(s.weight)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
            {segments.some((s) => s.reward.kind === "theme") && (
              <p className="border-t-2 border-dashed border-line px-4 py-2.5 text-xs text-muted">
                {data?.theme
                  ? `Le booster est celui en vente qui se termine le plus tôt.`
                  : "Aucun booster à thème en vente : chaque booster gagné devient deux paquets bonus."}
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
