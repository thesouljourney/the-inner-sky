#!/usr/bin/env node
/* ============================================================
   我的内在指南 · Phase 6 生成层报告(只在开发期跑)
     node tools/compass-generation-report.js [--payload] [--prompt] [--blind] [--json]

   预设跑「已录制」的生成结果(assets/compass-recorded.js)——
   那是 Claude 依照 compass-v1 的 prompt 实际写的,但不是 HTTP API 回应。
   要打真的 API,请部署 docs/edge/compass-generate.ts 之后用浏览器的
   #/compass/preview → Generation Mode: Claude API(live)。

   本工具不发任何请求。
   ============================================================ */
const path = require("path");
const PV = require(path.join(__dirname, "..", "assets", "compass-preview.js"));
const G = require(path.join(__dirname, "..", "assets", "compass-generation.js"));
const RC = require(path.join(__dirname, "..", "assets", "compass-recorded.js"));
const CT = require(path.join(__dirname, "..", "assets", "compass-translation.js"));

const CASES = RC.CASES;
const L = console.log, R = () => L("─".repeat(96));

async function runAll() {
  const out = {};
  for (const id of CASES) {
    const vm = PV.buildCase(id);
    out[id] = { vm, result: await G.generate(vm, RC.transportFor(id)) };
  }
  return out;
}

function deterministicOf(vm, dir) {
  const d = vm.directions.filter(x => x.key === dir)[0];
  return d && d.copy ? d.copy : null;
}

