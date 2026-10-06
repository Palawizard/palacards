import { and, desc, eq, isNull, schema, sql } from "@palacards/db";
import {
  type AdminSuggestionDTO,
  type SuggestionDTO,
  type SuggestionKind,
  type SuggestionStatus,
} from "@palacards/shared";
import type { Ctx } from "../context.js";
import { notFound } from "../errors.js";
import { Effects } from "./notifications.js";

const s = schema.suggestions;

/** Le bandeau « Une idée ? » revient une semaine après avoir été fermé (ou après une suggestion). */
export const SUGGESTION_BANNER_PAUSE_MS = 7 * 86_400_000;
/** Pas de bandeau le premier jour : le nouveau joueur découvre d'abord le jeu. */
const BANNER_MIN_ACCOUNT_AGE_MS = 86_400_000;

const toDTO = (r: typeof s.$inferSelect): SuggestionDTO => ({
  id: r.id,
  kind: r.kind,
  title: r.title,
  body: r.body,
  status: r.status,
  reply: r.reply,
  repliedAt: r.repliedAt?.toISOString() ?? null,
  createdAt: r.createdAt.toISOString(),
});

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
  return rows.map(toDTO);
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
  return toDTO(row!);
}

/** Suggestions pas encore ouvertes par un admin (pastille du menu). */
export async function newSuggestionsCount(ctx: Ctx): Promise<number> {
  const [row] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(s)
    .where(isNull(s.adminSeenAt));
  return row?.n ?? 0;
}

export async function adminSuggestions(
  ctx: Ctx,
): Promise<{ items: AdminSuggestionDTO[]; counts: Record<SuggestionStatus, number> }> {
  const rows = await ctx.db
    .select({
      suggestion: s,
      username: schema.user.username,
      displayName: sql<string>`coalesce(${schema.user.displayUsername}, ${schema.user.name})`,
    })
    .from(s)
    .leftJoin(schema.user, eq(schema.user.id, s.userId))
    .orderBy(desc(s.createdAt))
    .limit(500);
  const counts: Record<SuggestionStatus, number> = { new: 0, accepted: 0, done: 0, declined: 0 };
  for (const r of rows) counts[r.suggestion.status]++;
  return {
    counts,
    items: rows.map(({ suggestion: r, username, displayName }) => ({
      ...toDTO(r),
      author: username ? { id: r.userId, username, displayName } : null,
      seen: r.adminSeenAt !== null,
      updatedAt: r.updatedAt.toISOString(),
    })),
  };
}

/** L'admin a ouvert la liste : plus de pastille pour celles-ci. */
export async function markSuggestionsSeen(ctx: Ctx) {
  await ctx.db.update(s).set({ adminSeenAt: ctx.now() }).where(isNull(s.adminSeenAt));
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
    // Statut puis réponse coup sur coup : une seule notification (la précédente, pas encore lue, est remplacée).
    if (statusChanged || (replyChanged && reply)) {
      const n = schema.notifications;
      const [pending] = await tx
        .delete(n)
        .where(
          and(
            eq(n.userId, before.userId),
            eq(n.type, "suggestion_update"),
            isNull(n.readAt),
            sql`${n.payload}->>'suggestionId' = ${String(id)}`,
          ),
        )
        .returning({ payload: n.payload });
      await fx.notify(tx, before.userId, "suggestion_update", {
        suggestionId: id,
        title: before.title,
        status,
        replied: (replyChanged && !!reply) || (!!reply && pending?.payload.replied === true),
      });
    }
    return row!;
  });
  await fx.flush(ctx);
  return toDTO(updated);
}

export async function deleteSuggestion(ctx: Ctx, id: number) {
  const rows = await ctx.db.delete(s).where(eq(s.id, id)).returning({ id: s.id });
  if (!rows.length) throw notFound("Suggestion introuvable.");
}
