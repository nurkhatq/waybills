# -*- coding: utf-8 -*-
"""
Генерация внутренней накладной (Internal Label) в формате PDF.
Такой же размер как основная этикетка, но визуально отличается (синий фон, полосатая рамка).
QR-код содержит коды заказов в JSON.
"""
import io
import json
import logging
import os
from typing import List

logger = logging.getLogger(__name__)

MM_TO_PT = 2.83465

# Пути к системным шрифтам с поддержкой кириллицы (Ubuntu/Debian)
_FONT_PATHS = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    "/usr/share/fonts/truetype/ubuntu/Ubuntu-R.ttf",
    "/usr/share/fonts/truetype/freefont/FreeSans.ttf",
]

_FONT_BOLD_PATHS = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "/usr/share/fonts/truetype/ubuntu/Ubuntu-B.ttf",
    "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf",
]


def _find_font(paths: List[str]) -> str:
    for p in paths:
        if os.path.exists(p):
            return p
    return ""


def build_internal_label(
    product_name: str,
    order_codes: List[str],
    label_width_mm: float = 75.0,
    label_height_mm: float = 120.0,
) -> bytes:
    """
    Создаёт PDF-страницу внутренней накладной.
    Визуально отличается от Kaspi-накладной: синий фон шапки, штриховая рамка, ВНУТРЕННЯЯ НАКЛАДНАЯ.
    """
    try:
        return _build_with_reportlab(product_name, order_codes, label_width_mm, label_height_mm)
    except Exception as e:
        logger.error(f"label_service (reportlab) failed: {e}, falling back to PIL")
        try:
            return _build_with_pil(product_name, order_codes, label_width_mm, label_height_mm)
        except Exception as e2:
            logger.error(f"label_service (PIL) failed: {e2}")
            raise RuntimeError(f"Cannot generate internal label: {e} / {e2}")


def _qr_data(order_codes: List[str]) -> str:
    return json.dumps({"codes": order_codes}, ensure_ascii=False)


def _build_with_reportlab(
    product_name: str,
    order_codes: List[str],
    label_width_mm: float,
    label_height_mm: float,
) -> bytes:
    from reportlab.pdfgen import canvas
    from reportlab.lib.colors import HexColor, white, black
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont

    W = label_width_mm * MM_TO_PT
    H = label_height_mm * MM_TO_PT

    # Регистрируем кириллический шрифт
    font_regular = _find_font(_FONT_PATHS)
    font_bold = _find_font(_FONT_BOLD_PATHS)
    if font_regular:
        try:
            pdfmetrics.registerFont(TTFont("CyrRegular", font_regular))
        except Exception:
            font_regular = ""
    if font_bold:
        try:
            pdfmetrics.registerFont(TTFont("CyrBold", font_bold))
        except Exception:
            font_bold = ""

    reg_font = "CyrRegular" if font_regular else "Helvetica"
    bold_font = "CyrBold" if font_bold else "Helvetica-Bold"

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(W, H))

    # --- Фон ---
    c.setFillColor(HexColor("#f0f7ff"))
    c.rect(0, 0, W, H, fill=1, stroke=0)

    # --- Шапка (синяя) ---
    header_h = H * 0.18
    c.setFillColor(HexColor("#1e40af"))
    c.rect(0, H - header_h, W, header_h, fill=1, stroke=0)

    c.setFillColor(white)
    c.setFont(bold_font, 9)
    c.drawCentredString(W / 2, H - header_h * 0.45, "ВНУТРЕННЯЯ НАКЛАДНАЯ")

    # --- Штриховая рамка ---
    c.setStrokeColor(HexColor("#1e40af"))
    c.setLineWidth(2)
    c.setDash(6, 3)
    margin = 4
    c.rect(margin, margin, W - 2 * margin, H - 2 * margin, fill=0)
    c.setDash()  # сброс пунктира

    # --- QR-код ---
    qr_size = min(W * 0.38, H * 0.28)
    qr_x = W / 2 - qr_size / 2
    qr_y = H - header_h - qr_size - 8
    try:
        import qrcode
        from PIL import Image as PILImage
        qr = qrcode.QRCode(box_size=4, border=1, error_correction=qrcode.constants.ERROR_CORRECT_M)
        qr.add_data(_qr_data(order_codes))
        qr.make(fit=True)
        qr_img = qr.make_image(fill_color="black", back_color="white")
        qr_buf = io.BytesIO()
        qr_img.save(qr_buf, format="PNG")
        qr_buf.seek(0)
        from reportlab.lib.utils import ImageReader
        c.drawImage(ImageReader(qr_buf), qr_x, qr_y, qr_size, qr_size)
    except Exception as e:
        logger.warning(f"QR generation failed: {e}")
        c.setFont(reg_font, 7)
        c.setFillColor(black)
        c.drawCentredString(W / 2, qr_y + qr_size / 2, "[QR недоступен]")

    # --- Название товара ---
    name_y = qr_y - 6
    c.setFillColor(black)
    c.setFont(bold_font, 8)
    # Перенос длинного названия
    words = product_name.split()
    lines = []
    current = ""
    for w in words:
        test = (current + " " + w).strip()
        if c.stringWidth(test, bold_font, 8) < W - 16:
            current = test
        else:
            if current:
                lines.append(current)
            current = w
    if current:
        lines.append(current)
    for line in lines[:3]:
        c.drawCentredString(W / 2, name_y, line)
        name_y -= 10

    # --- Количество заказов ---
    count_y = name_y - 6
    c.setFont(bold_font, 14)
    c.setFillColor(HexColor("#1e40af"))
    c.drawCentredString(W / 2, count_y, f"{len(order_codes)} накладных")

    # --- Список кодов (первые ~8) ---
    codes_y = count_y - 14
    c.setFont(reg_font, 6)
    c.setFillColor(HexColor("#374151"))
    max_codes = 10
    for code in order_codes[:max_codes]:
        c.drawCentredString(W / 2, codes_y, code)
        codes_y -= 7
    if len(order_codes) > max_codes:
        c.drawCentredString(W / 2, codes_y, f"... и ещё {len(order_codes) - max_codes}")

    c.save()
    return buf.getvalue()


