/* 写作自动批改（启发式机改）
 * 四个维度打分：内容完成度 / 篇章结构 / 词汇丰富度 / 语法准确度
 * 输出：得分、维度建议、逐条问题、中式英语提醒、升级表达、范文对比
 * 说明：机改用于即时反馈与错误定位，不替代人工评分。
 */
var ECWriteGrade = (function () {
  'use strict';

  var P = (typeof ECParse !== 'undefined') ? ECParse
    : (typeof require === 'function' ? require('../core/parse.js') : null);

  var CONNECTORS = ['however', 'therefore', 'moreover', 'furthermore', 'in addition', 'besides',
    'firstly', 'first of all', 'secondly', 'thirdly', 'finally', 'in conclusion', 'to sum up',
    'on the one hand', 'on the other hand', 'as a result', 'for example', 'for instance',
    'in my opinion', 'from my perspective', 'although', 'while', 'whereas', 'because', 'since',
    'so that', 'in short', 'what is more', 'nevertheless', 'consequently', 'meanwhile',
    'first', 'second', 'then', 'also', 'but', 'so', 'because', 'and'];

  var STOP = ('the a an and or but if while of to in on at by for with from as is are was were be been being ' +
    'i you he she it we they me him her us them my your his its our their this that these those there here ' +
    'do does did done have has had will would can could should must may might not no yes so very more most ' +
    'than then too also just only about into over after before up down out off again once all any both each ' +
    'few other some such what which who whom when where why how one two three use used using make made ' +
    'take took get got go went come came see saw know knew think thought want wanted like liked need ' +
    'people time way thing things good bad new old many much lot lots').split(' ');

  var STOPMAP = {};
  STOP.forEach(function (w) { STOPMAP[w] = 1; });

  // 基础词 → 更高级表达（用于给出"升级建议"）
  var UPGRADE = [
    [/\ba lot of\b/gi, 'a considerable amount of / numerous', '书面语中避免 a lot of'],
    [/\blots of\b/gi, 'plenty of / a great deal of', '书面语中避免 lots of'],
    [/\bvery good\b/gi, 'excellent / remarkable', 'very + 形容词 可换成更强的单词'],
    [/\bvery important\b/gi, 'crucial / vital / essential', '升级：crucial 比 very important 更书面'],
    [/\bvery big\b/gi, 'enormous / substantial', '升级：enormous 更精确'],
    [/\bvery many\b/gi, 'a great many', '升级为书面搭配'],
    [/\bmore and more\b/gi, 'an increasing number of', '升级：an increasing number of 更符合考试书面语'],
    [/\bI think\b/gi, 'I believe / In my view / It seems to me that', '避免反复用 I think'],
    [/\bget\b/gi, 'obtain / acquire / receive（按语义选择）', 'get 过于口语，写作中可升级'],
    [/\bhelp\b/gi, 'facilitate / contribute to / be conducive to', '升级：facilitate 更学术'],
    [/\buse\b/gi, 'utilise / make use of / employ', '升级：utilise 更书面'],
    [/\bgood at\b/gi, 'proficient in / adept at', '升级表达'],
    [/\bbad\b/gi, 'harmful / detrimental / adverse', '升级：detrimental 更学术'],
    [/\bso\b/gi, 'therefore / consequently / thus', '句首避免用 so，改用 therefore'],
    [/\bbut\b/gi, 'however / nevertheless / yet', '句首避免用 but，改用 however'],
    [/\bbecause of\b/gi, 'owing to / due to / on account of', '多样化的原因表达'],
    [/\bimportant\b/gi, 'significant / vital / crucial', '注意 important 不要重复太多次']
  ];

  // 中式英语 / 高频语法错误规则
  var RULES = [
    { re: /\b(he|she|it)\s+(go|do|have|like|want|need|make|take|study|watch|play|live|work|come|read|write|teach|help)\b/gi,
      tag: 'third', label: '第三人称单数', advice: '主语是 he/she/it 时，一般现在时动词要加 -s/-es。' },
    { re: /\b(he|she|it)\s+(don't|doesn't|do not)\b/gi, tag: 'third', label: '第三人称单数否定', advice: 'he/she/it 的否定用 doesn\'t。' },
    { re: /\b(I|we|they|you)\s+(is|was)\b/gi, tag: 'be', label: 'be 动词搭配', advice: 'I 用 am，we/they/you 用 are/were。' },
    { re: /\b(he|she|it)\s+(are|were)\b/gi, tag: 'be', label: 'be 动词搭配', advice: 'he/she/it 用 is/was。' },
    { re: /\bI\s+am\s+agree\b/gi, tag: 'be', label: '典型中式错误', advice: 'agree 是动词，直接说 I agree。' },
    { re: /\bthere\s+(have|has)\b/gi, tag: 'therebe', label: 'there be 句型', advice: '表示"有"用 there is/are，不能用 there have。' },
    { re: /\ba\s+[aeiouAEIOU]/g, tag: 'article', label: '冠词 a/an', advice: '元音音素开头的词前用 an。' },
    { re: /\ban\s+[bcdfghjklmnpqrstvwxyzBCDFGHJKLMNPQRSTVWXYZ]/g, tag: 'article', label: '冠词 a/an', advice: '辅音音素开头的词前用 a。' },
    { re: /\bmany\s+(water|money|information|advice|news|homework|furniture|equipment|knowledge|traffic)\b/gi,
      tag: 'noun', label: '不可数名词', advice: '不可数名词用 much / a great deal of，不能用 many。' },
    { re: /\bmuch\s+(books|people|students|things|problems|reasons|ways|cars|words)\b/gi,
      tag: 'noun', label: '可数名词', advice: '可数名词复数用 many / a large number of。' },
    { re: /\bpeople\s+is\b/gi, tag: 'noun', label: '主谓一致', advice: 'people 是复数，谓语用 are。' },
    { re: /\bmore\s+(better|worse|bigger|smaller|easier|harder|faster|higher)\b/gi,
      tag: 'comparative', label: '比较级重复', advice: 'better 已是比较级，前面不能再加 more。' },
    { re: /\bmost\s+(best|worst|biggest)\b/gi, tag: 'comparative', label: '最高级重复', advice: 'best 已是最高级，前面不能再加 most。' },
    { re: /\b(can|should|must|may|will)\s+to\s+\w+/gi, tag: 'modal', label: '情态动词', advice: '情态动词后接动词原形，不加 to。' },
    { re: /\b(can|should|must|may|will)\s+(goes|went|going|did|has|had)\b/gi, tag: 'modal', label: '情态动词', advice: '情态动词后必须用动词原形。' },
    { re: /\b(discuss|enter|reach|marry|answer|attend)\s+about\b/gi, tag: 'prep', label: '多余介词', advice: 'discuss/enter/reach 等是及物动词，后面不加 about。' },
    { re: /\bin\s+the\s+last\s+(week|month|year)\b/gi, tag: 'tense', label: '时态搭配', advice: '"在过去一周里"常用 in the past week，且常与现在完成时连用。' },
    { re: /\bvery\s+like\b/gi, tag: 'other', label: '中式英语', advice: 'like 是动词，用 like ... very much 或 really like。' },
    { re: /\bopen\s+the\s+(light|TV)\b/gi, tag: 'other', label: '中式英语', advice: '开灯/开电视用 turn on the light/TV。' },
    { re: /\bclose\s+the\s+(light|TV)\b/gi, tag: 'other', label: '中式英语', advice: '关灯/关电视用 turn off the light/TV。' },
    { re: /\bwith\s+the\s+development\s+of\s+society\b/gi, tag: 'other', label: '套话', advice: '这个开头过于模板化，换成具体背景句得分更高。' },
    { re: /\baccording\s+to\s+me\b/gi, tag: 'other', label: '中式英语', advice: '表达"我认为"用 in my opinion / from my perspective。' },
    { re: /\b(\w+)\s+\1\b/gi, tag: 'other', label: '重复用词', advice: '同一个词连续出现两次，检查是否多写。' },
    { re: /,\s*(I|he|she|it|we|they|you|this|that|there)\s+\w+/g, tag: 'other', label: '逗号连接句', advice: '两个完整句子之间不能用逗号，应用句号或加连词。' },
    { re: /\bi\b(?![.]\w)/g, tag: 'other', label: '大小写', advice: '第一人称代词 I 永远大写。' }
  ];

  function tokens(text) {
    var m = String(text || '').match(/[A-Za-z][A-Za-z'\-]*/g) || [];
    return m;
  }

  function sentences(text) {
    return String(text || '')
      .split(/(?<=[.!?])\s+|\n+/)
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return tokens(s).length > 1; });
  }

  function paragraphs(text) {
    return String(text || '').split(/\n\s*\n+/).map(function (s) { return s.trim(); })
      .filter(function (s) { return tokens(s).length > 0; });
  }

  // 已知词表：全部语料词汇 + 范文用词 + 常用功能词
  var knownCache = null;
  function knownWords() {
    if (knownCache) return knownCache;
    var set = Object.create(null);
    STOP.forEach(function (w) { set[w] = 1; });
    ['dont', 'doesnt', 'didnt', 'cant', 'wont', 'isnt', 'arent', 'wasnt', 'werent', 'its', 'im', 'ive',
      'ill', 'id', 'thats', 'whats', 'theres', 'youre', 'theyre', 'were', 'lets', 'hes', 'shes'].forEach(function (w) { set[w] = 1; });
    try {
      var E = (typeof ECEngine !== 'undefined') ? ECEngine : (typeof require === 'function' ? require('./engine.js') : null);
      var c = E && E.content ? E.content() : null;
      if (c) {
        Object.keys(c.vocab).forEach(function (st) {
          c.vocab[st].forEach(function (w) { set[w.word.toLowerCase()] = 1; });
        });
        Object.keys(c.writing).forEach(function (st) {
          c.writing[st].forEach(function (p) {
            tokens(p.model).forEach(function (w) { set[w.toLowerCase()] = 1; });
          });
        });
      }
    } catch (e) { /* 无引擎时只用基础词表 */ }
    knownCache = set;
    return set;
  }

  function spellCheck(text) {
    var set = knownWords();
    var seen = {}, issues = [];
    tokens(text).forEach(function (raw) {
      var w = raw.toLowerCase().replace(/^'+|'+$/g, '');
      if (!w || w.length < 4 || seen[w]) return;
      seen[w] = 1;
      if (set[w]) return;
      // 与已知词做 1 步编辑距离比对，提示可能的拼写错误
      var close = null;
      var keys = Object.keys(set);
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        if (Math.abs(k.length - w.length) > 1) continue;
        if (P.editDistance(w, k) <= 1) { close = k; break; }
      }
      if (close) {
        issues.push({ type: 'error', tag: 'spelling', label: '拼写', snippet: raw, advice: '疑似拼写错误：' + raw + ' → ' + close });
      } else if (w.length >= 6) {
        issues.push({ type: 'warn', tag: 'spelling', label: '生词/拼写', snippet: raw, advice: '这个词不在常用词表中（' + raw + '），确认拼写是否正确、是否用了恰当的词。' });
      }
    });
    return issues;
  }

  function ruleCheck(text) {
    var issues = [];
    RULES.forEach(function (r) {
      var m, count = 0;
      var re = new RegExp(r.re.source, r.re.flags);
      while ((m = re.exec(text)) !== null && count < 3) {
        issues.push({
          type: 'error', tag: r.tag, label: r.label,
          snippet: m[0].length > 60 ? m[0].slice(0, 60) + '…' : m[0],
          advice: r.advice
        });
        count++;
        if (m.index === re.lastIndex) re.lastIndex++;
      }
    });
    return issues;
  }

  function upgradeCheck(text) {
    var out = [];
    UPGRADE.forEach(function (u) {
      var re = new RegExp(u[0].source, u[0].flags);
      var m = re.exec(text);
      if (m) out.push({ from: m[0], to: u[1], tip: u[2] });
    });
    return out;
  }

  // 内容要点关键词：取范文中出现频率高、非停用词的实词
  function keyContentWords(item) {
    var freq = Object.create(null);
    tokens((item.model || '') + ' ' + (item.prompt || '')).forEach(function (w) {
      var k = w.toLowerCase();
      if (k.length < 4 || STOPMAP[k]) return;
      freq[k] = (freq[k] || 0) + 1;
    });
    return Object.keys(freq).sort(function (a, b) { return freq[b] - freq[a]; }).slice(0, 14);
  }

  function grade(text, item, state) {
    text = String(text || '');
    var tk = tokens(text);
    var low = text.toLowerCase();
    var wordCount = tk.length;
    var sents = sentences(text);
    var paras = paragraphs(text);
    var minWords = (item && item.minWords) || 80;
    var stage = (item && item.stage) || 'basic';

    /* --- 1. 内容完成度 --- */
    var lenRatio = wordCount / minWords;
    var lenScore = P.clamp(lenRatio, 0, 1) * (lenRatio > 1.8 ? 0.9 : 1);
    var keys = keyContentWords(item || {});
    var hitKeys = keys.filter(function (k) { return low.indexOf(k) >= 0; });
    var keyScore = keys.length ? hitKeys.length / Math.min(keys.length, 10) : 0.5;
    var contentScore = P.clamp(0.5 * lenScore + 0.5 * P.clamp(keyScore, 0, 1), 0, 1);
    var contentAdvice = [];
    if (lenRatio < 1) contentAdvice.push('字数不足：写了 ' + wordCount + ' 词，要求至少 ' + minWords + ' 词，考试会直接扣分。');
    else if (lenRatio > 1.8) contentAdvice.push('篇幅超出要求较多（' + wordCount + ' 词），注意控制重点、避免流水账。');
    if (keys.length && keyScore < 0.45) contentAdvice.push('题目要点覆盖不足，范文涉及的关键内容如 ' + keys.slice(0, 6).join('、') + ' 几乎没有提到。');
    if (!contentAdvice.length) contentAdvice.push('内容覆盖到位，长度符合要求。');

    /* --- 2. 篇章结构 --- */
    var connCount = 0;
    CONNECTORS.forEach(function (c) {
      var re = new RegExp('\\b' + c.replace(/ /g, '\\s+') + '\\b', 'gi');
      var m = text.match(re);
      if (m) connCount += m.length;
    });
    var connDensity = wordCount ? connCount / (wordCount / 100) : 0;    // 每 100 词连接词数
    var paraScore = paras.length >= 3 ? 1 : (paras.length === 2 ? 0.7 : 0.35);
    var connScore = P.clamp(connDensity / 3, 0, 1);
    var sentLenAvg = sents.length ? wordCount / sents.length : 0;
    var variety = 0;
    if (sentLenAvg >= 8 && sentLenAvg <= 22) variety = 1;
    else if (sentLenAvg < 8) variety = 0.5;
    else variety = 0.7;
    var structScore = P.clamp(0.4 * paraScore + 0.4 * connScore + 0.2 * variety, 0, 1);
    var structAdvice = [];
    if (paras.length < 3) structAdvice.push('段落太少（' + paras.length + ' 段）。建议"总—分—总"或"观点—理由—例子"至少 3 段。');
    if (connScore < 0.5) structAdvice.push('衔接词偏少（每百词 ' + connDensity.toFixed(1) + ' 个）。补 however / therefore / in addition / for example 等，让逻辑显性化。');
    if (sentLenAvg > 22) structAdvice.push('句子偏长（平均 ' + sentLenAvg.toFixed(1) + ' 词/句），长句容易失控，建议长短句交替。');
    if (!structAdvice.length) structAdvice.push('结构清晰，段落与衔接处理得当。');

    /* --- 3. 词汇丰富度 --- */
    var lower = tk.map(function (w) { return w.toLowerCase(); });
    var uniq = {};
    lower.forEach(function (w) { uniq[w] = 1; });
    var ttr = lower.length ? Object.keys(uniq).length / lower.length : 0;
    var advanced = 0;
    try {
      var E2 = (typeof ECEngine !== 'undefined') ? ECEngine : (typeof require === 'function' ? require('./engine.js') : null);
      var c2 = E2 && E2.content ? E2.content() : null;
      if (c2 && c2.vocab) {
        var higher = ['cet4', 'cet6', 'ielts'];
        var set4 = {};
        higher.forEach(function (st) {
          (c2.vocab[st] || []).forEach(function (w) { set4[w.word.toLowerCase()] = 1; });
        });
        lower.forEach(function (w) { if (set4[w]) advanced++; });
      }
    } catch (e) { }
    var phraseHits = 0, phraseTotal = 0;
    ((item && item.highlights) || []).forEach(function (h) {
      phraseTotal++;
      var key = String(h[0]).toLowerCase().replace(/\.\.\./g, '').split(/[,(]/)[0].trim();
      if (key && key.split(' ').length > 1 && low.indexOf(key) >= 0) phraseHits++;
      else if (key && key.split(' ').length === 1 && new RegExp('\\b' + key + '\\b').test(low)) phraseHits++;
    });
    ((item && item.useful) || []).forEach(function (u) {
      phraseTotal++;
      var key = String(u).toLowerCase().split(/[,(]/)[0].trim();
      if (key && low.indexOf(key) >= 0) phraseHits++;
    });
    var lexScore = P.clamp(
      0.35 * P.clamp((ttr - 0.4) / 0.3, 0, 1) +
      0.35 * P.clamp(advanced / Math.max(3, wordCount / 25), 0, 1) +
      0.30 * (phraseTotal ? phraseHits / Math.min(phraseTotal, 6) : 0.4), 0, 1);
    var lexAdvice = [];
    if (ttr < 0.55) lexAdvice.push('重复用词较多（词汇多样性 ' + P.pct(ttr) + '%），试着用同义替换，例如 important → significant / crucial。');
    if (advanced < 2) lexAdvice.push('高级词汇很少（用了 ' + advanced + ' 个四六级及以上词）。至少替换 3~5 处基础词，能明显提分。');
    if (phraseTotal && phraseHits < 2) lexAdvice.push('范文中的亮点句式/短语用得少，背下来后直接套用：' + ((item.highlights || []).slice(0, 3).map(function (h) { return h[0]; }).join('；')) + '。');
    if (!lexAdvice.length) lexAdvice.push('词汇有变化，能主动使用较高级表达。');

    /* --- 4. 语法准确度 --- */
    var issues = ruleCheck(text).concat(spellCheck(text));
    var errWeight = issues.reduce(function (s, i) { return s + (i.type === 'error' ? 1 : 0.5); }, 0);
    var errRate = wordCount ? errWeight / (wordCount / 100) : 0;   // 每百词错误数
    var gramScore = P.clamp(1 - errRate / 8, 0, 1);
    var gramAdvice = [];
    if (!issues.length) gramAdvice.push('未检出明显语法或拼写问题，继续保持。');
    else gramAdvice.push('检出 ' + issues.length + ' 处可疑问题，逐条对照修改；每百词约 ' + errRate.toFixed(1) + ' 处。');
    if (sents.length && sents[0] && /^[a-z]/.test(sents[0])) gramAdvice.push('句首字母要大写。');

    var dims = [
      { key: 'content', name: '内容完成度', weight: 0.25, score: contentScore, advice: contentAdvice },
      { key: 'structure', name: '篇章结构', weight: 0.25, score: structScore, advice: structAdvice },
      { key: 'lexis', name: '词汇丰富度', weight: 0.25, score: lexScore, advice: lexAdvice },
      { key: 'grammar', name: '语法准确度', weight: 0.25, score: gramScore, advice: gramAdvice }
    ];
    var score = P.clamp(dims.reduce(function (s, d) { return s + d.score * d.weight; }, 0), 0, 1);

    var band;
    if (stage === 'ielts') band = (Math.round((4 + score * 5) * 2) / 2).toFixed(1) + ' 分（雅思写作估分）';
    else if (stage === 'basic') band = Math.round(score * 100) + ' / 100';
    else band = (Math.round(score * 15 * 10) / 10) + ' / 15 分';

    // 必修清单
    var checklist = [];
    checklist.push({ done: lenRatio >= 1, text: '词数达到 ' + minWords + ' 词（当前 ' + wordCount + '）' });
    checklist.push({ done: paras.length >= 3, text: '至少 3 个自然段（当前 ' + paras.length + '）' });
    checklist.push({ done: connCount >= 3, text: '使用 3 个以上衔接词（当前 ' + connCount + '）' });
    checklist.push({ done: advanced >= 3, text: '使用 3 个以上四级/六级词汇（当前 ' + advanced + '）' });
    checklist.push({ done: issues.filter(function (i) { return i.type === 'error'; }).length <= 2, text: '语法错误不超过 2 处' });
    checklist.push({ done: keys.length ? keyScore >= 0.5 : true, text: '覆盖题目要求的要点' });

    return {
      stage: stage, words: wordCount, sentences: sents.length, paragraphs: paras.length,
      minWords: minWords, score: score, band: band, dims: dims,
      issues: issues.slice(0, 24), issueCount: issues.length,
      upgrades: upgradeCheck(text).slice(0, 6),
      checklist: checklist,
      keyWords: { total: keys.length, hit: hitKeys.length, missing: keys.filter(function (k) { return hitKeys.indexOf(k) < 0; }) },
      stats: { ttr: ttr, advanced: advanced, connectors: connCount, avgSentence: sentLenAvg, errorPer100: errRate },
      isDraft: false
    };
  }

  return { grade: grade, RULES: RULES, UPGRADE: UPGRADE, CONNECTORS: CONNECTORS, resetCache: function () { knownCache = null; } };
})();
if (typeof module === 'object' && module.exports) { module.exports = ECWriteGrade; }
if (typeof window !== 'undefined') { window.ECWriteGrade = ECWriteGrade; }
