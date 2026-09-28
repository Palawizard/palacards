// Composants du marché (importés uniquement par des composants client).
import { ECONOMY, saleTax } from "@palacards/game";
import type { AuctionDTO, CardDTO, Page, ReferencePriceDTO } from "@palacards/shared";
import { ArrowLeft, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { api, ApiError, thumbSrc } from "@/lib/api";
import { countdown, fmt } from "@/lib/format";
import { useMe } from "@/lib/game";
import { useDebounced } from "@/lib/use-debounced";
import { Card } from "./Card";
import { CardSkeletons, ConfirmDialog, Empty } from "./ui";

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
      className={`${dim} relative grid shrink-0 place-items-center overflow-hidden rounded-lg border bg-panel-2 font-display text-xl`}
      style={{ borderColor: `var(--color-rarity-${card.rarity.toLowerCase()})` }}
      aria-hidden
    >
      {card.thumbUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- vignette Wikimedia
        <img src={thumbSrc(card.thumbUrl)} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" />
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
      Réf. {fmt(reference.median)} PW{" "}
      <span className="text-faint/80">
        ({fmt(reference.min)}–{fmt(reference.max)})
      </span>
    </span>
  );
}

/**
 * Une vente du marché : la vignette en grand, posée sur son étiquette de prix (offre, fin, actions).
 * `changed` : mise à jour arrivée en direct, affichée jusqu'à ce qu'elle soit vue.
 */
