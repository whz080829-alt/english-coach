/* UI 基础件：DOM 工具、提示、弹窗、进度环、通用答题器
 */
var ECUI = (function () {
  'use strict';

  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function el(html) {
    var d = document.createElement('div');
    d.innerHTML = html.trim();
    return d.firstElementChild;
  }

  function on(root, sel, evt, fn) {
    root.addEventListener(evt, function (e) {
      var t = e.target.closest(sel);
      if (t && root.contains(t)) fn(e, t);
    });
  }

  /* ---------- 提示 ---------- */
  function toast(msg, type, ms) {
    var wrap = $('#toast-wrap');
    if (!wrap) return;
    var t = el('<div class="toast ' + (type || '') + '">' + esc(msg) + '</div>');
    wrap.appendChild(t);
    setTimeout(function () { t.classList.add('out'); }, (ms || 2600));
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, (ms || 2600) + 400);
  }

  /* ---------- 弹窗 ---------- */
  function modal(opts) {
    return new Promise(function (resolve) {
      var wrap = $('#modal-wrap');
      var m = el(
        '<div class="modal-mask"><div class="modal">' +
        '<div class="modal-head"><h3>' + esc(opts.title || '') + '</h3>' +
        '<button class="icon-btn modal-x" title="关闭">✕</button></div>' +
        '<div class="modal-body"></div>' +
        '<div class="modal-foot"></div></div></div>');
      var body = $('.modal-body', m);
      if (typeof opts.body === 'string') body.innerHTML = opts.body;
      else if (opts.body) body.appendChild(opts.body);
      var foot = $('.modal-foot', m);
      (opts.actions || [{ label: '知道了', value: true, primary: true }]).forEach(function (a) {
        var b = el('<button class="btn ' + (a.primary ? 'primary' : a.danger ? 'danger' : '') + '">' + esc(a.label) + '</button>');
        b.addEventListener('click', function () { close(a.value); });
        foot.appendChild(b);
      });
      function close(v) {
        if (m.parentNode) m.parentNode.removeChild(m);
        document.removeEventListener('keydown', onKey);
        resolve(v);
      }
      function onKey(e) { if (e.key === 'Escape') close(false); }
      $('.modal-x', m).addEventListener('click', function () { close(false); });
      m.addEventListener('click', function (e) { if (e.target === m) close(false); });
      document.addEventListener('keydown', onKey);
      wrap.appendChild(m);
    });
  }

  function confirmBox(title, text, okLabel) {
    return modal({
      title: title,
      body: '<p>' + esc(text) + '</p>',
      actions: [{ label: '取消', value: false }, { label: okLabel || '确定', value: true, primary: true }]
    });
  }

  /* ---------- 图形 ---------- */
  function ring(pct, size, label, sub) {
    size = size || 96;
    var r = (size - 12) / 2;
    var c = 2 * Math.PI * r;
    var v = Math.max(0, Math.min(1, pct || 0));
    return '<div class="ring" style="width:' + size + 'px;height:' + size + 'px">' +
      '<svg viewBox="0 0 ' + size + ' ' + size + '">' +
      '<circle class="ring-bg" cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '"></circle>' +
      '<circle class="ring-fg" cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" ' +
      'stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + (c * (1 - v)).toFixed(1) + '"></circle>' +
      '</svg><div class="ring-text"><b>' + esc(label !== undefined ? label : Math.round(v * 100) + '%') + '</b>' +
      (sub ? '<span>' + esc(sub) + '</span>' : '') + '</div></div>';
  }

  function bar(pct, cls) {
    var v = Math.max(0, Math.min(1, pct || 0));
    return '<div class="bar ' + (cls || '') + '"><i style="width:' + (v * 100).toFixed(1) + '%"></i></div>';
  }

  function chip(text, cls) { return '<span class="chip ' + (cls || '') + '">' + esc(text) + '</span>'; }

  function fmtTime(ts) {
    var d = new Date(ts);
    function p(n) { return n < 10 ? '0' + n : n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function fmtDur(min) {
    min = Math.round(min || 0);
    if (min < 60) return min + ' 分钟';
    return Math.floor(min / 60) + ' 小时 ' + (min % 60) + ' 分钟';
  }

  function diffHTML(diff) {
    return diff.map(function (d) {
      if (d.type === 'same') return '<span class="w-same">' + esc(d.word) + '</span>';
      if (d.type === 'add') return '<span class="w-miss" title="漏写">' + esc(d.word) + '</span>';
      return '<span class="w-extra" title="多写">' + esc(d.word) + '</span>';
    }).join(' ');
  }

  /* ================= 通用答题器 ================= */

  function quiz(container, cfg) {
    var items = cfg.items || [];
    if (!items.length) {
      container.innerHTML = '<div class="empty">暂时没有可用题目，请先换个模块或检查语料文件。</div>';
      return;
    }
    var results = [];
    var queue = items.map(function (it, i) { return { item: it, seq: i, attempt: 1 }; });
    var total = items.length;
    var startTs = Date.now();
    var startIdx = 0;
    var wrongRefs = {};
    var current = null;
    var locked = false;

    container.innerHTML =
      '<div class="quiz">' +
      '<div class="quiz-head"><div class="quiz-progress">' + bar(0) + '</div>' +
      '<div class="quiz-count"><span class="q-now">0</span> / ' + total + '</div>' +
      '<button class="btn ghost small quiz-quit">结束本轮</button></div>' +
      '<div class="quiz-body"></div></div>';
    var body = $('.quiz-body', container);
    var nowEl = $('.q-now', container);
    var barEl = $('.quiz-progress .bar i', container);
    if (cfg.title) {
      var hd = el('<div class="quiz-title">' + esc(cfg.title) + '</div>');
      $('.quiz-head', container).prepend(hd);
    }
    $('.quiz-quit', container).addEventListener('click', function () {
      finish(true);
    });

    var keyHandler = function (e) {
      if (!current) return;
      if (e.key === 'p' || e.key === 'P') {
        if (current.item.audio) playCurrent(ECTTS.getRate());
        return;
      }
      if (locked) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); var b = $('.js-next', body); if (b) b.click(); }
        return;
      }
      if (current.item.type === 'choice') {
        var n = parseInt(e.key, 10);
        if (n >= 1 && n <= (current.item.options || []).length) {
          var btns = $$('.opt', body);
          if (btns[n - 1]) btns[n - 1].click();
        }
      }
    };
    document.addEventListener('keydown', keyHandler);

    // 朗读当前题目的音频（对话用双音色，单句用当前语速）
    function playCurrent(rate) {
      if (!current || !current.item.audio) return;
      if (Array.isArray(current.item.audio)) ECTTS.speakScript(current.item.audio, { rate: rate });
      else ECTTS.speak(current.item.audio, { rate: rate });
    }

    function pick() {
      // 优先取队列里第一次尝试的题，保证顺序稳定
      return queue.shift();
    }

    function next() {
      if (!queue.length) { finish(false); return; }
      current = pick();
      locked = false;
      nowEl.textContent = String(results.length + 1);
      barEl.style.width = ((results.length / total) * 100).toFixed(1) + '%';
      renderItem(current);
    }

    function record(entry, correct, extra) {
      var it = entry.item;
      if (entry.attempt === 1) {
        results.push(Object.assign({
          ref: it.ref, tag: it.tag, correct: !!correct, module: cfg.module,
          prompt: it.q || it.prompt || '', kind: cfg.module,
          correctAnswer: it.correctAnswer !== undefined ? it.correctAnswer : it.answer,
          explain: it.explain || ''
        }, extra || {}));
        if (!correct) {
          wrongRefs[it.ref] = (wrongRefs[it.ref] || 0) + 1;
          if (cfg.requeueWrong !== false && wrongRefs[it.ref] <= 1) {
            queue.push({ item: it, seq: entry.seq, attempt: 2 });
          }
        }
      }
    }

    function feedback(ok, html, extra) {
      locked = true;
      var fb = el('<div class="feedback ' + (ok ? 'ok' : 'no') + '">' + html +
        '<div class="fb-foot"><button class="btn primary js-next">' +
        (queue.length ? '继续 (Enter)' : '查看结果') + '</button></div></div>');
      body.appendChild(fb);
      var nx = $('.js-next', fb);
      nx.focus();
      nx.addEventListener('click', next);
      if (extra && extra.audio) playAudio(extra.audio, fb);
    }

    function playAudio(text, scope) {
      if (!window.ECTTS || !ECTTS.supported()) return;
      ECTTS.speak(text, { rate: cfg.rate });
    }

    function renderItem(entry) {
      var it = entry.item;
      body.innerHTML = '';

      if (entry.attempt === 2) {
        body.appendChild(el('<div class="requeue-tip">再练一遍这道错题</div>'));
      }
      if (it.note) body.appendChild(el('<div class="note">' + it.note + '</div>'));
      if (it.passage) {
        body.appendChild(el('<div class="passage-box">' + esc(it.passage).replace(/\n\n/g, '</p><p>').replace(/^/, '<p>') + '</p></div>'));
      }
      if (it.audio) {
        var audioBar = el('<div class="audio-bar"><button class="btn primary js-play">▶ 播放 (P)</button>' +
          '<button class="btn ghost js-slow">🐢 慢速</button>' +
          '<button class="btn ghost js-fast">⏩ 常速</button>' +
          '<span class="hint">可反复听</span></div>');
        body.appendChild(audioBar);
        $('.js-play', audioBar).addEventListener('click', function () { playCurrent(cfg.rate); });
        $('.js-slow', audioBar).addEventListener('click', function () { playCurrent(0.65); });
        $('.js-fast', audioBar).addEventListener('click', function () { playCurrent(1.1); });
        setTimeout(function () { if (current === entry) playCurrent(cfg.rate); }, 300);
      }

      if (it.type === 'choice') {
        body.appendChild(el('<div class="q-text">' + esc(it.q) + '</div>'));
        var opts = el('<div class="options"></div>');
        (it.options || []).forEach(function (o, i) {
          var b = el('<button class="opt" data-i="' + i + '"><b>' + String.fromCharCode(65 + i) + '</b><span>' + esc(o) + '</span></button>');
          b.addEventListener('click', function () {
            if (locked) return;
            var correct = i === it.answer;
            $$('.opt', opts).forEach(function (x, k) {
              x.classList.add('disabled');
              if (k === it.answer) x.classList.add('right');
            });
            if (!correct) b.classList.add('wrong');
            record(entry, correct, { your: o });
            feedback(correct,
              '<div class="fb-title">' + (correct ? '✅ 正确' : '❌ 正确答案：' + String.fromCharCode(65 + it.answer)) + '</div>' +
              (it.explain ? '<div class="fb-explain">' + esc(it.explain) + '</div>' : ''));
          });
          opts.appendChild(b);
        });
        body.appendChild(opts);
      }

      else if (it.type === 'fill' || it.type === 'tf') {
        body.appendChild(el('<div class="q-text">' + esc(it.q) + '</div>'));
        var isTF = it.type === 'tf';
        var box = el('<div class="fill-box">' +
          (isTF
            ? '<div class="tf-btns"><button class="btn js-t">T 正确</button><button class="btn js-f">F 错误</button></div>'
            : '<input class="input js-ans" placeholder="输入答案后按 Enter" autocomplete="off" autocapitalize="off" spellcheck="false"><button class="btn primary js-submit">提交</button>') +
          '</div>');
        body.appendChild(box);
        function submitTF(val) {
          if (locked) return;
          var correct = val === it.answer;
          record(entry, correct, { your: val === 'T' ? 'T' : 'F' });
          feedback(correct, '<div class="fb-title">' + (correct ? '✅ 正确' : '❌ 正确答案：' + it.answer) + '</div>' +
            (it.explain ? '<div class="fb-explain">' + esc(it.explain) + '</div>' : ''));
        }
        if (isTF) {
          $('.js-t', box).addEventListener('click', function () { submitTF('T'); });
          $('.js-f', box).addEventListener('click', function () { submitTF('F'); });
        } else {
          var input = $('.js-ans', box);
          input.focus();
          function submit() {
            if (locked) return;
            var val = input.value.trim();
            if (!val) { toast('先输入答案'); return; }
            var res = ECParse.checkFill(val, it);
            record(entry, res.ok, { your: val, quality: res.ok ? (res.exact ? 5 : 4) : 2 });
            feedback(res.ok,
              '<div class="fb-title">' + (res.ok ? (res.exact ? '✅ 完全正确' : '✅ 正确（表达略有差异）') : '❌ 参考答案：' + esc(it.answer)) + '</div>' +
              '<div class="fb-you">你的答案：' + esc(val) + '</div>' +
              (it.explain ? '<div class="fb-explain">' + esc(it.explain) + '</div>' : ''));
          }
          $('.js-submit', box).addEventListener('click', submit);
          input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
        }
      }

      else if (it.type === 'spell') {
        body.appendChild(el('<div class="q-text">根据中文与音标写出英文单词</div>'));
        body.appendChild(el('<div class="spell-cue"><b>' + esc(it.cn) + '</b><span class="phon">' + esc(it.phonetic || '') + '</span>' +
          (it.pos ? '<span class="pos">' + esc(it.pos) + '</span>' : '') + '</div>'));
        var sb = el('<div class="fill-box"><input class="input js-ans" placeholder="拼写单词" autocomplete="off" autocapitalize="off" spellcheck="false"><button class="btn primary js-submit">提交</button></div>');
        body.appendChild(sb);
        var si = $('.js-ans', sb);
        si.focus();
        function subSpell() {
          if (locked) return;
          var val = si.value.trim();
          if (!val) { toast('先输入单词'); return; }
          var r = ECParse.checkSpelling(val, it.word);
          record(entry, r.ok, { your: val, quality: r.level === 'exact' ? 5 : (r.level === 'typo' ? 3 : 1) });
          feedback(r.ok,
            '<div class="fb-title">' + (r.level === 'exact' ? '✅ 完全正确' : r.level === 'typo' ? '⚠️ 拼写有小错，注意字母顺序' : '❌ 正确答案：' + esc(it.word)) + '</div>' +
            '<div class="fb-you">' + esc(it.word) + ' ' + esc(it.phonetic || '') + ' ' + esc(it.comment || '') + '</div>' +
            (it.example ? '<div class="fb-explain">例句：' + esc(it.example) + '<br>' + esc(it.exampleCn || '') + '</div>' : ''));
        }
        $('.js-submit', sb).addEventListener('click', subSpell);
        si.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); subSpell(); } });
      }

      else if (it.type === 'dictation') {
        body.appendChild(el('<div class="q-text">听写：把你听到的句子完整写下来</div>'));
        var db = el('<div class="fill-box col"><textarea class="input js-ans" rows="2" placeholder="听写整句，注意大小写与标点不影响判分"></textarea>' +
          '<div class="row"><button class="btn primary js-submit">提交</button><button class="btn ghost js-giveup">听不出来，看答案</button></div></div>');
        body.appendChild(db);
        var di = $('.js-ans', db);
        di.focus();
        function subDict() {
          if (locked) return;
          var val = di.value.trim();
          if (!val) { toast('先写下你听到的内容'); return; }
          var g = ECParse.gradeText(val, it.text);
          var ok = g.score >= 0.85;
          record(entry, ok, {
            your: val, score: g.score,
            quality: g.score >= 0.95 ? 5 : g.score >= 0.85 ? 4 : g.score >= 0.6 ? 3 : 1
          });
          feedback(ok,
            '<div class="fb-title">' + (g.score >= 0.95 ? '✅ 完全正确' : ok ? '✅ 基本正确（' + Math.round(g.score * 100) + '%）' : '❌ 准确率 ' + Math.round(g.score * 100) + '%') + '</div>' +
            '<div class="fb-target">原文：' + esc(it.text) + '</div>' +
            (it.cn ? '<div class="fb-you">译文：' + esc(it.cn) + '</div>' : '') +
            '<div class="fb-diff">逐词对照：' + diffHTML(g.diff) + '</div>' +
            '<div class="hint">红色 = 你漏掉或写错的词，灰色删除线 = 你多写的词</div>');
        }
        $('.js-submit', db).addEventListener('click', subDict);
        $('.js-giveup', db).addEventListener('click', function () {
          if (locked) return;
          record(entry, false, { your: '(放弃)', quality: 1 });
          feedback(false, '<div class="fb-title">❌ 正确答案</div><div class="fb-target">' + esc(it.text) + '</div>' +
            (it.cn ? '<div class="fb-you">' + esc(it.cn) + '</div>' : ''));
        });
      }

      if (it.type === 'choice' && !it.noAutoPlay && it.audio) { /* 已自动播放 */ }
    }

    function finish(early) {
      document.removeEventListener('keydown', keyHandler);
      ECTTS.stop();
      var minutes = Math.max(1, Math.round((Date.now() - startTs) / 60000));
      if (cfg.onFinish) cfg.onFinish(results, { minutes: minutes, early: !!early, wrongRefs: wrongRefs });
    }
    next();
  }

  return {
    esc: esc, $: $, $$: $$, el: el, on: on, toast: toast, modal: modal, confirmBox: confirmBox,
    ring: ring, bar: bar, chip: chip, fmtTime: fmtTime, fmtDur: fmtDur, diffHTML: diffHTML, quiz: quiz
  };
})();
if (typeof window !== 'undefined') { window.ECUI = ECUI; }
