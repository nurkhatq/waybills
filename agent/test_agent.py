# -*- coding: utf-8 -*-
"""Быстрый смоук: агент вытаскивает задачу, качает PDF, отмечает done."""
import sys, requests

BASE = "http://194.238.41.18/waybills"
TOKEN = sys.argv[1] if len(sys.argv) > 1 else ""
CITY = sys.argv[2] if len(sys.argv) > 2 else "almaty"

h = {"Authorization": f"Bearer {TOKEN}"}

r = requests.get(f"{BASE}/agent/next-task", params={"city": CITY}, headers=h, timeout=15)
r.raise_for_status()
task = r.json().get("task")
if not task:
    print(f"[{CITY}] нет задач в очереди")
    sys.exit(0)

print(f"[{CITY}] задача #{task['id']}: {task['pdf_filename']} ({task['pdf_size_bytes']} байт, {task['waybills_count']} шт, роль {task['roll_type']})")

r = requests.get(f"{BASE}/agent/pdf/{task['id']}", headers=h, timeout=60)
r.raise_for_status()
with open(f"downloaded_{task['pdf_filename']}", "wb") as f:
    f.write(r.content)
print(f"  скачано {len(r.content)} байт → downloaded_{task['pdf_filename']}")

r = requests.post(f"{BASE}/agent/complete/{task['id']}", headers=h,
                  json={"ok": True}, timeout=15)
r.raise_for_status()
print(f"  ✓ отмечено done")
