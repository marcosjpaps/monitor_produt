"""Testes da camada de importações sem acessar banco de produção."""
import io
import os
import sqlite3
import sys
import tempfile
import types
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from backend import import_store as store


class PgCompatibleSQLite:
    """Somente para validar controle de duplicados e histórico."""
    def __init__(self, path):
        self.db = sqlite3.connect(path)
        self.db.row_factory = sqlite3.Row

    def execute(self, sql, params=()):
        if "CURRENT_TIMESTAMP - INTERVAL '1 day'" in sql:
            sql = sql.replace("CURRENT_TIMESTAMP - INTERVAL '1 day'",
                              "datetime('now', '-1 day')")
        return self.db.execute(sql, params)

    def commit(self):
        self.db.commit()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        if exc_type:
            self.db.rollback()
        else:
            self.db.commit()
        self.db.close()


class ImportStoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = str(Path(self.tmp.name) / "test.sqlite")
        self.connector = patch.object(store, "pg_connect",
                                      side_effect=lambda: PgCompatibleSQLite(self.path))
        self.connector.start()
        store.init_import_store()

    def tearDown(self):
        self.connector.stop()
        self.tmp.cleanup()

    def test_register_dedup_archive_restore(self):
        result = store.register_import("johndeere", "rastro.jdl", b"jdl-real", 8)
        self.assertTrue(result["new"])
        again = store.register_import("johndeere", "outro_nome.jdl", b"jdl-real", 8)
        self.assertFalse(again["new"])
        self.assertEqual(result["id"], again["id"])
        self.assertEqual(store.list_imports("johndeere", False, 30, 0)["total"], 1)
        self.assertTrue(store.change_archive(result["id"], True)["archived"])
        self.assertEqual(store.list_imports("johndeere", False, 30, 0)["total"], 0)
        self.assertEqual(store.list_imports("johndeere", True, 30, 0)["total"], 1)
        store.change_archive(result["id"], False)
        self.assertEqual(store.list_imports("johndeere", False, 30, 0)["total"], 1)

    def test_chunk_roundtrip_and_incomplete(self):
        part1 = b"uma parte"
        part2 = b"outra parte"
        uid = "11111111-1111-4111-8111-111111111111"
        store.store_chunk(uid, 0, 2, "massey", "operacao.kml", part1)
        with self.assertRaisesRegex(ValueError, "incompleto"):
            store.finish_chunks(uid, "massey", "operacao.kml")
        store.store_chunk(uid, 1, 2, "massey", "operacao.kml", part2)
        self.assertEqual(store.finish_chunks(uid, "massey", "operacao.kml"), part1 + part2)
        store.clear_chunks(uid)
        with self.assertRaisesRegex(ValueError, "não encontrado"):
            store.finish_chunks(uid, "massey", "operacao.kml")

    def test_safe_zip_hydration_and_archive(self):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as z:
            z.writestr("Fazenda 1/Talhao 2/EventHistory.dbf", b"exemplo")
        raw = buffer.getvalue()
        row = store.register_import("jacto", "Pacote.zip", raw, 1, store_binary=True)
        aggps_root = str(Path(self.tmp.name) / "aggps")
        fake_aggps = types.ModuleType("backend.aggps_parser")
        fake_aggps.get_active_aggps_path = lambda: aggps_root
        fake_aggps._find_aggps_dir = lambda root: str(Path(root) / "Data")
        with patch.dict(os.environ, {"VERCEL": "1"}), patch.dict(
            sys.modules, {"backend.aggps_parser": fake_aggps}
        ):
            result = store.hydrate_jacto_imports()
            self.assertEqual(result["hydrated"], 1)
            self.assertEqual(len(list(Path(aggps_root).rglob("EventHistory.dbf"))), 1)
            self.assertEqual(store.hydrate_jacto_imports()['hydrated'], 0)
            # A different request/instance registers a new package after startup.
            newer = io.BytesIO()
            with zipfile.ZipFile(newer, 'w') as archive:
                archive.writestr('Fazenda 3/Talhao 4/EventHistory.dbf', b'novo')
            store.register_import('jacto', 'Novo.zip', newer.getvalue(), 1, store_binary=True)
            self.assertEqual(store.hydrate_jacto_imports()['hydrated'], 2)
            self.assertEqual(len(list(Path(aggps_root).rglob('EventHistory.dbf'))), 2)
            store.change_archive(row["id"], True)
            store.hydrate_jacto_imports()
            self.assertEqual(len(list(Path(aggps_root).rglob("EventHistory.dbf"))), 1)


if __name__ == "__main__":
    unittest.main()
