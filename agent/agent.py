# -*- coding: utf-8 -*-
"""
Агент для складского ноутбука.
Раз в N секунд опрашивает VPS: есть ли задача на печать для моего города.
Если есть — скачивает PDF, печатает через SumatraPDF, отчитывается.

Установка на Windows:
  1. Скачать SumatraPDF-portable, положить рядом с agent.py как SumatraPDF.exe
  2. Скопировать config.ini.example → config.ini, заполнить
  3. python agent.py

Проверить имя принтера:
  Get-Printer | Select-Object Name
"""
import configparser
import logging
import os
import subprocess
import sys
import tempfile
import time

import requests

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("agent")


def read_config():
    cfg_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.ini")
    if not os.path.exists(cfg_path):
        logger.error(f"Config not found: {cfg_path}")
        sys.exit(1)
    cp = configparser.ConfigParser()
    cp.read(cfg_path, encoding="utf-8")
    return {
        "base_url": cp.get("agent", "base_url").rstrip("/"),
        "token": cp.get("agent", "token"),
        "city": cp.get("agent", "city"),
        "printer": cp.get("agent", "printer"),
        "sumatra_path": cp.get("agent", "sumatra_path", fallback="SumatraPDF.exe"),
        "poll_interval": cp.getint("agent", "poll_interval", fallback=5),
        "dry_run": cp.getboolean("agent", "dry_run", fallback=False),
    }


def get_next_task(cfg):
    r = requests.get(
        f"{cfg['base_url']}/agent/next-task",
        params={"city": cfg["city"]},
        headers={"Authorization": f"Bearer {cfg['token']}"},
        timeout=15,
    )
    r.raise_for_status()
    return r.json().get("task")


def download_pdf(cfg, task_id):
    r = requests.get(
        f"{cfg['base_url']}/agent/pdf/{task_id}",
        headers={"Authorization": f"Bearer {cfg['token']}"},
        timeout=60,
    )
    r.raise_for_status()
    return r.content


def report_done(cfg, task_id, ok, error=None):
    r = requests.post(
        f"{cfg['base_url']}/agent/complete/{task_id}",
        headers={"Authorization": f"Bearer {cfg['token']}"},
        json={"ok": ok, "error": error},
        timeout=15,
    )
    r.raise_for_status()


def print_pdf(cfg, pdf_bytes):
    """Печать через SumatraPDF -print-to (silent)."""
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
        f.write(pdf_bytes)
        tmp = f.name
    try:
        if cfg["dry_run"]:
            logger.info(f"  DRY-RUN: не печатаем, PDF в {tmp}")
            return True
        cmd = [cfg["sumatra_path"], "-print-to", cfg["printer"], "-silent", tmp]
        logger.info(f"  Печатаем: {' '.join(cmd)}")
        result = subprocess.run(cmd, capture_output=True, timeout=300)
        if result.returncode != 0:
            err = (result.stderr or b"").decode(errors="replace")[:500]
            raise RuntimeError(f"SumatraPDF exit={result.returncode}: {err}")
        return True
    finally:
        if not cfg["dry_run"]:
            try:
                os.unlink(tmp)
            except Exception:
                pass


def run():
    cfg = read_config()
    logger.info(f"Agent запущен: city={cfg['city']} printer={cfg['printer']} url={cfg['base_url']}")
    logger.info(f"Dry-run: {cfg['dry_run']}")

    while True:
        try:
            task = get_next_task(cfg)
        except Exception as e:
            logger.error(f"next-task ошибка: {e}")
            time.sleep(cfg["poll_interval"] * 3)
            continue

        if not task:
            time.sleep(cfg["poll_interval"])
            continue

        logger.info(
            f"Задача #{task['id']} job={task['job_id']} "
            f"файл={task['pdf_filename']} шт={task['waybills_count']} рулон={task['roll_type']}"
        )
        try:
            pdf = download_pdf(cfg, task["id"])
            print_pdf(cfg, pdf)
            report_done(cfg, task["id"], ok=True)
            logger.info(f"  ✓ напечатано")
        except Exception as e:
            logger.exception("Печать провалилась")
            try:
                report_done(cfg, task["id"], ok=False, error=str(e)[:500])
            except Exception:
                pass


if __name__ == "__main__":
    run()
