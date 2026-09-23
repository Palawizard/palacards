"use client";

import type { CardDTO, TradeDTO } from "@palacards/shared";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { RaritySigil } from "@/components/Card";
import { Thumb } from "@/components/market";
import { Empty, ErrorBox } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { countdown, fmt, relative } from "@/lib/format";
import { useMe } from "@/lib/game";
import { useNow } from "@/lib/use-now";

const BOXES = [
  { value: "received", label: "Reçus" },
  { value: "sent", label: "Envoyés" },
  { value: "history", label: "Historique" },
] as const;
type Box = (typeof BOXES)[number]["value"];

const STATUS: Record<string, string> = {
  accepted: "Accepté",
  declined: "Refusé",
  cancelled: "Annulé",
  expired: "Expiré",
  countered: "Contre-offre envoyée",
  pending: "En attente",
};

function Side({ title, cards, pw }: { title: string; cards: CardDTO[]; pw: number }) {
  return (
    <div className="min-w-0 flex-1">
      <h3 className="mb-1.5 text-xs font-semibold text-faint">{title}</h3>
      {cards.length === 0 && pw === 0 ? (
        <p className="text-sm text-faint">Rien</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {cards.map((c) => (
            <li key={c.instanceId}>
              <Link href={`/card/${c.cardId}`} className="flex items-center gap-2 rounded-md p-1 hover:bg-panel-2">
                <Thumb card={c} size="sm" />
                <span className="min-w-0">
                  <span className="line-clamp-1 font-serif">{c.title}</span>
                  <span className="tnum flex items-center gap-1.5 text-xs text-faint">
                    <RaritySigil rarity={c.rarity} /> ATK {fmt(c.atk)} · DEF {fmt(c.def)}
                  </span>
                </span>
              </Link>
            </li>
          ))}
          {pw > 0 && (
            <li className="tnum px-1 text-sm font-semibold">
              + {fmt(pw)} <span className="font-normal text-faint">PW</span>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function TradeItem({ trade, meId, now, onChanged }: { trade: TradeDTO; meId: string; now: number; onChanged: () => void }) {
  const incoming = trade.to.id === meId;
  const other = incoming ? trade.from : trade.to;
  const [busy, setBusy] = useState(false);
  // Du point de vue du joueur : ce qu'il reçoit et ce qu'il donne.
  const receive = incoming ? { cards: trade.give, pw: trade.fromPw } : { cards: trade.want, pw: trade.toPw };
  const give = incoming ? { cards: trade.want, pw: trade.toPw } : { cards: trade.give, pw: trade.fromPw };

  async function act(action: "accept" | "decline" | "cancel", ok: string) {
    setBusy(true);
    try {
      await api(`/trades/${trade.id}/${action}`, { method: "POST" });
      toast.success(ok);
      onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Action impossible.");
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-col gap-3 px-4 py-4">
      <p className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span>
          {incoming ? "De " : "À "}
          <Link href={`/u/${other.name.toLowerCase()}`} className="article-link font-semibold">
            {other.name}
          </Link>
          <span className="text-faint"> · {relative(trade.createdAt)}</span>
          {trade.parentId && <span className="text-faint"> · contre-offre</span>}
        </span>
        <span className="tnum text-xs text-faint">
          {trade.status === "pending" ? `expire dans ${countdown(new Date(trade.expiresAt).getTime() - now)}` : STATUS[trade.status]}
        </span>
      </p>
      {trade.message && <p className="rounded-md bg-panel-2 px-3 py-2 text-sm italic text-muted">« {trade.message} »</p>}
      <div className="flex flex-col gap-4 sm:flex-row">
        <Side title="Tu reçois" {...receive} />
        <div className="hidden w-px bg-line sm:block" aria-hidden />
        <Side title="Tu donnes" {...give} />
      </div>
      {trade.status === "pending" && (
        <div className="flex flex-wrap justify-end gap-2">
          {incoming ? (
            <>
              <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={() => act("decline", "Échange refusé.")}>
                Refuser
              </button>
              <Link href={`/trades/new?counter=${trade.id}`} className="btn btn-sm">
                Contre-offre
              </Link>
              <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => act("accept", "Échange conclu !")}>
                Accepter
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => act("cancel", "Proposition annulée.")}>
              Annuler la proposition
            </button>
          )}
        </div>
      )}
    </li>
  );
}

function Trades() {
  const router = useRouter();
  const params = useSearchParams();
  const box = (BOXES.find((b) => b.value === params.get("box"))?.value ?? "received") as Box;
  const { me } = useMe();
  const now = useNow(1000);
  const { data, error, mutate } = useSWR<TradeDTO[]>(`/trades?box=${box}`, { refreshInterval: 30_000 });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line-strong pb-1.5">
        <h1 className="font-serif text-[clamp(1.75rem,1.4rem+1.4vw,2.35rem)] leading-tight">Échanges</h1>
        <Link href="/trades/new" className="btn btn-sm btn-primary">
          Proposer un échange
        </Link>
      </div>
      <p className="hatnote -mt-2">Troc de cartes et de points wiki. Tes cartes proposées sont réservées tant que l’échange est en attente (72 h au plus).</p>

      <nav aria-label="Boîtes d'échanges" className="-mb-2 flex gap-1 border-b border-line">
        {BOXES.map((b) => (
          <button
            key={b.value}
            type="button"
            aria-current={box === b.value ? "page" : undefined}
            onClick={() => router.replace(b.value === "received" ? "/trades" : `/trades?box=${b.value}`)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm transition-colors duration-150 ${box === b.value ? "border-accent text-text" : "border-transparent text-muted hover:text-text"}`}
          >
            {b.label}
          </button>
        ))}
      </nav>

      {error ? (
        <ErrorBox error={error} retry={() => mutate()} />
      ) : !data || !me ? (
        <div className="h-60 animate-pulse rounded-md bg-panel" aria-busy />
      ) : data.length === 0 ? (
        <Empty title={box === "received" ? "Aucune proposition reçue" : box === "sent" ? "Aucune proposition en attente" : "Aucun échange terminé"}>
          Propose un troc depuis la fiche d’une carte ou le profil d’un ami.
        </Empty>
      ) : (
        <ul className="divide-y divide-line rounded-md border border-line bg-panel">
          {data.map((t) => (
            <TradeItem key={t.id} trade={t} meId={me.id} now={now} onChanged={() => mutate()} />
          ))}
        </ul>
      )}
    </div>
  );
}

export default function TradesPage() {
  return (
    <Suspense fallback={<div className="h-60 animate-pulse rounded-md bg-panel" />}>
      <Trades />
    </Suspense>
  );
}
