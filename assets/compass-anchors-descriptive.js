/* ============================================================
   我的内在指南 · 想留给自己的几句话(Personal Anchors)· 描述型来源
   ------------------------------------------------------------
   为什么会有这一层

   anchors-2.2(Personal Anchors v1,已锁)做的是【截取】:
   它要求已接受的文案里【本来就有】一句可以带走的一步
   (「可以先看看…」「不一定要…」「…就够了」),
   然后把那一步连同它的场合压缩出来。那是 compass-v1.1 之后
   写作指令才规定的收尾方式。

   问题是:compass-v1 那一代的文案只有【描述与归纳】,
   句子收在「这是怎么回事」,没有一句收在「那下次可以怎么办」。
   2.2 对这种文案会诚实地回 insufficient —— 一句都取不出来。
   使用者那一页于是永远空着,而且他手上那份文案是花钱生成的,
   不该为了这个被丢掉重来。

   这一层只做一件事:当 2.2 取不到的时候,改用【框架】而不是截取。

     一句锚点 = 什么时候(原文) + 一个固定的邀请 + 值得回头看的是什么(原文)

   ⚠ 与 2.2 最重要的差别,必须说清楚:
     2.2 不允许出现来源里没有的字词。
     这一层【会】加进一小段固定的话 —— 就是那个邀请本身
     (「可以先看看」「也没关系」之类)。那一段是封闭的、可枚举的,
     而且【不对这个人做任何主张】:它不说他是什么样的人、
     不说原因、不说该不该,只是把原文已经写出来的东西
     重新指给他看一眼。

     除了那一段,句子里【每一个】有内容的字都必须能在来源里回查得到,
     一个字都不能多 —— verifyFramed 会逐个相邻两字检查。

   硬边界(与 2.2 相同)
     · 输入只有已接受的 Compass 文案,不读星盘
     · 不呼叫任何 API,同一份文案永远得到同一组锚点
     · 不产生新的心理主张、不下命令、不用万用句
     · 2.2 做得到的时候,原样交给 2.2,一个字都不改
   ============================================================ */
