import { expect, test } from "@playwright/test";
import { apiCall, newPlayer } from "./helpers";

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
  // La récompense est affichée, avec la part qui reste à faire.
  await expect(alice.page.getByText(/paquet bonus · \+\d+\s?PW · \+[\d\s]+XP/)).toBeVisible();
  await expect(alice.page.getByText(/pour toucher la récompense/)).toBeVisible();
  await bob.page.goto("guild");
  await bob.page
    .locator("li", { hasText: `Club ${alice.name}` })
    .getByRole("button", { name: "Rejoindre" })
    .click();
  await expect(bob.page.getByText("Objectif de la semaine")).toBeVisible();
  await expect(bob.page.getByRole("link", { name: alice.name })).toBeVisible();
});

test("propose les pseudos pendant la saisie, au clavier comme au clic", async ({ browser }) => {
  const alice = await newPlayer(browser, "alice");
  const target = await newPlayer(browser, "zephyrin");

  // Échange : début du pseudo en majuscules et avec accent, puis Entrée sur la proposition.
  await alice.page.goto("trades/new");
  const to = alice.page.getByRole("combobox", { name: "Avec qui ?" });
  await to.fill(`ZÉPHYRIN${target.name.slice("zephyrin".length, -1).toUpperCase()}`);
  await expect(alice.page.getByRole("option", { name: target.name })).toBeVisible();
  await to.press("Enter");
  await expect(to).toHaveValue(target.name);
  await expect(alice.page.getByRole("listbox")).toHaveCount(0);
  await expect(alice.page.getByRole("list", { name: `Collection de ${target.name}` })).toBeVisible();

  // Duel : un clic (ou un toucher) sur la proposition remplit le champ.
  await alice.page.goto("battle");
  const opponent = alice.page.getByRole("combobox", { name: "Adversaire" });
  await opponent.fill(target.name.slice(2, -1));
  await alice.page.getByRole("option", { name: target.name }).click();
  await expect(opponent).toHaveValue(target.name);
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

test("filtre la collection d'un autre joueur par ses tags, sauf s'il les garde pour lui", async ({ browser }) => {
  const alice = await newPlayer(browser, "alice");
  const bob = await newPlayer(browser, "bob");
  const pack = await apiCall<{ cards: { instanceId: number }[] }>(alice.page, "POST", "/packs/open");
  const tagged = pack.cards.slice(0, 2).map((c) => c.instanceId);
  await apiCall(alice.page, "POST", "/collection/tags", { instanceIds: tagged, add: "Châteaux" });

  // Tags privés par défaut : Bob ne peut pas filtrer par tag.
  await bob.page.goto(`u/${alice.name.toLowerCase()}`);
  await expect(bob.page.getByText("10 cartes")).toBeVisible();
  await expect(bob.page.getByLabel("Tag")).toHaveCount(0);

  // Alice les partage depuis ses paramètres : Bob filtre sa collection sur son tag.
  await alice.page.goto("settings");
  await alice.page.getByLabel("Partager mes tags").check();
  await expect(alice.page.getByText("Tes tags sont partagés.")).toBeVisible();
  await bob.page.reload();
  await expect(bob.page.getByText("10 cartes")).toBeVisible();
  await bob.page.getByLabel("Tag").selectOption("châteaux");
  await expect(bob.page.getByText("2 cartes")).toBeVisible();

  // Alice les garde de nouveau pour elle : plus de filtre par tag chez Bob.
  await alice.page.getByLabel("Partager mes tags").uncheck();
  await expect(alice.page.getByText("Tes tags restent privés.")).toBeVisible();
  await bob.page.reload();
  await expect(bob.page.getByText("10 cartes")).toBeVisible();
  await expect(bob.page.getByLabel("Tag")).toHaveCount(0);
});

test("bannière choisie dans sa collection, vue sur son profil par un autre joueur, puis retirée", async ({
  browser,
}) => {
  const alice = await newPlayer(browser, "alice");
  const bob = await newPlayer(browser, "bob");
  const pack = await apiCall<{ cards: { title: string }[] }>(alice.page, "POST", "/packs/open");
  const title = pack.cards[0]!.title;

  // Alice choisit un article de sa collection depuis son profil.
  await alice.page.goto(`u/${alice.name.toLowerCase()}`);
  await alice.page.getByRole("button", { name: "Choisir une bannière" }).click();
  const picker = alice.page.getByRole("dialog", { name: "Choisir ta bannière" });
  await picker.getByLabel("Chercher dans ta collection").fill(title);
  await picker.getByRole("button").filter({ hasText: title }).first().click();
  await expect(alice.page.getByText(`${title} devient ta bannière.`)).toBeVisible();
  await expect(alice.page.getByRole("button", { name: "Changer la bannière" })).toBeVisible();

  // Bob la voit en haut du profil d'Alice, sans bouton pour la changer.
  await bob.page.goto(`u/${alice.name.toLowerCase()}`);
  const banner = bob.page.locator(".pc-banner");
  await expect(banner.getByText(title)).toBeVisible();
  await expect(bob.page.getByRole("button", { name: "Changer la bannière" })).toHaveCount(0);

  // Alice revient à la bannière par défaut.
  await alice.page.getByRole("button", { name: "Revenir à la bannière par défaut" }).click();
  await expect(alice.page.getByText("Bannière par défaut rétablie.")).toBeVisible();
  await bob.page.reload();
  await expect(bob.page.getByText("Joueur depuis")).toBeVisible();
  await expect(banner.getByText(title)).toHaveCount(0);
});

test("note de statut : écrite sur son profil, vue par un ami, effacée", async ({ browser }) => {
  const alice = await newPlayer(browser, "alice");
  const bob = await newPlayer(browser, "bob");
  await apiCall(alice.page, "POST", "/friends", { username: bob.name });
  await apiCall(bob.page, "POST", "/friends", { username: alice.name });
  const note = "Je cherche des cartes de volcans <3";

  // Alice écrit sa note depuis son profil ; un lien est refusé avant l'envoi.
  await alice.page.goto(`u/${alice.name.toLowerCase()}`);
  await alice.page.getByRole("button", { name: "Ajouter une note" }).click();
  const field = alice.page.getByLabel("Ta note de statut");
  await field.fill("Viens sur www.monsite.fr");
  await expect(alice.page.getByText("Pas de liens dans ta note.")).toBeVisible();
  await expect(alice.page.getByRole("button", { name: "Enregistrer" })).toBeDisabled();
  await field.fill(note);
  await alice.page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(alice.page.getByText("Note enregistrée.")).toBeVisible();

  // Bob la voit dans sa liste d'amis et sur le profil d'Alice.
  await bob.page.goto("friends");
  await expect(bob.page.getByText(note)).toBeVisible();
  await bob.page.goto(`u/${alice.name.toLowerCase()}`);
  await expect(bob.page.getByText(note)).toBeVisible();

  // Alice l'efface : elle disparaît chez Bob.
  await alice.page.getByRole("button", { name: "Effacer", exact: true }).click();
  await expect(alice.page.getByText("Note effacée.")).toBeVisible();
  await bob.page.reload();
  await expect(bob.page.getByText("Joueur depuis")).toBeVisible();
  await expect(bob.page.getByText(note)).toHaveCount(0);
});
