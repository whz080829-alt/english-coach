/* 视图：听力模块 */
(function () {
  'use strict';
  var U = ECUI;
  var P = ECParse;

  function itemsOf(stage) { return ECEngine.content().listening[stage] || []; }
  function dictationOf(stage) { return ECEngine.content().dictation[stage] || []; }

  function scriptText(it) {
    return it.script.map(function (l) { return (it.kind === 'dialogue' ? l[0] + ': ' : '') + l[1]; }).join('\n');
  }

  function toQuizItems(it, includeScriptInExplain) {
    var lines = scriptText(it);
    return it.questions.map(function (q) {
      return {
        type: 'choice', q: q.q, options: q.options, answer: q.answer,
        ref: it.id, tag: q.tag, correctAnswer: q.options[q.answer],
        explain: q.explain + (includeScriptInExplain === false ? '' : '\n\n原文：\n' + lines),
        audio: it.script, note: '🎧 先听完整对话，再作答。可以反复听，也可以点「慢速」。'
      };
    });
  }

  function toDictationItems(sentences) {
    return sentences.map(function (d) {
      return {
        type: 'dictation', ref: d.id, tag: 'spelling', text: d.text, cn: d.cn,
        audio: d.text, q: '听写', correctAnswer: d.text,
        explain: '听写句：' + d.text
      };
    });
  }

  function runQuiz(root, items, label) {
    if (!items.length) { U.toast('没有可用材料'); return; }
    U.quiz(root, {
      title: label, module: 'listening', items: items,
      onFinish: function (results, meta) { ECApp.finish('listening', results, meta); }
    });
  }

  // 逐句精听
  function intensive(root, it) {
    root.innerHTML = '<div class="card"><div class="wc-top"><span class="chip">逐句精听</span>' +
      '<a class="link" href="#/listening">返回听力</a></div>' +
      '<h2>' + U.esc(it.title) + '</h2>' +
      '<div class="row"><button class="btn primary js-all">▶ 整段播放</button>' +
      '<button class="btn ghost js-slowall">🐢 整段慢速</button>' +
      '<button class="btn ghost js-hide">隐藏/显示原文</button></div>' +
      '<ul class="script-list js-lines">' + it.script.map(function (l, i) {
        return '<li><span class="spk">' + U.esc(l[0]) + '</span>' +
          '<span class="txt">' + U.esc(l[1]) + '</span>' +
          '<button class="icon-btn js-line" data-i="' + i + '">🔊</button></li>';
      }).join('') + '</ul>' +
      '<div class="hint">先盲听整段，再逐句听写/跟读，最后对照原文。这一步最能提升辨音能力。</div>' +
      '<div class="row"><button class="btn primary js-quiz">做这段的题 →</button></div></div>';

    root.querySelector('.js-all').addEventListener('click', function () { ECTTS.speakScript(it.script); });
    root.querySelector('.js-slowall').addEventListener('click', function () { ECTTS.speakScript(it.script, { rate: 0.65 }); });
    root.querySelector('.js-hide').addEventListener('click', function () {
      root.querySelector('.js-lines').classList.toggle('blurred');
    });
    U.$$('.js-line', root).forEach(function (b) {
      b.addEventListener('click', function () { ECTTS.speak(it.script[parseInt(b.dataset.i, 10)][1]); });
    });
    root.querySelector('.js-quiz').addEventListener('click', function () {
      runQuiz(root, toQuizItems(it), '听力理解 · ' + it.title);
    });
  }

  function menu(root) {
    var S = ECApp.state();
    var stage = S.stage;
    var list = itemsOf(stage);
    var dict = dictationOf(stage);
    var an = ECEngine.analyze(S);
    var ttsOK = window.ECTTS && ECTTS.supported();

    root.innerHTML = (ttsOK ? '' :
      '<section class="card warn-card"><h3>⚠ 当前浏览器不支持语音合成</h3>' +
      '<p>听力模块需要浏览器的语音朗读功能。请用 Chrome / Edge 打开本应用；此时你仍可做「看原文练习」以外的其它模块。</p></section>') +

      '<section class="card"><h2>听力 · ' + U.esc(ECEngine.STAGE_META[stage].name) + '</h2>' +
      '<div class="mastery-row">' + U.ring(an.skillMap.listening.mastery, 110) +
      '<div><p class="hint">听力由两部分组成：<b>听力理解</b>（听对话/独白后答题）与 <b>听写</b>（把听到的句子写下来）。' +
      '听写最能暴露"听得懂但写不对"的问题。</p>' +
      '<div class="row">' +
      '<button class="btn primary js-free">听力理解 ' + Math.min(1, list.length) + ' 段</button>' +
      '<button class="btn primary js-dict">听写 6 句</button>' +
      '<button class="btn ghost js-dict10">听写 12 句</button>' +
      '<span class="hint">语速：</span>' +
      '<button class="btn tiny js-rate" data-r="0.65">慢</button>' +
      '<button class="btn tiny js-rate" data-r="0.9">中</button>' +
      '<button class="btn tiny js-rate" data-r="1.1">快</button>' +
      '</div></div></div></section>' +

      '<section class="card"><h2>听力材料（' + list.length + '）</h2><div class="list-grid">' +
      list.map(function (it) {
        var r = S.listening[it.id];
        return '<div class="l-item" data-id="' + U.esc(it.id) + '">' +
          '<div class="li-head"><b>' + U.esc(it.title) + '</b>' +
          (r ? '<span class="chip ' + (r.acc >= 0.8 ? 'ok' : r.acc >= 0.5 ? 'warn' : 'bad') + '">' + Math.round(r.acc * 100) + '%</span>' : '<span class="chip">未做</span>') + '</div>' +
          '<p class="hint">' + (it.kind === 'dialogue' ? '对话' : it.kind === 'monologue' ? '独白' : '通知/广播') +
          ' · ' + it.questions.length + ' 题 · ' + it.script.length + ' 句</p>' +
          '<div class="row"><button class="btn small primary js-do">做题</button>' +
          '<button class="btn small ghost js-int">逐句精听</button></div></div>';
      }).join('') + '</div></section>' +

      '<section class="card"><h2>听写句库（' + dict.length + '）</h2>' +
      '<p class="hint">按难度排序，一次练 6~12 句效果最好。</p>' +
      '<div class="dict-list">' + dict.slice(0, 12).map(function (d) {
        return '<div class="dict-row"><button class="icon-btn js-play" data-t="' + U.esc(d.text) + '">🔊</button>' +
          '<span class="small">' + U.esc(d.text) + '</span><span class="hint">' + U.esc(d.cn) + '</span></div>';
      }).join('') + '</div></section>';

    function pick(n, exclude) {
      var pool = list.slice();
      if (exclude) pool = pool.filter(function (x) { return x.id !== exclude.id; });
      return P.shuffle(pool).slice(0, n);
    }

    root.querySelector('.js-free').addEventListener('click', function () {
      var its = pick(2);
      var items = [];
      its.forEach(function (it) { items = items.concat(toQuizItems(it)); });
      runQuiz(root, items, '听力理解 ' + its.length + ' 段');
    });
    root.querySelector('.js-dict').addEventListener('click', function () {
      runQuiz(root, toDictationItems(P.shuffle(dict).slice(0, 6)), '听写 6 句');
    });
    root.querySelector('.js-dict10').addEventListener('click', function () {
      runQuiz(root, toDictationItems(P.shuffle(dict).slice(0, 12)), '听写 12 句');
    });
    U.$$('.js-rate', root).forEach(function (b) {
      b.addEventListener('click', function () {
        var r = parseFloat(b.dataset.r);
        ECTTS.setRate(r);
        ECApp.state().profile.ttsRate = r;
        ECApp.save();
        U.toast('语速已设为 ' + r);
      });
    });
    U.$$('.l-item', root).forEach(function (c) {
      var it = list.filter(function (x) { return x.id === c.dataset.id; })[0];
      c.querySelector('.js-do').addEventListener('click', function () { runQuiz(root, toQuizItems(it), '听力理解 · ' + it.title); });
      c.querySelector('.js-int').addEventListener('click', function () { intensive(root, it); });
    });
    U.$$('.js-play', root).forEach(function (b) {
      b.addEventListener('click', function () { ECTTS.speak(b.dataset.t); });
    });
  }

  function render(root, params) {
    params = params || {};
    var S = ECApp.state();
    if (params.task !== undefined && params.task !== null && params.task !== '') {
      var plan = S.plan;
      var task = plan && plan.tasks[parseInt(params.task, 10)];
      if (!task) { U.toast('任务不存在'); ECApp.go('#/listening'); return; }
      var stage = plan.stage;
      if (task.kind === 'dictation') {
        var d = P.shuffle(dictationOf(stage)).slice(0, task.count);
        runQuiz(root, toDictationItems(d), '听写训练 ' + d.length + ' 句');
      } else {
        var refs = task.refs || [];
        var its = itemsOf(stage).filter(function (x) { return refs.indexOf(x.id) >= 0; });
        if (!its.length) its = P.shuffle(itemsOf(stage)).slice(0, task.count || 2);
        var items = [];
        its.forEach(function (it) { items = items.concat(toQuizItems(it)); });
        runQuiz(root, items, '听力理解 ' + its.length + ' 段');
      }
      return;
    }
    menu(root);
  }

  window.ECViews = window.ECViews || {};
  window.ECViews.listening = { title: '听力', render: render };
})();
