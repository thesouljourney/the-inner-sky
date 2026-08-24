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

    checkEq("[place] 无资料回报 unresolved", Places.resolveLegacy({}).status, "unresolved");
    checkEq("[place] 校验缺时区", Places.validate({ lat: 1, lon: 2, city: "x" }).missing.join(), "timezone");
  });
}

/* ---------- 8. 同一份资料,重复计算必须完全一致 ---------- */
function testDeterminism() {
  const birth = {
    date: "1994-11-21", time: "01:44",
    place: { city: "Batu Pahat", lat: 1.8548, lon: 102.9325, tzId: "Asia/Kuala_Lumpur" }
  };
  const a = Astro.computeNatalChart(birth), b = Astro.computeNatalChart(birth);
  const strip = (x) => JSON.stringify(x, (k, v) => (k === "computedAt" ? undefined : v));
  checkEq("[determinism] 两次结果一致", strip(a) === strip(b), true);
}

/* ---------- 跑 ---------- */
function main() {
  testTimezones();
  testCharts();
  testFormatting();
  testAspects();
  testNoSilentDefaults();
  testUnknownTime();
  testDeterminism();
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
