import { and, eq, inArray, schema, sql } from "@palacards/db";
import {
  autoRecyclePicks,
  consumeFreePack,
  expectedPackPoints,
  PITY_THRESHOLD,
  pulledPackPoints,
  recycleValue,
  rollPack,
  rollShiny,
  type Rarity,
} from "@palacards/game";
import type { CardDTO, PackState } from "@palacards/shared";
import type { Ctx } from "../context.js";
import { conflict } from "../errors.js";
import { instancesByIds, loadMediaInBackground } from "./cards.js";
import { schedulePacksFull } from "./economy.js";
import { announcePulls, logPulls } from "./feed.js";
import { bumpObjective } from "./guilds.js";
import { afterCommit } from "./notifications.js";
import { emit } from "./progression.js";
import {
  activeSeason,
  getPlayer,
  lockPlayer,
  logMovement,
  movePw,
  ownedCount,
  packState,
  pushWallet,
  type DbOrTx,
} from "./players.js";
import { addThemePacks, drawThemeCard, getTheme, isOnSale, lockThemeStock, themeRarityCounts } from "./themes.js";

type Tx = Parameters<Parameters<Ctx["db"]["transaction"]>[0]>[0];

const RAND_SCALE = 2 ** 30;

/**
 * Tire un article d'une rareté via l'index (season, rarity, rand_key) : on part d'une clé aléatoire
 * et on prend la suivante, en rebouclant sur 0. Jamais d'ORDER BY random().
 */
export async function drawCard(db: DbOrTx, season: number, rarity: Rarity, random: Ctx["random"]) {
  const key = random(RAND_SCALE) / RAND_SCALE;
  for (const from of [key, 0]) {
    const [row] = await db.execute<{ id: string; title: string; atk: number; def: number }>(sql`
      select id, title, atk, def from cards
      where season = ${season} and rarity = ${rarity}::rarity and rand_key >= ${from}
      order by rand_key limit 1
    `);
    if (row) return { id: Number(row.id), title: row.title, atk: row.atk, def: row.def };
  }
  throw conflict("empty_tier", `Aucune carte ${rarity} dans la saison ${season}.`);
}

export async function getPackState(ctx: Ctx, userId: string): Promise<PackState> {
  return packState(await getPlayer(ctx.db, userId), ctx.now());
}

export interface OpenedPack {
  cards: CardDTO[];
  packs: PackState;
  usedBonus: boolean;
  pityTriggered: boolean;
  /** Booster à thème : articles du thème (les autres emplacements, sans article du thème à cette rareté, sont tirés dans toute la saison). */
  theme?: { id: number; name: string; themedCardIds: number[]; owned: number; opened: number };
  /** Recyclage automatique (réglage du joueur) : exemplaires recyclés dès l'ouverture et PW gagnés. */
  autoRecycled?: { instanceIds: number[]; gain: number };
}

export interface OpenPackOptions {
  /** Ouvre un booster à thème au lieu d'un paquet du stock. */
  themeId?: number;
  /** Booster à thème sans stock : l'achète (prix du thème en PW, pendant la vente) et l'ouvre aussitôt. */
  buy?: boolean;
}

/** Hook appelé dans la transaction après un tirage (succès, objectifs de guilde…). */
export type AfterPackHook = (tx: Tx, userId: string, rarities: Rarity[]) => Promise<void>;
const afterPackHooks: AfterPackHook[] = [];
export const onPackOpened = (hook: AfterPackHook) => afterPackHooks.push(hook);

/**
 * Ouvre un paquet : une seule transaction (joueur verrouillé, stock décrémenté, 5 exemplaires,
 * pity, ledger). La réponse part tout de suite ; les images manquantes arrivent ensuite par socket.
 */
