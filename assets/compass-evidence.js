/* ============================================================
   我的内在指南 · 证据抽取原型(Evidence Extraction Prototype)
   ------------------------------------------------------------
   这一支只回答一个问题:「系统凭什么这样说?」
   它【不】产生任何给使用者看的文字。summary / mechanism 一律是
   内部工作语言,刻意写得不好看 —— 好看是下一阶段的事。

   不碰网路、不呼叫任何 API、不读写资料库、不依赖浏览器。
   Node 与浏览器都能载入(档尾 UMD)。

   资料角色严格分三级(依 docs/INNER-COMPASS-ARCHITECTURE-AUDIT.md):

     chart       主要证据   唯一能计入 independentEvidenceCount 的来源
     themes      次级诠释   只能当 supporting,永远不计入独立证据数
     lifeThreads 综合脉络   只能当 contextual,永远不增加任何计数

   刻意排除:收藏、日记、心情、反思答案 —— 这一层根本不接受这些栏位。
   ============================================================ */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CompassEvidence = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ──────────────────────────────────────────────────────────
     0. 人类领域(domain)—— 候选模式必须属于其中一个,
        不可以属于「某个星座」或「某个宫位」
     ────────────────────────────────────────────────────────── */
  var DOMAINS = [
    "emotional-regulation", "security", "recovery", "processing-style",
    "motivation", "agency", "meaningful-engagement", "creation",
    "internal-pressure", "over-responsibility", "avoidance", "suppression",
    "repeated-tension", "relational-response", "uncertainty-response",
    "decision-pattern", "sense-of-meaning", "curiosity", "growth-direction",
    "developmental-pull", "belonging", "autonomy", "expression", "rest"
  ];

  var DIRECTIONS = ["grounds", "moves", "drains", "calls"];

  /* 每个方向关心哪些领域(来自内容规格第四部分) */
  var DIRECTION_DOMAINS = {
    grounds: ["emotional-regulation", "security", "recovery", "processing-style",
              "belonging", "rest"],
    moves:   ["motivation", "agency", "meaningful-engagement", "creation",
              "sense-of-meaning", "expression"],
    drains:  ["internal-pressure", "over-responsibility", "avoidance",
              "suppression", "repeated-tension", "uncertainty-response"],
    calls:   ["curiosity", "growth-direction", "developmental-pull", "autonomy",
              "sense-of-meaning", "creation"]
  };

  /* ──────────────────────────────────────────────────────────
     1. 盘面讯号抽取
     ------------------------------------------------------------
     一个 signal = 一个「结构事实」。它自带:
       structure   结构家族(planet-house / aspect / balance …)
       actors      参与这个结构的盘面物件(用来判断独立性)
       tags        语意标签,给规则比对用
     独立性键 independenceKey = structure + 排序后的 actors
     → 同一个结构被不同文字讲两次,永远只会是同一个键。
     ────────────────────────────────────────────────────────── */

  var PERSONAL = ["Sun", "Moon", "Mercury", "Venus", "Mars"];
  var HARD = ["squ", "opp", "con"];        // 本原型把合相也当「强接触」
  var SOFT = ["tri", "sex"];

  function sig(structure, actors, tags, detail, weight) {
    var a = actors.slice().sort();
    return {
      id: structure + ":" + a.join("+"),
      structure: structure,
      actors: a,
      independenceKey: structure + "|" + a.join("+"),
      tags: tags,
      detail: detail,
      weight: weight == null ? 1 : weight,
      sourceType: "chart",
      role: "primary",
      independence: "independent"
    };
  }

  function elementOf(signIdx) { return ["fire", "earth", "air", "water"][signIdx % 4]; }
  function modeOf(signIdx) { return ["cardinal", "fixed", "mutable"][signIdx % 3]; }

  function extractChartSignals(natal) {
    var out = [];
    if (!natal || !natal.planets) return out;
    var byKey = {};
    natal.planets.forEach(function (p) { byKey[p.key] = p; });
    var extras = {};
    (natal.extras || []).forEach(function (x) { extras[x.key] = x; });

    /* —— 1a. 行星落宫:只取有明确心理意义的几组,不是全部铺开 —— */
    natal.planets.forEach(function (p) {
      var h = p.house, tags = [];
      if (h === 12) tags.push("withdrawn-processing", "solitude-need");
      if (h === 4)  tags.push("private-base", "security-inward");
      if (h === 8)  tags.push("depth-engagement", "guarded-disclosure");
      if (h === 6)  tags.push("duty-load", "routine-bound");
      if (h === 10) tags.push("visible-responsibility");
      if (h === 9)  tags.push("horizon-pull", "meaning-search");
      if (h === 11) tags.push("collective-pull");
      if (h === 3)  tags.push("articulation-need");
      if (h === 1)  tags.push("self-forward");
      if (h === 5)  tags.push("making-impulse");
      if (!tags.length) return;
      if (p.key === "Saturn") tags.push("pressure-source");
      if (p.key === "Moon")   tags.push("regulation-site");
      if (p.key === "Mars")   tags.push("agency-site");
      if (p.key === "Mercury")tags.push("processing-site");
      if (p.key === "Uranus") tags.push("autonomy-need");
      if (p.key === "Jupiter")tags.push("expansion-site");
      out.push(sig("planet-house", [p.key, "H" + h], tags,
        p.key + " in house " + h, PERSONAL.indexOf(p.key) >= 0 ? 1.2 : 1));
    });

    /* —— 1b. 相位:只取容许度较紧的,松的当噪音丢掉 —— */
    (natal.aspects || []).forEach(function (a) {
      if (a.orb > 6) return;
      var tight = a.orb <= 3;
      var tags = [];
      var pair = [a.aKey, a.bKey];
      var has = function (k) { return pair.indexOf(k) >= 0; };
      var hard = HARD.indexOf(a.type) >= 0;
      var soft = SOFT.indexOf(a.type) >= 0;

      if (has("Saturn") && pair.some(function (k) { return PERSONAL.indexOf(k) >= 0; })) {
        tags.push(hard ? "pressure-contact" : "structure-contact");
        if (hard) tags.push("self-monitoring", "delayed-permission");
      }
      if (has("Uranus") && pair.some(function (k) { return PERSONAL.indexOf(k) >= 0; }))
        tags.push("autonomy-need", hard ? "disruption-sensitivity" : "variety-pull");
      if (has("Neptune") && (has("Moon") || has("Mercury")))
        tags.push("diffuse-processing", "hard-to-name-state");
      if (has("Pluto") && pair.some(function (k) { return PERSONAL.indexOf(k) >= 0; }))
        tags.push("depth-engagement", hard ? "control-tension" : "depth-pull");
      if (has("Moon") && has("Mercury")) tags.push("feeling-to-words");
      if (has("Mars") && has("Saturn")) tags.push(hard ? "effort-friction" : "sustained-effort");
      if (has("Jupiter") && pair.some(function (k) { return PERSONAL.indexOf(k) >= 0; }))
        tags.push("horizon-pull");
      if (!tags.length) return;
      if (tight) tags.push("tight-contact");
      out.push(sig("aspect", pair, tags,
        a.aKey + " " + a.type + " " + a.bKey + " (orb " + a.orb.toFixed(1) + ")",
        tight ? 1.4 : 1));
    });

    /* —— 1c. 元素 / 三方四正的整体倾斜 —— */
    var eCount = { fire: 0, earth: 0, air: 0, water: 0 };
    var mCount = { cardinal: 0, fixed: 0, mutable: 0 };
    natal.planets.forEach(function (p) {
      eCount[elementOf(p.signIdx)]++; mCount[modeOf(p.signIdx)]++;
    });
    Object.keys(eCount).forEach(function (e) {
      if (eCount[e] >= 4) {
        var t = { water: ["absorb-first", "solitude-need"], air: ["articulation-need", "distance-to-think"],
                  earth: ["needs-concrete", "slow-to-commit"], fire: ["momentum-need", "self-forward"] }[e];
        out.push(sig("element-balance", ["elem-" + e], t.concat(["balance-signal"]),
          e + " emphasis (" + eCount[e] + "/10)", 1.1));
      }
      if (eCount[e] <= 1)
        out.push(sig("element-lack", ["elem-" + e], ["lacking-" + e, "balance-signal"],
          e + " scarce (" + eCount[e] + "/10)", 0.9));
    });
    Object.keys(mCount).forEach(function (m) {
      if (mCount[m] >= 5) {
        var t = { fixed: ["hard-to-switch", "sustained-effort"], cardinal: ["initiation-pull", "momentum-need"],
                  mutable: ["adapt-first", "hard-to-settle"] }[m];
        out.push(sig("mode-balance", ["mode-" + m], t.concat(["balance-signal"]),
          m + " emphasis (" + mCount[m] + "/10)", 1.1));
      }
    });

    /* —— 1d. 星群:同宫 3 颗以上 —— */
    var byHouse = {};
    natal.planets.forEach(function (p) { (byHouse[p.house] = byHouse[p.house] || []).push(p.key); });
    Object.keys(byHouse).forEach(function (h) {
      if (byHouse[h].length < 3) return;
      out.push(sig("stellium", ["H" + h].concat(byHouse[h]), ["concentration", "house-" + h + "-emphasis"],
        "stellium in house " + h + ": " + byHouse[h].join(","), 1.5));
    });

    /* —— 1e. 逆行的个人行星:先在里面走一遍才出来 —— */
    var retro = natal.planets.filter(function (p) { return p.retro && PERSONAL.indexOf(p.key) >= 0; });
    if (retro.length)
      out.push(sig("retrograde-personal", retro.map(function (p) { return p.key; }),
        ["internal-first", "delayed-output"], "retrograde: " + retro.map(function (p) { return p.key; }).join(","), 1.1));

    /* —— 1f. 北交点所在宫:发展方向的拉力 —— */
    if (extras.NNode && extras.NNode.house)
      out.push(sig("node-house", ["NNode", "H" + extras.NNode.house],
        ["developmental-pull", "house-" + extras.NNode.house + "-emphasis"],
        "north node in house " + extras.NNode.house, 1.2));

    /* —— 1g. 日夜盘 —— */
    if (typeof natal.isDay === "boolean")
      out.push(sig("sect", [natal.isDay ? "day" : "night"],
        natal.isDay ? ["outward-reference"] : ["inward-reference"],
        natal.isDay ? "day chart" : "night chart", 0.8));

    return out;
  }

  /* ──────────────────────────────────────────────────────────
     2. 模式规则
     ------------------------------------------------------------
     每条规则要求「至少两组不同的 tag 家族」都出现 ——
     单一落点永远凑不满,这是硬规则(任务书第 6 节)。
     mechanism 是内部工作语言,必须写出「机制」而不是「特质」,
     没有 mechanism 的规则会被通用性检查挡下来。
     ────────────────────────────────────────────────────────── */
  var PATTERN_RULES = [
    { patternKey: "clarity-before-release", domain: "uncertainty-response",
      compass: { primary: "drains", secondary: "processing-style" },
      mechanismFamily: "withholding-until-certain",
      mechanism: "unresolved input stays mentally active until enough certainty is reached; output is postponed rather than dropped",
      needs: [["self-monitoring", "delayed-permission", "pressure-contact"],
              ["internal-first", "delayed-output", "absorb-first", "withdrawn-processing"]] },

    { patternKey: "solitude-then-contact", domain: "recovery",
      compass: { primary: "grounds", secondary: "relational-response" },
      mechanismFamily: "withdraw-to-reset",
      mechanism: "regulation happens by reducing input first; contact becomes wanted again only after internal sorting is done",
      needs: [["solitude-need", "withdrawn-processing", "private-base"],
              ["absorb-first", "inward-reference", "regulation-site"]] },

    { patternKey: "naming-to-settle", domain: "processing-style",
      compass: { primary: "grounds", secondary: "expression" },
      mechanismFamily: "articulation-as-regulation",
      mechanism: "a state stays diffuse until it is put into words; once named it stops occupying background attention",
      needs: [["feeling-to-words", "articulation-need", "processing-site"],
              ["distance-to-think", "hard-to-name-state", "diffuse-processing"]] },

    { patternKey: "carry-before-noticing-cost", domain: "over-responsibility",
      compass: { primary: "drains", secondary: "internal-pressure" },
      mechanismFamily: "load-taken-by-default",
      mechanism: "responsibility is absorbed automatically; the cost registers only after the task period ends",
      needs: [["pressure-source", "pressure-contact", "visible-responsibility", "duty-load"],
              ["sustained-effort", "hard-to-switch", "effort-friction"]] },

    { patternKey: "meaning-gates-effort", domain: "motivation",
      compass: { primary: "moves", secondary: "meaningful-engagement" },
      mechanismFamily: "meaning-conditional-energy",
      mechanism: "energy is not allocated by importance but by whether the work still reads as meaningful; repetitive prescribed work drains fastest",
      needs: [["meaning-search", "horizon-pull", "expansion-site"],
              ["momentum-need", "initiation-pull", "making-impulse", "agency-site"]] },

    { patternKey: "autonomy-or-stall", domain: "autonomy",
      compass: { primary: "moves", secondary: "calls" },
      mechanismFamily: "self-set-conditions",
      mechanism: "motivation drops when the shape of the day is externally prescribed, independent of how agreeable the content is",
      needs: [["autonomy-need", "variety-pull", "disruption-sensitivity"],
              ["momentum-need", "initiation-pull", "hard-to-settle"]] },

    { patternKey: "depth-or-disengage", domain: "meaningful-engagement",
      compass: { primary: "calls", secondary: "moves" },
      mechanismFamily: "depth-threshold",
      mechanism: "surface-level involvement does not hold attention; engagement starts only when permitted to go past the first layer",
      needs: [["depth-engagement", "depth-pull", "control-tension"],
              ["meaning-search", "horizon-pull", "concentration"]] },

    { patternKey: "stability-before-movement", domain: "security",
      compass: { primary: "grounds", secondary: "decision-pattern" },
      mechanismFamily: "ground-then-move",
      mechanism: "concrete footing is required before commitment; ambiguity is tolerated far less than difficulty",
      needs: [["needs-concrete", "slow-to-commit", "private-base"],
              ["security-inward", "regulation-site", "routine-bound"]] },

    /* 刻意放进来的反例:没有 mechanism、只讲特质 —— 用来验证通用性检查真的会挡 */
    { patternKey: "values-security", domain: "security",
      compass: { primary: "grounds" },
      mechanismFamily: "generic-trait",
      mechanism: null,
      generic: true,
      needs: [["security-inward", "private-base", "needs-concrete"]] }
  ];

  /* 互相对立的机制家族 —— 两边都强时保留成 tension,不是二选一 */
  var TENSION_PAIRS = [
    ["withdraw-to-reset", "articulation-as-regulation"],
    ["self-set-conditions", "load-taken-by-default"],
    ["ground-then-move", "self-set-conditions"],
    ["withholding-until-certain", "articulation-as-regulation"]
  ];

  /* ──────────────────────────────────────────────────────────
     3. 主题 / 生命脉络的比对(只做关键词,不做语意模型)
     ------------------------------------------------------------
     ⚠ 这两者永远不进 independentEvidenceCount。
     ────────────────────────────────────────────────────────── */
  var PATTERN_HINTS = {
    "clarity-before-release": ["想清楚", "确定", "谨慎", "说出来", "带出来", "犹豫", "反覆"],
    "solitude-then-contact": ["一个人", "独处", "安静", "消化", "沉淀", "空间"],
    "naming-to-settle": ["说出", "表达", "语言", "讲清楚", "写下"],
    "carry-before-noticing-cost": ["承担", "责任", "撑", "扛", "别人", "累"],
    "meaning-gates-effort": ["意义", "值得", "投入", "燃", "在乎"],
    "autonomy-or-stall": ["自由", "自己决定", "被安排", "掌控", "空间"],
    "depth-or-disengage": ["深", "表面", "穿透", "真正"],
    "stability-before-movement": ["安全感", "稳", "确定", "踏实", "基础"],
    "values-security": ["安全感", "稳"]
  };

  function textOfThemes(themes) {
    var rows = [];
    Object.keys(themes || {}).forEach(function (tid) {
      var t = themes[tid]; if (!t) return;
      var bits = [];
      if (t.tagline) bits.push(t.tagline);
      (t.aha || []).forEach(function (x) { bits.push(x); });
      if (bits.length) rows.push({ tid: tid, text: bits.join(" ") });
    });
    return rows;
  }
  function textOfThread(thread) {
    if (!thread) return "";
    var bits = [];
    if (thread.tagline) bits.push(thread.tagline);
    (thread.aha || []).forEach(function (x) { bits.push(x); });
    var pv = thread.previews && thread.previews.map;
    if (pv) Object.keys(pv).forEach(function (k) {
      if (pv[k] && pv[k].preview) bits.push(pv[k].preview);
      (pv[k] && pv[k].keyInsights || []).forEach(function (x) { bits.push(x); });
    });
    return bits.join(" ");
  }
  function hits(text, words) {
    var n = 0; (words || []).forEach(function (w) { if (text.indexOf(w) >= 0) n++; });
    return n;
  }

  /* ──────────────────────────────────────────────────────────
     4. 主流程
     ────────────────────────────────────────────────────────── */
  function build(input) {
    input = input || {};
    var ev = input.evidence || {};
    var ctx = input.context || {};
    var natal = ev.chart || null;
    var themes = ev.themes || {};
    var thread = ctx.lifeThreads || null;

    var signals = extractChartSignals(natal);
    var themeRows = textOfThemes(themes);
    var threadText = textOfThread(thread);

    var candidates = PATTERN_RULES.map(function (rule) {
      return evaluate(rule, signals, themeRows, threadText);
    });

    // 重複 / 多样性:同一个机制家族只留最强的那一个
    markDuplicates(candidates);
    // 对立张力
    var tensions = detectTensions(candidates);
    // 最终分类
    candidates.forEach(function (c) { classify(c); });

    return {
      generatedAt: new Date().toISOString(),
      inputRoles: {
        chart: "primary-evidence",
        themes: "secondary-interpretation-evidence",
        lifeThreads: "synthesis-context-only"
      },
      signalCount: signals.length,
      signals: signals,
      candidates: candidates,
      tensions: tensions,
      byDirection: groupByDirection(candidates),
      excludedSources: ["favorites", "journal", "mood", "reflectionAnswers"]
    };
  }

  function evaluate(rule, signals, themeRows, threadText) {
    /* 4a. 收集符合的盘面讯号,一组 needs 至少要命中一个 */
    var matched = [], groupsHit = 0;
    rule.needs.forEach(function (group) {
      var found = signals.filter(function (s) {
        return s.tags.some(function (t) { return group.indexOf(t) >= 0; });
      });
      if (found.length) groupsHit++;
      found.forEach(function (s) { if (matched.indexOf(s) < 0) matched.push(s); });
    });

    /* 4b. 独立性:用 independenceKey 去重 —— 同一个结构讲几次都只算一次 */
    var keys = {}, actors = {};
    matched.forEach(function (s) {
      keys[s.independenceKey] = true;
      s.actors.forEach(function (a) { actors[a] = true; });
    });
    var independentCount = Object.keys(keys).length;
    var actorCount = Object.keys(actors).length;

    /* 4c. 主题支持:记来源,但永远不加进 independentCount */
    var themeSupport = [];
    themeRows.forEach(function (row) {
      var n = hits(row.text, PATTERN_HINTS[rule.patternKey]);
      if (n >= 2) themeSupport.push({
        sourceType: "theme", sourceId: "topics." + row.tid, rawSignal: row.text.slice(0, 60),
        role: "supporting", independence: "independent-interpretation",
        countsTowardIndependentEvidence: false, hitCount: n
      });
    });

    /* 4d. 生命脉络:只当脉络。审计已确认它读过 blueprint + topics,
           所以它永远不增加任何计数,并且在这里明写 circularityBlocked。 */
    var threadHit = hits(threadText, PATTERN_HINTS[rule.patternKey]);
    var threadSupport = threadHit >= 2 ? {
      sourceType: "lifeThread", sourceId: "lifemap", rawSignal: "matched " + threadHit + " hint(s)",
      role: "contextual", independence: "contextual-only",
      countsTowardIndependentEvidence: false,
      circularityBlocked: themeSupport.length > 0,
      note: themeSupport.length > 0
        ? "themes already carry this pattern; life threads is derived from themes, so it adds no evidence"
        : "life threads alone cannot establish a pattern"
    } : null;

    var c = {
      id: "cand:" + rule.patternKey,
      patternKey: rule.patternKey,
      domain: rule.domain,
      mechanismFamily: rule.mechanismFamily,
      summary: rule.mechanism || ("(no mechanism stated) " + rule.domain),
      mechanism: rule.mechanism || null,
      sourceSignals: matched.map(function (s) {
        return {
          sourceType: "chart", sourceId: s.id, rawSignal: s.detail,
          role: "primary", independence: "independent",
          countsTowardIndependentEvidence: true,
          independenceKey: s.independenceKey,
          relevance: s.weight,
          relatedDirection: rule.compass.primary
        };
      }).concat(themeSupport).concat(threadSupport ? [threadSupport] : []),
      evidenceCount: matched.length + themeSupport.length + (threadSupport ? 1 : 0),
      independentEvidenceCount: independentCount,
      distinctActorCount: actorCount,
      needGroupsHit: groupsHit,
      needGroupsTotal: rule.needs.length,
      supportingSources: themeSupport.map(function (t) { return t.sourceId; }),
      contextualSources: threadSupport ? [threadSupport.sourceId] : [],
      contradictionSignals: [],
      compassRelevance: { primary: rule.compass.primary, secondary: rule.compass.secondary || null },
      generic: !!rule.generic || !rule.mechanism,
      duplicateOf: null,
      strength: 0,
      status: "provisional",
      rejectionReason: null
    };
    c.strength = score(c, rule);
    return c;
  }

  /* 4e. 强度:概念阶段的简单规则,分数不给使用者看 */
  function score(c, rule) {
    var s = 0;
    if (c.independentEvidenceCount >= 2) s += 3;          // 重複出现的独立盘面证据
    if (c.needGroupsHit >= c.needGroupsTotal) s += 2;      // 结构上真的对得起来
    if (DIRECTION_DOMAINS[c.compassRelevance.primary] &&
        DIRECTION_DOMAINS[c.compassRelevance.primary].indexOf(c.domain) >= 0) s += 2;  // 方向相关
    if (c.supportingSources.length >= 1) s += 2;          // 主题支持
    if (c.supportingSources.length >= 2) s += 1;          // 跨多个相关主题重複
    if (c.contextualSources.length) s += 1;               // 生命脉络只给这 1 分,且不进独立计数
    if (c.independentEvidenceCount <= 1) s -= 3;          // 单一孤立落点
    if (c.generic) s -= 3;                                // 通用诠释
    if (c.distinctActorCount <= 2 && c.independentEvidenceCount >= 2) s -= 1; // 同一组物件换讲法
    return s;
  }

  /* 4f. 重複:同一个机制家族只留最强的 */
  function markDuplicates(cands) {
    var best = {};
    cands.forEach(function (c) {
      var f = c.mechanismFamily;
      if (!best[f] || c.strength > best[f].strength) best[f] = c;
    });
    cands.forEach(function (c) {
      var b = best[c.mechanismFamily];
      if (b && b !== c) c.duplicateOf = b.patternKey;
    });
  }

  /* 4g. 对立张力:两边都够强 → 保留成 tension,不砍掉任何一边 */
  function detectTensions(cands) {
    var byFam = {};
    cands.forEach(function (c) { if (!byFam[c.mechanismFamily] || c.strength > byFam[c.mechanismFamily].strength) byFam[c.mechanismFamily] = c; });
    var out = [];
    TENSION_PAIRS.forEach(function (pair) {
      var a = byFam[pair[0]], b = byFam[pair[1]];
      if (!a || !b) return;
      var bothStrong = a.strength >= 5 && b.strength >= 5;
      if (!bothStrong && a.strength < 5 && b.strength < 5) return;
      var rec = {
        patternA: a.patternKey, patternB: b.patternKey,
        familyA: pair[0], familyB: pair[1],
        strengthA: a.strength, strengthB: b.strength,
        bothStrong: bothStrong,
        compatibleAsTension: bothStrong,
        resolution: bothStrong ? "keep-as-tension" : "keep-stronger-only"
      };
      out.push(rec);
      if (bothStrong) {
        a.contradictionSignals.push(rec);
        b.contradictionSignals.push(rec);
      }
    });
    return out;
  }

  /* 4h. 最终分类。顺序很重要:先挡死规则,再看强度 */
  function classify(c) {
    if (c.generic) {
      c.status = "rejected";
      c.rejectionReason = "too-generic-no-mechanism";
      return;
    }
    if (c.independentEvidenceCount === 0) {
      c.status = "rejected";
      c.rejectionReason = c.contextualSources.length
        ? "derived-entirely-from-life-threads"
        : "no-chart-evidence";
      return;
    }
    if (c.independentEvidenceCount < 2) {
      c.status = "rejected";
      c.rejectionReason = "isolated-placement-only";
      return;
    }
    if (c.needGroupsHit < c.needGroupsTotal) {
      c.status = "provisional";
      c.rejectionReason = null;
      return;
    }
    if (c.duplicateOf) {
      c.status = "rejected";
      c.rejectionReason = "duplicate-of-stronger-pattern:" + c.duplicateOf;
      return;
    }
    if (c.strength >= 7) { c.status = "accepted"; return; }
    c.status = "provisional";
  }

  function groupByDirection(cands) {
    var out = {};
    DIRECTIONS.forEach(function (d) {
      out[d] = cands.filter(function (c) {
        return c.compassRelevance.primary === d && c.status === "accepted";
      }).sort(function (a, b) { return b.strength - a.strength; })
        .map(function (c) { return { patternKey: c.patternKey, strength: c.strength, family: c.mechanismFamily }; });
    });
    return out;
  }

  /* 多样性:四个方向的首选如果落在同一个机制家族,标出来 */
  function diversityCheck(report) {
    var picked = {}, clashes = [];
    DIRECTIONS.forEach(function (d) {
      var top = (report.byDirection[d] || [])[0];
      if (!top) return;
      if (picked[top.family]) clashes.push({ family: top.family, directions: [picked[top.family], d] });
      else picked[top.family] = d;
    });
    return { ok: clashes.length === 0, clashes: clashes, pickedFamilies: Object.keys(picked) };
  }

  return {
    DOMAINS: DOMAINS,
    DIRECTIONS: DIRECTIONS,
    DIRECTION_DOMAINS: DIRECTION_DOMAINS,
    PATTERN_RULES: PATTERN_RULES,
    extractChartSignals: extractChartSignals,
    build: build,
    diversityCheck: diversityCheck
  };
});
