-- Boss à phases : l'ancien état d'un boss devient sa phase 1. Un boss déjà tombé passe en phase 2 (PV pleins) ;
-- ses joueurs payés à la chute (100 PW et 2 paquets) ont `boss_rewards.phases` = 2 : rien n'est repayé à minuit.
UPDATE "boss_days" SET
  "damage" = CASE WHEN "killed_at" IS NOT NULL THEN "max_hp" ELSE "max_hp" - "hp" END,
  "phase" = CASE WHEN "killed_at" IS NOT NULL THEN 2 ELSE 1 END,
  "hp" = CASE WHEN "killed_at" IS NOT NULL THEN (round("max_hp" * 1.4 / 50) * 50)::int ELSE "hp" END
WHERE "version" = 1;
--> statement-breakpoint
INSERT INTO "boss_phases" ("day", "phase", "max_hp", "fallen_at", "fallen_by")
SELECT "day", 1, "max_hp", "killed_at", "killed_by" FROM "boss_days" WHERE "killed_at" IS NOT NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Questions déjà posées à chaque joueur (définitions et images surtout) : elles ne reviennent qu'en dernier.
INSERT INTO "boss_question_history" ("user_id", "card_id", "type", "key", "asked_at")
SELECT a."user_id", h."card_id", h."question"->>'type', h."question"->>'type', max(h."served_at")
FROM "boss_hits" h JOIN "boss_assaults" a ON a."id" = h."assault_id"
WHERE h."served_at" IS NOT NULL AND h."question"->>'type' IS NOT NULL
GROUP BY a."user_id", h."card_id", h."question"->>'type'
ON CONFLICT DO NOTHING;
