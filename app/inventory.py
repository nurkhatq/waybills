# -*- coding: utf-8 -*-
"""
Загрузка инвентаря из inventory_export.csv.
Маппинг SKU → main_sku (дубли), детект комплектов.
"""
import csv
import logging
import os
from typing import Dict, Optional, Tuple

logger = logging.getLogger(__name__)


class Inventory:
    def __init__(self):
        # any_sku → main_sku
        self._sku_to_main: Dict[str, str] = {}
        # main_sku → (display_name, is_kit)
        self._main_info: Dict[str, Tuple[str, bool]] = {}

    def load(self, csv_path: str):
        if not os.path.exists(csv_path):
            logger.warning(f"Inventory CSV not found: {csv_path}")
            return
        count = 0
        try:
            # Проход 1: определяем формат и собираем все dop_skus
            dop_set: set = set()
            new_format = False
            dop_sep = "|"
            with open(csv_path, encoding="utf-8-sig", newline="") as f:
                reader = csv.DictReader(f)
                fieldnames = reader.fieldnames or []
                new_format = "master_sku" in fieldnames
                dop_sep = "," if new_format else "|"
                for row in reader:
                    dop_raw = (row.get("dop_skus", "") or "").strip()
                    if dop_raw:
                        for dop in dop_raw.split(dop_sep):
                            dop = dop.strip()
                            if dop:
                                dop_set.add(dop)

            # Проход 2: строим маппинги
            with open(csv_path, encoding="utf-8-sig", newline="") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    main = row.get("main_sku", "").strip().strip(",")
                    if not main:
                        continue
                    # дубль = его own main_sku есть в списке dop_skus какого-то родителя
                    is_dop = main in dop_set

                    if new_format:
                        name = (row.get("name", "") or "").strip() or main
                        type_val = (row.get("type", "") or "").strip()
                    else:
                        name = row.get("ms_name", "") or row.get("kaspi_title", "") or main
                        type_val = (row.get("ms_type", "") or "").strip()

                    # дубли — всегда non-kit
                    is_kit = False if is_dop else type_val == "Комплект"
                    if not is_dop:
                        self._sku_to_main[main] = main
                    self._main_info[main] = (name, is_kit)

                    dop_raw = (row.get("dop_skus", "") or "").strip()
                    if dop_raw:
                        for dop in dop_raw.split(dop_sep):
                            dop = dop.strip()
                            if dop:
                                self._sku_to_main[dop] = main
                    count += 1
            logger.info(f"Inventory loaded: {count} products, {len(self._sku_to_main)} SKU mappings")
        except Exception as e:
            logger.error(f"Failed to load inventory: {e}")

    def resolve(self, sku: str) -> str:
        """Возвращает main_sku для любого SKU (дубля или основного)."""
        if not sku:
            return sku
        return self._sku_to_main.get(sku, sku)

    def is_kit(self, main_sku: str) -> bool:
        """True если товар — комплект (по main_sku)."""
        info = self._main_info.get(main_sku)
        return info[1] if info else False

    def is_kit_for_offer(self, offer_code: str) -> bool:
        """Проверяет kit-статус с приоритетом собственной записи offer_code.
        Если у offer_code есть своя запись в _main_info — используем её тип,
        иначе — тип resolved main_sku. Это предотвращает ложные комплекты
        когда товар (Товар) ошибочно привязан к Комплекту как доп-SKU.
        """
        own = self._main_info.get(offer_code)
        if own is not None:
            return own[1]
        main_sku = self._sku_to_main.get(offer_code, offer_code)
        info = self._main_info.get(main_sku)
        return info[1] if info else False

    def name(self, main_sku: str) -> str:
        """Название товара по main_sku."""
        info = self._main_info.get(main_sku)
        return info[0] if info else main_sku

    def __len__(self):
        return len(self._main_info)


# Глобальный синглтон — загружается при старте приложения
_inventory: Optional[Inventory] = None


def get_inventory() -> Inventory:
    global _inventory
    if _inventory is None:
        _inventory = Inventory()
        # Ленивая загрузка при первом обращении из любого процесса (воркер, API)
        try:
            from .config import settings
            _inventory.load(settings.inventory_csv_path)
        except Exception as e:
            logger.warning(f"Auto-load inventory failed: {e}")
    return _inventory


def load_inventory(csv_path: str):
    global _inventory
    if _inventory is None:
        _inventory = Inventory()
    _inventory.load(csv_path)
    return _inventory
