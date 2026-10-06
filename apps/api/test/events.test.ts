import { sql } from "@palacards/db";
import {
  upgradeCardsToCap,
  upgradeChance,
  upgradeRefund,
  WHEEL_GAP_MS,
  WHEELS,
  type Rarity,
  type WheelTier,
} from "@palacards/game";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { createTheme } from "../src/services/themes.js";
import { nextParisMidnight } from "../src/services/wheel.js";
import { cleanCategory, createWiki } from "../src/services/wiki.js";
import { makeApp, signUp, signUpAdmin, uniqueName, type Client } from "./helpers.js";

const { app, ctx } = await makeApp();
const secure = ctx.random;
const clock = ctx.now;
afterEach(() => {
  ctx.random = secure;
  ctx.now = clock;
});
afterAll(() => app.close());

/** Un article de la saison active de cette rareté. */
async function cardOf(rarity: Rarity, skip = 0): Promise<number> {
  const [row] = await ctx.db.execute<{ id: number }>(sql`
    select id::int as id from cards where season = (select id from seasons where status = 'active')
      and rarity = ${rarity}::rarity order by id offset ${skip} limit 1
  `);
  return row!.id;
}
async function grantCards(p: Client, rarity: Rarity, count: number): Promise<number[]> {
  const res = await p.post("/test/grant-card", { cardId: await cardOf(rarity), count });
  return res.body.instanceIds;
}
async function balance(p: Client): Promise<number> {
  return (await p.get("/me")).body.wallet.balance;
}
/** Le solde doit toujours être la somme des lignes de ledger en PW. */
async function expectLedgerConsistent(p: Client) {
  const [row] = await ctx.db.execute<{ sum: string; balance: string }>(sql`
    select coalesce((select sum(delta) from ledger where user_id = ${p.userId} and kind = 'pw'), 0) as sum,
           (select balance from players where user_id = ${p.userId}) as balance
  `);
  expect(Number(row!.sum)).toBe(Number(row!.balance));
}

describe("upgrader", () => {
  it("réussite : les cartes sont détruites et une carte de la rareté au-dessus arrive", async () => {
    const p = await signUp(app);
    const ids = await grantCards(p, "R", 4);
    ctx.random = () => 0;
    const res = await p.post("/upgrade", { instanceIds: ids });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, chance: upgradeChance("R", 4), roll: 0, refund: 0 });
    expect(res.body.card.rarity).toBe("SR");
    const [left] = await ctx.db.execute<{ n: number }>(
      sql`select count(*)::int as n from card_instances where id in (${sql.join(
        ids.map((i) => sql`${i}`),
        sql`, `,
      )})`,
    );
    expect(left!.n).toBe(0);
    const [src] = await ctx.db.execute<{ source: string }>(
      sql`select source from card_instances where id = ${res.body.card.instanceId}`,
    );
    expect(src!.source).toBe("upgrade");
  });

  it("échec : cartes perdues, un quart de leur valeur de recyclage rendu en PW", async () => {
    const p = await signUp(app);
    const ids = await grantCards(p, "UR", 3);
    const before = await balance(p);
    const chance = upgradeChance("UR", 3);
    // Tirage pile sur la chance : raté (réussite seulement en dessous).
    ctx.random = () => chance;
    const res = await p.post("/upgrade", { instanceIds: ids });
    expect(res.body).toMatchObject({
      success: false,
      chance,
      roll: chance,
      card: null,
      refund: upgradeRefund("UR", 3),
    });
    expect(res.body.refund).toBe(112);
    expect(await balance(p)).toBe(before + res.body.refund);
    await expectLedgerConsistent(p);
  });

  it("une seule carte suffit, avec une petite chance", async () => {
    const p = await signUp(app);
    const ids = await grantCards(p, "SR", 1);
    const chance = upgradeChance("SR", 1);
    ctx.random = (max) => (max === 10_000 ? chance - 1 : 0);
    const res = await p.post("/upgrade", { instanceIds: ids });
    expect(res.body).toMatchObject({ success: true, chance, roll: chance - 1 });
    expect(res.body.card.rarity).toBe("UR");
  });

  it("refuse les raretés mélangées, les légendaires, le mauvais nombre et les cartes des autres", async () => {
    const p = await signUp(app);
    const other = await signUp(app);
    const c = await grantCards(p, "C", 2);
    const pc = await grantCards(p, "PC", 1);
    expect((await p.post("/upgrade", { instanceIds: [...c, ...pc] })).body.error).toBe("mixed_rarities");
    expect((await p.post("/upgrade", { instanceIds: [] })).status).toBe(400);
    const eleven = await grantCards(p, "C", 11);
    expect((await p.post("/upgrade", { instanceIds: eleven })).status).toBe(400);
    const l = await grantCards(p, "L", 3);
    expect((await p.post("/upgrade", { instanceIds: l })).body.error).toBe("max_rarity");
    const theirs = await grantCards(other, "C", 3);
    expect((await p.post("/upgrade", { instanceIds: theirs })).status).toBe(404);
  });

  it("refuse une carte en vente", async () => {
    const p = await signUp(app);
    const ids = await grantCards(p, "C", 3);
    await p.post("/market", { instanceId: ids[0], startPrice: 5, buyout: null, durationMs: 3_600_000 });
    expect((await p.post("/upgrade", { instanceIds: ids })).body.error).toBe("card_locked");
  });
});

