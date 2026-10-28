import { expect, test } from "@playwright/test";
import { apiCall, instantPacks, newPlayer } from "./helpers";

interface PortfolioDTO {
  cards: { instanceId: number }[];
}

test("créer un portfolio, l'afficher sur le profil, le liker depuis un autre compte (suggestions n° 3 et 116)", async ({
  browser,
}) => {
  const owner = await newPlayer(browser, "classeur");
  await instantPacks(owner.page);
  const { cards } = await apiCall<{ cards: { title: string }[] }>(owner.page, "POST", "/packs/open");
  const { page } = owner;

  // Création : nom et description, puis l'éditeur.
  await page.goto("portfolios");
  await page.getByRole("button", { name: "Nouveau portfolio" }).click();
  const create = page.getByRole("dialog", { name: "Nouveau portfolio" });
  await create.getByLabel("Nom").fill("Mes trouvailles");
  await create.getByLabel(/Description/).fill("Les cartes du premier paquet.");
  await create.getByRole("button", { name: "Créer et choisir les cartes" }).click();
  await expect(page).toHaveURL(/\/portfolios\/\d+\/modifier$/);
  const id = Number(/portfolios\/(\d+)/.exec(page.url())![1]);

  // Trois cartes d'un coup : une trouvée avec les filtres de la collection (suggestion n° 120), puis deux autres.
  await page.getByRole("button", { name: /Ajouter des cartes/ }).click();
  const picker = page.getByRole("dialog", { name: "Ajouter des cartes" });
  const picks = picker.locator(".pc-pick:not([disabled])");
  const title = cards[0]!.title;
  await picker.getByLabel("Filtrer par titre").fill(title);
  await expect(picks.first()).toContainText(title);
  await picks.first().click();
  // Le choix reste quand les filtres changent.
  await picker.getByRole("button", { name: "Réinitialiser" }).click();
  await expect(picker.getByText("1 carte choisie")).toBeVisible();
  const free = picker.locator(".pc-pick:not([disabled]):not([aria-pressed='true'])");
  for (let i = 0; i < 2; i++) await free.first().click();
  await picker.getByRole("button", { name: "Ajouter (3)" }).click();
  await expect(page.getByRole("heading", { name: /Cartes\s*3 \/ 30/ })).toBeVisible();

  // Vedette, ordre au clavier sur la poignée, couleur.
  await page
    .getByRole("button", { name: /^Mettre .* en vedette$/ })
    .nth(1)
    .click();
  await expect(page.getByRole("button", { name: /^Retirer .* de la vedette$/ })).toHaveCount(1);
  const before = await apiCall<PortfolioDTO>(page, "GET", `/portfolios/${id}`);
  await page.getByRole("button", { name: /^Déplacer .*, place 1 sur 3/ }).press("ArrowRight");
  await expect
    .poll(async () => (await apiCall<PortfolioDTO>(page, "GET", `/portfolios/${id}`)).cards.map((c) => c.instanceId))
    .toEqual([before.cards[1]!.instanceId, before.cards[0]!.instanceId, before.cards[2]!.instanceId]);
  await page.getByRole("radio", { name: "Azur" }).click();
  await expect(page.getByRole("radio", { name: "Azur" })).toHaveAttribute("aria-checked", "true");

  // Sur le profil.
  await page.goto(`u/${owner.name}`);
  const mine = page.getByRole("region", { name: /^Portfolios/ });
  await mine.getByRole("button", { name: "Choisir" }).click();
  await mine.getByRole("button", { name: "Ajouter", exact: true }).click();
  await expect(mine.getByRole("heading", { name: "Mes trouvailles" })).toBeVisible();

  // Un autre joueur le voit sur le profil, ouvre la page et l'aime (une seule fois, sans récompense).
  const visitor = await newPlayer(browser, "admirateur");
  await visitor.page.goto(`u/${owner.name}`);
  const theirs = visitor.page.getByRole("region", { name: "Portfolios" });
  await theirs.getByRole("link", { name: "Mes trouvailles" }).click();
  await expect(visitor.page).toHaveURL(new RegExp(`/portfolios/${id}$`));
  await expect(visitor.page.getByRole("heading", { level: 1, name: "Mes trouvailles" })).toBeVisible();
  await expect(visitor.page.getByText("Les cartes du premier paquet.")).toBeVisible();
  const balance = (await apiCall<{ wallet: { balance: number } }>(visitor.page, "GET", "/me")).wallet.balance;
  await visitor.page.getByRole("button", { name: /^J’aime \(0 j’aime\)$/ }).click();
  await expect(visitor.page.getByRole("button", { name: /^Retirer ton j’aime \(1 j’aime\)$/ })).toBeVisible();
  expect((await apiCall<{ wallet: { balance: number } }>(visitor.page, "GET", "/me")).wallet.balance).toBe(balance);

  // Le compteur suit chez l'auteur, qui ne peut pas aimer le sien.
  await page.goto(`portfolios/${id}`);
  await expect(page.locator(".pf-like")).toHaveText(/^1\s*j’aime$/);
  await expect(page.getByRole("button", { name: /J’aime/ })).toHaveCount(0);
});
