/* ============================================================
   我的内在指南 · 方向匹配引擎(Inner Guide · Rule Engine)
   ------------------------------------------------------------
   输入

     今天的状态 today_mood        使用者当天选的
     今天的主题 today_topic       使用者当天选的
     长期标签   movement_style / stuck_pattern / direction_need
                (guide-tags 算过一次,存在 profile 里,不每天重算)
     历史       direction_history(避免重复用)

   输出

     ONE PRIMARY DIRECTION + 一个 variant

   ⚠ 硬边界
     · 不呼叫任何 API。重整、换心情、看历史,一律 0 次请求。
     · 不读星盘 —— 星盘只在 guide-tags 那一层出现过一次
     · 不做人格分析,不替使用者决定人生
     · 同一天、同一组输入,永远得到同一个结果
   ============================================================ */
(function (root, factory) {
  if (typeof module === "object" && module.exports)
    module.exports = factory(require("./guide-content.js"));
  else root.GuideEngine = factory(root.GuideContent);
})(typeof self !== "undefined" ? self : this, function (CONTENT) {
  "use strict";

  var VERSION = "guide-engine-1.0";

  var MOODS = [
    { id: "calm",     zh: "平静" },
    { id: "tired",    zh: "有点累" },
    { id: "confused", zh: "有点乱" },
    { id: "stuck",    zh: "卡住了" },
    { id: "anxious",  zh: "有点焦虑" },
    { id: "empty",    zh: "提不起劲" },
    { id: "hopeful",  zh: "有些期待" },
    { id: "restart",  zh: "想重新开始" }
  ];
  var TOPICS = [
    { id: "work",         zh: "工作 / 学业" },
    { id: "relationship", zh: "关系" },
    { id: "self",         zh: "自己" },
    { id: "future",       zh: "未来" },
    { id: "decision",     zh: "一个决定" },
    { id: "energy",       zh: "状态 / 精力" },
    { id: "change",       zh: "改变" },
    { id: "unknown",      zh: "说不清楚" }
  ];

  /* ── 基础候选 ──────────────────────────────────────────
     先用状态与主题各自的偏好合并,再让明确写过的组合覆盖过去。
     写在这里的每一条都是产品判断,不是算出来的。 */
  var MOOD_BASE = {
    calm:     ["meaning", "experimentation", "clarity", "self_trust"],
    tired:    ["rest", "space", "boundaries", "choice"],
    confused: ["clarity", "space", "choice", "stability"],
    stuck:    ["experimentation", "choice", "clarity", "expression"],
    anxious:  ["stability", "space", "clarity", "rest"],
    empty:    ["rest", "meaning", "space", "connection"],
    hopeful:  ["experimentation", "self_trust", "meaning", "expression"],
    restart:  ["experimentation", "choice", "clarity", "stability"]
  };
  var TOPIC_BASE = {
    work:         ["meaning", "choice", "boundaries", "rest"],
    relationship: ["boundaries", "connection", "space", "expression"],
    self:         ["self_trust", "space", "expression", "rest"],
    future:       ["clarity", "stability", "choice", "meaning"],
    decision:     ["clarity", "choice", "self_trust", "space"],
    energy:       ["rest", "space", "boundaries", "stability"],
    change:       ["experimentation", "stability", "choice", "self_trust"],
    unknown:      ["space", "clarity", "rest", "expression"]
  };
  /* 明确指定的组合 —— 这些是产品定案的优先序,盖过上面的合并 */
  var PAIRS = {
    "tired|work":       ["rest", "choice", "meaning"],
    "confused|decision":["clarity", "choice", "space"],
    "anxious|future":   ["stability", "clarity", "space"],
    "stuck|work":       ["experimentation", "clarity", "choice"],
    "empty|energy":     ["rest", "space"],
    "hopeful|change":   ["experimentation", "self_trust"],
    "restart|future":   ["experimentation", "choice", "clarity"]
  };

  /* ── 长期标签怎么加权 ──────────────────────────────── */
  var STUCK_BOOST = {
    should_over_want:    ["choice", "meaning"],
    ability_over_desire: ["self_trust", "meaning"],
    overthinking:        ["experimentation", "clarity"],
    over_responsibility: ["boundaries", "rest"],
    people_first:        ["boundaries", "space"],
    fear_change:         ["experimentation", "stability"],
    too_many_options:    ["clarity", "choice"],
    self_pressure:       ["rest", "self_trust"]
  };
  var MOVEMENT_BOOST = {
    slow_confirm:     ["clarity", "stability"],
    action_first:     ["experimentation", "expression"],
    structure_first:  ["clarity", "stability"],
    space_first:      ["space", "rest"],
    connection_first: ["connection", "expression"],
    experiment_first: ["experimentation", "choice"]
  };
  var W = { base: [3, 2, 1, 0.5], need: 2, needTop: 1, stuck: 1.5, movement: 1 };

  var DAY = 86400000;
  function dayOf(s) { return String(s || "").slice(0, 10); }
  function daysBetween(a, b) {
    var x = Date.parse(dayOf(a) + "T00:00:00Z"), y = Date.parse(dayOf(b) + "T00:00:00Z");
    if (isNaN(x) || isNaN(y)) return Infinity;
    return Math.round((y - x) / DAY);
  }
  /* 稳定的伪乱数:同一个人、同一天、同一个方向,永远得到同一个数 */
  function hash(str) {
    var h = 2166136261;
    for (var i = 0; i < String(str).length; i++) {
      h ^= String(str).charCodeAt(i); h = (h * 16777619) >>> 0;
    }
    return h >>> 0;
  }

  function baseCandidates(mood, topic) {
    var pair = PAIRS[mood + "|" + topic];
    if (pair) return pair.slice();
    var m = MOOD_BASE[mood] || [], t = TOPIC_BASE[topic] || [];
    var score = {};
    m.forEach(function (d, i) { score[d] = (score[d] || 0) + (4 - i); });
    t.forEach(function (d, i) { score[d] = (score[d] || 0) + (4 - i); });
    return Object.keys(score).sort(function (a, b) {
      if (score[b] !== score[a]) return score[b] - score[a];
      /* 平手时照状态清单的顺序,再照主题清单 —— 完全确定性 */
      var ia = m.indexOf(a) < 0 ? 9 : m.indexOf(a), ib = m.indexOf(b) < 0 ? 9 : m.indexOf(b);
      if (ia !== ib) return ia - ib;
      return (t.indexOf(a) < 0 ? 9 : t.indexOf(a)) - (t.indexOf(b) < 0 ? 9 : t.indexOf(b));
    }).slice(0, 4);
  }

  /* ── 算今天的方向 ─────────────────────────────────── */
  function rank(input) {
    var tags = input.tags || {};
    var need = tags.direction_need || [], stuck = tags.stuck_pattern || [],
        move = tags.movement_style || [];
    var cands = baseCandidates(input.mood, input.topic);
    var rows = cands.map(function (d, i) {
      var why = [];
      var s = W.base[i] !== undefined ? W.base[i] : 0;
      if (s) why.push("今天的状态与主题");
      var ni = need.indexOf(d);
      if (ni >= 0) { s += W.need + (ni === 0 ? W.needTop : 0); why.push("长期值得靠近的方向"); }
      stuck.forEach(function (k) {
        if ((STUCK_BOOST[k] || []).indexOf(d) >= 0) { s += W.stuck; why.push("容易卡住的地方"); }
      });
      move.forEach(function (k) {
        if ((MOVEMENT_BOOST[k] || []).indexOf(d) >= 0) { s += W.movement; why.push("适合前进的方式"); }
      });
      return { direction: d, score: Math.round(s * 100) / 100, basePos: i,
               why: why.filter(function (x, j, a) { return a.indexOf(x) === j; }) };
    });
    rows.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return a.basePos - b.basePos;                   // 平手照基础顺序,不随机
    });
    return rows;
  }

  /* 备用方向:不在今天基础候选里的那些,只用长期标签排序。
     它们不会在正常情况下出现 —— 只有在前面几个方向都被重复挡住时才轮到。 */
  function extraByTags(input) {
    var tags = input.tags || {};
    var need = tags.direction_need || [], stuck = tags.stuck_pattern || [],
        move = tags.movement_style || [];
    return Object.keys(CONTENT.LIBRARY).map(function (d) {
      var s = 0;
      var ni = need.indexOf(d);
      if (ni >= 0) s += W.need + (ni === 0 ? W.needTop : 0);
      stuck.forEach(function (k) { if ((STUCK_BOOST[k] || []).indexOf(d) >= 0) s += W.stuck; });
      move.forEach(function (k) { if ((MOVEMENT_BOOST[k] || []).indexOf(d) >= 0) s += W.movement; });
      return { direction: d, score: Math.round(s * 100) / 100, basePos: 99,
               why: ["长期标签(备用)"] };
    }).sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return a.direction < b.direction ? -1 : 1;
    });
  }

  /* ── 避免重复 ─────────────────────────────────────
     history 的每一笔是 { date, direction, variantId, headline, step }
       · 同一个 headline 30 天内不重复
       · 同一个 small step 14 天内不重复
       · 连续两天同一个 direction → 第二天必须换 variant
     真的全部被挡住的时候,退回【最久没用过的那一个】,
     而不是空白 —— 但会记下 relaxed,让开发看得到。 */
  var HEADLINE_DAYS = 30, STEP_DAYS = 14;

  function pickVariant(direction, input) {
    var list = (CONTENT.LIBRARY[direction] || []).slice();
    if (!list.length) return null;
    var hist = input.history || [], today = dayOf(input.date);
    var lastEntry = hist.length ? hist[0] : null;
    var lastUsed = {};
    hist.forEach(function (h) {
      if (lastUsed[h.variantId] === undefined) lastUsed[h.variantId] = daysBetween(h.date, today);
    });

    function blocked(v) {
      for (var i = 0; i < hist.length; i++) {
        var h = hist[i], age = daysBetween(h.date, today);
        if (h.headline === v.headline && age < HEADLINE_DAYS) return "headline " + age + " 天内出现过";
        if (h.step === v.step && age < STEP_DAYS) return "一小步 " + age + " 天内出现过";
      }
      if (lastEntry && lastEntry.direction === direction &&
          daysBetween(lastEntry.date, today) <= 1 && lastEntry.variantId === v.id)
        return "昨天同一个方向用过这一版";
      return null;
    }

    var open = list.filter(function (v) { return !blocked(v); });
    var relaxed = false;
    if (!open.length) {
      /* 真的全部被挡住了(例如有人连续一个月选同一组状态与主题)。
         这时候退回【最久没用过的那一个】,而且无论如何不给昨天那一版。 */
      relaxed = true;
      var notYesterday = list.filter(function (v) {
        return !(lastEntry && lastEntry.variantId === v.id);
      });
      open = (notYesterday.length ? notYesterday : list).slice().sort(function (a, b) {
        var ia = lastUsed[a.id] === undefined ? 9999 : lastUsed[a.id];
        var ib = lastUsed[b.id] === undefined ? 9999 : lastUsed[b.id];
        if (ib !== ia) return ib - ia;                   // 最久没用过的排前面
        return a.id < b.id ? -1 : 1;
      });
      return { variant: open[0], relaxed: true, blockedCount: list.length };
    }
    /* 从还开着的里面挑一个 —— 用「人 + 日期 + 方向」当种子,
       所以同一个人同一天永远一样,不同的人不会永远拿到同一版。 */
    var seed = hash(String(input.owner || "anon") + "|" + today + "|" + direction);
    var chosen = open[seed % open.length];
    return { variant: chosen, relaxed: relaxed,
             blockedCount: list.length - list.filter(function (v) { return !blocked(v); }).length };
  }

  function guideFor(input) {
    input = input || {};
    if (!input.mood || !input.topic) return { status: "need_input", version: VERSION };
    var ranked = rank(input);
    if (!ranked.length) return { status: "no_match", version: VERSION };

    /* 从分数最高的方向往下找,第一个还有可用版本的就是今天的方向。
       前面几个都被挡住的时候(连续很多天同一组输入),把【其余方向】
       也按照长期标签排进来一起找 —— 与其重复,不如换一个仍然贴他的方向。 */
    var order = ranked.slice();
    var seen = {};
    order.forEach(function (r) { seen[r.direction] = 1; });
    extraByTags(input).forEach(function (r) { if (!seen[r.direction]) order.push(r); });

    var chosen = null, picked = null;
    for (var i = 0; i < order.length && !chosen; i++) {
      var p = pickVariant(order[i].direction, input);
      if (p && !p.relaxed) { chosen = order[i]; picked = p; }
    }
    if (!chosen) {                                   // 连备用方向都被挡 → 用最高分那个放宽
      chosen = ranked[0];
      picked = pickVariant(chosen.direction, input);
    }
    if (!picked) return { status: "no_match", version: VERSION };

    var v = picked.variant;
    return {
      status: "ok", version: VERSION,
      date: dayOf(input.date), mood: input.mood, topic: input.topic,
      direction: chosen.direction,
      label: CONTENT.LABELS[chosen.direction],
      variantId: v.id,
      headline: v.headline, body: v.body, toward: v.toward, notYet: v.notYet, step: v.step,
      /* 以下只给开发追溯,不进画面 */
      dev: { score: chosen.score, why: chosen.why, relaxed: picked.relaxed,
             ranked: ranked.map(function (r) { return r.direction + ":" + r.score; }) }
    };
  }

  /* 存进历史的那一笔 —— 只留使用者自己看得到的东西 */
  function historyEntry(g) {
    return { date: g.date, mood: g.mood, topic: g.topic, direction: g.direction,
             label: g.label, variantId: g.variantId, headline: g.headline, step: g.step };
  }

  return {
    VERSION: VERSION, MOODS: MOODS, TOPICS: TOPICS,
    MOOD_BASE: MOOD_BASE, TOPIC_BASE: TOPIC_BASE, PAIRS: PAIRS,
    STUCK_BOOST: STUCK_BOOST, MOVEMENT_BOOST: MOVEMENT_BOOST, WEIGHTS: W,
    HEADLINE_DAYS: HEADLINE_DAYS, STEP_DAYS: STEP_DAYS,
    baseCandidates: baseCandidates, rank: rank, extraByTags: extraByTags, guideFor: guideFor, historyEntry: historyEntry
  };
});
