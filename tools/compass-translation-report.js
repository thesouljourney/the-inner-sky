#!/usr/bin/env node
/* ============================================================
   我的内在指南 · Phase 4 人话翻译报告(只在开发期跑)
   node tools/compass-translation-report.js [--json] [--blind]

   这份报告要证明的事:
     selection 层选出来的内部机制,能不能稳定地翻成
     自然、具体、简单、有温度,但不文学 / 不玄学 / 不诊断的使用者语言。

   ⚠ 不呼叫任何 API、不碰资料库、不改产品 UI、
     不读日记 / 心情 / 收藏、不新增任何 pattern rule。
   ============================================================ */
const path = require("path");
const Astro = require(path.join(__dirname, "..", "assets", "astro", "astro-core.js"));
const CE = require(path.join(__dirname, "..", "assets", "compass-evidence.js"));
const CS = require(path.join(__dirname, "..", "assets", "compass-selection.js"));
const CT = require(path.join(__dirname, "..", "assets", "compass-translation.js"));

/* 与 Phase 3 同一组测试盘 —— 刻意不换 test set。 */
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

const RULE_BY_KEY = {};
CE.PATTERN_RULES.forEach(r => { RULE_BY_KEY[r.patternKey] = r; });
const COMPOSITE_BY_KEY = {};
CE.COMPOSITE_RULES.forEach(r => { COMPOSITE_BY_KEY[r.compositeKey] = r; });

function mechanismOf(key) {
  const r = RULE_BY_KEY[key] || COMPOSITE_BY_KEY[key];
  return r ? r.mechanism : null;
}

function run() {
  const cases = CASES.map(([caseId, d, t, lat, lon, tz]) => {
    const natal = Astro.computeNatalChart({ date: d, time: t, place: { lat, lon, tzId: tz } }).chart;
    return { caseId, report: CE.build({ evidence: { chart: natal, themes: {} }, context: {} }) };
  });
  const corpus = CS.buildCorpus(cases);
  cases.forEach(c => { c.selection = CS.select(c.report, corpus); });

  /* 每张盘、每个方向 → 翻译 */
  cases.forEach(c => {
    c.translated = {};
    CS.DIRECTIONS.forEach(dir => {
      const d = c.selection.directions[dir];
      if (!d || d.status !== "selected" || !d.primary) {
        c.translated[dir] = CT.translate({ status: "insufficient_evidence", primaryDirection: dir });
        return;
      }
      c.translated[dir] = CT.translate({
        patternKey: d.primary.key,
        kind: d.primary.kind,
        primaryDirection: dir,
        mechanism: mechanismOf(d.primary.key),
        strength: d.primary.parts.evidenceStrength,
        distinctiveness: d.primary.parts.personalDistinctiveness
      });
    });
  });
  return { cases, corpus };
}

/* 「为什么这句是具体的」/「为什么这句不是通用的」—— 从实际检查结果推,不是手写标语 */
function whySpecific(t) {
  const out = [];
  if (t.qualityChecks.concreteBehaviourPresent) out.push("写的是某个时刻会发生的事(有时间点 + 有动作),不是性格形容");
  if (t.livedExperience) out.push("对应到一条可描述的生活行为:" + t.livedExperience);
  if (t.sequence) out.push("讲的是顺序(" + t.sequence.join(" → ") + "),不是两个特质并列");
  if (t.internalMechanism) out.push("可以回溯到内部机制,不是凭空写的一句好听话");
  return out;
}
function whyNotGeneric(t, freq) {
  const out = [];
  out.push("没有出现任何套话(" + (t.qualityChecks.genericTerms.length ? t.qualityChecks.genericTerms.join("、") : "0 个") + ")");
  if (freq != null) {
    out.push(freq.count >= freq.tested
      ? "⚠ 这条模式在 10 张测试盘里 accepted " + freq.count + "/" + freq.tested +
        " —— 证据够强,但太普遍;文案本身不算通用,可是它不构成「只有你」的说法"
      : "这条模式在 10 张测试盘里 accepted " + freq.count + "/" + freq.tested + ",不是人人都会拿到");
  }
  out.push("句子里有可以否认的内容 —— 不符合的人会说「我不是这样」");
  return out;
}

