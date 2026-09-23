import { and, asc, eq, inArray, schema, sql } from "@palacards/db";
import {
  canManage,
  GUILD_MAX_MEMBERS,
  GUILD_OBJECTIVE_REWARD_PACKS,
  GUILD_OBJECTIVES,
  parisDay,
  validateGuildName,
  validateGuildTag,
  weeklyObjective,
  weekStart,
  type GuildObjectiveKind,
  type GuildRole,
} from "@palacards/game";
import type { Ctx } from "../context.js";
import { badRequest, conflict, forbidden, notFound } from "../errors.js";
import { Effects } from "./notifications.js";
import { activeSeason, lockPlayers, logMovement, packState, type DbOrTx } from "./players.js";
import { collectionScoresSql } from "./profiles.js";
import { syncGuildRoom } from "./social.js";

type Tx = Parameters<Parameters<Ctx["db"]["transaction"]>[0]>[0];
const g = schema.guilds;
const gm = schema.guildMembers;

export const GUILD_WEEKLY_JOB = "guild-weekly";

export async function membership(db: DbOrTx, userId: string) {
  const [row] = await db.select().from(gm).where(eq(gm.userId, userId));
  return row ?? null;
}

async function lockGuild(tx: Tx, guildId: number) {
  const [row] = await tx.select().from(g).where(eq(g.id, guildId)).for("update");
  if (!row) throw notFound("Cette guilde n'existe pas.");
  return row;
}

export async function createGuild(ctx: Ctx, userId: string, input: { name: string; tag: string; emblem: string; description: string }) {
  if (!validateGuildName(input.name)) throw badRequest("invalid_name", "Nom de guilde : 3 à 30 caractères.");
  if (!validateGuildTag(input.tag)) throw badRequest("invalid_tag", "Blason : 2 à 5 lettres ou chiffres.");
  const guild = await ctx.db.transaction(async (tx) => {
    await lockPlayers(tx, [userId]);
    if (await membership(tx, userId)) throw conflict("already_in_guild", "Tu es déjà dans une guilde.");
    const clash = await tx
      .select({ id: g.id })
      .from(g)
      .where(sql`lower(${g.name}) = lower(${input.name.trim()}) or lower(${g.tag}) = lower(${input.tag.trim()})`);
    if (clash.length) throw conflict("guild_exists", "Ce nom ou ce blason est déjà pris.");
    const [created] = await tx
      .insert(g)
      .values({ name: input.name.trim(), tag: input.tag.trim().toUpperCase(), emblem: input.emblem, description: input.description.trim() })
      .returning();
    await tx.insert(gm).values({ userId, guildId: created!.id, role: "leader" });
    return created!;
  });
  syncGuildRoom(ctx, userId, guild.id, true);
  await ensureObjective(ctx, guild.id);
  return { id: guild.id };
}

/** Rejoindre une guilde ouverte (20 membres au plus, compté sous verrou de la guilde). */
export async function joinGuild(ctx: Ctx, userId: string, guildId: number) {
  await ctx.db.transaction(async (tx) => {
    await lockGuild(tx, guildId);
    await lockPlayers(tx, [userId]);
    if (await membership(tx, userId)) throw conflict("already_in_guild", "Quitte d'abord ta guilde actuelle.");
    const [count] = await tx.select({ n: sql<number>`count(*)::int` }).from(gm).where(eq(gm.guildId, guildId));
    if ((count?.n ?? 0) >= GUILD_MAX_MEMBERS) throw conflict("guild_full", `Cette guilde est complète (${GUILD_MAX_MEMBERS} membres).`);
    await tx.insert(gm).values({ userId, guildId, role: "member" });
  });
  syncGuildRoom(ctx, userId, guildId, true);
}

/** Quitter : le chef passe la main au plus ancien officier (sinon membre) ; une guilde vide est dissoute. */
export async function leaveGuild(ctx: Ctx, userId: string) {
  const me = await membership(ctx.db, userId);
  if (!me) throw notFound("Tu n'es dans aucune guilde.");
  await ctx.db.transaction(async (tx) => {
    await lockGuild(tx, me.guildId);
    await tx.delete(gm).where(eq(gm.userId, userId));
    const rest = await tx
      .select()
      .from(gm)
      .where(eq(gm.guildId, me.guildId))
      .orderBy(sql`case ${gm.role} when 'officer' then 0 else 1 end`, asc(gm.joinedAt));
    if (!rest.length) await tx.delete(g).where(eq(g.id, me.guildId));
    else if (me.role === "leader") await tx.update(gm).set({ role: "leader" }).where(eq(gm.userId, rest[0]!.userId));
  });
  syncGuildRoom(ctx, userId, me.guildId, false);
}