describe("upgrade en série", () => {
  it("upgrade les doublons par lots au plafond, sans toucher aux favoris, brillantes ni au meilleur exemplaire", async () => {
    const p = await signUp(app);
    const lot = upgradeCardsToCap("C")!;
    // La brillante est le meilleur exemplaire (gardé) ; avec le favori, il reste 2 lots pleins.
    const ids = await grantCards(p, "C", lot * 2 + 2);
    const [fav, shiny] = [ids[1]!, ids[2]!];
    await p.post(`/collection/${fav}/favorite`, { favorite: true });
    await ctx.db.execute(sql`update card_instances set shiny = true where id = ${shiny}`);

    const preview = (await p.get("/upgrade/series?rarity=C")).body;
    expect(preview).toMatchObject({ rarity: "C", target: "PC", available: lot * 2, cards: lot * 2 });
    expect(preview.lots).toEqual([
      { cards: lot, chance: upgradeChance("C", lot) },
      { cards: lot, chance: upgradeChance("C", lot) },
    ]);

    // Premier lot réussi (tirage 0), second raté (tirage 9 999).
    let call = 0;
    ctx.random = (max) => (max === 10_000 ? (call++ === 0 ? 0 : 9_999) : 0);
    const before = await balance(p);
    const run = await p.post("/upgrade/series", { rarity: "C" });
    expect(run.status).toBe(200);
    expect(run.body).toMatchObject({ successes: 1, remaining: 0, refund: upgradeRefund("C", lot) });
    expect(run.body.lots.map((l: { success: boolean }) => l.success)).toEqual([true, false]);
    expect(run.body.cards).toHaveLength(1);
    expect(run.body.cards[0]).toMatchObject({ rarity: "PC" });
    expect(await balance(p)).toBe(before + upgradeRefund("C", lot));

    const left = await ctx.db.execute<{ id: number }>(
      sql`select id::int as id from card_instances where owner_id = ${p.userId}
          and card_id = (select card_id from card_instances where id = ${fav})`,
    );
    expect(left.map((r) => r.id).sort((a, b) => a - b)).toEqual([fav, shiny].sort((a, b) => a - b));
    expect((await p.post("/upgrade/series", { rarity: "C" })).body.error).toBe("no_duplicates");
    expect((await p.get("/upgrade/series?rarity=L")).body.error).toBe("max_rarity");
    await expectLedgerConsistent(p);
  });

  it("avec la case cochée, prend aussi le dernier exemplaire de chaque carte (jamais les favoris)", async () => {
    const p = await signUp(app);
    const grant = async (skip: number, count: number) =>
      (await p.post("/test/grant-card", { cardId: await cardOf("C", skip), count })).body.instanceIds as number[];
    const a = await grant(0, 2);
    const b = await grant(1, 1);
    await grant(2, 1);
    const [fav] = await grant(3, 1);
    await p.post(`/collection/${fav}/favorite`, { favorite: true });

    // Sans la case : le seul doublon (un lot d'une carte). Trois articles n'ont plus qu'un exemplaire libre.
    const plain = (await p.get("/upgrade/series?rarity=C")).body;
    expect(plain).toMatchObject({ available: 1, duplicates: 1, singles: 3, singlesUsed: 0, cards: 1 });

    const all = (await p.get("/upgrade/series?rarity=C&singles=1")).body;
    expect(upgradeCardsToCap("C")).toBe(4);
    expect(all).toMatchObject({ available: 4, duplicates: 1, singles: 3, singlesUsed: 3, cards: 4 });
    expect(all.lots).toEqual([{ cards: 4, chance: upgradeChance("C", 4) }]);

    ctx.random = () => 0;
    const run = await p.post("/upgrade/series", { rarity: "C", singles: true });
    expect(run.status).toBe(200);
    expect(run.body).toMatchObject({ successes: 1, remaining: 0 });
    const left = await ctx.db.execute<{ id: number }>(
      sql`select id::int as id from card_instances where owner_id = ${p.userId} and rarity = 'C'`,
    );
    expect(left.map((r) => r.id)).toEqual([fav]);
    expect(a.concat(b).every((id) => !left.some((r) => r.id === id))).toBe(true);
    expect((await p.post("/upgrade/series", { rarity: "C", singles: true })).body.error).toBe("no_duplicates");
    await expectLedgerConsistent(p);
  });
});

