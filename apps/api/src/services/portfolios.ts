import { and, asc, desc, eq, inArray, isNotNull, isNull, schema, sql } from "@palacards/db";
import {
  eligibleDesigns,
  normalizePortfolioCards,
  PORTFOLIO_DEFAULTS,
  PORTFOLIO_DESIGN_BY_KEY,
  PORTFOLIO_DESIGNS,
  PORTFOLIO_IMAGE_BACKGROUND,
  PORTFOLIO_MAX,
  PORTFOLIO_PROFILE_SLOTS,
  PORTFOLIO_SHARED_MAX_PLAYERS,
  portfolioCardsChange,
  type PortfolioAccent,
  type PortfolioVisibility,
} from "@palacards/game";
import {
  BANNER_IMAGE_MAX_BYTES,
  type PortfolioCardDTO,
  type PortfolioDesignItemDTO,
  type PortfolioDTO,
  type PortfolioSummaryDTO,
} from "@palacards/shared";
import type { Ctx } from "../context.js";
import { badRequest, conflict, forbidden, notFound } from "../errors.js";
import { sniffImage } from "./avatars.js";
import { BANNER_MAX_SIDE } from "./banners.js";
import { instanceColumns, toCardDTO } from "./cards.js";
import { Effects } from "./notifications.js";
import { lockPlayer, movePw, pushWallet, type DbOrTx } from "./players.js";

type Tx = Parameters<Parameters<Ctx["db"]["transaction"]>[0]>[0];
type Portfolio = typeof schema.portfolios.$inferSelect;

const pf = schema.portfolios;
const pc = schema.portfolioCards;
const pl = schema.portfolioLikes;
const pb = schema.portfolioBackgrounds;
const pm = schema.portfolioMembers;
const ci = schema.cardInstances;

/** Cartes montrées dans un aperçu (liste, profil). */
const PREVIEW_CARDS = 6;

const versionOf = (d: Date) => d.getTime().toString(36);

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------

/**
 * La carte est à un participant du portfolio : son propriétaire ou un ami qui l'a rejoint. Une carte qui change de
 * main en sort à la transmission, celles d'un ami qui part à son départ : ce filtre n'est qu'un garde-fou.
 */
const heldByParticipant = sql`(${ci.ownerId} = ${pf.userId} or exists (
  select 1 from portfolio_members m
  where m.portfolio_id = ${pf.id} and m.user_id = ${ci.ownerId} and m.joined_at is not null
))`;

/** Cartes de ces portfolios, dans l'ordre, encore à un participant. Vues seulement pour celui à qui est la carte. */
async function cardsOf(db: DbOrTx, list: Portfolio[], viewerId: string, limit?: number) {
  const out = new Map<number, PortfolioCardDTO[]>(list.map((p) => [p.id, []]));
  if (!list.length) return out;
  const rows = await db
    .select({ ...instanceColumns, portfolioId: pc.portfolioId, featured: pc.featured, by: schema.user.username })
    .from(pc)
    .innerJoin(pf, eq(pf.id, pc.portfolioId))
    .innerJoin(ci, and(eq(ci.id, pc.instanceId), heldByParticipant))
    .innerJoin(schema.user, eq(schema.user.id, ci.ownerId))
    .innerJoin(schema.cards, and(eq(schema.cards.season, ci.season), eq(schema.cards.id, ci.cardId)))
    .leftJoin(schema.wikiSummaries, eq(schema.wikiSummaries.pageId, ci.cardId))
    .where(
      inArray(
        pc.portfolioId,
        list.map((p) => p.id),
      ),
    )
    .orderBy(asc(pc.portfolioId), asc(pc.pos));
  for (const { portfolioId, featured, by, ...r } of rows)
    out.get(portfolioId)!.push({ ...toCardDTO(r, {}, viewerId), featured, by: by ?? "" });
  if (limit !== undefined)
    for (const [id, cards] of out)
      out.set(id, [...cards.filter((c) => c.featured), ...cards.filter((c) => !c.featured)].slice(0, limit));
  return out;
}

type MemberRow = {
  portfolio_id: string;
  user_id: string;
  username: string;
  display_name: string;
  avatar: string | null;
  joined_at: Date | string | null;
};

