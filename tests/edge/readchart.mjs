// read-chart v14 本机测试:登录验证、星盘归属、服务端快取指纹、付费权限、生命脉络九主题条件
// · Supabase(auth / charts / readings / rpc)与 Anthropic 都是记忆体里的假服务 —— 不打真 API、不花钱
// · 前端的指纹算法直接从 app.html 取出来执行,确认服务端算出来的指纹与前端逐字相同
// 用法:node tests/edge/readchart.mjs
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const SB = "https://sb.test";
Object.assign(process.env, { ANTHROPIC_API_KEY: "test-only", SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: "service-test" });
const RC = await import("../../docs/edge/read-chart.ts");

let pass = 0;
const failures = [];
const ok = (cond, label, extra) => { if (cond) pass++; else failures.push(label + (extra !== undefined ? "  → " + JSON.stringify(extra).slice(0, 300) : "")); };

// ── 前端的指纹算法(从 app.html 原样取出执行)──────────────────────
const html = fs.readFileSync(path.join(ROOT, "app.html"), "utf8");
const grab = (re, label) => { const m = re.exec(html); if (!m) throw new Error("app.html 找不到 " + label); return m[0]; };
const fpFnSrc = grab(/function fingerprint\(str\) \{[\s\S]*?\n  \}/, "fingerprint()");
const pvSeedSrc = grab(/function previewSeed\(items, lang\) \{[\s\S]*?\n  \}/, "previewSeed()");
const ctx = vm.createContext({ window: { crypto: globalThis.crypto }, crypto: globalThis.crypto, TextEncoder, Uint8Array, Array, String, Promise,
  PREVIEW_STYLE_ID: /const PREVIEW_STYLE_ID = "([^"]+)"/.exec(html)[1], PREVIEW_VER: Number(/const PREVIEW_VER = (\d+)/.exec(html)[1]) });
vm.runInContext(fpFnSrc + "\n" + pvSeedSrc + "\nthis.fingerprint = fingerprint; this.previewSeed = previewSeed;", ctx);
// askServer 里组 base 的那几行(原样)
const baseSrc = grab(/const sub = extra\.tid[^\n]*\n[\s\S]*?const base = [^\n]*\n/, "askServer base");
vm.runInContext("this.clientBase = function (fpSeed, kind, extra, lang) {\n" + baseSrc + "\nreturn base; };", ctx);
// 前端组 fpSeed 的写法(主题 / 生命蓝图 / 探索题 与 生命脉络)
ok(/const fpSeed = \[c\.date, c\.time, c\.lat\.toFixed\(4\), c\.lon\.toFixed\(4\)\]\.join\("\|"\);/.test(html), "[fp] 前端 fpSeed 写法未变(服务端依此计算)");
ok(/const liveT = window\.Reading\.liveTopics\(c\[TK2\]\);\n\s*const fpSeed = \[c\.date, c\.time, c\.lat\.toFixed\(4\), c\.lon\.toFixed\(4\), Object\.keys\(liveT\)\.sort\(\)\.join\(","\)\]\.join\("\|"\);/.test(html), "[fp] 前端生命脉络 fpSeed = 有效主题的 key(与以前清理之后相同)");
ok(/fp_base: seed/.test(html), "[fp] 前端把 fp_base 送给服务端");
const clientSeed = (c) => [c.date, c.time, c.lat.toFixed(4), c.lon.toFixed(4)].join("|");
const clientMapSeed = (c, tk) => [c.date, c.time, c.lat.toFixed(4), c.lon.toFixed(4), Object.keys(c[tk] || {}).sort().join(",")].join("|");

// ── 假资料 ─────────────────────────────────────────────────────────
const KEYS = ["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto"];
const chartPayload = (shift = 0) => ({
  ang: { asc: (15 + shift) % 360, mc: (285 + shift) % 360 },
  cusps: Array.from({ length: 12 }, (_, i) => (15 + shift + i * 30) % 360),
  planets: KEYS.map((k, i) => ({ key: k, lon: (shift + i * 37 + 11) % 360, house: (i % 12) + 1, retro: false, speed: 1 })),
  extras: [],
});
const T9 = ["self", "emotion", "career", "family", "love", "partner", "wealth", "study", "body"];
const goodTopic = () => ({ ver: 10, tagline: "t", sections: [{ title: "t", body: "正文" }] });
const topicsOf = (n) => Object.fromEntries(T9.slice(0, n).map((t) => [t, goodTopic()]));
const USERS = {
  tokA: { id: "aaaaaaaa-0000-4000-8000-000000000001", chart: { date: "1994-11-20", time: "08:30", lat: 1.29, lon: 103.85, topics: topicsOf(5) } },
  tokB: { id: "bbbbbbbb-0000-4000-8000-000000000002", chart: { date: "1990-05-05", time: "23:59", lat: -33.8688, lon: 151.20925, topics: topicsOf(9) } },
  tokE: { id: "eeeeeeee-0000-4000-8000-000000000005", chart: { date: "1985-01-01", time: "12:00", lat: 51.5074, lon: -0.1278, topics: topicsOf(3) } }, // Early User
  tokN: { id: "dddddddd-0000-4000-8000-000000000004", chart: null },  // 已登录但还没有星盘
};

