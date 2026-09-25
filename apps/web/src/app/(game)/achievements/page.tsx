"use client";

import { Award, Lock } from "lucide-react";
import useSWR from "swr";
import { ErrorBox } from "@/components/ui";
import { fmt } from "@/lib/format";
import { useSocketEvent } from "@/lib/game";

interface Achievement {
  key: string;
  name: string;
  description: string;
  target: number;
  reward: { pw: number; packs: number };
  progress: number;
  unlockedAt: string | null;
}

const reward = (r: Achievement["reward"]) =>
  [r.pw ? `${fmt(r.pw)} PW` : "", r.packs ? `${r.packs} paquet${r.packs > 1 ? "s" : ""} bonus` : ""]
    .filter(Boolean)
    .join(" + ");

export default function AchievementsPage() {
  const { data, error, mutate } = useSWR<Achievement[]>("/achievements");
  useSocketEvent("notification:new", (n) => {
    if (n.type === "achievement") void mutate();
  });
  // Toute récompense (PW ou paquets) peut venir d'un succès, même si ses notifications sont coupées.
  useSocketEvent("wallet:update", () => void mutate());
  useSocketEvent("packs:update", () => void mutate());
  const unlocked = data?.filter((a) => a.unlockedAt).length ?? 0;
  const sorted = [...(data ?? [])].sort(
    (a, b) => Number(!!b.unlockedAt) - Number(!!a.unlockedAt) || b.progress / b.target - a.progress / a.target,
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="page-title">Succès</h1>
        <p className="hatnote mt-2 tnum">{data ? `${unlocked} succès débloqués sur ${data.length}.` : "Chargement…"}</p>
      </div>
      {error ? (
        <ErrorBox error={error} retry={() => mutate()} />
      ) : !data ? (
        <div className="h-72 animate-pulse rounded-xl bg-panel" />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {sorted.map((a) => {
            const done = !!a.unlockedAt;
            const pct = Math.round((Math.min(a.progress, a.target) / a.target) * 100);
            return (
              <li
                key={a.key}
                className={`flex gap-3 rounded-lg border bg-panel p-3 ${done ? "border-warn/50" : "border-line"}`}
              >
                <span
                  className={`grid size-10 shrink-0 place-items-center rounded-full border ${done ? "border-warn/60 text-warn" : "border-line-strong text-faint"}`}
                  aria-hidden
                >
                  {done ? <Award className="size-5" /> : <Lock className="size-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-display text-lg leading-tight">{a.name}</p>
                  <p className="text-sm text-muted">{a.description}</p>
                  {done ? (
                    <p className="mt-1.5 text-xs text-warn">
                      Débloqué le {new Date(a.unlockedAt!).toLocaleDateString("fr-FR")} · {reward(a.reward)}
                    </p>
                  ) : (
                    <>
                      <div
                        className="mt-2 h-1.5 overflow-hidden rounded-full bg-panel-2"
                        role="progressbar"
                        aria-valuenow={a.progress}
                        aria-valuemax={a.target}
                        aria-label={`Progression : ${a.name}`}
                      >
                        <div
                          className="h-full rounded-full bg-accent transition-[width] duration-300 ease-(--ease-out)"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <p className="tnum mt-1 flex justify-between text-xs text-faint">
                        <span>
                          {fmt(Math.min(a.progress, a.target))} / {fmt(a.target)}
                        </span>
                        <span>{reward(a.reward)}</span>
                      </p>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
