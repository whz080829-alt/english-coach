/* 云同步层：登录态、进度拉取/推送、冲突合并、离线降级。
 *
 * 设计原则（取长补短）：
 *   1) 离线优先：没登录时一切照旧走 localStorage，功能不缩水；
 *      登录后本地数据仍然是主副本，云端只是"另一个副本"。
 *   2) 合并而非覆盖：两端都学过的记录按"更充分的一次"保留，
 *      掌握度由引擎根据合并后的原始记录重算，避免出现假进度。
 *   3) 冲突用版本号检测，409 时自动拉取→合并→重推，用户无感。
 */
var ECCloud = (function () {
  'use strict';

  var user = null;
  var serverVersion = 0;
  var dirty = false;
  var syncing = false;
  var lastSync = 0;
  var lastError = '';
  var conflictCount = 0;
  var listeners = [];
  var pushTimer = null;
  var PUSH_DELAY = 8000;
  var enabled = false;      // 服务端可用（/api/health 通）
  var newAchievements = [];
  var suppress = false;     // 云端写入本机时，不要反过来再标记为"待上传"

  // 执行一次"由云端引起的本机写入"，期间屏蔽 markDirty，避免自我循环
  function applyLocal(fn) {
    suppress = true;
    try { return fn(); } finally { suppress = false; }
  }

  /* ---------------- 状态广播 ---------------- */

  function status() {
    return {
      online: enabled,
      loggedIn: !!user,
      user: user,
      syncing: syncing,
      dirty: dirty,
      lastSync: lastSync,
      error: lastError,
      conflicts: conflictCount,
      serverVersion: serverVersion,
      pending: !!pushTimer
    };
  }

  function notify() {
    var s = status();
    listeners.forEach(function (fn) { try { fn(s); } catch (e) { } });
  }

  function onChange(fn) { listeners.push(fn); return fn; }

  /* ---------------- 合并算法 ---------------- */

  function pickBetter(a, b, weightKeys) {
    // 取"更充分"的一条：先比 attempts/reps，再比 last
    if (!a) return b;
    if (!b) return a;
    var ka = weightKeys.reduce(function (s, k) { return s + (a[k] || 0); }, 0);
    var kb = weightKeys.reduce(function (s, k) { return s + (b[k] || 0); }, 0);
    if (ka !== kb) return ka > kb ? a : b;
    return (a.last || 0) >= (b.last || 0) ? a : b;
  }

  function maxKeys(out, other, keys) {
    keys.forEach(function (k) {
      var v = Math.max(out[k] || 0, other[k] || 0);
      if (v) out[k] = v;
    });
    return out;
  }

  function mergeMaps(a, b, weightKeys, bonusKeys) {
    a = a || {}; b = b || {};
    var out = {};
    var ids = {};
    Object.keys(a).forEach(function (k) { ids[k] = 1; });
    Object.keys(b).forEach(function (k) { ids[k] = 1; });
    Object.keys(ids).forEach(function (id) {
      var x = a[id], y = b[id];
      if (!x) { out[id] = y; return; }
      if (!y) { out[id] = x; return; }
      var win = pickBetter(x, y, weightKeys);   // 更"充分"的那一条作为基底
      var merged = {};
      Object.keys(win).forEach(function (k) { merged[k] = win[k]; });
      // 补齐另一方独有的字段
      [x, y].forEach(function (src) {
        Object.keys(src).forEach(function (k) {
          if (merged[k] === undefined) merged[k] = src[k];
        });
      });
      // 计数类字段两端取最大，避免"少算"
      maxKeys(merged, x, bonusKeys);
      maxKeys(merged, y, bonusKeys);
      out[id] = merged;
    });
    return out;
  }

  var STAGE_ORDER = ['basic', 'ab', 'cet4', 'cet6', 'ielts'];

  function merge(local, remote) {
    if (!local) return remote;
    if (!remote) return local;
    var out = JSON.parse(JSON.stringify(local));

    /* 单词：连对次数多者胜；对错计数取最大 */
    out.words = mergeMaps(local.words, remote.words, ['reps', 'correct'], ['correct', 'wrong', 'lapses']);

    /* 其它模块：答题次数多者胜 */
    ['grammar', 'listening', 'reading', 'writing', 'dictation'].forEach(function (m) {
      out[m] = mergeMaps(local[m], remote[m], ['attempts', 'correct'], ['attempts', 'correct']);
    });

    /* 错题本：按内容去重，保留最近 400 条 */
    var ekey = {};
    (local.errors || []).concat(remote.errors || []).forEach(function (e) {
      if (!e) return;
      var k = [e.ts, e.module, e.ref, e.your].join('|');
      if (!ekey[k]) ekey[k] = e;
    });
    out.errors = Object.keys(ekey).map(function (k) { return ekey[k]; })
      .sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); }).slice(0, 400);

    /* 会话记录：按时间戳去重 */
    var skey = {};
    (local.sessions || []).concat(remote.sessions || []).forEach(function (s) {
      if (s && s.ts !== undefined) skey[s.ts] = s;
    });
    out.sessions = Object.keys(skey).map(function (k) { return skey[k]; })
      .sort(function (a, b) { return b.ts - a.ts; }).slice(0, 500);

    /* 每日统计：取最大值（同一天两台设备都学过，取更长的） */
    out.days = {};
    var dks = {};
    Object.keys(local.days || {}).forEach(function (k) { dks[k] = 1; });
    Object.keys(remote.days || {}).forEach(function (k) { dks[k] = 1; });
    Object.keys(dks).forEach(function (day) {
      var x = (local.days || {})[day], y = (remote.days || {})[day];
      if (!x) { out.days[day] = y; return; }
      if (!y) { out.days[day] = x; return; }
      var rec = {
        minutes: Math.max(x.minutes || 0, y.minutes || 0),
        items: Math.max(x.items || 0, y.items || 0),
        correct: Math.max(x.correct || 0, y.correct || 0),
        byModule: {}
      };
      ['vocab', 'grammar', 'listening', 'reading', 'writing'].forEach(function (m) {
        var p = (x.byModule || {})[m] || {}, q = (y.byModule || {})[m] || {};
        if (p.items || q.items) {
          rec.byModule[m] = {
            minutes: Math.max(p.minutes || 0, q.minutes || 0),
            items: Math.max(p.items || 0, q.items || 0),
            correct: Math.max(p.correct || 0, q.correct || 0)
          };
        }
      });
      out.days[day] = rec;
    });

    /* 阶段：取更靠后的；已解锁取并集 */
    var li = STAGE_ORDER.indexOf(local.stage), ri = STAGE_ORDER.indexOf(remote.stage);
    out.stage = (ri > li) ? remote.stage : local.stage;
    var unlocked = {};
    (local.unlocked || []).concat(remote.unlocked || []).forEach(function (s) { unlocked[s] = 1; });
    out.unlocked = STAGE_ORDER.filter(function (s) { return unlocked[s]; });

    /* 计划：取生成时间较新的那一份 */
    var lp = local.plan, rp = remote.plan;
    if (!lp) out.plan = rp || null;
    else if (!rp) out.plan = lp;
    else out.plan = ((rp.createdAt || 0) > (lp.createdAt || 0)) ? rp : lp;
    out.roundIndex = Math.max(local.roundIndex || 0, remote.roundIndex || 0);

    /* 生词本：按单词去重 */
    var wb = {}, wbOut = [];
    (local.wordbook || []).concat(remote.wordbook || []).forEach(function (w) {
      if (!w || !w.word) return;
      var k = String(w.word).toLowerCase();
      if (!wb[k]) { wb[k] = 1; wbOut.push(w); }
    });
    out.wordbook = wbOut.slice(0, 800);

    /* 摸底结果：取较新的 */
    out.placement = ((remote.placement || {}).ts || 0) > ((local.placement || {}).ts || 0)
      ? remote.placement : local.placement;
    out.placed = !!(local.placed || remote.placed);

    /* 偏好设置以本地为准（主题、语速等是本机偏好） */
    out.profile = Object.assign({}, remote.profile || {}, local.profile || {});

    /* 掌握度用引擎按合并后的原始记录重算，避免两边数值直接相加产生假进度 */
    try {
      if (window.ECEngine && ECEngine.ready()) {
        out.skills = out.skills || {};
        STAGE_ORDER.forEach(function (st) {
          out.skills[st] = out.skills[st] || {};
          ECEngine.SKILLS.forEach(function (sk) {
            out.skills[st][sk] = ECEngine.skillMastery(out, st, sk);
          });
        });
      }
    } catch (e) { /* 引擎不可用时保留原值 */ }

    return out;
  }

  /* ---------------- 与本地存储对接 ---------------- */

  function applyServerProfile(u) {
    applyLocal(function () {
      var S = ECStore.get();
      S.profile = S.profile || {};
      if (u.nickname) S.profile.nickname = u.nickname;
      if (u.target) S.profile.target = u.target;
      if (u.dailyMinutes) S.profile.dailyMinutes = u.dailyMinutes;
      S.profile.examDate = u.examDate || S.profile.examDate || '';
      ECStore.save(true);
    });
  }

  function hasLocalData(S) {
    return !!(Object.keys(S.words || {}).length || (S.sessions || []).length ||
      Object.keys(S.days || {}).length);
  }

  /* ---------------- 同步动作 ---------------- */

  function pullAndMerge() {
    return ECApi.getProgress().then(function (r) {
      serverVersion = r.version || 0;
      var local = ECStore.get();
      if (!r.state) {
        // 云端还没有数据：把本机进度作为该账号的初始进度
        if (hasLocalData(local)) return push(true);
        return { merged: false, pushed: false };
      }
      var merged = merge(local, r.state);
      var changed = JSON.stringify(merged) !== JSON.stringify(r.state);
      applyLocal(function () { ECStore.replace(merged); });
      if (changed) return push(true);
      return { merged: true, pushed: false };
    });
  }

  function push(force) {
    if (!user || syncing) return Promise.resolve(false);
    if (!force && !dirty) return Promise.resolve(false);
    syncing = true;
    notify();
    var snapshot = ECStore.get();
    return ECApi.putProgress(snapshot, serverVersion).then(function (r) {
      serverVersion = r.version;
      dirty = false;
      lastSync = Date.now();
      lastError = '';
      if (r.newAchievements && r.newAchievements.length) {
        newAchievements = newAchievements.concat(r.newAchievements);
        if (window.ECUI && ECUI.toast) {
          r.newAchievements.forEach(function (a) {
            ECUI.toast('🏅 解锁成就：' + a.icon + ' ' + a.name, '', 4200);
          });
        }
      }
      syncing = false;
      notify();
      return true;
    }).catch(function (e) {
      syncing = false;
      if (e.status === 409 && e.data && e.data.state) {
        // 冲突：以服务器版本为基准合并后重推一次
        conflictCount++;
        serverVersion = e.data.version;
        var merged = merge(ECStore.get(), e.data.state);
        applyLocal(function () { ECStore.replace(merged); });
        lastError = '检测到其它设备的学习记录，已自动合并';
        notify();
        return ECApi.putProgress(merged, serverVersion).then(function (r2) {
          serverVersion = r2.version;
          dirty = false;
          lastSync = Date.now();
          lastError = '';
          notify();
          return true;
        });
      }
      lastError = e.message || '同步失败';
      notify();
      return false;
    });
  }

  function schedulePush() {
    if (!user) return;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(function () { pushTimer = null; push(); }, PUSH_DELAY);
    notify();
  }

  function markDirty() {
    if (suppress) return;
    dirty = true;
    schedulePush();
    notify();
  }

  /* ---------------- 生命周期 ---------------- */

  function init() {
    return ECApi.health().then(function () {
      enabled = true;
      notify();
    }).catch(function () {
      enabled = false;
      notify();
      return null;      // 后端不可用：纯本地模式，功能不受影响
    }).then(function () {
      return ECApi.me();
    }).then(function (r) {
      if (!r || !r.user) return false;
      user = r.user;
      applyServerProfile(user);
      serverVersion = (r.progress && r.progress.version) || 0;
      notify();
      return pullAndMerge().then(function () {
        lastSync = Date.now();
        notify();
        return true;
      });
    }).catch(function () {
      user = null;
      notify();
      return false;
    });
  }

  function login(username, password, remember) {
    return ECApi.login(username, password, remember).then(function (r) {
      user = r.user;
      applyServerProfile(user);
      serverVersion = 0;
      dirty = false;
      lastError = '';
      notify();
      return pullAndMerge().then(function () {
        lastSync = Date.now();
        notify();
        return r.user;
      });
    });
  }

  function register(username, password, email, nickname, extra) {
    return ECApi.register(username, password, email, nickname, extra).then(function (r) {
      user = r.user;
      applyServerProfile(user);
      serverVersion = 0;
      dirty = false;
      notify();
      return pullAndMerge().then(function () {
        lastSync = Date.now();
        notify();
        return r.user;
      });
    });
  }

  function logout() {
    return ECApi.logout().catch(function () { return null; }).then(function () {
      user = null;
      serverVersion = 0;
      dirty = false;
      lastSync = 0;
      lastError = '';
      notify();
      return true;
    });
  }

  function saveProfile(patch) {
    if (!user) return Promise.resolve(null);
    return ECApi.updateMe(patch).then(function (r) {
      user = r.user;
      applyServerProfile(user);
      notify();
      return user;
    });
  }

  function drainAchievements() {
    var a = newAchievements;
    newAchievements = [];
    return a;
  }

  function flush() {
    if (user && dirty) return push(true);
    return Promise.resolve(false);
  }

  // 离开页面/切到后台时尽力把未同步的进度推上去
  function bindLifecycle() {
    if (typeof document === 'undefined') return;
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') flush();
    });
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', function () { flush(); });
    }
  }

  return {
    init: init, login: login, register: register, logout: logout,
    pullAndMerge: pullAndMerge, push: push, markDirty: markDirty, flush: flush,
    merge: merge, status: status, onChange: onChange,
    saveProfile: saveProfile, drainAchievements: drainAchievements,
    bindLifecycle: bindLifecycle,
    user: function () { return user; },
    enabled: function () { return enabled; }
  };
})();
if (typeof window !== 'undefined') { window.ECCloud = ECCloud; }
