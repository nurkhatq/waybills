# -*- coding: utf-8 -*-
import datetime
from sqlalchemy import Column, Integer, String, DateTime, Boolean, ForeignKey, Text, Float
from sqlalchemy.orm import relationship

from .db import Base


def now():
    return datetime.datetime.utcnow()


class Job(Base):
    """Один клик пользователя = один Job. Парсит Kaspi, генерит PDF, ставит в очередь на печать."""
    __tablename__ = "jobs"

    id = Column(Integer, primary_key=True)
    city = Column(String, nullable=False, index=True)
    status = Column(String, default="pending", index=True)
    # pending → parsing → pdf_ready → printing → done | error
    error = Column(Text, nullable=True)

    # Параметры запуска
    days_back = Column(Integer, default=7)
    test_mode = Column(Boolean, default=False)
    test_limit = Column(Integer, default=5)
    roll_a_size = Column(Integer, default=250)
    roll_b_size = Column(Integer, default=100)
    roll_b_threshold = Column(Integer, default=100)
    label_width_mm = Column(Float, default=75.0)
    label_height_mm = Column(Float, default=120.0)

    # Результаты парсинга
    orders_found = Column(Integer, default=0)
    orders_filtered_pickup = Column(Integer, default=0)
    orders_filtered_status = Column(Integer, default=0)
    orders_filtered_transmitted = Column(Integer, default=0)
    group_a_count = Column(Integer, default=0)
    group_b_count = Column(Integer, default=0)
    group_c_count = Column(Integer, default=0)

    # PDF файлы (JSON-массив имён файлов в data/<job_id>/)
    pdf_files_json = Column(Text, nullable=True)

    # Прогресс обработки
    progress = Column(Integer, default=0)
    progress_label = Column(Text, nullable=True)

    # Пользователь подтвердил что накладные напечатаны
    printed_at = Column(DateTime, nullable=True)

    # Сколько накладных реально ушло в PDF (после дедупликации)
    orders_printed = Column(Integer, nullable=True)

    created_at = Column(DateTime, default=now, index=True)
    updated_at = Column(DateTime, default=now, onupdate=now)

    orders = relationship("Order", back_populates="job", cascade="all, delete-orphan")
    print_tasks = relationship("PrintTask", back_populates="job", cascade="all, delete-orphan")


class Order(Base):
    """Один заказ в рамках job. Позволяет отслеживать статус печати и не дублировать."""
    __tablename__ = "orders"

    id = Column(Integer, primary_key=True)
    job_id = Column(Integer, ForeignKey("jobs.id"), nullable=False, index=True)
    order_code = Column(String, nullable=False, index=True)
    waybill_number = Column(String, nullable=True)
    num_positions = Column(Integer, default=1)
    total_qty = Column(Integer, default=1)
    group_letter = Column(String, nullable=True)  # A / B / C
    max_freq = Column(Integer, default=0)
    print_status = Column(String, default="pending")  # pending | printed | skipped | failed

    job = relationship("Job", back_populates="orders")


class PrintTask(Base):
    """Задача агенту-на-складе: скачай PDF-N, напечатай, отчитайся."""
    __tablename__ = "print_tasks"

    id = Column(Integer, primary_key=True)
    job_id = Column(Integer, ForeignKey("jobs.id"), nullable=False, index=True)
    city = Column(String, nullable=False, index=True)
    pdf_filename = Column(String, nullable=False)
    pdf_size_bytes = Column(Integer, default=0)
    waybills_count = Column(Integer, default=0)
    roll_type = Column(String, default="A")  # A / B (какой рулон)
    status = Column(String, default="queued", index=True)  # queued | claimed | done | error
    error = Column(Text, nullable=True)

    claimed_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=now)

    job = relationship("Job", back_populates="print_tasks")
