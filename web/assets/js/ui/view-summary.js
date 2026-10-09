/* 视图：一次学习结束后的复盘 + 下一轮安排 */
(function () {
  'use strict';
  var U = ECUI;

  function render(root) {
    var d = ECApp.lastSummary;
    if (!d) { root.innerHTML = '<section class="card"><p class="hint">没有本次学习记录。</p><a class="btn primary" href="#/plan">回到今日计划</a></section>'; return; }
    var S = ECApp.state();
    var res = d.res;
    var isWriting = d.module === 'writing';
    var name = ECEngine.SKILL_META[d.module] ? ECEngine.SKILL_META[d.module].name : d.module;

    var html = '<section class="card result-card">' +
      '<div class="card-head"><h2>本次「' + U.esc(name) + '」学习完成</h2>' +
      '<span class="hint">' + U.fmtTime(Date.now()) + '</span></div>' +
      '<div class="mastery-row">' +
      (isWriting
        ? U.ring(ECParse.clamp((d.meta && d.meta.score) || 0, 0, 1), 120, Math.round(((d.meta && d.meta.score) || 0) * 100) + '%', '机改得分')
        : U.ring(res.acc, 120, Math.round(res.acc * 100) + '%', '本次正确率')) +
      '<div class="result-stats">' +
      '<div class="rs-row"><span>题量</span><b>' + res.total + ' 题</b></div>' +
      '<div class="rs-row"><span>' + (isWriting ? '词数' : '正确') + '</span><b>' + (isWriting ? ((d.meta && d.meta.words) || 0) + ' 词' : res.correct + ' 题') + '</b></div>' +
      '<div class="rs-row"><span>用时</span><b>' + res.minutes + ' 分钟</b></div>' +
      '<div class="rs-row"><span>今日累计</span><b>' + U.fmtDur(ECStore.dayLog().minutes) + '</b></div>' +
      '</div></div>' +
      (res.acc < 0.6 && !isWriting ? '<p class="warn-text">正确率偏低（' + Math.round(res.acc * 100) + '%）。这些错题已进入错题本，下一轮会加大同类型练习。别急，基础阶段错得多是正常的。</p>' : '') +
      '</section>';

    if (d.changes && d.changes.length) {
      html += '<section class="card"><h2>掌握度变化</h2><table class="tbl"><thead><tr><th>模块</th><th>之前</th><th>现在</th><th>变化</th></tr></thead><tbody>' +
        d.changes.map(function (c) {
          var delta = c.to - c.from;
          return '<tr><td>' + U.esc(c.name) + '</td><td>' + Math.round(c.from * 100) + '%</td>' +
            '<td><b>' + Math.round(c.to * 100) + '%</b></td>' +
            '<td class="' + (delta >= 0 ? 'ok' : 'low') + '">' + (delta >= 0 ? '+' : '') + (delta * 100).toFixed(1) + '%</td></tr>';
        }).join('') + '</tbody></table></section>';
    }

    var plan = S.plan;
    if (d.roundComplete && d.newPlan) {
      html += '<section class="card highlight"><h2>🎯 本轮全部完成，已为你排出第 ' + d.newPlan.roundIndex + ' 轮计划</h2>' +
        '<div class="rationale">' + d.newPlan.rationale.map(function (r) { return '<p>· ' + U.esc(r) + '</p>'; }).join('') + '</div>' +
        '<ul class="tasks mini">' + d.newPlan.tasks.map(function (t) {
          return '<li><b>' + U.esc(t.title) + '</b><span class="hint">' + t.minutes + ' 分钟</span></li>';
        }).join('') + '</ul>' +
        '<div class="row"><a class="btn primary big" href="#/plan">开始新一轮 →</a></div></section>';
    } else if (plan) {
      var remaining = plan.tasks.map(function (t, i) { return { t: t, i: i }; })
        .filter(function (x) { return (plan.done || []).indexOf(x.i) < 0; });
      html += '<section class="card"><h2>本轮还剩 ' + remaining.length + ' 项</h2>' +
        '<ul class="tasks">' + remaining.map(function (x) {
          return '<li class="task"><div class="t-icon">•</div><div class="t-main"><b>' + U.esc(x.t.title) + '</b>' +
            '<p class="reason">' + U.esc(x.t.reason) + '</p></div>' +
            '<div class="t-meta"><span>' + x.t.minutes + ' 分钟</span></div>' +
            '<button class="btn primary js-go" data-i="' + x.i + '">开始</button></li>';
        }).join('') + '</ul>' +
        '<div class="row"><a class="btn ghost" href="#/plan">查看完整计划</a>' +
        '<button class="btn ghost js-replan">学不动了，重新排一轮</button></div></section>';
    }

    html += '<section class="card"><h2>查看</h2><div class="row">' +
      '<a class="btn ghost" href="#/stats?errors=1">打开错题本</a>' +
      '<a class="btn ghost" href="#/stats">学习报告</a>' +
      '<a class="btn ghost" href="#/plan">今日计划</a></div></section>' +
      '<div id="after-host"></div>';

    root.innerHTML = html;

    U.$$('.js-go', root).forEach(function (b) {
      b.addEventListener('click', function () { ECApp.startTask(parseInt(b.dataset.i, 10)); });
    });
    var rp = root.querySelector('.js-replan');
    if (rp) rp.addEventListener('click', function () { ECApp.replan(); });

    var host = root.querySelector('#after-host');
    if (d.opts && typeof d.opts.after === 'function') {
      var box = document.createElement('div');
      host.appendChild(box);
      d.opts.after(box);
    }
  }

  window.ECViews = window.ECViews || {};
  window.ECViews.summary = { title: '学习结果', render: render };
})();
