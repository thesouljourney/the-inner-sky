#!/usr/bin/env node
/* Phase 3.5 诊断:为什么某些规则从来不通过。只读不写,不改任何规则。 */
const path = require("path");
const Astro = require(path.join(__dirname, "..", "assets", "astro", "astro-core.js"));
const CE = require(path.join(__dirname, "..", "assets", "compass-evidence.js"));

const CASES = [
  ["C1","1994-11-21","01:44",1.8548,102.9325,"Asia/Kuala_Lumpur"],
  ["C2","1988-03-02","14:20",25.033,121.5654,"Asia/Taipei"],
  ["C3","1975-07-09","06:05",51.5072,-0.1276,"Europe/London"],
  ["C4","2001-12-30","23:10",40.7128,-74.006,"America/New_York"],
  ["C5","1969-05-17","09:40",-33.8688,151.2093,"Australia/Sydney"],
  ["C6","1983-09-28","18:55",3.139,101.6869,"Asia/Kuala_Lumpur"],
  ["C7","1996-02-14","04:15",35.6762,139.6503,"Asia/Tokyo"],
  ["C8","1979-08-23","12:00",48.8566,2.3522,"Europe/Paris"],
  ["C9","2006-04-05","20:30",-23.5505,-46.6333,"America/Sao_Paulo"],
  ["C10","1962-10-11","16:45",19.076,72.8777,"Asia/Kolkata"]
];
const TARGET = process.argv[2] ? [process.argv[2]] : null;

const charts = CASES.map(([id,d,t,la,lo,tz]) => ({
  id, natal: Astro.computeNatalChart({ date:d, time:t, place:{lat:la,lon:lo,tzId:tz} }).chart
}));
const reports = charts.map(c => ({ id:c.id, natal:c.natal,
  report: CE.build({ evidence:{ chart:c.natal, themes:{} }, context:{} }) }));

/* 每条规则在每张盘上,哪一组 needs 命中、哪一组没中 */
function groupsFor(rule, natal) {
  const signals = CE.extractChartSignals(natal);
  return rule.needs.map(g => {
    const hit = signals.filter(s => s.tags.some(t => g.indexOf(t) >= 0));
    return { size: hit.length, keys: [...new Set(hit.map(s => s.independenceKey))] };
  });
}

const rules = CE.PATTERN_RULES.filter(r =>
  TARGET ? TARGET.indexOf(r.patternKey) >= 0 || TARGET.indexOf(r.family) >= 0 : true);

console.log("规则诊断  (10 张盘,规则未改动)");
console.log("=".repeat(112));
rules.forEach(rule => {
  const rows = reports.map(r => {
    const c = r.report.candidates.find(x => x.patternKey === rule.patternKey);
    const g = groupsFor(rule, r.natal);
    return { id:r.id, cand:c, groups:g };
  });
  const acc = rows.filter(x => x.cand.status === "accepted").length;
  const prov = rows.filter(x => x.cand.status === "provisional").length;
  console.log("");
  console.log(rule.patternKey + "   [" + rule.family + "]  genericRisk=" + rule.genericRisk +
    "  minIndependent=" + (rule.minIndependent || (rule.genericRisk === "high" ? 3 : 2)) +
    "   A=" + acc + " P=" + prov);
  console.log("  needs 组:");
  rule.needs.forEach((g,i) => console.log("    g" + i + ": " + g.join(", ")));
  console.log("  " + "盘".padEnd(5) + "状态".padEnd(13) + "分".padEnd(4) + "独立".padEnd(5) +
    "物件".padEnd(5) + "组命中".padEnd(8) + "各组独立键数      卡在哪");
  rows.forEach(x => {
    const c = x.cand;
    const per = x.groups.map(g => g.keys.length).join("/");
    let block = "";
    if (c.status === "accepted") block = "—";
    else if (c.rejectionReason) block = c.rejectionReason;
    else if (c.needGroupsHit < c.needGroupsTotal) block = "needs 未全中";
    else block = "分数不足(" + c.strength + " < 7)";
    console.log("  " + x.id.padEnd(5) + c.status.padEnd(13) + String(c.strength).padEnd(4) +
      String(c.independentEvidenceCount).padEnd(5) + String(c.distinctActorCount).padEnd(5) +
      (c.needGroupsHit + "/" + c.needGroupsTotal).padEnd(8) + per.padEnd(18) + block);
  });
});
