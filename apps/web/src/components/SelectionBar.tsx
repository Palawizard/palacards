// Barre d'actions d'une sélection de cartes (Collection) et boîte « Tag » en masse.
// Importé uniquement par des composants client.
import { Recycle, Star, Tag, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import useSWR from "swr";
import { fmt } from "@/lib/format";

/**
 * Barre collée en bas de l'écran pendant une sélection : elle reste sous le pouce pendant qu'on fait défiler
 * la grille. À gauche le compte et « Tout sélectionner », à droite les actions.
 */
export function SelectionBar({
  count,
  selectAll,
  selectCount,
  onFavorite,
  favoriteLabel,
  onTag,
  onRecycle,
  recycleLabel,
  onCancel,
  busy,
}: {
  count: number;
  selectAll: ReactNode;
  /** « Sélectionner N cartes » (`SelectCount`), entre le compte et les actions. */
  selectCount?: ReactNode;
  onFavorite: () => void;
  favoriteLabel: string;
  onTag: () => void;
  onRecycle: () => void;
  recycleLabel: ReactNode;
  onCancel: () => void;
  busy: boolean;
}) {
  const none = count === 0;
  return (
    <div className="pc-selbar" role="region" aria-label="Actions sur la sélection">
      <div className="flex min-w-0 items-center gap-1 sm:gap-2">
        <button
          type="button"
          className="btn btn-sm btn-ghost px-2"
          onClick={onCancel}
          aria-label="Quitter la sélection"
        >
          <X aria-hidden className="size-4" />
        </button>
        <p className="tnum min-w-0 flex-1 truncate text-sm font-semibold sm:flex-none" aria-live="polite">
          {count ? `${fmt(count)} sélectionnée${count > 1 ? "s" : ""}` : "Touche des cartes"}
        </p>
        {selectAll}
      </div>
      {selectCount}
      {/* Téléphone : une rangée pleine largeur sous le compte ; « Recycler » prend la place qui reste. */}
      <div className="grid grid-cols-[auto_auto_minmax(0,1fr)] gap-1.5 sm:flex sm:items-center">
        <button type="button" className="btn btn-sm" disabled={none || busy} onClick={onFavorite}>
          <Star aria-hidden className="size-4" />
          {favoriteLabel}
        </button>
        <button type="button" className="btn btn-sm" disabled={none || busy} onClick={onTag}>
          <Tag aria-hidden className="size-4" />
          Tag
        </button>
        <button type="button" className="btn btn-sm btn-primary" disabled={none || busy} onClick={onRecycle}>
          <Recycle aria-hidden className="size-4" />
          {recycleLabel}
        </button>
      </div>
    </div>
  );
}

/**
 * « Sélectionner N cartes » : un nombre et un bouton. `onSelect` prend les N premières cartes de la liste
 * affichée ; le champ garde le nombre pour recommencer après un changement de filtre.
 */
export function SelectCount({
  onSelect,
  max,
  disabled,
}: {
  onSelect: (n: number) => void;
  max: number;
  disabled: boolean;
}) {
  const [text, setText] = useState("");
  const n = Math.min(Number(text), max);
  return (
    <form
      className="flex items-center gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (n > 0) onSelect(n);
      }}
    >
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        enterKeyHint="go"
        aria-label="Nombre de cartes à sélectionner"
        placeholder="Nombre"
        className="field tnum h-8 min-h-0 w-24 flex-1 text-right text-sm pointer-coarse:h-11 sm:flex-none"
        value={text}
        onChange={(e) => setText(e.target.value.replace(/\D/g, "").slice(0, String(max).length))}
      />
      <button type="submit" className="btn btn-sm" disabled={disabled || !(n > 0)}>
        Sélectionner{n > 0 ? ` les ${fmt(n)} premières` : ""}
      </button>
    </form>
  );
}

/** Comparaison sans casse ni accents (comme l'éditeur de tags de la fiche). */
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
const MAX_LENGTH = 24;

/**
 * Ajouter ou retirer un tag sur toute la sélection : un champ, les tags déjà utilisés en suggestions
 * (filtrés pendant la frappe, les plus fréquents d'abord), et les deux actions.
 */
export function BulkTagDialog({
  open,
  count,
  onClose,
  onApply,
}: {
  open: boolean;
  count: number;
  onClose: () => void;
  onApply: (action: "add" | "remove", tag: string) => Promise<void>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const known = useSWR<{ tags: { tag: string; count: number }[] }>(open ? "/collection/tags" : null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setText("");
      d.showModal();
    }
    if (!open && d.open) d.close();
  }, [open]);

  const suggestions = useMemo(() => {
    const q = fold(text);
    return (known.data?.tags ?? [])
      .map((t) => ({ t, at: q ? fold(t.tag).indexOf(q) : 0 }))
      .filter((x) => x.at >= 0 && x.t.tag !== text.trim().toLowerCase())
      .sort((a, b) => Number(a.at > 0) - Number(b.at > 0) || b.t.count - a.t.count)
      .slice(0, 10)
      .map((x) => x.t.tag);
  }, [known.data, text]);

  const tag = text.trim().toLowerCase();
  const plural = count > 1 ? "s" : "";

  async function apply(action: "add" | "remove") {
    if (!tag) return;
    setBusy(true);
    try {
      await onApply(action, tag);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="bulk-tag-title"
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-2xl border border-line-strong bg-panel p-0 text-text shadow-pop backdrop:bg-black/60"
    >
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          void apply("add");
        }}
      >
        <div className="flex flex-col gap-3 p-5">
          <h2 id="bulk-tag-title" className="font-display text-2xl uppercase">
            Tag sur {fmt(count)} carte{plural}
          </h2>
          <label className="flex flex-col gap-1">
            <span className="label">Tag</span>
            <input
              className="field"
              value={text}
              maxLength={MAX_LENGTH}
              onChange={(e) => setText(e.target.value)}
              placeholder="Choisis ou écris un tag"
              autoCapitalize="none"
              spellCheck={false}
              autoFocus
            />
          </label>
          {suggestions.length > 0 && (
            <ul className="flex flex-wrap gap-1.5" aria-label="Tags déjà utilisés">
              {suggestions.map((t) => (
                <li key={t}>
                  <button type="button" className="pc-tag hover:border-line-strong" onClick={() => setText(t)}>
                    {t}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-faint">
            Une carte garde 10 tags au plus : celles qui en ont déjà 10 sont ignorées.
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t-2 border-dashed border-line px-5 py-3">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            Annuler
          </button>
          <button type="button" className="btn btn-sm" disabled={!tag || busy} onClick={() => void apply("remove")}>
            Retirer
          </button>
          <button type="submit" className="btn btn-sm btn-primary" disabled={!tag || busy}>
            Ajouter à {fmt(count)} carte{plural}
          </button>
        </div>
      </form>
    </dialog>
  );
}
