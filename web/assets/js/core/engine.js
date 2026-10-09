/* 自适应引擎：掌握度建模 · 间隔重复调度 · 每轮学习计划重规划 · 晋级判定
 * 纯逻辑，无 DOM 依赖，可在 Node 下做单元测试。
 */
var ECEngine = (function () {
  'use strict';

  var P = (typeof ECParse !== 'undefined') ? ECParse
    : (typeof require === 'function' ? require('./parse.js') : null);
  var S = (typeof ECStore !== 'undefined') ? ECStore
    : (typeof require === 'function' ? require('./store.js') : null);

  var MIN = 60000, DAY = 86400000;
  var STAGES = ['basic', 'ab', 'cet4', 'cet6', 'ielts'];
  var SKILLS = ['vocab', 'grammar', 'listening', 'reading', 'writing'];

  var STAGE_META = {
    basic: {
      name: '基础夯实', tag: '中考~高考 60 分水平', target: 0.85,
      desc: '从 be 动词、一般现在时、最常用的 500 词开始，把句子写对、听懂最简单的对话。'
    },
    ab: {
      name: 'A/B 级 应用能力', tag: '高等学校英语应用能力考试', target: 0.85,
      desc: '应用文读写、校园与职场场景听读，掌握完成时、被动语态与基础从句。'
    },
    cet4: {
      name: '大学英语四级', tag: 'CET-4', target: 0.80,
      desc: '四级核心词汇、长难句拆解、新闻听力、议论文写作。'
    },
    cet6: {
      name: '大学英语六级', tag: 'CET-6', target: 0.80,
      desc: '六级进阶词汇、学术听力、观点型阅读与逻辑论证写作。'
    },
    ielts: {
      name: '雅思冲刺', tag: 'IELTS 6.5+', target: 0.80,
      desc: '学术词汇、学术听力、Task 1 图表与 Task 2 议论文、高分句式。'
    }
  };

  // 各阶段默认时间配比（学习重心）
  var BASE_WEIGHTS = {
    basic: { vocab: 0.42, grammar: 0.28, listening: 0.15, reading: 0.10, writing: 0.05 },
    ab: { vocab: 0.32, grammar: 0.24, listening: 0.20, reading: 0.14, writing: 0.10 },
    cet4: { vocab: 0.30, grammar: 0.14, listening: 0.24, reading: 0.22, writing: 0.10 },
    cet6: { vocab: 0.28, grammar: 0.12, listening: 0.25, reading: 0.23, writing: 0.12 },
    ielts: { vocab: 0.24, grammar: 0.10, listening: 0.24, reading: 0.22, writing: 0.20 }
  };

  var SKILL_META = {
    vocab: { name: '词汇', icon: '📖' },
    grammar: { name: '语法', icon: '🧩' },
    listening: { name: '听力', icon: '🎧' },
    reading: { name: '阅读', icon: '📚' },
    writing: { name: '写作', icon: '✍️' }
  };

  var TAG_LABEL = {
    tense: '时态', third: '第三人称单数', article: '冠词', noun: '名词单复数', pron: '代词',
    prep: '介词', modal: '情态动词', passive: '被动语态', clause: '从句', nonfinite: '非谓语动词',
    subjunctive: '虚拟语气', inversion: '倒装与强调', comparative: '比较级/最高级', connector: '连接与衔接',
    be: 'be 动词', therebe: 'there be 句型', spelling: '拼写', listening: '听力细节',
    number: '听力数字信息', attitude: '态度与观点', main: '主旨题', detail: '细节题',
    infer: '推断题', vocabq: '词义猜测', structure: '篇章结构', wordchoice: '用词准确性',
    content: '内容完成度', grammarw: '写作语法', other: '其它'
  };

  var TAG_RULES = [
    [/一般现在|一般过去|一般将来|现在完成|过去完成|进行时|完成时|时态|过去将来/, 'tense'],
    [/三单|第三人称/, 'third'],
    [/冠词|a\/an|the/, 'article'],
    [/名词|单复数|可数|不可数/, 'noun'],
    [/代词|物主/, 'pron'],
    [/介词/, 'prep'],
    [/情态/, 'modal'],
    [/被动/, 'passive'],
    [/从句/, 'clause'],
    [/非谓语|不定式|动名词|分词/, 'nonfinite'],
    [/虚拟/, 'subjunctive'],
    [/倒装|强调句/, 'inversion'],
    [/比较级|最高级/, 'comparative'],
    [/连接|衔接|过渡|逻辑/, 'connector'],
    [/be ?动词|主系表/, 'be'],
    [/there ?be/i, 'therebe']
  ];

  /* ================= 内容索引 ================= */

  var content = {
    vocab: {}, grammar: {}, listening: {}, dictation: {}, reading: {}, writing: {}
  };
  var index = {
    word: {},        // id -> word object
    grammar: {},     // id -> point (含 tags / ex 解析)
    listening: {},   // id -> item
    reading: {},
    writing: {}
  };
  var ready = false;

  function tagOfGrammar(title) {
    for (var i = 0; i < TAG_RULES.length; i++) {
      if (TAG_RULES[i][0].test(title)) return TAG_RULES[i][1];
    }
    return 'other';
  }

  function init(map) {
    map = map || {};
    content = { vocab: {}, grammar: {}, listening: {}, dictation: {}, reading: {}, writing: {} };
    index = { word: {}, grammar: {}, listening: {}, reading: {}, writing: {} };

    STAGES.forEach(function (st) {
      var raw = (map.VOCAB || {})[st];
      content.vocab[st] = typeof raw === 'string' ? P.parseVocab(raw) : (raw || []);
      content.vocab[st].forEach(function (w) {
        w.stage = st;
        index.word[w.id] = w;
      });

      content.grammar[st] = ((map.GRAMMAR || {})[st] || []).map(function (p) {
        var cp = {
          id: p.id, title: p.title, stage: st, points: p.points || [],
          examples: p.examples || [], pitfalls: p.pitfalls || [],
          tag: tagOfGrammar(p.title + ' ' + (p.points || []).join(' ')),
          ex: P.parseExercises(p.ex)
        };
        index.grammar[cp.id] = cp;
        return cp;
      });

      content.listening[st] = ((map.LISTENING || {})[st] || []).map(function (it) {
        var cp = {
          id: it.id, title: it.title, stage: st, kind: it.kind || 'dialogue',
          script: it.script || [], questions: (it.questions || []).map(function (q) {
            return {
              q: q.q, options: q.options, answer: q.answer, explain: q.explain,
              tag: /opinion|attitude|think of|feel about|suggest/i.test(q.q) ? 'attitude'
                : /\d|number|time|price|how many|how much/i.test(q.q + ' ' + (q.options || []).join(' ')) ? 'number' : 'listening'
            };
          })
        };
        index.listening[cp.id] = cp;
        return cp;
      });

      content.dictation[st] = P.parseRows((map.DICTATION || {})[st]).map(function (f, i) {
        return { id: 'd:' + st + ':' + (i + 1), stage: st, text: f[0], cn: f[1] || '' };
      });

      content.reading[st] = ((map.READING || {})[st] || []).map(function (p) {
        var cp = {
          id: p.id, title: p.title, topic: p.topic || '', stage: st,
          text: p.text || '', glossary: p.glossary || [],
          words: P.countWords(p.text),
          questions: (p.questions || []).map(function (q) {
            return {
              q: q.q, options: q.options, answer: q.answer, explain: q.explain,
              tag: /main idea|mainly|best title|purpose of|primarily about/i.test(q.q) ? 'main'
                : /infer|imply|suggest|conclude|attitude/i.test(q.q) ? 'infer'
                  : /mean|refers to|closest in meaning/i.test(q.q) ? 'vocabq' : 'detail'
            };
          })
        };
        index.reading[cp.id] = cp;
        return cp;
      });

      content.writing[st] = ((map.WRITING || {})[st] || []).map(function (p) {
        var cp = {
          id: p.id, title: p.title, stage: st, type: p.type || '短文写作',
          minWords: p.minWords || 80, prompt: p.prompt,
          requirements: p.requirements || [], outline: p.outline || [],
          model: p.model || '', highlights: p.highlights || [], useful: p.useful || []
        };
        index.writing[cp.id] = cp;
        return cp;
      });
    });
    ready = true;
    return content;
  }

  function stats() {
    var s = {};
    STAGES.forEach(function (st) {
      s[st] = {
        vocab: content.vocab[st].length,
        grammar: content.grammar[st].length,
        listening: content.listening[st].length,
        dictation: content.dictation[st].length,
        reading: content.reading[st].length,
        writing: content.writing[st].length
      };
    });
    return s;
  }

  /* ================= 掌握度建模 ================= */

  function stageTotal(stage, skill) { return (content[skill][stage] || []).length; }

  function wordCoverage(state, stage) {
    var list = content.vocab[stage] || [];
    if (!list.length) return { coverage: 0, accuracy: 0, seen: 0, total: 0, mastered: 0 };
    var sum = 0, seen = 0, mastered = 0, c = 0, w = 0;
    list.forEach(function (item) {
      var card = state.words[item.id];
      if (!card) return;
      seen++;
      if (card.status === 'mastered') { mastered++; sum += 1; }
      else if (card.status === 'review') sum += 0.72;
      else sum += 0.32;
      c += card.correct || 0; w += card.wrong || 0;
    });
    return {
      coverage: sum / list.length,
      accuracy: (c + 1.5) / (c + w + 3),
      seen: seen, total: list.length, mastered: mastered
    };
  }

  function skillMastery(state, stage, skill) {
    if (!content[skill] || !content[skill][stage]) return 0;
    if (skill === 'vocab') {
      var v = wordCoverage(state, stage);
      return P.clamp(0.62 * v.coverage + 0.38 * v.accuracy * Math.min(1, v.coverage * 2.2), 0, 1);
    }
    if (skill === 'grammar') {
      var pts = content.grammar[stage];
      if (!pts.length) return 0;
      var sum = 0;
      pts.forEach(function (p) {
        var r = state.grammar[p.id];
        if (!r || !r.attempts) return;
        var acc = (r.correct + 1) / (r.attempts + 2);
        var depth = Math.min(1, r.attempts / 4);
        sum += acc * (0.55 + 0.45 * depth);
      });
      return P.clamp(sum / pts.length, 0, 1);
    }
    if (skill === 'listening') {
      // 听力 = 理解题 70% + 听写 30%
      var litems = content.listening[stage] || [];
      var ditems = content.dictation[stage] || [];
      var lsum = 0, dsum = 0;
      litems.forEach(function (it) {
        var r = state.listening[it.id];
        if (r) lsum += P.clamp(r.acc || 0, 0, 1);
      });
      ditems.forEach(function (d) {
        var r = state.dictation[d.id];
        if (r) dsum += P.clamp(r.acc || 0, 0, 1);
      });
      var lm = litems.length ? lsum / litems.length : 0;
      var dm = ditems.length ? dsum / ditems.length : 0;
      if (!ditems.length) return P.clamp(lm, 0, 1);
      return P.clamp(0.7 * lm + 0.3 * dm, 0, 1);
    }
    var items = content[skill][stage];
    if (!items.length) return 0;
    var acc2 = 0;
    items.forEach(function (it) {
      var r = state[skill][it.id];
      if (!r) return;
      var a = r.acc !== undefined ? r.acc : (r.best || 0);
      if (skill === 'writing') a = r.best !== undefined ? r.best : (r.acc || 0);
      acc2 += P.clamp(a, 0, 1) * (skill === 'writing' ? 1 : (0.7 + 0.3 * Math.min(1, (r.attempts || 1) / 2)));
    });
    return P.clamp(acc2 / items.length, 0, 1);
  }

  function stageMastery(state, stage) {
    var w = BASE_WEIGHTS[stage], sum = 0, tot = 0;
    SKILLS.forEach(function (s) {
      sum += skillMastery(state, stage, s) * w[s];
      tot += w[s];
    });
    return tot ? sum / tot : 0;
  }

  /* ================= 诊断分析 ================= */

  function dueWords(state) {
    var now = Date.now(), out = [];
    Object.keys(state.words).forEach(function (id) {
      var c = state.words[id];
      if (c && c.due <= now) out.push({ id: id, card: c, word: index.word[id] });
    });
    out.sort(function (a, b) {
      // 错词优先 → 逾期久的优先
      var la = (a.card.lapses || 0) > 0 ? 0 : 1, lb = (b.card.lapses || 0) > 0 ? 0 : 1;
      if (la !== lb) return la - lb;
      return (a.card.due || 0) - (b.card.due || 0);
    });
    return out;
  }

  function weakTags(state, stage, limit) {
    var map = {};
    state.errors.forEach(function (e) {
      if (stage && e.stage && e.stage !== stage) return;
      var t = e.tag || 'other';
      if (!map[t]) map[t] = { tag: t, label: TAG_LABEL[t] || t, count: 0 };
      map[t].count++;
    });
    var arr = Object.keys(map).map(function (k) { return map[k]; })
      .sort(function (a, b) { return b.count - a.count; });
    var total = arr.reduce(function (s, x) { return s + x.count; }, 0);
    arr.forEach(function (x) { x.share = total ? x.count / total : 0; });
    return limit ? arr.slice(0, limit) : arr;
  }

  function analyze(state) {
    var stage = state.stage;
    var target = STAGE_META[stage].target;
    var skills = SKILLS.map(function (s) {
      var m = skillMastery(state, stage, s);
      var need = P.clamp((target - m) / target, 0, 1);
      return {
        skill: s, name: SKILL_META[s].name, icon: SKILL_META[s].icon,
        mastery: m, target: target, gap: Math.max(0, target - m), need: need
      };
    });
    var map = {};
    skills.forEach(function (x) { map[x.skill] = x; });
    var due = dueWords(state);
    var introduced = Object.keys(state.words).length;
    var newAvailable = (content.vocab[stage] || []).filter(function (w) { return !state.words[w.id]; }).length;
    return {
      stage: stage, stageMeta: STAGE_META[stage],
      stageMastery: stageMastery(state, stage),
      skills: skills, skillMap: map,
      weakTags: weakTags(state, stage, 5),
      dueCount: due.length, dueWords: due,
      vocab: wordCoverage(state, stage),
      introduced: introduced, newAvailable: newAvailable
    };
  }

  /* ================= 间隔重复 ================= */

  /* ================= 间隔重复（显式阶梯） =================
   * 对标 Memrise / Babbel 的"明码阶梯"：把复习间隔做成人能看懂的档位，
   * 界面上直接告诉用户"这个词在第 4 级、下次 7 天后见"，
   * 避免出现"为什么今天突然要复习 200 个词"的失控感。
   *
   * 四档自评 → 档位变化（关键：忘记不清零，只退两级，防止复习量雪崩）：
   *   6 熟知 → +2 档      5 认识 → +1 档
   *   3 模糊 → 不变，1 天后再说（当天再考一次）
   *   1 忘记 → -2 档（最低回到 10 分钟档），当天再考一次
   */
  var RUNGS = [10 * MIN, DAY, 3 * DAY, 7 * DAY, 16 * DAY, 35 * DAY, 75 * DAY, 180 * DAY];
  var RUNG_LABEL = ['10 分钟', '1 天', '3 天', '7 天', '16 天', '35 天', '75 天', '180 天'];

  function rungOf(card) {
    if (!card) return 0;
    if (typeof card.rung === 'number') return card.rung;
    // 兼容旧数据：按连对次数推断档位
    if (card.status === 'mastered') return 5;
    if (card.reps >= 4) return 4;
    if (card.reps >= 2) return 2;
    return card.reps ? 1 : 0;
  }

  function nextReviewText(card) {
    var r = rungOf(card);
    return RUNG_LABEL[r] + '后';
  }

  function reviewWord(state, id, quality) {
    var c = state.words[id];
    if (!c) {
      c = state.words[id] = {
        reps: 0, lapses: 0, ease: 2.5, int: 0, due: 0, status: 'learning',
        correct: 0, wrong: 0, first: Date.now(), last: 0, stage: state.stage
      };
    }
    c.rung = rungOf(c);
    c.last = Date.now();

    var delta = quality >= 6 ? 2 : quality >= 5 ? 1 : quality >= 4 ? 1 : quality >= 3 ? 0 : -2;
    c.rung = P.clamp(c.rung + delta, 0, RUNGS.length - 1);

    if (quality < 3) {
      c.lapses++; c.wrong++;
    } else {
      c.correct++; c.reps++;
    }
    c.ease = P.clamp((c.ease || 2.5) +
      (quality >= 6 ? 0.12 : quality >= 5 ? 0.06 : quality >= 4 ? 0.02 : quality >= 3 ? -0.06 : -0.22),
      1.3, 2.8);

    // 模糊：档位不前进，但 1 天后重现；忘记：回到 10 分钟档，当天再考一次
    c.int = (quality >= 3 && quality < 4) ? Math.min(c.int || DAY, DAY) : RUNGS[c.rung];
    c.due = Date.now() + c.int;
    // 间隔达到 16 天（第 5 级）即视为已掌握；调研显示 2 周以上的间隔才真正进长期记忆
    c.status = c.rung >= 4 ? 'mastered' : (c.rung >= 1 ? 'review' : 'learning');
    return c;
  }

  function passRate(card) {
    var t = (card.correct || 0) + (card.wrong || 0);
    return t ? (card.correct || 0) / t : 0;
  }

  /* ================= 选题 ================= */

  function pickNewWords(state, stage, n) {
    var out = [];
    if (n <= 0) return out;
    var list = content.vocab[stage] || [];
    for (var i = 0; i < list.length && out.length < n; i++) {
      if (!state.words[list[i].id]) out.push(list[i]);
    }
    return out;
  }

  function pickWeakGrammar(state, stage, n) {
    var pts = (content.grammar[stage] || []).slice();
    pts.sort(function (a, b) {
      var ra = state.grammar[a.id], rb = state.grammar[b.id];
      var ma = ra && ra.attempts ? (ra.correct / ra.attempts) * Math.min(1, ra.attempts / 4) : 0;
      var mb = rb && rb.attempts ? (rb.correct / rb.attempts) * Math.min(1, rb.attempts / 4) : 0;
      return ma - mb;
    });
    return pts.slice(0, n);
  }

  function pickItems(state, stage, skill, n) {
    var items = (content[skill][stage] || []).slice();
    items.sort(function (a, b) {
      var ra = state[skill][a.id], rb = state[skill][b.id];
      var sa = ra ? (ra.acc !== undefined ? ra.acc : (ra.best || 0)) : -0.1;
      var sb = rb ? (rb.acc !== undefined ? rb.acc : (rb.best || 0)) : -0.1;
      return sa - sb;
    });
    return items.slice(0, n);
  }

  /* ================= 计划生成（核心） ================= */

  function fmtMin(m) { return Math.round(m) + ' 分钟'; }

  function buildPlan(state, opts) {
    opts = opts || {};
    var stage = state.stage;
    var mins = state.profile.dailyMinutes || 40;
    var an = analyze(state);
    var base = BASE_WEIGHTS[stage];
    var first = !state.roundIndex;

    /* 写作必须一次写完（一次成篇才有效果），几分钟碎片时间做不了，
     * 所以按"写作轮换"安排：基础档每 3 轮一次，A/B 与四六级每 2 轮一次，雅思每轮一次。 */
    var roundNo = (state.roundIndex || 0) + 1;
    var wShare = base.writing || 0;
    var writingEvery = wShare >= 0.18 ? 1 : (wShare >= 0.10 ? 2 : 3);
    var writingRound = (roundNo % writingEvery) === 0 && (content.writing[stage] || []).length > 0;
    var wAlloc = 0;
    if (writingRound) {
      wAlloc = mins < 30
        ? Math.round(mins * 0.45)
        : Math.min(Math.round(mins * 0.5), Math.max(20, Math.round(mins * wShare * writingEvery)));
      if (wAlloc < 12) { writingRound = false; wAlloc = 0; }
    }

    // 权重：写作之外的四项按掌握度缺口加权
    var rawW = {}, sum = 0;
    SKILLS.forEach(function (s) {
      if (s === 'writing') return;
      var w;
      if (first) {
        w = base[s];
      } else {
        var need = an.skillMap[s].need;
        w = base[s] * (0.55 + 1.35 * need);
        if (an.skillMap[s].mastery >= an.skillMap[s].target) w *= 0.45;   // 达标 → 只做维持
        w = Math.max(w, base[s] * 0.3);
      }
      rawW[s] = w; sum += w;
    });

    var restMin = mins - wAlloc;
    var alloc = { writing: wAlloc }, used = wAlloc;
    SKILLS.forEach(function (s) {
      if (s === 'writing') return;
      var share = sum ? rawW[s] / sum : 0.25;
      var m = Math.max(0, Math.round(restMin * share));
      if (share > 0.03 && m < 5) m = 5;
      alloc[s] = m; used += m;
    });
    // 误差修正，让总时长落在预算上
    var diff = mins - used;
    var order = SKILLS.filter(function (s) { return s !== 'writing'; })
      .sort(function (a, b) { return (rawW[b] || 0) - (rawW[a] || 0); });
    var i = 0;
    while (diff !== 0 && i < 300) {
      var sk = order[i % order.length];
      if (diff > 0) { alloc[sk]++; diff--; }
      else if (alloc[sk] > 4) { alloc[sk]--; diff++; }
      i++;
    }
    // 展示用权重（含写作轮换摊薄后的占比）
    var weights = { writing: mins ? wAlloc / mins : 0 };
    SKILLS.forEach(function (s) {
      if (s === 'writing') return;
      weights[s] = sum ? (rawW[s] / sum) * (restMin / mins) : 0;
    });

    var tasks = [];
    var focusTags = an.weakTags.slice(0, 3);

    /* 每种任务的"分钟成本"，用于把时间预算换算成题量 */
    var COST = { reviewWord: 0.35, newWord: 1.2, grammarQ: 2.5, listenItem: 3, dictation: 0.9, passage: 9 };

    /* --- 词汇 --- */
    var due = an.dueWords;
    var newPool = pickNewWords(state, stage, 60);
    var vMin = alloc.vocab;
    var warnings = [];
    var reviewShare = an.dueCount >= 40 ? 0.58 : 0.45;   // 欠账多就先还账
    var reviewMin = (due.length && !first) ? vMin * reviewShare : 0;
    var newMin = vMin - reviewMin;
    var reviewN = reviewMin ? Math.max(5, Math.min(due.length, Math.round(reviewMin / COST.reviewWord))) : 0;
    var newN = Math.min(newPool.length, Math.max(newPool.length ? 5 : 0, Math.round(newMin / COST.newWord)));
    // 新词不够就把时间还给复习
    if (newN < Math.round(newMin / COST.newWord) && due.length > reviewN) {
      var spare = (Math.round(newMin / COST.newWord) - newN) * COST.newWord;
      reviewN = Math.min(due.length, reviewN + Math.round(spare / COST.reviewWord));
    }
    if (due.length === 0 && !first) reviewN = 0;

    /* 复习闸门 —— 对标调研里最重要的一条：
     * "复习量雪崩"是用户卸载的头号原因（每天加 40 个新词 → 复习涨到 200+ → 放弃）。
     * 所以单日复习量设上限，欠账过多时自动停新词、把欠账摊到未来几天。 */
    var capReview = Math.max(8, Math.round(vMin * 0.75 / COST.reviewWord));
    if (due.length > capReview) {
      var debtDays = Math.ceil(due.length / capReview);
      reviewN = Math.min(due.length, capReview);
      if (debtDays >= 4) {
        newN = 0;
        warnings.push('待复习积压 ' + due.length + ' 个词（约 ' + debtDays + ' 天的量）。本轮暂停新词，先把欠账还完 —— 硬扛只会越积越多。');
      } else if (debtDays >= 2 && newN > 0) {
        newN = Math.max(1, Math.round(newN * 0.5));
        warnings.push('待复习 ' + due.length + ' 个词，本轮新词减半（' + newN + ' 个），优先清复习。');
      }
    }

    function addVocabTasks() {
      if (reviewN > 0) {
        tasks.push({
          module: 'vocab', kind: 'review', count: reviewN,
          minutes: Math.round(reviewN * COST.reviewWord),
          refs: due.slice(0, reviewN).map(function (x) { return x.id; }),
          title: '复习到期单词 ' + reviewN + ' 个',
          reason: due.length >= reviewN
            ? '记忆曲线到期的词有 ' + due.length + ' 个，其中 ' + due.filter(function (x) { return (x.card.lapses || 0) > 0; }).length + ' 个是你曾经错过的，先清账。'
            : '当前只有 ' + due.length + ' 个词到期，按最小复习量安排。'
        });
      }
      if (newN > 0 && newPool.length) {
        tasks.push({
          module: 'vocab', kind: 'new', count: newN, minutes: Math.round(newN * COST.newWord),
          refs: newPool.slice(0, newN).map(function (w) { return w.id; }),
          title: '新学单词 ' + newN + ' 个',
          reason: an.vocab.total
            ? '本阶段词汇已覆盖 ' + an.vocab.seen + '/' + an.vocab.total + '（已掌握 ' + an.vocab.mastered + ' 个），还有 ' + an.newAvailable + ' 个新词没学。'
            : '先把本阶段词汇铺开。'
        });
      }
    }
    addVocabTasks();

    /* --- 语法 --- */
    var gPool = pickWeakGrammar(state, stage, Math.max(1, Math.min(3, Math.round(alloc.grammar / 12))));
    var gQ = 0;
    if (alloc.grammar >= 5 && gPool.length) {
      gQ = Math.max(6, Math.round(alloc.grammar / COST.grammarQ));
      tasks.push({
        module: 'grammar', kind: 'study', count: gQ, minutes: Math.round(gQ * COST.grammarQ),
        refs: gPool.map(function (p) { return p.id; }),
        title: '语法：' + gPool.map(function (p) { return p.title; }).join(' + ') + '（' + gQ + ' 题）',
        reason: (focusTags.length ? '你的高频错点在「' + focusTags.map(function (t) { return t.label; }).join('、') + '」，' : '') +
          '本阶段语法掌握度 ' + P.pct(an.skillMap.grammar.mastery) + '%，低于目标 ' + P.pct(an.skillMap.grammar.target) + '%，先攻最薄弱的考点。'
      });
    }

    /* --- 听力（理解 + 听写） --- */
    var dPoolSize = (content.dictation[stage] || []).length;
    var lItems = [], dN = 0;
    if (alloc.listening >= 5) {
      var lMin = alloc.listening;
      var dMin = Math.min(lMin * 0.4, dPoolSize * COST.dictation);
      var qMin = lMin - dMin;
      var lCount = Math.max(1, Math.round(qMin / COST.listenItem));
      lItems = pickItems(state, stage, 'listening', lCount);
      dN = Math.max(3, Math.min(dPoolSize, Math.round(dMin / COST.dictation)));
      var lTask = {
        module: 'listening', kind: 'quiz', count: lItems.length, minutes: Math.round(lItems.length * COST.listenItem),
        refs: lItems.map(function (x) { return x.id; }),
        title: '听力理解 ' + lItems.length + ' 段',
        reason: '听力掌握度 ' + P.pct(an.skillMap.listening.mastery) + '%，语音辨识和细节抓取需要持续输入，每段都可以反复听。'
      };
      var dTask = {
        module: 'listening', kind: 'dictation', count: dN, minutes: Math.round(dN * COST.dictation),
        refs: null,
        title: '听写训练 ' + dN + ' 句',
        reason: '听写会同时暴露拼写、连读和语法问题，是基础段提分最快的手段。'
      };
      if (dN >= 3) tasks.push(dTask);
      tasks.push(lTask);
    }

    /* --- 阅读 --- */
    if (alloc.reading >= 5) {
      var rPool = pickItems(state, stage, 'reading', Math.max(1, Math.round(alloc.reading / COST.passage)));
      tasks.push({
        module: 'reading', kind: 'passage', count: rPool.length, minutes: Math.round(rPool.length * COST.passage),
        refs: rPool.map(function (x) { return x.id; }),
        title: '阅读 ' + rPool.length + ' 篇 + 精读生词',
        reason: '阅读掌握度 ' + P.pct(an.skillMap.reading.mastery) + '%，每篇都带生词表、限时与逐题解析，练定位也练速度。'
      });
    }

    /* --- 写作（按写作轮换安排整篇） --- */
    if (writingRound && wAlloc >= 12) {
      var wItems = pickItems(state, stage, 'writing', 1);
      if (wItems.length) {
        tasks.push({
          module: 'writing', kind: 'essay', count: 1, minutes: wAlloc,
          refs: [wItems[0].id],
          title: '写作：' + wItems[0].title,
          reason: '写作掌握度 ' + P.pct(an.skillMap.writing.mastery) + '%。写作每 ' + writingEvery + ' 轮安排一次整篇（一次写完才有效果），' +
            '先列提纲再成文，交卷后按内容/结构/词汇/语法四维批改。'
        });
      }
    }

    /* --- 时长配平：把没用满的预算补给还能加量的任务 --- */
    function est() { return tasks.reduce(function (s, t) { return s + t.minutes; }, 0); }
    var guard = 0;
    while (est() < mins * 0.93 && guard < 60) {
      guard++;
      var before = est();
      // 优先补新词 → 复习 → 语法 → 听写 → 听力 → 阅读
      var newTask = tasks.filter(function (t) { return t.module === 'vocab' && t.kind === 'new'; })[0];
      var revTask = tasks.filter(function (t) { return t.module === 'vocab' && t.kind === 'review'; })[0];
      var gTask = tasks.filter(function (t) { return t.module === 'grammar'; })[0];
      var dTask2 = tasks.filter(function (t) { return t.module === 'listening' && t.kind === 'dictation'; })[0];
      var lTask2 = tasks.filter(function (t) { return t.module === 'listening' && t.kind === 'quiz'; })[0];
      var rTask = tasks.filter(function (t) { return t.module === 'reading'; })[0];
      if (newTask && newTask.count < newPool.length) {
        newTask.count++; newTask.minutes = Math.round(newTask.count * COST.newWord);
        newTask.refs = newPool.slice(0, newTask.count).map(function (w) { return w.id; });
        newTask.title = '新学单词 ' + newTask.count + ' 个';
      } else if (revTask && revTask.count < due.length) {
        revTask.count++; revTask.minutes = Math.round(revTask.count * COST.reviewWord);
        revTask.refs = due.slice(0, revTask.count).map(function (x) { return x.id; });
        revTask.title = '复习到期单词 ' + revTask.count + ' 个';
      } else if (gTask && gTask.count < 60) {
        gTask.count += 2; gTask.minutes = Math.round(gTask.count * COST.grammarQ);
        gTask.title = gTask.title.replace(/（\d+ 题）/, '（' + gTask.count + ' 题）');
      } else if (dTask2 && dTask2.count < dPoolSize) {
        dTask2.count += 2; dTask2.minutes = Math.round(dTask2.count * COST.dictation);
        dTask2.title = '听写训练 ' + dTask2.count + ' 句';
      } else if (lTask2 && lTask2.count < (content.listening[stage] || []).length) {
        var more = pickItems(state, stage, 'listening', lTask2.count + 1);
        lTask2.count = more.length; lTask2.refs = more.map(function (x) { return x.id; });
        lTask2.minutes = Math.round(more.length * COST.listenItem);
        lTask2.title = '听力理解 ' + more.length + ' 段';
      } else if (rTask && rTask.count < (content.reading[stage] || []).length) {
        var moreR = pickItems(state, stage, 'reading', rTask.count + 1);
        rTask.count = moreR.length; rTask.refs = moreR.map(function (x) { return x.id; });
        rTask.minutes = Math.round(moreR.length * COST.passage);
        rTask.title = '阅读 ' + moreR.length + ' 篇 + 精读生词';
      }
      if (est() === before) break;   // 已经加不动了
    }

    /* --- 反向配平：超出预算太多就收一收（复习任务不动） --- */
    guard = 0;
    while (est() > mins * 1.05 && guard < 60) {
      guard++;
      var before3 = est();
      var gT = tasks.filter(function (t) { return t.module === 'grammar'; })[0];
      var dT = tasks.filter(function (t) { return t.module === 'listening' && t.kind === 'dictation'; })[0];
      var lT = tasks.filter(function (t) { return t.module === 'listening' && t.kind === 'quiz'; })[0];
      var nT = tasks.filter(function (t) { return t.module === 'vocab' && t.kind === 'new'; })[0];
      var rT = tasks.filter(function (t) { return t.module === 'reading'; })[0];
      if (gT && gT.count > 6) {
        gT.count -= 2; gT.minutes = Math.round(gT.count * COST.grammarQ);
        gT.title = gT.title.replace(/（\d+ 题）/, '（' + gT.count + ' 题）');
      } else if (dT && dT.count > 3) {
        dT.count -= 2; dT.minutes = Math.round(dT.count * COST.dictation);
        dT.title = '听写训练 ' + dT.count + ' 句';
      } else if (lT && lT.count > 1) {
        lT.count -= 1;
        lT.refs = lT.refs.slice(0, lT.count);
        lT.minutes = Math.round(lT.count * COST.listenItem);
        lT.title = '听力理解 ' + lT.count + ' 段';
      } else if (nT && nT.count > 5) {
        nT.count -= 1; nT.minutes = Math.round(nT.count * COST.newWord);
        nT.refs = nT.refs.slice(0, nT.count);
        nT.title = '新学单词 ' + nT.count + ' 个';
      } else if (rT && rT.count > 1) {
        rT.count -= 1; rT.refs = rT.refs.slice(0, rT.count);
        rT.minutes = Math.round(rT.count * COST.passage);
        rT.title = '阅读 ' + rT.count + ' 篇 + 精读生词';
      }
      if (est() === before3) break;
    }
    // 若新词任务在配平中被加上但没有 refs
    tasks.forEach(function (t) {
      if (t.module === 'vocab' && t.kind === 'new' && t.refs && !t.refs.length) {
        t.refs = newPool.slice(0, t.count).map(function (w) { return w.id; });
      }
    });

    var totalMin = tasks.reduce(function (s, t) { return s + t.minutes; }, 0);
    var rationale = buildRationale(state, an, tasks, weights, first);

    var plan = {
      roundIndex: (state.roundIndex || 0) + 1,
      createdAt: Date.now(),
      stage: stage,
      minutes: mins,
      alloc: alloc,
      weights: weights,
      tasks: tasks,
      focusTags: focusTags,
      rationale: rationale,
      warnings: warnings,
      reviewCap: capReview,
      done: [],
      analysis: {
        stageMastery: an.stageMastery,
        skills: an.skills.map(function (s) { return { skill: s.skill, mastery: s.mastery }; }),
        weakTags: an.weakTags
      },
      estMinutes: totalMin
    };
    return plan;
  }

  function buildRationale(state, an, tasks, weights, first) {
    var L = [];
    var meta = STAGE_META[state.stage];
    L.push('当前阶段：' + meta.name + '（' + meta.tag + '），综合掌握度 ' + P.pct(an.stageMastery) + '%，目标 ' + P.pct(meta.target) + '%。');
    if (first) {
      L.push('这是你的第 1 轮：先按标准配比把五个模块都摸一遍，看清底子再定重心。');
    } else {
      var weak = an.skills.slice().sort(function (a, b) { return b.need - a.need; })[0];
      var strong = an.skills.slice().sort(function (a, b) { return a.need - b.need; })[0];
      if (weak && weak.need > 0.05) L.push('最薄弱的是' + weak.name + '（' + P.pct(weak.mastery) + '%），所以本轮给它最多的时间权重。');
      if (strong && strong.mastery >= strong.target) L.push(strong.name + '已达标（' + P.pct(strong.mastery) + '%），本轮只安排维持性练习，把时间省给短板。');
      if (an.weakTags.length) {
        L.push('错题分布：' + an.weakTags.map(function (t) {
          return t.label + ' ' + Math.round(t.share * 100) + '%';
        }).join('，') + '。这些考点已优先排进本轮的语法与练习。');
      }
      if (an.dueCount) L.push('有 ' + an.dueCount + ' 个单词到了复习节点，先复习再学新词，符合遗忘曲线。');
    }
    L.push('本轮共 ' + tasks.length + ' 项任务，预计 ' + tasks.reduce(function (s, t) { return s + t.minutes; }, 0) + ' 分钟（你设定每天 ' + (state.profile.dailyMinutes || 40) + ' 分钟）。学完后我会根据正确率、错题类型和记忆情况重新算下一轮。');
    return L;
  }

  /* ================= 记录与提交 ================= */

  function pushError(state, e) {
    state.errors.unshift(e);
    if (state.errors.length > 400) state.errors.length = 400;
  }

  function commit(state, session) {
    // session: {module, stage, minutes, results:[{ref, tag, correct, quality?, score?, prompt, your, correctAnswer, explain, kind}]}
    var stage = session.stage || state.stage;
    var module = session.module;
    var results = session.results || [];
    var before = {};
    SKILLS.forEach(function (s) { before[s] = skillMastery(state, stage, s); });

    var correctN = 0;
    var byRef = {};

    results.forEach(function (r) {
      if (r.correct) correctN++;
      var tag = r.tag || 'other';
      if (!r.correct) {
        pushError(state, {
          ts: Date.now(), stage: stage, module: module, ref: r.ref, tag: tag,
          label: TAG_LABEL[tag] || tag,
          prompt: r.prompt || '', your: r.your, correctAnswer: r.correctAnswer,
          explain: r.explain || '', kind: r.kind || ''
        });
      }
      if (module === 'vocab') {
        var q = r.quality !== undefined ? r.quality : (r.correct ? 4 : 1);
        reviewWord(state, r.ref, q);
      } else if (module === 'grammar') {
        var g = state.grammar[r.ref] || (state.grammar[r.ref] = { attempts: 0, correct: 0, last: 0 });
        g.attempts++; if (r.correct) g.correct++;
        g.last = Date.now();
        g.mastery = (g.correct + 1) / (g.attempts + 2);
        g.due = Date.now() + (r.correct ? 3 * DAY : DAY);
      } else if (module === 'listening' || module === 'reading') {
        var k = byRef[r.ref] || (byRef[r.ref] = { n: 0, c: 0, dict: String(r.ref).indexOf('d:') === 0 });
        k.n++; if (r.correct) k.c++;
      } else if (module === 'writing') {
        // 只有带 score 的结果才更新写作记录（错题条目不计入）
        if (r.score !== undefined) {
          var w = state.writing[r.ref] || (state.writing[r.ref] = { attempts: 0, best: 0, last: 0 });
          w.attempts++;
          w.last = Date.now();
          w.lastScore = P.clamp(r.score, 0, 1);
          if (w.lastScore > (w.best || 0)) w.best = w.lastScore;
        }
      }
    });

    // 整篇/整段的聚合指标
    Object.keys(byRef).forEach(function (ref) {
      var k = byRef[ref];
      if (module === 'listening' || module === 'reading') {
        var store = (module === 'listening' && k.dict) ? state.dictation : state[module];
        var rec = store[ref] || (store[ref] = { attempts: 0, best: 0, last: 0, acc: 0 });
        rec.attempts++;
        rec.last = Date.now();
        var acc = k.n ? k.c / k.n : 0;
        rec.acc = rec.attempts > 1 ? (rec.acc * 0.5 + acc * 0.5) : acc;
        rec.best = Math.max(rec.best || 0, acc);
      }
    });

    if (session.meta && session.meta.wpm) {
      var rid = session.meta.passageId;
      if (rid && state.reading[rid]) state.reading[rid].wpm = session.meta.wpm;
    }

    // 更新技能掌握度
    var changes = [];
    SKILLS.forEach(function (s) {
      var after = skillMastery(state, stage, s);
      state.skills[stage][s] = after;
      if (Math.abs(after - before[s]) > 0.0005) {
        changes.push({ skill: s, name: SKILL_META[s].name, from: before[s], to: after });
      }
    });

    // 当天与整体记录
    var dk = S.dayKey();
    var day = state.days[dk] || (state.days[dk] = { minutes: 0, items: 0, correct: 0, byModule: {} });
    var minutes = session.minutes || 0;
    day.minutes += minutes;
    day.items += results.length;
    day.correct += correctN;
    var bm = day.byModule[module] || (day.byModule[module] = { items: 0, correct: 0, minutes: 0 });
    bm.items += results.length; bm.correct += correctN; bm.minutes += minutes;

    var sess = {
      ts: Date.now(), stage: stage, module: module, minutes: minutes,
      items: results.length, correct: correctN,
      acc: results.length ? correctN / results.length : 0,
      tags: weakTags({ errors: state.errors.filter(function (e) { return Date.now() - e.ts < 60000; }) }, null, 3)
    };
    state.sessions.unshift(sess);
    if (state.sessions.length > 500) state.sessions.length = 500;

    state.counters.vocabIntroduced = Object.keys(state.words).length;
    S.save(true);

    return {
      module: module, stage: stage, minutes: minutes,
      total: results.length, correct: correctN,
      acc: results.length ? correctN / results.length : 0,
      changes: changes
    };
  }

  /* ================= 晋级判定与测试 ================= */

  function checkPromotion(state) {
    var stage = state.stage;
    var idx = STAGES.indexOf(stage);
    var an = analyze(state);
    var blockers = [];
    if (idx >= STAGES.length - 1) return { ready: false, maxed: true, weighted: an.stageMastery, blockers: ['已经是最高阶段'] };
    var minSkill = an.skills.reduce(function (m, s) { return Math.min(m, s.mastery); }, 1);
    if (an.stageMastery < 0.76) blockers.push('综合掌握度 ' + P.pct(an.stageMastery) + '%，需达到 76%');
    if (minSkill < 0.55) {
      var worst = an.skills.slice().sort(function (a, b) { return a.mastery - b.mastery; })[0];
      blockers.push(worst.name + '只有 ' + P.pct(worst.mastery) + '%，单模块需达到 55%');
    }
    var stageSessions = state.sessions.filter(function (s) { return s.stage === stage; });
    if (stageSessions.length < 5) blockers.push('本阶段学习记录 ' + stageSessions.length + ' 次，至少需要 5 次');
    return {
      ready: blockers.length === 0,
      weighted: an.stageMastery, minSkill: minSkill,
      next: STAGES[idx + 1], nextMeta: STAGE_META[STAGES[idx + 1]],
      blockers: blockers
    };
  }

  function promote(state) {
    var idx = STAGES.indexOf(state.stage);
    if (idx < 0 || idx >= STAGES.length - 1) return false;
    state.stage = STAGES[idx + 1];
    if (state.unlocked.indexOf(state.stage) < 0) state.unlocked.push(state.stage);
    state.roundIndex = 0;
    state.plan = null;
    S.save(true);
    return true;
  }

  // 晋级测试：当前阶段混合抽题
  function buildCheckpoint(state, n) {
    n = n || 25;
    var stage = state.stage;
    var items = [];
    function pushChoice(module, tag, ref, q, options, answer, explain) {
      items.push({ module: module, tag: tag, ref: ref, type: 'choice', q: q, options: options, answer: answer, explain: explain });
    }
    // 词汇：英→中
    var vs = P.shuffle(content.vocab[stage] || []).slice(0, Math.round(n * 0.3));
    vs.forEach(function (w) {
      var pool = P.shuffle((content.vocab[stage] || []).filter(function (x) { return x.id !== w.id; })).slice(0, 3);
      var opts = P.shuffle([w].concat(pool));
      pushChoice('vocab', 'vocabq', w.id, '“' + w.word + '” 的意思是？',
        opts.map(function (o) { return o.cn; }), opts.indexOf(w), w.cn + '（' + w.pos + '）');
    });
    // 语法
    var gs = P.shuffle(content.grammar[stage] || []).slice(0, 2);
    gs.forEach(function (p) {
      P.shuffle(p.ex.filter(function (e) { return e.type === 'choice'; })).slice(0, Math.round(n * 0.15)).forEach(function (e) {
        pushChoice('grammar', p.tag, p.id, e.q, e.options, e.answer, e.explain);
      });
    });
    // 听力
    P.shuffle(content.listening[stage] || []).slice(0, 1).forEach(function (it) {
      (it.questions || []).slice(0, 2).forEach(function (q) {
        pushChoice('listening', q.tag, it.id, q.q, q.options, q.answer, q.explain);
      });
    });
    // 阅读
    P.shuffle(content.reading[stage] || []).slice(0, 1).forEach(function (p) {
      (p.questions || []).slice(0, 2).forEach(function (q) {
        pushChoice('reading', q.tag, p.id, '【' + p.title + '】' + q.q, q.options, q.answer, q.explain);
      });
    });
    return P.shuffle(items).slice(0, n);
  }

  /* ================= 摸底测试 ================= */

  // 跨难度阶梯测试：由易到难，用于定位起始阶段
  function buildPlacement() {
    var items = [];
    var plan = [['basic', 8], ['ab', 6], ['cet4', 5], ['cet6', 4], ['ielts', 4]];
    plan.forEach(function (pair) {
      var stage = pair[0], cnt = pair[1];
      // 词汇占一半
      var vN = Math.ceil(cnt / 2);
      P.shuffle(content.vocab[stage] || []).slice(0, vN).forEach(function (w) {
        var pool = P.shuffle((content.vocab[stage] || []).filter(function (x) { return x.id !== w.id; })).slice(0, 3);
        var opts = P.shuffle([w].concat(pool));
        items.push({
          module: 'vocab', stage: stage, tag: 'vocabq', ref: w.id, type: 'choice',
          q: '“' + w.word + '” 的意思是？', options: opts.map(function (o) { return o.cn; }),
          answer: opts.indexOf(w), explain: w.word + ' ' + w.phonetic + ' ' + w.pos + ' ' + w.cn
        });
      });
      // 语法题
      var g = P.shuffle(content.grammar[stage] || [])[0];
      if (g) {
        P.shuffle(g.ex.filter(function (e) { return e.type === 'choice'; })).slice(0, cnt - vN).forEach(function (e) {
          items.push({
            module: 'grammar', stage: stage, tag: g.tag, ref: g.id, type: 'choice',
            q: e.q, options: e.options, answer: e.answer, explain: e.explain
          });
        });
      }
    });
    return items;
  }

  // 根据摸底结果估算起始阶段与初始掌握度
  function applyPlacement(state, results) {
    var byStage = {};
    STAGES.forEach(function (st) { byStage[st] = { n: 0, c: 0 }; });
    results.forEach(function (r) {
      var st = r.stage || 'basic';
      if (!byStage[st]) byStage[st] = { n: 0, c: 0 };
      byStage[st].n++;
      if (r.correct) byStage[st].c++;
    });
    var acc = {};
    STAGES.forEach(function (st) {
      acc[st] = byStage[st].n ? byStage[st].c / byStage[st].n : 0;
    });
    // 找到第一个正确率低于 50% 的档位，从它开始（前一档算过关）
    var startIdx = 0;
    for (var i = 0; i < STAGES.length; i++) {
      if (acc[STAGES[i]] >= 0.5) startIdx = Math.min(STAGES.length - 1, i + 1);
      else break;
    }
    // 若最后一档也过半，就停在雅思
    if (acc[STAGES[STAGES.length - 1]] >= 0.5) startIdx = STAGES.length - 1;
    var start = STAGES[startIdx];
    state.stage = start;
    state.placed = true;
    state.unlocked = STAGES.slice(0, startIdx + 1);
    state.roundIndex = 0;
    state.plan = null;
    // 低档位默认视为已掌握
    STAGES.forEach(function (st, i) {
      var m = i < startIdx ? 0.85 : (i === startIdx ? P.clamp(acc[st], 0.05, 0.7) : 0);
      SKILLS.forEach(function (s) { state.skills[st][s] = m; });
    });
    state.placement = {
      ts: Date.now(), acc: acc, start: start, raw: results.map(function (r) {
        return { module: r.module, stage: r.stage, correct: !!r.correct };
      })
    };
    S.save(true);
    return { start: start, acc: acc, startIdx: startIdx };
  }

  /* ================= 汇总统计 ================= */

  function dashboard(state) {
    var an = analyze(state);
    var totalWords = Object.keys(state.words).length;
    var mastered = Object.keys(state.words).filter(function (k) { return state.words[k].status === 'mastered'; }).length;
    var learning = Object.keys(state.words).filter(function (k) {
      var s = state.words[k].status;
      return s === 'learning' || s === 'review';
    }).length;
    var totalItems = 0, totalCorrect = 0;
    state.sessions.forEach(function (s) { totalItems += s.items; totalCorrect += s.correct; });
    var stages = STAGES.map(function (st) {
      return {
        stage: st, meta: STAGE_META[st],
        mastery: stageMastery(state, st),
        unlocked: state.unlocked.indexOf(st) >= 0,
        current: state.stage === st,
        skills: SKILLS.map(function (s) {
          return { skill: s, name: SKILL_META[s].name, mastery: skillMastery(state, st, s), total: stageTotal(st, s) };
        })
      };
    });
    return {
      analysis: an, stages: stages,
      words: { total: totalWords, mastered: mastered, learning: learning, due: an.dueCount },
      overall: {
        items: totalItems, correct: totalCorrect,
        acc: totalItems ? totalCorrect / totalItems : 0,
        sessions: state.sessions.length,
        streak: S.streak(),
        minutes: Object.keys(state.days).reduce(function (s, k) { return s + (state.days[k].minutes || 0); }, 0)
      },
      errors: state.errors
    };
  }

  /* ================= 导出 ================= */

  return {
    STAGES: STAGES, SKILLS: SKILLS, STAGE_META: STAGE_META, SKILL_META: SKILL_META,
    BASE_WEIGHTS: BASE_WEIGHTS, TAG_LABEL: TAG_LABEL, TAG_RULES: TAG_RULES,
    init: init, content: function () { return content; }, index: function () { return index; },
    stats: stats, ready: function () { return ready; },
    skillMastery: skillMastery, stageMastery: stageMastery, analyze: analyze,
    wordCoverage: wordCoverage, dueWords: dueWords, weakTags: weakTags,
    reviewWord: reviewWord, passRate: passRate,
    RUNGS: RUNGS, RUNG_LABEL: RUNG_LABEL, rungOf: rungOf, nextReviewText: nextReviewText,
    pickNewWords: pickNewWords, pickWeakGrammar: pickWeakGrammar, pickItems: pickItems,
    buildPlan: buildPlan, commit: commit, addErrors: function (state, list) {
      (list || []).forEach(function (e) { pushError(state, e); });
      S.save(true);
    },
    checkPromotion: checkPromotion, promote: promote, buildCheckpoint: buildCheckpoint,
    buildPlacement: buildPlacement, applyPlacement: applyPlacement,
    dashboard: dashboard, tagOfGrammar: tagOfGrammar
  };
})();
if (typeof module === 'object' && module.exports) { module.exports = ECEngine; }
if (typeof window !== 'undefined') { window.ECEngine = ECEngine; }
