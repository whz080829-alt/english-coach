"""业务接口实现。所有函数返回 (http_status, payload_dict)。"""
from __future__ import annotations

import json
import socket
import threading
import time

import auth
import db

MAX_STATE_BYTES = 4 * 1024 * 1024
MODULES = ('vocab', 'grammar', 'listening', 'reading', 'writing')
STAGES = ('basic', 'ab', 'cet4', 'cet6', 'ielts')


class ApiError(Exception):
    def __init__(self, status: int, message: str, code: str = 'error'):
        super().__init__(message)
        self.status = status
        self.message = message
        self.code = code


def _now() -> int:
    return int(time.time() * 1000)


def _require_user(ctx):
    if not ctx.get('user'):
        raise ApiError(401, '请先登录', 'unauthorized')
    return ctx['user']


def _s(body, key, default=None):
    v = body.get(key, default)
    return v.strip() if isinstance(v, str) else v


# ------------------------------------------------------------------ 站点设置（注册策略）

DEFAULT_REGISTRATION_OPEN = '1'     # 默认开放注册：任何人都可以创建账号
DEFAULT_INVITE_CODE = ''            # 为空表示不需要邀请码


def _get_setting(key: str, default: str = '') -> str:
    try:
        row = db.one('SELECT value FROM settings WHERE key = ?', (key,))
    except Exception:
        row = None
    return row['value'] if row else default


def _set_setting(key: str, value: str) -> None:
    with db.Tx() as conn:
        conn.execute('INSERT INTO settings(key, value) VALUES(?,?) '
                     'ON CONFLICT(key) DO UPDATE SET value=excluded.value', (key, value))


# 注册限流：防止公网/局域网内被脚本刷号（内存计数，重启即清零）
_reg_lock = threading.Lock()
_reg_attempts: dict[str, list] = {}      # ip -> [count, window_start]
REG_LIMIT_PER_HOUR = 20


def _register_wait(ip: str) -> int:
    now = time.time()
    with _reg_lock:
        rec = _reg_attempts.get(ip)
        if rec and now - rec[1] > 3600:
            rec = None
        if rec and rec[0] >= REG_LIMIT_PER_HOUR:
            return max(1, int(3600 - (now - rec[1])))
        return 0


def _record_register(ip: str) -> None:
    now = time.time()
    with _reg_lock:
        rec = _reg_attempts.get(ip)
        if rec is None or now - rec[1] > 3600:
            _reg_attempts[ip] = [1, now]
        else:
            rec[0] += 1


def get_config(body, ctx):
    """公开接口：注册页据此渲染表单。"""
    invite = (_get_setting('invite_code', DEFAULT_INVITE_CODE) or '').strip()
    return 200, {
        'registrationOpen': _get_setting('registration_open', DEFAULT_REGISTRATION_OPEN) == '1',
        'inviteRequired': bool(invite),
        'users': db.scalar('SELECT COUNT(*) FROM users'),
    }


def get_share(body, ctx):
    """公开接口：返回手机可访问的地址与二维码（SVG）。"""
    ips = _lan_ips()
    host = ctx.get('host') or ''
    port = 8788
    if host and ':' in host:
        try:
            port = int(host.rsplit(':', 1)[1])
        except Exception:
            pass
    urls = ['http://%s:%d/index.html' % (ip, port) for ip in ips]
    qr = None
    if urls:
        try:
            qr = _qr_svg(urls[0])
        except Exception:
            qr = None
    return 200, {'urls': urls, 'qr': qr, 'port': port}


def _lan_ips() -> list:
    """枚举本机局域网 IPv4（主出口在前）。"""
    ips: list = []

    def add(ip: str):
        if ip and not ip.startswith('127.') and ':' not in ip and ip not in ips:
            ips.append(ip)

    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.settimeout(0.5)
            s.connect(('223.5.5.5', 80))
            add(s.getsockname()[0])
        finally:
            s.close()
    except Exception:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            add(info[4][0])
    except Exception:
        pass
    return ips


