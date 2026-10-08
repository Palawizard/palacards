import { desc, eq, ne, schema, sql, type Db } from "@palacards/db";
import {
  BUILD_IN_FLIGHT_MS,
  branchFor,
  claimTriage,
  publishedToday,
  releaseStaleTriage,
  TRIAGE_MAX_ATTEMPTS,
  USAGE_LIMIT_PREFIX,
  type AutomationRow,
} from "../services/automation.js";
import { postDiscord, quote, truncate } from "./discord.js";
import { createIssue, pullState, type GithubConfig } from "./github.js";
import { triageSuggestion, type ClaudeRunner, type TriageResult } from "./triage.js";

/**
 * Cœur du service de tri : trie les suggestions en attente, puis publie sur GitHub celles à coder, dans la
 * limite du plafond du jour. Toutes les opérations sont reprises sans dommage (verrous, statuts en base).
 */

export interface EngineDeps {
  db: Db;
  now: () => Date;
  log: { info: (o: object, m?: string) => void; error: (o: object, m?: string) => void };
  runner: ClaudeRunner;
  model: string;
  /** Sans jeton GitHub : les suggestions à coder restent en file (« queued »). */
  github: GithubConfig | null;
  discordUrl: string | undefined;
  maxBuildsPerDay: number;
  /** Adresse publique du jeu (liens Discord vers la page Admin). */
  publicUrl: string;
}

const a = schema.suggestionAutomation;
const s = schema.suggestions;
/**
 * États d'une suggestion dont la pull request attend encore la décision de Palawi : prête, reprise en cours
 * (`@claude`), ou reprise en échec. Tant qu'une telle PR est ouverte, rien d'autre ne part.
 */
const PR_PENDING = sql.raw("('ready', 'running', 'failed')");

const VERDICT_LABELS: Record<TriageResult["verdict"], string> = {
  build: "À coder",
  decision: "À trancher",
  bug: "Bug à corriger",
  non: "Refus proposé",
  prod: "À faire en prod",
  saison: "Prochaine saison",
};
const KIND_LABELS: Record<string, string> = {
  bug: "Bug",
  feature: "Fonctionnalité",
  content: "Contenu",
  balance: "Équilibrage",
  other: "Autre",
};

/** Attente avant de retenter un tri en échec : 2, 4, 8, 16 minutes. */
const retryDelayMs = (attempts: number) => 2 ** attempts * 60_000;

