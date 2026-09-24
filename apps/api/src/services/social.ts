import { and, desc, eq, inArray, lt, or, schema, sql } from "@palacards/db";
import { dmChannel, guildChannel, type Rarity } from "@palacards/game";
import type { Ctx } from "../context.js";
import { badRequest, conflict, forbidden, notFound } from "../errors.js";
import { Effects } from "./notifications.js";
import { emit } from "./progression.js";
import { findUserByName } from "./profiles.js";

const f = schema.friendships;
const m = schema.messages;

const pair = (x: string, y: string) => (x < y ? { userA: x, userB: y } : { userA: y, userB: x });
const guildRoom = (guildId: number) => `guild:${guildId}`;

async function displayName(ctx: Ctx, userId: string): Promise<string> {
  const [u] = await ctx.db
    .select({ name: sql<string>`coalesce(${schema.user.displayUsername}, ${schema.user.name})` })
    .from(schema.user)
    .where(eq(schema.user.id, userId));
  return u?.name ?? "?";
}

// ---------------------------------------------------------------------------
// Amis
// ---------------------------------------------------------------------------

export async function friendIds(ctx: Ctx, userId: string): Promise<string[]> {
  const rows = await ctx.db
    .select({ a: f.userA, b: f.userB })
    .from(f)
    .where(and(eq(f.status, "accepted"), or(eq(f.userA, userId), eq(f.userB, userId))));
  return rows.map((r) => (r.a === userId ? r.b : r.a));
}

/** Envoie une demande (ou accepte directement si l'autre en avait déjà envoyé une). */
export async function requestFriend(ctx: Ctx, userId: string, username: string) {
  const other = await findUserByName(ctx.db, username);
  if (other.id === userId) throw badRequest("self", "Tu ne peux pas t'ajouter toi-même.");
  const key = pair(userId, other.id);
  const fx = new Effects();
  const status = await ctx.db.transaction(async (tx) => {
    const [existing] = await tx.select().from(f).where(and(eq(f.userA, key.userA), eq(f.userB, key.userB))).for("update");
    if (existing?.status === "accepted") throw conflict("already_friends", "Vous êtes déjà amis.");
    if (existing && existing.requestedBy === userId) throw conflict("already_requested", "Demande déjà envoyée.");
    if (existing) {
      await tx.update(f).set({ status: "accepted" }).where(and(eq(f.userA, key.userA), eq(f.userB, key.userB)));
      await fx.notify(tx, other.id, "friend_accepted", { from: await displayName(ctx, userId), userId });
      return "accepted" as const;
    }
    await tx.insert(f).values({ ...key, requestedBy: userId, status: "pending" });
    await fx.notify(tx, other.id, "friend_request", { from: await displayName(ctx, userId), userId });
    return "pending" as const;
  });
  await fx.flush(ctx);
  return { status };
}

export async function acceptFriend(ctx: Ctx, userId: string, otherId: string) {
  const key = pair(userId, otherId);
  const fx = new Effects();
  await ctx.db.transaction(async (tx) => {
    const [row] = await tx.select().from(f).where(and(eq(f.userA, key.userA), eq(f.userB, key.userB))).for("update");
    if (!row || row.status !== "pending" || row.requestedBy === userId) throw notFound("Aucune demande de ce joueur.");
    await tx.update(f).set({ status: "accepted" }).where(and(eq(f.userA, key.userA), eq(f.userB, key.userB)));
    await fx.notify(tx, otherId, "friend_accepted", { from: await displayName(ctx, userId), userId });
  });
  await fx.flush(ctx);
  for (const id of [userId, otherId]) {
    void friendIds(ctx, id)
      .then((ids) => emit(ctx, id, { type: "friends", count: ids.length }))
      .catch((err: unknown) => ctx.log.error({ err }, "succès (amis)"));
  }
}

/** Refuse, annule une demande ou retire un ami. */
export async function removeFriend(ctx: Ctx, userId: string, otherId: string) {
  const key = pair(userId, otherId);
  await ctx.db.delete(f).where(and(eq(f.userA, key.userA), eq(f.userB, key.userB)));
}

