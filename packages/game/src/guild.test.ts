import { describe, expect, it } from "vitest";
import {
  canManage,
  dmChannel,
  GUILD_OBJECTIVES,
  validateGuildName,
  validateGuildTag,
  weeklyObjective,
  weekStart,
} from "./guild.js";

describe("guildes", () => {
  it("calcule le lundi de la semaine", () => {
    expect(weekStart("2026-09-23")).toBe("2026-09-21"); // mercredi
    expect(weekStart("2026-09-21")).toBe("2026-09-21"); // lundi
    expect(weekStart("2026-09-27")).toBe("2026-09-21"); // dimanche
  });

  it("fait tourner les objectifs chaque semaine et adapte la cible à la taille", () => {
    const kinds = new Set(["2026-09-07", "2026-09-14", "2026-09-21"].map((w) => weeklyObjective(w, 5).kind));
    expect(kinds.size).toBe(3);
    const small = weeklyObjective("2026-09-21", 1);
    expect(small.target).toBe(GUILD_OBJECTIVES[small.kind].min);
    const big = weeklyObjective("2026-09-21", 20);
    expect(big.target).toBe(GUILD_OBJECTIVES[big.kind].perMember * 20);
  });

  it("encadre les droits des rôles", () => {
    expect(canManage("leader", "officer", "kick")).toBe(true);
    expect(canManage("officer", "member", "kick")).toBe(true);
    expect(canManage("officer", "officer", "kick")).toBe(false);
    expect(canManage("member", "member", "kick")).toBe(false);
    expect(canManage("officer", "member", "promote")).toBe(false);
    expect(canManage("leader", "member", "promote")).toBe(true);
    expect(canManage("leader", "leader", "kick")).toBe(false);
  });

  it("valide nom et blason", () => {
    expect(validateGuildName("Les Encyclopédistes")).toBe(true);
    expect(validateGuildName("ab")).toBe(false);
    expect(validateGuildTag("ENC")).toBe(true);
    expect(validateGuildTag("E")).toBe(false);
    expect(validateGuildTag("ÉCOLE")).toBe(false);
  });

  it("donne un canal unique par paire de joueurs", () => {
    expect(dmChannel("b", "a")).toBe(dmChannel("a", "b"));
    expect(dmChannel("a", "b")).toBe("dm:a:b");
  });
});
