"use client";

import { SUGGESTION_FAMILY, TIER_NAMES } from "@palacards/game";
import { Check, Lock, Search, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { Empty, ErrorBox, MEDALS } from "@/components/ui";
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
  reward: { pw: number; packs: number; badge?: string };
  progress: number;
  unlockedAt: string | null;
}

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
  { title: "Communauté", families: [SUGGESTION_FAMILY] },
];

const reward = (r: Achievement["reward"]) =>
  [
    r.pw ? `${fmt(r.pw)} PW` : "",
    r.packs ? `${r.packs} paquet${r.packs > 1 ? "s" : ""} bonus` : "",
    r.badge ? "Badge de profil" : "",
  ]
    .filter(Boolean)
    .join(" + ");

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"];

/** Recherche sans accents ni majuscules : « legendaire » trouve « Légendaires ». */
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
const matches = (a: Achievement, q: string) => fold(`${a.name} ${a.description}`).includes(q);

/**
 * Médaille d'un palier : son numéro (I, II, III…) se lit sans la couleur ; débloquée, elle est pleine
 * (bronze, argent, or, platine, diamant), à débloquer elle reste en pointillés.
 */
function Medal({ a, step, large = false }: { a: Achievement; step: number; large?: boolean }) {
  const done = !!a.unlockedAt;
  const color = MEDALS[Math.min(a.tier, MEDALS.length - 1)];
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-full border-2 font-display leading-none ${
        large ? "size-9 text-base" : "h-5 min-w-5 px-0.5 text-[0.7rem]"
      } ${done ? "" : "border-dashed border-line-strong text-faint"}`}
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

/** Barre de progression du palier en cours. */
function Progress({ a }: { a: Achievement }) {
  const pct = Math.round((Math.min(a.progress, a.target) / a.target) * 100);
  return (
    <div
      className="mt-2 h-1.5 overflow-hidden rounded-full bg-panel-2"
      role="progressbar"
      aria-valuenow={a.progress}
      aria-valuemax={a.target}
      aria-label={`Progression : ${a.name}`}
    >
      <div
        className="h-full origin-left rounded-full bg-accent transition-transform duration-300 ease-(--ease-out)"
        style={{ transform: `scaleX(${pct / 100})` }}
      />
    </div>
  );
}

const date = (iso: string) => new Date(iso).toLocaleDateString("fr-FR");

/**
 * Une famille de paliers : médailles en tête (elles ouvrent le détail), puis le palier en cours.
 * Pendant une recherche, si le texte n'est trouvé que dans un autre palier, une ligne le montre.
 */
function Family({ name, tiers, q, onOpen }: { name: string; tiers: Achievement[]; q: string; onOpen: () => void }) {
  const next = tiers.find((a) => !a.unlockedAt);
  const done = tiers.filter((a) => a.unlockedAt).length;
  const shown = next ?? tiers.at(-1)!;
  const hit = q && !fold(name).includes(q) && !matches(shown, q) ? tiers.findIndex((a) => matches(a, q)) : -1;
  return (
    <li className={`flex flex-col gap-3 rounded-[14px] border bg-panel p-4 ${next ? "border-line" : "border-warn/50"}`}>
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-display text-xl uppercase leading-tight">{name}</h3>
        <button
          type="button"
          onClick={onOpen}
          aria-haspopup="dialog"
          aria-label={`Voir les ${tiers.length} paliers de la famille ${name}`}
          title="Voir le détail des paliers"
          className="-m-1.5 flex max-w-[55%] flex-wrap justify-end gap-0.5 rounded-full p-1.5 transition-[background-color,transform] duration-150 ease-(--ease-out) hover:bg-panel-2 active:scale-[0.97]"
        >
          {tiers.map((a, i) => (
            <Medal key={a.key} a={a} step={i} />
          ))}
        </button>
      </div>
      <div>
        <p className="font-semibold leading-snug">
          {shown.name}
          {!next && <span className="ml-2 text-xs font-semibold text-warn">Famille complète</span>}
        </p>
        <p className="text-sm text-muted">{shown.description}</p>
        {next ? (
          <>
            <Progress a={shown} />
            <p className="tnum mt-1 flex justify-between gap-3 text-xs text-faint">
              <span>
                {fmt(Math.min(shown.progress, shown.target))} / {fmt(shown.target)}
              </span>
              <span>{reward(shown.reward)}</span>
            </p>
          </>
        ) : (
          <p className="tnum mt-1 text-xs text-warn">
            {done} palier{done > 1 ? "s" : ""} · dernier le {date(shown.unlockedAt!)}
          </p>
        )}
        {hit >= 0 && (
          <p className="mt-2 border-t border-dashed border-line pt-2 text-xs text-muted">
            <span className="font-semibold text-text">Trouvé au palier {ROMAN[hit] ?? hit + 1}&nbsp;:</span>{" "}
            {tiers[hit]!.name} · {tiers[hit]!.description}
          </p>
        )}
      </div>
    </li>
  );
}

/** Un palier dans le détail : obtenu (coche, date), en cours (progression) ou à venir (objectif). */
function TierRow({ a, step, current }: { a: Achievement; step: number; current: boolean }) {
  const done = !!a.unlockedAt;
  return (
    <li
      aria-current={current ? "step" : undefined}
      className={`flex gap-3 rounded-xl border p-3 ${
        current ? "border-accent shadow-lift" : done ? "border-warn/40" : "border-dashed border-line"
      }`}
    >
      <Medal a={a} step={step} large />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span className={`font-semibold leading-snug ${done || current ? "" : "text-muted"}`}>{a.name}</span>
          <span className={`tnum text-xs font-semibold ${done ? "text-warn" : "text-muted"}`}>{reward(a.reward)}</span>
        </p>
        <p className="text-sm text-muted">{a.description}</p>
        {done ? (
          <p className="tnum mt-1 flex items-center gap-1 text-xs font-semibold text-warn">
            <Check aria-hidden className="size-3.5" strokeWidth={3} /> Obtenu le {date(a.unlockedAt!)}
          </p>
        ) : current ? (
          <>
            <Progress a={a} />
            <p className="tnum mt-1 text-xs text-faint">
              En cours · {fmt(Math.min(a.progress, a.target))} / {fmt(a.target)}
            </p>
          </>
        ) : (
          <p className="tnum mt-1 text-xs text-faint">À venir · objectif {fmt(a.target)}</p>
        )}
      </div>
    </li>
  );
}

/** Détail des paliers d'une famille : objectif, récompense réellement versée et état de chacun. */
function TiersDialog({ name, tiers, onClose }: { name: string | null; tiers: Achievement[]; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const open = !!name && tiers.length > 0;
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  const next = tiers.find((a) => !a.unlockedAt);
  const done = tiers.filter((a) => a.unlockedAt).length;
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      // Un clic sur le fond (hors de la boîte) ferme aussi.
      onClick={(e) => e.target === e.currentTarget && e.currentTarget.close()}
      aria-labelledby="tiers-title"
      className="pc-picker m-auto max-h-[min(42rem,calc(100dvh-2rem))] w-[min(30rem,calc(100vw-1.5rem))] flex-col rounded-2xl border border-line-strong bg-panel p-0 text-text shadow-pop backdrop:bg-black/60 open:flex"
    >
      {open && (
        <>
          <header className="flex items-start gap-3 border-b-2 border-dashed border-line px-5 py-4">
            <div className="min-w-0 flex-1">
              <h2 id="tiers-title" className="font-display text-2xl uppercase leading-tight">
                {name}
              </h2>
              <p className="tnum text-sm text-muted">
                {done} palier{done > 1 ? "s" : ""} obtenu{done > 1 ? "s" : ""} sur {tiers.length}
              </p>
            </div>
            <button
              type="button"
              className="btn btn-sm btn-ghost px-2"
              onClick={() => ref.current?.close()}
              aria-label="Fermer"
            >
              <X aria-hidden className="size-5" />
            </button>
          </header>
          <ol className="flex flex-col gap-2 overflow-y-auto p-4 sm:p-5">
            {tiers.map((a, i) => (
              <TierRow key={a.key} a={a} step={i} current={a === next} />
            ))}
          </ol>
        </>
      )}
    </dialog>
  );
}

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
    return n ? n.progress / n.target : -1;
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