/** Participants et invités de ces portfolios, dans l'ordre d'arrivée (les invitations en attente à la fin). */
async function membersOf(db: DbOrTx, ids: number[]) {
  if (!ids.length) return [];
  return db.execute<MemberRow>(sql`
    select m.portfolio_id, m.user_id, u.username, coalesce(u.display_username, u.name) as display_name, p.avatar,
           m.joined_at
    from portfolio_members m join "user" u on u.id = m.user_id join players p on p.user_id = u.id
    where m.portfolio_id in (${sql.join(
      ids.map((id) => sql`${id}`),
      sql`, `,
    )})
    order by m.joined_at asc nulls last, m.invited_at asc
  `);
}

const toOwnerDTO = (m: MemberRow) => ({ username: m.username, displayName: m.display_name, avatar: m.avatar });

/** Résumés de ces portfolios pour `viewerId` (auteur, participants, likes, aperçu ou toutes les cartes). */
async function summaries(ctx: Ctx, list: Portfolio[], viewerId: string, full: true): Promise<PortfolioDTO[]>;
async function summaries(ctx: Ctx, list: Portfolio[], viewerId: string, full?: false): Promise<PortfolioSummaryDTO[]>;
async function summaries(ctx: Ctx, list: Portfolio[], viewerId: string, full = false) {
  if (!list.length) return [];
  const ids = list.map((p) => p.id);
  const [owners, likes, mineLiked, counts, backgrounds, allCards, members] = await Promise.all([
    ctx.db.execute<{ id: string; username: string; display_name: string; avatar: string | null }>(sql`
      select u.id, u.username, coalesce(u.display_username, u.name) as display_name, p.avatar
      from "user" u join players p on p.user_id = u.id
      where u.id in (${sql.join(
        [...new Set(list.map((p) => p.userId))].map((id) => sql`${id}`),
        sql`, `,
      )})
    `),
    ctx.db
      .select({ id: pl.portfolioId, n: sql<number>`count(*)::int` })
      .from(pl)
      .where(inArray(pl.portfolioId, ids))
      .groupBy(pl.portfolioId),
    ctx.db
      .select({ id: pl.portfolioId })
      .from(pl)
      .where(and(inArray(pl.portfolioId, ids), eq(pl.userId, viewerId))),
    ctx.db
      .select({ id: pc.portfolioId, n: sql<number>`count(*)::int` })
      .from(pc)
      .innerJoin(pf, eq(pf.id, pc.portfolioId))
      .innerJoin(ci, and(eq(ci.id, pc.instanceId), heldByParticipant))
      .where(inArray(pc.portfolioId, ids))
      .groupBy(pc.portfolioId),
    ctx.db.select({ id: pb.portfolioId, updatedAt: pb.updatedAt }).from(pb).where(inArray(pb.portfolioId, ids)),
    cardsOf(ctx.db, list, viewerId, full ? undefined : PREVIEW_CARDS),
    membersOf(ctx.db, ids),
  ]);
  const ownerBy = new Map(owners.map((o) => [o.id, o]));
  const likesBy = new Map(likes.map((l) => [l.id, l.n]));
  const liked = new Set(mineLiked.map((l) => l.id));
  const countBy = new Map(counts.map((c) => [c.id, c.n]));
  const bgBy = new Map(backgrounds.map((b) => [b.id, versionOf(b.updatedAt)]));
  return list.map((p) => {
    const o = ownerBy.get(p.userId);
    const cards = allCards.get(p.id) ?? [];
    const here = members.filter((m) => Number(m.portfolio_id) === p.id);
    const me = here.find((m) => m.user_id === viewerId);
    const role = p.userId === viewerId ? "owner" : me ? (me.joined_at ? "member" : "invited") : null;
    const summary: PortfolioSummaryDTO = {
      id: p.id,
      name: p.name,
      description: p.description,
      owner: { username: o?.username ?? "", displayName: o?.display_name ?? "?", avatar: o?.avatar ?? null },
      design: {
        background: p.background,
        frame: p.frame,
        accent: p.accent,
        backgroundVersion: bgBy.get(p.id) ?? null,
      },
      cardCount: countBy.get(p.id) ?? 0,
      likes: likesBy.get(p.id) ?? 0,
      liked: liked.has(p.id),
      mine: p.userId === viewerId,
      profileSlot: p.profileSlot,
      preview: full
        ? [...cards.filter((c) => c.featured), ...cards.filter((c) => !c.featured)].slice(0, PREVIEW_CARDS)
        : cards,
      visibility: p.visibility,
      role,
      members: here.filter((m) => m.joined_at).map(toOwnerDTO),
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    };
    if (!full) return summary;
    const invited = role === "owner" ? here.filter((m) => !m.joined_at).map(toOwnerDTO) : [];
    return { ...summary, cards, invited };
  });
}

