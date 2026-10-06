import { eq, schema, sql } from "@palacards/db";
import { parisDay } from "@palacards/game";
import type { BuildStatus, SuggestionAutomationDTO } from "@palacards/shared";
import { timingSafeEqual } from "node:crypto";
import { postDiscord } from "../automation/discord.js";
import { issueUrl, pullUrl } from "../automation/github.js";
import type { Ctx } from "../context.js";
import { conflict, GameError, notFound } from "../errors.js";
import { afterCommit } from "./notifications.js";

/**
 * Suggestions automatisées. Une nouvelle suggestion part au tri (service `triage`, réveillé par NOTIFY) ; les
 * suggestions à coder deviennent une issue GitHub anonyme, puis une branche et une pull request vers `dev`
 * (workflows GitHub). Les workflows rendent compte ici (POST /automation/…). Rien n'est envoyé au joueur :
 * l'admin envoie la réponse proposée depuis la page Admin.
 */

const a = schema.suggestionAutomation;
type Row = typeof a.$inferSelect;

/** Canal Postgres qui réveille le service de tri. */
export const AUTOMATION_CHANNEL = "suggestion_automation";

/** Branche de travail d'une suggestion (fix/ pour un bug, feat/ sinon). */
export const branchFor = (suggestionId: number, verdict: string | null) =>
  `${verdict === "bug" ? "fix" : "feat"}/suggestion-${suggestionId}`;

