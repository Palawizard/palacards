import { SAVED_DECKS_MAX } from "@palacards/game";
import type { SavedDeckDTO } from "@palacards/shared";
import { afterAll, describe, expect, it } from "vitest";
import { makeApp, signUp, type Client } from "./helpers.js";

const { app } = await makeApp();
afterAll(() => app.close());

async function cardsOf(p: Client): Promise<number[]> {
  await p.post("/packs/open");
  const list = await p.get("/collection?limit=5&sort=atk");
  return list.body.items.map((c: { instanceId: number }) => c.instanceId);
}

describe("decks de bataille enregistrés", () => {
  it("crée, renomme, modifie, liste et supprime un deck (privé)", async () => {
    const a = await signUp(app);
    const cards = await cardsOf(a);
    const created = await a.post("/battles/decks", { name: "  Mes   meilleures ", cards });
    expect(created.status).toBe(200);
    const deck = created.body as SavedDeckDTO;
    expect(deck).toMatchObject({ name: "Mes meilleures", missing: 0, status: "ready" });
    expect(deck.cards.map((c) => c?.instanceId)).toEqual(cards);

    // Deck en cours de composition : enregistrable, mais incomplet.
    const renamed = await a.put(`/battles/decks/${deck.id}`, { name: "Attaque", cards: cards.slice(0, 3) });
    expect(renamed.body).toMatchObject({ name: "Attaque", status: "incomplete" });
    expect(renamed.body.cards).toHaveLength(3);
    expect((await a.put(`/battles/decks/${deck.id}`, { name: "   " })).body.error).toBe("invalid_name");
    expect((await a.put(`/battles/decks/${deck.id}`, { cards: [cards[0], cards[0]] })).body.error).toBe("invalid_deck");

    // Les decks sont privés : un autre joueur ne les voit ni ne les modifie.
    const b = await signUp(app);
    expect((await b.get("/battles/decks")).body).toEqual([]);
    expect((await b.put(`/battles/decks/${deck.id}`, { name: "Volé" })).status).toBe(404);
    expect((await b.del(`/battles/decks/${deck.id}`)).status).toBe(404);
    // Ni avec les cartes d'un autre.
    expect((await b.post("/battles/decks", { name: "Pas à moi", cards })).status).toBe(404);

    expect((await a.get("/battles/decks")).body).toHaveLength(1);
    expect((await a.del(`/battles/decks/${deck.id}`)).status).toBe(200);
    expect((await a.get("/battles/decks")).body).toEqual([]);
  });

  it(`plafonne à ${SAVED_DECKS_MAX} decks côté serveur`, async () => {
    const a = await signUp(app);
    for (let i = 0; i < SAVED_DECKS_MAX; i++) {
      expect((await a.post("/battles/decks", { name: `Deck ${i + 1}`, cards: [] })).status).toBe(200);
    }
    const over = await a.post("/battles/decks", { name: "De trop", cards: [] });
    expect(over.status).toBe(409);
    expect(over.body.error).toBe("deck_limit");
    expect((await a.get("/battles/decks")).body).toHaveLength(SAVED_DECKS_MAX);
  });

  it("une carte qui quitte la collection rend le deck invalide, inutilisable en duel", async () => {
    const a = await signUp(app);
    const b = await signUp(app);
    const cards = await cardsOf(a);
    const deck = (await a.post("/battles/decks", { name: "Rares", cards })).body as SavedDeckDTO;
    expect((await a.post("/collection/recycle", { instanceIds: [cards[2]] })).status).toBe(200);

    const [after] = (await a.get("/battles/decks")).body as SavedDeckDTO[];
    expect(after).toMatchObject({ id: deck.id, missing: 1, status: "invalid" });
    expect(after!.cards[2]).toBeNull();
    // Le duel refuse ce deck tel quel.
    expect((await a.post("/battles", { opponent: b.username, deck: cards })).status).toBe(404);

    // Carte remplacée : le deck redevient prêt.
    const spare = (await a.get("/collection?limit=20&sort=atk")).body.items
      .map((c: { instanceId: number }) => c.instanceId)
      .find((id: number) => !cards.includes(id));
    const fixed = cards.map((id, i) => (i === 2 ? spare : id));
    const repaired = await a.put(`/battles/decks/${deck.id}`, { cards: fixed });
    expect(repaired.body).toMatchObject({ missing: 0, status: "ready" });
  });
});
