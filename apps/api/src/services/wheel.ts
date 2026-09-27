import { eq, schema } from "@palacards/db";
import { parisDay, rollWheel, WHEEL_SEGMENTS } from "@palacards/game";
import type { WheelDTO, WheelSpinDTO } from "@palacards/shared";
import type { Ctx } from "../context.js";
import { conflict } from "../errors.js";
import { instancesByIds, loadMediaInBackground } from "./cards.js";
import { afterCommit } from "./notifications.js";
import { drawCard } from "./packs.js";
import {
  activeSeason,
  getPlayer,
  lockPlayer,
  logMovement,
  movePw,
  ownedCount,
  packState,
  pushWallet,
  wallet,
} from "./players.js";
import { emit } from "./progression.js";

/** Prochain minuit à Paris (début du jour suivant `parisDay(now)`). */
export function nextParisMidnight(now: Date): Date {
  const today = parisDay(now);
  // On avance d'heure en heure jusqu'au changement de jour : robuste aux passages heure d'été / d'hiver.
  let t = Math.ceil(now.getTime() / 3_600_000) * 3_600_000;
  while (parisDay(new Date(t)) === today) t += 3_600_000;
  // Minuit de Paris tombe toujours sur une heure pile UTC (fuseau à +1 ou +2 h).
  return new Date(t);
}

export async function wheelState(ctx: Ctx, userId: string): Promise<WheelDTO> {
  const p = await getPlayer(ctx.db, userId);
  const now = ctx.now();
  return {
    ready: p.lastWheelDay !== parisDay(now),
    nextAt: nextParisMidnight(now).toISOString(),
    segments: WHEEL_SEGMENTS.map((s) => ({ reward: s.reward, weight: s.weight })),
  };
}

/**
 * Tour de roue quotidien (jour calendaire de Paris) : PW, paquets bonus, ou une UR / légendaire
 * aléatoire de la saison active. Une seule fois par jour : le jour est écrit dans la même transaction.
 */
export async function spinWheel(ctx: Ctx, userId: string): Promise<WheelSpinDTO> {
  const now = ctx.now();
  const today = parisDay(now);
  const res = await ctx.db.transaction(async (tx) => {
    const p = await lockPlayer(tx, userId);
    if (p.lastWheelDay === today) throw conflict("wheel_used", "Tu as déjà tourné la roue aujourd'hui.");
    await tx.update(schema.players).set({ lastWheelDay: today }).where(eq(schema.players.userId, userId));
    p.lastWheelDay = today;

    const segment = rollWheel(ctx.random);
    const reward = WHEEL_SEGMENTS[segment]!.reward;
    const ref = `wheel:${today}`;
    let instanceId: number | null = null;
    let drawn: Awaited<ReturnType<typeof drawCard>> | null = null;
    if (reward.kind === "pw") {
      await movePw(tx, p, reward.amount, "wheel", ref);
    } else if (reward.kind === "packs") {
      const bonusPacks = p.bonusPacks + reward.amount;
      await tx.update(schema.players).set({ bonusPacks }).where(eq(schema.players.userId, userId));
      await logMovement(tx, userId, "bonus_pack", reward.amount, bonusPacks, "wheel", ref);
      p.bonusPacks = bonusPacks;
    } else {
      const season = await activeSeason(tx);
      drawn = await drawCard(tx, season, reward.rarity, ctx.random);
      const [row] = await tx
        .insert(schema.cardInstances)
        .values({
          ownerId: userId,
          cardId: drawn.id,
          season,
          rarity: reward.rarity,
          atk: drawn.atk,
          def: drawn.def,
          source: "wheel",
          obtainedAt: now,
        })
        .returning({ id: schema.cardInstances.id });
      instanceId = row!.id;
      await logMovement(tx, userId, "card", 1, await ownedCount(tx, userId), "wheel", ref);
    }
    return { segment, reward, instanceId, drawn, player: p };
  });

  const card = res.instanceId ? ((await instancesByIds(ctx.db, [res.instanceId], userId))[0] ?? null) : null;
  const packs = packState(res.player, now);
  await afterCommit(ctx, async () => {
    pushWallet(ctx, res.player);
    ctx.rt.toUser(userId, "packs:update", packs);
    if (res.drawn) {
      loadMediaInBackground(ctx, userId, [{ cardId: res.drawn.id, title: res.drawn.title }]);
      void emit(ctx, userId, "collection");
    }
  });
  return {
    segment: res.segment,
    reward: res.reward,
    card,
    wallet: wallet(res.player),
    packs,
    nextAt: nextParisMidnight(now).toISOString(),
  };
}
