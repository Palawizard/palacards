"use client";

import { Lock, Search, Sparkles } from "lucide-react";
import { useState } from "react";
import useSWR from "swr";
import { Family, fold, GROUPS, matches, reward, TiersDialog, type Achievement } from "@/components/Achievements";
import { CommunityGoal } from "@/components/CommunityGoal";
import { Empty, ErrorBox } from "@/components/ui";
import { useSeenFeature } from "@/lib/features";
import { fmt } from "@/lib/format";
import { useSocketEvent } from "@/lib/game";

export default function AchievementsPage() {
  useSeenFeature("achievements-v2");
  const { data, error, mutate } = useSWR<Achievement[]>("/achievements");
  const [detail, setDetail] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const q = fold(query);
  useSocketEvent("progress:update", () => void mutate());
  useSocketEvent("notification:new", (n) => {
    if (n.type.startsWith("achievement")) void mutate();
  });
  const unlocked = data?.filter((a) => a.unlockedAt) ?? [];
  const earned = unlocked.reduce((s, a) => s + a.reward.pw, 0);

  const families = new Map<string, Achievement[]>();
  for (const a of data ?? []) if (!a.secret) families.set(a.family, [...(families.get(a.family) ?? []), a]);
  // Dans chaque thème, les familles presque finies d'abord : le prochain palier à portée de main.
  const ratio = (list: Achievement[]) => {
    const n = list.find((x) => !x.unlockedAt);
    return n ? (n.progress ?? 0) / n.target : -1;
  };
  // Recherche : une famille reste si son nom ou l'un de ses paliers (nom, description) contient le texte.
  const found = [...families].filter(
    ([name, tiers]) => !q || fold(name).includes(q) || tiers.some((a) => matches(a, q)),
  );
  const grouped = GROUPS.map((g) => ({
    title: g.title,
    families: found.filter(([name]) => g.families.includes(name)).sort(([, a], [, b]) => ratio(b) - ratio(a)),
  }));
  const others = found.filter(([name]) => !GROUPS.some((g) => g.families.includes(name)));
  if (others.length) grouped.push({ title: "Autres", families: others });
  // Les secrets pas encore débloqués arrivent masqués du serveur : la recherche n'en dévoile rien.
  const allSecrets = data?.filter((a) => a.secret) ?? [];
  const secrets = allSecrets.filter((a) => !q || matches(a, q));
  const results = found.length + secrets.length;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="page-title">Succès</h1>
        <p className="hatnote tnum mt-2">
          {data
            ? `${unlocked.length} succès débloqués sur ${data.length}, ${fmt(earned)} PW gagnés. Chaque famille a plusieurs paliers, de bronze à diamant.`
            : "Chargement…"}
        </p>
      </div>
      <CommunityGoal />
      {error ? (
        <ErrorBox error={error} retry={() => mutate()} />
      ) : !data ? (
        <div className="h-72 animate-pulse rounded-xl bg-panel" />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <form role="search" className="relative min-w-60 flex-1 sm:max-w-md" onSubmit={(e) => e.preventDefault()}>
              <Search
                aria-hidden
                className="pointer-events-none absolute left-3 top-1/2 size-[1.1rem] -translate-y-1/2 text-faint"
              />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Duels, brillantes, boss…"
                aria-label="Chercher un succès par son nom ou sa description"
                className="field h-11 pl-10 text-base"
              />
            </form>
            <p className="tnum text-sm text-muted" aria-live="polite">
              {q ? `${results} résultat${results > 1 ? "s" : ""}` : ""}
            </p>
          </div>
          {q && results === 0 && (
            <Empty title="Aucun succès ne correspond">
              <p>Rien pour «&nbsp;{query.trim()}&nbsp;» dans les noms et les descriptions.</p>
              <button type="button" className="btn btn-sm btn-ghost mt-3" onClick={() => setQuery("")}>
                Effacer la recherche
              </button>
            </Empty>
          )}
          {grouped
            .filter((g) => g.families.length)
            .map((g, gi) => (
              <section key={g.title} aria-labelledby={`group-${gi}`}>
                <h2 id={`group-${gi}`} className={`section-title ${gi === 0 ? "!mt-0" : ""}`}>
                  {g.title}
                  <span className="tnum font-sans text-sm font-semibold normal-case text-muted [font-stretch:100%]">
                    {g.families.flatMap(([, t]) => t).filter((a) => a.unlockedAt).length}/
                    {g.families.flatMap(([, t]) => t).length}
                  </span>
                </h2>
                <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {g.families.map(([name, tiers]) => (
                    <Family key={name} name={name} tiers={tiers} q={q} onOpen={() => setDetail(name)} />
                  ))}
                </ul>
              </section>
            ))}
          <TiersDialog name={detail} tiers={(detail && families.get(detail)) || []} onClose={() => setDetail(null)} />
          {secrets.length > 0 && (
            <section aria-labelledby="secrets-title">
              <h2 id="secrets-title" className={`section-title ${found.length ? "" : "!mt-0"}`}>
                Succès secrets
                <span className="tnum font-sans text-sm font-semibold normal-case text-muted [font-stretch:100%]">
                  {secrets.filter((s) => s.unlockedAt).length}/{secrets.length}
                </span>
              </h2>
              <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {secrets.map((s) => (
                  <li
                    key={s.key}
                    className={`flex items-center gap-3 rounded-[14px] border p-3 ${s.unlockedAt ? "border-warn/50 bg-panel" : "slot"}`}
                  >
                    <span
                      className={`grid size-9 shrink-0 place-items-center rounded-full ${s.unlockedAt ? "bg-accent text-accent-ink" : "border border-line-strong text-faint"}`}
                      aria-hidden
                    >
                      {s.unlockedAt ? <Sparkles className="size-4" /> : <Lock className="size-4" />}
                    </span>
                    <div className="min-w-0">
                      <p className="font-semibold leading-tight">{s.name}</p>
                      <p className="text-sm text-muted">{s.description}</p>
                      {s.unlockedAt && <p className="tnum text-xs text-warn">{reward(s.reward)}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
