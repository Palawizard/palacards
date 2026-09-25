// Composants d'interface partagés, importés uniquement par des composants client.
import { RARITIES, RARITY_LABELS, type Rarity } from "@palacards/game";
import { useEffect, useRef, type ReactNode } from "react";

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
