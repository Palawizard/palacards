"use client";

import {
  PORTFOLIO_ACCENTS,
  PORTFOLIO_CARDS_MAX,
  PORTFOLIO_DESCRIPTION_MAX,
  PORTFOLIO_NAME_MAX,
  PORTFOLIO_SHARED_MAX_PLAYERS,
} from "@palacards/game";
import type {
  CardDTO,
  Page,
  PortfolioCardDTO,
  PortfolioDesignItemDTO,
  PortfolioDTO,
  PortfolioOwnerDTO,
} from "@palacards/shared";
import {
  ChevronLeft,
  ChevronRight,
  GripVertical,
  ImageUp,
  Lock,
  LogOut,
  Plus,
  Star,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import useSWR, { type KeyedMutator } from "swr";
import useSWRInfinite from "swr/infinite";
import { Card, CardGrid } from "@/components/Card";
import {
  CollectionFilterBar,
  useCollectionFilters,
  type CollectionFilterOptions,
} from "@/components/CollectionFilters";
import { Avatar } from "@/components/Avatar";
import { participates, portfolioBackgroundSrc, PortfolioShell } from "@/components/Portfolio";
import { CardSkeletons, ConfirmDialog, Empty, ErrorBox, LoadMore } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { preparePortfolioBackground } from "@/lib/avatar-image";
import { fmt } from "@/lib/format";
import { useMe } from "@/lib/game";
import { dragTransform, moveItem, useGridDrag } from "@/lib/use-grid-drag";

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

// ---------------------------------------------------------------------------
// Cartes : ordre (poignée, flèches), vedette, retrait, ajout
// ---------------------------------------------------------------------------

function CardsEditor({ p, me, mutate }: { p: PortfolioDTO; me: string; mutate: KeyedMutator<PortfolioDTO> }) {
  const [order, setOrder] = useState<PortfolioCardDTO[]>(p.cards);
  // Portfolio partagé : chacun retire ses cartes, le propriétaire celles de tous.
  const shared = p.members.length > 0;
  const canRemove = (c: PortfolioCardDTO) => p.mine || c.by === me;
  const names = new Map([p.owner, ...p.members].map((m) => [m.username, m.displayName]));
  const [synced, setSynced] = useState(p.cards);
  const [picking, setPicking] = useState(false);
  const [announce, setAnnounce] = useState("");
  /** Déplacement au clavier : pas d'animation (geste répété, le résultat doit être immédiat). */
  const [instant, setInstant] = useState(false);
  const handles = useRef(new Map<number, HTMLButtonElement>());

  const save = useCallback(
    async (next: PortfolioCardDTO[], previous: PortfolioCardDTO[]) => {
      setOrder(next);
      try {
        const dto = await api<PortfolioDTO>(`/portfolios/${p.id}/cards`, {
          method: "PUT",
          body: { cards: next.map((c) => ({ instanceId: c.instanceId, featured: c.featured })) },
        });
        void mutate(dto, { revalidate: false });
      } catch (err) {
        setOrder(previous);
        toast.error(errorText(err, "Cartes non enregistrées."));
      }
    },
    [p.id, mutate],
  );

  const { drag, startDrag, cellRef } = useGridDrag({
    order,
    setOrder,
    synced,
    idOf: (c) => c.instanceId!,
    onDrop: (next, before, card) => {
      setAnnounce(`${card.title} : place ${next.indexOf(card) + 1} sur ${next.length}.`);
      void save(next, before);
    },
  });
  // Le portfolio rechargé fait foi, sauf pendant un glissement.
  if (p.cards !== synced && !drag) {
    setSynced(p.cards);
    setOrder(p.cards);
  }

  function shift(index: number, by: number, keyboard = false) {
    const to = index + by;
    if (to < 0 || to >= order.length) return;
    const card = order[index]!;
    setInstant(keyboard);
    void save(moveItem(order, index, to), order);
    setAnnounce(`${card.title} : place ${to + 1} sur ${order.length}.`);
    if (keyboard) requestAnimationFrame(() => handles.current.get(card.instanceId!)?.focus());
  }

  function feature(card: PortfolioCardDTO) {
    const on = !card.featured;
    setInstant(false);
    // Une seule carte en vedette : la nouvelle remplace l'ancienne.
    void save(
      order.map((c) => ({ ...c, featured: c.instanceId === card.instanceId ? on : false })),
      order,
    );
    setAnnounce(on ? `${card.title} est en vedette.` : `${card.title} n’est plus en vedette.`);
  }

  function remove(card: PortfolioCardDTO) {
    setInstant(false);
    void save(
      order.filter((c) => c.instanceId !== card.instanceId),
      order,
    );
    setAnnounce(`${card.title} retirée du portfolio.`);
  }

  function add(cards: CardDTO[]) {
    setPicking(false);
    const known = new Set(order.map((c) => c.instanceId));
    const fresh = cards
      .filter((c) => !known.has(c.instanceId))
      .slice(0, PORTFOLIO_CARDS_MAX - order.length)
      .map((c) => ({ ...c, featured: false, by: me }));
    if (!fresh.length) return;
    setInstant(false);
    void save([...order, ...fresh], order);
    toast.success(fresh.length > 1 ? `${fresh.length} cartes ajoutées.` : `${fresh[0]!.title} ajoutée.`);
  }

  const full = order.length >= PORTFOLIO_CARDS_MAX;

  return (
    <section aria-labelledby="pf-cards-title" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 id="pf-cards-title" className="pf-title flex-1 font-display text-2xl">
          Cartes{" "}
          <span className="pf-muted tnum font-sans text-sm font-semibold normal-case">
            {order.length} / {PORTFOLIO_CARDS_MAX}
          </span>
        </h2>
        <p className="pf-muted text-sm">
          Poignée ou flèches pour l’ordre, étoile pour la vedette.
          {shared && !p.mine && " Tu ne retires que tes cartes."}
        </p>
      </div>
      <ol className="pf-grid">
        {order.map((card, i) => {
          const lifted = drag?.id === card.instanceId;
          return (
            <motion.li
              key={card.instanceId}
              ref={cellRef(card.instanceId!)}
              layout={lifted ? false : "position"}
              transition={instant ? { duration: 0 } : { type: "spring", duration: 0.38, bounce: 0.12 }}
              className="pf-cell"
              data-lifted={lifted || undefined}
            >
              {lifted && <div aria-hidden className="slot absolute inset-x-0 top-0 aspect-[5/7]" />}
              <div
                className="pf-lift relative"
                data-featured={card.featured || undefined}
                style={lifted && drag ? { transform: dragTransform(drag, i) } : undefined}
              >
                <Card card={card} href={null} prefetch={false} />
                <button
                  type="button"
                  className="pf-star"
                  aria-pressed={card.featured}
                  aria-label={card.featured ? `Retirer ${card.title} de la vedette` : `Mettre ${card.title} en vedette`}
                  title={card.featured ? "En vedette" : "Mettre en vedette"}
                  onClick={() => feature(card)}
                >
                  <Star aria-hidden className="size-4" strokeWidth={2.25} />
                </button>
              </div>
              <div className="pc-arrange-bar" role="group" aria-label={`Place de ${card.title}`}>
                <button
                  type="button"
                  className="pc-arrange-btn"
                  aria-label={`Avancer ${card.title}`}
                  disabled={i === 0}
                  onClick={() => shift(i, -1)}
                >
                  <ChevronLeft aria-hidden className="size-4" />
                </button>
                <button
                  type="button"
                  ref={(el) => {
                    if (el) handles.current.set(card.instanceId!, el);
                    else handles.current.delete(card.instanceId!);
                  }}
                  className="pc-arrange-btn pc-grip"
                  aria-label={`Déplacer ${card.title}, place ${i + 1} sur ${order.length} (flèches)`}
                  onPointerDown={(e) => {
                    setInstant(false);
                    startDrag(e, card);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                      e.preventDefault();
                      shift(i, -1, true);
                    } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                      e.preventDefault();
                      shift(i, 1, true);
                    }
                  }}
                >
                  <GripVertical aria-hidden className="size-4" />
                  <span className="tnum text-xs font-bold">{i + 1}</span>
                </button>
                <button
                  type="button"
                  className="pc-arrange-btn"
                  aria-label={`Reculer ${card.title}`}
                  disabled={i === order.length - 1}
                  onClick={() => shift(i, 1)}
                >
                  <ChevronRight aria-hidden className="size-4" />
                </button>
                {shared && card.by !== me && (
                  <span
                    className="ml-auto min-w-0 truncate px-1 text-xs text-muted"
                    title={`Carte de ${names.get(card.by) ?? card.by}`}
                  >
                    {names.get(card.by) ?? card.by}
                  </span>
                )}
                {canRemove(card) && (
                  <button
                    type="button"
                    className={`pc-arrange-btn pc-arrange-remove ${shared && card.by !== me ? "" : "ml-auto"}`}
                    aria-label={`Retirer ${card.title} du portfolio`}
                    onClick={() => remove(card)}
                  >
                    <X aria-hidden className="size-4" />
                  </button>
                )}
              </div>
            </motion.li>
          );
        })}
        {!full && (
          <li>
            <button
              type="button"
              className="pc-showcase-empty pf-add"
              onClick={() => setPicking(true)}
              aria-label={`Ajouter des cartes (place ${order.length + 1} sur ${PORTFOLIO_CARDS_MAX})`}
            >
              <span aria-hidden className="pc-showcase-empty-num font-display">
                {order.length + 1}
              </span>
              <span className="pc-showcase-empty-cta whitespace-nowrap">
                <Plus aria-hidden className="size-4" />
                Ajouter
              </span>
            </button>
          </li>
        )}
      </ol>
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
      <CardsPicker
        open={picking}
        inside={new Set(order.map((c) => c.instanceId!))}
        room={PORTFOLIO_CARDS_MAX - order.length}
        onPick={add}
        onClose={() => setPicking(false)}
      />
    </section>
  );
}

