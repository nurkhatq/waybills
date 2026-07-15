# -*- coding: utf-8 -*-
"""
Фоновые задачи Celery.
"""
import json
import logging
import os
import traceback

from sqlalchemy.orm import Session

from . import kaspi, label_service, pdf_service, models
from .celery_app import celery
from .config import settings
from .db import SessionLocal
from .inventory import get_inventory

logger = logging.getLogger(__name__)


def _update_status(db, job, status, error=None):
    job.status = status
    if error:
        job.error = error
    db.commit()


def _update_progress(db, job, progress, label=""):
    job.progress = progress
    job.progress_label = label
    db.commit()


def _waybill_cache_path(job_id, order_code):
    return os.path.join(settings.data_dir, str(job_id), "waybills", f"{order_code}.pdf")


# Assembly tasks

@celery.task(name="tasks.fetch_assembly_job", bind=True, max_retries=0)
def fetch_assembly_job(self, job_id):
    db = SessionLocal()
    try:
        job = db.get(models.AssemblyJob, job_id)
        if not job:
            return
        job.status = "fetching"
        job.progress = 5
        job.progress_label = "Подключаемся к Kaspi..."
        db.commit()
        orders = kaspi.fetch_assembly_orders(job.city, days_back=7)
        job.progress = 80
        job.progress_label = f"Найдено {len(orders)} заказов..."
        db.commit()
        db.query(models.AssemblyOrder).filter(models.AssemblyOrder.job_id == job_id).delete()
        for o in orders:
            db.add(models.AssemblyOrder(
                job_id=job_id,
                kaspi_order_id=o["id"],
                code=o["code"],
                name=o.get("name", ""),
                offer_code=o.get("offer_code", ""),
                quantity=o.get("quantity", 1),
                base_price=o.get("base_price", 0.0),
            ))
        job.orders_found = len(orders)
        job.status = "ready"
        job.progress = 100
        job.progress_label = ""
        db.commit()
        old_jobs = (
            db.query(models.AssemblyJob)
            .filter(models.AssemblyJob.city == job.city, models.AssemblyJob.id != job_id)
            .order_by(models.AssemblyJob.id.desc())
            .offset(2)
            .all()
        )
        for old in old_jobs:
            db.delete(old)
        db.commit()
    except Exception as e:
        logger.exception(f"fetch_assembly_job {job_id} failed")
        job = db.get(models.AssemblyJob, job_id)
        if job:
            job.status = "error"
            job.error = str(e)
            db.commit()
    finally:
        db.close()


@celery.task(name="tasks.transmit_assembly_job", bind=True, max_retries=0)
def transmit_assembly_job(self, job_id):
    db = SessionLocal()
    try:
        job = db.get(models.AssemblyJob, job_id)
        if not job:
            return
        job.status = "transmitting"
        job.progress = 0
        db.commit()
        orders = (
            db.query(models.AssemblyOrder)
            .filter(models.AssemblyOrder.job_id == job_id, models.AssemblyOrder.transmitted == False)
            .all()
        )
        total = len(orders)
        done = 0
        for o in orders:
            ok = kaspi.assemble_order(o.kaspi_order_id, o.code)
            o.transmitted = True
            o.transmitted_ok = ok
            done += 1
            job.progress = int(done / total * 100) if total else 100
            job.progress_label = f"Отправлено {done} / {total}"
            db.commit()
        job.orders_transmitted = sum(1 for o in orders if o.transmitted_ok)
        job.status = "done"
        job.progress = 100
        job.progress_label = ""
        db.commit()
    except Exception as e:
        logger.exception(f"transmit_assembly_job {job_id} failed")
        job = db.get(models.AssemblyJob, job_id)
        if job:
            job.status = "error"
            job.error = str(e)
            db.commit()
    finally:
        db.close()


# Waybill tasks

