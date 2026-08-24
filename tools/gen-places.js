/* ============================================================
   tools/gen-places.js
   生成 assets/astro/places-data.js —— 全球出生地点资料库。

   资料来源(建置期,执行期不连网)
   ────────────────────────────
   · GeoNames cities1000(npm: cities-with-1000)
       城市名 / 经纬度 / 人口 / 国家码 / admin1 码 / IANA 时区
       授权 CC BY 4.0 —— 见档头 attribution。
   · city-timezones:用来「投票」推出 admin1 码对应的地区名。
       只有当同一个 admin1 码底下 ≥75% 的样本给出同一个地区名时才采用,
       避免像英国 ENG 被写成某个郡这种错误;推不出来就不显示地区。
   · i18n-iso-countries:国家名(英文 / 中文)。

   产物是纯资料,执行期由 assets/astro/places.js 载入并做搜索。

   用法:node tools/gen-places.js
   ============================================================ */
"use strict";
const fs = require("fs");
const path = require("path");

const OUT = path.join(__dirname, "..", "assets", "astro", "places-data.js");
const SRC = require.resolve("cities-with-1000/cities1000.txt");
const cityTz = require("city-timezones").cityMapping;
const iso = require("i18n-iso-countries");
iso.registerLocale(require("i18n-iso-countries/langs/en.json"));
iso.registerLocale(require("i18n-iso-countries/langs/zh.json"));

const MIN_POP = 5000;
const KEEP_FEATURES = new Set(["PPLC", "PPLA", "PPLA2"]);   // 首都 / 一级 / 二级行政中心一律保留

/* 国家名覆盖:ISO 官方长名太啰嗦或不适合当出生地点标签的,改成通用名 */
const COUNTRY_OVERRIDE = {
  TW: { en: "Taiwan", zh: "台湾" },
  US: { en: "United States", zh: "美国" },
  GB: { en: "United Kingdom", zh: "英国" },
  KR: { en: "South Korea", zh: "韩国" },
  KP: { en: "North Korea", zh: "朝鲜" },
  CZ: { en: "Czechia", zh: "捷克" },
  RU: { en: "Russia", zh: "俄罗斯" },
  VN: { en: "Vietnam", zh: "越南" },
  LA: { en: "Laos", zh: "老挝" },
  BN: { en: "Brunei", zh: "文莱" },
  MO: { en: "Macau", zh: "澳门" },
  HK: { en: "Hong Kong", zh: "香港" },
  IR: { en: "Iran", zh: "伊朗" },
  SY: { en: "Syria", zh: "叙利亚" },
  BO: { en: "Bolivia", zh: "玻利维亚" },
  VE: { en: "Venezuela", zh: "委内瑞拉" },
  TZ: { en: "Tanzania", zh: "坦桑尼亚" },
  MD: { en: "Moldova", zh: "摩尔多瓦" }
};

// 只收「纯汉字」别名:这个站的使用者是中文使用者,假名 / 谚文与拉丁混排的
// 别名既占体积又帮不上搜索。
const HAN_ONLY = /^[㐀-䶿一-鿿·]{1,8}$/;

function norm(s) {
  return String(s || "").toLowerCase().normalize("NFD")
    .replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "");
}

/* ---------- 1. 读 GeoNames ---------- */
function readCities() {
  const raw = fs.readFileSync(SRC, "utf8");
  const rows = [];
  for (const line of raw.split("\n")) {
    if (!line) continue;
    const f = line.split("\t");
    const pop = parseInt(f[14], 10) || 0;
    const feature = f[7];
    if (pop < MIN_POP && !KEEP_FEATURES.has(feature)) continue;
    const tz = f[17];
    if (!tz) continue;
    rows.push({
      name: f[1],
      ascii: f[2] || f[1],
      alt: f[3] || "",
      lat: parseFloat(f[4]),
      lon: parseFloat(f[5]),
      feature: feature,
      cc: f[8],
      a1: f[10] || "",
      pop: pop,
      tz: tz
    });
  }
  return rows;
}

/* ---------- 2. admin1 码 → 地区名(投票) ---------- */
function buildRegionNames(rows) {
  const byKey = new Map();
  for (const r of rows) {
    const k = r.cc + "|" + norm(r.ascii);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(r);
  }
  const votes = new Map();
  for (const c of cityTz) {
    if (!c.province) continue;
    const arr = byKey.get(c.iso2 + "|" + norm(c.city_ascii || c.city));
    if (!arr) continue;
    let best = null, bd = Infinity;
    for (const g of arr) {
      const d = Math.hypot(g.lat - c.lat, g.lon - c.lng);
      if (d < bd) { bd = d; best = g; }
    }
    if (!best || bd > 0.5 || !best.a1) continue;
    const kk = c.iso2 + "|" + best.a1;
    if (!votes.has(kk)) votes.set(kk, new Map());
    const m = votes.get(kk);
    m.set(c.province, (m.get(c.province) || 0) + 1);
  }
  const out = {};
  for (const [k, m] of votes) {
    let bn = null, bc = 0, tot = 0;
    for (const [n, c] of m) { tot += c; if (c > bc) { bc = c; bn = n; } }
    if (bc / tot >= 0.75) out[k] = bn;      // 不够一致就不给地区名,宁缺勿错
  }
  return out;
}

