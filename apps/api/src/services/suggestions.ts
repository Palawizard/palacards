import { and, asc, desc, eq, inArray, isNull, schema, sql } from "@palacards/db";
import {
  SUGGESTION_THREAD,
  type AdminSuggestionDTO,
  type SuggestionDTO,
  type SuggestionKind,
  type SuggestionMessageDTO,
  type SuggestionStatus,
} from "@palacards/shared";
import type { Ctx } from "../context.js";
import { conflict, notFound } from "../errors.js";
import { automationDTO, onSuggestionCreated } from "./automation.js";
import { Effects } from "./notifications.js";
import type { DbOrTx } from "./players.js";

const s = schema.suggestions;
const m = schema.suggestionMessages;

/** Le bandeau « Une idée ? » revient une semaine après avoir été fermé (ou après une suggestion). */
export const SUGGESTION_BANNER_PAUSE_MS = 7 * 86_400_000;
/** Pas de bandeau le premier jour : le nouveau joueur découvre d'abord le jeu. */
const BANNER_MIN_ACCOUNT_AGE_MS = 86_400_000;

const messageDTO = (r: typeof m.$inferSelect): SuggestionMessageDTO => ({
  id: r.id,
  fromAdmin: r.fromAdmin,
  body: r.body,
  createdAt: r.createdAt.toISOString(),
});

const toDTO = (r: typeof s.$inferSelect, thread: (typeof m.$inferSelect)[] = []): SuggestionDTO => ({
  id: r.id,
  kind: r.kind,
  title: r.title,
  body: r.body,
  status: r.status,
  reply: r.reply,
  repliedAt: r.repliedAt?.toISOString() ?? null,
  createdAt: r.createdAt.toISOString(),
  thread: thread.map(messageDTO),
});

/** Fils de plusieurs suggestions, chacun du plus ancien au plus récent. */
async function threads(db: DbOrTx, ids: number[]) {
  const byId = new Map<number, (typeof m.$inferSelect)[]>();
  if (!ids.length) return byId;
  const rows = await db.select().from(m).where(inArray(m.suggestionId, ids)).orderBy(asc(m.createdAt), asc(m.id));
  for (const r of rows) byId.set(r.suggestionId, [...(byId.get(r.suggestionId) ?? []), r]);
  return byId;
}

async function withThread(db: DbOrTx, row: typeof s.$inferSelect): Promise<SuggestionDTO> {
  return toDTO(row, (await threads(db, [row.id])).get(row.id));
}

/** Bandeau à montrer : compte de plus d'un jour, pas fermé ni suggestion envoyée depuis une semaine. */
export function showSuggestionBanner(
  player: { createdAt: Date; suggestionBannerUntil: Date | null },
  now: Date,
): boolean {
  if (now.getTime() - player.createdAt.getTime() < BANNER_MIN_ACCOUNT_AGE_MS) return false;
  return !player.suggestionBannerUntil || player.suggestionBannerUntil <= now;
}

/** Ferme le bandeau pour une semaine (sur tous les appareils). */
export async function pauseSuggestionBanner(ctx: Ctx, userId: string) {
  const until = new Date(ctx.now().getTime() + SUGGESTION_BANNER_PAUSE_MS);
  await ctx.db.update(schema.players).set({ suggestionBannerUntil: until }).where(eq(schema.players.userId, userId));
  return { until: until.toISOString() };
}

export async function mySuggestions(ctx: Ctx, userId: string): Promise<SuggestionDTO[]> {
  const rows = await ctx.db.select().from(s).where(eq(s.userId, userId)).orderBy(desc(s.createdAt)).limit(50);
  const byId = await threads(
    ctx.db,
    rows.map((r) => r.id),
  );
  return rows.map((r) => toDTO(r, byId.get(r.id)));
}

export async function createSuggestion(
  ctx: Ctx,
  userId: string,
  input: { kind: SuggestionKind; title: string; body: string },
): Promise<SuggestionDTO> {
  const [row] = await ctx.db
    .insert(s)
    .values({ userId, kind: input.kind, title: input.title, body: input.body })
    .returning();
  // Une suggestion vient d'être envoyée : inutile de la lui proposer à nouveau avant une semaine.
  await pauseSuggestionBanner(ctx, userId);
  await onSuggestionCreated(ctx, row!.id, userId);
  return toDTO(row!);
}

