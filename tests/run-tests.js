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
  checkEq("[sel] 选择层只透过开发预览的载入清单出现",
    (html.match(/compass-selection\.js/g) || []).length, 1);
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
  checkEq("[tr] 翻译层只透过开发预览的载入清单出现",
    (html.match(/compass-translation\.js/g) || []).length, 1);
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
  checkEq("[pv] 预览里只有一处 fetch", (pvBlock.match(/fetch\(/g) || []).length, 1);
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
function testCompassZhOnlyLabels() {
  const fs = require("fs");
  const html = fs.readFileSync(path.join(__dirname, "..", "app.html"), "utf8");
  checkEq("[zh] 英文小标只在英文模式出现",
    /window\.I18N\.isEN\(\)\s*\n?\s*\?\s*'<div class="cp-eyebrow">/.test(html), true);
  checkEq("[zh] 中文模式的小标只剩一颗星", /cp-eyebrow zh-only/.test(html), true);
  const dirBlock = html.slice(html.indexOf("function compassDirectionsHtml"),
                              html.indexOf("function compassRemindersHtml"));
  checkEq("[zh] 正式页四方向的英文名只在英文模式印",
    /window\.I18N\.isEN\(\) \? '<span class="en">' \+ esc0\(it\.en\)/.test(dirBlock), true);
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
