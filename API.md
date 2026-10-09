# API 文档 · 英语提分教练 全栈版 v1.0

- 基础地址：`http://127.0.0.1:8788`
- 全部接口都在 `/api/` 下，请求与响应都是 JSON（UTF-8）
- 认证：登录/注册成功后，服务端下发 **HttpOnly Cookie**（`ec_session`，`SameSite=Strict`）
- 同时返回 `token` 字段，可用于 `Authorization: Bearer <token>`（便于脚本/未来移动端）
- **CSRF**：使用 Cookie 认证时，写操作（POST/PUT/PATCH/DELETE）必须带 `X-Requested-With` 头；
  使用 Bearer 认证则不需要
- 错误响应统一为：`{"error": "中文说明", "code": "错误码"}`

## 错误码

| HTTP | code | 含义 |
|---|---|---|
| 400 | invalid_input / bad_json | 参数不合法 |
| 401 | unauthorized / bad_credentials | 未登录 / 用户名或密码错误 |
| 403 | forbidden / csrf | 无权限 / 缺少 CSRF 头 |
| 404 | not_found | 接口或文件不存在 |
| 405 | method_not_allowed | 方法不允许 |
| 409 | username_taken / email_taken / version_conflict | 用户名邮箱占用 / 进度版本冲突 |
| 413 | too_large | 请求体过大 |
| 429 | rate_limited | 登录尝试过于频繁 |
| 500 | internal | 服务器内部错误 |

---

## 认证

### POST /api/auth/register
```json
{ "username": "alice", "password": "study2026", "email": "a@b.com", "nickname": "小艾" }
```
- 用户名：字母开头，3~24 位，允许字母数字下划线连字符
- 密码：≥8 位且同时包含字母和数字
- `email` 可空；第一个注册的用户自动成为管理员
- 返回 `201 { user, token, expiresAt, isNewUser }`

### POST /api/auth/login
```json
{ "username": "alice 或邮箱", "password": "study2026", "remember": true }
```
- `remember=true` 会话 180 天，否则 30 天
- 返回 `200 { user, token, expiresAt }`

### POST /api/auth/logout
清除 Cookie 并使当前会话失效 → `200 { ok: true }`

### POST /api/auth/password
```json
{ "oldPassword": "study2026", "newPassword": "newpass2027" }
```
改密成功后会**注销该账号所有设备的会话**并返回新 token。

### GET /api/me
返回当前用户与云端进度版本：`{ user, progress: { version, updatedAt } | null }`

### PATCH /api/me
```json
{ "nickname": "小艾", "target": "cet6", "dailyMinutes": 55, "examDate": "2027-06-10" }
```
`target` 必须是 `basic|ab|cet4|cet6|ielts`；`dailyMinutes` 范围 5~600。

---

## 学习进度

### GET /api/progress
```json
{ "version": 3, "updatedAt": 1791437597161, "state": { ...完整学习状态... } }
```
新用户返回 `{ "version": 0, "state": null }`。

### PUT /api/progress
```json
{ "state": { ... }, "baseVersion": 3 }
```
- 成功 → `200 { version: 4, updatedAt, newAchievements: [...] }`
- `baseVersion` 与服务器当前版本不一致 → `409`
  ```json
  { "error": "这份进度在别处更新过，需要合并", "code": "version_conflict",
    "version": 5, "state": { ...服务器端状态... } }
  ```
  客户端应自行合并后，用 `baseVersion = version` 重新推送。
- 单次请求体上限 4MB

**state 结构（前端引擎的数据模型）**

| 字段 | 说明 |
|---|---|
| `profile` | 昵称、目标档位、每日时长等 |
| `stage` / `unlocked` | 当前阶段 / 已解锁阶段 |
| `skills` | 各阶段五模块掌握度（服务端会用合并后的记录重算） |
| `words` | 单词记忆卡：`{ reps, lapses, ease, rung, int, due, status, correct, wrong }` |
| `grammar` / `listening` / `reading` / `writing` / `dictation` | 各模块练习记录 |
| `errors` | 错题本（最多 400 条） |
| `sessions` | 学习流水（最多 500 条） |
| `days` | 每日统计 `{ "YYYY-MM-DD": { minutes, items, correct, byModule } }` |
| `plan` / `roundIndex` | 当前学习计划与轮次 |
| `wordbook` | 生词本 |

---