def _qr_svg(text: str) -> str:
    """二维码转 SVG 字符串（vendor/qrcode，纯 Python）。"""
    import qrcode
    q = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, border=2, box_size=1)
    q.add_data(text)
    q.make(fit=True)
    m = q.get_matrix()
    n = len(m)
    path = ''.join('M%d %dh1v1h-1z' % (x, y)
                   for y, row in enumerate(m) for x, v in enumerate(row) if v)
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" '
            'shape-rendering="crispEdges"><rect width="%d" height="%d" fill="#fff"/>'
            '<path d="%s" fill="#111"/></svg>' % (n, n, n, n, path))


# ------------------------------------------------------------------ 认证

def register(body, ctx):
    username = _s(body, 'username', '') or ''
    password = body.get('password') or ''
    email = _s(body, 'email', '') or ''
    nickname = _s(body, 'nickname', '') or ''

    # ---- 注册策略：是否开放、是否需要邀请码、按 IP 限流 ----
    if _get_setting('registration_open', DEFAULT_REGISTRATION_OPEN) != '1':
        raise ApiError(403, '当前没有开放注册，请联系管理员开通', 'registration_closed')
    invite = (_get_setting('invite_code', DEFAULT_INVITE_CODE) or '').strip()
    if invite:
        code = (_s(body, 'inviteCode', '') or '').strip()
        if code.upper() != invite.upper():
            raise ApiError(403, '邀请码不正确', 'bad_invite')
    ip = ctx.get('ip', '')
    wait = _register_wait(ip)
    if wait > 0:
        raise ApiError(429, f'注册太频繁，请 {wait} 秒后再试', 'rate_limited')

    for problem in (auth.username_problem(username), auth.password_problem(password),
                    auth.email_problem(email)):
        if problem:
            raise ApiError(400, problem, 'invalid_input')

    # ---- 个性化档案（注册时即可收集，为空则用默认值）----
    target = _s(body, 'target')
    if target is not None and target not in STAGES:
        raise ApiError(400, '目标档位不合法', 'invalid_input')
    daily_minutes = None
    if body.get('dailyMinutes') is not None:
        try:
            daily_minutes = int(body.get('dailyMinutes'))
        except Exception:
            raise ApiError(400, '每日时长必须是数字', 'invalid_input')
        if not 5 <= daily_minutes <= 600:
            raise ApiError(400, '每日时长需在 5~600 分钟之间', 'invalid_input')
    exam_date = (_s(body, 'examDate') or '')[:20]

    if db.one('SELECT id FROM users WHERE username = ?', (username,)):
        raise ApiError(409, '这个用户名已经被注册了', 'username_taken')
    if email and db.one('SELECT id FROM users WHERE email = ?', (email,)):
        raise ApiError(409, '这个邮箱已经被注册了', 'email_taken')

    pass_hash, salt, iters = auth.hash_password(password)
    now = int(time.time())
    # 第一个注册的用户自动成为管理员（本地自用场景，省去初始化脚本）
    is_admin = 1 if db.scalar('SELECT COUNT(*) FROM users') == 0 else 0
    user_id = db.execute(
        'INSERT INTO users(username, email, pass_hash, salt, iterations, nickname, '
        'target, daily_minutes, exam_date, created_at, last_login, is_admin) '
        'VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
        (username, email or None, pass_hash, salt, iters,
         nickname or username, target or 'cet4', daily_minutes or 40, exam_date,
         now, now, is_admin))
    _record_register(ip)
    db.log_event(user_id, 'register', {'username': username, 'ip': ip})

    token, expires = auth.create_session(user_id, ctx.get('ua', ''), ctx.get('ip', ''))
    row = db.one('SELECT * FROM users WHERE id = ?', (user_id,))
    return 201, {
        'user': auth.public_user(row),
        'token': token,
        'expiresAt': expires,
        'isNewUser': True,
    }


