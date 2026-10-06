import { describe, expect, it } from "vitest";
import { ELO_START } from "./battle.js";
import { TITLE_BOARDS, TITLE_MAX_RANK, TITLE_NAMES, titleDetail, titleWinners } from "./titles.js";

describe("titres de classement", () => {
  it("récompense les premiers du classement, dans l'ordre", () => {
    const rows = [5, 4, 3, 2, 1].map((value, i) => ({ id: `p${i}`, value }));
    const winners = titleWinners("collection", rows);
    expect(winners).toHaveLength(TITLE_MAX_RANK);
    expect(winners.map((w) => [w.id, w.rank])).toEqual([
      ["p0", 1],
      ["p1", 2],
      ["p2", 3],
    ]);
  });

  it("ignore les scores nuls et l'Elo de départ", () => {
    expect(titleWinners("wealth", [{ value: 10 }, { value: 0 }])).toHaveLength(1);
    expect(titleWinners("elo", [{ value: ELO_START + 1 }, { value: ELO_START }, { value: ELO_START - 50 }])).toEqual([
      { value: ELO_START + 1, rank: 1 },
    ]);
    expect(titleWinners("pass", [])).toEqual([]);
  });

  it("nomme chaque classement et situe le titre", () => {
    for (const b of TITLE_BOARDS) expect(TITLE_NAMES[b]).toBeTruthy();
    expect(titleDetail({ board: "luck", rank: 1, season: 3 })).toBe("n°\u00a01 en Chance, saison 3");
  });
});
