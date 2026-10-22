CREATE TABLE "shop_offers" (
	"user_id" text NOT NULL,
	"day" date NOT NULL,
	"slot" smallint NOT NULL,
	"card_id" bigint NOT NULL,
	"season" smallint NOT NULL,
	"rarity" "rarity" NOT NULL,
	"price" integer NOT NULL,
	"purchased_at" timestamp with time zone,
	"instance_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shop_offers_user_id_day_slot_pk" PRIMARY KEY("user_id","day","slot"),
	CONSTRAINT "shop_offers_price_ok" CHECK ("shop_offers"."price" > 0)
);
--> statement-breakpoint
ALTER TABLE "shop_offers" ADD CONSTRAINT "shop_offers_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "shop_offers_card_uq" ON "shop_offers" USING btree ("user_id","day","card_id");