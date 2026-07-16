from __future__ import annotations

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from .database import Base, SessionLocal, engine, get_session
from .models import Entry
from .schemas import DeleteResponse, EntryDetail, EntryPayload, SearchResponse
from .services import (
    break_links_to_entry,
    create_entry,
    EntryConflictError,
    rebuild_all_links,
    search_entries,
    serialize_entry,
    update_entry,
)


Base.metadata.create_all(bind=engine)

with SessionLocal() as startup_session:
    rebuild_all_links(startup_session)
    startup_session.commit()

app = FastAPI(title="Etymae API")

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
