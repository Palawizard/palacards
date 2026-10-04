import { and, desc, eq, gt, isNull, or, schema, sql } from "@palacards/db";
import type { AdminBroadcastDTO, BroadcastDTO } from "@palacards/shared";
import type { Ctx } from "../context.js";
import { conflict, notFound } from "../errors.js";

const b = schema.broadcasts;
type Row = typeof b.$inferSelect;

/** Canal `pg_notify` : un message envoyé par la CLI (autre processus) est poussé par l'API. */
export const BROADCAST_CHANNEL = "palacards_broadcast";

/** Pousse aux joueurs connectés un message envoyé hors de l'API (CLI). */
export async function pushBroadcast(ctx: Ctx, id: number) {
  const [row] = await ctx.db
    .select()
    .from(b)
    .where(and(eq(b.id, id), eq(b.status, "sent")));
  if (row) ctx.rt.toAll("broadcast:new", toDTO(row));
}

/** Messages des 30 derniers jours montrés aux retardataires (sans date d'expiration). */
const DEFAULT_TTL_DAYS = 30;

export interface BroadcastInput {
  title: string;
  body: string;
  tone: "info" | "update" | "event" | "warning";
  linkUrl: string | null;
  linkLabel: string | null;
  expiresAt: Date | null;
}

const toDTO = (r: Row): BroadcastDTO => ({
  id: r.id,
  title: r.title,
  body: r.body,
  tone: r.tone,
  linkUrl: r.linkUrl,
  linkLabel: r.linkLabel,
  sentAt: r.sentAt?.toISOString() ?? null,
});

/** Messages envoyés que le joueur n'a pas encore fermés (du plus ancien au plus récent). */
export async function pendingBroadcasts(ctx: Ctx, userId: string): Promise<BroadcastDTO[]> {
  const rows = await ctx.db
    .select()
    .from(b)
    .where(
      and(
        eq(b.status, "sent"),
        or(isNull(b.expiresAt), gt(b.expiresAt, ctx.now())),
        sql`${b.sentAt} > now() - make_interval(days => ${DEFAULT_TTL_DAYS})`,
        sql`not exists (select 1 from broadcast_reads r where r.broadcast_id = ${b.id} and r.user_id = ${userId})`,
      ),
    )
    .orderBy(b.sentAt);
  return rows.map(toDTO);
}

/** Le joueur a vu (fermé) un message : il ne revient plus, sur aucun appareil. */
export async function markBroadcastRead(ctx: Ctx, userId: string, id: number) {
  const [row] = await ctx.db.select({ id: b.id }).from(b).where(eq(b.id, id));
  if (!row) throw notFound("Message introuvable.");
  await ctx.db.insert(schema.broadcastReads).values({ broadcastId: id, userId }).onConflictDoNothing();
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export async function adminBroadcasts(ctx: Ctx): Promise<AdminBroadcastDTO[]> {
  const rows = await ctx.db
    .select({
      row: b,
      reads: sql<number>`(select count(*)::int from broadcast_reads r where r.broadcast_id = ${b.id})`,
    })
    .from(b)
    .orderBy(desc(b.id))
    .limit(100);
  return rows.map(({ row, reads }) => ({
    ...toDTO(row),
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    reads,
  }));
}

/** Crée un brouillon, ou l'envoie tout de suite (`send`). */
export async function createBroadcast(ctx: Ctx, adminId: string, input: BroadcastInput, send: boolean) {
  const [row] = await ctx.db
    .insert(b)
    .values({ ...input, createdBy: adminId, status: "draft" })
    .returning();
  if (send) return sendBroadcast(ctx, row!.id);
  return toDTO(row!);
}

export async function updateBroadcast(ctx: Ctx, id: number, input: BroadcastInput) {
  const [row] = await ctx.db
    .update(b)
    .set(input)
    .where(and(eq(b.id, id), eq(b.status, "draft")))
    .returning();
  if (!row) throw conflict("broadcast_not_draft", "Seul un brouillon peut être modifié.");
  return toDTO(row);
}

/**
 * Envoie un message : affiché tout de suite par-dessus la page chez les joueurs connectés,
 * et à la prochaine visite pour les autres (tant qu'il n'a pas expiré).
 */
export async function sendBroadcast(ctx: Ctx, id: number) {
  const [row] = await ctx.db
    .update(b)
    .set({ status: "sent", sentAt: ctx.now() })
    .where(and(eq(b.id, id), eq(b.status, "draft")))
    .returning();
  if (!row) throw conflict("broadcast_not_draft", "Ce message est déjà envoyé ou archivé.");
  const dto = toDTO(row);
  ctx.rt.toAll("broadcast:new", dto);
  return dto;
}

/** Archive un message : il n'est plus montré à personne. */
export async function archiveBroadcast(ctx: Ctx, id: number) {
  const [row] = await ctx.db.update(b).set({ status: "archived" }).where(eq(b.id, id)).returning({ id: b.id });
  if (!row) throw notFound("Message introuvable.");
}

export async function deleteBroadcast(ctx: Ctx, id: number) {
  await ctx.db.delete(b).where(eq(b.id, id));
}

/** Derniers messages envoyés (historique « Nouveautés »). */
export async function recentBroadcasts(ctx: Ctx, limit = 20): Promise<BroadcastDTO[]> {
  const rows = await ctx.db
    .select()
    .from(b)
    .where(eq(b.status, "sent"))
    .orderBy(desc(b.sentAt), desc(b.id))
    .limit(limit);
  return rows.map(toDTO);
}
