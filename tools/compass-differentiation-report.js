#!/usr/bin/env node
/* ============================================================
   我的内在指南 · Phase 3 差异化报告(只在开发期跑)
   node tools/compass-differentiation-report.js [--json]
   不呼叫任何 API、不碰资料库、不读日记 / 心情 / 收藏。
   ============================================================ */
const path = require("path");
const Astro = require(path.join(__dirname, "..", "assets", "astro", "astro-core.js"));
const CE = require(path.join(__dirname, "..", "assets", "compass-evidence.js"));
const CS = require(path.join(__dirname, "..", "assets", "compass-selection.js"));

/* 10 张结构明显不同的测试盘。只是确定性的出生资料,不是任何真实使用者。 */
const CASES = [
  ["C1",  "1994-11-21", "01:44",   1.8548, 102.9325, "Asia/Kuala_Lumpur"],
  ["C2",  "1988-03-02", "14:20",  25.0330, 121.5654, "Asia/Taipei"],
  ["C3",  "1975-07-09", "06:05",  51.5072,  -0.1276, "Europe/London"],
  ["C4",  "2001-12-30", "23:10",  40.7128, -74.0060, "America/New_York"],
  ["C5",  "1969-05-17", "09:40", -33.8688, 151.2093, "Australia/Sydney"],
  ["C6",  "1983-09-28", "18:55",   3.1390, 101.6869, "Asia/Kuala_Lumpur"],
  ["C7",  "1996-02-14", "04:15",  35.6762, 139.6503, "Asia/Tokyo"],
  ["C8",  "1979-08-23", "12:00",  48.8566,   2.3522, "Europe/Paris"],
  ["C9",  "2006-04-05", "20:30", -23.5505, -46.6333, "America/Sao_Paulo"],
  ["C10", "1962-10-11", "16:45",  19.0760,  72.8777, "Asia/Kolkata"]
];

function run() {
  // ① 先各自跑证据层(themes / lifeThreads 一律留空:这一阶段只测盘面差异)
  const cases = CASES.map(([caseId, d, t, lat, lon, tz]) => {
    const natal = Astro.computeNatalChart({ date: d, time: t, place: { lat, lon, tzId: tz } }).chart;
    return { caseId, report: CE.build({ evidence: { chart: natal, themes: {} }, context: {} }) };
  });
  // ② 跨盘语料 → distinctiveness
  const corpus = CS.buildCorpus(cases);
  // ③ 各自做选择
  cases.forEach(c => { c.selection = CS.select(c.report, corpus); });
  const pairs = CS.pairwise(cases);
  const diff = CS.differentiationCheck(cases);
  return { cases, corpus, pairs, diff };
}

function main() {
  const { cases, corpus, pairs, diff } = run();
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({
      matrix: corpus.matrix, stats: corpus.stats, diff, pairs,
      cases: cases.map(c => ({ caseId: c.caseId, selection: c.selection }))
    }, null, 2));
    return;
  }
  const L = console.log, R = () => L("─".repeat(100));
  const ids = corpus.matrix.caseIds;

  L("我的内在指南 · Phase 3 差异化与选择  (" + cases.length + " 张测试盘,27 条规则冻结)");
  R();

  L("① 跨盘矩阵   A=accepted  P=provisional  R=rejected  —=未触发");
  L("  " + "pattern".padEnd(34) + ids.map(i => i.padStart(4)).join("") + "   accepted  trigger  distinct");
  corpus.matrix.rows.forEach(r => {
    const st = corpus.stats[r.patternKey];
    L("  " + r.patternKey.padEnd(34) +
      ids.map(i => r.cells[i].padStart(4)).join("") +
      "   " + r.acceptedFrequency.toFixed(2).padStart(7) +
      "  " + r.triggerFrequency.toFixed(2).padStart(7) +
      "  " + st.distinctiveness.value.toFixed(2).padStart(7) +
      (st.distinctiveness.flags.length ? "  " + st.distinctiveness.flags.join(",") : ""));
  });
  R();

  L("② 频率排序");
  const byAcc = corpus.matrix.rows.slice().sort((a, b) => b.acceptedFrequency - a.acceptedFrequency);
  L("  最常 accepted:");
  byAcc.slice(0, 5).forEach(r => L("    " + r.patternKey.padEnd(34) + r.acceptedCount + "/" + r.testedCharts));
  L("  从未 accepted(但触发过):");
  byAcc.filter(r => r.acceptedCount === 0 && r.triggerCount > 0)
    .forEach(r => L("    " + r.patternKey.padEnd(34) + "触发 " + r.triggerCount + "/" + r.testedCharts));
  L("  从未触发:");
  const never = byAcc.filter(r => r.triggerCount === 0);
  never.length ? never.forEach(r => L("    " + r.patternKey)) : L("    （无）");
  R();

  L("③ 每张盘的四向选择");
  cases.forEach(c => {
    L("");
    L("  " + c.caseId);
    CS.DIRECTIONS.forEach(d => {
      const dd = c.selection.directions[d];
      if (dd.status !== "selected") {
        L("    " + d.padEnd(8) + "INSUFFICIENT_EVIDENCE   " + (dd.note || ""));
        return;
      }
      L("    " + d.padEnd(8) + dd.primary.key + "  [" + dd.primary.kind + "]  score=" +
        dd.primary.parts.selectionScore);
      L("             why: " + dd.primary.why);
      if (dd.runnerUp)
        L("             runner-up: " + dd.runnerUp.key + " (" + dd.runnerUp.parts.selectionScore +
          ") — " + dd.runnerUp.whyNot);
    });
  });
  R();

  L("④ 差异化体检  (同一个 pattern 被选中的比例 ≥ " + diff.threshold + " 就算失败)");
  CS.DIRECTIONS.forEach(d => {
    const p = diff.perDirection[d];
    L("  " + d.padEnd(8) +
      "不同选择 " + String(p.distinctSelections).padStart(2) + " 种" +
      "   最常选 " + String(p.modeKey || "—").padEnd(30) +
      " " + (p.modeCount + "/" + cases.length).padStart(5) +
      "  share=" + p.modeShare.toFixed(2) +
      "  insufficient=" + p.insufficientCount +
      "  avgEvidence=" + p.averageTopEvidence +
      (p.failure ? "   ✗ FAILURE" : "   ✓"));
  });
  L("  判定:" + diff.verdict + (diff.failingDirections.length ? "  → " + diff.failingDirections.join(", ") : ""));
  R();

  L("⑤ 两两相似度(Jaccard,只比 signature,不看出生资料)");
  L("  最相似:");
  pairs.slice(0, 3).forEach(p => L("    " + p.a + " ↔ " + p.b + "   " + p.similarity.toFixed(3)));
  L("  最不相似:");
  pairs.slice(-3).reverse().forEach(p => L("    " + p.a + " ↔ " + p.b + "   " + p.similarity.toFixed(3)));
  const avg = pairs.reduce((s, p) => s + p.similarity, 0) / pairs.length;
  L("  平均:" + avg.toFixed(3) + "   共 " + pairs.length + " 组");
  R();

  L("⑥ Blind signature test —— 只看选出来的四向机制,不看任何出生资料");
  cases.forEach(c => {
    const s = c.selection.signature.selected;
    L("  " + c.caseId.padEnd(5) +
      CS.DIRECTIONS.map(d => (s[d] || "—")).map(x => x.slice(0, 24).padEnd(26)).join(""));
  });
  R();
  L("全部为开发期产物。没有任何一项会显示给使用者。");
}

main();
