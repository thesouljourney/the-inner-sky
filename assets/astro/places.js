/* ============================================================
   assets/astro/places.js
   出生地点解析(LocationResolver)。

   职责
   ────
   · 全球城市搜索:输入「batu」→「Batu Pahat, Johor, Malaysia」
   · 把选到的地点解析成计算需要的完整资料:
       city / region / country / countryCode / lat / lon / tzId
   · 旧资料迁移:只有城市名(或只有经纬度)的旧星盘,尝试重新解析;
     同名城市无法唯一确定时回报 ambiguous,交给上层请使用者确认,
     绝不自动挑第一个。

   资料档 places-data.js 约 2.8 MB(gzip 后约 1.1 MB),因此采用
   「用到才载入」:使用者第一次聚焦出生地点栏位时才抓,抓完浏览器
   会长期快取。整个流程不依赖任何线上地理编码服务。
   ============================================================ */
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      function () { return Promise.resolve(require("./places-data.js")); },
      require("./tz-lookup.js")
    );
  } else {
    root.InnerSkyPlaces = factory(null, root.InnerSkyTzLookup);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (nodeLoader, tzLookup) {
  "use strict";

  var DATA = null;
  var INDEX = null;
  var loading = null;
  var dataUrl = "assets/astro/places-data.js";

  function setDataUrl(u) { dataUrl = u; }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error("地点资料载入失败:" + src)); };
      document.head.appendChild(s);
    });
  }

  function load() {
    if (INDEX) return Promise.resolve(INDEX);
    if (loading) return loading;
    loading = (nodeLoader
      ? nodeLoader()
      : (root_hasData() ? Promise.resolve(window.InnerSkyPlacesData)
                        : loadScript(dataUrl).then(function () { return window.InnerSkyPlacesData; }))
    ).then(function (d) {
      if (!d) throw new Error("地点资料不可用");
      DATA = d;
      INDEX = buildIndex(d);
      return INDEX;
    });
    return loading;
  }
  function root_hasData() {
    return typeof window !== "undefined" && window.InnerSkyPlacesData;
  }
  function isLoaded() { return !!INDEX; }

  /* ---------- 索引 ---------- */
  function norm(s) {
    return String(s || "").toLowerCase().normalize("NFD")
      .replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9㐀-䶿一-鿿]+/g, "");
  }

  function buildIndex(d) {
    var lines = d.rows.split("\n");
    var items = new Array(lines.length);
    for (var i = 0; i < lines.length; i++) {
      var f = lines[i].split("|");
      var name = f[0];
      var ascii = f[1] || name;
      items[i] = {
        i: i,
        name: name,
        ascii: ascii,
        cjk: f[2] ? f[2].split(",") : [],
        cc: f[3],
        a1: f[4],
        lat: parseInt(f[5], 10) / 1e4,
        lon: parseInt(f[6], 10) / 1e4,
        pop: parseInt(f[7], 10) || 0,
        tz: d.zones[parseInt(f[8], 10)],
        n: norm(ascii),
        nName: norm(name)
      };
    }
    // 依名称首碰撞分桶,搜索时只扫相关桶
    var buckets = new Map();
    function put(key, item) {
      if (!key) return;
      var k = key.slice(0, 2);
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(item);
    }
    for (var j = 0; j < items.length; j++) {
      var it = items[j];
      put(it.n, it);
      if (it.nName !== it.n) put(it.nName, it);
      for (var c = 0; c < it.cjk.length; c++) put(norm(it.cjk[c]), it);
    }

    /* 地区 / 国家索引:让使用者打「柔佛」或「Johor」、「马来西亚」或
       「Malaysia」都能带出该地区的城市,而不只是打城市名才找得到。
       每一组按人口排序,搜索时取前几名。 */
    var areas = new Map();          // 正规化名 → { label, cities: [] }
    function area(key, label) {
      if (!key) return null;
      if (!areas.has(key)) areas.set(key, { label: label, cities: [] });
      return areas.get(key);
    }
    for (var k = 0; k < items.length; k++) {
      var t = items[k];
      var names = [];
      if (t.a1) {
        var r = d.regions[t.cc + "|" + t.a1];
        if (r) { var rr = Array.isArray(r) ? r : [r, null]; names.push(rr[0], rr[1]); }
      }
      var co = d.countries[t.cc];
      if (co) names.push(co[0], co[1]);
      names.push(t.cc);
      for (var q = 0; q < names.length; q++) {
        if (!names[q]) continue;
        var a = area(norm(names[q]), names[q]);
        if (a) a.cities.push(t);
      }
    }
    areas.forEach(function (a) {
      a.cities.sort(function (x, y) { return y.pop - x.pop; });
      if (a.cities.length > 400) a.cities.length = 400;
    });
    return { data: d, items: items, buckets: buckets, areas: areas };
  }

  /* ---------- 显示名 ---------- */
  function countryName(cc, lang) {
    var c = DATA.countries[cc];
    if (!c) return cc;
    return (lang === "zh" ? c[1] : c[0]) || c[0];
  }
  /* 地区名存成 [英文, 中文],中文可能是 null */
  function regionPair(cc, a1) {
    if (!a1) return [null, null];
    var r = DATA.regions[cc + "|" + a1];
    if (!r) return [null, null];
    return Array.isArray(r) ? [r[0] || null, r[1] || null] : [r, null];
  }
  function regionName(cc, a1, lang) {
    var p = regionPair(cc, a1);
    return (lang === "zh" ? (p[1] || p[0]) : p[0]) || null;
  }

  /* 组一行地点名:城市, 地区, 国家。
     地区名与城市名或国家名重复时不重复列(例:Tampines, 新加坡, 新加坡)。 */
  function joinLabel(city, region, country, sep) {
    var parts = [city];
    if (region && norm(region) !== norm(city) && norm(region) !== norm(country)) parts.push(region);
    if (country && norm(country) !== norm(city)) parts.push(country);
    return parts.join(sep);
  }

  function toPlace(it, lang) {
    var pair = regionPair(it.cc, it.a1);
    var countryEn = countryName(it.cc, "en");
    var countryZh = countryName(it.cc, "zh");
    var cityZh = it.cjk.length ? it.cjk[0] : null;

    var labelEn = joinLabel(it.name, pair[0], countryEn, ", ");
    // 中文那一行:有中文就用中文,没有就沿用原名,让两行对得起来
    var labelZh = joinLabel(cityZh || it.name, pair[1] || pair[0], countryZh, "，");
    // 下拉选单一行只能放一段文字,所以中英并列成一行
    var display = (norm(labelZh) === norm(labelEn)) ? labelEn : (labelEn + " · " + labelZh);

    return {
      city: it.name,
      cityZh: cityZh,
      region: regionName(it.cc, it.a1, lang),
      regionEn: pair[0],
      regionZh: pair[1],
      country: countryName(it.cc, lang),
      countryEn: countryEn,
      countryZh: countryZh,
      countryCode: it.cc,
      admin1: it.a1 || null,
      label: lang === "zh" ? labelZh : labelEn,
      labelEn: labelEn,
      labelZh: labelZh,
      display: display,
      lat: it.lat,
      lon: it.lon,
      tzId: it.tz,
      population: it.pop,
      source: "geonames"
    };
  }

  /* ---------- 搜索 ---------- */
  /* 支援「城市」「城市 国家」「城市, 地区」几种写法。
     排序:完全相符 > 前缀相符 > 包含;同分再比人口。 */
  function search(query, opts) {
    opts = opts || {};
    var lang = opts.lang === "zh" ? "zh" : "en";
    var limit = opts.limit || 12;
    var raw = String(query || "").trim();
    if (!INDEX || raw.length < 1) return [];

    var tokens = raw.split(/[,，]/).map(function (s) { return norm(s); }).filter(Boolean);
    if (!tokens.length) return [];
    var head = tokens[0];
    var rest = tokens.slice(1);
    if (head.length < 1) return [];

    var pool = INDEX.buckets.get(head.slice(0, 2)) || [];
    if (head.length === 1) {
      pool = [];
      INDEX.buckets.forEach(function (arr, k) { if (k.charAt(0) === head) pool = pool.concat(arr); });
    }

    /* 整串查询若本身就是地区名或国家名(柔佛 / Johor / 马来西亚 / Malaysia),
       该地区的城市一并带出来。名字命中与地区命中取较高分,免得
       打「Johor」时新山反而排在同州小镇后面。 */
    var whole = norm(raw);
    var areaHit = INDEX.areas.get(whole);
    var areaScore = areaHit ? 3 : 1.5;
    if (!areaHit) {
      var cand = null, nCand = 0;      // 前缀唯一命中也算(打「柔」带出柔佛)
      INDEX.areas.forEach(function (a, key) {
        if (key.indexOf(whole) === 0) { cand = a; nCand++; }
      });
      if (nCand === 1) areaHit = cand;
    }
    var areaSet = new Set();
    if (areaHit) for (var ai = 0; ai < areaHit.cities.length; ai++) areaSet.add(areaHit.cities[ai].i);

    var seen = new Set();
    var hits = [];
    for (var i = 0; i < pool.length; i++) {
      var it = pool[i];
      if (seen.has(it.i)) continue;
      var keys = [it.n, it.nName].concat(it.cjk.map(norm));
      var score = -1;
      for (var k = 0; k < keys.length; k++) {
        var key = keys[k];
        if (!key) continue;
        if (key === head) { score = Math.max(score, 3); }
        else if (key.indexOf(head) === 0) { score = Math.max(score, 2); }
        else if (key.indexOf(head) > 0) { score = Math.max(score, 1); }
      }
      // 地区命中只用来「抬高」已经靠名字命中的城市,不会让不相干的城市混进来
      if (score >= 0 && areaSet.has(it.i)) score = Math.max(score, areaScore);
      if (score < 0) continue;

      // 第二段(国家 / 地区)必须也对得上
      if (rest.length) {
        var region = regionName(it.cc, it.a1);
        var hay = norm(it.cc) + norm(countryName(it.cc, "en")) + norm(countryName(it.cc, "zh")) + norm(region || "");
        var ok = rest.every(function (t) { return hay.indexOf(t) !== -1; });
        if (!ok) continue;
        score += 1;
      }
      seen.add(it.i);
      hits.push({ it: it, score: score });
    }

    // 该地区人口最多的城市补进来(照人口序,取 limit 的两倍当候选)
    if (areaHit) {
      var quota = limit * 2;
      for (var m = 0; m < areaHit.cities.length && quota > 0; m++) {
        var ci = areaHit.cities[m];
        if (seen.has(ci.i)) continue;
        seen.add(ci.i);
        hits.push({ it: ci, score: areaScore });
        quota--;
      }
    }

    hits.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return b.it.pop - a.it.pop;
    });
    return hits.slice(0, limit).map(function (h) { return toPlace(h.it, lang); });
  }

  /* ---------- 由经纬度推时区(旧资料迁移 / 自订座标用) ---------- */
  function timezoneAt(lat, lon) {
    if (typeof lat !== "number" || typeof lon !== "number" || !isFinite(lat) || !isFinite(lon)) return null;
    try { return tzLookup(lat, lon); } catch (e) { return null; }
  }

  /* 由经纬度找最近的已知城市(补 city / region / country 名) */
  function nearest(lat, lon, maxKm) {
    if (!INDEX) return null;
    var best = null, bd = Infinity;
    var items = INDEX.items;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var dLat = (it.lat - lat) * 111.32;
      var dLon = (it.lon - lon) * 111.32 * Math.cos(lat * Math.PI / 180);
      var d = Math.sqrt(dLat * dLat + dLon * dLon);
      if (d < bd) { bd = d; best = it; }
    }
    if (!best || bd > (maxKm || 60)) return null;
    var p = toPlace(best, "zh");
    p.distanceKm = bd;
    return p;
  }

  /* ---------- 旧资料迁移 ----------
     回传 { status, place, candidates }
       resolved   → 唯一确定,可以直接重算
       ambiguous  → 有多个同名城市,必须请使用者确认(绝不替他选)
       unresolved → 完全找不到,请使用者重填出生地点             */
  function resolveLegacy(input) {
    input = input || {};
    var lat = input.lat, lon = input.lon;
    var hasCoords = typeof lat === "number" && isFinite(lat) && typeof lon === "number" && isFinite(lon);

    // 有经纬度:时区由座标决定,最可靠
    if (hasCoords) {
      var tzId = timezoneAt(lat, lon);
      if (tzId) {
        var near = INDEX ? nearest(lat, lon, 80) : null;
        return {
          status: "resolved",
          place: {
            city: (near && near.city) || input.city || null,
            region: near ? near.region : null,
            country: near ? near.country : null,
            countryCode: near ? near.countryCode : null,
            label: near ? near.label : (input.city || null),
            lat: lat, lon: lon, tzId: tzId,
            source: near ? "coords+geonames" : "coords"
          },
          candidates: []
        };
      }
    }

    // 只有城市名:必须唯一命中才算解析成功
    var name = input.city || input.name || "";
    if (!name) return { status: "unresolved", place: null, candidates: [] };
    var cands = search(name, { limit: 8, lang: input.lang || "zh" });
    var exact = cands.filter(function (c) { return norm(c.city) === norm(name); });
    if (exact.length === 1) return { status: "resolved", place: exact[0], candidates: exact };
    if (exact.length > 1) return { status: "ambiguous", place: null, candidates: exact };
    if (cands.length === 1) return { status: "resolved", place: cands[0], candidates: cands };
    if (cands.length > 1) return { status: "ambiguous", place: null, candidates: cands };
    return { status: "unresolved", place: null, candidates: [] };
  }

  /* 校验一份地点资料是否足以计算星盘(不足就明说缺什么,不给预设值) */
  function validate(place) {
    var missing = [];
    if (!place) return { ok: false, missing: ["place"] };
    if (typeof place.lat !== "number" || !isFinite(place.lat) || place.lat < -89.999 || place.lat > 89.999) missing.push("latitude");
    if (typeof place.lon !== "number" || !isFinite(place.lon) || place.lon < -180 || place.lon > 180) missing.push("longitude");
    if (!place.tzId) missing.push("timezone");
    if (!place.city && !place.label) missing.push("city");
    return { ok: missing.length === 0, missing: missing };
  }

  return {
    load: load, isLoaded: isLoaded, setDataUrl: setDataUrl,
    search: search, timezoneAt: timezoneAt, nearest: nearest,
    resolveLegacy: resolveLegacy, validate: validate,
    countryName: function (cc, lang) { return DATA ? countryName(cc, lang) : cc; },
    attribution: function () { return DATA ? DATA.attribution : ""; }
  };
});
