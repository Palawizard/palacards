import { expect, test } from "@playwright/test";
import { apiCall, instantPacks, newPlayer } from "./helpers";

test("succès débloqué, fusion, classement et paramètres", async ({ browser }) => {
  const { page, name } = await newPlayer(browser, "prog");
  await instantPacks(page);

  // Premier paquet : le succès tombe en notification et sur la page Succès.
  await page.getByRole("button", { name: /Ouvrir un paquet/ }).first().click();
  await expect(page.getByText("Succès débloqué : Premier paquet.")).toBeVisible();
  await page.goto("achievements");
  // Au moins 1 : selon le tirage, une SR/UR peut débloquer d'autres succès dès le premier paquet.
  await expect(page.getByText(/[1-9]\d* succès débloqués sur 20/)).toBeVisible();
  await expect(page.locator("li", { hasText: "Premier paquet" }).getByText(/Débloqué le/)).toBeVisible();

  // Fusion : deux exemplaires du même article → niveau 2.
  const owned = await apiCall<{ items: { cardId: number }[] }>(page, "GET", "/collection?limit=1");
  const cardId = owned.items[0]!.cardId;
  await apiCall(page, "POST", "/test/grant-card", { cardId, count: 1 });
  await page.goto(`card/${cardId}`);
  await page.getByRole("button", { name: "Fusionner" }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Fusionner" }).click();
  await expect(page.getByText("Niveau 2 atteint.")).toBeVisible();
  await expect(page.getByText(/niveau 2 · obtenue/)).toBeVisible();

  // Classement : le joueur y figure, en évidence.
  await page.goto("leaderboard");
  await expect(page.getByRole("row", { name: new RegExp(name) })).toBeVisible();
  await page.getByRole("button", { name: "Elo" }).click();
  await expect(page.getByRole("row", { name: new RegExp(name) })).toBeVisible();

  // Paramètres : avatar et vitesse d'animation enregistrés.
  await page.goto("settings");
  await expect(page.getByRole("heading", { name: "Paramètres" })).toBeVisible();
  await page.getByRole("radio", { name: "Animée" }).click();
  await expect(page.getByText("Réglage enregistré.")).toBeVisible();
  expect((await apiCall<{ animationSpeed: string }>(page, "GET", "/me")).animationSpeed).toBe("normal");
});

test("admin : don de PW réservé aux comptes admin", async ({ browser }) => {
  const player = await newPlayer(browser, "don");
  await player.page.goto("admin");
  await expect(player.page.getByText("Page réservée aux admins.")).toBeVisible();

  // Le rôle admin est en base : la route de test fait ce que fait la CLI en prod.
  const { page: admin } = await newPlayer(browser, "patron");
  await apiCall(admin, "POST", "/test/make-admin");
  await admin.goto("admin");
  await expect(admin.getByRole("heading", { name: "Masse monétaire" })).toBeVisible();
  await admin.getByLabel("Pseudo").fill(player.name);
  await admin.getByLabel(/PW \(négatif/).fill("250");
  await admin.getByRole("button", { name: "Donner" }).click();
  await expect(admin.getByText(new RegExp(`Fait : ${player.name} a`))).toBeVisible();
  const me = await apiCall<{ wallet: { balance: number } }>(player.page, "GET", "/me");
  expect(me.wallet.balance).toBeGreaterThanOrEqual(350);
});

test("parcours : toutes les pages du menu s'affichent sans erreur, sur mobile aussi", async ({ browser }) => {
  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 390, height: 844 },
    { width: 360, height: 780 },
  ]) {
    const context = await browser.newContext({ locale: "fr-FR", viewport, ...(viewport.width < 768 ? { isMobile: true, hasTouch: true } : {}) });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("register");
    await page.getByLabel("Pseudo").fill(`tour${viewport.width}${Date.now().toString(36).slice(-4)}`);
    await page.getByLabel("Mot de passe").fill("motdepasse123");
    await page.getByRole("button", { name: "Créer mon compte" }).click();
    await expect(page).toHaveURL(/\/palacards\/pulls$/);
    for (const path of ["pulls", "collection", "cards", "battle", "market", "trades", "friends", "messages", "guild", "leaderboard", "profile", "achievements", "settings", "notifications"]) {
      await page.goto(path);
      await expect(page.locator("h1").first()).toBeVisible();
      await expect(page.getByText("Cette page arrive bientôt.")).toHaveCount(0);
      // Pas de défilement horizontal parasite sur mobile.
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `débordement horizontal sur /${path}`).toBeLessThanOrEqual(1);
    }
    expect(errors).toEqual([]);
    await context.close();
  }
});
