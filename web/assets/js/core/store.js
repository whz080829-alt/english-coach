/* 存储层：本地持久化（localStorage，失败时退化为内存）
 * 负责状态结构定义、读写、导入导出。
 */
var ECStore = (function () {
  'use strict';

  var KEY = 'ec_english_coach_state';
  var VERSION = 1;
  var memory = null;      // localStorage 不可用时的兜底
  var storageOK = true;

  try {
    var probe = '__ec_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
  } catch (e) { storageOK = false; }

  var STAGES = ['basic', 'ab', 'cet4', 'cet6', 'ielts'];
  var SKILLS = ['vocab', 'grammar', 'listening', 'reading', 'writing'];

  function emptyStageSkills() {
    var o = {};
    SKILLS.forEach(function (s) { o[s] = 0; });
    return o;
  }

  function defaults() {
    var skills = {};
    STAGES.forEach(function (st) { skills[st] = emptyStageSkills(); });
    return {
      version: VERSION,
      createdAt: Date.now(),
      profile: {
        nickname: '',
        target: 'cet4',            // 目标档位
        dailyMinutes: 40,
        examDate: '',
        ttsRate: 0.9,
        ttsVoice: '',
        theme: 'dark'
      },
      stage: 'basic',
      unlocked: ['basic'],
      placed: false,
      placement: null,             // 摸底结果
      skills: skills,
      words: {},                   // id -> 记忆卡片
      grammar: {},                 // id -> {attempts, correct, mastery, due, last}
      listening: {},               // id -> {attempts, best, last}
      dictation: {},               // key -> {attempts, best, last}
      reading: {},                 // id -> {attempts, best, last, wpm}
      writing: {},                 // id -> {attempts, best, last}
      errors: [],                  // 错题本
      sessions: [],                // 学习记录
      days: {},                    // 'YYYY-MM-DD' -> {minutes, items, correct, byModule}
      plan: null,                  // 当前一轮计划
      roundIndex: 0,
      counters: { vocabIntroduced: 0 }
    };
  }

  function merge(base, saved) {
    // 浅合并 + 关键字段深合并，兼容旧版本
    var out = base;
    if (!saved || typeof saved !== 'object') return out;
    Object.keys(saved).forEach(function (k) {
      if (k === 'skills' || k === 'days' || k === 'words' || k === 'profile') return;
      out[k] = saved[k];
    });
    if (saved.profile) {
      Object.keys(base.profile).forEach(function (k) {
        if (saved.profile[k] !== undefined) out.profile[k] = saved.profile[k];
      });
    }
    if (saved.skills) {
      STAGES.forEach(function (st) {
        if (saved.skills[st]) {
          SKILLS.forEach(function (s) {
            if (typeof saved.skills[st][s] === 'number') out.skills[st][s] = saved.skills[st][s];
          });
        }
      });
    }
    if (saved.days) out.days = saved.days;
    if (saved.words) out.words = saved.words;
    return out;
  }

  var state = null;

  function load() {
    var saved = null;
    if (storageOK) {
      try { saved = JSON.parse(window.localStorage.getItem(KEY) || 'null'); } catch (e) { saved = null; }
    } else if (memory) {
      saved = memory;
    }
    state = merge(defaults(), saved);
    return state;
  }

  function get() { if (!state) load(); return state; }

  var saveTimer = null;
  var observers = [];

  function onSave(fn) { observers.push(fn); return fn; }

  function save(immediate) {
    if (!state) return;
    if (!storageOK) {
      memory = state;
    } else if (immediate) {
      clearTimeout(saveTimer);
      try { window.localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { storageOK = false; memory = state; }
    } else {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(function () { save(true); }, 250);
    }
    // 通知观察者（云同步层据此把状态标记为"待上传"）
    for (var i = 0; i < observers.length; i++) {
      try { observers[i](); } catch (e) { }
    }
  }

  // 用一份完整状态替换当前状态（云同步合并之后用），并落盘
  function replace(next) {
    if (!next || typeof next !== 'object') return state;
    state = merge(defaults(), next);
    save(true);
    return state;
  }

  function reset() {
    state = defaults();
    save(true);
    return state;
  }

  function exportText() { return JSON.stringify(get(), null, 2); }

  function importText(txt) {
    var obj = JSON.parse(txt);
    if (!obj || typeof obj !== 'object') throw new Error('不是有效的存档');
    state = merge(defaults(), obj);
    save(true);
    return state;
  }

  /* ---------- 日期工具 ---------- */
  function dayKey(ts) {
    var d = new Date(ts === undefined ? Date.now() : ts);
    var m = d.getMonth() + 1, dd = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (dd < 10 ? '0' + dd : dd);
  }

  function dayLog(day) {
    var s = get();
    var k = day || dayKey();
    if (!s.days[k]) s.days[k] = { minutes: 0, items: 0, correct: 0, byModule: {} };
    return s.days[k];
  }

  function todayMinutes() { return dayLog().minutes || 0; }

  // 连续打卡天数（今天没学则从昨天往前算）
  function streak() {
    var s = get();
    var d = new Date();
    var k0 = dayKey(d.getTime());
    if (!(s.days[k0] && s.days[k0].items > 0)) d.setDate(d.getDate() - 1);
    var n = 0;
    for (var i = 0; i < 400; i++) {
      var k = dayKey(d.getTime());
      var rec = s.days[k];
      if (rec && rec.items > 0) { n++; } else { break; }
      d.setDate(d.getDate() - 1);
    }
    return n;
  }

  return {
    STAGES: STAGES, SKILLS: SKILLS, KEY: KEY,
    get: get, load: load, save: save, reset: reset, defaults: defaults,
    replace: replace, onSave: onSave,
    exportText: exportText, importText: importText,
    dayKey: dayKey, dayLog: dayLog, todayMinutes: todayMinutes, streak: streak,
    storageOK: function () { return storageOK; }
  };
})();
if (typeof module === 'object' && module.exports) { module.exports = ECStore; }
if (typeof window !== 'undefined') { window.ECStore = ECStore; }