/** Portfolio public et non vide (une carte encore à un participant) : visible des autres joueurs. */
const isPublic = sql`(${pf.visibility} = 'public' and exists (
  select 1 from portfolio_cards x join card_instances i on i.id = x.instance_id
  where x.portfolio_id = ${pf.id} and (i.owner_id = ${pf.userId} or exists (
    select 1 from portfolio_members m
    where m.portfolio_id = ${pf.id} and m.user_id = i.owner_id and m.joined_at is not null
  ))
))`;

async function load(db: DbOrTx, id: number): Promise<Portfolio> {
  const [p] = await db.select().from(pf).where(eq(pf.id, id));
  if (!p) throw notFound("Ce portfolio n'existe pas.");
  return p;
}

/** Place d'un joueur dans un portfolio : propriétaire, participant, invité ou aucune. */
async function roleIn(db: DbOrTx, p: Portfolio, userId: string): Promise<PortfolioSummaryDTO["role"]> {
  if (p.userId === userId) return "owner";
  const [m] = await db
    .select({ joinedAt: pm.joinedAt })
    .from(pm)
    .where(and(eq(pm.portfolioId, p.id), eq(pm.userId, userId)));
  return m ? (m.joinedAt ? "member" : "invited") : null;
}

/** Son propre portfolio, verrouillé (modification). */
async function own(tx: Tx, userId: string, id: number): Promise<Portfolio> {
  const [p] = await tx.select().from(pf).where(eq(pf.id, id)).for("update");
  if (!p) throw notFound("Ce portfolio n'existe pas.");
  if (p.userId !== userId) throw forbidden("Ce portfolio n'est pas le tien.");
  return p;
}

/** Portfolio dont on est propriétaire ou participant, verrouillé (ses cartes). */
async function editable(tx: Tx, userId: string, id: number) {
  const [p] = await tx.select().from(pf).where(eq(pf.id, id)).for("update");
  if (!p) throw notFound("Ce portfolio n'existe pas.");
  const role = await roleIn(tx, p, userId);
  if (role !== "owner" && role !== "member") throw forbidden("Tu ne participes pas à ce portfolio.");
  return p;
}

/**
 * Page d'un portfolio : son propriétaire, ses participants et ses invités le voient toujours ; les autres
 * seulement s'il est public et a une carte.
 */
export async function getPortfolio(ctx: Ctx, viewerId: string, id: number): Promise<PortfolioDTO> {
  const p = await load(ctx.db, id);
  const [dto] = await summaries(ctx, [p], viewerId, true);
  if (!dto!.role && (p.visibility !== "public" || !dto!.cards.length)) throw notFound("Ce portfolio n'existe pas.");
  return dto!;
}

/** Ses portfolios et ceux qu'on partage avec un ami : ceux du profil d'abord (dans l'ordre), puis les plus récents. */
export async function myPortfolios(ctx: Ctx, userId: string): Promise<PortfolioSummaryDTO[]> {
  const list = await ctx.db
    .select()
    .from(pf)
    .where(
      sql`(${pf.userId} = ${userId} or exists (
        select 1 from portfolio_members m where m.portfolio_id = ${pf.id} and m.user_id = ${userId}
          and m.joined_at is not null
      ))`,
    )
    .orderBy(sql`case when ${pf.userId} = ${userId} then ${pf.profileSlot} end asc nulls last`, desc(pf.updatedAt));
  return summaries(ctx, list, userId);
}

/** Invitations en attente dans les portfolios partagés d'amis, les plus récentes d'abord. */
export async function portfolioInvitations(ctx: Ctx, userId: string): Promise<PortfolioSummaryDTO[]> {
  const rows = await ctx.db
    .select({ p: pf })
    .from(pm)
    .innerJoin(pf, eq(pf.id, pm.portfolioId))
    .where(and(eq(pm.userId, userId), isNull(pm.joinedAt)))
    .orderBy(desc(pm.invitedAt));
  return summaries(
    ctx,
    rows.map((r) => r.p),
    userId,
  );
}

