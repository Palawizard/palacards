import { expect, test, type Page } from "@playwright/test";
import { apiCall, newPlayer } from "./helpers";

async function buildDeck(page: Page) {
  await page
    .getByRole("button", { name: /Mes 5 meilleures attaques/ })
    .first()
    .click();
}

/** Joue un tour complet depuis l'écran des deux joueurs : attaque, bouclier, réponse. */
async function playTurn(a: Page, b: Page) {
  await expect(a.getByText(/À toi d’attaquer|choisit son attaque/)).toBeVisible({ timeout: 15_000 });
  const aAttacks = await a
    .getByText("À toi d’attaquer")
    .isVisible()
    .catch(() => false);
  const [attacker, defender] = aAttacks ? [a, b] : [b, a];
  await attacker.locator("button.duel-pick").first().click();
  await attacker.getByRole("button", { name: /Attaquer ·/ }).click();
  await expect(defender.getByText("Choisis ton bouclier")).toBeVisible();
  await defender.locator("button.duel-pick").first().click();
  await defender.getByRole("button", { name: /Se protéger/ }).click();
  const choices = defender.locator("section[aria-live] button.btn");
  await expect(choices.first()).toBeEnabled({ timeout: 15_000 });
  await choices.first().click();
  // Résultat du tour, en clair, chez les deux joueurs.
  // (dans l'arène : le journal reprend aussi les tours précédents).
  const outcome = /Attaque parée|Parade parfaite|Touché/;
  await expect(defender.locator("section[aria-live]").getByText(outcome)).toBeVisible();
  await expect(attacker.locator("section[aria-live]").getByText(outcome)).toBeVisible();
}

test("duel en direct : attaque, bouclier, question, abandon", async ({ browser }) => {
  test.setTimeout(150_000);
  const alice = await newPlayer(browser, "live1");
  const bob = await newPlayer(browser, "live2");
  await apiCall(alice.page, "POST", "/packs/open");
  await apiCall(bob.page, "POST", "/packs/open");

  // Pastille « Nouveau » sur Bataille jusqu'à la première visite.
  const battleLink = alice.page.getByRole("link", { name: /Bataille/ }).first();
  await expect(battleLink.getByText("Nouveau")).toBeVisible();

  await alice.page.goto(`battle?opponent=${bob.name}`);
  await expect(battleLink.getByText("Nouveau")).toBeHidden();
  await buildDeck(alice.page);
  await alice.page.getByRole("button", { name: "Défier" }).click();
  await expect(alice.page).toHaveURL(/\/battle\/\d+$/);
  await expect(alice.page.getByText(`En attente de la réponse de ${bob.name}`)).toBeVisible();

  await bob.page.goto("battle");
  await bob.page.getByRole("button", { name: "Choisir mon deck" }).click();
  await buildDeck(bob.page);
  await bob.page.getByRole("button", { name: "Accepter le duel" }).click();
  await expect(bob.page).toHaveURL(/\/battle\/\d+$/);

  // Les deux écrans ouverts : le duel démarre, les PV sont affichés.
  await expect(alice.page.getByText(/Tour 1\/8/)).toBeVisible({ timeout: 20_000 });
  await expect(bob.page.getByRole("meter", { name: "Points de vie de Toi" })).toHaveAttribute("aria-valuenow", "100");

  await playTurn(alice.page, bob.page);
  // Tour suivant (après l'affichage du résultat) : l'autre joueur attaque.
  await expect(alice.page.getByText(/Tour 2\/8/)).toBeVisible({ timeout: 15_000 });
  await expect(alice.page.getByRole("heading", { name: "Journal" })).toBeVisible();
  await playTurn(alice.page, bob.page);

  await alice.page.getByRole("button", { name: /Abandonner/ }).click();
  await alice.page.getByRole("button", { name: "Oui" }).click();
  await expect(alice.page.getByText("Défaite", { exact: true })).toBeVisible();
  await expect(bob.page.getByText("Victoire", { exact: true })).toBeVisible();
  await expect(bob.page.getByText(`${alice.name} a abandonné.`)).toBeVisible();

  await bob.page.goto("battle");
  await expect(bob.page.getByRole("heading", { name: "Historique" })).toBeVisible();
  await expect(bob.page.getByText(new RegExp(`Victoire contre ${alice.name}`))).toBeVisible();
});

