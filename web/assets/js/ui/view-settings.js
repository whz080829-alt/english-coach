/* 视图：设置与数据管理 */
(function () {
  'use strict';
  var U = ECUI;

  /* ---------- 安装与分享（PWA / 手机 / 桌面） ---------- */

  function installSection() {
    var st = window.ECInstall ? ECInstall.state() : { available: false, installed: false, ios: false };
    var os = st.ios ? 'ios' : st.android ? 'android' : 'desktop';
    var html = '<section class="card"><h2>📲 安装到手机 / 电脑</h2>';
    if (st.installed) {
      html += '<p class="ok">当前正以「应用」方式运行，体验已是最完整形态。</p>';
    } else {
      html += '<div class="install-box" data-os="' + os + '">';
      if (st.available) {
        html += '<div class="row"><button class="btn primary big js-install-now">📲 一键安装（' +
          (os === 'android' ? 'Android' : os === 'ios' ? 'iOS' : 'Windows / Mac') + '）</button></div>';
      }
      html += '<div class="os-tip ios hint">📱 iPhone / iPad：点 Safari 底部的「分享」按钮 ⬆️ → 选「添加到主屏幕」→ 添加。之后从桌面图标直接打开，全屏无地址栏。</div>' +
        '<div class="os-tip android hint">🤖 Android：点上面的「一键安装」，或浏览器菜单 → 「安装应用 / 添加到主屏幕」。</div>' +
        '<div class="os-tip desktop hint">💻 电脑：Chrome / Edge 地址栏右侧会出现「安装」图标 ⊕（或菜单 → 安装此应用），点击后它会变成一个独立窗口的桌面应用，出现在开始菜单里。</div>' +
        '<p class="hint">安装后离线也能学：语料缓存在本机，联网时自动同步进度。</p>';
      html += '</div>';
    }
    html += '<div class="js-share"></div></section>';
    return html;
  }

  function bindInstall(root) {
    var st = window.ECInstall ? ECInstall.state() : null;
    var btn = root.querySelector('.js-install-now');
    if (btn) {
      btn.addEventListener('click', function () {
        ECInstall.promptInstall().then(function (r) {
          if (r === 'unavailable') {
            U.toast('当前浏览器不支持一键安装，请按下面的文字提示操作', 'mid', 5000);
          }
        });
      });
    }
    var box = root.querySelector('.js-share');
    if (!box || !ECCloud.status().online) {
      if (box) box.innerHTML = '<p class="hint">启动后端后，这里会显示手机扫码入口（后端未连接）。</p>';
      return;
    }
    ECApi.share().then(function (r) {
      if (!r || !r.urls || !r.urls.length) {
        box.innerHTML = '<p class="hint">未能获取局域网地址。</p>';
        return;
      }
      var url = r.urls[0];
      box.innerHTML = '<h3>让手机 / 同学也能用</h3>' +
        '<div class="row" style="align-items:flex-start">' +
        (r.qr ? '<div class="install-qr">' + r.qr + '</div>' : '') +
        '<div><p class="hint">手机连<b>同一个 Wi-Fi</b>，相机扫码或浏览器打开：</p>' +
        '<p><code>' + U.esc(url) + '</code></p>' +
        '<div class="row"><button class="btn small js-copy">复制地址</button></div>' +
        '<p class="hint">打开后注册账号即可使用；登录同一账号，进度在手机和电脑间自动合并。</p></div></div>';
      box.querySelector('.js-copy').addEventListener('click', function () {
        var done = function () { U.toast('已复制：' + url); };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(done, done);
        } else {
          var i = document.createElement('input');
          i.value = url; document.body.appendChild(i); i.select();
          try { document.execCommand('copy'); } catch (e) { }
          document.body.removeChild(i); done();
        }
      });
    }).catch(function () {
      box.innerHTML = '<p class="hint">获取分享地址失败。</p>';
    });
  }

  function render(root) {
    var S = ECApp.state();
    var p = S.profile;
    var voices = (window.ECTTS && ECTTS.voices()) || [];

    root.innerHTML = installSection() +

      '<section class="card"><h2>学习设置</h2>' +
      '<div class="form-grid">' +
      '<label>你的称呼<input class="input js-name" value="' + U.esc(p.nickname || '') + '" placeholder="例如：小王"></label>' +
      '<label>目标阶段<select class="input js-target">' +
      ECEngine.STAGES.map(function (st) {
        return '<option value="' + st + '"' + (p.target === st ? ' selected' : '') + '>' + U.esc(ECEngine.STAGE_META[st].name) + '（' + U.esc(ECEngine.STAGE_META[st].tag) + '）</option>';
      }).join('') + '</select></label>' +
      '<label>每天学习时长（分钟）<input class="input js-min" type="number" min="10" max="240" step="5" value="' + (p.dailyMinutes || 40) + '"></label>' +
      '<label>考试/目标日期<input class="input js-date" type="date" value="' + U.esc(p.examDate || '') + '"></label>' +
      '</div>' +
      '<p class="hint">每日时长直接决定每轮计划的任务量：时间少就把任务切小，但每天都别断。</p>' +
      '<div class="row"><button class="btn primary js-save">保存设置</button>' +
      '<button class="btn ghost js-replan">按新设置重新规划</button></div></section>' +

      '<section class="card"><h2>语音朗读（听力模块）</h2>' +
      (window.ECTTS && ECTTS.supported() ? '' : '<p class="warn-text">当前浏览器不支持语音合成，请用 Chrome 或 Edge 打开。</p>') +
      '<div class="form-grid">' +
      '<label>语速：<b class="js-rate-val">' + (p.ttsRate || 0.9) + '</b>' +
      '<input type="range" class="js-rate" min="0.5" max="1.3" step="0.05" value="' + (p.ttsRate || 0.9) + '"></label>' +
      '<label>音色<select class="input js-voice"><option value="">自动选择（推荐）</option>' +
      voices.map(function (v) {
        return '<option value="' + U.esc(v.name) + '"' + (p.ttsVoice === v.name ? ' selected' : '') + '>' +
          U.esc(v.name + ' (' + v.lang + ')' + (v.localService ? ' · 本地' : '')) + '</option>';
      }).join('') + '</select></label>' +
      '</div>' +
      '<div class="row"><button class="btn js-try">试听一句</button>' +
      '<button class="btn ghost js-refresh-voice">刷新音色列表</button></div>' +
      '<p class="hint">如果听不到声音：确认系统音量、浏览器是否静音，或换一个音色。部分系统需要先与页面交互一次才能播放。</p></section>' +

      '<section class="card"><h2>当前阶段</h2>' +
      '<p class="hint">系统默认按掌握度自动晋级。你也可以手动跳档（比如急着考四级）。</p>' +
      '<div class="row">' + ECEngine.STAGES.map(function (st) {
        return '<button class="btn ' + (S.stage === st ? 'primary' : 'ghost') + ' js-stage" data-s="' + st + '">' +
          U.esc(ECEngine.STAGE_META[st].name) + '</button>';
      }).join('') + '</div></section>' +

      '<section class="card"><h2>数据管理</h2>' +
      '<p class="hint">所有学习数据都存在这台电脑的浏览器里，不会上传。换电脑或清理浏览器前记得导出备份。</p>' +
      '<div class="row"><button class="btn js-export">导出备份（JSON）</button>' +
      '<button class="btn ghost js-import">导入备份</button>' +
      '<button class="btn danger js-reset">清空所有数据</button></div>' +
      '<div class="hint">存储状态：' + (ECStore.storageOK() ? 'localStorage 正常' : '当前环境不能持久化，关闭页面数据会丢失（建议用本地服务器方式打开）') + '</div>' +
      '</section>' +

      '<section class="card"><h2>这个软件怎么用</h2><ol class="bullets">' +
      '<li><b>先摸底</b>：首页点「开始摸底测试」，25 题定起点。</li>' +
      '<li><b>照着计划做</b>：每天打开首页，按顺序点「开始」，做完一项划掉一项。</li>' +
      '<li><b>做完就重排</b>：每完成一项，系统会更新掌握度、错题类型和记忆曲线；一轮做完自动生成下一轮。</li>' +
      '<li><b>看报告</b>：学习报告里的错题标签决定了后续重点，别忽略。</li>' +
      '<li><b>晋级</b>：掌握度达标后首页会出现「晋级测试」，通过就进入下一档。</li>' +
      '</ol></section>';

    root.querySelector('.js-save').addEventListener('click', function () {
      p.nickname = root.querySelector('.js-name').value.trim();
      p.target = root.querySelector('.js-target').value;
      p.dailyMinutes = Math.max(10, Math.min(240, parseInt(root.querySelector('.js-min').value, 10) || 40));
      p.examDate = root.querySelector('.js-date').value;
      ECApp.save();
      U.toast('设置已保存');
      ECApp.refresh();
    });
    root.querySelector('.js-replan').addEventListener('click', function () {
      ECApp.generatePlan();
      U.toast('已按新设置生成计划');
      ECApp.go('#/plan');
    });
    var rate = root.querySelector('.js-rate');
    rate.addEventListener('input', function () {
      root.querySelector('.js-rate-val').textContent = rate.value;
      p.ttsRate = parseFloat(rate.value);
      ECTTS.setRate(p.ttsRate);
      ECApp.save();
    });
    root.querySelector('.js-voice').addEventListener('change', function (e) {
      p.ttsVoice = e.target.value;
      ECTTS.setPreferred(p.ttsVoice);
      ECApp.save();
    });
    root.querySelector('.js-try').addEventListener('click', function () {
      ECTTS.speak('Learning English is a habit, not a sprint. Take one small step every day.', { rate: p.ttsRate });
    });
    root.querySelector('.js-refresh-voice').addEventListener('click', function () {
      ECTTS.refresh();
      U.toast('已刷新（当前 ' + ECTTS.voices().length + ' 个英语音色）');
      ECApp.refresh();
    });
    U.$$('.js-stage', root).forEach(function (b) {
      b.addEventListener('click', function () {
        var st = b.dataset.s;
        U.confirmBox('切换阶段', '切换到「' + ECEngine.STAGE_META[st].name + '」会重新生成学习计划（旧的学习记录与单词记忆会保留）。', '切换').then(function (ok) {
          if (!ok) return;
          var S2 = ECApp.state();
          S2.stage = st;
          if (S2.unlocked.indexOf(st) < 0) S2.unlocked.push(st);
          S2.roundIndex = 0;
          S2.plan = null;
          ECApp.generatePlan();
          U.toast('已切换到 ' + ECEngine.STAGE_META[st].name);
          ECApp.go('#/plan');
        });
      });
    });
    root.querySelector('.js-export').addEventListener('click', function () {
      var blob = new Blob([ECStore.exportText()], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'english-coach-backup-' + ECStore.dayKey() + '.json';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
      U.toast('已导出备份文件');
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
            U.toast('导入成功');
            ECApp.reload();
          } catch (e) { U.toast('导入失败：' + e.message, 'bad'); }
        };
        fr.readAsText(f);
      });
      inp.click();
    });
    root.querySelector('.js-reset').addEventListener('click', function () {
      U.confirmBox('清空所有数据', '这会删除全部学习记录、单词记忆与错题本，且无法恢复。确定吗？', '全部清空').then(function (ok) {
        if (!ok) return;
        ECStore.reset();
        ECApp.reload();
      });
    });

    bindInstall(root);
  }

  window.ECViews = window.ECViews || {};
  window.ECViews.settings = { title: '设置', render: render };
})();