describe("roues du jour", () => {
  /** Premier tirage aléatoire : la case `segment` de la roue `tier` ; les suivants : `then`. */
  function landOn(tier: WheelTier, segment: number, then: (max: number) => number = (max) => Math.floor(max / 2)) {
    const at = WHEELS[tier].slice(0, segment).reduce((a, s) => a + s.weight, 0);
    let first = true;
    ctx.random = (max) => (first ? ((first = false), at) : then(max));
  }
  const findSegment = (tier: WheelTier, test: (r: (typeof WHEELS)[WheelTier][number]["reward"]) => boolean) =>
    WHEELS[tier].findIndex((s) => test(s.reward));
  /** Midi à Paris, loin de minuit (le 2026-07-01 : heure d'été). */
  const noon = new Date("2026-07-01T10:00:00Z").getTime();

  it("petite, puis moyenne 2 h 30 après, puis grande 2 h 30 après, puis plus rien jusqu'à minuit", async () => {
    ctx.now = () => new Date(noon);
    const p = await signUp(app);
    expect((await p.get("/me")).body.wheelReady).toBe(true);
    const state = (await p.get("/wheel")).body;
    expect(state).toMatchObject({ next: "small", ready: true, missed: false, gapMinutes: 150 });
    expect(state.wheels.map((w: { status: string }) => w.status)).toEqual(["ready", "locked", "locked"]);

    const before = await balance(p);
    landOn("small", 0); // 100 PW
    const small = await p.post("/wheel/spin");
    expect(small.status).toBe(200);
    expect(small.body).toMatchObject({ tier: "small", segment: 0, prize: { kind: "pw", amount: 100 } });
    expect(await balance(p)).toBe(before + 100);
    expect(small.body.wheel).toMatchObject({ next: "medium", ready: false });
    expect(small.body.wheel.availableAt).toBe(new Date(noon + WHEEL_GAP_MS).toISOString());
    expect((await p.post("/wheel/spin")).body.error).toBe("wheel_not_ready");
    expect((await p.get("/me")).body.wheelReady).toBe(false);

    ctx.now = () => new Date(noon + WHEEL_GAP_MS - 1_000);
    expect((await p.post("/wheel/spin")).body.error).toBe("wheel_not_ready");
    ctx.now = () => new Date(noon + WHEEL_GAP_MS);
    expect((await p.get("/me")).body.wheelReady).toBe(true);
    landOn("medium", 0); // 200 PW
    expect((await p.post("/wheel/spin")).body).toMatchObject({ tier: "medium", prize: { kind: "pw", amount: 200 } });

    ctx.now = () => new Date(noon + 2 * WHEEL_GAP_MS);
    const packsAt = findSegment("large", (r) => r.kind === "packs");
    landOn("large", packsAt);
    const large = await p.post("/wheel/spin");
    expect(large.body).toMatchObject({ tier: "large", prize: WHEELS.large[packsAt]!.reward });
    expect(large.body.packs.bonus).toBe((WHEELS.large[packsAt]!.reward as { amount: number }).amount);
    expect(large.body.wheel.wheels.map((w: { status: string }) => w.status)).toEqual(["done", "done", "done"]);
    expect((await p.post("/wheel/spin")).body.error).toBe("wheel_used");

    // Le lendemain, tout repart de la petite roue.
    ctx.now = () => new Date(noon + 24 * 3_600_000);
    expect((await p.get("/wheel")).body).toMatchObject({ next: "small", ready: true });
    await expectLedgerConsistent(p);
  });

  it("une roue qui ne serait prête qu'après minuit est perdue pour la journée", async () => {
    const late = new Date("2026-07-01T20:30:00Z").getTime(); // 22 h 30 à Paris
    ctx.now = () => new Date(late);
    const p = await signUp(app);
    landOn("small", 0);
    await p.post("/wheel/spin");
    const state = (await p.get("/wheel")).body;
    expect(state).toMatchObject({ next: "medium", ready: false, missed: true });
    expect(state.wheels.map((w: { status: string }) => w.status)).toEqual(["done", "missed", "missed"]);
    expect((await p.post("/wheel/spin")).body.error).toBe("wheel_too_late");
    ctx.now = () => new Date(late + 2 * 3_600_000); // après minuit
    expect((await p.get("/wheel")).body).toMatchObject({ next: "small", ready: true });
  });

  it("donne un booster à thème en vente, ou deux paquets par booster s'il n'y en a aucun", async () => {
    // Un jour sans autre thème en vente (ceux des autres tests sont autour de l'heure réelle).
    const start = new Date("2026-06-10T08:00:00Z").getTime();
    ctx.now = () => new Date(start);
    const admin = await signUpAdmin(app, ctx);
    const titles = await ctx.db.execute<{ title: string }>(sql`
      select title from cards where season = (select id from seasons where status = 'active')
        and rarity in ('C', 'R') order by id desc limit 20
    `);
    const theme = await admin.post("/admin/themes", {
      name: `Thème ${uniqueName("roue")}`,
      titles: titles.map((t) => t.title),
      price: 200,
      startsAt: new Date(start - 60_000).toISOString(),
      endsAt: new Date(start + 2 * 86_400_000).toISOString(),
    });
    expect(theme.status).toBe(200);
    const themeAt = findSegment("medium", (r) => r.kind === "theme");

    const p = await signUp(app);
    landOn("small", 0);
    await p.post("/wheel/spin");
    ctx.now = () => new Date(start + WHEEL_GAP_MS + 1_000);
    expect((await p.get("/wheel")).body.theme).toMatchObject({ id: theme.body.id });
    landOn("medium", themeAt);
    const spin = await p.post("/wheel/spin");
    expect(spin.body.prize).toMatchObject({ kind: "theme", amount: 1 });
    const [stock] = await ctx.db.execute<{ count: number }>(
      sql`select count from player_theme_packs where user_id = ${p.userId} and theme_id = ${spin.body.prize.themeId}`,
    );
    expect(stock!.count).toBe(1);

    // Bien après la fin de tous les thèmes : deux paquets bonus par booster.
    const far = new Date("2031-03-03T10:00:00Z").getTime();
    ctx.now = () => new Date(far);
    const q = await signUp(app);
    landOn("small", 0);
    await q.post("/wheel/spin");
    ctx.now = () => new Date(far + 2 * WHEEL_GAP_MS);
    expect((await q.get("/wheel")).body.theme).toBeNull();
    landOn("medium", 0);
    await q.post("/wheel/spin");
    const largeTheme = findSegment("large", (r) => r.kind === "theme");
    ctx.now = () => new Date(far + 4 * WHEEL_GAP_MS);
    landOn("large", largeTheme);
    const fallback = await q.post("/wheel/spin");
    expect(fallback.body.prize).toEqual({ kind: "packs", amount: 4 });
    expect(fallback.body.packs.bonus).toBe(4);
    await expectLedgerConsistent(q);
  });

  it("peut donner une carte légendaire", async () => {
    ctx.now = () => new Date(noon);
    const p = await signUp(app);
    landOn(
      "small",
      findSegment("small", (r) => r.kind === "card" && r.rarity === "L"),
    );
    const spin = await p.post("/wheel/spin");
    expect(spin.body.card).toMatchObject({ rarity: "L" });
  });

  it("repart à minuit, heure de Paris", () => {
    expect(nextParisMidnight(new Date("2026-07-01T10:00:00Z")).toISOString()).toBe("2026-07-01T22:00:00.000Z");
    expect(nextParisMidnight(new Date("2026-01-15T23:30:00Z")).toISOString()).toBe("2026-01-16T23:00:00.000Z");
  });
});