export async function listFriends(ctx: Ctx, userId: string) {
  const rows = await ctx.db.execute<{
    other_id: string;
    username: string;
    display_name: string;
    avatar: string | null;
    status: "pending" | "accepted";
    requested_by: string;
    elo: number;
  }>(sql`
    select case when f.user_a = ${userId} then f.user_b else f.user_a end as other_id,
           u.username, coalesce(u.display_username, u.name) as display_name, p.avatar, f.status, f.requested_by, p.elo
    from friendships f
    join "user" u on u.id = case when f.user_a = ${userId} then f.user_b else f.user_a end
    join players p on p.user_id = u.id
    where f.user_a = ${userId} or f.user_b = ${userId}
    order by display_name
  `);
  const toDTO = (r: (typeof rows)[number]) => ({
    id: r.other_id,
    username: r.username,
    displayName: r.display_name,
    avatar: r.avatar,
    elo: r.elo,
    online: ctx.rt.isOnline(r.other_id),
  });
  return {
    friends: rows.filter((r) => r.status === "accepted").map(toDTO),
    incoming: rows.filter((r) => r.status === "pending" && r.requested_by !== userId).map(toDTO),
    outgoing: rows.filter((r) => r.status === "pending" && r.requested_by === userId).map(toDTO),
  };
}

/** Relation avec un autre joueur (profil public). */
export async function relation(ctx: Ctx, userId: string, otherId: string): Promise<"self" | "friends" | "incoming" | "outgoing" | "none"> {
  if (userId === otherId) return "self";
  const key = pair(userId, otherId);
  const [row] = await ctx.db.select().from(f).where(and(eq(f.userA, key.userA), eq(f.userB, key.userB)));
  if (!row) return "none";
  if (row.status === "accepted") return "friends";
  return row.requestedBy === userId ? "outgoing" : "incoming";
}

/** Présence : prévient les amis connectés quand un joueur arrive ou part. */
export function wirePresence(ctx: Ctx) {
  ctx.rt.onPresence((userId, online) => {
    void friendIds(ctx, userId)
      .then((ids) => ids.forEach((id) => ctx.rt.toUser(id, "presence:update", { userId, online })))
      .catch((err) => ctx.log.warn({ err }, "présence"));
  });
  // Rejoint la salle de sa guilde (chat en direct) à la connexion.
  ctx.rt.onConnection((socket) => {
    void ctx.db
      .select({ guildId: schema.guildMembers.guildId })
      .from(schema.guildMembers)
      .where(eq(schema.guildMembers.userId, socket.data.userId))
      .then(([row]) => {
        if (row) void socket.join(guildRoom(row.guildId));
      })
      .catch((err) => ctx.log.warn({ err }, "salle de guilde"));
  });
}

/** Fait rejoindre ou quitter la salle de guilde aux connexions ouvertes d'un joueur. */
export function syncGuildRoom(ctx: Ctx, userId: string, guildId: number, join: boolean) {
  const sockets = ctx.rt.io.in(`user:${userId}`);
  if (join) sockets.socketsJoin(guildRoom(guildId));
  else sockets.socketsLeave(guildRoom(guildId));
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

/** Vérifie l'accès à un canal et renvoie la cible de diffusion. */
async function channelAccess(ctx: Ctx, userId: string, channel: string): Promise<{ kind: "dm"; other: string } | { kind: "guild"; guildId: number }> {
  const dm = /^dm:([^:]+):([^:]+)$/.exec(channel);
  if (dm) {
    const [, a, b] = dm;
    if (userId !== a && userId !== b) throw forbidden("Conversation privée.");
    const other = userId === a ? b! : a!;
    // Un seul canal par paire (ids triés), vers un joueur qui existe, jamais vers soi-même.
    if (other === userId || channel !== dmChannel(a!, b!)) throw badRequest("invalid_channel", "Conversation inconnue.");
    const [exists] = await ctx.db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.id, other));
    if (!exists) throw notFound("Ce joueur n'existe pas.");
    return { kind: "dm", other };
  }
  const g = /^guild:(\d+)$/.exec(channel);
  if (g) {
    const guildId = Number(g[1]);
    const [member] = await ctx.db
      .select()
      .from(schema.guildMembers)
      .where(and(eq(schema.guildMembers.userId, userId), eq(schema.guildMembers.guildId, guildId)));
    if (!member) throw forbidden("Réservé aux membres de la guilde.");
    return { kind: "guild", guildId };
  }
  throw badRequest("invalid_channel", "Conversation inconnue.");
}

