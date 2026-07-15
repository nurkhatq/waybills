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
            with open(csv_path, encoding="utf-8-sig", newline="") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    main = row.get("main_sku", "").strip()
                    if not main:
                        continue
                    name = row.get("ms_name", "") or row.get("kaspi_title", "") or main
                    is_kit = (row.get("ms_type", "") or "").strip() == "Комплект"
                    self._sku_to_main[main] = main
                    self._main_info[main] = (name, is_kit)

                    dop_raw = row.get("dop_skus", "")
                    if dop_raw:
                        for dop in dop_raw.split("|"):
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
        """True если товар — комплект."""
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
    return _inventory


def load_inventory(csv_path: str):
    inv = get_inventory()
    inv.load(csv_path)
    return inv
