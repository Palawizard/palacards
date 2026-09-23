ALTER TABLE "cards" ALTER COLUMN "rand_key" SET DATA TYPE double precision;--> statement-breakpoint
ALTER TABLE "cards" ALTER COLUMN "rand_key" SET DEFAULT random();--> statement-breakpoint
-- Nouvelles clés en double précision : en float4, des milliers de communes partageaient la même clé et ne sortaient jamais.
UPDATE "cards" SET "rand_key" = random();--> statement-breakpoint
CREATE INDEX "cards_views_idx" ON "cards" USING btree ("season","views_12m","id");--> statement-breakpoint
CREATE INDEX "cards_atk_idx" ON "cards" USING btree ("season","atk","id");--> statement-breakpoint
CREATE INDEX "cards_def_idx" ON "cards" USING btree ("season","def","id");--> statement-breakpoint
CREATE INDEX "cards_title_idx" ON "cards" USING btree ("season","title","id");