interface MessageRow {
  id: number;
  channel: string;
  senderId: string;
  body: string;
  cardId: number | null;
  cardSeason: number | null;
  createdAt: Date;
}

async function toMessageDTOs(ctx: Ctx, rows: MessageRow[]) {
  const senders = [...new Set(rows.map((r) => r.senderId))];
  const names = senders.length
    ? await ctx.db
        .select({ id: schema.user.id, name: sql<string>`coalesce(${schema.user.displayUsername}, ${schema.user.name})` })
        .from(schema.user)
        .where(inArray(schema.user.id, senders))
    : [];
  const nameBy = new Map(names.map((n) => [n.id, n.name]));
  const withCard = rows.filter((r) => r.cardId !== null);
  const cards = withCard.length
    ? await ctx.db.execute<{ id: string; season: number; title: string; rarity: Rarity }>(sql`
        select id, season, title, rarity from cards
        where (season, id) in (${sql.join(withCard.map((r) => sql`(${r.cardSeason}::smallint, ${r.cardId}::bigint)`), sql`, `)})
      `)
    : [];
  const cardBy = new Map(cards.map((c) => [`${c.season}:${c.id}`, c]));
  return rows.map((r) => {
    const c = r.cardId !== null ? cardBy.get(`${r.cardSeason}:${r.cardId}`) : undefined;
    return {
      id: r.id,
      channel: r.channel,
      senderId: r.senderId,
      sender: nameBy.get(r.senderId) ?? "?",
      body: r.body,
      card: c ? { cardId: Number(c.id), season: c.season, title: c.title, rarity: c.rarity } : null,
      createdAt: r.createdAt.toISOString(),
    };
  });
}

export async function sendMessage(ctx: Ctx, userId: string, input: { to?: string; channel?: string; body: string; instanceId?: number }) {
  let channel = input.channel;
  if (input.to) {
    const other = await findUserByName(ctx.db, input.to);
    if (other.id === userId) throw badRequest("self", "Tu ne peux pas t'écrire à toi-même.");
    channel = dmChannel(userId, other.id);
  }
  if (!channel) throw badRequest("no_channel", "Destinataire manquant.");
  const access = await channelAccess(ctx, userId, channel);
  let card: { cardId: number; season: number } | null = null;
  if (input.instanceId) {
    const [inst] = await ctx.db
      .select({ cardId: schema.cardInstances.cardId, season: schema.cardInstances.season })
      .from(schema.cardInstances)
      .where(and(eq(schema.cardInstances.id, input.instanceId), eq(schema.cardInstances.ownerId, userId)));
    if (!inst) throw notFound("Cette carte n'est pas dans ta collection.");
    card = inst;
  }
  if (!input.body.trim() && !card) throw badRequest("empty", "Message vide.");
  const [row] = await ctx.db
    .insert(m)
    .values({ channel, senderId: userId, body: input.body.trim(), cardId: card?.cardId ?? null, cardSeason: card?.season ?? null })
    .returning();
  await markChannelRead(ctx, userId, channel, row!.createdAt);
  const [dto] = await toMessageDTOs(ctx, [row!]);
  if (access.kind === "dm") {
    ctx.rt.toUser(userId, "message:new", dto!);
    ctx.rt.toUser(access.other, "message:new", dto!);
  } else {
    ctx.rt.toRoom(guildRoom(access.guildId), "message:new", dto!);
  }
  return dto!;
}

