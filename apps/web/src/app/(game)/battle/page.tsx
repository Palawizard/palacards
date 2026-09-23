"use client";

import { BATTLE_ROUNDS, DECK_SIZE, ECONOMY, ROUNDS_TO_WIN } from "@palacards/game";
import type { CardDTO } from "@palacards/shared";
import { Swords } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { DeckPicker } from "@/components/DeckPicker";
import { Empty, ErrorBox } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { relative } from "@/lib/format";
import { useMe, useSocketEvent } from "@/lib/game";

interface BattleSummary {
  id: number;
  mode: "live" | "async";
  status: "pending" | "declined" | "cancelled" | "active" | "finished";
  isChallenger: boolean;
  opponent: { id: string; name: string; username: string };
  score: { you: number; them: number };
  result: "win" | "loss" | "draw" | null;
  eloDelta: number | null;
  roundsPlayed: number;
  createdAt: string;
}

const RESULT: Record<string, string> = { win: "Victoire", loss: "Défaite", draw: "Nul" };

function ChallengeForm({ onDone }: { onDone: () => void }) {
  const params = useSearchParams();
  const router = useRouter();
  const [opponent, setOpponent] = useState(params.get("opponent") ?? "");
  const [mode, setMode] = useState<"async" | "live">("async");
  const [deck, setDeck] = useState<CardDTO[]>([]);
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    try {
      const res = await api<{ id: number }>("/battles", { body: { opponent: opponent.trim(), mode, deck: deck.map((c) => c.instanceId) } });
      toast.success("Défi envoyé !");
      onDone();
      router.push(`/battle/${res.id}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Défi impossible.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="infobox">
      <h2 className="infobox-head">Lancer un défi</h2>
      <div className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-end gap-4">
          <label className="min-w-48 flex-1">
            <span className="label">Adversaire</span>
            <input className="field" value={opponent} onChange={(e) => setOpponent(e.target.value)} placeholder="Pseudo d’un ami" autoCapitalize="none" spellCheck={false} />
          </label>
          <fieldset className="flex gap-1.5" aria-label="Mode">
            {(
              [
                ["async", "Asynchrone"],
                ["live", "En direct"],
              ] as const
            ).map(([v, label]) => (
              <button key={v} type="button" className="chip h-10 px-4" aria-pressed={mode === v} onClick={() => setMode(v)}>
                {label}
              </button>
            ))}
          </fieldset>
        </div>
        <p className="text-xs text-faint">
          {mode === "async"
            ? "Asynchrone : tu joues tes 5 manches maintenant, ton ami plus tard ; mêmes questions pour les deux."
            : "En direct : vous jouez ensemble, 10 secondes par question. Ton ami doit être connecté."}
        </p>
        <DeckPicker deck={deck} onChange={setDeck} />
        <div className="flex justify-end">
          <button type="button" className="btn btn-primary" disabled={busy || deck.length !== DECK_SIZE || opponent.trim().length < 3} onClick={submit}>
            <Swords aria-hidden className="size-4" /> Défier
          </button>
        </div>
      </div>
    </section>
  );
}

function AcceptPanel({ battle, onDone }: { battle: BattleSummary; onDone: () => void }) {
  const router = useRouter();
  const [deck, setDeck] = useState<CardDTO[]>([]);
  const [busy, setBusy] = useState(false);
  async function act(accept: boolean) {
    setBusy(true);
    try {
      if (accept) {
        await api(`/battles/${battle.id}/accept`, { body: { deck: deck.map((c) => c.instanceId) } });
        router.push(`/battle/${battle.id}`);
      } else {
        await api(`/battles/${battle.id}/refuse`, { method: "POST" });
        toast("Défi refusé.");
      }
      onDone();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Action impossible.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col gap-3 border-t border-line p-3">
      <DeckPicker deck={deck} onChange={setDeck} />
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={() => act(false)}>
          Refuser
        </button>
        <button type="button" className="btn btn-sm btn-primary" disabled={busy || deck.length !== DECK_SIZE} onClick={() => act(true)}>
          Accepter le duel
        </button>
      </div>
    </div>
  );
}

function Battles() {
  const { data, error, mutate } = useSWR<BattleSummary[]>("/battles");
  const { me } = useMe();
  const [accepting, setAccepting] = useState<number | null>(null);
  useSocketEvent("battle:update", () => void mutate());
  useSocketEvent("notification:new", (n) => {
    if (n.type.startsWith("battle_")) void mutate();
  });

  const incoming = data?.filter((x) => x.status === "pending" && !x.isChallenger) ?? [];
  const ongoing = data?.filter((x) => x.status === "active" || (x.status === "pending" && x.isChallenger)) ?? [];
  const history = data?.filter((x) => ["finished", "declined", "cancelled"].includes(x.status)) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="page-title">Bataille</h1>
        <p className="hatnote mt-2">
          Duel en {BATTLE_ROUNDS} manches : à chaque manche, une carte de chaque deck et la même question pour les deux. Bien répondre, et vite,
          multiplie l’attaque. Premier à {ROUNDS_TO_WIN} manches ; victoire {ECONOMY.battle.win} PW, défaite {ECONOMY.battle.loss} PW. Ton Elo :{" "}
          {me ? <span className="tnum font-semibold not-italic text-text">{me.elo ?? "…"}</span> : "…"}.
        </p>
      </div>

      {error && <ErrorBox error={error} retry={() => mutate()} />}

      {incoming.length > 0 && (
        <section>
          <h2 className="section-title mt-0">Défis reçus</h2>
          <ul className="flex flex-col gap-2">
            {incoming.map((x) => (
              <li key={x.id} className="rounded-md border border-accent/40 bg-panel">
                <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                  <span>
                    <strong>{x.opponent.name}</strong> te défie <span className="text-muted">({x.mode === "live" ? "en direct" : "asynchrone"}, {relative(x.createdAt)})</span>
                  </span>
                  {accepting !== x.id && (
                    <button type="button" className="btn btn-sm btn-primary" onClick={() => setAccepting(x.id)}>
                      Choisir mon deck
                    </button>
                  )}
                </div>
                {accepting === x.id && <AcceptPanel battle={x} onDone={() => { setAccepting(null); void mutate(); }} />}
              </li>
            ))}
          </ul>
        </section>
      )}

      {ongoing.length > 0 && (
        <section>
          <h2 className="section-title mt-0">En cours</h2>
          <ul className="divide-y divide-line rounded-md border border-line bg-panel">
            {ongoing.map((x) => (
              <li key={x.id}>
                <Link href={`/battle/${x.id}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 hover:bg-panel-2">
                  <span>
                    Contre <strong>{x.opponent.name}</strong> <span className="text-muted">· {x.mode === "live" ? "en direct" : "asynchrone"}</span>
                  </span>
                  <span className="text-sm text-muted">
                    {x.status === "pending" ? "en attente de réponse" : x.mode === "async" ? `${x.roundsPlayed}/${BATTLE_ROUNDS} manches jouées` : "en cours"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <ChallengeForm onDone={() => mutate()} />

      <section>
        <h2 className="section-title">Historique</h2>
        {!data ? (
          <div className="h-32 animate-pulse rounded-md bg-panel" />
        ) : history.length === 0 ? (
          <Empty title="Aucun duel terminé">Défie un ami pour commencer.</Empty>
        ) : (
          <ul className="divide-y divide-line rounded-md border border-line bg-panel">
            {history.map((x) => (
              <li key={x.id}>
                <Link href={`/battle/${x.id}`} className="grid grid-cols-[1fr_auto] items-center gap-2 px-3 py-2.5 hover:bg-panel-2 sm:grid-cols-[1fr_auto_auto]">
                  <span>
                    {x.status === "finished" ? (
                      <strong className={x.result === "win" ? "text-accent" : x.result === "loss" ? "text-danger" : ""}>{RESULT[x.result ?? "draw"]}</strong>
                    ) : (
                      <span className="text-muted">{x.status === "declined" ? "Refusé" : "Annulé"}</span>
                    )}{" "}
                    contre {x.opponent.name}
                  </span>
                  <span className="tnum text-sm">
                    {x.status === "finished" && `${x.score.you} – ${x.score.them}`}
                    {x.eloDelta !== null && x.status === "finished" && (
                      <span className={`ml-2 ${x.eloDelta >= 0 ? "text-accent" : "text-danger"}`}>
                        {x.eloDelta >= 0 ? "+" : ""}
                        {x.eloDelta}
                      </span>
                    )}
                  </span>
                  <span className="hidden text-xs text-faint sm:block">{relative(x.createdAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default function BattlePage() {
  return (
    <Suspense fallback={<div className="h-72 animate-pulse rounded-md bg-panel" />}>
      <Battles />
    </Suspense>
  );
}
