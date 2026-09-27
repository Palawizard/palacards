import { expect, test } from "@playwright/test";
import { apiCall, instantPacks, newName, newPlayer } from "./helpers";

interface Me {
  wallet: { balance: number };
  packs: { bonus: number };
  wheelReady: boolean;
}

test("booster à thème créé par l'admin, code promo, ouverture du booster", async ({ browser }) => {
  const admin = await newPlayer(browser, "admin");
  await apiCall(admin.page, "POST", "/test/make-admin");
  const titles = (await apiCall<{ items: { title: string }[] }>(admin.page, "GET", "/cards?sort=views&limit=40")).items;

  // L'admin crée le booster (liste de titres : pas d'appel à Wikipédia en test) puis un code qui en donne un.
  const themeName = `Thème ${newName("e")}`;
  await admin.page.goto("admin");
  await admin.page.getByLabel("Nom du booster").fill(themeName);
  await admin.page.getByLabel("Titres en plus (un par ligne, facultatif)").fill(titles.map((t) => t.title).join("\n"));
  await admin.page.getByRole("button", { name: "Créer", exact: true }).click();
  await expect(admin.page.getByText(`Booster « ${themeName} » créé : 40 articles.`)).toBeVisible();

  const code = newName("CODE").toUpperCase();
  await admin.page.getByLabel("Code", { exact: true }).fill(code);
  await admin.page.getByLabel("PW", { exact: true }).fill("30");
  await admin.page.getByLabel("Booster à thème").selectOption({ label: themeName });
  await admin.page.getByLabel("Boosters", { exact: true }).fill("1");
  await admin.page.getByRole("button", { name: "Créer le code" }).click();
  await expect(admin.page.getByText(`Code ${code} créé.`)).toBeVisible();

  // Le joueur utilise le code depuis la page Paquets, puis ouvre le booster reçu.
  const player = await newPlayer(browser, "joueur");
  await instantPacks(player.page);
  await player.page.reload();
  const before = (await apiCall<Me>(player.page, "GET", "/me")).wallet.balance;
  await player.page.getByPlaceholder("Code promo").fill(code.toLowerCase());
  await player.page.getByRole("button", { name: "Utiliser le code" }).click();
  await expect(player.page.getByText(`Code utilisé : 30 PW, 1 booster ${themeName} !`)).toBeVisible();
  expect((await apiCall<Me>(player.page, "GET", "/me")).wallet.balance).toBe(before + 30);

  await player.page.getByRole("tab", { name: new RegExp(themeName) }).click();
  await expect(player.page.getByText("Édition limitée").first()).toBeVisible();
  await player.page.getByRole("button", { name: "Ouvrir le booster" }).click();
  await expect(player.page.getByRole("region", { name: "Ouverture de paquet" }).locator(".pc-card")).toHaveCount(10);
  // Plus de booster en stock : le bouton propose de l'acheter.
  await expect(player.page.getByRole("button", { name: /En racheter un · 250 PW/ })).toBeVisible();
});

test("roue du jour : un tour par jour", async ({ browser }) => {
  const { page } = await newPlayer(browser, "roue");
  expect((await apiCall<Me>(page, "GET", "/me")).wheelReady).toBe(true);
  await page.goto("wheel");
  await page.getByRole("button", { name: "Tourner la roue" }).click();
  await expect(page.getByRole("heading", { name: "Gagné" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: /Prochain tour dans/ })).toBeDisabled();
  expect((await apiCall<Me>(page, "GET", "/me")).wheelReady).toBe(false);
});

test("upgrader : des cartes communes pour tenter une peu commune, sur le cadran", async ({ browser }) => {
  const { page } = await newPlayer(browser, "upgrade");
  const common = await apiCall<{ items: { cardId: number }[] }>(page, "GET", "/cards?rarity=C&limit=1");
  await apiCall(page, "POST", "/test/grant-card", { cardId: common.items[0]!.cardId, count: 3 });
  await page.goto("upgrade");
  const cards = page.locator("button[aria-pressed]:has(article)");
  await expect(cards).toHaveCount(3);
  await cards.nth(0).click();
  // Une carte : 20,16 % sur le cadran, puis « Remplir » pose les deux autres.
  await expect(page.getByRole("img", { name: "Chance de réussite : 20,16 %" })).toBeVisible();
  await page.getByRole("button", { name: "Remplir" }).click();
  await expect(page.getByRole("img", { name: "Chance de réussite : 60,48 %" })).toBeVisible();
  await page.getByRole("button", { name: "Tenter l’upgrade · 60,48 %" }).click();
  await expect(page.getByText(/^(Réussi !|Raté)$/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Nouvel essai" })).toBeVisible();
  // Les cartes sacrifiées ont quitté la collection.
  await expect(cards).toHaveCount(0);
});