def login(body, ctx):
    username = _s(body, 'username', '') or ''
    password = body.get('password') or ''
    remember = bool(body.get('remember'))
    ip = ctx.get('ip', '')

    wait = auth.login_blocked(username, ip)
    if wait > 0:
        raise ApiError(429, f'尝试次数过多，请 {wait} 秒后再试', 'rate_limited')

    row = db.one('SELECT * FROM users WHERE username = ? OR email = ?', (username, username))
    if row is None or row['disabled']:
        auth.record_login_failure(username, ip)
        db.log_event(row['id'] if row else None, 'login_fail', {'username': username, 'ip': ip})
        raise ApiError(401, '用户名或密码不对', 'bad_credentials')

    if not auth.verify_password(password, row['pass_hash'], row['salt'], row['iterations']):
        auth.record_login_failure(username, ip)
        db.log_event(row['id'], 'login_fail', {'username': username, 'ip': ip})
        raise ApiError(401, '用户名或密码不对', 'bad_credentials')

    auth.clear_login_failures(username)
    db.execute('UPDATE users SET last_login = ? WHERE id = ?', (int(time.time()), row['id']))
    token, expires = auth.create_session(row['id'], ctx.get('ua', ''), ip, remember=remember)
    db.log_event(row['id'], 'login', {'ip': ip})
    row = db.one('SELECT * FROM users WHERE id = ?', (row['id'],))
    return 200, {'user': auth.public_user(row), 'token': token, 'expiresAt': expires}


def logout(ctx):
    if ctx.get('token'):
        auth.revoke(ctx['token'])
    return 200, {'ok': True}


def me(ctx):
    user = _require_user(ctx)
    row = db.one('SELECT * FROM users WHERE id = ?', (user['id'],))
    prog = db.one('SELECT version, updated_at FROM progress WHERE user_id = ?', (user['id'],))
    return 200, {
        'user': auth.public_user(row),
        'progress': {'version': prog['version'], 'updatedAt': prog['updated_at']} if prog else None,
    }


def update_me(body, ctx):
    user = _require_user(ctx)
    sets, args = [], []
    nickname = _s(body, 'nickname')
    if nickname is not None:
        if len(nickname) > 24:
            raise ApiError(400, '昵称最多 24 个字', 'invalid_input')
        sets.append('nickname = ?'); args.append(nickname)
    target = _s(body, 'target')
    if target is not None:
        if target not in STAGES:
            raise ApiError(400, '目标档位不合法', 'invalid_input')
        sets.append('target = ?'); args.append(target)
    dm = body.get('dailyMinutes')
    if dm is not None:
        try:
            dm = int(dm)
        except Exception:
            raise ApiError(400, '每日时长必须是数字', 'invalid_input')
        if not 5 <= dm <= 600:
            raise ApiError(400, '每日时长需在 5~600 分钟之间', 'invalid_input')
        sets.append('daily_minutes = ?'); args.append(dm)
    ed = _s(body, 'examDate')
    if ed is not None:
        sets.append('exam_date = ?'); args.append(ed[:20])
    if not sets:
        raise ApiError(400, '没有需要更新的字段', 'invalid_input')
    args.append(user['id'])
    with db.Tx() as conn:
        conn.execute('UPDATE users SET ' + ', '.join(sets) + ' WHERE id = ?', args)
    row = db.one('SELECT * FROM users WHERE id = ?', (user['id'],))
    return 200, {'user': auth.public_user(row)}


