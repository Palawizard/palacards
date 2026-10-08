import { eq, inArray, schema, sql } from "@palacards/db";
import { MAX_LEVEL, recycleValue } from "@palacards/game";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { progressionIdle } from "../src/services/progression.js";
import { makeApp, signUp, type Client } from "./helpers.js";

const { app, ctx } = await makeApp();
afterAll(() => app.close());

const ci = schema.cardInstances;

/**
 * Ouvre un paquet ; sans brillante ni doublon tirés au hasard, pour des comptes exacts (avec peu de cartes
 * légendaires ou UR dans la base de test, un paquet sort parfois deux fois le même article).
 */
async function freshCollection(p: Client, { unique = true } = {}) {
  const pulled = (await p.post("/packs/open")).body.cards as { instanceId: number; cardId: number; rarity: string }[];
  const seen = new Set<number>();
  const cards = unique ? pulled.filter((c) => !seen.has(c.cardId) && seen.add(c.cardId)) : pulled;
  const twins = pulled.filter((c) => !cards.includes(c)).map((c) => c.instanceId);
  if (twins.length) await ctx.db.delete(ci).where(inArray(ci.id, twins));
  await ctx.db.update(ci).set({ shiny: false }).where(eq(ci.ownerId, p.userId));
  await progressionIdle();
  return cards;
}

/** Ajoute `n` copies (niveau 1, mêmes stats) d'un exemplaire. Renvoie leurs ids. */
async function addCopies(instanceId: number, n: number, over: Partial<typeof ci.$inferInsert> = {}) {
  const [row] = await ctx.db.select().from(ci).where(eq(ci.id, instanceId));
  const { id: _id, obtainedAt: _o, pinnedSlot: _p, lockedBy: _l, ...base } = row!;
  const inserted = await ctx.db
    .insert(ci)
    .values(Array.from({ length: n }, () => ({ ...base, level: 1, favorite: false, shiny: false, ...over })))
    .returning({ id: ci.id });
  return inserted.map((r) => r.id);
}

const ids = (body: { items: { instanceId: number }[] }) => body.items.map((c) => c.instanceId).sort((a, b) => a - b);

describe("filtres de la collection", () => {
  let p: Client;
  let cards: Awaited<ReturnType<typeof freshCollection>>;

  beforeAll(async () => {
    p = await signUp(app);
    cards = await freshCollection(p);
  });

  it("filtre les brillantes, les favorites, ou tout sauf les favorites", async () => {
    const [shiny, fav] = cards;
    await ctx.db.update(ci).set({ shiny: true }).where(eq(ci.id, shiny!.instanceId));
    await p.post(`/collection/${fav!.instanceId}/favorite`, { favorite: true });

    expect(ids((await p.get("/collection?shiny=true")).body)).toEqual([shiny!.instanceId]);
    expect(ids((await p.get("/collection?favorites=only")).body)).toEqual([fav!.instanceId]);
    // Ancienne forme, toujours acceptée.
    expect(ids((await p.get("/collection?favorites=true")).body)).toEqual([fav!.instanceId]);
    const without = await p.get("/collection?favorites=exclude&limit=120");
    expect(without.body.total).toBe(cards.length - 1);
    expect(ids(without.body)).not.toContain(fav!.instanceId);
    expect((await p.get("/collection?favorites=maybe")).status).toBe(400);
  });

  it("cherche aussi dans le résumé Wikipédia quand on le demande", async () => {
    const target = cards[4]!;
    await ctx.db
      .insert(schema.wikiSummaries)
      .values({
        pageId: target.cardId,
        extract: "Une forteresse médiévale perchée sur un éperon rocheux.",
        status: "ok",
      })
      .onConflictDoUpdate({
        target: schema.wikiSummaries.pageId,
        set: { extract: "Une forteresse médiévale perchée sur un éperon rocheux." },
      });
    expect((await p.get("/collection?q=eperon")).body.total).toBe(0);
    const found = await p.get("/collection?q=%C3%A9peron&inSummary=true");
    expect(ids(found.body)).toContain(target.instanceId);
    // `%` et `_` sont cherchés tels quels, pas comme des jokers.
    expect((await p.get("/collection?q=%25&inSummary=true")).body.total).toBe(0);
  });

  it("trie les doublons par nombre d'exemplaires, du plus au moins, sur toutes les pages", async () => {
    const [x, y, z] = cards.slice(5);
    await addCopies(x!.instanceId, 1);
    await addCopies(y!.instanceId, 3);
    await addCopies(z!.instanceId, 2);
    const seen: { cardId: number; copies: number }[] = [];
    for (let page = 0; ; page++) {
      const res = await p.get(`/collection?duplicates=true&sort=copies&limit=4&page=${page}`);
      expect(res.status).toBe(200);
      seen.push(...res.body.items);
      if (!res.body.nextCursor) break;
    }
    expect(seen).toHaveLength(9);
    expect(seen.map((c) => c.copies)).toEqual([4, 4, 4, 4, 3, 3, 3, 2, 2]);
    expect(seen.map((c) => c.cardId)).toEqual([
      ...Array(4).fill(y!.cardId),
      ...Array(3).fill(z!.cardId),
      ...Array(2).fill(x!.cardId),
    ]);
    // Sans le filtre, les articles en un seul exemplaire viennent après.
    const all = (await p.get("/collection?sort=copies&limit=120")).body.items as { copies: number }[];
    expect(all.map((c) => c.copies)).toEqual([...all.map((c) => c.copies)].sort((a, b) => b - a));
    expect(all.at(-1)!.copies).toBe(1);
  });
});