function main() {
  const { cases, corpus } = run();
  const L = console.log, R = () => L("─".repeat(96));

  if (process.argv.includes("--json")) {
    L(JSON.stringify({
      cases: cases.map(c => ({ caseId: c.caseId, translated: c.translated })),
      separation: CT.separationCheck(),
      coverage: coverage(cases)
    }, null, 2));
    return;
  }

  /* 盲测语言检查:只印文案,不印任何 pattern key / 机制 */
  if (process.argv.includes("--blind")) {
    const seen = {};
    cases.forEach(c => CS.DIRECTIONS.forEach(dir => {
      const t = c.translated[dir];
      if (t.status !== "ok" || seen[t.patternKey]) return;
      seen[t.patternKey] = true;
      L("· " + t.coreInsight);
      L("  " + t.explanation);
      L("  → " + t.reflectionPrompt);
      L("");
    }));
    L("(共 " + Object.keys(seen).length + " 段。看得出这是星盘生成的吗?看得出这是同一个模板吗?)");
    return;
  }

  L("我的内在指南 · Phase 4 人话翻译原型  (" + cases.length + " 张测试盘;规则冻结,不新增 API 呼叫)");
  R();

  const freq = {};
  corpus.matrix.rows.forEach(r => { freq[r.patternKey] = { count: r.acceptedCount, tested: r.testedCharts }; });

  L("① 逐条翻译(每张盘 × 四个方向,只印第一次出现的模式)");
  const printed = {};
  cases.forEach(c => {
    CS.DIRECTIONS.forEach(dir => {
      const t = c.translated[dir];
      if (t.status === "insufficient_evidence") return;
      if (t.status === "not_translated") return;
      if (printed[t.patternKey]) return;
      printed[t.patternKey] = true;
      R();
      L("Pattern           " + t.patternKey + "  [" + t.kind + "]  ← " + c.caseId + " / " + dir);
      L("Mechanism         " + wrap(t.internalMechanism || "(未提供)", 18));
      L("Lived experience  " + wrap(t.livedExperience, 18));
      L("");
      L("  Core insight    " + t.coreInsight);
      L("  Explanation     " + wrap(t.explanation, 18));
      L("  Prompt          " + t.reflectionPrompt);
      L("");
      const q = t.qualityChecks;
      L("  Quality flags   astrologyLeak=" + q.astrologyLeak +
        "  genericRisk=" + q.genericRisk +
        "  literaryRisk=" + q.literaryRisk +
        "  labelRisk=" + q.labelRisk +
        "  diagnosticLeak=" + q.diagnosticLeak);
      L("                  长度 core=" + q.coreLen + "(15-35) expl=" + q.explLen + "(70-130)" +
        "  mechanismTraceable=" + q.mechanismTraceable +
        "  recognitionPotential=" + q.recognitionPotential);
      L("");
      L("  WHY THIS IS SPECIFIC");
      whySpecific(t).forEach(s => L("    · " + s));
      L("  WHY THIS IS NOT GENERIC");
      whyNotGeneric(t, freq[t.patternKey]).forEach(s => L("    · " + s));
    });
  });
  R();

  L("② 覆盖率:selection 选出来但还没写翻译的模式");
  const cov = coverage(cases);
  if (!cov.untranslated.length) L("   (无)");
  cov.untranslated.forEach(k => L("   " + k.key.padEnd(34) + "被选中 " + k.picks + " 次 —— 如实回报 not_translated,不硬凑"));
  L("   已翻译 " + cov.translatedPicks + " / 被选中 " + cov.totalPicks + " 次");
  const authored = Object.keys(CT.TRANSLATIONS).concat(Object.keys(CT.COMPOSITES));
  const unused = authored.filter(k => !printed[k]);
  if (unused.length) {
    L("   已写好翻译、但这 10 张盘里没被选成 primary 的:");
    unused.forEach(k => L("     " + k + "  (仍然跑全表护栏,见 ⑤)"));
  }
  R();

  L("③ 证据不足的方向:不生成文案(copy = null)");
  let insufficient = 0;
  cases.forEach(c => CS.DIRECTIONS.forEach(dir => {
    if (c.translated[dir].status === "insufficient_evidence") {
      insufficient++;
      L("   " + c.caseId + " / " + dir + "  → status=insufficient_evidence, copy=null");
    }
  }));
  if (!insufficient) L("   (无)");
  R();

  L("④ 模式之间的分离度(最像的前 8 对;同一个模板换几个词会在这里露馅)");
  CT.separationCheck().slice(0, 8).forEach(p =>
    L("   " + String(p.similarity).padStart(5) + "  " + p.a + "  ×  " + p.b));
  R();

  L("⑤ 全表护栏");
  const all = Object.assign({}, CT.TRANSLATIONS, CT.COMPOSITES, CT.TENSIONS);
  let bad = 0;
  Object.keys(all).forEach(k => {
    const q = CT.checkCopy(all[k].zh);
    const ok = !q.astrologyLeak && !q.diagnosticLeak && q.genericRisk !== "high" &&
      q.literaryRisk !== "high" && q.labelRisk !== "high" &&
      q.coreLenOk && q.explLenOk && q.promptIsQuestion && q.concreteBehaviourPresent;
    if (!ok) { bad++; L("   ✗ " + k + "  " + JSON.stringify(q)); }
  });
  L(bad ? "   " + bad + " 条未过" : "   " + Object.keys(all).length + " 条全部通过");
}

function coverage(cases) {
  const picks = {}, untrans = {};
  let total = 0, translated = 0;
  cases.forEach(c => CS.DIRECTIONS.forEach(dir => {
    const t = c.translated[dir];
    if (t.status === "insufficient_evidence") return;
    total++;
    if (t.status === "ok") { translated++; picks[t.patternKey] = (picks[t.patternKey] || 0) + 1; }
    else untrans[t.patternKey] = (untrans[t.patternKey] || 0) + 1;
  }));
  return {
    totalPicks: total, translatedPicks: translated,
    untranslated: Object.keys(untrans).sort().map(k => ({ key: k, picks: untrans[k] }))
  };
}

function wrap(s, indent) {
  s = String(s == null ? "" : s);
  const pad = " ".repeat(indent), width = 76;
  const out = [];
  for (let i = 0; i < s.length; i += width) out.push(s.slice(i, i + width));
  return out.join("\n" + pad);
}

if (require.main === module) main();
module.exports = { run, coverage };
