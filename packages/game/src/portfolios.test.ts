import { describe, expect, it } from "vitest";
import { ACHIEVEMENTS } from "./achievements.js";
import {
  eligibleDesigns,
  normalizePortfolioCards,
  PORTFOLIO_CARDS_MAX,
  PORTFOLIO_DESIGNS,
  PORTFOLIO_PRICES,
} from "./portfolios.js";

describe("designs des portfolios", () => {
  it("relie chaque design à gagner à un vrai succès, et a des clés uniques", () => {
    const keys = new Set(ACHIEVEMENTS.map((a) => a.key));
    for (const d of PORTFOLIO_DESIGNS)
      if (d.source.kind === "achievement") expect(keys.has(d.source.achievement), d.key).toBe(true);
    expect(new Set(PORTFOLIO_DESIGNS.map((d) => d.key)).size).toBe(PORTFOLIO_DESIGNS.length);
  });

  it("donne les gratuits, garde les achetés et accorde ceux qu'un succès ou un évènement débloque", () => {
    const none = eligibleDesigns({ owned: [], unlockedAchievements: new Set(), eventPlayed: () => false });
    expect([...none.have].sort()).toEqual(["ardoise", "double-filet", "filet", "lin", "nuit", "papier", "pointilles"]);
    expect(none.earned).toEqual([]);
    const some = eligibleDesigns({
      owned: ["marbre", "prisme"],
      unlockedAchievements: new Set(["shiny_1", "first_l"]),
      eventPlayed: (from) => from === "2026-10-31",
    });
    expect(some.have.has("marbre")).toBe(true);
    // Prisme est déjà enregistré : pas gagné une seconde fois.
    expect(some.earned).toEqual([
      { key: "citrouille", source: "event" },
      { key: "citrouille-cadre", source: "event" },
      { key: "or-legendaire", source: "achievement" },
    ]);
  });

  it("vend les fonds, cadres et designs de prestige aux prix prévus", () => {
    const prices = PORTFOLIO_DESIGNS.flatMap((d) => (d.source.kind === "shop" ? [d.source.price] : []));
    expect(new Set(prices)).toEqual(
      new Set([PORTFOLIO_PRICES.background, PORTFOLIO_PRICES.frame, PORTFOLIO_PRICES.prestige]),
    );
  });
});

describe("cartes d'un portfolio", () => {
  it("garde l'ordre, une seule carte en vedette, et refuse doublons et excès", () => {
    expect(
      normalizePortfolioCards([
        { instanceId: 3, featured: true },
        { instanceId: 1 },
        { instanceId: 2, featured: true },
      ]),
    ).toEqual([
      { instanceId: 3, featured: true },
      { instanceId: 1, featured: false },
      { instanceId: 2, featured: false },
    ]);
    expect(normalizePortfolioCards([{ instanceId: 1 }, { instanceId: 1 }])).toBeNull();
    expect(
      normalizePortfolioCards(Array.from({ length: PORTFOLIO_CARDS_MAX + 1 }, (_, i) => ({ instanceId: i + 1 }))),
    ).toBeNull();
  });
});
