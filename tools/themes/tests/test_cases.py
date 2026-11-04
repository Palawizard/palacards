from datetime import UTC, datetime

from palacards_themes.cases import CASE_CONTENT, next_monday_evening, script


def test_monday_evening_paris():
    # Mercredi 4 novembre 2026, heure d'hiver : lundi 9 à 23 h 59 à Paris = 22 h 59 UTC.
    assert next_monday_evening(datetime(2026, 11, 4, 12, tzinfo=UTC)) == datetime(2026, 11, 9, 22, 59, tzinfo=UTC)
    # Lundi après 23 h 59 : la semaine suivante.
    assert next_monday_evening(datetime(2026, 11, 9, 23, 30, tzinfo=UTC)) == datetime(2026, 11, 16, 22, 59, tzinfo=UTC)


def test_script_four_tiers_and_counts():
    sql = script("Jeux vidéo", "", 1, datetime(2026, 11, 4, tzinfo=UTC), datetime(2026, 11, 9, tzinfo=UTC), "palawi",
                 False, copy_ids=[3, 1, 2])
    assert sql.count("INSERT INTO cases") == 4
    assert "COPY _ids FROM STDIN;\n1\n2\n3\n\\." in sql
    assert "(c.rarity = 'L' AND c.n <= 15)" in sql
    assert sql.strip().endswith("ROLLBACK;")
    assert sum(CASE_CONTENT["bronze"].values()) == 30
