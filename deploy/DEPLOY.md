# Деплой Waybills на VPS

## Первичная установка

```bash
# 1. Клонируем в /opt/waybills
sudo mkdir -p /opt/waybills && sudo chown ubuntu:ubuntu /opt/waybills
cd /opt/waybills
git clone git@github.com:nurkhatq/waybills.git .

# 2. Виртуалка + зависимости
python3 -m venv .venv
.venv/bin/pip install --upgrade pip
.venv/bin/pip install -r requirements.txt

# 3. Создаём .env
cat > /opt/waybills/.env <<EOF
KASPI_TOKEN=Kv/vZG305UvNBHVGbgHouHCsAaCnewqrwTkNUj27gvs=
AGENT_TOKEN=$(openssl rand -hex 32)
DATA_DIR=/opt/waybills/data
DB_URL=sqlite:////opt/waybills/waybills.db
PUBLIC_BASE_URL=http://194.238.41.18/waybills
EOF

# 4. systemd
sudo cp deploy/waybills.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now waybills
sudo systemctl status waybills

# 5. nginx — добавляем блок в существующий novamanya.conf
sudo nano /etc/nginx/sites-available/novamanya.conf
# Вставить содержимое deploy/nginx-snippet.conf ВНУТРЬ server{} до location /

sudo nginx -t && sudo systemctl reload nginx

# 6. Проверить
curl http://194.238.41.18/waybills/health
# → {"ok": true, "time": "..."}
```

## Обновление после git push

```bash
cd /opt/waybills
git pull
.venv/bin/pip install -r requirements.txt
sudo systemctl restart waybills
```

## Логи

```bash
sudo journalctl -u waybills -f
```

## Агент на складском ноуте (Windows)

```powershell
# 1. Скачать релиз с GitHub, распаковать
# 2. Скачать SumatraPDF portable, положить рядом с agent.py
# 3. cp config.ini.example config.ini, отредактировать
# 4. pip install -r requirements.txt
python agent.py

# Для автозапуска — через nssm или Task Scheduler
```
