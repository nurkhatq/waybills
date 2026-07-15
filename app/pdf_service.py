# -*- coding: utf-8 -*-
"""
Генерация итоговых PDF: обрезка белых полей, нормализация под целевой размер 75x120мм,
разбивка на файлы под рулоны А и Б.
"""
import collections
import io
import logging
import os
from typing import Dict, List, Optional, Tuple

import pypdfium2
from PIL import ImageOps
from pypdf import PdfReader, PdfWriter, Transformation
from pypdf.generic import RectangleObject

logger = logging.getLogger(__name__)

MM_TO_PT = 2.83465


def _resolve_sku(offer_code: str, inventory=None) -> str:
    """Возвращает main_sku через инвентарь, или prefix если инвентарь не задан."""
    if inventory:
        return inventory.resolve(offer_code)
    return offer_code.rsplit("_", 1)[0] if "_" in offer_code else offer_code


def build_frequency_map(orders: List[Dict], inventory=None) -> "collections.Counter":
    freq = collections.Counter()
    for o in orders:
        for e in o["entries"]:
            offer_code = (e.get("offer") or {}).get("code", "")
            master = _resolve_sku(offer_code, inventory)
            freq[master] += e.get("quantity") or 0
    return freq


def classify_and_sort(orders: List[Dict], freq_map: "collections.Counter", inventory=None) -> List[Dict]:
    """
    Помечает каждый заказ группой A/B/C, max_freq, is_single.
    inventory (опционально) — для разрешения дублей SKU и детекта комплектов.
    """
    for o in orders:
        unique_offers = set()
        total_qty = 0
        max_freq = 0
        primary_sku = ""
        has_kit = False
        for e in o["entries"]:
            offer_code = (e.get("offer") or {}).get("code", "")
            master = _resolve_sku(offer_code, inventory)
            unique_offers.add(master)
            total_qty += e.get("quantity") or 0
            if inventory and inventory.is_kit(master):
                has_kit = True
            if freq_map.get(master, 0) > max_freq:
                max_freq = freq_map[master]
                primary_sku = master
        num_positions = len(unique_offers)
        if num_positions == 1 and total_qty == 1:
            group = "A"
            is_single = not has_kit
        elif num_positions == 1:
            group = "B"
            is_single = False
        else:
            group = "C"
            is_single = False
        o["num_positions"] = num_positions
        o["total_qty"] = total_qty
        o["group_letter"] = group
        o["max_freq"] = max_freq
        o["primary_sku"] = primary_sku
        o["is_single"] = is_single

    orders.sort(
        key=lambda o: (
            {"A": 0, "B": 1, "C": 2}[o["group_letter"]],
            -o["max_freq"],
            o["primary_sku"],
            -o["total_qty"],
            o["code"],
        )
    )
    return orders


def detect_content_bbox(pdf_bytes: bytes, margin_pt: float = 8) -> Optional[Tuple[float, float, float, float]]:
    """
    Возвращает bbox контента страницы в PDF-координатах (Y от низа), с полями.
    None если не удалось.
    """
    try:
        pdf = pypdfium2.PdfDocument(pdf_bytes)
        page = pdf[0]
        pw, ph = page.get_size()
        img = page.render(scale=1.0).to_pil().convert("L")
        w, h = img.size
        inv = ImageOps.invert(img)
        bbox = inv.getbbox()
        if not bbox:
            return None
        px0, py0, px1, py1 = bbox
        x0 = max(0, px0 * pw / w - margin_pt)
        x1 = min(pw, px1 * pw / w + margin_pt)
        y0 = max(0, (h - py1) * ph / h - margin_pt)
        y1 = min(ph, (h - py0) * ph / h + margin_pt)
        return (x0, y0, x1, y1)
    except Exception as e:
        logger.warning(f"detect_content_bbox failed: {e}")
        return None


def build_pdf_for_orders(
    orders_pdfs: List[Tuple[str, bytes]],
    label_width_mm: float = 75.0,
    label_height_mm: float = 120.0,
) -> bytes:
    """
    Собирает PDF из накладных заказов, обрезает белые поля, масштабирует под 75x120мм.
    orders_pdfs: список кортежей (order_code, pdf_bytes)
    Возвращает bytes готового PDF.
    """
    target_w = label_width_mm * MM_TO_PT
    target_h = label_height_mm * MM_TO_PT

    writer = PdfWriter()
    for order_code, pdf_bytes in orders_pdfs:
        try:
            bbox = detect_content_bbox(pdf_bytes)
            reader = PdfReader(io.BytesIO(pdf_bytes))
            page = reader.pages[0]

            if bbox:
                x0, y0, x1, y1 = bbox
                bw = x1 - x0
                bh = y1 - y0
            else:
                x0, y0 = 0.0, 0.0
                bw = float(page.mediabox.width)
                bh = float(page.mediabox.height)

            # Масштаб с сохранением пропорций до вписывания в target
            scale = min(target_w / bw, target_h / bh)
            # Центрируем в target
            new_w = bw * scale
            new_h = bh * scale
            offset_x = (target_w - new_w) / 2.0
            offset_y = (target_h - new_h) / 2.0

            page.add_transformation(
                Transformation()
                .translate(-x0, -y0)
                .scale(scale, scale)
                .translate(offset_x, offset_y)
            )
            rect = RectangleObject([0, 0, target_w, target_h])
            page.mediabox = rect
            page.cropbox = rect
            page.trimbox = rect
            page.artbox = rect
            writer.add_page(page)
        except Exception as e:
            logger.error(f"Skipping order {order_code}: {e}")
            continue

    buf = io.BytesIO()
    writer.write(buf)
    writer.close()
    return buf.getvalue()


def split_for_rolls(
    total: int, roll_a: int = 250, roll_b: int = 100, threshold: int = 100
) -> List[Tuple[str, int]]:
    """
    Разбивка на файлы под рулоны:
    - Полные рулоны роллом А (по roll_a штук)
    - Остаток: если ≤ threshold, отдельным PDF под роллом Б; иначе последним PDF под роллом А
    Возвращает [("A"|"B", count), ...]
    """
    chunks = []
    remaining = total
    while remaining > 0:
        if remaining <= threshold:
            chunks.append(("B", remaining))
            remaining = 0
        elif remaining <= roll_a:
            chunks.append(("A", remaining))
            remaining = 0
        else:
            chunks.append(("A", roll_a))
            remaining -= roll_a
    return chunks


def save_pdf(pdf_bytes: bytes, path: str):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(pdf_bytes)