/* ---------- 3. 打包 ---------- */
function build() {
  const rows = readCities();
  const regions = buildRegionNames(rows);

  const zones = [];
  const zoneIdx = new Map();
  const zoneOf = (tz) => {
    if (!zoneIdx.has(tz)) { zoneIdx.set(tz, zones.length); zones.push(tz); }
    return zoneIdx.get(tz);
  };

  const countries = {};
  const packed = [];
  rows.sort((a, b) => (a.cc < b.cc ? -1 : a.cc > b.cc ? 1 : b.pop - a.pop));

  for (const r of rows) {
    if (!countries[r.cc]) {
      const ov = COUNTRY_OVERRIDE[r.cc];
      countries[r.cc] = [
        (ov && ov.en) || iso.getName(r.cc, "en") || r.cc,
        (ov && ov.zh) || iso.getName(r.cc, "zh") || iso.getName(r.cc, "en") || r.cc
      ];
    }
    // 中日韩别名:让中文使用者可以直接打「吉隆坡」「东京」
    let cjk = "";
    if (r.alt) {
      const hits = [];
      for (const a of r.alt.split(",")) {
        if (HAN_ONLY.test(a) && hits.indexOf(a) === -1) hits.push(a);
        if (hits.length >= 2) break;
      }
      hits.sort((x, y) => x.length - y.length);
      cjk = hits.join(",");
    }
    const asciiField = norm(r.ascii) === norm(r.name) ? "" : r.ascii;
    packed.push([
      r.name.replace(/[|\n]/g, " "),
      asciiField.replace(/[|\n]/g, " "),
      cjk.replace(/[|\n]/g, " "),
      r.cc,
      r.a1,
      Math.round(r.lat * 1e4),
      Math.round(r.lon * 1e4),
      r.pop >= 1000 ? Math.round(r.pop / Math.pow(10, String(r.pop).length - 3)) *
        Math.pow(10, String(r.pop).length - 3) : r.pop,
      zoneOf(r.tz)
    ].join("|"));
  }

  const header = `/* ============================================================
   assets/astro/places-data.js —— 自动生成,请勿手改
   由 tools/gen-places.js 产生。

   全球出生地点资料库:${packed.length} 个城市 / ${Object.keys(countries).length} 个国家或地区 /
   ${zones.length} 个 IANA 时区。收录标准:人口 ≥ ${MIN_POP},或为首都 / 一二级行政中心。

   资料来源与授权
   ──────────────
   · 城市名、经纬度、人口、时区:GeoNames(https://www.geonames.org/)
     Creative Commons Attribution 4.0 (CC BY 4.0)。
   · 地区名推导:city-timezones(MIT)。
   · 国家名:i18n-iso-countries(MIT,底层为 Unicode CLDR)。

   栏位:name|ascii|cjk|countryCode|admin1|lat*1e4|lon*1e4|population|zoneIndex
   ascii 与 name 相同时留空;cjk 为中日韩别名(最多两个,逗号分隔)。
   生成时间:${new Date().toISOString()}
   ============================================================ */
(function (root) {
  "use strict";
  var DATA = {
    generated: ${JSON.stringify(new Date().toISOString())},
    minPopulation: ${MIN_POP},
    attribution: "City data \\u00a9 GeoNames, CC BY 4.0 (geonames.org)",
    countries: ${JSON.stringify(countries)},
    regions: ${JSON.stringify(regions)},
    zones: ${JSON.stringify(zones)},
    rows: `;

  const body = JSON.stringify(packed.join("\n"));
  const tail = `
  };
  if (typeof module === "object" && module.exports) module.exports = DATA;
  else root.InnerSkyPlacesData = DATA;
})(typeof globalThis !== "undefined" ? globalThis : this);
`;
  fs.writeFileSync(OUT, header + body + tail);
  process.stderr.write("cities " + packed.length + ", countries " + Object.keys(countries).length +
    ", regions " + Object.keys(regions).length + ", zones " + zones.length + "\n");
  process.stderr.write("written " + OUT + " (" + (fs.statSync(OUT).size / 1024).toFixed(0) + " KB)\n");
}

build();