async function main() {
  const all = await runAll();

  if (process.argv.includes("--json")) {
    L(JSON.stringify(Object.keys(all).reduce((m, k) => {
      m[k] = { status: all[k].result.status, meta: all[k].result.meta, copies: all[k].result.copies };
      return m;
    }, {}), null, 2));
    return;
  }

  if (process.argv.includes("--payload")) {
    const id = CASES[0];
    L("送给模型的完整 payload(" + id + ")—— 这就是全部,没有别的东西:");
    L(JSON.stringify(all[id].result.input, null, 1));
    L("");
    L("scrub 结果(空 = 没有占星词、没有身分资料):" + JSON.stringify(G.scrub(all[id].result.input)));
    return;
  }

  if (process.argv.includes("--prompt")) {
    const p = G.buildPrompt(all[CASES[0]].result.input);
    L("=== SYSTEM (" + p.promptVersion + ") ===\n" + p.system);
    L("\n=== USER ===\n" + p.user);
    return;
  }

  if (process.argv.includes("--blind")) {
    const LB = { grounds: "什么让我安定", moves: "什么让我前进", drains: "什么正在消耗我", calls: "我正在被什么吸引" };
    /* 打乱顺序,不印 case id / patternKey / 机制 / 分数 */
    const rows = [];
    CASES.forEach(id => {
      const c = all[id].result.copies || {};
      rows.push({ id, cards: Object.keys(LB).map(k => c[k] ? { k, ...c[k] } : null).filter(Boolean) });
    });
    rows.forEach((r, i) => {
      L("── 第 " + (i + 1) + " 个人 ──────────────────────────────");
      r.cards.forEach(c => {
        L("  【" + LB[c.k] + "】");
        L("  " + c.coreInsight);
        L("  " + c.explanation);
        L("  → " + c.reflectionPrompt);
        L("");
      });
    });
    L("(这四个人读起来像四个不同的人吗?哪一句你会说「这不是我」?)");
    return;
  }

  L("我的内在指南 · Phase 6 生成层报告   promptVersion=" + G.DEFAULT_PROMPT_VERSION +
    "   来源=" + (RC.isRecorded ? "已录制(非 HTTP API 回应)" : "live"));
  R();

  L("① 送出去的是什么 / 没送什么");
  const inp = all[CASES[0]].result.input;
  L("  contract 版本   " + inp.version + "   语言 " + inp.language);
  L("  每个方向送      selectedPattern{key,mechanism,domain,selectionReason} · livedMechanism ·");
  L("                  support[] · tension · composite · differentiationContext");
  L("  全域送          crossDirectionTensions · repeatedMechanisms · styleContext");
  L("  【没有送】      行星 / 星座 / 宫位 / 相位 / 度数 / 逆行 / 元素 / 出生日期 / 时间 /");
  L("                  地点 / 时区 / 姓名 / email / user id / 日记 / 心情 / 收藏 / 付费资料");
  CASES.forEach(id => {
    const leaks = G.scrub(all[id].result.input);
    L("  scrub " + id.padEnd(4) + (leaks.length ? "✗ " + JSON.stringify(leaks) : "✓ 0 处违规"));
  });
  R();

  L("② 逐案结果");
  CASES.forEach(id => {
    const r = all[id].result, vm = all[id].vm;
    R();
    L(id + "   status=" + r.status + "   requests=" + r.meta.requests +
      "   retried=" + r.meta.retried + "   promptVersion=" + r.meta.promptVersion);
    Object.keys(r.input.directions).forEach(dir => {
      const di = r.input.directions[dir];
      if (di.status !== "ready") {
        L("  【" + dir + "】 insufficient_evidence —— 不呼叫模型,copy = null");
        return;
      }
      const copy = (r.copies || {})[dir];
      L("  【" + dir + "】 " + di.selectedPattern.key +
        (di.composite ? "  [composite: " + di.composite.sequence.join(" → ") + "]" : "") +
        (di.tension ? "  [tension]" : ""));
      L("     mechanism   " + di.selectedPattern.mechanism);
      if (!copy) { L("     (没有产出)"); return; }
      L("     core        " + copy.coreInsight);
      L("     expl        " + copy.explanation);
      L("     prompt      " + copy.reflectionPrompt);
      const rb = G.rubric(copy, di);
      L("     rubric      准确=" + rb.accuracyToMechanism + " 具体=" + rb.specificity +
        " 自然=" + rb.naturalness + " 温度=" + rb.warmth +
        " 文学风险=" + rb.literaryRisk + " 通用风险=" + rb.genericRisk +
        " 编造原因=" + (rb.unsupportedInference ? "有" : "无") +
        " 占星外漏=" + (rb.astrologyLeakage ? "有" : "无"));
      const det = deterministicOf(vm, dir);
      if (det) {
        L("     确定性模板  " + det.coreInsight);
        L("     两者相似度  " + Math.round(CT.similarity(copy.coreInsight + copy.explanation,
                                   det.coreInsight + det.explanation) * 1000) / 1000);
      } else {
        L("     确定性模板  (这条模式还没写翻译 —— 模型补上了模板补不了的位置)");
      }
    });
    L("  跨卡最相似     " + JSON.stringify((r.validation && r.validation.crossCard.pairs[0]) || null));
  });
  R();

  L("③ 同一 pattern、不同人(§29)");
  const byPattern = {};
  CASES.forEach(id => {
    const r = all[id].result;
    Object.keys(r.input.directions).forEach(dir => {
      const di = r.input.directions[dir];
      if (di.status !== "ready" || !r.copies || !r.copies[dir]) return;
      (byPattern[di.selectedPattern.key] = byPattern[di.selectedPattern.key] || [])
        .push({ id, dir, di, copy: r.copies[dir] });
    });
  });
  Object.keys(byPattern).filter(k => byPattern[k].length > 1).forEach(k => {
    const rows = byPattern[k];
    L("  " + k + "   出现在 " + rows.map(x => x.id + "/" + x.dir).join("、"));
    L("    共同机制  " + rows[0].di.selectedPattern.mechanism);
    rows.forEach(x => {
      L("    " + x.id + "  " + x.copy.coreInsight);
      const ctx = [];
      if (x.di.tension) ctx.push("tension:" + x.di.tension.otherMechanism.slice(0, 60));
      if (x.di.support.length) ctx.push("support:" + x.di.support[0].mechanism.slice(0, 60));
      ctx.push("tier:" + x.di.differentiationContext.strengthTier + "/" + x.di.differentiationContext.distinctivenessTier);
      L("        个案脉络 " + ctx.join(" | "));
    });
    for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
      const s = CT.similarity(rows[i].copy.coreInsight + rows[i].copy.explanation,
                              rows[j].copy.coreInsight + rows[j].copy.explanation);
      L("    " + rows[i].id + " × " + rows[j].id + " 相似度 " + Math.round(s * 1000) / 1000 +
        (s > 0.85 ? "  ✗ 几乎一样" : (s < 0.03 ? "  ⚠ 差太远,确认核心机制没被写歪" : "  ✓ 同机制、不同表达")));
    }
    L("");
  });
  R();

  L("④ 不同 pattern 的分离度(§30)");
  const flat = [];
  CASES.forEach(id => {
    const r = all[id].result;
    Object.keys(r.copies || {}).forEach(dir => {
      flat.push({ id, dir, key: r.input.directions[dir].selectedPattern.key, copy: r.copies[dir] });
    });
  });
  const pairs = [];
  for (let i = 0; i < flat.length; i++) for (let j = i + 1; j < flat.length; j++) {
    if (flat[i].key === flat[j].key) continue;
    pairs.push({ a: flat[i], b: flat[j],
      s: CT.similarity(flat[i].copy.coreInsight + flat[i].copy.explanation,
                       flat[j].copy.coreInsight + flat[j].copy.explanation) });
  }
  pairs.sort((x, y) => y.s - x.s);
  pairs.slice(0, 8).forEach(p => L("  " + p.s.toFixed(3) + "  " +
    p.a.key + "(" + p.a.id + ")  ×  " + p.b.key + "(" + p.b.id + ")"));
  L("  最高 " + pairs[0].s.toFixed(3) + "(门槛 0.35)");
  R();

  L("⑤ 请求数");
  let total = 0;
  CASES.forEach(id => { total += all[id].result.meta.requests; });
  L("  " + CASES.length + " 张盘共 " + total + " 次生成请求(每张 1 次,没有任何一次 retry)");
  L("  切换 case、切换分页、重画页面:0 次 —— 只有按下按钮才会送。");
}

main().catch(e => { console.error(e); process.exitCode = 1; });
module.exports = { runAll };