def change_password(body, ctx):
    user = _require_user(ctx)
    old = body.get('oldPassword') or ''
    new = body.get('newPassword') or ''
    if not auth.verify_password(old, user['pass_hash'], user['salt'], user['iterations']):
        raise ApiError(400, '原密码不对', 'bad_credentials')
    problem = auth.password_problem(new)
    if problem:
        raise ApiError(400, problem, 'invalid_input')
    if old == new:
        raise ApiError(400, '新密码不能和原密码相同', 'invalid_input')
    pass_hash, salt, iters = auth.hash_password(new)
    with db.Tx() as conn:
        conn.execute('UPDATE users SET pass_hash=?, salt=?, iterations=? WHERE id=?',
                     (pass_hash, salt, iters, user['id']))
        conn.execute('DELETE FROM sessions WHERE user_id = ?', (user['id'],))
    token, expires = auth.create_session(user['id'], ctx.get('ua', ''), ctx.get('ip', ''))
    db.log_event(user['id'], 'password_changed', {'ip': ctx.get('ip')})
    return 200, {'ok': True, 'token': token, 'expiresAt': expires,
                 'message': '密码已修改，其它设备的登录已全部退出'}


# ------------------------------------------------------------------ 进度同步

def _validate_state(state):
    if not isinstance(state, dict):
        raise ApiError(400, '数据格式不对', 'invalid_state')
    for k in ('words', 'sessions', 'errors', 'days'):
        if k in state and not isinstance(state[k], dict if k in ('words', 'days') else list):
            raise ApiError(400, f'字段 {k} 类型不对', 'invalid_state')
    # 简单体量保护，防止恶意/异常数据撑爆数据库
    if len(state.get('words') or {}) > 50000:
        raise ApiError(413, '单词记录过多', 'too_large')
    for k, cap in (('sessions', 20000), ('errors', 20000)):
        if len(state.get(k) or []) > cap:
            state[k] = state[k][:cap]
    return state


def get_progress(ctx):
    user = _require_user(ctx)
    row = db.one('SELECT version, updated_at, state_json FROM progress WHERE user_id = ?', (user['id'],))
    if row is None:
        return 200, {'version': 0, 'updatedAt': 0, 'state': None}
    return 200, {'version': row['version'], 'updatedAt': row['updated_at'],
                 'state': json.loads(row['state_json'])}


def put_progress(body, ctx):
    user = _require_user(ctx)
    state = _validate_state(body.get('state'))
    base_version = body.get('baseVersion')
    try:
        base_version = int(base_version)
    except Exception:
        base_version = 0

    payload = json.dumps(state, ensure_ascii=False, separators=(',', ':'))
    if len(payload.encode('utf-8')) > MAX_STATE_BYTES:
        raise ApiError(413, '学习数据过大', 'too_large')

    now = _now()
    with db.Tx() as conn:
        row = conn.execute('SELECT version, state_json FROM progress WHERE user_id = ?',
                           (user['id'],)).fetchone()
        current = row['version'] if row else 0
        if row is not None and base_version != current:
            # 冲突：把服务器版本原样返回，由前端做合并
            return 409, {'error': 'version_conflict', 'code': 'version_conflict',
                         'message': '这份进度在别处更新过，需要合并',
                         'version': current, 'state': json.loads(row['state_json'])}
        version = current + 1
        conn.execute(
            'INSERT INTO progress(user_id, version, updated_at, bytes, state_json) '
            'VALUES(?,?,?,?,?) '
            'ON CONFLICT(user_id) DO UPDATE SET version=excluded.version, '
            'updated_at=excluded.updated_at, bytes=excluded.bytes, state_json=excluded.state_json',
            (user['id'], version, now, len(payload), payload))
        _sync_daily_stats(conn, user['id'], state, now)
        stage = state.get('stage')
        if stage in STAGES:
            conn.execute('UPDATE users SET stage = ? WHERE id = ?', (stage, user['id']))
        unlocked = _grant_achievements(conn, user['id'], state)

    return 200, {'version': version, 'updatedAt': now, 'newAchievements': unlocked}