describe("actions en masse", () => {
  let p: Client;
  let cards: Awaited<ReturnType<typeof freshCollection>>;

  beforeAll(async () => {
    p = await signUp(app);
    cards = await freshCollection(p);
  });

  it("met en favori et retire des favoris toute une sélection", async () => {
    const some = cards.slice(0, 4).map((c) => c.instanceId);
    expect((await p.post("/collection/favorite", { instanceIds: some, favorite: true })).body).toEqual({ changed: 4 });
    expect((await p.post("/collection/favorite", { instanceIds: some, favorite: true })).body).toEqual({ changed: 0 });
    expect(ids((await p.get("/collection?favorites=only")).body)).toEqual([...some].sort((a, b) => a - b));
    expect(
      (await p.post("/collection/favorite", { instanceIds: some.slice(0, 2), favorite: false })).body.changed,
    ).toBe(2);
    expect((await p.get("/collection?favorites=only")).body.total).toBe(2);
    // Les cartes d'un autre joueur ne bougent pas.
    const other = await signUp(app);
    expect((await other.post("/collection/favorite", { instanceIds: some, favorite: false })).body.changed).toBe(0);
    expect((await p.get("/collection?favorites=only")).body.total).toBe(2);
    expect((await p.post("/collection/favorite", { instanceIds: [], favorite: true })).status).toBe(400);
  });

  it("ajoute et retire un tag sur toute une sélection, sans dépasser 10 tags par carte", async () => {
    const some = cards.slice(0, 5).map((c) => c.instanceId);
    const full = some[0]!;
    await p.put(`/collection/${full}/tags`, { tags: Array.from({ length: 10 }, (_, i) => `t${i}`) });
    const added = await p.post("/collection/tags", { instanceIds: some, add: "  Châteaux " });
    expect(added.body).toEqual({ changed: 4, skipped: 1 });
    expect((await p.post("/collection/tags", { instanceIds: some, add: "châteaux" })).body).toEqual({
      changed: 0,
      skipped: 1,
    });
    const tagged = await p.get("/collection?tag=ch%C3%A2teaux");
    expect(tagged.body.total).toBe(4);
    expect(tagged.body.items[0].tags).toContain("châteaux");
    expect((await p.post("/collection/tags", { instanceIds: some, remove: "CHÂTEAUX" })).body.changed).toBe(4);
    expect((await p.get("/collection?tag=ch%C3%A2teaux")).body.total).toBe(0);
    expect((await p.post("/collection/tags", { instanceIds: some, add: " " })).status).toBe(400);
  });
});

