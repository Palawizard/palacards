CREATE TABLE "portfolio_members" (
	"portfolio_id" bigint NOT NULL,
	"user_id" text NOT NULL,
	"invited_at" timestamp with time zone DEFAULT now() NOT NULL,
	"joined_at" timestamp with time zone,
	CONSTRAINT "portfolio_members_portfolio_id_user_id_pk" PRIMARY KEY("portfolio_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "portfolios" ADD COLUMN "visibility" text DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE "portfolio_members" ADD CONSTRAINT "portfolio_members_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_members" ADD CONSTRAINT "portfolio_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "portfolio_members_user_idx" ON "portfolio_members" USING btree ("user_id");