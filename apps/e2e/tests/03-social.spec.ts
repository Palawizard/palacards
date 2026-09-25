import { expect, test } from "@playwright/test";
import { newPlayer } from "./helpers";

test("ami → message en temps réel → guilde", async ({ browser }) => {
  const alice = await newPlayer(browser, "alice");
  const bob = await newPlayer(browser, "bob");

  // Alice ajoute Bob, Bob accepte depuis sa page Amis.
  await alice.page.goto("friends");
  await alice.page.getByLabel("Pseudo à ajouter").fill(bob.name);
  await alice.page.getByRole("button", { name: "Ajouter" }).click();
  await expect(alice.page.getByText("Demande envoyée.")).toBeVisible();
  await bob.page.goto("friends");
  await bob.page.getByRole("button", { name: "Accepter" }).click();
  await expect(bob.page.getByText("Nouvel ami !")).toBeVisible();

  // Bob attend dans sa messagerie ; le message d'Alice arrive sans recharger.
  await bob.page.goto("messages");
  await alice.page.goto(`messages?to=${bob.name}`);
  await alice.page.getByLabel("Message", { exact: true }).fill("Salut, tu échanges ta Tour Eiffel ?");
  await alice.page.getByRole("button", { name: "Envoyer" }).click();
  // exact : l'aperçu de la conversation (« Toi : … ») contient aussi le texte.
  await expect(alice.page.getByText("Salut, tu échanges ta Tour Eiffel ?", { exact: true })).toBeVisible();
  await expect(bob.page.getByRole("link", { name: new RegExp(alice.name, "i") })).toBeVisible();
  await bob.page
    .getByRole("link", { name: new RegExp(alice.name, "i") })
    .first()
    .click();
  // Côté destinataire, l'aperçu n'a pas de préfixe « Toi : » : on cible la bulle du message.
  await expect(
    bob.page.getByRole("paragraph").filter({ hasText: "Salut, tu échanges ta Tour Eiffel ?" }),
  ).toBeVisible();

  // Alice fonde une guilde, Bob la rejoint.
  await alice.page.goto("guild");
  await alice.page.getByLabel("Nom").fill(`Club ${alice.name}`);
  // Blason aléatoire : il doit rester unique si la base E2E sert plusieurs fois (--repeat-each).
  const crest = Array.from({ length: 5 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join("");
  await alice.page.getByLabel("Blason (2 à 5 lettres)").fill(crest);
  await alice.page.getByRole("button", { name: "Fonder" }).click();
  await expect(alice.page.getByText("Objectif de la semaine")).toBeVisible();
  await bob.page.goto("guild");
  await bob.page
    .locator("li", { hasText: `Club ${alice.name}` })
    .getByRole("button", { name: "Rejoindre" })
    .click();
  await expect(bob.page.getByText("Objectif de la semaine")).toBeVisible();
  await expect(bob.page.getByRole("link", { name: alice.name })).toBeVisible();
});

test("photo de profil importée depuis les paramètres", async ({ browser }) => {
  const { page, name } = await newPlayer(browser, "photo");
  await page.goto("settings");
  // Image de 40 × 30 px : recadrée en carré et réencodée par le navigateur avant l'envoi.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAACgAAAAeCAIAAADRv8uKAAAALklEQVR4nO3NMQEAMAgAoLk0ZjKxsazg5wMFiM56F/7JKhaLxWKxWCwWi8XilQH91QGGD5y0UgAAAABJRU5ErkJggg==",
    "base64",
  );
  await page.getByLabel("Importer une photo").setInputFiles({ name: "moi.png", mimeType: "image/png", buffer: png });
  await expect(page.getByText("Photo de profil mise à jour.")).toBeVisible();

  const header = page.getByRole("button", { name: `Compte de ${name}` }).locator("img");
  await expect(header).toHaveAttribute("src", /\/avatars\/.+\?v=/);
  await expect.poll(() => header.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(256);

  await page.getByRole("button", { name: "Retirer la photo" }).click();
  await expect(page.getByText("Photo retirée.")).toBeVisible();
  await expect(header).toHaveCount(0);
});
