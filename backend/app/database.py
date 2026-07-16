from __future__ import annotations

import os
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker


DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
DATABASE_PATH = Path(os.environ.get("ETYMAE_DATABASE_PATH", DATA_DIR / "etymae.db"))
DATABASE_URL = f"sqlite:///{DATABASE_PATH.as_posix()}"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


def get_session():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
