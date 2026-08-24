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
    return { data: d, items: items, buckets: buckets };
  }

  /* ---------- 显示名 ---------- */
  function countryName(cc, lang) {
    var c = DATA.countries[cc];
    if (!c) return cc;
    return (lang === "zh" ? c[1] : c[0]) || c[0];
  }
  function regionName(cc, a1) {
    if (!a1) return null;
    return DATA.regions[cc + "|" + a1] || null;
  }

  function toPlace(it, lang) {
    var region = regionName(it.cc, it.a1);
    var country = countryName(it.cc, lang);
    var parts = [it.name];
    // 地区名和城市名或国家名重复时不重复列(例:Tampines, 新加坡, 新加坡)
    if (region && norm(region) !== norm(it.name) && norm(region) !== norm(country)) parts.push(region);
    parts.push(country);
    return {
      city: it.name,
      region: region,
      country: country,
      countryCode: it.cc,
      admin1: it.a1 || null,
      label: parts.join(", "),
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