/** Suggestions et réponses d'auteurs pas encore ouvertes par un admin (pastille du menu). */
export async function newSuggestionsCount(ctx: Ctx): Promise<number> {
  const [suggestions] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(s)
    .where(isNull(s.adminSeenAt));
  const [answers] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(m)
    .where(isNull(m.adminSeenAt));
  return (suggestions?.n ?? 0) + (answers?.n ?? 0);
}

export async function adminSuggestions(
  ctx: Ctx,
): Promise<{ items: AdminSuggestionDTO[]; counts: Record<SuggestionStatus, number> }> {
  const rows = await ctx.db
    .select({
      suggestion: s,
      automation: schema.suggestionAutomation,
      username: schema.user.username,
      displayName: sql<string>`coalesce(${schema.user.displayUsername}, ${schema.user.name})`,
    })
    .from(s)
    .leftJoin(schema.user, eq(schema.user.id, s.userId))
    .leftJoin(schema.suggestionAutomation, eq(schema.suggestionAutomation.suggestionId, s.id))
    .orderBy(desc(s.createdAt))
    .limit(500);
  const counts: Record<SuggestionStatus, number> = { new: 0, accepted: 0, done: 0, declined: 0 };
  for (const r of rows) counts[r.suggestion.status]++;
  const byId = await threads(
    ctx.db,
    rows.map((r) => r.suggestion.id),
  );
  return {
    counts,
    items: rows.map(({ suggestion: r, automation, username, displayName }) => ({
      ...toDTO(r, byId.get(r.id)),
      author: username ? { id: r.userId, username, displayName } : null,
      seen: r.adminSeenAt !== null,
      unseenAnswers: (byId.get(r.id) ?? []).filter((x) => x.adminSeenAt === null).length,
      updatedAt: r.updatedAt.toISOString(),
      automation: automation ? automationDTO(automation, ctx.config.GITHUB_REPOSITORY) : null,
    })),
  };
}

/** L'admin a ouvert la liste : plus de pastille pour celles-ci (ni pour les réponses des auteurs). */
export async function markSuggestionsSeen(ctx: Ctx) {
  await ctx.db.update(s).set({ adminSeenAt: ctx.now() }).where(isNull(s.adminSeenAt));
  await ctx.db.update(m).set({ adminSeenAt: ctx.now() }).where(isNull(m.adminSeenAt));
}

/**
 * Prévient l'auteur d'un nouveau statut ou d'une réponse de Palawi. Plusieurs mises à jour coup sur coup :
 * une seule notification (la précédente, pas encore lue, est remplacée et garde « a répondu »).
 */
async function notifyAuthor(
  tx: DbOrTx,
  fx: Effects,
  before: typeof s.$inferSelect,
  status: SuggestionStatus,
  replied: boolean,
  hasReply: boolean,
) {
  const n = schema.notifications;
  const [pending] = await tx
    .delete(n)
    .where(
      and(
        eq(n.userId, before.userId),
        eq(n.type, "suggestion_update"),
        isNull(n.readAt),
        sql`${n.payload}->>'suggestionId' = ${String(before.id)}`,
      ),
    )
    .returning({ payload: n.payload });
  await fx.notify(tx, before.userId, "suggestion_update", {
    suggestionId: before.id,
    title: before.title,
    status,
    replied: replied || (hasReply && pending?.payload.replied === true),
  });
}

/**
 * Statut et/ou réponse de l'admin. L'auteur est prévenu (notification) si le statut change
 * ou si la réponse est nouvelle ou modifiée.
 */
export async function updateSuggestion(
  ctx: Ctx,
  id: number,
  patch: { status?: SuggestionStatus; reply?: string | null },
): Promise<SuggestionDTO> {
  const fx = new Effects();
  const updated = await ctx.db.transaction(async (tx) => {
    const [before] = await tx.select().from(s).where(eq(s.id, id)).for("update");
    if (!before) throw notFound("Suggestion introuvable.");
    const reply = patch.reply === undefined ? before.reply : patch.reply?.trim() || null;
    const status = patch.status ?? before.status;
    const replyChanged = reply !== before.reply;
    const statusChanged = status !== before.status;
    if (!replyChanged && !statusChanged) return before;
    const [row] = await tx
      .update(s)
      .set({
        status,
        reply,
        repliedAt: replyChanged ? (reply ? ctx.now() : null) : before.repliedAt,
        adminSeenAt: before.adminSeenAt ?? ctx.now(),
        updatedAt: ctx.now(),
      })
      .where(eq(s.id, id))
      .returning();
    // Une réponse effacée ne mérite pas de notification ; un nouveau statut ou une réponse, si.
    if (statusChanged || (replyChanged && reply))
      await notifyAuthor(tx, fx, before, status, replyChanged && !!reply, !!reply);
    return row!;
  });
  await fx.flush(ctx);
  return withThread(ctx.db, updated);
}