/** Portfolios du profil d'un joueur (3 au plus, dans l'ordre qu'il a choisi), publics et non vides. */
export async function profilePortfolios(ctx: Ctx, viewerId: string, ownerId: string) {
  const list = await ctx.db
    .select()
    .from(pf)
    .where(and(eq(pf.userId, ownerId), isNotNull(pf.profileSlot), isPublic))
    .orderBy(asc(pf.profileSlot));
  return summaries(ctx, list, viewerId);
}

export const COMMUNITY_PAGE = 24;

/** Page Communauté : tous les portfolios non vides, les plus récents ou les plus aimés d'abord. */
export async function communityPortfolios(ctx: Ctx, viewerId: string, sort: "recent" | "likes", page: number) {
  const likes = sql`(select count(*) from portfolio_likes l where l.portfolio_id = ${pf.id})`;
  const list = await ctx.db
    .select()
    .from(pf)
    .where(isPublic)
    .orderBy(...(sort === "likes" ? [sql`${likes} desc`, desc(pf.createdAt)] : [desc(pf.createdAt)]), desc(pf.id))
    .limit(COMMUNITY_PAGE + 1)
    .offset(page * COMMUNITY_PAGE);
  return {
    items: await summaries(ctx, list.slice(0, COMMUNITY_PAGE), viewerId),
    nextCursor: list.length > COMMUNITY_PAGE ? String(page + 1) : null,
  };
}

// ---------------------------------------------------------------------------
// Création et modification
// ---------------------------------------------------------------------------

export async function createPortfolio(ctx: Ctx, userId: string, input: { name: string; description: string }) {
  return ctx.db.transaction(async (tx) => {
    await lockPlayer(tx, userId);
    const [{ n }] = (await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(pf)
      .where(eq(pf.userId, userId))) as [{ n: number }];
    if (n >= PORTFOLIO_MAX)
      throw conflict(
        "portfolio_limit",
        `Tu as déjà ${PORTFOLIO_MAX} portfolios : supprime-en un pour en créer un autre.`,
      );
    const [p] = await tx
      .insert(pf)
      .values({ userId, name: input.name, description: input.description, ...PORTFOLIO_DEFAULTS })
      .returning({ id: pf.id });
    return { id: p!.id };
  });
}

/**
 * Nom, description, design et visibilité (propriétaire seul) ; un design pas encore à soi est refusé. Réservé aux
 * participants, le portfolio quitte le profil.
 */
export async function updatePortfolio(
  ctx: Ctx,
  userId: string,
  id: number,
  input: {
    name?: string;
    description?: string;
    background?: string;
    frame?: string;
    accent?: PortfolioAccent;
    visibility?: PortfolioVisibility;
  },
) {
  const have = await designsOf(ctx.db, userId);
  await ctx.db.transaction(async (tx) => {
    const p = await own(tx, userId, id);
    if (input.background !== undefined) {
      if (input.background === PORTFOLIO_IMAGE_BACKGROUND) {
        const [img] = await tx.select({ id: pb.portfolioId }).from(pb).where(eq(pb.portfolioId, p.id));
        if (!img) throw badRequest("portfolio_no_image", "Envoie d'abord une image de fond.");
      } else if (PORTFOLIO_DESIGN_BY_KEY.get(input.background)?.slot !== "background")
        throw badRequest("portfolio_design", "Ce fond n'existe pas.");
      else if (!have.has(input.background)) throw forbidden("Ce fond n'est pas encore à toi.");
    }
    if (input.frame !== undefined) {
      if (PORTFOLIO_DESIGN_BY_KEY.get(input.frame)?.slot !== "frame")
        throw badRequest("portfolio_design", "Ce cadre n'existe pas.");
      if (!have.has(input.frame)) throw forbidden("Ce cadre n'est pas encore à toi.");
    }
    await tx
      .update(pf)
      .set({
        ...input,
        ...(input.visibility === "members" ? { profileSlot: null } : {}),
        updatedAt: ctx.now(),
      })
      .where(eq(pf.id, p.id));
  });
}

