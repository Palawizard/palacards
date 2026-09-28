ALTER TABLE "players" ADD COLUMN "auto_recycle_max" text;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "auto_recycle_keep_new" boolean DEFAULT true NOT NULL;