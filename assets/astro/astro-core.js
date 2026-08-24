/* ============================================================
   assets/astro/astro-core.js
   The Inner Sky · 本命盘计算核心(唯一计算入口 / Single Source of Truth)

   所有页面(落地页、我的星空、生命蓝图、主题解读、人生地图)都只读
   这里算出来的 NatalChartData,任何页面都不得自行推算星盘。

   依赖(按顺序载入):
     1. Astronomy Engine   → window.Astronomy
     2. ephem-minor.js     → window.InnerSkyEphemMinor(小天体 / 交点 / 莉莉丝)
     3. timezone.js        → window.InnerSkyTZ(历史时区)

   计算约定见 assets/astro/CALCULATION.md,并在 SETTINGS 里原样导出。
   ============================================================ */
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("astronomy-engine"),
      require("./ephem-minor.js"),
      require("./timezone.js")
    );
  } else {
    root.InnerSkyAstro = factory(root.Astronomy, root.InnerSkyEphemMinor, root.InnerSkyTZ);
    // 兼容旧代码:app.html 里既有的 AstroCore / AstroExtra 名字继续可用
    root.AstroCore = root.InnerSkyAstro.legacyCore;
    root.AstroExtra = root.InnerSkyAstro.legacyExtra;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (A, EPHEM, TZ) {
  "use strict";

  var D2R = Math.PI / 180, R2D = 180 / Math.PI;
  var C_AUDAY = 173.1446326846693;          // 光速,AU/日
  var ENGINE_VERSION = "2.0.0";             // 计算口径版本:改动算法时 +1,用来判断旧盘要不要重算

  /* ============================================================
     0. 计算设置(明确记录,不同定义绝不混用)
     ============================================================ */
  var SETTINGS = {
    engineVersion: ENGINE_VERSION,
    zodiac: "tropical",                     // 回归黄道,无 ayanamsa
    ayanamsa: null,
    frame: "true ecliptic and equinox of date",
    ephemeris: "Astronomy Engine (VSOP87 / 月球 ELP) + Swiss Ephemeris 拟合的小天体 Chebyshev 表",
    houseSystem: "placidus",                // 默认 Placidus
    housePolarFallback: "porphyry",         // 极区 Placidus 无解时退回 Porphyry(与 Swiss Ephemeris 一致)
    lunarNode: "true",                      // 默认真交点(与 Astro-Seek 预设一致);平交点同时算出
    lilith: "mean",                         // 默认平均黑月(月球平远地点);真/密切莉莉丝同时算出
    partOfFortune: "day/night sensitive",   // 昼盘 ASC+Moon−Sun,夜盘 ASC+Sun−Moon
    vertex: "prime vertical × ecliptic, western side",
    aspectSet: ["conjunction", "opposition", "square", "trine", "sextile", "quincunx"],
    positions: "apparent geocentric (光行时 + 周年光行差)",
    degreeDisplay: "truncated to arcminute",   // 显示取整:向下截断,与 Astro-Seek 一致
    houseAssignment: "unrounded decimal longitude"
  };

  /* ============================================================
     1. 基础工具
     ============================================================ */
  function n360(d) { return ((d % 360) + 360) % 360; }
  function diff180(d) { return ((d + 540) % 360) - 180; }

  /* 显示用:28.1755° → { deg:28, min:10, sec:31, text:"28°10′" }
     分与秒一律向下截断,不四舍五入 —— 四舍五入会让 28°10.53′ 显示成 28°11′,
     与 Astro-Seek 差一分。宫位判断永远用未取整的 lon。 */
  function dms(degInSign) {
    var total = Math.max(0, degInSign);
    var d = Math.floor(total);
    var mFloat = (total - d) * 60;
    var m = Math.floor(mFloat + 1e-9);
    var s = Math.floor((mFloat - m) * 60 + 1e-9);
    if (m > 59) { m = 59; s = 59; }
    return { deg: d, min: m, sec: s };
  }
  function fmtDeg(degInSign) {
    var v = dms(degInSign);
    return v.deg + "°" + String(v.min).padStart(2, "0") + "′";
  }

  var SIGNS = [
    { name: "白羊座", glyph: "Aries",       en: "Aries",       elem: "火", mode: "开创", ruler: "火星",   kw: "冲劲 · 直接 · 开拓" },
    { name: "金牛座", glyph: "Taurus",      en: "Taurus",      elem: "土", mode: "固定", ruler: "金星",   kw: "稳定 · 感官 · 累积" },
    { name: "双子座", glyph: "Gemini",      en: "Gemini",      elem: "风", mode: "变动", ruler: "水星",   kw: "好奇 · 沟通 · 多线" },
    { name: "巨蟹座", glyph: "Cancer",      en: "Cancer",      elem: "水", mode: "开创", ruler: "月亮",   kw: "滋养 · 保护 · 念旧" },
    { name: "狮子座", glyph: "Leo",         en: "Leo",         elem: "火", mode: "固定", ruler: "太阳",   kw: "自信 · 表现 · 慷慨" },
    { name: "处女座", glyph: "Virgo",       en: "Virgo",       elem: "土", mode: "变动", ruler: "水星",   kw: "细致 · 分析 · 服务" },
    { name: "天秤座", glyph: "Libra",       en: "Libra",       elem: "风", mode: "开创", ruler: "金星",   kw: "平衡 · 关系 · 审美" },
    { name: "天蝎座", glyph: "Scorpio",     en: "Scorpio",     elem: "水", mode: "固定", ruler: "冥王星", kw: "深度 · 洞察 · 转化" },
    { name: "射手座", glyph: "Sagittarius", en: "Sagittarius", elem: "火", mode: "变动", ruler: "木星",   kw: "远方 · 信念 · 自由" },
    { name: "摩羯座", glyph: "Capricorn",   en: "Capricorn",   elem: "土", mode: "开创", ruler: "土星",   kw: "责任 · 目标 · 攀登" },
    { name: "水瓶座", glyph: "Aquarius",    en: "Aquarius",    elem: "风", mode: "固定", ruler: "天王星", kw: "独立 · 革新 · 群体" },
    { name: "双鱼座", glyph: "Pisces",      en: "Pisces",      elem: "水", mode: "变动", ruler: "海王星", kw: "共感 · 想象 · 消融" }
  ];

  function lonToSign(lon) {
    lon = n360(lon);
    var idx = Math.floor(lon / 30);
    return { idx: idx, sign: SIGNS[idx].name, deg: lon - idx * 30 };
  }

  /* 宫位判断:用未四舍五入的 decimal longitude,靠宫头的行星才不会跑错宫 */
  function lonToHouse(lon, cusps) {
    if (!cusps || cusps.length !== 12) return null;
    lon = n360(lon);
    for (var i = 0; i < 12; i++) {
      var a = cusps[i], b = cusps[(i + 1) % 12];
      var span = n360(b - a);
      if (span === 0) span = 360;
      if (n360(lon - a) < span) return i + 1;
    }
    return 12;
  }

  /* ============================================================
     2. 十大主星
     ============================================================ */
  var BODIES = [
    { key: "Sun",     name: "太阳",   en: "Sun",     glyphKey: "Sun",     body: "Sun",     kind: "光体", kw: "自我 · 生命力 · 目标" },
    { key: "Moon",    name: "月亮",   en: "Moon",    glyphKey: "Moon",    body: "Moon",    kind: "光体", kw: "情绪 · 需求 · 安全感" },
    { key: "Mercury", name: "水星",   en: "Mercury", glyphKey: "Mercury", body: "Mercury", kind: "个人", kw: "思维 · 沟通 · 学习" },
    { key: "Venus",   name: "金星",   en: "Venus",   glyphKey: "Venus",   body: "Venus",   kind: "个人", kw: "爱 · 价值 · 审美" },
    { key: "Mars",    name: "火星",   en: "Mars",    glyphKey: "Mars",    body: "Mars",    kind: "个人", kw: "行动 · 欲望 · 竞争" },
    { key: "Jupiter", name: "木星",   en: "Jupiter", glyphKey: "Jupiter", body: "Jupiter", kind: "社会", kw: "扩张 · 机遇 · 信念" },
    { key: "Saturn",  name: "土星",   en: "Saturn",  glyphKey: "Saturn",  body: "Saturn",  kind: "社会", kw: "限制 · 责任 · 结构" },
    { key: "Uranus",  name: "天王星", en: "Uranus",  glyphKey: "Uranus",  body: "Uranus",  kind: "世代", kw: "突变 · 觉醒 · 独立" },
    { key: "Neptune", name: "海王星", en: "Neptune", glyphKey: "Neptune", body: "Neptune", kind: "世代", kw: "梦境 · 消融 · 灵性" },
    { key: "Pluto",   name: "冥王星", en: "Pluto",   glyphKey: "Pluto",   body: "Pluto",   kind: "世代", kw: "深层 · 权力 · 重生" }
  ];

  /* 视地心黄经(当日真黄道)。A.Ecliptic() 已经把 EQJ 旋转到当日真黄道,
     不是 J2000 —— 这一点是回归黄道正确与否的关键。 */
  function bodyLon(bodyName, time) {
    var v = A.GeoVector(A.Body[bodyName], time, true);   // true = 含光行时与光行差
    return n360(A.Ecliptic(v).elon);
  }
  /* 逆行:用真实黄经速度判断,不用硬编码日期区间 */
  function bodySpeed(bodyName, time) {
    var dt = 0.25;
    var t = A.MakeTime(time);
    return diff180(bodyLon(bodyName, t.AddDays(dt)) - bodyLon(bodyName, t.AddDays(-dt))) / (2 * dt);
  }

  /* ============================================================
     3. 小天体 / 交点 / 莉莉丝:读 Chebyshev 表
     ============================================================ */
  function chebEval(coef, x) {
    var b0 = 0, b1 = 0, b2;
    for (var k = coef.length - 1; k >= 1; k--) { b2 = b1; b1 = b0; b0 = 2 * x * b1 - b2 + coef[k]; }
    return x * b0 - b1 + coef[0];
  }
  function segIndex(tt) {
    if (!EPHEM) return -1;
    if (tt < EPHEM.startTT || tt >= EPHEM.endTT) return -1;
    return Math.floor((tt - EPHEM.startTT) / EPHEM.seg);
  }
  function inEphemRange(tt) { return segIndex(tt) >= 0; }

  /* 小天体日心赤道 J2000 位置(AU) */
  function minorHelio(key, tt) {
    var s = segIndex(tt);
    if (s < 0 || !EPHEM.bodies[key]) return null;
    var a = EPHEM.startTT + s * EPHEM.seg;
    var x = 2 * (tt - a) / EPHEM.seg - 1;
    var co = EPHEM.bodies[key][s];
    return [chebEval(co[0], x), chebEval(co[1], x), chebEval(co[2], x)];
  }

  /* 小天体视地心黄经(当日真黄道):光行时 + 周年光行差 */
  function minorLon(key, time) {
    var t = A.MakeTime(time);
    if (!inEphemRange(t.tt)) return null;
    var e = A.HelioState(A.Body.Earth, t);
    var tau = 0, u = null;
    for (var i = 0; i < 3; i++) {
      var p = minorHelio(key, t.tt - tau);
      if (!p) return null;
      u = [p[0] - e.x, p[1] - e.y, p[2] - e.z];
      tau = Math.sqrt(u[0] * u[0] + u[1] * u[1] + u[2] * u[2]) / C_AUDAY;
    }
    // 周年光行差:视方向朝观测者运动方向偏移
    u = [u[0] + tau * e.vx, u[1] + tau * e.vy, u[2] + tau * e.vz];
    return n360(A.Ecliptic(new A.Vector(u[0], u[1], u[2], t)).elon);
  }
  function minorSpeed(key, time) {
    var t = A.MakeTime(time);
    var l1 = minorLon(key, t.AddDays(-0.5)), l2 = minorLon(key, t.AddDays(0.5));
    if (l1 === null || l2 === null) return null;
    return diff180(l2 - l1);
  }

  /* 真交点(True / Osculating Node):由月亮的瞬时状态向量直接算,
     不用查表 —— 真交点带 ~173 天、振幅约 1.6° 的摆动,800 天一段的
     Chebyshev 拟不住(实测误差可达 1°)。
     做法:取当日真黄道座标下的月球位置 r 与速度 v,角动量 h = r × v,
     升交点方向 = ẑ × h,其黄经即真北交点。实测与 Swiss Ephemeris
     相差 < 15 角秒。 */
  function moonStateEcl(time) {
    var t = A.MakeTime(time);
    var h = 10 / 1440;                       // ±10 分钟做中央差分
    var p0 = A.Ecliptic(A.GeoVector(A.Body.Moon, t, false)).vec;
    var pm = A.Ecliptic(A.GeoVector(A.Body.Moon, t.AddDays(-h), false)).vec;
    var pp = A.Ecliptic(A.GeoVector(A.Body.Moon, t.AddDays(h), false)).vec;
    return {
      r: [p0.x, p0.y, p0.z],
      v: [(pp.x - pm.x) / (2 * h), (pp.y - pm.y) / (2 * h), (pp.z - pm.z) / (2 * h)]
    };
  }
  function trueNodeLon(time) {
    var s = moonStateEcl(time);
    var r = s.r, v = s.v;
    var hx = r[1] * v[2] - r[2] * v[1];
    var hy = r[2] * v[0] - r[0] * v[2];
    // 升交点方向 = ẑ × h = (−hy, hx, 0)
    return n360(Math.atan2(hx, -hy) * R2D);
  }
  function trueNodeSpeed(time) {
    var t = A.MakeTime(time);
    return diff180(trueNodeLon(t.AddDays(0.5)) - trueNodeLon(t.AddDays(-0.5)));
  }

  /* 平交点 / 平黑月莉莉丝:表里直接存的就是当日真黄道黄经(已解卷绕) */
  function angleSeries(key, tt) {
    var s = segIndex(tt);
    if (s < 0 || !EPHEM.angles || !EPHEM.angles[key]) return null;
    var a = EPHEM.startTT + s * EPHEM.seg;
    var x = 2 * (tt - a) / EPHEM.seg - 1;
    return chebEval(EPHEM.angles[key][s], x);
  }
  function angleLon(key, time) {
    var v = angleSeries(key, A.MakeTime(time).tt);
    return v === null ? null : n360(v);
  }
  function angleSpeed(key, time) {
    var t = A.MakeTime(time);
    var a = angleSeries(key, t.tt - 0.5), b = angleSeries(key, t.tt + 0.5);
    return (a === null || b === null) ? null : (b - a);
  }

  /* ============================================================
     4. 四轴(ASC / MC / DSC / IC)与 Vertex / East Point
     ============================================================ */
  function computeAngles(time, lat, lonEast) {
    var t = A.MakeTime(time);
    var gastH = A.SiderealTime(t);                 // 格林尼治视恒星时(小时)
    var armc = n360(gastH * 15 + lonEast);         // 当地视恒星时 = RAMC(度)
    var epsDeg = A.e_tilt(t).tobl;                 // 真黄赤交角
    var eps = epsDeg * D2R, ramc = armc * D2R, phi = lat * D2R;

    var mc = n360(Math.atan2(Math.sin(ramc), Math.cos(ramc) * Math.cos(eps)) * R2D);
    var asc = n360(Math.atan2(
      Math.cos(ramc),
      -(Math.sin(ramc) * Math.cos(eps) + Math.tan(phi) * Math.sin(eps))
    ) * R2D);
    /* 象限修正:宫头按黄经递增排列,而 MC(第 10 宫头)到 ASC(第 1 宫头)
       只隔三个宫,且 (ASC−MC) + (IC−ASC) = 180°,所以 n360(ASC−MC) 一定在
       0~180 之间。atan2 在极区会给出反向的解,这里翻回来。
       (例:特罗姆瑟 69.6°N,旧式写法会把 ASC 算成 228°,正解是 48°。) */
    if (n360(asc - mc) >= 180) asc = n360(asc + 180);

    // East Point(东升点):赤纬 0 的地平东点在黄道上的投影
    var ep = n360(Math.atan2(Math.cos(ramc), -Math.sin(ramc) * Math.cos(eps)) * R2D);

    /* Vertex:地平「卯酉圈(prime vertical)」与黄道在「西侧」的交点。
       做法 = 以 RAMC+180 与余纬 (90−|lat|,带原纬度符号) 套上升点公式,
       再强制落到盘面西半边(IC → DSC → MC 这半圈),否则拿到的是
       Anti-Vertex。旧版少了这一步,低纬度出生盘会整整差 180°
       (例:峇株巴辖 1994-11-21 应为天秤座 1°50′,旧版给白羊座 1°50′
        —— 其实反了,旧版给的是天秤座,正解是白羊座)。 */
    var vertex = null, antivertex = null;
    if (Math.abs(lat) > 0.0001 && Math.abs(lat) < 89.999) {
      var coLatSigned = (90 - Math.abs(lat)) * (lat >= 0 ? 1 : -1);
      var raic = n360(armc + 180) * D2R;
      var phiV = coLatSigned * D2R;
      var vx = n360(Math.atan2(
        Math.cos(raic),
        -(Math.sin(raic) * Math.cos(eps) + Math.tan(phiV) * Math.sin(eps))
      ) * R2D);
      var ic0 = n360(mc + 180);
      if (n360(vx - ic0) >= 180) vx = n360(vx + 180);   // 落到西半边
      vertex = vx;
      antivertex = n360(vx + 180);
    }
    return {
      asc: asc, mc: mc, dsc: n360(asc + 180), ic: n360(mc + 180),
      armc: armc, eps: eps, epsDeg: epsDeg, ep: ep,
      vertex: vertex, antivertex: antivertex
    };
  }

  /* ============================================================
     5. 宫位
     ============================================================ */
  function raDecOfEcl(lonDeg, eps) {
    var L = lonDeg * D2R;
    return {
      ra: n360(Math.atan2(Math.sin(L) * Math.cos(eps), Math.cos(L)) * R2D),
      dec: Math.asin(Math.sin(eps) * Math.sin(L))
    };
  }

  /* Placidus。极区(黄道上出现拱极点)时无解,退回 Porphyry —— 与 Swiss
     Ephemeris / Astro-Seek 在极区的处理一致。 */
  function placidusCusps(ang, lat) {
    var asc = ang.asc, mc = ang.mc, armc = ang.armc, eps = ang.eps;
    var phi = lat * D2R;
    var undefinedFlag = false;

    function xOf(lam) { return n360(raDecOfEcl(lam, eps).ra - armc); }
    function target(lam, which) {
      var dec = raDecOfEcl(lam, eps).dec;
      var c = -Math.tan(phi) * Math.tan(dec);
      if (c < -1 || c > 1) undefinedFlag = true;
      c = Math.max(-1, Math.min(1, c));
      var sad = Math.acos(c) * R2D;      // 半昼弧
      var san = 180 - sad;               // 半夜弧
      if (which === 11) return sad / 3;
      if (which === 12) return 2 * sad / 3;
      if (which === 2)  return sad + san / 3;
      return sad + 2 * san / 3;          // which === 3
    }
    function solve(which, lo, hi) {
      var span = n360(hi - lo), N = 96;
      function g(lam) { return diff180(xOf(lam) - target(lam, which)); }
      var prevLam = lo, prevG = g(lo);
      for (var i = 1; i <= N; i++) {
        var lam = lo + span * i / N, gi = g(lam);
        if (prevG === 0) return n360(prevLam);
        if ((prevG < 0) !== (gi < 0) && Math.abs(prevG - gi) < 180) {
          var a = prevLam, b = lam, ga = prevG;
          for (var k = 0; k < 60; k++) {
            var m = (a + b) / 2, gm = g(m);
            if ((ga < 0) !== (gm < 0)) b = m; else { a = m; ga = gm; }
          }
          return n360((a + b) / 2);
        }
        prevLam = lam; prevG = gi;
      }
      undefinedFlag = true;
      return null;
    }

    var wrapAsc = n360(asc - mc) > 1 ? 0 : 360;
    var wrapDsc = n360(mc + 180 - asc) > 1 ? 0 : 360;
    var c11 = solve(11, mc + 1e-4, asc + wrapAsc - 1e-4);
    var c12 = solve(12, mc + 1e-4, asc + wrapAsc - 1e-4);
    var c2  = solve(2,  asc + 1e-4, mc + 180 + wrapDsc - 1e-4);
    var c3  = solve(3,  asc + 1e-4, mc + 180 + wrapDsc - 1e-4);

    if (undefinedFlag || c11 === null || c12 === null || c2 === null || c3 === null) {
      return { cusps: porphyryCusps(asc, mc), system: "porphyry", fallbackFrom: "placidus" };
    }
    var cusps = new Array(12);
    cusps[0] = asc; cusps[9] = mc;
    cusps[10] = c11; cusps[11] = c12; cusps[1] = c2; cusps[2] = c3;
    cusps[3] = n360(mc + 180); cusps[4] = n360(c11 + 180); cusps[5] = n360(c12 + 180);
    cusps[6] = n360(asc + 180); cusps[7] = n360(c2 + 180); cusps[8] = n360(c3 + 180);
    return { cusps: cusps, system: "placidus", fallbackFrom: null };
  }

  /* Porphyry:把 ASC→IC、IC→DSC 等象限三等分 */
  function porphyryCusps(asc, mc) {
    var ic = n360(mc + 180), dsc = n360(asc + 180);
    var q1 = n360(ic - asc) / 3, q2 = n360(dsc - ic) / 3;
    var c = new Array(12);
    c[0] = asc;                 c[1] = n360(asc + q1);  c[2] = n360(asc + 2 * q1);
    c[3] = ic;                  c[4] = n360(ic + q2);   c[5] = n360(ic + 2 * q2);
    c[6] = dsc;                 c[7] = n360(c[1] + 180); c[8] = n360(c[2] + 180);
    c[9] = mc;                  c[10] = n360(c[4] + 180); c[11] = n360(c[5] + 180);
    return c;
  }
  function wholeSignCusps(asc) {
    var start = Math.floor(n360(asc) / 30) * 30, c = [];
    for (var i = 0; i < 12; i++) c.push(n360(start + i * 30));
    return c;
  }
  function equalCusps(asc) {
    var c = [];
    for (var i = 0; i < 12; i++) c.push(n360(asc + i * 30));
    return c;
  }

  function buildHouses(system, ang, lat) {
    if (system === "whole") return { cusps: wholeSignCusps(ang.asc), system: "whole", fallbackFrom: null };
    if (system === "equal") return { cusps: equalCusps(ang.asc), system: "equal", fallbackFrom: null };
    if (system === "porphyry") return { cusps: porphyryCusps(ang.asc, ang.mc), system: "porphyry", fallbackFrom: null };
    return placidusCusps(ang, lat);
  }

  /* ============================================================
     6. 相位
     ============================================================ */
  var ASPECTS = [
    { key: "con", name: "合相",   en: "Conjunction", angle: 0,   orb: 8, glyph: "☌", tone: "中性偏强", color: "#8a6420" },
    { key: "sex", name: "六合",   en: "Sextile",     angle: 60,  orb: 4, glyph: "⚹", tone: "和谐",     color: "#5f7d3c" },
    { key: "squ", name: "刑相",   en: "Square",      angle: 90,  orb: 6, glyph: "□", tone: "张力",     color: "#c0532a" },
    { key: "tri", name: "拱相",   en: "Trine",       angle: 120, orb: 6, glyph: "△", tone: "和谐",     color: "#3f7fa0" },
    { key: "qcx", name: "梅花",   en: "Quincunx",    angle: 150, orb: 3, glyph: "⚻", tone: "调整",     color: "#7a6a8a" },
    { key: "opp", name: "冲相",   en: "Opposition",  angle: 180, orb: 8, glyph: "☍", tone: "张力",     color: "#c0532a" }
  ];

  /* 相位一律用两点的实际黄经夹角判断,不看星座关系。
     入相位 / 出相位:看夹角随时间是变小还是变大。 */
  function computeAspects(points) {
    var out = [];
    for (var i = 0; i < points.length; i++) {
      for (var j = i + 1; j < points.length; j++) {
        var p = points[i], q = points[j];
        var sep = Math.abs(diff180(p.lon - q.lon));
        var best = null;
        for (var a = 0; a < ASPECTS.length; a++) {
          var asp = ASPECTS[a];
          var orbMax = asp.orb;
          if (p.key === "Sun" || p.key === "Moon" || q.key === "Sun" || q.key === "Moon") orbMax += 1;
          var orb = Math.abs(sep - asp.angle);
          if (orb <= orbMax && (!best || orb < best.orb)) {
            best = {
              a: i, b: j, aKey: p.key, bKey: q.key,
              type: asp.key, name: asp.name, en: asp.en, glyph: asp.glyph,
              angle: asp.angle, exact: sep, orb: orb, tone: asp.tone, color: asp.color,
              applying: null, separating: null
            };
          }
        }
        if (best) {
          if (typeof p.speed === "number" && typeof q.speed === "number") {
            // 一天后夹角是变小(入相位)还是变大(出相位)
            var sepNext = Math.abs(diff180((p.lon + p.speed) - (q.lon + q.speed)));
            var orbNext = Math.abs(sepNext - best.angle);
            best.applying = orbNext < best.orb;
            best.separating = !best.applying;
          }
          out.push(best);
        }
      }
    }
    return out;
  }

  function chartStats(planets) {
    var elems = { 火: 0, 土: 0, 风: 0, 水: 0 };
    var modes = { 开创: 0, 固定: 0, 变动: 0 };
    for (var i = 0; i < planets.length; i++) {
      elems[SIGNS[planets[i].signIdx].elem]++;
      modes[SIGNS[planets[i].signIdx].mode]++;
    }
    return { elems: elems, modes: modes };
  }

  /* ============================================================
     7. 扩展点位
     ============================================================ */
  var META = {
    ASC:       { name: "上升点",   glyphTxt: "ASC", tier: 2, group: "axes",       needsTime: true },
    DSC:       { name: "下降点",   glyphTxt: "DSC", tier: 2, group: "axes",       needsTime: true },
    MC:        { name: "天顶",     glyphTxt: "MC",  tier: 2, group: "axes",       needsTime: true },
    IC:        { name: "天底",     glyphTxt: "IC",  tier: 2, group: "axes",       needsTime: true },
    NNode:     { name: "北交点",   glyphKey: "NorthNode", tier: 2, group: "nodes", note: "真交点(True Node)" },
    SNode:     { name: "南交点",   glyphKey: "SouthNode", tier: 2, group: "nodes", note: "真交点(True Node)" },
    NNodeMean: { name: "北交点(平)", glyphKey: "NorthNode", tier: 4, group: "nodes", note: "平交点(Mean Node)" },
    EP:        { name: "东升点",   glyphTxt: "EP",  tier: 2, group: "table-only", note: "收而不用:仅列出,不参与解读", needsTime: true },
    Chiron:    { name: "凯龙星",   glyphKey: "Chiron", tier: 3, group: "asteroids" },
    Ceres:     { name: "谷神星",   glyphKey: "Ceres",  tier: 3, group: "asteroids" },
    Pallas:    { name: "智神星",   glyphKey: "Pallas", tier: 3, group: "asteroids" },
    Juno:      { name: "婚神星",   glyphKey: "Juno",   tier: 3, group: "asteroids" },
    Vesta:     { name: "灶神星",   glyphKey: "Vesta",  tier: 3, group: "asteroids" },
    Lilith:    { name: "莉莉丝",   glyphKey: "Lilith", tier: 4, group: "nodes", note: "平均黑月(Mean Black Moon)" },
    Eros433:   { name: "爱神星",   glyphTxt: "Er",  tier: 4, group: "asteroids", note: "小行星 433" },
    Psyche16:  { name: "赛姬星",   glyphTxt: "Ps",  tier: 4, group: "asteroids", note: "小行星 16" },
    PoF:       { name: "福点",     glyphKey: "Fortune", tier: 5, group: "parts", needsTime: true },
    PoSpirit:  { name: "精神点",   glyphTxt: "SP",  tier: 5, group: "parts", needsTime: true },
    PoE:       { name: "爱情点",   glyphTxt: "PoE", tier: 5, group: "parts", needsTime: true },
    PoM:       { name: "婚姻点",   glyphTxt: "PoM", tier: 5, group: "parts", needsTime: true },
    Vertex:    { name: "宿命点",   glyphTxt: "Vx",  tier: 5, group: "parts", needsTime: true },
    SMmid:     { name: "日月中点", glyphTxt: "☉☽", tier: 5, group: "parts" },
    Eris:      { name: "阋神星",   glyphKey: "Eris", tier: 6, group: "eris", note: "默认关闭;仅当与个人行星相位 <2° 时才解读" }
  };

  function computeExtras(res, lat) {
    var time = A.MakeTime(res.date);
    var ang = res.ang, cusps = res.cusps;
    var hasTime = res.hasTime !== false;
    var get = function (k) { return res.planets.find(function (p) { return p.key === k; }); };
    var sun = get("Sun").lon, moon = get("Moon").lon, venus = get("Venus").lon;

    function mk(key, lon, opt) {
      lon = n360(lon);
      var sg = lonToSign(lon), m = META[key], v = dms(sg.deg);
      return Object.assign({
        key: key, name: m.name, glyphKey: m.glyphKey || null, glyphTxt: m.glyphTxt || null,
        tier: m.tier, group: m.group, note: m.note || null,
        lon: lon, sign: sg.sign, signIdx: sg.idx, degInSign: sg.deg,
        deg: v.deg, min: v.min, sec: v.sec, text: fmtDeg(sg.deg),
        house: cusps ? lonToHouse(lon, cusps) : null, retro: false, speed: null
      }, opt || {});
    }

    var out = [];
    if (hasTime) {
      out.push(mk("ASC", ang.asc, { house: null }));
      out.push(mk("DSC", ang.dsc, { house: null }));
      out.push(mk("MC", ang.mc, { house: null }));
      out.push(mk("IC", ang.ic, { house: null }));
      out.push(mk("EP", ang.ep));
    }

    // 南北交点:默认真交点(直接由月亮状态向量算);平交点同时给出
    var nnTrue = trueNodeLon(time), nnSpeed = trueNodeSpeed(time);
    out.push(mk("NNode", nnTrue, { speed: nnSpeed, retro: nnSpeed < 0 }));
    out.push(mk("SNode", nnTrue + 180, { speed: nnSpeed, retro: nnSpeed < 0 }));
    var nnMean = angleLon("MeanNode", time);
    if (nnMean !== null) out.push(mk("NNodeMean", nnMean, { speed: angleSpeed("MeanNode", time), retro: true }));

    // 凯龙 + 四小行星 + 爱神 / 赛姬
    ["Chiron", "Ceres", "Pallas", "Juno", "Vesta", "Eros433", "Psyche16"].forEach(function (k) {
      var l = minorLon(k, time);
      if (l === null) return;
      var sp = minorSpeed(k, time);
      out.push(mk(k, l, { speed: sp, retro: sp < 0 }));
    });

    // 莉莉丝:默认平均黑月
    var lil = angleLon("MeanLilith", time);
    if (lil !== null) out.push(mk("Lilith", lil, { speed: angleSpeed("MeanLilith", time), retro: false }));

    // 昼夜盘:太阳在地平线上(第 7–12 宫一侧)为昼
    var isDay = hasTime ? (n360(sun - ang.asc) >= 180) : null;
    if (hasTime) {
      var pof = isDay ? ang.asc + moon - sun : ang.asc + sun - moon;
      var spirit = isDay ? ang.asc + sun - moon : ang.asc + moon - sun;
      out.push(mk("PoF", pof, { isDay: isDay }));
      out.push(mk("PoSpirit", spirit, { isDay: isDay }));
      out.push(mk("PoE", ang.asc + venus - spirit));
      out.push(mk("PoM", ang.asc + ang.dsc - venus));
      if (ang.vertex !== null) {
        out.push(mk("Vertex", ang.vertex, {
          note: Math.abs(lat) < 10 ? "低纬地区宿命点数值不稳定,仅供参考" : META.Vertex.note
        }));
      }
    }

    // 日月中点(取近弧)
    var sm = n360((sun + moon) / 2);
    if (Math.abs(diff180(sm - sun)) > 90) sm = n360(sm + 180);
    out.push(mk("SMmid", sm, { isDay: isDay }));

    // 阋神星
    var erisLon = minorLon("Eris", time);
    if (erisLon !== null) {
      var esp = minorSpeed("Eris", time);
      var eris = mk("Eris", erisLon, { speed: esp, retro: esp < 0 });
      eris.trigger = [];
      ["Sun", "Moon", "Mercury", "Venus", "Mars"].forEach(function (pk) {
        var p = get(pk);
        var sep = Math.abs(diff180(eris.lon - p.lon));
        [0, 90, 120, 180].forEach(function (deg) {
          var orb = Math.abs(sep - deg);
          if (orb < 2) eris.trigger.push({ planet: p.name, angle: deg, orb: orb });
        });
      });
      out.push(eris);
    }

    out.isDay = isDay;
    return out;
  }

  /* ============================================================
     8. 主计算
     input: { date: Date(UTC 时刻), lat, lon, system, hasTime }
     ============================================================ */
  function computeChart(input) {
    var date = input.date;
    var lat = input.lat, lon = input.lon;
    var system = input.system || "placidus";
    var hasTime = input.hasTime !== false;
    if (!(date instanceof Date) || isNaN(date.getTime())) throw new Error("computeChart: date 必须是有效的 UTC Date");
    if (typeof lat !== "number" || !isFinite(lat) || lat < -89.999 || lat > 89.999) throw new Error("computeChart: lat 无效");
    if (typeof lon !== "number" || !isFinite(lon) || lon < -180 || lon > 180) throw new Error("computeChart: lon 无效");

    var time = A.MakeTime(date);
    var ang = computeAngles(time, lat, lon);
    var houses = hasTime ? buildHouses(system, ang, lat) : { cusps: null, system: null, fallbackFrom: null };

    var planets = BODIES.map(function (b) {
      var L = bodyLon(b.body, time);
      var sp = bodySpeed(b.body, time);
      if (b.key === "Sun" || b.key === "Moon") sp = Math.abs(sp);   // 日月不逆行
      var sg = lonToSign(L), v = dms(sg.deg);
      return {
        key: b.key, name: b.name, en: b.en, glyphKey: b.glyphKey, kind: b.kind, kw: b.kw,
        lon: L, sign: sg.sign, signIdx: sg.idx, degInSign: sg.deg,
        deg: v.deg, min: v.min, sec: v.sec, text: fmtDeg(sg.deg),
        house: houses.cusps ? lonToHouse(L, houses.cusps) : null,
        speed: sp, retro: sp < 0
      };
    });

    var res = {
      engineVersion: ENGINE_VERSION,
      settings: SETTINGS,
      date: date, lat: lat, lon: lon, hasTime: hasTime,
      system: houses.system || system,
      requestedSystem: system,
      houseFallbackFrom: houses.fallbackFrom,
      ang: ang,
      cusps: houses.cusps,
      planets: planets,
      aspects: computeAspects(planets),
      stats: chartStats(planets),
      ephemerisCovered: inEphemRange(time.tt)
    };
    res.extras = computeExtras(res, lat);
    res.isDay = res.extras.isDay;
    return res;
  }

  /* ============================================================
     9. 从出生资料到星盘:唯一的对外入口
        BirthData → LocationResolver(调用方给) → TimezoneResolver →
        UTCConverter → AstrologyEngine → NatalChartData
     ============================================================ */
  function normalizeBirth(birth) {
    if (!birth) throw new Error("缺少出生资料");
    var p = birth.place || {};
    var missing = [];
    if (!birth.date) missing.push("birth_date");
    if (typeof p.lat !== "number" || !isFinite(p.lat)) missing.push("latitude");
    if (typeof p.lon !== "number" || !isFinite(p.lon)) missing.push("longitude");
    if (!p.tzId) missing.push("timezone");
    if (missing.length) {
      var err = new Error("出生资料不完整:" + missing.join(", "));
      err.code = "INCOMPLETE_BIRTH_DATA";
      err.missing = missing;
      throw err;
    }
    return p;
  }

  /* 完整流水线。不做任何静默默认值:缺地点 / 缺时区一律抛错。 */
  function computeNatalChart(birth, opts) {
    opts = opts || {};
    var place = normalizeBirth(birth);
    var unknownTime = !birth.time || birth.unknownTime === true;
    var localTime = unknownTime ? "12:00" : birth.time;

    var conv = TZ.localToUtc(birth.date, localTime, place.tzId);
    var res = computeChart({
      date: conv.utc, lat: place.lat, lon: place.lon,
      system: opts.system || birth.system || "placidus",
      hasTime: !unknownTime
    });

    return {
      schema: "NatalChartData/2",
      engineVersion: ENGINE_VERSION,
      settings: SETTINGS,
      computedAt: new Date().toISOString(),
      birth: {
        date: birth.date,
        time: unknownTime ? null : birth.time,
        unknownTime: unknownTime,
        place: {
          city: place.city || null,
          region: place.region || null,
          country: place.country || null,
          countryCode: place.countryCode || null,
          label: place.label || null,
          lat: place.lat, lon: place.lon, tzId: place.tzId
        },
        utc: conv.utc.toISOString(),
        utcOffsetMinutes: conv.offsetMinutes,
        utcOffsetText: conv.offsetText,
        tzAbbreviation: conv.abbreviation || null,
        dstInEffect: conv.dst,
        ambiguousLocalTime: conv.ambiguous,
        nonexistentLocalTime: conv.nonexistent
      },
      chart: res
    };
  }

  /* ============================================================
     10. 导出
     ============================================================ */
  var api = {
    VERSION: ENGINE_VERSION,
    SETTINGS: SETTINGS,
    SIGNS: SIGNS, BODIES: BODIES, ASPECTS: ASPECTS, META: META,
    n360: n360, diff180: diff180, dms: dms, fmtDeg: fmtDeg,
    lonToSign: lonToSign, lonToHouse: lonToHouse,
    computeAngles: computeAngles, buildHouses: buildHouses,
    bodyLon: bodyLon, bodySpeed: bodySpeed,
    minorLon: minorLon, minorSpeed: minorSpeed,
    angleLon: angleLon, angleSpeed: angleSpeed,
    trueNodeLon: trueNodeLon, trueNodeSpeed: trueNodeSpeed,
    computeAspects: computeAspects, chartStats: chartStats,
    computeExtras: computeExtras, computeChart: computeChart,
    computeNatalChart: computeNatalChart
  };

  // 旧命名空间:app.html 里既有的调用点不用改写
  api.legacyCore = {
    SETTINGS: SETTINGS, VERSION: ENGINE_VERSION,
    SIGNS: SIGNS, BODIES: BODIES, ASPECTS: ASPECTS,
    n360: n360, diff180: diff180, fmtDeg: fmtDeg,
    lonToSign: lonToSign, lonToHouse: lonToHouse,
    computeChart: computeChart, chartStats: chartStats,
    computeAngles: computeAngles, bodyLon: bodyLon
  };
  api.legacyExtra = { computeExtras: computeExtras, META: META };
  return api;
});
