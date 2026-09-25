"use client";

import { RARITY_LABELS, type Rarity } from "@palacards/game";
import type { CardDTO } from "@palacards/shared";
import { Lock, Star } from "lucide-react";
import Link from "next/link";
import { fmt } from "@/lib/format";
import { useCardMedia } from "@/lib/media";

export function RaritySigil({ rarity, withLabel = false }: { rarity: Rarity; withLabel?: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1.5"
      data-rarity={rarity}
      style={{ ["--r" as string]: `var(--color-rarity-${rarity.toLowerCase()})` }}
    >
      <span className="pc-sigil" title={RARITY_LABELS[rarity]}>
        {rarity}
      </span>
      {withLabel && <span className="text-sm text-muted">{RARITY_LABELS[rarity]}</span>}
    </span>
  );
}

function LevelPips({ level }: { level: number }) {
  if (level <= 1) return null;
  return (
    <span className="flex gap-[2px]" aria-label={`Niveau ${level}`} title={`Niveau ${level} (+${(level - 1) * 4} %)`}>
      {Array.from({ length: 5 }, (_, i) => (
        <span
          key={i}
          className={`h-[0.5em] w-[0.5em] rotate-45 rounded-[1px] ${i < level ? "bg-[var(--r)]" : "border border-sticker-muted/50"}`}
        />
      ))}
    </span>
  );
}

interface CardProps {
  card: CardDTO;
  /** Lien vers la fiche carte (par défaut). `null` pour une carte non cliquable. */
  href?: string | null;
  className?: string;
  /** Carte sélectionnée (échanges, deck, recyclage en lot). */
  selected?: boolean;
  priority?: boolean;
  /**
   * Préchargement de la fiche par le lien (par défaut : à l'entrée dans l'écran). `false` quand les cartes
   * défilent vite, comme à l'ouverture d'un paquet : sinon chaque carte lance une requête et du travail
   * de routeur pendant l'animation.
   */
  prefetch?: boolean;
}

/**
 * Une carte = une vignette d'album : image de l'article, bande de titre à la couleur de la rareté,
 * relevé ATK / DEF, pied d'étiquette (rareté, édition, niveau) et lien vers l'article (CC BY-SA).
 */
