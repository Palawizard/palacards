import { and, asc, eq, inArray, schema, sql } from "@palacards/db";
import { DECK_SIZE, SAVED_DECKS_MAX, savedDeckName, savedDeckStatus } from "@palacards/game";
import type { SavedDeckDTO } from "@palacards/shared";
import type { Ctx } from "../context.js";
import { badRequest, conflict, notFound } from "../errors.js";
import { ownInstances } from "./collection.js";
import { lockPlayer, type DbOrTx } from "./players.js";

// ---------------------------------------------------------------------------
// Decks de bataille enregistrés : privés, au plus SAVED_DECKS_MAX par joueur. Le duel vérifie toujours
// lui-même le deck envoyé (5 exemplaires distincts possédés) : un deck à réparer ne peut pas servir.
// ---------------------------------------------------------------------------

const sd = schema.savedDecks;
type Row = typeof sd.$inferSelect;

/** Nom nettoyé, sinon erreur lisible. */
function cleanName(name: string): string {
  const clean = savedDeckName(name);
  if (!clean) throw badRequest("invalid_name", "Donne un nom à ton deck.");
  return clean;
}

/** Exemplaires distincts, tous dans la collection du joueur au moment de l'enregistrement. */
async function checkCards(db: DbOrTx, userId: string, cards: number[]) {
  if (cards.length > DECK_SIZE || new Set(cards).size !== cards.length) {
    throw badRequest("invalid_deck", `Un deck compte au plus ${DECK_SIZE} cartes différentes.`);
  }
  if (!cards.length) return;
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.cardInstances)
    .where(and(inArray(schema.cardInstances.id, cards), eq(schema.cardInstances.ownerId, userId)));
  if ((row?.n ?? 0) !== cards.length) throw notFound("Une carte du deck n'est plus dans ta collection.");
}

/** Vue d'un deck : cartes encore possédées, et celles à remplacer. */
async function toDTOs(ctx: Ctx, userId: string, rows: Row[]): Promise<SavedDeckDTO[]> {
  const owned = await ownInstances(ctx, userId, [...new Set(rows.flatMap((r) => r.cards))]);
  const byId = new Map(owned.map((c) => [c.instanceId, c]));
  return rows.map((r) => {
    const cards = r.cards.map((id) => byId.get(id) ?? null);
    const missing = cards.filter((c) => !c).length;
    return {
      id: r.id,
      name: r.name,
      cards,
      missing,
      status: savedDeckStatus(cards.length, missing),
      updatedAt: r.updatedAt.toISOString(),
    };
  });
}

export async function listSavedDecks(ctx: Ctx, userId: string): Promise<SavedDeckDTO[]> {
  const rows = await ctx.db.select().from(sd).where(eq(sd.userId, userId)).orderBy(asc(sd.createdAt), asc(sd.id));
  return toDTOs(ctx, userId, rows);
}

async function deckOf(ctx: Ctx, userId: string, row: Row | undefined): Promise<SavedDeckDTO> {
  if (!row) throw notFound("Ce deck n'existe pas.");
  return (await toDTOs(ctx, userId, [row]))[0]!;
}

export async function createSavedDeck(
  ctx: Ctx,
  userId: string,
  input: { name: string; cards: number[] },
): Promise<SavedDeckDTO> {
  const name = cleanName(input.name);
  const row = await ctx.db.transaction(async (tx) => {
    // Un enregistrement à la fois par joueur : le plafond tient même avec deux onglets.
    await lockPlayer(tx, userId);
    const [count] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(sd)
      .where(eq(sd.userId, userId));
    if ((count?.n ?? 0) >= SAVED_DECKS_MAX) {
      throw conflict(
        "deck_limit",
        `Tu as déjà ${SAVED_DECKS_MAX} decks enregistrés : supprimes-en un ou modifie un deck existant.`,
      );
    }
    await checkCards(tx, userId, input.cards);
    const now = ctx.now();
    const [created] = await tx
      .insert(sd)
      .values({ userId, name, cards: input.cards, createdAt: now, updatedAt: now })
      .returning();
    return created;
  });
  return deckOf(ctx, userId, row);
}

export async function updateSavedDeck(
  ctx: Ctx,
  userId: string,
  deckId: number,
  input: { name?: string; cards?: number[] },
): Promise<SavedDeckDTO> {
  const name = input.name === undefined ? undefined : cleanName(input.name);
  if (input.cards) await checkCards(ctx.db, userId, input.cards);
  const [row] = await ctx.db
    .update(sd)
    .set({ ...(name !== undefined && { name }), ...(input.cards && { cards: input.cards }), updatedAt: ctx.now() })
    .where(and(eq(sd.id, deckId), eq(sd.userId, userId)))
    .returning();
  return deckOf(ctx, userId, row);
}

export async function deleteSavedDeck(ctx: Ctx, userId: string, deckId: number) {
  const gone = await ctx.db
    .delete(sd)
    .where(and(eq(sd.id, deckId), eq(sd.userId, userId)))
    .returning({ id: sd.id });
  if (!gone.length) throw notFound("Ce deck n'existe pas.");
}
