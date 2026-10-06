import { expect, test } from "@playwright/test";
import { apiCall, instantPacks, newPlayer } from "./helpers";

test("succès débloqué, fusion, classement et paramètres", async ({ browser }) => {
  const { page, name } = await newPlayer(browser, "prog");
  await instantPacks(page);

  // Premier paquet : le succès tombe en notification et sur la page Succès.
  await page
    .getByRole("button", { name: /Ouvrir un paquet/ })
    .first()
    .click();
  await expect(page.getByText("Succès débloqué : Premier paquet.")).toBeVisible();
  await page.goto("achievements");
  // Au moins 1 : selon le tirage, une SR/UR peut débloquer d'autres succès dès le premier paquet.
  await expect(page.getByText(/[1-9]\d* succès débloqués sur \d{3}/)).toBeVisible();
  // Famille « Paquets ouverts » : le premier palier est débloqué.
  await expect(page.getByText("Palier 1, Premier paquet, débloqué")).toBeAttached();
  // Les médailles ouvrent le détail des paliers : obtenu, en cours, puis fermeture à Échap.
  await page.getByRole("button", { name: /paliers de la famille Paquets ouverts/ }).click();
  const tiers = page.getByRole("dialog", { name: "Paquets ouverts" });
  await expect(tiers.getByRole("listitem").first()).toContainText("Obtenu le");
  await expect(tiers.getByRole("progressbar")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(tiers).toBeHidden();

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

test("titres de classement : choix du titre affiché sur le profil et dans les classements", async ({ browser }) => {
  const { page, name } = await newPlayer(browser, "titre");
  await instantPacks(page);
  await page
    .getByRole("button", { name: /Ouvrir un paquet/ })
    .first()
    .click();

  // Sans titre : la section explique comment en gagner un.
  await page.goto("profile");
  const titles = page.getByRole("region", { name: "Titres" });
  await expect(titles.getByText(/pour gagner un titre/)).toBeVisible();

  // Deux titres gagnés : aucun affiché tant que le joueur n'a pas choisi.
  const { season } = await apiCall<{ season: number }>(page, "GET", "/me");
  await apiCall(page, "POST", "/test/grant-title", { season, board: "luck", rank: 1 });
  await apiCall(page, "POST", "/test/grant-title", { season, board: "packs", rank: 3 });
  await page.reload();
  const lucky = titles.getByRole("button", { name: /Lucky guy/ });
  await expect(lucky).toHaveAttribute("aria-pressed", "false");
  await expect(titles.getByRole("button", { name: /Accro aux boosters/ })).toBeVisible();
  await lucky.click();
  await expect(lucky).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("header").getByText("Lucky guy")).toBeVisible();

  // Le titre suit le joueur dans les classements.
  await page.goto("leaderboard");
  await expect(page.getByRole("row", { name: new RegExp(name) }).getByText("Lucky guy")).toBeVisible();

  // Touché de nouveau : plus aucun titre affiché.
  await page.goto("profile");
  await lucky.click();
  await expect(lucky).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("header").getByText("Lucky guy")).toHaveCount(0);
});

test("paramètres : volume des sons au clavier, retenu après rechargement", async ({ browser }) => {
  const { page } = await newPlayer(browser, "volume");
  await page.goto("settings");
  const section = page.locator("#sons");
  const slider = section.getByRole("slider", { name: "Volume" });
  const enabled = section.getByRole("checkbox", { name: "Sons du jeu" });
  const header = page.getByRole("button", { name: "Sons du jeu" });
  // Par défaut : le volume d'origine du jeu.
  await expect(slider).toHaveValue("100");
  await expect(enabled).toBeChecked();

  // Au clavier : chaque flèche retire un cran de 5 %.
  await slider.focus();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await expect(slider).toHaveValue("90");
  await expect(section.getByText("90 %")).toBeVisible();
  await page.reload();
  await expect(slider).toHaveValue("90");

  // À 0 % : plus de son, la case et le bouton de l'en-tête suivent.
  await slider.focus();
  await page.keyboard.press("Home");
  await expect(slider).toHaveValue("0");
  await expect(enabled).not.toBeChecked();
  await expect(header).toHaveAttribute("aria-pressed", "false");

  // Réactiver le son depuis 0 % repart du volume par défaut.
  await enabled.check();
  await expect(slider).toHaveValue("100");
  await expect(header).toHaveAttribute("aria-pressed", "true");
});

test("en-tête : le survol du bouton de son déplie le curseur de volume", async ({ browser }) => {
  const { page } = await newPlayer(browser, "survol");
  await page.goto("pulls");
  const header = page.getByRole("banner");
  const button = header.getByRole("button", { name: "Sons du jeu" });
  const slider = header.getByRole("slider", { name: "Volume" });
  // Panneau qui porte le fondu : le parent du bloc libellé + curseur.
  const panel = slider.locator("xpath=../..");
  await expect(panel).toHaveCSS("opacity", "0");

  await button.hover();
  await expect(panel).toHaveCSS("opacity", "1");
  // La souris descend du bouton au curseur sans refermer le panneau.
  await slider.hover();
  await slider.focus();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await expect(slider).toHaveValue("90");
  await expect(header.getByText("90 %")).toBeVisible();

  // Le réglage est le même que dans les paramètres.
  await page.goto("settings");
  await expect(page.locator("#sons").getByRole("slider", { name: "Volume" })).toHaveValue("90");
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
    const context = await browser.newContext({
      locale: "fr-FR",
      viewport,
      ...(viewport.width < 768 ? { isMobile: true, hasTouch: true } : {}),
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("register");
    await page.getByLabel("Pseudo").fill(`tour${viewport.width}${Date.now().toString(36).slice(-4)}`);
    await page.getByLabel("Mot de passe").fill("motdepasse123");
    await page.getByRole("button", { name: "Créer mon compte" }).click();
    await expect(page).toHaveURL(/\/palacards\/pulls$/);
    for (const path of [
      "pulls",
      "collection",
      "cards",
      "battle",
      "market",
      "trades",
      "friends",
      "messages",
      "guild",
      "leaderboard",
      "profile",
      "achievements",
      "settings",
      "notifications",
    ]) {
      await page.goto(path);
      await expect(page.locator("h1").first()).toBeVisible();
      await expect(page.getByText("Cette page arrive bientôt.")).toHaveCount(0);
      // Pas de défilement horizontal parasite sur mobile.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `débordement horizontal sur /${path}`).toBeLessThanOrEqual(1);
    }
    expect(errors).toEqual([]);
    await context.close();
  }
});
