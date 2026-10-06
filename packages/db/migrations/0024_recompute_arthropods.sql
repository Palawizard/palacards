-- Détection des arthropodes corrigée (« carte à puce » n'est plus une puce) : drapeaux recalculés au prochain affichage.
UPDATE "wiki_summaries" SET "arthropod" = NULL WHERE "arthropod" IS NOT NULL;