export function createEngine(deps: EngineDeps) {
  const ctx = { db: deps.db, now: deps.now };
  const adminLink = (id: number) => `${deps.publicUrl}/admin/suggestions#suggestion-${id}`;

  async function discord(text: string) {
    try {
      await postDiscord(deps.discordUrl, text);
    } catch (err) {
      deps.log.error({ err }, "message Discord");
    }
  }

  async function triageOne(row: AutomationRow) {
    const id = row.suggestionId;
    const [sug] = await deps.db
      .select({ id: s.id, kind: s.kind, title: s.title, body: s.body, username: schema.user.username })
      .from(s)
      .leftJoin(schema.user, eq(schema.user.id, s.userId))
      .where(eq(s.id, id));
    if (!sug) return;
    const recent = await deps.db
      .select({ id: s.id, status: s.status, title: s.title })
      .from(s)
      .where(ne(s.id, id))
      .orderBy(desc(s.id))
      .limit(80);

    let result: TriageResult;
    try {
      result = await triageSuggestion(deps.runner, deps.model, {
        suggestion: { id, kind: sug.kind, title: sug.title, body: sug.body },
        recent,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      deps.log.error({ err, suggestionId: id }, "tri de la suggestion");
      await deps.db
        .update(a)
        .set({
          triageStatus: "error",
          error: truncate(message, 1000),
          nextAttemptAt: new Date(deps.now().getTime() + retryDelayMs(row.attempts)),
          updatedAt: deps.now(),
        })
        .where(eq(a.suggestionId, id));
      if (row.attempts >= TRIAGE_MAX_ATTEMPTS)
        await discord(
          `**Tri impossible** pour la suggestion n° ${id} après ${row.attempts} essais : ${truncate(message, 300)}\n${adminLink(id)}`,
        );
      return;
    }

    // Pas de branche pour « non », « prod » (Palawi le fait en production), « saison » (refonte gardée pour une
    // prochaine saison) ni pour une idée « bloat » : Palawi peut toujours lancer la branche depuis Admin.
    const noBranchVerdict = ["non", "prod", "saison"].includes(result.verdict);
    const heldAsBloat = !noBranchVerdict && result.category === "bloat";
    const wantsBuild = !noBranchVerdict && !heldAsBloat;
    // Une branche déjà lancée (ou mergée) n'est pas relancée par un nouveau tri.
    const canQueue = ["none", "closed", "failed"].includes(row.buildStatus);
    const queue = wantsBuild && canQueue;
    await deps.db
      .update(a)
      .set({
        triageStatus: "done",
        error: null,
        verdict: result.verdict,
        category: result.category,
        summary: result.summary,
        reasoning: result.reasoning,
        spec: result.spec || null,
        questions: result.questions,
        proposedReply: result.proposedReply,
        duplicateOf: result.duplicateOf,
        injection: result.injection,
        triagedAt: deps.now(),
        ...(queue
          ? { buildStatus: "queued" as const, branch: branchFor(id, result.verdict), prNumber: null, issueNumber: null }
          : {}),
        updatedAt: deps.now(),
      })
      .where(eq(a.suggestionId, id));

    const head = `**Suggestion n° ${id}**${sug.username ? ` de ${sug.username}` : ""} · ${KIND_LABELS[sug.kind] ?? sug.kind} : **${VERDICT_LABELS[result.verdict]}** (${result.category})`;
    const lines = [head, quote(result.summary)];
    if (result.injection) lines.push("Le texte essayait de donner des consignes à l'IA : rien n'a été lancé.");
    if (result.duplicateOf) lines.push(`Doublon de la suggestion n° ${result.duplicateOf}.`);
    if (result.verdict === "non") lines.push("Rien n'est envoyé au joueur : la réponse proposée t'attend dans Admin.");
    if (result.verdict === "prod") lines.push(`Pas de branche : c'est à faire en prod.\n${quote(result.spec, 600)}`);
    if (result.verdict === "saison")
      lines.push(
        "Pas de branche : refonte à garder pour une prochaine saison (« Construire la branche » dans Admin pour la forcer).",
      );
    else if (heldAsBloat)
      lines.push(
        "Pas de branche automatique (catégorie « bloat ») : « Construire la branche » dans Admin si tu la veux quand même.",
      );
    else if (result.verdict === "decision")
      lines.push(
        `${result.questions.length} question${result.questions.length > 1 ? "s" : ""} à trancher : Claude prépare la branche avec ses choix provisoires.`,
      );
    lines.push(adminLink(id));
    await discord(lines.join("\n"));
  }

  /**
   * Une PR ouverte (prête, reprise en cours ou en échec) attend la décision de Palawi. Si elle a été mergée ou
   * fermée sans que le workflow de fin ne rende compte (GitHub ne lance pas les workflows d'une PR en conflit, un
   * run annulé ne rend pas toujours compte), on lit son état sur GitHub.
   */
  async function settleOpenPulls() {
    if (!deps.github) return;
    const open = await deps.db
      .select({ id: a.suggestionId, pr: a.prNumber, status: a.buildStatus })
      .from(a)
      .where(sql`${a.prNumber} is not null and ${a.buildStatus} in ${PR_PENDING}`);
    for (const row of open) {
      if (!row.pr) continue;
      try {
        const state = await pullState(deps.github, row.pr);
        if (state === "open") continue;
        await deps.db
          .update(a)
          .set({ buildStatus: state, updatedAt: deps.now() })
          .where(sql`${a.suggestionId} = ${row.id} and ${a.buildStatus} = ${row.status}`);
        deps.log.info({ suggestionId: row.id, pr: row.pr, state }, "PR terminée hors workflow");
      } catch (err) {
        deps.log.error({ err, suggestionId: row.id }, "lecture de l'état de la PR");
      }
    }
  }

  /**
   * Publie la prochaine suggestion en file (issue GitHub), une à la fois : rien ne part tant qu'une branche est
   * publiée ou en cours, tant qu'une PR attend la décision de Palawi (merge ou fermeture), tant qu'une branche en
   * échec attend la sienne (PR à corriger avec @claude ou à fermer ; sans PR : Reconstruire ou Abandonner dans
   * Admin), pendant une pause sur la limite du forfait Claude, ni au-delà du plafond du jour. Une suggestion déjà
   * partie une fois (reconstruite, ou interrompue par la limite du forfait) repasse en tête de file. GitHub ne garde d'ailleurs qu'un seul run en
   * attente par groupe de concurrence et annule les autres.
   */
  async function publishQueued() {
    if (!deps.github) return;
    await settleOpenPulls();
    const now = deps.now();
    const inFlightSince = new Date(now.getTime() - BUILD_IN_FLIGHT_MS).toISOString();
    const [busy] = await deps.db.execute<{ n: number }>(sql`
      select count(*)::int as n from suggestion_automation
      where (build_status in ('published', 'running') and updated_at > ${inFlightSince}::timestamptz)
         or (pr_number is not null and build_status in ${PR_PENDING})
         or build_status = 'failed'
         or (build_status = 'queued' and next_attempt_at > ${now.toISOString()}::timestamptz
             and error like ${`${USAGE_LIMIT_PREFIX}%`})
    `);
    if ((busy?.n ?? 0) > 0) return;
    if ((await publishedToday(ctx)) >= deps.maxBuildsPerDay) return;
    const [claimed] = await deps.db.execute<{ suggestion_id: string }>(sql`
      update suggestion_automation set build_status = 'published', published_at = ${now.toISOString()}::timestamptz,
        error = null, updated_at = ${now.toISOString()}::timestamptz
      where suggestion_id = (
        select suggestion_id from suggestion_automation where build_status = 'queued'
        order by published_at nulls last, updated_at, suggestion_id for update skip locked limit 1
      )
      returning suggestion_id
    `);
    if (!claimed) return;
    const id = Number(claimed.suggestion_id);
    const [row] = await deps.db
      .select({ automation: a, kind: s.kind })
      .from(a)
      .innerJoin(s, eq(s.id, a.suggestionId))
      .where(eq(a.suggestionId, id));
    if (!row) return;
    try {
      const issue = await createIssue(deps.github, issueFor(id, row.kind, row.automation));
      await deps.db.update(a).set({ issueNumber: issue.number, updatedAt: deps.now() }).where(eq(a.suggestionId, id));
      await discord(`Branche en préparation pour la suggestion n° ${id} : ${issue.url}`);
    } catch (err) {
      deps.log.error({ err, suggestionId: id }, "création de l'issue GitHub");
      // Remise en file : nouvel essai au prochain passage.
      await deps.db
        .update(a)
        .set({ buildStatus: "queued", publishedAt: null, updatedAt: deps.now() })
        .where(eq(a.suggestionId, id));
    }
  }

  let running = false;
  let again = false;
  /** Un passage complet : tri de tout ce qui attend, puis publication. Les appels concurrents sont fusionnés. */
  async function tick() {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        for (let row = await claimTriage(ctx); row; row = await claimTriage(ctx)) await triageOne(row);
        await publishQueued();
      } while (again);
    } catch (err) {
      deps.log.error({ err }, "passage du service de tri");
    } finally {
      running = false;
    }
  }

  return { tick, publishQueued, releaseStale: () => releaseStaleTriage(ctx) };
}

