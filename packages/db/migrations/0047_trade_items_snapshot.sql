-- Historique des échanges (suggestion n° 118) : une carte fusionnée, recyclée ou upgradée après un échange effaçait
-- sa ligne (ON DELETE CASCADE). Chaque carte d'échange garde désormais une photo de l'exemplaire, et la clé
-- étrangère passe à SET NULL.
ALTER TABLE "trade_items" DROP CONSTRAINT "trade_items_instance_id_card_instances_id_fk";
--> statement-breakpoint
ALTER TABLE "trade_items" DROP CONSTRAINT "trade_items_trade_id_instance_id_pk";--> statement-breakpoint
ALTER TABLE "trade_items" ALTER COLUMN "instance_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "trade_items" ADD COLUMN "id" bigint PRIMARY KEY NOT NULL GENERATED ALWAYS AS IDENTITY (sequence name "trade_items_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1);--> statement-breakpoint
ALTER TABLE "trade_items" ADD COLUMN "card_id" bigint;--> statement-breakpoint
ALTER TABLE "trade_items" ADD COLUMN "season" smallint;--> statement-breakpoint
ALTER TABLE "trade_items" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "trade_items" ADD COLUMN "rarity" "rarity";--> statement-breakpoint
ALTER TABLE "trade_items" ADD COLUMN "shiny" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "trade_items" ADD COLUMN "atk" smallint;--> statement-breakpoint
ALTER TABLE "trade_items" ADD COLUMN "def" smallint;--> statement-breakpoint
ALTER TABLE "trade_items" ADD COLUMN "level" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "trade_items" ADD COLUMN "fate" text;--> statement-breakpoint
ALTER TABLE "trade_items" ADD COLUMN "fate_at" timestamp with time zone;--> statement-breakpoint
-- Photo des échanges existants : toutes les lignes restantes ont encore leur exemplaire (les autres ont été
-- effacées par la cascade et ne se récupèrent pas). Article, rareté, brillance et stats de base ne changent jamais ;
-- le niveau actuel est diminué des fusions faites dans cet exemplaire après l'échange (ledger, raison `fusion`,
-- `source>cible` ou `a+b>cible,c>cible2` ; la dernière partie d'une référence tronquée à 2 000 caractères est ignorée).
WITH parts AS (
  SELECT l.created_at, p.part, p.n, cardinality(string_to_array(l.ref_id, ',')) AS total, char_length(l.ref_id) AS len
  FROM "ledger" l, unnest(string_to_array(l.ref_id, ',')) WITH ORDINALITY AS p(part, n)
  WHERE l.reason = 'fusion' AND l.ref_id IS NOT NULL
), fusions AS (
  SELECT created_at, split_part(part, '>', 2)::bigint AS target,
         cardinality(string_to_array(split_part(part, '>', 1), '+')) AS levels
  FROM parts
  WHERE part ~ '^[0-9]+(\+[0-9]+)*>[0-9]+$' AND NOT (len >= 2000 AND n = total)
)
UPDATE "trade_items" ti SET
  card_id = ci.card_id,
  season = ci.season,
  title = c.title,
  rarity = ci.rarity,
  shiny = ci.shiny,
  atk = ci.atk,
  def = ci.def,
  level = greatest(1, ci.level - coalesce((
    SELECT sum(f.levels) FROM fusions f
    WHERE f.target = ti.instance_id AND f.created_at > coalesce(t.resolved_at, t.created_at)
  ), 0))
FROM "card_instances" ci, "cards" c, "trades" t
WHERE ci.id = ti.instance_id AND c.season = ci.season AND c.id = ci.card_id AND t.id = ti.trade_id;--> statement-breakpoint
-- Échanges conclus dont l'exemplaire a changé de main depuis (revendu au marché ou échangé de nouveau).
UPDATE "trade_items" ti SET fate = CASE ci.source WHEN 'market' THEN 'sold' ELSE 'traded' END, fate_at = ci.obtained_at
FROM "trades" t, "card_instances" ci
WHERE t.id = ti.trade_id AND t.status = 'accepted' AND ci.id = ti.instance_id
  AND ci.owner_id <> CASE ti.side WHEN 'from' THEN t.to_id ELSE t.from_id END;--> statement-breakpoint
ALTER TABLE "trade_items" ALTER COLUMN "card_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "trade_items" ALTER COLUMN "season" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "trade_items" ALTER COLUMN "title" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "trade_items" ALTER COLUMN "rarity" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "trade_items" ALTER COLUMN "atk" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "trade_items" ALTER COLUMN "def" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "trade_items" ADD CONSTRAINT "trade_items_instance_id_card_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."card_instances"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "trade_items_trade_instance_uq" ON "trade_items" USING btree ("trade_id","instance_id");
