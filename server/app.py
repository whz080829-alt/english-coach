"""英语提分教练 · 全栈版 后端服务

只用 Python 标准库（http.server + sqlite3），零依赖、可离线运行。

启动：
    python server/app.py                 # http://127.0.0.1:8788
    python server/app.py --port 9000     # 换端口
    python server/app.py --host 0.0.0.0  # 允许局域网/手机访问
    python server/app.py --open          # 启动后自动打开浏览器
"""
from __future__ import annotations

import argparse
import json
import mimetypes
import os
import socket
import sys
import threading
import time
import urllib.parse
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
# vendor/：内置纯 Python 二维码库（python-qrcode 裁剪版，MIT）
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'vendor'))

import api              # noqa: E402
import auth             # noqa: E402
import db               # noqa: E402

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB_DIR = os.path.join(BASE_DIR, 'web')
VERSION = '1.0.0'
START_TS = int(time.time())

MAX_BODY = 8 * 1024 * 1024

MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.ico': 'image/x-icon',
    '.webp': 'image/webp',
    '.md': 'text/markdown; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.woff2': 'font/woff2',
}

CSP = ("default-src 'self' blob: data:; script-src 'self' 'unsafe-inline'; "
       "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
       "connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")


def _json_bytes(obj) -> bytes:
    return json.dumps(obj, ensure_ascii=False, separators=(',', ':')).encode('utf-8')


