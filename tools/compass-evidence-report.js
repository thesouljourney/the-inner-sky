#!/usr/bin/env node
/* ============================================================
   我的内在指南 · 证据抽取原型:开发用报告
   ------------------------------------------------------------
   只给开发看。不进 production UI、不呼叫任何 API、不碰资料库。
   用法:  node tools/compass-evidence-report.js [--json]

   测试盘用的是仓库既有的那一组出生资料(tests/run-tests.js 也在用),
   不是任何真实使用者的资料,也不读任何日记 / 收藏 / 心情。
   ============================================================ */
const path = require("path");
const Astro = require(path.join(__dirname, "..", "assets", "astro", "astro-core.js"));
const CE = require(path.join(__dirname, "..", "assets", "compass-evidence.js"));

/* 仓库既有的测试出生资料 */
const BIRTH = {
  date: "1994-11-21", time: "01:44",
  place: { city: "Batu Pahat", lat: 1.8548, lon: 102.9325, tzId: "Asia/Kuala_Lumpur" }
};

/* 次级诠释证据:九个主题。这里用形状正确的 fixture,
   内容是占位的内部文字 —— 本阶段不碰真实使用者内容,也不产生给使用者看的文案。 */
const THEMES = {
  self:    { tagline: "你想清楚了才愿意说出来，所以有些话一直留在里面。", aha: ["确定之前你不会先讲"] },
  emotion: { tagline: "你需要先一个人待一下，才有力气重新靠近别人。", aha: ["独处不是不想连接"] },
  career:  { tagline: "事情有意义的时候你投入得很深，没有意义的时候特别容易累。", aha: ["值得才投入"] },
  family:  { tagline: "你很早就学会承担，累了也常常先撑着。", aha: ["责任是自动接下的"] },
  body:    { tagline: "你通常是事情结束以后，才发现自己已经撑了一阵子。", aha: ["累是后知后觉的"] }
};

/* 综合脉络:生命脉络。审计已确认它是从主题衍生的 → 永远不增加独立证据数。 */
const THREAD = {
  tagline: "你感知到的很多，却总要确认足够安全，才愿意真正把它带出来。",
  aha: ["谨慎保护过你，也在消耗你"],
  previews: { map: { s0: { preview: "你需要先想清楚，才愿意说出来。", keyInsights: ["确定之后才带出来"] } } }
};

