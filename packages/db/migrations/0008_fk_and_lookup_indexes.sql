CREATE INDEX "auctions_instance_idx" ON "auctions" USING btree ("instance_id");--> statement-breakpoint
CREATE INDEX "card_instances_card_season_idx" ON "card_instances" USING btree ("card_id","season");--> statement-breakpoint
CREATE INDEX "cards_id_idx" ON "cards" USING btree ("id");--> statement-breakpoint
CREATE INDEX "trade_items_instance_idx" ON "trade_items" USING btree ("instance_id");