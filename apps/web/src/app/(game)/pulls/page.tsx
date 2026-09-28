"use client";

import {
  CARDS_PER_PACK,
  DROP_TABLE_GUARANTEED,
  DROP_TABLE_STANDARD,
  DROP_TABLE_THEMED,
  DROP_TABLE_THEMED_GUARANTEED,
  DROP_TABLE_TOTAL,
  ECONOMY,
  RARITIES,
  RARITY_LABELS,
  type DropTable,
} from "@palacards/game";
import type { ThemeDTO } from "@palacards/shared";
import { ExternalLink, Ticket } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { AutoRecycle } from "@/components/AutoRecycle";
import { Card, RaritySigil } from "@/components/Card";
import { PackOpener } from "@/components/PackOpener";
import { api, ApiError } from "@/lib/api";
import { countdown, fmt, relative, timeLeft } from "@/lib/format";
import { useMe } from "@/lib/game";
import { usePackCountdown } from "@/lib/packs";
import { useNow } from "@/lib/use-now";
import { play } from "@/lib/sfx";

const SPEEDS = [
  { value: "normal", label: "Animée" },
  { value: "fast", label: "Rapide" },
  { value: "instant", label: "Instantanée" },
] as const;

const pct = (bp: number) =>
  `${((bp / DROP_TABLE_TOTAL) * 100).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %`;

/** Jauge du stock : une case par paquet, groupées par dix comme les rangées d'une planche. */
function StockGauge({ available, max }: { available: number; max: number }) {
  const groups = Array.from({ length: Math.ceil(max / 10) }, (_, g) =>
    Array.from({ length: Math.min(10, max - g * 10) }, (_, i) => g * 10 + i),
  );
  return (
    <span className="flex gap-1.5" aria-hidden>
      {groups.map((group, g) => (
        <span key={g} className="flex gap-[2px]">
          {group.map((i) => (
            <span
              key={i}
              className={`h-3.5 w-[5px] rounded-[2px] transition-colors duration-300 ${
                i < available ? "bg-accent shadow-[inset_0_0_0_1px_rgb(90_60_0/0.25)]" : "border border-line-strong"
              }`}
            />
          ))}
        </span>
      ))}
    </span>
  );
}

