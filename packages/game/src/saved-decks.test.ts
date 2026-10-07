import { describe, expect, it } from "vitest";
import { SAVED_DECK_NAME_MAX, savedDeckName, savedDeckStatus } from "./saved-decks.js";

describe("decks enregistrés", () => {
  it("un deck n'est utilisable qu'avec 5 cartes toutes possédées", () => {
    expect(savedDeckStatus(5, 0)).toBe("ready");
    expect(savedDeckStatus(3, 0)).toBe("incomplete");
    expect(savedDeckStatus(0, 0)).toBe("incomplete");
    expect(savedDeckStatus(5, 1)).toBe("invalid");
    expect(savedDeckStatus(2, 1)).toBe("invalid");
  });

  it("nettoie et borne le nom", () => {
    expect(savedDeckName("  Mes   rares  ")).toBe("Mes rares");
    expect(savedDeckName("   ")).toBeNull();
    expect(savedDeckName("x".repeat(50))).toHaveLength(SAVED_DECK_NAME_MAX);
  });
});
