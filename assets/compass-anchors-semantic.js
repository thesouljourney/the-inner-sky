/* ============================================================
   我的内在指南 · 想留给自己的几句话 —— 语意衍生层(anchors-3.1)
   ------------------------------------------------------------
   为什么会有这一层

   anchors-2.2(Personal Anchors v1,已锁)做的是【截取】:
   它要求已接受的文案里本来就有一句可以带走的一步,然后把那一步
   连同它的场合压缩出来。compass-v1 那一代的文案只有描述与归纳,
   句子收在「这是怎么回事」,所以 2.2 对它一句都取不出来。

   前一次的补救(anchors-3.0)改用【拼接】:原文子字串 + 固定框架。
   它安全,但读起来像拼的 —— 意思在原文里,句子却从来没有被真正
   重写过。人工内容审查没有通过,由这一版取代。

   ------------------------------------------------------------
   这一版换的是【单位】

     3.0  每一个【字】都必须在来源里找得到
     3.1  每一个【主张】都必须在来源里找得到

   做法与这个专案既有的人话翻译层(compass-translation.js)同一套:

     认出来源在讲哪一个【概念】 → 拿出我们【事先写好】的那一句

   画面上每一个字都是人写的完整句子,不是原文的碎片。
   系统负责的是「哪一句可以说」,不负责「怎么把碎片黏起来」。

   ⚠ 安全性靠三件事,不靠逐字比对
     ① 概念授权:句子只有在它所需要的概念【真的被这份文案授权】时才出现
     ② 输出空间有限:概念 × 句型是可枚举的,测试把【全部可能的句子】
        列出来逐条审、用 sha256 钉住 —— 3.0 的输出空间是无限的,
        所以永远可能有一句怪的没被发现,这一版没有这个问题
     ③ 词典静态稽核:那些句子是我们写的,测试对【整本词典】扫一次
        人格主张 / 心理机制 / 成因 / 过去 / 情绪命名 / 万用句

   ⚠ 语气守则(2026-09-16 人工 Voice Review 定案)
     · 「也不迟 / 没关系 / 不急」这类宽慰,只有在【原文自己给了那个许可】
       时才准写进 realization —— 不由句型自动加上去
     · realization 的确定性不可以高过来源(沿用 anchors-2.1 的范围守则)

   ⚠ 硬边界
     · 输入只有已接受的 Compass 文案,不读星盘
     · 不呼叫任何 API,同一份文案永远得到同一组锚点
     · 已锁的 2.2 做得到的时候,原样交给它,一个字都不改
   ============================================================ */