/**
 * Remplace les cartes (ordre et vedette), par le propriétaire ou un participant. Chacun n'ajoute que des exemplaires
 * de sa collection et ne retire que les siens (le propriétaire peut retirer ceux de tous) ; rien ne change de main.
 */
export async function setPortfolioCards(
  ctx: Ctx,
  userId: string,
  id: number,
  cards: { instanceId: number; featured?: boolean }[],
) {
  const list = normalizePortfolioCards(cards);
  if (!list) throw badRequest("portfolio_cards", "Liste de cartes invalide (30 au plus, chacune une fois).");
  await ctx.db.transaction(async (tx) => {
    const p = await editable(tx, userId, id);
    const before = await tx
      .select({ instanceId: pc.instanceId, ownerId: ci.ownerId })
      .from(pc)
      .innerJoin(pf, eq(pf.id, pc.portfolioId))
      .innerJoin(ci, and(eq(ci.id, pc.instanceId), heldByParticipant))
      .where(eq(pc.portfolioId, p.id));
    const change = portfolioCardsChange({
      editorId: userId,
      ownerId: p.userId,
      before,
      after: list.map((c) => c.instanceId),
    });
    if (!change) throw forbidden("Tu ne peux retirer que tes propres cartes.");
    if (change.added.length) {
      const owned = await tx
        .select({ id: ci.id })
        .from(ci)
        .where(and(inArray(ci.id, change.added), eq(ci.ownerId, userId)));
      if (owned.length !== change.added.length) throw notFound("Certaines cartes ne sont plus dans ta collection.");
    }
    await tx.delete(pc).where(eq(pc.portfolioId, p.id));
    if (list.length)
      await tx
        .insert(pc)
        .values(list.map((c, pos) => ({ portfolioId: p.id, instanceId: c.instanceId, pos, featured: c.featured })));
    await tx.update(pf).set({ updatedAt: ctx.now() }).where(eq(pf.id, p.id));
  });
}

export async function deletePortfolio(ctx: Ctx, userId: string, id: number) {
  await ctx.db.transaction(async (tx) => {
    const p = await own(tx, userId, id);
    await tx.delete(pf).where(eq(pf.id, p.id));
  });
}

/** Portfolios du profil, dans l'ordre d'affichage (3 au plus) ; les autres en sortent. */
export async function setProfilePortfolios(ctx: Ctx, userId: string, ids: number[]) {
  const wanted = [...new Set(ids)];
  if (wanted.length !== ids.length || wanted.length > PORTFOLIO_PROFILE_SLOTS)
    throw badRequest("portfolio_profile", `Choisis jusqu'à ${PORTFOLIO_PROFILE_SLOTS} portfolios différents.`);
  await ctx.db.transaction(async (tx) => {
    await lockPlayer(tx, userId);
    if (wanted.length) {
      const mine = await tx
        .select({ id: pf.id })
        .from(pf)
        .where(and(inArray(pf.id, wanted), eq(pf.userId, userId), eq(pf.visibility, "public")));
      if (mine.length !== wanted.length) throw notFound("Portfolio introuvable.");
    }
    // Tout est libéré d'abord : l'index unique (joueur, place) ne voit jamais deux portfolios au même endroit.
    await tx.update(pf).set({ profileSlot: null }).where(eq(pf.userId, userId));
    for (const [i, id] of wanted.entries())
      await tx
        .update(pf)
        .set({ profileSlot: i + 1 })
        .where(eq(pf.id, id));
  });
}

// ---------------------------------------------------------------------------
// Portfolios partagés (suggestion n° 125) : invitations d'amis, départ, retrait
// ---------------------------------------------------------------------------

async function areFriends(db: DbOrTx, x: string, y: string) {
  const [a, b] = x < y ? [x, y] : [y, x];
  const [row] = await db
    .select({ status: schema.friendships.status })
    .from(schema.friendships)
    .where(and(eq(schema.friendships.userA, a), eq(schema.friendships.userB, b)));
  return row?.status === "accepted";
}

async function nameOf(db: DbOrTx, userId: string) {
  const [u] = await db
    .select({ name: sql<string>`coalesce(${schema.user.displayUsername}, ${schema.user.name})` })
    .from(schema.user)
    .where(eq(schema.user.id, userId));
  return u?.name ?? "?";
}