def _sync_daily_stats(conn, user_id: int, state: dict, now: int) -> None:
    """从 state.days 派生每日汇总。只写入非零的天。"""
    days = state.get('days') or {}
    for day, rec in days.items():
        if not isinstance(rec, dict) or len(str(day)) != 10:
            continue
        minutes = int(rec.get('minutes') or 0)
        items = int(rec.get('items') or 0)
        correct = int(rec.get('correct') or 0)
        if minutes == 0 and items == 0:
            continue
        by_module = json.dumps(rec.get('byModule') or {}, ensure_ascii=False)[:4000]
        conn.execute(
            'INSERT INTO daily_stats(user_id, day, minutes, items, correct, by_module, updated_at) '
            'VALUES(?,?,?,?,?,?,?) '
            'ON CONFLICT(user_id, day) DO UPDATE SET minutes=excluded.minutes, items=excluded.items, '
            'correct=excluded.correct, by_module=excluded.by_module, updated_at=excluded.updated_at',
            (user_id, str(day), minutes, items, correct, by_module, now))


# ------------------------------------------------------------------ 成就

ACHIEVEMENTS = [
    ('first_step',   '迈出第一步', '完成第一次学习',        '🌱'),
    ('streak_3',     '坚持三天',   '连续学习 3 天',         '🔥'),
    ('streak_7',     '一周不断',   '连续学习 7 天',         '🔥'),
    ('streak_30',    '月度铁人',   '连续学习 30 天',        '🏆'),
    ('words_100',    '百词斩',     '累计学习 100 个单词',    '📖'),
    ('words_300',    '三百词库',   '累计学习 300 个单词',    '📚'),
    ('words_1000',   '千词达成',   '累计学习 1000 个单词',   '🗂️'),
    ('stage_ab',     'A/B级通关',  '晋级到 A/B 级',         '🎖️'),
    ('stage_cet4',   '四级通关',   '晋级到四级',            '🥉'),
    ('stage_cet6',   '六级通关',   '晋级到六级',            '🥈'),
    ('stage_ielts',  '雅思冲刺',   '晋级到雅思',            '🥇'),
    ('accuracy_90',  '神准一击',   '单次学习 ≥20 题且正确率 ≥90%', '🎯'),
    ('writing_10',   '笔耕不辍',   '完成 10 篇作文',         '✍️'),
    ('minutes_600',  '十小时',     '累计学习 10 小时',       '⏱️'),
    ('allrounder',   '五项全能',   '当前阶段五个模块掌握度都 ≥60%', '🧩'),
]

ACH_MAP = {a[0]: {'code': a[0], 'name': a[1], 'desc': a[2], 'icon': a[3]} for a in ACHIEVEMENTS}


def _streak(days: dict) -> int:
    """从 days（{YYYY-MM-DD: {...}}）算当前连续天数。"""
    import datetime
    have = {d for d, r in (days or {}).items()
            if isinstance(r, dict) and (r.get('items') or 0) > 0}
    if not have:
        return 0
    today = datetime.date.today()
    d = today
    if today.isoformat() not in have:
        d = today - datetime.timedelta(days=1)
    n = 0
    while d.isoformat() in have:
        n += 1
        d -= datetime.timedelta(days=1)
    return n


def _evaluate(state: dict) -> set:
    got = set()
    days = state.get('days') or {}
    words = state.get('words') or {}
    sessions = state.get('sessions') or []
    writing = state.get('writing') or {}
    stage = state.get('stage') or 'basic'

    if sessions or any((r or {}).get('items') for r in days.values()):
        got.add('first_step')
    s = _streak(days)
    if s >= 3:
        got.add('streak_3')
    if s >= 7:
        got.add('streak_7')
    if s >= 30:
        got.add('streak_30')

    nw = len(words)
    if nw >= 100:
        got.add('words_100')
    if nw >= 300:
        got.add('words_300')
    if nw >= 1000:
        got.add('words_1000')

    unlocked = set(state.get('unlocked') or [])
    order = list(STAGES)
    reached = set(unlocked) | {stage}
    for st in order[1:]:
        if st in reached:
            got.add('stage_' + st)

    for sess in sessions:
        items = int(sess.get('items') or 0)
        correct = int(sess.get('correct') or 0)
        if items >= 20 and items and correct / items >= 0.9:
            got.add('accuracy_90')
            break

    attempts = sum(int((v or {}).get('attempts') or 0) for v in writing.values())
    if len(writing) >= 10 or attempts >= 10:
        got.add('writing_10')

    total_min = sum(int((r or {}).get('minutes') or 0) for r in days.values())
    if total_min >= 600:
        got.add('minutes_600')

    skills = (state.get('skills') or {}).get(stage) or {}
    if skills and all(float(skills.get(m) or 0) >= 0.6 for m in MODULES):
        got.add('allrounder')
    return got


