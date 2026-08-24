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
   · tools/states-source.json(dr5hn/countries-states-cities-database,CC BY 4.0):
       只取 translations["zh-CN"],用「国家码 + 英文地区名」对上去,
       给地区名配中文。配不上的就只留英文,不猜。
   · tools/local-places.json:站方自订的马来西亚 / 新加坡地点表
       (从旧版 app.html 的 CITY_GROUPS 原样搬过来,含中文名)。
       GeoNames 的 cities1000 对这两个国家收得很薄(马来西亚 175、
       新加坡 2),旧使用者熟悉的「兀兰」「峇株巴辖」找不到,
       所以把原表并进来;时区一律由座标反查(tz-lookup),
       东马会正确落到 Asia/Kuching,不是手写死。
   · city-timezones 的城市本体也一并并入,补 GeoNames 漏掉的
       (例如花莲 Hualien)。

   产物是纯资料,执行期由 assets/astro/places.js 载入并做搜索。

   用法:node tools/gen-places.js
   ============================================================ */
"use strict";
const fs = require("fs");
const path = require("path");

const OUT = path.join(__dirname, "..", "assets", "astro", "places-data.js");
const SRC = require.resolve("cities-with-1000/cities1000.txt");
const cityTz = require("city-timezones").cityMapping;
const tzLookup = require("tz-lookup");
const STATES = (function () {
  const f = path.join(__dirname, "states-source.json");
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : [];
})();
const iso = require("i18n-iso-countries");
iso.registerLocale(require("i18n-iso-countries/langs/en.json"));
iso.registerLocale(require("i18n-iso-countries/langs/zh.json"));

const MIN_POP = 5000;
const KEEP_FEATURES = new Set(["PPLC", "PPLA", "PPLA2"]);   // 首都 / 一级 / 二级行政中心一律保留

