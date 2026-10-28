// Composants d'interface partagés, importés uniquement par des composants client.
import { RARITIES, RARITY_LABELS, TITLE_NAMES, titleDetail, type Rarity, type TitleRef } from "@palacards/game";
import { Award, Ban } from "lucide-react";
import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { fmt } from "@/lib/format";

/** Filtre de raretés : les sigles eux-mêmes servent de bascules. Sans sélection, tout est affiché. */
export function RarityFilter({ value, onChange }: { value: Rarity[]; onChange: (v: Rarity[]) => void }) {
  return (
    <div
      className="flex flex-wrap gap-1.5"
      role="group"
      aria-label="Filtrer par rareté"
      data-active={value.length > 0 || undefined}
    >
      {[...RARITIES].reverse().map((r) => {
        const on = value.includes(r);
        return (
          <button
            key={r}
            type="button"
            className="rarity-toggle"
            data-rarity={r}
            aria-pressed={on}
            aria-label={RARITY_LABELS[r]}
            title={RARITY_LABELS[r]}
            onClick={() => onChange(on ? value.filter((x) => x !== r) : [...value, r])}
          >
            {r}
          </button>
        );
      })}
    </div>
  );
}

export function Toggle({
  pressed,
  onChange,
  children,
}: {
  pressed: boolean;
  onChange: (v: boolean) => void;
  children: ReactNode;
}) {
  return (
    <button type="button" className="chip" aria-pressed={pressed} onClick={() => onChange(!pressed)}>
      {children}
    </button>
  );
}

/** État d'un filtre à trois états : indifférent (`""`), seulement ces cartes, ou toutes sauf elles. */
export type FilterMode = "" | "only" | "exclude";
const NEXT_MODE: Record<FilterMode, FilterMode> = { "": "only", only: "exclude", exclude: "" };

/**
 * Filtre à trois états : chaque clic passe d'indifférent à « seulement » (puce pleine), puis à « sauf » (puce
 * barrée d'une icône, libellé `excludeLabel`), puis revient à indifférent.
 */
export function TriToggle({
  value,
  onChange,
  label,
  excludeLabel,
}: {
  value: FilterMode;
  onChange: (v: FilterMode) => void;
  label: string;
  excludeLabel: string;
}) {
  const hint = { "": "indifférent", only: "seulement", exclude: "exclues" }[value];
  return (
    <button
      type="button"
      className="chip"
      aria-pressed={value !== ""}
      data-mode={value || undefined}
      title={`${label} : ${hint}. Clic : ${{ "": "seulement", only: "exclure", exclude: "indifférent" }[value]}.`}
      onClick={() => onChange(NEXT_MODE[value])}
    >
      {value === "exclude" && <Ban aria-hidden className="size-3.5" />}
      {value === "exclude" ? excludeLabel : label}
    </button>
  );
}

/** Plus grande ATK ou DEF minimale acceptée par l'API (smallint). */
const STAT_MAX = 32_767;

/** Puce d'un `<details>` qui s'ouvre comme un menu : se ferme au clic dehors et avec Échap. */
function useDismiss(ref: RefObject<HTMLDetailsElement | null>) {
  useEffect(() => {
    const close = (e: Event) => {
      const d = ref.current;
      if (!d?.open) return;
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !d.contains(e.target as Node)) {
        d.open = false;
        if (e instanceof KeyboardEvent) d.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [ref]);
}

/**
 * ATK et DEF minimales, dans un petit menu « Stats minimales » (comme « Toutes les cartes ») ; la puce montre les
 * seuils en cours. `hint` : précision sous les champs (stats niveau compris dans la collection).
 */
export function StatsFilter({
  minAtk,
  minDef,
  onChange,
  hint,
}: {
  minAtk: string;
  minDef: string;
  onChange: (patch: { minAtk?: string; minDef?: string }) => void;
  hint?: string;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useDismiss(ref);
  const atk = /^\d+$/.test(minAtk.trim()) ? Number(minAtk) : null;
  const def = /^\d+$/.test(minDef.trim()) ? Number(minDef) : null;
  const summary = [atk !== null && `ATK ≥ ${fmt(atk)}`, def !== null && `DEF ≥ ${fmt(def)}`]
    .filter(Boolean)
    .join(" · ");
  // Colonnes smallint côté API : au-delà de 32 767, aucune carte ne passe de toute façon.
  const clean = (v: string) => {
    const digits = v.replace(/\D/g, "").slice(0, 5);
    return digits && Number(digits) > STAT_MAX ? String(STAT_MAX) : digits;
  };
  return (
    <details ref={ref} className="group relative">
      <summary className="chip tnum cursor-pointer list-none" data-active={summary ? true : undefined}>
        {summary || "Stats minimales"}
      </summary>
      <div className="z-20 mt-2 flex w-60 flex-col gap-2 rounded-xl border border-line-strong bg-panel p-3 shadow-pop sm:absolute sm:left-0 sm:top-9 sm:mt-0">
        <label className="text-sm">
          <span className="label">ATK minimale</span>
          <input
            inputMode="numeric"
            className="field h-8 min-h-0"
            value={minAtk}
            onChange={(e) => onChange({ minAtk: clean(e.target.value) })}
            placeholder="100 à 9 999"
          />
        </label>
        <label className="text-sm">
          <span className="label">DEF minimale</span>
          <input
            inputMode="numeric"
            className="field h-8 min-h-0"
            value={minDef}
            onChange={(e) => onChange({ minDef: clean(e.target.value) })}
            placeholder="100 à 9 999"
          />
        </label>
        {hint && <p className="text-xs text-faint">{hint}</p>}
      </div>
    </details>
  );
}

/** Niveaux de carte (1 à 5), plusieurs cochables ; aucun coché : tous. */
export function LevelFilter({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Filtrer par niveau">
      <span className="mr-0.5 text-xs font-semibold text-faint" aria-hidden>
        Niv.
      </span>
      {[1, 2, 3, 4, 5].map((l) => {
        const on = value.includes(l);
        return (
          <button
            key={l}
            type="button"
            className="chip tnum w-8 justify-center px-0"
            aria-pressed={on}
            aria-label={`Niveau ${l}`}
            onClick={() => onChange(on ? value.filter((x) => x !== l) : [...value, l].sort())}
          >
            {l}
          </button>
        );
      })}
    </div>
  );
}

export function Select<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: readonly { value: T; label: string }[];
  label: string;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-muted">
      <span className="sr-only sm:not-sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="field h-8 min-h-0 w-auto py-0 pr-8 text-sm"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** État vide : une phrase, et l'action qui en sort. */
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="slot px-5 py-10 text-center">
      <p className="font-display text-2xl uppercase">{title}</p>
      {children && <div className="mx-auto mt-2 max-w-md text-sm text-muted">{children}</div>}
    </div>
  );
}

export function ErrorBox({ error, retry }: { error: unknown; retry?: () => void }) {
  const message = error instanceof Error ? error.message : "Chargement impossible.";
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger"
    >
      <span>{message}</span>
      {retry && (
        <button type="button" className="btn btn-sm btn-danger" onClick={retry}>
          Réessayer
        </button>
      )}
    </div>
  );
}

