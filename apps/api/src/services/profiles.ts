import { schema, sql, type SQL } from "@palacards/db";
import {
  checkStatusNote,
  COLLECTION_POINTS,
  RARITIES,
  STATUS_NOTE_ERRORS,
  visibleStatusNote,
  type TitleRef,
} from "@palacards/game";
import type { BannerDTO, CardDTO, PlayerSuggestionDTO } from "@palacards/shared";
import type { Ctx } from "../context.js";
import { badRequest, notFound } from "../errors.js";
import { bannersOf } from "./banners.js";
import { selectInstances, toCardDTO } from "./cards.js";
import type { DbOrTx } from "./players.js";
import { displayedTitles, listTitles } from "./titles.js";

/** Points de collection d'une rareté, en SQL (valeurs lues dans packages/game). */
export const rarityPointsSql = (col: SQL): SQL =>
  sql`(case ${col} ${sql.join(
    RARITIES.map((r) => sql`when ${r}::rarity then ${COLLECTION_POINTS[r]}`),
    sql` `,
  )} else 0 end)`;

/**
 * Score de collection (articles uniques, à leur meilleure rareté) de chaque joueur.
 * `season` restreint aux exemplaires de cette édition (classement de saison).
 */
export function collectionScoresSql(season?: number): SQL {
  const seasonFilter = season === undefined ? sql`` : sql`where ci.season = ${season}`;
  return sql`
    select owner_id, sum(points)::int as score, count(*)::int as unique_cards from (
      select ci.owner_id, ci.card_id, max(${rarityPointsSql(sql`ci.rarity`)}) as points
      from card_instances ci ${seasonFilter}
      group by ci.owner_id, ci.card_id
    ) best group by owner_id
  `;
}

export async function collectionScore(
  db: DbOrTx,
  userId: string,
  season?: number,
): Promise<{ score: number; uniqueCards: number }> {
  const [row] = await db.execute<{ score: number; unique_cards: number }>(
    sql`select score, unique_cards from (${collectionScoresSql(season)}) s where s.owner_id = ${userId}`,
  );
  return { score: row?.score ?? 0, uniqueCards: row?.unique_cards ?? 0 };
}

export interface ProfileDTO {
  id: string;
  username: string;
  displayName: string;
  avatar: string | null;
  createdAt: string;
  elo: number;
  eloPeak: number;
  collectionScore: number;
  uniqueCards: number;
  totalCards: number;
  showcase: CardDTO[];
  isMe: boolean;
  relation: "self" | "friends" | "incoming" | "outgoing" | "none";
  online: boolean;
  guild: { id: number; name: string; tag: string; emblem: string; role: string } | null;
  /** Badge « Créateur » : compte admin du jeu. */
  creator: boolean;
  /** Boosters à thème ouverts, par édition (les plus récentes d'abord). */
  themePacks: { id: number; name: string; opened: number }[];
  /** Titre affiché (choisi parmi `titles`). */
  title: TitleRef | null;
  /** Titres gagnés en fin de saison, les plus récents d'abord. */
  titles: TitleRef[];
  /** Note de statut (null : aucune). */
  statusNote: string | null;
  /** Bannière importée (null : bannière par défaut). */
  banner: BannerDTO | null;
}

export async function findUserByName(db: DbOrTx, username: string) {
  const [u] = await db.execute<{
    id: string;
    username: string;
    display_name: string;
    created_at: Date;
    is_admin: boolean;
  }>(sql`
    select id, username, coalesce(display_username, name) as display_name, created_at, is_admin
    from "user" where username = ${username.toLowerCase()}
  `);
  if (!u) throw notFound("Ce joueur n'existe pas.");
  return u;
}

/** Pseudos proposés pendant la saisie, au plus. */
export const PLAYER_SUGGESTIONS_MAX = 8;

/**
 * Pseudos proposés pendant la saisie d'un joueur, sans casse ni accents : ceux qui commencent par la saisie,
 * puis ceux qui la contiennent ; à égalité, les amis d'abord. Le joueur lui-même n'y est jamais ;
 * `excludeFriends` retire aussi ses amis et ses demandes en cours (page Amis, pour en ajouter un nouveau).
 */
export async function searchPlayers(
  ctx: Ctx,
  viewerId: string,
  q: string,
  { excludeFriends = false }: { excludeFriends?: boolean } = {},
): Promise<PlayerSuggestionDTO[]> {
  const needle = sql`lower(f_unaccent(${q.trim().replace(/[\\%_]/g, "\\$&")}))`;
  const rows = await ctx.db.execute<{
    username: string;
    display_name: string;
    avatar: string | null;
    status: "pending" | "accepted" | null;
  }>(sql`
    select u.username, coalesce(u.display_username, u.name) as display_name, p.avatar, f.status
    from "user" u
    join players p on p.user_id = u.id
    left join friendships f
      on (f.user_a = ${viewerId} and f.user_b = u.id) or (f.user_b = ${viewerId} and f.user_a = u.id)
    where u.id <> ${viewerId} and u.username is not null
      and lower(f_unaccent(u.username)) like '%' || ${needle} || '%'
      ${excludeFriends ? sql`and f.status is null` : sql``}
    order by lower(f_unaccent(u.username)) like ${needle} || '%' desc,
      f.status = 'accepted' desc nulls last,
      u.username
    limit ${PLAYER_SUGGESTIONS_MAX}
  `);
  return rows.map((r) => ({
    username: r.username,
    displayName: r.display_name,
    avatar: r.avatar,
    friend: r.status === "accepted",
  }));
}

