CREATE TABLE "cases" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cases_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"collection" text NOT NULL,
	"tier" text NOT NULL,
	"season" smallint NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cases_dates_ok" CHECK ("cases"."ends_at" > "cases"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "case_cards" (
	"case_id" bigint NOT NULL,
	"card_id" bigint NOT NULL,
	"rarity" "rarity" NOT NULL,
	"pos" smallint NOT NULL,
	CONSTRAINT "case_cards_case_id_card_id_pk" PRIMARY KEY("case_id","card_id")
);
--> statement-breakpoint
CREATE TABLE "case_openings" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "case_openings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" text NOT NULL,
	"case_id" bigint NOT NULL,
	"free" boolean NOT NULL,
	"price" integer NOT NULL,
	"rarity" "rarity" NOT NULL,
	"lot" smallint NOT NULL,
	"value" integer NOT NULL,
	"instance_ids" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_free_cases" (
	"user_id" text NOT NULL,
	"tier" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "player_free_cases_user_id_tier_pk" PRIMARY KEY("user_id","tier"),
	CONSTRAINT "player_free_cases_count_ok" CHECK ("player_free_cases"."count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "case_cards" ADD CONSTRAINT "case_cards_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_openings" ADD CONSTRAINT "case_openings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_openings" ADD CONSTRAINT "case_openings_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_free_cases" ADD CONSTRAINT "player_free_cases_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cases_ends_idx" ON "cases" USING btree ("ends_at");--> statement-breakpoint
CREATE INDEX "case_openings_user_idx" ON "case_openings" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "case_openings_value_idx" ON "case_openings" USING btree ("value","created_at");