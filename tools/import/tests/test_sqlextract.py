import gzip
import io

import pytest

from palacards_import.sqlextract import category_members, category_target_ids, disambiguation_ids

PAGE_PROPS = rb"""/*M!999999\- enable the sandbox mode */
CREATE TABLE `page_props` (
  `pp_page` int(10) unsigned NOT NULL,
  `pp_propname` varbinary(60) NOT NULL DEFAULT '',
  `pp_value` blob NOT NULL,
  `pp_sortkey` float DEFAULT NULL,
  PRIMARY KEY (`pp_page`,`pp_propname`)
) ENGINE=InnoDB;
INSERT INTO `page_props` VALUES (3,'defaultsort','Meillet, Antoine',NULL),(5,'disambiguation','',NULL),(6,'title','L\'a,(9,\'disambiguation\',',NULL);
INSERT INTO `page_props` VALUES (40,'disambiguation','',NULL);
"""

LINKTARGET = """CREATE TABLE `linktarget` (
  `lt_id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `lt_namespace` int(11) NOT NULL,
  `lt_title` varbinary(255) NOT NULL,
  PRIMARY KEY (`lt_id`)
);
INSERT INTO `linktarget` VALUES (1,0,'!'),(7,14,'Article_de_qualité'),(8,14,'Article_de_qualité_en_anglais'),(9,14,'Bon_article'),(10,0,'Bon_article');
""".encode()

CATEGORYLINKS = rb"""CREATE TABLE `categorylinks` (
  `cl_from` int(8) unsigned NOT NULL DEFAULT 0,
  `cl_sortkey` varbinary(230) NOT NULL DEFAULT '',
  `cl_timestamp` timestamp NOT NULL,
  `cl_sortkey_prefix` varbinary(255) NOT NULL DEFAULT '',
  `cl_type` enum('page','subcat','file') NOT NULL DEFAULT 'page',
  `cl_collation_id` smallint(5) unsigned NOT NULL DEFAULT 0,
  `cl_target_id` bigint(20) unsigned NOT NULL,
  PRIMARY KEY (`cl_from`,`cl_target_id`)
);
INSERT INTO `categorylinks` VALUES (3,'\xff\n\'),(\x1a','2025-11-15 15:34:27','Meillet','page',1,7),(3,'x','2025-11-15 15:34:27','','page',1,8),(4,'y','2025-11-15 15:34:27','','subcat',1,9);
INSERT INTO `categorylinks` VALUES (50,'z','2025-11-15 15:34:27','','page',1,9);
"""


def gz(data: bytes) -> io.BytesIO:
    return io.BytesIO(gzip.compress(data))


def test_disambiguation_ids():
    assert disambiguation_ids(gz(PAGE_PROPS)) == {5, 40}
    assert disambiguation_ids(gz(PAGE_PROPS), max_page=10) == {5}


def test_category_target_ids_exact_titles():
    assert category_target_ids(gz(LINKTARGET), ["Article_de_qualité", "Bon_article"]) == {
        7: "Article_de_qualité",
        9: "Bon_article",
    }


def test_category_members_binary_sortkeys():
    assert category_members(gz(CATEGORYLINKS), [7, 9]) == {7: {3}, 9: {50}}
    assert category_members(gz(CATEGORYLINKS), [7, 9], max_page=10) == {7: {3}, 9: set()}


def test_rejects_old_schema():
    old = CATEGORYLINKS.replace(b"`cl_sortkey` varbinary", b"`cl_to` varbinary")
    with pytest.raises(SystemExit):
        category_members(gz(old), [7])


def test_category_target_ids_stops_once_all_titles_found():
    # Suite du dump volumineuse puis tronquée : la lire jusqu'au bout lèverait EOFError.
    rows = ",".join(f"({i},0,'Titre_{i * 7919 % 100_003}')" for i in range(11, 200_000))
    data = LINKTARGET + f"INSERT INTO `linktarget` VALUES {rows};\n".encode()
    compressed = gzip.compress(data)
    truncated = io.BytesIO(compressed[: len(compressed) * 3 // 5])
    with pytest.raises(EOFError):
        category_target_ids(io.BytesIO(compressed[: len(compressed) * 3 // 5]), ["Absent"])
    assert category_target_ids(truncated, ["Article_de_qualité", "Bon_article"]) == {
        7: "Article_de_qualité",
        9: "Bon_article",
    }
