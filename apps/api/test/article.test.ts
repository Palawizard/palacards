import { and, eq, schema, sql } from "@palacards/db";
import { ARTICLE_MAX_GUESSES, articleReward, parisDay } from "@palacards/game";
import { PNG } from "pngjs";
import { afterAll, describe, expect, it, vi } from "vitest";
import { dailyArticle } from "../src/services/article.js";
import { progressionIdle } from "../src/services/progression.js";
import { makeApp, signUp, type Client } from "./helpers.js";

const { app, ctx } = await makeApp();
afterAll(() => app.close());

const ledgerSum = async (userId: string, reason: string) => {
  const [row] = await ctx.db.execute<{ n: string }>(
    sql`select coalesce(sum(delta), 0) as n from ledger where user_id = ${userId} and kind = 'pw' and reason = ${reason}`,
  );
  return Number(row?.n ?? 0);
};

/** Articles proposables (Super rare ou mieux) autres que la réponse du jour. */
async function wrongCards(n: number): Promise<{ id: number; title: string }[]> {
  const a = await dailyArticle(ctx);
  const rows = await ctx.db.execute<{ id: string; title: string }>(sql`
    select id, title from cards where season = ${a.season} and rarity in ('SR', 'UR', 'L') and id <> ${a.cardId}
    order by id limit ${n}
  `);
  return rows.map((r) => ({ id: Number(r.id), title: r.title }));
}

/** Image de la réponse, octets bruts. */
async function image(p: Client) {
  const r = await app.inject({
    method: "GET",
    url: "/palacards/api/article/image",
    headers: { cookie: p.cookie, origin: "http://localhost:3000" },
  });
  return {
    status: r.statusCode,
    type: r.headers["content-type"],
    cache: r.headers["cache-control"],
    body: r.rawPayload,
  };
}

describe("article du jour : essais", () => {
  it("compare chaque essai à la réponse et paie selon le nombre d'essais", async () => {
    const p = await signUp(app);
    const start = (await p.get("/article")).body;
    expect(start.guesses).toEqual([]);
    expect(start.answer).toBeNull();
    expect(start.nextReward).toBe(100);
    expect(start.maxGuesses).toBe(ARTICLE_MAX_GUESSES);
    expect(start.stats).toBeNull();
    expect(start.hints).toEqual({ description: null, firstLetter: null });
    const [wrong] = await wrongCards(1);
    const res = await p.post("/article/guess", { cardId: wrong!.id });
    expect(res.status).toBe(200);
    expect(res.body.guesses).toHaveLength(1);
    const cells = res.body.guesses[0].cells;
    expect(Object.keys(cells).sort()).toEqual(["category", "country", "rarity", "type", "views", "year"]);
    // Sans Wikidata (tests) : pays et année inconnus, jamais comptés faux.
    expect(cells.country).toMatchObject({ value: "?", state: "unknown" });
    expect(res.body.nextReward).toBe(95);
    expect((await p.post("/article/guess", { cardId: wrong!.id })).status).toBe(409);

    const a = await dailyArticle(ctx);
    const done = await p.post("/article/guess", { cardId: a.cardId });
    expect(done.body).toMatchObject({ found: true, finished: true, reward: 95 });
    expect(done.body.answer.title).toBe(a.title);
    expect(done.body.guesses[1].cells.rarity.state).toBe("good");
    expect(done.body.share.split("\n")).toHaveLength(3);
    expect(done.body.share.split("\n")[0]).toMatch(/· 2\/8$/);
    expect(done.body.share).not.toContain(a.title);
    expect(done.body.stats.found).toBeGreaterThanOrEqual(1);
    expect(done.body.stats.distribution[1]).toBeGreaterThanOrEqual(1);
    expect(await ledgerSum(p.userId, "daily_article")).toBe(articleReward(2));
    expect((await p.post("/article/guess", { cardId: wrong!.id })).status).toBe(409);
    expect((await p.get("/me")).body.articleReady).toBe(false);
    await progressionIdle();
    const stats = await ctx.db.select().from(schema.playerStats).where(eq(schema.playerStats.userId, p.userId));
    expect(stats.find((s) => s.key === "articles_found")?.value).toBe(1);
  });

  it("refuse un article qui n'est pas dans le jeu (ou trop commun) et le texte libre", async () => {
    const p = await signUp(app);
    expect((await p.post("/article/guess", { cardId: 999_999_999 })).status).toBe(404);
    const [common] = await ctx.db.execute<{ id: string }>(sql`select id from cards where rarity = 'C' limit 1`);
    expect((await p.post("/article/guess", { cardId: Number(common!.id) })).status).toBe(404);
    expect((await p.post("/article/guess", { guess: "aa" })).status).toBe(400);
    expect((await p.get("/article")).body.guesses).toEqual([]);
  });

  it("dévoile les indices de secours et termine au huitième essai raté, sans gain", async () => {
    const p = await signUp(app);
    const a = await dailyArticle(ctx);
    await ctx.db
      .update(schema.dailyArticles)
      .set({ description: `tour métallique, symbole de ${a.title}` })
      .where(eq(schema.dailyArticles.day, a.day));
    const wrong = await wrongCards(ARTICLE_MAX_GUESSES);
    let last;
    for (let i = 0; i < ARTICLE_MAX_GUESSES; i++) {
      last = (await p.post("/article/guess", { cardId: wrong[i]!.id })).body;
      if (i === 2) expect(last.hints.description).toBeNull();
      if (i === 3) {
        expect(last.hints.description).toMatch(/^tour métallique/);
        expect(last.hints.description).not.toContain(a.title);
        expect(last.hints.firstLetter).toBeNull();
      }
      if (i === 5) expect(last.hints.firstLetter).toBe([...a.title][0]!.toUpperCase());
    }
    expect(last).toMatchObject({ found: false, finished: true, reward: 0 });
    expect(last.answer).not.toBeNull();
    expect(last.share.split("\n")[0]).toMatch(/X\/8$/);
    expect(await ledgerSum(p.userId, "daily_article")).toBe(0);
  });
});

