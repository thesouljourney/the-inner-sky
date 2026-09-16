/* ============================================================
   我的内在指南 · 长期标签(Inner Guide · Long-term Tags)
   ------------------------------------------------------------
   这一层回答的是:

     「这个人【长期】适合怎么前进、容易卡在哪里、值得靠近什么?」

   它只算【一次】。算完存进 profile,之后每天都不再重算,
   也不再读星盘。

   ⚠ 星盘只在这里出现,而且只出现在【后台】
     输入是已经锁定的 Evidence 层产出的【已接受机制】,
     不是星座、宫位、相位。输出是三组标签,里面没有任何占星词汇,
     使用者永远看不到这一层。

   ⚠ 硬边界
     · 不修改 Evidence / Selection / 生成层,只读它们的结果
     · 不呼叫任何 API
     · 同一张盘永远得到同一组标签
   ============================================================ */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.GuideTags = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var VERSION = "guide-tags-1.0";

  var MOVEMENT = ["slow_confirm", "action_first", "structure_first",
                  "space_first", "connection_first", "experiment_first"];
  var STUCK = ["should_over_want", "ability_over_desire", "overthinking",
               "over_responsibility", "people_first", "fear_change",
               "too_many_options", "self_pressure"];
  var NEED = ["choice", "space", "clarity", "rest", "expression", "boundaries",
              "experimentation", "stability", "meaning", "connection", "self_trust"];

  /* 27 条机制 + 2 条护栏 → 三组标签。
     一条机制可以投给多个标签;投票是加权的,权重就是那条机制自己的 strength。
     这张表是【人写的对照】,不是从星盘算出来的 —— 它把「内部机制」翻成
     「前进方式 / 卡住方式 / 值得靠近的状态」,一次而已。 */
  var MAP = {
    "solitude-then-contact":        { m: ["space_first"],        s: [],                     n: ["space", "rest"] },
    "naming-to-settle":             { m: ["structure_first"],    s: ["overthinking"],       n: ["clarity", "expression"] },
    "rest-needs-permission":        { m: [],                     s: ["self_pressure"],      n: ["rest"] },
    "belonging-on-own-terms":       { m: ["space_first"],        s: ["people_first"],       n: ["boundaries", "choice"] },
    "clarity-before-release":       { m: ["slow_confirm"],       s: ["overthinking"],       n: ["clarity"] },
    "checked-before-spoken":        { m: ["slow_confirm"],       s: ["overthinking"],       n: ["expression", "self_trust"] },
    "open-loop-stays-loud":         { m: ["structure_first"],    s: ["overthinking"],       n: ["clarity", "rest"] },
    "trust-opens-slowly":           { m: ["slow_confirm"],       s: [],                     n: ["space", "connection"] },
    "carry-before-noticing-cost":   { m: [],                     s: ["over_responsibility"],n: ["boundaries", "rest"] },
    "standard-set-internally":      { m: [],                     s: ["self_pressure"],      n: ["rest", "self_trust"] },
    "visible-means-exposed":        { m: ["space_first"],        s: ["people_first"],       n: ["boundaries", "space"] },
    "hold-it-in-until-it-passes":   { m: [],                     s: ["overthinking"],       n: ["expression", "space"] },
    "effort-without-traction":      { m: ["experiment_first"],   s: ["should_over_want"],   n: ["choice", "meaning"] },
    "meaning-gates-effort":         { m: [],                     s: ["ability_over_desire"],n: ["meaning", "choice"] },
    "autonomy-or-stall":            { m: ["action_first"],       s: ["should_over_want"],   n: ["choice", "boundaries"] },
    "making-restores-agency":       { m: ["action_first"],       s: ["overthinking"],       n: ["expression", "experimentation"] },
    "starting-is-the-hard-part":    { m: ["action_first"],       s: ["overthinking"],       n: ["experimentation", "self_trust"] },
    "depth-or-disengage":           { m: [],                     s: ["too_many_options"],   n: ["meaning", "connection"] },
    "wider-frame-pull":             { m: ["experiment_first"],   s: ["too_many_options"],   n: ["meaning", "experimentation"] },
    "novelty-over-repetition":      { m: ["experiment_first"],   s: ["fear_change"],        n: ["experimentation", "choice"] },
    "growth-through-articulating":  { m: ["connection_first"],   s: ["overthinking"],       n: ["expression", "clarity"] },
    "closeness-needs-room":         { m: ["space_first"],        s: ["people_first"],       n: ["space", "boundaries"] },
    "depth-or-nothing-in-closeness":{ m: ["connection_first"],   s: [],                     n: ["connection", "meaning"] },
    "pace-set-by-the-other":        { m: ["connection_first"],   s: ["people_first"],       n: ["boundaries", "self_trust"] },
    "recognition-wanted-not-sought":{ m: [],                     s: ["should_over_want"],   n: ["self_trust", "expression"] },
    "stability-before-movement":    { m: ["structure_first"],    s: ["fear_change"],        n: ["stability", "clarity"] },
    "decide-then-revisit":          { m: ["slow_confirm"],       s: ["overthinking"],       n: ["self_trust", "clarity"] },
    "values-security":              { m: ["structure_first"],    s: ["fear_change"],        n: ["stability"] },
    "single-signal-sensitivity":    { m: [],                     s: ["overthinking"],       n: ["space", "stability"] }
  };

  var LIMITS = { movement: 2, stuck: 3, need: 3 };

  function tally(accepted) {
    var v = { m: {}, s: {}, n: {} };
    (accepted || []).forEach(function (c) {
      var row = MAP[c && c.patternKey];
      if (!row) return;
      var w = typeof c.strength === "number" && c.strength > 0 ? c.strength : 1;
      ["m", "s", "n"].forEach(function (g) {
        row[g].forEach(function (tag) { v[g][tag] = (v[g][tag] || 0) + w; });
      });
    });
    return v;
  }

  /* 排序刻意是确定性的:先看票数,票数一样就照固定的清单顺序。
     同一张盘永远得到同一组标签,顺序也一样。 */
  function topOf(votes, whitelist, limit) {
    return whitelist.slice()
      .filter(function (t) { return votes[t] > 0; })
      .sort(function (a, b) {
        if (votes[b] !== votes[a]) return votes[b] - votes[a];
        return whitelist.indexOf(a) - whitelist.indexOf(b);
      })
      .slice(0, limit);
  }

  /* report 就是 Evidence 层那份 build() 的结果(preview 层的 vm.report)。
     只读 candidates 里 status === "accepted" 的那些,其余一概不看。 */
  function fromReport(report) {
    var accepted = ((report && report.candidates) || [])
      .filter(function (c) { return c && c.status === "accepted"; });
    return fromAccepted(accepted);
  }

  function fromAccepted(accepted) {
    var v = tally(accepted);
    var out = {
      version: VERSION,
      movement_style: topOf(v.m, MOVEMENT, LIMITS.movement),
      stuck_pattern: topOf(v.s, STUCK, LIMITS.stuck),
      direction_need: topOf(v.n, NEED, LIMITS.need),
      /* 只给开发追溯:哪几条机制投了票。不进画面。 */
      basedOn: (accepted || []).map(function (c) { return c.patternKey; }).filter(function (k) { return MAP[k]; })
    };
    out.status = (out.movement_style.length && out.stuck_pattern.length && out.direction_need.length)
      ? "ok" : "insufficient";
    return out;
  }

  return {
    VERSION: VERSION, MOVEMENT: MOVEMENT, STUCK: STUCK, NEED: NEED,
    MAP: MAP, LIMITS: LIMITS,
    fromReport: fromReport, fromAccepted: fromAccepted
  };
});
