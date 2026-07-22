# -*- coding: utf-8 -*-
"""
Модуль сборщика: распределение заказов, скан штрихкодов, подтверждение.

Логика распределения (pull-модель по ТЗ):
- Берём последний AssemblyJob для города сборщика
- Группируем заказы по offer_code (SKU)
- SKU с 5+ заказами → тип A (один SKU, один проход)
- Остальные → тип B (пачки по BATCH_SIZE заказов, смешанные SKU)
- Сортировка типа B по бренду (латиница → кириллица)
- Сборщик берёт задание из очереди (claim), сканирует, подтверждает
- При complete → вызываем assemble_order в Kaspi (assembled=True)
"""
import json
import logging
from collections import defaultdict
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .auth import get_current_user
from .db import get_db
from . import models, kaspi
from .inventory import get_inventory

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/picker", tags=["picker"])

MASS_THRESHOLD = 5   # SKU с 5+ заказами = тип A
BATCH_SIZE = 6       # Размер пачки для типа B


# ─── Schemas ──────────────────────────────────────────────────────────────────

class ScanBody(BaseModel):
    order_code: str
    barcode: str | None = None       # None = кнопка "нет штрихкода"
    match_status: str = "matched"    # matched | unknown_barcode | no_barcode | skipped


class BulkScanBody(BaseModel):
    """Быстрый режим типа A: один скан + количество."""
    barcode: str | None = None
    quantity: int = 1               # сколько заказов подтвердить


# ─── Queue builder ────────────────────────────────────────────────────────────

def _is_cyrillic(text: str) -> bool:
    for ch in text:
        if "Ѐ" <= ch <= "ӿ":
            return True
    return False


def _brand_sort_key(brand: str) -> tuple:
    """Сначала латиница A→Z, потом кириллица А→Я."""
    b = brand.strip().lower()
    return (1 if _is_cyrillic(b) else 0, b)


