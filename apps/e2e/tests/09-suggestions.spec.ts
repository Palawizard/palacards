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

test("suggestion acceptée : succès « Boîte à idées » et badge sur le profil", async ({ browser }) => {
  const player = await newPlayer(browser, "boite");
  const sent = await apiCall<{ id: number }>(player.page, "POST", "/suggestions", {
    kind: "content",
    title: `Idée ${newName("b")}`,
    body: "Un booster à thème sur les volcans.",
  });
  const admin = await newPlayer(browser, "admin");
  await apiCall(admin.page, "POST", "/test/make-admin");
  await apiCall(admin.page, "PATCH", `/admin/suggestions/${sent.id}`, { status: "accepted" });

  await expect(player.page.getByText("Succès débloqué : Bonne idée.")).toBeVisible();
  await player.page.goto(`u/${player.name}`);
  await expect(player.page.getByText("Bonne idée", { exact: true })).toBeVisible();
  await player.page.goto("achievements");
  await expect(player.page.getByRole("heading", { name: "Boîte à idées" })).toBeVisible();
});