/**
 * L'auteur répond dans le fil, sous le retour de Palawi : seulement une fois que Palawi a répondu,
 * `SUGGESTION_THREAD.answers` fois au plus, et pas deux fois en moins de `cooldownSeconds`.
 */
export async function answerSuggestion(ctx: Ctx, userId: string, id: number, body: string): Promise<SuggestionDTO> {
  return ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(s)
      .where(and(eq(s.id, id), eq(s.userId, userId)))
      .for("update");
    if (!row) throw notFound("Suggestion introuvable.");
    if (!row.reply) throw conflict("suggestion_not_replied", "Tu pourras répondre une fois que Palawi t'aura répondu.");
    const answers = await tx
      .select({ createdAt: m.createdAt })
      .from(m)
      .where(and(eq(m.suggestionId, id), eq(m.fromAdmin, false)))
      .orderBy(desc(m.createdAt));
    if (answers.length >= SUGGESTION_THREAD.answers)
      throw conflict(
        "suggestion_answers_max",
        `Tu as déjà répondu ${SUGGESTION_THREAD.answers} fois. Pour une autre idée, envoie une nouvelle suggestion.`,
      );
    const last = answers[0]?.createdAt.getTime();
    const wait = last ? Math.ceil((last + SUGGESTION_THREAD.cooldownSeconds * 1000 - ctx.now().getTime()) / 1000) : 0;
    if (wait > 0) throw conflict("suggestion_answer_cooldown", `Attends encore ${wait} s avant de répondre à nouveau.`);
    await tx.insert(m).values({ suggestionId: id, fromAdmin: false, body, createdAt: ctx.now() });
    const [updated] = await tx.update(s).set({ updatedAt: ctx.now() }).where(eq(s.id, id)).returning();
    return withThread(tx, updated!);
  });
}

/** L'admin répond dans le fil : les réponses de l'auteur sont vues, et l'auteur est prévenu. */
export async function adminAnswerSuggestion(ctx: Ctx, id: number, body: string): Promise<SuggestionDTO> {
  const fx = new Effects();
  const dto = await ctx.db.transaction(async (tx) => {
    const [before] = await tx.select().from(s).where(eq(s.id, id)).for("update");
    if (!before) throw notFound("Suggestion introuvable.");
    await tx
      .update(m)
      .set({ adminSeenAt: ctx.now() })
      .where(and(eq(m.suggestionId, id), isNull(m.adminSeenAt)));
    await tx
      .insert(m)
      .values({ suggestionId: id, fromAdmin: true, body, adminSeenAt: ctx.now(), createdAt: ctx.now() });
    const [row] = await tx
      .update(s)
      .set({ adminSeenAt: before.adminSeenAt ?? ctx.now(), updatedAt: ctx.now() })
      .where(eq(s.id, id))
      .returning();
    await notifyAuthor(tx, fx, before, before.status, true, true);
    return withThread(tx, row!);
  });
  await fx.flush(ctx);
  return dto;
}

/** Supprime un message du fil (réponse abusive, ou message de l'admin à retirer). */
export async function deleteSuggestionMessage(ctx: Ctx, id: number, messageId: number): Promise<SuggestionDTO> {
  const rows = await ctx.db
    .delete(m)
    .where(and(eq(m.id, messageId), eq(m.suggestionId, id)))
    .returning({ id: m.id });
  if (!rows.length) throw notFound("Message introuvable.");
  const [row] = await ctx.db.select().from(s).where(eq(s.id, id));
  if (!row) throw notFound("Suggestion introuvable.");
  return withThread(ctx.db, row);
}

export async function deleteSuggestion(ctx: Ctx, id: number) {
  const rows = await ctx.db.delete(s).where(eq(s.id, id)).returning({ id: s.id });
  if (!rows.length) throw notFound("Suggestion introuvable.");
}