/** Le propriétaire invite un ami ; propriétaire et invitations compris, PORTFOLIO_SHARED_MAX_PLAYERS joueurs au plus. */
export async function invitePortfolioMember(ctx: Ctx, userId: string, id: number, friendId: string) {
  if (friendId === userId) throw badRequest("self", "Tu participes déjà à ton portfolio.");
  const fx = new Effects();
  await ctx.db.transaction(async (tx) => {
    const p = await own(tx, userId, id);
    if (!(await areFriends(tx, userId, friendId))) throw forbidden("Tu ne peux inviter que tes amis.");
    const rows = await tx.select({ userId: pm.userId }).from(pm).where(eq(pm.portfolioId, p.id));
    if (rows.some((r) => r.userId === friendId)) throw conflict("portfolio_member", "Cet ami est déjà invité.");
    if (rows.length + 1 >= PORTFOLIO_SHARED_MAX_PLAYERS)
      throw conflict(
        "portfolio_members_full",
        `Un portfolio partagé réunit ${PORTFOLIO_SHARED_MAX_PLAYERS} joueurs au plus, toi compris.`,
      );
    await tx.insert(pm).values({ portfolioId: p.id, userId: friendId, invitedAt: ctx.now() });
    await fx.notify(tx, friendId, "portfolio_invite", {
      from: await nameOf(tx, userId),
      portfolioId: p.id,
      name: p.name,
    });
  });
  await fx.flush(ctx);
}

/** L'ami invité accepte : il peut dès lors y poser ses cartes. Il faut être encore amis. */
export async function joinPortfolio(ctx: Ctx, userId: string, id: number) {
  const fx = new Effects();
  await ctx.db.transaction(async (tx) => {
    const [p] = await tx.select().from(pf).where(eq(pf.id, id)).for("update");
    const [m] = p
      ? await tx
          .select()
          .from(pm)
          .where(and(eq(pm.portfolioId, id), eq(pm.userId, userId)))
      : [];
    if (!p || !m) throw notFound("Aucune invitation pour ce portfolio.");
    if (m.joinedAt) throw conflict("portfolio_member", "Tu participes déjà à ce portfolio.");
    if (!(await areFriends(tx, userId, p.userId)))
      throw forbidden("Vous n'êtes plus amis : l'invitation ne tient plus.");
    await tx
      .update(pm)
      .set({ joinedAt: ctx.now() })
      .where(and(eq(pm.portfolioId, id), eq(pm.userId, userId)));
    // On n'aime pas un portfolio auquel on participe.
    await tx.delete(pl).where(and(eq(pl.portfolioId, id), eq(pl.userId, userId)));
    await fx.notify(tx, p.userId, "portfolio_joined", {
      from: await nameOf(tx, userId),
      portfolioId: id,
      name: p.name,
    });
  });
  await fx.flush(ctx);
}

/** Sort un participant (ou une invitation) d'un portfolio : ses cartes le quittent et restent dans sa collection. */
async function dropMember(tx: Tx, id: number, memberId: string, now: Date) {
  const gone = await tx
    .delete(pm)
    .where(and(eq(pm.portfolioId, id), eq(pm.userId, memberId)))
    .returning({ userId: pm.userId });
  if (!gone.length) return false;
  await tx
    .delete(pc)
    .where(
      and(
        eq(pc.portfolioId, id),
        inArray(pc.instanceId, tx.select({ id: ci.id }).from(ci).where(eq(ci.ownerId, memberId))),
      ),
    );
  await tx.update(pf).set({ updatedAt: now }).where(eq(pf.id, id));
  return true;
}

/**
 * Retire un participant ou une invitation : le propriétaire pour n'importe qui (révocation), chacun pour soi-même
 * (départ, refus).
 */
export async function removePortfolioMember(ctx: Ctx, userId: string, id: number, memberId: string) {
  await ctx.db.transaction(async (tx) => {
    const [p] = await tx.select().from(pf).where(eq(pf.id, id)).for("update");
    if (!p) throw notFound("Ce portfolio n'existe pas.");
    if (memberId !== userId && p.userId !== userId) throw forbidden("Ce portfolio n'est pas le tien.");
    if (!(await dropMember(tx, id, memberId, ctx.now()))) throw notFound("Ce joueur ne participe pas à ce portfolio.");
  });
}

