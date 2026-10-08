"use client";

// Page Admin des suggestions : tri par Claude (verdict, réponse proposée) et branche GitHub construite.
// Rien ne part chez le joueur d'ici : « Utiliser cette réponse » remplit seulement le champ de réponse.
import type { AdminSuggestionDTO, SuggestionAutomationDTO, TriageVerdict } from "@palacards/shared";
import { ArrowUpRight, CornerDownLeft, GitPullRequest, RotateCcw, Wand2 } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { relative } from "@/lib/format";

const EASE_OUT = [0.23, 1, 0.32, 1] as const;

const VERDICTS: Record<TriageVerdict, string> = {
  build: "À coder",
  decision: "À trancher",
  bug: "Bug à corriger",
  non: "Refus proposé",
  prod: "À faire en prod",
  saison: "Prochaine saison",
};
const CATEGORIES: Record<string, string> = {
  important: "important",
  confort: "confort",
  bloat: "peu utile",
  refus: "à ne pas retenir",
  troll: "troll",
};

function buildLine(a: SuggestionAutomationDTO): { state: string; text: string; live?: boolean } | null {
  switch (a.buildStatus) {
    case "none":
      return null;
    case "queued":
      // Pause sur la limite du forfait Claude : le message dit quand la branche repart.
      if (a.error?.startsWith("Limite du forfait")) return { state: "wait", text: a.error };
      return {
        state: "wait",
        text: "En file : part quand la PR en cours est mergée ou fermée (une à la fois, plafond du jour).",
      };
    case "published":
      return { state: "wait", text: "Issue ouverte : Claude va commencer la branche.", live: true };
    case "running":
      if (a.prUrl && a.ciConclusion === "failure")
        return { state: "wait", text: "CI en échec : Claude répare la branche tout seul…", live: true };
      return { state: "wait", text: "Claude code la branche…", live: true };
    case "ready":
      return {
        state: a.ciConclusion === "success" ? "ok" : "bad",
        text: `Branche prête · ${a.ciConclusion === "success" ? "CI verte" : `CI ${a.ciConclusion === "failure" ? "en échec" : (a.ciConclusion ?? "inconnue")}`}`,
      };
    case "failed": {
      // Un échec bloque la file jusqu'à la décision de Palawi.
      const why = a.error ? `La branche a échoué : ${a.error}` : "La branche a échoué.";
      return {
        state: "bad",
        text: a.prUrl
          ? `${why} La file attend : réponds @claude dans la PR pour qu'il corrige, ou ferme-la.`
          : `${why} La file attend : reconstruis la branche ou abandonne-la.`,
      };
    }
    case "merged":
      return { state: "ok", text: "Mergée dans dev : la réponse part après la mise en prod." };
    case "closed":
      return { state: "off", text: "Branche abandonnée." };
  }
}

