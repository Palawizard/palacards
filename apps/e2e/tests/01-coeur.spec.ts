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
  await expect(page.getByRole("heading", { name: "Détenteurs" })).toBeVisible();
});

test("redirige vers la connexion sans session", async ({ page }) => {
  await page.goto("collection");
  await expect(page).toHaveURL(/\/login\?next=/);
  await expect(page.getByRole("heading", { name: "Connexion" })).toBeVisible();
});
