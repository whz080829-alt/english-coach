/* 英语提分教练 · Service Worker
 * 作用：
 *   1. 让应用满足「可安装（PWA）」条件
 *   2. 静态资源缓存后离线可用——没网也能背单词（云同步会自动等待联网）
 *   3. 页面导航请求断网时回退到 index.html，避免白屏
 * 注意：/api/ 一律不走缓存，账号与同步请求永远直达服务器。
 */
'use strict';

var CACHE = 'ec-cache-v1';
var PRECACHE = [
  '/',
  '/index.html',
  '/诊断.html',
  '/manifest.webmanifest',
  '/assets/css/app.css',
  '/assets/favicon-32.png',
  '/assets/icon-192.png',
  '/assets/icon-512.png',
  '/assets/icon-maskable-192.png',
  '/assets/icon-maskable-512.png',
  '/assets/apple-touch-icon.png',
  '/assets/js/core/parse.js',
  '/assets/js/core/store.js',
  '/assets/js/core/tts.js',
  '/assets/js/core/api.js',
  '/assets/js/core/cloud.js',
  '/assets/js/core/install.js',
  '/assets/js/core/engine.js',
  '/assets/js/core/writegrade.js',
  '/assets/js/data/vocab.basic.js',
  '/assets/js/data/vocab.cet.js',
  '/assets/js/data/vocab.js',
  '/assets/js/data/grammar.js',
  '/assets/js/data/listening.js',
  '/assets/js/data/reading.js',
  '/assets/js/data/writing.js',
  '/assets/js/ui/ui.js',
  '/assets/js/ui/view-onboarding.js',
  '/assets/js/ui/view-plan.js',
  '/assets/js/ui/view-placement.js',
  '/assets/js/ui/view-vocab.js',
  '/assets/js/ui/view-grammar.js',
  '/assets/js/ui/view-listening.js',
  '/assets/js/ui/view-reading.js',
  '/assets/js/ui/view-writing.js',
  '/assets/js/ui/view-stats.js',
  '/assets/js/ui/view-settings.js',
  '/assets/js/ui/view-summary.js',
  '/assets/js/ui/view-account.js',
  '/assets/js/ui/view-social.js',
  '/assets/js/app.js'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      // 逐个缓存，单个失败不拖垮整体安装
      return Promise.all(PRECACHE.map(function (u) {
        return c.add(new Request(u, { cache: 'reload' })).catch(function () { });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;      // 跨域不处理
  if (url.pathname.indexOf('/api/') === 0) return;      // 接口永不缓存

  // 页面导航：网络优先，断网回退 index.html
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).catch(function () {
        return caches.match('/index.html').then(function (r) {
          return r || caches.match('/');
        });
      })
    );
    return;
  }

  // 静态资源：缓存优先，未命中则拉取并入库
  e.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && res.ok && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () {
        return new Response('', { status: 504, statusText: 'offline' });
      });
    })
  );
});