export async function openPack(ctx: Ctx, userId: string, options: OpenPackOptions = {}): Promise<OpenedPack> {
  const now = ctx.now();
  const result = await ctx.db.transaction(async (tx) => {
    const p = await lockPlayer(tx, userId);
    const season = await activeSeason(tx);
    const theme = options.themeId ? await getTheme(tx, options.themeId) : null;
    let free: ReturnType<typeof consumeFreePack> = null;
    let usedBonus = false;
    let themeOwned = 0;
    const update: Partial<typeof schema.players.$inferInsert> = {};
    if (theme) {
      const stock = await lockThemeStock(tx, userId, theme.id);
      if (stock > 0) {
        themeOwned = await addThemePacks(tx, userId, theme.id, -1, "pack_open");
      } else if (options.buy) {
        if (!isOnSale(theme, now)) throw conflict("theme_not_on_sale", "Ce booster à thème n'est pas en vente.");
        await movePw(tx, p, -theme.price, "theme_pack", `theme:${theme.id}`);
      } else {
        throw conflict("no_theme_packs", "Tu n'as pas de booster de ce thème.");
      }
    } else {
      free = consumeFreePack(p.packsStored, p.packsUpdatedAt, now);
      if (free) {
        update.packsStored = free.stored;
        update.packsUpdatedAt = free.updatedAt;
      } else if (p.bonusPacks > 0) {
        update.bonusPacks = p.bonusPacks - 1;
        usedBonus = true;
      } else {
        throw conflict("no_packs", "Plus de paquet : le prochain arrive bientôt.");
      }
    }

    // Compteur « boosters ouverts » du thème (page Paquets et profil).
    let themeOpened = 0;
    if (theme) {
      const pt = schema.playerThemePacks;
      const [row] = await tx
        .insert(pt)
        .values({ userId, themeId: theme.id, count: 0, opened: 1 })
        .onConflictDoUpdate({ target: [pt.userId, pt.themeId], set: { opened: sql`${pt.opened} + 1` } })
        .returning({ opened: pt.opened });
      themeOpened = row!.opened;
    }

    const roll = rollPack(p.pityCounter, ctx.random, theme ? "themed" : "standard", theme?.noLegendary);
    update.pityCounter = roll.pityCounter;
    const drawn: {
      rarity: Rarity;
      shiny: boolean;
      id: number;
      title: string;
      atk: number;
      def: number;
      themed: boolean;
    }[] = [];
    const counts = theme ? await themeRarityCounts(tx, theme.id, season) : null;
    for (const rarity of roll.rarities) {
      // Brillante : tirée carte par carte, indépendamment de la rareté.
      const shiny = rollShiny(ctx.random);
      drawn.push(
        theme && counts
          ? { rarity, shiny, ...(await drawThemeCard(tx, season, theme.id, rarity, counts, ctx.random)) }
          : { rarity, shiny, ...(await drawCard(tx, season, rarity, ctx.random)), themed: false },
      );
    }

    // Recyclage automatique : articles déjà possédés avant ce paquet (pour garder les nouveaux).
    const ownedBefore =
      p.autoRecycleMax && p.autoRecycleKeepNew
        ? new Set(
            (
              await tx
                .selectDistinct({ cardId: schema.cardInstances.cardId })
                .from(schema.cardInstances)
                .where(
                  and(
                    eq(schema.cardInstances.ownerId, userId),
                    inArray(
                      schema.cardInstances.cardId,
                      drawn.map((d) => d.id),
                    ),
                  ),
                )
            ).map((r) => r.cardId),
          )
        : new Set<number>();

    const inserted = await tx
      .insert(schema.cardInstances)
      .values(
        drawn.map((d) => ({
          ownerId: userId,
          cardId: d.id,
          season,
          rarity: d.rarity,
          atk: d.atk,
          def: d.def,
          shiny: d.shiny,
          source: "pack" as const,
          obtainedAt: now,
        })),
      )
      .returning({ id: schema.cardInstances.id });
    await tx.update(schema.players).set(update).where(eq(schema.players.userId, userId));

    const ids = inserted.map((r) => r.id);
    if (usedBonus) await logMovement(tx, userId, "bonus_pack", -1, update.bonusPacks!, "pack_open", ids.join(","));
    else if (free) await logMovement(tx, userId, "pack", -1, free.stored, "pack_open", ids.join(","));
    await logMovement(tx, userId, "card", ids.length, await ownedCount(tx, userId), "pack_open", ids.join(","));

    // Classements « Boosters ouverts » et « Chance » : points tirés face à l'espérance de ce paquet (type et pity).
    const pulled = pulledPackPoints(roll.rarities);
    const expected = expectedPackPoints(
      theme ? "themed" : "standard",
      p.pityCounter >= PITY_THRESHOLD,
      theme?.noLegendary,
    );
    await tx
      .insert(schema.packStats)
      .values({ userId, season, packs: 1, luckPacks: 1, pulledPoints: pulled, expectedPoints: expected })
      .onConflictDoUpdate({
        target: [schema.packStats.userId, schema.packStats.season],
        set: {
          packs: sql`${schema.packStats.packs} + 1`,
          luckPacks: sql`${schema.packStats.luckPacks} + 1`,
          pulledPoints: sql`${schema.packStats.pulledPoints} + ${pulled}`,
          expectedPoints: sql`${schema.packStats.expectedPoints} + ${expected}`,
        },
      });

    for (const hook of afterPackHooks) await hook(tx, userId, roll.rarities);
    const notable = await logPulls(
      tx,
      userId,
      theme ? "theme" : "pack",
      drawn.map((d) => ({ cardId: d.id, season, rarity: d.rarity, shiny: d.shiny, title: d.title })),
    );

    // Réponse lue dans la transaction : une fois le paquet consommé, plus rien ne peut faire échouer la requête.
    const cards = await instancesByIds(tx, ids, userId);
    const picks = autoRecyclePicks(
      drawn.map((d) => ({ cardId: d.id, rarity: d.rarity, shiny: d.shiny })),
      p.autoRecycleMax,
      p.autoRecycleKeepNew,
      ownedBefore,
    );
    let autoRecycled: OpenedPack["autoRecycled"];
    if (picks.length) {
      const gone = picks.map((i) => ids[i]!);
      const gain = picks.reduce((s, i) => s + recycleValue(drawn[i]!.rarity, drawn[i]!.shiny), 0);
      await tx.delete(schema.cardInstances).where(inArray(schema.cardInstances.id, gone));
      await logMovement(tx, userId, "card", -gone.length, await ownedCount(tx, userId), "recycle", gone.join(","));
      await movePw(tx, p, gain, "recycle", gone.join(","));
      autoRecycled = { instanceIds: gone, gain };
    }
    const state = { ...p, ...update } as typeof p;
    return {
      cards,
      autoRecycled,
      packs: packState(state, now),
      drawn,
      notable,
      recycledRarities: picks.map((i) => drawn[i]!.rarity),
      usedBonus,
      pityTriggered: p.pityCounter >= PITY_THRESHOLD,
      state,
      theme: theme
        ? {
            id: theme.id,
            name: theme.name,
            themedCardIds: drawn.filter((d) => d.themed).map((d) => d.id),
            owned: themeOwned,
            opened: themeOpened,
          }
        : undefined,
    };
  });

  // Effets secondaires après le commit : une erreur est journalisée, jamais renvoyée au joueur.
  await afterCommit(ctx, async () => {
    ctx.rt.toUser(userId, "packs:update", result.packs);
    if (result.theme || result.autoRecycled) pushWallet(ctx, result.state);
  });
  await afterCommit(ctx, async () => {
    await schedulePacksFull(ctx, userId, result.state.packsStored, result.state.packsUpdatedAt);
    await bumpObjective(ctx, userId, {
      open_packs: 1,
      pull_sr: result.drawn.filter((d) => d.rarity === "SR" || d.rarity === "UR" || d.rarity === "L").length,
    });
    // Progression en arrière-plan (succès, quêtes, passe) : l'ouverture du paquet ne l'attend pas.
    const events: Parameters<typeof emit>[2][] = [
      {
        type: "pack_opened",
        rarities: result.drawn.map((d) => d.rarity),
        shinies: result.drawn.map((d) => d.shiny),
        titles: result.drawn.map((d) => d.title),
        themed: !!result.theme,
      },
    ];
    if (result.recycledRarities.length) events.push({ type: "recycled", rarities: result.recycledRarities });
    void emit(ctx, userId, ...events, "collection");
    await announcePulls(ctx, userId, result.notable);
  });
  await afterCommit(ctx, async () =>
    loadMediaInBackground(
      ctx,
      userId,
      result.drawn.map((d) => ({ cardId: d.id, title: d.title })),
    ),
  );
  return {
    cards: result.cards,
    packs: result.packs,
    usedBonus: result.usedBonus,
    pityTriggered: result.pityTriggered,
    ...(result.theme ? { theme: result.theme } : {}),
    ...(result.autoRecycled ? { autoRecycled: result.autoRecycled } : {}),
  };
}
