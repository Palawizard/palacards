CREATE TABLE "hl_steps" (
	"run_id" bigint NOT NULL,
	"step" smallint NOT NULL,
	"kept_card_id" bigint NOT NULL,
	"challenger_card_id" bigint NOT NULL,
	"kept_views" bigint NOT NULL,
	"challenger_views" bigint NOT NULL,
	"pick" text NOT NULL,
	"correct" boolean NOT NULL,
	"timeout" boolean NOT NULL,
	"renewed" boolean NOT NULL,
	"answer_ms" integer NOT NULL,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hl_steps_run_id_step_pk" PRIMARY KEY("run_id","step")
);
--> statement-breakpoint
ALTER TABLE "hl_runs" ADD COLUMN "practice" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "hl_runs" ADD COLUMN "pair_renewed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "hl_steps" ADD CONSTRAINT "hl_steps_run_id_hl_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."hl_runs"("id") ON DELETE cascade ON UPDATE no action;