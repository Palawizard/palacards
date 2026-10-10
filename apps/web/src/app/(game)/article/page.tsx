"use client";

import { ATTR_KEYS, ATTR_LABELS, RARITY_LABELS } from "@palacards/game";
import type { ArticleAttrKey, ArticleGuessDTO, ArticleSearchItemDTO, DailyArticleDTO } from "@palacards/shared";
import { ArrowDown, ArrowUp, BookOpen, Check, Copy, EqualApproximately, Lock, Search, X } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { FlipCard } from "@/components/PackOpener";
import { ErrorBox } from "@/components/ui";
import { api, API_BASE, ApiError, SITE_URL, thumbSrc } from "@/lib/api";
import { fmt, timeLeft } from "@/lib/format";
import { useSeenFeature } from "@/lib/features";
import { useMe } from "@/lib/game";
import { play } from "@/lib/sfx";
import { useNow } from "@/lib/use-now";
import "@/components/content.css";

const RULES_KEY = "pc-article-rules-v3";
const STATE_LABELS = { good: "identique", near: "proche", bad: "différent", unknown: "inconnu" } as const;
const plural = (n: number, one: string, many: string) => (n > 1 ? many : one);

/**
 * Le titre en grille de mots croisés : une case par lettre, les mots séparés, la ponctuation gardée.
 * La première lettre (indice de secours) puis le titre entier se posent dans les cases.
 */
function TitleGrid({ pattern, state }: { pattern: string; state: "playing" | "found" | "lost" }) {
  const words = pattern.split(/\s{3,}/).map((w) => w.split(" ").filter(Boolean));
  const letters = words.flat().filter((c) => c === "_" || /[\p{L}\p{N}]/u.test(c)).length;
  return (
    <div
      className="pc-cross"
      data-state={state}
      role="img"
      aria-label={`Titre de ${letters} ${plural(letters, "lettre", "lettres")} en ${words.length} ${plural(words.length, "mot", "mots")}`}
    >
      {words.map((word, w) => (
        <span key={w} className="pc-cross-word">
          {word.map((c, i) => {
            const punct = c !== "_" && !/[\p{L}\p{N}]/u.test(c);
            const filled = c !== "_" && !punct;
            return (
              <span
                key={`${i}${c}`}
                className="pc-cross-cell"
                data-punct={punct || undefined}
                data-filled={filled || undefined}
                style={filled ? { animationDelay: `${i * 35}ms` } : undefined}
              >
                {c === "_" ? "" : c}
              </span>
            );
          })}
        </span>
      ))}
    </div>
  );
}

/** Règles, dépliées à la première visite. */
function Rules({ data }: { data: DailyArticleDTO }) {
  const ref = useRef<HTMLDetailsElement>(null);
  // Catégories toutes visibles dès le départ (ARTICLE_HINT_CATEGORIES_AFTER à 0) : pas d'essai à citer.
  const categoriesAtStart = data.hintsAfter.categories.length > 0 && data.hintsAfter.categories.every((n) => n === 0);
  useEffect(() => {
    try {
      if (!localStorage.getItem(RULES_KEY)) {
        if (ref.current) ref.current.open = true;
        localStorage.setItem(RULES_KEY, "1");
      }
    } catch {
      // stockage indisponible : règles repliées
    }
  }, []);
  return (
    <details ref={ref} className="pc-boss-rules">
      <summary>
        <BookOpen className="size-4" aria-hidden />
        Règles de l&apos;article du jour
      </summary>
      <ul>
        <li>
          Propose un vrai article du jeu (Super rare ou mieux) : tape quelques lettres et choisis-le dans la liste.
        </li>
        <li>
          Chaque essai est comparé à la réponse : <strong>vert</strong> identique, <strong>orange</strong> proche (à 10
          ans près, à 25 % des vues près, type voisin), <strong>rouge</strong> différent ; le pays est juste ou faux.
          Les flèches disent si la réponse est plus récente, plus rare ou plus lue. « ? » : on ne sait pas, ce
          n&apos;est pas compté faux.
        </li>
        <li>L&apos;image de la réponse se précise à chaque essai.</li>
        {categoriesAtStart && <li>Des catégories Wikipédia de la réponse sont visibles dès le départ.</li>}
        <li>
          {data.maxGuesses} essais. Les essais ratés débloquent des indices{" : "}
          {data.hintsAfter.categories.length > 0 && !categoriesAtStart && (
            <>
              une catégorie Wikipédia après le{" "}
              {data.hintsAfter.categories.map((n, i) => (
                <span key={i}>
                  {i > 0 && (i === data.hintsAfter.categories.length - 1 ? " et le " : ", le ")}
                  {n}
                  <sup>e</sup>
                </span>
              ))}
              {" ; "}
            </>
          )}
          sa description (titre masqué) après le {data.hintsAfter.description}
          <sup>e</sup>
          {" ; "}sa première lettre après le {data.hintsAfter.firstLetter}
          <sup>e</sup>.
        </li>
        <li>Trouvé : 70 PW, plus un bonus de 30 PW qui perd 5 PW par essai (100 PW au premier).</li>
      </ul>
    </details>
  );
}

