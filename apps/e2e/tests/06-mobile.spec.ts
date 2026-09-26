import { expect, test } from "@playwright/test";
import { apiCall, newPlayer } from "./helpers";

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

test("téléphone : la wishlist est accessible depuis le menu et les onglets du marché tiennent à l'écran", async ({
  browser,
}) => {
  const { page } = await newPlayer(browser, "wish", {
    viewport: { width: 360, height: 740 },
    hasTouch: true,
    isMobile: true,
  });
  const opened = await apiCall<{ cards: { cardId: number; title: string }[] }>(page, "POST", "/packs/open");
  const wanted = opened.cards[0]!;
  await apiCall(page, "PUT", `/wishlist/${wanted.cardId}`);

  // Entrée « Wishlist » dans le menu, page dédiée avec la carte suivie.
  await page.getByRole("button", { name: "Ouvrir le menu" }).click();
  await page.getByRole("link", { name: "Wishlist" }).click();
  await expect(page).toHaveURL(/\/palacards\/wishlist$/);
  await expect(page.getByRole("heading", { name: "Wishlist" })).toBeVisible();
  await expect(page.getByRole("button", { name: `Retirer ${wanted.title} de ma wishlist` })).toBeVisible();

  // Aucun onglet du marché ne déborde de l'écran.
  await page.goto("market");
  const tabs = page.getByRole("navigation", { name: "Onglets du marché" }).getByRole("button");
  await expect(tabs).toHaveCount(3);
  for (const tab of await tabs.all()) {
    const box = await tab.boundingBox();
    expect(box && box.x + box.width).toBeLessThanOrEqual(360);
  }

  // L'ancienne adresse de l'onglet renvoie vers la page.
  await page.goto("market?scope=wishlist");
  await expect(page).toHaveURL(/\/palacards\/wishlist$/);
});