/** Deux joueurs ne sont plus amis : chacun quitte les portfolios partagés de l'autre. */
export async function leaveSharedPortfolios(ctx: Ctx, x: string, y: string) {
  await ctx.db.transaction(async (tx) => {
    for (const [ownerId, memberId] of [
      [x, y],
      [y, x],
    ] as const) {
      const rows = await tx
        .select({ id: pm.portfolioId })
        .from(pm)
        .innerJoin(pf, eq(pf.id, pm.portfolioId))
        .where(and(eq(pf.userId, ownerId), eq(pm.userId, memberId)));
      for (const r of rows) await dropMember(tx, r.id, memberId, ctx.now());
    }
  });
}

// ---------------------------------------------------------------------------
// Likes (sans récompense)
// ---------------------------------------------------------------------------

export async function likePortfolio(ctx: Ctx, userId: string, id: number, like: boolean) {
  const p = await load(ctx.db, id);
  const role = await roleIn(ctx.db, p, userId);
  if (role === "owner" || role === "member") throw forbidden("Tu ne peux pas aimer ton propre portfolio.");
  if (like) {
    const [visible] = await ctx.db
      .select({ id: pf.id })
      .from(pf)
      .where(and(eq(pf.id, id), isPublic));
    if (!visible) throw notFound("Ce portfolio n'existe pas.");
    await ctx.db.insert(pl).values({ portfolioId: id, userId, createdAt: ctx.now() }).onConflictDoNothing();
  } else {
    await ctx.db.delete(pl).where(and(eq(pl.portfolioId, id), eq(pl.userId, userId)));
  }
  const [{ n }] = (await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(pl)
    .where(eq(pl.portfolioId, id))) as [{ n: number }];
  return { likes: n, liked: like };
}

// ---------------------------------------------------------------------------
// Designs
// ---------------------------------------------------------------------------

/** Clés des succès qui débloquent un design. */
const DESIGN_ACHIEVEMENTS = PORTFOLIO_DESIGNS.flatMap((d) =>
  d.source.kind === "achievement" ? [d.source.achievement] : [],
);

/**
 * Designs du joueur : gratuits, achetés ou gagnés. Ceux qu'un succès débloqué ou un évènement joué lui donnent
 * maintenant sont enregistrés au passage (ils lui restent ensuite).
 */
export async function designsOf(db: DbOrTx, userId: string): Promise<Set<string>> {
  const [rows, unlocked, events] = await Promise.all([
    db
      .select({ key: schema.playerPortfolioDesigns.designKey })
      .from(schema.playerPortfolioDesigns)
      .where(eq(schema.playerPortfolioDesigns.userId, userId)),
    db
      .select({ key: schema.achievementsProgress.achievementKey })
      .from(schema.achievementsProgress)
      .where(
        and(
          eq(schema.achievementsProgress.userId, userId),
          inArray(schema.achievementsProgress.achievementKey, DESIGN_ACHIEVEMENTS),
          isNotNull(schema.achievementsProgress.unlockedAt),
        ),
      ),
    db.execute<{ day: string }>(sql`select distinct day::text as day from boss_assaults where user_id = ${userId}`),
  ]);
  const days = events.map((e) => e.day);
  const { have, earned } = eligibleDesigns({
    owned: rows.map((r) => r.key),
    unlockedAchievements: new Set(unlocked.map((u) => u.key)),
    eventPlayed: (from, to) => days.some((d) => d >= from && d <= to),
  });
  if (earned.length)
    await db
      .insert(schema.playerPortfolioDesigns)
      .values(earned.map((e) => ({ userId, designKey: e.key, source: e.source })))
      .onConflictDoNothing();
  return have;
}

/** Catalogue des designs, avec ce que le joueur possède. */
export async function designCatalog(ctx: Ctx, userId: string): Promise<PortfolioDesignItemDTO[]> {
  const have = await designsOf(ctx.db, userId);
  return PORTFOLIO_DESIGNS.map((d) => ({
    key: d.key,
    slot: d.slot,
    name: d.name,
    source: d.source.kind,
    price: d.source.kind === "shop" ? d.source.price : null,
    condition: d.source.kind === "achievement" || d.source.kind === "event" ? d.source.label : null,
    owned: have.has(d.key),
  }));
}

