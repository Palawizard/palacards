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
          className={`h-[0.45em] w-[0.45em] rotate-45 ${i < level ? "bg-[var(--r)]" : "border border-line-strong"}`}
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
}

/**
 * Une carte = une mini-infobox Wikipédia : titre serif, image de l'article, table ATK / DEF,
 * pied d'étiquette (rareté, édition, niveau, marques) et lien vers l'article (CC BY-SA).
 */
export function Card({ card, href, className = "", selected = false, priority = false }: CardProps) {
  const live = useCardMedia(card.cardId);
  const thumb = live?.thumbUrl ?? card.thumbUrl;
  const pageUrl = live?.pageUrl ?? card.pageUrl;
  const target = href === undefined ? `/card/${card.cardId}` : href;

  return (
    <article
      className={`pc-card group ${selected ? "outline-2 outline-offset-2 outline-accent" : ""} ${className}`}
      data-rarity={card.rarity}
      aria-label={`${card.title}, ${RARITY_LABELS[card.rarity]}, attaque ${card.atk}, défense ${card.def}`}
    >
      {/* Les unités cqi se rapportent à la carte (conteneur) : tout le contenu suit sa largeur. */}
      <div className="flex h-full flex-col text-[length:max(10px,6cqi)]">
        <header className="relative z-[1] px-[5cqi] pb-[2.5cqi] pt-[4cqi]">
          <h3 className="line-clamp-2 min-h-[2.3em] font-serif text-[1.35em] leading-[1.12] text-balance">
            {target ? (
              <Link href={target} className="after:absolute after:inset-0 after:z-[1] after:content-['']">
                {card.title}
              </Link>
            ) : (
              card.title
            )}
          </h3>
        </header>

        <figure className="relative mx-[5cqi] flex-1 overflow-hidden rounded-[4px] border border-line bg-panel-2">
          {thumb ? (
            // eslint-disable-next-line @next/next/no-img-element -- vignettes Wikimedia servies telles quelles (pas d'optimiseur côté serveur)
            <img
              src={thumb}
              alt=""
              loading={priority ? "eager" : "lazy"}
              decoding="async"
              className="absolute inset-0 size-full object-cover transition-opacity duration-300"
            />
          ) : (
            <div
              aria-hidden
              className="absolute inset-0 grid place-items-center font-serif text-[4.2em] leading-none text-[color-mix(in_oklab,var(--r)_55%,var(--color-faint))]"
              style={{
                background: "radial-gradient(90% 70% at 50% 35%, color-mix(in oklab, var(--r) 14%, #1d222b), #151920)",
              }}
            >
              {card.title.slice(0, 1)}
            </div>
          )}
          <div className="absolute left-[3cqi] top-[3cqi] flex gap-[1.5cqi]">
            {card.locked && (
              <span
                className="grid size-[1.7em] place-items-center rounded-full bg-black/70 text-warn"
                title={card.locked === "auction" ? "En vente" : "Dans un échange"}
              >
                <Lock
                  className="size-[0.95em]"
                  aria-label={card.locked === "auction" ? "En vente" : "Dans un échange"}
                />
              </span>
            )}
            {card.favorite && (
              <span className="grid size-[1.7em] place-items-center rounded-full bg-black/70 text-warn" title="Favori">
                <Star className="size-[0.95em] fill-current" aria-label="Favori" />
              </span>
            )}
          </div>
          {card.owned && (
            <span className="absolute right-[3cqi] top-[3cqi] rounded-full bg-accent px-[2.2cqi] py-[0.4cqi] text-[0.78em] font-bold text-accent-ink">
              Possédée
            </span>
          )}
          {!!card.copies && card.copies > 1 && (
            <span className="tnum absolute bottom-[3cqi] right-[3cqi] rounded-full bg-black/75 px-[2.2cqi] text-[0.8em] font-semibold">
              ×{card.copies}
            </span>
          )}
        </figure>

        <dl className="tnum mx-[5cqi] mt-[3cqi] grid grid-cols-2 border-y border-line text-center">
          <div className="border-r border-line py-[1.6cqi]">
            <dt className="text-[0.72em] font-semibold text-faint">ATK</dt>
            <dd className="text-[1.2em] font-bold leading-tight">{fmt(card.atk)}</dd>
          </div>
          <div className="py-[1.6cqi]">
            <dt className="text-[0.72em] font-semibold text-faint">DEF</dt>
            <dd className="text-[1.2em] font-bold leading-tight">{fmt(card.def)}</dd>
          </div>
        </dl>

        <footer className="relative z-[2] grid grid-cols-[auto_1fr_auto] items-center gap-[2cqi] px-[5cqi] pb-[3.5cqi] pt-[2.5cqi] text-[0.88em]">
          <span className="pc-sigil" title={RARITY_LABELS[card.rarity]}>
            {card.rarity}
          </span>
          <span className="flex items-center gap-[2cqi] text-faint">
            <span title={`Édition saison ${card.season}`}>S{card.season}</span>
            <LevelPips level={card.level} />
          </span>
          {pageUrl && (
            <a
              href={pageUrl}
              target="_blank"
              rel="noreferrer"
              className="article-link whitespace-nowrap"
              title="Lire l'article sur Wikipédia (texte et image sous licence CC BY-SA)"
            >
              W <span className="text-faint">· CC BY-SA</span>
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