def _grant_achievements(conn, user_id: int, state: dict) -> list:
    got = _evaluate(state)
    have = {r['code'] for r in conn.execute(
        'SELECT code FROM achievements WHERE user_id = ?', (user_id,)).fetchall()}
    new = sorted(got - have)
    now = _now()
    for code in new:
        conn.execute('INSERT OR IGNORE INTO achievements(user_id, code, unlocked_at) VALUES(?,?,?)',
                     (user_id, code, now))
    return [dict(ACH_MAP[c], unlockedAt=now) for c in new if c in ACH_MAP]


def get_achievements(ctx):
    user = _require_user(ctx)
    rows = db.query('SELECT code, unlocked_at FROM achievements WHERE user_id = ?', (user['id'],))
    unlocked = {r['code']: r['unlocked_at'] for r in rows}
    out = []
    for code, name, desc, icon in ACHIEVEMENTS:
        out.append({'code': code, 'name': name, 'desc': desc, 'icon': icon,
                    'unlocked': code in unlocked, 'unlockedAt': unlocked.get(code)})
    return 200, {'achievements': out,
                 'unlockedCount': len(unlocked), 'total': len(ACHIEVEMENTS)}


# ------------------------------------------------------------------ 统计

def get_stats(ctx):
    user = _require_user(ctx)
    uid = user['id']
    row = db.one('SELECT COUNT(*) n, COALESCE(SUM(minutes),0) m, COALESCE(SUM(items),0) i, '
                 'COALESCE(SUM(correct),0) c, MIN(day) first, MAX(day) last '
                 'FROM daily_stats WHERE user_id = ?', (uid,))
    mod = {m: {'minutes': 0, 'items': 0, 'correct': 0} for m in MODULES}
    for r in db.query('SELECT by_module FROM daily_stats WHERE user_id = ?', (uid,)):
        try:
            bm = json.loads(r['by_module'] or '{}')
        except Exception:
            continue
        for k, v in (bm or {}).items():
            if k in mod and isinstance(v, dict):
                mod[k]['minutes'] += int(v.get('minutes') or 0)
                mod[k]['items'] += int(v.get('items') or 0)
                mod[k]['correct'] += int(v.get('correct') or 0)

    days = {r['day']: {'minutes': r['minutes'], 'items': r['items'], 'correct': r['correct']}
            for r in db.query('SELECT day, minutes, items, correct FROM daily_stats WHERE user_id = ?', (uid,))}
    best = max(days.items(), key=lambda kv: kv[1]['minutes'], default=(None, {'minutes': 0}))

    # 最长连续
    import datetime
    longest = cur = 0
    prev = None
    for day in sorted(days):
        try:
            d = datetime.date.fromisoformat(day)
        except Exception:
            continue
        if days[day]['items'] <= 0:
            continue
        cur = cur + 1 if prev and (d - prev).days == 1 else 1
        longest = max(longest, cur)
        prev = d

    prog = db.one('SELECT version, updated_at FROM progress WHERE user_id = ?', (uid,))
    return 200, {
        'totalDays': row['n'],
        'totalMinutes': row['m'],
        'totalItems': row['i'],
        'totalCorrect': row['c'],
        'accuracy': (row['c'] / row['i']) if row['i'] else 0,
        'firstDay': row['first'], 'lastDay': row['last'],
        'bestDay': {'day': best[0], 'minutes': best[1]['minutes']},
        'streak': _streak(days), 'longestStreak': longest,
        'byModule': mod,
        'progressVersion': prog['version'] if prog else 0,
        'progressUpdatedAt': prog['updated_at'] if prog else 0,
    }


