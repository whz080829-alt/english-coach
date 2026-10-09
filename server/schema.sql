-- 英语提分教练 · 全栈版 数据库结构（SQLite）
-- 设计要点：
--   1) users          账号与个人设置（目标档位、每日时长等）
--   2) sessions       登录会话（只存 token 的 SHA-256，泄库也无法直接冒用）
--   3) progress       每个用户一份完整学习状态（JSON），带版本号用于并发冲突检测
--   4) daily_stats    从 progress 派生的每日汇总，用于排行榜/日历（避免每次全表解析 JSON）
--   5) achievements   成就解锁记录
--   6) events         审计与留痕（登录、同步、异常）

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL COLLATE NOCASE,
    email         TEXT    COLLATE NOCASE,
    pass_hash     TEXT    NOT NULL,
    salt          TEXT    NOT NULL,
    iterations    INTEGER NOT NULL DEFAULT 200000,
    nickname      TEXT    NOT NULL DEFAULT '',
    target        TEXT    NOT NULL DEFAULT 'cet4',
    daily_minutes INTEGER NOT NULL DEFAULT 40,
    exam_date     TEXT    NOT NULL DEFAULT '',
    stage         TEXT    NOT NULL DEFAULT 'basic',
    created_at    INTEGER NOT NULL,
    last_login    INTEGER,
    is_admin      INTEGER NOT NULL DEFAULT 0,
    disabled      INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL AND email <> '';

CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT    PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    last_seen  INTEGER NOT NULL,
    ua         TEXT    NOT NULL DEFAULT '',
    ip         TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_exp  ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS progress (
    user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    version    INTEGER NOT NULL DEFAULT 1,
    updated_at INTEGER NOT NULL,
    bytes      INTEGER NOT NULL DEFAULT 0,
    state_json TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_stats (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day        TEXT    NOT NULL,              -- YYYY-MM-DD（本地日期）
    minutes    INTEGER NOT NULL DEFAULT 0,
    items      INTEGER NOT NULL DEFAULT 0,
    correct    INTEGER NOT NULL DEFAULT 0,
    by_module  TEXT    NOT NULL DEFAULT '{}', -- {"vocab":{"items":n,"correct":m,"minutes":t},...}
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, day)
);
CREATE INDEX IF NOT EXISTS idx_daily_day     ON daily_stats(day, minutes DESC);
CREATE INDEX IF NOT EXISTS idx_daily_user    ON daily_stats(user_id, day DESC);

CREATE TABLE IF NOT EXISTS achievements (
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code        TEXT    NOT NULL,
    unlocked_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, code)
);

CREATE TABLE IF NOT EXISTS events (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    ts      INTEGER NOT NULL,
    type    TEXT    NOT NULL,
    payload TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_events_user ON events(user_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type, ts DESC);

-- 站点级设置（开放注册开关、邀请码等），由管理员在「我的 → 用户管理」里调整
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
