-- Recherche floue sans accents (catalogue « Toutes les cartes ») et chargement contrôlé des cartes.
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS unaccent;--> statement-breakpoint

-- unaccent() n'est pas IMMUTABLE (dictionnaire modifiable) : enveloppe figée pour pouvoir l'indexer.
CREATE OR REPLACE FUNCTION f_unaccent(text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS cards_title_trgm_idx ON cards USING gin (lower(f_unaccent(title)) gin_trgm_ops);--> statement-breakpoint

-- Le COPY de l'import n'a pas besoin du WAL : la table est rechargée à chaque saison.
ALTER TABLE cards_next SET UNLOGGED;--> statement-breakpoint

-- Contrôle le contenu de cards_next puis l'insère dans cards pour la saison p_season, en une transaction.
-- Paliers : mêmes plafonds de rang que packages/game/src/rarity.ts (RARITY_RANK_CEILING) et
-- tools/import/build_cards.py ; un échantillon (< 2 M cartes) est mis à l'échelle sur 2,7 M.
-- La saison chargée reste invisible tant qu'elle n'est pas activée par le jeu.
CREATE OR REPLACE FUNCTION finish_card_load(p_season smallint)
RETURNS TABLE (rarity rarity, cards bigint)
LANGUAGE plpgsql
AS $$
#variable_conflict use_column
DECLARE
  total bigint;
  tier rarity;
  ceilings int[] := ARRAY[1000, 10000, 50000, 250000, 1000000];
  tiers rarity[] := ARRAY['L', 'UR', 'SR', 'R', 'PC']::rarity[];
  expected bigint;
  cumulated bigint;
  bad bigint;
BEGIN
  SELECT count(*) INTO total FROM cards_next;
  IF total = 0 THEN
    RAISE EXCEPTION 'cards_next est vide : rien à charger';
  END IF;
  IF EXISTS (SELECT 1 FROM cards c WHERE c.season = p_season) THEN
    RAISE EXCEPTION 'la saison % a déjà des cartes', p_season;
  END IF;
  IF (SELECT count(DISTINCT id) FROM cards_next) <> total THEN
    RAISE EXCEPTION 'identifiants en double dans cards_next';
  END IF;
  SELECT count(*) INTO bad FROM cards_next n
  WHERE n.atk NOT BETWEEN 100 AND 9999 OR n.def NOT BETWEEN 100 AND 9999
     OR n.views_12m < 0 OR n.page_len < 0 OR btrim(n.title) = '';
  IF bad > 0 THEN
    RAISE EXCEPTION '% cartes ont des valeurs hors bornes', bad;
  END IF;

  -- Effectifs : le nombre cumulé de cartes jusqu'à chaque palier doit égaler son plafond de rang.
  FOR i IN 1..array_length(tiers, 1) LOOP
    tier := tiers[i];
    expected := CASE WHEN total >= 2000000 THEN ceilings[i]
                     ELSE greatest(1, floor(ceilings[i] * total / 2700000.0 + 0.5)) END;
    expected := least(expected, total);
    SELECT count(*) INTO cumulated FROM cards_next n WHERE n.rarity = ANY (tiers[1:i]);
    IF cumulated <> expected THEN
      RAISE EXCEPTION 'effectif incohérent : % cartes de rareté % ou mieux, % attendues', cumulated, tier, expected;
    END IF;
  END LOOP;

  -- Les raretés suivent les vues : un palier ne peut pas avoir plus de vues que le palier au-dessus.
  SELECT count(*) INTO bad FROM (
    SELECT n.rarity, min(n.views_12m) AS lo, max(n.views_12m) AS hi FROM cards_next n GROUP BY n.rarity
  ) a JOIN (
    SELECT n.rarity, min(n.views_12m) AS lo FROM cards_next n GROUP BY n.rarity
  ) b ON b.rarity > a.rarity AND b.lo < a.hi;
  IF bad > 0 THEN
    RAISE EXCEPTION 'raretés incohérentes avec les vues';
  END IF;

  INSERT INTO cards (id, season, title, rarity, atk, def, views_12m, page_len)
  SELECT n.id, p_season, n.title, n.rarity, n.atk, n.def, n.views_12m, n.page_len FROM cards_next n;
  TRUNCATE cards_next;

  RETURN QUERY SELECT c.rarity, count(*) FROM cards c WHERE c.season = p_season GROUP BY c.rarity ORDER BY c.rarity;
END;
$$;
