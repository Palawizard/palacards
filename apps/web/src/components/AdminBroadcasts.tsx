"use client";

import type { AdminBroadcastDTO, BroadcastDTO } from "@palacards/shared";
import { Archive, Eye, RefreshCw, Send, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { api, ApiError } from "@/lib/api";
import { fmt, relative } from "@/lib/format";
import { ConfirmDialog, ErrorBox } from "./ui";

const TONES: { value: BroadcastDTO["tone"]; label: string }[] = [
  { value: "update", label: "Mise à jour" },
  { value: "info", label: "Message" },
  { value: "event", label: "Événement" },
  { value: "warning", label: "Important" },
];

const STATUS: Record<AdminBroadcastDTO["status"], string> = {
  draft: "Brouillon",
  sent: "Envoyé",
  archived: "Archivé",
};

/**
 * Messages serveur : un message envoyé s'affiche par-dessus la page chez tous les joueurs connectés,
 * et attend les autres à leur prochaine visite (jusqu'à son expiration, 30 jours au plus).
 */
export function AdminBroadcasts() {
  const list = useSWR<AdminBroadcastDTO[]>("/admin/broadcasts");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tone, setTone] = useState<BroadcastDTO["tone"]>("update");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkLabel, setLinkLabel] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<AdminBroadcastDTO | "new" | null>(null);

  const ready = title.trim().length >= 2 && body.trim().length > 0;

  async function create(send: boolean) {
    if (busy || !ready) return;
    setBusy(true);
    try {
      await api("/admin/broadcasts", {
        body: {
          title: title.trim(),
          body: body.trim(),
          tone,
          linkUrl: linkUrl.trim() || null,
          linkLabel: linkLabel.trim() || null,
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
          send,
        },
      });
      toast.success(send ? "Message envoyé à tout le monde." : "Brouillon enregistré.");
      setTitle("");
      setBody("");
      setLinkUrl("");
      setLinkLabel("");
      setExpiresAt("");
      void list.mutate();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Envoi impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function act(m: AdminBroadcastDTO, action: "send" | "archive" | "delete") {
    try {
      if (action === "delete") await api(`/admin/broadcasts/${m.id}`, { method: "DELETE" });
      else await api(`/admin/broadcasts/${m.id}/${action}`, { method: "POST" });
      toast.success(action === "send" ? "Message envoyé." : action === "archive" ? "Message archivé." : "Supprimé.");
      void list.mutate();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Action impossible.");
    }
  }

  async function refreshWeird() {
    try {
      const res = await api<{ started: boolean }>("/admin/feed/refresh", { method: "POST" });
      toast(res.started ? "Rechargement lancé (quelques minutes)." : "Un rechargement est déjà en cours.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Rechargement impossible.");
    }
  }

  return (
    <section>
      <h2 className="section-title mt-0">Messages serveur</h2>
      <p className="hatnote mb-3">
        Affiché par-dessus la page chez tous les joueurs connectés, et à la prochaine visite des autres. Aussi depuis
        l&apos;infra : <code className="text-xs">node dist/cli/broadcast.js send --title … --body …</code>
      </p>
      <form
        className="grid grid-cols-1 gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) setConfirm("new");
        }}
      >
        <label className="sm:col-span-2">
          <span className="label">Titre</span>
          <input className="field" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="sm:col-span-2">
          <span className="label">Message</span>
          <textarea
            className="field min-h-28"
            value={body}
            maxLength={2_000}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Les quêtes du jour sont arrivées…"
          />
        </label>
        <label>
          <span className="label">Ton</span>
          <select className="field" value={tone} onChange={(e) => setTone(e.target.value as BroadcastDTO["tone"])}>
            {TONES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="label">Ne plus montrer après (facultatif)</span>
          <input
            type="datetime-local"
            className="field"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
          />
        </label>
        <label>
          <span className="label">Lien (facultatif : /quests ou https://…)</span>
          <input className="field" value={linkUrl} maxLength={300} onChange={(e) => setLinkUrl(e.target.value)} />
        </label>
        <label>
          <span className="label">Texte du lien</span>
          <input
            className="field"
            value={linkLabel}
            maxLength={40}
            disabled={!linkUrl.trim()}
            onChange={(e) => setLinkLabel(e.target.value)}
            placeholder="Voir"
          />
        </label>
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          <button type="submit" className="btn btn-primary" disabled={busy || !ready}>
            <Send className="size-4" aria-hidden />
            Envoyer à tout le monde
          </button>
          <button type="button" className="btn" disabled={busy || !ready} onClick={() => void create(false)}>
            Garder en brouillon
          </button>
        </div>
      </form>

      {list.error && <ErrorBox error={list.error} retry={() => list.mutate()} />}
      {list.data && list.data.length > 0 && (
        <ul className="mt-5 divide-y divide-line rounded-xl border border-line bg-panel">
          {list.data.map((m) => (
            <li
              key={m.id}
              className={`flex flex-wrap items-start gap-3 p-3 ${m.status === "archived" ? "opacity-60" : ""}`}
            >
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{m.title}</p>
                <p className="line-clamp-2 text-sm text-muted">{m.body}</p>
                <p className="tnum mt-1 text-xs text-faint">
                  {STATUS[m.status]}
                  {m.sentAt ? ` ${relative(m.sentAt)}` : ""} · {TONES.find((t) => t.value === m.tone)?.label}
                  {m.status !== "draft" && (
                    <>
                      {" "}
                      · <Eye className="inline size-3 align-[-0.1rem]" aria-hidden /> vu par {fmt(m.reads)}
                    </>
                  )}
                </p>
              </div>
              <div className="flex gap-1">
                {m.status === "draft" && (
                  <button type="button" className="btn btn-sm" onClick={() => setConfirm(m)}>
                    <Send className="size-3.5" aria-hidden />
                    Envoyer
                  </button>
                )}
                {m.status === "sent" && (
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => void act(m, "archive")}>
                    <Archive className="size-3.5" aria-hidden />
                    Archiver
                  </button>
                )}
                {m.status !== "sent" && (
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost text-danger"
                    onClick={() => void act(m, "delete")}
                    aria-label={`Supprimer ${m.title}`}
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-line-strong p-3">
        <p className="text-sm text-muted">
          Fil d&apos;activité : les catégories « bizarres » de Wikipédia sont rechargées chaque lundi.
        </p>
        <button type="button" className="btn btn-sm" onClick={() => void refreshWeird()}>
          <RefreshCw className="size-3.5" aria-hidden />
          Recharger maintenant
        </button>
      </div>

      <ConfirmDialog
        open={confirm !== null}
        title="Envoyer à tout le monde ?"
        confirmLabel="Envoyer"
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm === "new") void create(true);
          else if (confirm) void act(confirm, "send");
        }}
      >
        Le message s&apos;affiche tout de suite chez les joueurs connectés, et à la prochaine visite des autres.
      </ConfirmDialog>
    </section>
  );
}
