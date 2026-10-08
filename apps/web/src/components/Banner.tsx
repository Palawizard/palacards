"use client";

import { RARITY_LABELS } from "@palacards/game";
import type { BannerDTO, CardDTO, Page } from "@palacards/shared";
import { ImageUp, Images, Layers, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import useSWRInfinite from "swr/infinite";
import { Card, CardGrid, RaritySigil } from "@/components/Card";
import { CardImage } from "@/components/CardImage";
import {
  CollectionFilterBar,
  useCollectionFilters,
  type CollectionFilterOptions,
} from "@/components/CollectionFilters";
import { CardSkeletons, Empty, ErrorBox, LoadMore } from "@/components/ui";
import { api, API_BASE, thumbSrc } from "@/lib/api";
import { useArthropodVeil } from "@/lib/arthropods";
import { prepareBanner } from "@/lib/avatar-image";
import { useMe } from "@/lib/game";
import { useCardMedia } from "@/lib/media";

type ImageBanner = Extract<BannerDTO, { kind: "image" }>;
type CardBanner = Extract<BannerDTO, { kind: "card" }>;

/** URL de la bannière importée d'un joueur (versionnée : le navigateur la garde en cache tant qu'elle ne change pas). */
export function bannerSrc(banner: ImageBanner): string {
  return `${API_BASE}/banners/${encodeURIComponent(banner.userId)}?v=${encodeURIComponent(banner.version)}`;
}

/** Image de l'article d'une bannière-carte (null : pas encore chargée, ou arthropode à masquer). */
function useCardBannerSrc(banner: CardBanner | null) {
  const cardId = banner?.cardId ?? 0;
  const live = useCardMedia(cardId);
  const { me } = useMe();
  const veil = useArthropodVeil(cardId, !!me?.hideArthropods);
  const thumbUrl = live?.thumbUrl ?? banner?.thumbUrl;
  return { src: thumbUrl ? thumbSrc(thumbUrl) : null, visible: veil === "off" || veil === "shown" };
}

/**
 * Bannière en haut du profil : image importée ou carte de sa collection, sinon la couverture de l'album
 * (bannière par défaut). Sur son propre profil, boutons pour importer une image, choisir une carte, revenir à
 * l'image importée (`imageSaved`, quand une carte la remplace) ou à la bannière par défaut.
 */
export function ProfileBanner({
  banner,
  isMe,
  imageSaved = false,
  onChanged,
}: {
  banner: BannerDTO | null;
  isMe: boolean;
  imageSaved?: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);

  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    try {
      await action();
      onChanged();
      toast.success(done);
    } catch (err) {
      // Erreur de l'API ou de la préparation de l'image (format, poids) : message déjà en français.
      toast.error(err instanceof Error ? err.message : "Bannière non enregistrée.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="pc-banner relative h-28 overflow-hidden rounded-xl border border-line sm:h-40">
        {banner?.kind === "image" && (
          // eslint-disable-next-line @next/next/no-img-element -- image servie par l'API (déjà réduite à 1200 × 300 px)
          <img
            key={banner.version}
            src={bannerSrc(banner)}
            alt=""
            decoding="async"
            className="absolute inset-0 size-full object-cover"
          />
        )}
        {banner?.kind === "card" && <CardBannerArt key={banner.cardId} banner={banner} />}
        {isMe && (
          <div className="absolute right-2 top-2 flex gap-1.5 sm:right-3 sm:top-3">
            <label
              className="btn btn-sm cursor-pointer has-[:disabled]:cursor-default has-[:disabled]:opacity-50 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent max-sm:px-2"
              aria-busy={busy}
              title={banner?.kind === "image" ? "Changer la bannière" : "Importer une bannière"}
            >
              <ImageUp aria-hidden className="size-4" />
              <span className="max-sm:sr-only">
                {banner?.kind === "image" ? "Changer la bannière" : "Importer une bannière"}
              </span>
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  void run(async () => {
                    const image = await prepareBanner(file);
                    await api("/me/banner", { method: "PUT", body: { image } });
                  }, "Bannière mise à jour.");
                }}
              />
            </label>
            <button
              type="button"
              className="btn btn-sm max-sm:px-2"
              disabled={busy}
              onClick={() => setPicking(true)}
              title={banner?.kind === "card" ? "Changer de carte" : "Utiliser une de mes cartes"}
            >
              <Layers aria-hidden className="size-4" />
              <span className="max-sm:sr-only">
                {banner?.kind === "card" ? "Changer de carte" : "Utiliser une de mes cartes"}
              </span>
            </button>
            {banner?.kind === "card" && imageSaved && (
              <button
                type="button"
                className="btn btn-sm px-2"
                disabled={busy}
                onClick={() => run(() => api("/me/banner/card", { method: "DELETE" }), "Image importée rétablie.")}
                aria-label="Revenir à mon image importée"
                title="Revenir à mon image importée"
              >
                <Images aria-hidden className="size-4" />
              </button>
            )}
            {banner && (
              <button
                type="button"
                className="btn btn-sm px-2"
                disabled={busy}
                onClick={() => run(() => api("/me/banner", { method: "DELETE" }), "Bannière par défaut rétablie.")}
                aria-label="Revenir à la bannière par défaut"
                title="Revenir à la bannière par défaut"
              >
                <X aria-hidden className="size-4" />
              </button>
            )}
          </div>
        )}
      </div>
      {isMe && (
        <BannerCardPicker
          open={picking}
          current={banner?.kind === "card" ? banner.cardId : null}
          onPick={(card) => {
            setPicking(false);
            void run(
              () => api("/me/banner/card", { method: "PUT", body: { cardId: card.cardId } }),
              `${card.title} en bannière.`,
            );
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </>
  );
}

/**
 * Carte en bannière : son image floutée remplit la bande (les vignettes Wikipédia sont trop petites pour
 * l'étirer nette), l'image nette posée à gauche dans un cadre à la couleur de la rareté, avec son titre.
 */
function CardBannerArt({ banner }: { banner: CardBanner }) {
  const { src, visible } = useCardBannerSrc(banner);
  return (
    <div
      className="absolute inset-0"
      data-rarity={banner.rarity}
      style={{ ["--r" as string]: `var(--color-rarity-${banner.rarity.toLowerCase()})` }}
    >
      {src && visible && (
        // eslint-disable-next-line @next/next/no-img-element -- vignette Wikimedia relayée par l'API
        <img src={src} alt="" decoding="async" className="pc-banner-backdrop" />
      )}
      <span aria-hidden className="pc-banner-shade" />
      <Link
        href={`/card/${banner.cardId}`}
        className="pc-banner-card absolute inset-y-2.5 left-2.5 flex max-w-[calc(100%-1.25rem)] items-end gap-3 sm:inset-y-3.5 sm:left-3.5"
        aria-label={`Bannière : ${banner.title}, ${RARITY_LABELS[banner.rarity]}`}
      >
        <figure className="pc-banner-frame relative aspect-[5/7] h-full shrink-0 overflow-hidden">
          {src ? (
            <CardImage cardId={banner.cardId} src={src} loading="eager" />
          ) : (
            <span
              aria-hidden
              className="absolute inset-0 grid place-items-center bg-sticker font-display text-4xl uppercase text-[color-mix(in_oklab,var(--r)_70%,var(--color-sticker-ink))]"
            >
              {banner.title.slice(0, 1)}
            </span>
          )}
        </figure>
        <span className="flex min-w-0 items-center gap-2 pb-0.5">
          <RaritySigil rarity={banner.rarity} />
          <span className="truncate font-display text-lg uppercase leading-tight text-white [text-shadow:0_1px_3px_rgb(0_0_0/0.7)] sm:text-2xl">
            {banner.title}
          </span>
        </span>
      </Link>
    </div>
  );
}

/** Choix d'une carte de sa collection pour la bannière, avec les filtres de la collection. */
function BannerCardPicker({
  open,
  current,
  onPick,
  onClose,
}: {
  open: boolean;
  /** Article déjà en bannière. */
  current: number | null;
  onPick: (card: CardDTO) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const { value: f, set, params } = useCollectionFilters();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const options = useSWR<CollectionFilterOptions>(open ? "/collection/summary" : null);
  const query = `${params}${params ? "&" : ""}sort=${f.sort}&limit=60`;
  const list = useSWRInfinite<Page<CardDTO>>((i, prev) =>
    !open || (prev && !prev.nextCursor) ? null : `/collection?${query}&page=${i}`,
  );
  const items = list.data?.flatMap((p) => p.items) ?? [];
  const done = !!list.data && !list.data[list.data.length - 1]?.nextCursor;
  const loadMore = useCallback(() => {
    if (!list.isValidating) void list.setSize((s) => s + 1);
  }, [list]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="banniere-picker-title"
      className="pc-picker m-auto max-h-[min(48rem,calc(100dvh-2rem))] w-[min(56rem,calc(100vw-2rem))] flex-col rounded-2xl border border-line-strong bg-panel p-0 text-text shadow-pop backdrop:bg-black/60 open:flex"
    >
      {open && (
        <>
          <div className="flex items-center gap-3 border-b-2 border-dashed border-line px-5 py-4">
            <h2 id="banniere-picker-title" className="flex-1 font-display text-2xl uppercase">
              Carte en bannière
            </h2>
            <button type="button" className="btn btn-sm btn-ghost px-2" onClick={onClose} aria-label="Fermer">
              <X aria-hidden className="size-5" />
            </button>
          </div>
          <CollectionFilterBar value={f} onChange={set} options={options.data} owner className="px-5 pt-4" />
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5 pt-4">
            {list.error ? (
              <ErrorBox error={list.error} retry={() => list.mutate()} />
            ) : !list.data ? (
              <CardSkeletons count={8} />
            ) : items.length === 0 ? (
              <Empty title={params ? "Aucune carte ne correspond" : "Ta collection est vide"}>
                {params ? "Essaie d'autres filtres." : "Ouvre un paquet pour tirer tes premières cartes."}
              </Empty>
            ) : (
              <>
                <CardGrid dense>
                  {items.map((card) => {
                    const chosen = card.cardId === current;
                    return (
                      <button
                        key={card.instanceId}
                        type="button"
                        className="pc-pick relative text-left disabled:cursor-not-allowed"
                        disabled={chosen}
                        onClick={() => onPick(card)}
                      >
                        <Card card={card} href={null} className={chosen ? "opacity-40" : ""} />
                        {chosen && <span className="pc-pick-note">Bannière actuelle</span>}
                      </button>
                    );
                  })}
                </CardGrid>
                <LoadMore onVisible={loadMore} loading={list.isValidating} done={done} />
              </>
            )}
          </div>
        </>
      )}
    </dialog>
  );
}

/** Bannière en fond d'une ligne de classement, fondue vers la gauche pour garder le nom lisible. */
export function RowBanner({ banner }: { banner: BannerDTO }) {
  const card = useCardBannerSrc(banner.kind === "card" ? banner : null);
  const src = banner.kind === "image" ? bannerSrc(banner) : card.visible ? card.src : null;
  if (!src) return null;
  // eslint-disable-next-line @next/next/no-img-element -- image servie par l'API (déjà réduite)
  return <img src={src} alt="" loading="lazy" decoding="async" className="pc-row-banner" />;
}
