/* 视图：排行榜 / 打卡日历 / 成就徽章
 * 对标市面产品补齐的激励体系（报告见 docs/benchmark.md）：
 *   热力图（Anki/GitHub 风格）、连续天数、明码排行榜、成就墙。
 * 刻意不做：付费墙、补签卡收费、强制打卡提醒、"AI 教练"弹窗。
 */
(function () {
  'use strict';
  var U = ECUI;

  var TYPES = [
    { key: 'today', label: '今日时长', unit: '分钟' },
    { key: 'total', label: '累计时长', unit: '分钟' },
    { key: 'streak', label: '连续天数', unit: '天' }
  ];

  function heatmap(days) {
    // 与 GitHub 一致的周一起始网格
    var byDay = {};
    days.forEach(function (d) { byDay[d.day] = d; });
    var first = new Date(days[0].day + 'T00:00:00');
    var pad = (first.getDay() + 6) % 7;      // 周一=0
    var cells = [];
    for (var i = 0; i < pad; i++) cells.push(null);
    days.forEach(function (d) { cells.push(d); });
    var max = Math.max(30, days.reduce(function (m, d) { return Math.max(m, d.minutes); }, 0));
    var html = '<div class="heat">';
    var months = [];
    for (var w = 0; w * 7 < cells.length; w++) {
      html += '<div class="heat-col">';
      for (var k = 0; k < 7; k++) {
        var c = cells[w * 7 + k];
        if (!c) { html += '<i class="heat-cell empty"></i>'; continue; }
        var ratio = c.minutes / max;
        var lvl = c.minutes === 0 ? 0 : ratio < 0.25 ? 1 : ratio < 0.5 ? 2 : ratio < 0.75 ? 3 : 4;
        html += '<i class="heat-cell l' + lvl + '" title="' + c.day + '：' + c.minutes + ' 分钟 / ' +
          c.items + ' 题"></i>';
      }
      html += '</div>';
      var d0 = cells[w * 7];
      if (d0) months.push(d0.day.slice(5, 7) + '月');
    }
    html += '</div>';
    html += '<div class="heat-legend"><span class="hint">少</span>' +
      [0, 1, 2, 3, 4].map(function (l) { return '<i class="heat-cell l' + l + '"></i>'; }).join('') +
      '<span class="hint">多</span><span class="hint">（最深 = 单日 ' + max + ' 分钟以上）</span></div>';
    return html;
  }

  function render(root) {
    var s = ECCloud.status();
    if (!s.loggedIn) {
      root.innerHTML = '<section class="card"><h2>🏆 排行榜与打卡日历</h2>' +
        '<p>这些功能需要登录账号（数据存在服务器上才能做排行）。</p>' +
        '<p class="hint">不登录也能用全部学习功能，学习报告在本机也能看。</p>' +
        '<a class="btn primary" href="#/account">去登录 / 注册</a></section>';
      return;
    }

    root.innerHTML = '<div id="social-body"><section class="card"><p class="hint">正在加载…</p></section></div>';
    var body = root.querySelector('#social-body');
    var state = { type: 'today' };

    Promise.all([ECApi.calendar(120), ECApi.stats(), ECApi.achievements()])
      .then(function (res) {
        var cal = res[0], stats = res[1], ach = res[2];
        var html = '<div class="grid cols-4">' +
          '<div class="stat-card"><span class="stat-num">🔥 ' + stats.streak + '</span><span class="stat-label">当前连续天数</span></div>' +
          '<div class="stat-card"><span class="stat-num">' + stats.longestStreak + '</span><span class="stat-label">最长连续天数</span></div>' +
          '<div class="stat-card"><span class="stat-num">' + U.fmtDur(stats.totalMinutes) + '</span><span class="stat-label">累计学习时长</span></div>' +
          '<div class="stat-card"><span class="stat-num">' + Math.round(stats.accuracy * 100) + '%</span><span class="stat-label">总正确率（' + stats.totalItems + ' 题）</span></div>' +
          '</div>';

        html += '<section class="card"><div class="card-head"><h2>打卡日历（近 120 天）</h2>' +
          '<span class="hint">连续 ' + cal.streak + ' 天 · 累计打卡 ' + stats.totalDays + ' 天</span></div>' +
          heatmap(cal.days) +
          (stats.totalDays === 0 ? '<p class="hint">还没有打卡记录，去首页开始第一轮学习吧。</p>' : '') +
          '</section>';

        html += '<section class="card"><h2>学习分布</h2><div class="skill-bars">' +
          ECEngine.SKILLS.map(function (m) {
            var v = (stats.byModule || {})[m] || { minutes: 0, items: 0, correct: 0 };
            var total = Math.max(1, stats.totalMinutes);
            return '<div class="skill-bar"><div class="sb-head"><span>' + ECEngine.SKILL_META[m].icon + ' ' +
              ECEngine.SKILL_META[m].name + '</span><b>' + U.fmtDur(v.minutes) +
              '<i> / ' + v.items + ' 题 / 正确率 ' + (v.items ? Math.round(v.correct / v.items * 100) : 0) + '%</i></b></div>' +
              U.bar(v.minutes / total) + '</div>';
          }).join('') + '</div></section>';

        html += '<section class="card"><div class="card-head"><h2>成就墙（' + ach.unlockedCount + '/' + ach.total + '）</h2></div>' +
          '<div class="badges">' + ach.achievements.map(function (a) {
            return '<div class="badge ' + (a.unlocked ? 'on' : 'off') + '" title="' + U.esc(a.desc) + '">' +
              '<span class="b-icon">' + a.icon + '</span><b>' + U.esc(a.name) + '</b>' +
              '<span class="hint">' + (a.unlocked
                ? new Date(a.unlockedAt).toLocaleDateString() + ' 解锁'
                : U.esc(a.desc)) + '</span></div>';
          }).join('') + '</div></section>';

        html += '<section class="card"><div class="card-head"><h2>排行榜</h2>' +
          '<div class="row" style="margin:0">' + TYPES.map(function (t) {
            return '<button class="btn small ' + (t.key === state.type ? 'primary' : 'ghost') +
              ' js-lb" data-t="' + t.key + '">' + t.label + '</button>';
          }).join('') + '</div></div><div id="lb-body"><p class="hint">加载中…</p></div></section>';

        body.innerHTML = html;
        loadBoard();

        U.$$('.js-lb', root).forEach(function (b) {
          b.addEventListener('click', function () {
            state.type = b.dataset.t;
            U.$$('.js-lb', root).forEach(function (x) {
              x.className = 'btn small ' + (x.dataset.t === state.type ? 'primary' : 'ghost') + ' js-lb';
            });
            loadBoard();
          });
        });

        function loadBoard() {
          var t = TYPES.filter(function (x) { return x.key === state.type; })[0];
          ECApi.leaderboard(state.type, 20).then(function (r) {
            var lb = root.querySelector('#lb-body');
            if (!lb) return;
            if (!r.items.length) {
              lb.innerHTML = '<p class="hint">还没有人上榜，今天学一会儿就能拿第 1。</p>';
              return;
            }
            lb.innerHTML = '<table class="tbl lb-table"><thead><tr><th>#</th><th>同学</th><th>阶段</th>' +
              '<th>' + (state.type === 'streak' ? '连续天数' : '学习时长') + '</th>' +
              '<th>' + (state.type === 'streak' ? '累计时长' : '题量') + '</th>' +
              (state.type === 'today' ? '<th>正确率</th>' : '') + '</tr></thead><tbody>' +
              r.items.map(function (it, i) {
                var medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i + 1);
                var me = s.user && it.userId === s.user.id;
                return '<tr class="' + (me ? 'lb-me' : '') + '"><td>' + medal + '</td>' +
                  '<td>' + U.esc(it.name) + (me ? ' <span class="chip">你</span>' : '') + '</td>' +
                  '<td class="small">' + U.esc((ECEngine.STAGE_META[it.stage] || {}).name || it.stage || '') + '</td>' +
                  '<td><b>' + (state.type === 'streak' ? it.streak : it.minutes) + '</b> ' + t.unit + '</td>' +
                  '<td>' + (state.type === 'streak' ? U.fmtDur(it.minutes) : it.items + ' 题') + '</td>' +
                  (state.type === 'today' ? '<td>' + Math.round((it.accuracy || 0) * 100) + '%</td>' : '') +
                  '</tr>';
              }).join('') + '</tbody></table>' +
              (r.myRank ? '<p class="hint">你的排名：第 ' + r.myRank + ' 名</p>'
                : '<p class="hint">今天还没上榜，学 10 分钟就能进榜。</p>');
          }).catch(function (e) {
            var lb = root.querySelector('#lb-body');
            if (lb) lb.innerHTML = '<p class="warn-text">加载失败：' + U.esc(e.message) + '</p>';
          });
        }
      }).catch(function (e) {
        body.innerHTML = '<section class="card"><h2>加载失败</h2><p class="warn-text">' + U.esc(e.message) +
          '</p><p class="hint">如果后端刚重启，请刷新页面重试。</p></section>';
      });
  }

  window.ECViews = window.ECViews || {};
  window.ECViews.social = { title: '排行榜', render: render };
})();