/** Panneau « Tri de Claude » d'une suggestion. `onUseReply` remplit le champ de réponse de l'admin. */
export function AutomationPanel({
  s,
  onChanged,
  onUseReply,
}: {
  s: AdminSuggestionDTO;
  onChanged: () => void;
  onUseReply: (text: string) => void;
}) {
  const reduce = useReducedMotion();
  const [busy, setBusy] = useState(false);
  const a = s.automation;

  async function run(path: string, ok: string) {
    setBusy(true);
    try {
      await api(`/admin/suggestions/${s.id}${path}`, { method: "POST" });
      toast.success(ok);
      onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Action impossible.");
    } finally {
      setBusy(false);
    }
  }

  if (!a)
    return (
      <div className="pc-auto pc-auto-empty">
        <span className="text-xs text-faint">Pas encore triée par Claude.</span>
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          disabled={busy}
          onClick={() => void run("/triage", "Tri lancé.")}
        >
          <Wand2 aria-hidden className="size-3.5" />
          Trier avec Claude
        </button>
      </div>
    );

  const pending = a.triageStatus === "pending" || a.triageStatus === "running";
  const build = buildLine(a);
  const reply =
    a.playerReply && (a.buildStatus === "ready" || a.buildStatus === "merged") ? a.playerReply : a.proposedReply;
  const canBuild =
    a.triageStatus === "done" && !!a.spec && ["none", "closed", "failed"].includes(a.buildStatus) && !pending;

  return (
    <section className="pc-auto" aria-label={`Tri de Claude pour « ${s.title} »`}>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <span className="pc-auto-label">Tri de Claude</span>
        {pending ? (
          <span className="pc-verdict" data-live>
            {a.triageStatus === "running" ? "Tri en cours…" : "En attente du tri"}
          </span>
        ) : a.triageStatus === "error" ? (
          <span className="pc-verdict" data-verdict="error">
            Tri en échec · {a.attempts} essai{a.attempts > 1 ? "s" : ""}
          </span>
        ) : a.verdict ? (
          <>
            <span className="pc-verdict" data-verdict={a.verdict}>
              {VERDICTS[a.verdict]}
            </span>
            {a.category && <span className="text-xs text-faint">{CATEGORIES[a.category] ?? a.category}</span>}
          </>
        ) : null}
        {a.triagedAt && !pending && <span className="tnum ml-auto text-xs text-faint">{relative(a.triagedAt)}</span>}
      </div>

      {a.triageStatus === "error" && a.error && (
        <p className="mt-2 text-sm text-danger [overflow-wrap:anywhere]">{a.error}</p>
      )}

      {a.triageStatus === "done" && (
        <motion.div
          key={a.triagedAt ?? "done"}
          initial={reduce ? { opacity: 0 } : { opacity: 0, transform: "translateY(-3px)" }}
          animate={{ opacity: 1, transform: "translateY(0px)" }}
          transition={{ duration: 0.2, ease: EASE_OUT }}
          className="mt-2 flex flex-col gap-2.5"
        >
          {a.summary && <p className="text-sm font-semibold leading-snug">{a.summary}</p>}
          {a.injection && (
            <p className="text-sm text-danger">
              Le texte essayait de donner des consignes à l’IA : rien n’a été lancé.
            </p>
          )}
          {a.duplicateOf && (
            <p className="text-sm text-muted">
              Doublon de la{" "}
              <a href={`#suggestion-${a.duplicateOf}`} className="article-link">
                suggestion n° {a.duplicateOf}
              </a>
              .
            </p>
          )}
          {a.questions.length > 0 && (
            <ol className="pc-auto-questions">
              {a.questions.map((q) => (
                <li key={q.question}>
                  <span className="font-semibold">{q.question}</span>
                  <span className="text-muted">
                    {" "}
                    {q.options.map((o, i) => (
                      <span key={o}>
                        {i > 0 && " · "}
                        <span className={o === q.recommended ? "font-semibold text-text" : undefined}>{o}</span>
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ol>
          )}
          {(a.reasoning || a.spec) && (
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {a.reasoning && (
                <details className="pc-auto-more">
                  <summary>Pourquoi ce verdict</summary>
                  <p>{a.reasoning}</p>
                </details>
              )}
              {a.spec && (
                <details className="pc-auto-more">
                  <summary>
                    {a.verdict === "prod"
                      ? "À faire en prod"
                      : a.verdict === "saison"
                        ? "Refonte pour une prochaine saison"
                        : "Cahier des charges publié"}
                  </summary>
                  <p>{a.spec}</p>
                </details>
              )}
            </div>
          )}
        </motion.div>
      )}

      {build && (
        <p className="pc-build mt-3" data-state={build.state} data-live={build.live || undefined}>
          <GitPullRequest aria-hidden className="size-3.5 shrink-0" />
          <span>{build.text}</span>
          {a.prUrl ? (
            <a
              href={a.prUrl}
              target="_blank"
              rel="noreferrer"
              className="article-link inline-flex items-center gap-0.5"
            >
              Pull request
              <ArrowUpRight aria-hidden className="size-3" />
            </a>
          ) : a.issueUrl ? (
            <a
              href={a.issueUrl}
              target="_blank"
              rel="noreferrer"
              className="article-link inline-flex items-center gap-0.5"
            >
              Issue
              <ArrowUpRight aria-hidden className="size-3" />
            </a>
          ) : null}
        </p>
      )}

      {reply && a.triageStatus === "done" && (
        <div className="pc-auto-reply mt-3">
          <p className="pc-auto-label">
            {reply === a.playerReply ? "Réponse rédigée avec la branche" : "Réponse proposée"}
          </p>
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{reply}</p>
          {a.announcement && reply === a.playerReply && (
            <p className="mt-1.5 text-xs text-faint">Ligne d’annonce : {a.announcement}</p>
          )}
          <button type="button" className="btn btn-sm mt-2" onClick={() => onUseReply(reply)}>
            <CornerDownLeft aria-hidden className="size-3.5" />
            Utiliser cette réponse
          </button>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-1.5">
        {canBuild && (
          <button
            type="button"
            className="btn btn-sm"
            disabled={busy}
            onClick={() => void run("/build", "Branche mise en file.")}
          >
            <GitPullRequest aria-hidden className="size-3.5" />
            {a.buildStatus === "none" ? "Construire la branche" : "Reconstruire la branche"}
          </button>
        )}
        {a.buildStatus === "failed" && !a.prUrl && (
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            disabled={busy}
            onClick={() => void run("/build/cancel", "Branche abandonnée : la file repart.")}
          >
            Abandonner
          </button>
        )}
        {a.buildStatus === "queued" && (
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            disabled={busy}
            onClick={() => void run("/build/cancel", "Retirée de la file.")}
          >
            Retirer de la file
          </button>
        )}
        {!pending && (
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            disabled={busy}
            onClick={() => void run("/triage", "Tri relancé.")}
          >
            <RotateCcw aria-hidden className="size-3.5" />
            Relancer le tri
          </button>
        )}
      </div>
    </section>
  );
}

/** Une suggestion attend encore Claude (tri ou branche) : la liste se recharge régulièrement. */
export const automationInFlight = (items: AdminSuggestionDTO[]) =>
  items.some(
    (s) =>
      s.automation &&
      (s.automation.triageStatus === "pending" ||
        s.automation.triageStatus === "running" ||
        ["queued", "published", "running"].includes(s.automation.buildStatus)),
  );
