import { sql } from "@palacards/db";
import { upgradeChance, upgradeRefund, WHEEL_SEGMENTS, type Rarity } from "@palacards/game";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { nextParisMidnight } from "../src/services/wheel.js";
import { cleanCategory, createWiki } from "../src/services/wiki.js";
import { makeApp, signUp, signUpAdmin, uniqueName, type Client } from "./helpers.js";

const { app, ctx } = await makeApp();
const secure = ctx.random;
afterEach(() => {
  ctx.random = secure;
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

describe("roue quotidienne", () => {
  it("un tour par jour, avec la récompense de la case tirée", async () => {
    const p = await signUp(app);
    expect((await p.get("/me")).body.wheelReady).toBe(true);
    const state = await p.get("/wheel");
    expect(state.body.ready).toBe(true);
    expect(state.body.segments).toHaveLength(WHEEL_SEGMENTS.length);

    const before = await balance(p);
    ctx.random = () => 0; // première case : 25 PW
    const spin = await p.post("/wheel/spin");
    expect(spin.status).toBe(200);
    expect(spin.body).toMatchObject({ segment: 0, reward: { kind: "pw", amount: 25 } });
    expect(await balance(p)).toBe(before + 25);
    expect((await p.post("/wheel/spin")).body.error).toBe("wheel_used");
    expect((await p.get("/me")).body.wheelReady).toBe(false);
    await expectLedgerConsistent(p);
  });

  it("donne des paquets bonus ou une carte légendaire", async () => {
    const packsAt = WHEEL_SEGMENTS.findIndex((s) => s.reward.kind === "packs");
    const legendAt = WHEEL_SEGMENTS.findIndex((s) => s.reward.kind === "card" && s.reward.rarity === "L");
    const start = (i: number) => WHEEL_SEGMENTS.slice(0, i).reduce((a, s) => a + s.weight, 0);

    const a = await signUp(app);
    ctx.random = () => start(packsAt);
    const spinA = await a.post("/wheel/spin");
    expect(spinA.body.packs.bonus).toBe((WHEEL_SEGMENTS[packsAt]!.reward as { amount: number }).amount);

    const b = await signUp(app);
    let first = true;
    // Premier appel : la case ; les suivants : le tirage de l'article.
    ctx.random = (max) => (first ? ((first = false), start(legendAt)) : Math.floor(max / 2));
    const spinB = await b.post("/wheel/spin");
    expect(spinB.body.card).toMatchObject({ rarity: "L" });
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
    expect(opened.body.theme.themedCardIds.length).toBeGreaterThan(0);
    for (const id of opened.body.theme.themedCardIds) expect(pool.has(id)).toBe(true);
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
