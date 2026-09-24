"use client";

import { TRADE_MAX_CARDS_PER_SIDE } from "@palacards/game";
import type { CardDTO, Page, TradeDTO } from "@palacards/shared";
import { Check, Search } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { RaritySigil } from "@/components/Card";
import { Thumb } from "@/components/market";
import { api, ApiError } from "@/lib/api";
import { fmt } from "@/lib/format";
import { useMe } from "@/lib/game";
import { useDebounced } from "@/lib/use-debounced";

/** Liste de cartes cochables (une collection), avec recherche. */
function Picker({
  source,
  selected,
  onToggle,
  emptyText,
  allowed,
}: {
  source: string | null;
  selected: Set<number>;
  onToggle: (c: CardDTO) => void;
  emptyText: string;
  allowed: Set<number>;
}) {
  const [q, setQ] = useState("");
  const query = useDebounced(q);
  const url = source ? `${source}${source.includes("?") ? "&" : "?"}limit=60${query.trim() ? `&q=${encodeURIComponent(query.trim())}` : ""}` : null;
  const { data, error } = useSWR<Page<CardDTO>>(url);
  return (
    <div className="flex min-h-0 flex-col gap-2">
      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-faint" />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrer" aria-label="Filtrer les cartes" className="field h-9 min-h-0 pl-8 text-sm" disabled={!source} />
      </div>
      <ul className="flex max-h-[22rem] flex-col gap-1 overflow-y-auto rounded-md border border-line bg-bg p-1">
        {!source ? (
          <li className="p-3 text-sm text-faint">{emptyText}</li>
        ) : error ? (
          <li className="p-3 text-sm text-danger">{error instanceof Error ? error.message : "Chargement impossible."}</li>
        ) : !data ? (
          <li className="h-40 animate-pulse rounded bg-panel" />
        ) : data.items.length === 0 ? (
          <li className="p-3 text-sm text-faint">Aucune carte.</li>
        ) : (
          data.items.map((c) => {
            const on = selected.has(c.instanceId!);
            const locked = !!c.locked && !on && !allowed.has(c.instanceId!);
            return (
              <li key={c.instanceId}>
                <button
                  type="button"
                  aria-pressed={on}
                  disabled={locked}
                  onClick={() => onToggle(c)}
                  className={`flex w-full items-center gap-2 rounded-md p-1.5 text-left transition-colors duration-150 disabled:opacity-40 ${on ? "bg-accent/12 outline outline-1 outline-accent/60" : "hover:bg-panel-2"}`}
                >
                  <Thumb card={c} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-1 font-serif">{c.title}</span>
                    <span className="tnum flex items-center gap-1.5 text-xs text-faint">
                      <RaritySigil rarity={c.rarity} /> ATK {fmt(c.atk)} · DEF {fmt(c.def)}
                      {locked && " · réservée"}
                    </span>
                  </span>
                  <span className={`grid size-5 shrink-0 place-items-center rounded border ${on ? "border-accent bg-accent text-accent-ink" : "border-line-strong"}`} aria-hidden>
                    {on && <Check className="size-3.5" strokeWidth={3} />}
                  </span>
                </button>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}

function Composer() {
  const router = useRouter();
  const params = useSearchParams();
  const counterId = params.get("counter");
  const { me } = useMe();
  const { data: parent } = useSWR<TradeDTO[]>(counterId ? "/trades?box=received" : null);
  const counterOf = parent?.find((t) => String(t.id) === counterId);

  const [to, setTo] = useState(params.get("to") ?? "");
  const partner = useDebounced(counterOf ? counterOf.from.username : to.trim(), 400);
  // Contre-offre : les cartes de l'offre reçue sont réservées par elle, mais libérées à l'envoi.
  const allowed = new Set(counterOf ? [...counterOf.give, ...counterOf.want].map((c) => c.instanceId!) : []);
  const [give, setGive] = useState<Set<number>>(() => new Set(params.get("give") ? [Number(params.get("give"))] : []));
  const [want, setWant] = useState<Set<number>>(new Set());
  const [givePw, setGivePw] = useState("");
  const [wantPw, setWantPw] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  // Contre-offre : on part de l'offre reçue, côtés inversés.
  const [seeded, setSeeded] = useState(false);
  if (counterOf && !seeded) {
    setSeeded(true);
    setGive(new Set(counterOf.want.map((c) => c.instanceId!)));
    setWant(new Set(counterOf.give.map((c) => c.instanceId!)));
    setGivePw(counterOf.toPw ? String(counterOf.toPw) : "");
    setWantPw(counterOf.fromPw ? String(counterOf.fromPw) : "");
  }

  const toggle = (setter: typeof setGive) => (c: CardDTO) =>
    setter((s) => {
      const next = new Set(s);
      if (next.has(c.instanceId!)) next.delete(c.instanceId!);
      else if (next.size < TRADE_MAX_CARDS_PER_SIDE) next.add(c.instanceId!);
      else toast(`${TRADE_MAX_CARDS_PER_SIDE} cartes maximum de chaque côté.`);
      return next;
    });

  const partnerOk = partner.length >= 3 && partner.toLowerCase() !== me?.username;
  const empty = give.size + want.size === 0 && !Number(givePw) && !Number(wantPw);

  async function submit() {
    setBusy(true);
    const body = { give: [...give], want: [...want], givePw: Number(givePw) || 0, wantPw: Number(wantPw) || 0, message: message.trim() || undefined };
    try {
      if (counterOf) await api(`/trades/${counterOf.id}/counter`, { body });
      else await api("/trades", { body: { ...body, to: partner } });
      toast.success(counterOf ? "Contre-offre envoyée." : "Proposition envoyée.");
      router.push("/trades?box=sent");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Envoi impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="page-title">{counterOf ? "Contre-offre" : "Proposer un échange"}</h1>
        <p className="hatnote mt-2">Coche les cartes de chaque côté et ajoute des points wiki si besoin. Ce que tu proposes reste réservé jusqu’à la réponse.</p>
      </div>

      {!counterOf && (
        <label className="max-w-sm">
          <span className="label">Avec qui ?</span>
          <input className="field" value={to} onChange={(e) => setTo(e.target.value)} placeholder="Pseudo de ton ami" autoCapitalize="none" spellCheck={false} />
        </label>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="flex flex-col gap-3">
          <h2 className="section-title mt-0">
            Tu donnes <span className="tnum text-base text-faint">({give.size})</span>
          </h2>
          <Picker source="/collection?sort=rarity" selected={give} onToggle={toggle(setGive)} emptyText="" allowed={allowed} />
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted">+ points wiki</span>
            <input inputMode="numeric" className="field tnum h-9 min-h-0 w-28 text-right" value={givePw} onChange={(e) => setGivePw(e.target.value.replace(/\D/g, ""))} placeholder="0" />
            <span className="text-xs text-faint">{me && `(${fmt(me.wallet.available)} disponibles)`}</span>
          </label>
        </section>
        <section className="flex flex-col gap-3">
          <h2 className="section-title mt-0">
            Tu demandes <span className="tnum text-base text-faint">({want.size})</span>
          </h2>
          <Picker
            allowed={allowed}
            source={partnerOk ? `/players/${encodeURIComponent(partner)}/collection` : null}
            selected={want}
            onToggle={toggle(setWant)}
            emptyText="Indique d’abord le pseudo de ton ami pour voir sa collection."
          />
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted">+ points wiki</span>
            <input inputMode="numeric" className="field tnum h-9 min-h-0 w-28 text-right" value={wantPw} onChange={(e) => setWantPw(e.target.value.replace(/\D/g, ""))} placeholder="0" />
          </label>
        </section>
      </div>

      <label>
        <span className="label">Message (facultatif)</span>
        <textarea className="field min-h-20" maxLength={280} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Allez, ta Tour Eiffel contre mon Mont Blanc ?" />
      </label>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-ghost" onClick={() => router.back()}>
          Annuler
        </button>
        <button type="button" className="btn btn-primary" disabled={busy || empty || (!counterOf && !partnerOk)} onClick={submit}>
          {counterOf ? "Envoyer la contre-offre" : "Envoyer la proposition"}
        </button>
      </div>
    </div>
  );
}

export default function NewTradePage() {
  return (
    <Suspense fallback={<div className="h-72 animate-pulse rounded-md bg-panel" />}>
      <Composer />
    </Suspense>
  );
}
