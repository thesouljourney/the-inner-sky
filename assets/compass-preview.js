/* ============================================================
   我的内在指南 · Dev Preview 编排层(Phase 5)
   ------------------------------------------------------------
   把已经做好的三层接起来,产出一份「画面直接可以画」的 view model:

     natal chart → compass-evidence → compass-selection → compass-translation

   ⚠ 这一层【只编排,不判断】:
     · 不改 27 条 evidence rules、不改 evidence scoring
     · 不改 selection scoring、不改任何一句 translation 文案
     · 不呼叫任何 API、不碰资料库、不读日记 / 心情 / 收藏
     · 证据不够 → 不补文案;还没翻译 → 不补文案。
       这两种缺口都必须一路传到画面上,不准为了版面完整而填东西。

   产出分成两块,刻意分开:
     view  给使用者看的(只有 coreInsight / explanation / reflectionPrompt)
     dev   开发者细节(patternKey、分数、trace)—— 预设不显示
   ============================================================ */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("./compass-evidence.js"),
      require("./compass-selection.js"),
      require("./compass-translation.js")
    );
  } else {
    root.CompassPreview = factory(root.CompassEvidence, root.CompassSelection, root.CompassTranslation);
  }
})(typeof self !== "undefined" ? self : this, function (CE, CS, CT) {
  "use strict";

  /* 四个方向在画面上的顺序与标题。key 用 selection 层的 key。 */
  var DIRECTIONS = [
    { key: "grounds", no: "01", en: "What grounds me", zh: "什么让我安定" },
    { key: "moves",   no: "02", en: "What moves me",   zh: "什么让我前进" },
    { key: "drains",  no: "03", en: "What drains me",  zh: "什么正在消耗我" },
    { key: "calls",   no: "04", en: "What calls me",   zh: "我正在被什么吸引" }
  ];

  var RULE_BY_KEY = {};
  CE.PATTERN_RULES.forEach(function (r) { RULE_BY_KEY[r.patternKey] = r; });
  var COMPOSITE_BY_KEY = {};
  CE.COMPOSITE_RULES.forEach(function (r) { COMPOSITE_BY_KEY[r.compositeKey] = r; });
  function mechanismOf(k) {
    var r = RULE_BY_KEY[k] || COMPOSITE_BY_KEY[k];
    return r ? r.mechanism : null;
  }

  /* 语料库:distinctiveness 要跨盘才算得出来。
     只算一次,之后每张盘共用 —— 切换 case 不需要重跑十张盘。 */
  var corpusCache = null;
  function corpusFor(reports) {
    if (corpusCache) return corpusCache;
    corpusCache = CS.buildCorpus(reports);
    return corpusCache;
  }
  function resetCorpus() { corpusCache = null; }

  /* 一张盘 → 证据报告。themes 一律留空:
     dev preview 只测盘面这一层,不混进九个主题。 */
  function reportFor(natal) {
    return CE.build({ evidence: { chart: natal, themes: {} }, context: {} });
  }

  /* ── 单一方向的 view model ──────────────────────────────── */
  function directionView(dirMeta, picked, corpusRow) {
    var out = {
      key: dirMeta.key, no: dirMeta.no, en: dirMeta.en, zh: dirMeta.zh,
      state: "ok",
      copy: null,      // 使用者会看到的三句话;任何非 ok 的状态一律是 null
      dev: null
    };

    if (!picked) {
      out.state = "insufficient_evidence";
      out.dev = { patternKey: null, reason: "no accepted candidate for this direction" };
      return out;
    }

    var t = CT.translate({
      patternKey: picked.key,
      kind: picked.kind,
      primaryDirection: dirMeta.key,
      mechanism: mechanismOf(picked.key)
    });

    var dev = {
      patternKey: picked.key,
      kind: picked.kind,
      translationStatus: t.status,
      selectionScore: picked.parts.selectionScore,
      evidenceStrength: picked.parts.evidenceStrength,
      directionRelevance: picked.parts.directionRelevance,
      distinctiveness: picked.parts.personalDistinctiveness,
      compositeValue: picked.parts.compositeValue,
      redundancyPenalty: picked.parts.redundancyPenalty,
      redundancyAgainst: picked.parts.redundancyAgainst,
      distinctivenessFlags: picked.parts.distinctivenessFlags || [],
      why: picked.why || null,
      mechanism: mechanismOf(picked.key),
      livedExperience: t.livedExperience || null,
      childPatterns: t.childPatterns || null,
      sequence: t.sequence || null,
      acceptedFrequency: corpusRow ? (corpusRow.acceptedCount + "/" + corpusRow.testedCharts) : null,
      qualityChecks: t.qualityChecks || null
    };
    out.dev = dev;

    if (t.status !== "ok") {
      /* 还没写翻译 —— 如实呈现,绝不 fallback、绝不即兴生成 */
      out.state = "not_translated";
      return out;
    }
    out.state = "ok";
    out.copy = {
      coreInsight: t.coreInsight,
      explanation: t.explanation,
      reflectionPrompt: t.reflectionPrompt
    };
    return out;
  }

  /* ── 一张盘 → 四个方向 ──────────────────────────────────── */
  function buildFor(natal, corpus) {
    var report = reportFor(natal);
    var selection = CS.select(report, corpus);
    var rows = {};
    if (corpus && corpus.matrix) {
      corpus.matrix.rows.forEach(function (r) { rows[r.patternKey] = r; });
    }
    var directions = DIRECTIONS.map(function (d) {
      var sel = selection.directions[d.key];
      var picked = (sel && sel.status === "selected" && sel.primary) ? sel.primary : null;
      return directionView(d, picked, picked ? rows[picked.key] : null);
    });
    return {
      directions: directions,
      counts: {
        ok: directions.filter(function (d) { return d.state === "ok"; }).length,
        insufficient: directions.filter(function (d) { return d.state === "insufficient_evidence"; }).length,
        notTranslated: directions.filter(function (d) { return d.state === "not_translated"; }).length
      },
      selection: selection,
      report: report
    };
  }

  /* ── 测试盘 ─────────────────────────────────────────────── */
  /* astro 引擎在 Node 与浏览器里的名字不一样,这里只做取用,不做计算。 */
  function engine(astro) {
    if (astro) return astro;
    if (typeof window !== "undefined" && window.InnerSkyAstro) return window.InnerSkyAstro;
    if (typeof module === "object" && module.exports) return require("./astro/astro-core.js");
    return null;
  }
  function casesModule(cases) {
    if (cases) return cases;
    if (typeof window !== "undefined" && window.CompassCases) return window.CompassCases;
    if (typeof module === "object" && module.exports) return require("./compass-cases.js");
    return null;
  }

  var natalCache = {};
  function natalFor(caseId, opts) {
    if (natalCache[caseId]) return natalCache[caseId];
    opts = opts || {};
    var C = casesModule(opts.cases), A = engine(opts.astro);
    var c = C.byId(caseId);
    if (!c) return null;
    natalCache[caseId] = A.computeNatalChart({
      date: c.date, time: c.time, place: { lat: c.lat, lon: c.lon, tzId: c.tzId }
    }).chart;
    return natalCache[caseId];
  }

  /* 十张测试盘的语料库。切换 case 时重复呼叫也只算一次。 */
  function testCorpus(opts) {
    if (corpusCache) return corpusCache;
    var C = casesModule((opts || {}).cases);
    return corpusFor(C.ids.map(function (id) {
      return { caseId: id, report: reportFor(natalFor(id, opts)) };
    }));
  }

  /* 画面要的就是这一个:给 caseId,拿到可以直接画的东西。 */
  function buildCase(caseId, opts) {
    var natal = natalFor(caseId, opts);
    if (!natal) return null;
    var vm = buildFor(natal, testCorpus(opts));
    vm.caseId = caseId;
    vm.source = "test-case";
    return vm;
  }

  /* 目前登入者自己的盘。语料库仍然用十张测试盘 ——
     distinctiveness 本来就需要一个参照母体,而这一版的母体就是它们。 */
  function buildCurrent(natal, opts) {
    if (!natal || !natal.planets) return null;
    var vm = buildFor(natal, testCorpus(opts));
    vm.caseId = "CURRENT";
    vm.source = "current-chart";
    return vm;
  }

  return {
    DIRECTIONS: DIRECTIONS,
    buildCase: buildCase,
    buildCurrent: buildCurrent,
    buildFor: buildFor,
    natalFor: natalFor,
    testCorpus: testCorpus,
    reportFor: reportFor,
    mechanismOf: mechanismOf,
    _resetCorpus: resetCorpus
  };
});
