# -*- coding: utf-8 -*-
"""
Фоновая задача обработки job: парсит Kaspi, генерит PDF, ставит в очередь на печать.
Выполняется Celery-воркером — не зависит от веб-процесса.
"""
import json
import logging
import os
import traceback

from sqlalchemy.orm import Session

from . import kaspi, pdf_service, models
from .celery_app import celery
from .config import settings
from .db import SessionLocal

logger = logging.getLogger(__name__)


def _update_status(db: Session, job: models.Job, status: str, error: str = None):
    job.status = status
    if error:
        job.error = error
    db.commit()


def _update_progress(db: Session, job: models.Job, progress: int, label: str = ""):
    job.progress = progress
    job.progress_label = label
    db.commit()


@celery.task(name="tasks.process_job", bind=True, max_retries=0)
def process_job(self, job_id: int):
    db = SessionLocal()
    try:
        job = db.get(models.Job, job_id)
        if not job:
            logger.error(f"Job {job_id} not found")
            return

        _update_status(db, job, "parsing")
        _update_progress(db, job, 5, "Получаем заказы от Kaspi...")

        # 1) Парсим Kaspi
        result = kaspi.fetch_ready_orders(job.city, job.days_back)
        orders = result["orders"]
        stats = result["stats"]

        job.orders_found = stats["found"]
        job.orders_filtered_pickup = stats["filtered_pickup"]
        job.orders_filtered_status = stats["filtered_status"]
        job.orders_filtered_transmitted = stats["filtered_transmitted"]
        db.commit()

        if not orders:
            _update_progress(db, job, 100, "")
            _update_status(db, job, "done", "Нет заказов, готовых к передаче.")
            return

        # Исключаем заказы из уже подтверждённых (напечатанных) сборок того же города
        printed_jobs = (
            db.query(models.Job)
            .filter(
                models.Job.city == job.city,
                models.Job.printed_at.isnot(None),
                models.Job.id != job.id,
            )
            .all()
        )
        if printed_jobs:
            printed_ids = {pj.id for pj in printed_jobs}
            already_printed = {
                o.order_code
                for o in db.query(models.Order).filter(models.Order.job_id.in_(printed_ids)).all()
            }
            before = len(orders)
            orders = [o for o in orders if o["code"] not in already_printed]
            skipped = before - len(orders)
            if skipped:
                job.orders_filtered_transmitted = (job.orders_filtered_transmitted or 0) + skipped
                db.commit()
                logger.info(f"Job {job.id}: исключено {skipped} уже напечатанных заказов")

        if not orders:
            _update_progress(db, job, 100, "")
            _update_status(db, job, "done", "Все заказы уже были напечатаны ранее.")
            return

        _update_progress(db, job, 15, f"Найдено {len(orders)} заказов, сортируем...")

        # 2) Сортировка + группировка
        freq_map = pdf_service.build_frequency_map(orders)
        sorted_orders = pdf_service.classify_and_sort(orders, freq_map)

        for o in sorted_orders:
            db.add(models.Order(
                job_id=job.id,
                order_code=o["code"],
                waybill_number=(o["attrs"].get("kaspiDelivery") or {}).get("waybillNumber"),
                num_positions=o["num_positions"],
                total_qty=o["total_qty"],
                group_letter=o["group_letter"],
                max_freq=o["max_freq"],
                primary_sku=o.get("primary_sku", ""),
                entries_json=json.dumps(o.get("entries", []), ensure_ascii=False),
            ))

        job.group_a_count = sum(1 for o in sorted_orders if o["group_letter"] == "A")
        job.group_b_count = sum(1 for o in sorted_orders if o["group_letter"] == "B")
        job.group_c_count = sum(1 for o in sorted_orders if o["group_letter"] == "C")
        db.commit()

        # 3) Скачиваем накладные
        orders_to_download = sorted_orders[:job.test_limit] if job.test_mode else sorted_orders
        total_to_download = len(orders_to_download)
        orders_pdfs = []

        for i, o in enumerate(orders_to_download):
            # Прогресс 20% → 80% по мере скачивания
            pct = 20 + int((i / total_to_download) * 60)
            _update_progress(db, job, pct, f"Скачиваем накладные {i + 1} / {total_to_download}")

            kd = o["attrs"].get("kaspiDelivery") or {}
            url = kd.get("waybill")
            if not url:
                continue
            try:
                pdf_bytes = kaspi.download_waybill_pdf(url)
                orders_pdfs.append((o["code"], pdf_bytes))
            except Exception as e:
                logger.warning(f"Order {o['code']}: waybill download failed: {e}")

        # 4) Генерим PDF
        _update_progress(db, job, 85, "Собираем PDF...")
        data_dir = os.path.join(settings.data_dir, str(job.id))
        os.makedirs(data_dir, exist_ok=True)

        total_count = len(orders_pdfs)
        print_pdfs = orders_pdfs
        print_count = len(print_pdfs)

        pdf_bytes = pdf_service.build_pdf_for_orders(
            print_pdfs,
            label_width_mm=job.label_width_mm,
            label_height_mm=job.label_height_mm,
        )
        suffix = f"_TEST_{print_count}pcs" if job.test_mode else f"_{total_count}pcs"
        filename = f"waybills{suffix}.pdf"
        path = os.path.join(data_dir, filename)
        pdf_service.save_pdf(pdf_bytes, path)

        db.add(models.PrintTask(
            job_id=job.id,
            city=job.city,
            pdf_filename=filename,
            pdf_size_bytes=len(pdf_bytes),
            waybills_count=print_count,
            roll_type="A",
            status="queued",
        ))

        job.pdf_files_json = json.dumps([filename])
        job.orders_printed = print_count
        _update_progress(db, job, 100, "")
        _update_status(db, job, "pdf_ready")
    except Exception as e:
        logger.exception(f"Job {job_id} failed")
        job = db.get(models.Job, job_id)
        if job:
            _update_status(db, job, "error", f"{type(e).__name__}: {e}\n{traceback.format_exc()[:2000]}")
    finally:
        db.close()
