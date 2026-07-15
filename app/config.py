# -*- coding: utf-8 -*-
"""Настройки сервиса — из переменных окружения или .env."""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    kaspi_token: str = "Kv/vZG305UvNBHVGbgHouHCsAaCnewqrwTkNUj27gvs="
    kaspi_api_base: str = "https://kaspi.kz/shop/api/v2"
    kaspi_user_agent: str = "MyKaspiIntegration/1.0 (MyStore)"
    db_url: str = "sqlite:///./waybills.db"

    # Хранилище PDF
    data_dir: str = "./data"

    # Публичный URL для агента (нужен когда агент за пределами VPS)
    public_base_url: str = "http://127.0.0.1:8090"

    # Секрет для агента
    agent_token: str = "change-me-in-production"

    # JWT для UI
    secret_key: str = "waybills-secret-change-in-production"

    # WMS backend (для проксирования логина)
    wms_url: str = "http://127.0.0.1:8000"

    # Redis — DB 1 (WMS использует DB 0)
    redis_url: str = "redis://127.0.0.1:6379/1"

    # Целевой размер термо-этикетки, мм → pt (1 mm = 2.83465 pt)
    label_width_mm: float = 75.0
    label_height_mm: float = 120.0

    # Дефолтные размеры рулонов
    roll_a_size: int = 250
    roll_b_size: int = 100
    roll_b_threshold: int = 100  # если остаток ≤ этого — на маленький рулон

    # Что считать «отсутствием ПВЗ» — маппинг город → pickupPointId
    pickup_points_json: str = '{"almaty":"15142052_PP2","astana":"15142052_PP5","shymkent":"15142052_PP1"}'

    # Инвентарь (CSV с дублями SKU и комплектами)
    inventory_csv_path: str = "./inventory_export.csv"

    # Smart-mode: порог для авто-выбора отдельной пачки (≥ N одиночных заказов)
    smart_batch_threshold: int = 5


settings = Settings()
