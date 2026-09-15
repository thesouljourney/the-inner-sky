#!/usr/bin/env node
/* ============================================================
   我的内在指南 · Phase 6.1 真实 API 路径验证
   ------------------------------------------------------------
     node --experimental-strip-types tools/compass-live-check.js [选项]

   三种跑法:

     --stub            本机跑 docs/edge/compass-generate.ts,上游 Anthropic 换成
                       本地假回应。【不需要金钥、不花钱】。
                       验证:HTTP → Edge Function → 解析 → 11 道验证 这一段。
                       ⚠ 这【不是】 live API 验证,报告会明写。

     (预设)            本机跑同一份 .ts,上游打【真的】 api.anthropic.com。
                       需要环境变数 ANTHROPIC_API_KEY。
                       金钥只存在于 server 端行程,不会出现在任何输出里。

     --url <URL>       打【已部署】的 Edge Function(正式路径)。
                       需要 --anon <SUPABASE_ANON_KEY> 当 Authorization。

   其他:
     --all             C1 通过之后,再跑 C4 / C6 / C10(预设只跑 C1)
     --json            机器可读

   ⚠ 只读:不改任何规则、不写资料库、不碰 production。
   ============================================================ */
const path = require("path");
const PV = require(path.join(__dirname, "..", "assets", "compass-preview.js"));
const G  = require(path.join(__dirname, "..", "assets", "compass-generation.js"));
const RC = require(path.join(__dirname, "..", "assets", "compass-recorded.js"));

const argv = process.argv.slice(2);
const has = (f) => argv.indexOf(f) >= 0;
const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };

const MODE = has("--stub") ? "stub" : (val("--url") ? "deployed" : "local-live");
const CASES = has("--all") ? ["C1", "C4", "C6", "C10"] : ["C1"];

/* 绝不印出金钥。连长度都不印 —— 只说有没有。 */
function keyState() {
  const k = process.env.ANTHROPIC_API_KEY || "";
  return k ? "set (server-side env only)" : "not set";
}

function transportFor(endpoint, anon) {
  return function (p) {
    const t0 = Date.now();
    return fetch(endpoint, {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json" },
        anon ? { Authorization: "Bearer " + anon, apikey: anon } : {}),
      body: JSON.stringify({ input: p._input, system: p.system, user: p.user,
                             promptVersion: p.promptVersion })
    }).then(r => r.json().then(o => ({ o, http: r.status })))
      .then(({ o, http }) => {
        transportFor.last = { http, latencyMs: Date.now() - t0,
                              model: o && o.model, promptVersion: o && o.promptVersion,
                              usage: o && o.usage ? Object.keys(o.usage).length + " fields" : null };
        if (!o || o.status !== "ok" || typeof o.text !== "string")
          throw new Error("http " + http + " · " + ((o && (o.reason || o.error)) || "bad response"));
        return o.text;
      });
  };
}