/** Choix de plusieurs cartes de sa collection d'un coup, avec les filtres et le tri de la collection. */
function CardsPicker({
  open,
  onClose,
  ...rest
}: {
  open: boolean;
  inside: Set<number>;
  room: number;
  onPick: (cards: CardDTO[]) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="pf-picker-title"
      className="pc-picker m-auto max-h-[min(46rem,calc(100dvh-2rem))] w-[min(56rem,calc(100vw-2rem))] flex-col rounded-2xl border border-line-strong bg-panel p-0 text-text shadow-pop backdrop:bg-black/60 open:flex"
    >
      {/* Monté à l'ouverture seulement : la recherche et la sélection repartent de zéro à chaque fois. */}
      {open && <PickerBody onClose={onClose} {...rest} />}
    </dialog>
  );
}

function PickerBody({
  inside,
  room,
  onPick,
  onClose,
}: {
  inside: Set<number>;
  room: number;
  onPick: (cards: CardDTO[]) => void;
  onClose: () => void;
}) {
  // Filtres propres au sélecteur : ceux de la page Collection (et son adresse) n'en sont pas touchés.
  const { value: f, set, reset, params } = useCollectionFilters();
  const options = useSWR<CollectionFilterOptions>("/collection/summary");
  const [chosen, setChosen] = useState<CardDTO[]>([]);
  const query = `${params}${params ? "&" : ""}sort=${f.sort}&limit=60`;
  const list = useSWRInfinite<Page<CardDTO>>((i, prev) =>
    prev && !prev.nextCursor ? null : `/collection?${query}&page=${i}`,
  );
  const items = list.data?.flatMap((p) => p.items) ?? [];
  const done = !!list.data && !list.data[list.data.length - 1]?.nextCursor;
  const loadMore = useCallback(() => {
    if (!list.isValidating) void list.setSize((s) => s + 1);
  }, [list]);
  const left = room - chosen.length;

  function toggle(card: CardDTO) {
    setChosen((list) =>
      list.some((c) => c.instanceId === card.instanceId)
        ? list.filter((c) => c.instanceId !== card.instanceId)
        : list.length < room
          ? [...list, card]
          : list,
    );
  }

  return (
    <>
      <div className="flex items-center gap-3 border-b-2 border-dashed border-line px-5 py-4">
        <h2 id="pf-picker-title" className="flex-1 font-display text-2xl uppercase">
          Ajouter des cartes
        </h2>
        <button type="button" className="btn btn-sm btn-ghost px-2" onClick={onClose} aria-label="Fermer">
          <X aria-hidden className="size-5" />
        </button>
      </div>
      {/* Sur mobile, les filtres défilent avec la liste pour lui laisser la hauteur ; au-delà, ils restent en haut. */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5">
        <CollectionFilterBar
          value={f}
          onChange={set}
          onReset={reset}
          options={options.data}
          owner
          className="py-4 sm:sticky sm:top-0 sm:z-10 sm:-mx-5 sm:bg-panel sm:px-5"
        />
        {list.error ? (
          <ErrorBox error={list.error} retry={() => list.mutate()} />
        ) : !list.data ? (
          <CardSkeletons count={8} />
        ) : items.length === 0 ? (
          <Empty title={params ? "Aucune carte ne correspond" : "Ta collection est vide"}>
            {params ? "Essaie d’autres filtres." : "Ouvre un paquet pour tirer tes premières cartes."}
          </Empty>
        ) : (
          <>
            <CardGrid dense>
              {items.map((card) => {
                const already = inside.has(card.instanceId!);
                const rank = chosen.findIndex((c) => c.instanceId === card.instanceId) + 1;
                const on = rank > 0;
                return (
                  <button
                    key={card.instanceId}
                    type="button"
                    className="pc-pick relative text-left disabled:cursor-not-allowed"
                    disabled={already || (!on && left <= 0)}
                    aria-pressed={on}
                    onClick={() => toggle(card)}
                  >
                    <Card card={card} href={null} className={already ? "opacity-40" : ""} />
                    {already && <span className="pc-pick-note">Déjà dedans</span>}
                    {on && (
                      <span className="pf-pick-rank" aria-hidden>
                        {rank}
                      </span>
                    )}
                  </button>
                );
              })}
            </CardGrid>
            <LoadMore onVisible={loadMore} loading={list.isValidating} done={done} />
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-3">
        <p className="tnum flex-1 text-sm text-muted" aria-live="polite">
          {chosen.length
            ? `${chosen.length} carte${chosen.length > 1 ? "s" : ""} choisie${chosen.length > 1 ? "s" : ""}`
            : "Touche les cartes à ajouter."}{" "}
          {left <= 0 ? "Le portfolio sera plein." : `Encore ${left} place${left > 1 ? "s" : ""}.`}
        </p>
        <button type="button" className="btn" onClick={onClose}>
          Annuler
        </button>
        <button type="button" className="btn btn-primary" disabled={!chosen.length} onClick={() => onPick(chosen)}>
          Ajouter{chosen.length ? ` (${chosen.length})` : ""}
        </button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Nom et description
// ---------------------------------------------------------------------------

function InfoForm({ p, mutate }: { p: PortfolioDTO; mutate: KeyedMutator<PortfolioDTO> }) {
  const [name, setName] = useState(p.name);
  const [description, setDescription] = useState(p.description);
  const [busy, setBusy] = useState(false);
  const changed = name.trim() !== p.name || description.trim() !== p.description;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const dto = await api<PortfolioDTO>(`/portfolios/${p.id}`, {
        method: "PATCH",
        body: { name: name.trim(), description: description.trim() },
      });
      void mutate(dto, { revalidate: false });
      toast.success("Enregistré.");
    } catch (err) {
      toast.error(errorText(err, "Modification non enregistrée."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" aria-labelledby="pf-info-title">
      <h2 id="pf-info-title" className="section-title !mb-0 mt-0">
        Titre
      </h2>
      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        Nom
        <input
          className="field"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={PORTFOLIO_NAME_MAX}
          required
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        <span>
          Description <span className="font-normal text-faint">(facultative)</span>
        </span>
        <textarea
          className="field min-h-24 py-2"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={PORTFOLIO_DESCRIPTION_MAX}
        />
      </label>
      <button type="submit" className="btn btn-sm self-start" disabled={busy || !changed || !name.trim()}>
        Enregistrer
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Design : fond, cadre, accent (gratuits, gagnés, achetés, image envoyée)
// ---------------------------------------------------------------------------

/** Ce qu'il faut pour avoir un design pas encore à soi. */
function lockNote(d: PortfolioDesignItemDTO) {
  if (d.source === "shop") return `${fmt(d.price ?? 0)} PW`;
  return d.condition ?? "Bientôt";
}

function DesignPanel({ p, mutate }: { p: PortfolioDTO; mutate: KeyedMutator<PortfolioDTO> }) {
  const designs = useSWR<PortfolioDesignItemDTO[]>("/portfolios/designs");
  const { me, mutateMe } = useMe();
  const [busy, setBusy] = useState(false);
  const [buying, setBuying] = useState<PortfolioDesignItemDTO | null>(null);
  const file = useRef<HTMLInputElement>(null);

  async function apply(change: Partial<Pick<PortfolioDTO["design"], "background" | "frame" | "accent">>) {
    const before = p;
    void mutate({ ...p, design: { ...p.design, ...change } }, { revalidate: false });
    try {
      const dto = await api<PortfolioDTO>(`/portfolios/${p.id}`, { method: "PATCH", body: change });
      void mutate(dto, { revalidate: false });
    } catch (err) {
      void mutate(before, { revalidate: false });
      toast.error(errorText(err, "Design non enregistré."));
    }
  }

  function choose(d: PortfolioDesignItemDTO) {
    if (d.owned) void apply(d.slot === "background" ? { background: d.key } : { frame: d.key });
    else if (d.source === "shop") setBuying(d);
  }

  async function buy(d: PortfolioDesignItemDTO) {
    setBuying(null);
    setBusy(true);
    try {
      await api(`/portfolios/designs/${d.key}/buy`, { method: "POST" });
      await designs.mutate();
      void mutateMe();
      toast.success(`${d.name} est à toi, pour tous tes portfolios.`);
      await apply(d.slot === "background" ? { background: d.key } : { frame: d.key });
    } catch (err) {
      toast.error(errorText(err, "Achat impossible."));
    } finally {
      setBusy(false);
    }
  }

  async function upload(f: File) {
    setBusy(true);
    try {
      const image = await preparePortfolioBackground(f);
      await api(`/portfolios/${p.id}/background`, { method: "PUT", body: { image } });
      await mutate();
      toast.success("Image de fond enregistrée.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Image non enregistrée.");
    } finally {
      setBusy(false);
      if (file.current) file.current.value = "";
    }
  }

  async function removeImage() {
    setBusy(true);
    try {
      await api(`/portfolios/${p.id}/background`, { method: "DELETE" });
      await mutate();
    } catch (err) {
      toast.error(errorText(err, "Image non retirée."));
    } finally {
      setBusy(false);
    }
  }

  if (designs.error) return <ErrorBox error={designs.error} retry={() => designs.mutate()} />;
  if (!designs.data) return <div className="h-96 animate-pulse rounded-xl bg-panel" aria-busy />;
  const backgrounds = designs.data.filter((d) => d.slot === "background");
  const frames = designs.data.filter((d) => d.slot === "frame");
  const { design } = p;

  const swatch = (d: PortfolioDesignItemDTO, preview: { background: string; frame: string }) => {
    const on = d.slot === "background" ? design.background === d.key : design.frame === d.key;
    const locked = !d.owned;
    const earned = locked && d.source !== "shop";
    return (
      <div key={d.key} className="flex min-w-0 flex-col gap-1">
        <button
          type="button"
          role="radio"
          aria-checked={on}
          className="pf-swatch disabled:cursor-not-allowed"
          disabled={busy || earned}
          onClick={() => choose(d)}
          aria-label={`${d.name}${locked ? ` (${earned ? `à gagner : ${lockNote(d)}` : `à acheter : ${lockNote(d)}`})` : ""}`}
        >
          <PortfolioShell
            id={p.id}
            design={{ ...design, ...preview, backgroundVersion: null }}
            className="!shadow-none"
            pageClassName="!p-2"
          >
            <span className="pf-rule !h-[3px] !w-6" aria-hidden />
          </PortfolioShell>
          {locked && (
            <span className="absolute right-1.5 top-1.5 grid size-6 place-items-center rounded-full bg-black/60 text-white">
              <Lock aria-hidden className="size-3.5" />
            </span>
          )}
        </button>
        <span className="truncate text-xs font-semibold" aria-hidden>
          {d.name}
        </span>
        {locked && (
          <span className="text-xs leading-snug text-faint [text-wrap:pretty]" aria-hidden>
            {lockNote(d)}
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-5">
      <section aria-labelledby="pf-bg-title" className="flex flex-col gap-2.5">
        <h2 id="pf-bg-title" className="section-title !mb-0 mt-0">
          Fond
        </h2>
        <div role="radiogroup" aria-labelledby="pf-bg-title" className="grid grid-cols-3 gap-x-2 gap-y-3">
          {backgrounds.map((d) => swatch(d, { background: d.key, frame: design.frame }))}
          {design.backgroundVersion && (
            <div className="flex min-w-0 flex-col gap-1">
              <button
                type="button"
                role="radio"
                aria-checked={design.background === "image"}
                aria-label="Ton image"
                className="pf-swatch"
                disabled={busy}
                onClick={() => apply({ background: "image" })}
              >
                <span
                  className="block h-full bg-cover bg-center"
                  style={{ backgroundImage: `url("${portfolioBackgroundSrc(p.id, design.backgroundVersion)}")` }}
                />
              </button>
              <span className="truncate text-xs font-semibold" aria-hidden>
                Ton image
              </span>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={file}
            type="file"
            accept="image/*"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
            }}
          />
          <button type="button" className="btn btn-sm" disabled={busy} onClick={() => file.current?.click()}>
            <ImageUp aria-hidden className="size-4" />
            {design.backgroundVersion ? "Changer d’image" : "Envoyer une image"}
          </button>
          {design.backgroundVersion && (
            <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={removeImage}>
              Retirer l’image
            </button>
          )}
        </div>
        <p className="text-xs text-faint">
          Ton image, recadrée en 16:10, sert de fond derrière les cartes. Pas de contenu choquant : les admins peuvent
          la retirer.
        </p>
      </section>

      <section aria-labelledby="pf-frame-title" className="flex flex-col gap-2.5">
        <h2 id="pf-frame-title" className="section-title !mb-0 mt-0">
          Cadre
        </h2>
        <div role="radiogroup" aria-labelledby="pf-frame-title" className="grid grid-cols-3 gap-x-2 gap-y-3">
          {frames.map((d) =>
            swatch(d, { background: design.background === "image" ? "papier" : design.background, frame: d.key }),
          )}
        </div>
      </section>

      <section aria-labelledby="pf-accent-title" className="flex flex-col gap-2.5">
        <h2 id="pf-accent-title" className="section-title !mb-0 mt-0">
          Couleur
        </h2>
        <div role="radiogroup" aria-labelledby="pf-accent-title" className="flex flex-wrap gap-2.5">
          {PORTFOLIO_ACCENTS.map((a) => (
            <button
              key={a.key}
              type="button"
              role="radio"
              aria-checked={design.accent === a.key}
              aria-label={a.name}
              title={a.name}
              className="pf-dot"
              data-accent={a.key}
              disabled={busy}
              onClick={() => apply({ accent: a.key })}
            />
          ))}
        </div>
      </section>

      <ConfirmDialog
        open={!!buying}
        title={buying ? `Acheter ${buying.slot === "background" ? "le fond" : "le cadre"} ${buying.name} ?` : ""}
        confirmLabel={buying ? `Acheter pour ${fmt(buying.price ?? 0)} PW` : "Acheter"}
        onConfirm={() => buying && buy(buying)}
        onClose={() => setBuying(null)}
      >
        Il sera à toi pour tous tes portfolios. Il te reste {fmt(me?.wallet.available ?? 0)} PW.
      </ConfirmDialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Partage (suggestion n° 125) : amis invités, retrait, visibilité
// ---------------------------------------------------------------------------

interface Friend {
  id: string;
  username: string;
  displayName: string;
}

const VISIBILITIES = [
  { value: "public", label: "Tout le monde", note: "Page Communauté et ton profil, dès la première carte." },
  { value: "members", label: "Les participants seuls", note: "Caché des autres joueurs et de ton profil." },
] as const;

function SharePanel({ p, mutate }: { p: PortfolioDTO; mutate: KeyedMutator<PortfolioDTO> }) {
  const friends = useSWR<{ friends: Friend[] }>("/friends");
  const [picked, setPicked] = useState("");
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<PortfolioOwnerDTO | null>(null);
  const taken = new Set([...p.members, ...p.invited].map((m) => m.username));
  const candidates = (friends.data?.friends ?? []).filter((f) => !taken.has(f.username));
  const players = 1 + p.members.length + p.invited.length;
  const full = players >= PORTFOLIO_SHARED_MAX_PLAYERS;
  const target = picked || candidates[0]?.username || "";

  async function run(fn: () => Promise<unknown>, done?: string) {
    setBusy(true);
    try {
      await fn();
      await mutate();
      if (done) toast.success(done);
    } catch (err) {
      toast.error(errorText(err, "Modification non enregistrée."));
    } finally {
      setBusy(false);
    }
  }

  function invite(e: FormEvent) {
    e.preventDefault();
    const friend = candidates.find((f) => f.username === target);
    if (!friend) return;
    setPicked("");
    void run(
      () => api(`/portfolios/${p.id}/members`, { body: { username: friend.username } }),
      `Invitation envoyée à ${friend.displayName}.`,
    );
  }

  function revoke(m: PortfolioOwnerDTO) {
    setRemoving(null);
    void run(
      () => api(`/portfolios/${p.id}/members/${encodeURIComponent(m.username)}`, { method: "DELETE" }),
      `${m.displayName} n’a plus accès au portfolio.`,
    );
  }

  const person = (m: PortfolioOwnerDTO, status: string) => (
    <li key={m.username} className="flex items-center gap-2.5">
      <Avatar name={m.displayName} avatar={m.avatar} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{m.displayName}</span>
        <span className="block text-xs text-faint">{status}</span>
      </span>
      <button
        type="button"
        className="btn btn-sm btn-ghost px-2"
        disabled={busy}
        aria-label={`Retirer ${m.displayName} du portfolio`}
        title="Retirer"
        onClick={() => setRemoving(m)}
      >
        <X aria-hidden className="size-4" />
      </button>
    </li>
  );

  return (
    <section aria-labelledby="pf-share-title" className="flex flex-col gap-3">
      <h2 id="pf-share-title" className="section-title !mb-0 mt-0">
        Partage
        <span className="tnum font-sans text-sm font-semibold normal-case tracking-normal text-faint [font-stretch:100%]">
          {players} / {PORTFOLIO_SHARED_MAX_PLAYERS}
        </span>
      </h2>
      <p className="text-sm text-muted [text-wrap:pretty]">
        Tes amis invités y ajoutent leurs propres cartes, qui restent à eux. Toi seul choisis le titre et le design.
      </p>
      {players > 1 && (
        <ul className="flex flex-col gap-2">
          {p.members.map((m) => person(m, "Participe"))}
          {p.invited.map((m) => person(m, "Invitation envoyée"))}
        </ul>
      )}
      {full ? (
        <p className="text-sm text-muted">
          Le portfolio réunit déjà {PORTFOLIO_SHARED_MAX_PLAYERS} joueurs, toi compris.
        </p>
      ) : friends.error ? (
        <ErrorBox error={friends.error} retry={() => friends.mutate()} />
      ) : !friends.data ? (
        <div className="h-10 animate-pulse rounded-lg bg-panel" aria-busy />
      ) : candidates.length ? (
        <form onSubmit={invite} className="flex flex-col gap-1.5">
          <label className="label" htmlFor="pf-invite">
            Inviter un ami
          </label>
          <div className="flex gap-2">
            <select
              id="pf-invite"
              className="field min-w-0 flex-1"
              value={target}
              onChange={(e) => setPicked(e.target.value)}
            >
              {candidates.map((f) => (
                <option key={f.username} value={f.username}>
                  {f.displayName}
                </option>
              ))}
            </select>
            <button type="submit" className="btn btn-sm" disabled={busy}>
              <UserPlus aria-hidden className="size-4" /> Inviter
            </button>
          </div>
        </form>
      ) : (
        <p className="text-sm text-muted">
          {friends.data.friends.length ? "Tous tes amis sont déjà invités." : "Tu n’as pas encore d’ami à inviter."}{" "}
          <Link href="/friends" className="article-link">
            Ajouter des amis
          </Link>
        </p>
      )}

      <fieldset className="mt-1 flex flex-col gap-2">
        <legend className="label mb-1.5">Qui voit ce portfolio</legend>
        {VISIBILITIES.map((v) => (
          <label key={v.value} className="flex cursor-pointer items-start gap-2.5 text-sm">
            <input
              type="radio"
              name="pf-visibility"
              className="mt-0.5 accent-[var(--color-accent)]"
              checked={p.visibility === v.value}
              disabled={busy}
              onChange={() =>
                void run(() => api(`/portfolios/${p.id}`, { method: "PATCH", body: { visibility: v.value } }))
              }
            />
            <span>
              <span className="font-semibold">{v.label}</span>
              <span className="block text-xs text-faint">{v.note}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <ConfirmDialog
        open={!!removing}
        danger
        title={removing ? `Retirer ${removing.displayName} ?` : ""}
        confirmLabel="Retirer"
        onConfirm={() => removing && revoke(removing)}
        onClose={() => setRemoving(null)}
      >
        Ses cartes quittent le portfolio et restent dans sa collection. Tu pourras l’inviter de nouveau.
      </ConfirmDialog>
    </section>
  );
}

/** Ce qu'un ami participant voit à la place du titre et du design : qui compose le portfolio, et le départ. */
function MemberPanel({ p, me }: { p: PortfolioDTO; me: string }) {
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);

  async function leave() {
    setLeaving(false);
    try {
      await api(`/portfolios/${p.id}/members/${encodeURIComponent(me)}`, { method: "DELETE" });
      toast.success("Tu as quitté le portfolio.");
      router.push("/portfolios");
    } catch (err) {
      toast.error(errorText(err, "Départ impossible."));
    }
  }

  return (
    <section aria-labelledby="pf-share-title" className="flex flex-col gap-3">
      <h2 id="pf-share-title" className="section-title !mb-0 mt-0">
        Partage
      </h2>
      <p className="text-sm text-muted [text-wrap:pretty]">
        Portfolio de {p.owner.displayName} : ajoute tes cartes, change l’ordre ou la vedette. Le titre et le design
        restent à son choix.
      </p>
      <ul className="flex flex-col gap-2">
        {[p.owner, ...p.members].map((m) => (
          <li key={m.username} className="flex items-center gap-2.5 text-sm font-semibold">
            <Avatar name={m.displayName} avatar={m.avatar} size="sm" />
            <span className="truncate">{m.username === me ? "Toi" : m.displayName}</span>
          </li>
        ))}
      </ul>
      <button type="button" className="btn btn-sm btn-ghost self-start text-danger" onClick={() => setLeaving(true)}>
        <LogOut aria-hidden className="size-4" /> Quitter le portfolio
      </button>
      <ConfirmDialog
        open={leaving}
        danger
        title="Quitter ce portfolio ?"
        confirmLabel="Quitter"
        onConfirm={leave}
        onClose={() => setLeaving(false)}
      >
        Tes cartes en sortent et restent dans ta collection. Il faudra une nouvelle invitation pour revenir.
      </ConfirmDialog>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function EditPortfolioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data: p, error, mutate } = useSWR<PortfolioDTO>(`/portfolios/${encodeURIComponent(id)}`);
  const { me } = useMe();
  const [deleting, setDeleting] = useState(false);

  async function destroy() {
    setDeleting(false);
    try {
      await api(`/portfolios/${id}`, { method: "DELETE" });
      toast.success("Portfolio supprimé.");
      router.push("/portfolios");
    } catch (err) {
      toast.error(errorText(err, "Suppression impossible."));
    }
  }

  if (error) return <ErrorBox error={error} retry={() => mutate()} />;
  if (!p || !me) return <div className="h-[32rem] animate-pulse rounded-xl bg-panel" aria-busy />;
  if (!participates(p))
    return (
      <Empty title={p.role === "invited" ? "Rejoins d’abord ce portfolio" : "Ce portfolio n’est pas à toi"}>
        <Link href={`/portfolios/${p.id}`} className="article-link">
          Voir sa page
        </Link>
      </Empty>
    );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/portfolios" className="inline-flex items-center gap-1 text-sm text-muted hover:text-text">
          <ChevronLeft aria-hidden className="size-4" /> Portfolios
        </Link>
        <div className="flex flex-wrap gap-2">
          {/* Sur mobile, le design et le partage viennent après les cartes : raccourci. */}
          <a href="#pf-design" className="btn btn-sm lg:hidden">
            {p.mine ? "Design et partage" : "Partage"}
          </a>
          {(p.cardCount > 0 || !p.mine) && (
            <Link href={`/portfolios/${p.id}`} className="btn btn-sm">
              Voir la page
            </Link>
          )}
          {p.mine && (
            <button type="button" className="btn btn-sm btn-ghost text-danger" onClick={() => setDeleting(true)}>
              <Trash2 aria-hidden className="size-4" /> Supprimer
            </button>
          )}
        </div>
      </div>
      <div>
        <h1 className="page-title">{p.mine ? "Modifier le portfolio" : "Tes cartes dans ce portfolio"}</h1>
        <p className="hatnote mt-2">
          Chaque changement est enregistré aussitôt. Une carte vendue, échangée, recyclée, fusionnée ou upgradée quitte
          le portfolio.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_19rem] lg:items-start">
        <PortfolioShell id={p.id} design={p.design} pageClassName="flex flex-col gap-4">
          <header>
            <p className="pf-title font-display text-[clamp(1.8rem,1.3rem+1.8vw,2.8rem)]">{p.name}</p>
            <span className="pf-rule mt-2" aria-hidden />
            {p.description && <p className="mt-2 max-w-[65ch] text-sm [text-wrap:pretty]">{p.description}</p>}
          </header>
          <CardsEditor p={p} me={me.username} mutate={mutate} />
        </PortfolioShell>
        <aside id="pf-design" className="flex scroll-mt-20 flex-col gap-6">
          {p.mine ? (
            <>
              <InfoForm key={`${p.name}\n${p.description}`} p={p} mutate={mutate} />
              <SharePanel p={p} mutate={mutate} />
              <DesignPanel p={p} mutate={mutate} />
            </>
          ) : (
            <MemberPanel p={p} me={me.username} />
          )}
        </aside>
      </div>

      <ConfirmDialog
        open={deleting}
        danger
        title="Supprimer ce portfolio ?"
        confirmLabel="Supprimer"
        onConfirm={destroy}
        onClose={() => setDeleting(false)}
      >
        Tes cartes restent dans ta collection ; seule la page disparaît, avec ses j’aime.
      </ConfirmDialog>
    </div>
  );
}
