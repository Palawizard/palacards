import { describe, expect, it } from "vitest";
import { CONDITION_WEIGHTS, CONDITIONS, DEFAULT_CONDITION, rollCondition } from "./condition.js";

describe("états de conservation", () => {
  it("les chances somment à 100", () => {
    expect(CONDITIONS.reduce((s, c) => s + CONDITION_WEIGHTS[c], 0)).toBe(100);
  });

  it("chaque tirage tombe sur l'état de sa tranche", () => {
    const counts = new Map<number, number>();
    for (let roll = 0; roll < 100; roll++) {
      const c = rollCondition(() => roll);
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    for (const c of CONDITIONS) expect(counts.get(c)).toBe(CONDITION_WEIGHTS[c]);
    expect(rollCondition(() => 0)).toBe(1);
    expect(rollCondition(() => 99)).toBe(5);
  });

  it("l'état par défaut est le plus courant", () => {
    const most = Math.max(...CONDITIONS.map((c) => CONDITION_WEIGHTS[c]));
    expect(CONDITION_WEIGHTS[DEFAULT_CONDITION]).toBe(most);
  });
});
