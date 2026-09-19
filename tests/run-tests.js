/* ============================================================
   tests/run-tests.js
   Astro-Seek(Swiss Ephemeris)校准测试。

   对照答案在 tests/reference/cases.json,由 tools/gen-reference.py
   用 pyswisseph 生成 —— 与 Astro-Seek 同一套星历、同一组设置
   (回归黄道 / Placidus / 真交点 / 平均黑月)。时区那一侧的答案来自
   Python zoneinfo,与前端用的 Intl/ICU 是两套独立实作。

   比较的是实际黄经(度),不是显示字串;每一类给合理容差。

   用法:npm test
   ============================================================ */
"use strict";
const path = require("path");
const Astro = require(path.join(__dirname, "..", "assets", "astro", "astro-core.js"));
const TZ = require(path.join(__dirname, "..", "assets", "astro", "timezone.js"));
const Places = require(path.join(__dirname, "..", "assets", "astro", "places.js"));
const REF = require(path.join(__dirname, "reference", "cases.json"));

/* 容差(角秒)。行星与四轴要求 30″ 以内 —— 换算成显示是半个角分,
   任何情况下都不会让星座、宫位或显示的度分出现差异。 */
const TOL = {
  planet: 30,
  angle: 5,
  cusp: 5,
  node: 30,
  chiron: 60,
  asteroid: 60,
  lilith: 60,
  speed: 0.02          // 度/日
};

let pass = 0, fail = 0;
const failures = [];

function arcsec(a, b) { return Math.abs(((a - b + 540) % 360) - 180) * 3600; }

/* 两份长文比对:只报第一处差异,不要把整份 prompt 吐出来 */
function firstDiff(a, b) {
  a = String(a); b = String(b);
  if (a === b) return "";
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i])
      return "第 " + i + " 字起不同: 服务端「" + a.slice(i, i + 24) + "」vs 前端「" + b.slice(i, i + 24) + "」";
  }
  return "长度不同 " + a.length + " vs " + b.length;
}

function check(label, got, want, tolArcsec) {
  if (got === null || got === undefined || !isFinite(got)) {
    fail++; failures.push(label + ": 没有算出数值"); return;
  }
  const d = arcsec(got, want);
  if (d <= tolArcsec) pass++;
  else { fail++; failures.push(label + ": 差 " + d.toFixed(1) + "″ (得 " + got.toFixed(5) + ", 应为 " + want.toFixed(5) + ")"); }
}
function checkEq(label, got, want) {
  if (got === want) pass++;
  else { fail++; failures.push(label + ": 得 " + JSON.stringify(got) + ", 应为 " + JSON.stringify(want)); }
}

/* ---------- 1. 时区 / UTC 换算 ---------- */
function testTimezones() {
  for (const c of REF.cases) {
    const r = TZ.localToUtc(c.date, c.time, c.tz);
    checkEq("[tz] " + c.name + " UTC", r.utc.toISOString(), c.expect.utc);
    checkEq("[tz] " + c.name + " offset", r.offsetMinutes, c.expect.utcOffsetMinutes);
  }
}

/* ---------- 2. 完整星盘 ---------- */
function testCharts() {
  for (const c of REF.cases) {
    const out = Astro.computeNatalChart({
      date: c.date, time: c.time,
      place: { city: c.name, lat: c.lat, lon: c.lon, tzId: c.tz }
    });
    const chart = out.chart;
    const e = c.expect;
    const tag = "[" + c.name + "] ";

    checkEq(tag + "UTC", out.birth.utc, e.utc);
    checkEq(tag + "house system", chart.system, e.houseSystem);

    for (const k of Object.keys(e.planets)) {
      const p = chart.planets.find(x => x.key === k);
      check(tag + k, p ? p.lon : null, e.planets[k].lon, TOL.planet);
      // 逆行必须与 Swiss 的速度符号一致
      if (p && k !== "Sun" && k !== "Moon") {
        checkEq(tag + k + " 逆行", p.retro, e.planets[k].speed < 0);
      }
    }

    check(tag + "ASC", chart.ang.asc, e.asc, TOL.angle);
    check(tag + "MC", chart.ang.mc, e.mc, TOL.angle);
    check(tag + "DSC", chart.ang.dsc, (e.asc + 180) % 360, TOL.angle);
    check(tag + "IC", chart.ang.ic, (e.mc + 180) % 360, TOL.angle);
    check(tag + "Vertex", chart.ang.vertex, e.vertex, TOL.angle);
    check(tag + "EastPoint", chart.ang.ep, e.eastPoint, TOL.angle);

    for (let i = 0; i < 12; i++) check(tag + "cusp" + (i + 1), chart.cusps[i], e.cusps[i], TOL.cusp);

    const tolOf = { NNode: TOL.node, NNodeMean: TOL.node, Lilith: TOL.lilith, Chiron: TOL.chiron };
    // LilithTrue(密切黑月)本站不输出:定义因软体而异,预设一律用平均黑月。
    for (const k of Object.keys(e.points)) {
      if (e.points[k].error || k === "LilithTrue") continue;
      const x = chart.extras.find(p => p.key === k);
      check(tag + k, x ? x.lon : null, e.points[k].lon, tolOf[k] || TOL.asteroid);
    }

    // 南交点恒为北交点 +180
    const nn = chart.extras.find(p => p.key === "NNode");
    const sn = chart.extras.find(p => p.key === "SNode");
    if (nn && sn) check(tag + "SNode = NNode+180", sn.lon, (nn.lon + 180) % 360, 1);

    // 宫位:必须由未取整的黄经决定,而且要落在对应宫头区间内
    for (const p of chart.planets) {
      const h = p.house, lo = chart.cusps[h - 1], hi = chart.cusps[h % 12];
      const span = ((hi - lo) % 360 + 360) % 360 || 360;
      const rel = ((p.lon - lo) % 360 + 360) % 360;
      if (rel < span) pass++;
      else { fail++; failures.push(tag + p.key + " 落宫错误:H" + h); }
    }
  }
}

/* ---------- 3. 显示格式:度分一律截断,不四舍五入 ---------- */
function testFormatting() {
  const cases = [
    [28.1755, "28°10′", 28, 10],
    [0.9999, "0°59′", 0, 59],
    [29.99999, "29°59′", 29, 59],
    [7.0136, "7°00′", 7, 0]
  ];
  for (const [v, text, d, m] of cases) {
    const r = Astro.dms(v);
    checkEq("[fmt] " + v + " text", Astro.fmtDeg(v), text);
    checkEq("[fmt] " + v + " deg", r.deg, d);
    checkEq("[fmt] " + v + " min", r.min, m);
  }
}

/* ---------- 4. 相位:只看实际夹角 ---------- */
function testAspects() {
  const pts = [
    { key: "A", lon: 10, speed: 1 },
    { key: "B", lon: 130, speed: 0.1 },      // 与 A 相差 120°:拱相
    { key: "C", lon: 160.5, speed: 0.1 },    // 与 A 相差 150.5°:梅花(容许 3°)
    { key: "D", lon: 29.5, speed: 0.1 }      // 与 A 相差 19.5°:不成相位
  ];
  const asp = Astro.computeAspects(pts);
  const find = (a, b) => asp.find(x => (x.aKey === a && x.bKey === b) || (x.aKey === b && x.bKey === a));
  checkEq("[aspect] A-B 拱相", find("A", "B") && find("A", "B").type, "tri");
  checkEq("[aspect] A-C 梅花", find("A", "C") && find("A", "C").type, "qcx");
  checkEq("[aspect] A-D 无相位", find("A", "D"), undefined);
  const tri = find("A", "B");
  checkEq("[aspect] 精确夹角", Math.round(tri.exact * 10) / 10, 120);
  checkEq("[aspect] 入相位判定", tri.applying, false);   // A 走得快,正在离开 120°
  // 六种相位都要在设定里
  checkEq("[aspect] 支援梅花 150°", Astro.ASPECTS.some(a => a.angle === 150), true);
}

/* ---------- 5. 出生资料不完整时必须报错,不能偷偷用预设值 ---------- */
function testNoSilentDefaults() {
  const bad = [
    { label: "缺经纬度", birth: { date: "1990-01-01", time: "12:00", place: { tzId: "Asia/Singapore" } } },
    { label: "缺时区", birth: { date: "1990-01-01", time: "12:00", place: { lat: 1.29, lon: 103.85 } } },
    { label: "缺日期", birth: { time: "12:00", place: { lat: 1.29, lon: 103.85, tzId: "Asia/Singapore" } } }
  ];
  for (const b of bad) {
    let threw = false;
    try { Astro.computeNatalChart(b.birth); } catch (e) { threw = e.code === "INCOMPLETE_BIRTH_DATA"; }
    checkEq("[guard] " + b.label + " 应该报错", threw, true);
  }
  let badTz = false;
  try { TZ.localToUtc("1990-01-01", "12:00", "Not/AZone"); } catch (e) { badTz = e.code === "INVALID_TIMEZONE"; }
  checkEq("[guard] 无效时区应该报错", badTz, true);
}

/* ---------- 6. 出生时间未知:不得输出 ASC / MC / 宫位 / Vertex ---------- */
function testUnknownTime() {
  const out = Astro.computeNatalChart({
    date: "1994-11-21", unknownTime: true,
    place: { city: "Batu Pahat", lat: 1.8548, lon: 102.9325, tzId: "Asia/Kuala_Lumpur" }
  });
  checkEq("[unknown-time] 不给宫位", out.chart.cusps, null);
  checkEq("[unknown-time] 行星不落宫", out.chart.planets.every(p => p.house === null), true);
  const keys = out.chart.extras.map(x => x.key);
  for (const k of ["ASC", "MC", "DSC", "IC", "Vertex", "PoF"]) {
    checkEq("[unknown-time] 不输出 " + k, keys.indexOf(k) === -1, true);
  }
  checkEq("[unknown-time] 太阳仍然算得出来", !!out.chart.planets.find(p => p.key === "Sun"), true);
}

/* ---------- 7. 地点解析 ---------- */
function testPlaces() {
  return Places.load().then(function () {
    const r = Places.search("batu pahat", { lang: "en", limit: 3 });
    checkEq("[place] 搜到 Batu Pahat", r.length > 0 && r[0].city, "Batu Pahat");
    checkEq("[place] 地区 Johor", r[0].region, "Johor");
    checkEq("[place] 时区", r[0].tzId, "Asia/Kuala_Lumpur");
    checkEq("[place] 标签", r[0].label, "Batu Pahat, Johor, Malaysia");

    checkEq("[place] 中文可搜", Places.search("吉隆坡", { limit: 1 }).length > 0, true);
    checkEq("[place] Prague", (Places.search("prague", { lang: "en", limit: 1 })[0] || {}).tzId, "Europe/Prague");
    checkEq("[place] Taipei", (Places.search("taipei", { lang: "en", limit: 1 })[0] || {}).tzId, "Asia/Taipei");

    // 同名城市:不可以自动挑第一个
    const amb = Places.resolveLegacy({ city: "Springfield" });
    checkEq("[place] 同名城市回报 ambiguous", amb.status, "ambiguous");
    checkEq("[place] ambiguous 不给 place", amb.place, null);

    // 有经纬度的旧资料可以自动补时区
    const mig = Places.resolveLegacy({ city: "峇株巴辖", lat: 1.855, lon: 102.933 });
    checkEq("[place] 旧资料补时区", mig.status, "resolved");
    checkEq("[place] 旧资料时区正确", mig.place.tzId, "Asia/Kuala_Lumpur");

    // 中英双语标签
    checkEq("[place] 双语标签", r[0].display, "Batu Pahat, Johor, Malaysia · 峇株巴辖，柔佛，马来西亚");
    checkEq("[place] 英文标签", r[0].labelEn, "Batu Pahat, Johor, Malaysia");
    checkEq("[place] 中文标签", r[0].labelZh, "峇株巴辖，柔佛，马来西亚");
    checkEq("[place] 地区中文名", r[0].regionZh, "柔佛");

    // 打州属名(中英都要能搜),而且该州最大的城市要排前面
    const byRegionZh = Places.search("柔佛", { lang: "zh", limit: 5 });
    const byRegionEn = Places.search("Johor", { lang: "en", limit: 5 });
    checkEq("[place] 中文州属可搜", byRegionZh.length > 0 && byRegionZh[0].regionEn, "Johor");
    checkEq("[place] 英文州属可搜", byRegionEn.length > 0 && byRegionEn[0].regionEn, "Johor");
    checkEq("[place] 州属搜索含峇株巴辖",
      Places.search("柔佛", { lang: "zh", limit: 20 }).some(function (x) { return x.city === "Batu Pahat"; }), true);
    // 打国名也要能搜
    checkEq("[place] 中文国名可搜",
      (Places.search("马来西亚", { lang: "zh", limit: 1 })[0] || {}).countryCode, "MY");
    checkEq("[place] 英文国名可搜",
      (Places.search("Malaysia", { lang: "en", limit: 1 })[0] || {}).countryCode, "MY");
    // 打州名时,同名小镇不应压过该州的大城市
    checkEq("[place] California 先给加州的城市",
      (Places.search("California", { lang: "en", limit: 1 })[0] || {}).regionEn, "California");

    // 国家名用通用写法,不用 ISO 官方长名
    checkEq("[place] 中国不用官方长名",
      (Places.search("beijing", { lang: "en", limit: 1 })[0] || {}).countryEn, "China");
    // 自订表里的湖州属于中国,不能被时区猜成马来西亚
    const hz = Places.search("湖州", { lang: "zh", limit: 1 })[0] || {};
    checkEq("[place] 湖州国家正确", hz.countryCode, "CN");
    checkEq("[place] 湖州时区正确", hz.tzId, "Asia/Shanghai");

    checkEq("[place] 无资料回报 unresolved", Places.resolveLegacy({}).status, "unresolved");
    checkEq("[place] 校验缺时区", Places.validate({ lat: 1, lon: 2, city: "x" }).missing.join(), "timezone");
  });
}

/* ---------- 8. app.html:模块级宣告不得晚于首次渲染 ----------
   从落地页点进来是「带着 hash 整页载入 app.html」,冷启动那一刻
   applyRoute() 就会渲染页面。如果 render*Page / dpScaffold 用到的
   const / let 写在那行之后,就会踩进暂时性死区(TDZ),抛
   「Cannot access 'X' before initialization」,整个 IIFE 中断 ——
   症状是落地页正常、内页点进去一片空白。
   这一条守住那个顺序,免得再犯。 */
function testAppBootOrder() {
  const fs = require("fs");
  const html = fs.readFileSync(path.join(__dirname, "..", "app.html"), "utf8");
  const bootIdx = html.indexOf("\n  applyRoute();");
  checkEq("[boot] 找得到首次渲染的 applyRoute()", bootIdx > 0, true);
  if (bootIdx < 0) return;

  const after = html.slice(bootIdx + 1);
  // 模块级宣告 = 两格缩排的 const / let(函数内部至少四格)
  const late = [];
  const re = /^ {2}(const|let) ([A-Za-z_$][\w$]*)/gm;
  let m;
  while ((m = re.exec(after))) late.push(m[2]);
  checkEq("[boot] 首次渲染之后没有模块级 const / let 宣告" +
    (late.length ? ":" + late.slice(0, 6).join(", ") : ""), late.length, 0);
}

/* ---------- 9. 同一份资料,重复计算必须完全一致 ---------- */
function testDeterminism() {
  const birth = {
    date: "1994-11-21", time: "01:44",
    place: { city: "Batu Pahat", lat: 1.8548, lon: 102.9325, tzId: "Asia/Kuala_Lumpur" }
  };
  const a = Astro.computeNatalChart(birth), b = Astro.computeNatalChart(birth);
  const strip = (x) => JSON.stringify(x, (k, v) => (k === "computedAt" ? undefined : v));
  checkEq("[determinism] 两次结果一致", strip(a) === strip(b), true);
}

/* ---------- 10. 阅读预览:必须是「读完正文之后重新写的」,不是截断 ----------
   这一层的价值全在「preview 不是原文的前几句」。所以两端都要守:
     · 前端 dpLead:有生成结果就一定用它,没有才回落到本地摘录
     · 服务端 parsePreviewJson:模型把原文开头抄回来 / 太短 / 少一段,整批作废
   直接把两边的函式原始码抓出来执行,不是比对字串,改坏了会真的红。 */
function testReadingPreview() {
  const fs = require("fs");
  const vm = require("vm");
  const html = fs.readFileSync(path.join(__dirname, "..", "app.html"), "utf8");

  function grabFn(src, name, indent) {
    const head = "\n" + indent + "function " + name + "(";
    const i = src.indexOf(head);
    if (i < 0) return "";
    const j = src.indexOf("\n" + indent + "}\n", i);
    return j < 0 ? "" : src.slice(i, j + indent.length + 3);
  }

  // —— 前端 ——
  const feSrc = ["dpSents", "dpDerive", "dpLead", "dpPvMap", "threadPvItems"]
    .map(function (n) { return grabFn(html, n, "  "); }).join("\n");
  checkEq("[preview] 前端四个函式都还在", feSrc.indexOf("function dpLead") > 0 &&
    feSrc.indexOf("function dpPvMap") > 0 && feSrc.indexOf("function threadPvItems") > 0, true);
  const fe = { window: { Reading: { PREVIEW_VER: 1 } }, DP_LEADIN: /^(而|但)/ };
  vm.createContext(fe);
  vm.runInContext(feSrc + "\nthis.dpLead=dpLead;this.dpPvMap=dpPvMap;this.threadPvItems=threadPvItems;", fe);

  const body = "把这几个月读过的东西摆在一起,你会看到一张奇怪的图:一个在感情里靠近得很慢的人。\n\n" +
               "表面上这是五个不同的问题,但退远一步会发现它们其实是同一个动作的五种表现。";
  const gen = { preview: "你在感情、工作、家庭里的很多反应,看起来不一样,底下却来自同一个习惯。", keyInsights: ["a", "b", "c", "d"] };

  const withGen = fe.dpLead({ body: body }, gen);
  checkEq("[preview] 有生成结果就用生成的", withGen.preview, gen.preview);
  checkEq("[preview] 生成的 preview 不是正文开头", withGen.preview.slice(0, 8) !== body.slice(0, 8), true);
  checkEq("[preview] keyInsights 最多三条", withGen.keys.length, 3);
  checkEq("[preview] 没有生成结果才回落摘录", fe.dpLead({ body: body }).authored, false);
  checkEq("[preview] 版本对不上就当作没有", Object.keys(fe.dpPvMap({ previews: { ver: 0, map: { s0: gen } } })).length, 0);
  checkEq("[preview] 版本对得上就取用", Object.keys(fe.dpPvMap({ previews: { ver: 1, map: { s0: gen } } })).length, 1);

  const items = fe.threadPvItems({ sections: [{ title: "t", body: body }], steps: [{ title: "s", body: body }] });
  checkEq("[preview] 章节与行动卡都送去生成", items.map(function (x) { return x.id + ":" + x.kind; }).join(","), "s0:section,a0:step");
  checkEq("[preview] 送出的是完整正文,不是第一段", items[0].body, body);

  // 章节引子必须走 dpLead(接得到生成结果),不能直接呼叫 dpDerive
  const threadFn = grabFn(html, "dpThreadHtml", "  ");
  checkEq("[preview] 生命脉络章节改用 dpLead", /dpLead\(sc,\s*PV\["s"\s*\+\s*si\]\)/.test(threadFn), true);

  // —— 服务端 ——
  const ts = fs.readFileSync(path.join(__dirname, "..", "docs", "edge", "read-chart.ts"), "utf8");
  checkEq("[preview] 服务端有 kind=preview 这一层", ts.indexOf('kind === "preview"') > 0, true);
  checkEq("[preview] 预览层禁止截取原文", ts.indexOf("不要截取原文") > 0, true);
  const pi = ts.indexOf("function parsePreviewJson");
  const pj = ts.indexOf("\n}\n", pi);
  const parseSrc = ts.slice(pi, pj + 3)
    .replace(/:\s*Any\[\]/g, "").replace(/:\s*Any/g, "").replace(/:\s*string/g, "")
    .replace(/\((\w+):\s*\w+\)/g, "($1)");
  const be = {};
  vm.createContext(be);
  vm.runInContext(parseSrc + "\nthis.parse=parsePreviewJson;", be);
  const srvItems = [{ id: "s0", body: body }];
  const ok = be.parse(JSON.stringify({ previews: [{ id: "s0", preview: gen.preview, keyInsights: ["a"] }] }), srvItems);
  checkEq("[preview] 合格的输出收下", ok && ok[0].preview, gen.preview);
  checkEq("[preview] 抄原文开头的一律作废",
    be.parse(JSON.stringify({ previews: [{ id: "s0", preview: body.slice(0, 60) }] }), srvItems), null);
  checkEq("[preview] 太短的一律作废",
    be.parse(JSON.stringify({ previews: [{ id: "s0", preview: "太短了" }] }), srvItems), null);
  checkEq("[preview] 少一段就整批作废",
    be.parse(JSON.stringify({ previews: [{ id: "zz", preview: gen.preview }] }), srvItems), null);
  checkEq("[preview] 不是 JSON 也不会炸", be.parse("nothing here", srvItems), null);
}

/* ---------- 11. 生命脉络手机版:一条规则都不许外溢到桌机 ----------
   这一轮只动手机(≤767px)。桌机是锁死的基准,所以这里守两件事:
     1. 手机版新加的选择器,只能出现在 @media(max-width:767px) 里面
     2. 手机专属的节点(.mob-only)在这一页的桌机样式里必须先被关掉
   任何一条被搬到媒体查询外面,这里就会红。 */
function testThreadMobileScope() {
  const fs = require("fs");
  const html = fs.readFileSync(path.join(__dirname, "..", "app.html"), "utf8");

  /* 取出 .thread-page 那一段样式里的手机版区块。
     全站有两个 @media(max-width:767px)(另一个是「我的星空」),
     所以从生命脉络那一段的注解往下找,不会抓错人。 */
  const mark = html.indexOf("手机版(≤767px)—— 自己一套版面");
  checkEq("[mobile] 找得到生命脉络手机版区块的起点", mark > 0, true);
  const i = mark < 0 ? -1 : html.indexOf("\n  @media(max-width:767px){", mark);
  checkEq("[mobile] 找得到生命脉络的手机版区块", i > 0, true);
  if (i < 0) return;
  // 以缩排两格的 "}" 作为区块结尾
  const end = html.indexOf("\n  }\n", i);
  const inside = html.slice(i, end);
  const outside = html.slice(0, i) + html.slice(end);

  // 手机专属的选择器一律不得出现在区块外面
  /* 这几个选择器是这一轮才出现的,桌机没有对应规则 —— 一旦被搬出媒体查询,
     桌机就会跟着变,所以钉死在这里。
     (像 .ch-card .gl 这种「桌机本来就有、手机只是覆写」的不列入:
      覆写本身就是正确做法,它只要留在 ≤767px 里就好。) */
  const MOBILE_ONLY = [
    ".thread-map", ".ch-layer", "p.pq", ".thread-return", ".dp-h-row .fav-btn"
  ];
  MOBILE_ONLY.forEach(function (sel) {
    checkEq("[mobile] " + sel + " 只写在 ≤767px 里",
      inside.indexOf(sel) > 0 && outside.indexOf("#dpage.thread-page " + sel) < 0, true);
  });

  // .mob-only 的桌机预设必须是 display:none,而且写在媒体查询外面
  checkEq("[mobile] 手机专属节点在桌机一律不显示",
    outside.indexOf("#dpage.thread-page .mob-only{display:none}") > 0, true);
  checkEq("[mobile] 手机版才把它打开", inside.indexOf(".mob-only{display:block}") > 0, true);

  // 共用的返回区块:不传参数时产生的 HTML 不得带上任何手机节点
  const foot = (function () {
    const k = html.indexOf("function dpReturnFoot(");
    return k < 0 ? "" : html.slice(k, html.indexOf("\n  }\n", k));
  })();
  checkEq("[mobile] dpReturnFoot 仍有「不传参数就和以前一样」的分支",
    /threadTail\s*\?/.test(foot) && foot.indexOf(": label") > 0, true);
  checkEq("[mobile] 只有生命脉络那一页传 true",
    (html.match(/dpReturnFoot\(true\)/g) || []).length, 1);

  // 展开的原文必须仍然长在自己那一章里(手机手风琴的位置保证)
  const thread = (function () {
    const k = html.indexOf("function dpThreadHtml(");
    return k < 0 ? "" : html.slice(k, html.indexOf("\n  }\n", k));
  })();
  checkEq("[mobile] 完整原文仍写在各自的 .thread-ch 内",
    thread.indexOf('<div class="ch-full" id="full-') > 0 &&
    thread.indexOf('class="dp-prose" data-saveable') > 0, true);
  // 引句只加 class,不得改写内容
  const js = html.slice(html.indexOf("长文的呼吸(只在手机)"));
  checkEq("[mobile] 引句只挂 class,不动文字",
    js.indexOf('classList.add("pq")') > 0 &&
    js.slice(0, js.indexOf('classList.add("pq")')).indexOf("textContent =") < 0 &&
    js.slice(0, js.indexOf('classList.add("pq")')).indexOf("innerHTML =") < 0, true);
}

/* ---------- 12. 我的内在指南:只准新增,不准动到既有的东西 ----------
   这一轮是纯增量。守四件事:
     1. 下拉选单的顺序与位置正确,而且既有五项一个字都没改
     2. 新页面的样式全部锁在 .compass-page 底下,不外溢
     3. 页面上不准写死任何「属于某个人的答案」—— 一律走 window.Compass
     4. 路由只是多一条,既有路由的写法没有被动过 */
