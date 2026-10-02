import { and, eq, or, schema } from "@palacards/db";
import {
  dailyQuests,
  parisDay,
  QUEST_HREF,
  QUEST_REWARDS,
  questLabel,
  rerollQuest as pickReroll,
  weekStart,
  weeklyQuest,
  type QuestKind,
  type QuestTier,
} from "@palacards/game";
import type { Ctx } from "../context.js";
import { conflict, notFound } from "../errors.js";
import { nextParisMidnight } from "./wheel.js";
import { lockPlayer, type DbOrTx } from "./players.js";

const q = schema.playerQuests;
export type QuestRow = typeof q.$inferSelect;

/** Quêtes du jour (créneaux 1 à 3) et de la semaine du joueur, créées à la première lecture. */
export async function ensureQuests(db: DbOrTx, userId: string, now: Date): Promise<QuestRow[]> {
  const day = parisDay(now);
  const week = weekStart(day);
  const where = and(
    eq(q.userId, userId),
    or(and(eq(q.period, "day"), eq(q.periodStart, day)), and(eq(q.period, "week"), eq(q.periodStart, week))),
  );
  let rows = await db.select().from(q).where(where);
  const hasDay = rows.some((r) => r.period === "day");
  const hasWeek = rows.some((r) => r.period === "week");
  if (hasDay && hasWeek) return rows;
  const values: (typeof q.$inferInsert)[] = [];
  if (!hasDay)
    dailyQuests(userId, day).forEach((def, i) =>
      values.push({
        userId,
        period: "day",
        periodStart: day,
        slot: i + 1,
        tier: def.tier,
        kind: def.kind,
        target: def.target,
        rewardPw: QUEST_REWARDS[def.tier].pw,
        rewardXp: QUEST_REWARDS[def.tier].xp,
      }),
    );
  if (!hasWeek) {
    const def = weeklyQuest(day);
    values.push({
      userId,
      period: "week",
      periodStart: def.week,
      slot: 1,
      tier: "weekly",
      kind: def.kind,
      target: def.target,
      rewardPw: QUEST_REWARDS.weekly.pw,
      rewardXp: QUEST_REWARDS.weekly.xp,
    });
  }
  // Deux créations simultanées (deux onglets) : la clé primaire garde la première.
  await db.insert(q).values(values).onConflictDoNothing();
  rows = await db.select().from(q).where(where);
  return rows;
}

export interface QuestDTO {
  period: "day" | "week";
  slot: number;
  tier: QuestTier;
  kind: QuestKind;
  label: string;
  href: string;
  target: number;
  progress: number;
  reward: { pw: number; xp: number };
  completedAt: string | null;
  rerolled: boolean;
}

const toDTO = (r: QuestRow): QuestDTO => ({
  period: r.period,
  slot: r.slot,
  tier: r.tier,
  kind: r.kind as QuestKind,
  label: questLabel({ kind: r.kind as QuestKind, target: r.target }),
  href: QUEST_HREF[r.kind as QuestKind],
  target: r.target,
  progress: r.progress,
  reward: { pw: r.rewardPw, xp: r.rewardXp },
  completedAt: r.completedAt?.toISOString() ?? null,
  rerolled: r.rerolled,
});

export async function listQuests(ctx: Ctx, userId: string) {
  const now = ctx.now();
  const rows = await ensureQuests(ctx.db, userId, now);
  const [p] = await ctx.db
    .select({ lastReroll: schema.players.lastQuestRerollDay })
    .from(schema.players)
    .where(eq(schema.players.userId, userId));
  const day = parisDay(now);
  // Prochain lundi à minuit (heure de Paris).
  let nextWeek = nextParisMidnight(now);
  while (new Date(`${parisDay(nextWeek)}T00:00:00Z`).getUTCDay() !== 1) nextWeek = nextParisMidnight(nextWeek);
  return {
    daily: rows
      .filter((r) => r.period === "day")
      .sort((a, b) => a.slot - b.slot)
      .map(toDTO),
    weekly: rows.filter((r) => r.period === "week").map(toDTO)[0] ?? null,
    rerollAvailable: p?.lastReroll !== day,
    resetsAt: nextParisMidnight(now).toISOString(),
    weeklyResetsAt: nextWeek.toISOString(),
  };
}

/** Change une quête du jour pas encore terminée (une fois par jour) contre un autre type du même créneau. */
export async function rerollQuest(ctx: Ctx, userId: string, slot: number) {
  const now = ctx.now();
  const day = parisDay(now);
  await ctx.db.transaction(async (tx) => {
    const p = await lockPlayer(tx, userId);
    if (p.lastQuestRerollDay === day) throw conflict("reroll_used", "Tu as déjà changé une quête aujourd'hui.");
    const rows = (await ensureQuests(tx, userId, now)).filter((r) => r.period === "day");
    const target = rows.find((r) => r.slot === slot);
    if (!target) throw notFound("Quête introuvable.");
    if (target.completedAt) throw conflict("quest_done", "Cette quête est déjà terminée.");
    const next = pickReroll(
      userId,
      day,
      target.tier,
      rows.map((r) => r.kind as QuestKind),
    );
    if (!next) throw conflict("no_reroll", "Aucune autre quête disponible pour ce créneau.");
    await tx
      .update(q)
      .set({ kind: next.kind, target: next.target, progress: 0, rerolled: true })
      .where(and(eq(q.userId, userId), eq(q.period, "day"), eq(q.periodStart, day), eq(q.slot, slot)));
    await tx.update(schema.players).set({ lastQuestRerollDay: day }).where(eq(schema.players.userId, userId));
  });
  ctx.rt.toUser(userId, "progress:update", {});
  return listQuests(ctx, userId);
}
