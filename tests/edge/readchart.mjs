// read-chart v13 本机测试:登录验证、星盘归属、服务端快取指纹、生命脉络条件
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
ok(/const fpSeed = \[c\.date, c\.time, c\.lat\.toFixed\(4\), c\.lon\.toFixed\(4\), Object\.keys\(c\[TK2\] \|\| \{\}\)\.sort\(\)\.join\(","\)\]\.join\("\|"\);/.test(html), "[fp] 前端生命脉络 fpSeed 写法未变");
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
const topicsOf = (n) => Object.fromEntries(["self", "emotion", "career", "family", "love", "partner", "wealth", "study", "body"].slice(0, n).map((t) => [t, { tagline: "t" }]));
const USERS = {
  tokA: { id: "aaaaaaaa-0000-4000-8000-000000000001", chart: { date: "1994-11-20", time: "08:30", lat: 1.29, lon: 103.85, topics: topicsOf(5) } },
  tokB: { id: "bbbbbbbb-0000-4000-8000-000000000002", chart: { date: "1990-05-05", time: "23:59", lat: -33.8688, lon: 151.20925, topics: topicsOf(9) } },
  tokE: { id: "eeeeeeee-0000-4000-8000-000000000005", chart: { date: "1985-01-01", time: "12:00", lat: 51.5074, lon: -0.1278, topics: topicsOf(3) } }, // Early User
  tokN: { id: "dddddddd-0000-4000-8000-000000000004", chart: null },  // 已登录但还没有星盘
};

// ── 假服务 ─────────────────────────────────────────────────────────
let S;
function reset({ enforced = [], dbDown = false } = {}) {
  S = { readings: {}, reads: [], writes: [], claude: 0, explore: [], enforced: new Set(enforced), dbDown, chartLookups: 0 };
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

// ═══════════════ 6. 生命脉络:九个主题条件只对测试账号执行 ═══════════════
await scenario("MAP", async () => {
  reset({ enforced: [USERS.tokA.id, USERS.tokB.id] });
  const a = await call("tokA", (await clientReq("tokA", "map")).body);       // 测试账号,只生成 5 个
  ok(a.status === 403 && a.body.code === "life_thread_locked" && a.body.generated === 5, "[map] 测试账号未满 9 个主题 → 403", a);
  ok(S.reads.length === 0 && S.claude === 0, "[map] 被挡下时没有读快取、没有呼叫模型");
  const b = await call("tokB", (await clientReq("tokB", "map")).body);       // 测试账号,9 个都生成了
  ok(b.status === 200 && b.body.valid === true, "[map] 测试账号 9 个主题都生成 → 可以生成", b);
  // 不在测试名单(含 Early Users,Sandbox 期间)→ 维持原本行为
  reset({ enforced: [] });
  const e = await call("tokE", (await clientReq("tokE", "map")).body);
  ok(e.status === 200, "[map] 不在测试名单(Early User)→ 照旧可以生成", e);
  // 英文版主题也算数
  ok(RC.generatedTopicCount({ topics: topicsOf(4), topics_en: topicsOf(9) }) === 9, "[map] 中文或英文任一版本生成过都算");
  ok(RC.generatedTopicCount({ topics: Object.assign(topicsOf(8), { extra: {} }) }) === 8, "[map] 非正式主题不算数");
  // 查不到是否适用付费强制 → 503,不放行、不呼叫模型
  reset({ enforced: [] }); S.rpcDown = true;
  const f = await call("tokE", (await clientReq("tokE", "map")).body);
  ok(f.status === 503 && S.claude === 0 && S.reads.length === 0, "[map] 无法确认是否适用 → 503,不读快取、不呼叫模型", f);
});

// ═══════════════ 7. 探索题照常落库(指纹不变)═══════════════
await scenario("QUESTION", async () => {
  reset();
  const q = await clientReq("tokA", "question", { qid: "q12" });
  const r = await call("tokA", q.body);
  ok(r.status === 200 && S.explore.length === 1 && S.explore[0].user_id === USERS.tokA.id && S.explore[0].chart_fingerprint === q.fp,
    "[question] 探索题照常存进 user_exploration_readings,指纹与前端相同", { r, e: S.explore[0] });
});

// ═══════════════ 8. 前端:请求前等待星盘落库、401 提示重新登录 ═══════════════
await scenario("FRONT", async () => {
  ok(/const ready = \(window\.Cloud && window\.Cloud\.chartWritesSettled\)/.test(html), "[front] 送出解读请求前先等星盘写入完成");
  ok(/return trackChartWrite\(rest\("charts", \{ method: "POST"/.test(html) && /return trackChartWrite\(rest\("charts\?id=eq\."/.test(html), "[front] 新增与更新星盘都会被追踪");
  ok(/e\.code = "login_required"/.test(html) && /dgLogin/.test(html), "[front] 续期失败 → 提示重新登录");
  ok(/dgChart/.test(html), "[front] 星盘不一致 → 提示重新整理");
  // 401 时不再提示「把 Verify JWT 关掉」(只在 GET 探测也是 401 时才这样提示)
  ok(/else if \(probe\.status === 401\) hint = T\("dg401"\);/.test(html), "[front] 只有闸道层 401 才提示 Verify JWT");
});

if (failures.length) {
  console.log("失败:");
  failures.forEach((f) => console.log("  ✗ " + f));
  console.log(`read-chart 测试:通过 ${pass},失败 ${failures.length}`);
  process.exit(1);
}
console.log(`read-chart 测试全部通过:${pass} 项`);
