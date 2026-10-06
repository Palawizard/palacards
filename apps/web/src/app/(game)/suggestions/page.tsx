"use client";

import {
  SUGGESTION_KINDS,
  SUGGESTION_LIMITS,
  suggestionInputSchema,
  type SuggestionDTO,
  type SuggestionKind,
} from "@palacards/shared";
import { Send } from "lucide-react";
import { useId, useRef, useState, type KeyboardEvent } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { KindTag, Reply, StatusPill } from "@/components/Suggestions";
import { Empty, ErrorBox } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { useSeenFeature } from "@/lib/features";
import { relative } from "@/lib/format";
import { useMe } from "@/lib/game";
import { KINDS } from "@/lib/suggestions";

/** Type de suggestion : tuiles à cocher, navigables aux flèches (groupe radio). */
function KindPicker({ value, onChange }: { value: SuggestionKind; onChange: (k: SuggestionKind) => void }) {
  const refs = useRef(new Map<SuggestionKind, HTMLButtonElement>());
  function onKeyDown(e: KeyboardEvent, i: number) {
    const step =
      e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = SUGGESTION_KINDS[(i + step + SUGGESTION_KINDS.length) % SUGGESTION_KINDS.length]!;
    onChange(next);
    refs.current.get(next)?.focus();
  }
  return (
    <div role="radiogroup" aria-label="Type de suggestion" className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
      {SUGGESTION_KINDS.map((k, i) => {
        const meta = KINDS[k];
        const Icon = meta.icon;
        const on = value === k;
        return (
          <button
            key={k}
            ref={(el) => {
              if (el) refs.current.set(k, el);
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            className="pc-kind"
            onClick={() => onChange(k)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            <span className="pc-kind-icon" aria-hidden>
              <Icon className="size-4" strokeWidth={2.25} />
            </span>
            <span className="text-sm font-semibold leading-tight">{meta.label}</span>
            <span className="text-xs leading-tight text-faint">{meta.hint}</span>
          </button>
        );
      })}
    </div>
  );
}

function SuggestionForm({ onSent }: { onSent: (s: SuggestionDTO) => void }) {
  const [kind, setKind] = useState<SuggestionKind>("feature");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const titleId = useId();
  const bodyId = useId();
  const valid = suggestionInputSchema.safeParse({ kind, title, body }).success;
  const meta = KINDS[kind];

  async function submit(e: { preventDefault(): void }) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    try {
      const sent = await api<SuggestionDTO>("/suggestions", { body: { kind, title: title.trim(), body: body.trim() } });
      onSent(sent);
      setTitle("");
      setBody("");
      toast.success("Suggestion envoyée à Palawi. Merci !");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Envoi impossible, réessaie dans un instant.");
    } finally {
      setBusy(false);
    }
  }

  const left = SUGGESTION_LIMITS.body - body.length;
  const short = body.trim().length > 0 && body.trim().length < 10;
  return (
    <form onSubmit={submit} className="infobox">
      <h2 className="infobox-head">Nouvelle suggestion</h2>
      <div className="flex flex-col gap-4 p-4">
        <fieldset className="flex flex-col gap-2">
          <legend className="label">C&apos;est à propos de…</legend>
          <KindPicker value={kind} onChange={setKind} />
        </fieldset>
        <div>
          <label htmlFor={titleId} className="label">
            En une phrase
          </label>
          <input
            id={titleId}
            className="field"
            value={title}
            maxLength={SUGGESTION_LIMITS.title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={meta.title}
            autoComplete="off"
          />
        </div>
        <div>
          <label htmlFor={bodyId} className="label">
            Les détails
          </label>
          <textarea
            id={bodyId}
            className="field min-h-36 leading-relaxed"
            value={body}
            maxLength={SUGGESTION_LIMITS.body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={meta.body}
          />
          <p className="tnum mt-1 text-right text-xs text-faint" aria-live="polite">
            {short
              ? "Encore quelques détails (10 caractères minimum)."
              : left < 200
                ? `${left} caractère${left > 1 ? "s" : ""} restant${left > 1 ? "s" : ""}`
                : "\u00a0"}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-faint">Seul Palawi lit ta suggestion. Il te répond ici.</p>
          <button type="submit" className="btn btn-primary" disabled={!valid || busy} aria-busy={busy}>
            <Send aria-hidden className="size-4" />
            {busy ? "Envoi…" : "Envoyer à Palawi"}
          </button>
        </div>
      </div>
    </form>
  );
}

export default function SuggestionsPage() {
  useSeenFeature("suggestions");
  const { mutateMe } = useMe();
  const list = useSWR<SuggestionDTO[]>("/suggestions");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="page-title">Suggestions</h1>
        <p className="hatnote mt-2 max-w-[62ch]">
          Un bug, une idée de booster, une règle à revoir ? Écris directement à Palawi. Il lit toutes les suggestions et
          te répond sur cette page. Claude, l&apos;IA d&apos;Anthropic, l&apos;aide à les trier, sans ton pseudo ; une
          idée retenue peut être publiée, reformulée et anonyme, sur le GitHub du jeu.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,34rem)_minmax(0,1fr)] lg:items-start">
        <SuggestionForm
          onSent={(s) => {
            void list.mutate((items) => [s, ...(items ?? [])], { revalidate: false });
            void mutateMe((m) => (m ? { ...m, suggestionBanner: false } : m), { revalidate: false });
          }}
        />

        <section aria-labelledby="mes-suggestions">
          <h2 id="mes-suggestions" className="section-title mt-0">
            Mes suggestions
          </h2>
          {list.error ? (
            <ErrorBox error={list.error} retry={() => list.mutate()} />
          ) : !list.data ? (
            <div className="flex flex-col gap-3" aria-busy>
              {[0, 1].map((i) => (
                <div key={i} className="h-28 animate-pulse rounded-xl bg-panel" />
              ))}
            </div>
          ) : list.data.length === 0 ? (
            <Empty title="Rien d'envoyé pour l'instant">
              Ta première idée apparaîtra ici, avec son avancement et la réponse de Palawi.
            </Empty>
          ) : (
            <ul className="flex flex-col gap-3">
              {list.data.map((s) => (
                <li key={s.id} className="pc-suggestion rounded-xl border border-line bg-panel p-4">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <KindTag kind={s.kind} />
                    <span className="tnum text-xs text-faint">{relative(s.createdAt)}</span>
                    <span className="ml-auto">
                      <StatusPill status={s.status} />
                    </span>
                  </div>
                  <h3 className="mt-1.5 font-semibold leading-snug">{s.title}</h3>
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-muted">{s.body}</p>
                  <Reply s={s} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