// ── 假服务 ─────────────────────────────────────────────────────────
let S;
function reset({ enforced = [], dbDown = false, paid = {} } = {}) {
  S = { readings: {}, reads: [], writes: [], claude: 0, explore: [], enforced: new Set(enforced), dbDown, chartLookups: 0,
        paid, paidCalls: [], paidDown: false };
}
const sha = (s) => RC.sha256hex(s);
const res = (status, body) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
globalThis.fetch = async (url, init = {}) => {
  const u = String(url), h = init.headers || {};
  if (u.startsWith("https://api.anthropic.com/")) {
    S.claude++;
    const sys = JSON.stringify(JSON.parse(init.body).system);
    const text = /阅读预览/.test(sys)
      ? JSON.stringify({ previews: JSON.parse(init.body).messages[0].content.match(/id: (\S+)/g).map((x) => ({ id: x.slice(4), preview: "这是一段足够长的阅读预览引子,用来通过长度检查。", keyInsights: [] })) })
      : JSON.stringify({ spine: "s", cards: [], chapters: [1, 2, 3].map(() => ({ title: "t", summary: "s", body: "这是一段足够长的正文内容,用来通过服务端二十个字以上的长度检查。" })),
                         tagline: "t", sections: [1, 2, 3].map(() => ({ title: "t", body: "这是一段足够长的正文内容,用来通过服务端二十个字以上的长度检查。" })) });
    return res(200, { content: [{ type: "text", text }] });
  }
  if (u === SB + "/auth/v1/user") {
    const tok = String(h.Authorization || "").replace(/^Bearer /, "");
    return USERS[tok] ? res(200, { id: USERS[tok].id }) : res(401, { msg: "invalid JWT" });
  }
  if (h.Authorization !== "Bearer service-test") return res(401, { message: "not service role" });
  if (S.dbDown) return res(503, { message: "down" });
  let m;
  if ((m = /^\/rest\/v1\/charts\?user_id=eq\.([^&]+)&select=data&limit=1$/.exec(u.slice(SB.length)))) {
    S.chartLookups++;
    const usr = Object.values(USERS).find((x) => x.id === decodeURIComponent(m[1]));
    return res(200, usr && usr.chart ? [{ data: usr.chart }] : []);
  }
  if (u === SB + "/rest/v1/rpc/paid_access") {
    const b = JSON.parse(init.body);
    S.paidCalls.push({ ...b, chartLookupsBefore: S.chartLookups, readsBefore: S.reads.length, claudeBefore: S.claude });
    if (S.paidDown) return res(500, { message: "rpc down" });
    const v = S.paid[b.p_user + "|" + b.p_kind + "|" + (b.p_tid || "")] ?? S.paid[b.p_user + "|" + b.p_kind] ?? S.paid[b.p_user] ?? "not_enforced";
    return res(200, JSON.stringify(v));   // PostgREST:纯量函式回传 JSON 字串
  }
  if (u === SB + "/rest/v1/rpc/enforcement_applies" && S.rpcDown) return res(500, { message: "rpc down" });
  if (u === SB + "/rest/v1/rpc/enforcement_applies") return res(200, S.enforced.has(JSON.parse(init.body).p_user));
  if ((m = /^\/rest\/v1\/readings\?fingerprint=eq\.([^&]+)&select=analysis$/.exec(u.slice(SB.length)))) {
    S.reads.push(m[1]);
    return res(200, S.readings[m[1]] ? [{ analysis: S.readings[m[1]] }] : []);
  }
  if (u === SB + "/rest/v1/readings" && init.method === "POST") {
    const b = JSON.parse(init.body); S.writes.push(b.fingerprint); S.readings[b.fingerprint] = b.analysis; return res(201, "");
  }
  if (u.startsWith(SB + "/rest/v1/exploration_question_configs")) return res(200, []);
  if (u.startsWith(SB + "/rest/v1/user_exploration_readings")) { S.explore.push(JSON.parse(init.body)); return res(201, ""); }
  throw new Error("unexpected fetch " + u);
};
async function call(token, body) {
  const headers = { "content-type": "application/json", apikey: "anon-key" };
  if (token !== null) headers.authorization = "Bearer " + token;
  const r = await RC.handler(new Request("https://fn.test/read-chart", { method: "POST", headers, body: JSON.stringify(body) }));
  return { status: r.status, body: await r.json() };
}
// 前端会送出的请求(fp_base 与 fingerprint 都用前端自己的算法)
async function clientReq(user, kind, extra = {}, lang = "zh", opts = {}) {
  const c = USERS[user].chart;
  const seed = kind === "map" ? clientMapSeed(c, lang === "en" ? "topics_en" : "topics") : clientSeed(c);
  let base = ctx.clientBase(seed, kind, extra, lang);
  if (opts.retry) base += "|retry1718000000000";
  const fp = await ctx.fingerprint(base);
  const body = Object.assign({ kind, fingerprint: fp, chart: chartPayload(), lang }, extra);
  if (!opts.legacy) body.fp_base = base;
  return { body, fp, base };
}
async function scenario(name, fn) { try { await fn(); } catch (e) { failures.push(name + ": 例外 " + (e && e.stack || e)); } }