/** Taux d'un paquet : cartes 1 à 9, puis la dernière (Rare ou mieux). */
function RatesTable({ table, last }: { table: DropTable; last: DropTable }) {
  return (
    <table className="tnum w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-faint">
          <th className="px-3 py-1.5 font-semibold">Rareté</th>
          <th className="px-2 py-1.5 text-right font-semibold">Cartes 1–{CARDS_PER_PACK - 1}</th>
          <th className="px-3 py-1.5 text-right font-semibold">Carte {CARDS_PER_PACK}</th>
        </tr>
      </thead>
      <tbody>
        {[...RARITIES].reverse().map((r) => (
          <tr key={r} className="border-t border-line">
            <td className="px-3 py-1.5">
              <RaritySigil rarity={r} />
              <span className="sr-only">{RARITY_LABELS[r]}</span>
            </td>
            <td className="px-2 py-1.5 text-right">{table[r] ? pct(table[r]) : "—"}</td>
            <td className="px-3 py-1.5 text-right">{last[r] ? pct(last[r]) : "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Choix du paquet à ouvrir : le paquet du stock ou un booster à thème. */
function EditionSwitch({
  themes,
  value,
  onChange,
  stock,
}: {
  themes: ThemeDTO[];
  value: number | null;
  onChange: (id: number | null) => void;
  stock: number;
}) {
  const options = [
    { id: null, label: "PalaCards", hint: `${stock} en stock` },
    ...themes.map((t) => ({
      id: t.id,
      label: t.name,
      hint: t.owned ? `${t.owned} à ouvrir` : t.onSale ? `${fmt(t.price)} PW` : "Bientôt",
    })),
  ];
  return (
    <div
      role="tablist"
      aria-label="Paquet à ouvrir"
      className="mx-auto flex max-w-full gap-1 overflow-x-auto rounded-xl border border-line bg-panel p-1"
    >
      {options.map((o) => {
        const on = o.id === value;
        return (
          <button
            key={o.id ?? "std"}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(o.id)}
            data-edition={o.id === null ? undefined : "theme"}
            className={`flex shrink-0 flex-col items-start rounded-lg px-3 py-1.5 text-left transition-[background-color,color,transform] duration-150 active:scale-[0.97] ${
              on ? "bg-[var(--foil-1)] text-cover-ink" : "text-muted hover:bg-panel-2 hover:text-text"
            }`}
          >
            <span className="max-w-44 truncate font-display text-base uppercase leading-tight">{o.label}</span>
            <span className={`tnum text-xs ${on ? "text-cover-ink/75" : "text-faint"}`}>{o.hint}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Vitrine des boosters spéciaux : une bande « édition limitée » par booster, en tête de la page. */
function ThemeShowcase({
  themes,
  selected,
  onPick,
}: {
  themes: ThemeDTO[];
  selected: number | null;
  onPick: (id: number) => void;
}) {
  const now = useNow(30_000);
  const list = themes.filter((t) => t.onSale || t.owned > 0 || new Date(t.startsAt).getTime() > now);
  if (!list.length) return null;
  return (
    <section aria-label="Boosters spéciaux" className="flex flex-col gap-3">
      {list.map((t) => {
        const upcoming = new Date(t.startsAt).getTime() > now;
        const on = t.id === selected;
        return (
          <article
            key={t.id}
            data-edition="theme"
            data-selected={on || undefined}
            className="pc-showcase group grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 p-4 sm:gap-x-6 sm:px-6 md:grid-cols-[auto_minmax(0,1fr)_auto]"
          >
            <div className="relative self-start sm:self-center" aria-hidden>
              <div className="pc-showcase-pack [filter:drop-shadow(0_10px_12px_rgb(4_8_30/0.45))]">
                <div className="pc-pack pc-pack-foil relative aspect-[5/7.3] w-[4.6rem] sm:w-[5.6rem]">
                  <span className="absolute inset-x-[10%] top-[34%] block font-display uppercase leading-[0.86] text-cover-ink [text-shadow:0_1px_0_var(--foil-2)]">
                    <span className="block text-[0.55rem] tracking-[0.06em] text-accent sm:text-[0.62rem]">
                      Booster
                    </span>
                    <span className="line-clamp-3 block break-words text-[0.85rem] sm:text-[1rem]">{t.name}</span>
                  </span>
                </div>
              </div>
              <span className="absolute -right-3 -top-2 grid size-[2.9rem] rotate-[-12deg] place-items-center rounded-full bg-accent text-center font-display text-[0.55rem] uppercase leading-[0.95] text-accent-ink shadow-[0_4px_10px_-4px_rgb(0_0_0/0.55)]">
                <span className="absolute inset-[3px] rounded-full border border-dashed border-accent-ink/30" />
                Édition
                <br />
                limitée
              </span>
            </div>

            <div className="min-w-0">
              <h2 className="font-display text-[clamp(1.55rem,1.15rem+1.5vw,2.35rem)] uppercase leading-[0.9] text-balance">
                {t.name}
              </h2>
              {t.description && <p className="mt-1.5 line-clamp-2 text-sm text-cover-ink/80">{t.description}</p>}
              <dl className="tnum mt-3 flex flex-wrap gap-x-5 gap-y-2">
                <div>
                  <dt className="text-xs font-semibold text-cover-ink/65">
                    {upcoming ? "En vente dans" : t.onSale ? "Fin dans" : "Vente"}
                  </dt>
                  <dd className="font-display text-xl leading-none">
                    {upcoming
                      ? timeLeft(new Date(t.startsAt).getTime() - now)
                      : t.onSale
                        ? timeLeft(new Date(t.endsAt).getTime() - now)
                        : "Terminée"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-cover-ink/65">Prix</dt>
                  <dd className="font-display text-xl leading-none">
                    {fmt(t.price)} <span className="text-sm">PW</span>
                  </dd>
                </div>
                {t.owned > 0 && (
                  <div>
                    <dt className="text-xs font-semibold text-cover-ink/65">À ouvrir</dt>
                    <dd className="font-display text-xl leading-none text-accent">{t.owned}</dd>
                  </div>
                )}
              </dl>
              <button
                type="button"
                className={`btn btn-sm mt-3 ${on ? "pc-showcase-picked" : "btn-primary"}`}
                aria-pressed={on}
                onClick={() => onPick(t.id)}
              >
                {on
                  ? "Booster choisi"
                  : t.owned > 0
                    ? "Ouvrir ce booster"
                    : upcoming
                      ? "Voir le booster"
                      : "Choisir ce booster"}
              </button>
            </div>

            {t.preview.length > 0 && (
              <div className="pc-fan hidden md:flex" aria-label="Cartes phares">
                {t.preview.slice(0, 3).map((c) => (
                  <div key={c.cardId} className="w-[6.4rem] lg:w-[7rem]">
                    <Card card={c} prefetch={false} />
                  </div>
                ))}
              </div>
            )}
          </article>
        );
      })}
    </section>
  );
}

/** Encart du booster à thème : fin de la vente, articles phares, taux. */
function ThemeBox({ theme }: { theme: ThemeDTO }) {
  const now = useNow(30_000);
  const upcoming = new Date(theme.startsAt).getTime() > now;
  return (
    <div className="infobox" data-edition="theme">
      <h2 className="infobox-head flex items-center justify-between gap-2">
        <span className="truncate">{theme.name}</span>
        <span className="shrink-0 rounded-full bg-[var(--foil-1)] px-2 py-0.5 text-[0.72rem] tracking-[0.04em] text-white">
          Édition limitée
        </span>
      </h2>
      <div className="flex flex-col gap-3 p-3 text-sm">
        {theme.description && <p className="text-muted">{theme.description}</p>}
        <p className="tnum text-muted">
          {upcoming
            ? `En vente ${relative(theme.startsAt)}.`
            : theme.onSale
              ? `En vente jusqu’à la fin, ${relative(theme.endsAt)}.`
              : "Vente terminée : tes boosters restent à ouvrir."}{" "}
          {fmt(theme.cardCount)} articles
          {theme.categories.length > 0 && (
            <>
              {" "}
              {theme.categories.length > 1 ? "des catégories" : "de la catégorie"}{" "}
              {theme.categories.map((c, i) => (
                <span key={c}>
                  {i > 0 && (i === theme.categories.length - 1 ? " et " : ", ")}
                  <a
                    href={`https://fr.wikipedia.org/wiki/Catégorie:${encodeURIComponent(c.replace(/ /g, "_"))}`}
                    target="_blank"
                    rel="noreferrer"
                    className="article-link"
                  >
                    {c}
                    <ExternalLink aria-hidden className="ml-0.5 inline size-3 align-[-1px]" />
                  </a>
                </span>
              ))}
            </>
          )}
          .
        </p>
        {theme.preview.length > 0 && (
          <div>
            <p className="label">À gagner</p>
            <div className="grid grid-cols-2 gap-2">
              {theme.preview.map((c) => (
                <Card key={c.cardId} card={c} prefetch={false} />
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="border-t border-line">
        <RatesTable table={DROP_TABLE_THEMED} last={DROP_TABLE_THEMED_GUARANTEED} />
      </div>
      <p className="border-t border-line p-3 text-xs leading-relaxed text-faint">
        Chaque carte est tirée parmi les articles du thème de sa rareté (dans toute la saison si le thème n’en a pas).
        La pity est commune avec les paquets PalaCards.
      </p>
    </div>
  );
}

/** Saisie d'un code promo (insensible à la casse). */
function PromoCode({ onRedeemed }: { onRedeemed: () => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  async function redeem(e: { preventDefault(): void }) {
    e.preventDefault();
    if (busy || !code.trim()) return;
    setBusy(true);
    try {
      const res = await api<{ pw: number; packs: number; themePacks: number; theme: { name: string } | null }>(
        "/codes/redeem",
        { body: { code: code.trim() } },
      );
      const parts = [
        res.pw ? `${fmt(res.pw)} PW` : "",
        res.packs ? `${res.packs} paquet${res.packs > 1 ? "s" : ""} bonus` : "",
        res.themePacks && res.theme
          ? `${res.themePacks} booster${res.themePacks > 1 ? "s" : ""} ${res.theme.name}`
          : "",
      ].filter(Boolean);
      play("coin");
      toast.success(`Code utilisé : ${parts.join(", ")} !`);
      setCode("");
      onRedeemed();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Code refusé.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={redeem} className="flex gap-2 p-3">
      <label className="min-w-0 flex-1">
        <span className="sr-only">Code promo</span>
        <input
          className="field h-9 min-h-0 font-semibold uppercase tracking-[0.08em] placeholder:font-normal placeholder:normal-case placeholder:tracking-normal"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\s/g, "").slice(0, 32))}
          placeholder="Code promo"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
        />
      </label>
      <button
        type="submit"
        className="btn btn-sm h-9 w-9 shrink-0 px-0"
        disabled={busy || code.trim().length < 3}
        aria-label="Utiliser le code"
        title="Utiliser le code"
      >
        <Ticket aria-hidden className="size-4" />
      </button>
    </form>
  );
}

export default function PullsPage() {
  const { me, mutateMe } = useMe();
  const { remaining, full } = usePackCountdown(me?.packs);
  const [saving, setSaving] = useState(false);
  const [buying, setBuying] = useState(false);
  const themes = useSWR<ThemeDTO[]>("/themes");
  const [themeId, setThemeId] = useState<number | null>(null);
  const opener = useRef<HTMLDivElement>(null);
  const theme = themes.data?.find((t) => t.id === themeId) ?? null;
  const now = useNow(30_000);

  async function buyBonus() {
    setBuying(true);
    try {
      await api("/packs/buy", { method: "POST" });
      play("coin");
      toast.success("Paquet bonus ajouté à ton stock.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Achat impossible.");
    } finally {
      setBuying(false);
    }
  }

  async function setSpeed(value: (typeof SPEEDS)[number]["value"]) {
    if (!me || me.animationSpeed === value) return;
    setSaving(true);
    try {
      await mutateMe(api("/me/settings", { method: "PATCH", body: { animationSpeed: value } }), { revalidate: false });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Réglage non enregistré.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <h1 className="page-title">Paquets</h1>
        {me ? (
          <dl className="tnum flex flex-wrap items-end gap-x-6 gap-y-2 text-sm">
            <div title={`Stock : ${me.packs.available}/${me.packs.max}`}>
              <dt className="text-xs font-semibold text-faint">Stock</dt>
              <dd className="flex items-center gap-2">
                <span className="font-display text-2xl leading-none">
                  {me.packs.available}
                  <span className="text-faint">/{me.packs.max}</span>
                </span>
                <StockGauge available={me.packs.available} max={me.packs.max} />
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-faint">Prochain</dt>
              <dd className="font-display text-2xl leading-none">{full ? "Plein" : countdown(remaining)}</dd>
            </div>
            <div title="Paquets ouverts depuis la dernière UR ou légendaire">
              <dt className="text-xs font-semibold text-faint">Pity</dt>
              <dd className="flex items-center gap-2">
                <span className="font-display text-2xl leading-none">
                  {me.packs.pity}
                  <span className="text-faint">/{me.packs.pityThreshold}</span>
                </span>
                <span className="h-2 w-16 overflow-hidden rounded-full bg-panel-2" aria-hidden>
                  <span
                    className="block h-full rounded-full bg-rarity-ur transition-[width] duration-500"
                    style={{ width: `${Math.min(100, (me.packs.pity / me.packs.pityThreshold) * 100)}%` }}
                  />
                </span>
              </dd>
            </div>
            {me.packs.bonus > 0 && (
              <div>
                <dt className="text-xs font-semibold text-faint">Bonus</dt>
                <dd className="font-display text-2xl leading-none text-highlight">+{me.packs.bonus}</dd>
              </div>
            )}
          </dl>
        ) : (
          <p className="hatnote">Chargement du stock…</p>
        )}
      </header>

      {themes.data && (
        <ThemeShowcase
          themes={themes.data}
          selected={theme?.id ?? null}
          onPick={(id) => {
            setThemeId(id);
            const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
            opener.current?.scrollIntoView({ block: "start", behavior: smooth ? "smooth" : "auto" });
          }}
        />
      )}

      <div className="flex flex-col gap-10">
        <div ref={opener} className="flex min-w-0 scroll-mt-20 flex-col gap-5">
          {!!themes.data?.length && (
            <EditionSwitch
              themes={themes.data}
              value={theme?.id ?? null}
              onChange={setThemeId}
              stock={(me?.packs.available ?? 0) + (me?.packs.bonus ?? 0)}
            />
          )}
          {me && (
            <PackOpener
              key={theme?.id ?? "std"}
              packs={me.packs}
              season={me.season}
              theme={theme}
              onOpened={theme ? () => void themes.mutate() : undefined}
            />
          )}
          {me && theme && theme.owned === 0 && !theme.onSale && (
            <p className="text-center text-sm text-muted">
              {new Date(theme.startsAt).getTime() > now
                ? `Ce booster sera en vente ${relative(theme.startsAt)}.`
                : "La vente de ce booster est terminée."}
            </p>
          )}
          {me && theme && theme.owned === 0 && theme.onSale && me.wallet.available < theme.price && (
            <p className="text-center text-sm text-muted">
              Il te manque <span className="tnum">{fmt(theme.price - me.wallet.available)} PW</span> pour ce booster.
            </p>
          )}
          {me && !theme && me.packs.available + me.packs.bonus === 0 && (
            <p className="mt-4 text-center text-sm text-muted">
              Plus de paquet pour l’instant. Le prochain arrive dans{" "}
              <span className="tnum">{countdown(remaining)}</span>.
            </p>
          )}
        </div>

        <aside className="grid items-start gap-4 md:grid-cols-[minmax(0,18.5rem)_minmax(0,24rem)] md:justify-center">
          <div className="infobox">
            <h2 className="infobox-head">Ouverture</h2>
            <div className="flex flex-col gap-2 p-3" role="radiogroup" aria-label="Vitesse d'ouverture">
              {SPEEDS.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  role="radio"
                  aria-checked={me?.animationSpeed === s.value}
                  disabled={saving || !me}
                  onClick={() => setSpeed(s.value)}
                  className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors duration-150 hover:bg-panel-2 aria-checked:text-text [&:not([aria-checked=true])]:text-muted"
                >
                  <span className="grid size-4 place-items-center rounded-full border border-line-strong">
                    {me?.animationSpeed === s.value && <span className="size-2 rounded-full bg-accent" />}
                  </span>
                  {s.label}
                </button>
              ))}
            </div>
            <div className="border-t border-line p-3">
              <p className="label">Recyclage auto</p>
              <AutoRecycle />
            </div>
            <div className="border-t border-line p-3">
              <button
                type="button"
                className="btn btn-sm h-auto w-full justify-between whitespace-normal py-1.5 text-left leading-tight"
                disabled={buying || !me || me.wallet.available < ECONOMY.bonusPackPrice}
                onClick={buyBonus}
                title={me && me.wallet.available < ECONOMY.bonusPackPrice ? "Pas assez de points wiki" : undefined}
              >
                <span>Acheter un paquet bonus</span>
                <span className="tnum shrink-0">{ECONOMY.bonusPackPrice} PW</span>
              </button>
            </div>
            <div className="border-t border-line">
              <PromoCode onRedeemed={() => void themes.mutate()} />
            </div>
          </div>

          {theme ? (
            <ThemeBox theme={theme} />
          ) : (
            <div className="infobox">
              <h2 className="infobox-head">Taux de tirage</h2>
              <RatesTable table={DROP_TABLE_STANDARD} last={DROP_TABLE_GUARANTEED} />
              {me && (
                <div className="border-t border-line p-3 text-sm">
                  <p className="text-xs leading-relaxed text-faint">
                    {CARDS_PER_PACK} cartes par paquet, la dernière Rare ou mieux. Pity : après {me.packs.pityThreshold}{" "}
                    paquets sans UR ni légendaire, la dernière carte du suivant est forcément UR ou mieux. Un paquet
                    bonus coûte {ECONOMY.bonusPackPrice} PW.
                  </p>
                </div>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
