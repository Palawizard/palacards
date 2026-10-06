import { and, asc, desc, eq, schema, sql } from "@palacards/db";
import { TITLE_BOARDS, TITLE_NAMES, titleWinners, type TitleBoard, type TitleRef } from "@palacards/game";
import type { Ctx } from "../context.js";
import { notFound } from "../errors.js";
import type { Effects } from "./notifications.js";
import type { DbOrTx } from "./players.js";
import { boardRows } from "./progression.js";

const toRef = (r: { board: string; rank: number; season: number }): TitleRef => ({
  board: r.board as TitleBoard,
  rank: Number(r.rank),
  season: Number(r.season),
});

/** Titres gagnés par un joueur, les plus récents d'abord. */
export async function listTitles(db: DbOrTx, userId: string): Promise<TitleRef[]> {
  const rows = await db
    .select({ board: schema.playerTitles.board, rank: schema.playerTitles.rank, season: schema.playerTitles.season })
    .from(schema.playerTitles)
    .where(eq(schema.playerTitles.userId, userId))
    .orderBy(desc(schema.playerTitles.season), asc(schema.playerTitles.rank), asc(schema.playerTitles.board));
  return rows.map(toRef);
}

/** Titre affiché par chacun de ces joueurs (absent : aucun titre choisi). */
export async function displayedTitles(db: DbOrTx, userIds: string[]): Promise<Map<string, TitleRef>> {
  if (!userIds.length) return new Map();
  const rows = await db.execute<{ user_id: string; board: string; rank: number; season: number }>(sql`
    select t.user_id, t.board, t.rank, t.season
    from players p join player_titles t
      on t.user_id = p.user_id and t.season = p.title_season and t.board = p.title_board
    where p.user_id in (${sql.join(
      userIds.map((id) => sql`${id}`),
      sql`, `,
    )})
  `);
  return new Map(rows.map((r) => [r.user_id, toRef(r)]));
}

/** Choisit le titre affiché sur le profil et dans les classements (null : n'en afficher aucun). */
export async function chooseTitle(ctx: Ctx, userId: string, choice: { season: number; board: TitleBoard } | null) {
  if (choice) {
    const [owned] = await ctx.db
      .select({ rank: schema.playerTitles.rank })
      .from(schema.playerTitles)
      .where(
        and(
          eq(schema.playerTitles.userId, userId),
          eq(schema.playerTitles.season, choice.season),
          eq(schema.playerTitles.board, choice.board),
        ),
      );
    if (!owned) throw notFound("Tu n'as pas obtenu ce titre.");
  }
  await ctx.db
    .update(schema.players)
    .set({ titleSeason: choice?.season ?? null, titleBoard: choice?.board ?? null })
    .where(eq(schema.players.userId, userId));
  return { title: choice ? ((await displayedTitles(ctx.db, [userId])).get(userId) ?? null) : null };
}

/**
 * Bascule de saison (dans sa transaction, avant la remise à zéro de l'Elo) : titre des TITLE_MAX_RANK premiers
 * de chaque classement de la saison qui se termine ; pour les guildes, de chaque membre des guildes lauréates.
 * Un joueur sans titre affiché affiche aussitôt le meilleur gagné. Idempotent (une ligne par saison et classement).
 */
export async function awardSeasonTitles(tx: DbOrTx, fx: Effects, season: number) {
  const awarded: { userId: string; season: number; board: TitleBoard; rank: number }[] = [];
  for (const board of TITLE_BOARDS) {
    for (const w of titleWinners(board, await boardRows(tx, board, "season", season))) {
      const members =
        board === "guilds"
          ? (
              await tx
                .select({ userId: schema.guildMembers.userId })
                .from(schema.guildMembers)
                .where(eq(schema.guildMembers.guildId, Number(w.id)))
            ).map((m) => m.userId)
          : [w.id];
      for (const userId of members) awarded.push({ userId, season, board, rank: w.rank });
    }
  }
  if (!awarded.length) return 0;
  const inserted = await tx.insert(schema.playerTitles).values(awarded).onConflictDoNothing().returning({
    userId: schema.playerTitles.userId,
    board: schema.playerTitles.board,
    rank: schema.playerTitles.rank,
  });
  // Meilleur rang d'abord : c'est lui qui s'affiche chez un joueur qui n'avait pas encore de titre.
  inserted.sort((a, b) => a.rank - b.rank);
  for (const t of inserted) {
    await tx
      .update(schema.players)
      .set({ titleSeason: season, titleBoard: t.board })
      .where(and(eq(schema.players.userId, t.userId), sql`${schema.players.titleSeason} is null`));
    await fx.notify(tx, t.userId, "title_won", {
      board: t.board,
      rank: t.rank,
      season,
      name: TITLE_NAMES[t.board as TitleBoard],
    });
  }
  return inserted.length;
}
