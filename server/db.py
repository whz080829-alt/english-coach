"""数据库层：SQLite 连接、初始化与轻量查询封装。

只用标准库 sqlite3。每个线程一个连接（ThreadingHTTPServer 每请求一线程），
写操作用 BEGIN IMMEDIATE 事务保证并发安全。
"""
from __future__ import annotations

import json
import os
import sqlite3
import threading
import time

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, 'data')
SCHEMA_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'schema.sql')

_lock = threading.Lock()
_local = threading.local()
_db_path = None


def db_path() -> str:
    return _db_path or os.path.join(DATA_DIR, 'coach.db')


def configure(path: str) -> None:
    """由启动参数覆盖数据库位置。"""
    global _db_path
    _db_path = os.path.abspath(path)
    os.makedirs(os.path.dirname(_db_path), exist_ok=True)
    # 让当前线程下次取连接时重新打开
    if getattr(_local, 'conn', None) is not None:
        try:
            _local.conn.close()
        except Exception:
            pass
        _local.conn = None


def connect() -> sqlite3.Connection:
    conn = getattr(_local, 'conn', None)
    if conn is None:
        path = db_path()
        os.makedirs(os.path.dirname(path), exist_ok=True)
        conn = sqlite3.connect(path, timeout=15.0, isolation_level=None)
        conn.row_factory = sqlite3.Row
        conn.execute('PRAGMA journal_mode=WAL')
        conn.execute('PRAGMA foreign_keys=ON')
        conn.execute('PRAGMA busy_timeout=15000')
        conn.execute('PRAGMA synchronous=NORMAL')
        _local.conn = conn
    return conn


def init() -> None:
    """建表（幂等）。"""
    with _lock:
        conn = connect()
        with open(SCHEMA_FILE, 'r', encoding='utf-8') as f:
            conn.executescript(f.read())


class Tx:
    """事务上下文：with Tx() as conn: ..."""

    def __enter__(self) -> sqlite3.Connection:
        self.conn = connect()
        self.conn.execute('BEGIN IMMEDIATE')
        return self.conn

    def __exit__(self, exc_type, exc, tb):
        if exc_type is None:
            self.conn.execute('COMMIT')
        else:
            self.conn.execute('ROLLBACK')
        return False


def query(sql: str, args=()) -> list:
    cur = connect().execute(sql, args)
    try:
        return cur.fetchall()
    finally:
        cur.close()


def one(sql: str, args=()):
    cur = connect().execute(sql, args)
    try:
        return cur.fetchone()
    finally:
        cur.close()


def execute(sql: str, args=()) -> int:
    cur = connect().execute(sql, args)
    try:
        return cur.lastrowid
    finally:
        cur.close()


def scalar(sql: str, args=(), default=0):
    row = one(sql, args)
    if row is None:
        return default
    v = row[0]
    return default if v is None else v


def log_event(user_id, type_: str, payload=None) -> None:
    try:
        execute('INSERT INTO events(user_id, ts, type, payload) VALUES(?,?,?,?)',
                (user_id, int(time.time() * 1000), type_,
                 json.dumps(payload, ensure_ascii=False)[:2000] if payload else ''))
    except Exception:
        pass    # 留痕失败不影响主流程


def cleanup_expired_sessions() -> int:
    return connect().execute('DELETE FROM sessions WHERE expires_at < ?',
                             (int(time.time()),)).rowcount
