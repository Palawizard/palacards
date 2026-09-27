"use client";

import type { WheelDTO, WheelRewardDTO, WheelSpinDTO } from "@palacards/shared";
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { RaritySigil } from "@/components/Card";
import { FlipCard } from "@/components/PackOpener";
import { ErrorBox } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { countdown, fmt } from "@/lib/format";
import { useMe } from "@/lib/game";
import { play } from "@/lib/sfx";
import { useNow } from "@/lib/use-now";

const SIZE = 340;
const C = SIZE / 2;
const R = 150;

/** Libellé court d'une case (dans la roue) et long (résultat, tableau des chances). */
function label(r: WheelRewardDTO): { big: string; small: string; long: string } {
  if (r.kind === "pw") return { big: String(r.amount), small: "PW", long: `${fmt(r.amount)} points wiki` };
  if (r.kind === "packs")
    return {
      big: String(r.amount),
      small: r.amount > 1 ? "paquets" : "paquet",
      long: `${r.amount} paquet${r.amount > 1 ? "s" : ""} bonus`,
    };
  return {
    big: r.rarity,
    small: "carte",
    long: r.rarity === "L" ? "Une légendaire au hasard" : "Une ultra rare au hasard",
  };
}

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
 * La roue : une pochette alu en disque. Cases bleu couverture en alternance, les cartes à la couleur
 * de leur rareté ; ampoules jaunes sur la jante, moyeu « P » comme le dos des vignettes.
 */