/** Achat d'un design en PW (une seule fois, à soi pour toujours). */
export async function buyDesign(ctx: Ctx, userId: string, key: string) {
  const d = PORTFOLIO_DESIGN_BY_KEY.get(key);
  if (!d) throw notFound("Ce design n'existe pas.");
  if (d.source.kind !== "shop") throw badRequest("design_not_for_sale", "Ce design ne s'achète pas.");
  const price = d.source.price;
  const player = await ctx.db.transaction(async (tx) => {
    const p = await lockPlayer(tx, userId);
    const [already] = await tx
      .select({ key: schema.playerPortfolioDesigns.designKey })
      .from(schema.playerPortfolioDesigns)
      .where(and(eq(schema.playerPortfolioDesigns.userId, userId), eq(schema.playerPortfolioDesigns.designKey, key)));
    if (already) throw conflict("design_owned", "Ce design est déjà à toi.");
    await movePw(tx, p, -price, "portfolio_design", key);
    await tx.insert(schema.playerPortfolioDesigns).values({ userId, designKey: key, source: "purchase" });
    return p;
  });
  pushWallet(ctx, player);
  return { balance: player.balance };
}

// ---------------------------------------------------------------------------
// Image de fond envoyée (contrôles des bannières)
// ---------------------------------------------------------------------------

export async function savePortfolioBackground(ctx: Ctx, userId: string, id: number, base64: string) {
  const buf = Buffer.from(base64, "base64");
  if (buf.length === 0) throw badRequest("background_empty", "Image vide.");
  if (buf.length > BANNER_IMAGE_MAX_BYTES)
    throw badRequest("background_too_big", "Image trop lourde (180 ko maximum).");
  const info = sniffImage(buf);
  if (!info) throw badRequest("background_format", "Format non reconnu : envoie une image WebP, JPEG ou PNG.");
  if (!info.width || !info.height || info.width > BANNER_MAX_SIDE || info.height > BANNER_MAX_SIDE)
    throw badRequest("background_size", `Image trop grande (${BANNER_MAX_SIDE} px de côté maximum).`);
  const now = ctx.now();
  await ctx.db.transaction(async (tx) => {
    const p = await own(tx, userId, id);
    await tx
      .insert(pb)
      .values({ portfolioId: p.id, image: buf, mime: info.mime, updatedAt: now })
      .onConflictDoUpdate({ target: pb.portfolioId, set: { image: buf, mime: info.mime, updatedAt: now } });
    await tx.update(pf).set({ background: PORTFOLIO_IMAGE_BACKGROUND, updatedAt: now }).where(eq(pf.id, p.id));
  });
  return { backgroundVersion: versionOf(now) };
}

/** Retire l'image de fond (le joueur, ou un admin : modération) ; le portfolio revient au fond par défaut. */
export async function deletePortfolioBackground(ctx: Ctx, id: number, userId: string | null) {
  await ctx.db.transaction(async (tx) => {
    const p = userId ? await own(tx, userId, id) : await load(tx, id);
    await tx.delete(pb).where(eq(pb.portfolioId, p.id));
    if (p.background === PORTFOLIO_IMAGE_BACKGROUND)
      await tx.update(pf).set({ background: PORTFOLIO_DEFAULTS.background }).where(eq(pf.id, p.id));
  });
}

export async function getPortfolioBackground(ctx: Ctx, id: number) {
  const [row] = await ctx.db.select({ image: pb.image, mime: pb.mime }).from(pb).where(eq(pb.portfolioId, id));
  return row ?? null;
}

/** Admin : images de fond envoyées, les plus récentes d'abord. */
export async function adminPortfolioBackgrounds(ctx: Ctx) {
  const rows = await ctx.db.execute<{
    id: string;
    name: string;
    username: string;
    display_name: string;
    updated_at: Date | string;
  }>(sql`
    select p.id, p.name, u.username, coalesce(u.display_username, u.name) as display_name, b.updated_at
    from portfolio_backgrounds b join portfolios p on p.id = b.portfolio_id join "user" u on u.id = p.user_id
    order by b.updated_at desc limit 200
  `);
  return rows.map((r) => ({
    portfolioId: Number(r.id),
    name: r.name,
    owner: { username: r.username, displayName: r.display_name },
    version: versionOf(new Date(r.updated_at)),
    updatedAt: new Date(r.updated_at).toISOString(),
  }));
}
