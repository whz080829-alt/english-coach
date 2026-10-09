# 英语提分教练 · 全栈版 —— 部署说明

这个包里是**完整的前端 + 后端 + 数据库**（Word/语法/听力/阅读/作文，账号、云同步、排行榜、打卡、成就）。

**零第三方依赖**：只用 Python 标准库，所以不需要 `pip install` 任何东西。

```
server/    后端（app.py 服务、api.py 接口、auth.py 认证、db.py 数据库、schema.sql 建表）
web/       前端（index.html + assets + 诊断.html + PWA 清单）
Dockerfile / render.yaml / start.sh   云端部署用
```

---

## 一、先搞清楚你要哪种"链接"

| 目标 | 用哪种 | 成本 | 手机能用吗 |
|---|---|---|---|
| 自己手机/平板用 | **局域网**（电脑上跑，手机连同一 Wi-Fi） | 0 | ✅ 同 Wi-Fi 内 |
| 发给同学、或**上传给平台生成 App** | **公网 HTTPS 部署**（下面第三节） | 有免费档 | ✅ 任何网络 |
| 临时演示给别人看 | 内网穿透隧道 | 0 | ✅ 临时地址 |

> ⚠️ **重要**：想"上传生成 App"（打成安装包）必须给平台一个**公网 HTTPS 地址**。
> 因为 App 装到手机上以后，要能随时连上你的服务器 —— `127.0.0.1` 和局域网 `192.168.x.x` 都不行。

---

## 二、局域网（最快，零成本）

1. 双击包里的 `启动服务器.cmd`（Windows），或执行 `sh start.sh`（Mac/Linux）
2. 它监听 `0.0.0.0:8788`，并在窗口里打印局域网地址
3. 手机连**同一个 Wi-Fi**，浏览器打开 `http://<电脑IP>:8788/index.html`
4. 页面里「设置 → 安装到手机/电脑」有二维码，直接扫码即可

首次启动如果弹 Windows 防火墙提示，要选**允许访问**（专用网络）。

---

## 三、部署到公网（拿到能上传生成 App 的链接）

### 方案 A：Render（有 Docker + 持久磁盘，最省心）

1. 注册 https://render.com
2. 把这个包推到你的 GitHub 仓库
3. Render → **New → Blueprint** → 选这个仓库（它会读 `render.yaml`）
4. 等 2-3 分钟，拿到形如 `https://english-coach-xxxx.onrender.com` 的地址

> **注意**：SQLite 是文件数据库，**必须要持久磁盘**。Render 免费档没有磁盘，容器一重启数据就没了 ——
> 想长期用就把 `render.yaml` 里的 `plan` 设成 `starter`（约 $7/月）。

### 方案 B：Railway / Fly.io

- Railway：New Project → Deploy from GitHub，加一个 Volume 挂到 `/data`
- Fly.io：`fly launch`（识别 Dockerfile）→ `fly volumes create coach_data --size 1` → 在 `fly.toml` 里挂到 `/data`

两者的关键点都一样：**把 `/data` 挂成持久卷**，数据库会自动建在 `/data/coach.db`。

### 方案 C：自己的 VPS / 宝塔面板

```bash
# 上传解压后
EC_DB=/var/lib/english-coach/coach.db PORT=80 sh start.sh
# 想让进程常驻，用 systemd 或 pm2
```

---

## 四、部署好之后

- 打开 `https://你的地址/index.html`
- **第一个注册的账号自动成为管理员**（可以开关注册、看所有用户）
- 因为是 HTTPS，手机上「添加到主屏幕」就是**完整的 PWA**：独立图标 + 全屏 + 离线缓存
- 把这个地址填进任何"网址转 App"的平台，就能生成安卓安装包（APK）
  - 生成的 App 本质是个浏览器外壳，**账号与云同步照样能用**，因为数据在后端
  - 想连 Apple 设备：用 Safari 打开 → 分享 → 添加到主屏幕，效果等同原生 App

---

## 五、常见问题

**Q：能不用 Docker 吗？**
能。只要 Python 3.9+，直接 `sh start.sh` 或
`python server/app.py --host 0.0.0.0 --port 8788 --db /data/coach.db`。

**Q：数据存在哪？**
一个 SQLite 文件（默认 `/data/coach.db`）。备份就是复制这个文件。

**Q：支持多少用户？**
单文件 SQLite + 多线程 HTTP 服务，几十到几百人的学习类应用完全够用。
真要上千人再换 PostgreSQL（改 `server/db.py` 即可，接口是隔离的）。

**Q：为什么不用现成的静态托管（Vercel/Netlify/对象存储）？**
因为它只托管静态文件，**跑不了 Python 后端**，账号和云同步会失效 ——
那种方式只能用离线单文件版（`英语提分教练-单文件版.html`）。