describe("boosters à thème", () => {
  async function makeTheme(admin: Client, extra: Record<string, unknown> = {}) {
    const titles = await ctx.db.execute<{ title: string }>(sql`
      select title from cards where season = (select id from seasons where status = 'active')
        and rarity in ('C', 'R', 'SR') order by id desc limit 30
    `);
    return admin.post("/admin/themes", {
      name: `Thème ${uniqueName("t")}`,
      titles: titles.map((t) => t.title),
      price: 200,
      startsAt: new Date(Date.now() - 60_000).toISOString(),
      endsAt: new Date(Date.now() + 3_600_000).toISOString(),
      ...extra,
    });
  }

  it("l'admin crée un thème, le joueur l'achète en PW et tire des cartes du thème", async () => {
    const admin = await signUpAdmin(app, ctx);
    const created = await makeTheme(admin);
    expect(created.status).toBe(200);
    expect(created.body.cardCount).toBe(30);

    const p = await signUp(app);
    const list = await p.get("/themes");
    const theme = list.body.find((t: { id: number }) => t.id === created.body.id);
    expect(theme).toMatchObject({ onSale: true, owned: 0, price: 200, cardCount: 30 });
    expect(theme.preview.length).toBeGreaterThan(0);
    expect((await p.get("/me")).body.themesOnSale).toBeGreaterThan(0);

    // Sans stock ni achat : refusé.
    expect((await p.post("/packs/open", { themeId: created.body.id })).body.error).toBe("no_theme_packs");
    await p.post("/test/grant-pw", { amount: 500 });
    const before = await balance(p);
    const packsBefore = (await p.get("/me")).body.packs;
    const opened = await p.post("/packs/open", { themeId: created.body.id, buy: true });
    expect(opened.status).toBe(200);
    expect(opened.body.cards).toHaveLength(10);
    expect(opened.body.theme.id).toBe(created.body.id);
    expect(await balance(p)).toBe(before - 200);
    // Le stock de paquets gratuits n'est pas touché.
    expect((await p.get("/me")).body.packs.available).toBe(packsBefore.available);
    // Les cartes du thème viennent bien de sa liste.
    const inTheme = await ctx.db.execute<{ card_id: string }>(
      sql`select card_id from theme_cards where theme_id = ${created.body.id}`,
    );
    const pool = new Set(inTheme.map((r) => Number(r.card_id)));
    // Tous les articles du booster se parcourent dans le catalogue.
    const listed = await p.get(`/cards?theme=${created.body.id}&limit=100`);
    expect(listed.body.items).toHaveLength(30);
    for (const c of listed.body.items) expect(pool.has(c.cardId)).toBe(true);
    expect(opened.body.theme.themedCardIds.length).toBeGreaterThan(0);
    for (const id of opened.body.theme.themedCardIds) expect(pool.has(id)).toBe(true);

    // Boosters ouverts : compteur par édition, sur la page Paquets et sur le profil.
    expect(opened.body.theme.opened).toBe(1);
    const again = await p.post("/packs/open", { themeId: created.body.id, buy: true });
    expect(again.body.theme).toMatchObject({ opened: 2, owned: 0 });
    const after = (await p.get("/themes")).body.find((t: { id: number }) => t.id === created.body.id);
    expect(after).toMatchObject({ opened: 2, owned: 0 });
    const profile = (await p.get(`/players/${p.username}`)).body;
    expect(profile.themePacks).toEqual([{ id: created.body.id, name: created.body.name, opened: 2 }]);
    expect(profile.creator).toBe(false);
    expect((await p.get(`/players/${admin.username}`)).body).toMatchObject({ creator: true, themePacks: [] });
    await expectLedgerConsistent(p);
  });

  it("sans légendaire : articles L écartés du thème, tirage L remplacé par UR", async () => {
    const admin = await signUpAdmin(app, ctx);
    const titles = await ctx.db.execute<{ title: string }>(sql`
      (select title from cards where season = (select id from seasons where status = 'active') and rarity = 'L'
        order by id limit 2)
      union all
      (select title from cards where season = (select id from seasons where status = 'active') and rarity = 'UR'
        order by id limit 6)
    `);
    const created = await makeTheme(admin, { titles: titles.map((t) => t.title), price: 100, noLegendary: true });
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({ noLegendary: true, cardCount: 6, byRarity: { L: 0, UR: 6 } });
    const inAdmin = (await admin.get("/admin/themes")).body.find((t: { id: number }) => t.id === created.body.id);
    expect(inAdmin).toMatchObject({ noLegendary: true, price: 100 });

    const p = await signUp(app);
    const listed = (await p.get("/themes")).body.find((t: { id: number }) => t.id === created.body.id);
    expect(listed).toMatchObject({ noLegendary: true, price: 100 });
    await p.post("/test/grant-pw", { amount: 500 });
    // Tirage le plus bas partout : L sur un booster normal, UR du thème ici.
    ctx.random = () => 0;
    const opened = await p.post("/packs/open", { themeId: created.body.id, buy: true });
    expect(opened.status).toBe(200);
    expect(opened.body.cards.map((c: { rarity: Rarity }) => c.rarity)).toEqual(Array(10).fill("UR"));
    expect(opened.body.theme.themedCardIds).toHaveLength(10);
    await expectLedgerConsistent(p);
  });

  it("refuse l'achat hors période et un thème trop petit", async () => {
    const admin = await signUpAdmin(app, ctx);
    const later = await makeTheme(admin, {
      startsAt: new Date(Date.now() + 3_600_000).toISOString(),
      endsAt: new Date(Date.now() + 7_200_000).toISOString(),
    });
    const p = await signUp(app);
    await p.post("/test/grant-pw", { amount: 500 });
    expect((await p.post("/packs/open", { themeId: later.body.id, buy: true })).body.error).toBe("theme_not_on_sale");
    const tiny = await admin.post("/admin/themes", {
      name: "Minuscule",
      titles: ["Titre qui n'existe pas"],
      startsAt: new Date().toISOString(),
      endsAt: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(tiny.body.error).toBe("theme_too_small");
    // Un joueur n'accède pas à l'admin.
    expect((await p.post("/admin/themes", { name: "x" })).status).toBe(403);
  });

  it("réunit plusieurs catégories (et l'ancien champ `category`), avec un essai à blanc", async () => {
    const admin = await signUpAdmin(app, ctx);
    const pool = await ctx.db.execute<{ id: string }>(sql`
      select id from cards where season = (select id from seasons where status = 'active') order by id limit 12
    `);
    const ids = pool.map((r) => Number(r.id));
    const members: Record<string, number[]> = {
      "Chanteur français": ids.slice(0, 6),
      "Chanteuse française": ids.slice(6),
    };
    const spy = vi.spyOn(ctx.wiki, "categoryMembers").mockImplementation(async (c) => members[c] ?? []);
    try {
      const window = {
        startsAt: new Date(Date.now() - 60_000).toISOString(),
        endsAt: new Date(Date.now() + 3_600_000).toISOString(),
      };
      const dry = await createTheme(ctx, admin.userId, {
        name: "Essai",
        categories: ["Catégorie:Chanteur_français", "Chanteuse française"],
        depth: 1,
        titles: [],
        price: 250,
        startsAt: new Date(window.startsAt),
        endsAt: new Date(window.endsAt),
        dryRun: true,
      });
      expect(dry).toMatchObject({
        dryRun: true,
        cardCount: 12,
        categories: ["Chanteur français", "Chanteuse française"],
      });
      const [row] = await ctx.db.execute<{ n: number }>(
        sql`select count(*)::int as n from themes where name = 'Essai'`,
      );
      expect(row!.n).toBe(0);

      const created = await admin.post("/admin/themes", {
        name: `Voix ${uniqueName("v")}`,
        category: "Chanteur français",
        categories: ["Chanteuse française"],
        ...window,
      });
      expect(created.status).toBe(200);
      expect(created.body.cardCount).toBe(12);
      const listed = (await (await signUp(app)).get("/themes")).body.find(
        (t: { id: number }) => t.id === created.body.id,
      );
      expect(listed.categories).toEqual(["Chanteur français", "Chanteuse française"]);
      const inAdmin = (await admin.get("/admin/themes")).body.find((t: { id: number }) => t.id === created.body.id);
      expect(inAdmin.categories).toEqual(["Chanteur français", "Chanteuse française"]);
    } finally {
      spy.mockRestore();
    }
  });

  it("l'admin peut terminer un thème", async () => {
    const admin = await signUpAdmin(app, ctx);
    const t = await makeTheme(admin);
    expect((await admin.post(`/admin/themes/${t.body.id}/end`)).status).toBe(200);
    const listed = (await admin.get("/admin/themes")).body.find((x: { id: number }) => x.id === t.body.id);
    expect(listed.onSale).toBe(false);
  });
});

describe("catégorie Wikipédia", () => {
  it("nettoie la saisie (préfixe, URL, soulignés)", () => {
    expect(cleanCategory("Catégorie:Jeu_vidéo")).toBe("Jeu vidéo");
    expect(cleanCategory("https://fr.wikipedia.org/wiki/Cat%C3%A9gorie:Jeu_vid%C3%A9o")).toBe("Jeu vidéo");
    expect(cleanCategory("  Planète naine ")).toBe("Planète naine");
  });

  it("parcourt les sous-catégories jusqu'à la profondeur demandée, pages suivantes comprises", async () => {
    const wiki = createWiki(ctx.db, { ...ctx.config, WIKIMEDIA_DISABLED: false }, ctx.log);
    const calls: string[] = [];
    const fetchMock = vi.fn(async (url: URL) => {
      const cat = url.searchParams.get("cmtitle")!;
      const cont = url.searchParams.get("cmcontinue");
      calls.push(`${cat}${cont ? `@${cont}` : ""}`);
      const members: Record<string, { pageid: number; ns: number; title: string }[]> = {
        "Catégorie:Racine": cont
          ? [{ pageid: 2, ns: 0, title: "B" }]
          : [
              { pageid: 1, ns: 0, title: "A" },
              { pageid: 100, ns: 14, title: "Catégorie:Sous" },
            ],
        "Catégorie:Sous": [
          { pageid: 3, ns: 0, title: "C" },
          { pageid: 101, ns: 14, title: "Catégorie:Trop profond" },
        ],
      };
      return Response.json({
        query: { categorymembers: members[cat] ?? [{ pageid: 99, ns: 0, title: "Z" }] },
        ...(cat === "Catégorie:Racine" && !cont ? { continue: { cmcontinue: "p2" } } : {}),
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      expect((await wiki.categoryMembers("Racine", 1)).sort()).toEqual([1, 2, 3]);
      expect(calls).toEqual(["Catégorie:Racine", "Catégorie:Racine@p2", "Catégorie:Sous"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("codes promo", () => {
  it("donne PW, paquets bonus et boosters à thème, une fois par joueur", async () => {
    const admin = await signUpAdmin(app, ctx);
    const titles = await ctx.db.execute<{ title: string }>(
      sql`select title from cards where season = (select id from seasons where status = 'active') order by id desc limit 10`,
    );
    const theme = await admin.post("/admin/themes", {
      name: "Thème du code",
      titles: titles.map((t) => t.title),
      startsAt: new Date(Date.now() - 1000).toISOString(),
      endsAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    const code = `promo${Date.now().toString(36)}`;
    const created = await admin.post("/admin/codes", {
      code,
      pw: 40,
      packs: 2,
      themeId: theme.body.id,
      themePacks: 1,
      maxUses: 2,
    });
    expect(created.status).toBe(200);
    expect(created.body.code).toBe(code.toUpperCase());

    const p = await signUp(app);
    const before = await balance(p);
    const res = await p.post("/codes/redeem", { code: ` ${code} ` });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ pw: 40, packs: 2, themePacks: 1, theme: { id: theme.body.id } });
    expect(await balance(p)).toBe(before + 40);
    expect((await p.get("/me")).body.packs.bonus).toBe(2);
    expect((await p.post("/codes/redeem", { code })).body.error).toBe("code_used");
    // Le booster reçu s'ouvre sans payer.
    const owned = (await p.get("/themes")).body.find((t: { id: number }) => t.id === theme.body.id);
    expect(owned.owned).toBe(1);
    const opened = await p.post("/packs/open", { themeId: theme.body.id });
    expect(opened.status).toBe(200);
    expect(opened.body.theme.owned).toBe(0);
    expect(await balance(p)).toBe(before + 40);

    // Limite d'utilisations.
    await (await signUp(app)).post("/codes/redeem", { code });
    expect((await (await signUp(app)).post("/codes/redeem", { code })).body.error).toBe("code_exhausted");
    await expectLedgerConsistent(p);
  });

  it("refuse un code inconnu, expiré ou désactivé avec le même message", async () => {
    const admin = await signUpAdmin(app, ctx);
    const expired = `old${Date.now().toString(36)}`;
    await admin.post("/admin/codes", { code: expired, pw: 10, expiresAt: new Date(Date.now() - 1000).toISOString() });
    const off = `off${Date.now().toString(36)}`;
    await admin.post("/admin/codes", { code: off, pw: 10 });
    expect((await admin.post(`/admin/codes/${off}/disabled`, { disabled: true })).status).toBe(200);
    const p = await signUp(app);
    const messages = new Set<string>();
    for (const code of ["INCONNU123", expired, off, "é"]) {
      const res = await p.post("/codes/redeem", { code });
      expect(res.status).toBe(404);
      messages.add(res.body.message);
    }
    expect(messages.size).toBe(1);
    expect((await admin.post("/admin/codes", { code: off, pw: 5 })).body.error).toBe("code_taken");
    expect((await admin.post("/admin/codes", { code: "vide1", pw: 0 })).body.error).toBe("empty");
  });
});

describe("don admin à tous les joueurs", () => {
  it("pseudo * : chaque joueur reçoit les PW et paquets, avec une notification", async () => {
    const admin = await signUpAdmin(app, ctx);
    const a = await signUp(app);
    const b = await signUp(app);
    const [before] = await ctx.db.execute<{ n: number }>(sql`select count(*)::int as n from players`);
    const balA = await balance(a);
    const res = await admin.post("/admin/grant", { username: "*", pw: 30, packs: 1, note: "Merci !" });
    expect(res.status).toBe(200);
    expect(res.body.players).toBe(before!.n);
    expect(await balance(a)).toBe(balA + 30);
    expect((await b.get("/me")).body.packs.bonus).toBe(1);
    const notif = (await a.get("/notifications")).body.items.find((n: { type: string }) => n.type === "gift");
    expect(notif.payload).toMatchObject({ pw: 30, packs: 1, note: "Merci !" });
    await expectLedgerConsistent(a);
  });

  it("refuse les retraits sur tous les joueurs", async () => {
    const admin = await signUpAdmin(app, ctx);
    expect((await admin.post("/admin/grant", { username: "*", pw: -10 })).body.error).toBe("negative_gift");
  });
});
