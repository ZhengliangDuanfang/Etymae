from __future__ import annotations

from sqlalchemy.orm import Session

from .database import Base, engine
from .models import Entry
from .schemas import EntryPayload
from .services import create_entry, rebuild_all_links


TEST_ENTRIES: list[EntryPayload] = [
    EntryPayload(
        spelling="proto",
        language="PIE",
        meaning="root ancestor",
        aliases_raw="",
        upstream_raw="",
    ),
    EntryPayload(
        spelling="mater",
        language="Latin",
        meaning="mother in Latin",
        aliases_raw="materia",
        upstream_raw="proto [PIE]",
    ),
    EntryPayload(
        spelling="mere",
        language="French",
        meaning="mother in French",
        aliases_raw="",
        upstream_raw="mater [Latin]",
    ),
    EntryPayload(
        spelling="mother",
        language="English",
        meaning="the female parent",
        aliases_raw="mom,mum",
        upstream_raw="mere [French]",
    ),
    EntryPayload(
        spelling="orphan",
        language="English",
        meaning="entry with an unresolved upstream",
        aliases_raw="",
        upstream_raw="missing-root [PIE]",
    ),
]


def reset_test_database(session: Session) -> None:
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)

    for payload in TEST_ENTRIES:
        create_entry(session, payload)

    rebuild_all_links(session)
    session.commit()


def list_seed_entries(session: Session) -> list[Entry]:
    return session.query(Entry).order_by(Entry.id.asc()).all()
