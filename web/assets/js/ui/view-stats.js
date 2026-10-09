/* 视图：学习报告 / 错题本 */
(function () {
  'use strict';
  var U = ECUI;

  function lastDays(n) {
    var out = [];
    var d = new Date();
    d.setDate(d.getDate() - (n - 1));
    for (var i = 0; i < n; i++) {
      var k = ECStore.dayKey(d.getTime());
      out.push({ key: k, label: (d.getMonth() + 1) + '/' + d.getDate() });
      d.setDate(d.getDate() + 1);
    }
    return out;
  }

  function render(root, params) {
    params = params || {};
    if (params.errors) return errorBook(root);
    var S = ECApp.state();
    var d = ECEngine.dashboard(S);
    var days = lastDays(14);
    var maxMin = Math.max(30, Math.max.apply(null, days.map(function (x) {
      return (S.days[x.key] && S.days[x.key].minutes) || 0;
    })));

    var html = '<div class="grid cols-4">' +
      '<div class="stat-card"><span class="stat-num">' + d.overall.streak + '</span><span class="stat-label">连续天数</span></div>' +
      '<div class="stat-card"><span class="stat-num">' + U.fmtDur(d.overall.minutes) + '</span><span class="stat-label">累计学习时长</span></div>' +
      '<div class="stat-card"><span class="stat-num">' + d.overall.items + '</span><span class="stat-label">累计答题</span></div>' +
      '<div class="stat-card"><span class="stat-num">' + Math.round(d.overall.acc * 100) + '%</span><span class="stat-label">总正确率</span></div>' +
      '</div>';

    html += '<section class="card"><h2>近 14 天学习量</h2><div class="chart">' +
      days.map(function (x) {
        var rec = S.days[x.key] || {};
        var h = Math.round(((rec.minutes || 0) / maxMin) * 100);
        var acc = rec.items ? rec.correct / rec.items : null;
        return '<div class="chart-col" title="' + x.key + '：' + (rec.minutes || 0) + ' 分钟 / ' + (rec.items || 0) + ' 题">' +
          '<div class="chart-bar" style="height:' + Math.max(2, h) + '%">' +
          (acc !== null ? '<i style="height:' + Math.round(acc * 100) + '%"></i>' : '') + '</div>' +
          '<span class="chart-x">' + x.label + '</span></div>';
      }).join('') + '</div>' +
      '<p class="hint">柱高 = 学习时长；柱内深色部分 = 当天正确率。</p></section>';

    html += '<section class="card"><h2>五档进度</h2><div class="stage-list">' +
      d.stages.map(function (st) {
        return '<div class="stage-row' + (st.current ? ' current' : '') + (st.unlocked ? '' : ' locked') + '">' +
          '<div class="sr-head"><b>' + U.esc(st.meta.name) + '</b>' +
          '<span class="hint">' + U.esc(st.meta.tag) + '</span>' +
          (st.current ? '<span class="chip ok">当前</span>' : st.unlocked ? '<span class="chip">已解锁</span>' : '<span class="chip">未解锁</span>') +
          '<b class="sr-pct">' + Math.round(st.mastery * 100) + '%</b></div>' +
          '<div class="sr-skills">' + st.skills.map(function (s) {
            return '<div class="sr-skill"><span>' + U.esc(s.name) + '</span>' + U.bar(s.mastery) + '<i>' + Math.round(s.mastery * 100) + '%</i></div>';
          }).join('') + '</div></div>';
      }).join('') + '</div></section>';

    var tags = ECEngine.weakTags(S, null, 12);
    html += '<section class="card"><div class="card-head"><h2>错题本（' + S.errors.length + '）</h2>' +
      '<button class="btn ghost small js-all-errors">查看全部错题 →</button></div>';
    if (!tags.length) {
      html += '<p class="hint">还没有错题记录。做几道题就会出现你的薄弱点分析。</p>';
    } else {
      html += '<div class="tag-cloud">' + tags.map(function (t) {
        return '<span class="chip ' + (t.share > 0.25 ? 'bad' : t.share > 0.12 ? 'warn' : '') + '">' +
          U.esc(t.label) + ' × ' + t.count + '</span>';
      }).join('') + '</div>' +
        '<p class="hint">这些标签决定了下一轮计划的语法与练习重点。</p>';
    }
    html += '</section>';

    html += '<section class="card"><h2>最近学习记录</h2>' +
      (S.sessions.length ? '<table class="tbl"><thead><tr><th>时间</th><th>模块</th><th>阶段</th><th>题数</th><th>正确率</th><th>用时</th></tr></thead><tbody>' +
        S.sessions.slice(0, 15).map(function (s) {
          return '<tr><td class="small">' + U.fmtTime(s.ts) + '</td>' +
            '<td>' + U.esc(ECEngine.SKILL_META[s.module] ? ECEngine.SKILL_META[s.module].name : s.module) + '</td>' +
            '<td>' + U.esc(ECEngine.STAGE_META[s.stage] ? ECEngine.STAGE_META[s.stage].name : s.stage) + '</td>' +
            '<td>' + s.items + '</td><td>' + Math.round((s.acc || 0) * 100) + '%</td><td>' + s.minutes + ' 分钟</td></tr>';
        }).join('') + '</tbody></table>' : '<p class="hint">还没有学习记录。</p>') +
      '</section>';

    root.innerHTML = html;
    root.querySelector('.js-all-errors').addEventListener('click', function () { errorBook(root); });
  }

  function errorBook(root) {
    var S = ECApp.state();
    var filter = '';
    function draw() {
      var list = S.errors.filter(function (e) { return !filter || e.tag === filter; });
      var tags = ECEngine.weakTags(S, null, 20);
      root.innerHTML = '<section class="card"><div class="card-head"><h2>错题本（' + S.errors.length + '）</h2>' +
        '<a class="btn ghost small" href="#/stats">← 返回报告</a></div>' +
        '<div class="tag-cloud"><span class="chip ' + (!filter ? 'ok' : '') + ' js-f" data-t="">全部</span>' +
        tags.map(function (t) {
          return '<span class="chip js-f ' + (filter === t.tag ? 'ok' : '') + '" data-t="' + U.esc(t.tag) + '">' + U.esc(t.label) + ' × ' + t.count + '</span>';
        }).join('') + '</div>' +
        (list.length ? '<table class="tbl"><thead><tr><th>类型</th><th>题目</th><th>你的答案</th><th>正确答案</th><th>解析</th><th></th></tr></thead><tbody>' +
          list.slice(0, 100).map(function (e, i) {
            return '<tr><td><span class="chip">' + U.esc(e.label || e.tag) + '</span></td>' +
              '<td class="small">' + U.esc(String(e.prompt || '').slice(0, 90)) + '</td>' +
              '<td class="small bad-text">' + U.esc(String(e.your === undefined ? '' : e.your).slice(0, 60)) + '</td>' +
              '<td class="small">' + U.esc(String(e.correctAnswer === undefined ? '' : e.correctAnswer).slice(0, 80)) + '</td>' +
              '<td class="small hint">' + U.esc(String(e.explain || '').slice(0, 80)) + '</td>' +
              '<td><button class="icon-btn js-del" data-idx="' + S.errors.indexOf(e) + '">🗑</button></td></tr>';
          }).join('') + '</tbody></table>' +
          '<div class="row"><button class="btn primary js-review">只练这些错题</button>' +
          '<button class="btn ghost js-clear">清空错题本</button></div>'
          : '<p class="hint">这个分类下没有错题。</p>') +
        '</section>';

      U.$$('.js-f', root).forEach(function (c) {
        c.addEventListener('click', function () { filter = c.dataset.t; draw(); });
      });
      U.$$('.js-del', root).forEach(function (b) {
        b.addEventListener('click', function () {
          S.errors.splice(parseInt(b.dataset.idx, 10), 1);
          ECApp.save();
          draw();
        });
      });
      var clear = root.querySelector('.js-clear');
      if (clear) clear.addEventListener('click', function () {
        U.confirmBox('清空错题本', '确定要清空全部错题记录吗？这不会影响单词记忆进度。', '清空').then(function (ok) {
          if (!ok) return;
          S.errors = [];
          ECApp.save();
          draw();
        });
      });
      var rev = root.querySelector('.js-review');
      if (rev) rev.addEventListener('click', function () {
        // 用错题里能重建为选择题的语法题做一次集中练习
        var items = [];
        list.slice(0, 40).forEach(function (e, i) {
          var g = ECEngine.index().grammar[e.ref];
          if (!g) return;
          var ex = g.ex.filter(function (x) { return x.type === 'choice' && x.q === e.prompt; })[0];
          if (!ex) return;
          items.push({
            type: 'choice', q: ex.q, options: ex.options, answer: ex.answer, explain: ex.explain,
            ref: g.id, tag: g.tag, correctAnswer: ex.options[ex.answer]
          });
        });
        if (!items.length) { U.toast('这些错题暂时无法重建为选择题，去对应模块重练吧'); return; }
        U.quiz(root, { title: '错题重练', module: 'grammar', items: ECParse.shuffle(items), onFinish: function (r, m) { ECApp.finish('grammar', r, m); } });
      });
    }
    draw();
  }

  window.ECViews = window.ECViews || {};
  window.ECViews.stats = { title: '学习报告', render: render };
})();
