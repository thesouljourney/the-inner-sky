/* ============================================================
   我的内在指南 · 想留给自己的几句话(Personal Anchors)
   ------------------------------------------------------------
   这一层【不是】另一次解读。它不读星盘、不呼叫任何 API、
   不产生任何新的心理判断 —— 它只做一件事:

     从【已经通过验证、已经被接受】的四张 Compass 文案里,
     挑出三句「以后真的值得回来提醒自己」的话。

   为什么是三句而不是四句:
     四个方向是系统在说话,三句锚点是使用者要带走的东西。
     一个方向一句会变成摘要;摘要没有取舍,取舍才有用。

   ⚠ 硬边界
     · 输入只有 accepted Compass copies(coreInsight / explanation /
       reflectionPrompt)与它们的方向 —— 没有盘面、没有机制、没有分数。
     · 不新增任何主张:每一句锚点都是从已接受文案里【截出来】的,
       不是重新写的。截取点与取舍规则完全确定性。
     · 不呼叫 API。同一份 Compass 永远得到同一组锚点。
   ============================================================ */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CompassAnchors = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var VERSION = "anchors-1.0";
  var ANCHOR_COUNT = 3;

  /* v1.2 的写作指令要求 explanation 最后有一句「轻轻一步」——
     那一句正好就是「可以带走的东西」。这些是它可能的起手式。 */
  var LEAD_CONNECTORS = [
    "所以", "因此", "于是", "这时候", "有些时候", "有时候",
    "如果最近刚好遇到这种情况", "如果最近", "对你来说", "也许真正值得留意的是",
    "只是当", "只是", "而且", "另外"
  ];
  /* 「轻轻一步」的记号。有这些的句子优先当锚点 —— 它本来就是写来给人带走的。 */
  var GENTLE_CUES = ["不一定要", "可以先", "不用急着", "也许比", "可以先看看",
    "不一定是", "也可能只是", "不必", "不妨", "先不用", "允许自己",
    "没有关系", "没关系", "就够了", "还在不在"];

  var CJK = /[，。！？；：、（）「」“”\s]/g;
  function len(s) { return String(s || "").replace(CJK, "").length; }
  function sentences(t) {
    return String(t || "").split(/(?<=[。！？])/).map(function (x) { return x.trim(); })
      .filter(Boolean);
  }
  function stripLead(s) {
    var out = String(s || "").trim();
    for (var i = 0; i < LEAD_CONNECTORS.length; i++) {
      var c = LEAD_CONNECTORS[i];
      if (out.indexOf(c) === 0) {
        out = out.slice(c.length).replace(/^[，、,]\s*/, "");
        break;
      }
    }
    return out;
  }
  function hasCue(s) {
    return GENTLE_CUES.some(function (w) { return String(s).indexOf(w) >= 0; });
  }
  /* 太长的锚点记不住,但砍掉重点更糟。
     作法:找【放得进长度、而且带着「轻轻一步」记号的最长一段】,
     同长度时取比较前面的那一段 —— 前面通常是「什么时候」,
     少了它锚点会变成一句没有场合的建议。 */
  function tighten(s, max) {
    var t = String(s || "").trim();
    if (len(t) <= max) return t;
    var parts = t.split(/[，；]/).map(function (x) { return x.trim(); }).filter(Boolean);
    var best = null;
    for (var n = parts.length; n >= 1 && !best; n--) {
      for (var i = 0; i + n <= parts.length; i++) {
        var slice = parts.slice(i, i + n).join("，");
        if (len(slice) <= max && hasCue(slice)) { best = slice; break; }
      }
    }
    if (!best) best = parts[parts.length - 1] || t;   // 都没有记号:宁可短也不要断在半句
    return /[。！？]$/.test(best) ? best : best + "。";
  }

  /* 相邻两字 Jaccard —— 与其他层同一个量法 */
  function bigrams(s) {
    var t = String(s).replace(CJK, ""), o = {};
    for (var i = 0; i + 1 < t.length; i++) o[t.slice(i, i + 2)] = true;
    return o;
  }
  function similarity(a, b) {
    var A = bigrams(a), B = bigrams(b), ka = Object.keys(A), kb = Object.keys(B);
    if (!ka.length || !kb.length) return 0;
    var inter = ka.filter(function (g) { return B[g]; }).length;
    return inter / (ka.length + kb.length - inter);
  }

  /* 一个方向 → 一个候选锚点。纯粹是截取,没有改写。 */
  function candidateFor(dirKey, copy) {
    var sents = sentences(copy.explanation);
    if (!sents.length) return null;
    var last = stripLead(sents[sents.length - 1]);
    var fromLast = hasCue(last);
    /* 最后一句没有「轻轻一步」的记号 → 往前找一句有的;都没有就用 coreInsight */
    var line = null;
    if (fromLast) line = last;
    else {
      for (var i = sents.length - 2; i >= 1; i--) {
        var s = stripLead(sents[i]);
        if (hasCue(s)) { line = s; break; }
      }
    }
    var source = line ? "gentle-direction" : "core-insight";
    if (!line) line = String(copy.coreInsight || "").trim();
    line = tighten(line, 36);
    if (len(line) < 6) return null;

    /* 支撑句:认得出来的那个画面,取第一句。可有可无。 */
    var support = sents.length > 1 ? stripLead(sents[0]) : "";
    if (len(support) > 30 || support === line) support = "";

    return {
      direction: dirKey,
      line: line,
      support: support,
      derivedFrom: source,
      /* 两件事决定一句话适不适合带走:
           1. 它本来就是写来给人带走的(有「轻轻一步」的记号)
           2. 短到记得住 */
      _score: (fromLast || source === "gentle-direction" ? 2 : 0) +
              (len(line) <= 24 ? 1 : 0),
      _len: len(line)
    };
  }

  /* 从四个方向挑三句:先看适不适合带走,再避免彼此重复。
     完全确定性 —— 同一份 Compass 永远得到同一组。 */
  function derive(copies, opts) {
    opts = opts || {};
    var order = opts.order || ["grounds", "moves", "drains", "calls"];
    var pool = [];
    order.forEach(function (k) {
      if (!copies || !copies[k]) return;
      var c = candidateFor(k, copies[k]);
      if (c) pool.push(c);
    });
    if (pool.length < ANCHOR_COUNT) {
      /* 不够三句就如实说不够 —— 不硬凑、不重复用同一句 */
      return { status: "insufficient", version: VERSION, anchors: [],
               available: pool.length, note: "accepted Compass 不足以取出三句锚点" };
    }

    /* 重复要付代价,但【只有真的重复才算】。
       0.02 与 0.05 的差别是杂讯,不该拿来决定留谁 —— 所以设一个地板,
       低于它一律当成「不重复」,改由分数与方向顺序决定。 */
    var REDUNDANCY_FLOOR = 0.15;
    var picked = [], dropped = [];
    while (picked.length < ANCHOR_COUNT && pool.length) {
      var best = null, bestVal = -Infinity, bestIdx = -1;
      pool.forEach(function (c, i) {
        var red = picked.reduce(function (m, p) {
          return Math.max(m, similarity(p.line + p.support, c.line + c.support));
        }, 0);
        var over = Math.max(0, red - REDUNDANCY_FLOOR);
        var val = c._score - over * 8;
        /* 同分时按方向顺序,不靠阵列顺序碰运气 */
        if (val > bestVal + 1e-9) { bestVal = val; best = c; bestIdx = i; }
      });
      picked.push(best);
      pool.splice(bestIdx, 1);
    }
    /* 被留下来的那些:说得出为什么 —— 取舍要能被检查 */
    pool.forEach(function (c) {
      var red = picked.reduce(function (m, p) {
        return Math.max(m, similarity(p.line + p.support, c.line + c.support));
      }, 0);
      dropped.push({ direction: c.direction, line: c.line,
        reason: red > REDUNDANCY_FLOOR ? "与已选的一句太接近(" + Math.round(red * 100) / 100 + ")"
          : (c._len > 24 ? "比较长,不容易记住(" + c._len + " 字)" : "三句已经足够,依方向顺序排在后面") });
    });

    var worst = 0;
    for (var i = 0; i < picked.length; i++)
      for (var j = i + 1; j < picked.length; j++)
        worst = Math.max(worst, similarity(picked[i].line, picked[j].line));

    return {
      status: "ok",
      version: VERSION,
      anchors: picked.map(function (p) {
        return { line: p.line, support: p.support, direction: p.direction,
                 derivedFrom: p.derivedFrom };
      }),
      maxSimilarity: Math.round(worst * 1000) / 1000,
      dropped: dropped
    };
  }

  /* 每一句锚点都必须真的来自已接受的文案 —— 不是重新写的。
     这是这一层最重要的一条自检。 */
  function verifyDerived(result, copies) {
    if (!result || result.status !== "ok") return { ok: true, offenders: [] };
    var blob = Object.keys(copies || {}).map(function (k) {
      return copies[k].coreInsight + copies[k].explanation;
    }).join("");
    var flat = blob.replace(CJK, "");
    var bad = result.anchors.filter(function (a) {
      var core = a.line.replace(CJK, "").replace(/。$/, "");
      return flat.indexOf(core) < 0;
    });
    return { ok: !bad.length, offenders: bad.map(function (a) { return a.line; }) };
  }

  return {
    VERSION: VERSION, ANCHOR_COUNT: ANCHOR_COUNT,
    GENTLE_CUES: GENTLE_CUES,
    derive: derive, verifyDerived: verifyDerived,
    candidateFor: candidateFor, similarity: similarity, tighten: tighten
  };
});