export async function manageMember(ctx: Ctx, actorId: string, targetId: string, action: "kick" | "promote" | "demote" | "transfer") {
  const actor = await membership(ctx.db, actorId);
  if (!actor) throw notFound("Tu n'es dans aucune guilde.");
  await ctx.db.transaction(async (tx) => {
    await lockGuild(tx, actor.guildId);
    const [target] = await tx.select().from(gm).where(and(eq(gm.userId, targetId), eq(gm.guildId, actor.guildId)));
    const [me] = await tx.select().from(gm).where(eq(gm.userId, actorId));
    if (!target || !me) throw notFound("Ce joueur n'est pas dans ta guilde.");
    if (!canManage(me.role, target.role, action)) throw forbidden("Ton rôle ne permet pas cette action.");
    if (action === "kick") await tx.delete(gm).where(eq(gm.userId, targetId));
    if (action === "promote") await tx.update(gm).set({ role: "officer" }).where(eq(gm.userId, targetId));
    if (action === "demote") await tx.update(gm).set({ role: "member" }).where(eq(gm.userId, targetId));
    if (action === "transfer") {
      await tx.update(gm).set({ role: "officer" }).where(eq(gm.userId, actorId));
      await tx.update(gm).set({ role: "leader" }).where(eq(gm.userId, targetId));
    }
  });
  if (action === "kick") syncGuildRoom(ctx, targetId, actor.guildId, false);
}

export async function updateGuild(ctx: Ctx, actorId: string, input: { description?: string; emblem?: string }) {
  const actor = await membership(ctx.db, actorId);
  if (!actor || actor.role === "member") throw forbidden("Réservé au chef et aux officiers.");
  await ctx.db.update(g).set(input).where(eq(g.id, actor.guildId));
}

// ---------------------------------------------------------------------------
// Objectif hebdomadaire
// ---------------------------------------------------------------------------

/** Crée l'objectif de la semaine s'il n'existe pas (job du lundi, et à la lecture par sécurité). */
export async function ensureObjective(ctx: Ctx, guildId: number) {
  const week = weekStart(parisDay(ctx.now()));
  const [count] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(gm).where(eq(gm.guildId, guildId));
  const { kind, target } = weeklyObjective(week, count?.n ?? 1);
  await ctx.db.insert(schema.guildObjectives).values({ guildId, weekStart: week, kind, target }).onConflictDoNothing();
  const [obj] = await ctx.db
    .select()
    .from(schema.guildObjectives)
    .where(and(eq(schema.guildObjectives.guildId, guildId), eq(schema.guildObjectives.weekStart, week)));
  return obj!;
}

/** Progression de l'objectif, calculée depuis les données du jeu (membres actuels, depuis lundi 0 h à Paris). */
export async function objectiveProgress(db: DbOrTx, guildId: number, kind: GuildObjectiveKind, week: string): Promise<number> {
  const since = sql`(${week}::date at time zone 'Europe/Paris')`;
  const members = sql`(select user_id from guild_members where guild_id = ${guildId})`;
  const query =
    kind === "pull_sr"
      ? sql`select count(*)::int as n from card_instances where owner_id in ${members} and source = 'pack' and rarity in ('SR','UR','L') and obtained_at >= ${since}`
      : kind === "open_packs"
        ? sql`select count(*)::int as n from ledger where user_id in ${members} and reason = 'pack_open' and kind in ('pack','bonus_pack') and created_at >= ${since}`
        : sql`select count(*)::int as n from battles where winner_id in ${members} and status = 'finished' and finished_at >= ${since}`;
  const [row] = await db.execute<{ n: number }>(query);
  return row?.n ?? 0;
}

/**
 * Vérifie l'objectif d'une guilde et distribue la récompense une seule fois
 * (ligne d'objectif verrouillée, `completed_at` posé dans la même transaction).
 */