/** Image de la réponse, pixelisée par le serveur, agrandie en flou ; l'image entière une fois la partie finie. */
function AnswerImage({ data }: { data: DailyArticleDTO }) {
  const [loaded, setLoaded] = useState(false);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  // Même élément d'un essai à l'autre : l'image précédente reste affichée pendant que la suivante charge.
  const src = data.answer?.thumbUrl
    ? thumbSrc(data.answer.thumbUrl)
    : `${API_BASE}/article/image?v=${data.guesses.length}`;
  const failed = failedSrc === src;
  if (!data.image && !data.answer?.thumbUrl) return null;
  // Plus l'image est petite, plus le flou d'agrandissement est fort (il gomme les gros pixels).
  const blur = data.imageWidth === null ? 0 : Math.max(2, Math.round(48 / data.imageWidth));
  return (
    <figure className="pc-article-image" data-loaded={loaded || undefined}>
      {failed ? (
        <figcaption className="grid h-full place-items-center px-4 text-center text-sm text-muted">
          Image indisponible pour l&apos;instant.
        </figcaption>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- image servie par l'API (pixelisée)
        <img
          src={src}
          alt={
            data.finished ? `Illustration de « ${data.answer?.title} »` : "Illustration de l'article à deviner, floutée"
          }
          style={{ filter: `blur(${blur}px)` }}
          onLoad={() => setLoaded(true)}
          onError={() => setFailedSrc(src)}
        />
      )}
      {!data.finished && (
        <span className="pc-article-image-tag tnum">
          {data.guesses.length < data.maxGuesses - 1 ? "Plus net à chaque essai" : "Dernier essai"}
        </span>
      )}
    </figure>
  );
}

/**
 * Autocomplétion au clavier (motif « combobox » ARIA) : flèches pour parcourir, Entrée pour proposer,
 * Échap pour fermer. Les articles déjà proposés sont grisés.
 */
