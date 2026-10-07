"use client";

import { TRADE_MAX_CARDS_PER_SIDE } from "@palacards/game";
import type { CardDTO, Page, TradeDTO } from "@palacards/shared";
import { Check, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import useSWRInfinite from "swr/infinite";
import { RaritySigil } from "@/components/Card";
import { Thumb } from "@/components/market";
import {
  CollectionFilterBar,
  useCollectionFilters,
  type CollectionFilterOptions,
} from "@/components/CollectionFilters";
import { PlayerSearch } from "@/components/PlayerSearch";
import { LoadMore } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { fmt } from "@/lib/format";
import { useMe } from "@/lib/game";
import { useDebounced } from "@/lib/use-debounced";

/**
 * Une collection entière, cochable, avec les filtres de la page Collection (favoris seulement sur la sienne,
 * `owner` ; tags de l'ami s'il les partage), et la suite qui se charge en faisant défiler la liste.
 */
function Picker({
  source,
  owner,
  selected,
  onToggle,
  emptyText,
  allowed,
  label,
}: {
  source: string | null;
  owner: boolean;
  selected: Map<number, CardDTO>;
  onToggle: (c: CardDTO) => void;
  emptyText: string;
  allowed: Set<number>;
  label: string;
}) {
  const { value: f, set, params } = useCollectionFilters();
  const summary = useSWR<CollectionFilterOptions>(source && `${source}/summary`);
  const base = source ? `${source}?${params}${params ? "&" : ""}sort=${f.sort}&limit=40` : null;
  const list = useSWRInfinite<Page<CardDTO>>((i, prev) =>
    !base || (prev && !prev.nextCursor) ? null : `${base}&page=${i}`,
  );
  const items = list.data?.flatMap((p) => p.items) ?? [];
  const total = list.data?.[0]?.total;
  const done = !!list.data && !list.data[list.data.length - 1]?.nextCursor;
  const loadMore = useCallback(() => {
    if (!list.isValidating) void list.setSize((n) => n + 1);
  }, [list]);

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <CollectionFilterBar
        value={f}
        onChange={set}
        options={summary.data}
        owner={owner}
        label={label}
        disabled={!source}
        className="gap-2"
      />
      <ul
        className="flex h-[min(28rem,60dvh)] flex-col gap-1 overflow-y-auto overscroll-contain rounded-xl border border-line bg-bg p-1"
        aria-label={label}
      >
        {!source ? (
          <li className="p-3 text-sm text-faint">{emptyText}</li>
        ) : list.error ? (
          <li className="p-3 text-sm text-danger">
            {list.error instanceof Error ? list.error.message : "Chargement impossible."}
          </li>
        ) : !list.data ? (
          <li className="h-40 animate-pulse rounded bg-panel" />
        ) : items.length === 0 ? (
          <li className="p-3 text-sm text-faint">Aucune carte ne correspond.</li>
        ) : (
          <>
            {items.map((c) => {
              const on = selected.has(c.instanceId!);
              const locked = !!c.locked && !on && !allowed.has(c.instanceId!);
              return (
                <li key={c.instanceId}>
                  <button
                    type="button"
                    aria-pressed={on}
                    disabled={locked}
                    onClick={() => onToggle(c)}
                    className={`flex w-full items-center gap-2 rounded-lg p-1.5 text-left transition-colors duration-150 disabled:opacity-40 ${on ? "bg-accent/12 outline outline-1 outline-accent/60" : "hover:bg-panel-2"}`}
                  >
                    <Thumb card={c} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="line-clamp-1 font-display">{c.title}</span>
                        {c.shiny && (
                          <span className="pc-shiny-tag !static shrink-0 !text-[0.65rem]" title="Carte brillante">
                            Brillante
                          </span>
                        )}
                      </span>
                      <span className="tnum flex items-center gap-1.5 text-xs text-faint">
                        <RaritySigil rarity={c.rarity} /> ATK {fmt(c.atk)} · DEF {fmt(c.def)}
                        {c.level > 1 && ` · niv. ${c.level}`}
                        {locked && " · réservée"}
                      </span>
                    </span>
                    <span
                      className={`grid size-5 shrink-0 place-items-center rounded border ${on ? "border-accent bg-accent text-accent-ink" : "border-line-strong"}`}
                      aria-hidden
                    >
                      {on && <Check className="size-3.5" strokeWidth={3} />}
                    </span>
                  </button>
                </li>
              );
            })}
            {!done && (
              <li>
                <LoadMore onVisible={loadMore} loading={list.isValidating} done={done} />
              </li>
            )}
          </>
        )}
      </ul>
      {total !== undefined && (
        <p className="tnum text-xs text-faint" aria-live="polite">
          {fmt(items.length)} / {fmt(total)} carte{total > 1 ? "s" : ""} affichée{items.length > 1 ? "s" : ""}
        </p>
      )}
    </div>
  );
}

