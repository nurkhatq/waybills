# -*- coding: utf-8 -*-
import datetime
import json
import logging
import os
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException, Header, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from . import kaspi, models, tasks
from .auth import get_current_user, login_via_wms
from .config import settings
from .db import get_db, init_db
from .inventory import load_inventory
from .picker import router as picker_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Waybills",
    description="Kaspi Доставка — сборка и печать накладных для склада",
    root_path="/waybills",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

init_db()
os.makedirs(settings.data_dir, exist_ok=True)
load_inventory(settings.inventory_csv_path)

STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")
if os.path.isdir(STATIC_DIR):
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


# ---------- Схемы ----------

class LoginRequest(BaseModel):
    username: str
    password: str


class JobCreate(BaseModel):
    city: str = Field(..., description="almaty | astana | shymkent")
    days_back: int = Field(7, ge=1, le=14)
    test_mode: bool = False
    test_limit: int = Field(5, ge=1, le=50)
    label_width_mm: float = Field(75.0, gt=0, lt=300)
    label_height_mm: float = Field(120.0, gt=0, lt=300)
    smart_mode: bool = False


class GenerateJobPayload(BaseModel):
    selected_batches: list  # [{sku, name, codes: [...]}, ...]


class MarkFilePrintedPayload(BaseModel):
    filename: str
    printed: bool


def _parse_pdf_files(raw_json: str | None, printed_files: list | None = None) -> list:
    if not raw_json:
        return []
    data = json.loads(raw_json)
    if not data:
        return []
    printed_set = set(printed_files or [])
    if isinstance(data[0], str):
        return [{"filename": f, "label": f, "count": None, "printed": f in printed_set} for f in data]
    for item in data:
        item["printed"] = item["filename"] in printed_set
    return data


def job_to_dict(job: models.Job) -> dict:
    return {
        "id": job.id,
        "city": job.city,
        "status": job.status,
        "error": job.error,
        "orders_found": job.orders_found,
        "orders_filtered_pickup": job.orders_filtered_pickup,
        "orders_filtered_status": job.orders_filtered_status,
        "orders_filtered_transmitted": job.orders_filtered_transmitted,
        "group_a_count": job.group_a_count,
        "group_b_count": job.group_b_count,
        "group_c_count": job.group_c_count,
        "cancel_tasks": json.loads(job.cancel_tasks_json) if job.cancel_tasks_json else [],
        "pdf_files": _parse_pdf_files(
            job.pdf_files_json,
            json.loads(job.printed_files_json) if job.printed_files_json else None,
        ),
        "orders_printed": job.orders_printed,
        "progress": job.progress or 0,
        "progress_label": job.progress_label or "",
        "printed_at": job.printed_at,
        "test_mode": job.test_mode,
        "test_limit": job.test_limit,
        "smart_mode": job.smart_mode or False,
        "single_stats": json.loads(job.single_stats_json) if job.single_stats_json else None,
        "days_back": job.days_back,
        "label_width_mm": job.label_width_mm,
        "label_height_mm": job.label_height_mm,
        "created_at": job.created_at,
        "updated_at": job.updated_at,
    }


def print_task_to_dict(t: models.PrintTask) -> dict:
    return {
        "id": t.id,
        "job_id": t.job_id,
        "city": t.city,
        "pdf_filename": t.pdf_filename,
        "pdf_size_bytes": t.pdf_size_bytes,
        "waybills_count": t.waybills_count,
        "roll_type": t.roll_type,
        "status": t.status,
        "error": t.error,
        "created_at": t.created_at,
        "claimed_at": t.claimed_at,
        "completed_at": t.completed_at,
    }


# ---------- Auth ----------

@app.post("/auth/login")
def auth_login(payload: LoginRequest):
    return login_via_wms(payload.username, payload.password)


@app.get("/auth/me")
def auth_me(user: dict = Depends(get_current_user)):
    return user


# ---------- UI ----------

@app.get("/", response_class=HTMLResponse)
def index():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))


@app.get("/config")
def get_config(user: dict = Depends(get_current_user)):
    return {
        "cities": list(kaspi.pickup_points_map().keys()),
        "user_city": user.get("city", "almaty"),
        "role": user.get("role", "operator"),
        "defaults": {
            "days_back": 7,
            "label_width_mm": settings.label_width_mm,
            "label_height_mm": settings.label_height_mm,
            "test_limit": 5,
        },
        "smart_batch_threshold": settings.smart_batch_threshold,
    }


# ---------- Jobs ----------

