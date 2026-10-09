/* 语音层：基于浏览器 Web Speech API（语音合成）朗读英文
 * 无需音频文件，离线可用；对话会自动切换英美音色并加停顿。
 */
var ECTTS = (function () {
  'use strict';

  var synth = (typeof window !== 'undefined' && window.speechSynthesis) ? window.speechSynthesis : null;
  var allVoices = [];
  var current = null;
  var queue = [];
  var playing = false;
  var rate = 0.9;
  var preferred = '';

  function supported() { return !!synth; }

  function refreshVoices() {
    if (!synth) return [];
    allVoices = synth.getVoices() || [];
    return allVoices;
  }

  function englishVoices() {
    if (!allVoices.length) refreshVoices();
    return allVoices.filter(function (v) { return /^en(-|_|$)/i.test(v.lang || ''); });
  }

  // 优先：本地音色 > 指定音色 > 英式/美式女声
  function resolveVoice(opts) {
    opts = opts || {};
    var list = englishVoices();
    if (!list.length) return null;
    if (opts.voiceName) {
      for (var i = 0; i < list.length; i++) { if (list[i].name === opts.voiceName) return list[i]; }
    }
    if (opts.index !== undefined && list.length) return list[opts.index % list.length];
    var want = preferred;
    if (want) {
      for (i = 0; i < list.length; i++) { if (list[i].name === want) return list[i]; }
    }
    var local = list.filter(function (v) { return v.localService; });
    var pool = local.length ? local : list;
    var prefer = pool.filter(function (v) { return /en-GB/i.test(v.lang); });
    return (prefer.length ? prefer : pool)[0];
  }

  function utter(text, opts) {
    return new Promise(function (resolve) {
      if (!synth || !text) { resolve(false); return; }
      var u = new SpeechSynthesisUtterance(String(text));
      u.lang = opts.lang || 'en-GB';
      u.rate = opts.rate !== undefined ? opts.rate : rate;
      u.pitch = opts.pitch !== undefined ? opts.pitch : 1;
      u.volume = 1;
      var v = resolveVoice(opts);
      if (v) { u.voice = v; u.lang = v.lang || u.lang; }
      var done = false;
      function finish() { if (!done) { done = true; resolve(true); } }
      u.onend = finish;
      u.onerror = finish;
      // 兜底：某些浏览器（尤其 file:// 首次调用）不触发 onend
      var guard = setTimeout(finish, Math.max(2500, String(text).length * 220));
      u.onend = function () { clearTimeout(guard); finish(); };
      u.onerror = function () { clearTimeout(guard); finish(); };
      try { synth.speak(u); } catch (e) { clearTimeout(guard); finish(); }
    });
  }

  function wait(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  // 朗读单句
  function speak(text, opts) {
    if (!synth) return Promise.resolve(false);
    synth.cancel();
    playing = true;
    return utter(text, opts || {}).then(function (r) { playing = false; return r; });
  }

  // 朗读对话/独白：script = [[speaker, line], ...]，说话人变化时切换音色并停顿
  function speakScript(script, opts) {
    opts = opts || {};
    if (!synth) return Promise.resolve(false);
    synth.cancel();
    playing = true;
    var voices = englishVoices();
    var map = {};
    var used = 0;
    var chain = Promise.resolve();
    script.forEach(function (line) {
      var spk = line[0], text = line[1];
      chain = chain.then(function () {
        if (!map[spk]) {
          map[spk] = used;
          used++;
        }
        return utter(text, {
          rate: opts.rate !== undefined ? opts.rate : rate,
          voiceName: opts.voiceName,
          index: voices.length > 1 ? map[spk] % Math.min(voices.length, 2) : 0
        });
      }).then(function () { return wait(opts.gap === undefined ? 320 : opts.gap); });
    });
    return chain.then(function () { playing = false; return true; });
  }

  function stop() {
    if (synth) synth.cancel();
    playing = false;
  }

  function isPlaying() { return playing; }
  function setRate(r) { rate = r; }
  function getRate() { return rate; }
  function setPreferred(name) { preferred = name || ''; }

  function init() {
    if (!synth) return;
    refreshVoices();
    if (synth.onvoiceschanged !== undefined) {
      synth.onvoiceschanged = function () { refreshVoices(); };
    }
  }

  return {
    supported: supported, init: init, speak: speak, speakScript: speakScript,
    stop: stop, isPlaying: isPlaying, setRate: setRate, getRate: getRate,
    setPreferred: setPreferred, voices: englishVoices, refresh: refreshVoices
  };
})();
if (typeof module === 'object' && module.exports) { module.exports = ECTTS; }
if (typeof window !== 'undefined') { window.ECTTS = ECTTS; }