def get_calendar(ctx):
    user = _require_user(ctx)
    qs = ctx.get('qs') or {}
    try:
        days = max(7, min(365, int(qs.get('days', ['120'])[0])))
    except Exception:
        days = 120
    import datetime
    start = (datetime.date.today() - datetime.timedelta(days=days - 1)).isoformat()
    rows = db.query('SELECT day, minutes, items, correct FROM daily_stats '
                    'WHERE user_id = ? AND day >= ? ORDER BY day', (user['id'], start))
    by_day = {r['day']: r for r in rows}
    out = []
    d = datetime.date.fromisoformat(start)
    today = datetime.date.today()
    while d <= today:
        k = d.isoformat()
        r = by_day.get(k)
        out.append({'day': k, 'minutes': r['minutes'] if r else 0,
                    'items': r['items'] if r else 0,
                    'correct': r['correct'] if r else 0})
        d += datetime.timedelta(days=1)
    return 200, {'days': out, 'streak': _streak({x['day']: {'items': x['items']} for x in out})}


def get_leaderboard(ctx):
    user = ctx.get('user')
    qs = ctx.get('qs') or {}
    kind = (qs.get('type', ['today'])[0] or 'today').lower()
    try:
        limit = max(3, min(100, int(qs.get('limit', ['20'])[0])))
    except Exception:
        limit = 20
    import datetime
    today = datetime.date.today().isoformat()

    if kind == 'today':
        rows = db.query(
            'SELECT u.id, u.username, u.nickname, u.stage, d.minutes, d.items, d.correct '
            'FROM daily_stats d JOIN users u ON u.id = d.user_id '
            'WHERE d.day = ? AND u.disabled = 0 ORDER BY d.minutes DESC, d.correct DESC LIMIT ?',
            (today, limit))
        items = [{'userId': r['id'], 'name': r['nickname'] or r['username'], 'stage': r['stage'],
                  'minutes': r['minutes'], 'items': r['items'],
                  'accuracy': (r['correct'] / r['items']) if r['items'] else 0} for r in rows]
    elif kind == 'total':
        rows = db.query(
            'SELECT u.id, u.username, u.nickname, u.stage, SUM(d.minutes) m, SUM(d.items) i, SUM(d.correct) c '
            'FROM daily_stats d JOIN users u ON u.id = d.user_id WHERE u.disabled = 0 '
            'GROUP BY u.id ORDER BY m DESC LIMIT ?', (limit,))
        items = [{'userId': r['id'], 'name': r['nickname'] or r['username'], 'stage': r['stage'],
                  'minutes': r['m'] or 0, 'items': r['i'] or 0,
                  'accuracy': ((r['c'] or 0) / r['i']) if r['i'] else 0} for r in rows]
    else:  # streak
        rows = db.query(
            'SELECT u.id, u.username, u.nickname, u.stage, d.day, d.minutes, d.items '
            'FROM daily_stats d JOIN users u ON u.id = d.user_id '
            'WHERE u.disabled = 0 AND d.items > 0 AND d.day >= ? ORDER BY u.id, d.day',
            ((datetime.date.today() - datetime.timedelta(days=400)).isoformat(),))
        per = {}
        for r in rows:
            per.setdefault(r['id'], {'name': r['nickname'] or r['username'], 'stage': r['stage'],
                                     'days': [], 'minutes': 0})['days'].append(r['day'])
            per[r['id']]['minutes'] += r['minutes']
        tmp = []
        for uid, v in per.items():
            have = set(v['days'])
            d = datetime.date.today()
            if d.isoformat() not in have:
                d -= datetime.timedelta(days=1)
            n = 0
            while d.isoformat() in have:
                n += 1
                d -= datetime.timedelta(days=1)
            tmp.append({'userId': uid, 'name': v['name'], 'stage': v['stage'],
                        'minutes': v['minutes'], 'streak': n, 'items': 0, 'accuracy': 0})
        items = sorted(tmp, key=lambda x: (-x['streak'], -x['minutes']))[:limit]

    my_rank = None
    if user:
        for i, it in enumerate(items, 1):
            if it['userId'] == user['id']:
                my_rank = i
                break
    return 200, {'type': kind, 'items': items, 'myRank': my_rank, 'day': today}


