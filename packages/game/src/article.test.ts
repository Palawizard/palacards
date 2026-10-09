import { describe, expect, it } from "vitest";
import {
  ARTICLE_MAX_GUESSES,
  allGood,
  articleHints,
  articleImageWidth,
  articleReward,
  attrValues,
  compactViews,
  compareAttrs,
  hintCategories,
  maskedDescription,
  shareGrid,
  titlePattern,
  type ArticleAttrs,
} from "./article.js";
import { articleCategory, descriptionType, typeStem } from "./category.js";

const attrs = (over: Partial<ArticleAttrs>): ArticleAttrs => ({
  category: "personne",
  type: "acteur",
  countryId: "Q142",
  country: "France",
  continents: ["Q46"],
  year: 1950,
  rarity: "UR",
  views: 1_000_000,
  ...over,
});

describe("catégories d'articles", () => {
  it("classe d'après la description courte", () => {
    expect(articleCategory("acteur américain")).toBe("personne");
    expect(articleCategory("actrice et chanteuse française")).toBe("personne");
    expect(articleCategory("homme politique français")).toBe("personne");
    expect(articleCategory("footballeur international portugais")).toBe("personne");
    expect(articleCategory("pianiste et compositeur polonais")).toBe("personne");
    expect(articleCategory("personnage de fiction de Marvel")).toBe("personne");
    expect(articleCategory("commune française du département du Nord")).toBe("lieu");
    expect(articleCategory("Île de la mer Méditerranée")).toBe("lieu");
    expect(articleCategory("presqu'île de Bretagne")).toBe("lieu");
    expect(articleCategory("gratte-ciel de New York")).toBe("lieu");
    expect(articleCategory("chaîne de montagnes d'Europe")).toBe("lieu");
    expect(articleCategory("film américain de Christopher Nolan")).toBe("oeuvre");
    expect(articleCategory("série télévisée américaine")).toBe("oeuvre");
    expect(articleCategory("jeu vidéo de Nintendo")).toBe("oeuvre");
    expect(articleCategory("bande dessinée franco-belge")).toBe("oeuvre");
    expect(articleCategory("album de Daft Punk")).toBe("oeuvre");
    expect(articleCategory("roman de Victor Hugo")).toBe("oeuvre");
    expect(articleCategory("entreprise américaine")).toBe("organisation");
    expect(articleCategory("club de football français")).toBe("organisation");
    expect(articleCategory("parti politique français")).toBe("organisation");
    expect(articleCategory("chaîne de télévision française")).toBe("organisation");
    expect(articleCategory("groupe de rock britannique")).toBe("organisation");
    expect(articleCategory("station de radio française")).toBe("organisation");
    expect(articleCategory("espèce d'oiseaux")).toBe("autre");
    expect(articleCategory("planète du Système solaire")).toBe("autre");
    expect(articleCategory("jeux Olympiques d'été")).toBe("autre");
  });

  it("se replie sur « autre » sans description, et suit l'indice « humain »", () => {
    expect(articleCategory(null)).toBe("autre");
    expect(articleCategory("")).toBe("autre");
    expect(articleCategory("chose mystérieuse")).toBe("autre");
    expect(articleCategory(null, { human: true })).toBe("personne");
    expect(articleCategory("liste de films")).toBe("autre");
  });

  it("donne le type (premier mot) et sa racine au masculin", () => {
    expect(descriptionType("Acteur américain")).toBe("acteur");
    expect(descriptionType("commune, Nord")).toBe("commune");
    expect(descriptionType(null)).toBeNull();
    expect(typeStem("actrice")).toBe(typeStem("acteur"));
    expect(typeStem("chanteuse")).toBe(typeStem("chanteur"));
    expect(typeStem("comédienne")).toBe(typeStem("comédien"));
    expect(typeStem("film")).not.toBe(typeStem("acteur"));
  });
});

describe("article du jour : comparaison des attributs", () => {
  it("met tout en vert pour la réponse elle-même", () => {
    const a = attrs({});
    expect(allGood(compareAttrs(a, a))).toBe(true);
  });

  it("orange : type proche, même continent, à 10 ans près, à 25 % des vues", () => {
    const c = compareAttrs(
      attrs({ type: "actrice", countryId: "Q183", country: "Allemagne", year: 1958, views: 800_000 }),
      attrs({}),
    );
    expect(c.category).toEqual({ state: "good", arrow: null });
    expect(c.type.state).toBe("near");
    expect(c.country.state).toBe("near");
    expect(c.year).toEqual({ state: "near", arrow: "down" });
    expect(c.views).toEqual({ state: "near", arrow: "up" });
  });

  it("rouge et flèches au-delà", () => {
    const c = compareAttrs(
      attrs({
        category: "lieu",
        type: "commune",
        countryId: "Q30",
        continents: ["Q49"],
        year: 1900,
        rarity: "SR",
        views: 10_000,
      }),
      attrs({ rarity: "L" }),
    );
    expect(c.category.state).toBe("bad");
    expect(c.type.state).toBe("bad");
    expect(c.country.state).toBe("bad");
    expect(c.year).toEqual({ state: "bad", arrow: "up" });
    expect(c.rarity).toEqual({ state: "bad", arrow: "up" });
    expect(c.views).toEqual({ state: "bad", arrow: "up" });
  });

  it("n'est jamais faux sur un attribut inconnu", () => {
    const c = compareAttrs(attrs({ category: null, type: null, countryId: null, year: null, views: 0 }), attrs({}));
    for (const k of ["category", "type", "country", "year", "views"] as const) expect(c[k].state).toBe("unknown");
    expect(attrValues(attrs({ country: null, year: null, views: 0 }))).toMatchObject({
      country: "?",
      year: "?",
      views: "?",
    });
    expect(attrValues(attrs({ year: -52 })).year).toBe("52 av. J.-C.");
  });

  it("écrit les vues en abrégé", () => {
    expect(compactViews(1_234_567)).toBe("1,2 M");
    expect(compactViews(850_400)).toBe("850 k");
    expect(compactViews(900)).toBe("900");
  });
});

