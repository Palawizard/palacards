// Composants du marché (importés uniquement par des composants client).
import { ECONOMY, saleTax } from "@palacards/game";
import type { AuctionDTO, CardDTO, ReferencePriceDTO } from "@palacards/shared";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { api, ApiError } from "@/lib/api";
import { countdown, fmt } from "@/lib/format";
import { useMe } from "@/lib/game";
import { RaritySigil } from "./Card";
import { ConfirmDialog } from "./ui";

const DURATIONS = [
  { ms: 10 * 60_000, label: "10 minutes" },
  { ms: 60 * 60_000, label: "1 heure" },
  { ms: 6 * 60 * 60_000, label: "6 heures" },
  { ms: 24 * 60 * 60_000, label: "24 heures" },
].filter((d) => (ECONOMY.auctionDurationsMs as readonly number[]).includes(d.ms));

/** Vignette carrée d'un article (listes, échanges). */
export function Thumb({ card, size = "md" }: { card: CardDTO; size?: "sm" | "md" }) {
  const dim = size === "sm" ? "size-10" : "size-14";
  return (
    <span
      className={`${dim} relative grid shrink-0 place-items-center overflow-hidden rounded-md border bg-panel-2 font-serif text-xl`}
      style={{ borderColor: `var(--color-rarity-${card.rarity.toLowerCase()})` }}
      aria-hidden
    >
      {card.thumbUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- vignette Wikimedia
        <img src={card.thumbUrl} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" />
      ) : (
        card.title.slice(0, 1)
      )}
    </span>
  );
}

export function ReferenceLine({ reference }: { reference: ReferencePriceDTO | null }) {
  if (!reference) return <span className="text-faint">Aucune vente de référence</span>;
  return (
    <span className="tnum text-faint" title={`Médiane des ${reference.count} dernières ventes`}>
      Réf. {fmt(reference.median)} PW <span className="text-faint/80">({fmt(reference.min)}–{fmt(reference.max)})</span>
    </span>
  );
}

/** Une vente du marché. `changed` : mise à jour arrivée en direct, affichée jusqu'à ce qu'elle soit vue. */
export function AuctionRow({
  auction,
  now,
  changed,
  onSeen,
  onChanged,
}: {
  auction: AuctionDTO;
  now: number;
  changed: boolean;
  onSeen: () => void;
  onChanged: () => void;
}) {
  const { me } = useMe();
  const [amount, setAmount] = useState(String(auction.minBid));
  const [busy, setBusy] = useState(false);
  const [confirmBuy, setConfirmBuy] = useState(false);
  const left = new Date(auction.endsAt).getTime() - now;
  const mine = me?.id === auction.sellerId;
  const leading = me?.id === auction.currentBidderId;
  const open = auction.status === "open" && left > 0;
  const [prevMin, setPrevMin] = useState(auction.minBid);
  if (prevMin !== auction.minBid) {
    setPrevMin(auction.minBid);
    setAmount(String(auction.minBid));
  }

  async function run(path: string, body?: unknown, success?: string) {
    setBusy(true);
    try {
      await api(path, { method: "POST", body: body ?? {} });
      if (success) toast.success(success);
      onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Action impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li
      onMouseEnter={changed ? onSeen : undefined}
      onFocus={changed ? onSeen : undefined}
      className={`grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 px-3 py-3 transition-colors duration-500 sm:grid-cols-[auto_minmax(0,1.6fr)_minmax(0,1fr)_auto] sm:items-center sm:px-4 ${
        changed ? "bg-accent/10" : ""
      }`}
    >
      <Link href={`/card/${auction.card.cardId}`} className="row-span-2 sm:row-span-1">
        <Thumb card={auction.card} />
      </Link>
      <div className="min-w-0">
        <Link href={`/card/${auction.card.cardId}`} className="line-clamp-1 font-serif text-lg leading-snug hover:underline">
          {auction.card.title}
        </Link>
        <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
          <RaritySigil rarity={auction.card.rarity} />
          <span className="tnum">
            ATK {fmt(auction.card.atk)} · DEF {fmt(auction.card.def)} · S{auction.card.season}
          </span>
          <span>par {mine ? "toi" : auction.seller}</span>
        </p>
        <p className="mt-0.5 text-xs">
          <ReferenceLine reference={auction.reference} />
        </p>
      </div>
      <div className="tnum col-start-2 flex items-baseline gap-3 sm:col-start-auto sm:flex-col sm:items-end sm:gap-0">
        <span className="text-lg font-bold">
          {fmt(auction.currentBid ?? auction.startPrice)} <span className="text-xs font-normal text-faint">PW</span>
        </span>
        <span className="text-xs text-muted">
          {auction.currentBid === null
            ? "mise à prix"
            : `${auction.bidCount} offre${auction.bidCount > 1 ? "s" : ""}${leading ? " · tu mènes" : auction.currentBidder ? ` · ${auction.currentBidder}` : ""}`}
        </span>
        <span className={`text-xs ${open && left < 60_000 ? "font-semibold text-danger" : "text-faint"}`}>
          {open ? `fin dans ${countdown(left)}` : auction.status === "sold" ? "vendue" : "terminée"}
        </span>
        {changed && <span className="text-xs font-semibold text-accent">Nouvelle offre</span>}
      </div>
      <div className="col-span-2 flex flex-wrap items-center gap-2 sm:col-span-1 sm:justify-end">
        {mine ? (
          open && auction.currentBid === null ? (
            <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={() => run(`/market/${auction.id}/cancel`, undefined, "Vente annulée.")}>
              Annuler la vente
            </button>
          ) : (
            <span className="text-xs text-faint">Ta vente</span>
          )
        ) : open ? (
          <>
            <form
              className="flex items-center gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                void run(`/market/${auction.id}/bid`, { amount: Number(amount) }, "Offre enregistrée.");
              }}
            >
              <label className="sr-only" htmlFor={`bid-${auction.id}`}>
                Montant de l’offre
              </label>
              <input
                id={`bid-${auction.id}`}
                inputMode="numeric"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
                className="field tnum h-8 min-h-0 w-24 text-right text-sm"
              />
              <button type="submit" className="btn btn-sm btn-primary" disabled={busy || Number(amount) < auction.minBid}>
                Enchérir
              </button>
            </form>
            {auction.buyout !== null && (
              <>
                <button type="button" className="btn btn-sm" disabled={busy} onClick={() => setConfirmBuy(true)}>
                  Acheter {fmt(auction.buyout)}
                </button>
                <ConfirmDialog
                  open={confirmBuy}
                  title={`Acheter ${auction.card.title} ?`}
                  confirmLabel={`Acheter pour ${fmt(auction.buyout)} PW`}
                  onConfirm={() => run(`/market/${auction.id}/buy`, undefined, "Achat effectué !")}
                  onClose={() => setConfirmBuy(false)}
                >
                  Achat immédiat au prix fixé par le vendeur. La carte arrive tout de suite dans ta collection.
                </ConfirmDialog>
              </>
            )}
          </>
        ) : null}
      </div>
    </li>
  );
}

