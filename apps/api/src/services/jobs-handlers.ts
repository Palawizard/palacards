import type { Ctx } from "../context.js";
import { sweepBattles } from "./battles.js";
import { backfillOwnedSummaries, SUMMARY_BACKFILL_JOB } from "./collection.js";
import { BOSS_FINALIZE_JOB, finalizeBosses } from "./boss.js";
import { purgeOldPulls, startWeirdRefresh, WEIRD_REFRESH_JOB } from "./feed.js";
import { notifyPacksFull, PACKS_FULL_JOB } from "./economy.js";
import { GUILD_WEEKLY_JOB, weeklyJob } from "./guilds.js";
import { CARDS_PURGE_JOB, purgeOldCards, rolloverSeason, SEASON_ROLLOVER_JOB } from "./seasons.js";
import { AUCTION_CLOSE_JOB, closeAuctionIfDue, sweepAuctions } from "./market.js";
import { PRIVACY_PURGE_JOB, purgeExpired } from "./privacy.js";
import { closeTrade, sweepTrades, TRADE_EXPIRE_JOB } from "./trades.js";

/** Déclare les files pg-boss et leurs handlers (tous idempotents). */
export function registerJobs(ctx: Ctx) {
  ctx.jobs.define(AUCTION_CLOSE_JOB, async (data) => {
    await closeAuctionIfDue(ctx, Number(data.auctionId));
  });
  ctx.jobs.define(TRADE_EXPIRE_JOB, async (data) => {
    await closeTrade(ctx, Number(data.tradeId), { kind: "expire" });
  });
  ctx.jobs.define(PACKS_FULL_JOB, async (data) => {
    await notifyPacksFull(ctx, String(data.userId), String(data.fullAt));
  });
  // Objectifs de guilde : nouvelle semaine le lundi à 0 h (heure de Paris).
  ctx.jobs.schedule(GUILD_WEEKLY_JOB, "0 0 * * 1", async () => {
    await weeklyJob(ctx);
  });
  // Saisons mensuelles : bascule le 1er du mois à 0 h (heure de Paris), puis purge des vieilles cartes (job à part).
  ctx.jobs.schedule(SEASON_ROLLOVER_JOB, "0 0 1 * *", async () => {
    if (await rolloverSeason(ctx, { onlyIfDue: true })) await ctx.jobs.sendAt(CARDS_PURGE_JOB, {}, ctx.now());
  });
  ctx.jobs.define(
    CARDS_PURGE_JOB,
    async () => {
      const { deleted } = await purgeOldCards(ctx);
      ctx.log.info({ deleted }, "purge des vieilles cartes");
    },
    // Idempotente : relancée à la bascule suivante si elle échoue ; pas de reprise pendant qu'elle tourne encore.
    { expireInSeconds: 3 * 3600, retryLimit: 0 },
  );
  // Minimisation RGPD : sessions expirées (IP, navigateur), jetons et notifications de plus de 6 mois, chaque nuit.
  ctx.jobs.schedule(PRIVACY_PURGE_JOB, "30 4 * * *", async () => {
    ctx.log.info(await purgeExpired(ctx), "purge des données expirées");
  });
  // Résumés Wikipédia des cartes possédées encore absents du cache (recherche « dans le résumé »).
  ctx.jobs.schedule(SUMMARY_BACKFILL_JOB, "*/10 * * * *", async () => {
    const loaded = await backfillOwnedSummaries(ctx);
    if (loaded) ctx.log.info({ loaded }, "résumés des cartes possédées");
  });
  // Boss du jour, juste après minuit (heure de Paris) : consolation si le boss a tenu, sinon retardataires
  // et meilleur assaillant.
  ctx.jobs.schedule(BOSS_FINALIZE_JOB, "5 0 * * *", async () => {
    await finalizeBosses(ctx);
  });
  // Fil d'activité : catégories « bizarres » rechargées chaque lundi, vieux tirages purgés chaque nuit.
  ctx.jobs.schedule(WEIRD_REFRESH_JOB, "15 5 * * 1", async () => {
    startWeirdRefresh(ctx);
  });
  ctx.jobs.schedule("pulls-purge", "45 4 * * *", async () => {
    ctx.log.info({ deleted: await purgeOldPulls(ctx) }, "purge du fil d'activité");
  });
  // Filet de sécurité : rattrape toute échéance manquée (redémarrage, job perdu).
  ctx.jobs.schedule("market-sweep", "* * * * *", async () => {
    await sweepAuctions(ctx);
    await sweepTrades(ctx);
    await sweepBattles(ctx);
  });
}
