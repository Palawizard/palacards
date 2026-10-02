"use client";

import type { PassDTO, QuestDTO, QuestsDTO } from "@palacards/shared";
import { ArrowRight, Check, Package, Shuffle } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { ErrorBox } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { fmt, timeLeft } from "@/lib/format";
import { useSeenFeature } from "@/lib/features";
import { useMe, useSocketEvent } from "@/lib/game";
import { play } from "@/lib/sfx";
import { useNow } from "@/lib/use-now";
import "@/components/content.css";

const TIER_LABEL: Record<QuestDTO["tier"], string> = {
  easy: "Facile",
  medium: "Moyenne",
  hard: "Difficile",
  weekly: "Semaine",
};

const rewardText = (r: { pw: number; packs: number }) =>
  [r.pw ? `${fmt(r.pw)} PW` : "", r.packs ? `${r.packs} paquet${r.packs > 1 ? "s" : ""}` : ""]
    .filter(Boolean)
    .join(" + ");

/**
 * Une quête = un emplacement de tampon : cercle en pointillés tant qu'elle avance, tampon encré quand
 * elle est faite. La barre fine suit la progression.
 */
function QuestStamp({
  quest,
  canReroll,
  onReroll,
  big = false,
}: {
  quest: QuestDTO;
  canReroll: boolean;
  onReroll?: () => void;
  big?: boolean;
}) {
  const done = !!quest.completedAt;
  const pct = Math.round((Math.min(quest.progress, quest.target) / quest.target) * 100);
  return (
    <li
      className={`pc-quest relative flex items-center gap-3.5 rounded-[14px] border bg-panel p-3.5 sm:gap-4 sm:p-4 ${
        done ? "border-accent/50" : "border-line"
      } ${big ? "sm:p-5" : ""}`}
      data-done={done || undefined}
    >
      <span className={`pc-stamp-slot ${big ? "size-16 sm:size-20" : "size-14 sm:size-16"}`} aria-hidden>
        {done ? (
          <span className="pc-stamp-ink">
            <Check className="size-[45%]" strokeWidth={3.5} />
          </span>
        ) : (
          <span className="font-display text-[0.7rem] uppercase leading-none text-faint">{TIER_LABEL[quest.tier]}</span>
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className={`font-semibold leading-snug ${big ? "text-lg" : ""}`}>{quest.label}</p>
        <div
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-line"
          role="progressbar"
          aria-valuenow={quest.progress}
          aria-valuemax={quest.target}
          aria-label={`Progression : ${quest.label}`}
        >
          <div
            className="h-full origin-left rounded-full bg-accent transition-transform duration-500 ease-(--ease-out)"
            style={{ transform: `scaleX(${pct / 100})` }}
          />
        </div>
        <p className="tnum mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted">
          <span>
            {fmt(Math.min(quest.progress, quest.target))} / {fmt(quest.target)}
          </span>
          <span className={done ? "font-semibold text-highlight" : ""}>
            +{fmt(quest.reward.pw)} PW · +{fmt(quest.reward.xp)} XP
          </span>
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        {!done && (
          <Link
            href={quest.href}
            className="btn btn-sm btn-ghost px-2.5"
            aria-label={`Aller faire : ${quest.label}`}
            title="Y aller"
          >
            <ArrowRight className="size-4" />
          </Link>
        )}
        {!done && canReroll && onReroll && (
          <button
            type="button"
            className="btn btn-sm btn-ghost px-2.5 text-muted"
            onClick={onReroll}
            aria-label={`Changer la quête : ${quest.label}`}
            title="Changer cette quête (une fois par jour)"
          >
            <Shuffle className="size-4" />
          </button>
        )}
      </div>
    </li>
  );
}

/**
 * La carte de fidélité de la saison : 100 cases à tamponner, une par niveau du passe. Les cases atteintes
 * portent leur tampon (paquets ou PW), les dizaines un gros tampon or ; la prochaine case est entourée.
 */
function LoyaltyCard({ pass }: { pass: PassDTO }) {
  const prevLevel = useRef(pass.level);
  const [fresh, setFresh] = useState<Set<number>>(new Set());
  useEffect(() => {
    if (pass.level > prevLevel.current) {
      const gained = new Set<number>();
      for (let n = prevLevel.current + 1; n <= pass.level; n++) gained.add(n);
      setFresh(gained);
      play("achievement");
    }
    prevLevel.current = pass.level;
  }, [pass.level]);
  const next = pass.levels[pass.level];
  const pct = pass.need ? Math.round((pass.into / pass.need) * 100) : 100;

  return (
    <section
      aria-labelledby="pass-title"
      className="pc-loyalty cover-texture rounded-[18px] bg-cover p-4 text-cover-ink sm:p-6"
    >
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <h2 id="pass-title" className="font-display text-[1.7rem] uppercase leading-none sm:text-[2.1rem]">
            Carte de saison <span className="text-accent">{pass.season}</span>
          </h2>
          <p className="mt-1.5 text-sm text-cover-muted">
            Un tampon par niveau, cent cases. La carte repart à zéro à chaque nouvelle saison.
          </p>
        </div>
        <div className="text-right">
          <p className="font-display text-[3rem] uppercase leading-[0.85] sm:text-[3.6rem]">
            <span className="sr-only">Niveau </span>
            {pass.level}
            <span className="text-[1.2rem] text-cover-muted">/{pass.maxLevel}</span>
          </p>
        </div>
      </div>

      <div className="mt-4">
        <div className="h-2.5 overflow-hidden rounded-full bg-black/25" aria-hidden>
          <div
            className="h-full origin-left rounded-full bg-accent transition-transform duration-500 ease-(--ease-out)"
            style={{ transform: `scaleX(${pct / 100})` }}
          />
        </div>
        <p className="tnum mt-1.5 flex flex-wrap justify-between gap-2 text-xs text-cover-muted">
          <span>
            {pass.need
              ? `${fmt(pass.into)} / ${fmt(pass.need)} XP vers le niveau ${pass.level + 1}`
              : "Carte complète !"}
          </span>
          {next && <span>Prochain tampon : {rewardText(next.reward)}</span>}
        </p>
      </div>

      <ol className="pc-loyalty-grid mt-5" aria-label="Niveaux du passe de saison">
        {pass.levels.map(({ level, reward }) => {
          const reached = level <= pass.level;
          const milestone = level % 10 === 0;
          const label = `Niveau ${level} : ${rewardText(reward)}${reached ? " (obtenu)" : ""}`;
          return (
            <li
              key={level}
              className="pc-loyalty-cell"
              data-reached={reached || undefined}
              data-next={level === pass.level + 1 || undefined}
              data-milestone={milestone || undefined}
              data-fresh={fresh.has(level) || undefined}
              title={label}
              aria-label={label}
            >
              {reached ? (
                <span className="pc-loyalty-ink" aria-hidden>
                  {milestone ? (
                    <span className="font-display text-[0.95em] leading-none">{level}</span>
                  ) : reward.packs ? (
                    <Package className="size-[55%]" strokeWidth={2.5} />
                  ) : (
                    <span className="text-[0.62em] font-black leading-none">PW</span>
                  )}
                </span>
              ) : (
                <span className="tnum text-[0.68em] font-semibold" aria-hidden>
                  {level}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export default function QuestsPage() {
  useSeenFeature("quests");
  const { mutateMe } = useMe();
  const quests = useSWR<QuestsDTO>("/quests");
  const pass = useSWR<PassDTO>("/pass");
  const [busy, setBusy] = useState(false);
  const now = useNow(30_000);
  useSocketEvent("progress:update", () => {
    void quests.mutate();
    void pass.mutate();
  });

  async function reroll(slot: number) {
    if (busy) return;
    setBusy(true);
    try {
      await quests.mutate(await api<QuestsDTO>(`/quests/${slot}/reroll`, { method: "POST" }), { revalidate: false });
      void mutateMe();
      toast.success("Nouvelle quête !");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Impossible de changer la quête.");
    } finally {
      setBusy(false);
    }
  }

  const q = quests.data;
  const doneToday = q?.daily.filter((x) => x.completedAt).length ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="page-title">Quêtes et passe</h1>
        <p className="hatnote mt-2">
          Trois quêtes par jour, une par semaine : des PW et de l&apos;XP de saison. Chaque paquet ouvert, chaque
          article trouvé et chaque assaut contre le boss font aussi monter ta carte.
        </p>
      </div>

      {quests.error ? (
        <ErrorBox error={quests.error} retry={() => quests.mutate()} />
      ) : !q ? (
        <div className="h-64 animate-pulse rounded-xl bg-panel" />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
          <section aria-labelledby="daily-title">
            <h2 id="daily-title" className="section-title !mt-0">
              Tampons du jour
              <span className="tnum font-sans text-sm font-semibold normal-case text-muted [font-stretch:100%]">
                {doneToday}/3
              </span>
            </h2>
            <ul className="flex flex-col gap-2.5">
              {q.daily.map((quest) => (
                <QuestStamp
                  key={quest.slot}
                  quest={quest}
                  canReroll={q.rerollAvailable && !busy}
                  onReroll={() => void reroll(quest.slot)}
                />
              ))}
            </ul>
            <p className="tnum mt-2 text-xs text-faint">
              Nouvelles quêtes dans {timeLeft(new Date(q.resetsAt).getTime() - now)}.
              {q.rerollAvailable ? " Tu peux en changer une aujourd'hui." : " Changement du jour utilisé."}
            </p>
          </section>
          {q.weekly && (
            <section aria-labelledby="weekly-title">
              <h2 id="weekly-title" className="section-title !mt-0">
                Tampon de la semaine
              </h2>
              <ul>
                <QuestStamp quest={q.weekly} canReroll={false} big />
              </ul>
              <p className="tnum mt-2 text-xs text-faint">
                La même pour tout le monde, jusqu&apos;à lundi : encore{" "}
                {timeLeft(new Date(q.weeklyResetsAt).getTime() - now)}.
              </p>
            </section>
          )}
        </div>
      )}

      {pass.error ? (
        <ErrorBox error={pass.error} retry={() => pass.mutate()} />
      ) : !pass.data ? (
        <div className="h-96 animate-pulse rounded-[18px] bg-cover/60" />
      ) : (
        <>
          <LoyaltyCard pass={pass.data} />
          <section aria-labelledby="xp-title" className="infobox">
            <h2 id="xp-title" className="infobox-head">
              Gagner de l&apos;XP
            </h2>
            <dl className="grid grid-cols-1 gap-x-8 px-4 py-3 text-sm sm:grid-cols-2">
              {pass.data.xpTable.map((row) => (
                <div key={row.label} className="flex justify-between gap-3 border-b border-dashed border-line py-1.5">
                  <dt className="text-muted">{row.label}</dt>
                  <dd className="tnum font-semibold">+{fmt(row.xp)} XP</dd>
                </div>
              ))}
            </dl>
          </section>
        </>
      )}
    </div>
  );
}
