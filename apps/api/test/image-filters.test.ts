import { schema, sql } from "@palacards/db";
import { afterAll, describe, expect, it } from "vitest";
import { makeApp, signUp, signUpAdmin } from "./helpers.js";

const { app, ctx } = await makeApp();
afterAll(() => app.close());

/** Trois articles de la saison active, avec un résumé en cache choisi par le test. */
async function articles(summaries: { description: string; extract?: string }[]) {
  const rows = await ctx.db.execute<{ id: string }>(sql`
    select c.id from cards c join seasons s on s.id = c.season and s.status = 'active'
    where not exists (select 1 from wiki_summaries w where w.page_id = c.id)
    order by c.id desc limit ${summaries.length}
  `);
  const ids = rows.map((r) => Number(r.id));
  await ctx.db.insert(schema.wikiSummaries).values(
    summaries.map((s, i) => ({
      pageId: ids[i]!,
      description: s.description,
      extract: s.extract ?? null,
      thumbUrl: "https://upload.wikimedia.org/x.jpg",
      pageUrl: "https://fr.wikipedia.org/wiki/X",
      status: "ok" as const,
    })),
  );
  return ids;
}

describe("filtres d'images (suggestion n° 111)", () => {
  it("garde le réglage de chaque joueur, coupé par défaut", async () => {
    const p = await signUp(app);
    expect((await p.get("/me")).body).toMatchObject({ hideArthropods: false, hideGore: false, hideNudity: false });
    expect((await p.patch("/me/settings", { hideGore: true })).status).toBe(200);
    expect((await p.get("/me")).body).toMatchObject({ hideGore: true, hideNudity: false });
    const other = await signUp(app);
    expect((await other.get("/me")).body.hideGore).toBe(false);
  });

  it("repère les thèmes par le résumé et par les catégories, et pas les autres", async () => {
    const p = await signUp(app);
    const [skin, spider, plain, nude] = await articles([
      { description: "maladie de la peau" },
      { description: "espèce d'araignées" },
      { description: "commune française" },
      { description: "commune française" },
    ]);
    await ctx.db.insert(schema.imageFilterCards).values({ cardId: nude!, theme: "nudity" });
    const res = await p.get(`/cards/image-flags?ids=${[skin, spider, plain, nude].join(",")}`);
    expect(res.status).toBe(200);
    expect(res.body.themes[skin!]).toEqual(["gore"]);
    expect(res.body.themes[spider!]).toEqual(["arthropods"]);
    expect(res.body.themes[nude!]).toEqual(["nudity"]);
    expect(res.body.themes[plain!]).toBeUndefined();
    // L'ancienne route des arthropodes répond toujours.
    expect((await p.get(`/cards/arthropods?ids=${spider}`)).body.arthropods).toEqual([spider]);
  });

  it("donne toujours le dernier mot à la liste Admin", async () => {
    const admin = await signUpAdmin(app, ctx);
    const p = await signUp(app);
    const [skin, plain] = await articles([{ description: "lésion cutanée" }, { description: "ville d'Italie" }]);
    expect((await p.put("/admin/image-filters", { cardId: plain, theme: "nudity", flagged: true })).status).toBe(403);
    expect((await admin.put("/admin/image-filters", { cardId: plain, theme: "nudity", flagged: true })).status).toBe(
      200,
    );
    expect((await admin.put("/admin/image-filters", { cardId: skin, theme: "gore", flagged: false })).status).toBe(200);
    const flags = (await p.get(`/cards/image-flags?ids=${skin},${plain}`)).body.themes;
    expect(flags[plain!]).toEqual(["nudity"]);
    expect(flags[skin!]).toBeUndefined();
    const list = (await admin.get("/admin/image-filters")).body.overrides;
    expect(list.filter((o: { cardId: number }) => [skin, plain].includes(o.cardId))).toHaveLength(2);
    // Rendue à la détection : de nouveau floutée.
    await admin.put("/admin/image-filters", { cardId: skin, theme: "gore", flagged: null });
    expect((await p.get(`/cards/image-flags?ids=${skin}`)).body.themes[skin!]).toEqual(["gore"]);
    // Recherche Admin par identifiant.
    const found = (await admin.get(`/admin/image-filters/search?q=${plain}`)).body;
    expect(found[0]).toMatchObject({ cardId: plain, themes: ["nudity"] });
  });

  it("figure dans l'export RGPD (réglages, choix d'un admin)", async () => {
    const admin = await signUpAdmin(app, ctx);
    await admin.patch("/me/settings", { hideNudity: true });
    const [card] = await articles([{ description: "statue" }]);
    await admin.put("/admin/image-filters", { cardId: card, theme: "nudity", flagged: true });
    const res = await admin.get("/me/export");
    expect(res.body.player.hideNudity).toBe(true);
    expect(res.body.imageFilterChoices).toEqual([expect.objectContaining({ cardId: card, theme: "nudity" })]);
  });
});
