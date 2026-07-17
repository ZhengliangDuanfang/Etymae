from __future__ import annotations

import os

from fastapi import Depends, FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from .database import Base, SessionLocal, engine, get_session
from .models import Entry
from .schemas import CsvImportPayload, CsvImportResponse, DeleteResponse, EntryDetail, EntryPayload, SearchResponse
from .services import (
    break_links_to_entry,
    create_entry,
    EntryConflictError,
    EntryImportError,
    import_entries_csv,
    rebuild_all_links,
    search_entries,
    serialize_entry,
    serialize_entries_csv,
    update_entry,
)
from .test_support import reset_test_database


Base.metadata.create_all(bind=engine)

with SessionLocal() as startup_session:
    rebuild_all_links(startup_session)
    startup_session.commit()

app = FastAPI(title="Etymae API")
TEST_MODE = os.environ.get("ETYMAE_TEST_MODE") == "1"

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:22026", "http://127.0.0.1:22026"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def healthcheck() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/entries/search", response_model=SearchResponse)
def search(q: str = Query(default=""), session: Session = Depends(get_session)) -> SearchResponse:
    return SearchResponse(items=search_entries(session, q))


@app.get("/api/entries/export.csv")
def export_entries(session: Session = Depends(get_session)) -> Response:
    csv_content = serialize_entries_csv(session)
    return Response(
        content=csv_content,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="etymae-entries.csv"'},
    )


@app.post("/api/entries/import.csv", response_model=CsvImportResponse)
def import_entries(payload: CsvImportPayload, session: Session = Depends(get_session)) -> CsvImportResponse:
    try:
        imported_count = import_entries_csv(session, payload.csv_text)
    except EntryImportError as exc:
        session.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except EntryConflictError as exc:
        session.rollback()
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    return CsvImportResponse(ok=True, imported_count=imported_count)


@app.get("/api/entries/{entry_id}", response_model=EntryDetail)
def get_entry(entry_id: int, session: Session = Depends(get_session)) -> EntryDetail:
    entry = serialize_entry(session, entry_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Entry not found")
    return entry


@app.post("/api/entries", response_model=EntryDetail)
def create(payload: EntryPayload, session: Session = Depends(get_session)) -> EntryDetail:
    try:
        entry = create_entry(session, payload)
    except EntryConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    serialized = serialize_entry(session, entry.id)
    if serialized is None:
        raise HTTPException(status_code=500, detail="Failed to load created entry")
    return serialized


@app.put("/api/entries/{entry_id}", response_model=EntryDetail)
def update(entry_id: int, payload: EntryPayload, session: Session = Depends(get_session)) -> EntryDetail:
    entry = session.get(Entry, entry_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Entry not found")

    try:
        updated = update_entry(session, entry, payload)
    except EntryConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    serialized = serialize_entry(session, updated.id)
    if serialized is None:
        raise HTTPException(status_code=500, detail="Failed to load updated entry")
    return serialized


@app.delete("/api/entries/{entry_id}", response_model=DeleteResponse)
def delete(entry_id: int, session: Session = Depends(get_session)) -> DeleteResponse:
    entry = session.get(Entry, entry_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Entry not found")

    break_links_to_entry(session, entry)
    session.delete(entry)
    session.commit()
    return DeleteResponse(ok=True)


@app.post("/api/test/reset")
def reset_test_data(session: Session = Depends(get_session)) -> dict[str, bool]:
    if not TEST_MODE:
        raise HTTPException(status_code=404, detail="Not found")

    reset_test_database(session)
    return {"ok": True}
