"use client";

import { BATTLE_ROUNDS } from "@palacards/game";
import type { BattleAnswerDTO, BattleQuestionDTO, BattleRoundResultDTO, CardDTO } from "@palacards/shared";
import { Check, X } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { use, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { Card } from "@/components/Card";
import { ErrorBox } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { fmt } from "@/lib/format";
import { useConnection, useSocket, useSocketEvent } from "@/lib/game";
import { useNow } from "@/lib/use-now";

interface RoundRecap {
  round: number;
  type: string;
  prompt: string;
  choices: string[];
  correctIndex: number;
  yourChoice: number | null;
  yourPower: number;
  theirPower: number | null;
  winnerId: string | null;
}
interface BattleDetail {
  id: number;
  mode: "live" | "async";
  status: string;
  isChallenger: boolean;
  opponent: { id: string; name: string; username: string };
  winnerId: string | null;
  score: { you: number; them: number };
  eloDelta: number | null;
  nextRound: number | null;
  liveRound: number | null;
  myDeck: (CardDTO & { slot: number })[];
  theirDeck: (CardDTO & { slot: number })[];
  rounds: RoundRecap[];
}
/** Résultat de la manche : réponse HTTP, ou résumé reçu par socket en direct (sans la carte adverse). */
type AnswerResult = Omit<BattleAnswerDTO, "battleId" | "theirCard"> & { theirCard?: CardDTO };

const TYPE_LABEL: Record<string, string> = {
  who_am_i: "Qui suis-je ?",
  most_viewed: "Le plus lu",
  longest: "Le plus long",
};

/** Barre de temps : se vide en continu jusqu'à l'échéance (calculée à la réception, sans dépendre de l'horloge du serveur). */
function Countdown({ endsAt, total }: { endsAt: number; total: number }) {
  const now = useNow(200);
  const left = Math.max(0, endsAt - now);
  return (
    <div className="flex items-center gap-3" aria-live="off">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-panel-2">
        <div
          className={`h-full origin-left rounded-full transition-transform duration-200 ease-linear ${left < 3000 ? "bg-danger" : "bg-accent"}`}
          style={{ transform: `scaleX(${left / total})` }}
        />
      </div>
      <span className="tnum w-8 text-right text-sm font-semibold">{Math.ceil(left / 1000)}</span>
    </div>
  );
}

function QuestionPanel({
  q,
  endsAt,
  result,
  onAnswer,
}: {
  q: BattleQuestionDTO;
  endsAt: number;
  result: AnswerResult | null;
  onAnswer: (choice: number) => void;
}) {
  const locked = !!result || q.answered;
  const theirCard = result?.theirCard ?? q.theirCard;
  return (
    <section aria-label={`Manche ${q.round}`} className="flex flex-col gap-4">
      {/* Mobile : la question d'abord (le chrono tourne), les cartes ensuite. */}
      <div className="order-2 mx-auto grid w-full max-w-[22rem] grid-cols-2 gap-3 sm:order-1 sm:max-w-[30rem]">
        <div className="flex flex-col gap-1">
          <span className="text-center text-xs text-faint">Ta carte</span>
          <Card card={q.yourCard} href={null} />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-center text-xs text-faint">Sa carte</span>
          {theirCard ? (
            <Card card={theirCard} href={null} />
          ) : (
            // Carte adverse face cachée : ses stats trahiraient la réponse.
            <div className="pc-card grid place-items-center" aria-label="Carte adverse, révélée après ta réponse">
              <span aria-hidden className="font-serif text-[length:max(1.5rem,22cqi)] text-faint">
                ?
              </span>
            </div>
          )}
        </div>
      </div>
      <div className="infobox order-1 sm:order-2">
        <h2 className="infobox-head flex items-baseline justify-between">
          <span>{TYPE_LABEL[q.type] ?? "Question"}</span>
          <span className="tnum text-sm text-faint">
            Manche {q.round}/{BATTLE_ROUNDS}
          </span>
        </h2>
        <div className="flex flex-col gap-4 p-4">
          <p className={q.type === "who_am_i" ? "font-serif text-lg leading-relaxed" : "text-lg font-semibold"}>
            {q.prompt}
          </p>
          {!locked && <Countdown endsAt={endsAt} total={q.timeLimitMs} />}
          <div className="grid gap-2 sm:grid-cols-2">
            {q.choices.map((choice, i) => {
              const isCorrect = result && i === result.correctIndex;
              const isMine = result && i === result.yourChoice;
              return (
                <button
                  key={i}
                  type="button"
                  disabled={locked}
                  onClick={() => onAnswer(i)}
                  className={`btn min-h-12 justify-start whitespace-normal text-left font-serif text-base font-normal ${
                    isCorrect ? "border-accent bg-accent/15 text-text" : isMine ? "border-danger bg-danger/10" : ""
                  }`}
                >
                  {isCorrect ? (
                    <Check aria-hidden className="size-4 shrink-0 text-accent" />
                  ) : isMine ? (
                    <X aria-hidden className="size-4 shrink-0 text-danger" />
                  ) : null}
                  {choice}
                </button>
              );
            })}
          </div>
          {!result && q.answered && (
            <p className="text-sm text-muted" role="status">
              Réponse enregistrée, en attente de la fin de la manche…
            </p>
          )}
          {result && (
            <p className="tnum text-sm" role="status">
              {result.yourChoice === null ? "Temps écoulé." : result.correct ? "Bonne réponse !" : "Raté."} Puissance de
              ta carte : <strong>{fmt(result.yourPower)}</strong>
              {result.correct && result.timeLeftMs > 0 && (
                <span className="text-faint">
                  {" "}
                  (bonus de vitesse : {Math.round(result.timeLeftMs / 100) / 10} s restantes)
                </span>
              )}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function Recap({ battle }: { battle: BattleDetail }) {
  const won = battle.winnerId !== null && battle.winnerId !== battle.opponent.id;
  const draw = battle.status === "finished" && battle.winnerId === null;
  return (
    <div className="flex flex-col gap-5">
      {battle.status === "finished" && (
        <motion.div
          initial={{ opacity: 0, transform: "translateY(8px)" }}
          animate={{ opacity: 1, transform: "translateY(0)" }}
          transition={{ duration: 0.35, ease: [0.23, 1, 0.32, 1] }}
          className="rounded-md border border-line-strong bg-panel p-5 text-center"
        >
          <p className={`font-serif text-4xl ${won ? "text-accent" : draw ? "" : "text-danger"}`}>
            {won ? "Victoire" : draw ? "Match nul" : "Défaite"}
          </p>
          <p className="tnum mt-1 text-lg">
            {battle.score.you} – {battle.score.them}
            {battle.eloDelta !== null && (
              <span className={`ml-3 text-base ${battle.eloDelta >= 0 ? "text-accent" : "text-danger"}`}>
                Elo {battle.eloDelta >= 0 ? "+" : ""}
                {battle.eloDelta}
              </span>
            )}
          </p>
        </motion.div>
      )}
      {battle.rounds.length > 0 && (
        <section>
          <h2 className="section-title mt-0">Manches</h2>
          <ol className="flex flex-col gap-2">
            {battle.rounds.map((r) => (
              <li key={r.round} className="rounded-md border border-line bg-panel px-3 py-2.5 text-sm">
                <p className="flex flex-wrap justify-between gap-2">
                  <span className="font-semibold">
                    Manche {r.round} · {TYPE_LABEL[r.type]}
                  </span>
                  <span className="tnum text-muted">
                    {fmt(r.yourPower)}
                    {r.theirPower !== null && ` contre ${fmt(r.theirPower)}`}
                    {r.winnerId && (
                      <strong className={`ml-2 ${r.winnerId === battle.opponent.id ? "text-danger" : "text-accent"}`}>
                        {r.winnerId === battle.opponent.id ? "perdue" : "gagnée"}
                      </strong>
                    )}
                  </span>
                </p>
                <p className="mt-1 text-muted">
                  Réponse : <span className="text-text">{r.choices[r.correctIndex]}</span>
                  {r.yourChoice !== r.correctIndex && (
                    <span> · toi : {r.yourChoice === null ? "pas de réponse" : r.choices[r.yourChoice]}</span>
                  )}
                </p>
              </li>
            ))}
          </ol>
        </section>
      )}
      {battle.theirDeck.length > 0 && (
        <section>
          <h2 className="section-title mt-0">Deck de {battle.opponent.name}</h2>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {battle.theirDeck.map((c) => (
              <Card key={c.slot} card={c} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export default function BattleScreen({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const battleId = Number(id);
  const { data: battle, error, mutate } = useSWR<BattleDetail>(`/battles/${battleId}`);
  const socket = useSocket();
  const connection = useConnection();
  const [question, setQuestion] = useState<BattleQuestionDTO | null>(null);
  const [endsAt, setEndsAt] = useState(0);
  const [result, setResult] = useState<AnswerResult | null>(null);
  const [liveScore, setLiveScore] = useState<{ you: number; them: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const answering = useRef(false);
  /** Manche affichée : une réponse arrivée après le passage à la manche suivante est ignorée. */
  const shownRound = useRef(0);
  const timedOut = useRef(0);

  useEffect(() => {
    if (socket) socket.emit("battle:join", battleId);
  }, [socket, battleId, connection]);

  function showQuestion(q: BattleQuestionDTO) {
    shownRound.current = q.round;
    setQuestion(q);
    setEndsAt(Date.now() + q.remainingMs);
    setResult(null);
    answering.current = q.answered;
  }

  useSocketEvent("battle:question", (q) => {
    if (q.battleId === battleId) showQuestion(q);
  });
  useSocketEvent("battle:round", (r: BattleRoundResultDTO) => {
    if (r.battleId !== battleId) return;
    setLiveScore(r.score);
    if (r.round === shownRound.current) {
      setResult(
        (prev) =>
          prev ?? {
            round: r.round,
            correctIndex: r.correctIndex,
            yourChoice: r.yourChoice,
            correct: r.yourChoice === r.correctIndex,
            yourPower: r.yourPower,
            timeLeftMs: 0,
          },
      );
    }
    toast(
      r.winnerId === null
        ? "Manche nulle."
        : r.winnerId === battle?.opponent.id
          ? `Manche perdue (${fmt(r.yourPower)} contre ${fmt(r.theirPower)}).`
          : `Manche gagnée (${fmt(r.yourPower)} contre ${fmt(r.theirPower)}) !`,
    );
    if (r.finished) void mutate();
  });
  useSocketEvent("battle:update", ({ battleId: b }) => {
    if (b === battleId) void mutate();
  });

  async function playRound(round: number) {
    setBusy(true);
    try {
      showQuestion(await api<BattleQuestionDTO>(`/battles/${battleId}/rounds/${round}/question`, { method: "POST" }));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Question indisponible.");
    } finally {
      setBusy(false);
    }
  }

  async function answer(choice: number, auto = false) {
    if (!question || answering.current) return;
    const round = question.round;
    answering.current = true;
    try {
      const res = await api<BattleAnswerDTO>(`/battles/${battleId}/rounds/${round}/answer`, { body: { choice } });
      if (shownRound.current === round) setResult(res);
      if (battle?.mode === "async") void mutate();
    } catch (err) {
      // Envoi automatique refusé (manche déjà close) : on resynchronise au lieu de réessayer en boucle.
      if (auto || (err instanceof ApiError && err.status === 409)) void mutate();
      else answering.current = false;
      if (!auto) toast.error(err instanceof ApiError ? err.message : "Réponse non enregistrée.");
    }
  }

  // Temps écoulé sans réponse : on envoie « pas de réponse » une seule fois pour passer à la suite.
  const now = useNow(500);
  useEffect(() => {
    if (!question || result || !endsAt || now <= endsAt + 300 || battle?.mode !== "async") return;
    if (answering.current || timedOut.current === question.round) return;
    timedOut.current = question.round;
    void answer(-1, true);
  });

  if (error) return <ErrorBox error={error} retry={() => mutate()} />;
  if (!battle) return <div className="h-72 animate-pulse rounded-md bg-panel" aria-busy />;

  const score = liveScore ?? battle.score;
  const asyncDone = battle.mode === "async" && battle.status === "active" && (battle.nextRound ?? 1) > BATTLE_ROUNDS;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-line-strong pb-2">
        <div>
          <h1 className="font-serif text-[clamp(1.6rem,1.3rem+1.3vw,2.2rem)] leading-tight">
            Duel contre {battle.opponent.name}
          </h1>
          <p className="text-sm text-muted">{battle.mode === "live" ? "En direct" : "Asynchrone"}</p>
        </div>
        {battle.status !== "pending" && (
          <p className="tnum font-serif text-3xl" aria-label={`Score : ${score.you} à ${score.them}`}>
            {score.you} <span className="text-faint">–</span> {score.them}
          </p>
        )}
      </header>

      {battle.status === "pending" && (
        <p className="text-muted">
          {battle.isChallenger
            ? `En attente de la réponse de ${battle.opponent.name}.`
            : "Ce défi t’attend sur la page Bataille."}{" "}
          <Link href="/battle" className="article-link">
            Retour aux duels
          </Link>
        </p>
      )}

      {battle.status === "active" && battle.mode === "live" && !question && (
        <p className="text-muted">
          Le duel démarre dès que vous êtes connectés tous les deux. Première question dans un instant…
        </p>
      )}

      {battle.status === "active" && battle.mode === "async" && !question && !asyncDone && (
        <div className="flex flex-col items-start gap-3">
          <p className="text-muted">
            Manche {battle.nextRound} sur {BATTLE_ROUNDS}. Tu as 10 secondes dès l’affichage de la question.
          </p>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => playRound(battle.nextRound ?? 1)}
          >
            Jouer la manche {battle.nextRound}
          </button>
        </div>
      )}

      <p className="sr-only" aria-live="polite">
        {question && battle.status === "active"
          ? `Manche ${question.round} : ${TYPE_LABEL[question.type] ?? "question"}. ${question.prompt}`
          : ""}
      </p>
      {question && battle.status === "active" && (
        <QuestionPanel q={question} endsAt={endsAt} result={result} onAnswer={answer} />
      )}

      {question && result && battle.mode === "async" && battle.status === "active" && (
        <div>
          {question.round < BATTLE_ROUNDS ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => playRound(question.round + 1)}
              disabled={busy}
            >
              Manche suivante
            </button>
          ) : (
            <p className="text-muted">
              Tu as joué tes {BATTLE_ROUNDS} manches. Le résultat tombera quand {battle.opponent.name} aura joué les
              siennes.
            </p>
          )}
        </div>
      )}
      {asyncDone && !question && (
        <p className="text-muted">
          Tu as joué tes {BATTLE_ROUNDS} manches. Le résultat tombera quand {battle.opponent.name} aura joué les
          siennes.
        </p>
      )}

      {(battle.status === "finished" || (!question && battle.rounds.length > 0)) && <Recap battle={battle} />}
      {["declined", "cancelled"].includes(battle.status) && <p className="text-muted">Ce défi n’a pas eu lieu.</p>}
    </div>
  );
}
