import { afterAll, describe, expect, it } from "vitest";
import { makeApp, signUp } from "./helpers.js";

const { app } = await makeApp({ now: () => new Date("2026-10-02T12:00:00+02:00") });
afterAll(() => app.close());

describe("menu : nouveautés et paquets à ouvrir", () => {
  it("annonce les nouveautés jusqu'à la première visite", async () => {
    const p = await signUp(app);
    const all = [
      "battle-v2",
      "quests",
      "article",
      "boss",
      "feed",
      "achievements-v2",
      "suggestions",
      "updates",
      "wheels",
      "battle-decks",
    ];
    expect((await p.get("/me")).body.newFeatures).toEqual(all);
    expect((await p.post("/me/seen-feature", { key: "battle-v2" })).status).toBe(200);
    // Idempotent : une deuxième visite ne duplique rien.
    expect((await p.post("/me/seen-feature", { key: "battle-v2" })).status).toBe(200);
    expect((await p.get("/me")).body.newFeatures).toEqual(all.slice(1));
    expect((await p.post("/me/seen-feature", { key: "inconnue" })).status).toBe(400);
  });

  it("compte les boosters à thème pas encore ouverts", async () => {
    const p = await signUp(app);
    expect((await p.get("/me")).body.themePacks).toBe(0);
  });
});