/** Cartes cochées d'un côté, toujours visibles même quand les filtres les cachent de la liste. */
function Chosen({ cards, onRemove }: { cards: CardDTO[]; onRemove: (c: CardDTO) => void }) {
  if (!cards.length) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Cartes choisies">
      {cards.map((c) => (
        <li
          key={c.instanceId}
          className="pc-tag max-w-full"
          style={{ borderColor: `var(--color-rarity-${c.rarity.toLowerCase()})` }}
        >
          <span className="truncate">{c.title}</span>
          <button type="button" className="pc-tag-remove" aria-label={`Retirer ${c.title}`} onClick={() => onRemove(c)}>
            <X aria-hidden className="size-3" strokeWidth={2.5} />
          </button>
        </li>
      ))}
    </ul>
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
  const giveParam = params.get("give");
  // `?give=<id>` (bouton « Échanger » d'une fiche) : la carte est cochée d'office, ses infos arrivent ensuite.
  const preset = useSWR<CardDTO[]>(giveParam ? `/collection/instances?ids=${giveParam}` : null);
  const [give, setGive] = useState<Map<number, CardDTO>>(new Map());
  const [want, setWant] = useState<Map<number, CardDTO>>(new Map());
  const [presetDone, setPresetDone] = useState(false);
  if (preset.data && !presetDone) {
    setPresetDone(true);
    setGive(new Map(preset.data.map((c) => [c.instanceId!, c])));
  }
  const [givePw, setGivePw] = useState("");
  const [wantPw, setWantPw] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  // Contre-offre : on part de l'offre reçue, côtés inversés.
  const [seeded, setSeeded] = useState(false);
  if (counterOf && !seeded) {
    setSeeded(true);
    setGive(new Map(counterOf.want.map((c) => [c.instanceId!, c])));
    setWant(new Map(counterOf.give.map((c) => [c.instanceId!, c])));
    setGivePw(counterOf.toPw ? String(counterOf.toPw) : "");
    setWantPw(counterOf.fromPw ? String(counterOf.fromPw) : "");
  }

  const toggle = (setter: typeof setGive) => (c: CardDTO) =>
    setter((s) => {
      const next = new Map(s);
      if (next.has(c.instanceId!)) next.delete(c.instanceId!);
      else if (next.size < TRADE_MAX_CARDS_PER_SIDE) next.set(c.instanceId!, c);
      else toast(`${TRADE_MAX_CARDS_PER_SIDE} cartes maximum de chaque côté.`);
      return next;
    });

  const partnerOk = partner.length >= 3 && partner.toLowerCase() !== me?.username;
  const empty = give.size + want.size === 0 && !Number(givePw) && !Number(wantPw);

  async function submit() {
    setBusy(true);
    const body = {
      give: [...give.keys()],
      want: [...want.keys()],
      givePw: Number(givePw) || 0,
      wantPw: Number(wantPw) || 0,
      message: message.trim() || undefined,
    };
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
        <p className="hatnote mt-2">
          Coche les cartes de chaque côté et ajoute des points wiki si besoin. Ce que tu proposes reste réservé jusqu’à
          la réponse.
        </p>
      </div>

      {!counterOf && (
        <label className="max-w-sm">
          <span className="label">Avec qui ?</span>
          <PlayerSearch value={to} onChange={setTo} placeholder="Pseudo de ton ami" />
        </label>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="flex flex-col gap-3">
          <h2 className="section-title mt-0">
            Tu donnes <span className="tnum text-base text-faint">({give.size})</span>
          </h2>
          <Chosen cards={[...give.values()]} onRemove={toggle(setGive)} />
          <Picker
            label="Ta collection"
            source="/collection"
            owner
            selected={give}
            onToggle={toggle(setGive)}
            emptyText=""
            allowed={allowed}
          />
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted">+ points wiki</span>
            <input
              inputMode="numeric"
              className="field tnum h-9 min-h-0 w-28 text-right"
              value={givePw}
              onChange={(e) => setGivePw(e.target.value.replace(/\D/g, ""))}
              placeholder="0"
            />
            <span className="text-xs text-faint">{me && `(${fmt(me.wallet.available)} disponibles)`}</span>
          </label>
        </section>
        <section className="flex flex-col gap-3">
          <h2 className="section-title mt-0">
            Tu demandes <span className="tnum text-base text-faint">({want.size})</span>
          </h2>
          <Chosen cards={[...want.values()]} onRemove={toggle(setWant)} />
          <Picker
            // Filtres remis à zéro d'un ami à l'autre : ses tags et boosters ne sont pas ceux du précédent.
            key={partnerOk ? partner : ""}
            label={partnerOk ? `Collection de ${partner}` : "Collection de ton ami"}
            allowed={allowed}
            source={partnerOk ? `/players/${encodeURIComponent(partner)}/collection` : null}
            owner={false}
            selected={want}
            onToggle={toggle(setWant)}
            emptyText="Indique d’abord le pseudo de ton ami pour voir sa collection."
          />
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted">+ points wiki</span>
            <input
              inputMode="numeric"
              className="field tnum h-9 min-h-0 w-28 text-right"
              value={wantPw}
              onChange={(e) => setWantPw(e.target.value.replace(/\D/g, ""))}
              placeholder="0"
            />
          </label>
        </section>
      </div>

      <label>
        <span className="label">Message (facultatif)</span>
        <textarea
          className="field min-h-20"
          maxLength={280}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Allez, ta Tour Eiffel contre mon Mont Blanc ?"
        />
      </label>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-ghost" onClick={() => router.back()}>
          Annuler
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || empty || (!counterOf && !partnerOk)}
          onClick={submit}
        >
          {counterOf ? "Envoyer la contre-offre" : "Envoyer la proposition"}
        </button>
      </div>
    </div>
  );
}

export default function NewTradePage() {
  return (
    <Suspense fallback={<div className="h-72 animate-pulse rounded-xl bg-panel" />}>
      <Composer />
    </Suspense>
  );
}
