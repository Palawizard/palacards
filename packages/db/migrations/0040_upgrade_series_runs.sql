CREATE TABLE "upgrade_series_runs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "upgrade_series_runs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" text NOT NULL,
	"rarity" "rarity" NOT NULL,
	"target" "rarity" NOT NULL,
	"lots" jsonb NOT NULL,
	"successes" smallint NOT NULL,
	"refund" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "upgrade_series_runs" ADD CONSTRAINT "upgrade_series_runs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "upgrade_series_runs_user_idx" ON "upgrade_series_runs" USING btree ("user_id","created_at");