export async function checkObjective(ctx: Ctx, guildId: number) {
  const obj = await ensureObjective(ctx, guildId);
  if (obj.completedAt) return;
  const progress = await objectiveProgress(ctx.db, guildId, obj.kind as GuildObjectiveKind, obj.weekStart);
  if (progress < obj.target) return;
  const fx = new Effects();
  const rewarded = await ctx.db.transaction(async (tx) => {
    const [locked] = await tx.select().from(schema.guildObjectives).where(eq(schema.guildObjectives.id, obj.id)).for("update");
    if (!locked || locked.completedAt) return [];
    await tx.update(schema.guildObjectives).set({ completedAt: ctx.now() }).where(eq(schema.guildObjectives.id, obj.id));
    const members = await tx.select({ userId: gm.userId }).from(gm).where(eq(gm.guildId, guildId));
    const players = await lockPlayers(
      tx,
      members.map((x) => x.userId),
    );
    for (const p of players.values()) {
      const bonusPacks = p.bonusPacks + GUILD_OBJECTIVE_REWARD_PACKS;
      await tx.update(schema.players).set({ bonusPacks }).where(eq(schema.players.userId, p.userId));
      await logMovement(tx, p.userId, "bonus_pack", GUILD_OBJECTIVE_REWARD_PACKS, bonusPacks, "guild_objective", obj.id);
      await fx.notify(tx, p.userId, "guild_objective", { guildId, kind: obj.kind });
      p.bonusPacks = bonusPacks;
    }
    return [...players.values()];
  });
  for (const p of rewarded) ctx.rt.toUser(p.userId, "packs:update", packState(p, ctx.now()));
  await fx.flush(ctx);
}

/** Après un tirage ou un duel : l'objectif de la guilde du joueur est peut-être atteint. */
export async function checkObjectiveFor(ctx: Ctx, userId: string) {
  const me = await membership(ctx.db, userId);
  if (me) await checkObjective(ctx, me.guildId);
}

export async function weeklyJob(ctx: Ctx) {
  const all = await ctx.db.select({ id: g.id }).from(g);
  for (const { id } of all) await ensureObjective(ctx, id);
}

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------

async function seasonScores(ctx: Ctx, season: number) {
  const rows = await ctx.db.execute<{ owner_id: string; score: number }>(collectionScoresSql(season));
  return new Map(rows.map((r) => [r.owner_id, r.score]));
}

export async function listGuilds(ctx: Ctx) {
  const season = await activeSeason(ctx.db);
  const scores = await seasonScores(ctx, season);
  const guilds = await ctx.db.select().from(g).orderBy(g.name);
  const members = guilds.length ? await ctx.db.select().from(gm).where(inArray(gm.guildId, guilds.map((x) => x.id))) : [];
  return guilds
    .map((x) => {
      const mine = members.filter((y) => y.guildId === x.id);
      return {
        id: x.id,
        name: x.name,
        tag: x.tag,
        emblem: x.emblem,
        description: x.description,
        members: mine.length,
        score: mine.reduce((s, y) => s + (scores.get(y.userId) ?? 0), 0),
      };
    })
    .sort((a, b) => b.score - a.score);
}

export async function guildDetail(ctx: Ctx, guildId: number) {
  const [guild] = await ctx.db.select().from(g).where(eq(g.id, guildId));
  if (!guild) throw notFound("Cette guilde n'existe pas.");
  const season = await activeSeason(ctx.db);
  const scores = await seasonScores(ctx, season);
  const rows = await ctx.db.execute<{ user_id: string; username: string; display_name: string; avatar: string | null; role: GuildRole; joined_at: Date; elo: number }>(sql`
    select m.user_id, u.username, coalesce(u.display_username, u.name) as display_name, p.avatar, m.role, m.joined_at, p.elo
    from guild_members m join "user" u on u.id = m.user_id join players p on p.user_id = m.user_id
    where m.guild_id = ${guildId}
    order by case m.role when 'leader' then 0 when 'officer' then 1 else 2 end, m.joined_at
  `);
  const obj = await ensureObjective(ctx, guildId);
  const progress = await objectiveProgress(ctx.db, guildId, obj.kind as GuildObjectiveKind, obj.weekStart);
  if (!obj.completedAt && progress >= obj.target) await checkObjective(ctx, guildId);
  const members = rows.map((r) => ({
    id: r.user_id,
    username: r.username,
    displayName: r.display_name,
    avatar: r.avatar,
    role: r.role,
    joinedAt: new Date(r.joined_at).toISOString(),
    elo: r.elo,
    score: scores.get(r.user_id) ?? 0,
    online: ctx.rt.isOnline(r.user_id),
  }));
  return {
    id: guild.id,
    name: guild.name,
    tag: guild.tag,
    emblem: guild.emblem,
    description: guild.description,
    createdAt: guild.createdAt.toISOString(),
    season,
    score: members.reduce((s, x) => s + x.score, 0),
    members,
    maxMembers: GUILD_MAX_MEMBERS,
    objective: {
      kind: obj.kind,
      label: GUILD_OBJECTIVES[obj.kind as GuildObjectiveKind].label(obj.target),
      target: obj.target,
      progress: Math.min(progress, obj.target),
      completed: !!obj.completedAt || progress >= obj.target,
      weekStart: obj.weekStart,
    },
  };
}
