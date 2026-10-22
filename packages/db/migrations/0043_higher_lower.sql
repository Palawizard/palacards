CREATE TABLE "hl_runs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "hl_runs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" text NOT NULL,
	"day" date NOT NULL,
	"try_no" smallint NOT NULL,
	"status" text DEFAULT 'playing' NOT NULL,
	"step" smallint DEFAULT 0 NOT NULL,
	"streak" smallint DEFAULT 0 NOT NULL,
	"season" smallint NOT NULL,
	"kept_card_id" bigint NOT NULL,
	"challenger_card_id" bigint NOT NULL,
	"deadline" timestamp with time zone NOT NULL,
	"end_reason" text,
	"reward" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "hl_seen" (
	"user_id" text NOT NULL,
	"day" date NOT NULL,
	"card_id" bigint NOT NULL,
	CONSTRAINT "hl_seen_user_id_day_card_id_pk" PRIMARY KEY("user_id","day","card_id")
);
--> statement-breakpoint
ALTER TABLE "hl_runs" ADD CONSTRAINT "hl_runs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hl_seen" ADD CONSTRAINT "hl_seen_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "hl_runs_try_uq" ON "hl_runs" USING btree ("user_id","day","try_no");--> statement-breakpoint
CREATE INDEX "hl_runs_playing_idx" ON "hl_runs" USING btree ("deadline") WHERE "hl_runs"."status" = 'playing';--> statement-breakpoint
CREATE INDEX "hl_runs_month_idx" ON "hl_runs" USING btree ("day","streak");