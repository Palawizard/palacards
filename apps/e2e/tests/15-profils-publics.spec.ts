import { expect, test } from "@playwright/test";
import { apiCall, instantPacks, newPlayer } from "./helpers";

test("profil d'un autre joueur : ses succès en lecture seule (suggestion n° 109)", async ({ browser }) => {
  const owner = await newPlayer(browser, "medaille");
  await instantPacks(owner.page);
  // Le premier paquet ouvert débloque le premier palier de « Paquets ouverts ».
  await apiCall(owner.page, "POST", "/packs/open");
  await expect
    .poll(
      async () =>
        (await apiCall<{ unlocked: number }>(owner.page, "GET", `/players/${owner.name}/achievements`)).unlocked,
    )
    .toBeGreaterThan(0);

  const { page } = await newPlayer(browser, "visiteur");
  await page.goto(`u/${owner.name}`);
  const section = page.getByRole("region", { name: /Succès/ });
  await expect(section.getByText(/^\d+ \/ \d+ succès$/)).toBeVisible();
  await expect(section.getByRole("heading", { name: "Paquets ouverts" })).toBeVisible();
  // Pas de progression chez les autres : aucune barre.
  await expect(section.getByRole("progressbar")).toHaveCount(0);

  // Détail des paliers au clic, comme sur la page Succès.
  await section.getByRole("button", { name: /paliers de la famille Paquets ouverts/ }).click();
  const dialog = page.getByRole("dialog", { name: "Paquets ouverts" });
  await expect(dialog.getByText(/Obtenu le /).first()).toBeVisible();
  await expect(dialog.getByText(/^En cours/)).toHaveCount(0);
  await dialog.getByRole("button", { name: "Fermer" }).click();

  // Les familles pas encore commencées sont repliées.
  await expect(section.getByText(/pas encore commencées?/)).toBeVisible();
});

test("page publique d'une guilde, depuis le classement et le profil d'un membre (suggestion n° 110)", async ({
  browser,
}) => {
  const chief = await newPlayer(browser, "chef");
  const name = `Guilde ${chief.name}`.slice(0, 24);
  await apiCall(chief.page, "POST", "/guilds", { name, tag: "PUB", emblem: "🦊", description: "Ouverte à tous" });

  const { page } = await newPlayer(browser, "curieux");
  await page.goto("leaderboard");
  await page.getByRole("button", { name: "Guildes" }).click();
  await page.getByRole("link", { name: new RegExp(name) }).click();
  await expect(page).toHaveURL(/\/guild\/\d+$/);
  await expect(page.getByRole("heading", { level: 1, name: new RegExp(name) })).toBeVisible();
  await expect(page.getByText("Ouverte à tous")).toBeVisible();
  await expect(page.getByText(/Classement des guildes/)).toBeVisible();
  // Rien de réservé aux membres : ni salon, ni objectif de la semaine, ni gestion.
  await expect(page.getByText(/Salon de la guilde|Objectif de la semaine|Promouvoir|Quitter/)).toHaveCount(0);
  const guildUrl = page.url();

  // Le membre mène à son profil, qui ramène à la guilde.
  await page.getByRole("link", { name: chief.name, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/u/${chief.name}$`));
  await page.getByRole("link", { name: new RegExp(name) }).click();
  await expect(page).toHaveURL(guildUrl);

  // Un membre qui ouvre la page publique de sa guilde retrouve sa page habituelle.
  await chief.page.goto(guildUrl.replace(/^.*\/palacards\//, ""));
  await expect(chief.page).toHaveURL(/\/guild$/);
});