@celery.task(name="tasks.process_job", bind=True, max_retries=0)
def process_job(self, job_id):
    db = SessionLocal()
    try:
        job = db.get(models.Job, job_id)
        if not job:
            logger.error(f"Job {job_id} not found")
            return

        _update_status(db, job, "parsing")
        _update_progress(db, job, 5, "Получаем заказы от Kaspi...")

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

        printed_jobs = (
            db.query(models.Job)
            .filter(models.Job.city == job.city, models.Job.printed_at.isnot(None), models.Job.id != job.id)
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

        if not orders:
            _update_progress(db, job, 100, "")
            _update_status(db, job, "done", "Все заказы уже были напечатаны ранее.")
            return

        _update_progress(db, job, 15, f"Найдено {len(orders)} заказов, сортируем...")

        inv = get_inventory()
        freq_map = pdf_service.build_frequency_map(orders, inventory=inv)
        sorted_orders = pdf_service.classify_and_sort(orders, freq_map, inventory=inv)
        orders_to_process = sorted_orders[:job.test_limit] if job.test_mode else sorted_orders

        for o in orders_to_process:
            kd = o["attrs"].get("kaspiDelivery") or {}
            db.add(models.Order(
                job_id=job.id,
                order_code=o["code"],
                waybill_number=kd.get("waybillNumber"),
                waybill_url=kd.get("waybill"),
                num_positions=o["num_positions"],
                total_qty=o["total_qty"],
                group_letter=o["group_letter"],
                max_freq=o["max_freq"],
                primary_sku=o.get("primary_sku", ""),
                is_single=o.get("is_single", False),
                entries_json=json.dumps(o.get("entries", []), ensure_ascii=False),
            ))

        job.group_a_count = sum(1 for o in orders_to_process if o["group_letter"] == "A")
        job.group_b_count = sum(1 for o in orders_to_process if o["group_letter"] == "B")
        job.group_c_count = sum(1 for o in orders_to_process if o["group_letter"] == "C")
        db.commit()

        if job.smart_mode:
            _run_smart_mode_fetch(db, job, orders_to_process)
        else:
            _run_standard_mode(db, job, orders_to_process)

    except Exception as e:
        logger.exception(f"Job {job_id} failed")
        job = db.get(models.Job, job_id)
        if job:
            _update_status(db, job, "error", f"{type(e).__name__}: {e}\n{traceback.format_exc()[:2000]}")
    finally:
        db.close()


def _run_smart_mode_fetch(db, job, orders):
    total = len(orders)
    codes_with_pdf = set()

    for i, o in enumerate(orders):
        pct = 20 + int((i / total) * 55)
        _update_progress(db, job, pct, f"Скачиваем накладные {i + 1} / {total}")
        kd = o["attrs"].get("kaspiDelivery") or {}
        url = kd.get("waybill")
        if not url:
            continue
        try:
            pdf_bytes = kaspi.download_waybill_pdf(url)
            cache_path = _waybill_cache_path(job.id, o["code"])
            pdf_service.save_pdf(pdf_bytes, cache_path)
            codes_with_pdf.add(o["code"])
        except Exception as e:
            logger.warning(f"Order {o['code']}: waybill download failed: {e}")

    _update_progress(db, job, 80, "Анализируем заказы...")

    inv = get_inventory()
    single_groups = {}
    non_single_count = 0

    for o in orders:
        if o["code"] not in codes_with_pdf:
            continue
        if o.get("is_single"):
            sku = o.get("primary_sku", o["code"])
            # Сначала ищем в инвентаре
            inv_name = inv.name(sku) if len(inv) > 0 else sku
            if inv_name != sku:
                name = inv_name
            else:
                # Fallback: имя из данных Kaspi (entries[0].offer.name)
                entries = o.get("entries", [])
                name = ((entries[0].get("offer") or {}).get("name", "") if entries else "") or sku
            if sku not in single_groups:
                single_groups[sku] = {"sku": sku, "name": name, "count": 0, "codes": []}
            single_groups[sku]["count"] += 1
            single_groups[sku]["codes"].append(o["code"])
        else:
            non_single_count += 1

    groups_list = sorted(single_groups.values(), key=lambda g: -g["count"])
    stats = {
        "groups": groups_list,
        "non_single_count": non_single_count,
        "total_with_pdf": len(codes_with_pdf),
    }
    job.single_stats_json = json.dumps(stats, ensure_ascii=False)
    _update_progress(db, job, 100, "")
    _update_status(db, job, "stats_ready")


def _run_standard_mode(db, job, orders):
    total = len(orders)
    orders_pdfs = []

    for i, o in enumerate(orders):
        pct = 20 + int((i / total) * 60)
        _update_progress(db, job, pct, f"Скачиваем накладные {i + 1} / {total}")
        kd = o["attrs"].get("kaspiDelivery") or {}
        url = kd.get("waybill")
        if not url:
            continue
        try:
            pdf_bytes = kaspi.download_waybill_pdf(url)
            orders_pdfs.append((o["code"], pdf_bytes))
        except Exception as e:
            logger.warning(f"Order {o['code']}: waybill download failed: {e}")

    _update_progress(db, job, 85, "Собираем PDF...")
    _finalize_pdfs(db, job, [("waybills", orders_pdfs)])


def _finalize_pdfs(db, job, batches):
    data_dir = os.path.join(settings.data_dir, str(job.id))
    os.makedirs(data_dir, exist_ok=True)
    filenames = []
    total_count = 0

    for prefix, orders_pdfs in batches:
        if not orders_pdfs:
            continue
        pdf_bytes = pdf_service.build_pdf_for_orders(
            orders_pdfs,
            label_width_mm=job.label_width_mm,
            label_height_mm=job.label_height_mm,
        )
        real_count = sum(1 for code, _ in orders_pdfs if not code.startswith("__internal_"))
        filename = f"{prefix}_{real_count}pcs.pdf"
        path = os.path.join(data_dir, filename)
        pdf_service.save_pdf(pdf_bytes, path)
        db.add(models.PrintTask(
            job_id=job.id,
            city=job.city,
            pdf_filename=filename,
            pdf_size_bytes=len(pdf_bytes),
            waybills_count=real_count,
            roll_type="A",
            status="queued",
        ))
        filenames.append(filename)
        total_count += real_count

    job.pdf_files_json = json.dumps(filenames)
    job.orders_printed = total_count
    _update_progress(db, job, 100, "")
    _update_status(db, job, "pdf_ready")


# Smart-mode: генерация PDF после выбора пользователя

@celery.task(name="tasks.generate_pdf_job", bind=True, max_retries=0)
def generate_pdf_job(self, job_id):
    db = SessionLocal()
    try:
        job = db.get(models.Job, job_id)
        if not job:
            return

        _update_status(db, job, "generating")
        _update_progress(db, job, 5, "Формируем PDF...")

        selected = json.loads(job.selected_batches_json or "[]")
        selected_codes_set = {code for batch in selected for code in batch.get("codes", [])}

        db_orders = (
            db.query(models.Order)
            .filter(models.Order.job_id == job_id)
            .all()
        )
        code_to_order = {o.order_code: o for o in db_orders}
        batches = []

        for i, batch in enumerate(selected):
            batch_pdfs = []
            product_name = batch.get("name", batch["sku"])
            codes = batch.get("codes", [])

            try:
                internal_bytes = label_service.build_internal_label(
                    product_name=product_name,
                    order_codes=codes,
                    label_width_mm=job.label_width_mm,
                    label_height_mm=job.label_height_mm,
                )
                batch_pdfs.append((f"__internal_{i}", internal_bytes))
            except Exception as e:
                logger.error(f"Internal label for batch {i} failed: {e}")

            for code in codes:
                cache_path = _waybill_cache_path(job_id, code)
                if os.path.exists(cache_path):
                    with open(cache_path, "rb") as f:
                        batch_pdfs.append((code, f.read()))
                else:
                    order = code_to_order.get(code)
                    if order and order.waybill_url:
                        try:
                            pdf_bytes = kaspi.download_waybill_pdf(order.waybill_url)
                            batch_pdfs.append((code, pdf_bytes))
                        except Exception as e:
                            logger.warning(f"Re-download failed for {code}: {e}")

            if batch_pdfs:
                safe_sku = batch["sku"].replace("/", "_")[:30]
                batches.append((f"batch_{i + 1}_{safe_sku}", batch_pdfs))

            pct = 5 + int((i + 1) / max(len(selected), 1) * 60)
            _update_progress(db, job, pct, f"Пачка {i + 1} / {len(selected)}")

        _update_progress(db, job, 70, "Формируем общую пачку...")
        common_pdfs = []
        for order in db_orders:
            if order.order_code in selected_codes_set:
                continue
            cache_path = _waybill_cache_path(job_id, order.order_code)
            if os.path.exists(cache_path):
                with open(cache_path, "rb") as f:
                    common_pdfs.append((order.order_code, f.read()))
            elif order.waybill_url:
                try:
                    pdf_bytes = kaspi.download_waybill_pdf(order.waybill_url)
                    common_pdfs.append((order.order_code, pdf_bytes))
                except Exception as e:
                    logger.warning(f"Re-download failed for {order.order_code}: {e}")

        if common_pdfs:
            batches.append(("common", common_pdfs))

        _update_progress(db, job, 85, "Сохраняем PDF...")
        _finalize_pdfs(db, job, batches)

    except Exception as e:
        logger.exception(f"generate_pdf_job {job_id} failed")
        job = db.get(models.Job, job_id)
        if job:
            _update_status(db, job, "error", f"{type(e).__name__}: {e}\n{traceback.format_exc()[:2000]}")
    finally:
        db.close()
