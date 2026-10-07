"use client";

import type { BannerDTO } from "@palacards/shared";
import { ImageIcon, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { CardImage } from "@/components/CardImage";
import { CardPicker } from "@/components/CardPicker";
import { api, ApiError } from "@/lib/api";
import { useArthropodVeil } from "@/lib/arthropods";
import { useMe } from "@/lib/game";

/**
 * Bannière en haut du profil : image d'un article de la collection du joueur, sinon la couverture de l'album
 * (bannière par défaut). Sur son propre profil, boutons pour la changer ou revenir au défaut.
 */
export function ProfileBanner({
  banner,
  isMe,
  onChanged,
}: {
  banner: BannerDTO | null;
  isMe: boolean;
  onChanged: () => void;
}) {
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);

  async function choose(cardId: number | null, title?: string) {
    setPicking(false);
    setBusy(true);
    try {
      await api("/me/banner", { method: "PUT", body: { cardId } });
      onChanged();
      toast.success(title ? `${title} devient ta bannière.` : "Bannière par défaut rétablie.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Bannière non enregistrée.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pc-banner relative h-28 overflow-hidden rounded-xl border border-line sm:h-40">
      {banner && (
        <>
          {/* Image pas encore chargée : le titre de l'article sur la couverture par défaut. */}
          {banner.thumbUrl && (
            <>
              <CardImage key={banner.cardId} cardId={banner.cardId} src={banner.thumbUrl} loading="eager" />
              <span aria-hidden className="pc-banner-scrim" />
            </>
          )}
          <p className="absolute bottom-2 left-3 right-3 truncate text-xs font-semibold text-white [text-shadow:0_1px_2px_rgb(0_0_0/0.6)] sm:bottom-3 sm:left-4">
            <span className="sr-only">Bannière : </span>
            {banner.title}
          </p>
        </>
      )}
      {isMe && (
        <div className="absolute right-2 top-2 flex gap-1.5 sm:right-3 sm:top-3">
          <button type="button" className="btn btn-sm" disabled={busy} onClick={() => setPicking(true)}>
            <ImageIcon aria-hidden className="size-4" />
            {banner ? "Changer la bannière" : "Choisir une bannière"}
          </button>
          {banner && (
            <button
              type="button"
              className="btn btn-sm px-2"
              disabled={busy}
              onClick={() => choose(null)}
              aria-label="Revenir à la bannière par défaut"
              title="Revenir à la bannière par défaut"
            >
              <X aria-hidden className="size-4" />
            </button>
          )}
        </div>
      )}
      {isMe && (
        <CardPicker
          open={picking}
          title="Choisir ta bannière"
          intro="L’image de l’article choisi s’affiche en haut de ton profil et derrière ta ligne dans les classements."
          unavailable={(card) => (card.cardId === banner?.cardId ? "Bannière actuelle" : null)}
          onPick={(card) => choose(card.cardId, card.title)}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}

/**
 * Bannière en fond d'une ligne de classement, fondue vers la gauche pour garder le nom lisible.
 * Rien tant que l'option « flouter les arthropodes » n'a pas confirmé que l'image peut s'afficher.
 */
export function RowBanner({ cardId, thumbUrl }: { cardId: number; thumbUrl: string }) {
  const { me } = useMe();
  const veil = useArthropodVeil(cardId, !!me?.hideArthropods);
  if (veil !== "off" && veil !== "shown") return null;
  // eslint-disable-next-line @next/next/no-img-element -- vignettes Wikimedia relayées par l'API (pas d'optimiseur Next)
  return <img src={thumbUrl} alt="" loading="lazy" decoding="async" className="pc-row-banner" />;
}
