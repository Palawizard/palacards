CREATE TABLE "suggestion_messages" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "suggestion_messages_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"suggestion_id" bigint NOT NULL,
	"from_admin" boolean NOT NULL,
	"body" text NOT NULL,
	"admin_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "suggestion_messages" ADD CONSTRAINT "suggestion_messages_suggestion_id_suggestions_id_fk" FOREIGN KEY ("suggestion_id") REFERENCES "public"."suggestions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "suggestion_messages_suggestion_idx" ON "suggestion_messages" USING btree ("suggestion_id","created_at");