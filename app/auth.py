# -*- coding: utf-8 -*-
"""JWT auth через WMS backend."""
import requests as req
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Depends, HTTPException, Header
from jose import jwt, JWTError

from .config import settings

ALGORITHM = "HS256"
TOKEN_EXPIRE_DAYS = 30

# warehouse_id → kaspi city key
WAREHOUSE_CITY_MAP = {1: "shymkent", 2: "almaty", 5: "astana"}


def _wms_login(username: str, password: str) -> dict:
    try:
        r = req.post(
            f"{settings.wms_url}/api/v1/auth/login",
            data={"username": username, "password": password},
            timeout=10,
        )
        if r.status_code == 401:
            raise HTTPException(401, "Неверный логин или пароль")
        r.raise_for_status()
        return r.json()
    except HTTPException:
        raise
    except req.exceptions.RequestException as e:
        raise HTTPException(502, f"WMS недоступен: {e}")


def create_token(user_id: int, username: str, full_name: str, city: str, role: str) -> str:
    payload = {
        "sub": str(user_id),
        "username": username,
        "full_name": full_name,
        "city": city,
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(days=TOKEN_EXPIRE_DAYS),
    }
    return jwt.encode(payload, settings.secret_key, algorithm=ALGORITHM)


def decode_jwt(token: str) -> dict:
    try:
        return jwt.decode(token, settings.secret_key, algorithms=[ALGORITHM])
    except JWTError:
        return {}


def login_via_wms(username: str, password: str) -> dict:
    wms = _wms_login(username, password)
    u = wms["user"]
    warehouse_id = u.get("warehouse_id") or 0
    city = WAREHOUSE_CITY_MAP.get(warehouse_id, "almaty")
    token = create_token(u["id"], u["username"], u["full_name"], city, u["role"])
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": u["id"],
            "username": u["username"],
            "full_name": u["full_name"],
            "city": city,
            "role": u["role"],
        },
    }


def get_current_user(authorization: Optional[str] = Header(None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Требуется авторизация")
    payload = decode_jwt(authorization.split(" ", 1)[1])
    if not payload or "sub" not in payload:
        raise HTTPException(401, "Токен недействителен или истёк")
    return payload
