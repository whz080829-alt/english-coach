/* 高考→A/B级→CET4/6→雅思 自适应英语补习教练
 * parse.js —— 数据解析与文本评分工具（浏览器 / Node 双用，无 DOM 依赖）
 */
var ECParse = (function () {
  'use strict';

  /* ---------- 基础行解析 ---------- */

  // 把 "a|b|c" 风格的多行文本切成二维数组；跳过空行与 # 注释行
  function parseRows(raw) {
    var out = [];
    if (!raw) return out;
    String(raw).split(/\r?\n/).forEach(function (line) {
      var s = line.trim();
      if (!s || s.charAt(0) === '#') return;
      out.push(s.split('|').map(function (x) { return x.trim(); }));
    });
    return out;
  }

  function isBlank(x) { return x === undefined || x === null || String(x).trim() === ''; }

  /* ---------- 词汇 ---------- */
  // 格式： word|音标|词性|中文释义|英文例句|例句中文|搭配(可选, 用 / 分隔)
  function parseVocab(raw) {
    var list = [];
    var seen = Object.create(null);
    parseRows(raw).forEach(function (f, i) {
      if (f.length < 6) return;
      var word = f[0];
      if (seen[word]) return;      // 同 band 内去重
      seen[word] = true;
      list.push({
        id: 'w:' + word.toLowerCase(),
        word: word,
        phonetic: f[1] || '',
        pos: f[2] || '',
        cn: f[3] || '',
        example: f[4] || '',
        exampleCn: f[5] || '',
        colloc: (f[6] || '').split('/').map(function (s) { return s.trim(); }).filter(Boolean),
        line: i + 1
      });
    });
    return list;
  }

  /* ---------- 语法练习 ---------- */
  // choice: c|题干|选项1;选项2;选项3;选项4|正确选项序号(从0开始)|解析
  // fill  : f|题干(用 ___ 表示空)|标准答案(多个答案用 / 分隔)|解析
  function parseExercises(raw) {
    var out = [];
    parseRows(raw).forEach(function (f) {
      var kind = (f[0] || '').toLowerCase();
      if (kind === 'c' || kind === 'choice') {
        if (f.length < 5) return;
        var opts = (f[2] || '').split(';').map(function (s) { return s.trim(); }).filter(Boolean);
        if (opts.length < 2) return;
        var ai = parseInt(f[3], 10);
        if (isNaN(ai) || ai < 0 || ai >= opts.length) ai = 0;
        out.push({ type: 'choice', q: f[1], options: opts, answer: ai, explain: f[4] || '' });
      } else if (kind === 'f' || kind === 'fill') {
        if (f.length < 4) return;
        out.push({
          type: 'fill', q: f[1],
          answer: f[2], explain: f[3] || '',
          accept: String(f[2]).split('/').map(function (s) { return s.trim(); }).filter(Boolean)
        });
      } else if (kind === 't' || kind === 'tf') {
        // 判断题： t|题干|T 或 F|解析
        if (f.length < 4) return;
        var ans = /^t/i.test(f[2]) ? 'T' : 'F';
        out.push({ type: 'tf', q: f[1], answer: ans, explain: f[3] || '' });
      }
    });
    return out;
  }

  /* ---------- 文本归一化与比对（听力/拼写/翻译批改） ---------- */

  // 缩写展开表：[缩写, 展开]；比对时统一成"去掉撇号"的形式，两侧都规范化
  var CONTRACTIONS = [
    ["i'm", 'i am'], ["it's", 'it is'], ["that's", 'that is'], ["don't", 'do not'],
    ["doesn't", 'does not'], ["didn't", 'did not'], ["can't", 'can not'], ["cannot", 'can not'],
    ["won't", 'will not'], ["isn't", 'is not'], ["aren't", 'are not'], ["wasn't", 'was not'],
    ["weren't", 'were not'], ["hasn't", 'has not'], ["haven't", 'have not'], ["hadn't", 'had not'],
    ["i'd", 'i would'], ["i'll", 'i will'], ["i've", 'i have'], ["we're", 'we are'],
    ["they're", 'they are'], ["you're", 'you are'], ["let's", 'let us'], ["he's", 'he is'],
    ["she's", 'she is'], ["there's", 'there is'], ["what's", 'what is'],
    ["gonna", 'going to'], ["wanna", 'want to'], ["ok", 'okay']
  ];
  var CONTRACTION_MAP = (function () {
    var m = Object.create(null);
    CONTRACTIONS.forEach(function (p) {
      m[p[0].replace(/[^a-z]/g, '')] = p[1];
    });
    return m;
  })();

  // 归一化：小写、去标点、展开常见缩写、统一数字与空格
  function normalize(s) {
    var t = String(s == null ? '' : s).toLowerCase();
    t = t.replace(/[\u2018\u2019\u201c\u201d]/g, "'");
    t = t.replace(/(\d),(\d)/g, '$1$2');
    t = t.replace(/[^a-z0-9'\s]/g, ' ');
    t = t.replace(/\s+/g, ' ').trim();
    t = t.split(' ').map(function (w) {
      var key = w.replace(/[^a-z]/g, '');
      return CONTRACTION_MAP[key] !== undefined ? CONTRACTION_MAP[key] : w;
    }).join(' ');
    return t.replace(/\s+/g, ' ').trim();
  }

  function words(s) {
    var n = normalize(s);
    return n ? n.split(' ') : [];
  }

  // 词级对齐（LCS），返回 [{type:'same'|'add'|'del', word}]
  function align(a, b) {
    var A = words(a), B = words(b);
    var n = A.length, m = B.length;
    var dp = [];
    for (var i = 0; i <= n; i++) { dp.push(new Array(m + 1).fill(0)); }
    for (i = n - 1; i >= 0; i--) {
      for (var j = m - 1; j >= 0; j--) {
        dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    var out = []; i = 0; j = 0;
    while (i < n && j < m) {
      if (A[i] === B[j]) { out.push({ type: 'same', word: A[i] }); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ type: 'del', word: A[i] }); i++; }
      else { out.push({ type: 'add', word: B[j] }); j++; }
    }
    while (i < n) { out.push({ type: 'del', word: A[i++] }); }
    while (j < m) { out.push({ type: 'add', word: B[j++] }); }
    return out;
  }

  // 听写/翻译评分：返回 0~1 的准确率 + 词级差异
  function gradeText(userText, target) {
    var A = words(userText), B = words(target);
    if (!B.length) return { score: 0, diff: [], missing: [], extra: [], userWords: A.length };
    var d = align(userText, target);
    var same = d.filter(function (x) { return x.type === 'same'; }).length;
    // 召回率与精确率各占一半，避免"多写凑分"或"少写蒙分"
    var recall = same / B.length;
    var precision = A.length ? same / A.length : 0;
    var score = Math.max(0, Math.min(1, 0.6 * recall + 0.4 * precision));
    return {
      score: score,
      diff: d,
      missing: d.filter(function (x) { return x.type === 'add'; }).map(function (x) { return x.word; }),
      extra: d.filter(function (x) { return x.type === 'del'; }).map(function (x) { return x.word; }),
      userWords: A.length,
      targetWords: B.length
    };
  }

  // 模糊匹配（单词拼写）：允许 1 个编辑距离（含相邻字母写反）内的近似
  function editDistance(a, b) {
    a = String(a); b = String(b);
    var dp = [];
    for (var i = 0; i <= a.length; i++) dp.push([i]);
    for (var j = 0; j <= b.length; j++) dp[0][j] = j;
    for (i = 1; i <= a.length; i++) {
      for (j = 1; j <= b.length; j++) {
        dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        // 相邻字母写反也算 1 次错误（receive ↔ recieve）
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
          dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + 1);
        }
      }
    }
    return dp[a.length][b.length];
  }

  function checkSpelling(user, target) {
    var u = String(user || '').trim().toLowerCase().replace(/\s+/g, ' ');
    var t = String(target || '').trim().toLowerCase();
    if (u === t) return { ok: true, level: 'exact' };
    if (editDistance(u, t) <= 1 && t.length > 3) return { ok: true, level: 'typo', distance: 1 };
    return { ok: false, level: 'wrong', distance: editDistance(u, t) };
  }

  // 从用户作答中抽词（用于填空判分，忽略大小写与首尾标点）
  function checkFill(user, ex) {
    var u = normalize(user);
    var accept = (ex.accept && ex.accept.length ? ex.accept : [ex.answer]);
    for (var i = 0; i < accept.length; i++) {
      if (u === normalize(accept[i])) return { ok: true, exact: true };
    }
    // 允许多词答案部分匹配（如 "has been" vs "has been to"）
    for (i = 0; i < accept.length; i++) {
      var a = normalize(accept[i]);
      if (a && (u.indexOf(a) >= 0 || a.indexOf(u) >= 0) && Math.abs(a.length - u.length) <= 3) {
        return { ok: true, exact: false };
      }
    }
    return { ok: false, exact: false };
  }

  /* ---------- 通用 ---------- */
  function countWords(text) {
    var m = String(text || '').match(/[A-Za-z][A-Za-z'\-]*/g);
    return m ? m.length : 0;
  }

  function pct(x) { return Math.round((x || 0) * 100); }

  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

  function shuffle(arr, rnd) {
    var a = arr.slice();
    var r = rnd || Math.random;
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(r() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  var api = {
    parseRows: parseRows, parseVocab: parseVocab, parseExercises: parseExercises,
    normalize: normalize, words: words, align: align, gradeText: gradeText,
    editDistance: editDistance, checkSpelling: checkSpelling, checkFill: checkFill,
    countWords: countWords, pct: pct, clamp: clamp, shuffle: shuffle
  };
  return api;
})();
if (typeof module === 'object' && module.exports) { module.exports = ECParse; }
if (typeof window !== 'undefined') { window.ECParse = ECParse; }