async function main() {
  const out = { mode: MODE, key: keyState(), promptVersion: G.DEFAULT_PROMPT_VERSION,
                health: null, cases: [], totals: { requests: 0, retries: 0, latency: [] } };
  let endpoint = val("--url"), anon = val("--anon"), server = null, restore = null;

  if (MODE !== "deployed") {
    const { serveEdgeFunction, stubAnthropic } = require(path.join(__dirname, "deno-shim.js"));
    if (MODE === "local-live" && !process.env.ANTHROPIC_API_KEY) {
      console.error("没有 ANTHROPIC_API_KEY。要嘛设好环境变数,要嘛用 --stub(不打真 API)。");
      process.exit(2);
    }
    if (MODE === "stub") {
      /* 假上游:直接把已录制的那一段当成模型回应送回来 —— 只为了把传输路径走完 */
      let n = 0;
      restore = stubAnthropic(() => RC.textFor(CASES[Math.min(n++, CASES.length - 1)]));
    }
    server = await serveEdgeFunction(path.join(__dirname, "..", "docs", "edge", "compass-generate.ts"),
      { env: { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || (MODE === "stub" ? "stub-key" : "") } });
    endpoint = server.url;
  }

  /* ── 4 · health check(最小请求)───────────────────────── */
  const t0 = Date.now();
  const hr = await fetch(endpoint, { headers: anon ? { Authorization: "Bearer " + anon, apikey: anon } : {} });
  const hj = await hr.json().catch(() => null);
  out.health = { http: hr.status, latencyMs: Date.now() - t0,
                 fn: hj && hj.function, keySetOnServer: hj && hj.anthropic_key_set,
                 model: hj && hj.model };

  /* ── 5/6 · C1 先跑,失败就停 ───────────────────────────── */
  for (const id of CASES) {
    const vm = PV.buildCase(id);
    const tp = transportFor(endpoint, anon);
    /* live transport 需要 payload;与浏览器端同一个做法 */
    const wrapped = (p) => { p._input = G.buildInput(vm); return tp(p); };
    const t = Date.now();
    let r;
    try { r = await G.generate(vm, wrapped); }
    catch (e) { r = { status: "generation_failed", reason: String(e && e.message || e), meta: { requests: 1 } }; }
    const row = {
      case: id, status: r.status, reason: r.reason || null,
      requests: (r.meta && r.meta.requests) || 0,
      retried: !!(r.meta && r.meta.retried),
      totalMs: Date.now() - t,
      lastCall: transportFor.last || null,
      readyDirections: r.input ? Object.keys(r.input.directions)
        .filter(k => r.input.directions[k].status === "ready") : [],
      scrubLeaks: r.input ? G.scrub(r.input).length : null,
      perDirection: {}
    };
    if (r.status === "ok") {
      Object.keys(r.copies).forEach(k => {
        const v = r.validation.perDirection[k];
        row.perDirection[k] = {
          patternKey: r.input.directions[k].selectedPattern.key,
          coreInsight: r.copies[k].coreInsight,
          explanation: r.copies[k].explanation,
          reflectionPrompt: r.copies[k].reflectionPrompt,
          rubric: G.rubric(r.copies[k], r.input.directions[k]),
          checks: v && v.checks ? { coreLen: v.checks.coreLen, explLen: v.checks.explLen,
                                    genericRisk: v.checks.genericRisk, literaryRisk: v.checks.literaryRisk,
                                    labelRisk: v.checks.labelRisk } : null
        };
      });
      row.crossCardMax = r.validation.crossCard.pairs[0] || null;
    } else if (r.validation) {
      Object.keys(r.validation.perDirection).forEach(k => {
        const v = r.validation.perDirection[k];
        if (!v.ok) row.perDirection[k] = { fails: v.fails };
      });
    }
    out.cases.push(row);
    out.totals.requests += row.requests;
    if (row.retried) out.totals.retries++;
    if (row.lastCall) out.totals.latency.push(row.lastCall.latencyMs);

    if (r.status !== "ok") { row.stoppedHere = true; break; }   // §5:C1 失败就停,不继续烧 API
  }

  if (restore) restore();
  if (server) await server.close();

  if (has("--json")) { console.log(JSON.stringify(out, null, 2)); return; }
  print(out);
  process.exitCode = out.cases.every(c => c.status === "ok") ? 0 : 1;
}

function print(o) {
  const L = console.log, R = () => L("─".repeat(92));
  L("我的内在指南 · Phase 6.1 真实路径验证");
  R();
  L("模式            " + o.mode +
    (o.mode === "stub" ? "   ⚠ 上游是本地假回应 —— 这不是 live API 验证" : ""));
  L("ANTHROPIC_KEY   " + o.key + "   (只在 server 端行程,任何输出都不含金钥)");
  L("promptVersion   " + o.promptVersion);
  R();
  L("① Health check");
  L("  HTTP " + o.health.http + "  " + o.health.latencyMs + "ms  " + (o.health.fn || "") +
    "  keySetOnServer=" + o.health.keySetOnServer + "  model=" + o.health.model);
  R();
  o.cases.forEach(c => {
    L("② " + c.case + "   status=" + c.status + (c.reason ? "(" + c.reason + ")" : "") +
      "   requests=" + c.requests + "   retried=" + c.retried +
      "   totalMs=" + c.totalMs + (c.lastCall ? "   upstreamMs=" + c.lastCall.latencyMs : ""));
    L("   ready 方向 " + c.readyDirections.join("、") + "   scrub 违规 " + c.scrubLeaks);
    Object.keys(c.perDirection).forEach(k => {
      const d = c.perDirection[k];
      if (d.fails) { L("   【" + k + "】 ✗ " + JSON.stringify(d.fails)); return; }
      L("   【" + k + "】 " + d.patternKey);
      L("      " + d.coreInsight);
      L("      " + d.explanation);
      L("      → " + d.reflectionPrompt);
      L("      长度 core=" + d.checks.coreLen + " expl=" + d.checks.explLen +
        "  通用=" + d.checks.genericRisk + " 文学=" + d.checks.literaryRisk + " 标签=" + d.checks.labelRisk +
        "  编造原因=" + (d.rubric.unsupportedInference ? "有" : "无") +
        "  占星外漏=" + (d.rubric.astrologyLeakage ? "有" : "无"));
    });
    if (c.crossCardMax) L("   跨卡最相似 " + JSON.stringify(c.crossCardMax));
    if (c.stoppedHere) L("   ⚠ 这一张失败 —— 依 §5 就此停止,不继续送请求。");
    R();
  });
  const lat = o.totals.latency;
  L("③ 总计   请求 " + o.totals.requests + " 次   retry " + o.totals.retries + " 次   " +
    (lat.length ? "平均上游延迟 " + Math.round(lat.reduce((a, b) => a + b, 0) / lat.length) + "ms" : "无上游延迟纪录"));
  if (o.mode === "stub")
    L("   ⚠ stub 模式:Anthropic 那一段没有真的跑。live 结论不能用这一次的数据。");
}

main().catch(e => { console.error(e); process.exitCode = 1; });
