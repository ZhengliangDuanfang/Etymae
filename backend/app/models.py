from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


class Entry(Base):
    __tablename__ = "entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    spelling: Mapped[str] = mapped_column(String(255), index=True)
    language: Mapped[str] = mapped_column(String(255), default="")
    meaning: Mapped[str] = mapped_column(Text, default="")
    aliases_raw: Mapped[str] = mapped_column(Text, default="")
    upstream_raw: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    outgoing_links: Mapped[list["EntryLink"]] = relationship(
        back_populates="source_entry",
        cascade="all, delete-orphan",
        foreign_keys="EntryLink.source_entry_id",
    )
    incoming_links: Mapped[list["EntryLink"]] = relationship(
        back_populates="target_entry",
        foreign_keys="EntryLink.target_entry_id",
    )


class EntryLink(Base):
    __tablename__ = "entry_links"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    source_entry_id: Mapped[int] = mapped_column(ForeignKey("entries.id", ondelete="CASCADE"))
    target_entry_id: Mapped[int | None] = mapped_column(
        ForeignKey("entries.id", ondelete="SET NULL"), nullable=True, index=True
    )
    raw_label: Mapped[str] = mapped_column(String(255), index=True)
    resolved: Mapped[int] = mapped_column(Integer, default=0)

    source_entry: Mapped[Entry] = relationship(
        back_populates="outgoing_links", foreign_keys=[source_entry_id]
    )
    target_entry: Mapped[Entry | None] = relationship(
        back_populates="incoming_links", foreign_keys=[target_entry_id]
    )
