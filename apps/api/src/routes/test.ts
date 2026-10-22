import { and, eq, schema, sql } from "@palacards/db";
import { TITLE_BOARDS, TITLE_MAX_RANK } from "@palacards/game";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser, type Ctx } from "../context.js";
import { parse } from "../errors.js";
import { closeAuctionIfDue } from "../services/market.js";
import { setAdminRole } from "../services/roles.js";
import { activeSeason, lockPlayer, logMovement, movePw, ownedCount, pushWallet } from "../services/players.js";

/**
 * Routes de test (E2E) : enregistrées uniquement avec GAME_TEST_MODE=1, refusé en production
 * par la config. Elles passent quand même par les mêmes transactions et le ledger.
 */
export function testRoutes(api: FastifyInstance, ctx: Ctx) {
  const auth = { preHandler: requireUser(ctx) };

  /** Donne `count` exemplaires d'un article (par défaut : un article déjà possédé, pour créer un doublon). */
  api.post("/test/grant-card", auth, async (req) => {
    const body = parse(
      z.object({ cardId: z.number().int().optional(), count: z.number().int().min(1).max(20).default(1) }),
      req.body,
    );
    const season = await activeSeason(ctx.db);
    const ids = await ctx.db.transaction(async (tx) => {
      await lockPlayer(tx, req.user.id);
      let cardId = body.cardId;
      if (!cardId) {
        const [owned] = await tx
          .select({ cardId: schema.cardInstances.cardId })
          .from(schema.cardInstances)
          .where(and(eq(schema.cardInstances.ownerId, req.user.id), eq(schema.cardInstances.season, season)))
          .limit(1);
        cardId = owned?.cardId;
      }
      const [card] = cardId
        ? await tx
            .select()
            .from(schema.cards)
            .where(and(eq(schema.cards.season, season), eq(schema.cards.id, cardId)))
        : await tx
            .select()
            .from(schema.cards)
            .where(eq(schema.cards.season, season))
            .orderBy(sql`rand_key`)
            .limit(1);
      if (!card) throw new Error("carte introuvable");
      const rows = await tx
        .insert(schema.cardInstances)
        .values(
          Array.from({ length: body.count }, () => ({
            ownerId: req.user.id,
            cardId: card.id,
            season,
            rarity: card.rarity,
            atk: card.atk,
            def: card.def,
            source: "admin" as const,
          })),
        )
        .returning({ id: schema.cardInstances.id });
      await logMovement(tx, req.user.id, "card", rows.length, await ownedCount(tx, req.user.id), "admin", "test");
      return rows.map((r) => r.id);
    });
    return { instanceIds: ids };
  });

  /** Termine une enchère tout de suite (échéance dans le passé, puis clôture normale). */
  api.post("/test/end-auction", auth, async (req) => {
    const { auctionId } = parse(z.object({ auctionId: z.number().int().positive() }), req.body);
    await ctx.db
      .update(schema.auctions)
      .set({ endsAt: new Date(Date.now() - 1000) })
      .where(eq(schema.auctions.id, auctionId));
    return { closed: await closeAuctionIfDue(ctx, auctionId) };
  });

  api.post("/test/grant-pw", auth, async (req) => {
    const { amount } = parse(z.object({ amount: z.number().int().positive().max(1_000_000) }), req.body);
    const p = await ctx.db.transaction(async (tx) =>
      movePw(tx, await lockPlayer(tx, req.user.id), amount, "admin", "test"),
    );
    pushWallet(ctx, p);
    return { balance: p.balance };
  });

  /** Donne un titre de fin de saison au joueur connecté (sans l'afficher : c'est à lui de le choisir). */
  api.post("/test/grant-title", auth, async (req) => {
    const body = parse(
      z.object({
        season: z.number().int().positive(),
        board: z.enum(TITLE_BOARDS),
        rank: z.number().int().min(1).max(TITLE_MAX_RANK),
      }),
      req.body,
    );
    await ctx.db
      .insert(schema.playerTitles)
      .values({ userId: req.user.id, ...body })
      .onConflictDoNothing();
    return { ok: true };
  });

  /** Donne le rôle admin au joueur connecté (en prod : CLI `node dist/cli/admin.js grant <pseudo>`). */
  api.post("/test/make-admin", auth, async (req) => {
    await setAdminRole(ctx.db, req.user.username, true);
    return { ok: true };
  });

  /**
   * « Plus ou moins vu » en E2E (pas de Wikipédia) : un résumé avec image pour les Super rares, Ultra rares et
   * Légendaires de la saison qui n'en ont pas, et des vues étalées. Base E2E seulement (modifie les cartes).
   */
  api.post("/test/hl-seed", auth, async () => {
    const rows = await ctx.db.execute(sql`
      insert into wiki_summaries (page_id, extract, thumb_url, page_url, description, status, arthropod)
      select c.id, 'Résumé de test.', 'https://upload.wikimedia.org/test/' || c.id || '.jpg', null, 'article de test', 'ok', false
      from cards c
      where c.season = (select id from seasons where status = 'active') and c.rarity in ('SR', 'UR', 'L')
      on conflict (page_id) do nothing
    `);
    // Cartes synthétiques aux vues presque identiques : on les étale (×1,08 de l'une à l'autre, comme les vraies).
    await ctx.db.execute(sql`
      update cards c set views_12m = (22500 * power(1.08, r.n))::bigint
      from (select id, season, row_number() over (order by views_12m, id) as n from cards where rarity in ('SR', 'UR', 'L')) r
      where c.id = r.id and c.season = r.season
    `);
    return { seeded: rows.count };
  });

  /** Côté le plus vu de la paire en cours (parcours E2E : jouer une bonne puis une mauvaise réponse). */
  api.get("/test/hl-answer", auth, async (req) => {
    const [row] = await ctx.db.execute<{ kept: string; challenger: string }>(sql`
      select k.views_12m as kept, c.views_12m as challenger
      from hl_runs r
      join cards k on k.season = r.season and k.id = r.kept_card_id
      join cards c on c.season = r.season and c.id = r.challenger_card_id
      where r.user_id = ${req.user.id} and r.status = 'playing'
    `);
    if (!row) return { higher: null };
    return { higher: Number(row.kept) > Number(row.challenger) ? "kept" : "challenger" };
  });
}
