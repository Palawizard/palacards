"use client";

import { TIER_NAMES } from "@palacards/game";
import { Lock, Sparkles } from "lucide-react";
import useSWR from "swr";
import { ErrorBox } from "@/components/ui";
import { useSeenFeature } from "@/lib/features";
import { fmt } from "@/lib/format";
import { useSocketEvent } from "@/lib/game";

interface Achievement {
  key: string;
  family: string;
  tier: number;
  secret: boolean;
  name: string;
  description: string;
  target: number;
  reward: { pw: number; packs: number };
  progress: number;
  unlockedAt: string | null;
}

/** Médailles des paliers : bronze, argent, or, platine, diamant (jamais les couleurs de rareté). */
const MEDALS = ["#c98a4b", "#c3cad8", "#f2c53d", "#7fd3f5", "#e3c8ff"];

/** Grands thèmes de la page (chaque famille de paliers appartient à un thème). */
const GROUPS: { title: string; families: string[] }[] = [
  {
    title: "Collection",
    families: [
      "Paquets ouverts",
      "Boosters à thème",
      "Super rares",
      "Ultra rares",
      "Légendaires",
      "Brillantes",
      "Articles différents",
      "Légendaires différentes",
      "Ultra rares de la saison",
      "Abécédaire",
      "Niveau de carte",
      "Fusions",
      "Recyclage",
      "Upgrader",
      "Upgrades réussis",
    ],
  },
  {
    title: "Quotidien",
    families: [
      "Connexion",
      "Roue du jour",
      "Quêtes du jour",
      "Quêtes de la semaine",
      "Article du jour",
      "Du premier coup",
      "Passe de saison",
    ],
  },
  {
    title: "Bataille et boss",
    families: [
      "Duels joués",
      "Victoires",
      "Séries de victoires",
      "Elo",
      "Assauts de boss",
      "Boss vaincus",
      "Dégâts aux boss",
      "Meilleur assaillant",
    ],
  },
  {
    title: "Commerce et bande",
    families: ["Ventes", "Coups de marteau", "Record de vente", "Achats", "Échanges", "Amis", "Guilde"],
  },
];

const reward = (r: Achievement["reward"]) =>
  [r.pw ? `${fmt(r.pw)} PW` : "", r.packs ? `${r.packs} paquet${r.packs > 1 ? "s" : ""} bonus` : ""]
    .filter(Boolean)
    .join(" + ");

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"];

/**
 * Médaille d'un palier : son numéro (I, II, III…) se lit sans la couleur ; débloquée, elle est pleine
 * (bronze, argent, or, platine, diamant), à débloquer elle reste en pointillés.
 */
function Medal({ a, step }: { a: Achievement; step: number }) {
  const done = !!a.unlockedAt;
  const color = MEDALS[Math.min(a.tier, MEDALS.length - 1)];
  return (
    <span
      className={`grid h-5 min-w-5 shrink-0 place-items-center rounded-full border-2 px-0.5 font-display text-[0.7rem] leading-none ${
        done ? "" : "border-dashed border-line-strong text-faint"
      }`}
      style={done ? { background: color, borderColor: color, color: "#1d1407" } : undefined}
      title={`${TIER_NAMES[Math.min(a.tier, TIER_NAMES.length - 1)]} · ${a.name} : ${a.description} (${reward(a.reward)})`}
    >
      <span aria-hidden>{ROMAN[step] ?? step + 1}</span>
      <span className="sr-only">
        Palier {step + 1}, {a.name}, {done ? "débloqué" : "à débloquer"}
      </span>
    </span>
  );
}

/** Une famille de paliers : médailles en tête, puis le palier en cours avec sa progression. */
function Family({ name, tiers }: { name: string; tiers: Achievement[] }) {
  const next = tiers.find((a) => !a.unlockedAt);
  const done = tiers.filter((a) => a.unlockedAt).length;
  const shown = next ?? tiers.at(-1)!;
  const pct = Math.round((Math.min(shown.progress, shown.target) / shown.target) * 100);
  return (
    <li className={`flex flex-col gap-3 rounded-[14px] border bg-panel p-4 ${next ? "border-line" : "border-warn/50"}`}>
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-display text-xl uppercase leading-tight">{name}</h3>
        <span className="flex max-w-[55%] flex-wrap justify-end gap-0.5">
          {tiers.map((a, i) => (
            <Medal key={a.key} a={a} step={i} />
          ))}
        </span>
      </div>
      <div>
        <p className="font-semibold leading-snug">
          {shown.name}
          {!next && <span className="ml-2 text-xs font-semibold text-warn">Famille complète</span>}
        </p>
        <p className="text-sm text-muted">{shown.description}</p>
        {next ? (
          <>
            <div
              className="mt-2 h-1.5 overflow-hidden rounded-full bg-panel-2"
              role="progressbar"
              aria-valuenow={shown.progress}
              aria-valuemax={shown.target}
              aria-label={`Progression : ${shown.name}`}
            >
              <div
                className="h-full origin-left rounded-full bg-accent transition-transform duration-300 ease-(--ease-out)"
                style={{ transform: `scaleX(${pct / 100})` }}
              />
            </div>
            <p className="tnum mt-1 flex justify-between gap-3 text-xs text-faint">
              <span>
                {fmt(Math.min(shown.progress, shown.target))} / {fmt(shown.target)}
              </span>
              <span>{reward(shown.reward)}</span>
            </p>
          </>
        ) : (
          <p className="tnum mt-1 text-xs text-warn">
            {done} palier{done > 1 ? "s" : ""} · dernier le {new Date(shown.unlockedAt!).toLocaleDateString("fr-FR")}
          </p>
        )}
      </div>
    </li>
  );
}

export default function AchievementsPage() {
  useSeenFeature("achievements-v2");
  const { data, error, mutate } = useSWR<Achievement[]>("/achievements");
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
    return n ? n.progress / n.target : -1;
  };
  const grouped = GROUPS.map((g) => ({
    title: g.title,
    families: [...families].filter(([name]) => g.families.includes(name)).sort(([, a], [, b]) => ratio(b) - ratio(a)),
  }));
  const others = [...families].filter(([name]) => !GROUPS.some((g) => g.families.includes(name)));
  if (others.length) grouped.push({ title: "Autres", families: others });
  const secrets = data?.filter((a) => a.secret) ?? [];

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
      {error ? (
        <ErrorBox error={error} retry={() => mutate()} />
      ) : !data ? (
        <div className="h-72 animate-pulse rounded-xl bg-panel" />
      ) : (
        <>
          {grouped.map((g, gi) => (
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
                  <Family key={name} name={name} tiers={tiers} />
                ))}
              </ul>
            </section>
          ))}
          <section aria-labelledby="secrets-title">
            <h2 id="secrets-title" className="section-title">
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
        </>
      )}
    </div>
  );
}