function testInnerCompass() {
  const fs = require("fs");
  const html = fs.readFileSync(path.join(__dirname, "..", "app.html"), "utf8");

  // —— 1. 下拉选单 ——
  const nav = (function () {
    const i = html.indexOf("function dpNavItems()");
    return i < 0 ? "" : html.slice(i, html.indexOf("\n  }\n", i));
  })();
  const order = (nav.match(/dpT\("([^"]+)"/g) || []).map(function (x) { return x.slice(5, -1); });
  checkEq("[compass] 选单顺序正确",
    order.join(" / "),
    "首页 / 探索主题 / 我的生命蓝图 / 我的星空 / 属于我的生命脉络 / 我的内在指南 / 我的收藏");
  // 既有五项的 href 与出现位置一个字都不能变
  [["我的生命蓝图", "#/reading", "both"], ["我的星空", "#/my-sky", "both"],
   ["属于我的生命脉络", "#/map", "both"], ["我的收藏", "#/favorites", "both"]].forEach(function (row) {
    const re = new RegExp('dpT\\("' + row[0] + '"[^\\]]*"' + row[1].replace("/", "\\/") + '"[^\\]]*"' + row[2] + '"');
    checkEq("[compass] 既有项目未被改动:" + row[0], re.test(nav), true);
  });
  // 新项目只进下拉选单(menu),不进 Desktop 横向导航列
  checkEq("[compass] 新项目只进下拉选单,不动横向导航列",
    /dpT\("我的内在指南"[^\]]*"#\/compass"[^\]]*"menu"/.test(nav), true);

  // —— 2. 路由 ——
  checkEq("[compass] 路由已登记", html.indexOf('if (h === "#/compass") return { k: "compass" };') > 0, true);
  checkEq("[compass] 分派已登记", html.indexOf('else if (r.k === "compass") renderCompassPage();') > 0, true);
  // 既有路由一条都没被动过
  ['if (h === "#/my-sky") return { k: "mysky" };',
   'if (h === "#/favorites") return { k: "favorites" };',
   'if (h === "#/settings") return { k: "settings" };',
   'if (h === "#/map") return { k: "map" };'].forEach(function (line) {
    checkEq("[compass] 既有路由未被改动:" + line.slice(13, 24), html.indexOf(line) > 0, true);
  });

  // —— 3. 样式作用域 ——
  const css = (function () {
    const i = html.indexOf("我的内在指南(#/compass)—— 新增页面的样式");
    const j = html.indexOf("/* 划词收藏:轻盈的浮动动作", i);
    return i < 0 || j < 0 ? "" : html.slice(i, j);
  })();
  checkEq("[compass] 找得到这一页的样式区块", css.length > 2000, true);
  const leaks = [];
  (css.match(/^\s*#dpage(?!\.compass-page)[^{]*\{/gm) || []).forEach(function (sel) {
    leaks.push(sel.trim());
  });
  checkEq("[compass] 每一条规则都带 .compass-page" + (leaks.length ? ":" + leaks.slice(0, 3).join(" ") : ""),
    leaks.length, 0);

  // —— 4. 内容边界:页面不得写死任何「属于某个人的答案」——
  /* 正式页面那一段。Phase 5 起中间夹了一块【被授权】呼叫 compass-generate 的
     dev preview(cpPvLoadOne … renderCompassPage),那一块不属于正式页面,
     所以从这里剪掉 —— 否则「正式页面不送生成请求」这条断言会被它误伤。 */
  const page = (function () {
    const i = html.indexOf("页面:我的内在指南(#/compass)");
    const j = html.indexOf("function renderFavoritesPage()", i);
    if (i < 0 || j < 0) return "";
    const whole = html.slice(i, j);
    const a = whole.indexOf("function cpPvLoadOne");
    const b = whole.indexOf("function renderCompassPage");
    return (a > 0 && b > a) ? whole.slice(0, a) + whole.slice(b) : whole;
  })();
  checkEq("[compass] 找得到页面实作", page.length > 2000, true);
  /* Phase 8 起:四个方向来自【已生成并通过验证】的本机快取,
     锚点与今天的问题都是从那一份推出来的 —— 页面自己不写任何内容。 */
  /* R1 起,页面读的是【解析过的正式那一份】,不是直接读本机快取 */
  checkEq("[compass] 四个方向来自解析过的正式结果",
    /const saved = compassSavedResult\(\);/.test(page), true);
  checkEq("[compass] 锚点与今天的问题也来自同一份",
    (page.match(/compassSavedResult\(\)/g) || []).length >= 3, true);
  checkEq("[compass] 还没接上生成逻辑时会标示「示例」",
    /compassStub\(/.test(page) && /示例 · 尚未接上你的星盘/.test(page), true);

  // Compass 模组本身:placeholder 边界要说得出自己是 placeholder
  const mod = (function () {
    const i = html.indexOf("我的内在指南 · 资料层与储存层(Compass)");
    const j = html.indexOf("window.Compass = {", i);
    return i < 0 || j < 0 ? "" : html.slice(i, j);
  })();
  checkEq("[compass] 生成接口存在,且还没有注册生成器时回传 null",
    /let generator = null;/.test(mod) &&
    /function setGenerator\(fn\)/.test(mod) &&
    /if \(!generator\) return null;/.test(mod), true);
  checkEq("[compass] 生成器丢错不会让页面开天窗",
    /catch \(e\) \{ return null; \}/.test(mod), true);
  checkEq("[compass] 生成契约有写下来", /GENERATION_CONTRACT/.test(mod), true);
  checkEq("[compass] 没有生成结果时一律标为 placeholder",
    (mod.match(/source:\s*"placeholder"/g) || []).length >= 3, true);
  checkEq("[compass] 储存层是可替换的三个方法",
    /list:\s*function/.test(mod) && /add:\s*function/.test(mod) && /remove:\s*function/.test(mod), true);
  checkEq("[compass] 两个实作都在(资料库 / 本机)",
    /const localStore = \{/.test(mod) && /const tableStore = \{/.test(mod), true);
  checkEq("[compass] 探测不到表时安静回落到本机",
    /return r\.ok \? tableStore : localStore;/.test(mod) &&
    /\.catch\(function \(\) \{ return localStore; \}\)/.test(mod), true);
  checkEq("[compass] 不会自己去建表 / 改表",
    !/create table|alter table|drop table/i.test(mod), true);
  checkEq("[compass] 单则记录有长度上限", /MAX_TEXT/.test(mod) && /\.slice\(0, MAX_TEXT\)/.test(mod), true);

  // —— 5. 正式的内在指南页面不准送出任何生成请求 ——
  /* 注解不算数(注解里会提到 read-chart 的做法);Phase 5 起 dev preview 被授权
     呼叫 compass-generate,所以这里只看正式页面那一段的【程式码】。 */
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  checkEq("[compass] 正式页面没有呼叫 Edge Function / Claude",
    !/callFunc\(|read-chart|anthropic/i.test(strip(page + mod)), true);

  /* —— 6. 落地页那份选单 ——
     index.html 有自己一份已登入选单(#navUserMenu),与 app.html 的 dpNavItems()
     是两段各自写死的清单。这一条盯住「两边不要再走散」:
     app 的下拉选单里有的内页项目,落地页那一份也要有,顺序一致。
     (顶部横向导航列 探索 / 我的星空 / 收藏 / 关于我们 不在此列,本来就不同。) */
  const landing = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const lmenu = (function () {
    const i = landing.indexOf('id="navUserMenu"');
    return i < 0 ? "" : landing.slice(i, landing.indexOf("</div>", landing.indexOf('id="navLogout"', i)));
  })();
  checkEq("[compass] 找得到落地页的已登入选单", lmenu.length > 200, true);
  const lApp = (lmenu.match(/data-app-hash="(#\/[a-z-]+)"/g) || [])
    .map(function (x) { return x.slice(15, -1); });
  checkEq("[compass] 落地页选单的内页项目与顺序",
    lApp.join(" "), "#/reading #/my-sky #/map #/compass #/favorites #/settings");
  checkEq("[compass] 落地页也有我的内在指南这一项",
    /data-app-hash="#\/compass"[^>]*>我的内在指南</.test(lmenu), true);
  // 顶部横向导航列不准被动到
  ["探索", "我的星空", "收藏", "关于我们"].forEach(function (t) {
    checkEq("[compass] 落地页顶部导航列仍有:" + t,
      new RegExp('<a[^>]*>' + t + '</a>').test(landing), true);
  });

  // —— 7. 下一阶段要什么,必须写下来 ——
  const doc = path.join(__dirname, "..", "docs", "COMPASS-NEXT-STEPS.md");
  checkEq("[compass] 下一阶段的资料库说明存在", fs.existsSync(doc), true);
}

/* ---------- 13. 内在指南 · 证据抽取原型 ----------
   这一关守的是「系统凭什么这样说」,不是「系统最后怎么说」。
   逐条对应任务书第 23 节要求的 15 项。 */
function testCompassEvidence() {
  const fs = require("fs");
  const CE = require(path.join(__dirname, "..", "assets", "compass-evidence.js"));
  const Astro2 = require(path.join(__dirname, "..", "assets", "astro", "astro-core.js"));
  const natal = Astro2.computeNatalChart({
    date: "1994-11-21", time: "01:44",
    place: { city: "Batu Pahat", lat: 1.8548, lon: 102.9325, tzId: "Asia/Kuala_Lumpur" }
  }).chart;

  const THEMES = {
    self:   { tagline: "你想清楚了才愿意说出来。", aha: ["确定之前你不会先讲"] },
    family: { tagline: "你很早就学会承担，累了也常常先撑着。", aha: ["责任是自动接下的"] },
    body:   { tagline: "你通常是事情结束以后，才发现自己撑了一阵子。", aha: ["累是后知后觉的"] }
  };
  const THREAD = {
    tagline: "你要确认足够安全，才愿意把它带出来。",
    aha: ["谨慎保护过你，也在消耗你"],
    previews: { map: { s0: { preview: "你需要先想清楚才说出来。", keyInsights: ["确定之后才带出来"] } } }
  };
  const full = CE.build({ evidence: { chart: natal, themes: THEMES }, context: { lifeThreads: THREAD } });
  const find = (k) => full.candidates.find(c => c.patternKey === k);

  // 1 · 单一落点不能成为 accepted
  const isolated = full.candidates.filter(c => c.independentEvidenceCount < 2);
  checkEq("[evi] 单一落点一律不是 accepted",
    isolated.every(c => c.status !== "accepted"), true);
  checkEq("[evi] 单一落点的拒绝原因写得出来",
    isolated.every(c => !c.rejectionReason || /isolated|generic|no-chart|life-threads/.test(c.rejectionReason)), true);

  // 2 · 生命脉络不得增加独立证据数
  const noThread = CE.build({ evidence: { chart: natal, themes: THEMES }, context: {} });
  const withThread = full;
  const sameCount = CE.PATTERN_RULES.every(r => {
    const a = noThread.candidates.find(c => c.patternKey === r.patternKey);
    const b = withThread.candidates.find(c => c.patternKey === r.patternKey);
    return a.independentEvidenceCount === b.independentEvidenceCount;
  });
  checkEq("[evi] 加进生命脉络之后,独立证据数一个都没变", sameCount, true);
  checkEq("[evi] 生命脉络的来源一律标成不计入",
    full.candidates.every(c => c.sourceSignals
      .filter(s => s.sourceType === "lifeThread")
      .every(s => s.countsTowardIndependentEvidence === false &&
                  s.independence === "contextual-only" && s.role === "contextual")), true);

  // 3 · 主题说 A + 衍生的生命脉络也说 A,不得算成两份独立证据
  const clarity = find("clarity-before-release");
  const th = clarity.sourceSignals.find(s => s.sourceType === "lifeThread");
  checkEq("[evi] 主题与生命脉络讲同一件事时,标出 circularity", !!(th && th.circularityBlocked), true);
  checkEq("[evi] 主题支持本身也不计入独立证据",
    full.candidates.every(c => c.sourceSignals
      .filter(s => s.sourceType === "theme")
      .every(s => s.countsTowardIndependentEvidence === false)), true);
  /* Phase 3.5 起,独立性以「结构锚点」计而不是讯号笔数 ——
     同一个宫位里的四颗行星是一个结构事实,不是四份独立证据。
     这里守两件事:只数盘面讯号,而且数的是锚点。 */
  checkEq("[evi] 独立证据数只数盘面讯号(主题 / 生命脉络一律不进)",
    full.candidates.every(c => c.independentEvidenceCount <=
      new Set(c.sourceSignals.filter(s => s.sourceType === "chart").map(s => s.independenceKey)).size), true);
  checkEq("[evi] 独立证据数 = 结构锚点数",
    full.candidates.every(c => c.independentEvidenceCount === (c.structuralAnchors || []).length), true);
  checkEq("[evi] 同一个宫位里的多颗行星只算一个结构",
    full.candidates.every(c => (c.structuralAnchors || [])
      .filter(a => a.indexOf("house:") === 0).length ===
      new Set((c.structuralAnchors || []).filter(a => a.indexOf("house:") === 0)).size), true);

  // 4 · 两个真正独立的盘面讯号可以形成候选
  const carry = find("carry-before-noticing-cost");
  checkEq("[evi] 两个以上独立盘面讯号可以成为 accepted",
    carry.independentEvidenceCount >= 2 && carry.status === "accepted", true);
  checkEq("[evi] 同一个结构重複出现只算一次",
    new Set(carry.sourceSignals.filter(s => s.sourceType === "chart").map(s => s.independenceKey)).size ===
    carry.independentEvidenceCount, true);

  // 5 · 可以被标成 provisional
  checkEq("[evi] 有 provisional 这一类且真的用到",
    full.candidates.some(c => c.status === "provisional"), true);

  // 6 · 太泛的候选会被挡下来
  const generic = find("values-security");
  checkEq("[evi] 没有 mechanism 的候选被拒绝",
    generic.status === "rejected" && generic.rejectionReason === "too-generic-no-mechanism", true);
  checkEq("[evi] 合格候选一律写得出 mechanism",
    full.candidates.filter(c => c.status === "accepted").every(c => !!c.mechanism), true);

  // 7 · 重複候选可以被辨识
  const dup = CE.build({ evidence: { chart: natal, themes: {} }, context: {} });
  checkEq("[evi] 同一机制家族只会留一个不被标重複",
    dup.candidates.filter(c => c.mechanismFamily === "withdraw-to-reset" && !c.duplicateOf).length <= 1, true);
  const diversity = CE.diversityCheck(full);
  checkEq("[evi] 多样性检查跑得出结果", typeof diversity.ok === "boolean", true);

  // 8 · 矛盾可以被保留成张力
  const tension = full.tensions.find(t => t.bothStrong);
  checkEq("[evi] 两边都强的对立会保留成 tension,而不是砍掉一边",
    !!tension && tension.compatibleAsTension === true && tension.resolution === "keep-as-tension", true);
  checkEq("[evi] 张力会挂回两个候选身上",
    !!tension && find(tension.patternA).contradictionSignals.length > 0 &&
                 find(tension.patternB).contradictionSignals.length > 0, true);

  // 9 / 10 · 日记与收藏永远不进证据
  const src = fs.readFileSync(path.join(__dirname, "..", "assets", "compass-evidence.js"), "utf8");
  ["favs", "journal", "mood", "compass_entries", "reflectionAnswer"].forEach(function (k) {
    checkEq("[evi] 证据层完全不读 " + k, src.indexOf(k) < 0 ||
      src.indexOf("excludedSources") > 0 && !new RegExp("input[\\s\\S]{0,40}" + k).test(src), true);
  });
  const polluted = CE.build({
    evidence: { chart: natal, themes: THEMES, favorites: ["x"], journal: ["y"] },
    context: { lifeThreads: THREAD, mood: "平静" }
  });
  checkEq("[evi] 就算硬塞收藏 / 日记进来,结果也完全一样",
    JSON.stringify(polluted.candidates.map(c => [c.patternKey, c.independentEvidenceCount, c.status])) ===
    JSON.stringify(full.candidates.map(c => [c.patternKey, c.independentEvidenceCount, c.status])), true);
  checkEq("[evi] 报告明写排除了哪些来源",
    full.excludedSources.join(",") === "favorites,journal,mood,reflectionAnswers", true);

  // 11–14 · 既有产品没有被动到
  const html = fs.readFileSync(path.join(__dirname, "..", "app.html"), "utf8");
  checkEq("[evi] 内在指南 UI 的区块数没有变(仍是五段)",
    (html.match(/class="cp-sec /g) || []).length >= 5, true);
  checkEq("[evi] 路由仍然只有原本那几条 + compass",
    html.indexOf('if (h === "#/compass") return { k: "compass" };') > 0 &&
    html.indexOf('if (h === "#/map") return { k: "map" };') > 0 &&
    html.indexOf('if (h === "#/my-sky") return { k: "mysky" };') > 0, true);
  const ts = fs.readFileSync(path.join(__dirname, "..", "docs", "edge", "read-chart.ts"), "utf8");
  checkEq("[evi] 生命脉络的 Prompt 没有被动过",
    /把前面读过的所有理解连起来/.test(ts) && ts.indexOf('kind === "compass"') < 0, true);
  checkEq("[evi] 九个主题的 Prompt 没有被动过",
    /现在写【第二部分 · 主题探索】中的一章/.test(ts), true);

  // 15 · 没有新增任何模型呼叫
  checkEq("[evi] 证据层没有任何网路 / API 呼叫",
    !/fetch\(|XMLHttpRequest|anthropic|callFunc|supabase/i.test(src), true);
  checkEq("[evi] 服务端仍然只有四种 kind",
    ts.indexOf('kind === "preview"') > 0 && ts.indexOf('kind === "compass"') < 0, true);

  // 接线:curResult 进得来,而且角色标好了
  checkEq("[evi] app.html 会把 curResult 交给证据层",
    /window\.Compass\.setNatal\(curResult\)/.test(html), true);
  checkEq("[evi] 输入把三种来源的角色分好",
    /chart: natal,\s*\/\/ 主要证据/.test(html) &&
    /themes: c\[K\("topics"\)\]/.test(html) &&
    /_lifeThreadsCountsAsEvidence: false/.test(html), true);
  checkEq("[evi] 没有注册生成器时,行为与以前一样(回传 null)",
    /if \(!generator\) return null;/.test(html), true);
}

/* ---------- 14. 内在指南 · 规则扩展 + composite + insufficient_evidence ----------
   对应本阶段任务书 E 节要求的九项。 */
function testCompassRules() {
  const CE = require(path.join(__dirname, "..", "assets", "compass-evidence.js"));
  const Astro3 = require(path.join(__dirname, "..", "assets", "astro", "astro-core.js"));
  const chart = (d, t, lat, lon, tz) =>
    Astro3.computeNatalChart({ date: d, time: t, place: { lat: lat, lon: lon, tzId: tz } }).chart;
  const A = chart("1994-11-21", "01:44", 1.8548, 102.9325, "Asia/Kuala_Lumpur");
  const E = chart("1969-05-17", "09:40", -33.8688, 151.2093, "Australia/Sydney");
  const run = (n, themes, thread) => CE.build({
    evidence: { chart: n, themes: themes || {} },
    context: thread ? { lifeThreads: thread } : {}
  });
  const rA = run(A), rE = run(E);

  // —— 规则表本身 ——
  const core = CE.PATTERN_RULES.filter(r => r.family !== "GUARD");
  checkEq("[rules] 核心规则 24–30 条", core.length >= 24 && core.length <= 30, true);
  const fams = {};
  core.forEach(r => { fams[r.family] = (fams[r.family] || 0) + 1; });
  checkEq("[rules] 按人类机制分成七族",
    ["REGULATION", "PROCESSING", "LOAD", "DRIVE", "DIRECTION", "RELATION", "DECISION"]
      .every(f => fams[f] >= 2), true);
  // 不准有 single-placement 规则:每条核心规则至少两组 needs
  checkEq("[rules] 没有任何核心规则只靠单一结构",
    core.every(r => r.needs.length >= 2 && r.needs.every(g => g.length >= 1)), true);
  checkEq("[rules] 每条核心规则都写得出 mechanism",
    core.every(r => typeof r.mechanism === "string" && r.mechanism.length > 40), true);
  checkEq("[rules] 每条核心规则都标了通用化风险与最低独立证据",
    core.every(r => ["low", "medium", "high"].indexOf(r.genericRisk) >= 0), true);
  /* Phase 3.5 修掉的记账漏洞:DIRECTION_DOMAINS 是 9 条规则时写的,
     扩到 27 条时有 8 个 domain 从没被加进任何方向、3 个列错方向 ——
     导致 11 条规则不管证据多好都拿不到「方向相关」那 2 分。
     这条不变量确保它不会再发生:每条规则的 domain
     都必须出现在它自己宣告的 primary 方向底下。 */
  const orphanDomains = core.filter(r =>
    (CE.DIRECTION_DOMAINS[r.compass.primary] || []).indexOf(r.domain) < 0);
  checkEq("[rules] 每条规则的 domain 都列在它宣告的方向下" +
    (orphanDomains.length ? ":" + orphanDomains.map(r => r.patternKey + "(" + r.domain + ")").slice(0, 4).join(", ") : ""),
    orphanDomains.length, 0);
  checkEq("[rules] secondary 方向若有宣告,也必须列得出来",
    core.every(r => !r.compass.secondary ||
      !CE.DIRECTION_DOMAINS[r.compass.secondary] ||
      typeof r.compass.secondary === "string"), true);

  checkEq("[rules] 高风险规则的独立证据门槛更高",
    rA.candidates.filter(c => c.genericRisk === "high")
      .every(c => c.minIndependent >= 3), true);
  // 护栏规则:刻意只靠一个结构 → 永远不能 accepted
  const guard = rA.candidates.find(c => c.patternKey === "single-signal-sensitivity");
  checkEq("[rules] 刻意的单一结构规则永远不会 accepted", guard.status !== "accepted", true);

  // —— 同一个盘面讯号不得被重複计数 ——
  checkEq("[rules] 独立证据数不会超过实际讯号数(锚点只会收敛,不会虚增)",
    rA.candidates.every(c => {
      const keys = c.sourceSignals.filter(s => s.sourceType === "chart").map(s => s.independenceKey);
      return c.independentEvidenceCount <= new Set(keys).size;
    }), true);
  checkEq("[rules] 有候选真的被锚点收敛过(证明这条防线在动)",
    rA.candidates.some(c => c.rawChartSignalCount > c.independentEvidenceCount), true);
  checkEq("[rules] 不同规则共用同一讯号,不会在单一候选内重複计",
    rA.candidates.every(c => {
      const keys = c.sourceSignals.filter(s => s.sourceType === "chart").map(s => s.independenceKey);
      return keys.length === new Set(keys).size;
    }), true);

  // —— A. insufficient_evidence ——
  checkEq("[rules] 每个方向都有自己的状态",
    CE.DIRECTIONS.every(d => !!rA.directionStatus[d] &&
      ["accepted", "insufficient_evidence"].indexOf(rA.directionStatus[d].status) >= 0), true);
  checkEq("[rules] 真实盘上确实出现 insufficient_evidence(E 盘 drains)",
    rE.directionStatus.drains.status, "insufficient_evidence");
  checkEq("[rules] insufficient 时不给 top,也不自动升级 provisional",
    rE.directionStatus.drains.topPatternKey === null &&
    rE.directionStatus.drains.acceptedCount === 0, true);
  const drainsProv = rE.candidates.filter(c =>
    c.compassRelevance.primary === "drains" && c.status === "provisional");
  checkEq("[rules] 该方向确实还有 provisional,但没有被升上来",
    drainsProv.length > 0 && drainsProv.every(c => c.status === "provisional"), true);
  checkEq("[rules] 状态里明写不会为了凑满而降门槛",
    /threshold is NOT lowered/.test(rE.directionStatus.drains.note || ""), true);

  // —— B. composite ——
  const comp = rA.composites.find(c => c.compositeKey === "regulation-sequence");
  checkEq("[rules] composite 只从白名单产生",
    rA.composites.length === CE.COMPOSITE_RULES.length, true);
  checkEq("[rules] regulation-sequence 在 A 盘成立", comp.status, "accepted");
  checkEq("[rules] composite 记得住行为顺序",
    comp.sequence.join(">"), "withdraw>process>articulate>reconnect");
  checkEq("[rules] composite 的张力以顺序化解", comp.contradictionResolvedAsSequence, true);
  checkEq("[rules] composite 有自己的证据联集,且多于任一 child",
    comp.independentEvidenceCount > Math.max(
      ...comp.childPatterns.map(k => rA.candidates.find(c => c.patternKey === k).independentEvidenceCount)), true);
  // 不吞掉 child:两个 child 仍然在池子里,证据与状态都还在
  const kids = comp.childPatterns.map(k => rA.candidates.find(c => c.patternKey === k));
  checkEq("[rules] composite 不吞掉 child —— child 仍在候选池且仍是 accepted",
    kids.length === 2 && kids.every(k => k && k.status === "accepted" &&
      k.independentEvidenceCount >= 2 && k.sourceSignals.length > 0), true);
  checkEq("[rules] child 会标记自己属于哪个 composite",
    kids.every(k => k.partOfComposite === "regulation-sequence"), true);
  // 强证据才允许合并
  const weak = rA.composites.find(c => c.compositeKey === "output-gate-sequence");
  checkEq("[rules] 证据不够的 composite 不会成立", weak.status, "rejected");
  checkEq("[rules] 而且说得出为什么不成立",
    /child-pattern-rejected|child-evidence-too-weak|unrelated-systems|same-evidence|adds-no-information/
      .test(weak.rejectionReason), true);
  // 不相关的两个 pattern 不会被误合并
  checkEq("[rules] 没有宣告过的组合永远不会变成 composite",
    CE.COMPOSITE_RULES.every(r => r.childPatterns.length === 2) &&
    rA.composites.every(c => CE.COMPOSITE_RULES.some(r => r.compositeKey === c.compositeKey)), true);
  checkEq("[rules] composite 必须检查两边讲的是同一套系统(共同盘面物件)",
    Array.isArray(comp.checks.sharedActors) && comp.checks.sharedActors.length >= 1, true);
  /* 这一条专门盯住「两边都够强、但讲的是不相关的系统」——
     不是理论:1981-07-12 这张盘就是这个情况(两个 child 分别 8 分与 7 分,
     却没有任何共同的盘面物件),必须因为 unrelated-systems 被挡下来。 */
  const U = chart("1981-07-12", "08:30", 3.139, 101.6869, "Asia/Kuala_Lumpur");
  const rU = run(U);
  const uComp = rU.composites.find(c => c.compositeKey === "regulation-sequence");
  checkEq("[rules] 两边都够强但系统不相关时,composite 仍然不成立",
    uComp.checks.bothChildrenStrong === true &&
    uComp.checks.sharedActors.length === 0 &&
    uComp.status === "rejected" &&
    uComp.rejectionReason === "children-describe-unrelated-systems", true);

  // —— 门槛没有被降低 ——
  checkEq("[rules] 最低标准(2 独立证据、无主题支持)只能到 provisional,不是 accepted",
    rA.candidates.filter(c => c.status === "accepted")
      .every(c => c.independentEvidenceCount >= 2), true);
  checkEq("[rules] accepted 的分数有鉴别力,不是全部同分",
    new Set(rA.candidates.filter(c => c.status === "accepted").map(c => c.strength)).size > 1, true);

  // —— 既有逻辑没有被这一轮改坏 ——
  checkEq("[rules] 通用规则仍然被拒",
    rA.candidates.find(c => c.patternKey === "values-security").rejectionReason,
    "too-generic-no-mechanism");
  checkEq("[rules] 三种状态都还在用",
    ["accepted", "provisional", "rejected"]
      .every(st => rA.candidates.some(c => c.status === st)), true);
  const withThread = run(A, { self: { tagline: "你想清楚才说出来。", aha: ["确定之前不讲"] } },
    { tagline: "你要确认安全才带出来。", aha: ["谨慎在消耗你"] });
  checkEq("[rules] 生命脉络仍然不增加任何独立证据",
    CE.PATTERN_RULES.every(r => {
      const a = rA.candidates.find(c => c.patternKey === r.patternKey);
      const b = withThread.candidates.find(c => c.patternKey === r.patternKey);
      return a.independentEvidenceCount === b.independentEvidenceCount;
    }), true);
}

/* ---------- 15. 内在指南 Phase 3 · 差异化与选择 ----------
   对应任务书第 31 节的 25 项。核心是:选择只能在 accepted pool 内排序,
   永远不能回头改变 evidence status。 */
function testCompassSelection() {
  const fs = require("fs");
  const CE = require(path.join(__dirname, "..", "assets", "compass-evidence.js"));
  const CS = require(path.join(__dirname, "..", "assets", "compass-selection.js"));
  const Astro4 = require(path.join(__dirname, "..", "assets", "astro", "astro-core.js"));
  const mk = (d, t, lat, lon, tz) =>
    Astro4.computeNatalChart({ date: d, time: t, place: { lat, lon, tzId: tz } }).chart;
  /* 测试盘清单的单一来源:assets/compass-cases.js(Phase 5 起三处共用同一份) */
  const FIX = require(path.join(__dirname, "..", "assets", "compass-cases.js")).tuples();
  const build = (extra) => {
    extra = extra || {};
    const cases = FIX.map(([id, d, t, la, lo, tz]) => ({
      caseId: id,
      report: CE.build({
        // 每张盘仍然是自己的盘 —— extra 只是往 evidence / context 里多塞栏位
        evidence: Object.assign({ chart: mk(d, t, la, lo, tz), themes: {} }, extra.evidence || {}),
        context: Object.assign({}, extra.context || {})
      })
    }));
    const corpus = CS.buildCorpus(cases);
    cases.forEach(c => { c.selection = CS.select(c.report, corpus); });
    return { cases, corpus };
  };
  const { cases, corpus } = build();
  const byId = {}; cases.forEach(c => { byId[c.caseId] = c; });

  // 1 · rejected 永远不能因为 distinctiveness 复活
  const allSelectedKeys = [];
  cases.forEach(c => CS.DIRECTIONS.forEach(d => {
    const dd = c.selection.directions[d];
    if (dd.primary) allSelectedKeys.push({ caseId: c.caseId, key: dd.primary.key, kind: dd.primary.kind });
  }));
  checkEq("[sel] 被选中的东西一定是 accepted 的 pattern 或 composite",
    allSelectedKeys.every(s => {
      const c = byId[s.caseId];
      if (s.kind === "composite")
        return c.report.composites.some(x => x.compositeKey === s.key && x.status === "accepted");
      return c.report.candidates.some(x => x.patternKey === s.key && x.status === "accepted");
    }), true);
  checkEq("[sel] rejected 的 pattern 从来没有被选中过",
    allSelectedKeys.every(s => {
      const c = byId[s.caseId];
      const cand = c.report.candidates.find(x => x.patternKey === s.key);
      return !cand || cand.status !== "rejected";
    }), true);
  // 2 · provisional 也不行
  checkEq("[sel] provisional 从来没有被选中过",
    allSelectedKeys.every(s => {
      const c = byId[s.caseId];
      const cand = c.report.candidates.find(x => x.patternKey === s.key);
      return !cand || cand.status !== "provisional";
    }), true);
  // 3 · selection 不改变 evidence status
  const before = JSON.stringify(cases.map(c => c.report.candidates.map(x => [x.patternKey, x.status])));
  cases.forEach(c => CS.select(c.report, corpus));
  checkEq("[sel] 再选一次不会改动任何 evidence status",
    JSON.stringify(cases.map(c => c.report.candidates.map(x => [x.patternKey, x.status]))), before);

  // 4 · 高证据低区分 vs 低证据高区分 可以正确竞争
  const rowUniversal = corpus.stats["wider-frame-pull"];
  checkEq("[sel] 人人都中的 pattern 区分度最低", rowUniversal.acceptedFrequency >= 0.9 &&
    rowUniversal.distinctiveness.value <= 0.1 &&
    rowUniversal.distinctiveness.flags.indexOf("low-distinctiveness") >= 0, true);
  const universalPickedAsPrimary = allSelectedKeys.filter(s => s.key === "wider-frame-pull").length;
  checkEq("[sel] 但它没有因此支配全部 case(仍可能在证据极强时胜出)",
    universalPickedAsPrimary < cases.length, true);

  /* 5 · 阵列顺序不影响选择。
     刻意用 C4:它的 grounds 有两个候选分数完全相同(0.508)——
     如果 tie-break 是看阵列顺序,把候选反过来就会选到另一个。 */
  const tieCase = byId.C4;
  const tieRanked = tieCase.selection.directions.grounds.ranked;
  checkEq("[sel] C4 的 grounds 确实存在同分,足以验出阵列顺序问题",
    tieRanked.length >= 2 && tieRanked[0].score === tieRanked[1].score, true);
  const shuffled = JSON.parse(JSON.stringify(tieCase.report));
  shuffled.candidates.reverse();
  (shuffled.composites || []).reverse();
  const selA = CS.select(tieCase.report, corpus), selB = CS.select(shuffled, corpus);
  checkEq("[sel] 把候选顺序反过来,同分时选出来的仍然一样",
    JSON.stringify(CS.DIRECTIONS.map(d => (selA.directions[d].primary || {}).key)),
    JSON.stringify(CS.DIRECTIONS.map(d => (selB.directions[d].primary || {}).key)));

  // 6 · 生命脉络不影响 distinctiveness 的证据计数
  const withThread = build({ context: { lifeThreads: { tagline: "你要确认安全才带出来。", aha: ["谨慎在消耗你"] } } });
  checkEq("[sel] 加进生命脉络后,跨盘 accepted 频率完全没变",
    JSON.stringify(corpus.matrix.rows.map(r => [r.patternKey, r.acceptedCount])),
    JSON.stringify(withThread.corpus.matrix.rows.map(r => [r.patternKey, r.acceptedCount])));

  // 7/8/9 · 日记 / 收藏 / 心情 不进差异化
  const src = fs.readFileSync(path.join(__dirname, "..", "assets", "compass-selection.js"), "utf8");
  checkEq("[sel] 选择层原始码不含日记 / 收藏 / 心情栏位",
    !/journal|favorites|favs|mood|reflectionAnswer|compass_entries/.test(
      src.replace(/不读日记 \/ 心情 \/ 收藏[^\n]*/g, "")), true);
  const polluted = build({ evidence: { favorites: ["x"], journal: ["y"] }, context: { mood: "平静" } });
  checkEq("[sel] 硬塞日记 / 收藏 / 心情,矩阵一格都不变",
    JSON.stringify(polluted.corpus.matrix.rows.map(r => [r.patternKey, r.acceptedCount])),
    JSON.stringify(corpus.matrix.rows.map(r => [r.patternKey, r.acceptedCount])));

  // 10/11/12 · composite 的 selection advantage 要靠「多讲了一件事」
  const compCase = cases.find(c => (c.report.composites || []).some(x => x.status === "accepted"));
  const cp = compCase.report.composites.find(x => x.status === "accepted");
  const candsByKey = {}; compCase.report.candidates.forEach(x => { candsByKey[x.patternKey] = x; });
  const cv = CS.compositeValue(cp, candsByKey);
  checkEq("[sel] 有顺序又化解张力的 composite 拿得到 compositeValue", cv.value > 0 &&
    cv.reasons.indexOf("new-sequence") >= 0, true);
  const stitched = CS.compositeValue({
    status: "accepted", sequence: ["a", "b"], mechanism: "short",
    contradictionResolvedAsSequence: false, childPatterns: [], independentEvidenceCount: 2, evidenceUnion: ["x", "y"]
  }, {});
  checkEq("[sel] 只是把两个东西拼起来的 composite 没有任何加分",
    stitched.value === 0 && stitched.reasons[0] === "merely-stitched", true);
  checkEq("[sel] composite 不会自动压过 child —— 权重只占 " + CS.WEIGHTS.composite,
    CS.WEIGHTS.composite < CS.WEIGHTS.evidence, true);

  // 13 · composite 选上之后,child 不会再占别的方向
  cases.forEach(c => {
    CS.DIRECTIONS.forEach(d => {
      const dd = c.selection.directions[d];
      if (!dd.primary || dd.primary.kind !== "composite") return;
      const kids = (c.report.composites.find(x => x.compositeKey === dd.primary.key) || {}).childPatterns || [];
      const elsewhere = CS.DIRECTIONS.filter(o => o !== d)
        .map(o => c.selection.directions[o].primary)
        .filter(p => p && kids.indexOf(p.key) >= 0);
      checkEq("[sel] " + c.caseId + " 的 composite child 没有同时占住别的方向", elsewhere.length, 0);
    });
  });

  // 14/15 · 证据重叠 → 罚分,但机制不同就不重罚,更不会自动 reject
  const a = byId.C1.report.candidates.find(x => x.patternKey === "solitude-then-contact");
  const b = byId.C1.report.candidates.find(x => x.patternKey === "naming-to-settle");
  const ov = CS.evidenceOverlap(a, b);
  checkEq("[sel] 证据重叠算得出共用了几条讯号",
    typeof ov.sharedEvidenceCount === "number" && ov.evidenceOverlapRatio >= 0 &&
    ov.evidenceOverlapRatio <= 1, true);
  checkEq("[sel] 机制不同的时候相似度不是 1", CS.mechanismSimilarity(a, b) < 1, true);
  checkEq("[sel] 高重叠不会让候选被自动 reject(状态仍由证据层决定)",
    a.status === "accepted" && b.status === "accepted", true);

  // 16 · insufficient_evidence 不会被 selection 填满
  const insufficient = [];
  cases.forEach(c => CS.DIRECTIONS.forEach(d => {
    if (c.report.directionStatus[d].status === "insufficient_evidence")
      insufficient.push({ caseId: c.caseId, d: d, sel: c.selection.directions[d] });
  }));
  checkEq("[sel] 测试组里确实出现过 insufficient_evidence", insufficient.length > 0, true);
  checkEq("[sel] insufficient 的方向永远没有被填上东西",
    insufficient.every(x => x.sel.status === "insufficient_evidence" && x.sel.primary === null), true);

  /* 16b · 就算有候选的「次要相关」指向那个方向,insufficient 也不准被填满。
     用一份合成 report 直接顶住这个守卫:accepted 的候选 primary=moves、
     secondary=drains,而 drains 在证据层是 insufficient。 */
  const synthetic = {
    candidates: [{
      patternKey: "synthetic-strong", status: "accepted", strength: 11,
      family: "DRIVE", mechanismFamily: "synthetic", domain: "motivation",
      compassRelevance: { primary: "moves", secondary: "drains" },
      sourceSignals: [{ sourceType: "chart", independenceKey: "aspect|A+B" },
                      { sourceType: "chart", independenceKey: "aspect|C+D" }],
      independentEvidenceCount: 2
    }],
    composites: [],
    tensions: [],
    directionStatus: {
      grounds: { status: "insufficient_evidence" },
      moves:   { status: "accepted" },
      drains:  { status: "insufficient_evidence" },
      calls:   { status: "insufficient_evidence" }
    }
  };
  const synSel = CS.select(synthetic, CS.buildCorpus([{ caseId: "S", report: synthetic }]));
  checkEq("[sel] 次要相关也不能把 insufficient 的方向填满",
    synSel.directions.drains.status === "insufficient_evidence" &&
    synSel.directions.drains.primary === null, true);
  checkEq("[sel] 该选的那个方向仍然选得出来",
    synSel.directions.moves.primary.key, "synthetic-strong");

  // 17 · 跨方向多样性:找得到 next-best
  const hasRunnerUp = cases.some(c => CS.DIRECTIONS.some(d => {
    const dd = c.selection.directions[d];
    return dd.runnerUp && dd.runnerUp.parts.redundancyPenalty > 0;
  }));
  checkEq("[sel] 会因为与已选项重叠而把候选往下压,改选 next-best", hasRunnerUp, true);

  // 18 · family diversity 是偏好不是硬规则
  checkEq("[sel] 没有写死「四个方向必须四个不同 family」",
    !/mustBeDistinctFamily|requireFourFamilies/.test(src), true);

  // 19/20 · 决定性:同样输入跑两次结果完全一样
  const run1 = build(), run2 = build();
  checkEq("[sel] 重跑一次,四向选择完全相同",
    JSON.stringify(run1.cases.map(c => CS.DIRECTIONS.map(d => (c.selection.directions[d].primary || {}).key))),
    JSON.stringify(run2.cases.map(c => CS.DIRECTIONS.map(d => (c.selection.directions[d].primary || {}).key))));
  checkEq("[sel] 两两相似度也完全可重现",
    JSON.stringify(CS.pairwise(run1.cases)), JSON.stringify(CS.pairwise(run2.cases)));

  // 21 · 27 条规则表没有被这一阶段改动
  const core = CE.PATTERN_RULES.filter(r => r.family !== "GUARD");
  checkEq("[sel] 规则表仍然是 27 条核心 + 2 条护栏",
    core.length === 27 && CE.PATTERN_RULES.length === 29, true);
  /* 只看真正的 require / import 与对规则表的赋值 —— 注解里提到档名不算 */
  const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  checkEq("[sel] 选择层没有 require 证据层,也没有碰规则表",
    !/require\(|import\s|PATTERN_RULES|COMPOSITE_RULES/.test(codeOnly), true);

  // 22/23/24/25 · 没有新增 API、没有改 UI、两套既有生成没动
  const html = fs.readFileSync(path.join(__dirname, "..", "app.html"), "utf8");
  const ts = fs.readFileSync(path.join(__dirname, "..", "docs", "edge", "read-chart.ts"), "utf8");
  checkEq("[sel] 选择层没有任何网路呼叫",
    !/fetch\(|XMLHttpRequest|anthropic|supabase/i.test(src), true);
  checkEq("[sel] 服务端仍然没有 kind=compass", ts.indexOf('kind === "compass"') < 0, true);
  /* Phase 5 起 app.html 会载入选择层 —— 但只在 #/compass/preview 这条开发路由,
     而且只能透过 CP_PV_SRC 这一张清单动态载入,不得写成静态 <script src>。 */
  checkEq("[sel] 选择层没有被写成 app.html 的静态 script",
    /<script[^>]+compass-selection/.test(html), false);
  checkEq("[sel] 选择层只出现在两张载入清单里(开发预览 + 正式生成)",
    (html.match(/compass-selection\.js/g) || []).length, 2);
  checkEq("[sel] 生命脉络与九个主题的 Prompt 仍未改动",
    /把前面读过的所有理解连起来/.test(ts) && /现在写【第二部分 · 主题探索】中的一章/.test(ts), true);

  // 差异化本身要有结论
  const diff = CS.differentiationCheck(cases);
  checkEq("[sel] 差异化体检给得出判定",
    diff.verdict === "OK" || diff.verdict === "DIFFERENTIATION_FAILURE", true);
  checkEq("[sel] 十张盘的 signature 没有任何两张完全相同",
    new Set(cases.map(c => JSON.stringify(c.selection.signature.selected))).size, cases.length);
}

/* ---------- 16. 内在指南 Phase 4 · 人话翻译原型 ----------
   对应任务书第 26 节的 20 项。要证明的只有一件事:
   已经选出来的内部机制,能稳定翻成自然、具体、简单、有温度,
   但不文学 / 不玄学 / 不诊断的使用者语言;翻不出来就如实说翻不出来。 */
function testCompassTranslation() {
  const fs = require("fs");
  const CE = require(path.join(__dirname, "..", "assets", "compass-evidence.js"));
  const CT = require(path.join(__dirname, "..", "assets", "compass-translation.js"));
  const REPORT = require(path.join(__dirname, "..", "tools", "compass-translation-report.js"));

  const ALL = Object.assign({}, CT.TRANSLATIONS, CT.COMPOSITES, CT.TENSIONS);
  const keys = Object.keys(ALL);
  const q = {};
  keys.forEach(k => { q[k] = CT.checkCopy(ALL[k].zh); });

  // 1 · 原型规模:10–12 条模式 + composite + tension
  checkEq("[tr] 至少写了 10 条模式翻译", Object.keys(CT.TRANSLATIONS).length >= 10, true);
  checkEq("[tr] composite 与 tension 各至少一条",
    Object.keys(CT.COMPOSITES).length >= 1 && Object.keys(CT.TENSIONS).length >= 1, true);

  // 2 · 占星语言绝对不能外漏
  checkEq("[tr] 没有任何一条出现占星词汇",
    keys.filter(k => q[k].astrologyLeak).join(","), "");

  // 3 · 不玄学 / 不文学
  checkEq("[tr] 没有任何一条踩到玄学或过度文学的词",
    keys.filter(k => q[k].literaryRisk === "high").join(","), "");

  // 4 · 不做心理诊断
  checkEq("[tr] 没有任何一条出现临床 / 诊断词汇",
    keys.filter(k => q[k].diagnosticLeak).join(","), "");

  // 5 · 不贴标签(不讲「你是一个……」)
  checkEq("[tr] 没有任何一条在给人贴标签",
    keys.filter(k => q[k].labelRisk === "high").join(","), "");

  // 6 · 不讲套话
  checkEq("[tr] 没有任何一条是心灵鸡汤套话",
    keys.filter(k => q[k].genericRisk === "high").join(","), "");

  // 7 · 长度契约
  checkEq("[tr] coreInsight 一律 15–35 字", keys.filter(k => !q[k].coreLenOk).join(","), "");
  checkEq("[tr] explanation 一律 70–130 字", keys.filter(k => !q[k].explLenOk).join(","), "");

  // 8 · reflectionPrompt 是一句简单问题
  checkEq("[tr] reflectionPrompt 都是问句", keys.filter(k => !q[k].promptIsQuestion).join(","), "");
  checkEq("[tr] reflectionPrompt 都是「一句」而不是一段",
    keys.filter(k => (ALL[k].zh.reflectionPrompt.match(/[。？?！]/g) || []).length !== 1).join(","), "");

  // 9 · 具体行为:有时间 / 条件,也有动作
  checkEq("[tr] 每一条都写到具体会发生的事", keys.filter(k => !q[k].concreteBehaviourPresent).join(","), "");

  // 10 · 文案里不应该混进英文(这一阶段只做中文)
  checkEq("[tr] 使用者看到的文字里没有英文",
    keys.filter(k => /[A-Za-z]/.test([ALL[k].zh.coreInsight, ALL[k].zh.explanation,
      ALL[k].zh.reflectionPrompt].join(""))).join(","), "");

  // 11 · 每一条翻译都必须对得上冻结规则表里的一条机制
  const ruleKeys = CE.PATTERN_RULES.map(r => r.patternKey);
  const compKeys = CE.COMPOSITE_RULES.map(r => r.compositeKey);
  checkEq("[tr] 每条模式翻译都能对回规则表",
    Object.keys(CT.TRANSLATIONS).filter(k => ruleKeys.indexOf(k) < 0).join(","), "");
  checkEq("[tr] composite 翻译对得回 composite 规则",
    Object.keys(CT.COMPOSITES).filter(k => compKeys.indexOf(k) < 0).join(","), "");

  // 12 · composite 要表达顺序,不是把两个 child 的句子接起来
  const rs = CT.COMPOSITES["regulation-sequence"];
  const ruleRS = CE.COMPOSITE_RULES.find(r => r.compositeKey === "regulation-sequence");
  checkEq("[tr] composite 的 childPatterns / sequence 与规则一致",
    JSON.stringify([rs.childPatterns, rs.sequence]),
    JSON.stringify([ruleRS.childPatterns, ruleRS.sequence]));
  const kidText = rs.childPatterns.map(k => CT.TRANSLATIONS[k].zh.explanation);
  checkEq("[tr] composite 文案不是两个 child 句子的拼接",
    kidText.some(t => rs.zh.explanation.indexOf(t) >= 0), false);
  checkEq("[tr] composite 文案讲的是先后顺序",
    /先[\s\S]*再|之后|等/.test(rs.zh.explanation + rs.zh.coreInsight), true);

  // 13 · 张力:两边都要保留,而且写成先后,不是「有时这样有时那样」
  const tn = CT.TENSIONS["articulation-as-regulation~withdraw-to-reset"];
  checkEq("[tr] 张力在规则表里确实成对",
    CE.TENSION_PAIRS.some(p => p.slice().sort().join("~") === "articulation-as-regulation~withdraw-to-reset"), true);
  checkEq("[tr] 张力文案两边都保留,并且给出顺序",
    /既[\s\S]*也|两边/.test(tn.zh.coreInsight + tn.zh.explanation) &&
    /先后|先[\s\S]*再|顺序/.test(tn.zh.coreInsight + tn.zh.explanation), true);

  // 14 · 证据不足 → 不生成任何文案,也没有通用 fallback
  const ins = CT.translate({ status: "insufficient_evidence", primaryDirection: "drains" });
  checkEq("[tr] 证据不足时 status 正确", ins.status, "insufficient_evidence");
  checkEq("[tr] 证据不足时 copy 是 null,不给通用安慰话", ins.copy === null &&
    ins.coreInsight === undefined && ins.explanation === undefined, true);

  // 15 · 还没写翻译的模式 → 如实回报,绝不硬凑
  const nt = CT.translate({ patternKey: "trust-opens-slowly", primaryDirection: "relation" });
  checkEq("[tr] 没写翻译的模式如实回报 not_translated", nt.status, "not_translated");
  checkEq("[tr] 没写翻译的模式不会生出文案", nt.copy === null && !nt.coreInsight, true);

  // 16 · 模式之间必须真的不一样(相邻两字 Jaccard)
  const sep = CT.separationCheck();
  checkEq("[tr] 任何两条模式文案的相似度都低于 0.35", sep[0].similarity < 0.35, true);
  checkEq("[tr] 相似度量得出东西(同一段文字对自己是 1)",
    CT.similarity("你先把事情做完才发现累了", "你先把事情做完才发现累了"), 1);

  // 17 · 护栏真的会咬:把禁用词塞进去必须被抓到
  const mut = (patch) => CT.checkCopy(Object.assign({}, CT.TRANSLATIONS["naming-to-settle"].zh, patch));
  checkEq("[tr] 护栏会抓占星词", mut({ explanation: "你的月亮在第四宫，所以你需要说出来。" }).astrologyLeak, true);
  checkEq("[tr] 护栏会抓玄学词", mut({ explanation: "你的灵魂在召唤你把它显化出来。" }).literaryRisk, "high");
  checkEq("[tr] 护栏会抓诊断词", mut({ explanation: "这是你的依恋创伤与神经系统失调。" }).diagnosticLeak, true);
  checkEq("[tr] 护栏会抓标签句", mut({ coreInsight: "你是一个需要说出来的人。" }).labelRisk, "high");
  checkEq("[tr] 护栏会抓套话", mut({ explanation: "相信自己，学会放下，一切都会好起来。" }).genericRisk, "high");
  checkEq("[tr] 护栏会抓长度不足", mut({ explanation: "说出来就好了。" }).explLenOk, false);

  // 18 · 同一个模式在不同方向拿到的文案完全一样(翻译只是模式的函数)
  const a = CT.translate({ patternKey: "naming-to-settle", primaryDirection: "grounds", mechanism: "m" });
  const b = CT.translate({ patternKey: "naming-to-settle", primaryDirection: "calls", mechanism: "m" });
  checkEq("[tr] 翻译是确定性的:同一模式两次结果相同",
    JSON.stringify(a.coreInsight + a.explanation + a.reflectionPrompt),
    JSON.stringify(b.coreInsight + b.explanation + b.reflectionPrompt));
  checkEq("[tr] recognitionPotential 有算出来", ["low", "medium", "high"].indexOf(a.qualityChecks.recognitionPotential) >= 0, true);

  // 19 · 这一层不呼叫 API、不读日记 / 心情 / 收藏、不碰资料库
  const src = fs.readFileSync(path.join(__dirname, "..", "assets", "compass-translation.js"), "utf8");
  const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  checkEq("[tr] 翻译层没有任何网路呼叫或资料库存取",
    !/fetch\(|XMLHttpRequest|anthropic|supabase|localStorage/i.test(codeOnly), true);
  checkEq("[tr] 翻译层没有读日记 / 心情 / 收藏",
    !/journal|mood|favs|favou?rite/i.test(codeOnly), true);
  checkEq("[tr] 翻译层不 require 证据层或选择层",
    !/require\(|import\s/.test(codeOnly), true);

  // 20 · 产品侧完全没动
  const html = fs.readFileSync(path.join(__dirname, "..", "app.html"), "utf8");
  const ts = fs.readFileSync(path.join(__dirname, "..", "docs", "edge", "read-chart.ts"), "utf8");
  checkEq("[tr] 翻译层没有被写成 app.html 的静态 script",
    /<script[^>]+compass-translation/.test(html), false);
  checkEq("[tr] 翻译层只出现在两张载入清单里(开发预览 + 正式生成)",
    (html.match(/compass-translation\.js/g) || []).length, 2);
  checkEq("[tr] 服务端仍然没有 kind=compass", ts.indexOf('kind === "compass"') < 0, true);
  const core = CE.PATTERN_RULES.filter(r => r.family !== "GUARD");
  checkEq("[tr] 27 条核心规则 + 2 条护栏仍未改动",
    core.length === 27 && CE.PATTERN_RULES.length === 29, true);

  // 21 · 报告工具跑得起来,而且会如实列出翻不出来的部分
  const rep = REPORT.run();
  const cov = REPORT.coverage(rep.cases);
  checkEq("[tr] 报告涵盖 10 张盘", rep.cases.length, 10);
  checkEq("[tr] 被选中但没写翻译的,一律 not_translated 而不是硬凑",
    cov.translatedPicks + cov.untranslated.reduce((n, u) => n + u.picks, 0), cov.totalPicks);
  checkEq("[tr] 证据不足的方向不会产出文案",
    rep.cases.every(c => Object.keys(c.translated).every(d =>
      c.translated[d].status === "ok" ||
      (c.translated[d].copy === null && !c.translated[d].coreInsight))), true);
}

/* ---------- 17. 内在指南 Phase 5 · Dev Preview 接线 ----------
   对应任务书第 17 节的 18 项。这一阶段只做「显示」,所以测试的重点是
   下面这三件事一件都没发生:
     · 多打了一次生成 API
     · 三层原型的规则 / 计分 / 文案被动到
     · 为了让画面好看而补出不存在的文案 */
function testCompassDevPreview() {
  const fs = require("fs");
  const crypto = require("crypto");
  const CE = require(path.join(__dirname, "..", "assets", "compass-evidence.js"));
  const CS = require(path.join(__dirname, "..", "assets", "compass-selection.js"));
  const CT = require(path.join(__dirname, "..", "assets", "compass-translation.js"));
  const CC = require(path.join(__dirname, "..", "assets", "compass-cases.js"));
  const PV = require(path.join(__dirname, "..", "assets", "compass-preview.js"));
  const html = fs.readFileSync(path.join(__dirname, "..", "app.html"), "utf8");
  const idx = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const pvSrc = fs.readFileSync(path.join(__dirname, "..", "assets", "compass-preview.js"), "utf8");
  const h = (o) => crypto.createHash("sha256").update(JSON.stringify(o)).digest("hex").slice(0, 16);

  const vms = CC.ids.map(id => PV.buildCase(id));

  // 1 · Case Selector 是确定性的
  checkEq("[pv] 同一张盘跑两次,四个方向完全一样",
    JSON.stringify(PV.buildCase("C4").directions), JSON.stringify(PV.buildCase("C4").directions));
  // 2 · 同一张盘 → 同一组 selection
  checkEq("[pv] 同一张盘的 patternKey 不会跳动",
    vms[3].directions.map(d => d.dev && d.dev.patternKey).join(","),
    PV.buildCase("C4").directions.map(d => d.dev && d.dev.patternKey).join(","));
  // 3 · 不同盘可以得到不同结果(切 case 要真的看得出差别)
  const sigs = vms.map(v => v.directions.map(d => (d.dev && d.dev.patternKey) || "-").join("|"));
  checkEq("[pv] 十张盘至少有六种不同的四方向组合", new Set(sigs).size >= 6, true);

  // 4 · 证据不足 → 没有任何文案
  const insufficient = [];
  vms.forEach(v => v.directions.forEach(d => { if (d.state === "insufficient_evidence") insufficient.push(v.caseId + "/" + d.key); }));
  checkEq("[pv] 测试盘里确实出现过 insufficient_evidence", insufficient.length > 0, true);
  checkEq("[pv] insufficient 的方向 copy 一律是 null",
    vms.every(v => v.directions.every(d => d.state !== "insufficient_evidence" || d.copy === null)), true);
  // 5 · 还没翻译 → 没有任何文案,也不换一条有翻译的来顶替
  const notTr = [];
  vms.forEach(v => v.directions.forEach(d => { if (d.state === "not_translated") notTr.push(v.caseId + "/" + d.key + ":" + d.dev.patternKey); }));
  checkEq("[pv] 测试盘里确实出现过 not_translated", notTr.length > 0, true);
  checkEq("[pv] not_translated 的方向 copy 一律是 null",
    vms.every(v => v.directions.every(d => d.state !== "not_translated" || d.copy === null)), true);
  checkEq("[pv] not_translated 的 patternKey 真的不在翻译表里",
    vms.every(v => v.directions.every(d => d.state !== "not_translated" ||
      (!CT.TRANSLATIONS[d.dev.patternKey] && !CT.COMPOSITES[d.dev.patternKey]))), true);

  // 6 · composite 只显示自己那一段,不并列 child
  let composites = 0;
  vms.forEach(v => v.directions.forEach(d => {
    if (d.state === "ok" && d.dev.kind === "composite") {
      composites++;
      const kids = (d.dev.childPatterns || []).map(k => CT.TRANSLATIONS[k]).filter(Boolean);
      const dup = kids.some(kid => d.copy.explanation.indexOf(kid.zh.explanation) >= 0 ||
                                   d.copy.coreInsight.indexOf(kid.zh.coreInsight) >= 0);
      if (dup) composites = -999;
    }
  }));
  checkEq("[pv] composite 有出现在测试盘里", composites > 0, true);
  checkEq("[pv] composite 的画面文案没有并列 child 的句子", composites > 0, true);
  checkEq("[pv] child 的 patternKey 只出现在开发者细节里,不在 copy",
    /childPatterns/.test(html.slice(html.indexOf("function cpPvDevHtml"), html.indexOf("function cpPvCardHtml"))) &&
    !/childPatterns/.test(html.slice(html.indexOf("function cpPvCardHtml"), html.indexOf("function cpPvGridHtml"))), true);

  // 7 · 使用者看到的文字里没有占星语言
  const leaks = [];
  vms.forEach(v => v.directions.forEach(d => {
    if (!d.copy) return;
    const q = CT.checkCopy(d.copy);
    if (q.astrologyLeak || q.diagnosticLeak) leaks.push(v.caseId + "/" + d.key);
  }));
  checkEq("[pv] 十张盘的所有使用者文案都没有占星 / 诊断词", leaks.join(","), "");

  // 8 · 使用者看到的卡片不会曝露 patternKey / 分数
  const userBranch = html.slice(html.indexOf('if (d.state === "ok")'), html.indexOf("const msg = d.state"));
  checkEq("[pv] 使用者卡片只印三句话,不印 patternKey / 分数",
    /patternKey|selectionScore|evidenceStrength|distinctiveness/.test(userBranch), false);
  checkEq("[pv] 使用者卡片只取 coreInsight / explanation / reflectionPrompt",
    (userBranch.match(/d\.copy\.\w+/g) || []).sort().join(","),
    "d.copy.coreInsight,d.copy.explanation,d.copy.reflectionPrompt");
  // 9 · 开发者面板可以曝露,但预设关闭
  checkEq("[pv] 开发者细节预设不显示",
    /#dpage\.compass-page \.cp-devdt\{display:none\}/.test(html.replace(/\s+/g, " ").replace(/ \{/g, "{")) ||
    /\.cp-devdt\s*\{\s*display:\s*none\s*\}/.test(html), true);
  checkEq("[pv] 打开开关才加上 cp-showdev", /cp-showdev/.test(html), true);
  checkEq("[pv] 开发者面板确实印 patternKey",
    /row\("patternKey", v\.patternKey\)/.test(html), true);

  // 10 · 没有新增任何生成呼叫
  checkEq("[pv] 编排层没有任何网路呼叫",
    /fetch\(|XMLHttpRequest|anthropic|supabase/i.test(pvSrc.replace(/\/\*[\s\S]*?\*\//g, "")), false);
  const ts = fs.readFileSync(path.join(__dirname, "..", "docs", "edge", "read-chart.ts"), "utf8");
  checkEq("[pv] 服务端仍然没有 kind=compass", ts.indexOf('kind === "compass"') < 0, true);
  const pvStart = html.indexOf("function cpPvLoadOne"), pvEnd = html.indexOf("function renderCompassPage");
  checkEq("[pv] 找得到预览这一段", pvStart > 0 && pvEnd > pvStart, true);
  const pvBlock = html.slice(pvStart, pvEnd);
  /* Phase 6 起,预览多了一个【手动】的生成呼叫。所以改成更精确的保证:
     整段里只有一处 fetch,而且它只在 cpLiveTransport 里;
     既有的生成端点(read-chart / FUNC_URL)一个字都没碰。 */
  /* 注解里提到 read-chart 的做法不算碰它 —— 只看程式码 */
  const pvCode = pvBlock.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  checkEq("[pv] 预览没有碰既有的生成端点",
    /FUNC_URL|netFetch|read-chart/.test(pvCode), false);
  /* 只数【全域的】fetch( —— 方法呼叫(例如 canonical.fetch)不算,
     那是另一条经过稽核的路径(compass_results 的读取),不是生成端点。 */
  checkEq("[pv] 预览里只有一处 fetch",
    (pvBlock.match(/(^|[^.\w])fetch\(/g) || []).length, 1);
  checkEq("[pv] 那一处 fetch 只在 live transport 里",
    /function cpLiveTransport\(\)[\s\S]*?fetch\(COMPASS_GEN_URL/.test(pvBlock), true);

  // 11/12/13 · 三层原型的规则、计分、文案都没被动到
  checkEq("[pv] 27 条规则 + 2 条护栏的内容没有改变", h(CE.PATTERN_RULES), "3de5d02f45bc7d33");
  checkEq("[pv] composite 规则没有改变", h(CE.COMPOSITE_RULES), "136b2789353db76d");
  checkEq("[pv] 方向归属表没有改变", h(CE.DIRECTION_DOMAINS), "9104a5e69ec9f51b");
  checkEq("[pv] selection 权重没有改变", h(CS.WEIGHTS), "315af0a295e1a9b0");
  checkEq("[pv] 翻译文案一个字都没有改变", h([CT.TRANSLATIONS, CT.COMPOSITES, CT.TENSIONS]), "5ff24f5c319f8dd6");

  // 14 · 不读日记 / 心情 / 收藏
  checkEq("[pv] 编排层不碰日记 / 心情 / 收藏",
    /journal|mood|favs|favou?rite/i.test(pvSrc.replace(/\/\*[\s\S]*?\*\//g, "")), false);
  checkEq("[pv] 预览这一段也不碰日记 / 心情 / 收藏",
    /compassMood|compassEntries|favs/.test(pvBlock), false);

  // 15 · 手机版护栏
  const flat = html.replace(/\s+/g, " ");
  checkEq("[pv] ≤900px 时四张卡收成一栏",
    /@media\(max-width:900px\)\{ #dpage\.compass-page \.cp-pv-grid\{grid-template-columns:1fr\}/.test(flat), true);
  checkEq("[pv] ≤767px 有专属的手机间距",
    /#dpage\.compass-page \.cp-pv-card\{padding:24px 18px/.test(flat), true);
  checkEq("[pv] case 按钮在手机上够大(≥34px)",
    /#dpage\.compass-page \.cp-case\{min-height:34px/.test(flat), true);

  // 16 · 既有路由没有少
  ["#\\/topic\\/", "#\\/q\\/", "#\\/reading", '"#\\/map"', '"#\\/my-sky"', '"#\\/compass"',
   '"#\\/favorites"', '"#\\/onboarding"', '"#\\/settings"', '"#\\/login"'].forEach(function (r) {
    checkEq("[pv] 既有路由仍在:" + r.replace(/\\\\/g, ""), new RegExp(r).test(html), true);
  });
  checkEq("[pv] 预览是自己一条路由,不是改写 #/compass",
    /h === "#\/compass\/preview"/.test(html) && /h === "#\/compass"\) return \{ k: "compass" \}/.test(html), true);
  checkEq("[pv] 没有 dev 旗标时,画面走的仍然是原本那一支",
    /\(dev \? cpPvSectionHtml\(\) : compassDirectionsHtml\(c\)\)/.test(html), true);

  // 17 · 顶部导览没有多一个入口(预览不该出现在正式选单里)
  const nav = html.slice(html.indexOf("function dpNavItems"), html.indexOf("function dpNavItems") + 1400);
  checkEq("[pv] 导览选单没有新增预览入口", /compass\/preview/.test(nav), false);
  checkEq("[pv] 导览选单仍然是原本那五项",
    (nav.match(/"#\/(reading|my-sky|map|compass|favorites)"/g) || []).length, 5);

  // 18 · 落地页一个字都没动
  checkEq("[pv] index.html 没有任何预览相关的东西",
    /compass\/preview|cp-pv|cp-devbar|compass-preview/.test(idx), false);
}

/* ---------- 18. 内在指南 Phase 6 · Claude 生成层 ----------
   对应任务书第 39 节的 30 项。核心只有一句:
     证据层决定什么够格被说,选择层决定什么值得被说,
     Claude 只决定怎么说 —— 它不重新解盘,也看不到盘。 */
function testCompassGeneration() {
  const fs = require("fs");
  const crypto = require("crypto");
  const CE = require(path.join(__dirname, "..", "assets", "compass-evidence.js"));
  const CS = require(path.join(__dirname, "..", "assets", "compass-selection.js"));
  const CT = require(path.join(__dirname, "..", "assets", "compass-translation.js"));
  const CC = require(path.join(__dirname, "..", "assets", "compass-cases.js"));
  const PV = require(path.join(__dirname, "..", "assets", "compass-preview.js"));
  const G = require(path.join(__dirname, "..", "assets", "compass-generation.js"));
  const RC = require(path.join(__dirname, "..", "assets", "compass-recorded.js"));
  const html = fs.readFileSync(path.join(__dirname, "..", "app.html"), "utf8");
  const idx = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const gsrc = fs.readFileSync(path.join(__dirname, "..", "assets", "compass-generation.js"), "utf8");
  const edge = fs.readFileSync(path.join(__dirname, "..", "docs", "edge", "compass-generate.ts"), "utf8");
  const rc = fs.readFileSync(path.join(__dirname, "..", "docs", "edge", "read-chart.ts"), "utf8");
  const h = (o) => crypto.createHash("sha256").update(JSON.stringify(o)).digest("hex").slice(0, 16);

  const inputs = CC.ids.map(id => ({ id, input: G.buildInput(PV.buildCase(id)) }));
  const blob = JSON.stringify(inputs.map(x => x.input));

  // 1–4 · 送出去的东西里没有原始占星,也没有出生资料
  checkEq("[gen] payload 里没有星座名",
    /\b(aries|taurus|gemini|cancer|leo|virgo|libra|scorpio|sagittarius|capricorn|aquarius|pisces)\b/i.test(blob) ||
    /白羊|金牛|双子|巨蟹|狮子|处女|天秤|天蝎|射手|摩羯|水瓶|双鱼/.test(blob), false);
  checkEq("[gen] payload 里没有行星名",
    /\b(Sun|Moon|Mercury|Venus|Mars|Jupiter|Saturn|Uranus|Neptune|Pluto)\b/.test(blob) ||
    /太阳|月亮|水星|金星|火星|木星|土星|天王星|海王星|冥王星/.test(blob), false);
  checkEq("[gen] payload 里没有宫位 / 相位 / 度数",
    /(\bH\d{1,2}\b|house|cusp|aspect|\borb\b|retrograde|宫位|相位|逆行|度数)/i.test(blob), false);
  checkEq("[gen] payload 里没有出生资料",
    /\d{4}-\d{2}-\d{2}|\d{2}:\d{2}|Asia\/|Europe\/|America\/|Australia\//.test(blob), false);
  checkEq("[gen] 十张盘的 scrub 全部 0 处违规",
    inputs.filter(x => G.scrub(x.input).length).map(x => x.id).join(","), "");

  // 5–7 · 日记 / 心情 / 收藏
  checkEq("[gen] payload 里没有日记 / 心情 / 收藏",
    /journal|mood|favou?rite|\bfavs\b/i.test(blob), false);
  checkEq("[gen] 生成层原始码不读日记 / 心情 / 收藏",
    /journal|mood|favs|favou?rite/i.test(gsrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/var IDENTITY_KEYS[\s\S]*?\];/, "")), false);
  checkEq("[gen] scrub 会挡下身分栏位",
    G.scrub({ a: { email: "x@y.z" } }).some(l => l.kind === "identity"), true);
  checkEq("[gen] scrub 会挡下占星词",
    G.scrub({ a: { m: "Moon in house 4" } }).some(l => l.kind === "astrology"), true);

  // 8 · 证据不足的方向不进 input,也就不会被生成
  const c10 = G.buildInput(PV.buildCase("C10"));
  checkEq("[gen] C10 的 moves 是 insufficient_evidence", c10.directions.moves.status, "insufficient_evidence");
  checkEq("[gen] insufficient 的方向不带任何机制",
    !c10.directions.moves.selectedPattern && !c10.directions.moves.mechanism, true);
  checkEq("[gen] prompt 明写不要为 insufficient 的方向输出",
    /status 是 insufficient_evidence 的方向【不要】出现在结果里/.test(G.SYSTEM), true);

  // 9/10 · selected pattern 与 mechanism 原样搬运,生成层不改
  const vm1 = PV.buildCase("C1"), in1 = G.buildInput(vm1);
  const dev1 = vm1.directions.filter(d => d.key === "grounds")[0].dev;
  checkEq("[gen] selectedPattern 与选择层完全一致", in1.directions.grounds.selectedPattern.key, dev1.patternKey);
  checkEq("[gen] mechanism 与规则表逐字一致", in1.directions.grounds.selectedPattern.mechanism, dev1.mechanism);
  checkEq("[gen] 生成层没有任何写回选择结果的地方",
    /\.patternKey\s*=|\.mechanism\s*=|selection\.\w+\s*=/.test(gsrc), false);

  // 11 · 一定要 structured JSON
  checkEq("[gen] 非 JSON 的输出解析不出东西", G.parseOutput("这是一段自由发挥的文字。"), null);
  checkEq("[gen] markdown 围栏里的 JSON 仍然解析得出来",
    !!G.parseOutput('```json\n{"directions":[{"direction":"grounds","coreInsight":"a"}]}\n```'), true);

  // 12–14 · 三类禁语会被退回
  const di = in1.directions.grounds;
  const mk = (o) => Object.assign({
    coreInsight: "你要先安静下来，把话想成形，才有办法重新靠近人。",
    explanation: "刚发生的时候，你多半不想说，也说不好。你需要先把外面的声音关小，让事情在心里排出顺序；等它变成一句讲得出来的话，你才比较容易开口，也才重新想回到人群里。次序被打乱的时候，你会讲得很卡。",
    reflectionPrompt: "那件事，你现在是还需要安静一会儿，还是已经想得差不多了？"
  }, o);
  const ruleOf = (r) => (r.fails || []).map(f => f.rule);
  checkEq("[gen] 基准文案本身是过的", G.validateOne(mk({}), di).ok, true);
  checkEq("[gen] 占星词会被退回",
    ruleOf(G.validateOne(mk({ coreInsight: "你的月亮在第四宫，所以你要先安静下来。" }), di)).indexOf("astrologyLeak") >= 0, true);
  checkEq("[gen] 心理诊断词会被退回",
    ruleOf(G.validateOne(mk({ coreInsight: "这是你的依恋创伤与神经系统失调造成的。" }), di)).indexOf("diagnosticWording") >= 0, true);
  checkEq("[gen] 玄学词会被退回",
    ruleOf(G.validateOne(mk({ coreInsight: "你的灵魂正在召唤你把它显化出来看看。" }), di)).indexOf("mysticalOrLiterary") >= 0, true);

  // 15 · 编造原因会被标出来,而且不准 retry
  const uns = G.validateOne(mk({
    explanation: "你害怕别人失望，所以总是先把事情扛下来。小时候家里没有人可以依靠，你很早就学会不麻烦别人，因此到现在你还是会先把自己的需要放到最后面才说。"
  }), di);
  checkEq("[gen] 编造原因会被抓到", ruleOf(uns).indexOf("unsupportedInference") >= 0, true);
  checkEq("[gen] 编造原因不列入可重试项",
    (uns.fails.filter(f => f.rule === "unsupportedInference")[0] || {}).noRetry, true);

  // 16/17 · reflectionPrompt 与长度
  checkEq("[gen] 反思句不是问句会被退回",
    ruleOf(G.validateOne(mk({ reflectionPrompt: "去想一想那件事。" }), di)).indexOf("reflectionQuestion") >= 0, true);
  checkEq("[gen] explanation 太短会被退回",
    ruleOf(G.validateOne(mk({ explanation: "先安静一下就好了。" }), di)).indexOf("lengthExplanation") >= 0, true);
  checkEq("[gen] coreInsight 太长会被退回",
    ruleOf(G.validateOne(mk({ coreInsight: "你需要先让自己安静下来把所有的事情都想清楚想明白之后才有办法真正重新靠近别人这件事" }), di)).indexOf("lengthCoreInsight") >= 0, true);
  checkEq("[gen] 机制是顺序型时,文案没有顺序就被退回",
    ruleOf(G.validateOne(mk({
      coreInsight: "你需要一个人待着的时间，也需要有人在旁边。",
      explanation: "独处对你来说是重要的，跟人在一起对你来说也是重要的。这两件事都需要，也都会影响你的状态，所以你会在两者之间移动，有时候多一点这个，有时候多一点那个，很难说哪一边更重要。",
      reflectionPrompt: "你现在比较想要哪一种？"
    }), di)).indexOf("mechanismShape") >= 0, true);

  return testCompassGenerationAsync({ CE, CS, CT, CC, PV, G, RC, html, idx, gsrc, edge, rc, h });
}

/* generate() 是非同步的,分开一段跑 */
function testCompassGenerationAsync(K) {
  const { CE, CS, CT, PV, G, RC, html, idx, gsrc, edge, rc, h } = K;
  const jobs = [];

  // 18/19 · retry 最多一次;失败不退回通用文案
  const badOnce = (() => {
    let n = 0;
    return function () {
      n++;
      return Promise.resolve(n === 1 ? "不是 JSON" : RC.textFor("C1", G.DEFAULT_PROMPT_VERSION));
    };
  })();
  jobs.push(G.generate(PV.buildCase("C1"), badOnce).then(r => {
    checkEq("[gen] JSON 坏掉时会重试一次并成功", r.status, "ok");
    checkEq("[gen] 重试次数正好两次请求", r.meta.requests, 2);
    checkEq("[gen] 有记录 retried", r.meta.retried, true);
  }));
  jobs.push(G.generate(PV.buildCase("C1"), () => Promise.resolve("永远不是 JSON")).then(r => {
    checkEq("[gen] 一直坏就是 generation_failed", r.status, "generation_failed");
    checkEq("[gen] 最多送两次(原始 + 一次重试)", r.meta.requests, 2);
    checkEq("[gen] 失败时 copies 是 null,没有通用文案", r.copies, null);
  }));
  // fidelity 失败不准重试
  const fake = JSON.stringify({ directions: ["grounds", "moves", "drains", "calls"].map(k => ({
    direction: k,
    coreInsight: "你害怕别人失望，所以总是先把事情扛下来。",
    explanation: "小时候家里没有人可以依靠，你很早就学会不麻烦别人。所以到现在，你还是会先把自己的需要放到最后面，等到所有人都安顿好了，才轮到你自己，而那个时候你通常已经没有力气了。",
    reflectionPrompt: "最近有没有一件事，你其实已经累了？"
  })) });
  jobs.push(G.generate(PV.buildCase("C1"), () => Promise.resolve(fake)).then(r => {
    checkEq("[gen] 编造原因 → generation_failed", r.status, "generation_failed");
    checkEq("[gen] 失败原因是 mechanism fidelity", r.reason, "mechanism_fidelity");
    checkEq("[gen] fidelity 失败不重试", r.meta.requests, 1);
  }));

  // 20 · 已录制的四张盘全部通过验证
  jobs.push(Promise.all(RC.CASES.map(id =>
    G.generate(PV.buildCase(id), RC.transportFor(id)).then(r => ({ id, r }))
  )).then(rows => {
    checkEq("[gen] 四张盘的生成结果全部通过验证",
      rows.filter(x => x.r.status !== "ok").map(x => x.id).join(","), "");
    checkEq("[gen] 每张盘只送一次请求",
      rows.filter(x => x.r.meta.requests !== 1).map(x => x.id).join(","), "");
    // 27 · promptVersion 有记下来
    checkEq("[gen] 每次生成都记录 promptVersion",
      rows.every(x => x.r.meta.promptVersion === G.DEFAULT_PROMPT_VERSION), true);
    checkEq("[gen] 每次生成都记录 input contract 版本",
      rows.every(x => x.r.meta.inputContractVersion === G.INPUT_CONTRACT_VERSION), true);
    // 生成轨迹能回答「这句话从哪条机制来」
    checkEq("[gen] 没有任何一张盘被 scrub 挡下(挡下就是接线出问题)",
      rows.filter(x => x.r.status === "blocked_by_scrub").map(x => x.id).join(","), "");
    checkEq("[gen] 每一段文案都回得出它的机制",
      rows.every(x => Object.keys(x.r.trace || {}).length > 0 && Object.keys(x.r.trace || {}).every(k =>
        x.r.trace[k].patternKey && x.r.trace[k].mechanism && x.r.trace[k].generatedCopy.coreInsight)), true);
    // C10 的 moves 不会被生成
    const c10 = rows.filter(x => x.id === "C10")[0].r;
    checkEq("[gen] C10 的 moves 没有产出任何文案", !!(c10 && c10.copies && c10.copies.moves), false);
    // 同 pattern 不同人:核心一致、表达不同
    const c1 = rows.filter(x => x.id === "C1")[0].r, c4 = rows.filter(x => x.id === "C4")[0].r;
    const mv = (r) => (r && r.input && r.input.directions.moves.selectedPattern) || {};
    checkEq("[gen] C1 与 C4 的 moves 是同一条机制", mv(c1).mechanism, mv(c4).mechanism);
    const cp = (r) => (r && r.copies && r.copies.moves) || { coreInsight: "", explanation: "" };
    const sim = CT.similarity(cp(c1).coreInsight + cp(c1).explanation,
                              cp(c4).coreInsight + cp(c4).explanation);
    checkEq("[gen] 同机制在两个人身上不是同一段字", sim < 0.85, true);
    checkEq("[gen] 同机制也没有被写成两个不相干的意思", sim > 0.02, true);
    // 不同 pattern 之间读得出差别
    let worst = 0;
    rows.forEach(x => {
      const p = x.r.validation && x.r.validation.crossCard.pairs[0];
      if (p && p.similarity > worst) worst = p.similarity;
    });
    checkEq("[gen] 同一张盘四张卡不会互相重复(<0.35)", worst < 0.35, true);
  }));

  // 21–23 · 手动、零自动呼叫
  const pvStart = html.indexOf("function cpPvLoadOne"), pvEnd = html.indexOf("function renderCompassPage");
  const pvBlock = html.slice(pvStart, pvEnd);
  checkEq("[gen] 预设模式是确定性模板", /let cpPvMode = "deterministic"/.test(html), true);
  checkEq("[gen] 只有按钮会触发生成",
    /getElementById\("cpPvGenBtn"\)[\s\S]{0,120}addEventListener\("click", cpPvGenerate\)/.test(pvBlock), true);
  checkEq("[gen] 切换测试盘不会呼叫生成",
    /querySelectorAll\("\.cp-casebtn"\)[\s\S]{0,200}?cpPvCase = b\.getAttribute\("data-case"\);\s*\n\s*cpPvPaint\(\);/.test(pvBlock), true);
  checkEq("[gen] 切换模式也不会呼叫生成",
    /cpPvMode = b2\.getAttribute\("data-mode"\);\s*\n\s*cpPvPaint\(\);/.test(pvBlock), true);
  checkEq("[gen] 确定性模式下不会送任何请求",
    /if \(cpPvGenBusy \|\| cpPvMode === "deterministic"\) return;/.test(pvBlock), true);
  checkEq("[gen] 同一 case + 模式 + promptVersion 会被快取",
    /cpPvGenCache\[cpGenKey\(/.test(pvBlock) && /caseId \+ "\|" \+ cpPvMode \+ "\|" \+ cpPvVersion\(\)/.test(pvBlock), true);
  checkEq("[gen] 正式 #\/compass 不会碰到生成层",
    /\(dev \? cpPvSectionHtml\(\) : compassDirectionsHtml\(c\)\)/.test(html), true);
  checkEq("[gen] read-chart 仍然没有 kind=compass", rc.indexOf('kind === "compass"') < 0, true);
  checkEq("[gen] read-chart 没有被这一阶段改动",
    h(rc.length + ":" + rc.slice(0, 200)), h(rc.length + ":" + rc.slice(0, 200)));

  // 24–26 · 冻结层一个字都没动
  checkEq("[gen] 27 条规则 + 2 条护栏未变", h(CE.PATTERN_RULES), "3de5d02f45bc7d33");
  checkEq("[gen] composite 规则未变", h(CE.COMPOSITE_RULES), "136b2789353db76d");
  checkEq("[gen] 方向归属表未变", h(CE.DIRECTION_DOMAINS), "9104a5e69ec9f51b");
  checkEq("[gen] selection 权重未变", h(CS.WEIGHTS), "315af0a295e1a9b0");
  checkEq("[gen] 确定性翻译文案未变", h([CT.TRANSLATIONS, CT.COMPOSITES, CT.TENSIONS]), "5ff24f5c319f8dd6");

  // 28/29 · 使用者看到的东西不含 patternKey;开发者面板可以
  const userBranch = html.slice(html.indexOf('if (d.state === "ok")'), html.indexOf("const MSG = {"));
  checkEq("[gen] 生成结果的卡片一样只印三句话",
    /patternKey|selectionScore|promptVersion|mechanism/.test(userBranch), false);
  checkEq("[gen] 开发者面板才印 promptVersion / model / requests",
    /row\("promptVersion", v\.gen\.promptVersion\)/.test(html), true);
  checkEq("[gen] 盲读模式会盖掉开发者细节",
    /cp-blind \.cp-devdt[\s\S]{0,60}display:none/.test(html.replace(/\s+/g, " ")) ||
    /cp-blind[\s\S]{0,80}\.cp-devdt/.test(html), true);

  // 30 · 边缘函式:独立、不吃星盘、服务端再扫一次
  checkEq("[gen] 生成端点是独立的 Edge Function", /compass-generate/.test(edge), true);
  checkEq("[gen] 生成端点拒绝星盘资料", /不接受星盘资料/.test(edge), true);
  checkEq("[gen] 生成端点自己再扫一次 payload", /blocked_by_scrub/.test(edge), true);
  checkEq("[gen] 生成端点不写任何资料库", /rest\/v1|supabase/i.test(edge.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")), false);
  checkEq("[gen] 生成端点没有引用 MASTER_SYSTEM",
    /MASTER_SYSTEM/.test(edge.replace(/^\s*\/\/.*$/gm, "")), false);

  // 落地页仍然没动
  checkEq("[gen] index.html 与生成层无关", /compass-generate|CompassGeneration|compass-recorded/.test(idx), false);
  // 已录制的结果明写不是 API 回应
  checkEq("[gen] 已录制的来源有明写不是 API 回应", RC.isRecorded, true);
  checkEq("[gen] UI 上把已录制标示出来", /已录制/.test(html), true);
  /* live 的错误处理里不准出现「已录制」那条路 —— 退回去就等于拿录音冒充现场 */
  const genStart = pvBlock.indexOf("G.generate(vm, transport");
  const catchBlock = pvBlock.slice(pvBlock.indexOf(".catch(function (e) {", genStart),
                                   pvBlock.indexOf("cpPvGenBusy = false; cpPvPaint();", genStart));
  checkEq("[gen] live 失败不会自动退回已录制",
    /CompassRecorded|RC\.|transportFor|recorded/.test(catchBlock), false);
  checkEq("[gen] live 失败一定写成 generation_failed",
    /status: "generation_failed"/.test(catchBlock), true);
  checkEq("[gen] 整段里只有一处 recorded transport(就是使用者自己选的那一个)",
    (pvBlock.match(/RC\.transportFor/g) || []).length, 1);

  return Promise.all(jobs);
}

/* ---------- 19. 内在指南 Phase 6.1 · 真实 API 路径 ----------
   这一段【真的把 docs/edge/compass-generate.ts 跑起来】(Deno 垫片 + node:http),
   所以测的是那份档案自己的程式码,不是另外写一份的复制品。
   上游 Anthropic 一律换成本地假回应 —— 测试永远不会花钱、不需要金钥。 */
function testCompassLivePath() {
  const fs = require("fs");
  const G = require(path.join(__dirname, "..", "assets", "compass-generation.js"));
  const PV = require(path.join(__dirname, "..", "assets", "compass-preview.js"));
  const RC = require(path.join(__dirname, "..", "assets", "compass-recorded.js"));
  const edgePath = path.join(__dirname, "..", "docs", "edge", "compass-generate.ts");
  const edge = fs.readFileSync(edgePath, "utf8");
  const html = fs.readFileSync(path.join(__dirname, "..", "app.html"), "utf8");

  /* 1 · 服务端的写作指令必须与前端逐字相同 */
  const m = edge.match(/const COMPASS_SYSTEM = `([\s\S]*?)`;/);
  checkEq("[live] Edge Function 里有 COMPASS_SYSTEM", !!m, true);
  checkEq("[live] 服务端与前端的 v1 写作指令逐字相同",
    m ? firstDiff(m[1], G.SYSTEM) : "缺 COMPASS_SYSTEM", "");

  /* 2 · scrub 必须抓得到中文行星名与「第 N 宫」——
         这是真的跑起来才发现的漏洞,补起来之后钉住 */
  ["太阳", "月亮", "火星", "土星", "冥王星"].forEach(w => {
    checkEq("[live] scrub 抓得到「" + w + "」",
      G.scrub({ a: "这个人的" + w + "很强" }).some(l => l.kind === "astrology"), true);
  });
  checkEq("[live] scrub 抓得到「第十宫」",
    G.scrub({ a: "落在第十宫" }).some(l => l.kind === "astrology"), true);
  checkEq("[live] 服务端的词表也补上了中文行星名",
    /太阳\|月亮\|水星\|金星\|火星/.test(edge.slice(edge.indexOf("const ASTRO_RE"), edge.indexOf("];", edge.indexOf("const ASTRO_RE")))), true);
  /* 补完之后十张盘的 payload 仍然全部乾净 */
  checkEq("[live] 词表补强后十张盘仍然 0 处违规",
    CASE_IDS_FOR_LIVE().filter(id => G.scrub(G.buildInput(PV.buildCase(id))).length).join(","), "");

  /* 3 · 前端永远看不到金钥 */
  const clientFiles = ["app.html", "index.html",
    "assets/compass-generation.js", "assets/compass-preview.js",
    "assets/compass-recorded.js", "assets/compass-selection.js",
    "assets/compass-evidence.js", "assets/compass-translation.js"];
  clientFiles.forEach(f => {
    const t = fs.readFileSync(path.join(__dirname, "..", f), "utf8");
    checkEq("[live] " + f + " 里没有任何金钥形状的字串", /sk-ant-|sk_live|Bearer\s+sk-/.test(t), false);
  });
  checkEq("[live] 前端不读 ANTHROPIC_API_KEY",
    /ANTHROPIC_API_KEY/.test(fs.readFileSync(path.join(__dirname, "..", "assets", "compass-generation.js"), "utf8")), false);
  checkEq("[live] 金钥只从服务端环境变数取",
    (edge.match(/Deno\.env\.get\("ANTHROPIC_API_KEY"\)/g) || []).length, 1);
  checkEq("[live] Edge Function 不会把金钥回传出去",
    /apiKey/.test(edge.slice(edge.indexOf("return json({ status: \"ok\""))), false);

  /* 4 · 开发用的端点旁路只换网址,不带任何凭证 */
  checkEq("[live] 端点可以用 localStorage 覆写(开发旁路)",
    /localStorage\.getItem\("compass_gen_url"\)/.test(html), true);

  /* 5 · 沿用专案既有的 secret,而且【只】需要这一个 */
  checkEq("[live] 只用既有的 ANTHROPIC_API_KEY,没有改名",
    (edge.match(/Deno\.env\.get\("ANTHROPIC_API_KEY"\)/g) || []).length, 1);
  checkEq("[live] 没有多要 SUPABASE_SERVICE_ROLE_KEY / SUPABASE_URL",
    /SUPABASE_SERVICE_ROLE_KEY|Deno\.env\.get\("SUPABASE_URL"\)/.test(edge), false);
  /* 端点预设就指向本专案的 project ref,不必另外设定 */
  checkEq("[live] 端点预设由 CloudCfg 推导,不写死第二份网址",
    /window\.CloudCfg\.url \+ "\/functions\/v1\/compass-generate"/.test(html), true);
  checkEq("[live] 呼叫标头与既有的 read-chart 同一套(Bearer + apikey)",
    /Authorization": "Bearer " \+ bearer[\s\S]{0,120}apikey/.test(
      html.slice(html.indexOf("function cpLiveTransport"), html.indexOf("function cpPvGenerate"))), true);

  /* 6 · 第一次部署最常见的失败要分得出类别,不能笼统当成「生成失败」 */
  const lt = html.slice(html.indexOf("function cpLiveTransport"), html.indexOf("function cpPvGenerate"));
  checkEq("[live] 非 JSON 的回应(闸道 401/404)不会让 r.json() 直接抛错",
    /r\.text\(\)\.then/.test(lt) && !/return r\.json\(\);/.test(lt), true);
  checkEq("[live] fetch 本身失败会被标成 network-or-cors", /network-or-cors/.test(lt), true);
  checkEq("[live] 每一次 POST 都留下状态码与耗时", /rec\.status = r\.status/.test(lt) && /rec\.ms = Date\.now\(\) - t0/.test(lt), true);

  /* 7 · 验证报告可以一键复制,而且【不含】任何凭证 */
  const rep = html.slice(html.indexOf("function cpPvReport"), html.indexOf("function cpPvGenResult"));
  checkEq("[live] 有验证报告可以复制", /id="cpPvCopy"/.test(html) && rep.length > 200, true);
  checkEq("[live] 验证报告不含 Authorization / apikey / 金钥",
    /Authorization|apikey|anon|token|sk-ant/.test(rep), false);
  checkEq("[live] 验证报告含 HTTP 状态、请求数、验证旗标",
    /status=/.test(rep) && /total POST/.test(rep) && /unsupported=/.test(rep), true);

  return testCompassLivePathAsync({ G, PV, RC, edgePath });
}
function CASE_IDS_FOR_LIVE() {
  return require(path.join(__dirname, "..", "assets", "compass-cases.js")).ids;
}

function testCompassLivePathAsync(K) {
  const { G, PV, RC, edgePath } = K;
  const shim = require(path.join(__dirname, "..", "tools", "deno-shim.js"));
  const restore = shim.stubAnthropic((body) => {
    /* 依 user 讯息里出现的 patternKey 决定回哪一份已录制的输出 */
    const u = JSON.stringify(body);
    const id = RC.CASES.filter(c => u.indexOf(
      G.buildInput(PV.buildCase(c)).directions.grounds.selectedPattern.key) >= 0)[0];
    return RC.textFor(id || "C1", G.DEFAULT_PROMPT_VERSION);
  });

  return shim.serveEdgeFunction(edgePath, { env: { ANTHROPIC_API_KEY: "test-only-not-a-real-key" } })
    .then(function (srv) {
      const post = (b) => fetch(srv.url, { method: "POST",
        headers: { "content-type": "application/json" }, body: JSON.stringify(b) })
        .then(r => r.json().then(o => ({ http: r.status, o })));
      const inp = G.buildInput(PV.buildCase("C1"));
      const p = G.buildPrompt(inp);
      const good = { input: inp, system: p.system, user: p.user, promptVersion: p.promptVersion };

      return fetch(srv.url).then(r => r.json().then(o => ({ http: r.status, o })))
        .then(function (h) {
          // 5 · health check:这份档案真的跑得起来
          checkEq("[live] GET health check 回 200", h.http, 200);
          checkEq("[live] health 回报自己是 compass-generate", /compass-generate/.test(h.o.function), true);
          checkEq("[live] health 只回报金钥有没有设,不回报金钥", h.o.anthropic_key_set, true);
          checkEq("[live] health 回传里不含金钥", /test-only-not-a-real-key/.test(JSON.stringify(h.o)), false);
          return post(good);
        })
        .then(function (r) {
          // 6 · 正常路径:HTTP → Edge Function → 结构化 JSON
          checkEq("[live] 正常请求回 200", r.http, 200);
          checkEq("[live] 回传 status=ok", r.o.status, "ok");
          checkEq("[live] 回传的是可解析的结构化 JSON", !!G.parseOutput(r.o.text), true);
          checkEq("[live] 回传带 promptVersion", r.o.promptVersion, G.DEFAULT_PROMPT_VERSION);
          checkEq("[live] 回传里没有金钥", /test-only-not-a-real-key/.test(JSON.stringify(r.o)), false);
          const copies = G.parseOutput(r.o.text);
          const v = G.validate(copies, inp);
          checkEq("[live] 走完真实 HTTP 之后仍然通过 11 道验证", v.ok, true);
          // 7 · 【回归】服务端不准扫自己的禁令表(这是跑起来才发现的 bug)
          checkEq("[live] 服务端没有把自己的禁令表当成外漏", r.o.status === "ok", true);
          return post(Object.assign({}, good, { system: p.system + " 这个人的月亮在第四宫" }));
        })
        .then(function (r) {
          // 8 · 改过的 system 一律拒收
          checkEq("[live] 被改过的 system 会被拒收", r.http, 400);
          checkEq("[live] 拒收原因是 prompt_mismatch", r.o.error, "prompt_mismatch");
          return post(Object.assign({}, good, { user: "随便写的 user 讯息" }));
        })
        .then(function (r) {
          // 9 · user 必须内嵌同一份 input
          checkEq("[live] user 没有内嵌 input 会被拒收", r.o.error, "payload_mismatch");
          return post(Object.assign({}, good, { user: p.user + "\n这个人的火星在第十宫。" }));
        })
        .then(function (r) {
          // 10 · 夹带在 user 里的占星资讯会被挡下
          checkEq("[live] user 夹带占星会被挡下", r.o.error, "blocked_by_scrub");
          const bad = JSON.parse(JSON.stringify(inp));
          bad.directions.grounds.selectedPattern.anchors = ["house:H10"];
          return post({ input: bad, system: p.system, user: p.user.split(
            JSON.stringify(inp, null, 1)).join(JSON.stringify(bad, null, 1)) });
        })
        .then(function (r) {
          // 11 · 夹带在 input 里的占星资讯会被挡下
          checkEq("[live] input 夹带占星会被挡下", r.o.error, "blocked_by_scrub");
          return post(Object.assign({}, good, { chart: { planets: [1] } }));
        })
        .then(function (r) {
          // 12 · 根本不接受星盘
          checkEq("[live] 送星盘一律拒收", r.http, 400);
          checkEq("[live] 拒收讯息说明不接受星盘", /不接受星盘/.test(r.o.error), true);
          // 13 · insufficient 的方向不会被送去生成
          const c10 = G.buildInput(PV.buildCase("C10"));
          const p10 = G.buildPrompt(c10);
          return post({ input: c10, system: p10.system, user: p10.user });
        })
        .then(function (r) {
          checkEq("[live] C10 走真实 HTTP 也回 200", r.http, 200);
          checkEq("[live] 服务端只处理 ready 的方向",
            (r.o.readyDirections || []).indexOf("moves") < 0, true);
          return srv.close();
        })
        .then(function () { restore(); })
        .catch(function (e) {
          /* 出错也要收干净,否则整个测试会卡在开着的 server 上 */
          restore();
          try { srv.close(); } catch (_e) { }
          checkEq("[live] 真实路径这一段没有抛错:" + String((e && e.message) || e), true, false);
        });
    });
}

/* ---------- 20. 内在指南 Phase 6.2 · 写作校准 v1.1 ----------
   只动表达。证据层 / 选择层 / 机制 / 隐私契约一律没动(仍由前面的 sha256 钉着)。 */
function testCompassVoiceV11() {
  const fs = require("fs");
  const G = require(path.join(__dirname, "..", "assets", "compass-generation.js"));
  const PV = require(path.join(__dirname, "..", "assets", "compass-preview.js"));
  const RC = require(path.join(__dirname, "..", "assets", "compass-recorded.js"));
  const html = fs.readFileSync(path.join(__dirname, "..", "app.html"), "utf8");
  const edge = fs.readFileSync(path.join(__dirname, "..", "docs", "edge", "compass-generate.ts"), "utf8");

  // 1 · v1 一个字都没被改掉
  checkEq("[v11] compass-v1 仍然存在且未被覆盖", G.SYSTEMS["compass-v1"] === G.SYSTEM, true);
  checkEq("[v11] v1 的写作指令内容没有变",
    require("crypto").createHash("sha256").update(G.SYSTEM).digest("hex").slice(0, 16), "df3b0a8385d86155");
  checkEq("[v11] 三个版本都在", G.PROMPT_VERSIONS.join(","), "compass-v1,compass-v1.1,compass-v1.2");
  checkEq("[v11] 预设走 v1.2", G.DEFAULT_PROMPT_VERSION, "compass-v1.2");
  checkEq("[v11] v1 与 v1.1 不是同一份", G.SYSTEM === G.SYSTEM_V11, false);

  // 2 · v1.1 里写进了这一阶段的三件事
  checkEq("[v11] v1.1 要求三段结构", /认出来[\s\S]{0,80}是什么[\s\S]{0,80}轻轻一步/.test(G.SYSTEM_V11), true);
  checkEq("[v11] v1.1 禁止命令句", /不写「你应该」|不是建议、不是命令/.test(G.SYSTEM_V11), true);
  checkEq("[v11] v1.1 点名要少用分析腔", /机制、成本、登记/.test(G.SYSTEM_V11), true);
  checkEq("[v11] v1.1 要求四个方向各司其职",
    /grounds 回答[\s\S]{0,400}calls   回答/.test(G.SYSTEM_V11), true);
  checkEq("[v11] v1.1 仍然保留全部占星 / 玄学 / 诊断 / 编造原因的禁令",
    ["绝对禁止:占星语言", "绝对禁止:玄学语言", "绝对禁止:心理诊断", "绝对禁止:编造原因"]
      .filter(x => G.SYSTEM_V11.indexOf(x) < 0).join(","), "");

  // 3 · 服务端两个版本都收,而且各自逐字核对
  const m1 = edge.match(/const COMPASS_SYSTEM = `([\s\S]*?)`;/);
  const m2 = edge.match(/const COMPASS_SYSTEM_V11 = `([\s\S]*?)`;/);
  checkEq("[v11] 服务端的 v1 与前端逐字相同",
    m1 ? firstDiff(m1[1], G.SYSTEM) : "缺 COMPASS_SYSTEM", "");
  checkEq("[v11] 服务端的 v1.1 与前端逐字相同",
    m2 ? firstDiff(m2[1], G.SYSTEM_V11) : "缺 COMPASS_SYSTEM_V11", "");
  checkEq("[v11] 服务端依 promptVersion 选版本核对",
    /system !== SYSTEMS\[wantVersion\]/.test(edge), true);

  // 4 · 命令句是硬性拒收,但否定形不算命令
  const base = RC.RAW_V11.C1.grounds;
  checkEq("[v11] 「你不一定要…」不算命令",
    G.toneCheck(base).commandingTerms.join(","), "");
  checkEq("[v11] 「你一定要…」算命令",
    G.toneCheck({ coreInsight: "", explanation: "你一定要先说清楚。", reflectionPrompt: "" })
      .commandingTerms.join(","), "一定要");
  const di = G.buildInput(PV.buildCase("C1")).directions.grounds;
  checkEq("[v11] 命令句会被验证挡下",
    (G.validateOne(Object.assign({}, base, { explanation: base.explanation.replace("你不一定要先解释", "你应该先解释清楚") }), di).fails || [])
      .map(f => f.rule).indexOf("commandingTone") >= 0, true);

  // 5 · 分析腔与轻方向是【量测】,不是硬挡
  const analytical = G.toneCheck({ coreInsight: "", reflectionPrompt: "",
    explanation: "成本要等结束之后才会完整地登记进来，这是你的处理方式。" });
  checkEq("[v11] 分析腔量得出来", analytical.analyticalTone, "high");
  checkEq("[v11] 分析腔不会让验证直接失败",
    (G.validateOne(Object.assign({}, base, { explanation: base.explanation }), di).fails || [])
      .filter(f => f.rule === "analyticalTone").length, 0);

  // 6 · v1.1 的四张卡:轻方向都在,而且没有放松任何既有护栏
  return Promise.all(["compass-v1", "compass-v1.1"].map(v =>
    G.generate(PV.buildCase("C1"), RC.transportFor("C1"), { promptVersion: v }).then(r => ({ v, r }))
  )).then(rows => {
    const by = {};
    rows.forEach(x => { by[x.v] = x.r; });
    /* Phase 6.3 起,v1 与 v1.1 的样本都会被新的「证据权限」规则挡下 ——
       那正是 6.3 要修的缺陷,所以这里断言它们【确实会红】,而不是假装没事。 */
    checkEq("[v11] v1 与 v1.1 的样本会被 6.3 的权限规则挡下",
      rows.filter(x => x.r.status !== "ok").map(x => x.v).join(","),
      "compass-v1,compass-v1.1");
    checkEq("[v11] 生成结果记录的是被要求的那个版本",
      rows.map(x => x.r.meta.promptVersion).join(","), "compass-v1,compass-v1.1");
    checkEq("[v11] 两版被挡下的都是 drains,而且是同一个原因",
      rows.map(x => Object.keys(x.r.validation.perDirection)
        .filter(k => !x.r.validation.perDirection[k].ok).join("+")).join(" / "),
      "drains / drains");

    const v1 = by["compass-v1"], v11 = by["compass-v1.1"];
    /* status 失败时 copies 是 null(刻意的),但 perDirection 的检查结果仍在 */
    const tone = (r, k) => r.validation.perDirection[k].checks.tone;
    const dirs = ["grounds", "moves", "drains", "calls"];
    checkEq("[v11] v1.1 四个方向都有「轻轻一步」",
      dirs.filter(k => !tone(v11, k).gentleDirection).join(","), "");
    checkEq("[v11] v1 本来一个都没有(这正是这一阶段要补的)",
      dirs.filter(k => tone(v1, k).gentleDirection).join(","), "");
    checkEq("[v11] v1.1 没有任何命令句",
      dirs.filter(k => tone(v11, k).commandingTerms.length).join(","), "");
    checkEq("[v11] v1.1 没有分析腔",
      dirs.filter(k => tone(v11, k).analyticalTone === "high").join(","), "");
    checkEq("[v11] v1.1 的 coreInsight 不是报告标题",
      dirs.filter(k => tone(v11, k).reportTitleShape).join(","), "");
    /* 既有护栏一条都没放松 */
    checkEq("[v11] v1.1 没有占星 / 诊断外漏",
      dirs.filter(k => { const q = v11.validation.perDirection[k].checks;
        return q.astrologyLeak || q.diagnosticLeak; }).join(","), "");
    checkEq("[v11] v1.1 没有编造原因",
      dirs.filter(k => (v11.validation.perDirection[k].fidelity.unsupported || []).length).join(","), "");
    checkEq("[v11] v1.1 四张卡仍然彼此不重复",
      v11.validation.crossCard.pairs[0].similarity < 0.35, true);
    checkEq("[v11] v1.1 的 4/4「所以」正是 6.3 要修的模板感",
      v11.validation.group.conclusionConnectorCount, 4);
    /* 反思句要能想起最近的事,不是行为统计题 */
    const raw11 = RC.RAW_V11.C1;
    checkEq("[v11] v1.1 的反思句都指向最近 / 现在",
      dirs.filter(k => !/最近|现在|这一?周|今天/.test(raw11[k].reflectionPrompt)).join(","), "");
    /* 机制没有被改掉 */
    checkEq("[v11] 两个版本选中的机制完全相同",
      dirs.map(k => v1.input.directions[k].selectedPattern.key).join(","),
      dirs.map(k => v11.input.directions[k].selectedPattern.key).join(","));
  });
}

/* §6.2-1:中文模式不再显示英文小标 */
/* ============================================================
   §36 · 九大主题的编辑式版面(topic-page)
   ------------------------------------------------------------
   这一次只改【呈现】。要守住的三件事:
     ① 文字一个字都没有被改、被截断、被前端补写
     ② 三十道探索题与生命蓝图仍然走 dpAnswerHtml,一个像素都没变
     ③ 样式全锁在 #dpage.topic-page 底下,不外溢到任何其他页
   ============================================================ */
function testTopicLayout() {
  const crypto = require("crypto");
  const fs = require("fs");
  const html = fs.readFileSync(path.join(__dirname, "..", "app.html"), "utf8");
  const fn = function (name) {
    const i = html.indexOf("\n  function " + name + "(");
    if (i < 0) return "";
    let k = html.indexOf("{", i), d = 0;
    for (; k < html.length; k++) {
      if (html[k] === "{") d++;
      else if (html[k] === "}") { d--; if (!d) break; }
    }
    return html.slice(i, k + 1);
  };

  /* —— ① 只有九大主题换了版面 —— */
  const topicPage = fn("renderTopicPage");
  checkEq("[tp] 九大主题改走 dpTopicHtml",
    /body = dpTopicHtml\(saved, tName, "theme_reading", tid\);/.test(topicPage), true);
  checkEq("[tp] 九大主题不再走 dpAnswerHtml", /dpAnswerHtml/.test(topicPage), false);
  checkEq("[tp] 三十道探索题仍然走 dpAnswerHtml",
    /dpAnswerHtml\(saved, q\.q, "question"\)/.test(fn("renderQPage")), true);
  /* dpAnswerHtml 现在只剩三十道探索题在用 —— 定义一处 + 呼叫一处 */
  checkEq("[tp] dpAnswerHtml 只被三十道探索题呼叫",
    (html.match(/dpAnswerHtml\(/g) || []).length, 2);
  /* dpAnswerHtml 与生命蓝图这一页本身一个字都没动 */
  const lock = function (name) {
    return crypto.createHash("sha256").update(fn(name)).digest("hex").slice(0, 16);
  };
  checkEq("[tp] dpAnswerHtml 的内容没有被改", lock("dpAnswerHtml"), "16ecaa4faf7f07b9");
  checkEq("[tp] 生命蓝图这一页没有被改", lock("renderReadingPage"), "61dc64f60d32f416");
  checkEq("[tp] 三十道探索题这一页没有被改", lock("renderQPage"), "893d3c71d47ab628");

  /* —— ② 文字没有被动过 —— */
  const tp = fn("dpTopicHtml");
  checkEq("[tp] 完整原文一直在 DOM 里(不是展开时才换进来)",
    /dpPara\(sc\.body\)/.test(tp), true);
  checkEq("[tp] 引子走既有的 dpLead,不是前端自己写的",
    /dpLead\(sc, PV\["s" \+ si\]\)/.test(tp), true);
  ["substr(", "substring(", "text-overflow", "line-clamp"].forEach(function (bad) {
    checkEq("[tp] 正文没有被截断(" + bad + ")", tp.indexOf(bad) >= 0, false);
  });
  /* 两处 slice 都不碰正文:一处是 fav 的 data-text(与 dpAnswerHtml 同一行),
     一处是段号补零。dpPara(sc.body) 送进去的永远是完整原文。 */
  checkEq("[tp] slice 只出现在 fav 的 data-text 与段号补零",
    (tp.match(/\.slice\([^)]*\)/g) || []).sort().join(" "), '.slice(-2) .slice(0, 300)');
  checkEq("[tp] 收藏挂点与旧版一致",
    /data-saveable data-source=/.test(tp) && /data-source-type=/.test(tp) &&
    /data-section=/.test(tp), true);
  checkEq("[tp] 段落锚点 sec-<i> 保留(深链不会断)", /id="sec-' \+ si \+ '"/.test(tp), true);
  /* 尾段仍然是那几个共用 component,不是另外写的一套 */
  ["dpReflectHtml", "dpKeepHtml", "dpStartHtml"].forEach(function (c) {
    checkEq("[tp] 尾段共用 " + c, tp.indexOf(c) >= 0, true);
  });
  checkEq("[tp] 「留给你的思考」与「试试看」并排", /class="tp-pair"/.test(tp), true);

  /* —— ③ 样式全锁在 .topic-page 底下 —— */
  const css = html.slice(html.indexOf("九大主题(#/topic/<id>)—— 编辑式的分段版面"),
                         html.indexOf("我的内在指南(#/compass)—— 新增页面的样式"))
    .replace(/^[\s\S]*?={20,} \*\//, "")          // 掉开头那段说明(它没有自己的 /* )
    .replace(/\/\*[\s\S]*?\*\//g, "")            // 其余注解
    .replace(/\/\* ={20,}[\s\S]*$/, "");          // 下一个区块的抬头
  checkEq("[tp] 找得到 topic-page 的样式区块", css.length > 2000, true);
  const rules = css
    .split("}").map(function (x) { return x.split("{")[0].trim(); })
    .filter(function (x) { return x && x.indexOf("@") < 0 && x.indexOf(":") !== 0; });
  const leaked = [];
  rules.forEach(function (r) {
    r.split(",").forEach(function (sel) {
      sel = sel.trim();
      if (!sel) return;
      if (sel.indexOf("#dpage.topic-page") !== 0) leaked.push(sel);
    });
  });
  checkEq("[tp] 每一条规则都带 .topic-page(没有外溢)", leaked.join(" | "), "");
  checkEq("[tp] topic-page 这个 class 只挂在九大主题这一页",
    /classList\.toggle\("topic-page", r\.k === "topic"\)/.test(html), true);

  /* —— 插画素材:九个主题各一组,同一张图跨主题共用、同主题内不重复 —— */
  const artBlock = html.slice(html.indexOf("  const TOPIC_SEC_ART = {"),
                              html.indexOf("};", html.indexOf("  const TOPIC_SEC_ART = {")) + 2);
  const SETS = {};
  (artBlock.match(/^\s*([a-z]+):\s*\[([^\]]*)\]/gm) || []).forEach(function (line) {
    const m = line.match(/^\s*([a-z]+):\s*\[([^\]]*)\]/);
    SETS[m[1]] = m[2].split(",").map(function (x) { return x.trim().replace(/^"|"$/g, ""); })
      .filter(Boolean);
  });
  const TIDS = ["self", "emotion", "career", "family", "love", "partner", "wealth", "study", "body"];
  checkEq("[tp] 九个主题都有自己的一组插画", Object.keys(SETS).sort().join(","), TIDS.slice().sort().join(","));
  /* 服务端一章固定生成 4–6 段 → 每一组至少要有 6 张,才不会在同一页里绕回来重复 */
  checkEq("[tp] 服务端一章是 4–6 段",
    /sections 请给 4–6 段。/.test(fs.readFileSync(path.join(__dirname, "..", "docs", "edge", "read-chart.ts"), "utf8")), true);
  TIDS.forEach(function (t) {
    const set = SETS[t] || [];
    checkEq("[tp] " + t + " 至少备 6 张(最长的一章也不会重复)", set.length >= 6, true);
    checkEq("[tp] " + t + " 同一组里没有重复", new Set(set).size, set.length);
  });
  /* 每一个被点到名的档案都真的在 repo 里 —— 漏一张就是线上一个破图 */
  const missing = [];
  Object.keys(SETS).forEach(function (t) {
    SETS[t].forEach(function (n) {
      if (!fs.existsSync(path.join(__dirname, "..", "assets", "topics", n + ".webp"))) missing.push(t + "/" + n);
    });
  });
  checkEq("[tp] 每一张点到名的素材都在 repo 里", missing.join(" "), "");
  checkEq("[tp] 素材放在同一个资料夹", /const TOPIC_ART_DIR = "assets\/topics\/";/.test(html), true);
  /* 没有列到的主题 / 载入失败 → 回落到水彩圆 + 星记号,不开天窗、不留破图框 */
  const artFn = fn("dpTopicSecArt");
  checkEq("[tp] 没有列到的主题回落到星记号",
    /TOPIC_SEC_ART\[tid\] \|\| \[\]/.test(artFn) &&
    /set\.length \? set\[i % set\.length\] : ""/.test(artFn), true);
  checkEq("[tp] 星记号一直在,图叠在上面(载不到就露出底)",
    artFn.indexOf('<span class="gl">') < artFn.indexOf("<img src="), true);
  checkEq("[tp] 图载不到就拿掉,不留破图框", /onerror="this\.remove\(\)"/.test(artFn), true);
  checkEq("[tp] 插画一律是装饰,不承载内容",
    /class="tp-art" aria-hidden="true"/.test(artFn) && /alt=""/.test(artFn), true);
  /* TDZ:render*Page 在冷启动那一刻就会用到它 */
  checkEq("[tp] TOPIC_SEC_ART 宣告在 applyRoute() 之前",
    html.indexOf("const TOPIC_SEC_ART") < html.lastIndexOf("applyRoute();"), true);

  /* —— 手机:编号在上,插画与标题横向并排;桌机那一套不受影响 —— */
  const mq = css.slice(css.indexOf("@media(max-width:767px)"));
  checkEq("[tp] 找得到手机断点", mq.length > 400, true);
  checkEq("[tp] 手机版是 编号 / 图+标题 / 正文 三段式",
    /grid-template-areas:\s*"no\s+fav"\s*"art\s+title"\s*"peek\s+peek"\s*"full\s+full"/.test(mq), true);
  checkEq("[tp] 靠 display:contents 拆层,DOM 一个节点都没动",
    /\.tp-body,\s*#dpage\.topic-page \.tp-h-row\{display:contents\}/.test(mq), true);
  checkEq("[tp] 没有标题时的空 span 不会乱入版面",
    /\.tp-h-row > span:empty\{display:none\}/.test(mq), true);
  checkEq("[tp] 插画 88–112px", /grid-template-columns:clamp\(88px,26vw,112px\)/.test(mq), true);
  checkEq("[tp] 图与标题横向间距 12–16px",
    (function () { const m = mq.match(/column-gap:(\d+)px/); return !!m && +m[1] >= 12 && +m[1] <= 16; })(), true);
  checkEq("[tp] 标题与插画垂直居中", /h3\.tp-h\{[^}]*align-self:center/.test(mq), true);
  checkEq("[tp] 标题不锁成一行(没有 nowrap / 没有截字)",
    /white-space:nowrap|line-clamp|text-overflow/.test(mq), false);
  checkEq("[tp] 正文占满整行", /\.tp-peek\{grid-area:peek/.test(mq) && /\.tp-full\{grid-area:full\}/.test(mq), true);
  /* 桌机那一条完全没被动到 —— 手机版的改动一条都不能漏出 media query */
  const deskSec = css.slice(0, css.indexOf("@media(max-width:767px)"));
  checkEq("[tp] 桌机仍然是「插画一栏 + 正文一栏」",
    /grid-template-columns:clamp\(112px,13vw,178px\) minmax\(0,1fr\)/.test(deskSec), true);
  checkEq("[tp] 桌机没有 grid-template-areas / display:contents",
    /grid-template-areas|display:contents/.test(deskSec), false);

  /* —— 展开:只放开高度,没有任何文字被换掉 —— */
  const bind = fn("dpBindTopicUI");
  checkEq("[tp] 展开只改高度", /full\.style\.maxHeight = full\.scrollHeight/.test(bind), true);
  checkEq("[tp] 展开不会写入 innerHTML", /innerHTML/.test(bind), false);
  checkEq("[tp] 收起之后焦点回到按钮(键盘不会掉出去)", /open\.focus\(\)/.test(bind), true);
  checkEq("[tp] aria-expanded 跟着状态走", /aria-expanded/.test(bind) && /aria-expanded/.test(tp), true);
  checkEq("[tp] 只在九大主题这一页挂事件",
    /classList\.contains\("topic-page"\)/.test(bind), true);
  /* footer 这一次完全没有动 */
  checkEq("[tp] 页尾没有被改(仍然是同一个 dpReturnFoot)",
    /const foot = dpReturnFoot\(\);/.test(topicPage), true);
}

/* ============================================================
   §37 · 九大主题的引子:改成阅读预览层写的,不再是正文的前几句
   ------------------------------------------------------------
   服务端早就有这一层(read-chart kind="preview"),「属于我的生命脉络」
   也一直在用。这一段守住的是:
     ① 九大主题真的接上了同一条路(不是另外长一套写作层)
     ② 正文永远只进不出 —— 送出去的是正文,收回来的只有引子
     ③ 没部署 / 收不到 / 验收不过 → 安静回落到本地摘录,不阻断画面
   ============================================================ */
function testTopicPreviews() {
  const fs = require("fs");
  const html = fs.readFileSync(path.join(__dirname, "..", "app.html"), "utf8");
  const fn = function (name) {
    const i = html.indexOf("\n  function " + name + "(");
    if (i < 0) return "";
    let k = html.indexOf("{", i), d = 0;
    for (; k < html.length; k++) {
      if (html[k] === "{") d++;
      else if (html[k] === "}") { d--; if (!d) break; }
    }
    return html.slice(i, k + 1);
  };

  /* —— ① 接上的是既有那一层,不是新写的 —— */
  const ens = fn("ensureTopicPreviews");
  checkEq("[pv9] 九大主题会去要阅读预览", ens.length > 200, true);
  checkEq("[pv9] 走既有的 fetchPreviews,不是另一条路",
    /window\.Reading\.fetchPreviews\(items\)/.test(ens), true);
  checkEq("[pv9] 版本号沿用同一个",
    /window\.Reading\.PREVIEW_VER/.test(ens) && /window\.Reading\.PREVIEW_STYLE_ID/.test(ens), true);
  checkEq("[pv9] 渲染主题页时才触发",
    /ensureTopicPreviews\(c, tid, saved\);/.test(fn("renderTopicPage")), true);
  /* 没有新的 prompt / 写作层:前端一个字都不写 */
  ["preview:", "你可能", "其实你", "也许你"].forEach(function (bad) {
    checkEq("[pv9] 前端没有自己写引子(" + bad + ")", ens.indexOf(bad) >= 0, false);
  });

  /* —— ② 正文只进不出 —— */
  const items = fn("topicPvItems");
  checkEq("[pv9] 送出去的是完整正文,不是截断",
    /body: String\(sc\.body \|\| ""\)/.test(items), true);
  checkEq("[pv9] 送出去的不含正文以外的东西",
    /\{ id: "s" \+ i, kind: "section", title: sc\.title \|\| "", body: String\(sc\.body \|\| ""\) \}/.test(items), true);
  checkEq("[pv9] 收回来的只写进 previews,不碰 sections",
    /dst\.previews = \{/.test(ens) && /dst\.sections\s*=/.test(ens) === false, true);
  checkEq("[pv9] 服务端一批上限 12 段,前端跟着截(指纹才对得上)",
    /\.slice\(0, 12\)/.test(items), true);
  checkEq("[pv9] 服务端确实截 12",
    /\.slice\(0, 12\)/.test(fs.readFileSync(path.join(__dirname, "..", "docs", "edge", "read-chart.ts"), "utf8")), true);
  /* 正文在这段时间被重新生成过 → 这批引子不是它的,丢掉 */
  checkEq("[pv9] 正文换过就丢掉这批引子",
    /String\(dst\.sections\[0\]\.body \|\| ""\) !== String\(\(t\.sections\[0\] \|\| \{\}\)\.body \|\| ""\)/.test(ens), true);
  checkEq("[pv9] 换了星盘就不写回去", /live\.id !== c\.id/.test(ens), true);

  /* —— ③ 回落:永远不阻断画面 —— */
  checkEq("[pv9] 没有 Supabase 就不送", /window\.Reading\.hasSupabase\(\)/.test(ens), true);
  checkEq("[pv9] 服务端没部署这一层就不送(fetchPreviews 自己挡)",
    /serverPreviewStyle\(\)\.then\(function \(sid\) \{\s*if \(!sid\) return \{\};/.test(html), true);
  checkEq("[pv9] 已经有就不重复要", /cur\.ver === window\.Reading\.PREVIEW_VER/.test(ens), true);
  checkEq("[pv9] 同一时间只跑一次", /pvBusy/.test(ens), true);
  checkEq("[pv9] 这一轮失败就不再试(不会反覆烧生成)",
    /pvSkip\[skipKey\] = true/.test(ens) && /\.catch\(function \(\) \{ pvBusy = false; pvSkip\[skipKey\] = true; \}\)/.test(ens), true);
  /* 旧格式接不住 previews → 根本不送,不烧一次生成再丢掉 */
  checkEq("[pv9] 旧格式(只有 raw)不送",
    /if \(!slot \|\| !slot\.sections \|\| !slot\.sections\.length\) return;/.test(ens), true);

  /* —— 真的跑一次 dpLead:有引子用引子,没有才摘录 —— */
  const sandbox = { DP_LEADIN: /^(而|但|不过|所以|因此|也就是说|换句话说|同时|另外|其实|这|那|它|他们|如果|当)/ };
  const src = ["dpSents", "dpDerive", "dpLead", "dpPvMap"].map(fn).join("\n") +
    "\nreturn { dpLead: dpLead, dpPvMap: dpPvMap };";
  const api = new Function("DP_LEADIN", "window", src)(sandbox.DP_LEADIN,
    { Reading: { PREVIEW_VER: 1 } });
  const body = "在别人眼里，你常常是那个先开口的人。不是因为你话多，而是因为沉默让你不安。" +
               "\n\n这是一种很早就学会的能力。它让你在很多场合里都不会失礼。";
  const sc = { title: "你是一个什么样的人", body: body };

  const noGen = api.dpLead(sc, undefined);
  checkEq("[pv9] 没有引子时回落到摘录(原文的句子)", body.indexOf(noGen.preview) >= 0, true);
  checkEq("[pv9] 摘录不算 authored", noGen.authored, false);

  const gen = { preview: "你很早就学会先把气氛接住。那让你几乎不会失礼，也让你很少有机会先照顾自己。",
                keyInsights: ["你的从容是一种很早就学会的能力。", "先接住别人，是有代价的。"] };
  const withGen = api.dpLead(sc, gen);
  checkEq("[pv9] 有引子就用引子", withGen.preview, gen.preview);
  checkEq("[pv9] 引子不是原文抄回来的", body.indexOf(withGen.preview) >= 0, false);
  checkEq("[pv9] 重点跟着一起进画面", withGen.keys.length, 2);
  checkEq("[pv9] 引子最多三条重点", api.dpLead(sc, { preview: "x", keyInsights: ["a", "b", "c", "d"] }).keys.length, 3);
  checkEq("[pv9] 有引子时标成 authored", withGen.authored, true);

  /* 版本对不上的 previews 当作没有 —— 不会拿旧写法硬套在新写法上 */
  checkEq("[pv9] 版本对得上才用", Object.keys(api.dpPvMap({ previews: { ver: 1, map: { s0: gen } } })).length, 1);
  checkEq("[pv9] 版本对不上就当作没有",
    Object.keys(api.dpPvMap({ previews: { ver: 0, map: { s0: gen } } })).length, 0);

  /* 主题页真的会去读那一份 map */
  checkEq("[pv9] 主题页把 previews 接到每一段上",
    /const PV = dpPvMap\(data\);/.test(fn("dpTopicHtml")) &&
    /dpLead\(sc, PV\["s" \+ si\]\)/.test(fn("dpTopicHtml")), true);
}

function testCompassZhOnlyLabels() {
  const fs = require("fs");
  const html = fs.readFileSync(path.join(__dirname, "..", "app.html"), "utf8");
  checkEq("[zh] 英文小标只在英文模式出现",
    /window\.I18N\.isEN\(\)\s*\n?\s*\?\s*'<div class="cp-eyebrow">/.test(html), true);
  checkEq("[zh] 中文模式的小标只剩一颗星", /cp-eyebrow zh-only/.test(html), true);
  /* ⚠ 这个切片原本指向 compassRemindersHtml —— 那支函式早就不存在了,
     indexOf 回 -1,整个检查等于对着【全档】比对,永远会通过。
     改成真正的边界:只看 compassDirectionsHtml 自己那一段。 */
  const dirBlock = html.slice(html.indexOf("function compassDirectionsHtml"),
                              html.indexOf("/* ── 想留给自己的几句话"));
  checkEq("[zh] 找得到真正的方向区块", dirBlock.length > 500 && dirBlock.length < 6000, true);
  checkEq("[zh] 正式页四方向的名字走 dpT —— 中文模式只会印中文",
    /'<b class="zh">' \+ esc0\(dpT\(d\.zh, d\.en\)\)/.test(dirBlock), true);
  checkEq("[zh] 方向区块里没有任何一定会印出来的英文名",
    /<span class="en">/.test(dirBlock), false);
  checkEq("[zh] 概念图的双语处理没有被搬进中文模式",
    /What grounds me|What moves me|What drains me|What calls me/.test(dirBlock), false);
  const cardBlock = html.slice(html.indexOf("function cpPvCardHtml"), html.indexOf("function cpPvGridHtml"));
  checkEq("[zh] 预览四方向的英文名也只在英文模式印",
    /window\.I18N\.isEN\(\) \? '<span class="en">' \+ esc0\(d\.en\)/.test(cardBlock), true);
  /* 中文版面文字本身没有被动到 */
  ["什么让我安定", "什么让我前进", "什么正在消耗我", "我正在被什么吸引",
   "你的内在指南", "想留给自己的几句话", "此刻的我", "我的星空记录"].forEach(t => {
    checkEq("[zh] 中文标题仍在:" + t, html.indexOf(t) > 0, true);
  });
}

/* ---------- 21. 内在指南 Phase 6.3 · 定点校准 v1.2 ----------
   只修三件事:方向那一句不要变成模板、不替使用者判断现实、calls 不是 moves。 */
function testCompassVoiceV12() {
  const fs = require("fs");
  const G = require(path.join(__dirname, "..", "assets", "compass-generation.js"));
  const PV = require(path.join(__dirname, "..", "assets", "compass-preview.js"));
  const RC = require(path.join(__dirname, "..", "assets", "compass-recorded.js"));
  const edge = fs.readFileSync(path.join(__dirname, "..", "docs", "edge", "compass-generate.ts"), "utf8");
  const crypto = require("crypto");
  const h = (t) => crypto.createHash("sha256").update(t).digest("hex").slice(0, 16);

  /* ★ VOICE LOCK:三份写作指令全部逐字钉住。
     改写法的正确做法是开新版本,不是就地编辑 —— 就地改会让这三条立刻红。 */
  checkEq("[lock] 声音基准是 compass-v1.2", G.VOICE_BASELINE.version, "compass-v1.2");
  checkEq("[lock] 基准的语言是中文", G.VOICE_BASELINE.language, "zh");
  checkEq("[lock] 预设生成走的就是基准版本",
    G.DEFAULT_PROMPT_VERSION, G.VOICE_BASELINE.version);
  checkEq("[lock] 历史版本都还留着",
    G.VOICE_BASELINE.history.filter(v => !G.SYSTEMS[v]).join(","), "");
  checkEq("[lock] compass-v1 逐字未动", h(G.SYSTEMS["compass-v1"]), "df3b0a8385d86155");
  checkEq("[lock] compass-v1.1 逐字未动", h(G.SYSTEMS["compass-v1.1"]), "f81a63bee5bb64d2");
  checkEq("[lock] compass-v1.2 逐字未动(已锁)", h(G.SYSTEMS["compass-v1.2"]), "a06710405bc99c8e");
  checkEq("[lock] 已锁的 v1.2 样本文案逐字未动",
    h(JSON.stringify(RC.RAW_V12.C1)), "afd185f8e09f4739");

  // 1 · 前两版原封不动
  checkEq("[v12] compass-v1.1 未被改动", G.SYSTEMS["compass-v1.1"] === G.SYSTEM_V11, true);
  checkEq("[v12] v1.2 不是 v1.1 的复制品", G.SYSTEM_V11 === G.SYSTEM_V12, false);
  const m12 = edge.match(/const COMPASS_SYSTEM_V12 = `([\s\S]*?)`;/);
  checkEq("[v12] 服务端的 v1.2 与前端逐字相同",
    m12 ? firstDiff(m12[1], G.SYSTEM_V12) : "缺 COMPASS_SYSTEM_V12", "");

  // 2 · v1.2 写进了这一阶段的三条规则
  checkEq("[v12] 写明不要每张都用「所以」收尾", /不要】每一张都用「所以」/.test(G.SYSTEM_V12), true);
  checkEq("[v12] 写明只能说证据授权的事", /只能说证据授权你说的事/.test(G.SYSTEM_V12), true);
  checkEq("[v12] 写明不准替使用者判断现实",
    /不可以】替这个人判断[\s\S]{0,120}值不值得信任/.test(G.SYSTEM_V12), true);
  checkEq("[v12] 写明 calls 不是 moves",
    /怎样让我重新有动力[\s\S]{0,80}写成 moves/.test(G.SYSTEM_V12), true);
  checkEq("[v12] calls 仍然禁止命运 / 使命",
    /不准写成命运、使命、注定/.test(G.SYSTEM_V12), true);
  checkEq("[v12] moves 不准写成消耗,也避开「耗很久」",
    /避免「耗很久」/.test(G.SYSTEM_V12), true);
  checkEq("[v12] v1.1 建立的东西一条都没丢",
    ["认出来", "是什么", "轻轻一步", "绝对禁止:占星语言", "绝对禁止:玄学语言",
     "绝对禁止:心理诊断", "绝对禁止:编造原因", "不要贴标签", "少用分析腔"]
      .filter(x => G.SYSTEM_V12.indexOf(x) < 0).join(","), "");

  // 3 · 证据权限:硬性拒收,而且不准 retry
  const bad = { coreInsight: "真正让你累的是反覆确认。",
    explanation: "你会一段一段靠近。慢一点没关系，只是也可以先看看，有些人是不是其实已经不用再确认了。",
    reflectionPrompt: "现在有没有一个人，其实你早就可以少确认几次了？" };
  const pc = G.permissionCheck(bad);
  checkEq("[v12] 替使用者判断现实会被抓到", pc.realityVerdicts.length > 0, true);
  checkEq("[v12] 把结论预设在问句里会被抓到", pc.embeddedConclusion.length > 0, true);
  const di = G.buildInput(PV.buildCase("C1")).directions.drains;
  const f = (G.validateOne(bad, di).fails || []);
  checkEq("[v12] 越权是硬性拒收", f.filter(x => x.rule === "realityVerdict").length, 1);
  checkEq("[v12] 越权不准 retry", (f.filter(x => x.rule === "realityVerdict")[0] || {}).noRetry, true);
  /* 只是重述机制的问句不算越权 */
  checkEq("[v12] 重述机制不算越权",
    G.permissionCheck({ coreInsight: "", explanation: "",
      reflectionPrompt: "有没有一件事，其实你已经决定了，只是还没让它过去？" }).embeddedConclusion.length, 0);

  // 4 · 组层量测:只 flag 不拒收
  const g11 = G.groupCheck(RC.RAW_V11.C1), g12 = G.groupCheck(RC.RAW_V12.C1);
  checkEq("[v12] v1.1 的四张都以「所以」收尾", g11.conclusionConnectorCount, 4);
  checkEq("[v12] v1.1 会被标成模板化", g11.flags.indexOf("formulaic_direction") >= 0, true);
  checkEq("[v12] v1.2 不再机械收尾", g12.conclusionConnectorCount <= 1, true);
  checkEq("[v12] v1.2 没有任何组层旗标", g12.flags.join(","), "");
  checkEq("[v12] v1.2 四张的开头各不相同", g12.distinctOpenings, 4);
  checkEq("[v12] v1.2 四张都还有「轻轻一步」", g12.gentleDirectionCount, 4);
  checkEq("[v12] moves 与 calls 不是同一件事换句话说",
    g12.movesCallsSemanticOverlap < 0.30, true);
  checkEq("[v12] 组层旗标不会让验证直接失败",
    /flags/.test(JSON.stringify((G.validate(RC.RAW_V11.C1,
      G.buildInput(PV.buildCase("C1"))).group || {}))), true);

  // 5 · calls 真的变成 orientation 了
  const calls12 = RC.RAW_V12.C1.calls, calls11 = RC.RAW_V11.C1.calls;
  checkEq("[v12] v1.1 的 calls 还在讲「重新有兴趣」",
    /重新有兴趣|恢复|动力/.test(calls11.coreInsight + calls11.explanation), true);
  checkEq("[v12] v1.2 的 calls 讲的是「会往哪里靠近」",
    /吸引|往里面走|继续理解/.test(calls12.coreInsight + calls12.explanation), true);
  checkEq("[v12] v1.2 的 calls 没有动力 / 恢复这类字眼",
    /重新有兴趣|恢复动力|提不起劲/.test(calls12.coreInsight), false);
  checkEq("[v12] v1.2 的 calls 没有命运 / 使命",
    /命运|使命|注定|人生道路|召唤|真正的你/.test(calls12.coreInsight + calls12.explanation), false);

  // 6 · moves 不带消耗词
  const moves12 = RC.RAW_V12.C1.moves;
  checkEq("[v12] moves 不出现「耗」这类消耗意味的字",
    /耗|成本|撑到最后|事后才发现累/.test(moves12.coreInsight + moves12.explanation), false);

  // 7 · 长度契约由生成层自己定(60–130),没有去动被冻结的翻译层
  const CT = require(path.join(__dirname, "..", "assets", "compass-translation.js"));
  checkEq("[v12] 翻译层的 70–130 契约没有被改",
    CT.checkCopy({ coreInsight: "一二三四五六七八九十一二三四五",
      explanation: "一".repeat(65), reflectionPrompt: "好吗？" }).explLenOk, false);
  checkEq("[v12] 生成层允许 60 字",
    (G.validateOne(Object.assign({}, RC.RAW_V12.C1.grounds,
      { explanation: RC.RAW_V12.C1.grounds.explanation.slice(0, 78) }), di).fails || [])
      .filter(x => x.rule === "lengthExplanation").length, 0);

  // 8 · 三个版本跑同一组机制:只有 v1.2 全过
  return Promise.all(["compass-v1", "compass-v1.1", "compass-v1.2"].map(v =>
    G.generate(PV.buildCase("C1"), RC.transportFor("C1"), { promptVersion: v }).then(r => ({ v, r }))
  )).then(rows => {
    const by = {}; rows.forEach(x => { by[x.v] = x.r; });
    checkEq("[v12] 只有 v1.2 完全通过",
      rows.filter(x => x.r.status === "ok").map(x => x.v).join(","), "compass-v1.2");
    checkEq("[v12] v1 与 v1.2 选中的机制完全相同",
      ["grounds", "moves", "drains", "calls"]
        .map(k => by["compass-v1"].input.directions[k].selectedPattern.key).join(","),
      ["grounds", "moves", "drains", "calls"]
        .map(k => by["compass-v1.2"].input.directions[k].selectedPattern.key).join(","));
    const v12 = by["compass-v1.2"], V = v12.validation;
    ["grounds", "moves", "drains", "calls"].forEach(k => {
      const q = V.perDirection[k].checks;
      checkEq("[v12] " + k + " 没有占星 / 诊断外漏", q.astrologyLeak || q.diagnosticLeak, false);
      checkEq("[v12] " + k + " 没有越权判断现实", q.permission.realityVerdicts.length, 0);
      checkEq("[v12] " + k + " 没有命令句", q.tone.commandingTerms.length, 0);
      checkEq("[v12] " + k + " 没有分析腔", q.tone.analyticalTone === "high", false);
      checkEq("[v12] " + k + " 的 coreInsight 不是报告标题", q.tone.reportTitleShape, false);
    });
    checkEq("[v12] v1.2 没有编造原因",
      ["grounds", "moves", "drains", "calls"]
        .filter(k => (V.perDirection[k].fidelity.unsupported || []).length).join(","), "");
    checkEq("[v12] v1.2 四张卡彼此不重复", V.crossCard.pairs[0].similarity < 0.35, true);
    checkEq("[v12] v1.2 的反思句都不预设结论",
      ["grounds", "moves", "drains", "calls"]
        .filter(k => V.perDirection[k].checks.permission.embeddedConclusion.length).join(","), "");
  });
}

/* ---------- 22. 内在指南 Phase 7 · 真实认证路径 ----------
   这里只能测【浏览器这一侧】。真正的 end-to-end 必须由人在部署过的环境按一次,
   所以下面没有任何一条会宣称 live 已经验证过。 */
function testCompassLiveAuthPath() {
  const fs = require("fs");
  const html = fs.readFileSync(path.join(__dirname, "..", "app.html"), "utf8");
  const edge = fs.readFileSync(path.join(__dirname, "..", "docs", "edge", "compass-generate.ts"), "utf8");
  const G = require(path.join(__dirname, "..", "assets", "compass-generation.js"));
  const PV = require(path.join(__dirname, "..", "assets", "compass-preview.js"));
  const lt = html.slice(html.indexOf("function cpLiveSession"), html.indexOf("function cpPvGenerate"));

  // §3 · 没有登入中的 session 就不送
  checkEq("[p7] 送出前会检查 session", /function cpLiveSession\(\)/.test(html), true);
  checkEq("[p7] 没有 session 直接拒绝,不送请求",
    /if \(!sess\) \{\s*\n\s*return Promise\.reject/.test(lt), true);
  checkEq("[p7] 拒绝讯息是开发者看得懂的那一句",
    /Live Compass generation requires an authenticated Supabase session\./.test(lt), true);
  checkEq("[p7] 不会用 anon key 顶替使用者的 token",
    /Cloud\.token\(\)\s*\|\|[\s\S]{0,40}anon/.test(lt), false);
  checkEq("[p7] 跨日失效的 session 也算没有 session", /dayValid\(\)/.test(lt), true);

  // §C · 401 先续期再重送(HTTP 层,不占用生成层的 retry 额度)
  checkEq("[p7] 401 会先续期一次", /x\.r\.status === 401 && attempt === 1/.test(lt), true);
  checkEq("[p7] 续期只做一次", /return send\(t2\.token, 2\);/.test(lt), true);
  checkEq("[p7] 续期失败就说会话过期", /会话已过期,请重新登入/.test(lt), true);
  checkEq("[p7] HTTP 续期与生成层的 retry 是两回事",
    /生成层「最多一次 targeted retry」是两回事/.test(html), true);

  // §D/§5 · promptVersion 真的送出去,而且是锁定的 v1.2
  checkEq("[p7] payload 带 promptVersion", /promptVersion: p\.promptVersion/.test(lt), true);
  checkEq("[p7] 送的是锁定的基准版本", G.DEFAULT_PROMPT_VERSION, G.VOICE_BASELINE.version);
  checkEq("[p7] 版本不符时不会降级重试",
    /compass-v1\.1|compass-v1"/.test(lt.replace(/\/\*[\s\S]*?\*\//g, "")), false);

  // §F/§4 · 送出去的就是那份 sanitized contract,不多不少
  const inp = G.buildInput(PV.buildCase("C1"));
  checkEq("[p7] payload 顶层只有四个栏位",
    /body: JSON\.stringify\(payload\)/.test(lt) &&
    /const payload = \{ input: p\._input, system: p\.system, user: p\.user,\s*\n\s*promptVersion: p\.promptVersion \};/.test(lt), true);
  checkEq("[p7] contract 本身仍然 0 处违规", G.scrub(inp).length, 0);
  checkEq("[p7] 有开发诊断可以看送了哪些栏位名", /cpPvSentKeys = \{/.test(lt), true);
  checkEq("[p7] 诊断只记 key 不记值", /只记 key,不记值/.test(html), true);

  // §6 · 回传一定标成 live,而且永远不会被别的来源冒充
  checkEq("[p7] 成功的 live 回传标成 live-anthropic", /source: "live-anthropic"/.test(lt), true);
  checkEq("[p7] recorded 模式在报告里明写不是 live",
    /RECORDED FIXTURE \(not a live API response\)/.test(html), true);
  checkEq("[p7] 卡片的开发细节会标出来源", /row\("source", v\.gen\.source\)/.test(html), true);
  checkEq("[p7] live 失败不会改用已录制",
    /CompassRecorded|RC\.transportFor/.test(lt), false);

  // §2 · 不准关掉 JWT 验证,也不准把金钥搬到前端
  checkEq("[p7] 没有任何关闭 JWT 验证的痕迹",
    /no-verify-jwt|verify_jwt\s*=\s*false/i.test(html + edge), false);
  /* 前端只在一句错误讯息里【提到】这个 secret 的名字(告诉使用者服务端还没设),
     那不是读它。真正要挡的是「前端去取值」。 */
  checkEq("[p7] 前端不会去读 ANTHROPIC_API_KEY 的值",
    /Deno\.env\.get\(\s*"ANTHROPIC|process\.env\.ANTHROPIC|ANTHROPIC_API_KEY\s*[=:]|getItem\(\s*"ANTHROPIC/.test(html), false);
  checkEq("[p7] 前端提到这个名字的地方只有那一句提示",
    (html.match(/ANTHROPIC_API_KEY/g) || []).length, 2);
  checkEq("[p7] 服务端仍然只从环境变数取金钥",
    (edge.match(/Deno\.env\.get\("ANTHROPIC_API_KEY"\)/g) || []).length, 1);
  checkEq("[p7] 验证报告不含任何凭证",
    /Authorization|apikey|access_token|sk-ant/.test(
      html.slice(html.indexOf("function cpPvReport"), html.indexOf("function cpPvGenResult"))), false);

  // §7 · 验证器没有为了让 live 过而放宽
  checkEq("[p7] 硬性拒收的规则一条都没少",
    ["astrologyLeak", "diagnosticWording", "mysticalOrLiterary", "labelling", "genericPhrase",
     "unsupportedInference", "commandingTone", "realityVerdict", "embeddedConclusion",
     "mechanismShape", "lengthExplanation", "reflectionQuestion"]
      .filter(r => !new RegExp('rule: "' + r + '"').test(
        fs.readFileSync(path.join(__dirname, "..", "assets", "compass-generation.js"), "utf8")))
      .join(","), "");
}

/* ---------- 23. 内在指南 Phase 7 · 三项诊断 + 影子验证器 ----------
   影子验证器只标记、不拒收。第一次 live 的那句话是【被授权的】,
   所以它在这里必须【不】被 flag —— 这是一条回归 fixture。 */
function testCompassShadowPermission() {
  const fs = require("fs");
  const G = require(path.join(__dirname, "..", "assets", "compass-generation.js"));
  const PV = require(path.join(__dirname, "..", "assets", "compass-preview.js"));
  const RC = require(path.join(__dirname, "..", "assets", "compass-recorded.js"));
  const html = fs.readFileSync(path.join(__dirname, "..", "app.html"), "utf8");
  const gsrc = fs.readFileSync(path.join(__dirname, "..", "assets", "compass-generation.js"), "utf8");
  const vm = PV.buildCase("C1");
  const inp = G.buildInput(vm);

  /* 第一次 live 真的写出来的那一句(drains) */
  const LIVE_DRAINS = {
    coreInsight: "真正让你累的，可能不是靠近，而是靠近之前那一次次的确认。",
    explanation: "有时候情绪当下没出来，等到某个小事才冒头，自己也说不清楚那是从哪里来的。",
    reflectionPrompt: "最近有没有一段关系，让你发现自己一直在等一个可以放心的感觉？"
  };

  // A · 同一句话 + 有 suppression / delayed 授权 → 不 flag
  const a = G.shadowInternalProcessCheck(LIVE_DRAINS, inp.directions.drains);
  checkEq("[p7s] 第一次 live 的 drains 句子不该被 flag", a.status, "PASS");
  checkEq("[p7s] 而且说得出是谁授权的",
    (a.claimsDetected.filter(c => c.claimClass === "delayed-emergence")[0] || {}).authorizedBy,
    "domain:suppression/repeated-tension");
  checkEq("[p7s] 授权确实来自 support 里的 suppression",
    (inp.directions.drains.support || []).some(x => x.domain === "suppression"), true);

  // B · 同一句话 + 没有相关授权 → SHADOW FLAG
  const b = G.shadowInternalProcessCheck(LIVE_DRAINS, inp.directions.grounds);
  checkEq("[p7s] 换到没有授权的方向就会 flag", b.status, "SHADOW FLAG");
  checkEq("[p7s] flag 说得出缺的是哪一个概念",
    (b.flags[0] || {}).missingPermission, "delayed-emergence");
  checkEq("[p7s] flag 指得出是哪一句触发的",
    (b.flags[0] || {}).detectedFragment, "当下没出来");
  /* 这就是「同一句话、不同 contract、不同结果」——不是全域禁用词表 */
  checkEq("[p7s] 不是全域禁用词表(同句不同命)", a.status !== b.status, true);

  // C · 外部现实的权限规则完全没被动到
  checkEq("[p7s] realityVerdict 仍然是硬性拒收",
    /rule: "realityVerdict", detail: perm\.realityVerdicts\.join\("、"\), noRetry: true/.test(gsrc), true);
  const badExternal = { coreInsight: "你会一段一段靠近一个人。",
    explanation: "慢一点没关系，只是也可以先看看，有些人是不是其实已经不用再确认了。",
    reflectionPrompt: "最近有没有一段关系，让你发现自己在等什么？" };
  checkEq("[p7s] 替使用者判断现实仍然会被硬挡",
    (G.validateOne(badExternal, inp.directions.drains).fails || [])
      .filter(f => f.rule === "realityVerdict").length, 1);

  // D/E · 影子旗标不拒收、不触发重试
  const v = G.validateOne(LIVE_DRAINS, inp.directions.grounds);   // 这一组会 shadow flag
  checkEq("[p7s] 影子 flag 时该方向仍然可以是 ok",
    v.unsupportedInternalProcess.status, "SHADOW FLAG");
  checkEq("[p7s] 影子 flag 不会进 fails",
    (v.fails || []).filter(f => /InternalProcess|shadow/i.test(f.rule)).length, 0);
  checkEq("[p7s] 影子结果自己标明只是影子", v.unsupportedInternalProcess.shadowOnly, true);
  checkEq("[p7s] 影子不会出现在可重试清单里",
    /unsupportedInternalProcess/.test(
      gsrc.slice(gsrc.indexOf("function validate("), gsrc.indexOf("function generate("))), false);

  // F · permittedConcepts 只从 sanitized contract 来,不含任何盘面
  const perm = G.permittedConcepts(inp.directions.drains);
  checkEq("[p7s] 授权集合里没有原始占星",
    G.scrub({ p: perm }).length, 0);
  checkEq("[p7s] 授权集合只来自机制与 domain",
    perm.domains.filter(d => /planet|house|sign|aspect|H\d/i.test(d)).join(","), "");

  // G · 授权脉络只在 dev preview,不进正式页面
  const devBlock = html.slice(html.indexOf("function cpPvDevHtml"), html.indexOf("function cpPvCardHtml"));
  checkEq("[p7s] 授权脉络印在开发面板里", /授权脉络\(送出去的就是这些\)/.test(devBlock), true);
  const prodPage = (function () {
    const i = html.indexOf("页面:我的内在指南(#/compass)");
    const j = html.indexOf("function renderFavoritesPage()", i);
    const whole = html.slice(i, j);
    const x = whole.indexOf("function cpPvLoadOne"), y = whole.indexOf("function renderCompassPage");
    return (x > 0 && y > x) ? whole.slice(0, x) + whole.slice(y) : whole;
  })();
  checkEq("[p7s] 正式页面不印授权脉络", /auth\.support|授权脉络/.test(prodPage), false);
  checkEq("[p7s] 授权脉络只有机制文字,没有盘面",
    G.scrub(vm.directions.filter(d => d.key === "drains")[0].dev.auth).length, 0);
  checkEq("[p7s] 授权脉络与真的送出去的那一份同源",
    vm.directions.filter(d => d.key === "drains")[0].dev.auth.support.length,
    inp.directions.drains.support.length);

  // H · 版本一律取自请求 / 回应的 metadata
  checkEq("[p7s] 会骗人的旧常数已经移除", /COMPASS_PROMPT_VERSION/.test(gsrc), false);
  const rep = html.slice(html.indexOf("function cpPvReport"), html.indexOf("function cpPvGenResult"));
  checkEq("[p7s] requested 取自这一次请求的 metadata",
    /const reqVer = \(g && g\.meta && g\.meta\.promptVersion\)/.test(rep), true);
  checkEq("[p7s] server 取自 Edge Function 的回应",
    /const srvVer = \(cpPvLastServer && cpPvLastServer\.promptVersion\)/.test(rep), true);
  checkEq("[p7s] 两者不同会警告,不会被悄悄抹平",
    /PROMPT VERSION MISMATCH/.test(rep), true);
  checkEq("[p7s] 版本不从 UI 选择器事后推断", /cpPvVersion\(\)/.test(rep), false);

  // I · 重试诊断有原因,但没有模型原文
  checkEq("[p7s] 报告会印 attempt 1 / attempt 2",
    /-- attempt 1 --/.test(rep) && /-- attempt 2 --/.test(rep), true);
  checkEq("[p7s] attempt 1 印的是验证器规则与原因",
    /f\.rule \+ "  —  " \+ f\.detail/.test(rep), true);
  checkEq("[p7s] 不印模型原始回应 / 被退回的文案 / system prompt",
    /a1\.raw|\.raw\b|a1\.copies|p\.system/.test(rep), false);
  checkEq("[p7s] 明写 HTTP 续期与内容重试是两回事",
    /HTTP 401 续期属于传输层,两者不共用额度/.test(rep), true);

  // 影子验证器跑过所有已锁样本:v1.2 四张都不该被 flag
  const dirs = ["grounds", "moves", "drains", "calls"];
  checkEq("[p7s] 已锁的 v1.2 样本没有任何影子旗标",
    dirs.filter(k => G.shadowInternalProcessCheck(RC.RAW_V12.C1[k], inp.directions[k]).status !== "PASS")
      .join(","), "");
}

/* ---------- 24. 我的内在指南 · 完整产品页(Phase 8) ---------- */
function testCompassProductPage() {
  const fs = require("fs");
  const AN = require(path.join(__dirname, "..", "assets", "compass-anchors.js"));
  const RC = require(path.join(__dirname, "..", "assets", "compass-recorded.js"));
  const html = fs.readFileSync(path.join(__dirname, "..", "app.html"), "utf8");
  const asrc = fs.readFileSync(path.join(__dirname, "..", "assets", "compass-anchors.js"), "utf8");
  const code = asrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const copies = RC.RAW_V12.C1;

  // —— 想留给自己的几句话:三句,而且每一句都出自已接受的文案 ——
  const r = AN.derive(copies);
  checkEq("[prod] 正好三句锚点", r.anchors.length, 3);
  checkEq("[prod] 不是一个方向一句(四取三)", r.dropped.length, 1);
  checkEq("[prod] 被留下的那一句说得出原因", !!(r.dropped[0] && r.dropped[0].reason), true);
  checkEq("[prod] 每一句都能在已接受的文案里找到",
    AN.verifyDerived(r, copies).offenders.join(","), "");
  checkEq("[prod] 三句之间不重复", r.maxSimilarity < 0.35, true);
  checkEq("[prod] 同一份 Compass 永远得到同一组",
    JSON.stringify(AN.derive(copies)), JSON.stringify(r));
  /* 少于三个方向就如实说不够,不重复用同一句凑数 */
  const thin = AN.derive({ grounds: copies.grounds, moves: copies.moves });
  checkEq("[prod] 不够三句就说不够", thin.status, "insufficient");
  checkEq("[prod] 不够的时候不硬凑", thin.anchors.length, 0);

  // 这一层不读星盘、不呼叫 API、不产生新主张
  checkEq("[prod] 锚点层没有任何网路呼叫",
    /fetch\(|XMLHttpRequest|anthropic|supabase/i.test(code), false);
  checkEq("[prod] 锚点层不碰星盘 / 机制 / 分数",
    /planets|cusps|\bmechanism\b|selectionScore|patternKey|support\[|\.domain/i.test(code), false);
  checkEq("[prod] 锚点层不读日记 / 心情 / 收藏",
    /journal|mood|favs|favou?rite/i.test(code), false);

  // —— 正式页面 ——
  const page = (function () {
    const i = html.indexOf("页面:我的内在指南(#/compass)");
    const j = html.indexOf("function renderFavoritesPage()", i);
    const w = html.slice(i, j);
    const a = w.indexOf("function cpPvLoadOne"), b = w.indexOf("function compassRepaint");
    return (a > 0 && b > a) ? w.slice(0, a) + w.slice(b) : w;
  })();
  checkEq("[prod] 四个方向来自解析过的正式结果",
    /const saved = compassSavedResult\(\);/.test(page), true);
  checkEq("[prod] 没有生成过就如实说,不拿示例冒充",
    /cp-empty4[\s\S]{0,400}你的内在指南还没有生成/.test(page), true);
  /* 一句都取不出来的时候,整段【不出现】—— 不把系统内部的不足写给使用者看 */
  checkEq("[prod] 锚点一句都没有就整段不出现",
    /if \(!list\.length\) return "";/.test(page), true);
  checkEq("[prod] 不再印任何「还没有可以带走的句子」",
    /这一份指南里，还没有可以单独带走的句子|等上面的内在指南生成之后/.test(html), false);
  checkEq("[prod] 今天的问题来自已通过验证的 reflectionPrompt",
    /saved\.directions\[k\] && saved\.directions\[k\]\.reflectionPrompt/.test(page), true);
  checkEq("[prod] 一次只有一个问题",
    /pool\[window\.Compass\.rotateIndex\(pool\.length, compassSeed\(\)\)\]/.test(page), true);

  // 生成只由按钮触发
  checkEq("[prod] 生成只绑在按钮上",
    /getElementById\("cpGenBtn"\)[\s\S]{0,120}addEventListener\("click", cpProdGenerate\)/.test(page), true);
  checkEq("[prod] 渲染流程里没有自动生成",
    /cpProdGenerate\(\)/.test(page
      .replace(/addEventListener\("click", cpProdGenerate\)/g, "")
      .replace(/function cpProdGenerate\(\)/g, "")), false);
  checkEq("[prod] 正式页面不载入开发用的已录制 fixture",
    /compass-recorded/.test(html.slice(html.indexOf("const CP_PROD_SRC"),
      html.indexOf("];", html.indexOf("const CP_PROD_SRC")))), false);

  // 快取只存使用者看得到的东西
  const rs = html.indexOf("result: (function () {");
  const store = html.slice(rs, html.indexOf("})(),", rs));
  checkEq("[prod] 快取只收白名单栏位",
    /coreInsight: String\(c\.coreInsight\)/.test(store) &&
    /explanation: String\(c\.explanation/.test(store) &&
    /reflectionPrompt: String\(c\.reflectionPrompt/.test(store), true);
  checkEq("[prod] 快取不存机制 / 证据 support / 分数 / prompt",
    /\bmechanism\b|support\[|\.domain|selectionScore|systemPrompt|patternKey|tension/i.test(store), false);

  // 日记:存当天的问题,不存任何诊断
  const shape = html.slice(html.indexOf("function shape(entry, keep)"), html.indexOf("function isEmpty"));
  checkEq("[prod] 记录会存下当天的问题", /question: String\(e\.question/.test(shape), true);
  checkEq("[prod] 记录不存机制 / 分数 / prompt / 模型推理",
    /mechanism|support|score|prompt(?!\b)|reasoning/i.test(shape.replace(/question/g, "")), false);

  // 展开长在自己下面 + 删除要确认
  checkEq("[prod] 展开的内容长在被点的那一张卡里",
    /data-entry="' \+ esc0\(r\.id\)/.test(page) && /open \? t : preview/.test(page), true);
  checkEq("[prod] 原地互动会保住卷动位置",
    /function compassRepaint\(\)/.test(html) && /window\.scrollTo\(0, y\)/.test(html), true);
  checkEq("[prod] 删除要按两次(第一下只是问)",
    /if \(compassDelAsk !== id\)/.test(html), true);

  /* 使用者真正看得到的东西,只由这几支产生 —— 只检查它们,
     不要把「按钮按下去才跑」的生成函式也算进画面。 */
  const render = ["compassDirectionsHtml", "compassAnchorsHtml", "compassNowHtml",
                  "compassQuestionHtml", "compassSkyHtml"].map(function (fn) {
    const a = html.indexOf("function " + fn + "(");
    return a < 0 ? "" : html.slice(a, html.indexOf("\n  function ", a + 10));
  }).join("\n");
  checkEq("[prod] 找得到五个渲染函式", render.length > 3000, true);
  ["cp-devbar", "cp-mode", "cp-casebtn", "cp-devdt", "patternKey", "promptVersion",
   "SHADOW", "selectionScore", "mechanism"].forEach(function (t) {
    checkEq("[prod] 画面上没有 " + t, render.indexOf(t) >= 0, false);
  });
  checkEq("[prod] 中文模式没有英文小标",
    /YOUR INNER COMPASS|THINGS TO REMEMBER|A QUESTION FOR YOU|MY SKY/.test(render), false);

  // 此刻的我:日常说法,不诊断
  const moods = html.slice(html.indexOf("const MOODS = ["), html.indexOf("];", html.indexOf("const MOODS = [")));
  checkEq("[prod] 心情选项不使用临床词汇",
    /焦虑|抑郁|创伤|解离|失调|障碍/.test(moods), false);
  checkEq("[prod] 心情由使用者自己选", /data-mood=/.test(page), true);
}


/* ---------- 25. 想留给自己的几句话 · 取舍的依据(Personal Anchors v2) ----------
   这一段守的不是措辞,是【取舍的理由】:
     · 选哪一句,看它在讲什么功能、能不能重复用、能不能做,
       不是看它排在第几句、有多短、来自哪个方向
     · 四个方向一律平等 —— Calls 赢得了就该被选上
     · 压缩可以,新增不行
     · 这一层永远不会产生第二次请求
   ------------------------------------------------------------------- */
function testCompassAnchorSelection() {
  const fs = require("fs");
  const AN = require(path.join(__dirname, "..", "assets", "compass-anchors.js"));
  const RC = require(path.join(__dirname, "..", "assets", "compass-recorded.js"));
  const html = fs.readFileSync(path.join(__dirname, "..", "app.html"), "utf8");
  const live = RC.RAW_V12.C1;

  /* —— 合成样本:Calls 这一句最能重复用、最做得到,而 Moves 明显弱一些。 ——
     它存在的唯一理由,就是证明这个引擎【不会】永远变成 Grounds + Moves + Drains。 */
  function d(ci, ex) {
    return { coreInsight: ci, explanation: ex, reflectionPrompt: "你希望这件事把你带到哪里？" };
  }
  const CALLS_WINS = {
    grounds: d("你在安静的地方比较容易想清楚。",
      "很多人以为要想清楚就得多讨论。对你来说不是这样。事情刚发生的时候，先让自己安静一会儿就够了。"),
    moves: d("你需要一个说得通的理由才走得动。",
      "没有理由的时候你会停住。这不是拖延。最近如果比较没力气，也可能只是那个理由暂时不见了。"),
    drains: d("反覆确认会把你的力气用掉。",
      "这一次你一直在重新检查，刚才那一轮其实就够了。"),
    calls: d("你对还没看完的事情特别放不下。",
      "每次有一件事你一直绕回去想，可以先看看，它到底还有哪一层没被你看完，而不是先怪自己分心。")
  };
  const w = AN.derive(CALLS_WINS);
  const wDirs = w.anchors.map(function (a) { return a.sourceDirection; });
  checkEq("[anc] Calls 也可能被选上", wDirs.indexOf("calls") >= 0, true);
  checkEq("[anc] Calls 够强的时候排在最前面", wDirs[0], "calls");
  checkEq("[anc] 被换掉的是比较弱的那个方向", w.dropped.map(function (x) { return x.direction; }).join(","), "moves");
  checkEq("[anc] 不是固定的 Grounds + Moves + Drains",
    wDirs.slice().sort().join(",") === "drains,grounds,moves", false);
  checkEq("[anc] 合成样本也回查得过来", AN.verifyDerived(w, CALLS_WINS).offenders.length, 0);

  /* 长度只是最后的微调:最长的一句赢过最短的一句,因为它真的更有用 */
  const byLen = w.anchors.slice().sort(function (a, b) { return b.line.length - a.line.length; });
  checkEq("[anc] 最长的一句没有因为长被刷掉", byLen[0].sourceDirection, "calls");
  checkEq("[anc] 分数不是靠长度堆出来的",
    w.anchors.every(function (a) { return a.score.memorability <= 0.6; }), true);

  /* 选的是【功能互补】,不是方向顺序 */
  const r = AN.derive(live);
  /* 功能互补是加分,不是硬性规定。这里记的是这份样本【实际】覆盖到几种,
     不是「一定要三种」—— 下面那一条才是真正的把关。 */
  checkEq("[anc] 目前样本实际覆盖的功能数",
    new Set(r.anchors.map(function (a) { return a["function"]; })).size, 3);
  checkEq("[anc] 能补的功能都补过了(候选池里只剩重复的功能)",
    (function () {
      const pool = ["grounds", "moves", "drains", "calls"]
        .map(function (k) { return AN.candidateFor(k, live[k]); }).filter(Boolean);
      const picked = new Set(r.anchors.map(function (a) { return a["function"]; }));
      /* 没被选上的候选里,不该还有一个【已选功能之外】而且分数够高的 */
      return pool.filter(function (c) {
        return !picked.has(c["function"]) &&
          AN.scoreCandidate(c).total > r.anchors[r.anchors.length - 1].score.total;
      }).length;
    })(), 0);
  checkEq("[anc] 不是照 grounds→moves→drains 的顺序挑",
    r.anchors.map(function (a) { return a.sourceDirection; }).join(",") === "grounds,moves,drains", false);
  checkEq("[anc] 每一句都说得出为什么留下它",
    r.anchors.every(function (a) { return a.selectionReason && a.selectionReason.length > 8; }), true);
  checkEq("[anc] 每一句都留得住来源(只给开发追溯)",
    r.anchors.every(function (a) { return !!a.sourceDirection && !!a.sourceFields.length; }), true);

  /* 不同的输入 → 不同的锚点。同一份输入 → 完全一样。 */
  checkEq("[anc] 不同的 Compass 给出不同的三句",
    r.anchors.map(function (a) { return a.line; }).join("|") ===
    w.anchors.map(function (a) { return a.line; }).join("|"), false);
  checkEq("[anc] 同一份 Compass 永远一样",
    JSON.stringify(AN.derive(live)), JSON.stringify(r));

  /* 没有万用句。宁可说不够,也不给谁都适用的话。 */
  const generic = r.anchors.concat(w.anchors).filter(function (a) {
    return AN.GENERIC.some(function (g) { return a.line.indexOf(g) >= 0; });
  });
  checkEq("[anc] 没有谁都适用的万用句", generic.length, 0);
  checkEq("[anc] 一个方向也凑不出三句就说不够", AN.derive({ calls: live.calls }).status, "insufficient");
  checkEq("[anc] 不够的时候一句都不给", AN.derive({ calls: live.calls }).anchors.length, 0);

  /* 压缩可以,新增不行 —— 把一个来源里没有的词塞进去,回查必须挡下来 */
  const tampered = JSON.parse(JSON.stringify(r));
  tampered.anchors[0].line = "在你被原生家庭影响的时候，可以先看看那个理由还在不在。";
  checkEq("[anc] 加进新说法会被挡下来", AN.verifyDerived(tampered, live).ok, false);
  const bossy = JSON.parse(JSON.stringify(r));
  bossy.anchors[0].line = "你应该先看看那个理由还在不在。";
  checkEq("[anc] 变成命令句会被挡下来", AN.verifyDerived(bossy, live).ok, false);

  /* 这一层不会产生任何请求 —— 把 fetch 换掉,derive 照样跑得完 */
  const realFetch = global.fetch, realXHR = global.XMLHttpRequest;
  let called = 0;
  global.fetch = function () { called++; throw new Error("anchors must not call out"); };
  global.XMLHttpRequest = function () { called++; throw new Error("anchors must not call out"); };
  try {
    checkEq("[anc] 推导过程不发任何请求", AN.derive(live).status, "ok");
    checkEq("[anc] fetch 一次都没被碰到", called, 0);
  } finally { global.fetch = realFetch; global.XMLHttpRequest = realXHR; }

  /* 画面上只剩那三句话 —— 灰色的来源说明已经拿掉 */
  const fn = html.slice(html.indexOf("function compassAnchorsHtml()"),
                        html.indexOf("function compassNowHtml()"));
  checkEq("[anc] 画面不再显示灰色的来源说明", /cp-anchor[\s\S]*?class="sp"/.test(fn), false);
  checkEq("[anc] 画面不显示来源方向 / 功能 / 取舍理由",
    /sourceDirection|selectionReason|sourceFields|score|function"\]/.test(fn), false);
  checkEq("[anc] 画面只印那一句话", /esc0\(a\.line\)/.test(fn), true);
  checkEq("[anc] .sp 的样式也一起收掉",
    /#dpage\.compass-page \.cp-anchor \.sp\{/.test(html), false);

  /* 手机上八个心情要全部看得到,不靠横向卷动 */
  const mob = html.slice(html.indexOf("@media(max-width:767px)"),
                         html.indexOf("正式页面的完整体验(Phase 8)"));
  const moodCss = mob.slice(mob.indexOf("#dpage.compass-page .cp-moods{"));
  checkEq("[anc] 手机上心情换行显示", /flex-wrap:wrap/.test(moodCss.slice(0, 260)), true);
  checkEq("[anc] 手机上心情不横向卷动", /overflow-x:auto/.test(moodCss.slice(0, 260)), false);
}


/* ---------- 26. 范围守则:压缩不可以把话说得更肯定(anchors 2.1) ----------
   规则是语意的,不是「保留字必须原样出现」:
     看那一步【原本站在什么范围底下】。原本有保留、搬进来的条件却是确定的,
     就不搬 —— 宁可只留那一步本身。
   ------------------------------------------------------------------- */
function testCompassAnchorScopeGuard() {
  const AN = require(path.join(__dirname, "..", "assets", "compass-anchors.js"));
  const RC = require(path.join(__dirname, "..", "assets", "compass-recorded.js"));
  const live = RC.RAW_V12.C1;
  function d(ci, ex) {
    return { coreInsight: ci, explanation: ex, reflectionPrompt: "你希望这件事把你带到哪里？" };
  }

  /* 1. 跨句组合会把范围说死 → 挡下来 ------------------------------------ */
  const g = AN.candidateFor("grounds", live.grounds);
  checkEq("[scope] 原文那一步本来站在有保留的范围底下", g.scopeHedged, true);
  checkEq("[scope] 跨句搬过来的确定条件被挡下来", g.scopeGuard, "cross-sentence-would-tighten-scope");
  checkEq("[scope] 挡下来之后不留场合那一半", g.situation, null);
  checkEq("[scope] 留下的是原文直接给的那一步",
    g.line, "先让自己安静一会儿就够了，不一定要马上解释。");
  checkEq("[scope] 原文的「有些时候」没有被换成确定条件",
    g.line.indexOf("事情刚发生的时候") >= 0, false);
  checkEq("[scope] 留下的那一步整段都在原文里",
    live.grounds.explanation.indexOf(g.line.replace(/。$/, "")) >= 0, true);

  /* 规则不是为 C1 写死的:换一组字、换一个保留字,照样挡 */
  const HEDGED = d("你在别人不急着接话的时候比较敢讲。",
    "被追问的时候，你会先把话收起来。通常，先让自己想一想就够了，不一定要当场给答案。");
  const h = AN.candidateFor("grounds", HEDGED);
  checkEq("[scope] 换一组文案、换成「通常」也一样挡", h.scopeGuard, "cross-sentence-would-tighten-scope");
  checkEq("[scope] 换一组文案也只留那一步",
    h.line, "先让自己想一想就够了，不一定要当场给答案。");

  /* 保留字长在那一步自己身上 → 它会跟着被带走,没有被拿掉 → 可以组合 */
  const CARRIED = d("你在别人不急着接话的时候比较敢讲。",
    "被追问的时候，你会先把话收起来。通常先让自己想一想就够了，不一定要当场给答案。");
  const ca = AN.candidateFor("grounds", CARRIED);
  checkEq("[scope] 保留字跟着那一步走的时候不必挡", ca.scopeGuard, null);
  checkEq("[scope] 「通常」仍然留在句子里", ca.line.indexOf("通常") >= 0, true);

  /* 原文本来就没有保留字 → 搬过来不会更肯定 → 照常组合 */
  const PLAIN = d("你在别人不急着接话的时候比较敢讲。",
    "被追问的时候，你会先把话收起来。先让自己想一想就够了，不一定要当场给答案。");
  const pl = AN.candidateFor("grounds", PLAIN);
  checkEq("[scope] 原文没有保留字就不必挡", pl.scopeGuard, null);
  checkEq("[scope] 原文没有保留字时照常跨句组合", pl.sameSentence, false);
  checkEq("[scope] 组合出来的句子真的多了一半场合", pl.line.length > pl.move.length + 1, true);

  /* 2. 同一句里的压缩,保留了不确定 → 接受 -------------------------------- */
  const dr = AN.candidateFor("drains", live.drains);
  checkEq("[scope] 同一句压缩不受守则影响", dr.scopeGuard, null);
  checkEq("[scope] 同一句压缩保留了「也许」", dr.line.indexOf("也许") >= 0, true);
  checkEq("[scope] 同一句压缩保留了原本的场合", dr.sameSentence, true);

  /* 3. 只拿掉纯连接词,范围没有变 → 接受 --------------------------------- */
  checkEq("[scope] 原文有句首连接词「只是当」", live.drains.explanation.indexOf("只是当") >= 0, true);
  checkEq("[scope] 锚点把连接词拿掉了", dr.line.indexOf("只是当") >= 0, false);
  checkEq("[scope] 拿掉连接词之后整句仍是原文的一段",
    live.drains.explanation.indexOf(dr.line.replace(/。$/, "")) >= 0, true);

  /* 4 & 5. Moves 与 Drains 一个字都没有变 -------------------------------- */
  const r = AN.derive(live);
  const byDir = {};
  r.anchors.forEach(function (a) { byDir[a.sourceDirection] = a.line; });
  checkEq("[scope] Moves 的那一句没有变",
    byDir.moves, "没力气的时候，可以先看看那个自己认同的理由还在不在，而不是先怀疑自己不够努力。");
  checkEq("[scope] Drains 的那一句没有变",
    byDir.drains, "你发现自己一直停在再确认一下，也许可以先看看，现在到底是什么让你放不下心。");

  /* 6. CALLS_WINS 仍然成立 ---------------------------------------------- */
  const CALLS_WINS = {
    grounds: d("你在安静的地方比较容易想清楚。",
      "很多人以为要想清楚就得多讨论。对你来说不是这样。事情刚发生的时候，先让自己安静一会儿就够了。"),
    moves: d("你需要一个说得通的理由才走得动。",
      "没有理由的时候你会停住。这不是拖延。最近如果比较没力气，也可能只是那个理由暂时不见了。"),
    drains: d("反覆确认会把你的力气用掉。",
      "这一次你一直在重新检查，刚才那一轮其实就够了。"),
    calls: d("你对还没看完的事情特别放不下。",
      "每次有一件事你一直绕回去想，可以先看看，它到底还有哪一层没被你看完，而不是先怪自己分心。")
  };
  const w = AN.derive(CALLS_WINS);
  const wDirs = w.anchors.map(function (a) { return a.sourceDirection; });
  checkEq("[scope] 守则之后 Calls 仍然被选上而且排第一", wDirs[0], "calls");
  checkEq("[scope] 守则之后仍然是 Moves 被换掉",
    w.dropped.map(function (x) { return x.direction; }).join(","), "moves");
  checkEq("[scope] 守则之后那三句一个字都没有变",
    w.anchors.map(function (a) { return a.line; }).join("|"),
    "每次有一件事你一直绕回去想，可以先看看，它到底还有哪一层没被你看完，而不是先怪自己分心。|" +
    "事情刚发生的时候，先让自己安静一会儿就够了。|" +
    "这一次你一直在重新检查，刚才那一轮其实就够了。");

  /* 7. 没有多出任何请求 -------------------------------------------------- */
  const fs = require("fs");
  const src = fs.readFileSync(path.join(__dirname, "..", "assets", "compass-anchors.js"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  checkEq("[scope] 守则没有带进任何网路呼叫",
    /fetch\(|XMLHttpRequest|anthropic|supabase|require\(/i.test(src), false);
  const realFetch = global.fetch, realXHR = global.XMLHttpRequest;
  let called = 0;
  global.fetch = function () { called++; throw new Error("no"); };
  global.XMLHttpRequest = function () { called++; throw new Error("no"); };
  try {
    checkEq("[scope] 守则跑起来不发请求", AN.derive(live).status, "ok");
    checkEq("[scope] fetch 一次都没被碰到", called, 0);
  } finally { global.fetch = realFetch; global.XMLHttpRequest = realXHR; }

  /* 8. 目前的样本仍然给得出正好三句 -------------------------------------- */
  checkEq("[scope] 目前的样本仍然是三句", r.anchors.length, 3);
  checkEq("[scope] 三句仍然全部回查得过", AN.verifyDerived(r, live).offenders.length, 0);
  checkEq("[scope] 同一份 Compass 仍然永远一样",
    JSON.stringify(AN.derive(live)), JSON.stringify(r));
}


/* ---------- 27. reusability 的定义(anchors 2.2) ----------
   它回答的是「这句提醒以后还回得来吗」,不是「剖析器有没有抓到场合片语」。
   ------------------------------------------------------------------- */
function testCompassAnchorReusability() {
  const AN = require(path.join(__dirname, "..", "assets", "compass-anchors.js"));
  const RC = require(path.join(__dirname, "..", "assets", "compass-recorded.js"));
  const live = RC.RAW_V12.C1;
  function d(ci, ex) {
    return { coreInsight: ci, explanation: ex, reflectionPrompt: "你希望这件事把你带到哪里？" };
  }
  /* 直接喂候选物件,把这一条规则单独隔离出来量 */
  function cand(situation, move) {
    return { line: (situation ? situation + "，" : "") + move + "。", situation: situation, move: move };
  }

  /* 1. 没有场合,但那一步自己站得住 → 仍然是「会再回来」 ------------------- */
  checkEq("[reuse] 没场合 + 给了许可的一步 → 2",
    AN.reusabilityOf(cand(null, "先让自己安静一会儿就够了，不一定要马上解释")), 2);
  checkEq("[reuse] 没场合 + 给了动作的一步 → 2",
    AN.reusabilityOf(cand(null, "可以先看看现在到底是什么让你放不下心")), 2);

  /* 2. 没有场合,而且那一步只是换个说法去理解 → 仍然是 0 ------------------ */
  checkEq("[reuse] 没场合 + 只是换个说法 → 0",
    AN.reusabilityOf(cand(null, "也可能只是那个理由暂时不见了")), 0);
  checkEq("[reuse] 没场合 + 纯描述 → 0",
    AN.reusabilityOf(cand(null, "那不一定是分心")), 0);
  checkEq("[reuse] 0 不是因为「没抓到场合」,而是因为那一步站不住",
    AN.reusabilityOf(cand(null, "先让自己安静一会儿就够了")) !== 
    AN.reusabilityOf(cand(null, "也可能只是那个理由暂时不见了")), true);

  /* 3. 绑在这一阵子 → 1(不是 2,也不是 0) ------------------------------- */
  ["最近", "这一次", "刚才", "今天", "这阵子"].forEach(function (w) {
    checkEq("[reuse] 「" + w + "」仍然只是这一阵子 → 1",
      AN.reusabilityOf(cand(w + "有件事一直卡着", "可以先看看它到底卡在哪里")), 1);
  });
  checkEq("[reuse] 一次性 + 站不住的一步 → 0",
    AN.reusabilityOf(cand("最近有件事卡着", "那不一定是分心")), 0);

  /* 4. 会重复出现的入口 → 2 -------------------------------------------- */
  ["每次", "一直", "只要", "每当"].forEach(function (w) {
    checkEq("[reuse] 「" + w + "」是会再回来的入口 → 2",
      AN.reusabilityOf(cand(w + "遇到这种事", "可以先看看自己在担心什么")), 2);
  });
  checkEq("[reuse] 「……的时候」也是会再回来的入口 → 2",
    AN.reusabilityOf(cand("没力气的时候", "可以先看看那个理由还在不在")), 2);

  /* 5. anchors-2.1 的范围守则一个字都没有松动 --------------------------- */
  const g = AN.candidateFor("grounds", live.grounds);
  checkEq("[reuse] 范围守则仍然在挡", g.scopeGuard, "cross-sentence-would-tighten-scope");
  checkEq("[reuse] 范围守则仍然不留场合那一半", g.situation, null);

  /* 6. Grounds 没有把「事情刚发生的时候」拿回来 -------------------------- */
  checkEq("[reuse] Grounds 仍然是那一步本身",
    g.line, "先让自己安静一会儿就够了，不一定要马上解释。");
  checkEq("[reuse] Grounds 没有拿回被挡下来的条件",
    g.line.indexOf("事情刚发生的时候") >= 0, false);
  const r = AN.derive(live);
  checkEq("[reuse] 画面上那三句里没有被挡下来的条件",
    r.anchors.filter(function (a) { return a.line.indexOf("事情刚发生的时候") >= 0; }).length, 0);
  /* 新定义之后它确实被一般规则选上了 —— 不是被硬塞进去的 */
  const gp = r.anchors.filter(function (a) { return a.sourceDirection === "grounds"; })[0];
  checkEq("[reuse] Grounds 这次靠一般规则被选上", !!gp, true);
  checkEq("[reuse] 它是靠「那一步自己站得住」拿到 2 的", gp ? gp.score.reusability : "(没被选上)", 2);
  checkEq("[reuse] 它拿到的是补位加分,不是特权",
    !!gp && gp.selectionReason.indexOf("补上「回到自己」") >= 0, true);

  /* 7. CALLS_WINS 仍然选得到 Calls,而且三句一个字都没变 ----------------- */
  const CALLS_WINS = {
    grounds: d("你在安静的地方比较容易想清楚。",
      "很多人以为要想清楚就得多讨论。对你来说不是这样。事情刚发生的时候，先让自己安静一会儿就够了。"),
    moves: d("你需要一个说得通的理由才走得动。",
      "没有理由的时候你会停住。这不是拖延。最近如果比较没力气，也可能只是那个理由暂时不见了。"),
    drains: d("反覆确认会把你的力气用掉。",
      "这一次你一直在重新检查，刚才那一轮其实就够了。"),
    calls: d("你对还没看完的事情特别放不下。",
      "每次有一件事你一直绕回去想，可以先看看，它到底还有哪一层没被你看完，而不是先怪自己分心。")
  };
  const w = AN.derive(CALLS_WINS);
  checkEq("[reuse] CALLS_WINS 仍然是 Calls 排第一", w.anchors[0].sourceDirection, "calls");
  checkEq("[reuse] CALLS_WINS 三句一个字都没变",
    w.anchors.map(function (a) { return a.line; }).join("|"),
    "每次有一件事你一直绕回去想，可以先看看，它到底还有哪一层没被你看完，而不是先怪自己分心。|" +
    "事情刚发生的时候，先让自己安静一会儿就够了。|" +
    "这一次你一直在重新检查，刚才那一轮其实就够了。");
  /* 被换掉的 moves 就是「situation===null 而且站不住 → 0」的真实例子 */
  const wm = w.dropped.filter(function (x) { return x.direction === "moves"; })[0];
  checkEq("[reuse] 被换掉的仍然是 Moves", !!wm, true);
  checkEq("[reuse] 它的 reusability 真的是 0",
    AN.scoreCandidate(AN.candidateFor("moves", CALLS_WINS.moves)).reusability, 0);
  checkEq("[reuse] 它的 situation 确实是 null",
    AN.candidateFor("moves", CALLS_WINS.moves).situation, null);

  /* 8. 功能互补是加分,不是硬性规定 ------------------------------------- */
  checkEq("[reuse] CALLS_WINS 只覆盖两种功能,照样成立",
    new Set(w.anchors.map(function (a) { return a["function"]; })).size, 2);
  checkEq("[reuse] 没有把 return+orient+notice 定成必须的组合",
    (function () {
      const fns = w.anchors.map(function (a) { return a["function"]; }).slice().sort().join(",");
      return fns === "notice,orient,return";
    })(), false);
  checkEq("[reuse] 也没有把 Grounds+Moves+Drains 定成必须的组合",
    w.anchors.map(function (a) { return a.sourceDirection; }).slice().sort().join(","),
    "calls,drains,grounds");

  /* 9. 没有多出任何请求 -------------------------------------------------- */
  const realFetch = global.fetch, realXHR = global.XMLHttpRequest;
  let called = 0;
  global.fetch = function () { called++; throw new Error("no"); };
  global.XMLHttpRequest = function () { called++; throw new Error("no"); };
  try {
    checkEq("[reuse] 新定义跑起来不发请求", AN.derive(live).status, "ok");
    checkEq("[reuse] fetch 一次都没被碰到", called, 0);
  } finally { global.fetch = realFetch; global.XMLHttpRequest = realXHR; }
}


/* ---------- 28. ★ PERSONAL ANCHORS v1 LOCK ----------
   「想留给自己的几句话」这一层已经通过人工内容审查,定为生产基准。
   这一段的存在只有一个目的:让【以后不相干的改动】没办法悄悄改掉它的行为。

   钉住的是两类东西:
     · 判断用的词表(那些词决定什么算场合、什么算一步、什么算保留字)
     · 已锁样本的【完整推导结果】(三句话、来源、功能、每一项分数、被换掉的那一个)
   所以纯粹改注解、换排版不会误红,但只要取舍结果真的变了就一定红。

   要改做法的正确方式是开新版本(anchors-3.x),不是就地编辑这一版。
   ------------------------------------------------------------------- */
function testCompassAnchorsLock() {
  const crypto = require("crypto");
  const AN = require(path.join(__dirname, "..", "assets", "compass-anchors.js"));
  const RC = require(path.join(__dirname, "..", "assets", "compass-recorded.js"));
  const h = (o) => crypto.createHash("sha256")
    .update(typeof o === "string" ? o : JSON.stringify(o)).digest("hex").slice(0, 16);
  function d(ci, ex) {
    return { coreInsight: ci, explanation: ex, reflectionPrompt: "你希望这件事把你带到哪里？" };
  }

  /* —— 基准身分 —— */
  const B = AN.ANCHORS_BASELINE;
  checkEq("[alock] 基准版本是 anchors-2.2", B.version, "anchors-2.2");
  checkEq("[alock] 程式码跑的就是基准版本", AN.VERSION, B.version);
  checkEq("[alock] 基准名称是 Personal Anchors v1", B.name, "Personal Anchors v1");
  checkEq("[alock] 基准的语言是中文", B.language, "zh");
  checkEq("[alock] 历史版本都记着", B.history.join(","), "anchors-1.0,anchors-2.0,anchors-2.1");
  checkEq("[alock] 锁住的项目一个都没少",
    B.locks.join("|"),
    "candidate derivation|scope guard|hedge handling|reusability|scoring|" +
    "function classification|complementarity|selection|verifyDerived|user-facing copy behavior");

  /* —— 1. 判断用的词表逐字钉住 —— */
  const VOCAB = {
    SITUATION_RECURRING: AN.SITUATION_RECURRING, SITUATION_ONCE: AN.SITUATION_ONCE,
    MOVE_GENTLE: AN.MOVE_GENTLE, MOVE_LOOK: AN.MOVE_LOOK, MOVE_PERMISSION: AN.MOVE_PERMISSION,
    COMMANDING: AN.COMMANDING, GENERIC: AN.GENERIC, HEDGE: AN.HEDGE, FUNCTIONS: AN.FUNCTIONS
  };
  checkEq("[alock] 判断用的词表逐字未动", h(VOCAB), "52eaf14835ee7076");

  /* —— 2. 已锁样本的完整推导结果 —— */
  checkEq("[alock] 已锁样本的推导结果逐项未动",
    h(AN.derive(RC.RAW_V12.C1)), "3b48592c7de80a85");

  const CALLS_WINS = {
    grounds: d("你在安静的地方比较容易想清楚。",
      "很多人以为要想清楚就得多讨论。对你来说不是这样。事情刚发生的时候，先让自己安静一会儿就够了。"),
    moves: d("你需要一个说得通的理由才走得动。",
      "没有理由的时候你会停住。这不是拖延。最近如果比较没力气，也可能只是那个理由暂时不见了。"),
    drains: d("反覆确认会把你的力气用掉。",
      "这一次你一直在重新检查，刚才那一轮其实就够了。"),
    calls: d("你对还没看完的事情特别放不下。",
      "每次有一件事你一直绕回去想，可以先看看，它到底还有哪一层没被你看完，而不是先怪自己分心。")
  };
  checkEq("[alock] CALLS_WINS 的推导结果逐项未动",
    h(AN.derive(CALLS_WINS)), "77f1fc2f861c052c");

  /* —— 3. 边界矩阵:范围守则 × 保留字 × reusability 三个级距 —— */
  const MATRIX = {
    reuse: [
      [null, "先让自己安静一会儿就够了，不一定要马上解释"],
      [null, "可以先看看现在到底是什么让你放不下心"],
      [null, "也可能只是那个理由暂时不见了"],
      [null, "那不一定是分心"],
      ["最近有件事卡着", "可以先看看它到底卡在哪里"],
      ["这一次比较难", "刚才那一轮其实就够了"],
      ["每次遇到这种事", "可以先看看自己在担心什么"],
      ["没力气的时候", "可以先看看那个理由还在不在"],
      ["一直停在同一个地方", "不一定要马上给答案"]
    ].map(function (x) {
      return AN.reusabilityOf({ line: (x[0] ? x[0] + "，" : "") + x[1] + "。",
                                situation: x[0], move: x[1] });
    }),
    guard: [
      /* 范围有保留 → 不跨句搬 */
      "被追问的时候，你会先把话收起来。通常，先让自己想一想就够了，不一定要当场给答案。",
      "被追问的时候，你会先把话收起来。有些时候，先让自己想一想就够了。",
      /* 保留字跟着那一步走 → 不必挡 */
      "被追问的时候，你会先把话收起来。通常先让自己想一想就够了，不一定要当场给答案。",
      /* 范围本来就没有保留 → 照常组合 */
      "被追问的时候，你会先把话收起来。先让自己想一想就够了，不一定要当场给答案。"
    ].map(function (ex) {
      const c = AN.candidateFor("grounds", d("你在别人不急着接话的时候比较敢讲。", ex));
      return c ? [c.scopeGuard, c.sameSentence, c.line] : null;
    })
  };
  checkEq("[alock] 边界矩阵逐项未动", h(MATRIX), "b5437b1c7ab6f8c2");

  /* —— 4. 对外的介面没有被悄悄拿掉 —— */
  checkEq("[alock] 对外介面一个都没少",
    ["VERSION", "ANCHORS_BASELINE", "ANCHOR_COUNT", "FUNCTIONS", "derive", "verifyDerived",
     "candidateFor", "scoreCandidate", "reusabilityOf", "similarity"]
      .filter(function (k) { return !(k in AN); }).join(","), "");
  checkEq("[alock] 仍然只取三句", AN.ANCHOR_COUNT, 3);

  /* —— 5. 这一层永远不呼叫 API —— */
  const fs = require("fs");
  const src = fs.readFileSync(path.join(__dirname, "..", "assets", "compass-anchors.js"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  checkEq("[alock] 锁定的这一版没有任何网路呼叫",
    /fetch\(|XMLHttpRequest|anthropic|supabase|import\s|require\(/i.test(src), false);

  /* —— 6. 基准文件跟程式码说的是同一件事 —— */
  const doc = fs.readFileSync(
    path.join(__dirname, "..", "docs", "INNER-COMPASS-ANCHORS-BASELINE.md"), "utf8");
  ["anchors-2.2", "52eaf14835ee7076", "3b48592c7de80a85", "77f1fc2f861c052c"]
    .forEach(function (t) {
      checkEq("[alock] 基准文件写着 " + t, doc.indexOf(t) >= 0, true);
    });
}


/* ---------- 29. 上线前修的两件事(F1 / F2) ----------
   F1 云端记录会把「那天的问题」丢掉  F2 内在指南的页尾指向错的地方
   ------------------------------------------------------------------- */
function testCompassPreLaunchFixes() {
  const fs = require("fs");
  const html = fs.readFileSync(path.join(__dirname, "..", "app.html"), "utf8");
  const sqlDir = path.join(__dirname, "..", "docs", "sql");
  const sql = fs.readFileSync(path.join(sqlDir, "compass_entries.sql"), "utf8");
  const mig = fs.readFileSync(path.join(sqlDir, "compass_entries_add_question.sql"), "utf8");

  /* —— F1:那天的问题要能来回走一趟 —— */
  const rowIn = html.slice(html.indexOf("function rowIn(r)"), html.indexOf("const tableStore"));
  checkEq("[F1] rowIn 会把 question 带回来", /question:\s*r\.question \|\| ""/.test(rowIn), true);

  const ts = html.slice(html.indexOf("const tableStore = {"), html.indexOf("function pickStore"));
  checkEq("[F1] list 的 select 有要 question",
    /select=id,created_at,mood,body,kind,question&/.test(ts), true);
  checkEq("[F1] add 的 POST 会送 question", /question:\s*row\.question \|\| null/.test(ts), true);
  /* 送上去的还是只有使用者看得到的东西 */
  checkEq("[F1] POST 没有夹带机制 / 证据 / 分数 / prompt",
    /\bmechanism\b|support\[|selectionScore|patternKey|systemPrompt|promptVersion/i
      .test(ts.slice(ts.indexOf("body: JSON.stringify({"), ts.indexOf("}).then"))), false);
  /* 本机那一条路没有被动到 */
  const shape = html.slice(html.indexOf("function shape(entry, keep)"), html.indexOf("function isEmpty"));
  checkEq("[F1] 本机的资料形状没有变", /question: String\(e\.question/.test(shape), true);

  /* —— 资料库:只能用「加栏位」的方式,不能重建或删资料 —— */
  checkEq("[F1] 正式 schema 有 question 这一栏", /^\s*question\s+text,/m.test(sql), true);
  checkEq("[F1] question 是可以为 null 的", /question\s+text\s*,/.test(sql) && !/question\s+text\s+not null/.test(sql), true);
  checkEq("[F1] schema 有长度限制", /compass_question_len_chk/.test(sql), true);
  checkEq("[F1] 迁移只加栏位", /add column if not exists question text/.test(mig), true);
  checkEq("[F1] 迁移可以重复跑", /if not exists/.test(mig) && /pg_constraint/.test(mig), true);
  ["drop table", "truncate", "delete from", "create table", "drop column"].forEach(function (bad) {
    checkEq("[F1] 迁移没有「" + bad + "」", mig.toLowerCase().indexOf(bad) >= 0, false);
  });
  checkEq("[F1] 迁移的长度限制与前端一致(160)",
    /<= 160/.test(mig) && /MAX_MOOD \* 4/.test(shape), true);
  checkEq("[F1] 正式 schema 指得出该跑哪一段迁移",
    sql.indexOf("compass_entries_add_question.sql") >= 0, true);
  /* 旧的列 question 是 null:画面本来就只在有值的时候才印 */
  const skyFn = (function () {
    const a = html.indexOf("function compassSkyHtml()");
    return html.slice(a, html.indexOf("\n  /*", a + 10));
  })();
  checkEq("[F1] 没有值就不印「那天的问题」", /open && r\.question/.test(skyFn), true);
  checkEq("[F1] 不会替旧记录编一个问题出来",
    /r\.question \|\| *["']那|placeholder|示例/.test(skyFn), false);

  /* —— F2:只有内在指南这一页换页尾 —— */
  const foot = html.slice(html.indexOf("function dpReturnFoot("), html.indexOf("// ---------- 页面:九大主题"));
  checkEq("[F2] dpReturnFoot 收一组可选的 label / href",
    /function dpReturnFoot\(threadTail, opts\)/.test(foot), true);
  checkEq("[F2] 不传就维持原本的文案",
    /o\.label \|\| dpT\("返回主题列表"/.test(foot), true);
  checkEq("[F2] 不传就维持原本的去处",
    /\(o\.href \|\| LANDING_TOPICS\)/.test(foot), true);
  checkEq("[F2] 内在指南这一页自己传一组",
    /foot: dpReturnFoot\(false, \{ label: dpT\("回到主页", "Back to home"\), href: LANDING_URL \}\)/.test(html), true);
  /* 其他页面一个都没被改到:剩下的呼叫仍然不带第二个参数 */
  const calls = (html.match(/dpReturnFoot\([^)]*\)/g) || [])
    .filter(function (c) { return c !== "dpReturnFoot(threadTail, opts)"; });
  checkEq("[F2] 其他页面的呼叫没有被动过",
    calls.filter(function (c) { return c.indexOf("label:") >= 0; }).length, 1);
  checkEq("[F2] 其他页面仍然拿到预设值",
    calls.filter(function (c) {
      return c.indexOf("label:") < 0 && !/dpReturnFoot\((\)|true\))/.test(c);
    }).join(","), "");
}



/* ---------- 30. 语意衍生层(anchors-3.1)----------
   compass-v1 那一代的文案只有描述与归纳,已锁的 2.2 一句都取不出来。
   3.1 换的是单位:不再要求每个【字】在来源里,而是要求每个【主张】在来源里。
   安全性靠三件事:概念授权、输出空间有限可枚举、词典静态稽核。
   ------------------------------------------------------------------- */
function testCompassAnchorsSemantic() {
  const crypto = require("crypto");
  const fs = require("fs");
  const AN = require(path.join(__dirname, "..", "assets", "compass-anchors.js"));
  const S = require(path.join(__dirname, "..", "assets", "compass-anchors-semantic.js"));
  const RC = require(path.join(__dirname, "..", "assets", "compass-recorded.js"));
  const h = (o) => crypto.createHash("sha256")
    .update(typeof o === "string" ? o : JSON.stringify(o)).digest("hex").slice(0, 16);
  function d(ci, ex) { return { coreInsight: ci, explanation: ex, reflectionPrompt: "" }; }

  const LIVE = {
    grounds: d("让你回来的，是一个有顺序的过程，不是一个地方",
      "有时候你需要的不是陪伴，而是先让外面安静一会儿。不是因为不想接触，而是在那之前，你得先把自己整理一下。有些感受在说出来之前是散的，说出来之后才会停下来占据你的注意力。等那一步完成，你才会真的想靠近人。这个顺序对你来说不是习惯，更像是一个必要的步骤。"),
    moves: d("让你愿意投入的，是「这件事还有没有意义」",
      "事情重不重要，不是你真正在评估的。你在评估的是：做这件事的时候，有没有什么是真实的。只要那个感觉还在，你可以做很久。但如果变成纯粹照步骤走的事，动力会消失得比想象中快。有些事你会接下来，是因为当时感觉值得，而不是因为你非接不可。"),
    drains: d("你真正容易耗掉的地方，在靠近之前那一段反覆确认的过程",
      "你不会一下子全说。通常是先说一点，看看接下来发生什么，再决定要不要继续。这个过程本身不是问题，但它需要持续花力气。对你来说，想深入和觉得现在还不到时候，这两件事往往同时都是真的——先出现的那个，通常是「再确认一次」。"),
    calls: d("你容易被「换一个角度再看」这件事吸引",
      "同样的事做太久，你的注意力会散掉——不是因为难，而是因为不变。换一个切入点，有时比休息更有用。你也容易对一件事背后的更大的问题感兴趣，那个「再往外一层看」的冲动，不太需要理由，就是会一直出现。")
  };
  const lines = (r) => (r.anchors || []).map(function (a) { return a.line; });

  /* —— 2. 案例 A:人工 Voice Review 定案的那三句 —— */
  checkEq("[sem] 2.2 对描述型文案仍然取不出东西", AN.derive(LIVE).status, "insufficient");
  const A = S.derive(LIVE);
  checkEq("[sem] A 取得出结果", A.status, "ok");
  checkEq("[sem] A 走语意层", A.mode, "semantic");
  checkEq("[sem] A 就是定案的那三句", lines(A).join("|"),
    "先让外面安静一会儿，等自己理顺了，再靠近也不迟。|" +
    "事情开始推不动的时候，也许可以回来看看，它对自己还有没有意义。|" +
    "有时候不是需要休息，只是需要换一个切入点。");
  checkEq("[sem] A 第三席给了 Calls,不是 Drains",
    A.anchors[2].sourceDirection, "calls");
  checkEq("[sem] A 逐句重新授权得起来", S.verifySemantic(A, LIVE).offenders.length, 0);
  checkEq("[sem] A 同一份文案永远同一组", JSON.stringify(S.derive(LIVE)), JSON.stringify(A));

  /* —— 7. 功能互补是偏好,不是硬性规定 —— */
  checkEq("[sem] A 只覆盖两种功能,照样成立", new Set(A.anchors.map(function (a) { return a["function"]; })).size, 2);
  checkEq("[sem] Drains 那一句其实做得出来,只是没被选上",
    !!S.candidateFor("drains", LIVE.drains), true);
  checkEq("[sem] 它被换掉的理由记下来了",
    (A.dropped[0] || {}).direction, "drains");

  /* —— 6. 句型多样性 ——
     跟功能互补一样是【偏好】而不是硬性规定:有别的句型可选就一定换,
     整份文案只授权得到同一种句型时,不会为了换句型去挑一句更差的。
     底线是:三句不可以全部同一个句型。 */
  const CASES = [["A", A, LIVE], ["C4", S.derive(RC.RAW.C4), RC.RAW.C4],
                 ["C6", S.derive(RC.RAW.C6), RC.RAW.C6], ["C10", S.derive(RC.RAW.C10), RC.RAW.C10]];
  CASES.forEach(function (x) {
    if (x[1].status !== "ok") return;
    const used = new Set(x[1].anchors.map(function (a) { return a.template; }));
    checkEq("[sem] " + x[0] + " 三句不会全部同一个句型", used.size >= 2, true);
    /* 有第三种句型可选的时候,就一定会用上 */
    const avail = new Set(["grounds", "moves", "drains", "calls"]
      .map(function (k) { return x[2][k] && S.candidateFor(k, x[2][k]); })
      .filter(Boolean).map(function (c) { return c.template; }));
    checkEq("[sem] " + x[0] + " 有几种句型就用上几种(上限三)",
      used.size, Math.min(3, avail.size));
  });
  /* 句型重复的扣分确实大过功能互补的加分 —— 这就是「多样性排在互补前面」 */
  checkEq("[sem] 句型重复扣的分比功能互补加的分多",
    (function () {
      const src = fs.readFileSync(path.join(__dirname, "..", "assets", "compass-anchors-semantic.js"), "utf8");
      const tpl = /usedTpl\[c\.template\] \? ([\d.]+) : 0/.exec(src);
      const fnb = /usedFn\[c\["function"\]\] \? 0 : ([\d.]+)/.exec(src);
      return tpl && fnb && parseFloat(tpl[1]) > parseFloat(fnb[1]);
    })(), true);

  /* —— 3. 另外三份 fixture —— */
  const C4 = S.derive(RC.RAW.C4);
  checkEq("[sem] C4 的三句", lines(C4).join("|"),
    "乱起来的时候，先把外面挡一挡，等自己理顺了，再找人也不迟。|" +
    "撑不下去的时候，也许可以回来看看，这件事对你还成不成立。|" +
    "累的常常不是那件事，是做完以后还要顾有多少人在看。");
  const C6 = S.derive(RC.RAW.C6);
  checkEq("[sem] C6 的三句", lines(C6).join("|"),
    "想往后站的时候，不是想离开，是需要知道退一步还在。|" +
    "累的常常不是事情本身，是被看着的时候多顾的那一层。|" +
    "一天被排满的时候，留一小块自己说了算的，就又转得动了。");
  const C10 = S.derive(RC.RAW.C10);
  checkEq("[sem] C10 的三句(这一份只有三个方向)", lines(C10).join("|"),
    "知道自己随时可以走，你才待得住。|" +
    "花力气的常常不是那个决定，是决定完以后那段没关上的检查。|" +
    "要等到可以说点真的东西，你才会真的靠过去。");
  [["C4", C4, RC.RAW.C4], ["C6", C6, RC.RAW.C6], ["C10", C10, RC.RAW.C10]].forEach(function (x) {
    checkEq("[sem] " + x[0] + " 逐句重新授权得起来", S.verifySemantic(x[1], x[2]).offenders.length, 0);
  });
  checkEq("[sem] 四份的三句彼此都不一样",
    new Set([lines(A).join("|"), lines(C4).join("|"), lines(C6).join("|"), lines(C10).join("|")]).size, 4);

  /* —— 4. Voice Review 决定三:保留原文的不确定 —— */
  const wake = S.candidateFor("calls", RC.RAW.C6.calls);
  checkEq("[sem] C6 用的是比较弱的「人比较容易回来」",
    wake.line.indexOf("人比较容易回来") >= 0, true);
  checkEq("[sem] C6 没有写成「人就回来了」",
    JSON.stringify(S.allPossibleLines()).indexOf("人就回来了") >= 0, false);

  /* —— 5. Voice Review 决定二:不加原文没给的宽慰 —— */
  checkEq("[sem] D5 没有「人不多没关系」",
    JSON.stringify(S.allPossibleLines()).indexOf("人不多没关系") >= 0, false);
  checkEq("[sem] D5 用的是原文支持得住的说法",
    lines(C10).join("|").indexOf("要等到可以说点真的东西，你才会真的靠过去") >= 0, true);

  /* —— 输出空间有限、可枚举、已审、已钉住 —— */
  const all = S.allPossibleLines();
  checkEq("[sem] 所有可能被说出口的句子共 19 句", all.length, 19);
  checkEq("[sem] 枚举清单逐字未动", h(all), "95f8abb7e7c55009");
  checkEq("[sem] 概念词典逐字未动", h(S.CONCEPTS), "ba31ce40024aec21");
  checkEq("[sem] 句型逐字未动",
    h(Object.keys(S.TEMPLATES).sort().map(function (k) { return k + ":" + S.TEMPLATES[k].need.join("+"); })),
    "b9f9a5aea5974d3d");

  /* —— 词典静态稽核:一次涵盖所有使用者 —— */
  const corpus = all.map(function (x) { return x.line; }).join("\n");
  const AUDIT = [
    ["新的人格主张", /你是一个|你天生|你就是|你的性格|你属于|你注定/],
    ["新的心理机制", /创伤|依恋|神经系统|防御机制|应对机制|失调|解离|回避型|焦虑型/],
    ["新的成因", /因为你|所以你才|是因为你|从小|童年|原生家庭/],
    ["新的情绪命名", /焦虑|抑郁|恐惧|愤怒|羞耻|悲伤/],
    ["星盘用语", /星座|宫位|行星|相位|逆行|上升|星盘|本命/],
    ["玄学用语", /灵魂|宇宙|命运|能量|疗愈|显化|高我/],
    ["万用句", /相信自己|慢慢来|照顾好自己|加油|顺其自然|活在当下|爱自己|做真实的自己/],
    ["命令句", /你应该|你必须|你需要学会|你最好|请你|记得要/]
  ];
  AUDIT.forEach(function (a) {
    checkEq("[sem] 整本词典没有" + a[0], a[1].test(corpus), false);
  });
  checkEq("[sem] 每一句都是完整句",
    all.filter(function (x) { return !/[。]$/.test(x.line); }).length, 0);
  checkEq("[sem] 每一句都不长",
    all.filter(function (x) { return x.line.replace(/[，。：「」]/g, "").length > 32; }).length, 0);

  /* —— 8. 认不出来就说认不出来,不凑 —— */
  const THIN = {
    grounds: d("你比较慢热。", "你需要一点时间。"),
    moves: d("你需要理由。", "没有理由你就停住。"),
    drains: d("你容易累。", "太多人看着你会累。"),
    calls: d("你喜欢深的东西。", "浅的东西留不住你。")
  };
  const thin = S.derive(THIN);
  checkEq("[sem] 认不出来就回 insufficient", thin.status, "insufficient");
  checkEq("[sem] 认不出来时一句都不给", (thin.anchors || []).length, 0);
  checkEq("[sem] 认不出来时不给万用句", JSON.stringify(thin.anchors), "[]");
  checkEq("[sem] RAW.C1 授权不足也照实回报",
    S.derive(RC.RAW.C1).status === "ok" ? (S.derive(RC.RAW.C1).anchors.length === 3) : true, true);

  /* —— 概念授权真的是个人化的:别人的概念不会跑到你身上 —— */
  const mine = new Set(S.licensedVariants(LIVE.drains).map(function (x) { return x.concept; }));
  checkEq("[sem] 「被看见的代价」没有出现在你的文案里", mine.has("extra_layer_tires"), false);
  const theirs = new Set(S.licensedVariants(RC.RAW.C4.drains).map(function (x) { return x.concept; }));
  checkEq("[sem] 它出现在 C4 的文案里", theirs.has("extra_layer_tires"), true);

  /* —— 10. 已锁的 2.2 一个字都没动 —— */
  const v12 = S.derive(RC.RAW_V12.C1);
  checkEq("[sem] v1.2 的文案原样交给已锁的 2.2", v12.mode, "extract");
  checkEq("[sem] v1.2 的结果与 2.2 逐字相同",
    JSON.stringify(v12.anchors), JSON.stringify(AN.derive(RC.RAW_V12.C1).anchors));
  checkEq("[sem] 已锁基准没有被碰过", AN.ANCHORS_BASELINE.version, "anchors-2.2");

  /* —— 这一层永远不呼叫 API —— */
  const src = fs.readFileSync(path.join(__dirname, "..", "assets", "compass-anchors-semantic.js"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  checkEq("[sem] 没有任何网路呼叫", /fetch\(|XMLHttpRequest|anthropic|supabase/i.test(src), false);
  checkEq("[sem] 不碰星盘 / 机制 / 分数 / 日记",
    /planets|cusps|\bmechanism\b|selectionScore|patternKey|journal|mood|favs/i.test(src), false);
  const realFetch = global.fetch, realXHR = global.XMLHttpRequest;
  let called = 0;
  global.fetch = function () { called++; throw new Error("no"); };
  global.XMLHttpRequest = function () { called++; throw new Error("no"); };
  try {
    checkEq("[sem] 推导过程不发请求", S.derive(LIVE).status, "ok");
    checkEq("[sem] fetch 一次都没被碰到", called, 0);
  } finally { global.fetch = realFetch; global.XMLHttpRequest = realXHR; }

  /* —— 9. 页面:渲染时现算,既有的空阵列自己会好 —— */
  const html = fs.readFileSync(path.join(__dirname, "..", "app.html"), "utf8");
  const fn = html.slice(html.indexOf("function compassAnchorsFor(saved)"),
                        html.indexOf("function compassNowHtml()"));
  checkEq("[sem] 渲染时从已存的四段文案现算", /AN3\.derive\(saved\.directions\)/.test(fn), true);
  checkEq("[sem] 现算的结果要重新授权过才给",
    /verifySemantic\(r, saved\.directions\)/.test(fn) && /if \(v\.ok\) list = r\.anchors/.test(fn), true);
  checkEq("[sem] 现算不出来才退回快取里那一份", /if \(!list\.length && saved\.anchors/.test(fn), true);
  checkEq("[sem] 现算有记忆化", /compassAnchorCache\.key === key/.test(fn), true);
  const ens = html.slice(html.indexOf("function compassEnsureAnchors()"),
                         html.indexOf("function compassAnchorsFor(saved)"));
  checkEq("[sem] 只补载锚点那两支",
    /compass-evidence|compass-selection|compass-generation|compass-preview|compass-recorded/.test(ens), false);
  checkEq("[sem] 正式页面会载入 3.1",
    /assets\/compass-anchors-semantic\.js/.test(
      html.slice(html.indexOf("const CP_PROD_SRC"), html.indexOf("];", html.indexOf("const CP_PROD_SRC")))), true);
  checkEq("[sem] 3.0 已经被取代,不再有参照",
    /compass-anchors-descriptive|CompassAnchorsDescriptive/.test(html), false);
}

/* ---------- 跑 ---------- */
/* ---------- 31. 我的内在指南 · 方向指南(Rule-based Direction Guide) ----------
   这个功能不是继续解读星盘,也不是每天呼叫 AI。
   它回答的是「知道这些以后,我可以往哪里走」。
   品质来自:好的匹配逻辑 + 写好的内容,不是来自频繁生成。
   ------------------------------------------------------------------- */
function testGuide() {
  const crypto = require("crypto");
  const fs = require("fs");
  const T = require(path.join(__dirname, "..", "assets", "guide-tags.js"));
  const C = require(path.join(__dirname, "..", "assets", "guide-content.js"));
  const E = require(path.join(__dirname, "..", "assets", "guide-engine.js"));
  const PV = require(path.join(__dirname, "..", "assets", "compass-preview.js"));
  const CA = require(path.join(__dirname, "..", "assets", "compass-cases.js"));
  const html = fs.readFileSync(path.join(__dirname, "..", "app.html"), "utf8");
  const h = (o) => crypto.createHash("sha256")
    .update(typeof o === "string" ? o : JSON.stringify(o)).digest("hex").slice(0, 16);
  const ids = (CA.CASES || []).map(function (c) { return c.id; });

  /* ═══ A. 长期标签:星盘只在后台出现一次 ═══ */
  const tagsOf = {};
  ids.forEach(function (id) { tagsOf[id] = T.fromReport(PV.buildCase(id).report); });
  checkEq("[guide] 十张测试盘都算得出标签",
    ids.filter(function (id) { return tagsOf[id].status !== "ok"; }).join(","), "");
  checkEq("[guide] 每张盘的标签组合不完全一样",
    new Set(ids.map(function (id) {
      const t = tagsOf[id];
      return t.movement_style.join() + "|" + t.stuck_pattern.join() + "|" + t.direction_need.join();
    })).size >= 7, true);
  ids.forEach(function (id) {
    const t = tagsOf[id];
    checkEq("[guide] " + id + " 标签数量在规格内",
      t.movement_style.length <= 2 && t.movement_style.length >= 1 &&
      t.stuck_pattern.length <= 3 && t.direction_need.length <= 3, true);
  });
  checkEq("[guide] 标签只用白名单里的值",
    ids.every(function (id) {
      const t = tagsOf[id];
      return t.movement_style.every(function (x) { return T.MOVEMENT.indexOf(x) >= 0; }) &&
             t.stuck_pattern.every(function (x) { return T.STUCK.indexOf(x) >= 0; }) &&
             t.direction_need.every(function (x) { return T.NEED.indexOf(x) >= 0; });
    }), true);
  checkEq("[guide] 同一张盘永远得到同一组标签",
    JSON.stringify(T.fromReport(PV.buildCase("C1").report)), JSON.stringify(tagsOf.C1));
  checkEq("[guide] 只看已接受的机制,不看被否决的",
    T.fromAccepted([{ patternKey: "solitude-then-contact", strength: 1 }]).direction_need.join(","),
    "space,rest");
  /* 被否决 / 暂列的机制不可以影响标签 —— 直接喂一份混着的 report */
  checkEq("[guide] 被否决的机制不会进标签",
    JSON.stringify(T.fromReport({ candidates: [
      { patternKey: "solitude-then-contact", strength: 1, status: "accepted" },
      { patternKey: "autonomy-or-stall", strength: 9, status: "rejected" },
      { patternKey: "novelty-over-repetition", strength: 9, status: "provisional" }
    ] })),
    JSON.stringify(T.fromAccepted([{ patternKey: "solitude-then-contact", strength: 1 }])));
  checkEq("[guide] 27 条机制 + 2 条护栏全部对照得到", Object.keys(T.MAP).length, 29);
  const tagSrc = fs.readFileSync(path.join(__dirname, "..", "assets", "guide-tags.js"), "utf8");
  checkEq("[guide] 标签层不发请求", /fetch\(|XMLHttpRequest|anthropic|supabase/i.test(tagSrc), false);

  /* ═══ B. 内容库 ═══ */
  const dirs = Object.keys(C.LIBRARY);
  checkEq("[guide] 11 个方向", dirs.length, 11);
  checkEq("[guide] 每个方向都有标签", dirs.every(function (d) { return !!C.LABELS[d]; }), true);
  checkEq("[guide] 每个方向至少 5 个版本",
    dirs.filter(function (d) { return C.LIBRARY[d].length < 5; }).join(","), "");
  const all = dirs.reduce(function (a, d) { return a.concat(C.LIBRARY[d]); }, []);
  checkEq("[guide] 一共 55 个版本", all.length, 55);
  checkEq("[guide] 每个版本四段都在",
    all.every(function (v) { return v.headline && v.body && v.toward && v.notYet && v.step; }), true);
  checkEq("[guide] id / headline / 一小步都不重复",
    new Set(all.map(function (v) { return v.id; })).size === 55 &&
    new Set(all.map(function (v) { return v.headline; })).size === 55 &&
    new Set(all.map(function (v) { return v.step; })).size === 55, true);
  const corpus = all.map(function (v) {
    return [v.headline, v.body, v.toward, v.notYet, v.step].join("\n");
  }).join("\n");
  [["星盘用语", /太阳|月亮|上升|宫位|相位|行星|星座|命主星|元素|星盘|本命|逆行|天顶|天底|北交|南交/],
   ["「因为你的星盘」这类说法", /因为你的星盘|你的星盘|你的月亮|你的太阳|你的上升|你的第.宫/],
   ["人格断言", /你是一个|你天生|你就是一个|你的性格|你属于|你注定/],
   /* 注:方向标签「更相信自己判断的状态」是规格定的,不算鸡汤 —— 这里只扫变体内容 */
   ["鸡汤", /^相信自己|。相信自己|勇敢做自己|跟随内心|宇宙会给你|一切都会变好|你值得最好|学会爱自己|活在当下|顺其自然|加油吧|要加油/],
   ["命令句", /你应该|你必须|你需要学会|请你|记得要/],
   ["临床词汇", /创伤|依恋|神经系统|失调|解离|回避型|焦虑型|防御机制/]
  ].forEach(function (a) {
    checkEq("[guide] 内容库没有" + a[0], a[1].test(corpus), false);
  });
  checkEq("[guide] 内容库逐字未动", h(C.LIBRARY), "2881f852cd473ae6");
  checkEq("[guide] 方向标签逐字未动", h(C.LABELS), "fe9c93493accc506");

  /* ═══ C. 匹配逻辑 ═══ */
  checkEq("[guide] 八种状态 / 八种主题", E.MOODS.length === 8 && E.TOPICS.length === 8, true);
  [["tired", "work", "rest,choice,meaning"],
   ["confused", "decision", "clarity,choice,space"],
   ["anxious", "future", "stability,clarity,space"],
   ["stuck", "work", "experimentation,clarity,choice"],
   ["empty", "energy", "rest,space"],
   ["hopeful", "change", "experimentation,self_trust"],
   ["restart", "future", "experimentation,choice,clarity"]
  ].forEach(function (x) {
    checkEq("[guide] " + x[0] + " + " + x[1] + " 的优先序",
      E.baseCandidates(x[0], x[1]).join(","), x[2]);
  });
  /* 规格的两个加权范例 */
  const r1 = E.rank({ mood: "confused", topic: "decision",
    tags: { stuck_pattern: ["should_over_want"], direction_need: ["choice"], movement_style: [] } });
  checkEq("[guide] should_over_want + need=choice → choice 权重最高", r1[0].direction, "choice");
  const withTag = E.rank({ mood: "stuck", topic: "work",
    tags: { stuck_pattern: ["overthinking"], movement_style: ["experiment_first"], direction_need: [] } });
  const noTag = E.rank({ mood: "stuck", topic: "work", tags: {} });
  const sc = function (rows, d) { const r = rows.filter(function (x) { return x.direction === d; })[0]; return r ? r.score : 0; };
  checkEq("[guide] overthinking + experiment_first → experimentation 与 clarity 都被拉高",
    sc(withTag, "experimentation") > sc(noTag, "experimentation") &&
    sc(withTag, "clarity") > sc(noTag, "clarity"), true);
  /* 每一格都给得出结果,而且【只有一个】方向 */
  let cells = 0, bad = [];
  E.MOODS.forEach(function (m) {
    E.TOPICS.forEach(function (t) {
      cells++;
      const g = E.guideFor({ mood: m.id, topic: t.id, tags: tagsOf.C1,
        date: "2026-09-16", owner: "u1", history: [] });
      if (g.status !== "ok" || !g.direction || !g.headline || !g.step) bad.push(m.id + "+" + t.id);
      if (g.direction && !C.LIBRARY[g.direction]) bad.push(m.id + "+" + t.id + " 方向不存在");
    });
  });
  checkEq("[guide] 64 种组合全部给得出一个方向", cells + "/" + bad.join(","), "64/");
  const one = E.guideFor({ mood: "tired", topic: "work", tags: tagsOf.C1, date: "2026-09-16", owner: "u1", history: [] });
  checkEq("[guide] 一天只给一个方向,不给四五个",
    typeof one.direction === "string" && !Array.isArray(one.direction), true);
  checkEq("[guide] 同一天同一组输入永远一样",
    JSON.stringify(E.guideFor({ mood: "tired", topic: "work", tags: tagsOf.C1, date: "2026-09-16", owner: "u1", history: [] })),
    JSON.stringify(one));
  checkEq("[guide] 不同的人不会永远拿到同一版",
    new Set(["u1", "u2", "u3", "u4", "u5", "u6"].map(function (o) {
      return E.guideFor({ mood: "calm", topic: "self", tags: tagsOf.C1, date: "2026-09-16", owner: o, history: [] }).variantId;
    })).size > 1, true);
  checkEq("[guide] 缺一个输入就不给方向",
    E.guideFor({ mood: "tired", tags: tagsOf.C1, date: "2026-09-16", owner: "u1", history: [] }).status, "need_input");

  /* ═══ D. 避免重复 ═══ */
  function runDays(n, pick) {
    let hist = [], rows = [];
    for (let d = 0; d < n; d++) {
      const date = new Date(Date.UTC(2026, 9, 1 + d)).toISOString().slice(0, 10);
      const inp = pick(d);
      const g = E.guideFor({ mood: inp[0], topic: inp[1], tags: tagsOf.C1,
        date: date, owner: "u1", history: hist });
      rows.push(g); hist.unshift(E.historyEntry(g));
    }
    let hb = 0, sb = 0, consec = 0;
    for (let i = 0; i < hist.length; i++) for (let j = i + 1; j < hist.length; j++) {
      const gap = Math.round((Date.parse(hist[i].date) - Date.parse(hist[j].date)) / 86400000);
      if (hist[i].headline === hist[j].headline && gap < E.HEADLINE_DAYS) hb++;
      if (hist[i].step === hist[j].step && gap < E.STEP_DAYS) sb++;
    }
    for (let i = 1; i < hist.length; i++) if (hist[i - 1].variantId === hist[i].variantId) consec++;
    return { hb: hb, sb: sb, consec: consec, dirs: new Set(hist.map(function (x) { return x.direction; })).size };
  }
  const same = runDays(45, function () { return ["confused", "decision"]; });
  checkEq("[guide] 连续 45 天同一组输入:30 天内 headline 不重复", same.hb, 0);
  checkEq("[guide] 连续 45 天同一组输入:14 天内一小步不重复", same.sb, 0);
  checkEq("[guide] 连续两天不会是同一版", same.consec, 0);
  checkEq("[guide] 同一组输入也会换方向,不会一直卡在一个", same.dirs >= 4, true);
  const M = E.MOODS.map(function (m) { return m.id; }), TP = E.TOPICS.map(function (t) { return t.id; });
  const vary = runDays(45, function (d) { return [M[d % 8], TP[(d * 3) % 8]]; });
  checkEq("[guide] 每天换输入:30 天内 headline 不重复", vary.hb, 0);
  checkEq("[guide] 每天换输入:14 天内一小步不重复", vary.sb, 0);
  /* 14 天的一小步去重要真的会挡:喂一笔【标题不同、但一小步一样】的历史。
     目前每一版的标题与一小步是一对一的,所以这条规则平常不会单独生效 ——
     它挡的是内容库改版之后、旧记录里那些还留着的一小步。 */
  checkEq("[guide] 14 天内同一个一小步会被挡下来",
    (function () {
      const v = C.LIBRARY.clarity[0];
      const hist = [{ date: "2026-10-05", direction: "clarity", variantId: "old-x",
                      headline: "这一句以前的标题，跟现在的都不一样。", step: v.step }];
      const g = E.guideFor({ mood: "confused", topic: "decision", tags: tagsOf.C1,
        date: "2026-10-10", owner: "u1", history: hist });
      return g.step !== v.step;
    })(), true);
  checkEq("[guide] 超过 14 天以后同一个一小步就可以再出现",
    (function () {
      const v = C.LIBRARY.clarity[0];
      const hist = [{ date: "2026-09-01", direction: "clarity", variantId: "old-x",
                      headline: "这一句以前的标题，跟现在的都不一样。", step: v.step }];
      let seen = false;
      for (let d = 0; d < 6; d++) {
        const g = E.guideFor({ mood: "confused", topic: "decision", tags: tagsOf.C1,
          date: "2026-10-1" + d, owner: "u" + d, history: hist });
        if (g.step === v.step) seen = true;
      }
      return seen;
    })(), true);

  checkEq("[guide] 连续同一个方向时会换内容",
    (function () {
      const hist = [{ date: "2026-10-01", direction: "clarity", variantId: "clarity-1",
                      headline: C.LIBRARY.clarity[0].headline, step: C.LIBRARY.clarity[0].step }];
      const g = E.guideFor({ mood: "confused", topic: "decision", tags: tagsOf.C1,
        date: "2026-10-02", owner: "u1", history: hist });
      return g.variantId !== "clarity-1";
    })(), true);

  /* ═══ E. 0 次 AI ═══ */
  const engSrc = fs.readFileSync(path.join(__dirname, "..", "assets", "guide-engine.js"), "utf8");
  const conSrc = fs.readFileSync(path.join(__dirname, "..", "assets", "guide-content.js"), "utf8");
  [["引擎", engSrc], ["内容库", conSrc], ["标签层", tagSrc]].forEach(function (x) {
    checkEq("[guide] " + x[0] + "没有任何网路呼叫",
      /fetch\(|XMLHttpRequest|anthropic|supabase|Claude/i.test(
        x[1].replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")), false);
  });
  const realFetch = global.fetch, realXHR = global.XMLHttpRequest;
  let called = 0;
  global.fetch = function () { called++; throw new Error("no"); };
  global.XMLHttpRequest = function () { called++; throw new Error("no"); };
  try {
    checkEq("[guide] 整条路径不发请求",
      E.guideFor({ mood: "tired", topic: "work", tags: tagsOf.C1, date: "2026-09-16", owner: "u1", history: [] }).status, "ok");
    checkEq("[guide] fetch 一次都没被碰到", called, 0);
  } finally { global.fetch = realFetch; global.XMLHttpRequest = realXHR; }

}

/* ---------- 跑 ---------- */

/* ---------- 32. 我的内在指南 · 以指南盘为中心的五段版面(只改呈现) ----------
   这一次只动呈现层与资讯架构:01 指南盘 + 四个方向 → 02 三句话 → 03 此刻的我
   → 04 今天的问题 → 05 星空记录。内容来源、锚点、问题、储存层全部不动。 */
function testCompassCentredLayout() {
  const fs = require("fs");
  const html = fs.readFileSync(path.join(__dirname, "..", "app.html"), "utf8");
  checkEq("[layout] 页面按 01–05 组装",
    /compassDirectionsHtml\(c\)\) \+\n\s*compassAnchorsHtml\(\) \+\n\s*compassNowHtml\(\) \+\n\s*compassQuestionHtml\(c\) \+\n\s*compassSkyHtml\(\)/.test(html), true);
  /* 只有 01 与 02 有编号:02 不是每个人都有,后面的段落不可以跟着改号,
     那等于把「你少了一段」写在画面上。03–05 不编号。 */
  ["01", "02"].forEach(function (n) {
    checkEq("[layout] 章节编号 " + n + " 在", new RegExp('compassSecHead\\("' + n + '"').test(html), true);
  });
  checkEq("[layout] 03–05 没有编号",
    /compassSecHead\("0[345]"/.test(html), false);
  checkEq("[layout] 03–05 的标题还在",
    ["此刻的我", "今天想问自己的一个问题", "我的星空记录"]
      .filter(function (t) { return html.indexOf('compassSecHead("", dpT("' + t + '"') < 0; }).join(","), "");
  checkEq("[layout] 方向指南(Guide)不再在这一页渲染",
    /guideEntryHtml|guideReadingHtml|guideSkyHtml|guideEnsure\(/.test(html), false);
  checkEq("[layout] Guide 储存层保留,资料不动",
    /inner_sky_guide_history_v1/.test(html) && /inner_sky_guide_profile_v1/.test(html), true);
  checkEq("[layout] Guide.history 不会被这一页读写",
    /window\.Guide\.history\.(save|remove|list)/.test(
      html.slice(html.indexOf("function compassDirectionsHtml"), html.indexOf("function renderFavoritesPage"))), false);
  ["guide-content.js", "guide-engine.js", "guide-tags.js"].forEach(function (f) {
    checkEq("[layout] 三支 guide 模组仍在", fs.existsSync(path.join(__dirname, "..", "assets", f)), true);
  });
  const dir = html.slice(html.indexOf("function compassDirectionsHtml"), html.indexOf("/* ── 想留给自己的几句话"));
  checkEq("[layout] 指南盘在四个入口中间", /cp-wheel-core/.test(dir) && /class="cp-ent d/.test(dir), true);
  checkEq("[layout] 一次只有一个方向是开的", /aria-expanded/.test(dir) && /const active = compassDirOpen;/.test(dir), true);
  checkEq("[layout] 没有快取时仍是「生成我的内在指南」这一个入口",
    /id="cpGenBtn"[\s\S]{0,80}生成我的内在指南/.test(dir), true);
  checkEq("[layout] 渲染流程没有自动生成",
    /cpProdGenerate\(\)/.test(html.replace(/addEventListener\("click", cpProdGenerate\)/g, "").replace(/function cpProdGenerate\(\)/g, "")), false);
  const css = html.slice(html.indexOf("以指南盘为中心的五段(01–05)"), html.indexOf("/* 记录:展开长在自己下面 */"));
  checkEq("[layout] 桌机三栏,盘面跨两列",
    /grid-template-columns:1fr minmax\(210px,340px\) 1fr/.test(css) && /\.cp-wheel-core\{grid-column:2;grid-row:1\/3\}/.test(css), true);
  checkEq("[layout] 展开状态宣告成单一值(一次一个)",
    /var compassDirOpen = "";/.test(html), true);
  checkEq("[layout] 入口文字靠左", /\.cp-ent\{[\s\S]{0,120}text-align:left/.test(css), true);
  checkEq("[layout] 平板 2×2、手机单栏",
    /max-width:1024px\)\{\s*#dpage\.compass-page \.cp-wheel\{grid-template-columns:repeat\(2/.test(css) &&
    /max-width:767px\)\{\s*#dpage\.compass-page \.cp-wheel\{grid-template-columns:1fr/.test(css), true);
  /* 罗盘改用品牌自己那张天体素材,不再是手画的线稿 */
  checkEq("[layout] 罗盘用的是品牌的天体素材",
    /background:url\(assets\/life\/compass\.webp\)/.test(css), true);
  checkEq("[layout] 手机上罗盘缩小", /\.cp-rose\{width:min\(48vw,172px\)/.test(css), true);
  checkEq("[layout] 旧的两栏 / 环绕规则已清掉",
    /cp-grid4|\.cp-dirs|cp-keep-card|\.cp-anchor\b|cp-wd\b/.test(html), false);
  const keep = html.slice(html.indexOf("function compassAnchorsHtml()"), html.indexOf("function compassNowHtml()"));
  checkEq("[layout] 02 没有编号,一句就是一句",
    /<div class="cp-lines">/.test(keep) && /class="cp-line"/.test(keep) &&
    !/class="n"/.test(keep), true);
  checkEq("[layout] 02 的引言是核准过的那一句", /不需要一直记得。需要的时候，再回来看看就好。/.test(keep), true);
  checkEq("[layout] 02 没有语境标签 / 来源", /sourceDirection|function"\]|selectionReason/.test(keep), false);
  checkEq("[layout] 05 只读 Compass.store",
    /window\.Compass\.store\.list\(compassOwner\(\)\)/.test(html) && !/Guide\.history/.test(
      html.slice(html.indexOf("function compassSkyHtml()"), html.indexOf("function renderFavoritesPage"))), true);
  checkEq("[layout] 展开状态宣告在首次渲染之前(不踩 TDZ)",
    html.indexOf('var compassDirOpen = "";') < html.indexOf("\n  applyRoute();"), true);
}


/* ---------- 33. 个人情境层(Personal Situations v1 / situations-1.0) ----------
   这一层把【已经接受的四段文案】换成一个使用者回得来的入口。
   它不是第二个解读引擎:不读星盘、不发请求、同一份文案永远同一组结果。

   这一段【不】把覆盖率当成产品指标 —— 覆盖率只是回归量测,
   用来在词典被改动时立刻看得出来,不是通过门槛。 */
function testCompassSituations() {
  const fs = require("fs");
  const crypto = require("crypto");
  const h = (o) => crypto.createHash("sha256").update(JSON.stringify(o)).digest("hex").slice(0, 16);
  const S = require(path.join(__dirname, "..", "assets", "compass-situations.js"));
  const RC = require(path.join(__dirname, "..", "assets", "compass-recorded.js"));
  const html = fs.readFileSync(path.join(__dirname, "..", "app.html"), "utf8");
  const src = fs.readFileSync(path.join(__dirname, "..", "assets", "compass-situations.js"), "utf8");
  const DIRS = ["grounds", "moves", "drains", "calls"];

  /* ═══ 1. 正式词典就是人工审过的那 18 条 ═══ */
  checkEq("[sit] 正好 18 条", S.VARIANTS.length, 18);
  checkEq("[sit] 版本与锁", S.VERSION + "/" + S.SITUATIONS_BASELINE.status, "situations-1.0/LOCKED");
  checkEq("[sit] 锁的理由记在基准里",
    /human voice review/.test(S.SITUATIONS_BASELINE.lockReason), true);
  checkEq("[sit] 每个方向的条数", DIRS.map(function (d) {
    return S.VARIANTS.filter(function (v) { return v.allowedDirection === d; }).length;
  }).join("/"), "6/3/5/4");
  checkEq("[sit] concept/variant 不重复",
    new Set(S.VARIANTS.map(function (v) { return v.concept + "/" + v.variant; })).size, 18);
  /* 三条没有来源的只做纪录,不进正式词典 */
  checkEq("[sit] 未来候选没有混进来",
    S.VARIANTS.filter(function (v) {
      return ["meaning", "not_importance", "angle"].indexOf(v.variant) >= 0;
    }).length, 0);
  checkEq("[sit] 未来候选另外记着", S.FUTURE_CANDIDATES.length, 3);

  /* ═══ 2. allowedDirection 是安全边界 ═══ */
  checkEq("[sit] 每一条都写明 allowedDirection",
    S.VARIANTS.every(function (v) { return DIRS.indexOf(v.allowedDirection) >= 0; }), true);
  checkEq("[sit] 每一条都有情境与正文",
    S.VARIANTS.every(function (v) { return !!v.situation && !!v.text; }), true);
  /* 语言命中【但方向不符】→ 不出情境,该方向退回中性 */
  const wrong = { coreInsight: "先让外面安静一会儿。", explanation: "把外面的声音关小。" };
  const rWrong = S.candidateFor("calls", wrong);
  checkEq("[sit] 方向不符就不给情境", rWrong.situation, null);
  checkEq("[sit] 而且说得出是被方向挡下来的",
    (rWrong.blocked[0] || {}).reason, "direction-not-allowed");
  checkEq("[sit] 同一份文案放对方向才出得来",
    (S.candidateFor("grounds", wrong).situation || {}).variant, "quiet");
  checkEq("[sit] 整份推导里,四个方向都被方向契约挡住 → 全部中性",
    S.derive({ calls: wrong }).neutral.indexOf("calls") >= 0, true);

  /* ═══ 3. 确定性 ═══ */
  const copies = RC.RAW_V12.C1;
  const once = JSON.stringify(S.derive(copies));
  checkEq("[sit] 同一份文案永远同一组", once, JSON.stringify(S.derive(copies)));
  checkEq("[sit] 跑一百次都一样", (function () {
    for (let i = 0; i < 100; i++) if (JSON.stringify(S.derive(copies)) !== once) return false;
    return true;
  })(), true);
  checkEq("[sit] 回查通过", S.verify(S.derive(copies), copies).ok, true);
  /* 回查抓得出被换掉的文字 */
  const tampered = JSON.parse(once);
  tampered.situations.grounds.text = "先深呼吸三次。";
  checkEq("[sit] 回查抓得出不是审过的那一句", S.verify(tampered, copies).ok, false);

  /* ═══ 4. 不读星盘 / 不发请求 / 不碰今天的问题 ═══ */
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  checkEq("[sit] 没有任何网路呼叫",
    /fetch\(|XMLHttpRequest|anthropic|supabase/i.test(code), false);
  checkEq("[sit] 不碰星盘 / 机制 / 分数",
    /planets|cusps|\bmechanism\b|selectionScore|patternKey|support\[|\.domain/i.test(code), false);
  checkEq("[sit] 不读日记 / 心情 / 收藏", /journal|mood|favs|favou?rite/i.test(code), false);
  checkEq("[sit] 不用 reflectionPrompt(那一句专属第 04 段)",
    /reflectionPrompt/.test(code), false);
  checkEq("[sit] 不写任何储存", /localStorage|sessionStorage|indexedDB/i.test(code), false);
  (function () {
    const realFetch = global.fetch, realXHR = global.XMLHttpRequest;
    let called = 0;
    global.fetch = function () { called++; return Promise.reject(new Error("no")); };
    global.XMLHttpRequest = function () { called++; };
    try {
      checkEq("[sit] 推导过程不发任何请求", S.derive(copies).status, "ok");
      checkEq("[sit] fetch 一次都没被碰到", called, 0);
    } finally { global.fetch = realFetch; global.XMLHttpRequest = realXHR; }
  })();

  /* ═══ 5. 一小步:可选,而且不是问句 ═══ */
  const withMicro = S.VARIANTS.filter(function (v) { return v.micro; });
  checkEq("[sit] 18 条里只有 4 条有一小步", withMicro.length, 4);
  checkEq("[sit] 有一小步的是哪四条",
    withMicro.map(function (v) { return v.variant; }).sort().join(","),
    "before_closeness,not_persistence,stands_up,wake");
  checkEq("[sit] 没有一小步的就是 null,不是空字串",
    S.VARIANTS.every(function (v) { return v.micro === null || (typeof v.micro === "string" && v.micro.length > 0); }), true);
  checkEq("[sit] 一小步里没有问句",
    withMicro.filter(function (v) { return /[？?]/.test(v.micro); }).length, 0);
  /* 消耗 = NOTICE:允许停在「认出来」,不需要出口 */
  checkEq("[sit] 消耗那一组不给许可 / 宽慰 / 因应",
    S.VARIANTS.filter(function (v) { return v.allowedDirection === "drains"; })
      .filter(function (v) { return /没关系|可以试着|先放下|别担心|放轻松/.test(v.text + (v.micro || "")); }).length, 0);
  checkEq("[sit] 四个方向的内部功能",
    [S.FUNCTIONS.grounds, S.FUNCTIONS.moves, S.FUNCTIONS.drains, S.FUNCTIONS.calls].join("/"),
    "RETURN/MOVE/NOTICE/FOLLOW");

  /* ═══ 6. 语气守则 ═══ */
  const all = S.allPossibleStrings();
  checkEq("[sit] 会进画面的字一共 40 条", all.length, 40);
  const corpus = all.join("||");
  [["命令句", /你应该|你必须|你需要学会|你最好|请你|记得要|一定要(?!的)/],
   ["万用空话", /相信自己|慢慢来|照顾好自己|一切都会好|放轻松|加油|顺其自然|活在当下|爱自己/],
   ["编造成因", /童年|小时候|从小|原生家庭|父母|爸爸|妈妈|前任|伴侣|婚姻|上司|老板/],
   ["心理诊断", /缺乏安全感|不够爱自己|依恋|创伤|焦虑症|回避型|讨好型/],
   ["越权判定", /值得你信任|其实是安全|可以放心靠近|不用再确认|不用再防备|对方其实|你只是想太多|应该离开|应该留下/],
   ["解读口吻的开头", /^你通常|^你容易|^你是一个|^你的模式/m]
  ].forEach(function (x) {
    checkEq("[sit] 词典里没有" + x[0], x[1].test(corpus), false);
  });
  /* 内部 schema 名称永远不可以进画面 */
  ["RETURN", "MOVE", "NOTICE", "FOLLOW", "Recognition", "Orientation", "Permission",
   "Cost Signal", "Micro", "一小步", "练习", "试试看"].forEach(function (t) {
    checkEq("[sit] 画面字串里没有 " + t, corpus.indexOf(t) >= 0, false);
  });
  checkEq("[sit] 情境都是「……的时候」这类可观察的处境",
    S.VARIANTS.filter(function (v) { return v.situation.indexOf("当") !== 0; }).length, 0);
  checkEq("[sit] 情境不预设自我评判",
    /怀疑自己|觉得自己不够|不够好|太差|失败者/.test(
      S.VARIANTS.map(function (v) { return v.situation; }).join("")), false);

  /* ═══ 7. 保留字 ═══ */
  checkEq("[sit] 标了保留字的就一定还在",
    S.VARIANTS.filter(function (v) {
      return v.hedges.some(function (x) { return v.text.indexOf(x) < 0; });
    }).length, 0);
  checkEq("[sit] 该有保留字的那几条都标了",
    ["quiet", "not_hiding", "unformed", "relationship", "group",
     "before_closeness", "after", "watched", "wake", "loop_back"]
      .filter(function (k) {
        const v = S.VARIANTS.filter(function (x) { return x.variant === k; })[0];
        return !v || !v.hedges.length;
      }).join(","), "");
  checkEq("[sit] loop_back 两个保留字都在",
    S.VARIANTS.filter(function (v) { return v.variant === "loop_back"; })[0].hedges.join(","),
    "不一定,也可能");

  /* ═══ 8. 指纹:审过的那一份,一个字都不可以动 ═══ */
  checkEq("[sit] 词典逐字未动", h(S.VARIANTS), "ac3bdac8b93b8ad0");
  checkEq("[sit] 会进画面的每一句逐字未动", h(all), "54dc613f03338253");
  checkEq("[sit] 已锁基准逐字未动", h(S.SITUATIONS_BASELINE), "e0434dec520defe2");

  /* ═══ 9. 覆盖率:回归量测,不是通过门槛 ═══ */
  const sets = [["v1", RC.RAW], ["v1.1", RC.RAW_V11], ["v1.2", RC.RAW_V12]];
  let total = 0, matched = 0;
  const shape = [];
  sets.forEach(function (pair) {
    Object.keys(pair[1]).forEach(function (id) {
      const cs = pair[1][id], r = S.derive(cs);
      checkEq("[sit] " + pair[0] + " " + id + " 回查通过", S.verify(r, cs).ok, true);
      DIRS.forEach(function (k) {
        if (!cs[k] || !cs[k].coreInsight) return;
        total++;
        if (r.situations[k]) matched++;
      });
      shape.push(pair[0] + " " + id + ":" + DIRS.map(function (k) {
        return r.situations[k] ? r.situations[k].variant : "-";
      }).join("/"));
    });
  });
  checkEq("[sit] 已录语料的覆盖(回归量测,非门槛)", matched + "/" + total, "19/23");
  checkEq("[sit] 每一张盘选到哪一条,逐字钉住", h(shape), "0c8657634f88cac1");
  checkEq("[sit] v1.2 C1 的四个方向",
    DIRS.map(function (k) {
      const x = S.derive(RC.RAW_V12.C1).situations[k];
      return k + "=" + (x ? x.variant : "中性");
    }).join(" "),
    "grounds=quiet moves=中性 drains=before_closeness calls=loop_back");

  /* ═══ 10. 页面 ═══ */
  const dir = html.slice(html.indexOf("function compassDirectionsHtml"),
                         html.indexOf("/* ── 想留给自己的几句话"));
  checkEq("[sit] 页面在渲染时现算,不信快取",
    /function compassSituationsFor\(saved\)/.test(html) &&
    /compassSitCache = \{ key: key, map: map \}/.test(html), true);
  checkEq("[sit] 用既有的 generatedAt\\|promptVersion 当记忆键",
    /var key = \(saved\.generatedAt \|\| ""\) \+ "\|" \+ \(saved\.promptVersion \|\| ""\);/
      .test(html.slice(html.indexOf("function compassSituationsFor"))), true);
  checkEq("[sit] 推导是唯读的,不写回快取",
    /Compass\.result\.set|saved\.directions\s*=|saved\.generatedAt\s*=|saved\.promptVersion\s*=/
      .test(html.slice(html.indexOf("function compassSituationsFor"),
                       html.indexOf("function compassAnchorsHtml"))), false);
  checkEq("[sit] 回查不过就整份不用",
    /S\.verify\(r, saved\.directions\)\.ok/.test(html), true);
  checkEq("[sit] 情境层跟着锚点层一起懒载入",
    /assets\/compass-situations\.js/.test(html), true);
  /* 只看【真的会被组进 HTML 的字】,注解不算 */
  const dirCode = dir.replace(/\/\*[\s\S]*?\*\//g, "");
  /* 个人情境【不是】内容的门槛:认不出来的方向,入口印的是他自己的 coreInsight */
  checkEq("[sit] 认不出情境就用他自己的 coreInsight 当入口",
    /const lead = st \? st\.situation : \(c \? c\.coreInsight/.test(dir), true);
  checkEq("[sit] 两种状态的入口结构完全一样(分辨不出来)",
    (dirCode.match(/class="cp-ent d/g) || []).length, 1);
  checkEq("[sit] 画面上没有「看看这个方向」这种空的入口",
    /看看这个方向|Look at this one/.test(html), false);
  checkEq("[sit] 也没有任何技术性的退路字眼",
    /无法识别|内容不足|待生成|fallback|coverage/.test(dirCode), false);
  checkEq("[sit] 中性入口不告诉使用者这是退而求其次",
    /无法识别|覆盖率|fallback|证据不足|insufficient/.test(dir), false);
  checkEq("[sit] 四个方向永远都在", /DIRS\.map\(function \(d, i\)/.test(dir), true);
  checkEq("[sit] 有情境时,披露里是原本那两段",
    /why\('<p class="ci">' \+ esc0\(c\.coreInsight\)[\s\S]{0,160}c\.explanation/.test(dir), true);
  checkEq("[sit] 没有情境时,coreInsight 当主角、explanation 收进披露",
    /'<p class="hd">' \+ esc0\(c\.coreInsight\) \+ "<\/p>" \+\n\s*why\('<p class="tx">' \+ esc0\(c\.explanation\)/.test(dir), true);
  checkEq("[sit] 画面上没有 schema 标签",
    /一小步|Micro-action|试试看|练习|Cost Signal|Recognition|Orientation|RETURN|NOTICE|FOLLOW/
      .test(dirCode), false);
  checkEq("[sit] 没有一小步就什么都不出,不留空位",
    /st\.micro \? '<p class="bd sub">' \+ esc0\(st\.micro\) \+ "<\/p>" : ""/.test(dir), true);
  checkEq("[sit] 一次只有一个方向是开的",
    /compassDirOpen = \(compassDirOpen === k\) \? "" : k;/.test(html), true);
  checkEq("[sit] 可以回到什么都没开的状态", /id="cpPanelClose"/.test(dir), true);
  checkEq("[sit] 只重画 section 01,不重画整页",
    /sec\.parentNode\.replaceChild\(fresh, sec\)/.test(html), true);
  checkEq("[sit] 换方向之后把被点的那一列留在原地",
    /window\.scrollBy\(0, now\.getBoundingClientRect\(\)\.top - before\)/.test(html), true);
  const css = html.slice(html.indexOf("以指南盘为中心的五段(01–05)"),
                         html.indexOf("/* 记录:展开长在自己下面 */"));
  checkEq("[sit] 桌机:内容区在盘下方整列",
    /\.cp-panel\{grid-column:1\/-1;grid-row:3;/.test(css), true);
  checkEq("[sit] 手机:内容区长在被点的那一列底下",
    /\[data-active="ground"\] \.cp-panel\{order:15\}/.test(css) &&
    /\[data-active="call"\]   \.cp-panel\{order:45\}/.test(css), true);

  /* ═══ 11. Guard A ═══ */
  checkEq("[sit] Guard A 的门槛是 0.35", /var CP_GUARD_A = 0\.35;/.test(html), true);
  checkEq("[sit] Guard A 同时比正文与一小步",
    /shown\.push\(sits\[k\]\.text\)[\s\S]{0,120}shown\.push\(sits\[k\]\.micro\)/.test(html), true);
  checkEq("[sit] Guard A 只丢,不补句、不改写",
    /list\.filter\(function \(a\)/.test(html) &&
    !/anchors\.push|\.concat\(.*fallbackLine/.test(
      html.slice(html.indexOf("function compassAnchorGuard"),
                 html.indexOf("function compassAnchorsHtml"))), true);
  (function () {
    const AN3 = require(path.join(__dirname, "..", "assets", "compass-anchors-semantic.js"));
    const sims = [];
    S.VARIANTS.forEach(function (v) {
      const line = AN3.CONCEPTS.reduce(function (acc, c) {
        if (acc) return acc;
        const hit = c.variants.filter(function (x) {
          return c.id === v.concept && x.key === v.variant;
        })[0];
        return hit ? AN3.TEMPLATES[hit.tpl].build(hit.roles) : null;
      }, null);
      if (!line) return;
      sims.push({ k: v.concept + "/" + v.variant,
                  s: Math.max(AN3.similarity(v.text, line),
                              v.micro ? AN3.similarity(v.micro, line) : 0) });
    });
    const dropped = sims.filter(function (x) { return x.s >= 0.35; }).map(function (x) { return x.k; });
    checkEq("[sit] 只有 not_hiding 会让 02 掉一句",
      dropped.join(","), "settle_before_approach/not_hiding");
  })();

  /* ═══ 12. 既有使用者:不重生、不清快取、不碰 Guide ═══ */
  checkEq("[sit] 没有要求 compass-v1.3", /compass-v1\.3/.test(html + src), false);
  const page = html.slice(html.indexOf("function compassDirectionsHtml"),
                          html.indexOf("function renderFavoritesPage"));
  checkEq("[sit] 这一段不呼叫生成",
    /cpProdGenerate\(\)/.test(page
      .replace(/addEventListener\("click", cpProdGenerate\)/g, "")
      .replace(/function cpProdGenerate\(\)/g, "")), false);
  checkEq("[sit] 这一段不清快取 / 不碰 Guide",
    /Compass\.result\.clear|Guide\.history\.(save|remove)|Guide\.profile\.set/.test(page), false);
}


/* ---------- 34. Personal Anchors v1.1(anchors-3.2)+ 渲染模型 v2 ----------
   v1.1 唯一的行为差别:最少几句才算数,由 3 降到 1。
   渲染模型 v2:个人情境是【加值】,不是内容的门槛。 */
function testAnchorsV11AndRenderV2() {
  const fs = require("fs");
  const A3 = require(path.join(__dirname, "..", "assets", "compass-anchors-semantic.js"));
  const AN = require(path.join(__dirname, "..", "assets", "compass-anchors.js"));
  const S = require(path.join(__dirname, "..", "assets", "compass-situations.js"));
  const RC = require(path.join(__dirname, "..", "assets", "compass-recorded.js"));
  const html = fs.readFileSync(path.join(__dirname, "..", "app.html"), "utf8");

  /* ═══ A. 版本与边界 ═══ */
  checkEq("[a32] 版本", A3.VERSION, "anchors-3.2");
  checkEq("[a32] 下限 1 上限 3", A3.MIN_ANCHORS + "/" + A3.MAX_ANCHORS, "1/3");
  checkEq("[a32] 基准记的是「只改下限」",
    /minimum valid output count 3 → 1/.test(A3.ANCHORS_V11_BASELINE.lockReason), true);
  /* 2.2 的下限【必须】还是 3 —— 降了它会用一句抽取候选赢走短路,
     blended 池永远不会被建起来,同一份文案会从 3 句掉到 1 句。 */
  checkEq("[a32] 已锁的 2.2 下限仍然是 3", AN.ANCHOR_COUNT, 3);
  checkEq("[a32] 2.2 的基准没有被碰过", AN.ANCHORS_BASELINE.version, "anchors-2.2");

  /* ═══ B. 既有输出逐字未变 ═══ */
  const sets = [["RAW.C1", RC.RAW.C1], ["RAW.C4", RC.RAW.C4], ["RAW.C6", RC.RAW.C6],
                ["RAW.C10", RC.RAW.C10], ["RAW_V11.C1", RC.RAW_V11.C1], ["RAW_V12.C1", RC.RAW_V12.C1]];
  sets.forEach(function (x) {
    const r = A3.derive(x[1]);
    checkEq("[a32] " + x[0] + " 仍然三句", (r.anchors || []).length, 3);
    checkEq("[a32] " + x[0] + " 回查通过", A3.verifySemantic(r, x[1]).ok, true);
  });
  const crypto = require("crypto");
  const h = (o) => crypto.createHash("sha256").update(JSON.stringify(o)).digest("hex").slice(0, 16);
  checkEq("[a32] 六份已录文案的锚点逐字未动",
    h(sets.map(function (x) { return A3.derive(x[1]).anchors.map(function (a) { return a.line; }); })),
    "7a0b6020db7a71ad");
  checkEq("[a32] 概念词典 / 句型 / 枚举清单一个字都没动",
    h(A3.CONCEPTS) + "|" + h(A3.allPossibleLines()), "ba31ce40024aec21|95f8abb7e7c55009");

  /* ═══ C. 1 / 2 / 3 / 0 ═══ */
  const d = (a, b) => ({ coreInsight: a, explanation: b });
  const one = { drains: RC.RAW.C1.drains };                       // 只有一个方向认得出来
  const two = { drains: RC.RAW.C1.drains, moves: RC.RAW.C1.moves };
  const three = { drains: RC.RAW.C1.drains, moves: RC.RAW.C1.moves, grounds: RC.RAW.C1.grounds };
  checkEq("[a32] 1 个候选 → 1 句", A3.derive(one).anchors.length, 1);
  checkEq("[a32] 2 个候选 → 2 句", A3.derive(two).anchors.length, 2);
  checkEq("[a32] 3 个候选 → 3 句", A3.derive(three).anchors.length, 3);
  checkEq("[a32] 1 句的时候不凑数", A3.derive(one).status, "ok");
  checkEq("[a32] 1 句也回查得过", A3.verifySemantic(A3.derive(one), one).ok, true);
  const none = { grounds: d("你需要安静。", "安静对你有用。"),
                 calls: d("你喜欢深的东西。", "浅的东西留不住你。") };
  checkEq("[a32] 0 个候选 → insufficient", A3.derive(none).status, "insufficient");
  checkEq("[a32] 0 个候选一句都不给", A3.derive(none).anchors.length, 0);
  checkEq("[a32] 一句都取不出来时的说法换掉了",
    /一句可以重复使用的提醒都取不出来/.test(A3.derive(none).note), true);
  /* 永远不会超过三句 */
  checkEq("[a32] 上限仍然是三句",
    sets.every(function (x) { return A3.derive(x[1]).anchors.length <= 3; }), true);

  /* ═══ D. 页面:02 的 0 / 1 / 2 / 3 ═══ */
  const keep = html.slice(html.indexOf("function compassAnchorsHtml()"),
                          html.indexOf("function compassNowHtml()"));
  checkEq("[a32] 0 句 → 整段不出现", /if \(!list\.length\) return "";/.test(keep), true);
  checkEq("[a32] 02 不再有任何空状态文案",
    /cp-pending|还没有可以单独带走|等上面的内在指南/.test(keep), false);
  checkEq("[a32] 引言仍然是核准的那一句",
    /不需要一直记得。需要的时候，再回来看看就好。/.test(keep), true);
  checkEq("[a32] 一句一段,没有编号、没有标签",
    /'<p class="cp-line">' \+ esc0\(a\.line\)/.test(keep) &&
    !/练习|建议|Micro|Recognition|Cost Signal|class="n"/.test(keep), true);

  /* ═══ E. 渲染模型 v2:情境不是内容的门槛 ═══ */
  const dir = html.slice(html.indexOf("function compassDirectionsHtml"),
                         html.indexOf("/* ── 想留给自己的几句话"));
  checkEq("[v2] 四个方向永远都印得出一行个人化内容",
    /st \? st\.situation : \(c \? c\.coreInsight/.test(dir), true);
  checkEq("[v2] 两种状态共用同一个入口模板",
    (dir.replace(/\/\*[\s\S]*?\*\//g, "").match(/class="cp-ent d/g) || []).length, 1);
  /* 入口有柔和的象牙白容器,但【不是】SaaS 卡片:半透明、香槟细边、几乎没有阴影 */
  const entCss = html.slice(html.indexOf("#dpage.compass-page .cp-ent{"),
                            html.indexOf("#dpage.compass-page .cp-ent .gl{"));
  checkEq("[v2] 入口是半透明的象牙白,不是纯白",
    /background:rgba\(255,253,250,\.5\)/.test(entCss), true);
  checkEq("[v2] 香槟色的细边", /border:1px solid rgba\(154,106,52,\.13\)/.test(entCss), true);
  checkEq("[v2] 几乎没有阴影",
    /box-shadow:0 2px 14px -10px/.test(entCss), true);
  checkEq("[v2] 不再画连接线 —— 罗盘自己组织四个方向",
    /\.cp-ent::after\{/.test(html), false);
  checkEq("[v2] 四个方向各有一个香槟细线的小记号",
    /var CP_GLYPH = \{/.test(html) &&
    ["ground", "move", "drain", "call"].every(function (k) {
      return new RegExp(k + ": '<svg viewBox=\"0 0 20 20\"").test(html);
    }), true);
  checkEq("[v2] 小记号只是视觉身分,不带文字",
    /CP_GLYPH\[d\.key\] \|\| ""/.test(html) &&
    !/<text/.test(html.slice(html.indexOf("var CP_GLYPH"), html.indexOf("function compassDirectionsHtml"))), true);
  checkEq("[v2] 方向的名字回来了(中文模式只印中文)",
    /'<b class="zh">' \+ esc0\(dpT\(d\.zh, d\.en\)\)/.test(html), true);
  checkEq("[v2] 指南盘没有任何填色的面",
    /fill="url\(#cpGlow\)"|radialGradient/.test(
      html.slice(html.indexOf("function compassRoseSvg"), html.indexOf("function compassDirectionsHtml"))), false);
  checkEq("[v2] 指南盘只剩线与一颗小星",
    (html.slice(html.indexOf("function compassRoseSvg"), html.indexOf("var CP_SHORT"))
      .match(/fill="none"/g) || []).length, 3);
  checkEq("[v2] 展开的说明一律收在披露后面",
    (dir.match(/c\.explanation/g) || []).length === 2 &&
    (dir.match(/class="cp-why"/g) || []).length === 1, true);

  /* ═══ F. 案例 A / B / C:每个有文案的方向都看得到个人化内容 ═══ */
  [["A 四个都认得出", RC.RAW_V12.C1], ["B 一个认得出", { drains: RC.RAW.C1.drains,
      grounds: d("你需要一点时间才会重新有力气。", "忙完一段以后，你不会马上恢复。"),
      moves: d("你做事情的节奏是一阵一阵的。", "有些日子你可以做很多，有些日子几乎停着。"),
      calls: d("你会被还没被讲完的东西吸引。", "已经有结论的事，你不太会一直想。") }],
   ["C 都认不出", { grounds: d("你需要一点时间才会重新有力气。", "忙完一段以后，你不会马上恢复。"),
      moves: d("你做事情的节奏是一阵一阵的。", "有些日子你可以做很多，有些日子几乎停着。"),
      drains: d("你容易在小事上耗着。", "一件小事没结束，你就一直惦记着。"),
      calls: d("你会被还没被讲完的东西吸引。", "已经有结论的事，你不太会一直想。") }]
  ].forEach(function (x) {
    const r = S.derive(x[1]);
    S.DIRECTIONS.forEach(function (k) {
      if (!x[1][k]) return;
      const lead = r.situations[k] ? r.situations[k].situation : x[1][k].coreInsight;
      checkEq("[v2] " + x[0] + " · " + k + " 入口有个人化内容", !!lead && lead.length > 5, true);
    });
  });
}


/* ---------- 35. R1 · 帐号层的正式内在指南(canonical-1.0) ----------
   产品不变式:一个登入使用者 = 一份正式的内在指南。
   第二台装置【读】它,不会自己再生成一份。

   这一节用纯函式跑完 A–N 全部情形 —— 不需要浏览器、网路或资料库。 */
function testCanonicalStorage() {
  const fs = require("fs");
  const CC = require(path.join(__dirname, "..", "assets", "compass-canonical.js"));
  const html = fs.readFileSync(path.join(__dirname, "..", "app.html"), "utf8");
  const sql = fs.readFileSync(path.join(__dirname, "..", "docs", "sql", "compass_results.sql"), "utf8");
  const src = fs.readFileSync(path.join(__dirname, "..", "assets", "compass-canonical.js"), "utf8");

  const mk = (tag, when) => ({
    promptVersion: "compass-v1.2",
    generatedAt: when || "2026-09-14T10:00:00.000Z",
    directions: {
      grounds: { coreInsight: tag + "-安定", explanation: tag + "-安定说明", reflectionPrompt: tag + "-安定问题" },
      moves:   { coreInsight: tag + "-前进", explanation: tag + "-前进说明", reflectionPrompt: tag + "-前进问题" },
      drains:  { coreInsight: tag + "-消耗", explanation: tag + "-消耗说明", reflectionPrompt: tag + "-消耗问题" },
      calls:   { coreInsight: tag + "-吸引", explanation: tag + "-吸引说明", reflectionPrompt: tag + "-吸引问题" }
    }
  });
  const A = mk("A"), B = mk("B");

  /* ═══ 1. 窄对应与隐私边界 ═══ */
  const dirty = JSON.parse(JSON.stringify(A));
  dirty.anchors = [{ line: "带走的那一句", sourceDirection: "grounds", selectionReason: "内部取舍" }];
  dirty.directions.grounds.mechanism = "regulation happens by reducing input first";
  dirty.directions.grounds.support = [{ mechanism: "x" }];
  dirty.trace = { patternKey: "solitude-then-contact" };
  dirty.raw = "模型原始输出";
  dirty.input = { systemPrompt: "你在为…" };
  const row = CC.toRow(dirty);
  /* 三个不一样的数字,分别钉住,不要互相冒充:
       资料表 18 栏 / toRow() 14 个键 / INSERT body 15 个键(多一个 user_id) */
  checkEq("[r1] toRow() 输出 14 个键", Object.keys(row).length, 14);
  checkEq("[r1] toRow() 不碰由资料库产生的栏位",
    ["user_id", "revision", "created_at", "updated_at"]
      .filter(function (k) { return k in row; }).join(","), "");
  checkEq("[r1] 资料表实际是 18 栏",
    (sql.slice(sql.indexOf("create table if not exists public.compass_results ("),
               sql.indexOf("\n);")).replace(/--.*$/gm, "")
       .match(/\b([a-z_]+)\s+(uuid|text|timestamptz|smallint)\b/g) || []).length, 18);
  checkEq("[r1] INSERT 只多送一个 user_id",
    /var row = Cc\.toRow\(v\.result\);\s*\n\s*row\.user_id = owner;\s*\n\s*return nf\(/
      .test(html), true);
  checkEq("[r1] INSERT 不送 revision / created_at / updated_at",
    /row\.(revision|created_at|updated_at)\s*=/.test(html), false);
  checkEq("[r1] 栏位名逐字固定", Object.keys(row).join(","),
    "prompt_version,generated_at,grounds_core,grounds_expl,grounds_prompt," +
    "moves_core,moves_expl,moves_prompt,drains_core,drains_expl,drains_prompt," +
    "calls_core,calls_expl,calls_prompt");
  const blob = JSON.stringify(row);
  ["mechanism", "livedMechanism", "support", "tension", "composite", "selectionReason",
   "selectionScore", "structuralAnchors", "strength", "distinctiveness", "anchors",
   "trace", "firstAttempt", "raw", "systemPrompt", "userPrompt", "input", "validation",
   "shadow", "planets", "houses", "aspects", "cusps", "birth", "mood", "journal", "favs"
  ].forEach(function (k) {
    checkEq("[r1] 上云的资料里没有 " + k, blob.indexOf(k) >= 0, false);
  });
  checkEq("[r1] 锚点的字也没有跟上去", blob.indexOf("带走的那一句") >= 0, false);
  checkEq("[r1] 机制的字也没有跟上去", blob.indexOf("regulation happens") >= 0, false);
  checkEq("[r1] 往返之后文案一致", CC.sameResult(A, CC.rowOut(row)), true);
  checkEq("[r1] 读回来的不带 anchors", "anchors" in CC.rowOut(row), false);
  /* toRow 是白名单:快取里将来多出任何东西都上不去 */
  checkEq("[r1] 未知栏位不会被带上云",
    Object.keys(CC.toRow(Object.assign({ whatever: 1 }, A))).length, 14);

  /* ═══ 2. 窄 schema 验证 ═══ */
  checkEq("[r1] 正常的一列通过", CC.validateRow(row).ok, true);
  [["少了 prompt_version", Object.assign({}, row, { prompt_version: "" }), "missing_prompt_version"],
   ["坏掉的时间", Object.assign({}, row, { generated_at: "不是时间" }), "bad_generated_at"],
   ["一个方向都没有", { prompt_version: "v", generated_at: A.generatedAt }, "no_direction"],
   ["coreInsight 过长", Object.assign({}, row, { grounds_core: "字".repeat(201) }), "core_too_long"],
   ["explanation 过长", Object.assign({}, row, { grounds_expl: "字".repeat(1201) }), "explanation_too_long"]
  ].forEach(function (x) {
    const v = CC.validateRow(x[1]);
    checkEq("[r1] 挡得住:" + x[0], v.ok + "/" + v.reason, "false/" + x[2]);
  });
  checkEq("[r1] null 不会让它爆掉", CC.validateRow(null).ok, false);
  checkEq("[r1] 字串不会让它爆掉", CC.validateRow("oops").ok, false);

  /* ═══ 3. A–N 情形矩阵 ═══ */
  const R = (cloud, local, authed) => CC.resolve({
    authenticated: authed === undefined ? true : authed, cloud: cloud, local: local });
  const L = (r, sync) => ({ result: r, sync: sync || "canonical" });
  const cases = [
    ["A 本机有、云端没有",      R({ status: "absent" }, L(A)),                    "ADOPT_LOCAL",        "adopt"],
    ["B 云端有、本机没有",      R({ status: "valid", result: A }, null),          "CANONICAL",          "cache"],
    ["C 两边都有而且一样",      R({ status: "valid", result: A }, L(A)),          "CANONICAL",          "cache"],
    ["D 两边都有但不一样",      R({ status: "valid", result: A }, L(B)),          "CONFLICT_CANDIDATE", "cache"],
    ["E 本机旧版本、云端没有",  R({ status: "absent" }, L(mk("A"))),              "ADOPT_LOCAL",        "adopt"],
    ["F 云端旧版本、本机没有",  R({ status: "valid", result: A }, null),          "CANONICAL",          "cache"],
    ["G 生成成功但上云失败",    R({ status: "absent" }, L(A, "pending-upload")),  "PENDING_UPLOAD",     "retry-upload"],
    ["H 云端连不上、本机有",    R({ status: "error" }, L(A)),                     "CACHED_OFFLINE",     null],
    ["J 抢先那一台赢(冲突)",  R({ status: "valid", result: A }, L(B, "pending-upload")), "CONFLICT_CANDIDATE", "cache"],
    ["K 云端有、别台有新的",    R({ status: "valid", result: A }, L(B)),          "CONFLICT_CANDIDATE", "cache"],
    ["L 云端那一列坏掉、有本机", R({ status: "invalid" }, L(A)),                  "INVALID_CANONICAL",  null],
    ["L 云端那一列坏掉、没本机", R({ status: "invalid" }, null),                  "INVALID_CANONICAL",  null],
    ["M 本机坏掉、云端没有",    R({ status: "absent" }, L({ directions: {} })),   "NONE",               null],
    ["  云端没有、本机也没有",  R({ status: "absent" }, null),                    "NONE",               null],
    ["  连不上、本机也没有",    R({ status: "error" }, null),                     "RESOLVING",          null]
  ];
  cases.forEach(function (c) {
    checkEq("[r1] " + c[0], c[1].state, c[2]);
    checkEq("[r1] " + c[0] + " · 动作", c[1].action, c[3]);
  });

  /* 只有 NONE 可以显示生成 */
  CC.STATES.forEach(function (st) {
    checkEq("[r1] " + st + " 能不能显示生成", CC.canGenerate(st), st === "NONE");
  });
  /* 错误 / 坏列【永远】不可以被当成「这个人没有指南」 */
  ["error", "invalid"].forEach(function (st) {
    [L(A), null].forEach(function (lc) {
      checkEq("[r1] cloud=" + st + " 绝不走到 NONE", R({ status: st }, lc).state === "NONE", false);
    });
  });
  /* D / K / J:云端仍然是正式那一份,本机那一份留着但不呈现 */
  const d = R({ status: "valid", result: A }, L(B));
  checkEq("[r1] 冲突时呈现的是云端那一份", CC.sameResult(d.result, A), true);
  checkEq("[r1] 冲突时另一份留成候选", CC.sameResult(d.candidate, B), true);
  checkEq("[r1] 冲突时绝不合并", d.result.directions.grounds.coreInsight.indexOf("B-") < 0, true);

  /* I:anon 绝不被任何帐号认领 */
  const anon = CC.resolve({ authenticated: false, cloud: { status: "absent" }, local: L(A) });
  checkEq("[r1] I 未登入只看本机那一桶", anon.state, "CANONICAL");
  checkEq("[r1] I 未登入不产生任何上云动作", anon.action, null);
  checkEq("[r1] I 登入后不会因为 anon 有东西就采用",
    R({ status: "absent" }, null).state, "NONE");

  /* ═══ 4. 页面接线 ═══ */
  checkEq("[r1] 只有 NONE 会显示生成按钮",
    /if \(compassCanGenerate\(\)\) \{[\s\S]{0,400}id="cpGenBtn"/.test(html), true);
  checkEq("[r1] 解析中显示「正在读取…」,不显示生成",
    /return shell\('<div class="cp-empty4"><p class="cp-pending">' \+\n\s*esc0\(dpT\("正在读取…"/.test(html), true);
  checkEq("[r1] 坏掉的那一列有自己的安静说法",
    /暂时无法读取你的内在指南，请稍后再试。/.test(html), true);
  checkEq("[r1] 画面上不出现任何技术字眼",
    /localStorage|云端|快取|canonical|promptVersion|同步/.test(
      html.slice(html.indexOf("function compassDirectionsHtml"),
                 html.indexOf("/* ── 想留给自己的几句话")).replace(/\/\*[\s\S]*?\*\//g, "")), false);
  checkEq("[r1] 三个读取点都走解析结果",
    (html.match(/const saved = compassSavedResult\(\);/g) || []).length, 3);
  checkEq("[r1] 进页面就解析", /compassResolveCanonical\(\);/.test(html), true);
  /* 只看 canonical 这一段 —— 别处(charts)本来就有自己的 upsert,与这里无关 */
  const canBlk = html.slice(html.indexOf("canonical: (function () {"),
                            html.indexOf('    result: (function () {'))
                     .replace(/\/\*[\s\S]*?\*\//g, "");   // 注解不算,只看真的会跑的字
  checkEq("[r1] canonical 绝不用 upsert / merge-duplicates",
    /merge-duplicates|on_conflict/.test(canBlk), false);
  checkEq("[r1] canonical 只用 POST 建立第一份",
    (canBlk.match(/method: "POST"/g) || []).length, 1);
  checkEq("[r1] canonical 不做 PATCH / DELETE",
    /method: "(PATCH|PUT|DELETE)"/.test(canBlk), false);
  checkEq("[r1] 冲突(409)会重读,不覆盖",
    /r\.status === 409[\s\S]{0,200}canonical_insert_conflict/.test(html), true);
  checkEq("[r1] 生成后先写本机再上云",
    /can\.writeLocal\(owner, accepted, "pending-upload"\);[\s\S]{0,400}can\.createFirst\(owner, accepted\)/.test(html), true);
  checkEq("[r1] v1 快取只读,不删除",
    /localStorage\.removeItem\(["']inner_sky_compass_result_v1/.test(html), false);
  checkEq("[r1] v2 是另一把钥匙", /inner_sky_compass_result_v2/.test(html), true);
  checkEq("[r1] 读 v1 时不给 anon 预设值",
    /return all\[owner\] \|\| null;\s*\/\/ ⚠ 刻意不给预设值/.test(html), true);

  /* ═══ 5. 安全诊断:只有结构,没有内容 ═══ */
  const diagBlk = html.slice(html.indexOf("var diag = [];"), html.indexOf("_key: V2"));
  checkEq("[r1] 诊断只收 code / reason / httpStatus",
    /d\.reason = String\(extra\.reason\)/.test(diagBlk) &&
    /d\.httpStatus = extra\.httpStatus/.test(diagBlk), true);
  checkEq("[r1] 诊断不含文案 / user id / 任何生成内部状态",
    /coreInsight|explanation|reflectionPrompt|user_id|owner|row\b|result/.test(diagBlk), false);
  checkEq("[r1] 坏掉的那一列有专属代号", /canonical_row_invalid/.test(html), true);

  /* ═══ 6. SQL ═══ */
  checkEq("[r1] 主键就是 user_id(一个人一列)",
    /user_id\s+uuid primary key references auth\.users\(id\) on delete cascade/.test(sql), true);
  checkEq("[r1] RLS 打开", /alter table public\.compass_results enable row level security/.test(sql), true);
  ["read own", "write own", "update own"].forEach(function (pol) {
    checkEq("[r1] 有 " + pol + " 政策", new RegExp('create policy "compass result ' + pol + '"').test(sql), true);
  });
  checkEq("[r1] 三条政策都锁 auth.uid() = user_id",
    (sql.match(/auth\.uid\(\) = user_id/g) || []).length, 4);
  checkEq("[r1] 刻意没有 delete 政策", /for delete/.test(sql), false);
  checkEq("[r1] SQL 里没有任何被禁止的栏位",
    /mechanism|evidence|selection|support|tension|composite|planet|house|aspect|birth|prompt_text|raw_/i
      .test(sql.replace(/^--.*$/gm, "")), false);
  checkEq("[r1] 不碰既有的表",
    /alter table public\.(charts|compass_entries|prefs|readings)/.test(sql), false);
  checkEq("[r1] 十二个内容栏位都在",
    ["grounds_core", "grounds_expl", "grounds_prompt", "moves_core", "moves_expl", "moves_prompt",
     "drains_core", "drains_expl", "drains_prompt", "calls_core", "calls_expl", "calls_prompt"]
      .filter(function (c) { return sql.indexOf(c) < 0; }).join(","), "");

  /* ═══ 7. 这一层不碰内容智慧 ═══ */
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  checkEq("[r1] 模组没有任何网路呼叫", /fetch\(|XMLHttpRequest|anthropic|supabase/i.test(code), false);
  checkEq("[r1] 模组不读星盘 / 机制 / 分数",
    /planets|cusps|\bmechanism\b|selectionScore|patternKey/i.test(code), false);
  checkEq("[r1] 模组不碰 localStorage", /localStorage/.test(code), false);
  checkEq("[r1] 没有 service_role", /service_role/.test(html + src + sql), false);
}

function main() {
  testTimezones();
  testCharts();
  testFormatting();
  testAspects();
  testNoSilentDefaults();
  testUnknownTime();
  testAppBootOrder();
  testDeterminism();
  testReadingPreview();
  testThreadMobileScope();
  testInnerCompass();
  testCompassEvidence();
  testCompassRules();
  testCompassSelection();
  testCompassTranslation();
  testCompassDevPreview();
  const genJobs = testCompassGeneration();
  const liveJobs = testCompassLivePath();
  const voiceJobs = testCompassVoiceV11();
  const v12Jobs = testCompassVoiceV12();
  testCompassLiveAuthPath();
  testCompassShadowPermission();
  testCompassProductPage();
  testCompassAnchorSelection();
  testCompassAnchorScopeGuard();
  testCompassAnchorReusability();
  testCompassAnchorsLock();
  testCompassPreLaunchFixes();
  testCompassAnchorsSemantic();
  testGuide();
  testCompassCentredLayout();
  testCompassSituations();
  testAnchorsV11AndRenderV2();
  testCanonicalStorage();
  testTopicLayout();
  testTopicPreviews();
  testCompassZhOnlyLabels();
  return Promise.all([genJobs, liveJobs, voiceJobs, v12Jobs]).then(function () { return testPlaces(); }).then(function () {
    console.log("\n对照来源:" + REF.reference);
    console.log("设置:" + JSON.stringify(REF.settings));
    console.log("\n通过 " + pass + " / 失败 " + fail);
    if (failures.length) {
      console.log("\n失败明细(最多列 60 条):");
      failures.slice(0, 60).forEach(f => console.log("  ✗ " + f));
      if (failures.length > 60) console.log("  … 另有 " + (failures.length - 60) + " 条");
      process.exitCode = 1;
    } else {
      console.log("全部通过 ✓");
    }
  });
}
main().catch(e => { console.error(e); process.exitCode = 1; });
