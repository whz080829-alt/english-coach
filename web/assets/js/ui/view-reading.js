/* 视图：阅读模块 */
(function () {
  'use strict';
  var U = ECUI;
  var P = ECParse;

  function passOf(stage) { return ECEngine.content().reading[stage] || []; }

  function highlight(text, glossary) {
    var html = U.esc(text);
    (glossary || []).forEach(function (g) {
      var term = String(g[0]).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      var re = new RegExp('\\b(' + term + '[a-z]{0,3})\\b', 'gi');
      html = html.replace(re, '<span class="gl" data-tip="' + U.esc(g[0] + ' ' + g[1]) + '">$1</span>');
    });
    return html.split(/\n\s*\n/).map(function (p) { return '<p>' + p + '</p>'; }).join('');
  }

  function readFlow(root, p, stage, timed) {
    var start = Date.now();
    var S = ECApp.state();
    var rec = S.reading[p.id];

    root.innerHTML = '<div class="card reading-card">' +
      '<div class="wc-top"><span class="chip">' + U.esc(ECEngine.STAGE_META[stage].name) + '</span>' +
      '<span class="chip">' + U.esc(p.topic || '阅读') + '</span>' +
      '<span class="hint">' + p.words + ' 词' + (rec && rec.wpm ? ' · 你的最快速度 ' + Math.round(rec.wpm) + ' 词/分' : '') + '</span>' +
      '<span class="timer" id="rd-timer">00:00</span></div>' +
      '<h2>' + U.esc(p.title) + '</h2>' +
      '<p class="hint">带下划线的词可以点一下看中文释义。' + (timed ? '限时：' + Math.ceil(p.words / 80) + ' 分钟内读完。' : '') + '</p>' +
      '<div class="passage-text js-text">' + highlight(p.text, p.glossary) + '</div>' +
      '<div class="row"><button class="btn primary big js-done">我读完了，开始做题 →</button>' +
      '<button class="btn ghost js-book-all">把这篇文章的生词全部加入生词本</button>' +
      '<a class="btn ghost" href="#/reading">返回</a></div></div>';

    var timerEl = root.querySelector('#rd-timer');
    var t = setInterval(function () {
      var s = Math.floor((Date.now() - start) / 1000);
      timerEl.textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
    }, 500);

    U.$$('.gl', root).forEach(function (g) {
      g.addEventListener('click', function () { U.toast(g.dataset.tip, '', 3500); });
    });
    root.querySelector('.js-book-all').addEventListener('click', function () {
      (p.glossary || []).forEach(function (g) {
        var parts = String(g[1]).split(' ');
        var pos = /^[a-z]+\.$/.test(parts[0]) ? parts[0] : '';
        var cn = pos ? parts.slice(1).join(' ') : g[1];
        ECApp.addWordbook({ word: g[0], cn: cn, phonetic: pos, example: '', source: p.title });
      });
      U.toast('已加入生词本：' + (p.glossary || []).length + ' 个');
    });
    root.querySelector('.js-done').addEventListener('click', function () {
      clearInterval(t);
      var minutes = Math.max(0.25, (Date.now() - start) / 60000);
      var wpm = minutes > 0 ? p.words / minutes : 0;
      var items = p.questions.map(function (q) {
        return {
          type: 'choice', q: q.q, options: q.options, answer: q.answer,
          ref: p.id, tag: q.tag, correctAnswer: q.options[q.answer],
          explain: q.explain, passage: p.text, note: '原文可以上下滚动查看；做完题会带你精读。'
        };
      });
      U.quiz(root, {
        title: '阅读理解 · ' + p.title, module: 'reading', items: items,
        onFinish: function (results, meta) {
          var correct = results.filter(function (r) { return r.correct; }).length;
          meta.wpm = wpm;
          meta.passageId = p.id;
          var wrongTags = {};
          results.filter(function (r) { return !r.correct; }).forEach(function (r) {
            var lb = ECEngine.TAG_LABEL[r.tag] || r.tag;
            wrongTags[lb] = (wrongTags[lb] || 0) + 1;
          });
          ECApp.finish('reading', results, meta, {
            after: function (host) {
              host.innerHTML = '<section class="card review-card"><h2>精读回顾 · ' + U.esc(p.title) + '</h2>' +
                '<div class="grid cols-3">' +
                '<div class="stat-card"><span class="stat-num">' + correct + '/' + results.length + '</span><span class="stat-label">本次正确</span></div>' +
                '<div class="stat-card"><span class="stat-num">' + Math.round(wpm) + '</span><span class="stat-label">阅读速度 词/分</span></div>' +
                '<div class="stat-card"><span class="stat-num">' + Math.round(minutes * 10) / 10 + '</span><span class="stat-label">用时（分钟）</span></div>' +
                '</div>' +
                '<p class="hint">参考速度：基础 80~120 词/分，四级 150+，六级 180+，雅思 200+。速度不够就先练"不回读"。</p>' +
                (Object.keys(wrongTags).length ? '<p>错题类型：' + Object.keys(wrongTags).map(function (k) { return '<b>' + U.esc(k) + '</b> ' + wrongTags[k] + ' 题'; }).join('，') + '。这些类型已记入报告。</p>' : '<p>全对，很稳。</p>') +
                '<h3>本篇生词表</h3>' +
                '<table class="tbl"><thead><tr><th>词</th><th>释义</th><th></th></tr></thead><tbody>' +
                (p.glossary || []).map(function (g, i) {
                  return '<tr><td><b>' + U.esc(g[0]) + '</b></td><td>' + U.esc(g[1]) + '</td>' +
                    '<td><button class="btn tiny js-add" data-i="' + i + '">+ 生词本</button></td></tr>';
                }).join('') + '</tbody></table>' +
                '<div class="row"><button class="btn primary js-next">再读一篇 →</button>' +
                '<a class="btn ghost" href="#/plan">回到计划</a></div></section>';
              U.$$('.js-add', host).forEach(function (b) {
                b.addEventListener('click', function () {
                  var g = p.glossary[parseInt(b.dataset.i, 10)];
                  var parts = String(g[1]).split(' ');
                  var pos = /^[a-z]+\.$/.test(parts[0]) ? parts[0] : '';
                  ECApp.addWordbook({ word: g[0], cn: pos ? parts.slice(1).join(' ') : g[1], phonetic: pos, source: p.title });
                  U.toast('已加入生词本');
                });
              });
              host.querySelector('.js-next').addEventListener('click', function () {
                var pool = passOf(stage).filter(function (x) { return x.id !== p.id; });
                if (!pool.length) { ECApp.go('#/reading'); return; }
                readFlow(root, P.shuffle(pool)[0], stage, timed);
              });
            }
          });
        }
      });
    });
  }

  function menu(root) {
    var S = ECApp.state();
    var stage = S.stage;
    var list = passOf(stage);
    var an = ECEngine.analyze(S);
    var wpms = Object.keys(S.reading).map(function (k) { return S.reading[k].wpm || 0; }).filter(function (x) { return x > 0; });
    var avgWpm = wpms.length ? wpms.reduce(function (a, b) { return a + b; }, 0) / wpms.length : 0;

    root.innerHTML = '<section class="card"><h2>阅读 · ' + U.esc(ECEngine.STAGE_META[stage].name) + '</h2>' +
      '<div class="mastery-row">' + U.ring(an.skillMap.reading.mastery, 110) +
      '<div><p class="hint">每篇文章都有生词释义、限时阅读和逐题解析。读的时候不要回读，先抓主旨再看细节。</p>' +
      '<p class="hint">你的平均阅读速度：<b>' + (avgWpm ? Math.round(avgWpm) + ' 词/分' : '暂无记录') + '</b></p>' +
      '<div class="row"><button class="btn primary js-free">精读一篇</button>' +
      '<button class="btn primary js-timed">限时阅读一篇</button></div></div></div></section>' +
      '<section class="card"><h2>文章列表（' + list.length + '）</h2><div class="list-grid">' +
      list.map(function (p) {
        var r = S.reading[p.id];
        return '<div class="l-item" data-id="' + U.esc(p.id) + '">' +
          '<div class="li-head"><b>' + U.esc(p.title) + '</b>' +
          (r ? '<span class="chip ' + (r.acc >= 0.8 ? 'ok' : r.acc >= 0.5 ? 'warn' : 'bad') + '">' + Math.round(r.acc * 100) + '%</span>' : '<span class="chip">未做</span>') + '</div>' +
          '<p class="hint">' + U.esc(p.topic || '') + ' · ' + p.words + ' 词 · ' + p.questions.length + ' 题</p>' +
          '<div class="row"><button class="btn small primary js-read">阅读</button>' +
          '<button class="btn small ghost js-timed-one">限时</button></div></div>';
      }).join('') + '</div></section>';

    root.querySelector('.js-free').addEventListener('click', function () {
      readFlow(root, P.shuffle(list)[0], stage, false);
    });
    root.querySelector('.js-timed').addEventListener('click', function () {
      readFlow(root, P.shuffle(list)[0], stage, true);
    });
    U.$$('.l-item', root).forEach(function (c) {
      var p = list.filter(function (x) { return x.id === c.dataset.id; })[0];
      c.querySelector('.js-read').addEventListener('click', function () { readFlow(root, p, stage, false); });
      c.querySelector('.js-timed-one').addEventListener('click', function () { readFlow(root, p, stage, true); });
    });
  }

  function render(root, params) {
    params = params || {};
    var S = ECApp.state();
    if (params.task !== undefined && params.task !== null && params.task !== '') {
      var plan = S.plan;
      var task = plan && plan.tasks[parseInt(params.task, 10)];
      if (!task) { U.toast('任务不存在'); ECApp.go('#/reading'); return; }
      var refs = task.refs || [];
      var list = passOf(plan.stage);
      var p = list.filter(function (x) { return refs.indexOf(x.id) >= 0; })[0] || P.shuffle(list)[0];
      if (!p) { U.toast('本阶段还没有阅读材料'); return; }
      readFlow(root, p, plan.stage, true);
      return;
    }
    menu(root);
  }

  window.ECViews = window.ECViews || {};
  window.ECViews.reading = { title: '阅读', render: render };
})();
