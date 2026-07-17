from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class EntryPayload(BaseModel):
    spelling: str = Field(min_length=1, max_length=255)
    language: str = Field(default="", max_length=255)
    meaning: str = Field(default="")
    aliases_raw: str = Field(default="")
    upstream_raw: str = Field(default="")


class CsvImportPayload(BaseModel):
    csv_text: str = Field(default="")


class SearchResult(BaseModel):
    id: int
    spelling: str
    language: str
    aliases: list[str]
    meaning_preview: str


class EntryRef(BaseModel):
    id: int
    spelling: str
    language: str


class UnresolvedLink(BaseModel):
    label: str


class EntryDetail(BaseModel):
    id: int
    spelling: str
    language: str
    meaning: str
    aliases_raw: str
    aliases: list[str]
    upstream_raw: str
    upstream_resolved: list[EntryRef]
    upstream_unresolved: list[UnresolvedLink]
    downstream: list[EntryRef]
    created_at: datetime
    updated_at: datetime


class SearchResponse(BaseModel):
    items: list[SearchResult]


class DeleteResponse(BaseModel):
    ok: bool


class CsvImportResponse(BaseModel):
    ok: bool
    imported_count: int
