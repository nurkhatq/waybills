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
            "ALTER TABLE jobs ADD COLUMN printed_at TIMESTAMP",
            "ALTER TABLE jobs ADD COLUMN orders_printed INTEGER",
            "ALTER TABLE orders ADD COLUMN primary_sku TEXT",
            "ALTER TABLE orders ADD COLUMN entries_json TEXT",
            "ALTER TABLE orders ADD COLUMN is_single INTEGER DEFAULT 0",
            "ALTER TABLE orders ADD COLUMN waybill_url TEXT",
            "ALTER TABLE jobs ADD COLUMN smart_mode INTEGER DEFAULT 0",
            "ALTER TABLE jobs ADD COLUMN single_stats_json TEXT",
            "ALTER TABLE jobs ADD COLUMN selected_batches_json TEXT",
            "ALTER TABLE jobs ADD COLUMN printed_files_json TEXT",
            "ALTER TABLE jobs ADD COLUMN cancel_tasks_json TEXT",
        ]:
            try:
                conn.execute(text(stmt))
                conn.commit()
            except Exception:
                pass
