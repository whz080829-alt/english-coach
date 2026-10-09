#!/bin/sh
# 不用 Docker 的主机（VPS / 宝塔 / PythonAnywhere 等）直接用这个脚本启动。
# 依赖：只要 Python 3.9+，无需 pip install 任何东西。

set -e

cd "$(dirname "$0")"

HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-8788}"
DB_PATH="${EC_DB:-./data/coach.db}"

mkdir -p "$(dirname "$DB_PATH")"

echo "英语提分教练 · 全栈版"
echo "  监听：$HOST:$PORT"
echo "  数据库：$DB_PATH"
echo "  打开：http://127.0.0.1:$PORT/index.html"

exec python3 server/app.py --host "$HOST" --port "$PORT" --db "$DB_PATH"
