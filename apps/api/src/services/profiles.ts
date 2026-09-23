import { schema, sql, type SQL } from "@palacards/db";
import { COLLECTION_POINTS, RARITIES } from "@palacards/game";
import type { CardDTO } from "@palacards/shared";
import type { Ctx } from "../context.js";
import { notFound } from "../errors.js";
import { selectInstances, toCardDTO } from "./cards.js";
import type { DbOrTx } from "./players.js";

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
}

export async function findUserByName(db: DbOrTx, username: string) {
  const [u] = await db.execute<{ id: string; username: string; display_name: string; created_at: Date }>(sql`
    select id, username, coalesce(display_username, name) as display_name, created_at
    from "user" where username = ${username.toLowerCase()}
  `);
  if (!u) throw notFound("Ce joueur n'existe pas.");
  return u;
}

export async function getProfile(ctx: Ctx, viewerId: string, username: string): Promise<ProfileDTO> {
  const u = await findUserByName(ctx.db, username);
  const [p] = await ctx.db.execute<{ avatar: string | null; elo: number; elo_peak: number; total: number }>(sql`
    select p.avatar, p.elo, p.elo_peak, (select count(*)::int from card_instances where owner_id = p.user_id) as total
    from players p where p.user_id = ${u.id}
  `);
  const score = await collectionScore(ctx.db, u.id);
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
    showcase: pinned.map((r) => toCardDTO(r)),
    isMe: u.id === viewerId,
  };
}
