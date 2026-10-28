import { describe, expect, it } from "vitest";
import { isGore, isNudity, resolveImageThemes, summaryImageThemes } from "./image-filters.js";

describe("isGore", () => {
  it("repère maladies, plaies, chirurgie et cadavres d'après la description courte", () => {
    for (const description of [
      "maladie de la peau",
      "maladie infectieuse",
      "lésion cutanée",
      "infection bactérienne de la peau",
      "intervention chirurgicale",
      "brûlure grave",
      "momie égyptienne",
      "Gangrène gazeuse",
    ])
      expect(isGore({ description }), description).toBe(true);
  });
  it("repère la définition du résumé", () => {
    for (const extract of [
      "La gale est une maladie contagieuse de la peau due à un acarien. Elle provoque des démangeaisons.",
      "L'appendicectomie est une intervention chirurgicale qui consiste à retirer l'appendice.",
      "Le vitiligo est une affection de la peau caractérisée par des taches blanches.",
      "Un ulcère de Buruli est une infection due à Mycobacterium ulcerans.",
    ])
      expect(isGore({ extract }), extract).toBe(true);
  });
  it("ne floute ni les personnes, ni les œuvres, ni les simples mentions", () => {
    for (const s of [
      { description: "chanteur français", extract: "Il meurt de la tuberculose en 1923." },
      { description: "film américain de 1995", extract: "Outbreak est un film sur une maladie infectieuse." },
      { description: "médecin français", extract: "Il est un spécialiste des maladies de la peau." },
      { description: "espèce de virus", extract: "Le virus Ebola est un virus de la famille des Filoviridae." },
      { description: "maladie des plantes", extract: "Le mildiou est une maladie des plantes due à un oomycète." },
      { description: "maladie du hêtre", extract: "Le chancre du hêtre est une maladie du hêtre." },
      { description: "commune française", extract: "Lésigny est une commune française." },
      { description: "éruption volcanique", extract: "L'éruption du Kīlauea en mai 1924 est une éruption volcanique." },
      { description: null, extract: null },
    ])
      expect(isGore(s), JSON.stringify(s)).toBe(false);
  });
});

describe("isNudity", () => {
  it("repère les nus, le naturisme et l'anatomie génitale", () => {
    for (const s of [
      { description: "tableau de Courbet représentant une femme nue" },
      { description: "nu féminin de Modigliani" },
      { extract: "La Vénus pudique est une statue représentant la déesse nue cachant sa poitrine." },
      { extract: "Le naturisme est un mode de vie en harmonie avec la nature." },
      { description: "plage naturiste en Espagne" },
      { description: "organe génital masculin" },
      { description: "film pornographique de 1972" },
    ])
      expect(isNudity(s), JSON.stringify(s)).toBe(true);
  });
  it("ne floute ni les personnes, ni les simples mentions", () => {
    for (const s of [
      { description: "actrice pornographique américaine", extract: "Elle a tourné dans des films pornographiques." },
      { description: "peintre français", extract: "Il est connu pour ses nus." },
      { description: "tableau de Monet", extract: "Les Nymphéas sont une série de tableaux." },
      { description: "chanson de 2004", extract: "Nue est une chanson." },
      { description: null, extract: null },
    ])
      expect(isNudity(s), JSON.stringify(s)).toBe(false);
  });
});

describe("thèmes d'une carte", () => {
  it("réunit les thèmes du résumé", () => {
    expect(summaryImageThemes({ description: "espèce d'araignées" })).toEqual(["arthropods"]);
    expect(summaryImageThemes({ description: "maladie de la peau" })).toEqual(["gore"]);
    expect(summaryImageThemes({ description: "ville de France" })).toEqual([]);
  });
  it("donne toujours le dernier mot à la liste Admin", () => {
    expect(resolveImageThemes(["gore"], new Map([["gore", false]]))).toEqual([]);
    expect(resolveImageThemes([], new Map([["nudity", true]]))).toEqual(["nudity"]);
    expect(resolveImageThemes(["arthropods", "gore"], new Map([["nudity", true]]))).toEqual([
      "arthropods",
      "gore",
      "nudity",
    ]);
  });
});
