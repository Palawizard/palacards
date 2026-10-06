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
import { createIssue, type GithubConfig } from "./github.js";
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

const VERDICT_LABELS: Record<TriageResult["verdict"], string> = {
  build: "À coder",
  decision: "À trancher",
  bug: "Bug à corriger",
  non: "Refus proposé",
  prod: "À faire en prod",
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

    // « non » et « prod » ne lancent pas de branche (prod : Palawi le fait lui-même en production).
    const wantsBuild = result.verdict !== "non" && result.verdict !== "prod";
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
    if (result.verdict === "decision")
      lines.push(
        `${result.questions.length} question${result.questions.length > 1 ? "s" : ""} à trancher : Claude prépare la branche avec ses choix provisoires.`,
      );
    lines.push(adminLink(id));
    await discord(lines.join("\n"));
  }

  /**
   * Publie la prochaine suggestion en file (issue GitHub), une à la fois : GitHub ne garde qu'un seul run en
   * attente par groupe de concurrence et annule les autres. Rien ne part tant qu'une branche est publiée ou en
   * cours, pendant une pause sur la limite du forfait Claude, ni au-delà du plafond du jour.
   */
  async function publishQueued() {
    if (!deps.github) return;
    const now = deps.now();
    const inFlightSince = new Date(now.getTime() - BUILD_IN_FLIGHT_MS).toISOString();
    const [busy] = await deps.db.execute<{ n: number }>(sql`
      select count(*)::int as n from suggestion_automation
      where (build_status in ('published', 'running') and updated_at > ${inFlightSince}::timestamptz)
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
        order by updated_at, suggestion_id for update skip locked limit 1
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
  const verdict = row.verdict === "non" || row.verdict === "prod" ? "build" : (row.verdict ?? "build");
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
