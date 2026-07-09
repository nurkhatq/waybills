# -*- coding: utf-8 -*-
"""
Фоновая задача обработки job: парсит Kaspi, генерит PDF, ставит в очередь на печать.
"""
import json
import logging
import os
import traceback

from sqlalchemy.orm import Session

from . import kaspi, pdf_service, models
from .config import settings
from .db import SessionLocal

logger = logging.getLogger(__name__)


def _update_status(db: Session, job: models.Job, status: str, error: str = None):
    job.status = status
    if error:
        job.error = error
    db.commit()


def process_job(job_id: int):
    db = SessionLocal()
    try:
        job = db.get(models.Job, job_id)
        if not job:
            logger.error(f"Job {job_id} not found")
            return

        _update_status(db, job, "parsing")

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
            _update_status(db, job, "done", "Нет заказов, готовых к передаче.")
            return

        # 2) Сортировка + группировка
        freq_map = pdf_service.build_frequency_map(orders)
        sorted_orders = pdf_service.classify_and_sort(orders, freq_map)

        # Сохраняем заказы в БД
        for o in sorted_orders:
            db.add(models.Order(
                job_id=job.id,
                order_code=o["code"],
                waybill_number=(o["attrs"].get("kaspiDelivery") or {}).get("waybillNumber"),
                num_positions=o["num_positions"],
                total_qty=o["total_qty"],
                group_letter=o["group_letter"],
                max_freq=o["max_freq"],
            ))

        job.group_a_count = sum(1 for o in sorted_orders if o["group_letter"] == "A")
        job.group_b_count = sum(1 for o in sorted_orders if o["group_letter"] == "B")
        job.group_c_count = sum(1 for o in sorted_orders if o["group_letter"] == "C")
        db.commit()

        # 3) Скачиваем накладные для сорт. заказов
        # В тестовом режиме — те же самые заказы, но при печати ограничим до test_limit
        orders_pdfs = []
        for o in sorted_orders:
            kd = o["attrs"].get("kaspiDelivery") or {}
            url = kd.get("waybill")
            if not url:
                continue
            try:
                pdf_bytes = kaspi.download_waybill_pdf(url)
                orders_pdfs.append((o["code"], pdf_bytes))
            except Exception as e:
                logger.warning(f"Order {o['code']}: waybill download failed: {e}")

        # 4) Разбивка на файлы под рулоны
        chunks = pdf_service.split_for_rolls(
            len(orders_pdfs),
            roll_a=job.roll_a_size,
            roll_b=job.roll_b_size,
            threshold=job.roll_b_threshold,
        )

        # 5) Генерим PDF для каждого chunk и создаём PrintTask
        data_dir = os.path.join(settings.data_dir, str(job.id))
        os.makedirs(data_dir, exist_ok=True)

        file_names = []
        idx = 0
        chunk_start = 0
        for chunk_idx, (roll_type, count) in enumerate(chunks, 1):
            chunk_pdfs = orders_pdfs[chunk_start:chunk_start + count]
            chunk_start += count

            pdf_bytes = pdf_service.build_pdf_for_orders(
                chunk_pdfs,
                label_width_mm=job.label_width_mm,
                label_height_mm=job.label_height_mm,
            )
            filename = f"part{chunk_idx:02d}_roll{roll_type}_{count}pcs.pdf"
            path = os.path.join(data_dir, filename)
            pdf_service.save_pdf(pdf_bytes, path)
            file_names.append(filename)

            # В тестовом режиме — обрежем печатное задание до test_limit накладных на файл
            print_count = min(count, job.test_limit) if job.test_mode else count

            # Если для печати нужен урезанный PDF — соберём его отдельно
            if job.test_mode and print_count < count:
                test_pdfs = chunk_pdfs[:print_count]
                test_bytes = pdf_service.build_pdf_for_orders(
                    test_pdfs,
                    label_width_mm=job.label_width_mm,
                    label_height_mm=job.label_height_mm,
                )
                test_filename = f"part{chunk_idx:02d}_roll{roll_type}_TEST_{print_count}pcs.pdf"
                test_path = os.path.join(data_dir, test_filename)
                pdf_service.save_pdf(test_bytes, test_path)
                print_filename = test_filename
                print_size = len(test_bytes)
            else:
                print_filename = filename
                print_size = len(pdf_bytes)

            db.add(models.PrintTask(
                job_id=job.id,
                city=job.city,
                pdf_filename=print_filename,
                pdf_size_bytes=print_size,
                waybills_count=print_count,
                roll_type=roll_type,
                status="queued",
            ))
            idx += 1

        job.pdf_files_json = json.dumps(file_names)
        _update_status(db, job, "pdf_ready")
    except Exception as e:
        logger.exception(f"Job {job_id} failed")
        job = db.get(models.Job, job_id)
        if job:
            _update_status(db, job, "error", f"{type(e).__name__}: {e}\n{traceback.format_exc()[:2000]}")
    finally:
        db.close()
