CREATE TABLE "suggestion_automation" (
	"suggestion_id" bigint PRIMARY KEY NOT NULL,
	"triage_status" text DEFAULT 'pending' NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"error" text,
	"verdict" text,
	"category" text,
	"summary" text,
	"reasoning" text,
	"spec" text,
	"questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"proposed_reply" text,
	"duplicate_of" bigint,
	"injection" boolean DEFAULT false NOT NULL,
	"triaged_at" timestamp with time zone,
	"build_status" text DEFAULT 'none' NOT NULL,
	"issue_number" integer,
	"pr_number" integer,
	"branch" text,
	"ci_conclusion" text,
	"player_reply" text,
	"announcement" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "suggestion_automation" ADD CONSTRAINT "suggestion_automation_suggestion_id_suggestions_id_fk" FOREIGN KEY ("suggestion_id") REFERENCES "public"."suggestions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "suggestion_automation_triage_idx" ON "suggestion_automation" USING btree ("triage_status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "suggestion_automation_build_idx" ON "suggestion_automation" USING btree ("build_status","published_at");