/* 国家名覆盖:ISO 官方长名太啰嗦或不适合当出生地点标签的,改成通用名 */
const COUNTRY_OVERRIDE = {
  TW: { en: "Taiwan", zh: "台湾" },
  CN: { en: "China", zh: "中国" },
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

/* ---------- 1a. 地区名的中文 ---------- */
/* 用「国家码 + 英文地区名」去 dr5hn 的资料里找 translations["zh-CN"]。
   之前试过用 FIPS / ISO 代码对,东京会被对成福冈、布拉格会被对成
   赫拉德茨克拉洛韦 —— 代码体系不一致。改用名字对就准了,
   因为英文地区名本身已经是从 GeoNames 那侧投票出来的。 */
const zhStateIndex = (function () {
  const m = new Map();
  for (const s of STATES) {
    const zh = s.translations && (s.translations["zh-CN"] || s.translations.zh);
    if (!zh) continue;
    for (const n of [s.name, s.native]) {
      if (!n) continue;
      const k = s.country_code + "|" + norm(n);
      if (!m.has(k)) m.set(k, zh);
    }
  }
  return m;
})();

/* dr5hn 缺的、但对这个站的使用者有意义的地区,手动补上 */
const REGION_ZH_OVERRIDE = {
  "MY|Trengganu": "登嘉楼",
  "TW|Kaohsiung City": "高雄市",
  "CN|Xinjiang Uygur": "新疆",
  "CN|Ningxia Hui": "宁夏",
  "KR|Gangwon-do": "江原道",
  "KR|Gyeonggi-do": "京畿道",
  "TH|Bangkok Metropolis": "曼谷",
  "ID|Jakarta Raya": "雅加达",
  "ID|Yogyakarta": "日惹",
  "ID|Bangka-Belitung": "邦加-勿里洞",
  "PH|Metropolitan Manila": "马尼拉大都会",
  "CZ|Prague": "布拉格",
  "CZ|Liberecký": "利贝雷茨",
  "PT|Lisboa": "里斯本",
  "AR|Ciudad de Buenos Aires": "布宜诺斯艾利斯",
  "MX|Distrito Federal": "墨西哥城",
  "MX|México": "墨西哥州",
  "DK|Hovedstaden": "首都大区"
};

function regionZh(cc, enName) {
  const ov = REGION_ZH_OVERRIDE[cc + "|" + enName];
  if (ov) return ov;
  if (!enName) return null;
  const exact = zhStateIndex.get(cc + "|" + norm(enName));
  if (exact) return exact;
  // 名字带前后缀时(Bangkok Metropolis vs Bangkok)放宽成包含关系,
  // 但必须在同一个国家里唯一命中,否则宁可不给。
  const want = norm(enName);
  let hit = null, count = 0;
  for (const [k, zh] of zhStateIndex) {
    if (k.slice(0, 3) !== cc + "|") continue;
    const other = k.slice(3);
    if (other.indexOf(want) === 0 || want.indexOf(other) === 0) { hit = zh; count++; }
  }
  return count === 1 ? hit : null;
}

/* ---------- 1b. 补充来源 ---------- */

/* 站方自订的马来西亚 / 新加坡地点(旧版 CITY_GROUPS)。
   名字形如「峇株巴辖(Batu Pahat)」,拆成中文名 + 英文名两个搜索键。 */
function readLocalPlaces() {
  const file = path.join(__dirname, "local-places.json");
  if (!fs.existsSync(file)) return [];
  const groups = JSON.parse(fs.readFileSync(file, "utf8"));
  const out = [];
  for (const [region, cities] of groups) {
    for (const [label, lat, lon] of cities) {
      const m = /^(.*?)\s*[(（](.+?)[)）]\s*$/.exec(label);
      const zh = m ? m[1].trim() : label.trim();
      const en = m ? m[2].trim() : label.trim();
      const tz = tzLookup(lat, lon);
      out.push({
        name: en, ascii: en, alt: zh, lat: lat, lon: lon,
        // 国家码稍后由座标最近的 GeoNames 城市决定,不能照时区猜 ——
        // 旧表最后一组是「中国 · 湖州」,按时区猜会被标成马来西亚。
        feature: "PPL", cc: null,
        a1: "", pop: 0, tz: tz,
        regionName: region.replace(/\s*·.*$/, "").trim(),
        curated: true
      });
    }
  }
  return out;
}

/* city-timezones 里 GeoNames 没有的城市(例如花莲)。 */
function readCityTz(existing) {
  const out = [];
  for (const c of cityTz) {
    if (!c.iso2 || !c.city || typeof c.lat !== "number" || typeof c.lng !== "number") continue;
    const key = c.iso2 + "|" + norm(c.city_ascii || c.city);
    const near = existing.get(key);
    if (near && near.some(function (g) { return Math.hypot(g.lat - c.lat, g.lon - c.lng) < 0.35; })) continue;
    let tz = c.timezone;
    try { tz = tzLookup(c.lat, c.lng) || c.timezone; } catch (e) { /* 用资料自带的 */ }
    if (!tz) continue;
    out.push({
      name: c.city, ascii: c.city_ascii || c.city, alt: "",
      lat: c.lat, lon: c.lng, feature: "PPL", cc: c.iso2, a1: "",
      pop: Math.round(c.pop || 0), tz: tz,
      regionName: c.province || null
    });
  }
  return out;
}

function indexByName(rows) {
  const m = new Map();
  for (const r of rows) {
    const k = r.cc + "|" + norm(r.ascii);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
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
  const geo = readCities();
  const regions = buildRegionNames(geo);

  /* 自订表与 GeoNames 会重叠(峇株巴辖两边都有)。同一个城市只能出现一次,
     否则搜索结果会看到两笔一模一样的地点。做法:自订那笔如果在 GeoNames
     里找得到同名且相距 <25 km 的城市,就只把中文名挂到 GeoNames 那笔上,
     自订笔本身丢掉 —— GeoNames 有人口(排序要用)也有 admin1 地区名。 */
  const geoIndex = indexByName(geo);
  const localOnly = [];

  /* 自订地点的国家码:取座标最近的 GeoNames 城市。
     这样吉隆坡→MY、兀兰→SG、湖州→CN 都会对。 */
  function countryAt(lat, lon) {
    let best = null, bd = Infinity;
    for (const g of geo) {
      const d = Math.hypot((g.lat - lat) * 111, (g.lon - lon) * 111 * Math.cos(lat * Math.PI / 180));
      if (d < bd) { bd = d; best = g; }
    }
    return best && bd < 300 ? best.cc : null;
  }

  for (const loc of readLocalPlaces()) {
    loc.cc = countryAt(loc.lat, loc.lon);
    if (!loc.cc) continue;               // 定不出国家就不收,不猜
    const near = (geoIndex.get(loc.cc + "|" + norm(loc.ascii)) || []).filter(function (g) {
      return Math.hypot((g.lat - loc.lat) * 111, (g.lon - loc.lon) * 111 *
        Math.cos(loc.lat * Math.PI / 180)) < 25;
    });
    if (near.length) { near[0].zhAlias = loc.alt; continue; }
    /* 自订表独有的地点(兀兰、淡滨尼这些)本来只有中文分组名。
       借用同国最近一个 GeoNames 城市的 admin1 码,地区名就能中英都有;
       借不到才退回用中文分组名自建一个 ~ 码。 */
    let best = null, bd = Infinity;
    for (const g of geo) {
      if (g.cc !== loc.cc || !g.a1) continue;
      const d = Math.hypot((g.lat - loc.lat) * 111,
        (g.lon - loc.lon) * 111 * Math.cos(loc.lat * Math.PI / 180));
      if (d < bd) { bd = d; best = g; }
    }
    if (best && bd < 120) loc.a1 = best.a1, loc.regionName = null;
    localOnly.push(loc);
  }
  const rows = localOnly.concat(geo);
  const extra = readCityTz(indexByName(rows));
  rows.push.apply(rows, extra);
  process.stderr.write("geonames " + geo.length + " + 自订新增 " + localOnly.length +
    " + city-timezones 补 " + extra.length + "\n");

  const zones = [];
  const zoneIdx = new Map();
  const zoneOf = (tz) => {
    if (!zoneIdx.has(tz)) { zoneIdx.set(tz, zones.length); zones.push(tz); }
    return zoneIdx.get(tz);
  };

  const countries = {};
  const packed = [];
  const localRegions = {};      // 自订 / 补充来源直接带地区名,不靠 admin1 码
  rows.sort((a, b) => (a.cc < b.cc ? -1 : a.cc > b.cc ? 1 : b.pop - a.pop));

  for (const r of rows) {
    if (!countries[r.cc]) {
      const ov = COUNTRY_OVERRIDE[r.cc];
      countries[r.cc] = [
        (ov && ov.en) || iso.getName(r.cc, "en") || r.cc,
        (ov && ov.zh) || iso.getName(r.cc, "zh") || iso.getName(r.cc, "en") || r.cc
      ];
    }
    // 自订 / 补充来源自己带地区名:塞一个专属 admin1 码进 regions 表
    if (!r.a1 && r.regionName) {
      const code = "~" + r.regionName;
      r.a1 = code;
      localRegions[r.cc + "|" + code] = [r.regionName, /[\u4e00-\u9fff]/.test(r.regionName) ? r.regionName : null];
    }
    // 中日韩别名:让中文使用者可以直接打「吉隆坡」「东京」
    let cjk = "";
    if (r.curated && r.alt) {
      cjk = r.alt;                       // 自订表的中文名直接用
    } else if (r.zhAlias) {
      cjk = r.zhAlias;                   // 自订表并进来的中文名优先于 GeoNames 别名
    } else if (r.alt) {
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

  // 地区名改成 [英文, 中文],中文配不到就留 null
  const bilingualRegions = {};
  for (const [k, en] of Object.entries(regions)) {
    bilingualRegions[k] = [en, regionZh(k.split("|")[0], en)];
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
   regions 的值是 [英文名, 中文名],中文配不到时为 null。
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
    regions: ${JSON.stringify(Object.assign({}, bilingualRegions, localRegions))},
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