// ═══════════════ 1. 指纹与前端逐字相同(快取继续命中)═══════════════
await scenario("FP", async () => {
  for (const [u, kind, extra, lang] of [
    ["tokA", "blueprint", {}, "zh"], ["tokA", "blueprint", {}, "en"], ["tokA", "topic", { tid: "career" }, "zh"],
    ["tokA", "topic", { tid: "self" }, "en"], ["tokA", "question", { qid: "q07" }, "zh"], ["tokB", "map", {}, "zh"],
    ["tokB", "map", {}, "en"], ["tokB", "topic", { tid: "body" }, "zh"]]) {
    const c = USERS[u].chart;
    const server = RC.chartCacheBase(RC.birthSeed(c), Object.assign({ lang }, extra), kind, c);
    const seed = kind === "map" ? clientMapSeed(c, lang === "en" ? "topics_en" : "topics") : clientSeed(c);
    const client = ctx.clientBase(seed, kind, extra, lang);
    ok(server.ok && server.base === client, `[fp] 服务端自组的 base 与前端相同:${kind}/${lang}`, { server, client });
    ok(await sha(client) === await ctx.fingerprint(client), `[fp] SHA-256 与前端 fingerprint() 相同:${kind}/${lang}`);
  }
  // 浮点与边界:负座标、四舍五入、整数
  for (const c of [{ date: "2001-02-03", time: "00:00", lat: -0.00004, lon: 179.99995 }, { date: "1970-01-01", time: "", lat: 45, lon: -73.56789 }]) {
    ok(RC.birthSeed(c) === clientSeed(c), "[fp] 出生资料字串与前端 toFixed(4) 相同", { s: RC.birthSeed(c), c: clientSeed(c) });
  }
  ok(RC.birthSeed({ date: "x", time: "y", lat: "1.2", lon: 2 }) === null, "[fp] 座标不是数字 → 不组指纹");
  // 预览:服务端用正文算出的指纹与前端 previewSeed 相同
  const items = [{ id: "s1", kind: "section", title: "标题", body: "这是一段已经生成好的正文,长度要超过四十个字才会送去产生预览,所以这里刻意多写几句,确保一定超过那个门槛,不会被过滤掉。" }];
  ok(await sha(RC.previewSeedOf(items, "zh")) === await ctx.fingerprint(ctx.previewSeed(items, "zh")), "[fp] 预览指纹与前端相同");
});

// ═══════════════ 2. 旧快取命中:不呼叫模型 ═══════════════
await scenario("CACHE", async () => {
  reset();
  for (const [u, kind, extra] of [["tokA", "blueprint", {}], ["tokA", "topic", { tid: "career" }], ["tokB", "map", {}]]) {
    const q = await clientReq(u, kind, extra);
    S.readings[kind === "blueprint" ? q.fp + "-blueprint-writing-1.0" : q.fp] = '{"cached":"old"}';
    const r = await call(u, q.body);
    ok(r.status === 200 && r.body.cached === true, `[cache] 既有快取命中:${kind}`, r);
  }
  ok(S.claude === 0, "[cache] 既有快取命中时完全没有呼叫模型", S.claude);
  // 旧版前端(没有 fp_base):服务端自己组,一样命中
  const legacy = await clientReq("tokA", "topic", { tid: "career" }, "zh", { legacy: true });
  const r = await call("tokA", legacy.body);
  ok(r.status === 200 && r.body.cached === true && S.claude === 0, "[cache] 旧版前端(没送 fp_base)也命中同一份快取", r);
  // 预览快取命中
  const items = [{ id: "s1", kind: "section", title: "标题", body: "这是一段已经生成好的正文,长度要超过四十个字才会送去产生预览,所以这里刻意多写几句,确保一定超过那个门槛,不会被过滤掉。" }];
  const pfp = await ctx.fingerprint(ctx.previewSeed(items, "zh"));
  S.readings[pfp + "-preview-writing-1.0"] = JSON.stringify({ previews: [{ id: "s1", preview: "这是一段足够长的阅读预览引子,用来通过长度检查。", keyInsights: [] }] });
  const pr = await call("tokA", { kind: "preview", fingerprint: pfp, lang: "zh", items });
  ok(pr.status === 200 && pr.body.cached === true && S.claude === 0, "[cache] 预览既有快取命中", pr);
});

