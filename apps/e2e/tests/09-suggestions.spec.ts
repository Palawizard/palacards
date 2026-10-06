import { expect, test } from "@playwright/test";
import { apiCall, newName, newPlayer } from "./helpers";

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
