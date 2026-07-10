# -*- coding: utf-8 -*-
from celery import Celery
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
    task_acks_late=True,  # задача снимается с очереди только после успешного завершения
)
