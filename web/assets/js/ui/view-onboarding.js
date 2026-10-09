/* 视图：新用户个性化引导
 * 三步：① 目标考试 → ② 每日时间与考试日期 → ③ 摸底测试定起点
 * 摸底结果决定从哪一档开始、每天安排多少任务，实现"按程度定制"。
 */
(function () {
  'use strict';
  var U = ECUI;

  var STEP = ['目标', '时间', '摸底'];

  function steps(cur) {
    return '<div class="onboard-steps">' + STEP.map(function (s, i) {
      return '<div class="step' + (i === cur ? ' on' : '') + '">第 ' + (i + 1) + ' 步 · ' + s + '</div>';
    }).join('') + '</div>';
  }

  function saveProfile(patch) {
    var S = ECApp.state();
    S.profile = S.profile || {};
    Object.keys(patch).forEach(function (k) { S.profile[k] = patch[k]; });
    ECStore.save(true);
    if (ECCloud.status().loggedIn) {
      ECCloud.saveProfile(patch).catch(function () { });
    }
  }

  /* ---------- 第 1 步：目标 ---------- */
  function stepTarget(root) {
    var S = ECApp.state();
    var cur = S.profile.target || '';
    root.innerHTML = steps(0) +
      '<section class="card">' +
      '<h2>你为什么学英语？</h2>' +
      '<p class="hint">选一个最主要的目标。它决定你的五级进阶路线的终点和材料侧重；中途随时可以改。</p>' +
      '<div class="choice-grid">' +
      ECEngine.STAGES.map(function (st) {
        var m = ECEngine.STAGE_META[st];
        return '<button class="choice js-choice' + (cur === st ? ' on' : '') + '" data-v="' + st + '">' +
          '<b>' + U.esc(m.name) + '</b><span class="hint">' + U.esc(m.desc || m.tag || '') + '</span></button>';
      }).join('') +
      '</div>' +
      '<div class="row"><button class="btn primary big js-next" ' + (cur ? '' : 'disabled') + '>下一步 →</button></div>' +
      '</section>';

    U.$$('.js-choice', root).forEach(function (b) {
      b.addEventListener('click', function () {
        U.$$('.js-choice', root).forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        saveProfile({ target: b.dataset.v });
        root.querySelector('.js-next').disabled = false;
      });
    });
    root.querySelector('.js-next').addEventListener('click', function () {
      stepTime(root);
    });
  }

  /* ---------- 第 2 步：时间 ---------- */
  function stepTime(root) {
    var S = ECApp.state();
    var cur = S.profile.dailyMinutes || 40;
    var choices = [
      { v: 15, label: '15 分钟', hint: '碎片时间，细水长流' },
      { v: 30, label: '30 分钟', hint: '每天一点点，稳步推进' },
      { v: 40, label: '40 分钟', hint: '推荐 · 量与坚持的平衡点' },
      { v: 60, label: '60 分钟', hint: '备考冲刺节奏' },
      { v: 90, label: '90 分钟+', hint: '大块时间，全力提分' }
    ];
    root.innerHTML = steps(1) +
      '<section class="card">' +
      '<h2>每天能投入多长时间？</h2>' +
      '<p class="hint">任务量完全按这个数字切分：时间少任务就小，但每天都不断档。</p>' +
      '<div class="choice-grid">' +
      choices.map(function (c) {
        return '<button class="choice js-choice' + (cur === c.v ? ' on' : '') + '" data-v="' + c.v + '">' +
          '<b>' + c.label + '</b><span class="hint">' + c.hint + '</span></button>';
      }).join('') +
      '</div>' +
      '<div class="form-grid" style="margin-top:14px">' +
      '<label>考试 / 目标日期（可选，会倒计时提醒）<input class="input js-date" type="date" value="' +
      U.esc(S.profile.examDate || '') + '"></label>' +
      '</div>' +
      '<div class="row"><button class="btn ghost js-back">← 上一步</button>' +
      '<button class="btn primary big js-next">下一步 →</button></div>' +
      '</section>';

    U.$$('.js-choice', root).forEach(function (b) {
      b.addEventListener('click', function () {
        U.$$('.js-choice', root).forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        saveProfile({ dailyMinutes: parseInt(b.dataset.v, 10) });
      });
    });
    root.querySelector('.js-date').addEventListener('change', function (e) {
      saveProfile({ examDate: e.target.value });
    });
    root.querySelector('.js-back').addEventListener('click', function () { stepTarget(root); });
    root.querySelector('.js-next').addEventListener('click', function () {
      if (!S.profile.dailyMinutes) saveProfile({ dailyMinutes: 40 });
      stepTest(root);
    });
  }

  /* ---------- 第 3 步：摸底 ---------- */
  function stepTest(root) {
    var S = ECApp.state();
    var t = S.profile.target;
    var meta = t ? ECEngine.STAGE_META[t] : null;
    root.innerHTML = steps(2) +
      '<section class="card">' +
      '<h2>最后一步：摸底测试</h2>' +
      '<p>25 道题，从初中水平排到雅思难度，用来判断<b>你该从哪一档开始</b>。</p>' +
      '<ul class="bullets">' +
      '<li>不用紧张，<b>不会就选「跳过」</b>，答错不影响任何记录。</li>' +
      '<li>大约 10 分钟。做完我立刻给你定起点，并排出<b>第 1 轮专属计划</b>。</li>' +
      (meta ? '<li>你的目标「' + U.esc(meta.name) + '」会影响每轮计划的任务侧重。</li>' : '') +
      '</ul>' +
      '<div class="row">' +
      '<button class="btn primary big js-go">开始摸底（推荐）</button>' +
      '<a class="btn ghost" href="#/placement?skip=1">跳过，从基础档开始</a>' +
      '</div></section>';
    root.querySelector('.js-go').addEventListener('click', function () {
      location.hash = '#/placement';
    });
  }

  function render(root) {
    var S = ECApp.state();
    if (S.placed) { location.hash = '#/plan'; return; }
    stepTarget(root);
  }

  window.ECViews = window.ECViews || {};
  window.ECViews.onboarding = { title: '开始定制', render: render };
})();
