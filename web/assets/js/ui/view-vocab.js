/* 视图：单词模块 */
(function () {
  'use strict';
  var U = ECUI;
  var P = ECParse;

  var STATUS_LABEL = { new: '未学', learning: '学习中', review: '复习中', mastered: '已掌握' };

  function wordsOf(stage) { return ECEngine.content().vocab[stage] || []; }

  function cardOf(S, id) { return S.words[id]; }

  function clozeOf(w) {
    var ws = P.words(w.example);
    var root = w.word.toLowerCase().replace(/[^a-z]/g, '');
    root = root.slice(0, Math.max(4, root.length - 2));
    var target = null;
    for (var i = 0; i < ws.length; i++) {
      if (ws[i].indexOf(root) === 0) { target = ws[i]; break; }
    }
    if (!target) return null;
    var re = new RegExp('\\b' + target + '\\b', 'i');
    if (!re.test(w.example)) return null;
    return {
      q: w.example.replace(re, '______') + '　（' + w.exampleCn + '）',
      answer: target, accept: [target, w.word]
    };
  }

  function distractors(stage, w, n) {
    var pool = wordsOf(stage).filter(function (x) { return x.id !== w.id; });
    return P.shuffle(pool).slice(0, n || 3);
  }

  // 为一个单词生成 1~2 道测验题；limit=1 时只出 1 题（大批量复习用）
  function quizItemsFor(w, stage, mode, limit) {
    var out = [];
    var forms = mode === 'spell' ? ['spell', 'en2cn'] : P.shuffle(['en2cn', 'spell', 'cloze', 'cn2en']);
    forms.slice(0, limit || 2).forEach(function (f) {
      if (f === 'en2cn') {
        var d = distractors(stage, w, 3);
        var opts = P.shuffle([w].concat(d));
        out.push({
          type: 'choice', ref: w.id, tag: 'vocabq', wordRef: w,
          q: '“' + w.word + '” 的意思是？',
          options: opts.map(function (o) { return o.cn; }),
          answer: opts.indexOf(w),
          correctAnswer: w.cn,
          explain: w.word + ' ' + w.phonetic + ' ' + w.pos + ' ' + w.cn + '　例：' + w.example,
          audio: w.word
        });
      } else if (f === 'cn2en') {
        var d2 = distractors(stage, w, 3);
        var opts2 = P.shuffle([w].concat(d2));
        out.push({
          type: 'choice', ref: w.id, tag: 'vocabq',
          q: '“' + w.cn + '” 对应的英文单词是？',
          options: opts2.map(function (o) { return o.word; }),
          answer: opts2.indexOf(w),
          correctAnswer: w.word,
          explain: w.word + ' ' + w.phonetic + ' ' + w.pos
        });
      } else if (f === 'spell') {
        out.push({
          type: 'spell', ref: w.id, tag: 'spelling', word: w.word,
          cn: w.cn, phonetic: w.phonetic, pos: w.pos,
          comment: w.colloc && w.colloc.length ? '搭配：' + w.colloc.join(' / ') : '',
          example: w.example, exampleCn: w.exampleCn,
          correctAnswer: w.word
        });
      } else if (f === 'cloze') {
        var c = clozeOf(w);
        if (c) {
          out.push({
            type: 'fill', ref: w.id, tag: 'wordchoice', wordRef: w,
            q: c.q, answer: c.answer, accept: c.accept,
            correctAnswer: c.answer,
            explain: w.word + ' ' + w.pos + ' ' + w.cn
          });
        }
      }
    });
    return out;
  }

  /* ---------- 词卡学习 ---------- */
  function studyCards(root, words, stage, onDone) {
    var queue = words.slice();
    var again = [];
    var idx = 0;
    var learned = 0;

    function next() {
      if (!queue.length) {
        if (again.length) {
          queue = again.slice();
          again = [];
          return next();
        }
        document.onkeydown = null;
        onDone(learned);
        return;
      }
      var w = queue.shift();
      var S = ECApp.state();
      var card = S.words[w.id];
      root.innerHTML = '<div class="card word-card">' +
        '<div class="wc-top">' +
        '<span class="chip">' + U.esc(ECEngine.STAGE_META[stage].name) + '</span>' +
        '<span class="hint">还剩 ' + (queue.length + again.length + 1) + ' 张 · 已学 ' + learned + '</span>' +
        '</div>' +
        '<div class="wc-word">' + U.esc(w.word) +
        '<button class="icon-btn js-say" title="朗读">🔊</button></div>' +
        '<div class="wc-phon">' + U.esc(w.phonetic) + '　<span class="pos">' + U.esc(w.pos) + '</span></div>' +
        '<div class="wc-cn">' + U.esc(w.cn) + '</div>' +
        (card && card.wrong ? '<div class="hint">这个词你错过 ' + card.wrong + ' 次，重点看</div>' : '') +
        (card ? '<div class="hint wc-rung">记忆等级：第 ' + (ECEngine.rungOf(card) + 1) + ' / ' +
          ECEngine.RUNGS.length + ' 级 · 下次复习 ' + ECEngine.nextReviewText(card) + '</div>' : '') +
        '<div class="wc-ex"><p class="en">' + U.esc(w.example) + '<button class="icon-btn js-say-ex" title="朗读例句">🔊</button></p>' +
        '<p class="cn">' + U.esc(w.exampleCn) + '</p></div>' +
        (w.colloc.length ? '<div class="wc-colloc">常用搭配：' + w.colloc.map(function (c) { return '<code>' + U.esc(c) + '</code>'; }).join(' ') + '</div>' : '') +
        '<div class="wc-actions wc-grade">' +
        '<button class="btn primary big js-know" title="认识（间隔 +1 档）">😀 认识</button>' +
        '<button class="btn js-vague" title="模糊（当天再考一次，间隔不前进）">🤔 模糊</button>' +
        '<button class="btn js-forget" title="忘记（退两级，当天再考一次）">😵 忘记</button>' +
        '<button class="btn js-easy" title="熟知（间隔 +2 档）">🚀 太简单</button>' +
        '<button class="btn ghost js-book">加入生词本</button>' +
        '</div>' +
        '<div class="hint wc-tip">先自己读一遍、想一遍意思，再按真实感觉点四档之一 —— ' +
        '诚实自评比"全点认识"有用得多。看完所有词卡马上做测验。</div>' +
        '</div>';

      root.querySelector('.js-say').addEventListener('click', function () { ECTTS.speak(w.word); });
      root.querySelector('.js-say-ex').addEventListener('click', function () { ECTTS.speak(w.example); });
      ECTTS.speak(w.word);

      // 四档自评：5=认识 6=熟知 3=模糊 1=忘记
      function grade(quality, requeue) {
        var c = ECEngine.reviewWord(ECApp.state(), w.id, quality);
        ECApp.save();
        U.toast((requeue ? '稍后再考你一次 · ' : '') +
          '下次复习：' + ECEngine.nextReviewText(c) + '（第 ' + (ECEngine.rungOf(c) + 1) + ' 级）', '', 2200);
        if (requeue) again.push(w); else learned++;
        next();
      }
      root.querySelector('.js-know').addEventListener('click', function () { grade(5, false); });
      root.querySelector('.js-easy').addEventListener('click', function () { grade(6, false); });
      root.querySelector('.js-vague').addEventListener('click', function () { grade(3, true); });
      root.querySelector('.js-forget').addEventListener('click', function () { grade(1, true); });
      root.querySelector('.js-book').addEventListener('click', function () {
        ECApp.addWordbook({ word: w.word, cn: w.cn, example: w.example, phonetic: w.phonetic, source: '单词学习' });
        U.toast('已加入生词本');
      });
      document.onkeydown = function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); root.querySelector('.js-know').click(); }
        else if (e.key === '1') root.querySelector('.js-forget').click();
        else if (e.key === '2') root.querySelector('.js-vague').click();
        else if (e.key === '3') root.querySelector('.js-know').click();
        else if (e.key === '4') root.querySelector('.js-easy').click();
      };
    }
    next();
  }

  /* ---------- 测验 ---------- */
  function runQuiz(root, words, stage, mode, label, perWord) {
    var items = [];
    words.forEach(function (w) {
      quizItemsFor(w, stage, mode, perWord).forEach(function (it) { items.push(it); });
    });
    items = P.shuffle(items);
    if (!items.length) { U.toast('没有可练习的单词'); ECApp.go('#/vocab'); return; }
    U.quiz(root, {
      title: (label || '单词测验') + '（' + words.length + ' 个词 / ' + items.length + ' 题）',
      module: 'vocab',
      items: items,
      onFinish: function (results, meta) {
        ECApp.finish('vocab', results, meta);
      }
    });
  }

  /* ---------- 任务入口 ---------- */
  function fromTask(root, params) {
    var S = ECApp.state();
    var plan = S.plan;
    var task = plan && plan.tasks[parseInt(params.task, 10)];
    if (!task) { U.toast('任务不存在'); ECApp.go('#/vocab'); return; }
    var stage = plan.stage;
    var all = wordsOf(stage);
    var words = (task.refs || []).map(function (id) {
      return all.filter(function (w) { return w.id === id; })[0] || ECEngine.index().word[id];
    }).filter(Boolean);
    if (!words.length) {
      words = (task.kind === 'review' ? ECEngine.dueWords(S) : ECEngine.pickNewWords(S, stage, task.count));
      words = words.map(function (x) { return x.word || x; });
    }
    if (task.kind === 'new') {
      studyCards(root, words, stage, function () {
        runQuiz(root, words, stage, null, '新词过关测验');
      });
    } else {
      runQuiz(root, words, stage, null, '复习测验', words.length > 20 ? 1 : 2);
    }
  }

  /* ---------- 首页 ---------- */
  function menu(root) {
    var S = ECApp.state();
    var stage = S.stage;
    var all = wordsOf(stage);
    var seen = all.filter(function (w) { return S.words[w.id]; });
    var mastered = all.filter(function (w) { return S.words[w.id] && S.words[w.id].status === 'mastered'; });
    var due = ECEngine.dueWords(S);
    var newLeft = all.length - seen.length;
    var an = ECEngine.analyze(S);

    root.innerHTML = '<div class="grid cols-3">' +
      '<section class="card clickable" data-mode="new"><h3>📖 学新词</h3>' +
      '<p class="hint">本阶段还剩 <b>' + newLeft + '</b> 个没学</p><span class="btn primary">开始学新词</span></section>' +
      '<section class="card clickable" data-mode="review"><h3>🔁 复习到期</h3>' +
      '<p class="hint">现在到期的词有 <b>' + due.length + '</b> 个</p><span class="btn primary">开始复习</span></section>' +
      '<section class="card clickable" data-mode="test"><h3>🎯 混合测试</h3>' +
      '<p class="hint">从已学过的词里随机抽测</p><span class="btn primary">开始测试</span></section>' +
      '</div>' +

      '<section class="card"><h2>本阶段词汇进度 · ' + U.esc(ECEngine.STAGE_META[stage].name) + '</h2>' +
      '<div class="mastery-row">' + U.ring(an.skillMap.vocab.mastery, 110) +
      '<div class="skill-bars">' +
      '<div class="skill-bar"><div class="sb-head"><span>已学 / 总数</span><b>' + seen.length + ' / ' + all.length + '</b></div>' + U.bar(all.length ? seen.length / all.length : 0) + '</div>' +
      '<div class="skill-bar"><div class="sb-head"><span>已掌握</span><b class="ok">' + mastered.length + '</b></div>' + U.bar(all.length ? mastered.length / all.length : 0, 'ok') + '</div>' +
      '<div class="skill-bar"><div class="sb-head"><span>待复习</span><b class="low">' + due.length + '</b></div>' + U.bar(all.length ? due.length / all.length : 0, 'low') + '</div>' +
      '</div></div></section>' +

      '<section class="card"><div class="card-head"><h2>生词本（' + (S.wordbook || []).length + '）</h2>' +
      '<button class="btn ghost small js-open-book">查看生词本</button></div>' +
      '<p class="hint">阅读、听力、写作中不认识或拼错的词，都可以一键存进生词本，在这里集中攻克。</p></section>' +

      '<section class="card"><div class="card-head"><h2>单词表</h2>' +
      '<input class="input js-search" placeholder="搜索单词或中文释义" style="max-width:240px"></div>' +
      '<div class="word-table-wrap"><table class="tbl word-table"><thead><tr><th>单词</th><th>词性</th><th>释义</th><th>状态</th><th>正确率</th></tr></thead>' +
      '<tbody>' + all.map(function (w) {
        var c = S.words[w.id];
        var rate = c ? ECEngine.passRate(c) : 0;
        return '<tr data-w="' + U.esc((w.word + ' ' + w.cn).toLowerCase()) + '">' +
          '<td><b>' + U.esc(w.word) + '</b><span class="phon">' + U.esc(w.phonetic) + '</span></td>' +
          '<td>' + U.esc(w.pos) + '</td><td>' + U.esc(w.cn) + '</td>' +
          '<td><span class="dot ' + (c ? c.status : 'new') + '"></span>' + (c ? STATUS_LABEL[c.status] : '未学') + '</td>' +
          '<td>' + (c ? Math.round(rate * 100) + '%' : '—') + '</td></tr>';
      }).join('') + '</tbody></table></div></section>';

    U.$$('.card.clickable', root).forEach(function (c) {
      c.addEventListener('click', function () { freeSession(root, c.dataset.mode); });
    });
    root.querySelector('.js-open-book').addEventListener('click', function () { wordbook(root); });
    var search = root.querySelector('.js-search');
    search.addEventListener('input', function () {
      var q = search.value.trim().toLowerCase();
      U.$$('.word-table tbody tr', root).forEach(function (tr) {
        tr.style.display = !q || tr.dataset.w.indexOf(q) >= 0 ? '' : 'none';
      });
    });
  }

  function freeSession(root, mode) {
    var S = ECApp.state();
    var stage = S.stage;
    if (mode === 'new') {
      var newLeft = wordsOf(stage).filter(function (w) { return !S.words[w.id]; }).length;
      root.innerHTML = '<section class="card"><h2>学新词 · ' + U.esc(ECEngine.STAGE_META[stage].name) + '</h2>' +
        '<p class="hint">本阶段还有 ' + newLeft + ' 个新词。一次建议 10~25 个，学完立刻测验记得最牢。</p>' +
        '<div class="row">' + [10, 15, 20, 30].map(function (n) {
          return '<button class="btn primary js-n" data-n="' + n + '">' + n + ' 个</button>';
        }).join('') + '<a class="btn ghost" href="#/vocab">返回</a></div></section>';
      U.$$('.js-n', root).forEach(function (b) {
        b.addEventListener('click', function () {
          var n = parseInt(b.dataset.n, 10);
          var words = ECEngine.pickNewWords(ECApp.state(), stage, n);
          if (!words.length) { U.toast('本阶段新词已经学完了，去复习或进入下一阶段吧'); return; }
          studyCards(root, words, stage, function () { runQuiz(root, words, stage, null, '新词过关测验'); });
        });
      });
      return;
    }
    if (mode === 'review') {
      var due = ECEngine.dueWords(S);
      if (!due.length) { U.toast('太棒了，现在没有到期的单词'); return; }
      var words = due.slice(0, 40).map(function (x) { return x.word; }).filter(Boolean);
      runQuiz(root, words, stage, null, '到期复习', words.length > 20 ? 1 : 2);
      return;
    }
    // 混合测试
    var learned = wordsOf(stage).filter(function (w) { return S.words[w.id]; });
    if (learned.length < 4) { U.toast('学过的词还太少，先学新词吧'); return; }
    var pick = P.shuffle(learned).slice(0, 20);
    runQuiz(root, pick, stage, null, '混合抽测');
  }

  function wordbook(root) {
    var S = ECApp.state();
    var list = S.wordbook || [];
    if (!list.length) {
      root.innerHTML = '<section class="card"><h2>生词本</h2><p class="hint">还空的。在阅读、听力、写作里点「加入生词本」就会存到这里。</p>' +
        '<a class="btn ghost" href="#/vocab">返回单词</a></section>';
      return;
    }
    root.innerHTML = '<section class="card"><div class="card-head"><h2>生词本（' + list.length + '）</h2>' +
      '<div><button class="btn primary small js-practice">开始攻克</button> ' +
      '<button class="btn ghost small js-clear">清空</button></div></div>' +
      '<table class="tbl"><thead><tr><th>单词</th><th>释义</th><th>例句</th><th>来源</th><th></th></tr></thead><tbody>' +
      list.map(function (w, i) {
        return '<tr><td><b>' + U.esc(w.word) + '</b> <span class="phon">' + U.esc(w.phonetic || '') + '</span></td>' +
          '<td>' + U.esc(w.cn) + '</td><td class="small">' + U.esc(w.example || '') + '</td>' +
          '<td class="hint">' + U.esc(w.source || '') + '</td>' +
          '<td><button class="icon-btn js-del" data-i="' + i + '" title="移除">🗑</button></td></tr>';
      }).join('') + '</tbody></table></section>';

    root.querySelector('.js-practice').addEventListener('click', function () {
      var S2 = ECApp.state();
      var stage = S2.stage;
      var items = [];
      list.forEach(function (w, i) {
        var fake = { id: 'book:' + i, word: w.word, cn: w.cn, phonetic: w.phonetic || '', pos: '', example: w.example || '', exampleCn: '', colloc: [] };
        items.push({ type: 'spell', ref: 'book:' + i, tag: 'spelling', word: w.word, cn: w.cn, phonetic: w.phonetic || '', correctAnswer: w.word });
        items.push({ type: 'fill', ref: 'book:' + i, tag: 'spelling', q: '写出中文意思为「' + w.cn + '」的英文单词', answer: w.word, accept: [w.word], correctAnswer: w.word });
      });
      U.quiz(root, { title: '生词本攻克', module: 'vocab', items: P.shuffle(items), onFinish: function (r, m) { ECApp.finish('vocab', r, m); } });
    });
    root.querySelector('.js-clear').addEventListener('click', function () {
      U.confirmBox('清空生词本', '确定要清空全部生词吗？', '清空').then(function (ok) {
        if (!ok) return;
        ECApp.state().wordbook = [];
        ECApp.save();
        wordbook(root);
      });
    });
    U.$$('.js-del', root).forEach(function (b) {
      b.addEventListener('click', function () {
        ECApp.state().wordbook.splice(parseInt(b.dataset.i, 10), 1);
        ECApp.save();
        wordbook(root);
      });
    });
  }

  function render(root, params) {
    params = params || {};
    if (params.book) return wordbook(root);
    if (params.task !== undefined && params.task !== null && params.task !== '') return fromTask(root, params);
    menu(root);
  }

  window.ECViews = window.ECViews || {};
  window.ECViews.vocab = { title: '单词', render: render };
})();
