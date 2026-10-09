import { expect, test } from "@playwright/test";
import { apiCall, newPlayer } from "./helpers";

interface Broadcast {
  id: number;
}

test("mises à jour : un message fermé se relit depuis le menu", async ({ browser }) => {
  const admin = await newPlayer(browser, "admin");
  await apiCall(admin.page, "POST", "/test/make-admin");
  const older = await apiCall<Broadcast>(admin.page, "POST", "/admin/broadcasts", {
    title: "Ancienne annonce",
    body: "Un premier message.",
    tone: "info",
    send: true,
  });
  const latest = await apiCall<Broadcast>(admin.page, "POST", "/admin/broadcasts", {
    title: "Mise à jour de test",
    body: "Du nouveau :\n\n• Premier changement\n• Second changement\n\nBon jeu !",
    tone: "update",
    linkUrl: "/boss",
    linkLabel: "Voir le boss",
    send: true,
  });

  try {
    // Le joueur ferme les messages qui s'affichent à son arrivée…
    const { page } = await newPlayer(browser, "lecteur");
    const dialog = page.locator("dialog.pc-broadcast[open]");
    await expect(dialog.getByText("1 / 2")).toBeVisible();
    await dialog.getByRole("button", { name: "Suivant" }).click();
    await dialog.getByRole("button", { name: "J'ai compris" }).click();
    await expect(dialog).toHaveCount(0);

    // … puis les retrouve dans « Mises à jour » (pastille « Nouveau » jusqu'à la première visite).
    const nav = page.getByRole("navigation", { name: "Menu principal" });
    const link = nav.getByRole("link", { name: /Mises à jour/ });
    await expect(link).toContainText("Nouveau");
    await link.click();
    await expect(page).toHaveURL(/\/palacards\/nouveautes$/);
    await expect(page.getByRole("heading", { level: 1, name: "Dernières mises à jour" })).toBeVisible();

    // Le plus récent en affiche, avec sa liste à puces et son lien ; l'ancien dessous.
    const top = page.locator(`#maj-${latest.id}`);
    await expect(top.getByRole("heading", { name: "Mise à jour de test" })).toBeVisible();
    await expect(top.getByRole("listitem")).toHaveText(["Premier changement", "Second changement"]);
    await expect(page.locator(`#maj-${older.id}`).getByRole("heading", { name: "Ancienne annonce" })).toBeVisible();
    await expect(link).not.toContainText("Nouveau");

    await top.getByRole("link", { name: "Voir le boss" }).click();
    await expect(page).toHaveURL(/\/palacards\/boss$/);
  } finally {
    // Archivés : les parcours suivants ne voient pas ces messages s'ouvrir par-dessus la page.
    await apiCall(admin.page, "POST", `/admin/broadcasts/${latest.id}/archive`);
    await apiCall(admin.page, "POST", `/admin/broadcasts/${older.id}/archive`);
  }
});

test("mises à jour : le compteur avance et « Tout passer » ferme la série", async ({ browser }) => {
  const admin = await newPlayer(browser, "admin");
  await apiCall(admin.page, "POST", "/test/make-admin");
  const sent: Broadcast[] = [];
  for (const n of [1, 2, 3]) {
    sent.push(
      await apiCall<Broadcast>(admin.page, "POST", "/admin/broadcasts", {
        title: `Retour ${n}`,
        body: `Message ${n}.`,
        tone: "update",
        send: true,
      }),
    );
  }

  try {
    const { page } = await newPlayer(browser, "retour");
    const dialog = page.locator("dialog.pc-broadcast[open]");
    await expect(dialog.getByText("1 / 3")).toBeVisible();
    await dialog.getByRole("button", { name: "Suivant" }).click();
    // Le total reste fixe, le rang avance.
    await expect(dialog.getByText("2 / 3")).toBeVisible();
    await dialog.getByRole("button", { name: "Tout passer (2)" }).click();
    await expect(dialog).toHaveCount(0);

    // À la visite suivante, rien ne revient.
    await page.reload();
    await expect(page.getByRole("navigation", { name: "Menu principal" })).toBeVisible();
    await expect.poll(() => apiCall<Broadcast[]>(page, "GET", "/broadcasts/pending")).toEqual([]);
    await expect(dialog).toHaveCount(0);
  } finally {
    for (const m of sent) await apiCall(admin.page, "POST", `/admin/broadcasts/${m.id}/archive`);
  }
});