test("file de matchmaking : le duel démarre dès que deux joueurs cherchent", async ({ browser }) => {
  test.setTimeout(120_000);
  const alice = await newPlayer(browser, "queue1");
  const bob = await newPlayer(browser, "queue2");
  await apiCall(alice.page, "POST", "/packs/open");
  await apiCall(bob.page, "POST", "/packs/open");

  await alice.page.goto("battle");
  await buildDeck(alice.page);
  await alice.page.getByRole("button", { name: "Trouver un adversaire" }).click();
  await expect(alice.page.getByText("Recherche d’un adversaire…")).toBeVisible();
  await expect(alice.page.getByRole("button", { name: "Trouver un adversaire" })).toBeDisabled();

  // Chez Bob, la pastille verte du menu compte les joueurs qui attendent.
  const battleLink = bob.page.getByRole("link", { name: /Bataille/ }).first();
  await expect(battleLink.getByTitle("1 joueur en attente d’un duel")).toBeVisible();

  // Bob cherche à son tour : le duel s'ouvre chez les deux, sans autre clic.
  await bob.page.goto("battle");
  await expect(bob.page.getByText("1 joueur attend un adversaire", { exact: false })).toBeVisible();
  await buildDeck(bob.page);
  await bob.page.getByRole("button", { name: "Trouver un adversaire" }).click();
  await expect(bob.page).toHaveURL(/\/battle\/\d+$/);
  await expect(alice.page).toHaveURL(/\/battle\/\d+$/);
  await expect(alice.page.getByText(/Tour 1\/8/)).toBeVisible({ timeout: 20_000 });
  await expect(bob.page.getByText(/Tour 1\/8/)).toBeVisible();

  // La file est vide : plus de pastille.
  await expect(battleLink.getByTitle(/en attente d’un duel/)).toBeHidden();
});

test("decks enregistrés : enregistrer, recharger, deck à réparer", async ({ browser }) => {
  const alice = await newPlayer(browser, "deck1");
  const bob = await newPlayer(browser, "deck2");
  await apiCall(alice.page, "POST", "/packs/open");
  const page = alice.page;

  await page.goto(`battle?opponent=${bob.name}`);
  await expect(page.getByText("Aucun deck enregistré")).toBeVisible();
  const chip = page
    .getByRole("group", { name: "Charger un deck enregistré" })
    .getByRole("button", { name: /Mes rares/ });
  await buildDeck(page);
  await page.getByRole("button", { name: "Enregistrer comme nouveau deck" }).click();
  await page.getByLabel("Nom du deck").fill("Mes rares");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(chip).toHaveAttribute("aria-pressed", "true");

  // Retour sur la page : le deck se recharge d'un clic, prêt pour le duel.
  await page.reload();
  const defy = page.getByRole("button", { name: "Défier" });
  await expect(defy).toBeDisabled();
  await chip.click();
  await expect(page.getByText("(5/5)")).toBeVisible();
  await expect(defy).toBeEnabled();

  // Une carte du deck recyclée : le deck est marqué à réparer et ne peut pas servir tel quel.
  const [deck] = await apiCall<{ cards: { instanceId: number }[] }[]>(page, "GET", "/battles/decks");
  await apiCall(page, "POST", "/collection/recycle", { instanceIds: [deck!.cards[0]!.instanceId] });
  await page.reload();
  await chip.click();
  await expect(page.getByText(/1\scarte n’est plus dans ta collection/)).toBeVisible();
  await expect(page.getByText("(4/5)")).toBeVisible();
  await expect(defy).toBeDisabled();
});
