CREATE TABLE "pack_stats" (
	"user_id" text NOT NULL,
	"season" smallint NOT NULL,
	"packs" integer DEFAULT 0 NOT NULL,
	"luck_packs" integer DEFAULT 0 NOT NULL,
	"pulled_points" bigint DEFAULT 0 NOT NULL,
	"expected_points" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "pack_stats_user_id_season_pk" PRIMARY KEY("user_id","season")
);
--> statement-breakpoint
ALTER TABLE "pack_stats" ADD CONSTRAINT "pack_stats_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Rattrapage : paquets déjà ouverts (une ligne de ledger « card / pack_open » par paquet), rangés dans la saison
-- en cours à leur ouverture.
INSERT INTO "pack_stats" ("user_id", "season", "packs")
SELECT l."user_id", s."id", count(*)::int
FROM "ledger" l
CROSS JOIN LATERAL (
	SELECT coalesce(
		(SELECT "id" FROM "seasons" WHERE "started_at" <= l."created_at" ORDER BY "started_at" DESC LIMIT 1),
		(SELECT min("id") FROM "seasons" WHERE "started_at" IS NOT NULL)
	) AS "id"
) s
WHERE l."kind" = 'card' AND l."reason" = 'pack_open' AND s."id" IS NOT NULL
GROUP BY l."user_id", s."id";
--> statement-breakpoint
-- Chance des paquets encore au journal des tirages (10 cartes par paquet). Espérance sans pity, en dix-millièmes
-- de point : 396 550 par paquet standard, 885 000 par booster à thème (packages/game, expectedPackPoints).
INSERT INTO "pack_stats" ("user_id", "season", "luck_packs", "pulled_points", "expected_points")
SELECT "user_id", "season", sum("packs")::int, sum("pulled"), sum("expected")
FROM (
	SELECT "user_id", "season", count(*) / 10 AS "packs",
		sum(CASE "rarity" WHEN 'C' THEN 1 WHEN 'PC' THEN 2 WHEN 'R' THEN 5 WHEN 'SR' THEN 20 WHEN 'UR' THEN 100 WHEN 'L' THEN 1000 ELSE 0 END) * 10000 AS "pulled",
		(count(*) / 10) * (CASE "source" WHEN 'theme' THEN 885000 ELSE 396550 END) AS "expected"
	FROM "pulls"
	WHERE "source" IN ('pack', 'theme')
	GROUP BY "user_id", "season", "source"
) p
WHERE "packs" > 0
GROUP BY "user_id", "season"
ON CONFLICT ("user_id", "season") DO UPDATE SET
	"luck_packs" = excluded."luck_packs",
	"pulled_points" = excluded."pulled_points",
	"expected_points" = excluded."expected_points";
