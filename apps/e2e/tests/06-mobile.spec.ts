import { expect, test } from "@playwright/test";
import { newPlayer } from "./helpers";

test("téléphone : les cartes du paquet sortent une par une, sans défiler", async ({ browser }) => {
  const { page } = await newPlayer(browser, "mobi", {
    viewport: { width: 390, height: 664 },
    hasTouch: true,
    isMobile: true,
  });

  await page.getByRole("button", { name: "Ouvrir un paquet" }).click();
  const pack = page.getByRole("region", { name: "Ouverture de paquet" });

  // Une seule vignette à la fois, entière à l'écran.
  await expect(pack.locator("article.pc-card")).toHaveCount(1);
  await expect(pack.getByText("1/10")).toBeVisible();
  const primary = pack.getByRole("button", { name: /^(Retourner|Suivante|Voir le paquet)$/ });
  const box = await primary.boundingBox();
  expect(box && box.y + box.height).toBeLessThanOrEqual(664);

  // « Suivante » jusqu'au bout (chaque carte se retourne d'abord), puis le récapitulatif.
  const recap = page.getByRole("heading", { name: "Ce paquet" });
  for (let i = 0; i < 25 && !(await recap.isVisible()); i++) await primary.click();
  await expect(recap).toBeVisible();
  await expect(pack.getByRole("button", { name: /^Revoir / })).toHaveCount(10);

  // Une ligne du récapitulatif remontre la carte en grand.
  await pack
    .getByRole("button", { name: /^Revoir / })
    .nth(3)
    .click();
  await expect(pack.getByText("4/10")).toBeVisible();
  await pack.getByRole("button", { name: "Tout voir" }).click();
  await expect(page.getByRole("button", { name: "Ouvrir le suivant" })).toBeVisible();
});