function GuessInput({
  disabled,
  guessed,
  onGuess,
}: {
  disabled: boolean;
  guessed: Set<number>;
  onGuess: (item: ArticleSearchItemDTO) => Promise<boolean>;
}) {
  const id = useId();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 150);
    return () => clearTimeout(t);
  }, [q]);
  const { data, isLoading } = useSWR<ArticleSearchItemDTO[]>(
    debounced.length >= 2 ? `/article/search?q=${encodeURIComponent(debounced)}` : null,
    { keepPreviousData: true },
  );
  const items = debounced.length >= 2 ? (data ?? []) : [];
  const shown = open && q.trim().length >= 2;

  async function choose(item: ArticleSearchItemDTO | undefined) {
    if (!item || guessed.has(item.cardId) || disabled) return;
    if (await onGuess(item)) {
      setQ("");
      setDebounced("");
      setOpen(false);
    }
    input.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      if (!items.length) return;
      setActive((a) => (a + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (shown) void choose(items[active]);
    } else if (e.key === "Escape") {
      if (shown) {
        e.preventDefault();
        setOpen(false);
      }
    }
  }

  return (
    <div className="pc-combo">
      <label htmlFor={`${id}-input`} className="sr-only">
        Propose un article du jeu
      </label>
      <Search className="pc-combo-icon size-4" aria-hidden />
      <input
        id={`${id}-input`}
        ref={input}
        role="combobox"
        aria-expanded={shown}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={shown && items[active] ? `${id}-opt-${active}` : undefined}
        className="field h-12 pl-10 text-base"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={onKeyDown}
        placeholder="Un article du jeu : tape quelques lettres…"
        autoComplete="off"
        autoCapitalize="sentences"
        spellCheck={false}
        maxLength={80}
        disabled={disabled}
        enterKeyHint="send"
      />
      {shown && (
        <ul id={`${id}-list`} role="listbox" className="pc-combo-list" aria-label="Articles proposés">
          {items.length === 0 ? (
            <li className="px-3 py-2.5 text-sm text-muted" role="presentation">
              {isLoading ? "Recherche…" : "Aucun article Super rare ou mieux à ce nom."}
            </li>
          ) : (
            items.map((item, i) => {
              const done = guessed.has(item.cardId);
              return (
                <li
                  key={item.cardId}
                  id={`${id}-opt-${i}`}
                  role="option"
                  aria-selected={i === active}
                  aria-disabled={done || undefined}
                  className="pc-combo-option"
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => void choose(item)}
                >
                  <span data-rarity={item.rarity} className="pc-sigil shrink-0" title={RARITY_LABELS[item.rarity]}>
                    {item.rarity}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{item.title}</span>
                  {done && <span className="text-xs text-faint">déjà proposé</span>}
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}

function CellIcon({ state, arrow }: { state: string; arrow: "up" | "down" | null }) {
  if (arrow === "up") return <ArrowUp className="size-3.5" aria-hidden />;
  if (arrow === "down") return <ArrowDown className="size-3.5" aria-hidden />;
  if (state === "good") return <Check className="size-3.5" aria-hidden />;
  if (state === "near") return <EqualApproximately className="size-3.5" aria-hidden />;
  if (state === "bad") return <X className="size-3.5" aria-hidden />;
  return null;
}

const ARROW_TEXT: Record<ArticleAttrKey, { up: string; down: string } | null> = {
  category: null,
  type: null,
  country: null,
  year: { up: "la réponse est plus récente", down: "la réponse est plus ancienne" },
  rarity: { up: "la réponse est plus rare", down: "la réponse est moins rare" },
  views: { up: "la réponse est plus lue", down: "la réponse est moins lue" },
};

/** Ligne d'un essai : titre, puis six cases ; une ligne neuve se dévoile case par case. */
function GuessRow({ g, fresh, reduce }: { g: ArticleGuessDTO; fresh: boolean; reduce: boolean }) {
  return (
    <li className="pc-guess-row" data-fresh={(fresh && !reduce) || undefined}>
      <span className="pc-guess-title" title={g.title}>
        {g.title}
      </span>
      {ATTR_KEYS.map((k, i) => {
        const c = g.cells[k];
        const arrow = c.arrow ? ARROW_TEXT[k]?.[c.arrow] : null;
        return (
          <span
            key={k}
            className="pc-attr"
            data-state={c.state}
            style={fresh && !reduce ? { animationDelay: `${80 + i * 70}ms` } : undefined}
            aria-label={`${ATTR_LABELS[k]} : ${c.value}, ${STATE_LABELS[c.state]}${arrow ? `, ${arrow}` : ""}`}
          >
            <span className="pc-attr-label" aria-hidden>
              {ATTR_LABELS[k]}
            </span>
            <span className="pc-attr-value" aria-hidden>
              {c.value}
              <CellIcon state={c.state} arrow={c.arrow} />
            </span>
          </span>
        );
      })}
    </li>
  );
}

function Distribution({ stats, mine }: { stats: NonNullable<DailyArticleDTO["stats"]>; mine: number | null }) {
  const max = Math.max(1, ...stats.distribution);
  return (
    <div className="flex w-full flex-col gap-2">
      <p className="tnum text-center text-sm text-muted">
        {fmt(stats.found)} {plural(stats.found, "joueur a trouvé", "joueurs ont trouvé")} sur {fmt(stats.played)}{" "}
        aujourd&apos;hui.
      </p>
      <ol className="pc-dist" aria-label="Essais des joueurs qui ont trouvé">
        {stats.distribution.map((n, i) => (
          <li key={i} data-mine={mine === i + 1 || undefined}>
            <span className="tnum w-3 text-right text-xs text-muted">{i + 1}</span>
            <span className="pc-dist-bar" style={{ transform: `scaleX(${Math.max(0.04, n / max)})` }} aria-hidden />
            <span className="tnum text-xs">{n}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export default function ArticlePage() {
  useSeenFeature("article-v2");
  const { mutateMe } = useMe();
  const reduce = !!useReducedMotion();
  const { data, error, mutate } = useSWR<DailyArticleDTO>("/article");
  const [freshId, setFreshId] = useState<number | null>(null);
  // Partie finie sous nos yeux : la carte se retourne un instant après ; en revenant sur une partie
  // déjà finie, elle est face visible d'emblée.
  const [justFinished, setJustFinished] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const revealed = !!data?.finished && (!justFinished || flipped);
  const now = useNow(30_000);

  async function guess(item: ArticleSearchItemDTO): Promise<boolean> {
    try {
      const res = await api<DailyArticleDTO>("/article/guess", { body: { cardId: item.cardId } });
      setFreshId(item.cardId);
      if (res.finished) {
        setJustFinished(true);
        setTimeout(() => setFlipped(true), 900);
      }
      await mutate(res, { revalidate: false });
      if (res.found) {
        play("victory");
        toast.success(`Trouvé ! +${res.reward} PW`);
        void mutateMe();
      } else if (res.finished) play("defeat");
      else play("wrong");
      return true;
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Impossible d'envoyer ta réponse.");
      return false;
    }
  }

  async function share() {
    if (!data?.share) return;
    try {
      await navigator.clipboard.writeText(`${data.share}\n${SITE_URL}/article`);
      toast.success("Copié : colle-le à tes potes !");
    } catch {
      toast.error("Copie impossible sur ce navigateur.");
    }
  }

  if (error) return <ErrorBox error={error} retry={() => mutate()} />;
  const state = !data ? "playing" : data.found ? "found" : data.finished ? "lost" : "playing";
  const used = data ? (data.legacy ? data.legacy.guesses.length : data.guesses.length) : 0;
  const guessed = new Set(data?.guesses.map((g) => g.cardId));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="page-title">Article du jour{data ? ` n° ${data.number}` : ""}</h1>
        <p className="hatnote mt-2">
          Un article très lu, le même pour tout le monde. Propose des articles du jeu : leurs attributs te rapprochent
          de la réponse.
        </p>
      </div>

      {!data ? (
        <div className="h-80 animate-pulse rounded-xl bg-panel" aria-label="Chargement de l'article du jour" />
      ) : (
        <>
          <Rules data={data} />
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)] lg:items-start">
            <div className="flex min-w-0 flex-col gap-5">
              <section
                aria-label="L'article à trouver"
                className="flex flex-col items-center gap-5 rounded-[18px] border border-line bg-panel px-4 py-6 shadow-lift sm:px-6"
              >
                <TitleGrid pattern={data.pattern} state={state} />
                {!data.finished ? (
                  <GuessInput disabled={false} guessed={guessed} onGuess={guess} />
                ) : (
                  <p className="text-center font-display text-2xl uppercase">
                    {data.found ? (
                      <>
                        Trouvé en {used} {plural(used, "essai", "essais")}{" "}
                        <span className="text-highlight">+{data.reward} PW</span>
                      </>
                    ) : (
                      "Raté pour aujourd'hui"
                    )}
                  </p>
                )}
                <div className="flex w-full max-w-xl flex-wrap items-center justify-between gap-3 text-sm">
                  <span
                    className="pc-guess-pips"
                    aria-label={`${used} ${plural(used, "essai", "essais")} sur ${data.maxGuesses}`}
                  >
                    {Array.from({ length: data.maxGuesses }, (_, i) => (
                      <span
                        key={i}
                        data-state={i < used ? (data.found && i === used - 1 ? "right" : "wrong") : undefined}
                      />
                    ))}
                  </span>
                  {!data.finished ? (
                    <span className="tnum text-muted">
                      Prochain essai : <strong className="text-text">{data.nextReward} PW</strong>
                    </span>
                  ) : (
                    <span className="tnum text-muted">
                      Nouvel article dans {timeLeft(new Date(data.nextAt).getTime() - now)}
                    </span>
                  )}
                </div>
                <ul className="pc-hints" aria-label="Indices de secours">
                  {data.hintsAfter.categories.length > 0 && (
                    <li className="pc-hint-wide" data-open={data.hints.categories.length > 0 || undefined}>
                      <span className="pc-hint-label">Catégories Wikipédia</span>
                      <span className="pc-hint-cats">
                        {data.hintsAfter.categories.map((n, i) => {
                          const name = data.hints.categories[i];
                          return name ? (
                            <span key={i} className="pc-hint-cat">
                              {name}
                            </span>
                          ) : (
                            <span key={i} className="pc-hint-cat text-faint" data-locked>
                              <Lock className="mr-1 inline size-3.5 align-[-0.15rem]" aria-hidden />
                              Après {n} essais
                            </span>
                          );
                        })}
                      </span>
                    </li>
                  )}
                  <li data-open={!!data.hints.description || undefined}>
                    {data.hints.description ? (
                      <>
                        <span className="pc-hint-label">Description</span>
                        <span>{data.hints.description}</span>
                      </>
                    ) : (
                      <span className="text-faint">
                        <Lock className="mr-1 inline size-3.5 align-[-0.15rem]" aria-hidden />
                        Description après {data.hintsAfter.description} essais
                      </span>
                    )}
                  </li>
                  <li data-open={!!data.hints.firstLetter || undefined}>
                    {data.hints.firstLetter ? (
                      <>
                        <span className="pc-hint-label">Première lettre</span>
                        <span className="font-display text-xl">{data.hints.firstLetter}</span>
                      </>
                    ) : (
                      <span className="text-faint">
                        <Lock className="mr-1 inline size-3.5 align-[-0.15rem]" aria-hidden />
                        Première lettre après {data.hintsAfter.firstLetter} essais
                      </span>
                    )}
                  </li>
                </ul>
              </section>

              <section aria-labelledby="guesses-title">
                <h2 id="guesses-title" className="section-title !mt-0">
                  Tes essais
                </h2>
                {data.legacy ? (
                  <p className="slot px-4 py-6 text-center text-sm text-muted">
                    Tu as joué l&apos;article du jour avant la nouvelle formule ({data.legacy.guesses.length}{" "}
                    {plural(data.legacy.guesses.length, "essai", "essais")}). Rendez-vous demain pour la version à
                    attributs !
                  </p>
                ) : data.guesses.length === 0 ? (
                  <p className="slot px-4 py-6 text-center text-sm text-muted">
                    Aucun essai pour l&apos;instant. Commence par un article que tu connais bien : ses cases te diront
                    dans quelle direction chercher.
                  </p>
                ) : (
                  <>
                    <div className="pc-guess-head" aria-hidden>
                      <span>Article</span>
                      {ATTR_KEYS.map((k) => (
                        <span key={k}>{ATTR_LABELS[k]}</span>
                      ))}
                    </div>
                    <ol className="pc-guess-list" reversed>
                      {[...data.guesses].reverse().map((g) => (
                        <GuessRow key={g.cardId} g={g} fresh={g.cardId === freshId} reduce={reduce} />
                      ))}
                    </ol>
                  </>
                )}
              </section>
            </div>

            <aside className="flex flex-col items-center gap-4 lg:sticky lg:top-20">
              {!data.answer && <AnswerImage data={data} />}
              {data.answer ? (
                <>
                  <div className="w-[min(15rem,70vw)]">
                    <FlipCard
                      card={data.answer}
                      revealed={revealed}
                      onReveal={() => setFlipped(true)}
                      index={0}
                      speed="normal"
                      stagger={false}
                    />
                  </div>
                  {data.answerCells && (
                    <dl className="pc-answer-attrs">
                      {ATTR_KEYS.map((k) => (
                        <div key={k}>
                          <dt>{ATTR_LABELS[k]}</dt>
                          <dd>{data.answerCells![k]}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  <div className="flex flex-wrap justify-center gap-2">
                    {data.share && (
                      <button type="button" className="btn" onClick={share}>
                        <Copy className="size-4" aria-hidden />
                        Partager ma grille
                      </button>
                    )}
                    {data.answer.pageUrl && (
                      <a href={data.answer.pageUrl} target="_blank" rel="noreferrer" className="btn btn-ghost">
                        Lire l&apos;article
                      </a>
                    )}
                  </div>
                  {data.share && (
                    <pre className="pc-share" aria-label="Ta grille">
                      {data.share.split("\n").slice(1).join("\n")}
                    </pre>
                  )}
                  {data.stats && <Distribution stats={data.stats} mine={data.found ? used : null} />}
                </>
              ) : (
                !data.image && (
                  <div className="slot grid w-full place-items-center px-4 py-3 text-center lg:aspect-[5/7] lg:w-[min(15rem,70vw)] lg:p-6">
                    <p className="font-display text-lg uppercase leading-tight text-faint lg:text-2xl">
                      Pas d&apos;image aujourd&apos;hui : les cases suffiront
                    </p>
                  </div>
                )
              )}
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
