/* 视图：写作模块 */
(function () {
  'use strict';
  var U = ECUI;
  var P = ECParse;

  function listOf(stage) { return ECEngine.content().writing[stage] || []; }

  function dimBar(name, score, advice) {
    return '<div class="dim"><div class="dim-head"><b>' + U.esc(name) + '</b>' +
      '<span class="' + (score >= 0.8 ? 'ok' : score >= 0.6 ? 'mid' : 'low') + '">' + Math.round(score * 100) + '%</span></div>' +
      U.bar(score, score >= 0.8 ? 'ok' : score >= 0.6 ? 'mid' : 'low') +
      '<ul class="advice">' + (advice || []).map(function (a) { return '<li>' + U.esc(a) + '</li>'; }).join('') + '</ul></div>';
  }

  function resultPage(root, p, stage, g, text, onAgain) {
    var S = ECApp.state();
    var issues = g.issues || [];
    var errors = issues.filter(function (i) { return i.type === 'error'; });
    var warns = issues.filter(function (i) { return i.type !== 'error'; });

    root.innerHTML = '<div class="grid cols-4">' +
      '<div class="stat-card big-stat"><span class="stat-num">' + U.esc(g.band) + '</span><span class="stat-label">本次得分</span></div>' +
      '<div class="stat-card"><span class="stat-num">' + g.words + '</span><span class="stat-label">词数（要求 ≥' + p.minWords + '）</span></div>' +
      '<div class="stat-card"><span class="stat-num">' + g.sentences + '</span><span class="stat-label">句子 / ' + g.paragraphs + ' 段</span></div>' +
      '<div class="stat-card"><span class="stat-num">' + (g.stats.errorPer100).toFixed(1) + '</span><span class="stat-label">每百词问题数</span></div>' +
      '</div>' +

      '<section class="card"><h2>四维评分</h2><div class="dims">' +
      g.dims.map(function (d) { return dimBar(d.name, d.score, d.advice); }).join('') +
      '</div></section>' +

      '<section class="card"><h2>交卷检查清单</h2><ul class="checklist">' +
      g.checklist.map(function (c) {
        return '<li class="' + (c.done ? 'done' : 'todo') + '">' + (c.done ? '✅' : '⬜') + ' ' + U.esc(c.text) + '</li>';
      }).join('') + '</ul></section>' +

      (errors.length ? '<section class="card"><h2>❌ 语法/拼写问题（' + errors.length + '）</h2>' +
        '<table class="tbl"><thead><tr><th>类型</th><th>你的写法</th><th>怎么改</th></tr></thead><tbody>' +
        errors.map(function (i) {
          return '<tr><td><span class="chip bad">' + U.esc(i.label) + '</span></td>' +
            '<td><code>' + U.esc(i.snippet) + '</code></td><td>' + U.esc(i.advice) + '</td></tr>';
        }).join('') + '</tbody></table>' +
        '<p class="hint">这些问题已自动记入错题本，并会影响下一轮计划的重点。</p></section>' : '') +

      (warns.length ? '<section class="card"><h2>⚠ 需要留意的地方（' + warns.length + '）</h2><ul class="bullets">' +
        warns.map(function (i) { return '<li><b>' + U.esc(i.label) + '</b>：' + U.esc(i.advice) + '</li>'; }).join('') + '</ul></section>' : '') +

      (g.upgrades.length ? '<section class="card"><h2>💡 升级你的表达</h2><table class="tbl"><thead><tr><th>你写的</th><th>可以换成</th><th>说明</th></tr></thead><tbody>' +
        g.upgrades.map(function (u) {
          return '<tr><td><code>' + U.esc(u.from) + '</code></td><td><b>' + U.esc(u.to) + '</b></td><td class="hint">' + U.esc(u.tip) + '</td></tr>';
        }).join('') + '</tbody></table></section>' : '') +

      '<section class="card"><h2>范文与亮点表达</h2>' +
      '<p class="hint">先别看范文，自己把上面的问题改一遍，再对照范文找差距，效果最好。</p>' +
      '<details><summary class="btn ghost">点击展开范文</summary>' +
      '<div class="model-essay">' + U.esc(p.model).split(/\n\s*\n/).map(function (x) { return '<p>' + x + '</p>'; }).join('') + '</div>' +
      '<h3>亮点表达</h3><ul class="bullets">' +
      (p.highlights || []).map(function (h) { return '<li><b>' + U.esc(h[0]) + '</b> —— ' + U.esc(h[1]) + '</li>'; }).join('') + '</ul>' +
      '<h3>可套用句式</h3><ul class="chips">' + (p.useful || []).map(function (x) { return '<li>' + U.esc(x) + '</li>'; }).join('') + '</ul>' +
      '</details>' +
      '<h3>你的原文</h3><div class="user-essay">' + U.esc(text).split(/\n\s*\n/).map(function (x) { return '<p>' + x + '</p>'; }).join('') + '</div>' +
      '</section>' +

      '<section class="card"><h2>接下来</h2><div class="row">' +
      '<button class="btn primary js-again">按批改意见重写一遍</button>' +
      '<button class="btn js-next">换一道题</button>' +
      '<button class="btn ghost js-book">把高级表达加入生词本</button>' +
      '<a class="btn ghost" href="#/plan">回到计划</a></div></section>';

    root.querySelector('.js-again').addEventListener('click', onAgain);
    root.querySelector('.js-next').addEventListener('click', function () {
      var pool = listOf(stage).filter(function (x) { return x.id !== p.id; });
      if (!pool.length) { ECApp.go('#/writing'); return; }
      writeFlow(root, P.shuffle(pool)[0], stage);
    });
    root.querySelector('.js-book').addEventListener('click', function () {
      (p.highlights || []).forEach(function (h) {
        ECApp.addWordbook({ word: h[0], cn: h[1], example: '', source: '写作 ' + p.title });
      });
      U.toast('已加入生词本');
    });
  }

  function writeFlow(root, p, stage, draft) {
    var S = ECApp.state();
    S.drafts = S.drafts || {};
    var text = draft !== undefined ? draft : (S.drafts[p.id] || '');
    var start = Date.now();

    root.innerHTML = '<div class="writing-layout">' +
      '<div class="card prompt-card"><div class="wc-top"><span class="chip">' + U.esc(p.type) + '</span>' +
      '<span class="chip">不少于 ' + p.minWords + ' 词</span>' +
      '<span class="hint">' + U.esc(ECEngine.STAGE_META[stage].name) + '</span></div>' +
      '<h2>' + U.esc(p.title) + '</h2>' +
      '<p class="prompt-body">' + U.esc(p.prompt) + '</p>' +
      '<h4>题目要求</h4><ul class="bullets">' + (p.requirements || []).map(function (r) { return '<li>' + U.esc(r) + '</li>'; }).join('') + '</ul>' +
      '<h4>写作提纲</h4><ol class="bullets">' + (p.outline || []).map(function (r) { return '<li>' + U.esc(r) + '</li>'; }).join('') + '</ol>' +
      '<details><summary class="link">先看几个可用句式（会降低难度，自选）</summary><ul class="chips">' +
      (p.useful || []).map(function (x) { return '<li>' + U.esc(x) + '</li>'; }).join('') + '</ul></details>' +
      '</div>' +
      '<div class="card editor-card">' +
      '<div class="editor-bar"><span class="wc-count">0 词</span>' +
      '<span class="hint js-time">00:00</span>' +
      '<span class="hint js-msg">建议先写提纲再动笔</span></div>' +
      '<textarea class="essay-input js-text" placeholder="在这里写你的作文（英文）。写完点下面的按钮，我会按内容/结构/词汇/语法四个维度批改。"></textarea>' +
      '<div class="row"><button class="btn primary js-submit">交卷批改</button>' +
      '<button class="btn ghost js-save">保存草稿</button>' +
      '<button class="btn ghost js-model">直接看范文（不推荐）</button>' +
      '<a class="btn ghost" href="#/writing">返回</a></div>' +
      '<p class="hint">机改用于即时定位问题，最终评分请结合范文与老师意见。</p>' +
      '</div></div>';

    var ta = root.querySelector('.js-text');
    var cnt = root.querySelector('.wc-count');
    ta.value = text;
    function upd() {
      var n = P.countWords(ta.value);
      cnt.textContent = n + ' 词' + (n >= p.minWords ? ' ✅' : '（还差 ' + (p.minWords - n) + '）');
      cnt.className = 'wc-count ' + (n >= p.minWords ? 'ok' : 'low');
    }
    upd();
    ta.addEventListener('input', upd);
    ta.focus();
    var t = setInterval(function () {
      var s = Math.floor((Date.now() - start) / 1000);
      root.querySelector('.js-time').textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
    }, 1000);

    root.querySelector('.js-save').addEventListener('click', function () {
      ECApp.state().drafts[p.id] = ta.value;
      ECApp.save();
      U.toast('草稿已保存');
    });
    root.querySelector('.js-model').addEventListener('click', function () {
      U.confirmBox('确定要看范文吗？', '先自己写一遍，再看范文，效果会好几倍。', '我确定要看').then(function (ok) {
        if (!ok) return;
        U.modal({ title: '范文 · ' + p.title, body: '<div class="model-essay">' + U.esc(p.model).split(/\n\s*\n/).map(function (x) { return '<p>' + x + '</p>'; }).join('') + '</div>' });
      });
    });
    root.querySelector('.js-submit').addEventListener('click', function () {
      var val = ta.value.trim();
      if (P.countWords(val) < 20) { U.toast('至少写 20 个词再交卷吧'); return; }
      clearInterval(t);
      var minutes = Math.max(1, Math.round((Date.now() - start) / 60000));
      var g = ECWriteGrade.grade(val, p, ECApp.state());
      ECApp.state().drafts[p.id] = val;
      // 逐条问题直接进错题本（用于后续重点排课）
      ECEngine.addErrors(ECApp.state(), (g.issues || []).filter(function (i) { return i.type === 'error'; }).map(function (i) {
        return {
          ts: Date.now(), stage: stage, module: 'writing', ref: p.id, tag: i.tag,
          label: i.label, prompt: p.title + ' · ' + i.label, your: i.snippet,
          correctAnswer: i.advice, explain: i.advice, kind: 'writing'
        };
      }));
      ECApp.finish('writing', [{
        ref: p.id, tag: 'grammarw', correct: g.score >= 0.6, score: g.score,
        prompt: p.title, your: val.slice(0, 120), correctAnswer: '见批改页', explain: '机改得分 ' + g.band
      }], { minutes: minutes, score: g.score, words: g.words }, {
        after: function (host) {
          var holder = document.createElement('div');
          host.parentNode.insertBefore(holder, host.nextSibling);
          resultPage(holder, p, stage, g, val, function () { writeFlow(root, p, stage, val); });
        }
      });
    });
  }

  function menu(root) {
    var S = ECApp.state();
    var stage = S.stage;
    var list = listOf(stage);
    var an = ECEngine.analyze(S);
    root.innerHTML = '<section class="card"><h2>写作 · ' + U.esc(ECEngine.STAGE_META[stage].name) + '</h2>' +
      '<div class="mastery-row">' + U.ring(an.skillMap.writing.mastery, 110) +
      '<div><p class="hint">写完立刻拿到批改：内容完成度、篇章结构、词汇丰富度、语法准确度四个维度，' +
      '还会指出中式英语、拼写问题和可以升级的表达。</p>' +
      '<p class="hint">批改发现的问题会自动进入错题本，下一轮计划会针对它们加大练习。</p>' +
      '<button class="btn primary js-free">开始一篇写作</button></div></div></section>' +
      '<section class="card"><h2>题目（' + list.length + '）</h2><div class="list-grid">' +
      list.map(function (p) {
        var r = S.writing[p.id];
        var draft = (S.drafts || {})[p.id];
        return '<div class="l-item" data-id="' + U.esc(p.id) + '">' +
          '<div class="li-head"><b>' + U.esc(p.title) + '</b>' +
          (r && r.best ? '<span class="chip ' + (r.best >= 0.8 ? 'ok' : r.best >= 0.6 ? 'warn' : 'bad') + '">历史最好 ' + Math.round(r.best * 100) + '%</span>' : '<span class="chip">未写</span>') + '</div>' +
          '<p class="hint">' + U.esc(p.type) + ' · 不少于 ' + p.minWords + ' 词' + (draft ? ' · 有草稿' : '') + '</p>' +
          '<p class="hint small">' + U.esc(String(p.prompt).slice(0, 60)) + '…</p>' +
          '<div class="row"><button class="btn small primary js-write">写这篇</button></div></div>';
      }).join('') + '</div></section>';

    root.querySelector('.js-free').addEventListener('click', function () {
      var undone = list.filter(function (p) { return !S.writing[p.id]; });
      writeFlow(root, (undone.length ? undone : list)[0], stage);
    });
    U.$$('.l-item', root).forEach(function (c) {
      var p = list.filter(function (x) { return x.id === c.dataset.id; })[0];
      c.querySelector('.js-write').addEventListener('click', function () { writeFlow(root, p, stage); });
    });
  }

  function render(root, params) {
    params = params || {};
    var S = ECApp.state();
    if (params.task !== undefined && params.task !== null && params.task !== '') {
      var plan = S.plan;
      var task = plan && plan.tasks[parseInt(params.task, 10)];
      if (!task) { U.toast('任务不存在'); ECApp.go('#/writing'); return; }
      var list = listOf(plan.stage);
      var p = list.filter(function (x) { return (task.refs || []).indexOf(x.id) >= 0; })[0] || list[0];
      if (p) writeFlow(root, p, plan.stage);
      return;
    }
    menu(root);
  }

  window.ECViews = window.ECViews || {};
  window.ECViews.writing = { title: '写作', render: render };
})();
