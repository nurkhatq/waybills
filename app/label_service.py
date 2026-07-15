# -*- coding: utf-8 -*-
import io
import json
import logging
import os
from typing import List

logger = logging.getLogger(__name__)

MM_TO_PT = 2.83465

_FONT_PATHS = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
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
    from reportlab.lib.colors import black, white, HexColor
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont

    W = label_width_mm * MM_TO_PT
    H = label_height_mm * MM_TO_PT

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

    # Белый фон
    c.setFillColor(white)
    c.rect(0, 0, W, H, fill=1, stroke=0)

    # QR-код — занимает верхние ~55% страницы
    qr_size = min(W * 0.85, H * 0.52)
    qr_x = (W - qr_size) / 2
    qr_y = H - qr_size - (H * 0.04)
    try:
        import qrcode
        from reportlab.lib.utils import ImageReader
        qr = qrcode.QRCode(box_size=6, border=2, error_correction=qrcode.constants.ERROR_CORRECT_M)
        qr.add_data(_qr_data(order_codes))
        qr.make(fit=True)
        qr_img = qr.make_image(fill_color="black", back_color="white")
        qr_buf = io.BytesIO()
        qr_img.save(qr_buf, format="PNG")
        qr_buf.seek(0)
        c.drawImage(ImageReader(qr_buf), qr_x, qr_y, qr_size, qr_size)
    except Exception as e:
        logger.warning(f"QR generation failed: {e}")
        c.setFont(reg_font, 8)
        c.setFillColor(black)
        c.drawCentredString(W / 2, qr_y + qr_size / 2, "[QR недоступен]")

    # Горизонтальная разделительная линия
    sep_y = qr_y - 6
    c.setStrokeColor(HexColor("#d1d5db"))
    c.setLineWidth(0.5)
    c.line(10, sep_y, W - 10, sep_y)

    # Название товара — перенос по словам
    name_y = sep_y - 4
    c.setFillColor(black)
    c.setFont(bold_font, 9)
    words = product_name.split()
    lines = []
    current = ""
    for w in words:
        test = (current + " " + w).strip()
        if c.stringWidth(test, bold_font, 9) < W - 14:
            current = test
        else:
            if current:
                lines.append(current)
            current = w
    if current:
        lines.append(current)
    for line in lines[:4]:
        name_y -= 11
        c.drawCentredString(W / 2, name_y, line)

    # Количество заказов
    count_y = name_y - 14
    c.setFont(bold_font, 16)
    c.drawCentredString(W / 2, count_y, f"{len(order_codes)} шт.")

    c.save()
    return buf.getvalue()


def _build_with_pil(
    product_name: str,
    order_codes: List[str],
    label_width_mm: float,
    label_height_mm: float,
) -> bytes:
    from PIL import Image, ImageDraw, ImageFont

    DPI = 150
    W = int(label_width_mm / 25.4 * DPI)
    H = int(label_height_mm / 25.4 * DPI)

    img = Image.new("RGB", (W, H), color=(255, 255, 255))
    draw = ImageDraw.Draw(img)

    font_path = _find_font(_FONT_PATHS)
    bold_path = _find_font(_FONT_BOLD_PATHS)
    try:
        font_sm = ImageFont.truetype(bold_path or font_path, size=16) if (bold_path or font_path) else ImageFont.load_default()
        font_lg = ImageFont.truetype(bold_path or font_path, size=24) if (bold_path or font_path) else ImageFont.load_default()
    except Exception:
        font_sm = font_lg = ImageFont.load_default()

    qr_size = min(int(W * 0.85), int(H * 0.52))
    qr_x = (W - qr_size) // 2
    qr_y = int(H * 0.04)

    try:
        import qrcode
        qr = qrcode.QRCode(box_size=4, border=2, error_correction=qrcode.constants.ERROR_CORRECT_M)
        qr.add_data(_qr_data(order_codes))
        qr.make(fit=True)
        qr_img = qr.make_image(fill_color="black", back_color="white").convert("RGB")
        qr_img = qr_img.resize((qr_size, qr_size), Image.NEAREST)
        img.paste(qr_img, (qr_x, qr_y))
        text_y = qr_y + qr_size + 12
    except Exception:
        text_y = int(H * 0.6)

    draw.line([(10, text_y - 4), (W - 10, text_y - 4)], fill=(200, 200, 200), width=1)

    draw.text((W // 2, text_y), product_name[:60], fill=(0, 0, 0), font=font_sm, anchor="mt")
    text_y += int(font_sm.size * 1.4) + 8
    draw.text((W // 2, text_y), f"{len(order_codes)} шт.", fill=(0, 0, 0), font=font_lg, anchor="mt")

    buf = io.BytesIO()
    img.save(buf, format="PDF", resolution=DPI)
    return buf.getvalue()
