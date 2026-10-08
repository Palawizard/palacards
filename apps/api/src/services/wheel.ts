import { eq, schema } from "@palacards/db";
import {
  parisDay,
  rollShiny,
  rollCondition,
  rollWheel,
  WHEEL_GAP_MS,
  WHEEL_THEME_FALLBACK_PACKS,
  WHEEL_TIERS,
  WHEELS,
  wheelSchedule,
  type WheelSchedule,
} from "@palacards/game";
import type { WheelDTO, WheelFaceDTO, WheelPrizeDTO, WheelSpinDTO } from "@palacards/shared";
import type { Ctx } from "../context.js";
import { conflict } from "../errors.js";
import { instancesByIds, loadMediaInBackground } from "./cards.js";
import { announcePulls, logPulls } from "./feed.js";
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
import { addThemePacks, endingSoonestTheme } from "./themes.js";

type Player = Awaited<ReturnType<typeof getPlayer>>;

/** Prochain minuit à Paris (début du jour suivant `parisDay(now)`). */
export function nextParisMidnight(now: Date): Date {
  const today = parisDay(now);
  // On avance d'heure en heure jusqu'au changement de jour : robuste aux passages heure d'été / d'hiver.
  let t = Math.ceil(now.getTime() / 3_600_000) * 3_600_000;
  while (parisDay(new Date(t)) === today) t += 3_600_000;
  // Minuit de Paris tombe toujours sur une heure pile UTC (fuseau à +1 ou +2 h).
  return new Date(t);
}

/** Où en est le joueur dans ses roues du jour. */
export function playerWheelSchedule(p: Pick<Player, "lastWheelDay" | "wheelStep" | "wheelLastAt">, now: Date) {
  return wheelSchedule(
    { day: p.lastWheelDay, opened: p.wheelStep, lastAt: p.wheelLastAt },
    now,
    parisDay(now),
    nextParisMidnight(now),
  );
}

function wheelDTO(schedule: WheelSchedule, now: Date, theme: WheelDTO["theme"]): WheelDTO {
  const wheels: WheelFaceDTO[] = WHEEL_TIERS.map((tier, i) => ({
    tier,
    status:
      i < schedule.opened
        ? "done"
        : i > schedule.opened
          ? schedule.missed
            ? "missed"
            : "locked"
          : schedule.missed
            ? "missed"
            : schedule.ready
              ? "ready"
              : "waiting",
    availableAt: i === schedule.opened && schedule.availableAt ? schedule.availableAt.toISOString() : null,
    segments: WHEELS[tier].map((s) => ({ reward: s.reward, weight: s.weight })),
  }));
  return {
    wheels,
    next: schedule.next,
    ready: schedule.ready,
    availableAt: schedule.availableAt?.toISOString() ?? null,
    missed: schedule.missed,
    resetAt: nextParisMidnight(now).toISOString(),
    gapMinutes: WHEEL_GAP_MS / 60_000,
    theme,
  };
}

export async function wheelState(ctx: Ctx, userId: string): Promise<WheelDTO> {
  const now = ctx.now();
  const p = await getPlayer(ctx.db, userId);
  return wheelDTO(playerWheelSchedule(p, now), now, await endingSoonestTheme(ctx.db, now));
}

async function addBonusPacks(tx: Parameters<typeof logMovement>[0], p: Player, amount: number, ref: string) {
  const bonusPacks = p.bonusPacks + amount;
  await tx.update(schema.players).set({ bonusPacks }).where(eq(schema.players.userId, p.userId));
  await logMovement(tx, p.userId, "bonus_pack", amount, bonusPacks, "wheel", ref);
  p.bonusPacks = bonusPacks;
}

/**
 * Tourne la prochaine roue du jour (petite, puis moyenne 2 h 30 après, puis grande 2 h 30 après) : PW,
 * paquets bonus, boosters à thème ou une UR / légendaire de la saison active. L'avancement est écrit dans
 * la même transaction que le gain : jamais deux fois la même roue.
 */
