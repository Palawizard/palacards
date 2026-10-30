import { expect, test } from "@playwright/test";
import { apiCall, instantPacks, newPlayer } from "./helpers";

interface PortfolioDTO {
  cards: { instanceId: number; by: string }[];
  members: { username: string }[];
}

test("inviter un ami dans un portfolio, qui y ajoute ses cartes, puis lui retirer l'accès (suggestion n° 125)", async ({
  browser,
}) => {
  const owner = await newPlayer(browser, "hote");
  const friend = await newPlayer(browser, "invite");
  await apiCall(owner.page, "POST", "/friends", { username: friend.name });
  await apiCall(friend.page, "POST", "/friends", { username: owner.name });
  await instantPacks(friend.page);
  await apiCall(friend.page, "POST", "/packs/open");
  const { id } = await apiCall<{ id: number }>(owner.page, "POST", "/portfolios", { name: "À plusieurs mains" });

  // Le propriétaire invite son ami depuis l'éditeur.
  const { page } = owner;
  await page.goto(`portfolios/${id}/modifier`);
  const share = page.getByRole("region", { name: /^Partage/ });
  await share.getByLabel("Inviter un ami").selectOption(friend.name);
  await share.getByRole("button", { name: "Inviter" }).click();
  await expect(share.getByText("Invitation envoyée", { exact: true })).toBeVisible();
  await expect(share.getByRole("heading", { name: /2 \/ 5/ })).toBeVisible();

  // L'ami accepte depuis la page Portfolios et ajoute deux de ses cartes.
  const f = friend.page;
  await f.goto("portfolios");
  const invites = f.getByRole("region", { name: "Invitations" });
  await expect(invites.getByText("À plusieurs mains")).toBeVisible();
  await invites.getByRole("button", { name: "Rejoindre" }).click();
  await expect(invites).toHaveCount(0);
  await f.getByRole("link", { name: "Mes cartes" }).click();
  await expect(f).toHaveURL(new RegExp(`/portfolios/${id}/modifier$`));
  await expect(f.getByRole("heading", { level: 1, name: "Tes cartes dans ce portfolio" })).toBeVisible();
  // Ni titre ni design pour lui.
  await expect(f.getByRole("radio", { name: "Azur" })).toHaveCount(0);
  await f.getByRole("button", { name: /Ajouter des cartes/ }).click();
  const picker = f.getByRole("dialog", { name: "Ajouter des cartes" });
  const free = picker.locator(".pc-pick:not([disabled]):not([aria-pressed='true'])");
  for (let i = 0; i < 2; i++) await free.first().click();
  await picker.getByRole("button", { name: "Ajouter (2)" }).click();
  await expect(f.getByRole("heading", { name: /Cartes\s*2 \/ 30/ })).toBeVisible();
  const shared = await apiCall<PortfolioDTO>(f, "GET", `/portfolios/${id}`);
  expect(shared.cards.map((c) => c.by)).toEqual([friend.name, friend.name]);

  // La page publique nomme les deux participants.
  await page.goto(`portfolios/${id}`);
  await expect(page.getByRole("link", { name: friend.name })).toBeVisible();
  await expect(page.getByRole("list", { name: "Cartes de À plusieurs mains" }).getByRole("listitem")).toHaveCount(2);

  // Le propriétaire retire l'accès : les cartes de l'ami quittent le portfolio et restent à lui.
  await page.goto(`portfolios/${id}/modifier`);
  await share.getByRole("button", { name: `Retirer ${friend.name} du portfolio` }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Retirer" }).click();
  await expect(page.getByRole("heading", { name: /Cartes\s*0 \/ 30/ })).toBeVisible();
  const after = await apiCall<PortfolioDTO>(page, "GET", `/portfolios/${id}`);
  expect(after.members).toEqual([]);
  const mine = await apiCall<{ items: unknown[] }>(f, "GET", "/collection?limit=60");
  expect(mine.items.length).toBeGreaterThanOrEqual(2);
});
