import { expect, test } from "@playwright/test";
import { apiCall, instantPacks, newPlayer } from "./helpers";

test("inscription → ouvrir un paquet → recycler un doublon", async ({ browser }) => {
  const { page } = await newPlayer(browser, "alice");

  // Ouverture animée : la pochette, puis les 10 cartes retournées une à une.
  await expect(page.getByRole("heading", { name: "Paquets", level: 1 })).toBeVisible();
  await expect(page.getByRole("main").getByTitle("Stock : 30/30")).toBeVisible();
  await page.getByRole("button", { name: "Ouvrir un paquet" }).click();
  const pack = page.getByRole("region", { name: "Ouverture de paquet" });
  await expect(pack.locator("article.pc-card")).toHaveCount(10);
  await page
    .getByRole("button", { name: "Tout retourner" })
    .click({ timeout: 5_000 })
    .catch(() => {});
  await expect(page.getByRole("main").getByTitle("Stock : 29/30")).toBeVisible();

  // Mode instantané, puis quelques paquets pour obtenir un doublon.
  await instantPacks(page);
  await page.reload();
  for (let i = 0; i < 8; i++) await apiCall(page, "POST", "/packs/open");

  await page.goto("collection");
  await expect(page.getByRole("heading", { name: "Collection" })).toBeVisible();
  await expect(page.getByText("90 cartes", { exact: true })).toBeVisible();

  // Doublon garanti : un exemplaire de plus d'un article déjà possédé.
  await apiCall(page, "POST", "/test/grant-card", {});
  await page.reload();
  const dups = await apiCall<{ instanceIds: number[]; gain: number }>(page, "GET", "/collection/duplicates");
  expect(dups.instanceIds.length).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Recycler les doublons" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /Recycler \(\+/ }).click();
  await expect(page.getByText(/recyclées? : +/).first()).toBeVisible();

  // Le solde bouge aussi avec les succès (en arrière-plan) : on vérifie la ligne de ledger du recyclage.
  const history = await apiCall<{ reason: string; delta: number }[]>(page, "GET", "/wallet/history");
  expect(history.find((h) => h.reason === "recycle")?.delta).toBe(dups.gain);
});