describe("article du jour : récompense, indices, image, partage", () => {
  it("paie 70 PW plus un bonus de 30 qui baisse de 5 par essai", () => {
    expect(articleReward(1)).toBe(100);
    expect(articleReward(2)).toBe(95);
    expect(articleReward(6)).toBe(75);
    expect(articleReward(7)).toBe(70);
    expect(articleReward(ARTICLE_MAX_GUESSES)).toBe(70);
    expect(articleReward(ARTICLE_MAX_GUESSES + 1)).toBe(0);
    expect(articleReward(3, false)).toBe(0);
  });

  it("dévoile les catégories après 2, 3 et 5 essais, la description après 4, la première lettre après 6", () => {
    expect(articleHints(1, false)).toEqual({ categories: 0, description: false, firstLetter: false });
    expect(articleHints(2, false)).toEqual({ categories: 1, description: false, firstLetter: false });
    expect(articleHints(3, false)).toEqual({ categories: 2, description: false, firstLetter: false });
    expect(articleHints(4, false)).toEqual({ categories: 2, description: true, firstLetter: false });
    expect(articleHints(5, false)).toEqual({ categories: 3, description: true, firstLetter: false });
    expect(articleHints(6, false)).toEqual({ categories: 3, description: true, firstLetter: true });
    expect(articleHints(0, true)).toEqual({ categories: 3, description: true, firstLetter: true });
    expect(maskedDescription("tour en fer puddlé de Paris, dite tour Eiffel", "Tour Eiffel")).not.toMatch(/eiffel/i);
    expect(titlePattern("Tour Eiffel", "first")).toBe("T _ _ _   _ _ _ _ _ _");
  });

  it("choisit des catégories qui ne nomment pas la réponse, les plus générales d'abord", () => {
    const raw = [
      "Catégorie:Tour en France",
      "Catégorie:Monument de Paris",
      "Catégorie:Gustave Eiffel",
      "Catégorie:Article de qualité",
      "Catégorie:Portail:Paris/Articles liés",
      "Catégorie:Page utilisant P1435",
      "Catégorie:Tours d'observation",
      "Catégorie:Édifice construit en 1889",
      "Catégorie:Monument historique classé en 1964",
      "Catégorie:Monument de Paris",
    ];
    expect(hintCategories(raw, "Tour Eiffel")).toEqual([
      "Monument de Paris",
      "Édifice construit en 1889",
      "Monument historique classé en 1964",
    ]);
    // Accents ignorés, précision entre parenthèses retirée, titre court comparé mot à mot.
    expect(hintCategories(["Élan en Europe", "Cervidé"], "Elan (animal)")).toEqual(["Cervidé"]);
    expect(hintCategories(["Satellite de Jupiter", "Objet céleste découvert en 1610"], "Io (lune)")).toEqual([
      "Satellite de Jupiter",
      "Objet céleste découvert en 1610",
    ]);
    expect(hintCategories([], "Tour Eiffel")).toEqual([]);
  });

  it("précise l'image à chaque essai, entière à la fin", () => {
    const widths = Array.from({ length: ARTICLE_MAX_GUESSES }, (_, i) => articleImageWidth(i, false)!);
    for (let i = 1; i < widths.length; i++) expect(widths[i]!).toBeGreaterThan(widths[i - 1]!);
    expect(articleImageWidth(20, false)).toBe(widths.at(-1));
    expect(articleImageWidth(3, true)).toBeNull();
  });

  it("partage une grille de couleurs sans spoiler", () => {
    const answer = attrs({});
    const rows = [
      compareAttrs(attrs({ category: "lieu", type: null, year: 1955 }), answer),
      compareAttrs(answer, answer),
    ];
    expect(shareGrid(rows, true, 12)).toBe("PalaCards · Article du jour n° 12 · 2/8\n🟥⬜🟩🟧🟩🟩\n🟩🟩🟩🟩🟩🟩");
    expect(shareGrid(rows.slice(0, 1), false, 3).split("\n")[0]).toBe("PalaCards · Article du jour n° 3 · X/8");
  });
});
