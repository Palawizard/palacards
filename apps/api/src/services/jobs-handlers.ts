import type { Ctx } from "../context.js";
import { sweepBattles } from "./battles.js";
import { notifyPacksFull, PACKS_FULL_JOB } from "./economy.js";
import { GUILD_WEEKLY_JOB, weeklyJob } from "./guilds.js";
import { AUCTION_CLOSE_JOB, closeAuctionIfDue, sweepAuctions } from "./market.js";
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
  // Filet de sécurité : rattrape toute échéance manquée (redémarrage, job perdu).
  ctx.jobs.schedule("market-sweep", "* * * * *", async () => {
    await sweepAuctions(ctx);
    await sweepTrades(ctx);
    await sweepBattles(ctx);
  });
}