export function Card({ card, href, className = "", selected = false, priority = false, prefetch }: CardProps) {
  const live = useCardMedia(card.cardId);
  const thumb = live?.thumbUrl ?? card.thumbUrl;
  const pageUrl = live?.pageUrl ?? card.pageUrl;
  const target = href === undefined ? `/card/${card.cardId}` : href;

  return (
    <article
      className={`pc-card group ${selected ? "outline-3 outline-offset-2 outline-accent" : ""} ${className}`}
      data-rarity={card.rarity}
      aria-label={`${card.title}, ${RARITY_LABELS[card.rarity]}, attaque ${card.atk}, défense ${card.def}`}
    >
      {/* Les unités cqi se rapportent à la carte (conteneur) : tout le contenu suit sa largeur. */}
      <div className="pc-frame flex h-full flex-col p-[4cqi] text-[length:max(10px,6cqi)]">
        <figure className="pc-art relative flex-1 overflow-hidden rounded-t-[6px] bg-sticker-line">
          {thumb ? (
            // eslint-disable-next-line @next/next/no-img-element -- vignettes Wikimedia servies telles quelles (pas d'optimiseur côté serveur)
            <img
              src={thumb}
              alt=""
              loading={priority ? "eager" : "lazy"}
              decoding="async"
              className="absolute inset-0 size-full object-cover"
            />
          ) : (
            <div
              aria-hidden
              className="absolute inset-0 grid place-items-center font-display text-[5em] uppercase leading-none text-[color-mix(in_oklab,var(--r)_70%,var(--color-sticker-ink))]"
              style={{
                background:
                  "repeating-linear-gradient(-45deg, color-mix(in oklab, var(--r) 10%, transparent) 0 2px, transparent 2px 9px), color-mix(in oklab, var(--r) 16%, var(--color-sticker))",
              }}
            >
              {card.title.slice(0, 1)}
            </div>
          )}
          {/* Pastille de rareté, comme celle de la pochette : le premier repère de la vignette. */}
          <span className="pc-pastille" aria-hidden>
            {card.rarity}
          </span>
          <div className="absolute bottom-[3cqi] left-[3cqi] flex gap-[1.5cqi]">
            {card.locked && (
              <span
                className="grid size-[1.7em] place-items-center rounded-full bg-black/70 text-white"
                title={card.locked === "auction" ? "En vente" : "Dans un échange"}
              >
                <Lock
                  className="size-[0.95em]"
                  aria-label={card.locked === "auction" ? "En vente" : "Dans un échange"}
                />
              </span>
            )}
            {card.favorite && (
              <span
                className="grid size-[1.7em] place-items-center rounded-full bg-black/70 text-accent"
                title="Favori"
              >
                <Star className="size-[0.95em] fill-current" aria-label="Favori" />
              </span>
            )}
          </div>
          {card.owned && (
            <span className="absolute right-[3cqi] top-[3cqi] rounded-full bg-accent px-[2.2cqi] py-[0.4cqi] text-[0.78em] font-bold text-accent-ink shadow-sm">
              Possédée
            </span>
          )}
          {!!card.copies && card.copies > 1 && (
            <span className="tnum absolute bottom-[3cqi] right-[3cqi] rounded-full bg-black/75 px-[2.2cqi] text-[0.82em] font-bold text-white">
              ×{card.copies}
            </span>
          )}
        </figure>

        <header className="pc-band relative z-[1] rounded-b-[6px] px-[3.5cqi] pb-[1.8cqi] pt-[2.2cqi]">
          <h3 className="line-clamp-2 min-h-[2em] font-display text-[1.3em] uppercase leading-[1] text-balance">
            {target ? (
              <Link
                href={target}
                prefetch={prefetch === false ? false : undefined}
                className="after:absolute after:inset-0 after:z-[1] after:content-['']"
              >
                {card.title}
              </Link>
            ) : (
              card.title
            )}
          </h3>
        </header>

        <dl className="tnum mt-[2.5cqi] grid grid-cols-2 text-center">
          <div className="border-r-2 border-dashed border-sticker-line">
            <dt className="text-[0.66em] font-bold tracking-[0.08em] text-sticker-muted">ATK</dt>
            <dd className="font-display text-[1.55em] leading-[1.05]">{fmt(card.atk)}</dd>
          </div>
          <div>
            <dt className="text-[0.66em] font-bold tracking-[0.08em] text-sticker-muted">DEF</dt>
            <dd className="font-display text-[1.55em] leading-[1.05]">{fmt(card.def)}</dd>
          </div>
        </dl>

        <footer className="relative z-[2] mt-[2cqi] grid grid-cols-[1fr_auto] items-center gap-[2cqi] text-[0.85em]">
          <span className="flex items-center gap-[2cqi] font-semibold text-sticker-muted">
            <span title={`Édition saison ${card.season}`}>S{card.season}</span>
            <LevelPips level={card.level} />
          </span>
          {pageUrl && (
            <a
              href={pageUrl}
              target="_blank"
              rel="noreferrer"
              className="whitespace-nowrap font-semibold text-sticker-link hover:underline"
              title="Lire l'article sur Wikipédia (texte et image sous licence CC BY-SA)"
            >
              W <span className="font-normal text-sticker-muted">· CC BY-SA</span>
            </a>
          )}
        </footer>
      </div>
    </article>
  );
}

/** Grille adaptative : ~2 colonnes sur téléphone, jusqu'à 6 sur grand écran. */
export function CardGrid({ children, dense = false }: { children: React.ReactNode; dense?: boolean }) {
  return (
    <div
      className={`grid gap-3 sm:gap-4 ${
        dense
          ? "grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))]"
          : "grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] sm:grid-cols-[repeat(auto-fill,minmax(11.5rem,1fr))]"
      }`}
    >
      {children}
    </div>
  );
}
