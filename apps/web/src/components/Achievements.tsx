// Succès à paliers : médailles, familles et détail des paliers, partagés par la page Succès et les profils publics
// (importé uniquement par des composants client).
import { TIER_NAMES } from "@palacards/game";
import type { PublicAchievementsDTO } from "@palacards/shared";
import { Check, ChevronRight, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { fmt } from "@/lib/format";

export interface Achievement {
  key: string;
  family: string;
  tier: number;
  secret: boolean;
  name: string;
  description: string;
  target: number;
  /** Objectif en pourcentage : 1 = en %, 10 = en dixièmes de % ; null : un nombre. */
  percent: number | null;
  reward: { pw: number; packs: number };
  /** Absente sur le profil d'un autre joueur : on voit ses paliers obtenus, jamais sa progression. */
  progress?: number;
  unlockedAt: string | null;
}

/** Médailles des paliers : bronze, argent, or, platine, diamant (jamais les couleurs de rareté). */
export const MEDALS = ["#c98a4b", "#c3cad8", "#f2c53d", "#7fd3f5", "#e3c8ff"];

/** Grands thèmes de la page (chaque famille de paliers appartient à un thème). */
export const GROUPS: { title: string; families: string[] }[] = [
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
      "Communes de la saison",
      "Peu communes de la saison",
      "Rares de la saison",
      "Super rares de la saison",
      "Ultra rares de la saison",
      "Légendaires de la saison",
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
      "Plus ou moins vu",
      "Réussites à Plus ou moins vu",
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

export const reward = (r: Achievement["reward"]) =>
  [r.pw ? `${fmt(r.pw)} PW` : "", r.packs ? `${r.packs} paquet${r.packs > 1 ? "s" : ""} bonus` : ""]
    .filter(Boolean)
    .join(" + ");

/** Objectif ou progression d'un palier : « 1 234 », ou « 0,5 % » pour une part de la saison. */
export const amount = (a: Achievement, v: number) => (a.percent ? `${fmt(v / a.percent)}\u00a0%` : fmt(v));

export const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"];

/** Recherche sans accents ni majuscules : « legendaire » trouve « Légendaires ». */
export const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
export const matches = (a: Achievement, q: string) => fold(`${a.name} ${a.description}`).includes(q);

/**
 * Médaille d'un palier : son numéro (I, II, III…) se lit sans la couleur ; débloquée, elle est pleine
 * (bronze, argent, or, platine, diamant), à débloquer elle reste en pointillés.
 */
export function Medal({ a, step, large = false }: { a: Achievement; step: number; large?: boolean }) {
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
export function Progress({ a }: { a: Achievement & { progress: number } }) {
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

export const date = (iso: string) => new Date(iso).toLocaleDateString("fr-FR");

/**
 * Une famille de paliers : médailles en tête (elles ouvrent le détail), puis le palier en cours.
 * Pendant une recherche, si le texte n'est trouvé que dans un autre palier, une ligne le montre.
 */
export function Family({
  name,
  tiers,
  q,
  onOpen,
}: {
  name: string;
  tiers: Achievement[];
  q: string;
  onOpen: () => void;
}) {
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
        {next && shown.progress === undefined ? (
          <p className="tnum mt-1 text-xs text-faint">
            {done ? `${done} palier${done > 1 ? "s" : ""} obtenu${done > 1 ? "s" : ""} · ` : ""}prochain : objectif{" "}
            {amount(shown, shown.target)}
          </p>
        ) : next ? (
          <>
            <Progress a={{ ...shown, progress: shown.progress ?? 0 }} />
            <p className="tnum mt-1 flex justify-between gap-3 text-xs text-faint">
              <span>
                {amount(shown, Math.min(shown.progress ?? 0, shown.target))} / {amount(shown, shown.target)}
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
export function TierRow({ a, step, current }: { a: Achievement; step: number; current: boolean }) {
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
        ) : current && a.progress !== undefined ? (
          <>
            <Progress a={{ ...a, progress: a.progress }} />
            <p className="tnum mt-1 text-xs text-faint">
              En cours · {amount(a, Math.min(a.progress, a.target))} / {amount(a, a.target)}
            </p>
          </>
        ) : (
          <p className="tnum mt-1 text-xs text-faint">À venir · objectif {amount(a, a.target)}</p>
        )}
      </div>
    </li>
  );
}

/** Détail des paliers d'une famille : objectif, récompense réellement versée et état de chacun. */
export function TiersDialog({
  name,
  tiers,
  onClose,
}: {
  name: string | null;
  tiers: Achievement[];
  onClose: () => void;
}) {
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

/** Familles dans l'ordre de la page Succès (thèmes, puis le reste), chacune avec ses paliers. */
function familiesOf(items: Achievement[]): [string, Achievement[]][] {
  const by = new Map<string, Achievement[]>();
  for (const a of items) if (!a.secret) by.set(a.family, [...(by.get(a.family) ?? []), a]);
  const order = GROUPS.flatMap((g) => g.families);
  const rank = (name: string) => (order.includes(name) ? order.indexOf(name) : order.length);
  return [...by].sort(([a], [b]) => rank(a) - rank(b));
}

/**
 * Famille vue sur le profil d'un autre joueur : médailles (elles ouvrent le détail des paliers), puis le meilleur
 * palier obtenu et sa date. Sans palier obtenu : grisée, avec le premier objectif.
 */
function PublicFamily({ name, tiers, onOpen }: { name: string; tiers: Achievement[]; onOpen: () => void }) {
  const best = tiers.findLast((a) => a.unlockedAt);
  return (
    <li
      className={`flex items-start justify-between gap-3 rounded-[14px] border p-3 ${
        best ? "border-line bg-panel" : "border-dashed border-line opacity-70"
      }`}
    >
      <div className="min-w-0">
        <h3 className="font-display text-lg uppercase leading-tight">{name}</h3>
        {best ? (
          <p className="tnum text-xs text-muted">
            <span className="font-semibold text-warn">{TIER_NAMES[Math.min(best.tier, TIER_NAMES.length - 1)]}</span> ·{" "}
            {best.name} · le {date(best.unlockedAt!)}
          </p>
        ) : (
          <p className="tnum text-xs text-faint">Pas encore · premier palier : {amount(tiers[0]!, tiers[0]!.target)}</p>
        )}
      </div>
      <button
        type="button"
        onClick={onOpen}
        aria-haspopup="dialog"
        aria-label={`Voir les ${tiers.length} paliers de la famille ${name}`}
        title="Voir le détail des paliers"
        className="-m-1 flex max-w-[50%] flex-wrap justify-end gap-0.5 rounded-full p-1 transition-[background-color,transform] duration-150 ease-(--ease-out) hover:bg-panel-2 active:scale-[0.97]"
      >
        {tiers.map((a, i) => (
          <Medal key={a.key} a={a} step={i} />
        ))}
      </button>
    </li>
  );
}

/**
 * Succès d'un joueur sur son profil (suggestion n° 109), en lecture seule : compteur, familles où il a obtenu
 * au moins un palier, puis les autres (grisées, repliées), et ses secrets découverts. Jamais sa progression.
 */
export function PlayerAchievements({ data }: { data: PublicAchievementsDTO }) {
  const [detail, setDetail] = useState<string | null>(null);
  const families = familiesOf(data.items);
  const started = families.filter(([, t]) => t.some((a) => a.unlockedAt));
  const notYet = families.filter(([, t]) => !t.some((a) => a.unlockedAt));
  const secrets = data.items.filter((a) => a.secret);
  const open = (name: string) => () => setDetail(name);
  return (
    <section aria-labelledby="achievements-title">
      <h2 id="achievements-title" className="section-title mt-0">
        Succès
        <span className="tnum font-sans text-sm font-semibold normal-case text-muted [font-stretch:100%]">
          {data.unlocked} / {data.total} succès
        </span>
      </h2>
      {started.length ? (
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {started.map(([name, tiers]) => (
            <PublicFamily key={name} name={name} tiers={tiers} onOpen={open(name)} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">Aucun succès débloqué pour l’instant.</p>
      )}
      {secrets.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2" aria-label="Succès secrets découverts">
          {secrets.map((s) => (
            <li
              key={s.key}
              className="flex items-center gap-1.5 rounded-full border border-warn/50 bg-panel px-3 py-1 text-sm"
              title={s.description}
            >
              <Sparkles aria-hidden className="size-3.5 text-warn" />
              {s.name}
            </li>
          ))}
        </ul>
      )}
      {(notYet.length > 0 || data.hiddenSecrets > 0) && (
        <details className="group mt-3">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm font-semibold text-muted hover:text-text">
            <ChevronRight
              aria-hidden
              className="size-4 transition-transform duration-200 ease-(--ease-out) group-open:rotate-90"
            />
            {notYet.length} famille{notYet.length > 1 ? "s" : ""} pas encore commencée{notYet.length > 1 ? "s" : ""}
            {data.hiddenSecrets > 0 &&
              ` · ${data.hiddenSecrets} secret${data.hiddenSecrets > 1 ? "s" : ""} à découvrir`}
          </summary>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {notYet.map(([name, tiers]) => (
              <PublicFamily key={name} name={name} tiers={tiers} onOpen={open(name)} />
            ))}
          </ul>
        </details>
      )}
      <TiersDialog
        name={detail}
        tiers={(detail && families.find(([n]) => n === detail)?.[1]) || []}
        onClose={() => setDetail(null)}
      />
    </section>
  );
}