export async function history(ctx: Ctx, userId: string, channel: string, before?: number) {
  await channelAccess(ctx, userId, channel);
  const rows = await ctx.db
    .select()
    .from(m)
    .where(before ? and(eq(m.channel, channel), lt(m.id, before)) : eq(m.channel, channel))
    .orderBy(desc(m.id))
    .limit(51);
  const page = rows.slice(0, 50);
  return { items: (await toMessageDTOs(ctx, page)).reverse(), nextCursor: rows.length > 50 ? String(page[page.length - 1]!.id) : null };
}

export async function markChannelRead(ctx: Ctx, userId: string, channel: string, at = new Date()) {
  await ctx.db
    .insert(schema.messageReads)
    .values({ userId, channel, lastReadAt: at })
    .onConflictDoUpdate({
      target: [schema.messageReads.userId, schema.messageReads.channel],
      set: { lastReadAt: sql`greatest(${schema.messageReads.lastReadAt}, ${at.toISOString()}::timestamptz)` },
    });
}

/** Conversations du joueur (MP + guilde), avec dernier message et non-lus. */
export async function conversations(ctx: Ctx, userId: string) {
  const [gm] = await ctx.db
    .select({ guildId: schema.guildMembers.guildId, name: schema.guilds.name })
    .from(schema.guildMembers)
    .innerJoin(schema.guilds, eq(schema.guilds.id, schema.guildMembers.guildId))
    .where(eq(schema.guildMembers.userId, userId));
  const guildCh = gm ? guildChannel(gm.guildId) : null;
  const rows = await ctx.db.execute<{
    channel: string;
    last_body: string;
    last_at: Date;
    last_sender: string;
    unread: number;
  }>(sql`
    with mine as (
      select distinct channel from messages
      where channel like ${`dm:${userId}:%`} or channel like ${`dm:%:${userId}`} ${guildCh ? sql`or channel = ${guildCh}` : sql``}
    )
    select c.channel,
           l.body as last_body, l.created_at as last_at, l.sender_id as last_sender,
           (select count(*)::int from messages x
             where x.channel = c.channel and x.sender_id <> ${userId}
               and x.created_at > coalesce((select r.last_read_at from message_reads r where r.user_id = ${userId} and r.channel = c.channel), 'epoch')) as unread
    from mine c
    join lateral (select body, created_at, sender_id from messages where channel = c.channel order by id desc limit 1) l on true
    order by l.created_at desc
  `);
  const others = rows.map((r) => /^dm:([^:]+):([^:]+)$/.exec(r.channel)).flatMap((x) => (x ? [x[1] === userId ? x[2]! : x[1]!] : []));
  const users = others.length
    ? await ctx.db
        .select({ id: schema.user.id, username: schema.user.username, name: sql<string>`coalesce(${schema.user.displayUsername}, ${schema.user.name})` })
        .from(schema.user)
        .where(inArray(schema.user.id, others))
    : [];
  const userBy = new Map(users.map((u) => [u.id, u]));
  const list = rows.map((r) => {
    const dm = /^dm:([^:]+):([^:]+)$/.exec(r.channel);
    const otherId = dm ? (dm[1] === userId ? dm[2]! : dm[1]!) : null;
    const other = otherId ? userBy.get(otherId) : undefined;
    return {
      channel: r.channel,
      kind: dm ? ("dm" as const) : ("guild" as const),
      title: dm ? (other?.name ?? "?") : (gm?.name ?? "Guilde"),
      username: other?.username ?? null,
      online: otherId ? ctx.rt.isOnline(otherId) : false,
      lastBody: r.last_body,
      lastAt: new Date(r.last_at).toISOString(),
      lastFromMe: r.last_sender === userId,
      unread: r.unread,
    };
  });
  // Le salon de guilde apparaît même vide.
  if (guildCh && !list.some((c) => c.channel === guildCh)) {
    list.push({ channel: guildCh, kind: "guild", title: gm!.name, username: null, online: false, lastBody: "", lastAt: "", lastFromMe: false, unread: 0 });
  }
  return list;
}