/** Relation d'amitié vue par `viewerId`. */
async function friendRelation(ctx: Ctx, viewerId: string, otherId: string): Promise<ProfileDTO["relation"]> {
  if (viewerId === otherId) return "self";
  const [a, b] = viewerId < otherId ? [viewerId, otherId] : [otherId, viewerId];
  const [row] = await ctx.db.execute<{ status: string; requested_by: string }>(
    sql`select status, requested_by from friendships where user_a = ${a} and user_b = ${b}`,
  );
  if (!row) return "none";
  if (row.status === "accepted") return "friends";
  return row.requested_by === viewerId ? "outgoing" : "incoming";
}

export async function getProfile(ctx: Ctx, viewerId: string, username: string): Promise<ProfileDTO> {
  const u = await findUserByName(ctx.db, username);
  const [p] = await ctx.db.execute<{
    avatar: string | null;
    elo: number;
    elo_peak: number;
    total: number;
    status_note: string | null;
    status_note_at: Date | string | null;
  }>(sql`
    select p.avatar, p.elo, p.elo_peak, (select count(*)::int from card_instances where owner_id = p.user_id) as total,
           p.status_note, p.status_note_at
    from players p where p.user_id = ${u.id}
  `);
  const score = await collectionScore(ctx.db, u.id);
  const [guild] = await ctx.db.execute<{ id: string; name: string; tag: string; emblem: string; role: string }>(sql`
    select g.id, g.name, g.tag, g.emblem, m.role from guild_members m join guilds g on g.id = m.guild_id where m.user_id = ${u.id}
  `);
  const themePacks = await ctx.db.execute<{ id: string; name: string; opened: number }>(sql`
    select t.id, t.name, p.opened from player_theme_packs p join themes t on t.id = p.theme_id
    where p.user_id = ${u.id} and p.opened > 0
    order by t.starts_at desc, t.id desc
  `);
  const pinned = await selectInstances(ctx.db)
    .where(sql`${schema.cardInstances.ownerId} = ${u.id} and ${schema.cardInstances.pinnedSlot} is not null`)
    .orderBy(schema.cardInstances.pinnedSlot);
  return {
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    avatar: p?.avatar ?? null,
    createdAt: new Date(u.created_at).toISOString(),
    elo: p?.elo ?? 1000,
    eloPeak: p?.elo_peak ?? 1000,
    collectionScore: score.score,
    uniqueCards: score.uniqueCards,
    totalCards: p?.total ?? 0,
    // Vues seulement sur sa propre vitrine (« Plus lu » en duel).
    showcase: pinned.map((r) => toCardDTO(r, {}, viewerId)),
    isMe: u.id === viewerId,
    relation: await friendRelation(ctx, viewerId, u.id),
    online: ctx.rt.isOnline(u.id),
    guild: guild
      ? { id: Number(guild.id), name: guild.name, tag: guild.tag, emblem: guild.emblem, role: guild.role }
      : null,
    creator: u.is_admin === true,
    themePacks: themePacks.map((t) => ({ id: Number(t.id), name: t.name, opened: t.opened })),
    title: (await displayedTitles(ctx.db, [u.id])).get(u.id) ?? null,
    titles: await listTitles(ctx.db, u.id),
    statusNote: statusNoteOf(ctx, p ?? null),
    banner: (await bannersOf(ctx.db, [u.id])).get(u.id) ?? null,
  };
}

/** Note de statut affichable d'une ligne de `players` (null si absente ou expirée). */
export function statusNoteOf(
  ctx: Ctx,
  row: { status_note: string | null; status_note_at: Date | string | null } | null,
): string | null {
  if (!row) return null;
  return visibleStatusNote(row.status_note, row.status_note_at ? new Date(row.status_note_at) : null, ctx.now());
}

/** Change (ou efface, note vide) sa note de statut, après le filtre de `packages/game`. */
export async function setStatusNote(ctx: Ctx, userId: string, raw: string | null) {
  const res = checkStatusNote(raw);
  if (!res.ok) throw badRequest(`status_note_${res.error}`, STATUS_NOTE_ERRORS[res.error]);
  await ctx.db
    .update(schema.players)
    .set({ statusNote: res.note, statusNoteAt: res.note ? ctx.now() : null })
    .where(sql`${schema.players.userId} = ${userId}`);
  return { statusNote: res.note };
}