(function (root, factory) {
  if (typeof module === "object" && module.exports)
    module.exports = factory(require("./compass-anchors.js"));
  else root.CompassAnchorsSemantic = factory(root.CompassAnchors);
})(typeof self !== "undefined" ? self : this, function (AN) {
  "use strict";

  var VERSION = "anchors-3.1";
  var ANCHOR_COUNT = 3;

  /* ── 句型:手写,而且刻意只有六个 ─────────────────────────
     三句并排的时候,句型重复比功能重复更容易让人觉得「这是模具压的」,
     所以取舍时句型多样性【排在功能互补前面】。 */
  var TEMPLATES = {
    sequence: {
      need: ["step1", "state", "step2"],
      build: function (r) {
        return (r.trigger ? r.trigger + "的时候，" : "") +
          "先" + r.step1 + "，等" + r.state + "，再" + r.step2 + "也不迟。";
      }
    },
    when_look: {
      need: ["trigger", "question"],
      build: function (r) { return r.trigger + "的时候，也许可以回来看看，" + r.question + "。"; }
    },
    when_keep: {
      need: ["trigger", "restatement"],
      build: function (r) { return r.trigger + "的时候，" + r.restatement + "。"; }
    },
    not_a_but_b: {
      need: ["a", "b"],
      build: function (r) { return "不是" + r.a + "，是" + r.b + "。"; }
    },
    not_a_only_b: {
      need: ["a", "onlyB"],
      build: function (r) { return "不是" + r.a + "，只要" + r.onlyB + "。"; }
    },
    sometimes_not_a: {
      need: ["a", "b"],
      build: function (r) { return "有时候不是" + r.a + "，只是" + r.b + "。"; }
    },
    what_tires: {
      need: ["subject", "a", "b"],
      build: function (r) { return r.subject + "的常常不是" + r.a + "，是" + r.b + "。"; }
    },
    statement: {
      need: ["restatement"],
      build: function (r) { return r.restatement + "。"; }
    }
  };

  /* ── 概念词典 ─────────────────────────────────────────────
     cues   只用来【认出来源在讲什么】,一个字都不会进画面
     roles  手写的句子成分,进画面
     keep   人工内容审查给的「会不会真的想留给自己」——
            这是人的判断,不是算出来的,所以直接写在词典里
     spec   具体程度(触发点明不明确)

     ⚠ 这一版刻意【不】追求覆盖率。认不出来就诚实回 insufficient。 */
  var CONCEPTS = [
    {
      id: "settle_before_approach",
      variants: [
        { key: "quiet", cues: ["先让外面安静", "把外面的声音关小"], keep: 3, spec: 3,
          tpl: "sequence", roles: { step1: "让外面安静一会儿", state: "自己理顺了", step2: "靠近" } },
        { key: "block", cues: ["把外面的事情挡一挡", "先退开一点"], keep: 3, spec: 3,
          tpl: "sequence", roles: { trigger: "乱起来", step1: "把外面挡一挡", state: "自己理顺了", step2: "找人" } },
        { key: "not_hiding", cues: ["不是在躲谁", "把自己接回来"], keep: 3, spec: 2,
          tpl: "statement", roles: { restatement: "一个人待一会儿不是在躲谁，是把自己接回来" } },
        /* 「也是可以的」这个许可来自原文自己写的「说出来之前是散的…才比较容易开口」 */
        { key: "unformed", cues: ["说出来之前是散的", "讲得出口的话", "讲得出来的话"], keep: 2, spec: 2,
          tpl: "statement", roles: { restatement: "话还没成形的时候，不急着说，也是可以的" } }
      ]
    },
    {
      id: "momentum_needs_meaning",
      variants: [
        { key: "meaning", cues: ["还有没有意义", "有没有什么是真实的"], keep: 3, spec: 3,
          tpl: "when_look", roles: { trigger: "事情开始推不动", question: "它对自己还有没有意义" } },
        { key: "stands_up", cues: ["成不成立", "讲不讲得通"], keep: 3, spec: 3,
          tpl: "when_look", roles: { trigger: "撑不下去", question: "这件事对你还成不成立" } },
        { key: "not_persistence", cues: ["不是没有毅力", "需要那个理由还在"], keep: 3, spec: 2,
          tpl: "not_a_but_b", roles: { a: "你没有毅力", b: "那个理由要还在" } },
        { key: "not_importance", cues: ["事情重不重要", "不是你真正在评估的"], keep: 2, spec: 2,
          tpl: "not_a_only_b", roles: { a: "每件事都要重要", onlyB: "它对你还是真的" } }
      ]
    },
    {
      id: "checking_loop_costs",
      variants: [
        { key: "decision", cues: ["没关上的检查", "不在选择本身"], keep: 3, spec: 3,
          tpl: "what_tires", roles: { subject: "花力气", a: "那个决定", b: "决定完以后那段没关上的检查" } },
        { key: "closeness", cues: ["再确认一次", "反覆确认", "反复确认"], keep: 2, spec: 3,
          tpl: "when_keep", roles: { trigger: "又想再确认一次",
            restatement: "可以记得：想深入和还不到时候，常常是同时的" } }
      ]
    },
    {
      id: "angle_over_rest",
      variants: [
        { key: "angle", cues: ["比休息更有用", "换一个切入点"], keep: 3, spec: 2,
          tpl: "sometimes_not_a", roles: { a: "需要休息", b: "需要换一个切入点" } }
      ]
    },
    {
      id: "room_to_step_back",
      variants: [
        { key: "relationship", cues: ["随时可以退一步", "想往后站", "那个余地还在"], keep: 3, spec: 3,
          tpl: "when_keep", roles: { trigger: "想往后站", restatement: "不是想离开，是需要知道退一步还在" } },
        { key: "group", cues: ["什么时候可以走", "有退路"], keep: 3, spec: 3,
          tpl: "statement", roles: { restatement: "知道自己随时可以走，你才待得住" } }
      ]
    },
    {
      id: "agency_over_volume",
      variants: [
        { key: "one_slot", cues: ["自己排的", "自己说了算", "自己决定的余地"], keep: 3, spec: 3,
          tpl: "when_keep", roles: { trigger: "一天被排满", restatement: "留一小块自己说了算的，就又转得动了" } }
      ]
    },
    {
      id: "extra_layer_tires",
      variants: [
        { key: "after", cues: ["有多少人在看", "做完之后还要处理"], keep: 3, spec: 3,
          tpl: "what_tires", roles: { subject: "累", a: "那件事", b: "做完以后还要顾有多少人在看" } },
        { key: "watched", cues: ["先绷起来", "越多人在看"], keep: 3, spec: 3,
          tpl: "what_tires", roles: { subject: "累", a: "事情本身", b: "被看着的时候多顾的那一层" } }
      ]
    },
    {
      id: "depth_over_surface",
      variants: [
        /* 「比较容易」而不是「就」—— 原文只说「突然醒过来」,没有承诺必然 */
        { key: "wake", cues: ["往下走一层", "换个角度重新看"], keep: 3, spec: 3,
          tpl: "when_keep", roles: { trigger: "做得完但人不在里面", restatement: "往下走一层，人比较容易回来" } },
        { key: "serious", cues: ["不是更轻松的事", "可以认真的事"], keep: 2, spec: 2,
          tpl: "not_a_but_b", roles: { a: "更轻松的事", b: "可以认真的事" } },
        /* 刻意【不】写「人不多没关系」——原文没有给那个宽慰 */
        { key: "real_exchange", cues: ["能换到东西", "说点真的东西"], keep: 2, spec: 2,
          tpl: "statement", roles: { restatement: "要等到可以说点真的东西，你才会真的靠过去" } }
      ]
    }
  ];

  var CJK = /[，。！？；：、（）「」“”\s—…]/g;
  function flat(s) { return String(s || "").replace(CJK, ""); }
  function has(t, list) { return list.some(function (w) { return String(t).indexOf(w) >= 0; }); }

  function bigrams(s) {
    var t = flat(s), o = {};
    for (var i = 0; i + 1 < t.length; i++) o[t.slice(i, i + 2)] = true;
    return o;
  }
  function similarity(a, b) {
    var A = bigrams(a), B = bigrams(b), ka = Object.keys(A), kb = Object.keys(B);
    if (!ka.length || !kb.length) return 0;
    var inter = ka.filter(function (g) { return B[g]; }).length;
    return inter / (ka.length + kb.length - inter);
  }

  function build(tpl, roles) {
    var t = TEMPLATES[tpl];
    if (!t) return null;
    for (var i = 0; i < t.need.length; i++) if (!roles[t.need[i]]) return null;
    return t.build(roles);
  }

  /* ── 授权:这份文案有没有在讲这个概念 ─────────────────── */
  function licensedVariants(copy) {
    var blob = flat((copy && copy.coreInsight) || "") + flat((copy && copy.explanation) || "");
    var out = [];
    CONCEPTS.forEach(function (c) {
      for (var i = 0; i < c.variants.length; i++) {
        var v = c.variants[i];
        var hit = v.cues.filter(function (w) { return blob.indexOf(flat(w)) >= 0; });
        if (!hit.length) continue;
        out.push({ concept: c.id, variant: v.key, cuesHit: hit, def: v });
        break;                         // 一个概念只取【第一个】命中的说法,不重复出句
      }
    });
    return out;
  }

  /* ── 一个方向 → 最多一个候选 ─────────────────────────── */
  function candidateFor(dirKey, copy) {
    if (!copy || !copy.coreInsight) return null;
    var lic = licensedVariants(copy);
    var best = null;
    lic.forEach(function (L) {
      var line = build(L.def.tpl, L.def.roles);
      if (!line) return;
      if (has(line, AN.COMMANDING) || has(line, AN.GENERIC)) return;
      var c = {
        direction: dirKey, line: line, mode: "semantic",
        concept: L.concept, variant: L.variant, template: L.def.tpl,
        cuesHit: L.cuesHit, keep: L.def.keep, spec: L.def.spec,
        sourceFields: ["coreInsight", "explanation"]
      };
      c["function"] = functionOf(line);
      if (!best || c.keep > best.keep ||
          (c.keep === best.keep && c.spec > best.spec)) best = c;
    });
    return best;
  }

  function functionOf(line) {
    var fn = "notice", best = 0;
    AN.FUNCTIONS.forEach(function (f) {
      var n = f.cues.filter(function (w) { return line.indexOf(w) >= 0; }).length;
      if (n > best) { best = n; fn = f.id; }
    });
    return fn;
  }
  function fnZh(id) {
    var f = AN.FUNCTIONS.filter(function (x) { return x.id === id; })[0];
    return f ? f.zh : id;
  }

  /* ── 取舍 ─────────────────────────────────────────────
     人工 Voice Review 定下来的优先顺序:

       1 语意安全 / 可溯源   ← 由词典与授权保证,不进这里算
       2 自然                ← 由手写 realization 保证
       3 会不会想留给自己    ← keep,权重最大
       4 具体 / 有用         ← spec
       5 句型不要重复        ← 重复扣 1.5
       6 功能互补            ← 只加 1,【不可以】把更好的一句挤掉

     第 6 项刻意给得比第 5 项小:功能互补是偏好,不是硬性规定。 */
  function value(c, usedTpl, usedFn, picked) {
    var red = picked.reduce(function (m, p) { return Math.max(m, similarity(p.line, c.line)); }, 0);
    return c.keep * 3 + c.spec
      - (usedTpl[c.template] ? 1.5 : 0)
      + (usedFn[c["function"]] ? 0 : 1)
      - Math.max(0, red - 0.2) * 8;
  }

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

    var pool = [];
    order.forEach(function (k) {
      if (!copies || !copies[k]) return;
      var c = AN.candidateFor(k, copies[k]);          // 单一方向仍然优先用截取
      if (c) {
        c.mode = "extract"; c.template = "extract";
        c.keep = 3; c.spec = 2;
      } else {
        c = candidateFor(k, copies[k]);
      }
      if (c) pool.push(c);
    });
    if (pool.length < ANCHOR_COUNT) {
      return { status: "insufficient", version: VERSION, mode: "semantic", anchors: [],
               available: pool.length, dropped: [],
               note: "accepted Compass 不足以取出三句可以重复使用的提醒" };
    }

    var picked = [], usedTpl = {}, usedFn = {};
    while (picked.length < ANCHOR_COUNT && pool.length) {
      var best = null, bestVal = -Infinity, bestIdx = -1;
      pool.forEach(function (c, i) {
        var v = value(c, usedTpl, usedFn, picked);
        if (v > bestVal + 1e-9) { bestVal = v; best = c; bestIdx = i; }
      });
      best.selectionReason =
        "值得留下=" + best.keep + " 具体=" + best.spec +
        (usedTpl[best.template] ? " 句型重复" : " 句型新") +
        (usedFn[best["function"]] ? "" : " 补上「" + fnZh(best["function"]) + "」");
      usedTpl[best.template] = true;
      usedFn[best["function"]] = true;
      picked.push(best);
      pool.splice(bestIdx, 1);
    }

    var dropped = pool.map(function (c) {
      return { direction: c.direction, line: c.line, "function": c["function"],
        reason: "另外三句更值得留下(值得留下=" + c.keep + " 具体=" + c.spec + ")" };
    });
    var worst = 0;
    for (var i = 0; i < picked.length; i++)
      for (var j = i + 1; j < picked.length; j++)
        worst = Math.max(worst, similarity(picked[i].line, picked[j].line));

    return {
      status: "ok", version: VERSION, mode: "semantic", engine: VERSION,
      anchors: picked.map(function (p) {
        return { line: p.line, sourceDirection: p.direction, sourceFields: p.sourceFields,
                 "function": p["function"], mode: p.mode, template: p.template,
                 concept: p.concept || null, variant: p.variant || null,
                 cuesHit: p.cuesHit || null, selectionReason: p.selectionReason };
      }),
      functionsCovered: Object.keys(usedFn),
      templatesUsed: Object.keys(usedTpl),
      maxSimilarity: Math.round(worst * 1000) / 1000,
      dropped: dropped
    };
  }

  /* ── 验证:每一个【主张】都必须重新授权得起来 ───────────
     截取来的那几句 → 交给 2.2 原本那一套,一个字都不放宽。
     语意句 → 三件事全部要成立:
       ① 那个概念的那个说法,在这个方向的文案里【现在仍然】被授权
       ② 画面上那一句,等于句型套上词典里手写的成分(没有被改过)
       ③ 没有变成命令句 / 万用句 */
  function verifySemantic(result, copies) {
    if (!result || result.status !== "ok") return { ok: true, offenders: [] };
    var bad = [];
    result.anchors.forEach(function (a) {
      var src = copies && copies[a.sourceDirection];
      if (!src) { bad.push({ line: a.line, why: "找不到来源方向" }); return; }
      if (a.mode !== "semantic") {
        var one = AN.verifyDerived({ status: "ok", anchors: [a] }, copies);
        if (!one.ok) bad = bad.concat(one.offenders);
        return;
      }
      var lic = licensedVariants(src).filter(function (L) {
        return L.concept === a.concept && L.variant === a.variant;
      })[0];
      if (!lic) { bad.push({ line: a.line, why: "这个概念在来源里没有被授权",
                             tokens: [a.concept + "/" + a.variant] }); return; }
      var rebuilt = build(lic.def.tpl, lic.def.roles);
      if (rebuilt !== a.line)
        bad.push({ line: a.line, why: "句子不等于词典里写好的那一句", tokens: [rebuilt] });
      if (has(a.line, AN.COMMANDING)) bad.push({ line: a.line, why: "变成命令句" });
      if (has(a.line, AN.GENERIC)) bad.push({ line: a.line, why: "变成谁都能说的空话" });
    });
    return { ok: !bad.length, offenders: bad };
  }

  /* ── 把【所有可能被说出口的句子】列出来 ───────────────
     这是这一版最重要的安全性质:输出空间有限,可以整份审、整份钉住。
     3.0 的输出空间是「原文的任意子字串组合」,做不到这件事。 */
  function allPossibleLines() {
    var out = [];
    CONCEPTS.forEach(function (c) {
      c.variants.forEach(function (v) {
        var line = build(v.tpl, v.roles);
        if (line) out.push({ concept: c.id, variant: v.key, template: v.tpl, line: line });
      });
    });
    return out;
  }

  return {
    VERSION: VERSION, ANCHOR_COUNT: ANCHOR_COUNT,
    CONCEPTS: CONCEPTS, TEMPLATES: TEMPLATES,
    derive: derive, verifySemantic: verifySemantic,
    candidateFor: candidateFor, licensedVariants: licensedVariants,
    allPossibleLines: allPossibleLines, similarity: similarity
  };
});
