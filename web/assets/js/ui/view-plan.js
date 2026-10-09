/* 视图：首页 / 今日计划 */
(function () {
  'use strict';
  var U = ECUI;

  function taskIcon(m) {
    return ({ vocab: '📖', grammar: '🧩', listening: '🎧', reading: '📚', writing: '✍️' })[m] || '•';
  }

  function render(root) {
    var S = ECApp.state();
    var an = ECEngine.analyze(S);
    var plan = S.plan;
    var today = ECStore.dayLog();
    var meta = ECEngine.STAGE_META[S.stage];
    var streak = ECStore.streak();

    var html = '';

    if (!S.placed) {
      html += '<section class="card highlight">' +
        '<h2>先做两件事，我才能给你排课</h2>' +
        '<ol class="steps">' +
        '<li><b>设定目标</b>：你的目标档位、每天能学多久。<a href="#/settings" class="link">去设置 →</a></li>' +
        '<li><b>做一次摸底测试</b>（约 10 分钟，25 题，从最简单到雅思难度）：测完我会判断你该从哪一档开始，并生成第 1 轮计划。</li>' +
        '</ol>' +
        '<a class="btn primary big" href="#/placement">开始摸底测试</a>' +
        '<a class="btn ghost big" href="#/placement?skip=1">跳过，直接从基础档开始</a>' +
        '</section>';
    }

    html += '<div class="grid cols-3">' +
      '<section class="card stat-card">' +
      '<div class="stat-line"><span class="stat-num">' + streak + '</span><span class="stat-label">连续学习天数</span></div>' +
      '<div class="stat-sub">今天已学 ' + U.fmtDur(today.minutes) + ' · 完成 ' + today.items + ' 题 · 正确 ' + today.correct + ' 题</div>' +
      '</section>' +
      '<section class="card stat-card">' +
      '<div class="stat-line"><span class="stat-num">' + Object.keys(S.words).length + '</span><span class="stat-label">已学单词</span></div>' +
      '<div class="stat-sub">已掌握 ' + an.vocab.mastered + ' 个 · 待复习 ' + an.dueCount + ' 个</div>' +
      '</section>' +
      '<section class="card stat-card">' +
      '<div class="stat-line"><span class="stat-num">' + U.esc(meta.tag) + '</span><span class="stat-label">当前阶段</span></div>' +
      '<div class="stat-sub">目标阶段：' + U.esc(ECEngine.STAGE_META[S.profile.target].name) + '</div>' +
      '</section>' +
      '</div>';

    // 掌握度总览
    html += '<section class="card"><h2>当前阶段掌握度 · ' + U.esc(meta.name) + '</h2>' +
      '<div class="mastery-row">' +
      U.ring(an.stageMastery, 120, Math.round(an.stageMastery * 100) + '%', '综合') +
      '<div class="skill-bars">';
    an.skills.forEach(function (s) {
      var cls = s.mastery >= s.target ? 'ok' : (s.mastery >= s.target * 0.6 ? 'mid' : 'low');
      html += '<div class="skill-bar"><div class="sb-head"><span>' + s.icon + ' ' + s.name + '</span>' +
        '<b class="' + cls + '">' + Math.round(s.mastery * 100) + '%<i> / 目标 ' + Math.round(s.target * 100) + '%</i></b></div>' +
        U.bar(s.mastery, cls) + '</div>';
    });
    html += '</div></div>';
    if (an.weakTags.length) {
      html += '<div class="weak-tags"><span class="hint">近期错题集中在：</span>';
      an.weakTags.forEach(function (t) {
        html += U.chip(t.label + ' ' + Math.round(t.share * 100) + '%', 'warn');
      });
      html += '</div>';
    }
    html += '</section>';

    // 本轮计划
    if (plan && plan.tasks && plan.tasks.length) {
      var done = plan.done || [];
      html += '<section class="card plan-card">' +
        '<div class="card-head"><h2>第 ' + plan.roundIndex + ' 轮计划' +
        '<span class="hint">（' + U.fmtTime(plan.createdAt) + ' 生成 · 预计 ' + plan.estMinutes + ' 分钟）</span></h2>' +
        '<button class="btn ghost small js-replan">重新规划本轮</button></div>' +
        ((plan.warnings && plan.warnings.length)
          ? '<div class="plan-warn">' + plan.warnings.map(function (w) {
            return '<p>⚠️ ' + U.esc(w) + '</p>';
          }).join('') + '</div>' : '') +
        '<div class="rationale">' + plan.rationale.map(function (r) { return '<p>· ' + U.esc(r) + '</p>'; }).join('') + '</div>' +
        '<ul class="tasks">';
      plan.tasks.forEach(function (t, i) {
        var isDone = done.indexOf(i) >= 0;
        html += '<li class="task' + (isDone ? ' done' : '') + '">' +
          '<div class="t-icon">' + taskIcon(t.module) + '</div>' +
          '<div class="t-main"><b>' + U.esc(t.title) + '</b><p class="reason">' + U.esc(t.reason) + '</p></div>' +
          '<div class="t-meta"><span>' + t.count + ' 项</span><span>' + t.minutes + ' 分钟</span></div>' +
          '<button class="btn ' + (isDone ? 'ghost' : 'primary') + ' js-start" data-i="' + i + '">' + (isDone ? '再练一次' : '开始') + '</button>' +
          '</li>';
      });
      html += '</ul>' +
        '<div class="plan-foot"><span class="hint">已完成 ' + done.length + '/' + plan.tasks.length + ' 项。全部完成后我会自动按你的表现排下一轮。</span>' +
        '<button class="btn primary js-finish-round"' + (done.length >= plan.tasks.length ? '' : ' disabled') + '>进入下一轮 →</button></div>' +
        '</section>';
    } else if (S.placed) {
      html += '<section class="card"><h2>还没有计划</h2><p>点下面的按钮，我按你现在的水平生成一轮学习计划。</p>' +
        '<button class="btn primary big js-replan">生成学习计划</button></section>';
    }

    // 晋级
    var promo = ECEngine.checkPromotion(S);
    if (!promo.maxed) {
      html += '<section class="card promo-card' + (promo.ready ? ' ready' : '') + '">' +
        '<h2>' + (promo.ready ? '🎉 可以冲击下一阶段了' : '晋级检查') + '</h2>' +
        (promo.ready
          ? '<p>你在「' + U.esc(meta.name) + '」的掌握度已达 ' + Math.round(promo.weighted * 100) + '%。通过一次晋级测试就能进入 <b>' + U.esc(promo.nextMeta.name) + '</b>。</p>' +
          '<a class="btn primary" href="#/placement?type=promote">开始晋级测试</a>'
          : '<ul class="blockers">' + promo.blockers.map(function (b) { return '<li>' + U.esc(b) + '</li>'; }).join('') + '</ul>' +
          '<p class="hint">继续按计划学习即可，达标后我会提醒你。</p>') +
        '</section>';
    }

    // 快速入口
    html += '<section class="card"><h2>自由练习</h2><div class="quick-grid">' +
      ['vocab', 'grammar', 'listening', 'reading', 'writing'].map(function (m) {
        return '<a class="quick" href="#/' + m + '"><span class="q-icon">' + taskIcon(m) + '</span>' +
          '<b>' + ECEngine.SKILL_META[m].name + '</b><span class="hint">' + Math.round(an.skillMap[m].mastery * 100) + '%</span></a>';
      }).join('') +
      '<a class="quick" href="#/stats"><span class="q-icon">📈</span><b>学习报告</b><span class="hint">错题本</span></a>' +
      '</div></section>';

    root.innerHTML = html;

    var rp = root.querySelector('.js-replan');
    if (rp) rp.addEventListener('click', function () { ECApp.replan(); });

    U.$$('.js-start', root).forEach(function (b) {
      b.addEventListener('click', function () { ECApp.startTask(parseInt(b.dataset.i, 10)); });
    });
    var fr = root.querySelector('.js-finish-round');
    if (fr) fr.addEventListener('click', function () { ECApp.replan(true); });
  }

  window.ECViews = window.ECViews || {};
  window.ECViews.plan = { title: '今日计划', render: render };
})();