export function automationDTO(row: Row, repository: string): SuggestionAutomationDTO {
  return {
    triageStatus: row.triageStatus,
    attempts: row.attempts,
    error: row.error,
    verdict: row.verdict,
    category: row.category,
    summary: row.summary,
    reasoning: row.reasoning,
    spec: row.spec,
    questions: row.questions,
    proposedReply: row.proposedReply,
    duplicateOf: row.duplicateOf,
    injection: row.injection,
    triagedAt: row.triagedAt?.toISOString() ?? null,
    buildStatus: row.buildStatus,
    issueUrl: row.issueNumber ? issueUrl(repository, row.issueNumber) : null,
    prUrl: row.prNumber ? pullUrl(repository, row.prNumber) : null,
    branch: row.branch,
    ciConclusion: row.ciConclusion,
    playerReply: row.playerReply,
    announcement: row.announcement,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** (Re)met une suggestion au tri et réveille le service. Les infos de construction déjà là sont gardées. */
export async function enqueueTriage(ctx: Ctx, suggestionId: number) {
  const [exists] = await ctx.db
    .select({ id: schema.suggestions.id })
    .from(schema.suggestions)
    .where(eq(schema.suggestions.id, suggestionId));
  if (!exists) throw notFound("Suggestion introuvable.");
  await ctx.db
    .insert(a)
    .values({ suggestionId })
    .onConflictDoUpdate({
      target: a.suggestionId,
      set: { triageStatus: "pending", attempts: 0, error: null, nextAttemptAt: ctx.now(), updatedAt: ctx.now() },
    });
  await ctx.db.execute(sql`select pg_notify(${AUTOMATION_CHANNEL}, ${String(suggestionId)})`);
}

/** Nouvelle suggestion : au tri si l'automatisation est active. Une erreur ici ne bloque jamais le joueur. */
export async function onSuggestionCreated(ctx: Ctx, suggestionId: number, userId: string) {
  if (!ctx.config.AUTOMATION_ENABLED) return;
  try {
    // Au-delà du quota du joueur sur 24 h, la suggestion attend un tri lancé à la main depuis Admin.
    const since = new Date(ctx.now().getTime() - 86_400_000);
    const [recent] = await ctx.db.execute<{ n: number }>(sql`
      select count(*)::int as n from suggestions s
      join suggestion_automation a on a.suggestion_id = s.id
      where s.user_id = ${userId} and s.created_at > ${since.toISOString()}::timestamptz and s.id <> ${suggestionId}
    `);
    if ((recent?.n ?? 0) >= ctx.config.AUTOMATION_AUTO_TRIAGE_PER_USER) return;
    await enqueueTriage(ctx, suggestionId);
  } catch (err) {
    ctx.log.error({ err, suggestionId }, "mise au tri de la suggestion");
  }
}

async function rowOf(ctx: Ctx, suggestionId: number): Promise<Row> {
  const [row] = await ctx.db.select().from(a).where(eq(a.suggestionId, suggestionId));
  if (!row) throw notFound("Cette suggestion n'a pas encore été triée.");
  return row;
}

/** Admin : lance la construction d'une suggestion triée (même refusée par le tri). */
export async function adminQueueBuild(ctx: Ctx, suggestionId: number): Promise<SuggestionAutomationDTO> {
  const row = await rowOf(ctx, suggestionId);
  if (row.triageStatus !== "done") throw conflict("triage_pending", "Le tri n'est pas terminé.");
  if (!row.spec) throw conflict("no_spec", "Pas de cahier des charges : relance le tri avant de construire.");
  if (["queued", "published", "running"].includes(row.buildStatus))
    throw conflict("build_in_progress", "Une branche est déjà en préparation.");
  const [updated] = await ctx.db
    .update(a)
    .set({
      buildStatus: "queued",
      branch: branchFor(suggestionId, row.verdict),
      prNumber: null,
      issueNumber: null,
      ciConclusion: null,
      updatedAt: ctx.now(),
    })
    .where(eq(a.suggestionId, suggestionId))
    .returning();
  await ctx.db.execute(sql`select pg_notify(${AUTOMATION_CHANNEL}, ${String(suggestionId)})`);
  return automationDTO(updated!, ctx.config.GITHUB_REPOSITORY);
}

/** Admin : abandonne la construction (pas encore publiée : retirée de la file ; sinon marquée abandonnée). */
export async function adminCancelBuild(ctx: Ctx, suggestionId: number): Promise<SuggestionAutomationDTO> {
  const row = await rowOf(ctx, suggestionId);
  const [updated] = await ctx.db
    .update(a)
    .set({ buildStatus: row.buildStatus === "queued" ? "none" : "closed", updatedAt: ctx.now() })
    .where(eq(a.suggestionId, suggestionId))
    .returning();
  return automationDTO(updated!, ctx.config.GITHUB_REPOSITORY);
}

// ---------------------------------------------------------------------------
// Comptes rendus des workflows GitHub
// ---------------------------------------------------------------------------

/** Jeton des workflows comparé en temps constant. Sans jeton configuré, la route est fermée. */
export function checkAutomationToken(ctx: Ctx, header: string | undefined) {
  const expected = ctx.config.AUTOMATION_TOKEN;
  const given = header?.startsWith("Bearer ") ? header.slice(7) : "";
  const ok =
    !!expected && given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  if (!ok) throw new GameError(401, "unauthorized", "Jeton d'automatisation invalide.");
}

export interface BuildReport {
  status: Extract<BuildStatus, "running" | "ready" | "failed" | "merged" | "closed">;
  issueNumber?: number;
  prNumber?: number;
  branch?: string;
  ciConclusion?: string;
  playerReply?: string;
  announcement?: string;
  /** Titre de la branche (PR) et questions encore ouvertes, pour le message Discord. */
  title?: string;
  openQuestions?: number;
  runUrl?: string;
  /** Échec dû à la limite du forfait Claude : la branche repart toute seule plus tard. */
  reason?: "usage_limit";
}

/** Pause de la file après une limite du forfait Claude. */
export const USAGE_LIMIT_PAUSE_MS = 60 * 60_000;
/** Début du message d'erreur d'une branche mise en pause (lu par le service de tri et la page Admin). */
export const USAGE_LIMIT_PREFIX = "Limite du forfait";
/** Au-delà, une branche « publiée » ou « en cours » sans nouvelles ne bloque plus la file (workflow : 150 min max). */
export const BUILD_IN_FLIGHT_MS = 3 * 60 * 60_000;

const parisTime = (d: Date) =>
  d.toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" }).replace(":", " h ");

/** Compte rendu d'un workflow : met à jour la suggestion et prévient l'admin sur Discord. */
export async function reportBuild(ctx: Ctx, suggestionId: number, report: BuildReport) {
  const row = await rowOf(ctx, suggestionId);
  if (report.status === "failed" && report.reason === "usage_limit") return pauseOnUsageLimit(ctx, row, report);
  const [updated] = await ctx.db
    .update(a)
    .set({
      buildStatus: report.status,
      ...(report.issueNumber ? { issueNumber: report.issueNumber } : {}),
      ...(report.prNumber ? { prNumber: report.prNumber } : {}),
      ...(report.branch ? { branch: report.branch } : {}),
      ...(report.ciConclusion !== undefined ? { ciConclusion: report.ciConclusion } : {}),
      ...(report.playerReply ? { playerReply: report.playerReply } : {}),
      ...(report.announcement ? { announcement: report.announcement } : {}),
      updatedAt: ctx.now(),
    })
    .where(eq(a.suggestionId, suggestionId))
    .returning();
  const repo = ctx.config.GITHUB_REPOSITORY;
  const pr = updated!.prNumber ? pullUrl(repo, updated!.prNumber) : null;
  const admin = adminUrl(ctx, suggestionId);
  const name = `la suggestion n° ${suggestionId}${row.summary ? ` (${row.summary})` : ""}`;
  let message: string | null = null;
  if (report.status === "ready") {
    const ci = report.ciConclusion === "success" ? "CI verte" : `CI : ${report.ciConclusion ?? "inconnue"}`;
    const questions = report.openQuestions
      ? `\n${report.openQuestions} question${report.openQuestions > 1 ? "s" : ""} à trancher : réponds dans la PR en commençant par @claude.`
      : "";
    message = `**Branche prête** pour ${name}. ${ci}.${questions}\nPR : ${pr ?? "?"}\nJe la merge ? (Squash and merge vers dev)`;
  } else if (report.status === "failed") {
    message = `**Échec** de la branche pour ${name}.${report.runUrl ? `\nJournal : ${report.runUrl}` : ""}${pr ? `\nPR : ${pr}` : ""}\nAdmin : ${admin}`;
  } else if (report.status === "merged") {
    message = `Suggestion n° ${suggestionId} **mergée dans dev**. Réponse au joueur prête dans Admin, à envoyer après la mise en prod.\n${admin}`;
  }
  if (message) {
    const text = message;
    await afterCommit(ctx, () => postDiscord(ctx.config.DISCORD_WEBHOOK_URL, text));
  }
  return automationDTO(updated!, repo);
}

/**
 * Limite du forfait Claude atteinte pendant une branche : la suggestion revient en file et toute la file attend
 * une heure (le workflow a fermé l'issue ; une nouvelle sera publiée au prochain essai).
 */
async function pauseOnUsageLimit(ctx: Ctx, row: Row, report: BuildReport) {
  const retryAt = new Date(ctx.now().getTime() + USAGE_LIMIT_PAUSE_MS);
  const error = `${USAGE_LIMIT_PREFIX} Claude atteinte : la branche repart vers ${parisTime(retryAt)}.`;
  const [updated] = await ctx.db
    .update(a)
    .set({
      buildStatus: "queued",
      nextAttemptAt: retryAt,
      error,
      issueNumber: null,
      prNumber: null,
      updatedAt: ctx.now(),
    })
    .where(eq(a.suggestionId, row.suggestionId))
    .returning();
  const text = `**Pause** : ${error} (suggestion n° ${row.suggestionId}, file en attente jusque-là).${report.runUrl ? `\nJournal : ${report.runUrl}` : ""}`;
  await afterCommit(ctx, () => postDiscord(ctx.config.DISCORD_WEBHOOK_URL, text));
  return automationDTO(updated!, ctx.config.GITHUB_REPOSITORY);
}

export const adminUrl = (ctx: Ctx, suggestionId: number) =>
  `${ctx.config.WEB_ORIGIN}${ctx.config.BASE_PATH}/admin/suggestions#suggestion-${suggestionId}`;

// ---------------------------------------------------------------------------
// Service de tri (worker) : file, plafond du jour, publication
// ---------------------------------------------------------------------------

/** Nombre maximal d'essais de tri avant d'abandonner (l'admin peut relancer). */
export const TRIAGE_MAX_ATTEMPTS = 5;

/** Prend la prochaine suggestion à trier (verrou : un seul service à la fois sur une même ligne). */
export async function claimTriage(ctx: Pick<Ctx, "db" | "now">): Promise<Row | null> {
  const [row] = await ctx.db.execute<{ suggestion_id: string }>(sql`
    update suggestion_automation set triage_status = 'running', attempts = attempts + 1, updated_at = ${ctx.now().toISOString()}::timestamptz
    where suggestion_id = (
      select suggestion_id from suggestion_automation
      where triage_status in ('pending', 'error') and attempts < ${TRIAGE_MAX_ATTEMPTS}
        and next_attempt_at <= ${ctx.now().toISOString()}::timestamptz
      order by next_attempt_at, suggestion_id
      for update skip locked
      limit 1
    )
    returning suggestion_id
  `);
  if (!row) return null;
  const [full] = await ctx.db
    .select()
    .from(a)
    .where(eq(a.suggestionId, Number(row.suggestion_id)));
  return full ?? null;
}

/** Tri interrompu (service redémarré) : remis en attente. */
export async function releaseStaleTriage(ctx: Pick<Ctx, "db" | "now">, olderThanMs = 15 * 60_000) {
  const before = new Date(ctx.now().getTime() - olderThanMs).toISOString();
  await ctx.db.execute(sql`
    update suggestion_automation set triage_status = 'pending'
    where triage_status = 'running' and updated_at < ${before}::timestamptz
  `);
}

/** Branches publiées depuis minuit (heure de Paris) : plafond du jour. */
export async function publishedToday(ctx: Pick<Ctx, "db" | "now">): Promise<number> {
  const [row] = await ctx.db.execute<{ n: number }>(sql`
    select count(*)::int as n from suggestion_automation
    where published_at is not null
      and (published_at at time zone 'Europe/Paris')::date = ${parisDay(ctx.now())}::date
  `);
  return row?.n ?? 0;
}

export type { Row as AutomationRow };
