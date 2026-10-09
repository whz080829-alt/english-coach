"""认证：密码哈希（PBKDF2-HMAC-SHA256）、会话令牌、输入校验、登录限流。

安全设计：
  * 密码用 PBKDF2-HMAC-SHA256 + 每用户独立随机盐 + 20 万次迭代，绝不明文/可逆存储
  * 会话令牌是 32 字节随机串，数据库只存它的 SHA-256，泄库也无法直接冒用
  * 令牌比对用 hmac.compare_digest，防时序侧信道
  * 登录失败按"用户名 + IP"计数，5 次/5 分钟触发退避，防暴力破解
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import re
import secrets
import threading
import time

import db

ITERATIONS = 200_000
SESSION_TTL = 30 * 24 * 3600          # 30 天
SESSION_TTL_REMEMBER = 180 * 24 * 3600  # 勾选"记住我"180 天
SESSION_COOKIE = 'ec_session'

USERNAME_RE = re.compile(r'^[A-Za-z][A-Za-z0-9_\-]{2,23}$')
EMAIL_RE = re.compile(r'^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$')

_fail_lock = threading.Lock()
_failures: dict[str, list] = {}
FAIL_LIMIT_USER = 5      # 同一账号连续失败 5 次 → 锁 5 分钟
FAIL_LIMIT_IP = 30       # 同一 IP 失败 30 次 → 锁 5 分钟（阈值放宽，避免误伤共用出口）
FAIL_WINDOW = 300


# ---------------------------------------------------------------- 密码

def hash_password(password: str, salt: bytes | None = None, iterations: int = ITERATIONS):
    salt = salt or secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, iterations)
    return (base64.b64encode(dk).decode(),
            base64.b64encode(salt).decode(),
            iterations)


def verify_password(password: str, pass_hash: str, salt_b64: str, iterations: int) -> bool:
    try:
        salt = base64.b64decode(salt_b64)
        dk = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, int(iterations))
    except Exception:
        return False
    return hmac.compare_digest(base64.b64encode(dk).decode(), pass_hash)


def username_problem(username: str) -> str | None:
    if not username:
        return '请填写用户名'
    if not USERNAME_RE.match(username):
        return '用户名需以字母开头，3~24 位，只能用字母、数字、下划线、连字符'
    return None


def password_problem(password: str) -> str | None:
    if not password or len(password) < 8:
        return '密码至少 8 位'
    if len(password) > 128:
        return '密码太长（最多 128 位）'
    if not re.search(r'[A-Za-z]', password) or not re.search(r'\d', password):
        return '密码需要同时包含字母和数字'
    if password.lower() in ('12345678', 'password', 'abc12345', 'qwerty123', 'a1234567'):
        return '这个密码太常见了，换一个'
    return None


def email_problem(email: str) -> str | None:
    if email and not EMAIL_RE.match(email):
        return '邮箱格式不正确'
    return None


# ---------------------------------------------------------------- 会话

def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode('utf-8')).hexdigest()


def create_session(user_id: int, ua: str = '', ip: str = '', remember: bool = False) -> tuple[str, int]:
    token = secrets.token_urlsafe(32)
    now = int(time.time())
    ttl = SESSION_TTL_REMEMBER if remember else SESSION_TTL
    db.execute(
        'INSERT INTO sessions(token_hash, user_id, created_at, expires_at, last_seen, ua, ip) '
        'VALUES(?,?,?,?,?,?,?)',
        (_token_hash(token), user_id, now, now + ttl, now, (ua or '')[:200], (ip or '')[:64]))
    return token, now + ttl


def user_for_token(token: str):
    if not token:
        return None
    row = db.one(
        'SELECT s.token_hash, s.expires_at, s.last_seen, u.* FROM sessions s '
        'JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?', (_token_hash(token),))
    if row is None:
        return None
    if row['expires_at'] < int(time.time()):
        revoke(token)
        return None
    if row['disabled']:
        return None
    # 滑动续期：超过 1 天没活动才写库，避免每个请求都写
    now = int(time.time())
    if now - row['last_seen'] > 86400:
        db.execute('UPDATE sessions SET last_seen = ? WHERE token_hash = ?',
                   (now, row['token_hash']))
    return row


def revoke(token: str) -> None:
    if token:
        db.execute('DELETE FROM sessions WHERE token_hash = ?', (_token_hash(token),))


def revoke_all(user_id: int) -> None:
    db.execute('DELETE FROM sessions WHERE user_id = ?', (user_id,))


# ---------------------------------------------------------------- 登录限流

def _prune(now: float) -> None:
    for k in list(_failures.keys()):
        if now - _failures[k][1] > FAIL_WINDOW:
            _failures.pop(k, None)


def login_blocked(username: str, ip: str) -> int:
    """返回还需等待的秒数，0 表示可以尝试。账号阈值严、IP 阈值宽。"""
    now = time.time()
    with _fail_lock:
        _prune(now)
        wait = 0
        for k, limit in ((f'u:{username.lower()}', FAIL_LIMIT_USER), (f'i:{ip}', FAIL_LIMIT_IP)):
            rec = _failures.get(k)
            if rec and rec[0] >= limit:
                wait = max(wait, int(FAIL_WINDOW - (now - rec[1])))
        return max(0, wait)


def record_login_failure(username: str, ip: str) -> None:
    now = time.time()
    with _fail_lock:
        for k in (f'u:{username.lower()}', f'i:{ip}'):
            rec = _failures.get(k)
            if rec is None or now - rec[1] > FAIL_WINDOW:
                _failures[k] = [1, now]
            else:
                rec[0] += 1
                rec[1] = now


def clear_login_failures(username: str) -> None:
    """登录成功后只清该账号的计数（不清 IP，防止攻击者用小号刷掉 IP 计数）。"""
    with _fail_lock:
        _failures.pop(f'u:{username.lower()}', None)


# ---------------------------------------------------------------- 用户

def public_user(row) -> dict:
    return {
        'id': row['id'],
        'username': row['username'],
        'email': row['email'] or '',
        'nickname': row['nickname'] or row['username'],
        'target': row['target'],
        'dailyMinutes': row['daily_minutes'],
        'examDate': row['exam_date'] or '',
        'stage': row['stage'],
        'createdAt': row['created_at'],
        'lastLogin': row['last_login'],
        'isAdmin': bool(row['is_admin']),
    }
