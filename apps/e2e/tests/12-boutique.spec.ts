import { expect, test } from "@playwright/test";
import { apiCall, newPlayer } from "./helpers";

test("boutique du jour : 20 cartes, acheter une carte, puis « Achetée »", async ({ browser }) => {
  const { page } = await newPlayer(browser, "boutique");
  await apiCall(page, "POST", "/test/grant-pw", { amount: 10_000 });
  await page.goto("shop");
  await expect(page.getByRole("heading", { name: "Boutique du jour" })).toBeVisible();
  await expect(page.getByText(/Nouvelle sélection dans/)).toBeVisible();
  const buy = page.getByRole("button", { name: /^Acheter .* pour \d/ });
  await expect(buy).toHaveCount(20);

  // Filtre par rareté puis retour à toutes les cartes.
  const sr = page.getByRole("button", { name: /^Super rare \(\d+\)$/ });
  await sr.click();
  await expect(sr).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Toutes", exact: true }).click();

  // Une légendaire demande une confirmation ; les autres s'achètent directement.
  const first = buy.first();
  const label = (await first.getAttribute("aria-label"))!;
  await first.click();
  if (/3\s500\sPW$/.test(label))
    await page
      .locator("dialog[open]")
      .getByRole("button", { name: /^Acheter pour/ })
      .click();
  await expect(page.getByText(/rejoint ta collection/).first()).toBeVisible();
  await expect(page.getByText("Achetée", { exact: true })).toHaveCount(1);
  await expect(page.getByRole("button", { name: label })).toHaveCount(0);
  // Rechargement : l'achat est gardé, la sélection aussi.
  await page.reload();
  await expect(page.getByText("Achetée", { exact: true })).toHaveCount(1);
  await expect(buy).toHaveCount(19);
});