function main() {
  const res = Astro.computeNatalChart(BIRTH);
  const natal = res.chart;

  const report = CE.build({
    evidence: { chart: natal, themes: THEMES },
    context:  { lifeThreads: THREAD }
  });
  const diversity = CE.diversityCheck(report);

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ report, diversity }, null, 2));
    return;
  }

  const line = (s) => console.log(s);
  const rule = () => line("─".repeat(72));

  line("我的内在指南 · 证据抽取原型报告");
  line("测试盘:" + BIRTH.date + " " + BIRTH.time + " " + BIRTH.place.city);
  rule();
  line("资料角色");
  Object.keys(report.inputRoles).forEach(k => line("  " + k.padEnd(12) + report.inputRoles[k]));
  line("  排除的来源:" + report.excludedSources.join(", "));
  rule();

  const fams = {};
  CE.PATTERN_RULES.forEach(r => { fams[r.family] = (fams[r.family] || 0) + 1; });
  line("规则表:" + report.ruleCount + " 条  " +
    Object.keys(fams).map(f => f + "(" + fams[f] + ")").join("  "));
  rule();
  line("① 原始盘面讯号  共 " + report.signalCount + " 条");
  report.signals.forEach(s =>
    line("  [" + s.structure.padEnd(18) + "] " + s.detail.padEnd(40) + " tags: " + s.tags.join(",")));
  rule();

  line("② 候选模式");
  report.candidates
    .slice().sort((a, b) => b.strength - a.strength)
    .forEach(c => {
      line("");
      line("  " + c.patternKey + "   [" + c.status.toUpperCase() + "]  strength=" + c.strength);
      line("    domain            " + c.domain);
      line("    mechanismFamily   " + c.mechanismFamily);
      line("    summary           " + String(c.summary).slice(0, 88));
      line("    compass           primary=" + c.compassRelevance.primary +
           (c.compassRelevance.secondary ? "  secondary=" + c.compassRelevance.secondary : ""));
      line("    独立盘面证据      " + c.independentEvidenceCount +
           "   (不同盘面物件 " + c.distinctActorCount + ")");
      line("    needs 命中        " + c.needGroupsHit + "/" + c.needGroupsTotal);
      line("    主题支持          " + (c.supportingSources.length ? c.supportingSources.join(", ") : "无") +
           "   ← 不计入独立证据");
      line("    生命脉络          " + (c.contextualSources.length ? c.contextualSources.join(", ") : "无") +
           "   ← 只当脉络,永不计数");
      if (c.rejectionReason) line("    拒绝原因          " + c.rejectionReason);
      if (c.duplicateOf) line("    重複于            " + c.duplicateOf);
      if (c.contradictionSignals.length)
        c.contradictionSignals.forEach(t =>
          line("    张力              " + t.patternA + " ↔ " + t.patternB +
               "  bothStrong=" + t.bothStrong + "  " + t.resolution));
      line("    证据明细");
      c.sourceSignals.forEach(s =>
        line("      · " + s.sourceType.padEnd(10) + s.role.padEnd(11) +
             (s.countsTowardIndependentEvidence ? "计入" : "不计入") + "  " +
             String(s.rawSignal).slice(0, 46) +
             (s.circularityBlocked ? "   ⚠ circularity blocked" : "")));
    });
  rule();

  const by = (st) => report.candidates.filter(c => c.status === st).map(c => c.patternKey);
  line("③ 分类结果");
  line("  accepted    " + (by("accepted").join(", ") || "（无）"));
  line("  provisional " + (by("provisional").join(", ") || "（无）"));
  line("  rejected    " + (by("rejected").join(", ") || "（无）"));
  rule();

  line("④ 张力");
  if (!report.tensions.length) line("  （没有侦测到对立家族）");
  report.tensions.forEach(t =>
    line("  " + t.familyA + " ↔ " + t.familyB +
         "   A=" + t.strengthA + " B=" + t.strengthB +
         "  bothStrong=" + t.bothStrong + "  → " + t.resolution));
  rule();

  line("⑤ Composite pattern");
  report.composites.forEach(cp => {
    line("  " + cp.compositeKey + "  [" + cp.status.toUpperCase() + "]" +
         (cp.status === "accepted" ? "  strength=" + cp.strength : "  " + cp.rejectionReason));
    line("    children   " + cp.childPatterns.join(" + ") +
         "  (" + Object.keys(cp.childStrengths).map(k => k + ":" + cp.childStrengths[k]).join(", ") + ")");
    line("    sequence   " + cp.sequence.join(" → "));
    line("    方向       " + cp.primaryCompassDirection);
    line("    证据联集   " + cp.independentEvidenceCount + " 个独立结构");
    line("    张力以顺序化解  " + cp.contradictionResolvedAsSequence);
    line("    验证       " + JSON.stringify({
      bothStrong: cp.checks.bothChildrenStrong, sharedActors: cp.checks.sharedActors,
      distinctKeysEach: cp.checks.distinctKeysEach, unionExceedsBest: cp.checks.unionExceedsBest }));
  });
  rule();

  line("⑥ 每个方向的状态");
  CE.DIRECTIONS.forEach(d => {
    const st = report.directionStatus[d];
    line("  " + d.padEnd(9) + st.status.toUpperCase() +
         (st.topPatternKey ? "   top=" + st.topPatternKey + "  accepted=" + st.acceptedCount : "") +
         (st.note ? "\n             " + st.note : ""));
  });
  rule();

  line("⑦ 四个方向目前的候选(只列 accepted)");
  CE.DIRECTIONS.forEach(d => {
    const rows = report.byDirection[d];
    line("  " + d.padEnd(9) + (rows.length
      ? rows.map(r => r.patternKey + "(" + r.strength + "/" + r.family + ")").join(", ")
      : "（无 accepted 候选）"));
  });
  rule();

  line("⑧ 多样性检查");
  line("  通过:" + diversity.ok);
  line("  各方向首选的机制家族:" + (diversity.pickedFamilies.join(", ") || "（无）"));
  if (!diversity.ok)
    diversity.clashes.forEach(c =>
      line("  ⚠ 家族 " + c.family + " 同时是 " + c.directions.join(" 与 ") + " 的首选 → 其中一个必须换"));
  rule();
  line("本报告只在开发时执行。没有呼叫任何 API,没有产生任何给使用者看的文字。");
}

main();
