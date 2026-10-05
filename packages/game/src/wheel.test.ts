import { describe, expect, it } from "vitest";
import {
  rollWheel,
  WHEEL_GAP_MS,
  WHEEL_TIERS,
  WHEEL_TOTAL,
  WHEELS,
  wheelSchedule,
  type WheelReward,
  type WheelTier,
} from "./wheel.js";

/** Valeur indicative d'un lot (paquet 150 PW, booster 200, UR 250, légendaire 1 500). */
const value = (r: WheelReward) =>
  r.kind === "pw"
    ? r.amount
    : r.kind === "packs"
      ? r.amount * 150
      : r.kind === "theme"
        ? r.amount * 200
        : r.rarity === "UR"
          ? 250
          : 1_500;
const expected = (tier: WheelTier) => WHEELS[tier].reduce((s, x) => s + (value(x.reward) * x.weight) / WHEEL_TOTAL, 0);

describe("roues du jour", () => {
  it.each(WHEEL_TIERS)("la roue %s somme à 10 000", (tier) => {
    expect(WHEELS[tier].reduce((s, x) => s + x.weight, 0)).toBe(WHEEL_TOTAL);
  });

  it.each(WHEEL_TIERS)("roue %s : la légendaire est plus rare que l'UR", (tier) => {
    const weight = (rarity: "UR" | "L") =>
      WHEELS[tier].find((s) => s.reward.kind === "card" && s.reward.rarity === rarity)!.weight;
    expect(weight("L")).toBeLessThan(weight("UR"));
  });

  it("chaque roue vaut mieux que la précédente, et la petite n'est pas une roue de consolation", () => {
    const [small, medium, large] = WHEEL_TIERS.map(expected) as [number, number, number];
    expect(small).toBeGreaterThan(200);
    expect(medium).toBeGreaterThan(small * 1.4);
    expect(large).toBeGreaterThan(medium * 1.8);
    // Plus petit lot de chaque roue : au moins le gros lot de l'ancienne roue unique (100 PW).
    for (const tier of WHEEL_TIERS)
      expect(Math.min(...WHEELS[tier].map((s) => value(s.reward)))).toBeGreaterThanOrEqual(100);
  });

  it("tire chaque case selon son poids (bornes des intervalles)", () => {
    for (const tier of WHEEL_TIERS) {
      const segments = WHEELS[tier];
      expect(rollWheel(tier, () => 0)).toBe(0);
      expect(rollWheel(tier, () => WHEEL_TOTAL - 1)).toBe(segments.length - 1);
      let acc = 0;
      segments.forEach((s, i) => {
        expect(rollWheel(tier, () => acc)).toBe(i);
        acc += s.weight;
        expect(rollWheel(tier, () => acc - 1)).toBe(i);
      });
    }
  });
});

describe("calendrier des roues", () => {
  const today = "2026-10-06";
  const midnight = new Date("2026-10-06T22:00:00Z"); // minuit à Paris (heure d'été)
  const at = (iso: string) => new Date(iso);

  it("nouvelle journée : la petite est prête tout de suite", () => {
    const s = wheelSchedule(
      { day: "2026-10-05", opened: 3, lastAt: at("2026-10-05T20:00:00Z") },
      at("2026-10-05T22:01:00Z"),
      today,
      midnight,
    );
    expect(s).toEqual({ opened: 0, next: "small", availableAt: null, ready: true, missed: false });
  });

  it("la moyenne attend 2 h 30 après la petite, la grande 2 h 30 après la moyenne", () => {
    const small = at("2026-10-06T06:00:00Z");
    const waiting = wheelSchedule(
      { day: today, opened: 1, lastAt: small },
      at("2026-10-06T07:00:00Z"),
      today,
      midnight,
    );
    expect(waiting).toMatchObject({ next: "medium", ready: false, missed: false });
    expect(waiting.availableAt!.getTime()).toBe(small.getTime() + WHEEL_GAP_MS);
    const ready = wheelSchedule({ day: today, opened: 1, lastAt: small }, at("2026-10-06T08:30:00Z"), today, midnight);
    expect(ready).toMatchObject({ next: "medium", ready: true, availableAt: null });
    const large = wheelSchedule(
      { day: today, opened: 2, lastAt: at("2026-10-06T09:00:00Z") },
      at("2026-10-06T10:00:00Z"),
      today,
      midnight,
    );
    expect(large).toMatchObject({ next: "large", ready: false });
  });

  it("trois roues tournées : plus rien jusqu'à minuit", () => {
    const s = wheelSchedule(
      { day: today, opened: 3, lastAt: at("2026-10-06T12:00:00Z") },
      at("2026-10-06T13:00:00Z"),
      today,
      midnight,
    );
    expect(s).toEqual({ opened: 3, next: null, availableAt: null, ready: false, missed: false });
  });

  it("une roue qui ne serait prête qu'après minuit est perdue pour la journée", () => {
    const s = wheelSchedule(
      { day: today, opened: 1, lastAt: at("2026-10-06T20:00:00Z") },
      at("2026-10-06T20:30:00Z"),
      today,
      midnight,
    );
    expect(s).toMatchObject({ next: "medium", ready: false, missed: true });
  });
});