function WheelFace({ segments }: { segments: WheelDTO["segments"] }) {
  const seg = 360 / segments.length;
  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="block size-full" aria-hidden>
      <defs>
        <radialGradient id="wheel-rim" cx="50%" cy="40%" r="60%">
          <stop offset="0%" style={{ stopColor: "color-mix(in oklab, var(--color-cover) 70%, #fff)" }} />
          <stop offset="100%" style={{ stopColor: "var(--color-cover-2)" }} />
        </radialGradient>
        <linearGradient id="wheel-sheen" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.22" />
          <stop offset="45%" stopColor="#fff" stopOpacity="0" />
          <stop offset="100%" stopColor="#000" stopOpacity="0.2" />
        </linearGradient>
      </defs>
      <circle cx={C} cy={C} r={R + 14} fill="url(#wheel-rim)" />
      <circle cx={C} cy={C} r={R + 14} fill="none" stroke="rgb(0 0 0 / 0.25)" strokeWidth="1" />
      {segments.map(({ reward }, i) => {
        const card = reward.kind === "card";
        const fill = card
          ? `var(--color-rarity-${reward.rarity.toLowerCase()})`
          : i % 2
            ? "var(--color-cover-2)"
            : "var(--color-cover)";
        const mid = i * seg + seg / 2;
        const l = label(reward);
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
                fontSize={card ? 34 : 36}
                fill={card ? (reward.rarity === "L" ? "#1f1600" : "#fff") : "var(--color-accent)"}
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
      {/* Reflet de l'alu, fixe par rapport à la roue. */}
      <circle cx={C} cy={C} r={R} fill="url(#wheel-sheen)" pointerEvents="none" />
      {/* Ampoules de la jante, une par séparation et une au milieu de chaque case. */}
      {Array.from({ length: segments.length * 2 }, (_, i) => {
        const [x, y] = polar((i * seg) / 2, R + 7);
        return (
          <circle key={i} cx={x} cy={y} r={i % 2 ? 2.4 : 3.6} fill="var(--color-accent)" opacity={i % 2 ? 0.7 : 1} />
        );
      })}
      {/* Moyeu : la pastille jaune du dos des vignettes. */}
      <circle cx={C} cy={C} r="34" fill="var(--color-accent)" />
      <circle cx={C} cy={C} r="28" fill="none" stroke="rgb(31 22 0 / 0.25)" strokeWidth="2" strokeDasharray="4 4" />
      <text
        x={C}
        y={C + 13}
        textAnchor="middle"
        fontSize="38"
        fill="var(--color-cover)"
        style={{ fontStretch: "62%", fontWeight: 800 }}
      >
        P
      </text>
    </svg>
  );
}

export default function WheelPage() {
  const { me, mutateMe } = useMe();
  const wheel = useSWR<WheelDTO>("/wheel");
  const reduce = useReducedMotion();
  const rotation = useMotionValue(0);
  const transform = useTransform(rotation, (r) => `rotate(${r}deg)`);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<WheelSpinDTO | null>(null);
  const [revealed, setRevealed] = useState(false);
  const now = useNow(1000);
  const lastTick = useRef(0);

  const segments = wheel.data?.segments ?? [];
  const seg = segments.length ? 360 / segments.length : 0;

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

  // Minuit passé : le lot affiché s'efface et la roue revient sans recharger la page.
  const expired = !!result && new Date(result.nextAt).getTime() <= now;
  const shown = expired ? null : result;
  const ready = !!wheel.data?.ready && !shown;
  const nextAt = shown?.nextAt ?? wheel.data?.nextAt;
  const wait = nextAt ? new Date(nextAt).getTime() - now : 0;
  const due = !!nextAt && wait <= 0 && !spinning && wheel.data?.ready === false;

  useEffect(() => {
    if (!due) return;
    void wheel.mutate();
    void mutateMe();
  }, [due, wheel, mutateMe]);

  async function spin() {
    if (!ready || spinning) return;
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
      // Toujours un vrai tour de roue (le réglage de vitesse ne concerne que les paquets) ; mouvement réduit :
      // pas de tours, un court glissement jusqu'à la case gagnante.
      await animate(
        rotation,
        reduce ? end - 360 * Math.floor((end - current) / 360) : end,
        reduce ? { duration: 0.6, ease: [0.23, 1, 0.32, 1] } : { duration: 4.8, ease: [0.12, 0.72, 0.16, 1] },
      );
      setResult(res);
      void mutateMe((m) => (m ? { ...m, wallet: res.wallet, packs: res.packs, wheelReady: false } : m), {
        revalidate: false,
      });
      void wheel.mutate((w) => (w ? { ...w, ready: false, nextAt: res.nextAt } : w), { revalidate: false });
      if (res.reward.kind === "card") setTimeout(() => setRevealed(true), reduce ? 0 : 450);
      else play("coin");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "La roue est coincée, réessaie.");
      void wheel.mutate();
    } finally {
      setSpinning(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="page-title">Roue du jour</h1>
        <p className="hatnote mt-2">
          Un tour gratuit par jour, en plus du bonus de connexion. La roue revient à minuit (heure de Paris).
        </p>
      </div>

      {wheel.error && <ErrorBox error={wheel.error} retry={() => wheel.mutate()} />}

      <div className="grid items-start gap-8 md:grid-cols-[minmax(0,26rem)_minmax(0,22rem)] md:justify-center">
        <div className="flex flex-col items-center gap-5">
          <div className="relative w-[min(26rem,86vw)]">
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
              {segments.length ? (
                <motion.div className="size-full" style={{ transform }}>
                  <WheelFace segments={segments} />
                </motion.div>
              ) : (
                <div className="size-full animate-pulse rounded-full bg-panel" />
              )}
            </div>
          </div>

          <button
            type="button"
            className="btn btn-primary min-h-12 w-full max-w-xs text-base"
            onClick={spin}
            disabled={!ready || spinning || !me}
          >
            {spinning ? "La roue tourne…" : ready ? "Tourner la roue" : `Prochain tour dans ${countdown(wait)}`}
          </button>
        </div>

        <div className="flex flex-col gap-4">
          <section className="infobox" aria-live="polite">
            <h2 className="infobox-head">{shown ? "Gagné" : "Ton lot"}</h2>
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
                        +{label(shown.reward).big}
                        <span className="block text-[0.8rem] uppercase">{label(shown.reward).small}</span>
                      </span>
                    </span>
                    <p className="text-sm text-muted">
                      <strong className="text-text">{label(shown.reward).long}</strong>{" "}
                      {shown.reward.kind === "packs" ? (
                        <>
                          ajouté{shown.reward.amount > 1 ? "s" : ""} à ton stock.{" "}
                          <Link href="/pulls" className="article-link">
                            Les ouvrir
                          </Link>
                        </>
                      ) : (
                        "sur ton compte."
                      )}
                    </p>
                  </div>
                )
              ) : (
                <p className="text-sm text-muted">
                  {wheel.data?.ready === false
                    ? "Tu as déjà tourné la roue aujourd’hui. Reviens demain pour un nouveau tour."
                    : "Des points wiki, des paquets bonus, et parfois une ultra rare ou une légendaire."}
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
                          label(s.reward).long
                        )}
                      </td>
                      <td className="px-4 py-1.5 text-right text-muted">{pct(s.weight)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </section>
        </div>
      </div>
    </div>
  );
}
