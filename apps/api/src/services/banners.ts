import { eq, schema, sql } from "@palacards/db";
import type { BannerDTO } from "@palacards/shared";
import type { Ctx } from "../context.js";
import { notFound } from "../errors.js";
import type { DbOrTx } from "./players.js";

/**
 * Bannière choisie par chacun de ces joueurs (absent : bannière par défaut). Une bannière ne s'affiche que
 * tant que le joueur possède encore un exemplaire de l'article : vendu, échangé ou recyclé, on revient au défaut.
 * Une seule requête pour tout un classement (clé primaire de `players`, index `card_instances_owner_card_idx`).
 */
export async function bannersOf(db: DbOrTx, userIds: string[]): Promise<Map<string, BannerDTO>> {
  if (!userIds.length) return new Map();
  const rows = await db.execute<{ user_id: string; card_id: string; title: string | null; thumb_url: string | null }>(
    sql`
      select p.user_id, p.banner_card_id as card_id, w.thumb_url,
        (select c.title from cards c where c.id = p.banner_card_id order by c.season desc limit 1) as title
      from players p left join wiki_summaries w on w.page_id = p.banner_card_id
      where p.banner_card_id is not null and p.user_id in (${sql.join(
        userIds.map((id) => sql`${id}`),
        sql`, `,
      )})
        and exists (select 1 from card_instances ci where ci.owner_id = p.user_id and ci.card_id = p.banner_card_id)
    `,
  );
  return new Map(
    rows.map((r) => [r.user_id, { cardId: Number(r.card_id), title: r.title ?? "", thumbUrl: r.thumb_url }]),
  );
}

/** Choisit la bannière (article de sa collection) ou revient à la bannière par défaut (null). */
export async function chooseBanner(ctx: Ctx, userId: string, cardId: number | null) {
  if (cardId !== null) {
    const [owned] = await ctx.db.execute<{ one: number }>(
      sql`select 1 as one from card_instances where owner_id = ${userId} and card_id = ${cardId} limit 1`,
    );
    if (!owned) throw notFound("Cet article n'est pas dans ta collection.");
  }
  await ctx.db.update(schema.players).set({ bannerCardId: cardId }).where(eq(schema.players.userId, userId));
  return { banner: cardId === null ? null : ((await bannersOf(ctx.db, [userId])).get(userId) ?? null) };
}
