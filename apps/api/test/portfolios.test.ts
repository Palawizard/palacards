import { eq, schema, sql } from "@palacards/db";
import { ECONOMY, PORTFOLIO_MAX, PORTFOLIO_PRICES, PORTFOLIO_SHARED_MAX_PLAYERS } from "@palacards/game";
import { afterAll, describe, expect, it } from "vitest";
import { makeApp, signUp, signUpAdmin, type Client } from "./helpers.js";

const { app, ctx } = await makeApp();
afterAll(() => app.close());

const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAACgAAAAeCAIAAADRv8uKAAAALklEQVR4nO3NMQEAMAgAoLk0ZjKxsazg5wMFiM56F/7JKhaLxWKxWCwWi8XilQH91QGGD5y0UgAAAABJRU5ErkJggg==";

/** Joueur avec un paquet ouvert ; renvoie ses exemplaires. */
async function withCards(p: Client): Promise<number[]> {
  const opened = await p.post("/packs/open");
  return opened.body.cards.map((c: { instanceId: number }) => c.instanceId);
}
async function create(p: Client, name = "Mes favorites") {
  const res = await p.post("/portfolios", { name });
  expect(res.status).toBe(200);
  return res.body.id as number;
}
async function givePw(p: Client, amount: number) {
  await p.post("/test/grant-pw", { amount });
}