// ═══════════════ 3. 未登录:在读快取与呼叫模型之前拒绝 ═══════════════
await scenario("AUTH", async () => {
  reset();
  for (const kind of ["blueprint", "topic", "map", "question", "preview"]) {
    const extra = kind === "topic" ? { tid: "self" } : kind === "question" ? { qid: "q01" } : {};
    const body = kind === "preview" ? { kind, items: [{ id: "a", body: "x".repeat(60) }] } : (await clientReq("tokA", kind, extra)).body;
    for (const tok of [null, "anon-key", "forged-token"]) {
      const r = await call(tok, body);
      ok(r.status === 401 && r.body.code === "login_required", `[auth] ${kind} · ${tok === null ? "没有凭证" : tok} → 401`, r);
    }
  }
  ok(S.reads.length === 0 && S.writes.length === 0, "[auth] 未登录时没有读写共享快取", { reads: S.reads.length, writes: S.writes.length });
  ok(S.claude === 0 && S.chartLookups === 0, "[auth] 未登录时没有呼叫模型,也没有查星盘", { claude: S.claude, charts: S.chartLookups });
  // 生命蓝图 / 预览 / 探索题:登录后免费(不检查付费)
  reset({ enforced: [USERS.tokA.id] });
  for (const [kind, extra] of [["blueprint", {}], ["question", { qid: "q03" }]]) {
    const r = await call("tokA", (await clientReq("tokA", kind, extra)).body);
    ok(r.status === 200 && r.body.valid === true, `[free] 已登录:${kind} 照常生成(不检查付费)`, r);
  }
  const pr = await call("tokA", { kind: "preview", lang: "zh", items: [{ id: "s1", body: "这是一段已经生成好的正文,长度要超过四十个字才会送去产生预览,所以这里刻意多写几句,确保一定超过那个门槛,不会被过滤掉。" }] });
  ok(pr.status === 200 && pr.body.valid === true, "[free] 已登录:预览照常生成", pr);
});

// ═══════════════ 4. 星盘归属:读不到、也写不进别人的快取 ═══════════════
await scenario("OWN", async () => {
  reset();
  const bq = await clientReq("tokB", "topic", { tid: "career" });
  S.readings[bq.fp] = '{"secret":"B 的解读"}';
  // A 拿 B 的 fp_base / fingerprint 来要 B 的快取
  const steal = await call("tokA", Object.assign({}, bq.body));
  ok(steal.status === 403 && steal.body.code === "chart_mismatch", "[own] 用别人的出生资料 → 403 chart_mismatch", steal);
  // A 只送 B 的 fingerprint(不送 fp_base)→ 服务端用 A 自己的资料算,拿不到 B 的内容
  const steal2 = await call("tokA", Object.assign({}, bq.body, { fp_base: undefined }));
  ok(steal2.status === 200 && !/B 的解读/.test(JSON.stringify(steal2.body)), "[own] 只送别人的 fingerprint 也读不到别人的快取", steal2);
  ok(!S.reads.includes(bq.fp), "[own] 从头到尾没有读取 B 的快取键", S.reads);
  // 快取污染:A 送 B 的星盘位置 + 自己的 fp_base → 只会写进 A 自己的键
  const aq = await clientReq("tokA", "topic", { tid: "love" });
  S.writes = [];
  await call("tokA", Object.assign({}, aq.body, { chart: chartPayload(120), fingerprint: bq.fp }));
  ok(S.writes.length === 1 && S.writes[0] === aq.fp && S.readings[bq.fp] === '{"secret":"B 的解读"}', "[own] 前端送的 fingerprint 不会被用来写快取;B 的快取没有被覆盖", S.writes);
  // fp_base 结构与这次的 kind / tid / lang 不符
  for (const [label, patch] of [
    ["kind 不符", { fp_base: aq.base.replace("|topic:love|", "|blueprint|") }],
    ["tid 不符", { fp_base: aq.base.replace("topic:love", "topic:self") }],
    ["lang 不符", { fp_base: aq.base + "|en-w2" }],
    ["夹带额外字串", { fp_base: aq.base + "|anything" }]]) {
    const r = await call("tokA", Object.assign({}, aq.body, patch));
    ok(r.status === 403 && /fp_base|chart_/.test(r.body.code), `[own] fp_base ${label} → 403`, r);
  }
  // 没有星盘 / 资料库失败
  const n = await call("tokN", (await clientReq("tokA", "blueprint")).body);
  ok(n.status === 403 && n.body.code === "chart_not_found", "[own] 已登录但没有星盘 → 403 chart_not_found", n);
  reset({ dbDown: true });
  const d = await call("tokA", (await clientReq("tokA", "blueprint")).body);
  ok(d.status === 503 && S.claude === 0, "[own] 资料库读不到 → 503,不呼叫模型", d);
});