export async function spinWheel(ctx: Ctx, userId: string): Promise<WheelSpinDTO> {
  const now = ctx.now();
  const today = parisDay(now);
  const res = await ctx.db.transaction(async (tx) => {
    const p = await lockPlayer(tx, userId);
    const schedule = playerWheelSchedule(p, now);
    if (!schedule.next) throw conflict("wheel_used", "Tu as tourné les trois roues aujourd'hui. Reviens demain !");
    if (schedule.missed)
      throw conflict("wheel_too_late", "Cette roue ne sera plus prête avant minuit : reviens demain dès minuit.");
    if (!schedule.ready) throw conflict("wheel_not_ready", "Cette roue n'est pas encore prête.");
    const tier = schedule.next;
    const step = schedule.opened + 1;
    await tx
      .update(schema.players)
      .set({ lastWheelDay: today, wheelStep: step, wheelLastAt: now })
      .where(eq(schema.players.userId, userId));
    p.lastWheelDay = today;
    p.wheelStep = step;
    p.wheelLastAt = now;

    const segment = rollWheel(tier, ctx.random);
    const reward = WHEELS[tier][segment]!.reward;
    const ref = `wheel:${today}:${tier}`;
    let prize: WheelPrizeDTO;
    let instanceId: number | null = null;
    let drawn: Awaited<ReturnType<typeof drawCard>> | null = null;
    let notable: number[] = [];
    if (reward.kind === "pw") {
      await movePw(tx, p, reward.amount, "wheel", ref);
      prize = reward;
    } else if (reward.kind === "packs") {
      await addBonusPacks(tx, p, reward.amount, ref);
      prize = reward;
    } else if (reward.kind === "theme") {
      const theme = await endingSoonestTheme(tx, now);
      if (theme) {
        await addThemePacks(tx, userId, theme.id, reward.amount, "wheel", ref);
        prize = { kind: "theme", amount: reward.amount, themeId: theme.id, themeName: theme.name };
      } else {
        const amount = reward.amount * WHEEL_THEME_FALLBACK_PACKS;
        await addBonusPacks(tx, p, amount, ref);
        prize = { kind: "packs", amount };
      }
    } else {
      const season = await activeSeason(tx);
      drawn = await drawCard(tx, season, reward.rarity, ctx.random);
      const shiny = rollShiny(ctx.random);
      const condition = rollCondition(ctx.random);
      const [row] = await tx
        .insert(schema.cardInstances)
        .values({
          ownerId: userId,
          cardId: drawn.id,
          season,
          rarity: reward.rarity,
          atk: drawn.atk,
          def: drawn.def,
          shiny,
          condition,
          source: "wheel",
          obtainedAt: now,
        })
        .returning({ id: schema.cardInstances.id });
      instanceId = row!.id;
      await logMovement(tx, userId, "card", 1, await ownedCount(tx, userId), "wheel", ref);
      notable = await logPulls(tx, userId, "wheel", [
        { cardId: drawn.id, season, rarity: reward.rarity, shiny, title: drawn.title },
      ]);
      prize = reward;
    }
    return { tier, segment, reward, prize, instanceId, drawn, notable, player: p };
  });

  const card = res.instanceId ? ((await instancesByIds(ctx.db, [res.instanceId], userId))[0] ?? null) : null;
  const packs = packState(res.player, now);
  await afterCommit(ctx, async () => {
    pushWallet(ctx, res.player);
    ctx.rt.toUser(userId, "packs:update", packs);
    void emit(ctx, userId, { type: "wheel_spun" }, ...(res.drawn ? (["collection"] as const) : []));
    if (res.drawn) {
      loadMediaInBackground(ctx, userId, [{ cardId: res.drawn.id, title: res.drawn.title }]);
      await announcePulls(ctx, userId, res.notable);
    }
  });
  return {
    tier: res.tier,
    segment: res.segment,
    reward: res.reward,
    prize: res.prize,
    card,
    wallet: wallet(res.player),
    packs,
    wheel: wheelDTO(playerWheelSchedule(res.player, now), now, await endingSoonestTheme(ctx.db, now)),
  };
}