def _build_with_pil(
    product_name: str,
    order_codes: List[str],
    label_width_mm: float,
    label_height_mm: float,
) -> bytes:
    """Запасной вариант через Pillow → PDF."""
    from PIL import Image, ImageDraw, ImageFont

    DPI = 150
    W = int(label_width_mm / 25.4 * DPI)
    H = int(label_height_mm / 25.4 * DPI)

    img = Image.new("RGB", (W, H), color=(240, 247, 255))
    draw = ImageDraw.Draw(img)

    # Шапка
    header_h = int(H * 0.18)
    draw.rectangle([0, 0, W, header_h], fill=(30, 64, 175))

    # Найдём шрифт
    font_path = _find_font(_FONT_PATHS)
    bold_path = _find_font(_FONT_BOLD_PATHS)
    try:
        font_sm = ImageFont.truetype(font_path or bold_path, size=14) if (font_path or bold_path) else ImageFont.load_default()
        font_lg = ImageFont.truetype(bold_path or font_path, size=18) if (bold_path or font_path) else ImageFont.load_default()
        font_hd = ImageFont.truetype(bold_path or font_path, size=12) if (bold_path or font_path) else ImageFont.load_default()
    except Exception:
        font_sm = font_lg = font_hd = ImageFont.load_default()

    draw.text((W // 2, header_h // 2), "ВНУТРЕННЯЯ НАКЛАДНАЯ", fill=(255, 255, 255), font=font_hd, anchor="mm")

    # QR код
    try:
        import qrcode
        qr = qrcode.QRCode(box_size=3, border=1, error_correction=qrcode.constants.ERROR_CORRECT_M)
        qr.add_data(_qr_data(order_codes))
        qr.make(fit=True)
        qr_img = qr.make_image(fill_color="black", back_color="white").convert("RGB")
        qr_size = min(W // 3, H // 4)
        qr_img = qr_img.resize((qr_size, qr_size), Image.NEAREST)
        qr_x = (W - qr_size) // 2
        qr_y = header_h + 8
        img.paste(qr_img, (qr_x, qr_y))
        text_y = qr_y + qr_size + 8
    except Exception:
        text_y = header_h + 10

    draw.text((W // 2, text_y), product_name[:50], fill=(0, 0, 0), font=font_sm, anchor="mt")
    text_y += 20
    draw.text((W // 2, text_y), f"{len(order_codes)} накладных", fill=(30, 64, 175), font=font_lg, anchor="mt")
    text_y += 28

    for code in order_codes[:8]:
        draw.text((W // 2, text_y), code, fill=(55, 65, 81), font=font_sm, anchor="mt")
        text_y += 14
    if len(order_codes) > 8:
        draw.text((W // 2, text_y), f"... и ещё {len(order_codes) - 8}", fill=(107, 114, 128), font=font_sm, anchor="mt")

    # Рамка
    draw.rectangle([3, 3, W - 4, H - 4], outline=(30, 64, 175), width=2)

    buf = io.BytesIO()
    img.save(buf, format="PDF", resolution=DPI)
    return buf.getvalue()