def build_picker_tasks(city: str, db: Session) -> int:
    """
    Строит picker_tasks из последнего AssemblyJob для города.
    Если задания уже есть (pending/claimed) — не пересоздаёт.
    Возвращает кол-во созданных задач.
    """
    existing = (
        db.query(models.PickerTask)
        .filter(
            models.PickerTask.city == city,
            models.PickerTask.status.in_(["pending", "claimed"]),
        )
        .count()
    )
    if existing > 0:
        return 0

    aj = (
        db.query(models.AssemblyJob)
        .filter(models.AssemblyJob.city == city, models.AssemblyJob.status == "ready")
        .order_by(models.AssemblyJob.id.desc())
        .first()
    )
    if not aj:
        return 0

    orders = (
        db.query(models.AssemblyOrder)
        .filter(models.AssemblyOrder.job_id == aj.id)
        .all()
    )
    if not orders:
        return 0

    inv = get_inventory()

    # Группируем по resolved main_sku
    groups: dict[str, list] = defaultdict(list)
    for o in orders:
        raw_sku = o.offer_code or ""
        main_sku = inv.resolve(raw_sku) if raw_sku else raw_sku
        groups[main_sku].append(o)

    # Тип A: SKU с 5+ заказами
    type_a_skus = {sku for sku, ords in groups.items() if len(ords) >= MASS_THRESHOLD}

    # Тип B: остальные, сортируем по бренду
    type_b_items = []
    for sku, ords in groups.items():
        if sku not in type_a_skus:
            brand = inv.brand(sku) if sku else ""
            for o in ords:
                type_b_items.append((brand, sku, o))

    type_b_items.sort(key=lambda x: _brand_sort_key(x[0]))

    created = 0

    for sku in type_a_skus:
        ords = groups[sku]
        info = inv.product_info(sku) if sku else {"name": sku, "barcode": None, "is_kit": False}
        is_kit = info.get("is_kit", False)
        task_orders = [
            {
                "order_code": o.code,
                "kaspi_order_id": o.kaspi_order_id,
                "offer_code": o.offer_code or sku,
                "name": o.name or info.get("name", sku),
                "quantity": o.quantity,
                "is_kit": is_kit,
            }
            for o in ords
        ]
        db.add(models.PickerTask(
            city=city,
            task_type="A",
            offer_code=sku,
            product_name=info.get("name", sku),
            expected_barcode=info.get("barcode"),
            orders_json=json.dumps(task_orders, ensure_ascii=False),
            total_orders=len(ords),
            total_qty=sum(o.quantity for o in ords),
        ))
        created += 1

    # Тип B (пачки по BATCH_SIZE)
    batch: list = []
    for brand, sku, o in type_b_items:
        info = inv.product_info(sku) if sku else {"name": o.name or sku, "barcode": None, "is_kit": False}
        is_kit = info.get("is_kit", False)
        batch.append({
            "order_code": o.code,
            "kaspi_order_id": o.kaspi_order_id,
            "offer_code": o.offer_code or sku,
            "name": o.name or info.get("name", sku),
            "quantity": o.quantity,
            "expected_barcode": info.get("barcode"),
            "is_kit": is_kit,
        })
        if len(batch) >= BATCH_SIZE:
            db.add(models.PickerTask(
                city=city,
                task_type="B",
                orders_json=json.dumps(batch, ensure_ascii=False),
                total_orders=len(batch),
                total_qty=sum(item["quantity"] for item in batch),
            ))
            created += 1
            batch = []

    if batch:
        db.add(models.PickerTask(
            city=city,
            task_type="B",
            orders_json=json.dumps(batch, ensure_ascii=False),
            total_orders=len(batch),
            total_qty=sum(item["quantity"] for item in batch),
        ))
        created += 1

    db.commit()
    logger.info(f"picker: built {created} tasks for {city}")
    return created


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _resolve_scan_status(barcode: str | None, order: dict, inv) -> str:
    """Определяет match_status по отсканированному штрихкоду и заказу."""
    if barcode is None:
        return "no_barcode"

    expected_barcode = order.get("expected_barcode") or order.get("barcode")
    is_kit = order.get("is_kit", False)

    # Ищем в инвентаре
    found_sku = inv.lookup_barcode(barcode)  # всегда возвращает resolved main_sku

    # Комплекты: скан любого известного товара принимается
    # (компоненты комплекта — отдельные SKU)
    if is_kit:
        if found_sku:
            return "matched"
        # штрихкод неизвестен системе — записываем как unknown для дальнейшего добавления
        return "unknown_barcode"

    if found_sku is None:
        return "unknown_barcode"

    # Сравниваем с ожидаемым SKU заказа
    expected_sku = order.get("offer_code", "")
    main_expected = inv.resolve(expected_sku) if expected_sku else None

    if main_expected and found_sku == main_expected:
        return "matched"

    # Штрихкод известен, но не совпадает с ожидаемым
    return "unknown_barcode"


def _task_dict(task: models.PickerTask, include_scans: bool = False) -> dict:
    orders = json.loads(task.orders_json or "[]")
    scan_map = {}
    if include_scans:
        for s in (task.scans or []):
            scan_map[s.order_code] = {
                "barcode_scanned": s.barcode_scanned,
                "match_status": s.match_status,
                "scanned_at": s.scanned_at.isoformat() if s.scanned_at else None,
            }
    for o in orders:
        o["scan"] = scan_map.get(o["order_code"])
    return {
        "id": task.id,
        "city": task.city,
        "task_type": task.task_type,
        "offer_code": task.offer_code,
        "product_name": task.product_name,
        "expected_barcode": task.expected_barcode,
        "orders": orders,
        "total_orders": task.total_orders,
        "total_qty": task.total_qty,
        "scanned_qty": task.scanned_qty,
        "picker_username": task.picker_username,
        "status": task.status,
        "created_at": task.created_at.isoformat() if task.created_at else None,
        "claimed_at": task.claimed_at.isoformat() if task.claimed_at else None,
        "completed_at": task.completed_at.isoformat() if task.completed_at else None,
    }


