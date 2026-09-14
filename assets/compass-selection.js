/* ============================================================
   我的内在指南 · 差异化与选择层(Phase 3)
   ------------------------------------------------------------
   上一层(compass-evidence.js)回答的是「能不能这样说」。
   这一层回答的是「这么多成立的说法里,为什么这一个特别值得告诉这个人」。

   ⚠ 硬边界:
     · 27 条规则冻结 —— 这一支【不 import 也不修改】规则表
     · 选择永远不能回头改变 evidence status
     · rejected 不会因为稀有而复活;provisional 不会因为稀有而自动 accepted
     · insufficient_evidence 不会被填满
     · 不读日记 / 心情 / 收藏 —— 这一层的输入只有上一层的 report
   只在开发期使用,不进产品 UI,不发任何请求。
   ============================================================ */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CompassSelection = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var DIRECTIONS = ["grounds", "moves", "drains", "calls"];

  /* ──────────────────────────────────────────────────────────
     1. 跨盘矩阵与频率
     ------------------------------------------------------------
     每一格分四种:A=accepted P=provisional R=rejected —=没触发
     「没触发」= 这条规则在这张盘上连一个讯号都没对上。
     ────────────────────────────────────────────────────────── */
  function cellOf(cand) {
    if (!cand) return "-";
    if (cand.evidenceCount === 0 && cand.independentEvidenceCount === 0) return "-";
    return { accepted: "A", provisional: "P", rejected: "R" }[cand.status] || "-";
  }

  function buildMatrix(cases) {
    var keys = {};
    cases.forEach(function (c) {
      c.report.candidates.forEach(function (x) { keys[x.patternKey] = true; });
    });
    var patternKeys = Object.keys(keys).sort();
    var rows = patternKeys.map(function (pk) {
      var cells = {}, accepted = 0, provisional = 0, triggered = 0;
      cases.forEach(function (c) {
        var cand = c.report.candidates.find(function (x) { return x.patternKey === pk; });
        var cell = cellOf(cand);
        cells[c.caseId] = cell;
        if (cell === "A") accepted++;
        if (cell === "P") provisional++;
        if (cell !== "-") triggered++;
      });
      var n = cases.length;
      return {
        patternKey: pk, cells: cells, testedCharts: n,
        acceptedCount: accepted, provisionalCount: provisional, triggerCount: triggered,
        acceptedFrequency: accepted / n,
        provisionalFrequency: provisional / n,
        triggerFrequency: triggered / n
      };
    });
    return { patternKeys: patternKeys, caseIds: cases.map(function (c) { return c.caseId; }), rows: rows };
  }

  /* ──────────────────────────────────────────────────────────
     2. Personal distinctiveness
     ------------------------------------------------------------
     它不是新的占星证据,是跨盘比较指标 —— 只能用来【排序】。

     公式刻意做得可解释:
       rawDistinct = 1 - acceptedFrequency
       confidence  = min(1, acceptedCount / 3)      ← 样本太少就不敢下结论
       distinct    = 0.5 + (rawDistinct - 0.5) * confidence

     这个收缩项是为了挡住「罕见 = 重要」这个错误:
     只出现一次的模式,可能只是 fixture 偏差 / 规则太窄 / 结构巧合,
     所以它的 distinctiveness 会被拉回 0.5 附近,而不是拿到接近 1 的满分。
     ────────────────────────────────────────────────────────── */
  function distinctivenessOf(row) {
    var raw = 1 - row.acceptedFrequency;
    var confidence = Math.min(1, row.acceptedCount / 3);
    var d = 0.5 + (raw - 0.5) * confidence;
    var flags = [];
    if (row.acceptedFrequency >= 0.75) flags.push("low-distinctiveness");
    if (row.acceptedFrequency === 0 && row.triggerFrequency > 0) flags.push("never-accepted");
    if (row.triggerFrequency === 0) flags.push("never-triggered");
    if (row.acceptedCount > 0 && row.acceptedCount <= 1) flags.push("low-sample");
    return { value: Math.max(0, Math.min(1, d)), raw: raw, confidence: confidence, flags: flags };
  }

  function buildCorpus(cases) {
    var matrix = buildMatrix(cases);
    var stats = {};
    matrix.rows.forEach(function (r) {
      stats[r.patternKey] = Object.assign({}, r, { distinctiveness: distinctivenessOf(r) });
    });
    return { matrix: matrix, stats: stats, caseCount: cases.length };
  }

  /* ──────────────────────────────────────────────────────────
     3. 证据重叠与冗余
     ------------------------------------------------------------
     两个 patternKey 不同的候选,可能用了几乎同一批讯号 —— 那其实是同一件事。
     但高重叠【不自动 reject】:同一个结构本来就可能支持两种不同机制。
     所以要同时看「证据重叠」与「机制相似」,两者都高才重罚。
     ────────────────────────────────────────────────────────── */
  function chartKeys(c) {
    return c.sourceSignals.filter(function (s) { return s.sourceType === "chart"; })
      .map(function (s) { return s.independenceKey; });
  }
  function evidenceOverlap(a, b) {
    var ka = chartKeys(a), kb = chartKeys(b);
    var shared = ka.filter(function (k) { return kb.indexOf(k) >= 0; });
    var denom = Math.min(ka.length, kb.length) || 1;
    return { sharedEvidenceCount: shared.length, evidenceOverlapRatio: shared.length / denom };
  }
  function mechanismSimilarity(a, b) {
    if (a.mechanismFamily === b.mechanismFamily) return 1;
    if (a.family && a.family === b.family) return 0.5;   // 同一个 taxonomy 大家族
    return 0;
  }
  function redundancyAgainst(cand, picked) {
    var worst = { penalty: 0, against: null, overlap: null, mechSim: 0 };
    picked.forEach(function (p) {
      var ov = evidenceOverlap(cand, p.candidate);
      var ms = mechanismSimilarity(cand, p.candidate);
      /* 机制不同的时候,即使证据重叠也只轻罚 —— 同一结构支持两种机制是合理的 */
      var penalty = ov.evidenceOverlapRatio * (0.25 + 0.75 * ms);
      /* composite 已经选走时,它的 child 在别的方向要额外让路 */
      if (p.kind === "composite" && p.childPatterns &&
          p.childPatterns.indexOf(cand.patternKey) >= 0) penalty = Math.max(penalty, 0.9);
      if (penalty > worst.penalty)
        worst = { penalty: penalty, against: p.key, overlap: ov, mechSim: ms };
    });
    return worst;
  }

  /* ──────────────────────────────────────────────────────────
     4. Composite value
     ------------------------------------------------------------
     composite 不因为「比 child 复杂」就自动优先。
     只有当它真的多讲了一件事 —— 有顺序、化解了张力、比 child 更具体、
     证据链仍然清楚 —— 才拿得到 selection 上的优势。
     只是把两个相似的东西拼起来 → 0 分。
     ────────────────────────────────────────────────────────── */
  function compositeValue(cp, candsByKey) {
    if (!cp || cp.status !== "accepted") return { value: 0, reasons: ["not-accepted"] };
    var reasons = [], score = 0;
    var newSequence = Array.isArray(cp.sequence) && cp.sequence.length >= 3 &&
                      typeof cp.mechanism === "string" && cp.mechanism.length > 40;
    var explainsTension = !!cp.contradictionResolvedAsSequence;
    var kids = (cp.childPatterns || []).map(function (k) { return candsByKey[k]; }).filter(Boolean);
    var bestKid = kids.reduce(function (m, k) { return Math.max(m, k.independentEvidenceCount); }, 0);
    var moreSpecific = cp.independentEvidenceCount > bestKid;
    var traceable = cp.evidenceUnion && cp.evidenceUnion.length === cp.independentEvidenceCount;

    if (newSequence) { score += 0.35; reasons.push("new-sequence"); }
    if (explainsTension) { score += 0.35; reasons.push("explains-child-tension"); }
    if (moreSpecific) { score += 0.2; reasons.push("more-specific-than-children"); }
    if (traceable) { score += 0.1; reasons.push("evidence-traceable"); }

    /* 只是拼接:既没有新顺序,也没有化解张力 → 一律 0 */
    if (!newSequence && !explainsTension) return { value: 0, reasons: ["merely-stitched"] };
    return { value: Math.min(1, score), reasons: reasons };
  }

  /* ──────────────────────────────────────────────────────────
     5. Selection score
     ------------------------------------------------------------
     只在 accepted pool 内排序。每一项都留着,不做成一个黑盒分数。
     ────────────────────────────────────────────────────────── */
  var W = { evidence: 0.40, relevance: 0.20, distinct: 0.25, composite: 0.15 };
  var MAX_STRENGTH = 12;

  function relevanceOf(cand, dir) {
    if (cand.compassRelevance.primary === dir) return 1;
    if (cand.compassRelevance.secondary === dir) return 0.6;
    return 0.3;
  }

  function scoreCandidate(entry, dir, corpus, picked, candsByKey) {
    var cand = entry.candidate;
    var st = corpus.stats[cand.patternKey] || null;
    var distinct = st ? st.distinctiveness.value : 0.5;
    var evidence = Math.max(0, Math.min(1, cand.strength / MAX_STRENGTH));
    var relevance = relevanceOf(cand, dir);
    var cv = entry.kind === "composite" ? entry.compositeValue.value : 0;
    var red = redundancyAgainst(cand, picked);
    var raw = W.evidence * evidence + W.relevance * relevance +
              W.distinct * distinct + W.composite * cv;
    return {
      evidenceStrength: round(evidence), directionRelevance: round(relevance),
      personalDistinctiveness: round(distinct), compositeValue: round(cv),
      redundancyPenalty: round(red.penalty), redundancyAgainst: red.against,
      evidenceOverlapRatio: red.overlap ? round(red.overlap.evidenceOverlapRatio) : 0,
      sharedEvidenceCount: red.overlap ? red.overlap.sharedEvidenceCount : 0,
      mechanismSimilarity: round(red.mechSim),
      selectionScore: round(raw - red.penalty * 0.5),
      distinctivenessFlags: st ? st.distinctiveness.flags : []
    };
  }
  function round(x) { return Math.round(x * 1000) / 1000; }

  /* ──────────────────────────────────────────────────────────
     6. 方向内竞争 + 跨方向多样性
     ------------------------------------------------------------
     方向依固定顺序处理;每一次都对「已经选走的」算一次冗余,
     所以后面的方向会自动避开前面讲过的东西(跨方向多样性)。
     排序的 tie-break 用 patternKey 字典序 —— 不看阵列顺序,
     所以把候选顺序打乱,选出来的结果完全一样。
     ────────────────────────────────────────────────────────── */
  function select(report, corpus) {
    var candsByKey = {};
    report.candidates.forEach(function (c) { candsByKey[c.patternKey] = c; });

    /* accepted pool —— 硬闸门。这里只放 accepted,
       provisional 与 rejected 连进场的机会都没有。 */
    var pool = [];
    report.candidates.forEach(function (c) {
      if (c.status !== "accepted") return;
      pool.push({ kind: "pattern", key: c.patternKey, candidate: c });
    });
    (report.composites || []).forEach(function (cp) {
      if (cp.status !== "accepted") return;
      var synthetic = {
        patternKey: cp.compositeKey, mechanismFamily: cp.compositeKey,
        family: "COMPOSITE", domain: cp.domain,
        strength: cp.strength, independentEvidenceCount: cp.independentEvidenceCount,
        compassRelevance: { primary: cp.primaryCompassDirection, secondary: null },
        sourceSignals: (cp.evidenceUnion || []).map(function (k) {
          return { sourceType: "chart", independenceKey: k };
        })
      };
      pool.push({ kind: "composite", key: cp.compositeKey, candidate: synthetic,
                  compositeValue: compositeValue(cp, candsByKey),
                  childPatterns: cp.childPatterns });
    });

    var picked = [], directions = {};
    DIRECTIONS.forEach(function (dir) {
      var ds = report.directionStatus[dir];
      if (!ds || ds.status !== "accepted") {
        directions[dir] = {
          status: "insufficient_evidence", primary: null, runnerUp: null, ranked: [],
          note: "selection must not fill this direction: no candidate passed the evidence gate"
        };
        return;
      }
      var here = pool.filter(function (e) {
        return e.candidate.compassRelevance.primary === dir ||
               e.candidate.compassRelevance.secondary === dir;
      });
      var ranked = here.map(function (e) {
        return { kind: e.kind, key: e.key, childPatterns: e.childPatterns || null,
                 parts: scoreCandidate(e, dir, corpus, picked, candsByKey), entry: e };
      });
      ranked.sort(function (a, b) {
        if (b.parts.selectionScore !== a.parts.selectionScore)
          return b.parts.selectionScore - a.parts.selectionScore;
        return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;   // tie-break 用名字,不用阵列顺序
      });
      if (!ranked.length) {
        directions[dir] = { status: "insufficient_evidence", primary: null, runnerUp: null, ranked: [] };
        return;
      }
      var top = ranked[0], second = ranked[1] || null;
      directions[dir] = {
        status: "selected",
        primary: { key: top.key, kind: top.kind, parts: top.parts,
                   why: explainPick(top, second) },
        runnerUp: second ? { key: second.key, kind: second.kind, parts: second.parts,
                             whyNot: explainSkip(second, top) } : null,
        ranked: ranked.map(function (r) { return { key: r.key, kind: r.kind, score: r.parts.selectionScore }; })
      };
      picked.push({ key: top.key, kind: top.kind, candidate: top.entry.candidate,
                    childPatterns: top.childPatterns });
    });

    return { directions: directions, signature: signatureOf(report, directions) };
  }

  function explainPick(top, second) {
    var p = top.parts, bits = [];
    bits.push("evidence=" + p.evidenceStrength);
    bits.push("relevance=" + p.directionRelevance);
    bits.push("distinct=" + p.personalDistinctiveness);
    if (p.compositeValue > 0) bits.push("compositeValue=" + p.compositeValue);
    if (p.redundancyPenalty > 0) bits.push("redundancy=-" + p.redundancyPenalty);
    if (second) bits.push("beat " + second.key + " by " +
      round(p.selectionScore - second.parts.selectionScore));
    return bits.join(", ");
  }
  function explainSkip(second, top) {
    var a = second.parts, b = top.parts, bits = [];
    if (a.evidenceStrength < b.evidenceStrength) bits.push("weaker evidence");
    if (a.personalDistinctiveness < b.personalDistinctiveness) bits.push("less distinctive across charts");
    if (a.redundancyPenalty > 0) bits.push("overlaps an already-selected pattern (" +
      a.redundancyAgainst + ", overlap " + a.evidenceOverlapRatio + ")");
    if (a.directionRelevance < b.directionRelevance) bits.push("only secondary relevance here");
    if (!bits.length) bits.push("lower combined selection score");
    return bits.join("; ");
  }

  /* ──────────────────────────────────────────────────────────
     7. Case signature + 相似度
     ------------------------------------------------------------
     signature 是内部的 selection 摘要,不是文案。
     相似度用 Jaccard,简单、透明、可重现。
     ────────────────────────────────────────────────────────── */
  function signatureOf(report, directions) {
    var selected = {};
    DIRECTIONS.forEach(function (d) {
      selected[d] = directions[d].primary ? directions[d].primary.key : null;
    });
    var accepted = report.candidates.filter(function (c) { return c.status === "accepted"; });
    var fams = {};
    accepted.forEach(function (c) { fams[c.family] = (fams[c.family] || 0) + 1; });
    return {
      selected: selected,
      strongestAcceptedPatterns: accepted.slice()
        .sort(function (a, b) { return b.strength - a.strength || (a.patternKey < b.patternKey ? -1 : 1); })
        .slice(0, 5).map(function (c) { return c.patternKey; }),
      dominantMechanismFamilies: Object.keys(fams).sort(function (a, b) {
        return fams[b] - fams[a] || (a < b ? -1 : 1); }).slice(0, 3),
      meaningfulTensions: (report.tensions || []).filter(function (t) { return t.bothStrong; })
        .map(function (t) { return [t.familyA, t.familyB].sort().join("~"); }).sort(),
      composites: (report.composites || []).filter(function (c) { return c.status === "accepted"; })
        .map(function (c) { return c.compositeKey; }).sort(),
      insufficientDirections: DIRECTIONS.filter(function (d) {
        return directions[d].status === "insufficient_evidence"; })
    };
  }

  function signatureSet(sig) {
    var s = [];
    Object.keys(sig.selected).forEach(function (d) {
      if (sig.selected[d]) s.push("sel:" + d + "=" + sig.selected[d]);
    });
    sig.strongestAcceptedPatterns.forEach(function (p) { s.push("strong:" + p); });
    sig.dominantMechanismFamilies.forEach(function (f) { s.push("fam:" + f); });
    sig.meaningfulTensions.forEach(function (t) { s.push("tension:" + t); });
    sig.composites.forEach(function (c) { s.push("comp:" + c); });
    return s;
  }
  function jaccard(a, b) {
    var A = signatureSet(a), B = signatureSet(b);
    var inter = A.filter(function (x) { return B.indexOf(x) >= 0; }).length;
    var uni = A.concat(B.filter(function (x) { return A.indexOf(x) < 0; })).length;
    return uni ? round(inter / uni) : 0;
  }
  function pairwise(cases) {
    var out = [];
    for (var i = 0; i < cases.length; i++)
      for (var j = i + 1; j < cases.length; j++)
        out.push({ a: cases[i].caseId, b: cases[j].caseId,
                   similarity: jaccard(cases[i].selection.signature, cases[j].selection.signature) });
    return out.sort(function (x, y) { return y.similarity - x.similarity; });
  }

  /* ──────────────────────────────────────────────────────────
     8. 差异化体检:哪一个方向在跨盘之间根本分不出来
     ────────────────────────────────────────────────────────── */
  function differentiationCheck(cases, opts) {
    var limit = (opts && opts.failAt) || 0.75;
    var perDirection = {};
    DIRECTIONS.forEach(function (d) {
      var counts = {}, insufficient = 0, tops = [], strengths = [];
      cases.forEach(function (c) {
        var dd = c.selection.directions[d];
        if (dd.status !== "selected") { insufficient++; return; }
        counts[dd.primary.key] = (counts[dd.primary.key] || 0) + 1;
        tops.push(dd.primary.key);
        strengths.push(dd.primary.parts.evidenceStrength);
      });
      var sorted = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a] || (a < b ? -1 : 1); });
      var modeKey = sorted[0] || null;
      var modeShare = modeKey ? counts[modeKey] / cases.length : 0;
      perDirection[d] = {
        distinctSelections: sorted.length,
        modeKey: modeKey, modeCount: modeKey ? counts[modeKey] : 0, modeShare: round(modeShare),
        insufficientCount: insufficient,
        insufficientRate: round(insufficient / cases.length),
        averageTopEvidence: strengths.length
          ? round(strengths.reduce(function (a, b) { return a + b; }, 0) / strengths.length) : 0,
        failure: modeShare >= limit
      };
    });
    var failing = DIRECTIONS.filter(function (d) { return perDirection[d].failure; });
    return {
      threshold: limit, perDirection: perDirection, failingDirections: failing,
      verdict: failing.length ? "DIFFERENTIATION_FAILURE" : "OK"
    };
  }

  return {
    DIRECTIONS: DIRECTIONS,
    buildMatrix: buildMatrix,
    buildCorpus: buildCorpus,
    distinctivenessOf: distinctivenessOf,
    evidenceOverlap: evidenceOverlap,
    mechanismSimilarity: mechanismSimilarity,
    compositeValue: compositeValue,
    select: select,
    signatureSet: signatureSet,
    jaccard: jaccard,
    pairwise: pairwise,
    differentiationCheck: differentiationCheck,
    WEIGHTS: W
  };
});
