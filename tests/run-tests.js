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
  const page = (function () {
    const i = html.indexOf("页面:我的内在指南(#/compass)");
    const j = html.indexOf("function renderFavoritesPage()", i);
    return i < 0 || j < 0 ? "" : html.slice(i, j);
  })();
  checkEq("[compass] 找得到页面实作", page.length > 2000, true);
  checkEq("[compass] 四个方向的内容来自 Compass 模组,不是写死在页面里",
    /window\.Compass\.directions\(/.test(page) && /window\.Compass\.reminders\(/.test(page) &&
    /window\.Compass\.question\(/.test(page), true);
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

  // —— 5. 这一轮不准新增任何生成请求 ——
  checkEq("[compass] 页面没有呼叫 Edge Function / Claude",
    !/callFunc\(|read-chart|anthropic/.test(page + mod), true);

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
  checkEq("[evi] 独立证据数只数盘面讯号",
    full.candidates.every(c => c.independentEvidenceCount ===
      new Set(c.sourceSignals.filter(s => s.sourceType === "chart").map(s => s.independenceKey)).size), true);

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

/* ---------- 跑 ---------- */
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
  return testPlaces().then(function () {
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
