/* 应用装配：初始化、路由、顶栏与侧边导航、学习结束后的重新规划 */
var ECApp = (function () {
  'use strict';

  var state = null;
  var currentRoute = { name: 'plan', params: {} };
  var lastSummary = null;

  var NAV = [
    { name: 'plan', label: '今日计划', icon: '🏠' },
    { name: 'vocab', label: '单词', icon: '📖' },
    { name: 'grammar', label: '语法', icon: '🧩' },
    { name: 'listening', label: '听力', icon: '🎧' },
    { name: 'reading', label: '阅读', icon: '📚' },
    { name: 'writing', label: '写作', icon: '✍️' },
    { name: 'social', label: '排行榜', icon: '🏆' },
    { name: 'stats', label: '学习报告', icon: '📈' },
    { name: 'account', label: '我的', icon: '👤' },
    { name: 'settings', label: '设置', icon: '⚙️' }
  ];

  function parseHash() {
    var h = location.hash.replace(/^#\/?/, '');
    var q = h.split('?');
    var name = q[0] || 'plan';
    var params = {};
    (q[1] || '').split('&').forEach(function (kv) {
      if (!kv) return;
      var p = kv.split('=');
      params[decodeURIComponent(p[0])] = decodeURIComponent(p[1] === undefined ? '1' : p[1]);
    });
    return { name: name, params: params };
  }

  function buildContent() {
    return {
      VOCAB: window.EC_VOCAB || {},
      GRAMMAR: window.EC_GRAMMAR || {},
      LISTENING: window.EC_LISTENING || {},
      DICTATION: window.EC_DICTATION || {},
      READING: window.EC_READING || {},
      WRITING: window.EC_WRITING || {}
    };
  }

  function contentReport() {
    var s = ECEngine.stats(), miss = [];
    ECEngine.STAGES.forEach(function (st) {
      var k = s[st];
      if (!k.vocab) miss.push('vocab.' + st);
      if (!k.grammar) miss.push('grammar.' + st);
      if (!k.listening) miss.push('listening.' + st);
      if (!k.reading) miss.push('reading.' + st);
      if (!k.writing) miss.push('writing.' + st);
    });
    return { stats: s, missing: miss };
  }

  function renderNav() {
    var el = document.getElementById('nav');
    el.innerHTML = NAV.map(function (n) {
      return '<a href="#/' + n.name + '" class="nav-item' + (currentRoute.name === n.name ? ' active' : '') + '" data-n="' + n.name + '">' +
        '<span class="nav-icon">' + n.icon + '</span><span class="nav-label">' + n.label + '</span></a>';
    }).join('');
  }

  function syncChip() {
    var s = (window.ECCloud && ECCloud.status) ? ECCloud.status()
      : { online: false, loggedIn: false, dirty: false, syncing: false };
    var cls = 'chip sync-chip' + (!s.online ? ' off' : !s.loggedIn ? '' : s.dirty ? ' pending' : ' ok');
    var text = !s.online ? '本机模式'
      : !s.loggedIn ? '未登录'
        : s.syncing ? '同步中…' : s.dirty ? '待同步' : '已同步';
    var title = !s.online ? '后端未运行，数据只存在本机；点这里查看说明'
      : !s.loggedIn ? '未登录：登录后可在多设备间同步进度'
        : '最后同步：' + (s.lastSync ? new Date(s.lastSync).toLocaleTimeString() : '—');
    return '<a class="' + cls + '" href="#/account" title="' + ECUI.esc(title) + '">☁️ ' + text + '</a>';
  }

  function renderTop() {
    var an = ECEngine.analyze(state);
    var meta = ECEngine.STAGE_META[state.stage];
    var view = window.ECViews[currentRoute.name] || window.ECViews.plan;
    document.getElementById('top-title').textContent = view.title || '';
    var inst = (window.ECInstall && ECInstall.state().available && !ECInstall.state().installed)
      ? '<button class="chip install-chip js-install">📲 安装</button>' : '';
    document.getElementById('top-meta').innerHTML =
      inst +
      syncChip() +
      '<span class="chip stage-chip">' + ECUI.esc(meta.name) + '</span>' +
      '<span class="chip">掌握度 ' + Math.round(an.stageMastery * 100) + '%</span>' +
      '<span class="chip">🔥 ' + ECStore.streak() + ' 天</span>' +
      '<span class="chip">今日 ' + ECStore.dayLog().minutes + ' 分钟</span>' +
      '<button class="icon-btn js-theme" title="切换主题">' + (state.profile.theme === 'light' ? '🌙' : '☀️') + '</button>';
    var ib = document.querySelector('.js-install');
    if (ib) {
      ib.addEventListener('click', function () {
        ECInstall.promptInstall().then(function (r) {
          if (r === 'unavailable') ECApp.go('#/settings');
        });
      });
    }
    document.querySelector('.js-theme').addEventListener('click', function () {
      state.profile.theme = state.profile.theme === 'light' ? 'dark' : 'light';
      document.body.dataset.theme = state.profile.theme;
      ECStore.save(true);
      renderTop();
    });
  }

  function renderRoute() {
    var root = document.getElementById('view');
    var view = window.ECViews[currentRoute.name];
    if (!view) { location.hash = '#/plan'; return; }
    ECTTS.stop();
    window.scrollTo(0, 0);
    renderNav();
    renderTop();
    try {
      view.render(root, currentRoute.params);
    } catch (e) {
      root.innerHTML = '<section class="card"><h2>出错了</h2><p class="hint">' + ECUI.esc(e.message) + '</p>' +
        '<pre class="err">' + ECUI.esc(e.stack || '') + '</pre>' +
        '<a class="btn primary" href="#/plan">回到首页</a></section>';
      throw e;
    }
  }

  function go(hash) {
    if (location.hash === hash) renderRoute();
    else location.hash = hash;
  }

  function refresh() { renderRoute(); }

  function save() { ECStore.save(); }

  function reload() {
    state = ECStore.load();
    ECTTS.setRate(state.profile.ttsRate || 0.9);
    ECTTS.setPreferred(state.profile.ttsVoice || '');
    document.body.dataset.theme = state.profile.theme || 'dark';
    go('#/plan');
  }

  function generatePlan() {
    var plan = ECEngine.buildPlan(state);
    state.plan = plan;
    state.roundIndex = plan.roundIndex;
    ECStore.save(true);
    return plan;
  }

  function replan(silent) {
    function doIt() {
      generatePlan();
      ECUI.toast('已按你最新的表现重新排出第 ' + state.plan.roundIndex + ' 轮计划');
      go('#/plan');
    }
    if (silent === true) { doIt(); return; }
    ECUI.confirmBox('重新规划', '会按你现在的掌握度与错题情况重新排一轮计划，未完成的任务会被替换。继续吗？', '重新规划')
      .then(function (ok) { if (ok) doIt(); });
  }

  function startTask(i) {
    var plan = state.plan;
    if (!plan || !plan.tasks[i]) { ECUI.toast('任务不存在'); return; }
    var t = plan.tasks[i];
    go('#/' + t.module + '?task=' + i);
  }

  function addWordbook(item) {
    state.wordbook = state.wordbook || [];
    var key = String(item.word || '').toLowerCase();
    if (state.wordbook.some(function (w) { return String(w.word).toLowerCase() === key; })) return false;
    state.wordbook.unshift(Object.assign({ ts: Date.now() }, item));
    if (state.wordbook.length > 800) state.wordbook.length = 800;
    ECStore.save(true);
    return true;
  }

  // 学习结束：写记录 → 标记任务 → 判断本轮是否完成 → 必要时重排 → 展示复盘
  function finish(module, results, meta, opts) {
    meta = meta || {};
    var res = ECEngine.commit(state, {
      module: module, stage: state.stage,
      minutes: meta.minutes || 5, results: results || [], meta: meta
    });

    var taskIdx = currentRoute.params.task !== undefined ? parseInt(currentRoute.params.task, 10) : null;
    var plan = state.plan;
    var roundComplete = false, newPlan = null;
    if (plan && taskIdx !== null && !isNaN(taskIdx)) {
      plan.done = plan.done || [];
      if (plan.done.indexOf(taskIdx) < 0) plan.done.push(taskIdx);
      if (plan.done.length >= plan.tasks.length) {
        roundComplete = true;
        newPlan = generatePlan();
      } else {
        ECStore.save(true);
      }
    } else {
      ECStore.save(true);
    }

    lastSummary = {
      module: module, res: res, changes: res.changes,
      plan: plan, roundComplete: roundComplete, newPlan: newPlan,
      meta: meta, opts: opts || {}
    };
    go('#/summary');
  }

  function onboardingGuard() {
    // 新用户引导：没摸过底就先进引导（选目标 → 定时长 → 摸底定制）
    if (!state.placed && currentRoute.name !== 'onboarding') {
      location.hash = '#/onboarding';
      return;
    }
    // 首次打开：没有计划就生成一个基础计划，避免空白页
    if (state.placed && !state.plan) generatePlan();
  }

  function start() {
    state = ECStore.load();
    ECEngine.init(buildContent());
    ECTTS.init();
    ECTTS.setRate(state.profile.ttsRate || 0.9);
    ECTTS.setPreferred(state.profile.ttsVoice || '');
    document.body.dataset.theme = state.profile.theme || 'dark';

    var rep = contentReport();
    var banner = document.getElementById('data-banner');
    var notes = [];
    if (rep.missing.length) {
      notes.push('<b>⚠ 部分语料文件未加载：</b>' + rep.missing.join('、') +
        '（请确认 assets/js/data/ 下的文件存在，并用 Chrome/Edge 打开）');
    }
    if (!ECStore.storageOK()) {
      notes.push('<b>⚠ 当前浏览器不允许本页保存数据</b>，学习进度在关闭页面后会丢失。' +
        '请关闭无痕/隐私模式，或改用文件夹里的「启动.cmd」以本地服务方式打开。');
    }
    if (window.__ecErrors && window.__ecErrors.length) {
      notes.push('<b>⚠ 检测到 ' + window.__ecErrors.length + ' 条脚本错误：</b>' +
        ECUI.esc(window.__ecErrors[0]) + '（详见 诊断.html）');
    }
    if (notes.length) {
      banner.innerHTML = notes.join('<br>');
      banner.style.display = 'block';
    } else {
      banner.style.display = 'none';
    }

    window.addEventListener('hashchange', function () {
      currentRoute = parseHash();
      onboardingGuard();
      renderRoute();
    });
    currentRoute = parseHash();
    onboardingGuard();
    renderRoute();

    // ---- 云同步接线：本地一落盘就标记待上传；登录态变化时刷新顶栏与当前页 ----
    if (window.ECInstall) {
      ECInstall.init();
      ECInstall.onChange(function () { renderTop(); });
    }
    if (window.ECCloud) {
      ECStore.onSave(function () { ECCloud.markDirty(); });
      ECCloud.bindLifecycle();
      var lastAuthKey = '';
      ECCloud.onChange(function () {
        renderTop();
        var s = ECCloud.status();
        var key = (s.online ? 1 : 0) + '|' + (s.loggedIn ? 1 : 0);
        // 登录态/后端状态真正变化时才重绘当前页面（避免每次保存都重绘）
        if (key !== lastAuthKey) {
          lastAuthKey = key;
          if (currentRoute.name === 'account' || currentRoute.name === 'social' ||
            currentRoute.name === 'plan') {
            renderRoute();
          }
        }
      });
      ECCloud.init().then(function (ok) {
        renderTop();
        if (ok && ECCloud.user()) {
          var u = ECCloud.user();
          ECUI.toast('已登录：' + (u.nickname || u.username) + '，进度已同步', '', 3000);
        }
      }).catch(function () { renderTop(); });
    }

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && ECTTS.isPlaying()) ECTTS.stop();
    });
  }

  return {
    start: start, state: function () { return state; }, save: save, go: go,
    refresh: refresh, reload: reload, generatePlan: generatePlan, replan: replan,
    startTask: startTask, finish: finish, addWordbook: addWordbook,
    route: function () { return currentRoute; },
    contentReport: contentReport,
    get lastSummary() { return lastSummary; }
  };
})();
if (typeof window !== 'undefined') { window.ECApp = ECApp; }
