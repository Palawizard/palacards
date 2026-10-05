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
  // Le bonus du jour (+20 PW) est réclamé par la page en arrière-plan : on le réclame aussi (idempotent,
  // joueur verrouillé) pour qu'il soit déjà compté dans `before` et ne tombe pas pendant le code promo.
  await apiCall(player.page, "POST", "/daily");
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

  // Tous les articles du booster se parcourent dans le catalogue.
  await player.page.goto("pulls");
  await player.page.getByRole("tab", { name: new RegExp(themeName) }).click();
  await player.page.getByRole("link", { name: "Voir les 40 articles" }).click();
  await expect(player.page).toHaveURL(/\/cards\?theme=\d+$/);
  await expect(player.page.getByRole("heading", { level: 1, name: themeName })).toBeVisible();
  await expect(player.page.locator("article.pc-card")).toHaveCount(40);
});

test("roues du jour : la petite tout de suite, la moyenne après 2 h 30", async ({ browser }) => {
  const { page } = await newPlayer(browser, "roue");
  expect((await apiCall<Me>(page, "GET", "/me")).wheelReady).toBe(true);
  await page.goto("wheel");
  await expect(page.getByRole("button", { name: /Moyenne/ })).toContainText("2 h 30 après la petite");
  await page.getByRole("button", { name: "Tourner la petite roue" }).click();
  await expect(page.getByRole("heading", { name: "Gagné" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Déjà tournée aujourd'hui" })).toBeDisabled();
  await expect(page.getByRole("button", { name: /Petite/ })).toContainText("Tournée");
  // Après 21 h 30 (Paris), la moyenne ne serait prête qu'après minuit : « Demain ».
  await expect(page.getByRole("button", { name: /Moyenne/ })).toContainText(/Dans 2:2\d:\d\d|Demain/);
  expect((await apiCall<Me>(page, "GET", "/me")).wheelReady).toBe(false);
  // La moyenne n'est pas encore prête.
  await page.getByRole("button", { name: /Moyenne/ }).click();
  await expect(page.getByRole("button", { name: /^(Prête dans|Trop tard aujourd'hui)/ })).toBeDisabled();
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

test("upgrader : favoris masqués par défaut, upgrade en série des doublons", async ({ browser }) => {
  const { page } = await newPlayer(browser, "serie");
  const common = await apiCall<{ items: { cardId: number }[] }>(page, "GET", "/cards?rarity=C&limit=1&sort=title");
  const granted = await apiCall<{ instanceIds: number[] }>(page, "POST", "/test/grant-card", {
    cardId: common.items[0]!.cardId,
    count: 10,
  });
  await apiCall(page, "POST", `/collection/${granted.instanceIds[9]}/favorite`, { favorite: true });
  await page.goto("upgrade");
  const cards = page.locator("button[aria-pressed]:has(article)");
  await expect(cards).toHaveCount(9);
  await page.getByRole("button", { name: "Afficher les favoris" }).click();
  await expect(cards).toHaveCount(10);

  // Le favori et le meilleur exemplaire restent : 8 doublons, deux lots au plafond.
  const series = page.getByRole("region", { name: "Upgrade en série" });
  await expect(series).toContainText("8 doublons → 2 upgrades");
  await series.getByRole("button", { name: "Lancer 2 upgrades" }).click();
  await expect(series).toContainText(/réussites? sur 2/, { timeout: 15_000 });
  await expect(series).toContainText("Aucun doublon de rareté commune à upgrader");
  await expect(cards).toHaveCount(2);
});
