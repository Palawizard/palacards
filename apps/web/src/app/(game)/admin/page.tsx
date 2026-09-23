"use client";

import { useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { ConfirmDialog, ErrorBox } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { fmt, relative } from "@/lib/format";
import { useMe } from "@/lib/game";

interface Overview {
  economy: {
    supply: { total: number; locked: number; players: number; bonusPacks: number };
    flows: { reason: string; created: number; destroyed: number }[];
    cards: { instances: number; auctions: number; trades: number };
  };
  season: { active: number; startedAt: string | null; endsAt: string | null; cards: { season: number; cards: number }[]; nextLoaded: boolean };
  jobs: { name: string; queued: number; active: number; total: number }[];
}
interface LedgerRow {
  id: number;
  kind: string;
  delta: number;
  balanceAfter: number;
  reason: string;
  refId: string | null;
  createdAt: string;
  username: string | null;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-panel px-4 py-3">
      <dt className="text-xs text-faint">{label}</dt>
      <dd className="tnum text-xl font-semibold">{value}</dd>
    </div>
  );
}

export default function AdminPage() {
  const { me } = useMe();
  const { data, error, mutate } = useSWR<Overview>(me?.isAdmin ? "/admin" : null, { refreshInterval: 30_000 });
  const ledger = useSWR<LedgerRow[]>(me?.isAdmin ? "/admin/ledger" : null);
  const [username, setUsername] = useState("");
  const [pw, setPw] = useState("");
  const [packs, setPacks] = useState("");
  const [note, setNote] = useState("");
  const [confirmSeason, setConfirmSeason] = useState(false);

  if (me && !me.isAdmin) return <p className="text-muted">Page réservée aux admins.</p>;

  async function grant(e: { preventDefault(): void }) {
    e.preventDefault();
    try {
      const res = await api<{ balance: number; bonusPacks: number }>("/admin/grant", {
        body: { username: username.trim(), pw: Number(pw) || 0, packs: Number(packs) || 0, note: note.trim() || undefined },
      });
      toast.success(`Fait : ${username} a ${fmt(res.balance)} PW et ${res.bonusPacks} paquet(s) bonus.`);
      setPw("");
      setPacks("");
      void mutate();
      void ledger.mutate();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Don impossible.");
    }
  }

  async function newSeason() {
    try {
      const res = await api<{ from: number; to: number; copied: boolean }>("/admin/season", { method: "POST" });
      toast.success(`Saison ${res.to} lancée${res.copied ? " (cartes de la saison précédente reconduites)" : ""}.`);
      void mutate();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Bascule impossible.");
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <h1 className="page-title">Admin</h1>
      {error && <ErrorBox error={error} retry={() => mutate()} />}

      <section>
        <h2 className="section-title mt-0">Masse monétaire</h2>
        {data ? (
          <>
            <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-4">
              <Stat label="PW en circulation" value={fmt(data.economy.supply.total)} />
              <Stat label="dont bloqués" value={fmt(data.economy.supply.locked)} />
              <Stat label="Joueurs" value={fmt(data.economy.supply.players)} />
              <Stat label="Paquets bonus en stock" value={fmt(data.economy.supply.bonusPacks)} />
              <Stat label="Exemplaires" value={fmt(data.economy.cards.instances)} />
              <Stat label="Ventes ouvertes" value={fmt(data.economy.cards.auctions)} />
              <Stat label="Échanges en attente" value={fmt(data.economy.cards.trades)} />
              <Stat label="PW moyens / joueur" value={fmt(Math.round(data.economy.supply.total / Math.max(1, data.economy.supply.players)))} />
            </dl>
            <table className="tnum mt-4 w-full text-sm">
              <caption className="mb-1 text-left text-xs text-faint">Flux de PW sur 30 jours</caption>
              <thead>
                <tr className="text-left text-xs text-faint">
                  <th className="py-1.5 font-semibold">Motif</th>
                  <th className="py-1.5 text-right font-semibold">Créés</th>
                  <th className="py-1.5 text-right font-semibold">Détruits</th>
                </tr>
              </thead>
              <tbody>
                {data.economy.flows.map((f) => (
                  <tr key={f.reason} className="border-t border-line">
                    <td className="py-1.5">{f.reason}</td>
                    <td className="py-1.5 text-right text-accent">{f.created ? `+${fmt(f.created)}` : "—"}</td>
                    <td className="py-1.5 text-right text-danger">{f.destroyed ? `−${fmt(f.destroyed)}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <div className="h-40 animate-pulse rounded-md bg-panel" />
        )}
      </section>

      <section>
        <h2 className="section-title mt-0">Donner des PW ou des paquets</h2>
        <form onSubmit={grant} className="grid gap-3 sm:grid-cols-[1.4fr_1fr_1fr_1.6fr_auto] sm:items-end">
          <label>
            <span className="label">Pseudo</span>
            <input className="field" value={username} onChange={(e) => setUsername(e.target.value)} required />
          </label>
          <label>
            <span className="label">PW (négatif pour retirer)</span>
            <input className="field tnum" inputMode="numeric" value={pw} onChange={(e) => setPw(e.target.value.replace(/[^\d-]/g, ""))} />
          </label>
          <label>
            <span className="label">Paquets bonus</span>
            <input className="field tnum" inputMode="numeric" value={packs} onChange={(e) => setPacks(e.target.value.replace(/[^\d-]/g, ""))} />
          </label>
          <label>
            <span className="label">Note (journal)</span>
            <input className="field" value={note} onChange={(e) => setNote(e.target.value)} maxLength={80} />
          </label>
          <button type="submit" className="btn btn-primary" disabled={!username.trim() || (!Number(pw) && !Number(packs))}>
            Donner
          </button>
        </form>
      </section>

      <section>
        <h2 className="section-title mt-0">Saison</h2>
        {data && (
          <div className="flex flex-col gap-3 text-sm">
            <p>
              Saison active : <strong>{data.season.active}</strong>
              {data.season.endsAt && <span className="text-muted"> · bascule automatique {relative(data.season.endsAt)}</span>}
            </p>
            <p className="text-muted">
              Cartes chargées : {data.season.cards.map((c) => `saison ${c.season} (${fmt(c.cards)})`).join(", ")}.{" "}
              {data.season.nextLoaded
                ? "La saison suivante est prête (import chargé)."
                : "La saison suivante n’est pas chargée : la bascule reconduira les cartes actuelles."}
            </p>
            <div>
              <button type="button" className="btn btn-danger btn-sm" onClick={() => setConfirmSeason(true)}>
                Lancer la saison {data.season.active + 1} maintenant
              </button>
            </div>
          </div>
        )}
      </section>

      <section>
        <h2 className="section-title mt-0">Jobs</h2>
        <table className="tnum w-full text-sm">
          <tbody>
            {(data?.jobs ?? []).map((j) => (
              <tr key={j.name} className="border-b border-line">
                <td className="py-1.5 font-semibold">{j.name}</td>
                <td className="py-1.5 text-right text-muted">
                  {j.queued} en file · {j.active} en cours · {j.total} au total
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && !data.jobs.length && <p className="text-sm text-faint">pg-boss n’est pas démarré (tests).</p>}
      </section>

      <section>
        <h2 className="section-title mt-0">Journal</h2>
        <div className="overflow-x-auto">
          <table className="tnum w-full min-w-[36rem] text-sm">
            <tbody>
              {(ledger.data ?? []).map((l) => (
                <tr key={l.id} className="border-b border-line">
                  <td className="whitespace-nowrap py-1.5 pr-3 text-faint">{relative(l.createdAt)}</td>
                  <td className="py-1.5 pr-3 font-semibold">{l.username}</td>
                  <td className="py-1.5 pr-3">
                    {l.reason} <span className="text-faint">({l.kind})</span>
                  </td>
                  <td className={`py-1.5 pr-3 text-right ${l.delta > 0 ? "text-accent" : "text-danger"}`}>
                    {l.delta > 0 ? "+" : ""}
                    {fmt(l.delta)}
                  </td>
                  <td className="py-1.5 text-right text-faint">{fmt(l.balanceAfter)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <ConfirmDialog
        open={confirmSeason}
        danger
        title="Lancer une nouvelle saison ?"
        confirmLabel="Lancer la saison"
        onConfirm={newSeason}
        onClose={() => setConfirmSeason(false)}
      >
        Les classements de la saison sont archivés, l’Elo repart à 1 000 et les nouveaux tirages portent le tampon de la nouvelle édition. Les cartes possédées
        gardent leurs stats.
      </ConfirmDialog>
    </div>
  );
}