# ------------------------------------------------------------------ 管理

def admin_users(ctx):
    user = _require_user(ctx)
    if not user['is_admin']:
        raise ApiError(403, '需要管理员权限', 'forbidden')
    rows = db.query(
        'SELECT u.id, u.username, u.nickname, u.stage, u.created_at, u.last_login, u.disabled, '
        '(SELECT COUNT(*) FROM progress p WHERE p.user_id = u.id) has_progress '
        'FROM users u ORDER BY u.created_at DESC LIMIT 200')
    return 200, {'users': [dict(r) for r in rows],
                 'count': db.scalar('SELECT COUNT(*) FROM users')}


def admin_get_settings(ctx):
    user = _require_user(ctx)
    if not user['is_admin']:
        raise ApiError(403, '需要管理员权限', 'forbidden')
    return 200, {
        'registrationOpen': _get_setting('registration_open', DEFAULT_REGISTRATION_OPEN) == '1',
        'inviteCode': _get_setting('invite_code', DEFAULT_INVITE_CODE),
    }


def admin_set_settings(body, ctx):
    user = _require_user(ctx)
    if not user['is_admin']:
        raise ApiError(403, '需要管理员权限', 'forbidden')
    if body.get('registrationOpen') is not None:
        _set_setting('registration_open', '1' if body.get('registrationOpen') else '0')
    if body.get('inviteCode') is not None:
        code = str(body.get('inviteCode')).strip()
        if len(code) > 32:
            raise ApiError(400, '邀请码最长 32 位', 'invalid_input')
        _set_setting('invite_code', code)
    db.log_event(user['id'], 'admin_settings', {
        'registrationOpen': _get_setting('registration_open'),
        'inviteSet': bool(_get_setting('invite_code'))})
    return 200, {
        'registrationOpen': _get_setting('registration_open', DEFAULT_REGISTRATION_OPEN) == '1',
        'inviteCode': _get_setting('invite_code', DEFAULT_INVITE_CODE),
    }


ROUTES = {
    ('POST', '/api/auth/register'): register,
    ('POST', '/api/auth/login'): login,
    ('POST', '/api/auth/logout'): lambda body, ctx: logout(ctx),
    ('POST', '/api/auth/password'): change_password,
    ('GET', '/api/me'): lambda body, ctx: me(ctx),
    ('PATCH', '/api/me'): update_me,
    ('GET', '/api/config'): lambda body, ctx: get_config(body, ctx),
    ('GET', '/api/share'): lambda body, ctx: get_share(body, ctx),
    ('GET', '/api/progress'): lambda body, ctx: get_progress(ctx),
    ('PUT', '/api/progress'): put_progress,
    ('GET', '/api/stats'): lambda body, ctx: get_stats(ctx),
    ('GET', '/api/stats/calendar'): lambda body, ctx: get_calendar(ctx),
    ('GET', '/api/leaderboard'): lambda body, ctx: get_leaderboard(ctx),
    ('GET', '/api/achievements'): lambda body, ctx: get_achievements(ctx),
    ('GET', '/api/admin/users'): lambda body, ctx: admin_users(ctx),
    ('GET', '/api/admin/settings'): lambda body, ctx: admin_get_settings(ctx),
    ('PUT', '/api/admin/settings'): admin_set_settings,
}
