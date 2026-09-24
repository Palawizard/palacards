import { describe, expect, it } from "vitest";
import { socketLimiter } from "./socket-rate-limit.js";

describe("limiteur Socket.IO", () => {
  const rules = { "battle:join": { capacity: 3, perSecond: 1 }, default: { capacity: 2, perSecond: 0.5 } };

  it("laisse passer une rafale jusqu'à la capacité, puis au débit de recharge", () => {
    let t = 0;
    const limiter = socketLimiter(rules, () => t);
    expect([1, 2, 3, 4].map(() => limiter.allow("battle:join"))).toEqual([true, true, true, false]);
    t = 999;
    expect(limiter.allow("battle:join")).toBe(false);
    t = 1_000;
    expect(limiter.allow("battle:join")).toBe(true);
    expect(limiter.allow("battle:join")).toBe(false);
    // Le seau ne dépasse jamais sa capacité, même après une longue pause.
    t = 60_000;
    expect([1, 2, 3, 4].map(() => limiter.allow("battle:join"))).toEqual([true, true, true, false]);
  });

  it("compte chaque événement à part, et tous les événements inconnus dans un seau commun", () => {
    const limiter = socketLimiter(rules, () => 0);
    expect(limiter.allow("battle:join")).toBe(true);
    expect(limiter.allow("inconnu-1")).toBe(true);
    expect(limiter.allow("inconnu-2")).toBe(true);
    expect(limiter.allow("toString")).toBe(false);
    expect(limiter.allow("__proto__")).toBe(false);
    expect(limiter.allow("battle:join")).toBe(true);
  });
});