class CoachServer(ThreadingHTTPServer):
    """多线程 HTTP 服务；对"连接被对端重置"这类正常事件不打报错栈。

    浏览器刷新、关闭标签页、健康检查探测都会直接断连，
    标准库默认会把它们打印成异常，容易让人误以为服务出错。
    """
    daemon_threads = True
    allow_reuse_address = True

    def handle_error(self, request, client_address):
        import sys
        exc = sys.exc_info()[0]
        if exc in (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
            return
        ThreadingHTTPServer.handle_error(self, request, client_address)


class Handler(BaseHTTPRequestHandler):
    server_version = 'EnglishCoachCloud/' + VERSION
    protocol_version = 'HTTP/1.1'

    # 浏览器（以及某些客户端）经常在不发 FIN 的情况下直接断开 keep-alive 连接，
    # socketserver 会把这种"连接被重置"当成异常打印一大段 Python 报错栈，
    # 让控制台看起来像服务崩了。这里把它当成正常的连接关闭静默处理。
    def handle_one_request(self):
        try:
            BaseHTTPRequestHandler.handle_one_request(self)
        except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
            self.close_connection = True

    # ---------------------------------------------------------- 基础输出

    def _send(self, status: int, body: bytes, ctype='application/json; charset=utf-8',
              extra_headers=None, etag=None):
        self.send_response(status)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('X-Frame-Options', 'DENY')
        if ctype.startswith('text/html'):
            self.send_header('Content-Security-Policy', CSP)
        if etag:
            self.send_header('ETag', etag)
        for k, v in (extra_headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != 'HEAD':
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass

    def _json(self, status: int, obj, extra_headers=None):
        self._send(status, _json_bytes(obj), 'application/json; charset=utf-8', extra_headers)

    def _error(self, status: int, message: str, code='error'):
        self._json(status, {'error': message, 'code': code})

    # ---------------------------------------------------------- 请求上下文

    def _cookies(self) -> dict:
        raw = self.headers.get('Cookie') or ''
        out = {}
        for part in raw.split(';'):
            if '=' in part:
                k, v = part.split('=', 1)
                out[k.strip()] = urllib.parse.unquote(v.strip())
        return out

    def _read_body(self) -> dict:
        try:
            length = int(self.headers.get('Content-Length') or 0)
        except Exception:
            length = 0
        if length <= 0:
            return {}
        if length > MAX_BODY:
            raise api.ApiError(413, '请求体过大', 'too_large')
        raw = self.rfile.read(length)
        if not raw:
            return {}
        ctype = (self.headers.get('Content-Type') or '').lower()
        if 'application/json' in ctype or raw[:1] in (b'{', b'['):
            try:
                data = json.loads(raw.decode('utf-8'))
            except Exception:
                raise api.ApiError(400, 'JSON 格式错误', 'bad_json')
            if not isinstance(data, dict):
                raise api.ApiError(400, '请求体必须是对象', 'bad_json')
            return data
        # 兼容表单提交
        parsed = urllib.parse.parse_qs(raw.decode('utf-8', 'replace'))
        return {k: v[0] for k, v in parsed.items()}

    def _context(self, method: str, path: str, qs: dict) -> dict:
        cookie_token = self._cookies().get(auth.SESSION_COOKIE)
        bearer = ''
        authz = self.headers.get('Authorization') or ''
        if authz.lower().startswith('bearer '):
            bearer = authz[7:].strip()
        token = cookie_token or bearer
        user = auth.user_for_token(token) if token else None
        return {
            'user': user,
            'token': token,
            'viaCookie': bool(cookie_token),
            'ip': self.client_address[0] if self.client_address else '',
            'ua': self.headers.get('User-Agent') or '',
            'host': self.headers.get('Host') or '',
            'qs': qs,
            'method': method,
            'path': path,
        }

    # ---------------------------------------------------------- 路由

    def _handle_api(self, method: str, path: str, qs: dict) -> bool:
        """返回 True 表示已处理。"""
        if path == '/api/health':
            self._json(200, {'ok': True, 'version': VERSION, 'uptime': int(time.time()) - START_TS,
                             'users': db.scalar('SELECT COUNT(*) FROM users')})
            return True

        fn = api.ROUTES.get((method, path))
        if fn is None:
            allowed = sorted({m for (m, p) in api.ROUTES if p == path})
            if allowed:
                self._error(405, '方法不允许，可用：' + ', '.join(allowed), 'method_not_allowed')
            else:
                self._error(404, '接口不存在：' + path, 'not_found')
            return True

        try:
            body = self._read_body()
            ctx = self._context(method, path, qs)
            # CSRF 防护：用 Cookie 认证的写操作必须带自定义头
            if method in ('POST', 'PUT', 'PATCH', 'DELETE') and ctx['viaCookie']:
                if not self.headers.get('X-Requested-With'):
                    self._error(403, '缺少 X-Requested-With 头（CSRF 防护）', 'csrf')
                    return True
            status, payload = fn(body, ctx)
        except api.ApiError as e:
            self._error(e.status, e.message, e.code)
            return True
        except Exception as e:                     # 兜底，避免 500 里带堆栈
            import traceback
            traceback.print_exc()
            db.log_event(None, 'server_error', {'path': path, 'error': str(e)})
            self._error(500, '服务器内部错误', 'internal')
            return True

        headers = {}
        token = payload.get('token')
        if token:
            max_age = max(0, int(payload.get('expiresAt', 0) - time.time()))
            headers['Set-Cookie'] = (f'{auth.SESSION_COOKIE}={urllib.parse.quote(token)}; '
                                     f'Path=/; HttpOnly; SameSite=Strict; Max-Age={max_age}')
        elif path == '/api/auth/logout':
            headers['Set-Cookie'] = f'{auth.SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0'
        self._json(status, payload, headers)
        return True

    # ---------------------------------------------------------- 静态文件

    def _serve_static(self, path: str) -> bool:
        if path in ('/', ''):
            path = '/index.html'
        rel = urllib.parse.unquote(path.lstrip('/'))
        # 目录穿越防护
        full = os.path.normpath(os.path.join(WEB_DIR, rel))
        if not full.startswith(os.path.normpath(WEB_DIR) + os.sep) and full != os.path.normpath(WEB_DIR):
            self._error(403, '禁止访问', 'forbidden')
            return True
        if os.path.isdir(full):
            full = os.path.join(full, 'index.html')
        if not os.path.isfile(full):
            body = ('<!doctype html><meta charset="utf-8"><title>404</title>'
                    '<body style="font-family:system-ui,-apple-system,Segoe UI,Microsoft YaHei;'
                    'padding:48px;background:#0e1116;color:#e6ecf3">'
                    '<h1 style="margin:0 0 12px">404 找不到这个文件</h1>'
                    '<p style="color:#8d9aab">请从 <a style="color:#4c8dff" href="/index.html">首页</a> 进入。'
                    '如果你是在找接口，接口都在 /api/ 下。</p></body>').encode('utf-8')
            self._send(404, body, 'text/html; charset=utf-8')
            return True
        try:
            st = os.stat(full)
        except OSError:
            self._error(500, '读取文件失败', 'io')
            return True
        etag = '"%s-%s"' % (int(st.st_mtime), st.st_size)
        if self.headers.get('If-None-Match') == etag:
            self._send(304, b'', 'text/plain', etag=etag)
            return True
        ext = os.path.splitext(full)[1].lower()
        ctype = MIME.get(ext) or mimetypes.guess_type(full)[0] or 'application/octet-stream'
        try:
            with open(full, 'rb') as f:
                data = f.read()
        except OSError:
            self._error(500, '读取文件失败', 'io')
            return True
        # HTML 不缓存，静态资源用 ETag 校验，避免改了代码看不到效果
        extra = {'Cache-Control': 'no-cache' if ext in ('.html', '.js', '.css') else 'public, max-age=3600'}
        self._send(200, data, ctype, extra, etag=etag)
        return True

    # ---------------------------------------------------------- 动词

    def _dispatch(self, method: str):
        parsed = urllib.parse.urlsplit(self.path)
        path = parsed.path
        qs = urllib.parse.parse_qs(parsed.query)
        try:
            if path.startswith('/api/'):
                self._handle_api(method, path, qs)
            elif method in ('GET', 'HEAD'):
                self._serve_static(path)
            else:
                self._error(405, '不支持的请求方法', 'method_not_allowed')
        except api.ApiError as e:
            self._error(e.status, e.message, e.code)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_GET(self):
        self._dispatch('GET')

    def do_HEAD(self):
        self._dispatch('HEAD')

    def do_POST(self):
        self._dispatch('POST')

    def do_PUT(self):
        self._dispatch('PUT')

    def do_PATCH(self):
        self._dispatch('PATCH')

    def do_DELETE(self):
        self._dispatch('DELETE')

    def do_OPTIONS(self):
        self._send(204, b'', 'text/plain',
                   {'Allow': 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS'})

    # ---------------------------------------------------------- 日志

    def log_message(self, fmt, *args):
        msg = fmt % args
        if '/api/' in msg or ' 4' in msg or ' 5' in msg:
            sys.stderr.write('[%s] %s\n' % (time.strftime('%H:%M:%S'), msg))

    def log_error(self, fmt, *args):
        self.log_message(fmt, *args)


def local_ip() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return '127.0.0.1'


def main(argv=None):
    ap = argparse.ArgumentParser(description='英语提分教练 · 全栈版后端')
    ap.add_argument('--host', default=os.environ.get('HOST') or '127.0.0.1',
                    help='监听地址，0.0.0.0 可供局域网/公网访问')
    ap.add_argument('--port', type=int,
                    default=int(os.environ.get('PORT') or 8788),
                    help='监听端口（默认 8788，云平台会用 PORT 环境变量注入）')
    ap.add_argument('--db', default=None, help='数据库文件路径')
    ap.add_argument('--open', action='store_true', help='启动后自动打开浏览器')
    args = ap.parse_args(argv)

    if args.db:
        db.configure(args.db)
    db.init()
    n = db.cleanup_expired_sessions()

    try:
        httpd = CoachServer((args.host, args.port), Handler)
    except OSError as e:
        print()
        print('  启动失败：端口 %d 无法绑定（%s）' % (args.port, e))
        print('  可能已经有另一个实例在运行。可以：')
        print('    1) 直接访问 http://127.0.0.1:%d/index.html' % args.port)
        print('    2) 或换端口启动：python server/app.py --port 8789')
        print()
        return 2

    httpd.daemon_threads = True
    url = 'http://%s:%d/index.html' % ('127.0.0.1' if args.host in ('0.0.0.0', '::') else args.host,
                                       args.port)
    print()
    print('  ============================================================')
    print('   英语提分教练 · 全栈版  v%s' % VERSION)
    print('  ============================================================')
    print('   本机访问 : %s' % url)
    if args.host in ('0.0.0.0', '::'):
        ips = api._lan_ips()
        print('   局域网/手机: http://%s:%d/index.html' % (ips[0] if ips else local_ip(), args.port))
        print('   （手机连同一 Wi-Fi，浏览器扫码或输入上面的地址即可注册使用）')
    print('   数据库   : %s' % db.db_path())
    print('   用户数   : %d        过期会话清理: %d' % (db.scalar('SELECT COUNT(*) FROM users'), n))
    print()
    print('   任何人都可以注册账号开始使用（可在「我的 → 用户管理」里关闭开放注册）')
    print('   按 Ctrl+C 停止服务')
    print()

    if args.open:
        threading.Thread(target=lambda: (time.sleep(0.8), webbrowser.open(url)),
                         daemon=True).start()

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print('\n  正在停止服务...')
    finally:
        httpd.server_close()
        print('  已停止。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