/** Mise en vente d'un exemplaire (depuis la fiche carte). */
export function SellForm({ card, onDone }: { card: CardDTO; onDone: () => void }) {
  const { data: prices } = useSWR<{ reference: ReferencePriceDTO | null }>(`/cards/${card.cardId}/prices`);
  const [start, setStart] = useState("");
  const [buyout, setBuyout] = useState("");
  const [duration, setDuration] = useState(String(DURATIONS[1]?.ms ?? 3_600_000));
  const [busy, setBusy] = useState(false);
  const startRef = useRef<HTMLInputElement>(null);
  useEffect(() => startRef.current?.focus(), []);
  const startN = Number(start);
  const buyN = buyout ? Number(buyout) : null;
  const valid = startN >= 1 && (buyN === null || buyN >= startN);

  async function submit(e: { preventDefault(): void }) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    try {
      await api("/market", { body: { instanceId: card.instanceId, startPrice: startN, buyout: buyN, durationMs: Number(duration) } });
      toast.success(`${card.title} est en vente.`);
      onDone();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Mise en vente impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-3 rounded-md border border-line bg-panel-2 p-3 sm:grid-cols-3">
      <label>
        <span className="label">Mise à prix (PW)</span>
        <input ref={startRef} inputMode="numeric" className="field tnum" value={start} onChange={(e) => setStart(e.target.value.replace(/\D/g, ""))} placeholder={prices?.reference ? String(prices.reference.median) : "50"} />
      </label>
      <label>
        <span className="label">Achat immédiat (facultatif)</span>
        <input inputMode="numeric" className="field tnum" value={buyout} onChange={(e) => setBuyout(e.target.value.replace(/\D/g, ""))} />
      </label>
      <label>
        <span className="label">Durée</span>
        <select className="field" value={duration} onChange={(e) => setDuration(e.target.value)}>
          {DURATIONS.map((d) => (
            <option key={d.ms} value={d.ms}>
              {d.label}
            </option>
          ))}
        </select>
      </label>
      <p className="text-xs leading-relaxed text-muted sm:col-span-2">
        Frais d’annonce : {ECONOMY.auctionListingFee} PW. Taxe de {ECONOMY.marketTaxRate * 100} % à la vente
        {startN >= 1 && ` (à ${fmt(startN)} PW, tu recevrais ${fmt(startN - saleTax(startN))} PW)`}. <ReferenceLine reference={prices?.reference ?? null} />
        {buyN !== null && buyN < startN && <span className="block text-danger">L’achat immédiat doit être au moins égal à la mise à prix.</span>}
      </p>
      <div className="flex items-end justify-end gap-2">
        <button type="button" className="btn btn-sm btn-ghost" onClick={onDone}>
          Annuler
        </button>
        <button type="submit" className="btn btn-sm btn-primary" disabled={!valid || busy}>
          Mettre en vente
        </button>
      </div>
    </form>
  );
}
