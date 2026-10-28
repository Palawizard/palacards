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
