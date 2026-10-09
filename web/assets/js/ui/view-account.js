/* 视图：我的（登录 / 注册 / 资料 / 同步状态 / 改密 / 管理） */
(function () {
  'use strict';
  var U = ECUI;

  function strength(pw) {
    var s = 0;
    if (!pw) return { score: 0, label: '空', cls: 'low' };
    if (pw.length >= 8) s++;
    if (pw.length >= 12) s++;
    if (/[A-Za-z]/.test(pw) && /\d/.test(pw)) s++;
    if (/[^A-Za-z0-9]/.test(pw)) s++;
    if (s <= 1) return { score: 0.25, label: '太弱', cls: 'low' };
    if (s === 2) return { score: 0.5, label: '一般', cls: 'mid' };
    if (s === 3) return { score: 0.75, label: '不错', cls: 'ok' };
    return { score: 1, label: '很强', cls: 'ok' };
  }

  function loginForm(root, mode) {
    var s = ECCloud.status();
    var isLogin = mode !== 'register';
    if (!isLogin) {
      // 注册前先拿注册策略（是否开放、是否需要邀请码）
      ECApi.config().then(function (cfg) {
        if (cfg && cfg.registrationOpen === false) {
          root.innerHTML = '<section class="card auth-card"><h2>暂时无法注册</h2>' +
            '<p>管理员当前关闭了「开放注册」。请联系管理员开通，或先用本机模式学习。</p>' +
            '<div class="row"><button class="btn primary js-offline2">先用本机模式</button></div></section>';
          var r2 = root.querySelector('.js-offline2');
          if (r2) r2.addEventListener('click', function () { ECApp.go('#/plan'); });
          return;
        }
        buildAuthForm(root, mode, cfg || {});
      }).catch(function () { buildAuthForm(root, mode, {}); });
      return;
    }
    buildAuthForm(root, mode, {});
  }

  function buildAuthForm(root, mode, cfg) {
    var U = ECUI;
    var s = ECCloud.status();
    var isLogin = mode !== 'register';
    root.innerHTML = '<section class="card auth-card">' +
      '<div class="card-head"><h2>' + (isLogin ? '登录账号' : '注册新账号') + '</h2>' +
      '<span class="hint">' + (s.online ? '后端已连接' : '⚠ 后端未连接') +
      (!isLogin && cfg.users !== undefined ? ' · 已有 ' + cfg.users + ' 人在用' : '') + '</span></div>' +
      '<p class="hint">' + (isLogin
        ? '登录后，这台电脑和手机上的学习进度会合并到一起；不登录也能正常用，只是数据只存在本机浏览器里。'
        : '注册后立刻开始云同步。系统会按你的目标和摸底结果，为你定制专属学习计划。') + '</p>' +
      '<div class="auth-tabs">' +
      '<button class="btn ' + (isLogin ? 'primary' : 'ghost') + ' js-tab" data-m="login">登录</button>' +
      '<button class="btn ' + (!isLogin ? 'primary' : 'ghost') + ' js-tab" data-m="register">注册</button>' +
      '</div>' +
      '<div class="form-grid auth-form">' +
      '<label>用户名' + (isLogin ? '（或邮箱）' : '') +
      '<input class="input js-u" autocomplete="username" placeholder="' +
      (isLogin ? '用户名或邮箱' : '字母开头，3~24 位') + '"></label>' +
      (isLogin ? '' : '<label>昵称（可选）<input class="input js-nick" placeholder="显示在排行榜上的名字"></label>') +
      '<label>密码<input class="input js-p" type="password" autocomplete="' +
      (isLogin ? 'current-password' : 'new-password') + '" placeholder="至少 8 位，含字母和数字"></label>' +
      (isLogin ? '' : '<label>确认密码<input class="input js-p2" type="password" autocomplete="new-password"></label>') +
      (isLogin ? '' : '<label>目标考试<select class="input js-target">' +
        ECEngine.STAGES.map(function (st) {
          return '<option value="' + st + '"' + (st === 'cet4' ? ' selected' : '') + '>' +
            U.esc(ECEngine.STAGE_META[st].name) + '（' + U.esc(ECEngine.STAGE_META[st].tag) + '）</option>';
        }).join('') + '</select></label>') +
      (isLogin ? '' : '<label>每天能学多久（分钟）<input class="input js-min" type="number" min="5" max="600" step="5" value="40"></label>') +
      (isLogin ? '' : '<label>考试/目标日期（可选）<input class="input js-date" type="date"></label>') +
      (isLogin ? '' : (cfg.inviteRequired
        ? '<label>邀请码<input class="input js-invite" placeholder="请向分享给你的人索取"></label>'
        : '')) +
      (isLogin ? '<label>邮箱（可选，用于以后找回）<input class="input js-email" placeholder="name@example.com"></label>' : '') +
      '</div>' +
      (isLogin ? '' : '<div class="pw-meter js-meter">' + U.bar(0) + '<span class="hint">密码强度</span></div>') +
      (isLogin ? '<label class="checkbox-line"><input type="checkbox" class="js-remember" checked> 记住我（30 天免登录，勾选后延长到 180 天）</label>' : '') +
      '<div class="js-err err-text"></div>' +
      '<div class="row"><button class="btn primary big js-submit">' + (isLogin ? '登录' : '注册并开始') + '</button>' +
      '<button class="btn ghost js-offline">先不登录，用本机模式</button></div>' +
      '<p class="hint">密码用 PBKDF2-HMAC-SHA256 加盐存储（20 万次迭代），服务器不保存明文；会话是 HttpOnly Cookie，脚本读不到。</p>' +
      '</section>';

    U.$$('.js-tab', root).forEach(function (b) {
      b.addEventListener('click', function () { loginForm(root, b.dataset.m); });
    });
    root.querySelector('.js-offline').addEventListener('click', function () { ECApp.go('#/plan'); });

    var meter = root.querySelector('.js-meter');
    var p1 = root.querySelector('.js-p'), p2 = root.querySelector('.js-p2');
    if (p1 && meter) {
      p1.addEventListener('input', function () {
        var st = strength(p1.value);
        meter.innerHTML = U.bar(st.score, st.cls) + '<span class="hint">密码强度：' + st.label + '</span>';
      });
    }

    function fail(msg) {
      var e = root.querySelector('.js-err');
      e.textContent = msg;
      e.style.display = 'block';
    }

    function submit() {
      var u = root.querySelector('.js-u').value.trim();
      var pw = p1.value;
      var errEl = root.querySelector('.js-err');
      errEl.style.display = 'none';
      if (!u || !pw) { fail('请填写用户名和密码'); return; }
      var btn = root.querySelector('.js-submit');
      btn.disabled = true;
      btn.textContent = '处理中…';
      var done = function (user) {
        ECUI.toast('欢迎，' + (user.nickname || user.username) + '！进度已同步', '', 3600);
        // 新注册用户进入个性化引导
        if (!isLogin) ECApp.go('#/onboarding');
        else ECApp.refresh();
      };
      var bad = function (e) {
        btn.disabled = false;
        btn.textContent = isLogin ? '登录' : '注册并开始';
        fail(e.message || '操作失败');
      };
      if (isLogin) {
        ECCloud.login(u, pw, root.querySelector('.js-remember').checked).then(done).catch(bad);
      } else {
        if (pw !== p2.value) { bad({ message: '两次输入的密码不一致' }); return; }
        var extra = {
          target: (root.querySelector('.js-target') || {}).value,
          dailyMinutes: parseInt((root.querySelector('.js-min') || {}).value, 10) || undefined,
          examDate: (root.querySelector('.js-date') || {}).value || ''
        };
        var inv = root.querySelector('.js-invite');
        if (inv) extra.inviteCode = inv.value.trim();
        ECCloud.register(u, pw, '', root.querySelector('.js-nick').value.trim(), extra)
          .then(done).catch(bad);
      }
    }

    root.querySelector('.js-submit').addEventListener('click', submit);
    U.$$('.input', root).forEach(function (i) {
      i.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); submit(); }
      });
    });
  }

  function fmtAgo(ts) {
    if (!ts) return '从未';
    var s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (s < 10) return '刚刚';
    if (s < 60) return s + ' 秒前';
    if (s < 3600) return Math.floor(s / 60) + ' 分钟前';
    if (s < 86400) return Math.floor(s / 3600) + ' 小时前';
    return Math.floor(s / 86400) + ' 天前';
  }

  function profileView(root) {
    var s = ECCloud.status();
    var u = s.user || {};
    var S = ECApp.state();
    var created = u.createdAt ? new Date(u.createdAt * 1000).toLocaleDateString() : '—';

    root.innerHTML = '<div class="grid cols-3">' +
      '<section class="card"><h2>👤 ' + U.esc(u.nickname || u.username) + '</h2>' +
      '<p class="hint">用户名：' + U.esc(u.username) + (u.isAdmin ? ' · 管理员' : '') + '</p>' +
      '<p class="hint">注册于 ' + created + '</p>' +
      '<p class="hint">当前阶段：' + U.esc((ECEngine.STAGE_META[S.stage] || {}).name || S.stage) + '</p>' +
      '</section>' +
      '<section class="card"><h2>☁️ 同步状态</h2>' +
      '<p class="' + (s.error ? 'warn-text' : 'ok') + '">' +
      (s.syncing ? '正在同步…' : (s.dirty ? '有待同步的改动' : '已同步')) + '</p>' +
      '<p class="hint">最后同步：' + fmtAgo(s.lastSync) + ' · 云端版本 v' + s.serverVersion + '</p>' +
      (s.conflicts ? '<p class="hint">已自动合并 ' + s.conflicts + ' 次多设备冲突</p>' : '') +
      (s.error ? '<p class="warn-text small">' + U.esc(s.error) + '</p>' : '') +
      '<div class="row"><button class="btn primary small js-sync">立即同步</button>' +
      '<button class="btn ghost small js-pull">从云端拉取并合并</button></div>' +
      '</section>' +
      '<section class="card"><h2>📤 本机备份</h2>' +
      '<p class="hint">云同步之外，建议偶尔导出一份 JSON 存档（换电脑/清浏览器前尤其重要）。</p>' +
      '<div class="row"><button class="btn small js-export">导出备份</button>' +
      '<button class="btn ghost small js-import">导入备份</button></div>' +
      '</section></div>' +

      '<section class="card"><h2>学习目标</h2>' +
      '<div class="form-grid">' +
      '<label>目标阶段<select class="input js-target">' +
      ECEngine.STAGES.map(function (st) {
        return '<option value="' + st + '"' + (u.target === st ? ' selected' : '') + '>' +
          U.esc(ECEngine.STAGE_META[st].name) + '（' + U.esc(ECEngine.STAGE_META[st].tag) + '）</option>';
      }).join('') + '</select></label>' +
      '<label>每日学习时长（分钟）<input class="input js-min" type="number" min="5" max="600" value="' +
      (u.dailyMinutes || 40) + '"></label>' +
      '<label>考试/目标日期<input class="input js-date" type="date" value="' + U.esc(u.examDate || '') + '"></label>' +
      '<label>昵称<input class="input js-nick" value="' + U.esc(u.nickname || '') + '" maxlength="24"></label>' +
      '</div>' +
      '<div class="js-msg"></div>' +
      '<div class="row"><button class="btn primary js-save">保存（同时同步到云端）</button></div>' +
      '</section>' +

      '<section class="card"><h2>安全</h2>' +
      '<div class="form-grid">' +
      '<label>原密码<input class="input js-op" type="password" autocomplete="current-password"></label>' +
      '<label>新密码<input class="input js-np" type="password" autocomplete="new-password" placeholder="至少 8 位，含字母和数字"></label>' +
      '</div>' +
      '<div class="js-pmsg"></div>' +
      '<div class="row"><button class="btn js-pwd">修改密码</button>' +
      '<button class="btn danger js-logout">退出登录</button></div>' +
      '<p class="hint">修改密码后，其它设备上的登录会全部失效，需要重新登录。</p>' +
      '</section>' +

      '<section class="card js-admin"></section>';

    root.querySelector('.js-sync').addEventListener('click', function () {
      ECCloud.flush().then(function (r) {
        U.toast(r ? '已同步到云端' : (ECCloud.status().dirty ? '同步失败' : '没有需要同步的改动'));
        ECApp.refresh();
      });
    });
    root.querySelector('.js-pull').addEventListener('click', function () {
      ECCloud.pullAndMerge().then(function () {
        U.toast('已从云端拉取并合并');
        ECApp.refresh();
      }).catch(function (e) { U.toast('拉取失败：' + e.message, 'bad'); });
    });
    root.querySelector('.js-export').addEventListener('click', function () {
      var blob = new Blob([ECStore.exportText()], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'english-coach-' + ECStore.dayKey() + '.json';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
      U.toast('已导出备份');
    });
    root.querySelector('.js-import').addEventListener('click', function () {
      var inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = '.json,application/json';
      inp.addEventListener('change', function () {
        var f = inp.files[0];
        if (!f) return;
        var fr = new FileReader();
        fr.onload = function () {
          try {
            ECStore.importText(String(fr.result));
            U.toast('导入成功，将自动同步到云端');
            ECCloud.markDirty();
            ECApp.reload();
          } catch (e) { U.toast('导入失败：' + e.message, 'bad'); }
        };
        fr.readAsText(f);
      });
      inp.click();
    });
    root.querySelector('.js-save').addEventListener('click', function () {
      var patch = {
        nickname: root.querySelector('.js-nick').value.trim(),
        target: root.querySelector('.js-target').value,
        dailyMinutes: parseInt(root.querySelector('.js-min').value, 10) || 40,
        examDate: root.querySelector('.js-date').value
      };
      ECCloud.saveProfile(patch).then(function () {
        var S2 = ECApp.state();
        S2.profile.nickname = patch.nickname;
        S2.profile.target = patch.target;
        S2.profile.dailyMinutes = patch.dailyMinutes;
        S2.profile.examDate = patch.examDate;
        ECStore.save(true);
        root.querySelector('.js-msg').innerHTML = '<p class="ok">已保存并同步到云端</p>';
        U.toast('已保存');
      }).catch(function (e) {
        root.querySelector('.js-msg').innerHTML = '<p class="warn-text">' + U.esc(e.message) + '</p>';
      });
    });
    root.querySelector('.js-pwd').addEventListener('click', function () {
      var op = root.querySelector('.js-op').value, np = root.querySelector('.js-np').value;
      ECCloud.status();
      ECApi.changePassword(op, np).then(function () {
        root.querySelector('.js-pmsg').innerHTML = '<p class="ok">密码已修改，其它设备已退出登录</p>';
        U.toast('密码已修改');
      }).catch(function (e) {
        root.querySelector('.js-pmsg').innerHTML = '<p class="warn-text">' + U.esc(e.message) + '</p>';
      });
    });
    root.querySelector('.js-logout').addEventListener('click', function () {
      U.confirmBox('退出登录', '退出后本机仍可继续学习（数据保留在本机），但不再同步到云端。', '退出').then(function (ok) {
        if (!ok) return;
        ECCloud.flush().then(function () { return ECCloud.logout(); }).then(function () {
          U.toast('已退出登录');
          ECApp.refresh();
        });
      });
    });

    if (u.isAdmin) {
      ECApi.adminUsers().then(function (r) {
        var box = root.querySelector('.js-admin');
        if (!box) return;
        box.innerHTML = '<h2>👥 用户管理（共 ' + r.count + ' 人）</h2>' +
          '<table class="tbl"><thead><tr><th>ID</th><th>用户名</th><th>昵称</th><th>阶段</th><th>注册时间</th><th>最近登录</th></tr></thead><tbody>' +
          r.users.map(function (x) {
            return '<tr><td>' + x.id + '</td><td>' + U.esc(x.username) + '</td><td>' + U.esc(x.nickname || '') + '</td>' +
              '<td>' + U.esc(x.stage || '') + '</td>' +
              '<td class="small">' + new Date(x.created_at * 1000).toLocaleString() + '</td>' +
              '<td class="small">' + (x.last_login ? new Date(x.last_login * 1000).toLocaleString() : '—') + '</td></tr>';
          }).join('') + '</tbody></table>' +
          '<h3>注册策略</h3>' +
          '<label class="checkbox-line"><input type="checkbox" class="js-reg-open"> 允许任何人注册账号</label>' +
          '<div class="form-grid"><label>邀请码（留空 = 不需要）' +
          '<input class="input js-invite-code" maxlength="32" placeholder="例如：STUDY2026"></label></div>' +
          '<div class="row"><button class="btn primary small js-save-reg">保存注册策略</button></div>' +
          '<div class="js-reg-msg"></div>';
        var regOpen = box.querySelector('.js-reg-open');
        var invInput = box.querySelector('.js-invite-code');
        ECApi.adminSettings().then(function (st) {
          regOpen.checked = !!st.registrationOpen;
          invInput.value = st.inviteCode || '';
        }).catch(function () { });
        box.querySelector('.js-save-reg').addEventListener('click', function () {
          ECApi.saveAdminSettings({
            registrationOpen: regOpen.checked,
            inviteCode: invInput.value.trim()
          }).then(function (st2) {
            regOpen.checked = !!st2.registrationOpen;
            invInput.value = st2.inviteCode || '';
            box.querySelector('.js-reg-msg').innerHTML =
              '<p class="ok">已保存：' + (st2.registrationOpen ? '开放注册' : '已关闭注册') +
              (st2.inviteCode ? ' · 需要邀请码' : ' · 无需邀请码') + '</p>';
            U.toast('注册策略已保存');
          }).catch(function (e) {
            box.querySelector('.js-reg-msg').innerHTML = '<p class="warn-text">' + U.esc(e.message) + '</p>';
          });
        });
      }).catch(function () { });
    }
  }

  function render(root) {
    var s = ECCloud.status();
    if (!s.online) {
      root.innerHTML = '<section class="card warn-card"><h2>⚠ 后端服务没有运行</h2>' +
        '<p>当前是<strong>纯本机模式</strong>：所有功能都能用，数据保存在这台电脑的浏览器里，但没有账号和云同步。</p>' +
        '<p class="hint">要启用账号与同步，请双击文件夹里的 <code>启动服务器.cmd</code>，' +
        '然后通过 <code>http://127.0.0.1:8788/index.html</code> 打开本页面（不要用 file:// 直接打开）。</p>' +
        '<button class="btn primary js-retry">重新检测后端</button></section>';
      root.querySelector('.js-retry').addEventListener('click', function () {
        U.toast('正在检测…');
        ECCloud.init().then(function (ok) {
          U.toast(ok ? '已连接并登录' : '仍未检测到后端');
          ECApp.refresh();
        });
      });
      return;
    }
    if (!s.loggedIn) { loginForm(root, 'login'); return; }
    profileView(root);
  }

  window.ECViews = window.ECViews || {};
  window.ECViews.account = { title: '我的', render: render };
})();
