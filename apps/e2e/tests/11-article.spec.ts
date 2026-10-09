import { expect, test } from "@playwright/test";
import { apiCall, newPlayer } from "./helpers";

test("article du jour : proposer des articles au clavier, comparer leurs attributs, trouver", async ({ browser }) => {
  const { page } = await newPlayer(browser, "artc");
  const answer = await apiCall<{ cardId: number; title: string }>(page, "GET", "/test/article-answer");

  await page.goto("article");
  await expect(page.getByRole("heading", { name: /^Article du jour n° \d+$/ })).toBeVisible();
  await expect(page.getByText(/Propose un vrai article du jeu/)).toBeVisible();

  const input = page.getByRole("combobox", { name: "Propose un article du jeu" });
  // Un essai faux, choisi au clavier (flèche puis Entrée), qui n'est pas la réponse.
  await input.fill("Carte synth");
  const list = page.getByRole("listbox", { name: "Articles proposés" });
  await expect(list.getByRole("option").first()).toBeVisible();
  const options = list.getByRole("option");
  const count = await options.count();
  let index = 0;
  for (; index < count; index++) if (!(await options.nth(index).textContent())?.endsWith(answer.title)) break;
  for (let i = 0; i < index; i++) await input.press("ArrowDown");
  await input.press("Enter");
  await expect(page.getByRole("heading", { name: "Tes essais" })).toBeVisible();
  await expect(page.locator(".pc-guess-row")).toHaveCount(1);
  await expect(page.locator(".pc-guess-row .pc-attr")).toHaveCount(6);
  await expect(page.getByText(/Prochain essai : 95 PW/)).toBeVisible();

  // Échap ferme la liste sans rien proposer.
  await input.fill(answer.title);
  await expect(list).toBeVisible();
  await input.press("Escape");
  await expect(list).toBeHidden();

  // La flèche rouvre la liste ; la bonne réponse, choisie à la souris.
  await input.press("ArrowDown");
  await expect(list).toBeVisible();
  const exact = new RegExp(`(?:SR|UR|L)${answer.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
  await list.getByRole("option").filter({ hasText: exact }).click();
  await expect(page.getByText(/Trouvé en 2 essais/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Partager ma grille" })).toBeVisible();
  await expect(page.getByText(/joueurs? (a|ont) trouvé sur/)).toBeVisible();
});
