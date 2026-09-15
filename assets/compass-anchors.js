/* ============================================================
   我的内在指南 · 想留给自己的几句话(Personal Anchors)
   ------------------------------------------------------------
   这一层回答的是:

     「读完我的内在指南以后,有什么是我以后真的值得回来提醒自己的?」

   它【不是】四张卡的摘要,不是最后一句话,不是励志语录,
   也【不是】第二次解读 —— 它不读星盘、不呼叫任何 API、不产生新主张。

   做法:从每一个 ready 方向的【已接受文案】里,压缩出一句可以重复使用的提醒,
   再从这些候选里挑出三句【功能互补】的。

   一句锚点 = 什么时候 + 可以往哪里看
     什么时候   从文案里带「的时候 / 一旦 / 每次 / 一直」的那一段来
     往哪里看   从文案里带「可以先看看 / 不一定要 / 就够了」的那一段来
   两半都是原文里本来就有的话 —— 压缩,不是改写,更不是新增。

   ⚠ 硬边界
     · 输入只有 accepted Compass(coreInsight / explanation / reflectionPrompt)
     · 不新增任何概念:verifyDerived 会逐个字段回查
     · 不呼叫 API。同一份 Compass 永远得到同一组锚点。
   ============================================================ */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CompassAnchors = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var VERSION = "anchors-2.1";
  var ANCHOR_COUNT = 3;

  /* ── 词表:刻意很小。这些不是心理规则,只是「这句话长什么形状」 ── */

  /* 会重复发生的场合 —— 锚点要能在未来用得上,靠的就是这个 */
  var SITUATION_RECURRING = ["的时候", "一旦", "每次", "每当", "只要", "遇到", "碰到", "一直"];
  /* 一次性的场合,当不了长期提醒 */
  var SITUATION_ONCE = ["最近", "今天", "这一次", "刚才"];
  /* 轻轻的一步:给一个可以站的位置,不是命令 */
  var MOVE_GENTLE = ["可以先看看", "也可以先看看", "可以先", "也可以", "不一定要", "不一定是",
    "不用急着", "先不用", "就够了", "不妨", "允许自己", "没有关系", "没关系",
    "也许可以", "也可能只是", "还在不在", "不必"];
  /* 指向「去看一眼」而不是「去做什么」—— 这是 actionability 的核心 */
  var MOVE_LOOK = ["看看", "问问", "想想", "留意", "注意", "停一下", "停下来", "检查"];
  /* 命令句:一出现就不是锚点 */
  var COMMANDING = ["你应该", "你必须", "你需要学会", "你最好", "请你", "记得要"];
  /* 语意上的保留字:原文用它们把话说得【没那么满】。
     压缩可以拿掉它们,但不可以因此把话说得比原文更肯定。 */
  var HEDGE = ["有些时候", "有时候", "有时", "可能", "也许", "或许", "不一定",
    "比较", "往往", "通常", "多半", "大概", "不见得", "未必"];
  /* 谁都能说的空话 */
  var GENERIC = ["相信自己", "慢慢来", "照顾好自己", "一切都会好", "做真实的自己",
    "放轻松", "加油", "顺其自然", "活在当下", "爱自己"];

  /* 三种功能。用【这句话在讲什么】判断,不是用它来自哪个方向。 */
  var FUNCTIONS = [
    { id: "return",  zh: "回到自己",
      cues: ["安静", "停", "退", "休息", "空间", "慢", "沉下来", "关小", "一个人", "独处", "喘"] },
    { id: "orient",  zh: "决定方向",
      cues: ["理由", "为什么", "值得", "方向", "还在不在", "要不要", "意义", "说得通",
             "带到哪里", "继续", "投入", "在意"] },
    { id: "notice",  zh: "早点发现",
      cues: ["一直", "反覆", "反复", "又", "再确认", "绕", "卡", "耗", "掂量", "重新",
             "没完", "拖"] }
  ];

  var CJK = /[，。！？；：、（）「」“”\s]/g;
  function len(s) { return String(s || "").replace(CJK, "").length; }
  function has(t, list) { return list.some(function (w) { return String(t).indexOf(w) >= 0; }); }
  function hits(t, list) { return list.filter(function (w) { return String(t).indexOf(w) >= 0; }); }

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

  /* 把文案切成子句。顺序保留,但【位置不参与评分】—— 这是这一版与上一版最大的差别。 */
  var LEAD = ["所以", "因此", "于是", "这时候", "有些时候", "有时候", "只是当", "只是",
    "而且", "另外", "对你来说", "如果最近刚好遇到这种情况"];
  function stripLead(s) {
    var out = String(s || "").trim();
    for (var i = 0; i < LEAD.length; i++) {
      if (out.indexOf(LEAD[i]) === 0) {
        out = out.slice(LEAD[i].length).replace(/^[，、,]\s*/, "");
        break;
      }
    }
    return out;
  }
  function clauses(text) {
    return String(text || "").split(/[。！？；，]/)
      .map(function (x) { return x.trim(); }).filter(function (x) { return len(x) >= 3; });
  }

  /* ──────────────────────────────────────────────────────────
     一个方向 → 一个候选锚点
     ────────────────────────────────────────────────────────── */
  function sentences(t) {
    return String(t || "").split(/(?<=[。！？])/).map(function (x) { return x.trim(); })
      .filter(function (x) { return len(x) >= 4; });
  }

  function candidateFor(dirKey, copy) {
    if (!copy || !copy.explanation) return null;
    var srcFields = ["coreInsight", "explanation"];
    var sents = sentences(copy.explanation);
    if (!sents.length) return null;

    /* ① 先找「往哪里看」。它决定这句锚点有没有用。
       取整句里从那个子句到句末 —— 半截的动作(「也许可以先看看。」)说了等于没说。 */
    var mov = null, movScore = -1, movSentIdx = -1, movClauseIdx = -1;
    sents.forEach(function (sent, si) {
      var cls = clauses(stripLead(sent));
      cls.forEach(function (c, ci) {
        if (!has(c, MOVE_GENTLE)) return;
        var span = cls.slice(ci).join("，");
        if (len(span) > 30) span = cls.slice(ci, ci + 2).join("，");
        var sc = 2 + (has(span, MOVE_LOOK) ? 2 : 0) - (len(span) > 26 ? 1 : 0);
        if (sc > movScore) { movScore = sc; mov = span; movSentIdx = si; movClauseIdx = ci; }
      });
    });
    if (!mov) return null;      // 这个方向给不出可以带走的话

    /* ② 再找「什么时候」。
       优先跟动作【同一句】而且在它前面 —— v1.2 本来就把场合与那一步写在同一句里。
       同一句里没有,才退回全篇最好的一个。 */
    function sitScoreOf(c) {
      if (!has(c, SITUATION_RECURRING)) return -1;
      return 2 - (has(c, SITUATION_ONCE) ? 1 : 0)
               - (len(c) > 18 ? 1 : 0) + (len(c) >= 6 ? 1 : 0);
    }
    var sit = null, sitScore = -1, sitSameSentence = false;
    clauses(stripLead(sents[movSentIdx])).slice(0, movClauseIdx).forEach(function (c) {
      var sc = sitScoreOf(c);
      if (sc > sitScore) { sitScore = sc; sit = c; sitSameSentence = true; }
    });

    /* ②-a 范围守则(scope guard)
       ------------------------------------------------------------
       同一句里找得到场合,那就是原文自己给的范围,压缩不会改变它。
       但是【跨句】把另一句的条件搬过来,有可能把话说得比原文更肯定 ——
       原文说「有些时候……就够了」,搬成「事情刚发生的时候……就够了」,
       那已经不是压缩,是替作者做了一个它没做的承诺。

       判断方式是语意的,不是「保留字必须原样出现」:
         看那一步【原本站在什么范围底下】(句首到它自己之前的那一段)。
         那个范围本来是有保留的 → 换成别句的条件一定会更肯定 → 整个不搬。
         那个范围本来就没有保留 → 原文自己就没有留余地,搬过来不会更肯定 → 可以搬。
       注意这里只看【范围】那一段,不看整句:保留字长在那一步自己身上的时候
       (「通常先让自己想一想就够了」),它会跟着那一步一起被带走,不算被拿掉。
       守不住的时候宁可只留那一步本身 —— 少一半,好过多一分原文没有的确定。 */
    var movSentRaw = sents[movSentIdx] || "";
    var movHead = clauses(stripLead(movSentRaw))[movClauseIdx] || "";
    var movScope = movHead ? movSentRaw.slice(0, movSentRaw.indexOf(movHead)) : "";
    var scopeHedged = has(movScope, HEDGE);
    var scopeGuard = null;

    if (!sit) {
      var all = clauses(copy.coreInsight).concat(
        sents.map(function (x) { return clauses(stripLead(x)); })
             .reduce(function (a2, b2) { return a2.concat(b2); }, []));
      all.forEach(function (c) {
        if (c === mov) return;
        /* 这一句原本是有保留的,从别句搬一个条件进来一定会把它说死 —— 不搬 */
        if (scopeHedged) { scopeGuard = "cross-sentence-would-tighten-scope"; return; }
        var sc = sitScoreOf(c);
        if (sc > sitScore) { sitScore = sc; sit = c; }
      });
    }
    if (sit) scopeGuard = null;   // 真的找到可以用的场合,就没有被挡下来这回事

    var line = (sit ? sit + "，" : "") + mov;
    if (!/[。！？]$/.test(line)) line += "。";

    /* 功能:看这句话在讲什么,不是看它来自哪个方向 */
    var fn = "notice", fnBest = 0;
    FUNCTIONS.forEach(function (f) {
      var n = hits(line, f.cues).length;
      if (n > fnBest) { fnBest = n; fn = f.id; }
    });

    return {
      direction: dirKey,
      line: line,
      situation: sit, move: mov, sameSentence: sitSameSentence,
      scopeHedged: scopeHedged, scopeGuard: scopeGuard,
      "function": fn,
      sourceFields: srcFields,
      _sit: sitScore, _mov: movScore, _len: len(line), _fnHits: fnBest
    };
  }

  /* ──────────────────────────────────────────────────────────
     评分。顺序就是任务书第 7 节的优先顺序。
     长度【只】在最后当微调,不会把更有用的一句挤掉。
     ────────────────────────────────────────────────────────── */
  function scoreCandidate(c) {
    var t = c.line;
    var fidelity = 1;                                   // 由 verifyDerived 把关,这里是结构分
    var reusable = (c.situation && has(c.situation, SITUATION_RECURRING) ? 2 : 0) +
                   (c.situation && has(c.situation, SITUATION_ONCE) ? -1 : 0);
    var actionable = (has(t, MOVE_LOOK) ? 2 : 0) + (has(t, MOVE_GENTLE) ? 1 : 0) -
                     (has(t, COMMANDING) ? 5 : 0);
    var specific = has(t, GENERIC) ? -4 : (c._fnHits >= 2 ? 1 : 0);
    var memorable = c._len <= 22 ? 0.6 : (c._len <= 34 ? 0.3 : 0);
    return {
      fidelity: fidelity, reusability: reusable, actionability: actionable,
      specificity: specific, memorability: memorable,
      total: fidelity * 2 + reusable * 2 + actionable * 1.5 + specific * 1.5 + memorable
    };
  }

  /* 互补:先补上还没出现的功能,再看字面别太像 */
  function derive(copies, opts) {
    opts = opts || {};
    var order = opts.order || ["grounds", "moves", "drains", "calls"];
    var pool = [];
    order.forEach(function (k) {
      if (!copies || !copies[k]) return;
      var c = candidateFor(k, copies[k]);
      if (!c) return;
      c.score = scoreCandidate(c);
      pool.push(c);
    });
    if (pool.length < ANCHOR_COUNT) {
      return { status: "insufficient", version: VERSION, anchors: [],
               available: pool.length, dropped: [],
               note: "accepted Compass 不足以取出三句可以重复使用的提醒" };
    }

    var picked = [], usedFn = {};
    while (picked.length < ANCHOR_COUNT && pool.length) {
      var best = null, bestVal = -Infinity, bestIdx = -1;
      pool.forEach(function (c, i) {
        var red = picked.reduce(function (m, p) { return Math.max(m, similarity(p.line, c.line)); }, 0);
        var val = c.score.total
          + (usedFn[c["function"]] ? 0 : 2.5)          // 补上还没出现的功能
          - Math.max(0, red - 0.15) * 8;              // 只有真的像才扣分
        if (val > bestVal + 1e-9) { bestVal = val; best = c; bestIdx = i; }
      });
      best.selectionReason = (usedFn[best["function"]] ? "" : "补上「" + fnZh(best["function"]) + "」这个功能;") +
        "reusability=" + best.score.reusability + " actionability=" + best.score.actionability +
        " specificity=" + best.score.specificity;
      usedFn[best["function"]] = true;
      picked.push(best);
      pool.splice(bestIdx, 1);
    }

    var dropped = pool.map(function (c) {
      var red = picked.reduce(function (m, p) { return Math.max(m, similarity(p.line, c.line)); }, 0);
      return { direction: c.direction, line: c.line, "function": c["function"],
        reason: red > 0.15 ? "与已选的一句太接近(" + Math.round(red * 100) / 100 + ")"
          : (usedFn[c["function"]] ? "「" + fnZh(c["function"]) + "」已经有人选了,而且它的分数比较低("
              + round1(c.score.total) + ")"
            : "分数比较低(" + round1(c.score.total) + ")") };
    });

    var worst = 0;
    for (var i = 0; i < picked.length; i++)
      for (var j = i + 1; j < picked.length; j++)
        worst = Math.max(worst, similarity(picked[i].line, picked[j].line));

    return {
      status: "ok", version: VERSION,
      anchors: picked.map(function (p) {
        return {
          line: p.line,
          /* 以下一律【只给开发追溯】,不进画面 */
          sourceDirection: p.direction, sourceFields: p.sourceFields,
          "function": p["function"], selectionReason: p.selectionReason,
          score: p.score
        };
      }),
      functionsCovered: Object.keys(usedFn),
      maxSimilarity: Math.round(worst * 1000) / 1000,
      dropped: dropped
    };
  }
  function fnZh(id) {
    var f = FUNCTIONS.filter(function (x) { return x.id === id; })[0];
    return f ? f.zh : id;
  }
  function round1(x) { return Math.round(x * 10) / 10; }

  /* ──────────────────────────────────────────────────────────
     溯源验证(语意压缩版)
     ------------------------------------------------------------
     上一版只检查「整句是不是原文的子字串」——那样只能做截取,不能压缩。
     这一版改成【逐个相邻两字回查】:锚点可以重新组合、可以删,
     但不可以出现来源里没有的字词。也就是:
       可以压缩   ✓
       可以换顺序 ✓
       可以新增讯息 ✗
     完全确定性,不需要第二个模型。
     ────────────────────────────────────────────────────────── */
  function verifyDerived(result, copies) {
    if (!result || result.status !== "ok") return { ok: true, offenders: [] };
    var bad = [];
    result.anchors.forEach(function (a) {
      var src = copies && copies[a.sourceDirection];
      if (!src) { bad.push({ line: a.line, why: "找不到来源方向" }); return; }
      if (!a.sourceFields || !a.sourceFields.length) { bad.push({ line: a.line, why: "没有记录来源栏位" }); return; }
      var blob = a.sourceFields.map(function (f) { return src[f] || ""; }).join("");
      var pool = bigrams(blob);
      var unknown = Object.keys(bigrams(a.line)).filter(function (g) { return !pool[g]; });
      /* 接起来的地方会产生一两个新的相邻字对(例如场合与动作之间的接缝),
         那是压缩的必然结果,不是新讯息。超过这个数就是真的加了东西。 */
      if (unknown.length > 2) bad.push({ line: a.line, why: "出现来源里没有的字词", tokens: unknown.slice(0, 6) });
      if (has(a.line, COMMANDING)) bad.push({ line: a.line, why: "变成命令句" });
    });
    return { ok: !bad.length, offenders: bad };
  }

  return {
    VERSION: VERSION, ANCHOR_COUNT: ANCHOR_COUNT, FUNCTIONS: FUNCTIONS,
    SITUATION_RECURRING: SITUATION_RECURRING, MOVE_GENTLE: MOVE_GENTLE, HEDGE: HEDGE,
    MOVE_LOOK: MOVE_LOOK, GENERIC: GENERIC,
    derive: derive, verifyDerived: verifyDerived,
    candidateFor: candidateFor, scoreCandidate: scoreCandidate, similarity: similarity
  };
});
