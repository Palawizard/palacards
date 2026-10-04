import { describe, expect, it } from "vitest";
import { isArthropod } from "./arthropod.js";

describe("isArthropod", () => {
  it("repère araignées, scorpions, acariens, insectes et mille-pattes par la description courte", () => {
    for (const description of [
      "espèce d'araignées",
      "espèce d’arachnides",
      "famille d'insectes",
      "genre de coléoptères",
      "espèce de lépidoptères",
      "ordre d'arachnides",
      "espèce de myriapodes",
      "espèce de scorpions",
      "nom vernaculaire de certains insectes",
      "nom de plusieurs sortes d'insectes",
      "groupe d'insectes connus par divers noms vernaculaires",
      "espèce de fourmis",
      "insecte parasite situé dans les cheveux",
      "araignée mythique de la province de Tarente",
    ])
      expect(isArthropod({ description }), description).toBe(true);
  });

  it("repère les tournures taxonomiques de la première phrase du résumé", () => {
    for (const extract of [
      "Pardosa amentata est une espèce d'araignées aranéomorphes de la famille des Lycosidae.",
      "Les Carabidae sont une famille d'insectes de l'ordre des coléoptères.",
      "Ixodes ricinus (L. 1758) est une espèce d'acariens de la famille des Ixodidae. Elle transmet la maladie de Lyme.",
      "La Scolopendre ceinturée est une espèce de chilopodes.",
      "La fourmi rousse est un insecte social des forêts.",
      "Le genre fossile d'insectes Meganeura vivait au Carbonifère.",
    ])
      expect(isArthropod({ extract }), extract).toBe(true);
  });

  it("laisse visibles les crustacés et les autres animaux", () => {
    for (const s of [
      {
        description: "espèce de crustacés",
        extract: "Le Crabe vert est une espèce de crabes de la famille des Carcinidae.",
      },
      { description: "espèce de mammifères", extract: "Le Pangolin se nourrit de fourmis et de termites." },
      { description: "espèce de lézards", extract: "Le Lézard des murailles est une espèce de lézards insectivore." },
      {
        description: "espèce d'oiseaux",
        extract: "L'Hirondelle rustique est un oiseau qui chasse les insectes en vol.",
      },
    ])
      expect(isArthropod(s), s.description).toBe(false);
  });

  it("ne floute pas ce qui porte seulement un nom d'arthropode", () => {
    for (const s of [
      { description: "groupe de hard rock allemand", extract: "Scorpions est un groupe de hard rock allemand." },
      { description: "film de David Cronenberg sorti en 1986", extract: "La Mouche est un film américain." },
      { description: "super-héros de fiction de Marvel Comics", extract: "Spider-Man est un super-héros." },
      { description: "constellation", extract: "Le Scorpion est une constellation du zodiaque." },
      { description: "produit chimique", extract: "Un insecticide est une substance active." },
      { description: null, extract: null },
      {},
    ])
      expect(isArthropod(s), s.description ?? "vide").toBe(false);
  });
});
