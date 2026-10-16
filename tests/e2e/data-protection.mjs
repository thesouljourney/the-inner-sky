// 资料保护的端对端测试:两个真的浏览器分页、真的前端代码(app.html 的 Cloud.updateChart / savePrefs),
// 写进真的 PostgreSQL(模拟 Supabase + docs/sql/data_protection.sql)。
// 模拟的情况:两个分页 / 装置先各自读到同一份旧资料,再分别写入不同内容,两种写入顺序都测。
// · 不连任何真服务(Supabase / Anthropic / Vercel 都是本机假服务),不花钱
// 用法:PGHOST=/var/run/postgresql PGUSER=<superuser> PGDATABASE=postgres node tests/e2e/data-protection.mjs
//      (需要 Playwright 与 Chromium;可用 PLAYWRIGHT_MODULE / CHROMIUM_PATH 指定位置)
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
import pg from "pg";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const require = createRequire(import.meta.url);
function loadPlaywright() {
  for (const m of [process.env.PLAYWRIGHT_MODULE, "playwright", "/opt/node-tools/node_modules/playwright"].filter(Boolean)) {
    try { return require(m); } catch (e) { /* 试下一个 */ }
  }
  throw new Error("找不到 Playwright(可用 PLAYWRIGHT_MODULE 指定)");
}
const { chromium } = loadPlaywright();
const CHROMIUM = process.env.CHROMIUM_PATH ||
  ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome"].find((p) => fs.existsSync(p));

const UID = "aaaaaaaa-0000-4000-8000-000000000001";
const CHART_ID = "cccccccc-0000-4000-8000-000000000001";
const T9 = ["self", "emotion", "career", "family", "love", "partner", "wealth", "study", "body"];
const topic = (id, n) => ({ ver: 10, savedAt: n, tagline: "T-" + id, sections: [{ title: "章", body: "正文 " + id }], aha: [], steps: [] });

let pass = 0;
const failures = [];
const ok = (cond, label, extra) => { if (cond) pass++; else failures.push(label + (extra !== undefined ? "  → " + JSON.stringify(extra).slice(0, 300) : "")); };

// ── 本机资料库 ───────────────────────────────────────────────
const DB = "dataprot_" + process.pid;
const admin = new pg.Client();
await admin.connect();
await admin.query(`drop database if exists ${DB}`);
await admin.query(`create database ${DB}`);
await admin.end();
const pool = new pg.Pool({ database: DB, max: 4 });
for (const f of ["tests/sql/00_mock_supabase.sql", "docs/sql/payments_stage1.sql", "docs/sql/payments_stage1b.sql", "docs/sql/data_protection.sql"])
  await pool.query(fs.readFileSync(path.join(ROOT, f), "utf8"));
// 模拟资料库没有重建 prefs 的 RLS 规则;这里补上「只读写自己」(与正式环境相同的形状)
await pool.query(`create policy prefs_own on public.prefs for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())`);
await pool.query(`grant all on public.prefs, public.charts to authenticated`);

async function asUser(fn) {   // 与 PostgREST 相同:每个请求一个交易,带登录者身分
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("set local role authenticated");
    await c.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true)", [UID]);
    const r = await fn(c);
    await c.query("commit");
    return r;
  } catch (e) { await c.query("rollback"); throw e; } finally { c.release(); }
}
async function resetData(nTopics) {
  const topics = Object.fromEntries(T9.slice(0, nTopics).map((t, i) => [t, topic(t, 100 + i)]));
  await pool.query("update charts set data = $1 where id = $2", [{ date: "1994-11-20", time: "08:30", lat: 1.29, lon: 103.85,
    tzId: "Asia/Singapore", utcOffsetMinutes: 480, nick: "A", topics, favs: [] }, CHART_ID]);
  await pool.query("delete from prefs");
  await pool.query("insert into prefs (user_id, data) values ($1, $2)", [UID,
    { readTopics: Object.fromEntries(T9.slice(0, nTopics).map((t) => [t, true])), readOrder: T9.slice(0, nTopics) }]);
}
const dbChart = async () => (await pool.query("select data from charts where id = $1", [CHART_ID])).rows[0].data;
const dbPrefs = async () => (await pool.query("select data from prefs where user_id = $1", [UID])).rows[0].data;

