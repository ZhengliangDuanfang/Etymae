from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
import sys


_TEMP_DIR = tempfile.TemporaryDirectory()
os.environ["ETYMAE_DATABASE_PATH"] = str(Path(_TEMP_DIR.name) / "test.db")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import Base, SessionLocal, engine
from app.schemas import EntryPayload
from app.services import create_entry, search_entries


class SearchEntriesTest(unittest.TestCase):
    def setUp(self) -> None:
        Base.metadata.drop_all(bind=engine)
        Base.metadata.create_all(bind=engine)
        self.session = SessionLocal()

    def tearDown(self) -> None:
        self.session.close()

    @classmethod
    def tearDownClass(cls) -> None:
        engine.dispose()

    def test_search_returns_all_matches_without_hard_limit(self) -> None:
        for index in range(15):
            create_entry(
                self.session,
                EntryPayload(
                    spelling=f"target-{index:02d}",
                    language="Test",
                    meaning="shared keyword for search",
                    aliases_raw="",
                    upstream_raw="",
                ),
            )

        results = search_entries(self.session, "shared keyword")

        self.assertEqual(len(results), 15)
        self.assertEqual(results[0].spelling, "target-00")
        self.assertEqual(results[-1].spelling, "target-14")


if __name__ == "__main__":
    unittest.main()