/** Squelette de grille pendant le chargement : les cases numérotées d'un album encore vide. */
export function CardSkeletons({ count = 12 }: { count?: number }) {
  return (
    <div
      className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-3 sm:grid-cols-[repeat(auto-fill,minmax(11.5rem,1fr))] sm:gap-4"
      aria-hidden
    >
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="slot grid aspect-[5/7] animate-pulse place-items-center font-display text-4xl text-line-strong"
        >
          {i + 1}
        </div>
      ))}
    </div>
  );
}

/** Déclenche `onVisible` quand l'élément approche du bas de l'écran (pagination infinie). */
export function LoadMore({ onVisible, loading, done }: { onVisible: () => void; loading: boolean; done: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || done) return;
    const obs = new IntersectionObserver((entries) => entries[0]?.isIntersecting && onVisible(), {
      rootMargin: "600px",
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [onVisible, done]);
  if (done) return null;
  return (
    <div ref={ref} className="flex justify-center py-6">
      <button type="button" className="btn btn-sm" onClick={onVisible} disabled={loading}>
        {loading ? "Chargement…" : "Afficher plus"}
      </button>
    </div>
  );
}

/** Boîte de confirmation native (<dialog>) : focus piégé et Échap gérés par le navigateur. */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  onConfirm,
  onClose,
  danger = false,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
  danger?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className="m-auto w-[min(26rem,calc(100vw-2rem))] rounded-2xl border border-line-strong bg-panel p-0 text-text shadow-pop backdrop:bg-black/60"
    >
      <div className="p-5">
        <h2 className="font-display text-2xl uppercase">{title}</h2>
        <div className="mt-2 text-sm text-muted">{children}</div>
      </div>
      <div className="flex justify-end gap-2 border-t-2 border-dashed border-line px-5 py-3">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
          Annuler
        </button>
        <button
          type="button"
          className={`btn btn-sm ${danger ? "btn-danger" : "btn-primary"}`}
          onClick={() => {
            onConfirm();
            onClose();
          }}
        >
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}

/** Badge « Créateur » à côté du pseudo (compte admin du jeu) : classements et profil. */
/** Titre cosmétique gagné en fin de saison (profil, classements) ; le détail (rang, saison) en infobulle. */
export function TitleBadge({ title, size = "sm" }: { title: TitleRef; size?: "sm" | "lg" }) {
  const detail = titleDetail(title);
  return (
    <span
      title={detail}
      className={`inline-flex max-w-full shrink-0 items-center gap-1 rounded-full border border-[color-mix(in_oklab,var(--color-warn)_45%,var(--color-line))] bg-[color-mix(in_oklab,var(--color-warn)_10%,transparent)] font-semibold leading-none text-text ${
        size === "lg" ? "px-2.5 py-1 text-[0.8rem]" : "px-1.5 py-[3px] text-[0.7rem]"
      }`}
    >
      <Award aria-hidden className={`shrink-0 text-warn ${size === "lg" ? "size-3.5" : "size-3"}`} strokeWidth={2.5} />
      <span className="truncate">{TITLE_NAMES[title.board]}</span>
      <span className="sr-only"> ({detail})</span>
    </span>
  );
}

export function CreatorBadge({ size = "sm" }: { size?: "sm" | "lg" }) {
  return (
    <span
      title="Créateur de PalaCards"
      className={`inline-flex shrink-0 items-center rounded-full bg-accent font-sans font-bold uppercase leading-none tracking-[0.04em] text-accent-ink ${
        size === "lg" ? "px-2.5 py-1 text-[0.78rem]" : "px-1.5 py-[3px] text-[0.66rem]"
      }`}
    >
      Créateur
    </span>
  );
}
