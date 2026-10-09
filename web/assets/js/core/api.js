/* API 客户端：与后端 /api/* 通信。
 * 认证优先用 httpOnly Cookie（同源自动携带、免疫 XSS 窃取），
 * 写操作带 X-Requested-With 头满足服务端 CSRF 校验。
 */
var ECApi = (function () {
  'use strict';

  var BASE = '';
  var token = null;          // 可选：Bearer 方式（接口调试/未来 App 用）
  var lastError = null;

  function setToken(t) { token = t || null; }
  function getToken() { return token; }

  function offlineErr(msg) {
    var err = new Error('无法连接服务器（' + (msg || '网络错误') + '）');
    err.status = 0;
    err.code = 'offline';
    return err;
  }

  function request(method, path, body, opts) {
    opts = opts || {};
    // 没有 fetch 的环境（很旧的浏览器）直接按"离线"处理，不影响本机学习功能
    if (typeof fetch !== 'function') {
      return Promise.reject(offlineErr('当前浏览器不支持 fetch'));
    }
    var headers = { 'X-Requested-With': 'fetch' };
    if (body !== undefined && body !== null) headers['Content-Type'] = 'application/json';
    if (token) headers['Authorization'] = 'Bearer ' + token;
    var init = { method: method, headers: headers, credentials: 'same-origin' };
    if (body !== undefined && body !== null) init.body = JSON.stringify(body);
    if (opts.timeout) {
      var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      if (ctrl) {
        init.signal = ctrl.signal;
        setTimeout(function () { ctrl.abort(); }, opts.timeout);
      }
    }
    return fetch(BASE + path, init).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        if (text) { try { data = JSON.parse(text); } catch (e) { data = { raw: text }; } }
        return { status: res.status, ok: res.status >= 200 && res.status < 300, data: data };
      });
    }).catch(function (e) {
      throw offlineErr((e && e.message) ? e.message : '网络错误');
    });
  }

  function api(method, path, body, opts) {
    return request(method, path, body, opts).then(function (r) {
      lastError = null;
      if (r.ok) return r.data;
      var err = new Error((r.data && r.data.error) || ('请求失败（HTTP ' + r.status + '）'));
      err.status = r.status;
      err.code = (r.data && r.data.code) || 'error';
      err.data = r.data;
      lastError = err;
      throw err;
    });
  }

  return {
    setToken: setToken, getToken: getToken,
    lastError: function () { return lastError; },

    health: function () { return api('GET', '/api/health'); },

    register: function (username, password, email, nickname, extra) {
      extra = extra || {};
      return api('POST', '/api/auth/register',
        { username: username, password: password, email: email || '', nickname: nickname || '',
          target: extra.target || undefined,
          dailyMinutes: extra.dailyMinutes || undefined,
          examDate: extra.examDate || undefined,
          inviteCode: extra.inviteCode || undefined });
    },
    login: function (username, password, remember) {
      return api('POST', '/api/auth/login',
        { username: username, password: password, remember: !!remember });
    },
    logout: function () { return api('POST', '/api/auth/logout', {}); },
    me: function () { return api('GET', '/api/me'); },
    updateMe: function (patch) { return api('PATCH', '/api/me', patch); },
    changePassword: function (oldPassword, newPassword) {
      return api('POST', '/api/auth/password',
        { oldPassword: oldPassword, newPassword: newPassword });
    },

    getProgress: function () { return api('GET', '/api/progress'); },
    putProgress: function (state, baseVersion) {
      return api('PUT', '/api/progress', { state: state, baseVersion: baseVersion });
    },

    stats: function () { return api('GET', '/api/stats'); },
    calendar: function (days) { return api('GET', '/api/stats/calendar?days=' + (days || 120)); },
    leaderboard: function (type, limit) {
      return api('GET', '/api/leaderboard?type=' + (type || 'today') + '&limit=' + (limit || 20));
    },
    achievements: function () { return api('GET', '/api/achievements'); },
    adminUsers: function () { return api('GET', '/api/admin/users'); },

    config: function () { return api('GET', '/api/config'); },
    share: function () { return api('GET', '/api/share'); },
    adminSettings: function () { return api('GET', '/api/admin/settings'); },
    saveAdminSettings: function (patch) {
      return api('PUT', '/api/admin/settings', patch);
    }
  };
})();
if (typeof window !== 'undefined') { window.ECApi = ECApi; }