## 统计与激励

### GET /api/stats
```json
{
  "totalDays": 12, "totalMinutes": 540, "totalItems": 1080, "totalCorrect": 900,
  "accuracy": 0.833, "firstDay": "2026-09-27", "lastDay": "2026-10-08",
  "bestDay": { "day": "2026-10-05", "minutes": 75 },
  "streak": 6, "longestStreak": 9,
  "byModule": { "vocab": {"minutes":300,"items":600,"correct":520}, "...": {} },
  "progressVersion": 7, "progressUpdatedAt": 1791...
}
```

### GET /api/stats/calendar?days=120
```json
{ "days": [ { "day": "2026-10-08", "minutes": 45, "items": 90, "correct": 80 } ], "streak": 6 }
```
`days` 范围 7~365，按日期升序返回（含没有学习记录的 0 值日期，便于直接画热力图）。

### GET /api/leaderboard?type=today|total|streak&limit=20
```json
{ "type": "today", "day": "2026-10-08", "myRank": 3,
  "items": [ { "userId": 1, "name": "小明", "stage": "basic",
               "minutes": 45, "items": 90, "accuracy": 0.9, "streak": 6 } ] }
```
`myRank` 为你自己的排名（不在前 N 名时为 `null`）。

### GET /api/achievements
```json
{ "unlockedCount": 3, "total": 15,
  "achievements": [ { "code": "first_step", "name": "迈出第一步", "desc": "...",
                      "icon": "🌱", "unlocked": true, "unlockedAt": 1791... } ] }
```

15 个成就：`first_step` `streak_3` `streak_7` `streak_30` `words_100` `words_300` `words_1000`
`stage_ab` `stage_cet4` `stage_cet6` `stage_ielts` `accuracy_90` `writing_10` `minutes_600` `allrounder`

---

## 其他

### GET /api/health
```json
{ "ok": true, "version": "1.0.0", "uptime": 3600, "users": 2 }
```
前端用它判断"后端是否可用"，决定显示「☁️ 已同步」还是「☁️ 本机模式」。

### GET /api/admin/users
仅管理员可访问，返回用户列表（最多 200 条）。非管理员 → `403`。

---

## 静态资源

`/` → `web/index.html`，其余按 `web/` 目录直接托管。
- 已做目录穿越防护（`../` 一律 403）
- HTML/JS/CSS 用 `ETag` + `Cache-Control: no-cache`，改代码刷新即生效
- 响应头带 `X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`、
  `Referrer-Policy: no-referrer`，HTML 额外带 CSP

## curl 示例

```bash
# 健康检查
curl http://127.0.0.1:8788/api/health

# 注册（保存 Cookie）
curl -c jar.txt -H "Content-Type: application/json" -H "X-Requested-With: fetch" \
     -d "{\"username\":\"alice\",\"password\":\"study2026\"}" \
     http://127.0.0.1:8788/api/auth/register

# 拉取进度
curl -b jar.txt http://127.0.0.1:8788/api/progress

# 推送进度
curl -b jar.txt -X PUT -H "Content-Type: application/json" -H "X-Requested-With: fetch" \
     -d "{\"state\":{},\"baseVersion\":0}" http://127.0.0.1:8788/api/progress

# 排行榜
curl -b jar.txt "http://127.0.0.1:8788/api/leaderboard?type=total&limit=10"
```

## v1.1 新增接口

| 方法 | 路径 | 认证 | 说明 |
|---|---|---|---|
| GET | `/api/config` | 无 | 注册策略：`{registrationOpen, inviteRequired, users}`，注册页据此渲染 |
| GET | `/api/share` | 无 | 局域网地址列表 + 二维码 SVG：`{urls:[...], qr:"<svg…>"}` |
| GET | `/api/admin/settings` | 管理员 | 读取注册策略 `{registrationOpen, inviteCode}` |
| PUT | `/api/admin/settings` | 管理员 | 修改注册策略，body：`{registrationOpen:bool, inviteCode:string}` |

注册接口 `POST /api/auth/register` 新增可选字段：
`target`（目标档位）、`dailyMinutes`（每日时长 5~600）、`examDate`、`inviteCode`（需要邀请码时必填）。
注册行为受策略控制：关闭时返回 403 `registration_closed`；邀请码错误返回 403 `bad_invite`；
同 IP 每小时超过 20 次返回 429 `rate_limited`。
