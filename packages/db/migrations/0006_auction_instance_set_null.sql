ALTER TABLE "auctions" DROP CONSTRAINT "auctions_instance_id_card_instances_id_fk";
--> statement-breakpoint
ALTER TABLE "auctions" ALTER COLUMN "instance_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "auctions" ADD CONSTRAINT "auctions_instance_id_card_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."card_instances"("id") ON DELETE set null ON UPDATE no action;