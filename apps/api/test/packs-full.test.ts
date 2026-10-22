import { and, eq, schema, sql } from "@palacards/db";
import { MAX_STORED_PACKS } from "@palacards/game";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Ctx } from "../src/context.js";
import { notifyPacksFull } from "../src/services/economy.js";
import { makeApp, signUp, type Client } from "./helpers.js";

let app: Awaited<ReturnType<typeof makeApp>>["app"];
let ctx: Ctx;

beforeAll(async () => {
  ({ app, ctx } = await makeApp());
});

afterAll(async () => {
  await app.close();
});

async function packsFullCount(userId: string) {
  const [row] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.notifications)
    .where(and(eq(schema.notifications.userId, userId), eq(schema.notifications.type, "packs_full")));
  return row!.n;
}

/** Recule l'horloge du stock : le minuteur a eu le temps de le remplir (absence de deux jours). */
async function fastForward(userId: string) {
  await ctx.db
    .update(schema.players)
    .set({ packsUpdatedAt: sql`${schema.players.packsUpdatedAt} - interval '2 days'` })
    .where(eq(schema.players.userId, userId));
}

/** Ouvre un paquet du stock (le stock repasse sous le plafond), plus des paquets bonus (stock inchangé). */
async function openFreeThenBonus(p: Client, bonus: number) {
  await ctx.db.update(schema.players).set({ bonusPacks: bonus }).where(eq(schema.players.userId, p.userId));
  expect((await p.post("/packs/open")).status).toBe(200);
  // Stock vide : les ouvertures suivantes prennent les paquets bonus.
  await ctx.db
    .update(schema.players)
    .set({ packsStored: 0, packsUpdatedAt: new Date() })
    .where(eq(schema.players.userId, p.userId));
  for (let i = 0; i < bonus; i++) expect((await p.post("/packs/open")).body.usedBonus).toBe(true);
}

describe("notification « stock de paquets plein » (suggestion n° 106)", () => {
  it("une seule notification après une longue absence, même avec plusieurs jobs en attente", async () => {
    const p = await signUp(app);
    await openFreeThenBonus(p, 6);
    await fastForward(p.userId);
    // 7 jobs rattrapés d'un coup au redémarrage (1 par ouverture avant le correctif).
    for (let i = 0; i < 7; i++) await notifyPacksFull(ctx, p.userId);
    expect(await packsFullCount(p.userId)).toBe(1);
    expect((await p.get("/me")).body.packs.available).toBe(MAX_STORED_PACKS);
  });

  it("rien de nouveau tant que le stock n'a pas été utilisé puis rempli à nouveau", async () => {
    const p = await signUp(app);
    await openFreeThenBonus(p, 0);
    await fastForward(p.userId);
    await notifyPacksFull(ctx, p.userId);
    await notifyPacksFull(ctx, p.userId);
    expect(await packsFullCount(p.userId)).toBe(1);

    // Paquet du stock ouvert : plus plein, pas de notification tant que le minuteur n'a pas tout rempli.
    expect((await p.post("/packs/open")).status).toBe(200);
    await notifyPacksFull(ctx, p.userId);
    expect(await packsFullCount(p.userId)).toBe(1);

    await fastForward(p.userId);
    await notifyPacksFull(ctx, p.userId);
    expect(await packsFullCount(p.userId)).toBe(2);
  });

  it("5 requêtes concurrentes : une seule notification", async () => {
    const p = await signUp(app);
    await openFreeThenBonus(p, 0);
    await fastForward(p.userId);
    await Promise.all(Array.from({ length: 5 }, () => notifyPacksFull(ctx, p.userId)));
    expect(await packsFullCount(p.userId)).toBe(1);
  });
});