test("fiche carte et catalogue", async ({ browser }) => {
  const { page } = await newPlayer(browser, "bob");
  await page.goto("cards?q=synthetique%20n%C2%B0%207");
  await expect(page.locator("article.pc-card").first()).toBeVisible();
  await page.locator("article.pc-card h3 a").first().click();
  await expect(page).toHaveURL(/\/card\/\d+$/);

  // Depuis une vignette, la fiche s'ouvre par-dessus le catalogue, qui reste en place dessous.
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("heading", { name: "Détenteurs" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Toutes les cartes", level: 1 })).toBeAttached();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(page).toHaveURL(/\/cards\?q=/);

  // Rouverte puis fermée au bouton ; un chargement direct de la fiche affiche la page complète.
  await page.locator("article.pc-card h3 a").first().click();
  await sheet.getByRole("button", { name: "Fermer la fiche" }).click();
  await expect(sheet).toBeHidden();
  await page.locator("article.pc-card h3 a").first().click();
  await expect(sheet).toBeVisible();
  await page.reload();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByRole("heading", { name: "Détenteurs" })).toBeVisible();
});

test("la fiche d'une carte tirée s'ouvre sans quitter l'ouverture du paquet", async ({ browser }) => {
  const { page } = await newPlayer(browser, "fiche");
  await page.getByRole("button", { name: "Ouvrir un paquet" }).click();
  const pack = page.getByRole("region", { name: "Ouverture de paquet" });
  await page.getByRole("button", { name: "Tout retourner" }).click();
  await pack.locator("article.pc-card h3 a").first().click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Mes exemplaires" })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Fermer la fiche" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(pack.locator("article.pc-card")).toHaveCount(10);
});

test("tout sélectionner les cartes du filtre pour les recycler", async ({ browser }) => {
  const { page } = await newPlayer(browser, "tri");
  await instantPacks(page);
  for (let i = 0; i < 3; i++) await apiCall(page, "POST", "/packs/open");
  const commons = await apiCall<{ total: number }>(page, "GET", "/collection?rarity=C&limit=1");
  expect(commons.total).toBeGreaterThan(0);
  // Une commune peut sortir brillante (0,1 % par carte) : sélectionnée, elle n'est pas recyclée.
  const guarded = (await apiCall<{ protected: number }>(page, "GET", "/collection/selectable?rarity=C")).protected;
  const recycled = commons.total - guarded;

  await page.goto("collection");
  await page.getByRole("button", { name: "Sélectionner", exact: true }).click();
  await page
    .getByRole("group", { name: /rareté/i })
    .getByRole("button", { name: /^Commune/ })
    .click();
  await expect(page.getByText(`${commons.total} carte`, { exact: false }).first()).toBeVisible();
  const bar = page.getByRole("region", { name: "Actions sur la sélection" });
  await bar.getByRole("button", { name: "Tout sélectionner" }).click();
  await expect(bar.getByRole("button", { name: "Tout désélectionner" })).toBeVisible();
  await expect(bar.getByText(`${commons.total} sélectionnée`)).toBeVisible();
  await bar.getByRole("button", { name: /^Recycler \(\+/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: `Recycler ${recycled} carte`, exact: false })).toBeVisible();
  await dialog.getByRole("button", { name: /Recycler \(\+/ }).click();
  await expect(page.getByText(`${recycled} cartes recyclées`, { exact: false })).toBeVisible();
  expect((await apiCall<{ total: number }>(page, "GET", "/collection?rarity=C&limit=1")).total).toBe(guarded);
});

test("« Doublons » trie par nombre d'exemplaires, sauf tri choisi à la main", async ({ browser }) => {
  const { page } = await newPlayer(browser, "dups");
  await instantPacks(page);
  await apiCall(page, "POST", "/packs/open");
  await apiCall(page, "POST", "/test/grant-card", { count: 3 });

  await page.goto("collection");
  const sort = page.getByRole("combobox", { name: "Trier" });
  await expect(sort).toHaveValue("rarity");
  const duplicates = page.getByRole("button", { name: "Doublons", exact: true });
  await duplicates.click();
  await expect(sort).toHaveValue("copies");
  await duplicates.click();
  await expect(sort).toHaveValue("rarity");

  // Un tri choisi à la main reste en place.
  await sort.selectOption("title");
  await duplicates.click();
  await expect(sort).toHaveValue("title");
});

test("fusionne les doublons d'un coup, puis met une sélection en favori et la tague", async ({ browser }) => {
  const { page } = await newPlayer(browser, "lot");
  await instantPacks(page);
  await apiCall(page, "POST", "/packs/open");
  const { instanceIds } = await apiCall<{ instanceIds: number[] }>(page, "POST", "/test/grant-card", { count: 3 });
  const [granted] = await apiCall<{ cardId: number }[]>(page, "GET", `/collection/instances?ids=${instanceIds[0]}`);

  // Fusion en masse : l'aperçu annonce les doublons consommés, puis le meilleur exemplaire monte.
  await page.goto("collection");
  await page.getByRole("button", { name: "Fusionner les doublons" }).click();
  const fusion = page.getByRole("dialog");
  await expect(fusion.getByRole("heading", { name: "Fusionner les doublons ?" })).toBeVisible();
  await expect(fusion.getByText(/tu renonces aux \d+ PW/)).toBeVisible();
  await fusion.getByRole("button", { name: /^Fusionner \d+ doublons?$/ }).click();
  await expect(page.getByText(/montées? de \d+ niveaux?/)).toBeVisible();
  const copies = await apiCall<{ items: { cardId: number; level: number }[] }>(page, "GET", "/collection?limit=120");
  // Quatre exemplaires (celui du paquet et trois donnés) : le meilleur gagne trois niveaux.
  expect(
    Math.max(...copies.items.filter((c) => c.cardId === granted!.cardId).map((c) => c.level)),
  ).toBeGreaterThanOrEqual(4);

  // Sélection : deux cartes en favori, puis un tag sur les deux.
  await page.getByRole("button", { name: "Sélectionner", exact: true }).click();
  const cards = page.getByRole("button", { name: /, attaque \d/ });
  await cards.nth(0).click();
  await cards.nth(1).click();
  const bar = page.getByRole("region", { name: "Actions sur la sélection" });
  await expect(bar.getByText("2 sélectionnées")).toBeVisible();
  await bar.getByRole("button", { name: "Favori", exact: true }).click();
  await expect(page.getByText("2 cartes en favori.")).toBeVisible();
  await expect(bar.getByRole("button", { name: "Retirer des favoris" })).toBeVisible();
  expect((await apiCall<{ total: number }>(page, "GET", "/collection?favorites=only&limit=1")).total).toBe(2);

  await bar.getByRole("button", { name: "Tag", exact: true }).click();
  const tag = page.getByRole("dialog", { name: "Tag sur 2 cartes" });
  await tag.getByLabel("Tag").fill("Châteaux");
  await tag.getByRole("button", { name: "Ajouter à 2 cartes" }).click();
  await expect(page.getByText("« châteaux » ajouté à 2 cartes.")).toBeVisible();
  expect((await apiCall<{ total: number }>(page, "GET", "/collection?tag=ch%C3%A2teaux&limit=1")).total).toBe(2);
  // Filtre « Sans favoris » : les deux cartes disparaissent de la liste.
  await bar.getByRole("button", { name: "Quitter la sélection" }).click();
  const all = (await apiCall<{ total: number }>(page, "GET", "/collection?limit=1")).total;
  await page.getByRole("button", { name: "Sans favoris" }).click();
  await expect(page.getByText(`${all - 2} cartes`, { exact: true })).toBeVisible();
});

test("redirige vers la connexion sans session", async ({ page }) => {
  await page.goto("collection");
  await expect(page).toHaveURL(/\/login\?next=/);
  await expect(page.getByRole("heading", { name: "Connexion" })).toBeVisible();
});
