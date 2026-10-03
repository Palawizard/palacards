// Éditeur de tags d'un exemplaire (importé uniquement par des composants client).
import { Plus, X } from "lucide-react";
import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { toast } from "sonner";
import useSWR, { useSWRConfig } from "swr";
import { api, ApiError } from "@/lib/api";

/** Limites de l'API (PUT /collection/:id/tags). */
const MAX_TAGS = 10;
const MAX_LENGTH = 24;

/** Comparaison sans casse ni accents : « Héros » retrouve « heros ». */
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

type Option = { kind: "tag"; tag: string; count: number } | { kind: "create"; tag: string };

/**
 * Tags d'un exemplaire : les tags posés en pastilles, un champ qui propose les tags déjà utilisés
 * (filtrés pendant la frappe, les plus fréquents d'abord) et crée un nouveau tag avec Entrée ou une virgule.
 * Chaque ajout ou retrait est enregistré aussitôt, comme le favori.
 */
export function TagEditor({
  instanceId,
  initial,
  onSaved,
}: {
  instanceId: number;
  initial: string[];
  onSaved: () => void;
}) {
  const [tags, setTags] = useState(initial);
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const { mutate } = useSWRConfig();
  const known = useSWR<{ tags: { tag: string; count: number }[] }>("/collection/tags");

  const options = useMemo<Option[]>(() => {
    const q = fold(text);
    const mine = new Set(tags);
    const pool = (known.data?.tags ?? []).filter((t) => !mine.has(t.tag));
    // Ceux qui commencent par la saisie d'abord, puis ceux qui la contiennent ; à égalité, les plus utilisés.
    const scored = pool
      .map((t) => ({ t, at: q ? fold(t.tag).indexOf(q) : 0 }))
      .filter((x) => x.at >= 0)
      .sort((a, b) => Number(a.at > 0) - Number(b.at > 0) || b.t.count - a.t.count);
    const out: Option[] = scored.slice(0, 8).map(({ t }) => ({ kind: "tag", ...t }));
    const typed = text.trim().toLowerCase();
    const exists = typed && (mine.has(typed) || pool.some((t) => t.tag === typed));
    if (typed && !exists) out.push({ kind: "create", tag: typed });
    return out;
  }, [text, tags, known.data]);

  const full = tags.length >= MAX_TAGS;
  const showList = open && !full && (options.length > 0 || !known.data?.tags.length);
  const current = Math.min(active, options.length - 1);

  async function save(next: string[]) {
    const before = tags;
    setTags(next);
    try {
      const res = await api<{ tags: string[] }>(`/collection/${instanceId}/tags`, {
        method: "PUT",
        body: { tags: next },
      });
      setTags(res.tags);
      onSaved();
      void mutate("/collection/tags");
      void mutate("/collection/summary");
    } catch (err) {
      setTags(before);
      toast.error(err instanceof ApiError ? err.message : "Tags non enregistrés.");
    }
  }

  function add(raw: string) {
    const tag = raw.trim().toLowerCase().slice(0, MAX_LENGTH);
    setText("");
    setActive(0);
    if (!tag || tags.includes(tag) || full) return;
    void save([...tags, tag]);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      if (options.length) setActive((current + (e.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = showList ? options[current] : undefined;
      add(pick?.tag ?? text);
    } else if (e.key === ",") {
      e.preventDefault();
      add(text);
    } else if (e.key === "Backspace" && !text && tags.length) {
      void save(tags.slice(0, -1));
    } else if (e.key === "Escape" && showList) {
      // Ferme la liste sans fermer la fiche carte qui l'entoure.
      e.stopPropagation();
      setOpen(false);
    }
  }

  return (
    <div className="relative w-full">
      <div className="pc-tag-field" onClick={() => input.current?.focus()}>
        {tags.map((t) => (
          <span key={t} className="pc-tag">
            {t}
            <button
              type="button"
              className="pc-tag-remove"
              aria-label={`Retirer le tag ${t}`}
              onClick={(e) => {
                e.stopPropagation();
                void save(tags.filter((x) => x !== t));
              }}
            >
              <X aria-hidden className="size-3" strokeWidth={2.5} />
            </button>
          </span>
        ))}
        <input
          ref={input}
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && options.length ? `${listId}-${current}` : undefined}
          aria-label="Ajouter un tag"
          className="min-w-[8ch] flex-1 bg-transparent py-1 text-sm outline-none disabled:cursor-not-allowed"
          value={text}
          maxLength={MAX_LENGTH}
          disabled={full}
          placeholder={full ? `${MAX_TAGS} tags au maximum` : tags.length ? "Ajouter…" : "Choisis ou écris un tag"}
          autoFocus
          onChange={(e) => {
            setText(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
        />
      </div>
      {showList && (
        <ul id={listId} role="listbox" aria-label="Tags" className="pc-listbox">
          {options.length === 0 && (
            <li className="px-3 py-2 text-xs text-faint" role="presentation">
              Écris un tag puis Entrée : il sera proposé pour tes autres cartes.
            </li>
          )}
          {options.map((o, i) => (
            <li
              key={`${o.kind}:${o.tag}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === current}
              className="pc-option"
              // mousedown : le champ garde le focus (sinon la liste se ferme avant le clic).
              onMouseDown={(e) => e.preventDefault()}
              onMouseMove={() => setActive(i)}
              onClick={() => add(o.tag)}
            >
              {o.kind === "create" ? (
                <>
                  <Plus aria-hidden className="size-3.5 text-faint" />
                  <span className="min-w-0 flex-1 truncate">
                    Créer <span className="font-semibold">« {o.tag} »</span>
                  </span>
                </>
              ) : (
                <>
                  <span className="min-w-0 flex-1 truncate">{o.tag}</span>
                  <span className="tnum text-xs text-faint">
                    {o.count} carte{o.count > 1 ? "s" : ""}
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
