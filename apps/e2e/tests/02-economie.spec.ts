import { expect, test } from "@playwright/test";
import { apiCall, instantPacks, newPlayer } from "./helpers";

interface Me {
  id: string;
  wallet: { balance: number; locked: number; available: number };
}
interface OpenedPack {
  cards: { instanceId: number; cardId: number; title: string }[];
}

test("mise en vente → enchère d'un 2e joueur → fin d'enchère → échange", async ({ browser }) => {
  const seller = await newPlayer(browser, "vendeur");
  const buyer = await newPlayer(browser, "acheteur");
  await instantPacks(seller.page);
  const pack = await apiCall<OpenedPack>(seller.page, "POST", "/packs/open");
  const card = pack.cards[0]!;

  // Le vendeur met la carte en vente depuis sa fiche.
  await seller.page.goto(`card/${card.cardId}`);
  await seller.page.getByRole("button", { name: "Vendre" }).first().click();
  await seller.page.getByLabel("Mise à prix (PW)").fill("20");
  await seller.page.getByRole("button", { name: "Mettre en vente" }).click();
  await expect(seller.page.getByText("est en vente")).toBeVisible();

  // L'acheteur la trouve au marché et enchérit ; le vendeur voit l'offre arriver en direct.
  await seller.page.goto("market?scope=mine");
  await buyer.page.goto("market");
  const row = buyer.page.locator("li", { hasText: card.title }).first();
  await expect(row).toBeVisible();
  await row.getByLabel("Montant de l’offre").fill("25");
  await row.getByRole("button", { name: "Enchérir" }).click();
  await expect(buyer.page.getByText("Offre enregistrée.")).toBeVisible();
  await expect(seller.page.getByText("Nouvelle offre")).toBeVisible();
  expect((await apiCall<Me>(buyer.page, "GET", "/me")).wallet.locked).toBe(25);

  // Fin de l'enchère (route de test) : la carte change de main, les notifications arrivent.
  const auctions = await apiCall<{ id: number }[]>(seller.page, "GET", "/market?scope=mine");
  await apiCall(seller.page, "POST", "/test/end-auction", { auctionId: auctions[0]!.id });
  await buyer.page.goto("notifications");
  await expect(buyer.page.getByText(/Enchère gagnée/)).toBeVisible();
  const buyerMe = await apiCall<Me>(buyer.page, "GET", "/me");
  expect(buyerMe.wallet).toMatchObject({ locked: 0, balance: 100 - 25 + 20 }); // +20 : bonus du jour
  await buyer.page.goto(`card/${card.cardId}`);
  await expect(buyer.page.getByRole("heading", { name: "Mes exemplaires" })).toBeVisible();
  await expect(buyer.page.getByRole("button", { name: "Vendre" })).toBeVisible();

  // Échange : l'acheteur propose la carte contre 10 PW, le vendeur accepte.
  await buyer.page.goto(`trades/new?to=${seller.name}`);
  await buyer.page
    .getByRole("button", { name: new RegExp(card.title) })
    .first()
    .click();
  await buyer.page.getByPlaceholder("0").last().fill("10");
  await buyer.page.getByRole("button", { name: "Envoyer la proposition" }).click();
  await expect(buyer.page).toHaveURL(/trades\?box=sent/);

  await seller.page.goto("trades");
  await expect(seller.page.getByText("Tu reçois")).toBeVisible();
  await seller.page.getByRole("button", { name: "Accepter", exact: true }).click();
  await seller.page.getByRole("dialog").getByRole("button", { name: "Accepter l’échange" }).click();
  await expect(seller.page.getByText("Échange conclu !")).toBeVisible();
  const sellerCards = await apiCall<{ items: { cardId: number }[] }>(seller.page, "GET", "/collection?limit=100");
  expect(sellerCards.items.some((c) => c.cardId === card.cardId)).toBe(true);
});
