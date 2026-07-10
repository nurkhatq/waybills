# -*- coding: utf-8 -*-
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

from .config import settings

engine = create_engine(
    settings.db_url,
    connect_args={"check_same_thread": False} if settings.db_url.startswith("sqlite") else {},
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    from . import models  # noqa: F401
    from sqlalchemy import text
    Base.metadata.create_all(bind=engine)
    # Добавляем новые колонки если их ещё нет (SQLite не поддерживает IF NOT EXISTS в ALTER)
    with engine.connect() as conn:
        for stmt in [
            "ALTER TABLE jobs ADD COLUMN progress INTEGER DEFAULT 0",
            "ALTER TABLE jobs ADD COLUMN progress_label TEXT DEFAULT ''",
        ]:
            try:
                conn.execute(text(stmt))
                conn.commit()
            except Exception:
                pass