// ── 静态网站 ─────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  const type = p.endsWith(".html") ? "text/html" : p.endsWith(".js") ? "text/javascript" : p.endsWith(".css") ? "text/css" : "application/octet-stream";
  res.writeHead(200, { "content-type": type + "; charset=utf-8" });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}/app.html`;

// ── 假的 Supabase(PostgREST 的这几个用法,转成带身分的 SQL)──────────
async function supabase(route) {
  const req = route.request(), u = new URL(req.url()), m = req.method();
  const json = (status, body) => route.fulfill({ status, contentType: "application/json", body: body === undefined ? "" : JSON.stringify(body) });
  try {
    if (u.pathname.startsWith("/functions/v1/")) return json(200, {});
    if (u.pathname === "/auth/v1/user") return json(200, { id: UID, email: "a@example.test", user_metadata: {} });
    if (u.pathname === "/auth/v1/token") return json(200, { access_token: "t2", refresh_token: "r2", user: { id: UID, email: "a@example.test", user_metadata: {} } });
    if (u.pathname === "/rest/v1/charts" && m === "GET")
      return json(200, await asUser(async (c) => (await c.query("select id, data from charts order by created_at")).rows));
    if (u.pathname === "/rest/v1/charts" && m === "PATCH") {
      const id = (u.searchParams.get("id") || "").replace(/^eq\./, "");
      const b = JSON.parse(req.postData());
      const rows = await asUser(async (c) => (await c.query("update charts set data = $1, updated_at = $2 where id = $3 returning data", [b.data, b.updated_at, id])).rows);
      return /return=representation/.test(req.headers()["prefer"] || "") ? json(200, rows) : json(204);
    }
    if (u.pathname === "/rest/v1/prefs" && m === "GET")
      return json(200, await asUser(async (c) => (await c.query("select data from prefs")).rows));
    if (u.pathname === "/rest/v1/prefs" && m === "POST") {
      const b = JSON.parse(req.postData());
      const rows = await asUser(async (c) => (await c.query(
        "insert into prefs (user_id, data) values ($1, $2) on conflict (user_id) do update set data = excluded.data returning data", [b.user_id, b.data])).rows);
      return /return=representation/.test(req.headers()["prefer"] || "") ? json(201, rows) : json(201);
    }
    if (m === "GET" || m === "HEAD") return json(200, []);
    return json(204);
  } catch (e) {
    return json(500, { message: String(e && e.message || e) });
  }
}

const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});
async function openTab() {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.route(/supabase\.co/, supabase);
  await page.addInitScript(() => {
    const d = new Date();
    const day = d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
    localStorage.setItem("xingli_session_v1", JSON.stringify({ access_token: "t", refresh_token: "r", user_id: "aaaaaaaa-0000-4000-8000-000000000001", login_date: day }));
  });
  await page.goto(BASE + "#/map");
  await page.waitForFunction(() => window.Cloud && window.Cloud.hasSession && window.Cloud.hasSession(), null, { timeout: 15000 });
  await page.waitForTimeout(1500);
  return { page, errors };
}
// 分页拿一份「自己的」星盘副本(相当于这个分页记忆体里的那一份)
const snapshot = (tab) => tab.page.evaluate(async () => { window.__mine = (await window.Cloud.loadCharts())[0]; return Object.keys(window.__mine.topics || {}).length; });

async function scenario(name, fn) { try { await fn(); } catch (e) { failures.push(name + ": 例外 " + (e && e.stack || e)); } }

// ═══ 1. 实际发生过的情况:旧分页只有 6 篇,另一个分页补到 9 篇,旧分页之后收藏一句话 ═══
for (const order of ["新分页先写", "旧分页先写"]) {
  await scenario("TOPICS " + order, async () => {
    await resetData(6);
    const A = await openTab(), B = await openTab();
    ok(await snapshot(A) === 6 && await snapshot(B) === 6, `[${order}] 两个分页都先读到同一份 6 篇的版本`);
    const writeB = () => B.page.evaluate(async () => {           // B:生成另外 3 篇
      ["wealth", "study", "body"].forEach((t, i) => { window.__mine.topics[t] = { ver: 10, savedAt: Date.now() + i, tagline: "新", sections: [{ title: "章", body: "新 " + t }] }; });
      await window.Cloud.updateChart(window.__mine);
    });
    const writeA = () => A.page.evaluate(async () => {           // A:拿着旧版本收藏一句话(整份写回)
      window.__mine.favs = [{ key: "k1", text: "一句话", addedAt: Date.now() }];
      await window.Cloud.updateChart(window.__mine);
    });
    if (order === "新分页先写") { await writeB(); await writeA(); } else { await writeA(); await writeB(); }
    const d = await dbChart();
    ok(T9.every((t) => d.topics && d.topics[t]), `[${order}] 资料库最后九个主题都在`, Object.keys(d.topics || {}));
    ok(Array.isArray(d.favs) && d.favs.length === 1 && d.favs[0].key === "k1", `[${order}] 旧分页的收藏照常存入`, d.favs);
    const aKeys = await A.page.evaluate(() => Object.keys(window.__mine.topics).length);
    const bFavs = await B.page.evaluate(() => (window.__mine.favs || []).length);
    if (order === "新分页先写") ok(aKeys === 9, `[${order}] 旧分页存档后,画面上的资料自动补回 9 篇(不必重新整理)`, aKeys);
    else ok(bFavs === 1, `[${order}] 新分页存档后,也拿到了旧分页的收藏`, bFavs);
    ok(A.errors.length === 0 && B.errors.length === 0, `[${order}] 两个分页都没有 JavaScript 错误`, A.errors.concat(B.errors));
    await A.page.close(); await B.page.close();
  });
}

// ═══ 2. 已读记录(savePrefs 防抖后整份 upsert),两种写入顺序 ═══
for (const order of ["新分页先写", "旧分页先写"]) {
  await scenario("PREFS " + order, async () => {
    await resetData(6);
    const A = await openTab(), B = await openTab();
    const saveB = () => B.page.evaluate(() => new Promise((r) => {
      window.Cloud.savePrefs({ readTopics: { self: true, emotion: true, career: true, family: true, love: true, partner: true, wealth: true, study: true, body: true },
                               readOrder: ["self", "emotion", "career", "family", "love", "partner", "wealth", "study", "body"] });
      setTimeout(r, 1800);
    }));
    const saveA = () => A.page.evaluate(() => new Promise((r) => {
      window.Cloud.savePrefs({ readTopics: { self: true, emotion: true, career: true, family: true, love: true, partner: true },
                               readOrder: ["self", "emotion", "career", "family", "love", "partner"], glyphMode: "name" });
      setTimeout(r, 1800);
    }));
    if (order === "新分页先写") { await saveB(); await saveA(); } else { await saveA(); await saveB(); }
    const p = await dbPrefs();
    ok(T9.every((t) => p.readTopics && p.readTopics[t]), `[${order}] 已读记录九个都留下`, p.readTopics);
    ok(Array.isArray(p.readOrder) && T9.every((t) => p.readOrder.indexOf(t) >= 0), `[${order}] 阅读顺序没有遗漏`, p.readOrder);
    ok(p.glyphMode === "name", `[${order}] 旧分页的设定照常写入,另一个分页没带这项也不会抹掉`, p.glyphMode);
    await A.page.close(); await B.page.close();
  });
}

// ═══ 3. 正常的重新生成照常生效;旧分页的同版本旧副本盖不回去 ═══
await scenario("REGEN", async () => {
  await resetData(9);
  const A = await openTab(), B = await openTab();
  await snapshot(A); await snapshot(B);
  await B.page.evaluate(async () => {
    window.__mine.topics.self = { ver: 10, savedAt: Date.now(), tagline: "重新生成", sections: [{ title: "章", body: "重新生成的正文" }] };
    await window.Cloud.updateChart(window.__mine);
  });
  await A.page.evaluate(async () => { window.__mine.nick = "旧分页"; await window.Cloud.updateChart(window.__mine); });
  const d = await dbChart();
  ok(d.topics.self.tagline === "重新生成", "重新生成的内容不会被旧分页的旧副本盖回去", d.topics.self.tagline);
  ok(d.nick === "旧分页", "其他栏位(显示名称)维持最后写入为准", d.nick);
  await A.page.close(); await B.page.close();
});

// ═══ 4. 前端:收藏 / 取消收藏会留下 addedAt 与墓碑 ═══
await scenario("FAV", async () => {
  const html = fs.readFileSync(path.join(ROOT, "app.html"), "utf8");
  ok(/c\.favsRemoved\[k\] = Date\.now\(\);/.test(html) && /addedAt: Date\.now\(\),/.test(html), "收藏带 addedAt、取消收藏留下墓碑");
  ok((html.match(/savedAt = Date\.now\(\)/g) || []).length >= 9, "所有写入内容的地方都盖上 savedAt", (html.match(/savedAt = Date\.now\(\)/g) || []).length);
});

await browser.close();
server.close();
await pool.end();
const a2 = new pg.Client(); await a2.connect(); await a2.query(`drop database if exists ${DB}`); await a2.end();

if (failures.length) {
  console.log("失败:");
  failures.forEach((f) => console.log("  ✗ " + f));
  console.log(`资料保护端对端测试:通过 ${pass},失败 ${failures.length}`);
  process.exit(1);
}
console.log(`资料保护端对端测试全部通过:${pass} 项`);
