import { expect, test } from "@playwright/test";
import { apiCall, newPlayer } from "./helpers";

test("plus ou moins vu : un essai complet, bonne réponse puis erreur", async ({ browser }) => {
  const { page } = await newPlayer(browser, "plusmoins");
  await apiCall(page, "POST", "/test/hl-seed");
  // L'ancienne page de l'article du jour mène au nouveau jeu.
  await page.goto("article");
  await expect(page).toHaveURL(/\/plus-ou-moins$/);
  await expect(page.getByRole("heading", { name: "Plus ou moins vu" })).toBeVisible();
  await page.getByRole("button", { name: "Jouer" }).click();

  const board = page.getByRole("region", { name: "Essai en cours" });
  await expect(board).toContainText("Essai 1 · série 0");
  // Aucune vue ni rareté affichée avant la réponse.
  await expect(board.getByText("? vues sur 12 mois")).toHaveCount(2);
  const choices = board.getByRole("button", { name: /le plus vu \?$/ });
  await expect(choices).toHaveCount(2);

  // Bonne réponse : les vues apparaissent, la série passe à 1, puis une nouvelle paire arrive.
  const { higher } = await apiCall<{ higher: "kept" | "challenger" }>(page, "GET", "/test/hl-answer");
  await choices.nth(higher === "kept" ? 0 : 1).click();
  await expect(board).toContainText("série 1");
  await expect(board.getByText(/\d\svues?$/).first()).toBeVisible();
  await expect(board.getByText("? vues sur 12 mois")).toHaveCount(2, { timeout: 5_000 });

  // Mauvaise réponse : fin de l'essai, série de 1 et 10 PW.
  const next = await apiCall<{ higher: "kept" | "challenger" }>(page, "GET", "/test/hl-answer");
  await board
    .getByRole("button", { name: /le plus vu \?$/ })
    .nth(next.higher === "kept" ? 1 : 0)
    .click();
  const end = page.getByRole("region", { name: "Fin de l’essai" });
  await expect(end).toContainText("Raté");
  await expect(end).toContainText("Série de 1");
  await expect(end).toContainText("+10");
  await expect(page.getByRole("button", { name: "Essai suivant (2 restants)" })).toBeVisible();
});