describe("article du jour : autocomplétion", () => {
  it("cherche sans accents parmi les Super rares et mieux, les plus lus d'abord", async () => {
    const p = await signUp(app);
    const a = await dailyArticle(ctx);
    const [card] = await ctx.db.execute<{ id: string }>(
      sql`select id from cards where season = ${a.season} and rarity = 'UR' and id <> ${a.cardId} order by id limit 1`,
    );
    const [common] = await ctx.db.execute<{ id: string }>(
      sql`select id from cards where season = ${a.season} and rarity = 'C' order by id limit 1`,
    );
    await ctx.db.execute(
      sql`update cards set title = 'Éléphant de mer austral' where season = ${a.season} and id = ${Number(card!.id)}`,
    );
    await ctx.db.execute(
      sql`update cards set title = 'Éléphant de mer commun' where season = ${a.season} and id = ${Number(common!.id)}`,
    );
    // Accents et majuscules ignorés ; la carte commune n'est pas proposable.
    const res = await p.get(`/article/search?q=${encodeURIComponent("ELEPHANT DE M")}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ cardId: Number(card!.id), title: "Éléphant de mer austral", rarity: "UR" }]);
    // Milieu du titre, et plafond de 8 suggestions, toutes Super rares ou mieux.
    expect((await p.get(`/article/search?q=${encodeURIComponent("de mer aus")}`)).body).toHaveLength(1);
    const many = (await p.get(`/article/search?q=${encodeURIComponent("synthétique")}`)).body;
    expect(many).toHaveLength(8);
    for (const r of many) expect(["SR", "UR", "L"]).toContain(r.rarity);
    expect(many[0].rarity).toBe("L");
    expect((await p.get("/article/search?q=a")).body).toEqual([]);
  });
});

describe("article du jour : image pixelisée", () => {
  it("sert l'image réduite sans jamais exposer son URL avant la fin, puis l'image entière", async () => {
    const p = await signUp(app);
    const a = await dailyArticle(ctx);
    const url = "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Secret.png/320px-Secret.png";
    await ctx.db.update(schema.dailyArticles).set({ imageUrl: url }).where(eq(schema.dailyArticles.day, a.day));
    const src = new PNG({ width: 64, height: 48 });
    for (let i = 0; i < src.data.length; i += 4) src.data.set([200, (i / 4) % 256, 30, 255], i);
    const original = PNG.sync.write(src);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(
        async () => new Response(new Uint8Array(original), { headers: { "content-type": "image/png" } }),
      );
    try {
      const state = await p.get("/article");
      expect(state.body.image).toBe(true);
      expect(state.body.imageWidth).toBe(6);
      expect(JSON.stringify(state.body)).not.toContain("Secret");
      const first = await image(p);
      expect(first.status).toBe(200);
      expect(first.type).toBe("image/png");
      expect(first.cache).toContain("no-store");
      expect(PNG.sync.read(first.body).width).toBe(6);
      const [wrong] = await wrongCards(1);
      await p.post("/article/guess", { cardId: wrong!.id });
      expect(PNG.sync.read((await image(p)).body).width).toBe(8);
      await p.post("/article/guess", { cardId: a.cardId });
      const full = await image(p);
      expect(Buffer.compare(full.body, original)).toBe(0);
    } finally {
      fetchSpy.mockRestore();
      await ctx.db.update(schema.dailyArticles).set({ imageUrl: null }).where(eq(schema.dailyArticles.day, a.day));
    }
  });
});

describe("article du jour : jour de la mise à jour", () => {
  it("garde la partie finie de l'ancien format, fait jouer les autres au nouveau, sans double paiement", async () => {
    const day = "2099-03-03";
    const done = await signUp(app);
    const halfway = await signUp(app);
    const [card] = await ctx.db.execute<{ id: string; title: string; season: number }>(
      sql`select id, title, season from cards where rarity = 'L' order by id desc limit 1`,
    );
    await ctx.db.delete(schema.dailyArticles).where(eq(schema.dailyArticles.day, day));
    await ctx.db.insert(schema.dailyArticles).values({
      day,
      cardId: Number(card!.id),
      season: card!.season,
      title: card!.title,
      rarity: "L",
      clues: [{ kind: "description", label: "Ce que c'est", text: "▢▢▢" }],
    });
    await ctx.db.insert(schema.dailyGuesses).values([
      { userId: done.userId, day, guesses: ["Paris", card!.title], found: true, reward: 90, finishedAt: new Date() },
      { userId: halfway.userId, day, guesses: ["Paris"] },
    ]);
    const now = ctx.now;
    ctx.now = () => new Date("2099-03-03T12:00:00+01:00");
    try {
      const converted = await dailyArticle(ctx, day);
      expect(converted).toMatchObject({ format: 2, cardId: Number(card!.id) });
      expect(converted.attrs?.rarity).toBe("L");
      const old = (await done.get("/article")).body;
      expect(old).toMatchObject({ finished: true, found: true, reward: 90 });
      expect(old.legacy.guesses).toEqual(["Paris", card!.title]);
      expect((await done.post("/article/guess", { cardId: Number(card!.id) })).status).toBe(409);
      const fresh = (await halfway.get("/article")).body;
      expect(fresh).toMatchObject({ finished: false, guesses: [], legacy: null });
      const won = (await halfway.post("/article/guess", { cardId: Number(card!.id) })).body;
      expect(won).toMatchObject({ found: true, reward: articleReward(1) });
    } finally {
      ctx.now = now;
    }
    const [g] = await ctx.db
      .select()
      .from(schema.dailyGuesses)
      .where(and(eq(schema.dailyGuesses.userId, done.userId), eq(schema.dailyGuesses.day, day)));
    expect(g!.reward).toBe(90);
    expect(await ledgerSum(done.userId, "daily_article")).toBe(0);
    expect(parisDay(ctx.now())).not.toBe(day);
  });
});
