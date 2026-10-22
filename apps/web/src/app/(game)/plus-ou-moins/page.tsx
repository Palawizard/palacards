"use client";

import { HL_REVEAL_MS, HL_REWARD_CAP, hlReward } from "@palacards/game";
import type { HlAnswerDTO, HlArticleDTO, HlPairDTO, HlStateDTO } from "@palacards/shared";
import { Check, Clock, Copy, Eye, Flame, Trophy, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { ErrorBox } from "@/components/ui";
import { api, ApiError, SITE_URL, thumbSrc } from "@/lib/api";
import { useSeenFeature } from "@/lib/features";
import { countdown, fmt } from "@/lib/format";
import { useMe } from "@/lib/game";
import { play } from "@/lib/sfx";
import { useNow } from "@/lib/use-now";
import "@/components/content.css";

const NBSP = String.fromCharCode(160);
const EASE_OUT = [0.23, 1, 0.32, 1] as const;

type Side = "kept" | "challenger";

/** Vues en toutes lettres (« 1 234 567 vues »). */
const views = (n: number) => `${fmt(n)}${NBSP}vue${n > 1 ? "s" : ""}`;

/**
 * Un article de la paire : image, titre, description courte. Jamais de rareté (cadre, couleur ou badge) :
 * elle vient des vues et rendrait le jeu trivial. Les vues n'apparaissent qu'après la réponse.
 */
function ArticleChoice({
  article,
  side,
  revealed,
  winner,
  disabled,
  onPick,
}: {
  article: HlArticleDTO;
  side: Side;
  revealed: number | null;
  winner: boolean | null;
  disabled: boolean;
  onPick: (side: Side) => void;
}) {
  // Vignette introuvable : l'initiale du titre, comme une carte sans image.
  const [broken, setBroken] = useState(false);
  return (
    <button
      type="button"
      onClick={() => onPick(side)}
      disabled={disabled}
      aria-label={`${article.title}${revealed !== null ? ` : ${views(revealed)}` : " : le plus vu ?"}`}
      className={`group relative flex min-h-0 w-full flex-col overflow-hidden rounded-2xl border-2 bg-panel text-left shadow-[var(--shadow-lift)] transition-[transform,border-color] duration-150 ease-(--ease-out) active:scale-[0.98] disabled:active:scale-100 pointer-fine:hover:enabled:border-line-strong ${
        winner === true ? "border-good" : winner === false ? "border-danger" : "border-line"
      }`}
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-panel-2">
        {article.thumbUrl && !broken ? (
          // eslint-disable-next-line @next/next/no-img-element -- vignettes Wikimedia relayées par l'API
          <img
            src={thumbSrc(article.thumbUrl)}
            alt=""
            className="size-full object-cover"
            decoding="async"
            onError={() => setBroken(true)}
          />
        ) : (
          <span className="grid size-full place-items-center font-display text-5xl uppercase text-faint">
            {article.title.slice(0, 1)}
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3 sm:p-4">
        <p className="font-display text-xl uppercase leading-tight text-text sm:text-2xl">{article.title}</p>
        {article.description && <p className="line-clamp-2 text-sm text-muted">{article.description}</p>}
        <p className="tnum mt-auto pt-2 text-base font-bold" aria-live="polite">
          {revealed !== null ? (
            <span className={winner ? "text-good" : "text-text"}>{views(revealed)}</span>
          ) : (
            <span className="text-faint">? vues sur 12 mois</span>
          )}
        </p>
      </div>
    </button>
  );
}

/** Chrono de 15 s calé sur le temps restant envoyé par le serveur (qui tranche de toute façon). */
function Timer({ pair }: { pair: HlPairDTO }) {
  const reduce = useReducedMotion();
  // Une instance par paire (clé du parent) : l'échéance locale est fixée à l'arrivée de la paire.
  const [end] = useState(() => Date.now() + pair.msLeft);
  const now = useNow(250);
  const left = Math.max(0, end - now);
  const ratio = Math.min(1, left / pair.durationMs);
  const urgent = left < 5_000;
  return (
    <div className="flex items-center gap-3" aria-label={`Temps restant : ${Math.ceil(left / 1000)} secondes`}>
      <Clock aria-hidden className={`size-4 shrink-0 ${urgent ? "text-danger" : "text-muted"}`} />
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-panel-2" aria-hidden>
        <div
          className={`h-full origin-left rounded-full ${urgent ? "bg-danger" : "bg-accent"} ${reduce ? "" : "transition-transform duration-200 ease-linear"}`}
          style={{ transform: `scaleX(${ratio})` }}
        />
      </div>
      <span className={`tnum w-8 text-right text-sm font-bold ${urgent ? "text-danger" : "text-text"}`} aria-hidden>
        {Math.ceil(left / 1000)}
      </span>
    </div>
  );
}

/**
 * « Plus ou moins vu » : lequel des deux articles a eu le plus de vues sur 12 mois ? 3 essais par jour, 15 s par
 * choix. Bonne réponse : l'article le plus vu reste, un nouveau arrive en face. Le serveur garde la paire et
 * les vues : rien ne se joue côté navigateur.
 */
export default function HigherLowerPage() {
  useSeenFeature("plus-ou-moins");
  const reduce = useReducedMotion();
  const { mutateMe } = useMe();
  const { data, error, mutate } = useSWR<HlStateDTO>("/hl");
  /** Réponse en cours de révélation : la paire jouée et les vues. Fin d'essai : reste affichée. */
  const [reveal, setReveal] = useState<{ pair: HlPairDTO; res: HlAnswerDTO } | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const now = useNow(1000);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const pair = reveal?.pair ?? data?.current ?? null;
  const resetIn = data ? new Date(data.resetsAt).getTime() - now : 0;
  const over = reveal && !reveal.res.next ? reveal.res : null;
  const playing = !!data?.current || !!reveal?.res.next;

  async function start() {
    if (busy) return;
    setBusy(true);
    try {
      const state = await api<HlStateDTO>("/hl/start", { method: "POST" });
      setReveal(null);
      void mutate(state, { revalidate: false });
      void mutateMe();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Impossible de lancer un essai.");
      void mutate();
    } finally {
      setBusy(false);
    }
  }

  async function pick(side: Side) {
    const current = data?.current;
    if (!current || busy || reveal) return;
    setBusy(true);
    try {
      const res = await api<HlAnswerDTO>("/hl/answer", { body: { step: current.step, pick: side } });
      setReveal({ pair: current, res });
      play(res.correct ? "correct" : "wrong");
      if (res.reward) play("coin");
      if (res.next) {
        // Vues révélées un instant, puis la paire suivante.
        // Le serveur a compté la révélation dans l'échéance : le chrono local part à l'affichage de la paire.
        timer.current = setTimeout(() => {
          setReveal(null);
          const cur = res.state.current;
          void mutate(
            { ...res.state, current: cur && { ...cur, msLeft: Math.max(0, cur.msLeft - HL_REVEAL_MS) } },
            { revalidate: false },
          );
        }, HL_REVEAL_MS);
      } else {
        void mutate(res.state, { revalidate: false });
        void mutateMe();
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Réponse impossible.");
      setReveal(null);
      void mutate();
    } finally {
      setBusy(false);
    }
  }

  async function share() {
    if (!data?.share) return;
    try {
      await navigator.clipboard.writeText(`${data.share}\n${SITE_URL}/plus-ou-moins`);
      toast.success("Copié : colle-le à tes potes !");
    } catch {
      toast.error("Copie impossible sur ce navigateur.");
    }
  }

  if (error) return <ErrorBox error={error} retry={() => mutate()} />;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="page-title">Plus ou moins vu</h1>
        <p className="hatnote mt-2">
          Lequel de ces deux articles a eu le plus de vues sur Wikipédia ces 12 derniers mois{NBSP}? Bonne réponse{NBSP}
          : ta série monte et le plus vu reste face à un nouvel article, de plus en plus proche. Une erreur, ou 15
          secondes sans répondre, et l’essai s’arrête. 3 essais par jour, jusqu’à {fmt(hlReward(HL_REWARD_CAP))}
          {NBSP}PW par essai.
        </p>
      </div>

      {!data ? (
        <div className="h-96 animate-pulse rounded-xl bg-panel" aria-hidden />
      ) : (
        <>
          <div className="tnum flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-muted">
            <span className="inline-flex items-center gap-1.5">
              <Flame aria-hidden className="size-4" />
              Essais restants{NBSP}: <strong className="text-text">{data.triesLeft}</strong> / {data.maxTries}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Trophy aria-hidden className="size-4" />
              Record{NBSP}: <strong className="text-text">{data.best}</strong>
            </span>
            {data.earnedToday > 0 && (
              <span>
                Gagné aujourd’hui{NBSP}: <strong className="text-text">{fmt(data.earnedToday)}</strong>
                {NBSP}PW
              </span>
            )}
          </div>

          {pair && (
            <section className="infobox" aria-label="Essai en cours">
              <div className="flex flex-col gap-4 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <p className="tnum">
                    Essai {pair.tryNo} · série{" "}
                    <strong className="text-text">{reveal ? reveal.res.streak : pair.streak}</strong>
                  </p>
                  {!reveal && (
                    <p className="tnum text-muted">
                      En jeu{NBSP}: {fmt(pair.reward)}
                      {NBSP}PW → {fmt(pair.nextReward)}
                      {NBSP}PW si tu as raison
                    </p>
                  )}
                </div>
                {!reveal && <Timer key={`${pair.tryNo}-${pair.step}`} pair={pair} />}
                <AnswerBoard pair={pair} res={reveal?.res ?? null} busy={busy} onPick={pick} reduce={!!reduce} />
                <p className="sr-only" aria-live="assertive">
                  {reveal
                    ? reveal.res.timeout
                      ? "Temps écoulé."
                      : reveal.res.correct
                        ? "Bonne réponse !"
                        : "Raté."
                    : ""}
                </p>
              </div>
            </section>
          )}

          <AnimatePresence initial={false}>
            {over && (
              <motion.section
                key="over"
                className="infobox"
                aria-label="Fin de l’essai"
                initial={reduce ? { opacity: 0 } : { opacity: 0, transform: "translateY(8px)" }}
                animate={{ opacity: 1, transform: "translateY(0px)" }}
                transition={{ duration: 0.24, ease: EASE_OUT }}
              >
                <div className="flex flex-col gap-1 p-4">
                  <p className="font-display text-2xl uppercase">
                    {over.timeout ? "Temps écoulé" : over.correct ? "Plus d’article à comparer" : "Raté"}
                  </p>
                  <p className="tnum text-sm text-muted">
                    Série de <strong className="text-text">{over.streak}</strong>
                    {over.reward ? ` · +${fmt(over.reward)}${NBSP}PW` : " · pas de PW cette fois"}
                  </p>
                </div>
              </motion.section>
            )}
          </AnimatePresence>

          {!playing &&
            (data.triesLeft > 0 ? (
              <button
                type="button"
                className="btn btn-primary min-w-56 self-start max-sm:w-full max-sm:self-stretch"
                disabled={busy}
                onClick={start}
              >
                {data.runs.length
                  ? `Essai suivant (${data.triesLeft} restant${data.triesLeft > 1 ? "s" : ""})`
                  : "Jouer"}
              </button>
            ) : (
              <p className="text-sm text-muted">
                Tes 3 essais du jour sont joués. Nouveaux essais dans{" "}
                <strong className="tnum text-text">{countdown(Math.max(0, resetIn))}</strong>.
              </p>
            ))}

          {data.runs.length > 0 && (
            <section className="infobox" aria-labelledby="hl-day">
              <h2 id="hl-day" className="infobox-head">
                Ta journée
              </h2>
              <div className="flex flex-col gap-3 p-4">
                <ol className="tnum flex flex-wrap gap-2 text-sm">
                  {data.runs.map((r) => (
                    <li key={r.tryNo} className="rounded-lg border border-line px-3 py-2">
                      Essai {r.tryNo}
                      {NBSP}: série <strong className="text-text">{r.streak}</strong>
                      <span className="text-muted">
                        {r.reward ? ` · +${fmt(r.reward)}${NBSP}PW` : ""}
                        {r.endReason === "timeout" ? " · temps écoulé" : ""}
                      </span>
                    </li>
                  ))}
                </ol>
                <p className="tnum text-sm text-muted">
                  Meilleure série du jour{NBSP}: <strong className="text-text">{data.todayBest}</strong> · série record
                  {NBSP}: <strong className="text-text">{data.best}</strong> · {fmt(data.totalWins)} réussites en tout
                </p>
                {data.share && (
                  <div className="flex flex-col gap-2">
                    <pre className="pc-share whitespace-pre-wrap text-left text-sm" aria-label="Ton résumé à partager">
                      {data.share}
                    </pre>
                    <button type="button" className="btn self-start" onClick={share}>
                      <Copy aria-hidden className="size-4" />
                      Copier le résumé
                    </button>
                  </div>
                )}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

/** Les deux articles côte à côte, avec les vues une fois la réponse donnée. */
function AnswerBoard({
  pair,
  res,
  busy,
  onPick,
  reduce,
}: {
  pair: HlPairDTO;
  res: HlAnswerDTO | null;
  busy: boolean;
  onPick: (side: Side) => void;
  reduce: boolean;
}) {
  const higher: Side | null = res
    ? res.reveal.kept.views > res.reveal.challenger.views
      ? "kept"
      : "challenger"
    : null;
  const sides: Side[] = ["kept", "challenger"];
  return (
    <div className="relative mx-auto grid w-full max-w-3xl grid-cols-2 gap-3 sm:gap-5">
      {sides.map((side) => (
        <motion.div
          key={`${pair.tryNo}-${pair.step}-${side}`}
          initial={
            side === "challenger" && !reduce && pair.step > 0 ? { opacity: 0, transform: "translateX(12px)" } : false
          }
          animate={{ opacity: 1, transform: "translateX(0px)" }}
          transition={{ duration: 0.24, ease: EASE_OUT }}
          className="flex"
        >
          <ArticleChoice
            article={pair[side]}
            side={side}
            revealed={res ? res.reveal[side].views : null}
            winner={res ? side === higher : null}
            disabled={busy || !!res}
            onPick={onPick}
          />
        </motion.div>
      ))}
      <span
        aria-hidden
        className="absolute left-1/2 top-[min(28vw,8.5rem)] grid size-10 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-line bg-panel text-muted shadow-[var(--shadow-lift)] sm:size-12"
      >
        {res ? (
          res.correct ? (
            <Check className="size-5 text-good" strokeWidth={3} />
          ) : (
            <X className="size-5 text-danger" strokeWidth={3} />
          )
        ) : (
          <Eye className="size-5" />
        )}
      </span>
    </div>
  );
}
