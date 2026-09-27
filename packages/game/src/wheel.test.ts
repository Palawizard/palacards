import { describe, expect, it } from "vitest";
import { rollWheel, WHEEL_SEGMENTS, WHEEL_TOTAL } from "./wheel.js";

describe("roue quotidienne", () => {
  it("somme à 10 000", () => {
    expect(WHEEL_SEGMENTS.reduce((s, x) => s + x.weight, 0)).toBe(WHEEL_TOTAL);
  });

  it("la légendaire est la case la plus rare, puis l'UR", () => {
    const weight = (rarity: "UR" | "L") =>
      WHEEL_SEGMENTS.find((s) => s.reward.kind === "card" && s.reward.rarity === rarity)!.weight;
    const others = WHEEL_SEGMENTS.filter((s) => s.reward.kind !== "card").map((s) => s.weight);
    expect(weight("L")).toBeLessThan(weight("UR"));
    expect(weight("UR")).toBeLessThan(Math.min(...others));
  });

  it("tire chaque case selon son poids (bornes des intervalles)", () => {
    expect(rollWheel(() => 0)).toBe(0);
    expect(rollWheel(() => WHEEL_TOTAL - 1)).toBe(WHEEL_SEGMENTS.length - 1);
    let acc = 0;
    WHEEL_SEGMENTS.forEach((s, i) => {
      expect(rollWheel(() => acc)).toBe(i);
      acc += s.weight;
      expect(rollWheel(() => acc - 1)).toBe(i);
    });
  });
});
