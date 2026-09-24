import { eq, schema, sql } from "@palacards/db";
import { ELO_START } from "@palacards/game";
import type { Ctx } from "../context.js";
import { conflict } from "../errors.js";
import { activeSeason, PLAYER_LOCK_ORDER } from "./players.js";
import { collectionScoresSql } from "./profiles.js";

export const SEASON_ROLLOVER_JOB = "season-rollover";
/** Purge des vieilles cartes : job à part, long (jusqu'à 2,7 M lignes), jamais relancé en parallèle. */
export const CARDS_PURGE_JOB = "cards-purge";

/** État des saisons (page Admin) : saison active, prochaine saison déjà chargée ou non. */
export async function seasonStatus(ctx: Ctx) {
  const season = await activeSeason(ctx.db);
  const [row] = await ctx.db.select().from(schema.seasons).where(eq(schema.seasons.id, season));
  // Page rafraîchie régulièrement : un seul comptage (index-only) et un simple `exists` pour la saison suivante.
  const [stats] = await ctx.db.execute<{ n: number; next: boolean }>(sql`
    select (select count(*)::int from cards where season = ${season}) as n,
           exists (select 1 from cards where season = ${season + 1}) as next
  `);
  return {
    active: season,
    startedAt: row?.startedAt?.toISOString() ?? null,
    endsAt: row?.endsAt?.toISOString() ?? null,
    cards: [{ season, cards: stats?.n ?? 0 }],
    nextLoaded: !!stats?.next,
  };
}

/**
 * Bascule de saison, en une transaction :
 * 1. les cartes de la saison suivante viennent de l'import (`load_cards.sql -v season=N+1`) ;
 *    à défaut, on reconduit les cartes de la saison en cours (nouvelles clés de tirage) ;
 * 2. archivage des classements de la saison (collection, Elo, richesse, guilde) ;
 * 3. remise à zéro de l'Elo de saison (le meilleur Elo historique est conservé) ;
 * 4. activation de la nouvelle saison jusqu'au 1er du mois suivant (heure de Paris).
 * Les exemplaires déjà possédés gardent leurs stats et leur tampon d'édition.
 * `onlyIfDue` (job mensuel, relancé en cas d'échec) : ne bascule que si la saison active est échue,
 * pour qu'une nouvelle tentative n'enchaîne jamais deux saisons.
 */
export async function rolloverSeason(ctx: Ctx, options: { onlyIfDue?: boolean; expectedFrom?: number } = {}) {
  const res = await ctx.db.transaction(async (tx) => {
    // Verrou exclusif : deux bascules simultanées (job + admin) ne peuvent pas se chevaucher.
    await tx.execute(sql`lock table seasons in exclusive mode`);
    const [current] = await tx.select().from(schema.seasons).where(eq(schema.seasons.status, "active"));
    if (!current) throw conflict("no_season", "Aucune saison active.");
    if (options.onlyIfDue && current.endsAt && current.endsAt.getTime() > ctx.now().getTime() + 5 * 60_000) return null;
    // Bascule forcée par l'admin : une requête relancée (délai dépassé, double clic) ne rebascule pas.
    if (options.expectedFrom !== undefined && current.id !== options.expectedFrom) {
      throw conflict(
        "season_changed",
        `La saison ${options.expectedFrom} est déjà terminée (saison active : ${current.id}).`,
      );
    }
    const next = current.id + 1;
    const [loaded] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from cards where season = ${next}`);
    const copied = !loaded?.n;
    if (copied) {
      await tx.execute(sql`
        insert into cards (id, season, title, rarity, atk, def, views_12m, page_len)
        select id, ${next}, title, rarity, atk, def, views_12m, page_len from cards where season = ${current.id}
      `);
    }
    await tx.execute(sql`
      insert into season_archives (season, user_id, collection_score, elo, wealth, guild_id)
      select ${current.id}, p.user_id, coalesce(s.score, 0), p.elo, p.balance, m.guild_id
      from players p
      left join (${collectionScoresSql(current.id)}) s on s.owner_id = p.user_id
      left join guild_members m on m.user_id = p.user_id
      on conflict (season, user_id) do nothing
    `);
    // Joueurs verrouillés dans le même ordre que `lockPlayers` (duels, marché, échanges…) : id croissant
    // octet par octet (collation "C"), pas celui de la collation de la base (en_US mélange majuscules et
    // minuscules) ; sinon deux ordres opposés sur des ids à casse mixte peuvent s'interbloquer.
    await tx.execute(sql`select user_id from players order by ${PLAYER_LOCK_ORDER} for update`);
    await tx.update(schema.players).set({ elo: ELO_START });
    await tx
      .update(schema.seasons)
      .set({ status: "archived", endsAt: ctx.now() })
      .where(eq(schema.seasons.id, current.id));
    // Fin au 1er du mois suivant (heure de Paris) ; une bascule forcée à moins de 7 jours de cette date
    // court jusqu'au 1er du mois d'après, pour ne jamais créer une saison de quelques jours.
    await tx.execute(sql`
      with f as (select (date_trunc('month', now() at time zone 'Europe/Paris') + interval '1 month') as first)
      insert into seasons (id, status, started_at, ends_at)
      select ${next}, 'active', now(),
             (case when f.first - (now() at time zone 'Europe/Paris') < interval '7 days' then f.first + interval '1 month' else f.first end)
               at time zone 'Europe/Paris'
      from f
      on conflict (id) do update set status = 'active', started_at = now(), ends_at = excluded.ends_at
    `);
    return { from: current.id, to: next, copied };
  });
  if (!res) return null;
  await ctx.db.execute(sql`analyze cards`);
  ctx.log.info(res, "nouvelle saison");
  return res;
}

/**
 * Après une bascule : supprime les cartes d'anciennes saisons que plus rien ne référence
 * (exemplaires, ventes, decks, messages), pour que la table ne grossisse pas de 2,7 M lignes par mois.
 */
export async function purgeOldCards(ctx: Ctx) {
  const season = await activeSeason(ctx.db);
  const rows = await ctx.db.execute(sql`
    delete from cards c
    where c.season < ${season}
      and not exists (select 1 from card_instances i where i.season = c.season and i.card_id = c.id)
      and not exists (select 1 from auctions a where a.season = c.season and a.card_id = c.id)
      and not exists (select 1 from battle_decks d where d.season = c.season and d.card_id = c.id)
      and not exists (select 1 from messages m where m.card_season = c.season and m.card_id = c.id)
  `);
  return { deleted: rows.count };
}