(function (root, factory) {
  if (typeof module === "object" && module.exports)
    module.exports = factory(require("./compass-anchors.js"));
  else root.CompassAnchorsDescriptive = factory(root.CompassAnchors);
})(typeof self !== "undefined" ? self : this, function (AN) {
  "use strict";

  var VERSION = "anchors-3.0";
  var ANCHOR_COUNT = 3;

  /* ── 唯一允许新增的字:邀请框架 ────────────────────────────
     封闭清单。它们不对人做任何主张,只是把原文里已经有的东西
     重新指一次。任何不在这份清单里的新字词都会被 verifyFramed 挡下来。 */
  var FRAME = {
    look:   { head: "的时候，", mid: "可以先看看，", tail: "。" },
    permit: { head: "的时候，", mid: "先", tail: "，也没关系。" }
  };
  /* 把上面所有框架用字摊平,给回查用 */
  var FRAME_TOKENS = "的时候，可以先看看，先，也没关系。「」";

  var CJK = /[，。！？；：、（）「」“”\s—…]/g;
  function len(s) { return String(s || "").replace(CJK, "").length; }
  function has(t, list) { return list.some(function (w) { return String(t).indexOf(w) >= 0; }); }

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
  function sentences(t) {
    return String(t || "").split(/(?<=[。！？])/).map(function (x) { return x.trim(); })
      .filter(function (x) { return len(x) >= 4; });
  }
  function clauses(t) {
    return String(t || "").split(/[。！？；，：]|——/)
      .map(function (x) { return x.trim(); }).filter(function (x) { return len(x) >= 2; });
  }

  /* 句首的连接词与主词:拿掉它们不改变意思,但少了它们句子才站得住 */
  var LEAD = ["不是因为", "而不是", "但如果", "这时候", "你需要先", "你需要", "你多半",
    "才有办法", "而是要", "反而", "不是", "而是", "但是", "可是", "只是", "所以", "因为",
    "对你来说", "这个", "那个", "更像是", "有时候", "通常是", "通常", "等",
    "你也", "你会", "你得", "你要", "你在", "你不会", "你不是", "你的", "你", "它需要", "它"];
  function stripLead(s) {
    var out = String(s || "").trim(), moved = true, guard = 0;
    while (moved && guard++ < 4) {
      moved = false;
      for (var i = 0; i < LEAD.length; i++) {
        if (out.indexOf(LEAD[i]) === 0 && len(out) - len(LEAD[i]) >= 3) {
          out = out.slice(LEAD[i].length).replace(/^[，、,：]\s*/, ""); moved = true; break;
        }
      }
    }
    return out;
  }

  /* ── ① 什么时候:会再回来的状态 ─────────────────────────
     不是随便一个子句。要嘛原文自己标了场合,
     要嘛它描述的是一个【会发生在这个人身上的变化】。 */
  var STATE = /(会|开始|容易|越来越|越做越|变得)[^，。]{0,6}(消失|散|走神|飘|变|少|累|乱|停|卡|耗|忘|远|慢|快|紧|沉|空|没力|掉|讲得很卡)/;
  var STATE_TAIL = /(得[^，。]{0,6}|了)$/;
  var SELF_COND = ["一旦", "只要", "每次", "每当", "遇到", "碰到"];   // 自己就带条件,不必再加「的时候」
  var NOT_A_MOMENT = /(的(地方|过程|方式|东西|事情|人|话|步骤|顺序|理由|感觉)|的)$/;
  function situationsFrom(copy) {
    var out = [], seen = {};
    sentences(copy.coreInsight).concat(sentences(copy.explanation)).forEach(function (sent) {
      clauses(sent).forEach(function (raw) {
        var c = stripLead(raw);
        var recurring = has(c, AN.SITUATION_RECURRING);
        var idx = c.indexOf("的时候");
        if (idx > 0) c = c.slice(0, idx);            // 原文写了「…的时候」就用它前面那一段,不叠第二次
        if (!recurring && !STATE.test(c)) return;
        if (has(c, AN.SITUATION_ONCE)) return;       // 一次性的场合当不了长期提醒
        var state = STATE.test(c);
        var t = stripLead(c).replace(STATE_TAIL, "");
        if (len(t) < 3 || len(t) > 13 || seen[t]) return;
        /* 「真正容易耗掉的地方」是一个东西,不是一个时刻 —— 接上「的时候」会变成病句 */
        if (NOT_A_MOMENT.test(t)) return;
        seen[t] = 1;
        out.push({ text: t, selfCond: has(t, SELF_COND),
          score: (state ? 2 : 0) + (recurring || idx > 0 ? 1 : 0) + (len(t) <= 9 ? 1 : 0) });
      });
    });
    return out.sort(function (a, b) { return b.score - a.score; });
  }

  /* ── ② 值得回头看的是什么 ───────────────────────────── */
  /* 「还没有答案的问题」—— 它只问,不主张,所以拿来当「可以先看看什么」最安全 */
  var OPEN_Q = ["还有没有", "还在不在", "讲不讲得通", "成不成立", "稳不稳", "为什么",
    "值不值得", "值得", "意义", "理由", "真实", "还没有", "有多少", "是什么", "怎么"];
  var ACTION = /^(先|让自己|把|换|停|问|看|想|退|挡|关小)/;      // 可以自己做的一步
  function isAction(t) { return ACTION.test(t) && !/的$/.test(t); }
  var DANGLING = /^(是|或者|一旦|而|才|也|再|就|都|还|没|不|哪怕|之后|反过来)/;
  var TRAILING = /(的|地|得|是|在|和|与|或)$/;                     // 收不了尾的半句

  /* 一句锚点里的「重点」只有两种来源,分别对应两种框架:
       action —— 一个可以自己做的一步     → 只用在【什么让我安定】
                 那一段问的就是「什么让你回来」,里面的动作本来就是让人稳下来的那些。
       open   —— 一个还没有答案的问题     → 用在其他三个方向
                 「可以先看看 X」只是把注意力指过去,不说 X 是好是坏。
     刻意【不】让消耗 / 吸引那两段产生「先做某件事也没关系」——
     那两段描述的是代价与拉力,替它们发许可等于说了原文没说的话。 */
  function focusesFrom(copy, kind) {
    var out = [], seen = {};
    function add(t, score, k) {
      t = stripLead(t).replace(/[，。；：]$/, "");
      if (len(t) < 3 || len(t) > 15) return;
      if (seen[t] || has(t, AN.GENERIC)) return;
      if (k !== "quoted" && (DANGLING.test(t) || TRAILING.test(t))) return;
      if (kind === "action" && !isAction(t)) return;
      if (kind === "open" && k !== "quoted" && (!has(t, OPEN_Q) || isAction(t))) return;
      seen[t] = 1; out.push({ text: t, score: score, kind: k });
    }
    if (kind === "open") {
      /* a. 原文自己用「」框起来的 —— 那是写的人认定的重点,不是我们挑的 */
      [copy.coreInsight, copy.explanation].forEach(function (src, i) {
        String(src || "").replace(/「([^」]{3,20})」/g, function (_, inner) { add(inner, 4 - i, "quoted"); return _; });
      });
      /* b. coreInsight 里「，是…」之后的那一半 */
      var m = /[，,]\s*是(.{3,20}?)(?:[，,。]|$)/.exec(String(copy.coreInsight || ""));
      if (m) add(m[1], 2, "core");
    }
    sentences(copy.coreInsight).concat(sentences(copy.explanation)).forEach(function (sent) {
      clauses(sent).forEach(function (raw) {
        var c = stripLead(raw);
        add(c, kind === "action" ? 2 : 1, kind === "action" ? "action" : "clause");
      });
    });
    return out.sort(function (a, b) { return b.score - a.score; });
  }

  /* ── 造一句 ───────────────────────────────────────────── */
  function joinSit(sit, head) { return sit.text + (sit.selfCond ? "，" : head); }

  /* 【什么让我安定】那一段里的动作,本来就是让这个人稳下来的那些 → 可以发许可。
     其余三段描述的是代价、拉力与条件 → 只能把注意力指过去,不能发许可。 */
  var PERMIT_DIRECTIONS = { grounds: true };

  function framedCandidate(dirKey, copy) {
    if (!copy || !copy.explanation) return null;
    var permit = !!PERMIT_DIRECTIONS[dirKey];
    var sits = situationsFrom(copy);
    var focs = focusesFrom(copy, permit ? "action" : "open");
    if (!focs.length) return null;

    /* 场合与重点不可以讲同一件事 —— 那样整句等于什么都没说 */
    var sit = null, foc = null;
    for (var i = 0; i < focs.length && !foc; i++) {
      var f = focs[i];
      for (var j = 0; j < sits.length; j++) {
        if (similarity(sits[j].text, f.text) < 0.3) { sit = sits[j]; foc = f; break; }
      }
      if (!foc && permit) { sit = null; foc = f; }      // 许可句本身就站得住,没有场合也行
    }
    if (!foc) return null;

    var line, frame;
    if (permit) {
      frame = "permit";
      line = (sit ? joinSit(sit, FRAME.permit.head) : "") +
        (/^先/.test(foc.text) ? foc.text : FRAME.permit.mid + foc.text) + FRAME.permit.tail;
    } else {
      if (!sit) return null;                            // 没有场合的「可以先看看」没有用
      frame = "look";
      /* 被框起来的那一段直接接在「可以先看看」后面,中间不要再点一个逗号 */
      var mid = foc.kind === "quoted" ? FRAME.look.mid.replace(/，$/, "") : FRAME.look.mid;
      var shown = foc.kind === "quoted" ? "「" + foc.text + "」" : foc.text;
      line = joinSit(sit, FRAME.look.head) + mid + shown + FRAME.look.tail;
    }
    if (len(line) < 8 || len(line) > 34) return null;
    if (has(line, AN.COMMANDING) || has(line, AN.GENERIC)) return null;

    var fn = "notice", best = 0;
    AN.FUNCTIONS.forEach(function (f) {
      var n = f.cues.filter(function (w) { return line.indexOf(w) >= 0; }).length;
      if (n > best) { best = n; fn = f.id; }
    });

    return {
      direction: dirKey, line: line, mode: "framed", frame: frame,
      situation: sit ? sit.text : null, move: foc.text,
      sourceFields: ["coreInsight", "explanation"],
      "function": fn, _len: len(line), _fnHits: best, focusKind: foc.kind
    };
  }

  /* ── 评分:与 2.2 同一套优先顺序。
     框架句一律扣 0.5 —— 它毕竟没有原文自己给的那一步那么贴。 */
  function scoreFramed(c) {
    var reusable = has(c.line, AN.SITUATION_ONCE) ? 1 : 2;
    var actionable = (c.frame === "look" ? 2 : 1) + 1;
    var specific = has(c.line, AN.GENERIC) ? -4 :
                   (c.focusKind === "quoted" || c.focusKind === "action" ? 1 : (c._fnHits >= 2 ? 1 : 0));
    var memorable = c._len <= 22 ? 0.6 : (c._len <= 30 ? 0.3 : 0);
    return {
      fidelity: 1, reusability: reusable, actionability: actionable,
      specificity: specific, memorability: memorable,
      total: 1 * 2 + reusable * 2 + actionable * 1.5 + specific * 1.5 + memorable - 0.5
    };
  }

  function fnZh(id) {
    var f = AN.FUNCTIONS.filter(function (x) { return x.id === id; })[0];
    return f ? f.zh : id;
  }
  function round1(x) { return Math.round(x * 10) / 10; }

  /* ── 取舍:与 2.2 同一套(先补功能,再看别太像)──────────── */
  function pick(pool) {
    var picked = [], usedFn = {};
    while (picked.length < ANCHOR_COUNT && pool.length) {
      var best = null, bestVal = -Infinity, bestIdx = -1;
      pool.forEach(function (c, i) {
        var red = picked.reduce(function (m, p) { return Math.max(m, similarity(p.line, c.line)); }, 0);
        var val = c.score.total + (usedFn[c["function"]] ? 0 : 2.5) - Math.max(0, red - 0.15) * 8;
        if (val > bestVal + 1e-9) { bestVal = val; best = c; bestIdx = i; }
      });
      best.selectionReason = (usedFn[best["function"]] ? "" : "补上「" + fnZh(best["function"]) + "」这个功能;") +
        "reusability=" + best.score.reusability + " actionability=" + best.score.actionability +
        " specificity=" + best.score.specificity;
      usedFn[best["function"]] = true;
      picked.push(best);
      pool.splice(bestIdx, 1);
    }
    return { picked: picked, usedFn: usedFn };
  }

  /* ── 对外 ─────────────────────────────────────────────── */
  function derive(copies, opts) {
    opts = opts || {};
    var order = opts.order || ["grounds", "moves", "drains", "calls"];

    /* ① 已锁的 2.2 做得到,就原样交给它 —— 一个字都不改 */
    var ex = AN.derive(copies, opts);
    if (ex.status === "ok") {
      var out = {}; for (var k in ex) out[k] = ex[k];
      out.mode = "extract"; out.engine = AN.VERSION; out.version = VERSION;
      return out;
    }

    /* ② 2.2 取不到,才用框架 */
    var pool = [];
    order.forEach(function (k) {
      if (!copies || !copies[k]) return;
      var c = AN.candidateFor(k, copies[k]);        // 单一方向仍然优先用截取
      if (c) { c.mode = "extract"; c.score = AN.scoreCandidate(c); }
      else { c = framedCandidate(k, copies[k]); if (c) c.score = scoreFramed(c); }
      if (c) pool.push(c);
    });
    if (pool.length < ANCHOR_COUNT) {
      return { status: "insufficient", version: VERSION, mode: "framed", anchors: [],
               available: pool.length, dropped: [],
               note: "accepted Compass 不足以取出三句可以重复使用的提醒" };
    }

    var r = pick(pool);
    var dropped = pool.map(function (c) {
      var red = r.picked.reduce(function (m, p) { return Math.max(m, similarity(p.line, c.line)); }, 0);
      return { direction: c.direction, line: c.line, "function": c["function"],
        reason: red > 0.15 ? "与已选的一句太接近(" + Math.round(red * 100) / 100 + ")"
          : (r.usedFn[c["function"]] ? "「" + fnZh(c["function"]) + "」已经有人选了,而且它的分数比较低("
              + round1(c.score.total) + ")"
            : "分数比较低(" + round1(c.score.total) + ")") };
    });
    var worst = 0;
    for (var i = 0; i < r.picked.length; i++)
      for (var j = i + 1; j < r.picked.length; j++)
        worst = Math.max(worst, similarity(r.picked[i].line, r.picked[j].line));

    return {
      status: "ok", version: VERSION, mode: "framed", engine: VERSION,
      anchors: r.picked.map(function (p) {
        return { line: p.line, sourceDirection: p.direction, sourceFields: p.sourceFields,
                 "function": p["function"], mode: p.mode || "framed", frame: p.frame || null,
                 situation: p.situation || null, move: p.move,
                 selectionReason: p.selectionReason, score: p.score };
      }),
      functionsCovered: Object.keys(r.usedFn),
      maxSimilarity: Math.round(worst * 1000) / 1000,
      dropped: dropped
    };
  }

  /* ── 溯源验证 ─────────────────────────────────────────
     截取来的那几句 → 交给 2.2 原本那一套,一个字都不放宽。
     框架句 → 【逐段】回查:场合那一段与重点那一段各自必须在来源里
     一字不差地找得到,中间那句邀请必须是 FRAME 里的原文。
     换句话说:除了那句邀请,一个字都不能是我们自己加的。 */
  function verifyFramed(result, copies) {
    if (!result || result.status !== "ok") return { ok: true, offenders: [] };
    var bad = [];
    result.anchors.forEach(function (a) {
      var src = copies && copies[a.sourceDirection];
      if (!src) { bad.push({ line: a.line, why: "找不到来源方向" }); return; }
      if (a.mode !== "framed") {
        var one = AN.verifyDerived({ status: "ok", anchors: [a] }, copies);
        if (!one.ok) bad = bad.concat(one.offenders);
        return;
      }
      var blob = (a.sourceFields || []).map(function (f) { return src[f] || ""; }).join("");
      var flat = String(blob).replace(CJK, "");
      /* 场合与重点都必须是来源里的一段原文 */
      [["场合", a.situation], ["重点", a.move]].forEach(function (pair) {
        if (!pair[1]) return;
        if (flat.indexOf(String(pair[1]).replace(CJK, "")) < 0)
          bad.push({ line: a.line, why: pair[0] + "那一段不在来源里", tokens: [pair[1]] });
      });
      /* 把场合、重点、框架用字全部扣掉之后,不可以还剩下别的字 */
      var rest = String(a.line);
      [a.situation, a.move].forEach(function (x) { if (x) rest = rest.split(x).join(""); });
      var allowed = FRAME.look.head + FRAME.look.mid + FRAME.look.tail +
                    FRAME.permit.head + FRAME.permit.mid + FRAME.permit.tail + "，「」";
      var leftover = rest.split("").filter(function (ch) { return allowed.indexOf(ch) < 0; });
      if (leftover.length)
        bad.push({ line: a.line, why: "出现来源与框架都没有的字", tokens: leftover.slice(0, 8) });
      if (has(a.line, AN.COMMANDING)) bad.push({ line: a.line, why: "变成命令句" });
      if (has(a.line, AN.GENERIC)) bad.push({ line: a.line, why: "变成谁都能说的空话" });
    });
    return { ok: !bad.length, offenders: bad };
  }

  return {
    VERSION: VERSION, ANCHOR_COUNT: ANCHOR_COUNT, FRAME: FRAME, FRAME_TOKENS: FRAME_TOKENS,
    derive: derive, verifyFramed: verifyFramed,
    framedCandidate: framedCandidate, scoreFramed: scoreFramed,
    situationsFrom: situationsFrom, focusesFrom: focusesFrom, similarity: similarity
  };
});