describe("fusion en masse des doublons", () => {
  let p: Client;
  let cards: Awaited<ReturnType<typeof freshCollection>>;

  beforeAll(async () => {
    p = await signUp(app);
    cards = await freshCollection(p);
  });

  it("annonce puis applique les fusions, sans toucher aux exemplaires protégés", async () => {
    const [a, b] = cards;
    // Article A : 6 doublons (le meilleur monte au niveau 5, il en reste 2), dont un favori jamais consommé.
    const dupA = await addCopies(a!.instanceId, 6);
    await ctx.db.update(ci).set({ favorite: true }).where(eq(ci.id, dupA[0]!));
    // Article B : un doublon brillant (protégé) et un doublon engagé dans une vente.
    const [shinyB] = await addCopies(b!.instanceId, 1, { shiny: true });
    const [lockedB] = await addCopies(b!.instanceId, 1, { lockedBy: "auction" });

    const preview = (await p.get("/collection/fusions")).body;
    // La brillante B devient le meilleur exemplaire : l'original de B y est fusionné.
    expect(preview).toMatchObject({ cards: 2, consumed: 5, levels: 5, toMax: 1 });
    expect(preview.forgonePw).toBe(4 * recycleValue(a!.rarity as never) + recycleValue(b!.rarity as never));

    const done = await p.post("/collection/fusions");
    expect(done.status).toBe(200);
    expect(done.body).toEqual({ cards: 2, consumed: 5, levels: 5 });
    const [best] = await ctx.db.select().from(ci).where(eq(ci.id, a!.instanceId));
    expect(best!.level).toBe(MAX_LEVEL);
    const left = await ctx.db
      .select({ id: ci.id })
      .from(ci)
      .where(inArray(ci.id, [...dupA, shinyB!, lockedB!, b!.instanceId]));
    const kept = left.map((r) => r.id);
    expect(kept).toContain(dupA[0]);
    expect(kept).toContain(shinyB);
    expect(kept).toContain(lockedB);
    expect(kept).not.toContain(b!.instanceId);
    const [shiny] = await ctx.db.select().from(ci).where(eq(ci.id, shinyB!));
    expect(shiny!.level).toBe(2);
    const [ledger] = await ctx.db.execute<{ delta: number }>(
      sql`select delta from ledger where user_id = ${p.userId} and reason = 'fusion' order by id desc limit 1`,
    );
    expect(Number(ledger!.delta)).toBe(-5);
    await progressionIdle();
    expect((await p.get("/collection/fusions")).body).toMatchObject({ cards: 0, consumed: 0 });
  });

  it("respecte les filtres en cours", async () => {
    const c = cards[5]!;
    const d = cards.slice(2).find((x) => x.rarity !== c.rarity && x.cardId !== c.cardId);
    await addCopies(c.instanceId, 1);
    if (d) await addCopies(d.instanceId, 1);
    const only = (await p.get(`/collection/fusions?rarity=${c.rarity}`)).body;
    expect(only).toMatchObject({ consumed: 1 });
    expect((await p.post(`/collection/fusions?rarity=${c.rarity}`)).body.consumed).toBe(1);
    if (d) expect((await p.get("/collection/fusions")).body.consumed).toBe(1);
  });
});

describe("collection d'un autre joueur (échanges)", () => {
  it("se parcourt en entier, page par page, filtrée par rareté et brillantes, sans favoris ni vues", async () => {
    const owner = await signUp(app);
    for (let i = 0; i < 7; i++) await freshCollection(owner, { unique: false });
    const viewer = await signUp(app);
    const url = `/players/${owner.username}/collection`;
    const first = await viewer.get(`${url}?limit=30`);
    expect(first.body.total).toBe(70);
    expect(first.body.items).toHaveLength(30);
    expect(first.body.nextCursor).toBe("1");
    const third = await viewer.get(`${url}?limit=30&page=2`);
    expect(third.body.items).toHaveLength(10);
    expect(third.body.nextCursor).toBeNull();
    expect(first.body.items[0]).not.toHaveProperty("views12m");
    expect(first.body.items[0]).not.toHaveProperty("favorite");

    const rarity = first.body.items[0].rarity as string;
    const filtered = await viewer.get(`${url}?rarity=${rarity}`);
    expect(filtered.body.items.every((c: { rarity: string }) => c.rarity === rarity)).toBe(true);
    const [one] = first.body.items as { instanceId: number }[];
    await ctx.db.update(ci).set({ shiny: true }).where(eq(ci.id, one!.instanceId));
    expect(ids((await viewer.get(`${url}?shiny=true`)).body)).toEqual([one!.instanceId]);
    expect((await viewer.get(`${url}?sort=views`)).status).toBe(400);

    // Mêmes filtres que sa propre collection : doublons, édition, résumé des menus.
    await addCopies(one!.instanceId, 1);
    // Le paquet peut déjà contenir des doublons : on vérifie seulement que les deux copies ajoutées y sont.
    const dups = (await viewer.get(`${url}?duplicates=true&limit=120`)).body.items as { cardId: number }[];
    const oneCard = first.body.items[0].cardId as number;
    expect(dups.filter((c) => c.cardId === oneCard).length).toBeGreaterThanOrEqual(2);
    expect((await viewer.get(`${url}?season=999`)).body.total).toBe(0);
    const summary = await viewer.get(`${url}/summary`);
    expect(summary.status).toBe(200);
    expect(summary.body.seasons.length).toBeGreaterThan(0);
  });

  it("se filtre par les tags du joueur, sauf s'il les garde pour lui", async () => {
    const owner = await signUp(app);
    const cards = await freshCollection(owner);
    const viewer = await signUp(app);
    const url = `/players/${owner.username}/collection`;
    const tagged = cards.slice(0, 2).map((c) => c.instanceId);
    await owner.post("/collection/tags", { instanceIds: tagged, add: "châteaux" });

    // Privés par défaut : rien dans le menu, et le filtre est ignoré.
    expect((await owner.get("/me")).body.publicTags).toBe(false);
    expect((await viewer.get(`${url}/summary`)).body.tags).toEqual([]);
    expect((await viewer.get(`${url}?tag=${encodeURIComponent("châteaux")}`)).body.total).toBe(cards.length);

    // Partagés : le menu les propose, le filtre se combine aux autres, les cartes restent sans tags.
    expect((await owner.patch("/me/settings", { publicTags: true })).body.publicTags).toBe(true);
    expect((await viewer.get(`${url}/summary`)).body.tags).toEqual(["châteaux"]);
    const byTag = await viewer.get(`${url}?tag=${encodeURIComponent("châteaux")}`);
    expect(ids(byTag.body)).toEqual([...tagged].sort((a, b) => a - b));
    expect(byTag.body.items[0]).not.toHaveProperty("tags");
    const rarity = byTag.body.items[0].rarity as string;
    const both = await viewer.get(`${url}?tag=${encodeURIComponent("châteaux")}&rarity=${rarity}`);
    expect(both.body.items.every((c: { rarity: string }) => c.rarity === rarity)).toBe(true);
    expect(both.body.total).toBeLessThanOrEqual(2);

    // Repris : rien dans le menu, et le filtre est ignoré (on ne devine pas ses tags en essayant).
    expect((await owner.patch("/me/settings", { publicTags: false })).body.publicTags).toBe(false);
    expect((await viewer.get(`${url}/summary`)).body.tags).toEqual([]);
    expect((await viewer.get(`${url}?tag=${encodeURIComponent("châteaux")}`)).body.total).toBe(cards.length);
    expect((await viewer.get(`${url}?tag=inconnu`)).body.total).toBe(cards.length);
    // Sa propre collection garde le filtre.
    expect((await owner.get("/collection/summary")).body.tags).toEqual(["châteaux"]);
  });
});

