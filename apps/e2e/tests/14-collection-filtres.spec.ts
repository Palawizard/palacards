import { expect, test } from "@playwright/test";
import { apiCall, instantPacks, newPlayer } from "./helpers";

test("collection : filtres de niveau et de stats cumulés, gardés dans l'adresse (suggestion n° 115)", async ({
  browser,
}) => {
  const { page } = await newPlayer(browser, "filtres");
  await instantPacks(page);
  await apiCall(page, "POST", "/packs/open");

  await page.goto("collection");
  const cards = page.getByText(/^\d+ cartes?$/);
  await expect(cards).toHaveText(/^\d+ cartes?$/);
  const all = await cards.textContent();

  // Toutes les cartes neuves sont au niveau 1 : « niveau 2 » ne garde rien.
  await page.getByRole("button", { name: "Niveau 2" }).click();
  await expect(page.getByText("Aucune carte ne correspond")).toBeVisible();
  await expect(page.getByText("1 filtre actif")).toBeVisible();
  await expect(page).toHaveURL(/levels=2/);

  // Niveaux 1 et 2, plus une ATK minimale impossible : rien non plus (ET logique).
  await page.getByRole("button", { name: "Niveau 1" }).click();
  await expect(cards).toHaveText(all!);
  await page.getByText("Stats minimales").click();
  await page.getByLabel("ATK minimale").fill("99999");
  await expect(page.getByText("Aucune carte ne correspond")).toBeVisible();
  await expect(page.getByText("2 filtres actifs")).toBeVisible();

  // Le rechargement retrouve les filtres ; « Réinitialiser » les retire tous.
  await expect(page).toHaveURL(/minAtk=32767/);
  await page.reload();
  await expect(page.getByText("Aucune carte ne correspond")).toBeVisible();
  await page.getByRole("button", { name: "Réinitialiser", exact: true }).click();
  await expect(cards).toHaveText(all!);
  await expect(page).toHaveURL(/\/collection$/);
});
