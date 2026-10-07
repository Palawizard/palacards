"use client";

import { checkStatusNote, STATUS_NOTE_ERRORS, STATUS_NOTE_MAX, statusNoteLength } from "@palacards/game";
import { MessageCircle, Pencil, ShieldX } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui";
import { api, ApiError } from "@/lib/api";

/** Bulle de la note (texte brut : React l'échappe). */
function Bubble({ note }: { note: string }) {
  return (
    <p className="flex min-w-0 max-w-full items-start gap-1.5 rounded-xl rounded-tl-sm border border-line bg-panel px-3 py-1.5 text-sm leading-snug">
      <MessageCircle aria-hidden className="mt-0.5 size-3.5 shrink-0 text-faint" />
      <span className="sr-only">Note : </span>
      <span className="min-w-0 break-words">{note}</span>
    </p>
  );
}

/**
 * Note de statut sous le pseudo, sur le profil public. Son auteur la modifie ou l'efface sur place ;
 * l'admin peut l'effacer (modération).
 */
export function StatusNote({
  username,
  note,
  isMe,
  canModerate,
  onChanged,
}: {
  username: string;
  note: string | null;
  isMe: boolean;
  canModerate: boolean;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const inputId = useId();
  const errorId = useId();

  async function save(value: string | null) {
    setBusy(true);
    try {
      await api("/me/status-note", { method: "PUT", body: { note: value } });
      setEditing(false);
      toast.success(value?.trim() ? "Note enregistrée." : "Note effacée.");
      onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Impossible d'enregistrer ta note.");
    } finally {
      setBusy(false);
    }
  }

  async function moderate() {
    setBusy(true);
    try {
      await api(`/admin/players/${encodeURIComponent(username)}/status-note`, { method: "DELETE" });
      toast.success("Note effacée.");
      onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Impossible d'effacer la note.");
    } finally {
      setBusy(false);
    }
  }

  if (isMe && editing) {
    const length = statusNoteLength(draft.trim());
    const check = checkStatusNote(draft);
    const error = check.ok ? null : STATUS_NOTE_ERRORS[check.error];
    return (
      <form
        className="mt-2 flex max-w-xl flex-col gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (check.ok) void save(check.note);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") setEditing(false);
        }}
      >
        <label htmlFor={inputId} className="sr-only">
          Ta note de statut
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            id={inputId}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Ce que tu fais en ce moment, ce que tu cherches…"
            className="field h-9 min-h-0 min-w-0 flex-1 basis-60 text-sm"
            aria-invalid={!!error}
            aria-describedby={errorId}
            autoComplete="off"
            autoFocus
          />
          <div className="flex gap-2">
            <button type="submit" className="btn btn-sm btn-primary" disabled={busy || !check.ok}>
              Enregistrer
            </button>
            <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => setEditing(false)}>
              Annuler
            </button>
          </div>
        </div>
        <p id={errorId} className="flex justify-between gap-3 text-xs" aria-live="polite">
          <span className={error ? "text-danger" : "text-faint"}>
            {error ?? "Visible sur ton profil et par tes amis. Pas de liens."}
          </span>
          <span className={`tnum shrink-0 ${length > STATUS_NOTE_MAX ? "text-danger" : "text-faint"}`}>
            {length}/{STATUS_NOTE_MAX}
          </span>
        </p>
      </form>
    );
  }

  if (isMe) {
    const edit = () => {
      setDraft(note ?? "");
      setEditing(true);
    };
    return note ? (
      <div className="mt-2 flex max-w-xl flex-wrap items-center gap-x-2 gap-y-1">
        <Bubble note={note} />
        <div className="flex gap-1">
          <button type="button" className="btn btn-sm btn-ghost px-2" onClick={edit} aria-label="Modifier ma note">
            <Pencil aria-hidden className="size-4" />
          </button>
          <button type="button" className="btn btn-sm btn-ghost text-muted" disabled={busy} onClick={() => save(null)}>
            Effacer
          </button>
        </div>
      </div>
    ) : (
      <button type="button" className="chip mt-2" onClick={edit}>
        <MessageCircle aria-hidden className="size-3.5" /> Ajouter une note
      </button>
    );
  }

  if (!note) return null;
  return (
    <div className="mt-2 flex max-w-xl flex-wrap items-center gap-x-2 gap-y-1">
      <Bubble note={note} />
      {canModerate && (
        <>
          <button
            type="button"
            className="btn btn-sm btn-ghost text-muted"
            disabled={busy}
            onClick={() => setConfirm(true)}
          >
            <ShieldX aria-hidden className="size-4" /> Effacer la note
          </button>
          <ConfirmDialog
            open={confirm}
            title="Effacer la note ?"
            confirmLabel="Effacer"
            danger
            onConfirm={() => void moderate()}
            onClose={() => setConfirm(false)}
          >
            Le joueur sera prévenu que sa note a été retirée par la modération.
          </ConfirmDialog>
        </>
      )}
    </div>
  );
}