// ═══════════════ 5. 重试:跳过快取,与前端行为相同 ═══════════════
await scenario("RETRY", async () => {
  reset();
  const q = await clientReq("tokA", "topic", { tid: "study" }, "zh", { retry: true });
  const plain = await clientReq("tokA", "topic", { tid: "study" });
  S.readings[plain.fp] = '{"bad":"parse failed earlier"}';
  const r = await call("tokA", q.body);
  ok(r.status === 200 && r.body.cached === false && S.claude === 1 && S.reads.length === 0, "[retry] 带 retry 的请求不读快取、重新生成", { r, reads: S.reads });
  ok(S.writes.length === 1 && S.writes[0] === q.fp && S.readings[plain.fp] === '{"bad":"parse failed earlier"}', "[retry] 写进 retry 自己的键(与原本相同)", S.writes);
});

// ═══════════════ 6. 付费权限:topic / map 在查星盘、读快取、呼叫模型之前检查 ═══════════════
await scenario("PAID", async () => {
  const A = USERS.tokA.id, B = USERS.tokB.id;
  // 未购买的主题 → 403 paid_required;完全没有查星盘、读快取、呼叫模型
  reset({ paid: { [A + "|topic|career"]: "denied" } });
  const d = await call("tokA", (await clientReq("tokA", "topic", { tid: "career" })).body);
  ok(d.status === 403 && d.body.code === "paid_required" && d.body.tid === "career", "[paid] 未购买的主题 → 403 paid_required", d);
  ok(S.chartLookups === 0 && S.reads.length === 0 && S.writes.length === 0 && S.claude === 0, "[paid] 被挡下时没有查星盘、读写快取、呼叫模型",
    { charts: S.chartLookups, reads: S.reads.length, claude: S.claude });
  ok(S.paidCalls.length === 1 && S.paidCalls[0].p_user === A && S.paidCalls[0].p_kind === "topic" && S.paidCalls[0].p_tid === "career",
    "[paid] 以登录者自己的 user_id 查询(不相信前端)", S.paidCalls);
  // 即使共享快取里已经有这份内容,也拿不到
  reset({ paid: { [A + "|topic|career"]: "denied" } });
  const q = await clientReq("tokA", "topic", { tid: "career" });
  S.readings[q.fp] = '{"cached":"someone generated it"}';
  const d2 = await call("tokA", q.body);
  ok(d2.status === 403 && !/someone generated/.test(JSON.stringify(d2.body)) && S.reads.length === 0, "[paid] 快取里已有内容也不会被读出", d2);
  // 已购买 / Early User / 不适用付费强制 → 照常(快取命中不呼叫模型)
  for (const v of ["ok", "early_access", "not_enforced"]) {
    reset({ paid: { [A + "|topic|career"]: v } });
    const qq = await clientReq("tokA", "topic", { tid: "career" });
    S.readings[qq.fp] = '{"cached":"old"}';
    const r = await call("tokA", qq.body);
    ok(r.status === 200 && r.body.cached === true && S.claude === 0, `[paid] paid_access = ${v} → 照常取得`, r);
    ok(S.paidCalls[0].chartLookupsBefore === 0 && S.paidCalls[0].readsBefore === 0, `[paid] ${v}:付费检查发生在查星盘与读快取之前`, S.paidCalls[0]);
  }
  // 不合法的主题 → 400;资料库读不到 / 回传无法辨识 → 503(fail closed)
  reset({ paid: { [A + "|topic|xyz"]: "invalid" } });
  const inv = await call("tokA", (await clientReq("tokA", "topic", { tid: "xyz" })).body);
  ok(inv.status === 400 && inv.body.code === "invalid_topic" && S.claude === 0, "[paid] 不合法的主题 → 400", inv);
  for (const [label, setup] of [["RPC 失败", () => { S.paidDown = true; }], ["回传无法辨识", () => { S.paid[A] = "maybe"; }]]) {
    reset(); setup();
    const r = await call("tokA", (await clientReq("tokA", "topic", { tid: "self" })).body);
    ok(r.status === 503 && r.body.code === "entitlement_unavailable" && S.claude === 0 && S.reads.length === 0 && S.chartLookups === 0,
      `[paid] ${label} → 503,不放行、不读快取、不呼叫模型`, r);
  }
  // 生命脉络:没有 Complete → 403 paid_required(就算九个主题都生成了)
  reset({ paid: { [B + "|map"]: "denied" } });
  const m = await call("tokB", (await clientReq("tokB", "map")).body);
  ok(m.status === 403 && m.body.code === "paid_required" && m.body.kind === "map" && S.claude === 0 && S.chartLookups === 0, "[paid] 生命脉络没有 Complete → 403", m);
  ok(S.paidCalls[0].p_kind === "map" && S.paidCalls[0].p_tid === null, "[paid] 生命脉络以 p_kind = map 查询", S.paidCalls);
  reset(); S.paidDown = true;
  const m2 = await call("tokB", (await clientReq("tokB", "map")).body);
  ok(m2.status === 503 && S.claude === 0, "[paid] 生命脉络:资料库读不到 → 503", m2);
  // 生命蓝图 / 探索题 / 预览:免费(只要登录),不查付费
  reset({ paid: { [A]: "denied" } });
  for (const [kind, extra] of [["blueprint", {}], ["question", { qid: "q05" }]]) {
    const r = await call("tokA", (await clientReq("tokA", kind, extra)).body);
    ok(r.status === 200 && r.body.valid === true, `[paid] ${kind} 免费:不检查付费`, r);
  }
  await call("tokA", { kind: "preview", lang: "zh", items: [{ id: "s1", body: "这是一段已经生成好的正文,长度要超过四十个字才会送去产生预览,所以这里刻意多写几句,确保一定超过那个门槛,不会被过滤掉。" }] });
  ok(S.paidCalls.length === 0, "[paid] 生命蓝图 / 探索题 / 预览完全没有呼叫 paid_access", S.paidCalls);
});

