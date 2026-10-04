"use client";

import { Eye, EyeOff } from "lucide-react";
import { revealArthropod, useArthropodVeil } from "@/lib/arthropods";
import { useMe } from "@/lib/game";

/**
 * Image d'article d'une carte. Avec l'option « flouter les arthropodes », une araignée ou un insecte reste
 * flou jusqu'au clic sur « Afficher » (`revealable`), et l'image attend le verdict sans clignoter.
 * Les vignettes trop petites ou posées dans un bouton (`revealable` à false) restent floues : on les
 * dévoile depuis la carte en grand.
 */
export function CardImage({
  cardId,
  src,
  revealable = true,
  loading = "lazy",
  className = "absolute inset-0 size-full object-cover",
}: {
  cardId: number;
  src: string;
  revealable?: boolean;
  loading?: "lazy" | "eager";
  className?: string;
}) {
  const { me } = useMe();
  const veil = useArthropodVeil(cardId, !!me?.hideArthropods);
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- vignettes Wikimedia relayées par l'API (pas d'optimiseur Next) */}
      <img
        src={src}
        alt=""
        loading={loading}
        decoding="async"
        className={`pc-veil-img ${className}`}
        data-veil={veil}
      />
      {veil === "veiled" &&
        (revealable ? (
          <span className="pc-veil">
            <button
              type="button"
              className="pc-veil-btn"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                revealArthropod(cardId);
              }}
            >
              <Eye aria-hidden className="size-[1.1em]" strokeWidth={2.25} />
              Afficher
            </button>
            <span className="pc-veil-note">Arthropode masqué</span>
          </span>
        ) : (
          <span className="pc-veil" title="Arthropode masqué : ouvre la carte pour l'afficher">
            <EyeOff aria-label="Arthropode masqué" className="size-4 text-white drop-shadow" />
          </span>
        ))}
    </>
  );
}
