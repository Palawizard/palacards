import { describe, expect, it } from "vitest";
import { decodeImage, pixelate, pixelatableUrl } from "../src/services/pixelate.js";
import { entityAttributes, wikidataYear } from "../src/services/wiki.js";
import { PNG } from "pngjs";

const claim = (prop: string, value: object, rank = "normal") => ({
  [prop]: [{ rank, mainsnak: { datavalue: { value } } }],
});

describe("attributs Wikidata", () => {
  it("lit l'année d'une date, avant J.-C. comprise", () => {
    expect(wikidataYear("+1952-03-11T00:00:00Z")).toBe(1952);
    expect(wikidataYear("-0052-00-00T00:00:00Z")).toBe(-52);
    expect(wikidataYear("+0000-00-00T00:00:00Z")).toBeNull();
    expect(wikidataYear(undefined)).toBeNull();
  });

  it("prend la nationalité et la naissance d'une personne", () => {
    const a = entityAttributes({
      claims: {
        ...claim("P31", { id: "Q5" }),
        ...claim("P27", { id: "Q142" }),
        ...claim("P569", { time: "+1802-02-26T00:00:00Z" }),
        ...claim("P571", { time: "+1900-01-01T00:00:00Z" }),
      },
    });
    expect(a).toEqual({ human: true, countryId: "Q142", year: 1802, yearKind: "birth" });
  });

  it("prend le pays et la sortie d'une œuvre, en évitant les valeurs dépréciées", () => {
    const a = entityAttributes({
      claims: {
        ...claim("P31", { id: "Q11424" }),
        P495: [
          { rank: "deprecated", mainsnak: { datavalue: { value: { id: "Q30" } } } },
          { rank: "normal", mainsnak: { datavalue: { value: { id: "Q145" } } } },
        ],
        ...claim("P577", { time: "+2010-07-08T00:00:00Z" }),
      },
    });
    expect(a).toEqual({ human: false, countryId: "Q145", year: 2010, yearKind: "publication" });
  });
});

describe("image pixelisée", () => {
  it("réduit une image à quelques pixels, proportions gardées", () => {
    const src = new PNG({ width: 40, height: 20 });
    src.data.fill(255);
    const img = decodeImage(PNG.sync.write(src), "image/png")!;
    expect(img).toMatchObject({ width: 40, height: 20 });
    const out = PNG.sync.read(pixelate(img, 8));
    expect([out.width, out.height]).toEqual([8, 4]);
    expect(decodeImage(Buffer.from("pas une image"), "image/png")).toBeNull();
    expect(decodeImage(Buffer.from("<svg/>"), "image/svg+xml")).toBeNull();
  });

  it("n'accepte que les vignettes JPEG et PNG", () => {
    expect(pixelatableUrl("https://upload.wikimedia.org/a/320px-B.jpg")).toBe(true);
    expect(pixelatableUrl("https://upload.wikimedia.org/a/320px-B.PNG")).toBe(true);
    expect(pixelatableUrl("https://upload.wikimedia.org/a/B.svg")).toBe(false);
    expect(pixelatableUrl(null)).toBe(false);
  });
});