def _count_scanned(task: models.PickerTask) -> int:
    return len([s for s in task.scans if s.match_status != "skipped"])


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/build")
def build_tasks(
    city: str | None = None,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Построить очередь задач из последнего AssemblyJob. Вызывается менеджером."""
    target_city = city or user.get("city", "almaty")
    if user.get("role") not in ("admin", "manager") and target_city != user.get("city"):
        raise HTTPException(403, "Нет доступа")
    created = build_picker_tasks(target_city, db)
    pending = db.query(models.PickerTask).filter(
        models.PickerTask.city == target_city,
        models.PickerTask.status == "pending",
    ).count()
    return {"created": created, "pending_tasks": pending}


@router.get("/tasks")
def list_tasks(
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Список доступных задач для сборщика (pending + его claimed)."""
    city = user.get("city", "almaty")
    username = user.get("username")

    pending_count = db.query(models.PickerTask).filter(
        models.PickerTask.city == city,
        models.PickerTask.status == "pending",
    ).count()
    if pending_count == 0:
        build_picker_tasks(city, db)

    tasks = (
        db.query(models.PickerTask)
        .filter(
            models.PickerTask.city == city,
            models.PickerTask.status.in_(["pending", "claimed"]),
        )
        .order_by(models.PickerTask.id)
        .all()
    )
    return {
        "tasks": [_task_dict(t) for t in tasks],
        "my_task": next(
            (_task_dict(t, include_scans=True) for t in tasks
             if t.picker_username == username and t.status == "claimed"),
            None,
        ),
    }


@router.post("/tasks/{task_id}/claim")
def claim_task(
    task_id: int,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    username = user.get("username")
    city = user.get("city", "almaty")

    active = db.query(models.PickerTask).filter(
        models.PickerTask.city == city,
        models.PickerTask.picker_username == username,
        models.PickerTask.status == "claimed",
    ).first()
    if active:
        raise HTTPException(409, f"У вас уже есть активное задание #{active.id}")

    task = db.get(models.PickerTask, task_id)
    if not task:
        raise HTTPException(404, "Задание не найдено")
    if task.city != city:
        raise HTTPException(403, "Задание для другого склада")
    if task.status != "pending":
        raise HTTPException(409, "Задание уже взято другим сборщиком")

    task.status = "claimed"
    task.picker_username = username
    task.claimed_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(task)
    return _task_dict(task, include_scans=True)


@router.get("/tasks/{task_id}")
def get_task(
    task_id: int,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    task = db.get(models.PickerTask, task_id)
    if not task:
        raise HTTPException(404, "Задание не найдено")
    if task.city != user.get("city") and user.get("role") not in ("admin", "manager"):
        raise HTTPException(403, "Нет доступа")
    return _task_dict(task, include_scans=True)


@router.post("/tasks/{task_id}/scan")
def record_scan(
    task_id: int,
    body: ScanBody,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Записать скан одного заказа."""
    task = db.get(models.PickerTask, task_id)
    if not task:
        raise HTTPException(404, "Задание не найдено")
    if task.picker_username != user.get("username"):
        raise HTTPException(403, "Это задание взял другой сборщик")
    if task.status != "claimed":
        raise HTTPException(400, "Задание не активно")

    orders_list = json.loads(task.orders_json or "[]")
    order_item = next((o for o in orders_list if o["order_code"] == body.order_code), None)

    existing = next((s for s in task.scans if s.order_code == body.order_code), None)

    if body.match_status != "matched":
        # Клиент передал явный статус (no_barcode, skipped и пр.) — доверяем
        status = body.match_status
    elif body.barcode is None:
        status = "no_barcode"
    else:
        # Авто-определение
        inv = get_inventory()
        if order_item:
            status = _resolve_scan_status(body.barcode, order_item, inv)
        else:
            found = inv.lookup_barcode(body.barcode)
            status = "matched" if found else "unknown_barcode"

    if existing:
        existing.barcode_scanned = body.barcode
        existing.match_status = status
        existing.scanned_at = datetime.now(timezone.utc)
    else:
        db.add(models.PickerScan(
            task_id=task_id,
            order_code=body.order_code,
            offer_code=order_item.get("offer_code") if order_item else None,
            barcode_scanned=body.barcode,
            match_status=status,
        ))

    db.flush()
    task.scanned_qty = _count_scanned(task)
    db.commit()
    db.refresh(task)
    return _task_dict(task, include_scans=True)


@router.post("/tasks/{task_id}/bulk-scan")
def bulk_scan(
    task_id: int,
    body: BulkScanBody,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """
    Быстрый режим для типа A: один скан + количество.
    Подтверждает `quantity` заказов подряд начиная с первого неотсканированного.
    """
    task = db.get(models.PickerTask, task_id)
    if not task:
        raise HTTPException(404, "Задание не найдено")
    if task.picker_username != user.get("username"):
        raise HTTPException(403, "Это задание взял другой сборщик")
    if task.status != "claimed":
        raise HTTPException(400, "Задание не активно")

    orders_list = json.loads(task.orders_json or "[]")
    scanned_codes = {s.order_code for s in task.scans}
    pending_orders = [o for o in orders_list if o["order_code"] not in scanned_codes]

    inv = get_inventory()
    qty = min(body.quantity, len(pending_orders))
    if qty <= 0:
        raise HTTPException(400, "Нет заказов для подтверждения")

    # Определяем статус по первому незаполненному заказу
    sample_order = pending_orders[0] if pending_orders else {}
    if body.barcode is None:
        status = "no_barcode"
    else:
        status = _resolve_scan_status(body.barcode, sample_order, inv)

    for o in pending_orders[:qty]:
        db.add(models.PickerScan(
            task_id=task_id,
            order_code=o["order_code"],
            offer_code=o.get("offer_code"),
            barcode_scanned=body.barcode,
            match_status=status,
        ))

    db.flush()
    task.scanned_qty = _count_scanned(task)
    db.commit()
    db.refresh(task)
    return _task_dict(task, include_scans=True)


@router.post("/tasks/{task_id}/complete")
def complete_task(
    task_id: int,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Сборщик завершил задание. Вызываем assemble_order для каждого заказа в Kaspi."""
    task = db.get(models.PickerTask, task_id)
    if not task:
        raise HTTPException(404, "Задание не найдено")
    if task.picker_username != user.get("username"):
        raise HTTPException(403, "Это задание взял другой сборщик")
    if task.status != "claimed":
        raise HTTPException(400, "Задание не активно")

    task.status = "done"
    task.completed_at = datetime.now(timezone.utc)
    db.commit()

    scans = task.scans
    orders_list = json.loads(task.orders_json or "[]")

    # Отправляем assemble_order в Kaspi только для успешно отсканированных
    scanned_codes = {
        s.order_code for s in scans
        if s.match_status in ("matched", "unknown_barcode", "no_barcode")
    }
    assembled_count = 0
    errors = []
    for o in orders_list:
        if o["order_code"] in scanned_codes:
            ok = kaspi.assemble_order(o["kaspi_order_id"], o["order_code"])
            if ok:
                assembled_count += 1
            else:
                errors.append(o["order_code"])

    if errors:
        logger.warning(f"picker task {task_id}: assemble_order failed for {errors}")

    return {
        "task_id": task_id,
        "status": "done",
        "total_orders": task.total_orders,
        "scanned": len([s for s in scans if s.match_status in ("matched", "unknown_barcode")]),
        "no_barcode": len([s for s in scans if s.match_status == "no_barcode"]),
        "skipped": len([s for s in scans if s.match_status == "skipped"]),
        "assembled_in_kaspi": assembled_count,
        "assemble_errors": errors,
    }


@router.post("/tasks/{task_id}/release")
def release_task(
    task_id: int,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Вернуть задание в очередь."""
    task = db.get(models.PickerTask, task_id)
    if not task:
        raise HTTPException(404, "Задание не найдено")
    if task.picker_username != user.get("username") and user.get("role") not in ("admin", "manager"):
        raise HTTPException(403, "Нет доступа")

    task.status = "pending"
    task.picker_username = None
    task.claimed_at = None
    task.scanned_qty = 0
    for s in list(task.scans):
        db.delete(s)
    db.commit()
    return {"released": True}


@router.get("/lookup/barcode/{barcode}")
def lookup_barcode(
    barcode: str,
    user: dict = Depends(get_current_user),
):
    """Найти товар по штрихкоду. dop_sku автоматически разрешается до main_sku."""
    inv = get_inventory()
    main_sku = inv.lookup_barcode(barcode)  # уже resolved
    if not main_sku:
        return {"found": False, "barcode": barcode}
    return {"found": True, "barcode": barcode, **inv.product_info(main_sku)}
