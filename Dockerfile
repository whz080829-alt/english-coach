# 英语提分教练 · 全栈版（前端 + Python 后端 + SQLite）
#
# 特点：零第三方依赖，只用 Python 标准库，所以镜像很小、构建很快。
# 数据必须放在挂载的持久磁盘上（默认 /data），否则容器重启会丢数据。

FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    HOST=0.0.0.0 \
    PORT=8080 \
    EC_DB=/data/coach.db

WORKDIR /app

COPY server/ /app/server/
COPY web/    /app/web/

RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 8080

# --host 0.0.0.0：容器内必须监听所有网卡
# --db：指向持久磁盘
CMD ["sh", "-c", "python server/app.py --host 0.0.0.0 --port ${PORT:-8080} --db ${EC_DB:-/data/coach.db}"]