/** Issue publique : cahier des charges reformulé et anonyme, jamais le texte ni le pseudo du joueur. */
export function issueFor(id: number, kind: string, row: AutomationRow) {
  // Construction forcée depuis Admin : une refonte de saison a forcément des choix à trancher.
  const verdict =
    row.verdict === "saison"
      ? "decision"
      : row.verdict === "non" || row.verdict === "prod"
        ? "build"
        : (row.verdict ?? "build");
  const questions = row.questions.length
    ? `\n\n### Questions à trancher\n\nClaude prend l'option recommandée en attendant la réponse de Palawi dans la pull request.\n\n${row.questions
        .map(
          (q, i) =>
            `${i + 1}. ${q.question}\n${q.options.map((o) => `   - ${o}${o === q.recommended ? " (recommandée)" : ""}`).join("\n")}`,
        )
        .join("\n")}`
    : "";
  const body = `<!-- suggestion:${id} -->
**Suggestion n° ${id}** · ${KIND_LABELS[kind] ?? kind} · tri : ${VERDICT_LABELS[verdict as TriageResult["verdict"]]}${row.category ? ` (${row.category})` : ""}

### Demande

${row.spec ?? ""}${questions}

---
Issue créée automatiquement à partir d'une suggestion de joueur, reformulée et anonymisée. Claude prépare la branche \`${row.branch ?? branchFor(id, row.verdict)}\` et une pull request vers \`dev\`.`;
  return {
    title: truncate(`Suggestion n° ${id} : ${row.summary ?? "sans titre"}`, 120),
    body,
    labels: ["suggestion", `auto:${verdict}`],
  };
}
