import { describe, expect, it } from "vitest";
import { checkStatusNote, cleanStatusNote, STATUS_NOTE_MAX, visibleStatusNote } from "./status-note.js";

describe("note de statut", () => {
  it("nettoie les espaces et les caractères invisibles", () => {
    expect(cleanStatusNote("  En   pause\ncafé ​☕  ")).toBe("En pause café ☕");
    // La liaison des emojis composés est gardée.
    expect(cleanStatusNote("👨‍👩‍👧")).toBe("👨‍👩‍👧");
  });

  it("vide ou nulle : la note est effacée", () => {
    expect(checkStatusNote(null)).toEqual({ ok: true, note: null });
    expect(checkStatusNote("   \n ")).toEqual({ ok: true, note: null });
  });

  it("limite la longueur en caractères visibles", () => {
    expect(checkStatusNote("a".repeat(STATUS_NOTE_MAX))).toEqual({ ok: true, note: "a".repeat(STATUS_NOTE_MAX) });
    expect(checkStatusNote("a".repeat(STATUS_NOTE_MAX + 1))).toEqual({ ok: false, error: "too_long" });
    // Un emoji compte pour un caractère.
    expect(checkStatusNote("🃏".repeat(STATUS_NOTE_MAX)).ok).toBe(true);
  });

  it("refuse les balises mais garde les cœurs <3", () => {
    expect(checkStatusNote("<b>salut</b>")).toEqual({ ok: false, error: "markup" });
    expect(checkStatusNote("<script>alert(1)</script>")).toEqual({ ok: false, error: "markup" });
    expect(checkStatusNote("Je vous aime <3 et 2 > 1")).toEqual({ ok: true, note: "Je vous aime <3 et 2 > 1" });
  });

  it("refuse les liens", () => {
    for (const note of ["https://exemple.org", "va sur www.truc.net", "discord.gg/abc", "mon-site.fr !"]) {
      expect(checkStatusNote(note)).toEqual({ ok: false, error: "link" });
    }
    expect(checkStatusNote("Fini. Me voilà de retour").ok).toBe(true);
  });

  it("reste visible tant qu'aucune durée de vie n'est réglée", () => {
    const now = new Date("2026-10-07T12:00:00Z");
    expect(visibleStatusNote("Coucou", new Date("2020-01-01T00:00:00Z"), now)).toBe("Coucou");
    expect(visibleStatusNote(null, now, now)).toBeNull();
  });
});