describe("exemplaires par id", () => {
  it("ne renvoie que les siens, dans l'ordre demandé", async () => {
    const p = await signUp(app);
    const [a, b] = await freshCollection(p);
    const other = await signUp(app);
    const mine = await p.get(`/collection/instances?ids=${b!.instanceId},${a!.instanceId}`);
    expect(mine.body.map((c: { instanceId: number }) => c.instanceId)).toEqual([b!.instanceId, a!.instanceId]);
    expect((await other.get(`/collection/instances?ids=${a!.instanceId}`)).body).toEqual([]);
    expect((await p.get("/collection/instances?ids=abc")).status).toBe(400);
  });
});

describe("option « flouter les arthropodes »", () => {
  it("s'active dans les réglages et repère les cartes d'arthropodes depuis leur résumé", async () => {
    const p = await signUp(app);
    expect((await p.get("/me")).body.hideArthropods).toBe(false);
    expect((await p.patch("/me/settings", { hideArthropods: true })).body.hideArthropods).toBe(true);

    const [spider, plain, unknown] = await freshCollection(p);
    const summary = (pageId: number, description: string) =>
      ctx.db
        .insert(schema.wikiSummaries)
        .values({ pageId, description, status: "ok" })
        .onConflictDoUpdate({ target: schema.wikiSummaries.pageId, set: { description, arthropod: null } });
    await summary(spider!.cardId, "espèce d'araignées");
    await summary(plain!.cardId, "château fort de France");
    await ctx.db.delete(schema.wikiSummaries).where(eq(schema.wikiSummaries.pageId, unknown!.cardId));

    const res = await p.get(`/cards/arthropods?ids=${spider!.cardId},${plain!.cardId},${unknown!.cardId}`);
    expect(res.body).toEqual({ arthropods: [spider!.cardId], pending: [unknown!.cardId] });
    // Le drapeau calculé est gardé en cache.
    const [row] = await ctx.db
      .select({ arthropod: schema.wikiSummaries.arthropod })
      .from(schema.wikiSummaries)
      .where(eq(schema.wikiSummaries.pageId, plain!.cardId));
    expect(row!.arthropod).toBe(false);
    expect((await p.get("/cards/arthropods?ids=")).status).toBe(400);
  });
});

describe("option « Upgrader sans animation »", () => {
  it("est désactivée par défaut et se mémorise pour le joueur", async () => {
    const p = await signUp(app);
    expect((await p.get("/me")).body.quickUpgrade).toBe(false);
    expect((await p.patch("/me/settings", { quickUpgrade: true })).body.quickUpgrade).toBe(true);
    expect((await p.get("/me")).body.quickUpgrade).toBe(true);
    expect((await p.patch("/me/settings", { quickUpgrade: "oui" })).status).toBe(400);
    // Réglage propre à chaque joueur.
    expect((await (await signUp(app)).get("/me")).body.quickUpgrade).toBe(false);
  });
});
