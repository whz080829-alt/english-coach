/* 视图：语法模块 */
(function () {
  'use strict';
  var U = ECUI;
  var P = ECParse;

  function pointsOf(stage) { return ECEngine.content().grammar[stage] || []; }

  function masteryOf(S, id) {
    var r = S.grammar[id];
    if (!r || !r.attempts) return null;
    return r.correct / r.attempts;
  }

  function toQuizItems(points) {
    var items = [];
    points.forEach(function (p) {
      p.ex.forEach(function (e) {
        if (e.type === 'choice') {
          items.push({ type: 'choice', q: e.q, options: e.options, answer: e.answer, explain: e.explain, ref: p.id, tag: p.tag, correctAnswer: e.options[e.answer] });
        } else if (e.type === 'fill') {
          items.push({ type: 'fill', q: e.q, answer: e.answer, accept: e.accept, explain: e.explain, ref: p.id, tag: p.tag, correctAnswer: e.answer });
        } else {
          items.push({ type: 'tf', q: e.q, answer: e.answer, explain: e.explain, ref: p.id, tag: p.tag, correctAnswer: e.answer });
        }
      });
    });
    return P.shuffle(items);
  }

  function lecture(root, points, stage, onDone) {
    var i = 0;
    function show() {
      var p = points[i];
      var S = ECApp.state();
      var m = masteryOf(S, p.id);
      root.innerHTML = '<div class="card lecture-card">' +
        '<div class="wc-top"><span class="chip">语法讲解 ' + (i + 1) + ' / ' + points.length + '</span>' +
        (m !== null ? '<span class="hint">该考点历史正确率 ' + Math.round(m * 100) + '%</span>' : '<span class="hint">新考点</span>') + '</div>' +
        '<h2>' + U.esc(p.title) + '</h2>' +
        '<div class="lecture-sec"><h4>要点</h4><ul class="bullets">' +
        p.points.map(function (x) { return '<li>' + U.esc(x) + '</li>'; }).join('') + '</ul></div>' +
        '<div class="lecture-sec"><h4>例句</h4><ul class="examples">' +
        p.examples.map(function (ex) {
          return '<li><p class="en">' + U.esc(ex[0]) + '<button class="icon-btn js-say" data-t="' + U.esc(ex[0]) + '">🔊</button></p><p class="cn">' + U.esc(ex[1]) + '</p></li>';
        }).join('') + '</ul></div>' +
        (p.pitfalls && p.pitfalls.length ? '<div class="lecture-sec warn"><h4>⚠ 易错提醒</h4><ul class="bullets">' +
          p.pitfalls.map(function (x) { return '<li>' + U.esc(x) + '</li>'; }).join('') + '</ul></div>' : '') +
        '<div class="row"><button class="btn primary big js-next">' + (i + 1 < points.length ? '下一个考点 →' : '开始做题 →') + '</button>' +
        (i > 0 ? '<button class="btn ghost js-prev">← 上一个</button>' : '') + '</div>' +
        '</div>';

      U.$$('.js-say', root).forEach(function (b) {
        b.addEventListener('click', function () { ECTTS.speak(b.dataset.t); });
      });
      root.querySelector('.js-next').addEventListener('click', function () {
        i++;
        if (i < points.length) show(); else onDone();
      });
      var prev = root.querySelector('.js-prev');
      if (prev) prev.addEventListener('click', function () { i--; show(); });
    }
    show();
  }

  function practice(root, points, stage, label) {
    var items = toQuizItems(points);
    if (!items.length) { U.toast('这些考点还没有练习题'); ECApp.go('#/grammar'); return; }
    U.quiz(root, {
      title: (label || '语法练习') + ' · ' + points.map(function (p) { return p.title; }).join(' + '),
      module: 'grammar',
      items: items,
      onFinish: function (results, meta) { ECApp.finish('grammar', results, meta); }
    });
  }

  function runPoints(root, points, stage, withLecture) {
    if (withLecture) {
      lecture(root, points, stage, function () { practice(root, points, stage); });
    } else {
      practice(root, points, stage);
    }
  }

  function menu(root) {
    var S = ECApp.state();
    var stage = S.stage;
    var pts = pointsOf(stage);
    var an = ECEngine.analyze(S);

    root.innerHTML = '<section class="card"><h2>语法 · ' + U.esc(ECEngine.STAGE_META[stage].name) + '</h2>' +
      '<div class="mastery-row">' + U.ring(an.skillMap.grammar.mastery, 110) +
      '<div><p class="hint">语法是最容易短期提分的模块。每个考点都是「讲解 → 立刻做题 → 错题自动进错题本」。</p>' +
      '<p class="hint">绿色 = 正确率 ≥ 80%，黄色 = 60%~80%，红色 = &lt; 60%。点考点直接学。</p>' +
      '<button class="btn primary js-weak">刷最弱的 3 个考点</button></div></div></section>' +
      '<section class="card"><h2>考点清单（' + pts.length + '）</h2><div class="grammar-grid">' +
      pts.map(function (p) {
        var m = masteryOf(S, p.id);
        var cls = m === null ? 'new' : m >= 0.8 ? 'ok' : m >= 0.6 ? 'mid' : 'low';
        var r = S.grammar[p.id];
        return '<div class="g-point ' + cls + '" data-id="' + U.esc(p.id) + '">' +
          '<div class="gp-head"><b>' + U.esc(p.title) + '</b><span class="gp-badge ' + cls + '">' +
          (m === null ? '未学' : Math.round(m * 100) + '%') + '</span></div>' +
          '<p class="hint">' + U.esc(p.points[0] || '') + '</p>' +
          '<div class="gp-foot"><span class="hint">' + (r ? '做过 ' + r.attempts + ' 题' : '还没做过') + ' · 练习 ' + p.ex.length + ' 题</span>' +
          '<span class="link">讲解 + 练习 →</span></div></div>';
      }).join('') + '</div></section>';

    U.$$('.g-point', root).forEach(function (c) {
      c.addEventListener('click', function () {
        var p = pts.filter(function (x) { return x.id === c.dataset.id; })[0];
        if (p) runPoints(root, [p], stage, true);
      });
    });
    root.querySelector('.js-weak').addEventListener('click', function () {
      var weak = ECEngine.pickWeakGrammar(ECApp.state(), stage, 3);
      if (weak.length) runPoints(root, weak, stage, true);
    });
  }

  function render(root, params) {
    params = params || {};
    var S = ECApp.state();
    var stage = S.stage;
    if (params.task !== undefined && params.task !== null && params.task !== '') {
      var plan = S.plan;
      var task = plan && plan.tasks[parseInt(params.task, 10)];
      if (!task) { U.toast('任务不存在'); ECApp.go('#/grammar'); return; }
      var refs = task.refs || [];
      var pts = pointsOf(plan.stage).filter(function (p) { return refs.indexOf(p.id) >= 0; });
      if (!pts.length) pts = ECEngine.pickWeakGrammar(S, plan.stage, 2);
      runPoints(root, pts, plan.stage, true);
      return;
    }
    menu(root);
  }

  window.ECViews = window.ECViews || {};
  window.ECViews.grammar = { title: '语法', render: render };
})();
