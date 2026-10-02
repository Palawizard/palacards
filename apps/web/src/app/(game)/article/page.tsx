"use client";

import type { ArticleClueDTO, DailyArticleDTO } from "@palacards/shared";
import { Copy } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { FlipCard } from "@/components/PackOpener";
import { ErrorBox } from "@/components/ui";
import { api, ApiError, SITE_URL, thumbSrc } from "@/lib/api";
import { fmt, timeLeft } from "@/lib/format";
import { useSeenFeature } from "@/lib/features";
import { useMe } from "@/lib/game";
import { play } from "@/lib/sfx";
import { useNow } from "@/lib/use-now";
import "@/components/content.css";

/**
 * Le titre en grille de mots croisés : une case par lettre, les mots séparés, la ponctuation gardée.
 * Les lettres dévoilées par les indices (première lettre, moitié) puis le titre entier se posent dans les cases.
 */
function TitleGrid({ pattern, state }: { pattern: string; state: "playing" | "found" | "lost" }) {
  const words = pattern.split(/\s{3,}/).map((w) => w.split(" ").filter(Boolean));
  const letters = words.flat().filter((c) => c === "_" || /[\p{L}\p{N}]/u.test(c)).length;
  return (
    <div className="pc-cross" data-state={state} role="img" aria-label={`Titre de ${letters} lettres`}>
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

function Clue({ clue, index }: { clue: ArticleClueDTO; index: number }) {
  return (
    <li className="pc-clue infobox">
      <h3 className="infobox-head flex items-baseline justify-between gap-3 !text-base">
        <span>{clue.label}</span>
        <span className="tnum font-sans text-xs font-semibold text-faint [font-stretch:100%]">Indice {index + 1}</span>
      </h3>
      <div className="px-4 py-3">
        {clue.image ? (
          // eslint-disable-next-line @next/next/no-img-element -- vignette Wikimedia relayée par l'API
          <img
            src={thumbSrc(clue.image)}
            alt="Illustration de l'article à deviner"
            className="mx-auto max-h-56 rounded-lg object-contain"
          />
        ) : clue.kind === "letters" || clue.kind === "half" ? (
          <p className="tnum text-center font-display text-2xl uppercase tracking-[0.12em]">{clue.text}</p>
        ) : (
          <p className="leading-relaxed text-text [text-wrap:pretty]">{clue.text}</p>
        )}
      </div>
    </li>
  );
}

export default function ArticlePage() {
  useSeenFeature("article");
  const { mutateMe } = useMe();
  const { data, error, mutate } = useSWR<DailyArticleDTO>("/article");
  const [guess, setGuess] = useState("");
  const [busy, setBusy] = useState(false);
  // Partie finie sous nos yeux : la carte se retourne un instant après ; en revenant sur une partie
  // déjà finie, elle est face visible d'emblée.
  const [justFinished, setJustFinished] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const revealed = !!data?.finished && (!justFinished || flipped);
  const input = useRef<HTMLInputElement>(null);
  const now = useNow(30_000);

  async function submit(e: { preventDefault(): void }) {
    e.preventDefault();
    if (busy || !guess.trim() || !data || data.finished) return;
    setBusy(true);
    try {
      const res = await api<DailyArticleDTO>("/article/guess", { body: { guess } });
      if (res.finished) {
        setJustFinished(true);
        setTimeout(() => setFlipped(true), 450);
      }
      await mutate(res, { revalidate: false });
      setGuess("");
      if (res.found) {
        play("victory");
        toast.success(`Trouvé ! +${res.reward} PW`);
        void mutateMe();
      } else if (res.finished) {
        play("defeat");
      } else {
        play("wrong");
        input.current?.focus();
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Impossible d'envoyer ta réponse.");
    } finally {
      setBusy(false);
    }
  }

  async function share() {
    if (!data?.share) return;
    const text = `PalaCards · Article du jour n° ${data.number}\n${data.share}\n${SITE_URL}/article`;
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copié : colle-le à tes potes !");
    } catch {
      toast.error("Copie impossible sur ce navigateur.");
    }
  }

  if (error) return <ErrorBox error={error} retry={() => mutate()} />;
  const state = !data ? "playing" : data.found ? "found" : data.finished ? "lost" : "playing";
  const used = data?.guesses.length ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="page-title">Article du jour{data ? ` n° ${data.number}` : ""}</h1>
        <p className="hatnote mt-2">
          Un article très lu, le même pour tout le monde. Six essais : chaque erreur dévoile un indice. 100 PW au
          premier essai, 10 de moins par essai raté.
        </p>
      </div>

      {!data ? (
        <div className="h-80 animate-pulse rounded-xl bg-panel" />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:items-start">
          <div className="flex flex-col gap-5">
            <section
              aria-label="Le titre à trouver"
              className="flex flex-col items-center gap-5 rounded-[18px] border border-line bg-panel px-4 py-6 shadow-lift sm:px-6"
            >
              <TitleGrid pattern={data.pattern} state={state} />
              {!data.finished ? (
                <form onSubmit={submit} className="flex w-full max-w-lg gap-2">
                  <label htmlFor="article-guess" className="sr-only">
                    Ta réponse : le titre de l&apos;article
                  </label>
                  <input
                    id="article-guess"
                    ref={input}
                    className="field h-12 text-base"
                    value={guess}
                    onChange={(e) => setGuess(e.target.value)}
                    placeholder="Titre de l'article…"
                    autoComplete="off"
                    autoCapitalize="sentences"
                    spellCheck={false}
                    maxLength={120}
                    enterKeyHint="send"
                  />
                  <button type="submit" className="btn btn-primary h-12 shrink-0 px-5" disabled={busy || !guess.trim()}>
                    {busy ? "…" : "Proposer"}
                  </button>
                </form>
              ) : (
                <p className="text-center font-display text-2xl uppercase">
                  {data.found ? (
                    <>
                      Trouvé en {used} essai{used > 1 ? "s" : ""}{" "}
                      <span className="text-highlight">+{data.reward} PW</span>
                    </>
                  ) : (
                    "Raté pour aujourd'hui"
                  )}
                </p>
              )}
              <div className="flex w-full max-w-lg flex-wrap items-center justify-between gap-3 text-sm">
                <span
                  className="pc-guess-pips"
                  aria-label={`${used} essai${used > 1 ? "s" : ""} sur ${data.maxGuesses}`}
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
              {data.guesses.length > 0 && (
                <ul className="flex w-full max-w-lg flex-wrap gap-1.5" aria-label="Tes propositions">
                  {data.guesses.map((g, i) => (
                    <li
                      key={i}
                      className={`chip ${data.found && i === used - 1 ? "!border-good !text-good" : "line-through decoration-danger/70"}`}
                    >
                      {g}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section aria-labelledby="clues-title">
              <h2 id="clues-title" className="section-title !mt-0">
                Indices
              </h2>
              <ol className="flex flex-col gap-3">
                {data.clues.map((c, i) => (
                  <Clue key={`${c.kind}${i}`} clue={c} index={i} />
                ))}
              </ol>
            </section>
          </div>

          <aside className="flex flex-col items-center gap-4 lg:sticky lg:top-20">
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
                <div className="flex flex-wrap justify-center gap-2">
                  <button type="button" className="btn" onClick={share}>
                    <Copy className="size-4" aria-hidden />
                    Partager mon résultat
                  </button>
                  {data.answer.pageUrl && (
                    <a href={data.answer.pageUrl} target="_blank" rel="noreferrer" className="btn btn-ghost">
                      Lire l&apos;article
                    </a>
                  )}
                </div>
                <p className="text-lg tracking-[0.2em]" aria-label="Ton résultat">
                  {data.share}
                </p>
              </>
            ) : (
              <div className="slot grid w-full place-items-center px-4 py-3 text-center lg:aspect-[5/7] lg:w-[min(15rem,70vw)] lg:p-6">
                <p className="font-display text-lg uppercase leading-tight text-faint lg:text-2xl">
                  La carte se retourne quand tu as trouvé
                </p>
              </div>
            )}
            <p className="tnum text-center text-sm text-muted">
              {data.stats.played
                ? `${fmt(data.stats.found)} joueur${data.stats.found > 1 ? "s" : ""} sur ${fmt(data.stats.played)} ${data.stats.found > 1 ? "ont" : "a"} trouvé aujourd'hui.`
                : "Personne n'a encore joué aujourd'hui."}
            </p>
          </aside>
        </div>
      )}
    </div>
  );
}
