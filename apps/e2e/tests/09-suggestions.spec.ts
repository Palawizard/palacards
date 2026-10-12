import { expect, test } from "@playwright/test";
import { apiCall, newName, newPlayer } from "./helpers";

test("le joueur répond au retour de Palawi, l'admin voit la réponse et la supprime", async ({ browser }) => {
  const player = await newPlayer(browser, "fil");
  const title = `Fil ${newName("s")}`;
  const { id } = await apiCall<{ id: number }>(player.page, "POST", "/suggestions", {
    kind: "feature",
    title,
    body: "Pouvoir trier ma collection par date d'obtention.",
  });
  const admin = await newPlayer(browser, "admin");
  await apiCall(admin.page, "POST", "/test/make-admin");
  await apiCall(admin.page, "PATCH", `/admin/suggestions/${id}`, { reply: "Par date d'obtention ou de sortie ?" });

  await player.page.goto("suggestions");
  const mine = player.page.getByRole("listitem").filter({ hasText: title });
  await mine.getByRole("button", { name: "Répondre à Palawi" }).click();
  await mine.getByLabel("Ta réponse à Palawi").fill("D'obtention, pour retrouver mes tirages.");
  await mine.getByRole("button", { name: "Envoyer" }).click();
  await expect(mine.getByRole("list", { name: "Fil de réponses" })).toContainText(
    "D'obtention, pour retrouver mes tirages.",
  );
  await expect(mine).toContainText("4 réponses possibles");

  await admin.page.goto("admin/suggestions");
  const item = admin.page.locator(`#suggestion-${id}`);
  await expect(item).toContainText("Nouvelle réponse");
  await item.getByRole("button", { name: /^Supprimer le message de/ }).click();
  await expect(admin.page.getByText("Message supprimé du fil.")).toBeVisible();
  await expect(item.getByRole("list", { name: "Fil de réponses" })).toHaveCount(0);
});

test("suggestion envoyée, puis triée par Claude depuis la page Admin", async ({ browser }) => {
  const player = await newPlayer(browser, "idee");
  const title = `Idée ${newName("s")}`;
  await apiCall(player.page, "POST", "/suggestions", {
    kind: "feature",
    title,
    body: "Pouvoir trier ma collection par date d'obtention.",
  });

  const admin = await newPlayer(browser, "admin");
  await apiCall(admin.page, "POST", "/test/make-admin");
  await admin.page.goto("admin/suggestions");
  const item = admin.page.getByRole("listitem").filter({ hasText: title });
  // Automatisation coupée en E2E : la suggestion n'a pas été triée, l'admin peut lancer le tri.
  await expect(item).toContainText("Pas encore triée par Claude.");
  await item.getByRole("button", { name: "Trier avec Claude" }).click();
  await expect(admin.page.getByText("Tri lancé.")).toBeVisible();
  await expect(item.getByRole("region", { name: `Tri de Claude pour « ${title} »` })).toContainText(
    "En attente du tri",
  );
});
