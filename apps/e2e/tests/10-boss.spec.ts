import { expect, test } from "@playwright/test";
import { apiCall, instantPacks, newPlayer } from "./helpers";

test("boss du jour : choisir cinq articles, répondre aux questions, puis les voir au repos", async ({ browser }) => {
  const { page } = await newPlayer(browser, "boss");
  await instantPacks(page);
  for (let i = 0; i < 2; i++) await apiCall(page, "POST", "/packs/open");

  await page.goto("boss");
  await expect(page.getByRole("heading", { name: "Boss du jour", level: 1 })).toBeVisible();
  // Première visite : les règles sont dépliées.
  await expect(page.getByText(/quand une phase tombe, la suivante arrive aussitôt/)).toBeVisible();
  await expect(page.getByText(/^Faiblesse : /)).toBeVisible();
  await expect(page.getByRole("meter", { name: "Points de vie de la phase 1" })).toBeVisible();

  await page.getByRole("button", { name: "Mes 5 plus efficaces" }).click();
  await page.getByRole("button", { name: "Attaquer (5/5)" }).click();

  // Cinq questions : on répond la première proposition (ou une année) à chaque fois.
  const done = page.getByText(/^Assaut 1 terminé/);
  for (let i = 0; i < 40 && !(await done.isVisible()); i++) {
    const year = page.getByLabel("Ton année");
    const choice = page.locator("section[aria-labelledby='assault-title'] .btn.min-h-12").first();
    if (await year.isVisible()) {
      await year.fill("1900");
      await page.getByRole("button", { name: "Valider" }).click();
    } else if (await choice.isVisible()) {
      await choice.click();
    }
    await page.waitForTimeout(500);
  }
  await expect(done).toBeVisible({ timeout: 30_000 });

  // Les cinq articles joués se reposent trois jours, grisés dans le sélecteur.
  await expect(page.getByText("Reposée dans 3 jours")).toHaveCount(5);
  await expect(page.getByText(/1 assaut restant/)).toBeVisible();
});
