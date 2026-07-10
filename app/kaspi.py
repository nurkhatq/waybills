# -*- coding: utf-8 -*-
"""
Клиент Kaspi Shop API v2. Извлечён из warehouse_picking.py.
"""
import datetime
import json
import logging
from typing import List, Dict

import requests

from .config import settings

TZ_KZ = datetime.timezone(datetime.timedelta(hours=5))
logger = logging.getLogger(__name__)


def make_session() -> requests.Session:
    s = requests.Session()
    s.headers.update({
        "X-Auth-Token": settings.kaspi_token,
        "Content-Type": "application/vnd.api+json",
        "Accept": "application/vnd.api+json, application/json",
        "User-Agent": settings.kaspi_user_agent,
    })
    return s


def pickup_points_map() -> Dict[str, str]:
    return json.loads(settings.pickup_points_json)


def fetch_ready_orders(city: str, days_back: int = 7, progress_cb=None) -> Dict:
    """
    Забирает заказы в статусе «ждут курьера» для указанного города.
    Возвращает {"orders": [...], "stats": {...}}
    """
    mapping = pickup_points_map()
    pickup_point_id = mapping.get(city)
    if not pickup_point_id:
        raise ValueError(f"Unknown city: {city}. Available: {list(mapping.keys())}")

    session = make_session()
    now = datetime.datetime.now(tz=TZ_KZ)
    start = (now - datetime.timedelta(days=days_back)).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    start_ts = int(start.timestamp() * 1000)
    end_ts = int(now.timestamp() * 1000)

    ready_orders: List[Dict] = []
    stats = {"filtered_pickup": 0, "filtered_status": 0, "filtered_transmitted": 0, "filtered_express": 0}
    page = 0
    while True:
        r = session.get(
            f"{settings.kaspi_api_base}/orders",
            params={
                "page[number]": page,
                "page[size]": 100,
                "filter[orders][creationDate][$ge]": start_ts,
                "filter[orders][creationDate][$le]": end_ts,
                "filter[orders][state]": "KASPI_DELIVERY",
                "include[orders]": "entries",
                "sort": "creationDate",
            },
            timeout=30,
        )
        r.raise_for_status()
        data = r.json()
        orders = data.get("data", [])
        included = data.get("included", [])
        if not orders:
            break

        entry_lookup = {
            item["id"]: item.get("attributes", {})
            for item in included
            if item.get("type") == "orderentries"
        }

        for o in orders:
            a = o.get("attributes", {})
            if a.get("pickupPointId") != pickup_point_id:
                stats["filtered_pickup"] += 1
                continue
            if a.get("status") != "ACCEPTED_BY_MERCHANT" or not a.get("assembled"):
                stats["filtered_status"] += 1
                continue
            kd = a.get("kaspiDelivery") or {}
            if kd.get("courierTransmissionDate") is not None:
                stats["filtered_transmitted"] += 1
                continue
            if kd.get("express"):
                stats["filtered_express"] += 1
                continue

            entry_ids = [
                e["id"]
                for e in o.get("relationships", {}).get("entries", {}).get("data", [])
            ]
            entries = [entry_lookup.get(eid, {}) for eid in entry_ids if entry_lookup.get(eid)]
            ready_orders.append(
                {
                    "id": o["id"],
                    "code": str(a.get("code", "")),
                    "attrs": a,
                    "entries": entries,
                }
            )

        if progress_cb:
            progress_cb(page, len(ready_orders))
        if len(orders) < 100:
            break
        page += 1

    stats["found"] = len(ready_orders)
    return {"orders": ready_orders, "stats": stats}


def download_waybill_pdf(waybill_url: str) -> bytes:
    """Скачивает PDF накладной. Требует Accept: */* иначе 406."""
    session = make_session()
    session.headers["Accept"] = "*/*"
    r = session.get(waybill_url, timeout=30)
    r.raise_for_status()
    return r.content
