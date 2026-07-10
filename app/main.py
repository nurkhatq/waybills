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
        "pdf_files": json.loads(job.pdf_files_json) if job.pdf_files_json else [],
        "progress": job.progress or 0,
        "progress_label": job.progress_label or "",
        "test_mode": job.test_mode,
        "test_limit": job.test_limit,
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


@app.get("/jobs/{job_id}")
def get_job(job_id: int, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    job = db.get(models.Job, job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    if user.get("role") not in ("admin", "manager") and job.city != user.get("city"):
        raise HTTPException(403, "Нет доступа")
    return job_to_dict(job)


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
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    tasks.process_job.delay(job.id)
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
    if user.get("role") not in ("admin", "manager") and job.city != user.get("city"):
        raise HTTPException(403, "Нет доступа")
    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(400, "Bad filename")
    path = os.path.join(settings.data_dir, str(job_id), filename)
    if not os.path.exists(path):
        raise HTTPException(404, "PDF not found")
    return FileResponse(path, media_type="application/pdf", filename=filename)


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


@app.get("/health")
def health():
    return {"ok": True, "time": datetime.datetime.utcnow().isoformat()}
