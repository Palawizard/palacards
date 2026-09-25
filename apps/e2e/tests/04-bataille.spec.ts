import { expect, test, type Page } from "@playwright/test";
import { apiCall, newPlayer } from "./helpers";

async function buildDeck(page: Page) {
  await page
    .getByRole("button", { name: /Mes 5 meilleures attaques/ })
    .first()
    .click();
}

/** Joue toutes les manches proposées à l'écran (asynchrone). */
async function playAsync(page: Page) {
  const finished = page.getByText(/^(Victoire|Défaite|Match nul)$/);
  const waiting = page.getByText(/Le résultat tombera quand/);
  for (let r = 1; r <= 5; r++) {
    const start = page.getByRole("button", { name: new RegExp(`Jouer la manche ${r}|Manche suivante`) });
    // Le duel peut se terminer avant la 5e manche (3 manches gagnées).
    await expect(start.or(finished).or(waiting)).toBeVisible();
    if (!(await start.isVisible())) break;
    // Le bouton peut disparaître si le duel se conclut entre-temps : on s'arrête alors.
    if (
      !(await start.click({ timeout: 5_000 }).then(
        () => true,
        () => false,
      ))
    )
      break;
    const choice = page.locator("section[aria-label^='Manche'] button.btn").first();
    if (
      !(await choice.click({ timeout: 10_000 }).then(
        () => true,
        () => false,
      ))
    )
      break;
    await expect(page.getByRole("status").or(finished)).toBeVisible();
  }
}

test("duel asynchrone complet", async ({ browser }) => {
  const alice = await newPlayer(browser, "alice");
  const bob = await newPlayer(browser, "bob");
  await apiCall(alice.page, "POST", "/packs/open");
  await apiCall(bob.page, "POST", "/packs/open");

  // Alice défie Bob en asynchrone avec ses 5 meilleures cartes.
  await alice.page.goto(`battle?opponent=${bob.name}`);
  await buildDeck(alice.page);
  await alice.page.getByRole("button", { name: "Défier" }).click();
  await expect(alice.page).toHaveURL(/\/battle\/\d+$/);
  await expect(alice.page.getByText(`En attente de la réponse de ${bob.name}`)).toBeVisible();

  // Bob accepte avec son deck, joue ses 5 manches.
  await bob.page.goto("battle");
  await bob.page.getByRole("button", { name: "Choisir mon deck" }).click();
  await buildDeck(bob.page);
  await bob.page.getByRole("button", { name: "Accepter le duel" }).click();
  await expect(bob.page).toHaveURL(/\/battle\/\d+$/);
  await playAsync(bob.page);
  await expect(bob.page.getByText(/Le résultat tombera quand/)).toBeVisible();

  // Alice joue à son tour : le résultat s'affiche, avec l'Elo et le deck adverse.
  await alice.page.reload();
  await playAsync(alice.page);
  await alice.page.reload();
  await expect(alice.page.getByText(/Victoire|Défaite|Match nul/).first()).toBeVisible();
  await expect(alice.page.getByRole("heading", { name: `Deck de ${bob.name}` })).toBeVisible();
  await bob.page.goto("battle");
  await expect(bob.page.getByRole("heading", { name: "Historique" })).toBeVisible();
  await expect(bob.page.getByText(new RegExp(`(Victoire|Défaite|Nul) contre ${alice.name}`))).toBeVisible();
});

test("duel en direct : manches cadencées par le serveur", async ({ browser }) => {
  test.setTimeout(120_000);
  const alice = await newPlayer(browser, "live1");
  const bob = await newPlayer(browser, "live2");
  await apiCall(alice.page, "POST", "/packs/open");
  await apiCall(bob.page, "POST", "/packs/open");
  await alice.page.goto(`battle?opponent=${bob.name}`);
  await alice.page.getByRole("button", { name: "En direct" }).click();
  await buildDeck(alice.page);
  await alice.page.getByRole("button", { name: "Défier" }).click();
  await expect(alice.page).toHaveURL(/\/battle\/\d+$/);

  await bob.page.goto("battle");
  await bob.page.getByRole("button", { name: "Choisir mon deck" }).click();
  await buildDeck(bob.page);
  await bob.page.getByRole("button", { name: "Accepter le duel" }).click();
  await expect(bob.page).toHaveURL(/\/battle\/\d+$/);
  await alice.page.reload();

  // Chaque manche arrive en même temps chez les deux ; on répond jusqu'à la fin du duel.
  for (let round = 1; round <= 5; round++) {
    const done = alice.page.getByText(/^(Victoire|Défaite|Match nul)$/);
    if (await done.isVisible().catch(() => false)) break;
    for (const p of [alice.page, bob.page]) {
      const panel = p.locator(`section[aria-label='Manche ${round}']`);
      await expect(panel).toBeVisible({ timeout: 20_000 });
      await panel.locator("button.btn").first().click();
    }
    await expect(alice.page.getByRole("status")).toBeVisible();
    await alice.page.waitForTimeout(3_000);
    await alice.page.reload();
    await bob.page.reload();
    if (
      await alice.page
        .getByText(/^(Victoire|Défaite|Match nul)$/)
        .isVisible()
        .catch(() => false)
    )
      break;
  }
  await expect(alice.page.getByText(/^(Victoire|Défaite|Match nul)$/)).toBeVisible({ timeout: 30_000 });
});