describe("portfolios (suggestions n° 3 et 116)", () => {
  it("crée un portfolio de cartes possédées, en ordre, avec une carte en vedette", async () => {
    const p = await signUp(app);
    const [a, b, c] = await withCards(p);
    const id = await create(p);
    const res = await p.put(`/portfolios/${id}/cards`, {
      cards: [{ instanceId: c }, { instanceId: a, featured: true }, { instanceId: b, featured: true }],
    });
    expect(res.status).toBe(200);
    expect(res.body.cards.map((x: { instanceId: number; featured: boolean }) => [x.instanceId, x.featured])).toEqual([
      [c, false],
      [a, true],
      [b, false],
    ]);
    // Aperçu : la carte en vedette d'abord.
    expect(res.body.preview[0].instanceId).toBe(a);
    // Une carte d'un autre joueur est refusée ; une même carte peut aller dans plusieurs portfolios.
    const other = await signUp(app);
    const [theirs] = await withCards(other);
    expect((await p.put(`/portfolios/${id}/cards`, { cards: [{ instanceId: theirs }] })).status).toBe(404);
    const second = await create(p, "Deuxième");
    expect((await p.put(`/portfolios/${second}/cards`, { cards: [{ instanceId: a }] })).status).toBe(200);
    expect((await p.put(`/portfolios/${id}/cards`, { cards: [{ instanceId: a }, { instanceId: a }] })).status).toBe(
      400,
    );
  });

  it("limite à 30 cartes et au garde-fou de portfolios", async () => {
    const p = await signUp(app);
    const id = await create(p);
    const many = Array.from({ length: 31 }, (_, i) => ({ instanceId: i + 1 }));
    expect((await p.put(`/portfolios/${id}/cards`, { cards: many })).status).toBe(400);
    await ctx.db
      .insert(schema.portfolios)
      .values(Array.from({ length: PORTFOLIO_MAX - 1 }, (_, i) => ({ userId: p.userId, name: `P${i}` })));
    const refused = await p.post("/portfolios", { name: "Un de trop" });
    expect(refused.body.error).toBe("portfolio_limit");
  });

  it("retire proprement une carte recyclée, fusionnée, upgradée, vendue ou échangée", async () => {
    const p = await signUp(app);
    const buyer = await signUp(app);
    const cards = await withCards(p);
    const [recycled, fused, upgraded, sold, traded, kept] = cards;
    const id = await create(p);
    const other = await create(p, "Autre");
    const all = cards.slice(0, 6).map((instanceId) => ({ instanceId }));
    await p.put(`/portfolios/${id}/cards`, { cards: all });
    await p.put(`/portfolios/${other}/cards`, { cards: all });

    expect((await p.post("/collection/recycle", { instanceIds: [recycled] })).status).toBe(200);
    const [row] = await ctx.db.select().from(schema.cardInstances).where(eq(schema.cardInstances.id, fused!));
    const copy = await p.post("/test/grant-card", { cardId: row!.cardId, count: 1 });
    await ctx.db
      .update(schema.cardInstances)
      .set({ level: 2 })
      .where(eq(schema.cardInstances.id, copy.body.instanceIds[0]));
    expect((await p.post(`/collection/${copy.body.instanceIds[0]}/fuse`, { sourceId: fused })).status).toBe(200);
    await ctx.db.update(schema.cardInstances).set({ rarity: "C" }).where(eq(schema.cardInstances.id, upgraded!));
    expect((await p.post("/upgrade", { instanceIds: [upgraded] })).status).toBe(200);
    const listed = await p.post("/market", { instanceId: sold, startPrice: 5, buyout: 10, durationMs: 3_600_000 });
    expect((await buyer.post(`/market/${listed.body.id}/buy`)).status).toBe(200);
    const trade = await p.post("/trades", { to: buyer.username, give: [traded] });
    expect((await buyer.post(`/trades/${trade.body.id}/accept`)).status).toBe(200);

    for (const pid of [id, other]) {
      const left = (await p.get(`/portfolios/${pid}`)).body.cards.map((c: { instanceId: number }) => c.instanceId);
      expect(left).toEqual([kept]);
    }
    const [{ n }] = (await ctx.db.execute<{ n: number }>(
      sql`select count(*)::int as n from portfolio_cards where portfolio_id in (${id}, ${other})`,
    )) as unknown as [{ n: number }];
    expect(n).toBe(2);
  });

  it("affiche jusqu'à trois portfolios sur le profil, dans l'ordre choisi", async () => {
    const p = await signUp(app);
    const [card] = await withCards(p);
    const ids = [await create(p, "Un"), await create(p, "Deux"), await create(p, "Trois"), await create(p, "Quatre")];
    for (const id of ids) await p.put(`/portfolios/${id}/cards`, { cards: [{ instanceId: card }] });
    expect((await p.put("/portfolios/profile", { ids })).status).toBe(400);
    expect((await p.put("/portfolios/profile", { ids: [ids[2], ids[0], ids[3]] })).status).toBe(200);
    const visitor = await signUp(app);
    const shown = (await visitor.get(`/players/${p.username}/portfolios`)).body;
    expect(shown.map((s: { name: string }) => s.name)).toEqual(["Trois", "Un", "Quatre"]);
    // Un portfolio vide n'est pas public.
    const empty = await create(p, "Vide");
    expect((await visitor.get(`/portfolios/${empty}`)).status).toBe(404);
    expect((await p.get(`/portfolios/${empty}`)).status).toBe(200);
  });

  it("compte un like par joueur, jamais sur les siens, et trie la page Communauté", async () => {
    const p = await signUp(app);
    const [card] = await withCards(p);
    const id = await create(p, "Aimé");
    await p.put(`/portfolios/${id}/cards`, { cards: [{ instanceId: card }] });
    const fan = await signUp(app);
    const fan2 = await signUp(app);
    expect((await p.post(`/portfolios/${id}/like`)).status).toBe(403);
    expect((await fan.post(`/portfolios/${id}/like`)).body).toEqual({ likes: 1, liked: true });
    expect((await fan.post(`/portfolios/${id}/like`)).body.likes).toBe(1);
    expect((await fan2.post(`/portfolios/${id}/like`)).body.likes).toBe(2);
    expect((await fan2.del(`/portfolios/${id}/like`)).body).toEqual({ likes: 1, liked: false });
    const top = (await fan.get("/portfolios?sort=likes")).body.items;
    expect(top[0]).toMatchObject({ id, likes: 1, liked: true, mine: false });
    const recent = (await fan.get("/portfolios?sort=recent")).body.items;
    expect(recent.some((r: { id: number }) => r.id === id)).toBe(true);
  });

  it("vend les designs en PW, accorde ceux d'un succès, et refuse ceux qu'on n'a pas", async () => {
    const p = await signUp(app);
    const id = await create(p);
    expect((await p.patch(`/portfolios/${id}`, { background: "marbre" })).status).toBe(403);
    expect(
      (await p.patch(`/portfolios/${id}`, { background: "ardoise", frame: "pointilles", accent: "azur" })).status,
    ).toBe(200);
    await givePw(p, 1_000);
    const before = (await p.get("/me")).body.wallet.balance;
    expect((await p.post("/portfolios/designs/marbre/buy")).status).toBe(200);
    expect((await p.get("/me")).body.wallet.balance).toBe(before - PORTFOLIO_PRICES.background);
    expect((await p.post("/portfolios/designs/marbre/buy")).body.error).toBe("design_owned");
    expect((await p.post("/portfolios/designs/prisme/buy")).body.error).toBe("design_not_for_sale");
    expect((await p.patch(`/portfolios/${id}`, { background: "marbre" })).body.design.background).toBe("marbre");
    // Succès « Brillantes » palier I : le fond Prisme est à lui.
    await ctx.db.insert(schema.achievementsProgress).values({
      userId: p.userId,
      achievementKey: "shiny_1",
      progress: 1,
      unlockedAt: new Date(),
    });
    const catalog = (await p.get("/portfolios/designs")).body;
    expect(catalog.find((d: { key: string }) => d.key === "prisme").owned).toBe(true);
    expect(catalog.find((d: { key: string }) => d.key === "galaxie")).toMatchObject({ owned: false, price: 1_500 });
    expect(ECONOMY.startingBalance).toBeGreaterThan(0);
  });

  it("accepte une image de fond sur le modèle des bannières, supprimable depuis Admin", async () => {
    const p = await signUp(app);
    const admin = await signUpAdmin(app, ctx);
    const id = await create(p);
    expect(
      (await p.put(`/portfolios/${id}/background`, { image: Buffer.from("<svg/>").toString("base64") })).status,
    ).toBe(400);
    expect((await p.put(`/portfolios/${id}/background`, { image: PNG })).status).toBe(200);
    expect((await p.get(`/portfolios/${id}`)).body.design).toMatchObject({ background: "image" });
    const img = await app.inject({
      method: "GET",
      url: `/palacards/api/portfolios/${id}/background`,
      headers: { cookie: p.cookie },
    });
    expect(img.headers["content-type"]).toBe("image/png");
    const listed = (await admin.get("/admin/portfolio-backgrounds")).body;
    expect(listed.some((b: { portfolioId: number }) => b.portfolioId === id)).toBe(true);
    expect((await p.del(`/admin/portfolio-backgrounds/${id}`)).status).toBe(403);
    expect((await admin.del(`/admin/portfolio-backgrounds/${id}`)).status).toBe(200);
    expect((await p.get(`/portfolios/${id}`)).body.design.background).toBe("papier");
  });

  it("figure dans l'export RGPD", async () => {
    const p = await signUp(app);
    const [card] = await withCards(p);
    const id = await create(p);
    await p.put(`/portfolios/${id}/cards`, { cards: [{ instanceId: card }] });
    const exported = (await p.get("/me/export")).body;
    expect(exported.portfolios[0]).toMatchObject({ id, name: "Mes favorites" });
    expect(exported.portfolioCards).toEqual([expect.objectContaining({ portfolioId: id, instanceId: card })]);
  });
});

