# -*- coding: utf-8 -*-
from celery import Celery
from celery.schedules import crontab
from .config import settings

celery = Celery(
    "waybills",
    broker=settings.redis_url,
    backend=settings.redis_url,
    include=["app.tasks"],
)

celery.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="Asia/Almaty",
    task_track_started=True,
    worker_prefetch_multiplier=1,
    task_acks_late=True,
    beat_schedule={
        # Автозакрытие сессий сборщиков в 20:00 по KZ (Asia/Almaty = UTC+5)
        "auto-close-picker-sessions": {
            "task": "tasks.auto_close_picker_sessions",
            "schedule": crontab(hour=20, minute=0),
        },
    },
)