// ═══════════════ 7. 生命脉络:九个正式中文主题都生成 —— 对所有人 ═══════════════
await scenario("MAP", async () => {
  // Early User / 一般用户(not_enforced 或 early_access)一样要九个主题
  for (const v of ["not_enforced", "early_access", "ok"]) {
    reset({ paid: { [USERS.tokE.id]: v, [USERS.tokB.id]: v } });
    const e = await call("tokE", (await clientReq("tokE", "map")).body);      // 只生成 3 个
    ok(e.status === 403 && e.body.code === "life_thread_locked" && e.body.generated === 3, `[map] ${v}:未满 9 个主题 → 403`, e);
    ok(S.reads.length === 0 && S.claude === 0, `[map] ${v}:被挡下时没有读快取、没有呼叫模型`);
    const b = await call("tokB", (await clientReq("tokB", "map")).body);      // 9 个都生成了
    ok(b.status === 200 && b.body.valid === true, `[map] ${v}:9 个主题都生成 → 可以生成`, b);
  }
  // 「已生成」的判断(与前端 reviveTopic 相同)
  const GT = RC.generatedTopicCount;
  ok(GT({ topics: topicsOf(4), topics_en: topicsOf(9) }) === 4, "[map] 英文版主题不算数");
  ok(GT({ topics: Object.assign(topicsOf(8), { extra: goodTopic(), personal: goodTopic() }) }) === 8, "[map] 非正式 / 旧版主题 id 不算数");
  const t9 = topicsOf(9);
  ok(GT({ topics: Object.assign({}, t9, { body: { ver: 9, sections: [{ body: "x" }] } }) }) === 8, "[map] 版本过期的主题不算数");
  ok(GT({ topics: Object.assign({}, t9, { body: { sections: [{ body: "x" }] } }) }) === 8, "[map] 没有版本的旧资料不算数");
  ok(GT({ topics: Object.assign({}, t9, { body: { ver: 10, sections: [] } }) }) === 8, "[map] 没有段落的主题不算数");
  ok(GT({ topics: Object.assign({}, t9, { body: { ver: 10, raw: '前言 {"sections":[{"title":"a","body":"b"}]} 尾' } }) }) === 9, "[map] 只有可解析的 raw 也算生成");
  ok(GT({ topics: Object.assign({}, t9, { body: { ver: 10, raw: "{ 坏掉的 JSON" } }) }) === 8, "[map] raw 无法解析不算数");
  ok(GT({ topics: Object.assign({}, t9, { body: "字串" }) }) === 8 && GT(null) === 0 && GT({}) === 0, "[map] 格式不对 / 空资料不算数");
  // 服务端只看资料库里的主题;前端送来的 topics 再多也没用
  reset();
  const e2 = await call("tokE", Object.assign((await clientReq("tokE", "map")).body, { topics: topicsOf(9) }));
  ok(e2.status === 403 && e2.body.code === "life_thread_locked", "[map] 前端送来的 topics 不能代替资料库里的主题", e2);
  // 旧版前端(没送 fp_base)的生命脉络快取键:只算有效主题(与前端 liveTopics 相同)
  const c = { date: "1994-11-20", time: "08:30", lat: 1.29, lon: 103.85, topics: Object.assign(topicsOf(9), { personal: goodTopic(), wealth: { ver: 3 } }) };
  const lb = RC.chartCacheBase(RC.birthSeed(c), { lang: "zh" }, "map", c);
  ok(lb.ok && lb.base.indexOf("|body,career,emotion,family,love,partner,self,study|map|v10") > 0, "[map] 旧版快取键只算有效主题", lb);
});