export function AuctionTile({
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
  const urgent = open && left < 60_000;
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
      className="pc-lot flex flex-col"
      data-changed={changed || undefined}
    >
      <Card card={auction.card} className="relative z-[1] mx-1.5 sm:mx-2" />
      <div className="pc-lot-tag -mt-4 flex flex-1 flex-col gap-2.5 px-3 pb-3 pt-6 max-sm:px-2">
        <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
          <p className="tnum min-w-0">
            <span className="font-display text-[1.75rem] leading-none">
              {fmt(auction.currentBid ?? auction.startPrice)}
            </span>{" "}
            <span className="text-xs font-semibold text-faint">PW</span>
            <span className="block truncate text-xs text-muted">
              {changed ? (
                <span className="font-semibold text-highlight">Nouvelle offre</span>
              ) : auction.currentBid === null ? (
                <>mise à prix · par {mine ? "toi" : auction.seller}</>
              ) : (
                <>
                  {auction.bidCount} offre{auction.bidCount > 1 ? "s" : ""}
                  {leading ? (
                    <span className="font-semibold text-good"> · tu mènes</span>
                  ) : (
                    auction.currentBidder && ` · ${auction.currentBidder}`
                  )}
                </>
              )}
            </span>
          </p>
          <span
            className={`tnum shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${
              urgent ? "bg-danger/15 text-danger" : "bg-panel-2 text-muted"
            }`}
            title={new Date(auction.endsAt).toLocaleString("fr-FR")}
          >
            {open ? countdown(left) : auction.status === "sold" ? "Vendue" : "Terminée"}
          </span>
        </div>

        <p className="truncate text-xs">
          <ReferenceLine reference={auction.reference} />
        </p>

        <div className="mt-auto flex flex-col gap-2 border-t-2 border-dashed border-line pt-2.5">
          {mine ? (
            open && auction.currentBid === null ? (
              <button
                type="button"
                className="btn btn-sm btn-danger w-full"
                disabled={busy}
                onClick={() => run(`/market/${auction.id}/cancel`, undefined, "Vente annulée.")}
              >
                Annuler la vente
              </button>
            ) : (
              <span className="text-center text-xs text-faint">Ta vente</span>
            )
          ) : open ? (
            <>
              <form
                className="flex flex-col gap-1.5 sm:flex-row"
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
                  className="field tnum h-8 min-h-0 w-full min-w-0 flex-1 text-right text-sm"
                />
                <button
                  type="submit"
                  className="btn btn-sm btn-primary shrink-0"
                  disabled={busy || Number(amount) < auction.minBid}
                >
                  Enchérir
                </button>
              </form>
              {auction.buyout !== null && (
                <>
                  <button
                    type="button"
                    className="btn btn-sm w-full justify-between"
                    disabled={busy}
                    onClick={() => setConfirmBuy(true)}
                  >
                    <span className="hidden sm:inline">Achat immédiat</span>
                    <span className="sm:hidden">Acheter</span>
                    <span className="tnum">{fmt(auction.buyout)} PW</span>
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
      </div>
    </li>
  );
}

/** Mise en vente depuis le marché : choisir une carte de sa collection, puis fixer le prix. */
export function SellDialog({ open, onClose, onListed }: { open: boolean; onClose: () => void; onListed: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [q, setQ] = useState("");
  const query = useDebounced(q);
  const [card, setCard] = useState<CardDTO | null>(null);
  const { data } = useSWR<Page<CardDTO>>(
    open
      ? `/collection?limit=60&sort=rarity${query.trim().length >= 2 ? `&q=${encodeURIComponent(query.trim())}` : ""}`
      : null,
  );
  const sellable = (data?.items ?? []).filter((c) => !c.locked);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={() => {
        setCard(null);
        setQ("");
        onClose();
      }}
      aria-labelledby="sell-title"
      className="m-auto flex max-h-[min(44rem,calc(100dvh-2rem))] w-[min(52rem,calc(100vw-1.5rem))] flex-col rounded-2xl border border-line-strong bg-panel p-0 text-text shadow-pop backdrop:bg-black/60 [&:not([open])]:hidden"
    >
      <header className="flex items-center justify-between gap-3 border-b-2 border-dashed border-line px-5 py-3">
        <h2 id="sell-title" className="font-display text-2xl uppercase">
          {card ? "Fixer le prix" : "Mettre en vente"}
        </h2>
        <button
          type="button"
          className="btn btn-sm btn-ghost px-2"
          onClick={() => ref.current?.close()}
          aria-label="Fermer"
        >
          <X aria-hidden className="size-4" />
        </button>
      </header>
      {card ? (
        <div className="grid gap-5 overflow-y-auto p-5 sm:grid-cols-[11rem_minmax(0,1fr)]">
          <div className="mx-auto flex w-40 flex-col gap-2 sm:w-full">
            <Card card={card} href={null} />
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setCard(null)}>
              <ArrowLeft aria-hidden className="size-4" /> Changer de carte
            </button>
          </div>
          <SellForm
            key={card.instanceId}
            card={card}
            onDone={() => {
              onListed();
              ref.current?.close();
            }}
            onCancel={() => setCard(null)}
          />
        </div>
      ) : (
        <div className="flex min-h-0 flex-col gap-3 p-5">
          <div className="relative">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-faint"
            />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Chercher dans ma collection"
              aria-label="Chercher dans ma collection"
              className="field h-9 min-h-0 pl-8 text-sm"
            />
          </div>
          <div className="-mx-1 min-h-0 overflow-y-auto px-1 pb-1">
            {!data ? (
              <CardSkeletons count={8} />
            ) : sellable.length === 0 ? (
              <Empty title={query.trim() ? "Aucune carte trouvée" : "Rien à vendre"}>
                {query.trim()
                  ? "Essaie un autre titre."
                  : "Ouvre des paquets : les cartes déjà en vente ou en échange n’apparaissent pas ici."}
              </Empty>
            ) : (
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-3">
                {sellable.map((c) => (
                  <li key={c.instanceId}>
                    <button
                      type="button"
                      className="pc-pick block w-full rounded-[12px] text-left"
                      onClick={() => setCard(c)}
                      aria-label={`Vendre ${c.title}`}
                    >
                      <Card card={c} href={null} prefetch={false} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </dialog>
  );
}

/** Mise en vente d'un exemplaire (depuis la fiche carte). */
export function SellForm({
  card,
  onDone,
  onCancel = onDone,
}: {
  card: CardDTO;
  onDone: () => void;
  onCancel?: () => void;
}) {
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
      await api("/market", {
        body: { instanceId: card.instanceId, startPrice: startN, buyout: buyN, durationMs: Number(duration) },
      });
      toast.success(`${card.title} est en vente.`);
      onDone();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Mise en vente impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-3 rounded-xl border border-line bg-panel-2 p-3 sm:grid-cols-3">
      <label>
        <span className="label">Mise à prix (PW)</span>
        <input
          ref={startRef}
          inputMode="numeric"
          className="field tnum"
          value={start}
          onChange={(e) => setStart(e.target.value.replace(/\D/g, ""))}
          placeholder={prices?.reference ? String(prices.reference.median) : "50"}
        />
      </label>
      <label>
        <span className="label">Achat immédiat (facultatif)</span>
        <input
          inputMode="numeric"
          className="field tnum"
          value={buyout}
          onChange={(e) => setBuyout(e.target.value.replace(/\D/g, ""))}
        />
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
        {startN >= 1 && ` (à ${fmt(startN)} PW, tu recevrais ${fmt(startN - saleTax(startN))} PW)`}.{" "}
        <ReferenceLine reference={prices?.reference ?? null} />
        {buyN !== null && buyN < startN && (
          <span className="block text-danger">L’achat immédiat doit être au moins égal à la mise à prix.</span>
        )}
      </p>
      <div className="flex items-end justify-end gap-2">
        <button type="button" className="btn btn-sm btn-ghost" onClick={onCancel}>
          Annuler
        </button>
        <button type="submit" className="btn btn-sm btn-primary" disabled={!valid || busy}>
          Mettre en vente
        </button>
      </div>
    </form>
  );
}
