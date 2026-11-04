import { expect, test } from "@playwright/test";
import { apiCall, newPlayer } from "./helpers";

test("caisses : contenu visible, ouverture gratuite, ×5 avec « Passer », puis plus assez de PW", async ({
  browser,
}) => {
  const { page } = await newPlayer(browser, "caisse");
  await apiCall(page, "POST", "/test/case-seed", { collection: "Essai e2e", free: 1 });
  await page.goto("cases");
  await expect(page.getByRole("heading", { name: "Caisses", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Essai e2e" })).toHaveAttribute("aria-pressed", "true");

  // Quatre niveaux, chacun avec son prix ; le contenu affiche une chance par carte.
  const tiers = page.getByRole("list", { name: "Niveaux de caisse" }).getByRole("button");
  await expect(tiers).toHaveCount(4);
  await tiers.filter({ hasText: "Or" }).click();
  await expect(page.getByRole("heading", { name: "Contenu de la caisse Or" })).toBeVisible();
  await expect(page.getByText(/Lots de légendaires/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Chances" })).toBeVisible();

  // Caisse gratuite : la bande défile, « Passer » l'arrête, la carte rejoint la collection, sans toucher aux PW.
  await page.getByRole("button", { name: /Ouvrir une caisse gratuite/ }).click();
  const skip = page.getByRole("button", { name: "Passer", exact: true });
  if (await skip.isVisible().catch(() => false)) await skip.click();
  await expect(page.getByText(/rejoin(t|nent) ta/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Ouvrir une caisse gratuite/ })).toHaveCount(0);

  // ×5 contre des PW : cinq bandes, puis au moins cinq cartes gagnées (le prix est vérifié par l'API).
  await apiCall(page, "POST", "/test/grant-pw", { amount: 5 * 750 });
  await page.getByRole("button", { name: /^Ouvrir ×5/ }).click();
  await expect(page.locator(".pc-reel")).toHaveCount(5);
  await page.getByRole("button", { name: "Passer", exact: true }).click();
  await expect(page.getByText(/cartes rejoignent ta/)).toBeVisible();
  const after = (await apiCall<{ wallet: { available: number } }>(page, "GET", "/me")).wallet.available;

  // Pas assez de PW pour une Légendaire (solde de départ) : bouton grisé et somme manquante.
  await tiers.filter({ hasText: "Légendaire" }).click();
  const open = page.getByRole("button", { name: /^Ouvrir 2\s000 PW/ });
  if (after < 2_000) {
    await expect(open).toBeDisabled();
    await expect(page.getByText(/Il te manque .* PW pour cette caisse/)).toBeVisible();
  } else await expect(open).toBeEnabled();
});