// ═══════════════ 8. 前端与服务端的「已生成」判断逐条相同 ═══════════════
await scenario("SAME", async () => {
  const src = [
    grab(/const CONTENT_VER = \d+;/, "CONTENT_VER"),
    grab(/function isStale\(saved\) \{[^\n]*\}/, "isStale()"),
    grab(/function parseTopic\(txt\) \{[\s\S]*?\n  \}/, "parseTopic()"),
    grab(/function reviveTopic\(saved\) \{[\s\S]*?\n  \}/, "reviveTopic()"),
    grab(/const LEGACY_TOPIC_IDS = \[[^\]]*\];/, "LEGACY_TOPIC_IDS"),
    grab(/function liveTopics\(obj\) \{[\s\S]*?\n  \}/, "liveTopics()"),
    grab(/function generatedTopicCount\(c\) \{[\s\S]*?\n  \}/, "generatedTopicCount()"),
  ].join("\n");
  const fx = vm.createContext({ JSON, String, Array, Object, TOPICS9: T9.map((id) => ({ id })) });
  vm.runInContext(src + "\nthis.gtc = generatedTopicCount; this.live = liveTopics;", fx);
  const t9 = topicsOf(9);
  const cases = [
    {}, { topics: t9 }, { topics: topicsOf(7) }, { topics: t9, topics_en: t9 },
    { topics: Object.assign({}, t9, { body: { ver: 9, sections: [{ body: "x" }] } }) },
    { topics: Object.assign({}, t9, { body: { sections: [{ body: "x" }] } }) },
    { topics: Object.assign({}, t9, { body: { ver: 10, sections: [] } }) },
    { topics: Object.assign({}, t9, { body: { ver: 10, raw: '{"sections":[{"title":"a","body":"b"}]}' } }) },
    { topics: Object.assign({}, t9, { body: { ver: 10, raw: '{"sections":[]}' } }) },
    { topics: Object.assign({}, t9, { body: { ver: 10, raw: "坏的" } }) },
    { topics: Object.assign({}, t9, { body: { ver: "10", sections: [{ body: "x" }] } }) },
    { topics: Object.assign(topicsOf(8), { personal: goodTopic(), extra: goodTopic() }) },
  ];
  cases.forEach((c, i) => {
    const front = fx.gtc(JSON.parse(JSON.stringify(c))), server = RC.generatedTopicCount(JSON.parse(JSON.stringify(c)));
    ok(front === server, `[same] 案例 ${i}:前端 ${front} = 服务端 ${server}`);
    const lk = Object.keys(fx.live(c.topics || {})).sort().join(","), sk = RC.liveTopicKeys(c.topics || {}).join(",");
    ok(lk === sk, `[same] 案例 ${i}:有效主题 key 相同`, { lk, sk });
  });
  ok(/const THREAD_GATE = 9;/.test(html), "[same] 前端 THREAD_GATE = 9");
  ok(/function threadReadCount\(\) \{ return window\.Reading\.generatedTopicCount\(activeChart\(\)\); \}/.test(html), "[same] 生命脉络进度 = 已生成数(不看 readTopics)");
});

// ═══════════════ 9. 探索题照常落库(指纹不变)═══════════════
await scenario("QUESTION", async () => {
  reset();
  const q = await clientReq("tokA", "question", { qid: "q12" });
  const r = await call("tokA", q.body);
  ok(r.status === 200 && S.explore.length === 1 && S.explore[0].user_id === USERS.tokA.id && S.explore[0].chart_fingerprint === q.fp,
    "[question] 探索题照常存进 user_exploration_readings,指纹与前端相同", { r, e: S.explore[0] });
});