describe("portfolios partagés (suggestion n° 125)", () => {
  async function befriend(a: Client, b: Client) {
    await a.post("/friends", { username: b.username });
    await b.post("/friends", { username: a.username });
  }
  const ids = (body: { cards: { instanceId: number }[] }) => body.cards.map((c) => c.instanceId);

  it("invite un ami, qui y pose ses propres cartes sans qu'aucune change de main", async () => {
    const owner = await signUp(app);
    const friend = await signUp(app);
    const stranger = await signUp(app);
    await befriend(owner, friend);
    const [o1] = await withCards(owner);
    const [f1, f2] = await withCards(friend);
    const id = await create(owner, "À deux");
    await owner.put(`/portfolios/${id}/cards`, { cards: [{ instanceId: o1 }] });

    // Seuls les amis peuvent être invités ; l'invité est prévenu et voit l'invitation.
    expect((await owner.post(`/portfolios/${id}/members`, { username: stranger.username })).status).toBe(403);
    const invited = await owner.post(`/portfolios/${id}/members`, { username: friend.username });
    expect(invited.status).toBe(200);
    expect(invited.body.invited.map((m: { username: string }) => m.username)).toEqual([friend.username]);
    expect((await owner.post(`/portfolios/${id}/members`, { username: friend.username })).status).toBe(409);
    expect((await friend.get("/notifications")).body.items[0].type).toBe("portfolio_invite");
    const invitations = await friend.get("/portfolios/invitations");
    expect(invitations.body.map((p: { id: number; role: string }) => [p.id, p.role])).toEqual([[id, "invited"]]);

    // Pas encore participant : il ne peut rien y poser.
    expect((await friend.put(`/portfolios/${id}/cards`, { cards: [{ instanceId: o1 }] })).status).toBe(403);
    const joined = await friend.post(`/portfolios/${id}/join`);
    expect(joined.body.role).toBe("member");
    expect(joined.body.invited).toEqual([]);
    expect((await owner.get("/notifications")).body.items[0].type).toBe("portfolio_joined");
    expect((await friend.get("/portfolios/mine")).body.map((p: { id: number }) => p.id)).toContain(id);

    // L'ami ajoute ses cartes ; celle d'un autre est refusée, comme le retrait d'une carte qui n'est pas à lui.
    const added = await friend.put(`/portfolios/${id}/cards`, {
      cards: [{ instanceId: f1 }, { instanceId: o1 }, { instanceId: f2, featured: true }],
    });
    expect(added.status).toBe(200);
    expect(added.body.cards.map((c: { by: string }) => c.by)).toEqual([
      friend.username,
      owner.username,
      friend.username,
    ]);
    const [s1] = await withCards(stranger);
    expect(
      (await friend.put(`/portfolios/${id}/cards`, { cards: [...added.body.cards, { instanceId: s1 }] })).status,
    ).toBe(404);
    expect((await friend.put(`/portfolios/${id}/cards`, { cards: [{ instanceId: f1 }] })).status).toBe(403);
    // Il ne touche ni au nom ni au design, et n'aime pas un portfolio auquel il participe.
    expect((await friend.patch(`/portfolios/${id}`, { name: "Volé" })).status).toBe(403);
    expect((await friend.post(`/portfolios/${id}/like`)).status).toBe(403);
    const [row] = await ctx.db.select().from(schema.cardInstances).where(eq(schema.cardInstances.id, f1!));
    expect(row!.ownerId).toBe(friend.userId);

    // Le propriétaire peut retirer la carte de son ami ; l'ami retire la sienne.
    const trimmed = await owner.put(`/portfolios/${id}/cards`, { cards: [{ instanceId: o1 }, { instanceId: f2 }] });
    expect(ids(trimmed.body)).toEqual([o1, f2]);

    // Révocation : l'ami perd l'accès et ses cartes quittent le portfolio (elles restent à lui).
    expect((await owner.del(`/portfolios/${id}/members/${friend.username}`)).status).toBe(200);
    expect(ids((await owner.get(`/portfolios/${id}`)).body)).toEqual([o1]);
    expect((await friend.put(`/portfolios/${id}/cards`, { cards: [{ instanceId: o1 }] })).status).toBe(403);
    expect((await friend.get("/portfolios/mine")).body.map((p: { id: number }) => p.id)).not.toContain(id);
  });

  it("limite à 5 joueurs, laisse partir un participant et retire les anciens amis", async () => {
    const owner = await signUp(app);
    const id = await create(owner);
    const friends: Client[] = [];
    for (let i = 0; i < PORTFOLIO_SHARED_MAX_PLAYERS; i++) {
      const f = await signUp(app);
      await befriend(owner, f);
      friends.push(f);
    }
    for (const f of friends.slice(0, PORTFOLIO_SHARED_MAX_PLAYERS - 1))
      expect((await owner.post(`/portfolios/${id}/members`, { username: f.username })).status).toBe(200);
    const full = await owner.post(`/portfolios/${id}/members`, { username: friends.at(-1)!.username });
    expect(full.body.error).toBe("portfolio_members_full");

    // Un invité refuse (ou un participant part) : il se retire lui-même ; il ne retire pas les autres.
    const [a, b, c] = friends;
    expect((await a!.del(`/portfolios/${id}/members/${a!.username}`)).status).toBe(200);
    expect((await b!.del(`/portfolios/${id}/members/${c!.username}`)).status).toBe(403);
    await b!.post(`/portfolios/${id}/join`);
    const [card] = await withCards(b!);
    await b!.put(`/portfolios/${id}/cards`, { cards: [{ instanceId: card }] });
    expect((await owner.get(`/portfolios/${id}`)).body.cardCount).toBe(1);

    // Plus amis : il quitte le portfolio, avec ses cartes.
    expect((await owner.del(`/friends/${b!.userId}`)).status).toBe(200);
    const after = await owner.get(`/portfolios/${id}`);
    expect(after.body.members).toEqual([]);
    expect(after.body.cardCount).toBe(0);
  });

  it("cache aux autres un portfolio réservé à ses participants", async () => {
    const owner = await signUp(app);
    const friend = await signUp(app);
    const visitor = await signUp(app);
    await befriend(owner, friend);
    const [card] = await withCards(owner);
    const id = await create(owner, "Entre nous");
    await owner.put(`/portfolios/${id}/cards`, { cards: [{ instanceId: card }] });
    await owner.put("/portfolios/profile", { ids: [id] });
    await owner.post(`/portfolios/${id}/members`, { username: friend.username });
    expect((await visitor.get(`/portfolios/${id}`)).status).toBe(200);

    const hidden = await owner.patch(`/portfolios/${id}`, { visibility: "members" });
    expect(hidden.body.visibility).toBe("members");
    expect(hidden.body.profileSlot).toBeNull();
    expect((await visitor.get(`/portfolios/${id}`)).status).toBe(404);
    expect((await visitor.post(`/portfolios/${id}/like`)).status).toBe(404);
    expect((await visitor.get(`/players/${owner.username}/portfolios`)).body).toEqual([]);
    const community = await visitor.get("/portfolios");
    expect(community.body.items.map((p: { id: number }) => p.id)).not.toContain(id);
    expect((await owner.put("/portfolios/profile", { ids: [id] })).status).toBe(404);
    // L'invité le voit, pour décider.
    expect((await friend.get(`/portfolios/${id}`)).status).toBe(200);
  });
});
