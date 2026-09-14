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
  /* ⚠ Phase 3.5 修正:这张表是 Phase 2 只有 9 条规则时写的。
     规则表扩到 27 条之后,有 8 个 domain 从来没有被加进任何方向
     (trust / self-expectation / stimulation / boundaries / intimacy /
      relational-response / recognition / decision-pattern),
     另有 3 个只列在与规则宣告不同的方向下。
     后果:27 条里有 11 条不管证据多好,都永远拿不到「方向相关」那 2 分,
     被结构性地压在门槛下 —— 那是记账漏洞,不是机制判断。
     实例:closeness-needs-room 的证据(5 个独立结构 / 7 个物件)比
     solitude-then-contact(4 / 6)更厚,分数却低 2 分、卡在 provisional。

     这里把表补齐:每一个 domain 都列在它真正服务的方向下,
     需要时跨列(一个 domain 可以同时服务两个方向)。
     ⚠ 没有动 accepted 门槛(仍是 7),也没有动任何规则的 needs 或 minIndependent。 */
  var DIRECTION_DOMAINS = {
    grounds: ["emotional-regulation", "security", "recovery", "processing-style",
              "belonging", "rest", "boundaries", "trust", "decision-pattern"],
    moves:   ["motivation", "agency", "meaningful-engagement", "creation",
              "sense-of-meaning", "expression", "autonomy", "stimulation"],
    drains:  ["internal-pressure", "over-responsibility", "avoidance",
              "suppression", "repeated-tension", "uncertainty-response",
              "self-expectation", "expression", "trust", "relational-response",
              "recognition", "decision-pattern"],
    calls:   ["curiosity", "growth-direction", "developmental-pull", "autonomy",
              "sense-of-meaning", "creation", "meaningful-engagement",
              "stimulation", "intimacy"]
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

  /* 一个讯号的「结构锚点」= 产生这个讯号的那一个结构事实。
     同一个锚点底下的讯号,彼此不算互相独立。 */
  function anchorOf(s) {
    var house = s.actors.filter(function (a) { return /^H\d+$/.test(a); })[0];
    switch (s.structure) {
      case "planet-house":
      case "stellium":      return "house:" + house;
      case "aspect":        return "aspect:" + s.actors.slice().sort().join("+");
      case "angular":       return "axis:" + s.actors.filter(function (a) {
                              return ["ASC", "DSC", "MC", "IC"].indexOf(a) >= 0; }).join("");
      case "element-balance":
      case "element-lack":
      case "mode-balance":  return "stat:" + s.actors[0];
      case "retrograde-personal": return "retrograde";
      case "node-house":    return "node";
      case "sect":          return "sect";
      default:              return s.structure + ":" + s.actors.join("+");
    }
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
      if (h === 8)  tags.push("depth-engagement", "guarded-disclosure", "trust-gated", "control-stake");
      if (h === 6)  tags.push("duty-load", "routine-bound");
      if (h === 10) tags.push("visible-responsibility", "visibility-exposure", "recognition-stake");
      if (h === 9)  tags.push("horizon-pull", "meaning-search");
      if (h === 11) tags.push("collective-pull", "belonging-search");
      if (h === 2)  tags.push("worth-anchor", "material-ground");
      if (h === 7)  tags.push("relational-mirror", "pacing-with-others");
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
      if (has("Moon") && has("Saturn"))
        tags.push("self-expectation", hard ? "comfort-restraint" : "steady-holding");
      if (has("Sun") && has("Saturn"))
        tags.push("achievement-pressure", hard ? "never-quite-enough" : "earned-confidence");
      if (has("Mercury") && has("Saturn")) tags.push("verify-before-speaking", "careful-output");
      if (has("Venus") && has("Saturn")) tags.push("measured-closeness", "slow-warmth");
      if (has("Venus") && has("Uranus")) tags.push("space-in-closeness", "novelty-pull");
      if (has("Venus") && has("Neptune")) tags.push("boundary-blur", "idealise-then-adjust");
      if (has("Mars") && has("Neptune")) tags.push("diffuse-drive", "effort-fog");
      if (has("Mars") && has("Pluto")) tags.push("control-stake", "all-or-nothing-effort");
      if (has("Jupiter") && has("Saturn")) tags.push("expand-vs-limit");
      if (has("Mercury") && has("Uranus")) tags.push("fast-switching", "novelty-pull");
      if (has("Mars") && has("Saturn")) tags.push(hard ? "effort-friction" : "sustained-effort");
      if (has("Jupiter") && pair.some(function (k) { return PERSONAL.indexOf(k) >= 0; }))
        tags.push("horizon-pull");
      if (!tags.length) return;
      if (tight) tags.push("tight-contact");
      out.push(sig("aspect", pair, tags,
        a.aKey + " " + a.type + " " + a.bKey + " (orb " + a.orb.toFixed(1) + ")",
        tight ? 1.4 : 1));
    });

    /* —— 1b2. 合轴:行星贴着四轴,是结构上的「显著位置」 —— */
    var ANG = { ASC: "self-forward", MC: "visibility-exposure", DSC: "pacing-with-others", IC: "private-base" };
    Object.keys(ANG).forEach(function (ax) {
      var a = extras[ax]; if (!a) return;
      natal.planets.forEach(function (p) {
        var d = Math.abs(((p.lon - a.lon + 540) % 360) - 180);
        d = 180 - d;
        if (d > 8) return;
        var tags = ["angular-emphasis", ANG[ax]];
        if (p.key === "Saturn") tags.push("pressure-source");
        if (p.key === "Moon") tags.push("regulation-site");
        if (p.key === "Uranus") tags.push("autonomy-need");
        out.push(sig("angular", [p.key, ax], tags,
          p.key + " conjunct " + ax + " (" + d.toFixed(1) + "°)", 1.3));
      });
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
     2. 规则表 —— 按「人类机制」分类,不是按行星 / 宫位堆
     ------------------------------------------------------------
     七个机制家族(taxonomy):
       REGULATION  回到基线的方式
       PROCESSING  输入怎么变成可用的东西
       LOAD        接下了什么、代价什么时候出现
       DRIVE       什么启动并维持移动
       DIRECTION   什么在往前拉
       RELATION    远近怎么协商
       DECISION    怎么承诺

     每一条规则的形状:
       needs        必要证据形状。**至少两组**,每组至少命中一个讯号 ——
                    单一落点在结构上就凑不满,这是硬规则。
       disqualifiers 出现这些讯号时,这条规则会被扣分甚至失格
       partners     对立的机制家族(可能构成张力,而不是二选一)
       genericRisk  通用化风险:high 的规则要求更多独立证据
       minIndependent 最低独立盘面证据数(预设 2,高风险的要 3)

     ⚠ 规则不是「某个落点 = 某种性格」,
       而是「多个独立结构同时出现时,可能支持某种生活机制」。
     ────────────────────────────────────────────────────────── */
  var PATTERN_RULES = [

    /* ═══ REGULATION · 回到基线的方式 ═══ */
    { patternKey: "solitude-then-contact", family: "REGULATION", domain: "recovery",
      compass: { primary: "grounds", secondary: "relational-response" },
      mechanismFamily: "withdraw-to-reset", genericRisk: "medium",
      mechanism: "regulation happens by reducing input first; contact becomes wanted again only after internal sorting is done",
      needs: [["solitude-need", "withdrawn-processing", "private-base"],
              ["absorb-first", "inward-reference", "regulation-site"]],
      partners: ["articulation-as-regulation"] },

    { patternKey: "naming-to-settle", family: "REGULATION", domain: "processing-style",
      compass: { primary: "grounds", secondary: "expression" },
      mechanismFamily: "articulation-as-regulation", genericRisk: "medium",
      mechanism: "a state stays diffuse until it is put into words; once named it stops occupying background attention",
      needs: [["feeling-to-words", "articulation-need", "processing-site"],
              ["distance-to-think", "hard-to-name-state", "diffuse-processing"]],
      partners: ["withdraw-to-reset"] },

    { patternKey: "rest-needs-permission", family: "REGULATION", domain: "rest",
      compass: { primary: "grounds", secondary: "internal-pressure" },
      mechanismFamily: "rest-as-earned", genericRisk: "medium",
      mechanism: "rest is treated as something to be earned rather than scheduled; stopping happens only once the work is defensible",
      needs: [["self-expectation", "comfort-restraint", "never-quite-enough"],
              ["duty-load", "routine-bound", "sustained-effort"]],
      disqualifiers: ["momentum-need"],
      partners: ["load-taken-by-default"] },

    { patternKey: "belonging-on-own-terms", family: "REGULATION", domain: "belonging",
      compass: { primary: "grounds", secondary: "autonomy" },
      mechanismFamily: "conditional-belonging", genericRisk: "high", minIndependent: 3,
      mechanism: "group settings are wanted but only tolerable with an exit; belonging holds when participation stays self-defined",
      needs: [["collective-pull", "belonging-search"],
              ["autonomy-need", "space-in-closeness", "solitude-need"]],
      partners: ["self-set-conditions"] },

    /* ═══ PROCESSING · 输入怎么变成可用的东西 ═══ */
    { patternKey: "clarity-before-release", family: "PROCESSING", domain: "uncertainty-response",
      compass: { primary: "drains", secondary: "processing-style" },
      mechanismFamily: "withholding-until-certain", genericRisk: "medium",
      mechanism: "unresolved input stays mentally active until enough certainty is reached; output is postponed rather than dropped",
      needs: [["self-monitoring", "delayed-permission", "pressure-contact", "verify-before-speaking"],
              ["internal-first", "delayed-output", "absorb-first", "withdrawn-processing"]],
      partners: ["articulation-as-regulation"] },

    { patternKey: "checked-before-spoken", family: "PROCESSING", domain: "expression",
      compass: { primary: "drains", secondary: "expression" },
      mechanismFamily: "output-pre-audited", genericRisk: "medium",
      mechanism: "wording is audited before it leaves; the pause is not hesitation about content but about how it will land",
      needs: [["verify-before-speaking", "careful-output"],
              ["articulation-need", "processing-site", "feeling-to-words"]],
      partners: ["articulation-as-regulation"] },

    { patternKey: "open-loop-stays-loud", family: "PROCESSING", domain: "uncertainty-response",
      compass: { primary: "drains", secondary: "decision-pattern" },
      mechanismFamily: "unclosed-loop-cost", genericRisk: "medium",
      mechanism: "an unfinished conversation or undecided matter keeps running in the background and costs more than the outcome itself",
      needs: [["hard-to-switch", "sustained-effort", "control-stake"],
              ["hard-to-name-state", "diffuse-processing", "guarded-disclosure"]],
      partners: ["adaptive-drift"] },

    { patternKey: "trust-opens-slowly", family: "PROCESSING", domain: "trust",
      compass: { primary: "drains", secondary: "relational-response" },
      mechanismFamily: "graded-disclosure", genericRisk: "medium",
      mechanism: "disclosure is released in stages; each stage is checked before the next, so closeness lags behind actual feeling",
      needs: [["trust-gated", "guarded-disclosure", "depth-engagement"],
              ["measured-closeness", "slow-warmth", "delayed-permission"]],
      partners: ["depth-threshold"] },

    /* ═══ LOAD · 接下了什么、代价什么时候出现 ═══ */
    { patternKey: "carry-before-noticing-cost", family: "LOAD", domain: "over-responsibility",
      compass: { primary: "drains", secondary: "internal-pressure" },
      mechanismFamily: "load-taken-by-default", genericRisk: "low",
      mechanism: "responsibility is absorbed automatically; the cost registers only after the task period ends",
      needs: [["pressure-source", "pressure-contact", "visible-responsibility", "duty-load"],
              ["sustained-effort", "hard-to-switch", "effort-friction"]],
      partners: ["self-set-conditions"] },

    { patternKey: "standard-set-internally", family: "LOAD", domain: "self-expectation",
      compass: { primary: "drains", secondary: "internal-pressure" },
      mechanismFamily: "internal-bar", genericRisk: "medium",
      mechanism: "the bar being met is the one set internally, not the one others asked for; meeting the external ask does not end the effort",
      needs: [["self-expectation", "never-quite-enough", "achievement-pressure"],
              ["self-monitoring", "careful-output", "delayed-permission"]],
      partners: ["meaning-conditional-energy"] },

    { patternKey: "visible-means-exposed", family: "LOAD", domain: "internal-pressure",
      compass: { primary: "drains", secondary: "recognition" },
      mechanismFamily: "visibility-cost", genericRisk: "high", minIndependent: 3,
      mechanism: "being seen raises the stake rather than the reward; visibility is managed carefully instead of enjoyed",
      needs: [["visibility-exposure", "recognition-stake", "angular-emphasis"],
              ["pressure-source", "self-monitoring", "guarded-disclosure"]],
      partners: ["making-for-its-own-sake"] },

    { patternKey: "hold-it-in-until-it-passes", family: "LOAD", domain: "suppression",
      compass: { primary: "drains", secondary: "emotional-regulation" },
      mechanismFamily: "contain-then-release", genericRisk: "medium",
      mechanism: "a reaction is held while it matters and surfaces later in a smaller unrelated moment",
      needs: [["comfort-restraint", "guarded-disclosure", "delayed-output"],
              ["absorb-first", "regulation-site", "hard-to-name-state"]],
      partners: ["articulation-as-regulation"] },

    { patternKey: "effort-without-traction", family: "LOAD", domain: "repeated-tension",
      compass: { primary: "drains", secondary: "agency" },
      mechanismFamily: "friction-in-effort", genericRisk: "medium",
      mechanism: "effort is available but does not convert cleanly into movement; the gap between trying and progress is where energy goes",
      needs: [["effort-friction", "diffuse-drive", "effort-fog"],
              ["agency-site", "sustained-effort", "all-or-nothing-effort"]],
      partners: ["momentum-from-starting"] },

    /* ═══ DRIVE · 什么启动并维持移动 ═══ */
    { patternKey: "meaning-gates-effort", family: "DRIVE", domain: "motivation",
      compass: { primary: "moves", secondary: "meaningful-engagement" },
      mechanismFamily: "meaning-conditional-energy", genericRisk: "low",
      mechanism: "energy is not allocated by importance but by whether the work still reads as meaningful; repetitive prescribed work drains fastest",
      needs: [["meaning-search", "horizon-pull", "expansion-site"],
              ["momentum-need", "initiation-pull", "making-impulse", "agency-site"]],
      partners: ["load-taken-by-default"] },

    { patternKey: "autonomy-or-stall", family: "DRIVE", domain: "autonomy",
      compass: { primary: "moves", secondary: "calls" },
      mechanismFamily: "self-set-conditions", genericRisk: "low",
      mechanism: "motivation drops when the shape of the day is externally prescribed, independent of how agreeable the content is",
      needs: [["autonomy-need", "variety-pull", "disruption-sensitivity"],
              ["momentum-need", "initiation-pull", "hard-to-settle"]],
      partners: ["load-taken-by-default"] },

    { patternKey: "making-restores-agency", family: "DRIVE", domain: "creation",
      compass: { primary: "moves", secondary: "creation" },
      mechanismFamily: "making-for-its-own-sake", genericRisk: "medium",
      mechanism: "producing something concrete restores a sense of agency faster than resolving the thing that removed it",
      needs: [["making-impulse", "agency-site", "self-forward"],
              ["momentum-need", "initiation-pull", "novelty-pull"]],
      partners: ["visibility-cost"] },

    { patternKey: "starting-is-the-hard-part", family: "DRIVE", domain: "agency",
      compass: { primary: "moves", secondary: "decision-pattern" },
      mechanismFamily: "momentum-from-starting", genericRisk: "medium",
      mechanism: "the cost sits at the threshold rather than in the work; once begun, continuing is comparatively easy",
      needs: [["hard-to-switch", "sustained-effort", "slow-to-commit"],
              ["momentum-need", "agency-site", "initiation-pull"]],
      partners: ["adaptive-drift"] },

    /* ═══ DIRECTION · 什么在往前拉 ═══ */
    { patternKey: "depth-or-disengage", family: "DIRECTION", domain: "meaningful-engagement",
      compass: { primary: "calls", secondary: "moves" },
      mechanismFamily: "depth-threshold", genericRisk: "medium",
      mechanism: "surface-level involvement does not hold attention; engagement starts only when permitted to go past the first layer",
      needs: [["depth-engagement", "depth-pull", "control-tension", "trust-gated"],
              ["meaning-search", "horizon-pull", "concentration"]],
      partners: ["novelty-over-repetition"] },

    { patternKey: "wider-frame-pull", family: "DIRECTION", domain: "curiosity",
      compass: { primary: "calls", secondary: "sense-of-meaning" },
      mechanismFamily: "horizon-expansion", genericRisk: "medium",
      mechanism: "interest reliably moves toward the larger frame around a subject rather than the subject itself",
      needs: [["horizon-pull", "meaning-search", "expansion-site"],
              ["articulation-need", "processing-site", "novelty-pull", "developmental-pull"]],
      partners: ["ground-then-move"] },

    { patternKey: "novelty-over-repetition", family: "DIRECTION", domain: "stimulation",
      compass: { primary: "calls", secondary: "moves" },
      mechanismFamily: "novelty-over-repetition", genericRisk: "medium",
      mechanism: "repetition erodes attention faster than difficulty does; a changed angle restores it more reliably than rest",
      needs: [["novelty-pull", "variety-pull", "fast-switching", "autonomy-need"],
              ["hard-to-settle", "adapt-first", "making-impulse", "disruption-sensitivity"]],
      partners: ["depth-threshold"] },

    { patternKey: "growth-through-articulating", family: "DIRECTION", domain: "developmental-pull",
      compass: { primary: "calls", secondary: "expression" },
      mechanismFamily: "development-via-output", genericRisk: "medium",
      mechanism: "the developmental pull is toward putting inner material outside, where it can be tested rather than only held",
      needs: [["developmental-pull", "articulation-need"],
              ["internal-first", "delayed-output", "withdrawn-processing", "absorb-first"]],
      partners: ["withdraw-to-reset"] },

    /* ═══ RELATION · 远近怎么协商 ═══ */
    { patternKey: "closeness-needs-room", family: "RELATION", domain: "boundaries",
      compass: { primary: "grounds", secondary: "relational-response" },
      mechanismFamily: "space-inside-closeness", genericRisk: "medium",
      mechanism: "closeness is sustainable when room to withdraw stays available; the room matters more than how often it is used",
      needs: [["space-in-closeness", "novelty-pull", "autonomy-need"],
              ["relational-mirror", "pacing-with-others", "measured-closeness"]],
      partners: ["conditional-belonging"] },

    { patternKey: "depth-or-nothing-in-closeness", family: "RELATION", domain: "intimacy",
      compass: { primary: "calls", secondary: "relational-response" },
      mechanismFamily: "intimacy-depth-gate", genericRisk: "high", minIndependent: 3,
      mechanism: "casual closeness registers as effort rather than ease; engagement arrives only where real exchange is possible",
      needs: [["depth-engagement", "trust-gated", "guarded-disclosure"],
              ["relational-mirror", "pacing-with-others", "control-stake"]],
      partners: ["space-inside-closeness"] },

    { patternKey: "pace-set-by-the-other", family: "RELATION", domain: "relational-response",
      compass: { primary: "drains", secondary: "boundaries" },
      mechanismFamily: "adaptive-pacing", genericRisk: "high", minIndependent: 3,
      mechanism: "pace is matched to the other person before checking one's own; the mismatch shows up as fatigue rather than as disagreement",
      needs: [["pacing-with-others", "relational-mirror", "boundary-blur"],
              ["adapt-first", "absorb-first", "comfort-restraint"]],
      partners: ["self-set-conditions"] },

    { patternKey: "recognition-wanted-not-sought", family: "RELATION", domain: "recognition",
      compass: { primary: "drains", secondary: "recognition" },
      mechanismFamily: "unasked-recognition", genericRisk: "high", minIndependent: 3,
      mechanism: "acknowledgement matters but asking for it feels disqualifying, so the wanting stays unstated and unmet",
      needs: [["recognition-stake", "visibility-exposure"],
              ["guarded-disclosure", "self-expectation", "delayed-permission"]],
      partners: ["making-for-its-own-sake"] },

    /* ═══ DECISION · 怎么承诺 ═══ */
    { patternKey: "stability-before-movement", family: "DECISION", domain: "security",
      compass: { primary: "grounds", secondary: "decision-pattern" },
      mechanismFamily: "ground-then-move", genericRisk: "medium",
      mechanism: "concrete footing is required before commitment; ambiguity is tolerated far less than difficulty",
      needs: [["needs-concrete", "slow-to-commit", "private-base", "worth-anchor"],
              ["security-inward", "regulation-site", "routine-bound", "material-ground"]],
      partners: ["adaptive-drift"] },

    { patternKey: "decide-then-revisit", family: "DECISION", domain: "decision-pattern",
      compass: { primary: "drains", secondary: "uncertainty-response" },
      mechanismFamily: "post-decision-review", genericRisk: "medium",
      mechanism: "a decision is made on time but stays open for review afterwards; the re-checking costs more than the choice did",
      needs: [["self-monitoring", "hard-to-settle", "adapt-first"],
              ["delayed-permission", "verify-before-speaking", "control-stake"]],
      partners: ["ground-then-move"] },

    /* ═══ 护栏用的反例 —— 刻意不合格,用来证明筛选真的在动 ═══ */
    { patternKey: "values-security", family: "GUARD", domain: "security",
      compass: { primary: "grounds" },
      mechanismFamily: "generic-trait", genericRisk: "high",
      mechanism: null, generic: true,
      needs: [["security-inward", "private-base", "needs-concrete"]] },

    { patternKey: "single-signal-sensitivity", family: "GUARD", domain: "emotional-regulation",
      compass: { primary: "grounds" },
      mechanismFamily: "single-placement-guard", genericRisk: "high",
      mechanism: "placeholder rule that intentionally rests on one structure only, to prove single placements cannot be accepted",
      needs: [["night-chart-only-marker"]] }
  ];

  /* 对立的机制家族:直接从规则的 partners 推出来,不另外手写一张表 ——
     规则改了,张力关系就跟着改,不会有两份说法不一致的东西。 */
  var TENSION_PAIRS = (function () {
    var seen = {}, out = [];
    PATTERN_RULES.forEach(function (r) {
      (r.partners || []).forEach(function (other) {
        var k = [r.mechanismFamily, other].sort().join("~");
        if (seen[k] || r.mechanismFamily === other) return;
        seen[k] = true; out.push(k.split("~"));
      });
    });
    return out;
  })();

  /* ──────────────────────────────────────────────────────────
     2b. Composite pattern —— 白名单,不是「两个都强就自动合并」
     ------------------------------------------------------------
     只有明确宣告过的组合才有资格becomes composite,而且还要通过自己的
     证据验证(见 buildComposites)。宣告里要写清楚行为顺序。
     ────────────────────────────────────────────────────────── */
  var COMPOSITE_RULES = [
    { compositeKey: "regulation-sequence",
      domain: "emotional-regulation",
      childPatterns: ["solitude-then-contact", "naming-to-settle"],
      sequence: ["withdraw", "process", "articulate", "reconnect"],
      primaryCompassDirection: "grounds",
      mechanism: "regulation runs as an ordered sequence rather than a preference: input is reduced first, the state is sorted internally, it is then put into words, and contact becomes wanted again afterwards",
      requires: {
        bothChildrenAtLeast: 7,        // 两边都要够强
        sharedActorsAtLeast: 1,        // 要有共同的盘面物件 → 讲的是同一套系统
        distinctKeysEachAtLeast: 1,    // 各自要有对方没有的证据 → 不是同一件事
        unionMustExceedBest: true      // 合起来的证据必须多于任一边 → 合并真的加了资讯
      } },

    { compositeKey: "output-gate-sequence",
      domain: "expression",
      childPatterns: ["clarity-before-release", "checked-before-spoken"],
      sequence: ["absorb", "verify", "wait-for-certainty", "release"],
      primaryCompassDirection: "drains",
      mechanism: "output passes two gates in order: it waits for internal certainty, then it waits for the wording to be safe; the delay is cumulative rather than from a single cause",
      requires: { bothChildrenAtLeast: 7, sharedActorsAtLeast: 1,
                  distinctKeysEachAtLeast: 1, unionMustExceedBest: true } }
  ];
  /* ──────────────────────────────────────────────────────────
     3. 主题 / 生命脉络的比对(只做关键词,不做语意模型)
     ------------------------------------------------------------
     ⚠ 这两者永远不进 independentEvidenceCount。
     ────────────────────────────────────────────────────────── */
  var PATTERN_HINTS = {
    "solitude-then-contact":      ["一个人", "独处", "安静", "消化", "沉淀", "空间"],
    "naming-to-settle":           ["说出", "表达", "语言", "讲清楚", "写下"],
    "rest-needs-permission":      ["休息", "停下", "撑", "累", "允许"],
    "belonging-on-own-terms":     ["group", "群", "人多", "参与", "退开"],
    "clarity-before-release":     ["想清楚", "确定", "谨慎", "说出来", "带出来", "犹豫", "反覆"],
    "checked-before-spoken":      ["怎么说", "措辞", "开口", "confirm", "先想"],
    "open-loop-stays-loud":       ["没说清楚", "悬着", "放不下", "一直想", "结果"],
    "trust-opens-slowly":         ["信任", "慢慢", "试探", "深交", "防备"],
    "carry-before-noticing-cost": ["承担", "责任", "撑", "扛", "别人", "累"],
    "standard-set-internally":    ["标准", "要求自己", "不够", "做到"],
    "visible-means-exposed":      ["被看见", "曝光", "评价", "在意别人怎么看"],
    "hold-it-in-until-it-passes": ["忍", "压", "不说", "过去就好"],
    "effort-without-traction":    ["使不上力", "白费", "卡住", "没有进展"],
    "meaning-gates-effort":       ["意义", "值得", "投入", "燃", "在乎"],
    "autonomy-or-stall":          ["自由", "自己决定", "被安排", "掌控", "空间"],
    "making-restores-agency":     ["做出来", "创造", "作品", "完成"],
    "starting-is-the-hard-part":  ["开始", "起头", "拖", "一旦开始"],
    "depth-or-disengage":         ["深", "表面", "穿透", "真正"],
    "wider-frame-pull":           ["更大的", "全貌", "背后", "为什么"],
    "novelty-over-repetition":    ["重複", "新鲜", "腻", "一成不变", "变化"],
    "growth-through-articulating":["讲出来", "写出来", "分享", "表达"],
    "closeness-needs-room":       ["距离", "空间", "喘口气", "靠近"],
    "depth-or-nothing-in-closeness": ["浅", "深入", "交心", "应酬"],
    "pace-set-by-the-other":      ["配合", "迁就", "对方", "节奏"],
    "recognition-wanted-not-sought": ["肯定", "认可", "被看见", "不好意思说"],
    "stability-before-movement":  ["安全感", "稳", "确定", "踏实", "基础"],
    "decide-then-revisit":        ["决定", "回头想", "后悔", "再确认"],
    "values-security":            ["安全感", "稳"],
    "single-signal-sensitivity":  ["敏感"]
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
    /* Composite:只在白名单宣告过、且自己通过证据验证时才成立。
       成立之后【不删除】任何 child —— child 仍然带着自己的证据留在池子里。 */
    var composites = buildComposites(candidates, tensions);

    var byDirection = groupByDirection(candidates, composites);

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
      composites: composites,
      tensions: tensions,
      byDirection: byDirection,
      directionStatus: directionStatus(byDirection),
      ruleCount: PATTERN_RULES.length,
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

    /* 4a2. 失格讯号:规则自己宣告的反向证据 */
    var disq = (rule.disqualifiers || []).length
      ? signals.filter(function (s) {
          return s.tags.some(function (t) { return rule.disqualifiers.indexOf(t) >= 0; });
        })
      : [];

    /* 4b. 独立性:以「结构锚点」计,不以讯号笔数计。
       ------------------------------------------------------------
       Phase 3.5 稽核发现的膨胀:同一个宫位里的四颗行星,会产生四笔
       planet-house 讯号、被当成四份独立证据 —— 但那其实是【一个】结构事实
       (这个宫位很重),只是由四颗行星表达。相位与轴点同理。

       所以独立性改成数「不同的结构锚点」:
         planet-house / stellium  → 锚点是那个宫位
         aspect                   → 锚点是那一对行星
         angular                  → 锚点是那条轴
         element/mode balance     → 锚点是那个统计量
         retrograde / node / sect → 各自一个锚点
       同一个锚点底下不管有几笔讯号,永远只算一份。 */
    var anchors = {}, keys = {}, actors = {};
    matched.forEach(function (s) {
      anchors[anchorOf(s)] = true;
      keys[s.independenceKey] = true;
      s.actors.forEach(function (a) { actors[a] = true; });
    });
    var independentCount = Object.keys(anchors).length;
    var rawSignalCount = Object.keys(keys).length;
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
      /* 稽核用:去重前的讯号笔数,与实际用到的结构锚点。
         两者差距越大,代表原本的算法把同一件事重複计了越多次。 */
      rawChartSignalCount: rawSignalCount,
      structuralAnchors: Object.keys(anchors).sort(),
      distinctActorCount: actorCount,
      needGroupsHit: groupsHit,
      needGroupsTotal: rule.needs.length,
      supportingSources: themeSupport.map(function (t) { return t.sourceId; }),
      contextualSources: threadSupport ? [threadSupport.sourceId] : [],
      contradictionSignals: [],
      compassRelevance: { primary: rule.compass.primary, secondary: rule.compass.secondary || null },
      generic: !!rule.generic || !rule.mechanism,
      genericRisk: rule.genericRisk || "medium",
      /* 通用化风险高的规则要求更多独立证据 —— 越容易套在谁身上的说法,门槛越高 */
      minIndependent: rule.minIndependent || (rule.genericRisk === "high" ? 3 : 2),
      disqualifiedBy: disq.map(function (d) { return d.id; }),
      family: rule.family || "UNCLASSIFIED",
      partOfComposite: null,
      duplicateOf: null,
      strength: 0,
      status: "provisional",
      rejectionReason: null
    };
    c.strength = score(c, rule);
    return c;
  }

  /* 4e. 强度:分数永不给使用者看。
     ------------------------------------------------------------
     这一版刻意把「证据量」做成分级,而不是一个门槛就满分 ——
     上一版所有通过的候选分数都是 7,等于没有鉴别力,
     「哪一个是这个方向的首选」会变成看阵列顺序。

     ⚠ 门槛没有降低,是提高了:
       规格说「2 个独立盘面讯号」是进入 strong candidate consideration 的
       最低标准,不是 accepted 的标准。所以光有最低标准 → provisional;
       要 accepted 得再加上「主题支持」或「更厚的盘面证据」。 */
  function score(c, rule) {
    var s = 0;
    // 证据量分级:越多独立结构,分数越高(这是这一版新增的鉴别力)
    if (c.independentEvidenceCount >= 2) s += 2;
    if (c.independentEvidenceCount >= 4) s += 1;
    if (c.independentEvidenceCount >= 6) s += 1;
    if (c.distinctActorCount >= 5) s += 1;                // 涉及够多不同的盘面物件
    if (c.needGroupsHit >= c.needGroupsTotal) s += 2;      // 结构真的对得起来
    if (DIRECTION_DOMAINS[c.compassRelevance.primary] &&
        DIRECTION_DOMAINS[c.compassRelevance.primary].indexOf(c.domain) >= 0) s += 2;
    if (c.supportingSources.length >= 1) s += 2;          // 主题支持
    if (c.supportingSources.length >= 2) s += 1;          // 跨多个相关主题重複
    if (c.contextualSources.length) s += 1;               // 生命脉络只给 1 分,且不进独立计数
    if (c.independentEvidenceCount <= 1) s -= 3;          // 单一孤立落点
    if (c.generic) s -= 3;                                // 通用诠释
    if (c.distinctActorCount <= 2 && c.independentEvidenceCount >= 2) s -= 1; // 同一组物件换讲法
    if (c.disqualifiedBy.length) s -= 2;                  // 规则自己宣告的反向证据
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
    if (c.independentEvidenceCount < c.minIndependent) {
      c.status = "rejected";
      c.rejectionReason = c.independentEvidenceCount < 2
        ? "isolated-placement-only"
        : "below-required-independent-evidence:" + c.minIndependent;
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

  function groupByDirection(cands, composites) {
    var out = {};
    DIRECTIONS.forEach(function (d) {
      var rows = cands.filter(function (c) {
        return c.compassRelevance.primary === d && c.status === "accepted";
      }).map(function (c) {
        return { kind: "pattern", patternKey: c.patternKey, strength: c.strength, family: c.mechanismFamily };
      });
      (composites || []).forEach(function (cp) {
        if (cp.status === "accepted" && cp.primaryCompassDirection === d)
          rows.push({ kind: "composite", patternKey: cp.compositeKey, strength: cp.strength,
                      family: cp.compositeKey, childPatterns: cp.childPatterns });
      });
      rows.sort(function (a, b) { return b.strength - a.strength; });
      out[d] = rows;
    });
    return out;
  }

  /* 每个方向自己的状态。
     ⚠ 没有 accepted 的时候一律是 insufficient_evidence:
       不降门槛、不自动把最强的 provisional 升上来、不塞通用模式进去。
       未来若要从 provisional 做 secondary review,必须另外通过额外验证,
       这一层只负责如实说「证据不够」。 */
  function directionStatus(byDirection) {
    var out = {};
    DIRECTIONS.forEach(function (d) {
      var rows = byDirection[d] || [];
      out[d] = rows.length
        ? { status: "accepted", topPatternKey: rows[0].patternKey, acceptedCount: rows.length }
        : { status: "insufficient_evidence", topPatternKey: null, acceptedCount: 0,
            note: "no candidate met the acceptance bar; threshold is NOT lowered to fill this direction" };
    });
    return out;
  }

  /* Composite:白名单 + 自己的证据验证。四个条件全过才成立。 */
  function buildComposites(cands, tensions) {
    var byKey = {};
    cands.forEach(function (c) { byKey[c.patternKey] = c; });

    return COMPOSITE_RULES.map(function (rule) {
      var kids = rule.childPatterns.map(function (k) { return byKey[k]; });
      var req = rule.requires;
      var rec = {
        compositeKey: rule.compositeKey,
        domain: rule.domain,
        mechanism: rule.mechanism,
        childPatterns: rule.childPatterns.slice(),
        sequence: rule.sequence.slice(),
        primaryCompassDirection: rule.primaryCompassDirection,
        childStrengths: {},
        evidenceUnion: [],
        independentEvidenceCount: 0,
        contradictionResolvedAsSequence: false,
        strength: 0,
        status: "rejected",
        rejectionReason: null,
        checks: {}
      };

      if (kids.some(function (k) { return !k; })) {
        rec.rejectionReason = "child-pattern-missing"; return rec;
      }
      kids.forEach(function (k) { rec.childStrengths[k.patternKey] = k.strength; });

      // 每个 child 自己的盘面证据键
      var keySets = kids.map(function (k) {
        return k.sourceSignals.filter(function (s) { return s.sourceType === "chart"; })
          .map(function (s) { return s.independenceKey; });
      });
      var actorSets = kids.map(function (k) {
        var a = {};
        k.sourceSignals.filter(function (s) { return s.sourceType === "chart"; })
          .forEach(function (s) { s.independenceKey.split("|")[1].split("+").forEach(function (x) { a[x] = true; }); });
        return Object.keys(a);
      });

      var union = {};
      keySets.forEach(function (ks) { ks.forEach(function (k) { union[k] = true; }); });
      rec.evidenceUnion = Object.keys(union);
      rec.independentEvidenceCount = rec.evidenceUnion.length;

      var sharedActors = actorSets[0].filter(function (a) { return actorSets[1].indexOf(a) >= 0; });
      var ownKeys = keySets.map(function (ks, i) {
        var other = keySets[1 - i];
        return ks.filter(function (k) { return other.indexOf(k) < 0; });
      });
      var bestChild = Math.max(keySets[0].length, keySets[1].length);

      rec.checks = {
        bothChildrenStrong: kids.every(function (k) { return k.strength >= req.bothChildrenAtLeast; }),
        childrenNotRejected: kids.every(function (k) { return k.status !== "rejected"; }),
        sharedActors: sharedActors,
        sharedActorsOk: sharedActors.length >= req.sharedActorsAtLeast,
        distinctKeysEach: ownKeys.map(function (k) { return k.length; }),
        distinctKeysOk: ownKeys.every(function (k) { return k.length >= req.distinctKeysEachAtLeast; }),
        unionExceedsBest: rec.independentEvidenceCount > bestChild,
        notMutuallyNegating: true
      };

      /* 互为张力 ≠ 互相否定。张力是「两边都真,在不同阶段」——
         正好就是 sequence 想描述的东西,所以这里把它记成「张力以顺序化解」。 */
      var fams = kids.map(function (k) { return k.mechanismFamily; }).sort().join("~");
      rec.contradictionResolvedAsSequence = (tensions || []).some(function (t) {
        return [t.familyA, t.familyB].sort().join("~") === fams && t.bothStrong;
      });

      var ch = rec.checks;
      if (!ch.childrenNotRejected) { rec.rejectionReason = "child-pattern-rejected"; return rec; }
      if (!ch.bothChildrenStrong) { rec.rejectionReason = "child-evidence-too-weak"; return rec; }
      if (!ch.sharedActorsOk) { rec.rejectionReason = "children-describe-unrelated-systems"; return rec; }
      if (!ch.distinctKeysOk) { rec.rejectionReason = "children-are-the-same-evidence"; return rec; }
      if (req.unionMustExceedBest && !ch.unionExceedsBest) {
        rec.rejectionReason = "merging-adds-no-information"; return rec;
      }

      rec.status = "accepted";
      rec.strength = Math.max(kids[0].strength, kids[1].strength) + 1;
      kids.forEach(function (k) { k.partOfComposite = rule.compositeKey; });
      return rec;
    });
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
    COMPOSITE_RULES: COMPOSITE_RULES,
    TENSION_PAIRS: TENSION_PAIRS,
    extractChartSignals: extractChartSignals,
    build: build,
    diversityCheck: diversityCheck
  };
});
