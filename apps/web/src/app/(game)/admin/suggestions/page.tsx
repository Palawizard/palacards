"use client";

import {
  SUGGESTION_KINDS,
  SUGGESTION_LIMITS,
  SUGGESTION_STATUSES,
  type AdminSuggestionDTO,
  type SuggestionKind,
  type SuggestionStatus,
} from "@palacards/shared";
import { Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { AutomationPanel, automationInFlight } from "@/components/SuggestionAutomation";
import { KindTag, StatusPill } from "@/components/Suggestions";
import { ConfirmDialog, Empty, ErrorBox, Select } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { relative } from "@/lib/format";
import { useMe } from "@/lib/game";
import { KINDS, STATUSES } from "@/lib/suggestions";

interface AdminList {
  items: AdminSuggestionDTO[];
  counts: Record<SuggestionStatus, number>;
}

type Filter = SuggestionStatus | "all";
const FILTERS: { value: Filter; label: string }[] = [
  { value: "new", label: "À traiter" },
  { value: "accepted", label: "Retenues" },
  { value: "done", label: "Faites" },
  { value: "declined", label: "Pas retenues" },
  { value: "all", label: "Toutes" },
];

function subscribeHash(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

function SuggestionRow({
  s,
  fresh,
  onChanged,
  onReload,
  onDelete,
}: {
  s: AdminSuggestionDTO;
  fresh: boolean;
  onChanged: (s: AdminSuggestionDTO) => void;
  onReload: () => void;
  onDelete: () => void;
}) {
  const [reply, setReply] = useState(s.reply ?? "");
  const [busy, setBusy] = useState(false);
  const dirty = reply.trim() !== (s.reply ?? "");

  async function patch(body: { status?: SuggestionStatus; reply?: string | null }, ok: string) {
    setBusy(true);
    try {
      const updated = await api<AdminSuggestionDTO>(`/admin/suggestions/${s.id}`, { method: "PATCH", body });
      onChanged({ ...s, ...updated });
      toast.success(ok);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Modification impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li id={`suggestion-${s.id}`} className="scroll-mt-24 rounded-xl border border-line bg-panel p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <KindTag kind={s.kind} />
        {fresh && <StatusPill status="new" admin />}
        <span className="tnum text-xs text-faint">
          {s.author ? (
            <Link href={`/u/${s.author.username.toLowerCase()}`} className="article-link">
              {s.author.displayName}
            </Link>
          ) : (
            "Compte supprimé"
          )}{" "}
          · {relative(s.createdAt)}
        </span>
        <button
          type="button"
          className="btn btn-sm btn-ghost ml-auto px-2 text-faint hover:text-danger"
          onClick={onDelete}
          aria-label={`Supprimer « ${s.title} »`}
          title="Supprimer"
        >
          <Trash2 aria-hidden className="size-4" />
        </button>
      </div>
      <h2 className="mt-1 text-base font-semibold leading-snug">{s.title}</h2>
      <p className="mt-1 max-w-[75ch] whitespace-pre-wrap text-sm leading-relaxed text-muted">{s.body}</p>

      <AutomationPanel
        s={s}
        onChanged={onReload}
        onUseReply={(text) => {
          setReply(text);
          document.getElementById(`reply-${s.id}`)?.focus();
        }}
      />

      <div className="mt-4 flex flex-col gap-3 border-t-2 border-dashed border-line pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-faint">Statut</span>
          <div role="radiogroup" aria-label={`Statut de « ${s.title} »`} className="pc-segment">
            {SUGGESTION_STATUSES.map((st) => (
              <button
                key={st}
                type="button"
                role="radio"
                aria-checked={s.status === st}
                disabled={busy}
                onClick={() => s.status !== st && void patch({ status: st }, `Statut : ${STATUSES[st].admin}.`)}
              >
                {STATUSES[st].admin}
              </button>
            ))}
          </div>
        </div>
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (dirty)
              void patch({ reply: reply.trim() || null }, reply.trim() ? "Réponse envoyée." : "Réponse retirée.");
          }}
        >
          <label className="sr-only" htmlFor={`reply-${s.id}`}>
            Réponse à {s.author?.displayName ?? "l'auteur"}
          </label>
          <textarea
            id={`reply-${s.id}`}
            className="field min-h-20 text-sm leading-relaxed"
            value={reply}
            maxLength={SUGGESTION_LIMITS.reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder={`Répondre à ${s.author?.displayName ?? "l'auteur"} (visible sur sa page Suggestions, il est prévenu)`}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-faint">
              {s.repliedAt ? `Réponse envoyée ${relative(s.repliedAt)}` : "Pas encore de réponse"}
            </span>
            <button type="submit" className="btn btn-sm btn-primary" disabled={!dirty || busy}>
              {s.reply && !reply.trim() ? "Retirer la réponse" : s.reply ? "Modifier la réponse" : "Répondre"}
            </button>
          </div>
        </form>
      </div>
    </li>
  );
}

export default function AdminSuggestionsPage() {
  const { me, mutateMe } = useMe();
  // Tant qu'une suggestion attend Claude (tri ou branche), la liste se met à jour toute seule.
  const list = useSWR<AdminList>(me?.isAdmin ? "/admin/suggestions" : null, {
    refreshInterval: (d) => (d && automationInFlight(d.items) ? 15_000 : 0),
  });
  const [filter, setFilter] = useState<Filter>("new");
  const [kind, setKind] = useState<"" | SuggestionKind>("");
  const [confirm, setConfirm] = useState<AdminSuggestionDTO | null>(null);
  /** Traitées pendant la visite : elles restent affichées dans le filtre en cours (le temps d'y répondre). */
  const [touched, setTouched] = useState<Set<number>>(new Set());
  /** Suggestions pas encore ouvertes à l'arrivée sur la page : marquées « À traiter » pendant la visite. */
  const [fresh, setFresh] = useState<Set<number> | null>(null);
  if (list.data && fresh === null) setFresh(new Set(list.data.items.filter((s) => !s.seen).map((s) => s.id)));

  // Ouverture de la liste : plus de pastille dans le menu.
  const unseen = fresh?.size ?? 0;
  useEffect(() => {
    if (!unseen) return;
    void api("/admin/suggestions/seen", { method: "POST" })
      .then(() => mutateMe((m) => (m ? { ...m, newSuggestions: 0 } : m), { revalidate: false }))
      .catch(() => {});
  }, [unseen, mutateMe]);

  // Lien direct (Discord) vers une suggestion : affichée quel que soit le filtre, puis amenée à l'écran.
  const hash = useSyncExternalStore(
    subscribeHash,
    () => window.location.hash,
    () => "",
  );
  const target = Number(hash.match(/^#suggestion-(\d+)$/)?.[1]) || null;
  const ready = !!list.data;
  useEffect(() => {
    if (!ready || target === null) return;
    document.getElementById(`suggestion-${target}`)?.scrollIntoView({ block: "start" });
  }, [ready, target]);

  if (me && !me.isAdmin) return <p className="text-muted">Page réservée aux admins.</p>;

  const items = (list.data?.items ?? []).filter(
    (s) =>
      (filter === "all" || s.status === filter || touched.has(s.id) || s.id === target) && (!kind || s.kind === kind),
  );
  const total = list.data ? list.data.items.length : 0;

  function replace(updated: AdminSuggestionDTO) {
    setTouched((t) => new Set(t).add(updated.id));
    void list.mutate(
      (d) => {
        if (!d) return d;
        const before = d.items.find((x) => x.id === updated.id);
        const counts = { ...d.counts };
        if (before && before.status !== updated.status) {
          counts[before.status]--;
          counts[updated.status]++;
        }
        return { counts, items: d.items.map((x) => (x.id === updated.id ? updated : x)) };
      },
      { revalidate: false },
    );
  }

  async function remove(s: AdminSuggestionDTO) {
    try {
      await api(`/admin/suggestions/${s.id}`, { method: "DELETE" });
      toast.success("Suggestion supprimée.");
      void list.mutate();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Suppression impossible.");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="page-title">Suggestions reçues</h1>
        <p className="hatnote mt-2 tnum">
          {list.data
            ? `${total} suggestion${total > 1 ? "s" : ""}, dont ${list.data.counts.new} à traiter. Un changement de statut ou une réponse prévient l'auteur.`
            : "Chargement…"}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Filtrer par statut" className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => {
            const n = f.value === "all" ? total : (list.data?.counts[f.value] ?? 0);
            return (
              <button
                key={f.value}
                type="button"
                className="chip"
                aria-pressed={filter === f.value}
                onClick={() => {
                  setFilter(f.value);
                  setTouched(new Set());
                }}
              >
                {f.label}
                <span className="tnum opacity-70">{n}</span>
              </button>
            );
          })}
        </div>
        <span className="ml-auto">
          <Select
            label="Type"
            value={kind}
            onChange={setKind}
            options={[
              { value: "", label: "Tous les types" },
              ...SUGGESTION_KINDS.map((k) => ({ value: k, label: KINDS[k].label })),
            ]}
          />
        </span>
      </div>

      {list.error ? (
        <ErrorBox error={list.error} retry={() => list.mutate()} />
      ) : !list.data ? (
        <div className="flex flex-col gap-3" aria-busy>
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-44 animate-pulse rounded-xl bg-panel" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <Empty title={filter === "new" && !kind ? "Tout est traité" : "Aucune suggestion ici"}>
          {filter === "new" && !kind
            ? "Les nouvelles suggestions des joueurs arriveront ici, avec une pastille dans le menu."
            : "Change de filtre pour voir les autres."}
        </Empty>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((s) => (
            <SuggestionRow
              key={s.id}
              s={s}
              fresh={!!fresh?.has(s.id) && s.status === "new"}
              onChanged={replace}
              onReload={() => void list.mutate()}
              onDelete={() => setConfirm(s)}
            />
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={!!confirm}
        danger
        title="Supprimer cette suggestion ?"
        confirmLabel="Supprimer"
        onConfirm={() => confirm && void remove(confirm)}
        onClose={() => setConfirm(null)}
      >
        « {confirm?.title} » disparaît aussi de la page de son auteur. Pour garder une trace, préfère le statut « Pas
        retenue ».
      </ConfirmDialog>
    </div>
  );
}