@app.post("/jobs")
def create_job(
    payload: JobCreate,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    # Оператор может создавать только для своего города
    if user.get("role") not in ("admin", "manager") and payload.city != user.get("city"):
        raise HTTPException(403, "Вы можете создавать сборки только для своего склада")

    if payload.city not in kaspi.pickup_points_map():
        raise HTTPException(400, f"Unknown city: {payload.city}")

    job = models.Job(
        city=payload.city,
        days_back=payload.days_back,
        test_mode=payload.test_mode,
        test_limit=payload.test_limit,
        label_width_mm=payload.label_width_mm,
        label_height_mm=payload.label_height_mm,
        smart_mode=payload.smart_mode,
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    tasks.process_job.delay(job.id)
    return job_to_dict(job)


@app.get("/jobs")
def list_jobs(
    limit: int = 20,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    q = db.query(models.Job).order_by(models.Job.id.desc())
    # Операторы видят только свой город
    if user.get("role") not in ("admin", "manager"):
        q = q.filter(models.Job.city == user.get("city"))
    return [job_to_dict(j) for j in q.limit(limit).all()]


@app.delete("/jobs")
def delete_all_jobs(
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    if user.get("role") not in ("admin", "manager"):
        raise HTTPException(403, "Только администратор может очищать историю")
    db.query(models.PrintTask).delete()
    db.query(models.Order).delete()
    count = db.query(models.Job).count()
    db.query(models.Job).delete()
    db.commit()
    return {"deleted": count}


@app.get("/jobs/{job_id}")
def get_job(job_id: int, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    job = db.get(models.Job, job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    if user.get("role") not in ("admin", "manager") and job.city != user.get("city"):
        raise HTTPException(403, "Нет доступа")
    return job_to_dict(job)


@app.post("/jobs/{job_id}/mark-printed")
def mark_printed(
    job_id: int,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    job = db.get(models.Job, job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    if user.get("role") not in ("admin", "manager") and job.city != user.get("city"):
        raise HTTPException(403, "Нет доступа")
    job.printed_at = datetime.datetime.utcnow()
    db.commit()
    return job_to_dict(job)


@app.post("/jobs/{job_id}/unmark-printed")
def unmark_printed(
    job_id: int,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    job = db.get(models.Job, job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    if user.get("role") not in ("admin", "manager") and job.city != user.get("city"):
        raise HTTPException(403, "Нет доступа")
    job.printed_at = None
    db.commit()
    return job_to_dict(job)


@app.post("/jobs/{job_id}/mark-file-printed")
def mark_file_printed(
    job_id: int,
    payload: MarkFilePrintedPayload,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    job = db.get(models.Job, job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    if user.get("role") not in ("admin", "manager") and job.city != user.get("city"):
        raise HTTPException(403, "Нет доступа")

    printed_files = json.loads(job.printed_files_json or "[]")
    if payload.printed and payload.filename not in printed_files:
        printed_files.append(payload.filename)
    elif not payload.printed and payload.filename in printed_files:
        printed_files.remove(payload.filename)
    job.printed_files_json = json.dumps(printed_files)

    # Авто-устанавливаем printed_at когда все файлы отмечены
    pdf_files = json.loads(job.pdf_files_json or "[]")
    all_filenames = [f["filename"] if isinstance(f, dict) else f for f in pdf_files]
    if all_filenames and all(fn in printed_files for fn in all_filenames):
        if not job.printed_at:
            job.printed_at = datetime.datetime.utcnow()
    else:
        job.printed_at = None

    db.commit()
    return job_to_dict(job)


@app.delete("/jobs/{job_id}")
def delete_job(
    job_id: int,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    if user.get("role") not in ("admin", "manager"):
        raise HTTPException(403, "Только администратор может удалять сборки")
    job = db.get(models.Job, job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    import shutil
    data_dir = os.path.join(settings.data_dir, str(job_id))
    if os.path.exists(data_dir):
        shutil.rmtree(data_dir, ignore_errors=True)
    db.delete(job)
    db.commit()
    return {"deleted": job_id}


@app.post("/jobs/{job_id}/retry")
def retry_job(
    job_id: int,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Создаёт новый job с теми же параметрами что исходный."""
    src = db.get(models.Job, job_id)
    if not src:
        raise HTTPException(404, "Job not found")
    if user.get("role") not in ("admin", "manager") and src.city != user.get("city"):
        raise HTTPException(403, "Нет доступа")

    job = models.Job(
        city=src.city,
        days_back=src.days_back,
        test_mode=src.test_mode,
        test_limit=src.test_limit,
        label_width_mm=src.label_width_mm,
        label_height_mm=src.label_height_mm,
        smart_mode=src.smart_mode or False,
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    tasks.process_job.delay(job.id)
    return job_to_dict(job)


@app.get("/jobs/{job_id}/orders")
def get_job_orders(job_id: int, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    job = db.get(models.Job, job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    if user.get("role") not in ("admin", "manager") and job.city != user.get("city"):
        raise HTTPException(403, "Нет доступа")
    orders = (
        db.query(models.Order)
        .filter(models.Order.job_id == job_id)
        .order_by(models.Order.id)
        .all()
    )
    return [
        {
            "id": o.id,
            "order_code": o.order_code,
            "waybill_number": o.waybill_number,
            "num_positions": o.num_positions,
            "total_qty": o.total_qty,
            "group_letter": o.group_letter,
            "max_freq": o.max_freq,
            "primary_sku": o.primary_sku,
            "entries": json.loads(o.entries_json) if o.entries_json else [],
        }
        for o in orders
    ]


@app.get("/jobs/{job_id}/stats")
def get_job_stats(job_id: int, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    """Smart-mode: возвращает статистику одиночных заказов для выбора пачек."""
    job = db.get(models.Job, job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    if user.get("role") not in ("admin", "manager") and job.city != user.get("city"):
        raise HTTPException(403, "Нет доступа")
    if not job.single_stats_json:
        raise HTTPException(400, "Статистика ещё не готова")
    return {
        "threshold": settings.smart_batch_threshold,
        **json.loads(job.single_stats_json),
    }


@app.post("/jobs/{job_id}/generate")
def generate_job_pdf(
    job_id: int,
    payload: GenerateJobPayload,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Smart-mode: пользователь выбрал пачки → запускаем генерацию PDF."""
    job = db.get(models.Job, job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    if user.get("role") not in ("admin", "manager") and job.city != user.get("city"):
        raise HTTPException(403, "Нет доступа")
    if job.status != "stats_ready":
        raise HTTPException(400, f"Job не в статусе stats_ready: {job.status}")
    job.selected_batches_json = json.dumps(payload.selected_batches, ensure_ascii=False)
    db.commit()
    tasks.generate_pdf_job.delay(job.id)
    return job_to_dict(job)


@app.get("/jobs/{job_id}/tasks")
def get_job_tasks(job_id: int, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    tasks_list = (
        db.query(models.PrintTask)
        .filter(models.PrintTask.job_id == job_id)
        .order_by(models.PrintTask.id)
        .all()
    )
    return [print_task_to_dict(t) for t in tasks_list]


def _resolve_user(authorization: Optional[str], token: Optional[str]) -> dict:
    """Принимает токен из заголовка или query-параметра (для PDF-ссылок в браузере)."""
    from .auth import get_current_user as _gcu
    if token and not authorization:
        authorization = f"Bearer {token}"
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Требуется авторизация")
    from .auth import decode_jwt
    payload = decode_jwt(authorization.split(" ", 1)[1])
    if not payload or "sub" not in payload:
        raise HTTPException(401, "Токен недействителен или истёк")
    return payload


@app.get("/jobs/{job_id}/pdf/{filename}")
def download_pdf(
    job_id: int,
    filename: str,
    token: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    user = _resolve_user(authorization, token)
    job = db.get(models.Job, job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    # picker_*.pdf доступны с любого города (принт-станция переключается между городами)
    is_picker_pdf = filename.startswith("picker_")
    if not is_picker_pdf and user.get("role") not in ("admin", "manager") and job.city != user.get("city"):
        raise HTTPException(403, "Нет доступа")
    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(400, "Bad filename")
    path = os.path.join(settings.data_dir, str(job_id), filename)
    if not os.path.exists(path):
        raise HTTPException(404, "PDF not found")
    return FileResponse(path, media_type="application/pdf", filename=filename)


def assembly_job_to_dict(job: models.AssemblyJob) -> dict:
    return {
        "id": job.id,
        "city": job.city,
        "status": job.status,
        "progress": job.progress or 0,
        "progress_label": job.progress_label or "",
        "orders_found": job.orders_found or 0,
        "orders_transmitted": job.orders_transmitted or 0,
        "error": job.error,
        "created_at": job.created_at,
    }


@app.post("/assembly/fetch")
def start_assembly_fetch(
    city: str = Query(...),
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    if user.get("role") not in ("admin", "manager") and city != user.get("city"):
        raise HTTPException(403, "Нет доступа")
    if city not in kaspi.pickup_points_map():
        raise HTTPException(400, f"Unknown city: {city}")

    job = models.AssemblyJob(city=city)
    db.add(job)
    db.commit()
    db.refresh(job)
    tasks.fetch_assembly_job.delay(job.id)
    return assembly_job_to_dict(job)


@app.get("/assembly/latest")
def get_latest_assembly_job(
    city: str = Query(...),
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    if user.get("role") not in ("admin", "manager") and city != user.get("city"):
        raise HTTPException(403, "Нет доступа")
    job = (
        db.query(models.AssemblyJob)
        .filter(models.AssemblyJob.city == city)
        .order_by(models.AssemblyJob.id.desc())
        .first()
    )
    if not job:
        return None
    return assembly_job_to_dict(job)


@app.get("/assembly/job/{job_id}")
def get_assembly_job(
    job_id: int,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    job = db.get(models.AssemblyJob, job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    if user.get("role") not in ("admin", "manager") and job.city != user.get("city"):
        raise HTTPException(403, "Нет доступа")
    return assembly_job_to_dict(job)


@app.get("/assembly/job/{job_id}/orders")
def get_assembly_job_orders(
    job_id: int,
    page: int = Query(0, ge=0),
    size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    job = db.get(models.AssemblyJob, job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    if user.get("role") not in ("admin", "manager") and job.city != user.get("city"):
        raise HTTPException(403, "Нет доступа")
    total = db.query(models.AssemblyOrder).filter(models.AssemblyOrder.job_id == job_id).count()
    orders = (
        db.query(models.AssemblyOrder)
        .filter(models.AssemblyOrder.job_id == job_id)
        .offset(page * size)
        .limit(size)
        .all()
    )
    return {
        "total": total,
        "page": page,
        "size": size,
        "orders": [
            {
                "id": o.id,
                "kaspi_order_id": o.kaspi_order_id,
                "code": o.code,
                "name": o.name,
                "offer_code": o.offer_code,
                "quantity": o.quantity,
                "base_price": o.base_price,
                "transmitted": o.transmitted,
                "transmitted_ok": o.transmitted_ok,
            }
            for o in orders
        ],
    }


@app.post("/assembly/job/{job_id}/transmit")
def start_assembly_transmit(
    job_id: int,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    job = db.get(models.AssemblyJob, job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    if user.get("role") not in ("admin", "manager") and job.city != user.get("city"):
        raise HTTPException(403, "Нет доступа")
    if job.status not in ("ready", "done"):
        raise HTTPException(400, f"Job not ready: {job.status}")
    # Reset transmitted flags so we can retry
    db.query(models.AssemblyOrder).filter(
        models.AssemblyOrder.job_id == job_id
    ).update({"transmitted": False, "transmitted_ok": None})
    job.orders_transmitted = 0
    tasks.transmit_assembly_job.delay(job_id)
    job.status = "transmitting"
    db.commit()
    return assembly_job_to_dict(job)


# ---------- Agent API ----------

def _check_agent(auth: Optional[str]):
    if not auth or auth != f"Bearer {settings.agent_token}":
        raise HTTPException(401, "Bad or missing agent token")


@app.get("/agent/next-task")
def agent_next_task(
    city: str = Query(...),
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    _check_agent(authorization)
    t = (
        db.query(models.PrintTask)
        .filter(models.PrintTask.city == city, models.PrintTask.status == "queued")
        .order_by(models.PrintTask.id)
        .first()
    )
    if not t:
        return {"task": None}
    t.status = "claimed"
    t.claimed_at = datetime.datetime.utcnow()
    db.commit()
    return {"task": print_task_to_dict(t)}


@app.get("/agent/pdf/{task_id}")
def agent_download_pdf(
    task_id: int,
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    _check_agent(authorization)
    t = db.get(models.PrintTask, task_id)
    if not t:
        raise HTTPException(404, "Task not found")
    path = os.path.join(settings.data_dir, str(t.job_id), t.pdf_filename)
    if not os.path.exists(path):
        raise HTTPException(404, "PDF file missing")
    return FileResponse(path, media_type="application/pdf", filename=t.pdf_filename)


class TaskComplete(BaseModel):
    ok: bool = True
    error: Optional[str] = None


@app.post("/agent/complete/{task_id}")
def agent_complete_task(
    task_id: int,
    payload: TaskComplete,
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    _check_agent(authorization)
    t = db.get(models.PrintTask, task_id)
    if not t:
        raise HTTPException(404, "Task not found")
    t.completed_at = datetime.datetime.utcnow()
    t.status = "done" if payload.ok else "error"
    t.error = payload.error
    db.commit()
    remaining = (
        db.query(models.PrintTask)
        .filter(models.PrintTask.job_id == t.job_id, models.PrintTask.status.in_(["queued", "claimed"]))
        .count()
    )
    if remaining == 0:
        job = db.get(models.Job, t.job_id)
        job.status = "done"
        db.commit()
    return {"ok": True}


app.include_router(picker_router)


@app.get("/health")
def health():
    return {"ok": True, "time": datetime.datetime.utcnow().isoformat()}
