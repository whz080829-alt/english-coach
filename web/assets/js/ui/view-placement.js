/* 视图：摸底测试 / 晋级测试 */
(function () {
  'use strict';
  var U = ECUI;

  function intro(root, params) {
    var S = ECApp.state();
    var promote = params.type === 'promote';
    if (promote) {
      var next = ECEngine.checkPromotion(S).nextMeta;
      root.innerHTML = '<section class="card">' +
        '<h2>晋级测试</h2>' +
        '<p>这一关考的是你现在这个阶段（<b>' + U.esc(ECEngine.STAGE_META[S.stage].name) + '</b>）的词汇、语法、听力与阅读，共 25 题。</p>' +
        '<p>正确率达到 <b>80%</b> 即可进入 <b>' + U.esc(next.name) + '</b>：' + U.esc(next.desc) + '</p>' +
        '<p class="hint">没通过也不要紧，我会把你错的考点直接排进下一轮计划。</p>' +
        '<button class="btn primary big js-go">开始测试</button> <a class="btn ghost" href="#/plan">返回</a>' +
        '</section>';
    } else {
      root.innerHTML = '<section class="card">' +
        '<h2>摸底测试</h2>' +
        '<p>25 道题，从最简单的初中水平一直排到雅思难度，用来判断你该从哪一档开始。</p>' +
        '<ul class="bullets">' +
        '<li>不用紧张，<b>不会就选「跳过」</b>，答错不影响任何记录。</li>' +
        '<li>全部做完大约 10 分钟，做完我立刻给你定起点并排出第 1 轮计划。</li>' +
        '</ul>' +
        '<button class="btn primary big js-go">开始摸底</button> ' +
        '<a class="btn ghost" href="#/placement?skip=1">跳过，从基础档开始</a>' +
        '</section>';
    }

    root.querySelector('.js-go').addEventListener('click', function () {
      if (promote) runPromote(root); else runPlacement(root);
    });
  }

  function runPlacement(root) {
    var items = ECEngine.buildPlacement();
    U.quiz(root, {
      title: '摸底测试（不用怕答错）',
      module: 'placement',
      items: items.map(function (it) {
        return Object.assign({}, it, { tag: it.tag || 'other' });
      }),
      requeueWrong: false,
      onFinish: function (results) {
        var mapped = results.map(function (r) {
          var src = items.filter(function (x) { return x.ref === r.ref; })[0] || {};
          return { module: r.module, stage: src.stage || 'basic', correct: r.correct };
        });
        var S = ECApp.state();
        var out = ECEngine.applyPlacement(S, mapped);
        var meta = ECEngine.STAGE_META[out.start];
        var rows = ECEngine.STAGES.map(function (st) {
          var a = out.acc[st] || 0;
          return '<tr><td>' + U.esc(ECEngine.STAGE_META[st].name) + '</td>' +
            '<td>' + U.bar(a) + '</td><td>' + Math.round(a * 100) + '%</td></tr>';
        }).join('');
        ECApp.generatePlan();
        root.innerHTML = '<section class="card">' +
          '<h2>摸底完成，你的起点是：' + U.esc(meta.name) + '</h2>' +
          '<p>' + U.esc(meta.desc) + '</p>' +
          '<table class="tbl"><thead><tr><th>难度档</th><th>正确率</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>' +
          '<p class="hint">低档位已按"掌握"处理，会快速复习巩固；高档位暂时不上，避免打击信心。</p>' +
          '<a class="btn primary big" href="#/plan">查看我的第 1 轮计划 →</a>' +
          '</section>';
      }
    });
  }

  function runPromote(root) {
    var S = ECApp.state();
    var stage = S.stage;
    var items = ECEngine.buildCheckpoint(S, 25);
    U.quiz(root, {
      title: '晋级测试 · ' + ECEngine.STAGE_META[stage].name,
      module: 'checkpoint',
      items: items,
      requeueWrong: false,
      onFinish: function (results) {
        var correct = results.filter(function (r) { return r.correct; }).length;
        var acc = results.length ? correct / results.length : 0;
        var pass = acc >= 0.8;
        // 错题照常计入错题本，用于下一轮重点
        ECEngine.commit(ECApp.state(), {
          module: 'grammar', stage: stage, minutes: 20,
          results: results.filter(function (r) { return !r.correct; }).map(function (r) {
            return { ref: r.ref, tag: r.tag, correct: false, prompt: r.prompt, your: r.your, correctAnswer: r.correctAnswer, explain: r.explain };
          })
        });
        var html = '<section class="card ' + (pass ? 'highlight' : '') + '">' +
          '<h2>' + (pass ? '🎉 晋级成功！' : '本次未通过') + '</h2>' +
          '<div class="score-big">' + correct + ' / ' + results.length + '（' + Math.round(acc * 100) + '%）</div>';
        if (pass) {
          var nextMeta = ECEngine.checkPromotion(ECApp.state()).nextMeta;
          ECEngine.promote(ECApp.state());
          ECApp.generatePlan();
          html += '<p>你已进入 <b>' + U.esc(nextMeta.name) + '</b>：' + U.esc(nextMeta.desc) + '</p>' +
            '<p class="hint">新一轮计划已按新阶段重新生成，词汇和材料全部换成新档位。</p>' +
            '<a class="btn primary big" href="#/plan">开始新一轮 →</a>';
        } else {
          var wrong = results.filter(function (r) { return !r.correct; });
          var tags = {};
          wrong.forEach(function (r) { tags[r.tag] = (tags[r.tag] || 0) + 1; });
          var tagList = Object.keys(tags).map(function (t) {
            return '<li>' + U.esc(ECEngine.TAG_LABEL[t] || t) + '：错 ' + tags[t] + ' 题</li>';
          }).join('');
          ECApp.generatePlan();
          html += '<p>还差一点（需要 80%）。这些错题已经记入错题本，并会优先出现在下一轮计划里：</p>' +
            '<ul class="bullets">' + tagList + '</ul>' +
            '<a class="btn primary" href="#/plan">查看重新排好的计划 →</a>';
        }
        html += '</section>';
        root.innerHTML = html;
      }
    });
  }

  function render(root, params) {
    params = params || {};
    var S = ECApp.state();
    if (params.skip) {
      if (!S.placed) {
        S.placed = true;
        S.stage = 'basic';
        S.unlocked = ['basic'];
        ECEngine.STAGES.forEach(function (st, i) {
          ECEngine.SKILLS.forEach(function (sk) { S.skills[st][sk] = i === 0 ? 0.12 : 0; });
        });
        ECStore.save(true);
      }
      ECApp.generatePlan();
      location.hash = '#/plan';
      return;
    }
    intro(root, params);
  }

  window.ECViews = window.ECViews || {};
  window.ECViews.placement = { title: '测试', render: render };
})();