// ═══════════════ 10. 前端:请求前等待星盘落库、401 提示重新登录 ═══════════════
await scenario("FRONT", async () => {
  ok(/const ready = \(window\.Cloud && window\.Cloud\.chartWritesSettled\)/.test(html), "[front] 送出解读请求前先等星盘写入完成");
  ok(/return trackChartWrite\(rest\("charts", \{ method: "POST"/.test(html) && /return trackChartWrite\(rest\("charts\?id=eq\."/.test(html), "[front] 新增与更新星盘都会被追踪");
  ok(/e\.code = "login_required"/.test(html) && /dgLogin/.test(html), "[front] 续期失败 → 提示重新登录");
  ok(/dgChart/.test(html), "[front] 星盘不一致 → 提示重新整理");
  // 401 时不再提示「把 Verify JWT 关掉」(只在 GET 探测也是 401 时才这样提示)
  ok(/else if \(probe\.status === 401\) hint = T\("dg401"\);/.test(html), "[front] 只有闸道层 401 才提示 Verify JWT");
  // 生命脉络:查看已保存的与生成新的,都先过九主题这道门
  const fnBody = (name) => { const i = html.indexOf("function " + name + "("); return html.slice(i, html.indexOf("\n  }\n", i)); };
  const page = fnBody("renderMapPage");
  ok(/const saved = threadUnlocked\(c\) \? window\.Reading\.reviveTopic\(c\[window\.Reading\.LK\("lifemap"\)\]\) : null;/.test(page),
    "[thread] #/map:九个主题没有全部生成时,不读出已保存的生命脉络");
  ok(page.indexOf("else if (!threadUnlocked(c))") > 0 && page.indexOf("else if (!threadUnlocked(c))") < page.indexOf("else if (mapBusy)"),
    "[thread] #/map:先显示进度,再轮到生成中 / 错误 / 生成按钮");
  const tg = fnBody("toggleMap");
  ok(tg.indexOf("if (!threadUnlocked(c)) {") > 0 && tg.indexOf("if (!threadUnlocked(c)) {") < tg.indexOf("reviveTopic(c[MK])") &&
     tg.indexOf("if (!threadUnlocked(c)) {") < tg.indexOf("fetchMap("), "[thread] 生成按钮:未满九个主题不显示旧内容、不送出生成请求");
  ok(/if \(saved\) \{ location\.hash = "#\/map"; return; \}/.test(tg), "[thread] 已有生命脉络 → 直接打开,不重新生成、不呼叫 AI");
  const rm = fnBody("renderMap");
  ok(/const saved = threadUnlocked\(c\) \?/.test(rm) && /else if \(!threadUnlocked\(c\)\)/.test(rm), "[thread] 旧版面板同样先检查九主题");
  ok(/var lm = c && threadUnlocked\(c\) \?/.test(html), "[thread] 落地页快取未开启时不放生命脉络内容");
  ok(/function favList\(\) \{ return visibleFavs\(activeChart\(\)\); \}/.test(html) && /const list = visibleFavs\(c\)\.slice\(\);/.test(html) &&
     /f\.sourceType !== "life_thread"/.test(html), "[thread] 未开启时,来自生命脉络的收藏也不显示(资料不动)");
  ok(/lifeThreads: \(window\.Reading\.generatedTopicCount\(c\) >= 9 && /.test(html), "[thread] 内在指南的证据层:未开启时不使用生命脉络");
  // cleanupLegacy:不再删除、也不回存
  const cl = grab(/function cleanupLegacy\(c\) \{[^\n]*\}/, "cleanupLegacy()");
  const cx = vm.createContext({}); vm.runInContext(cl + "\nthis.f = cleanupLegacy;", cx);
  const sample = { answers: [1], topics: { personal: { ver: 3 }, self: { ver: 9 } }, lifemap: { ver: 2 }, reading: { ver: 1 }, qa: { q01: { ver: 1 } } };
  const before = JSON.stringify(sample);
  ok(cx.f(sample) === false && JSON.stringify(sample) === before, "[legacy] cleanupLegacy 不改动任何资料、回传 false");
  ok(!/cleanupLegacy\(c\)\) window\.Cloud\.updateChart/.test(html), "[legacy] 载入星盘时不再回存");
  ok(/window\.Reading\.liveTopics\(c\.topics\)/.test(html) && /liveTopics\(c\[QK\]\)/.test(html) && /liveEntry\(c\[window\.Reading\.LK\("reading"\)\]\)/.test(html),
    "[legacy] 送给服务端的主题 / 探索题 / 生命蓝图只取有效内容(与以前清理后相同)");
  // 新的错误代码有对应的提示,不会显示成未知错误
  ok(/err\.code === "paid_required"\) hint = T\("dgPaid"\)/.test(html) && /err\.code === "life_thread_locked"\) hint = T\("dgThread"\)/.test(html) &&
     /err\.code === "entitlement_unavailable"\) hint = T\("dgEnt"\)/.test(html), "[front] paid_required / life_thread_locked / entitlement_unavailable 有提示");
});

if (failures.length) {
  console.log("失败:");
  failures.forEach((f) => console.log("  ✗ " + f));
  console.log(`read-chart 测试:通过 ${pass},失败 ${failures.length}`);
  process.exit(1);
}
console.log(`read-chart 测试全部通过:${pass} 项`);
