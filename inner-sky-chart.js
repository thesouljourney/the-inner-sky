/* 我的星空 · 落地页星盘（只读展示，不重新计算）
   数据来源：localStorage["inner_sky_chart_v1"]
   期望结构（与应用内 compute() 返回一致）：
   { ang:{asc,mc}, cusps:[12], planets:[{key,lon,retro}], aspects:[{a,b,type,name,orb}] }
   没有数据时显示引导，不用示例盘冒充使用者资料。 */
(function () {
  window.INNER_SKY_CHART_VERSION = "v3-house-clamp";
  var SIGNS = [
    { name: "白羊座", elem: "火", mode: "开创", ruler: "火星", art: "assets/signs/sm/aries.webp" },
    { name: "金牛座", elem: "土", mode: "固定", ruler: "金星", art: "assets/signs/sm/taurus.webp" },
    { name: "双子座", elem: "风", mode: "变动", ruler: "水星", art: "assets/signs/sm/gemini.webp" },
    { name: "巨蟹座", elem: "水", mode: "开创", ruler: "月亮", art: "assets/signs/sm/cancer.webp" },
    { name: "狮子座", elem: "火", mode: "固定", ruler: "太阳", art: "assets/signs/sm/leo.webp" },
    { name: "处女座", elem: "土", mode: "变动", ruler: "水星", art: "assets/signs/sm/virgo.webp" },
    { name: "天秤座", elem: "风", mode: "开创", ruler: "金星", art: "assets/signs/sm/libra.webp" },
    { name: "天蝎座", elem: "水", mode: "固定", ruler: "冥王星", art: "assets/signs/sm/scorpio.webp" },
    { name: "射手座", elem: "火", mode: "变动", ruler: "木星", art: "assets/signs/sm/sagittarius.webp" },
    { name: "摩羯座", elem: "土", mode: "开创", ruler: "土星", art: "assets/signs/sm/capricorn.webp" },
    { name: "水瓶座", elem: "风", mode: "固定", ruler: "天王星", art: "assets/signs/sm/aquarius.webp" },
    { name: "双鱼座", elem: "水", mode: "变动", ruler: "海王星", art: "assets/signs/sm/pisces.webp" }
  ];
  var BODIES = {
    Sun: { name: "太阳", kw: "自我与生命力" }, Moon: { name: "月亮", kw: "情绪与需求" },
    Mercury: { name: "水星", kw: "思考与表达" }, Venus: { name: "金星", kw: "爱与价值" },
    Mars: { name: "火星", kw: "行动与欲望" }, Jupiter: { name: "木星", kw: "扩张与机遇" },
    Saturn: { name: "土星", kw: "责任与课题" }, Uranus: { name: "天王星", kw: "改变与突破" },
    Neptune: { name: "海王星", kw: "灵感与想象" }, Pluto: { name: "冥王星", kw: "蜕变与重生" }
  };
  var ART = {
    Sun: "assets/planets/sm/sun.webp", Moon: "assets/planets/sm/moon.webp", Mercury: "assets/planets/sm/mercury.webp",
    Venus: "assets/planets/sm/venus.webp", Mars: "assets/planets/sm/mars.webp", Jupiter: "assets/planets/sm/jupiter.webp",
    Saturn: "assets/planets/sm/saturn.webp", Uranus: "assets/planets/sm/uranus.webp",
    Neptune: "assets/planets/sm/neptune.webp", Pluto: "assets/planets/sm/pluto.webp"
  };
  var FRAC = {
    Sun: { f: .500, cx: .500, cy: .473 }, Moon: { f: .530, cx: .519, cy: .500 },
    Mercury: { f: .427, cx: .500, cy: .508 }, Venus: { f: .651, cx: .500, cy: .493 },
    Mars: { f: .580, cx: .500, cy: .538 }, Jupiter: { f: .653, cx: .500, cy: .486 },
    Saturn: { f: .462, cx: .500, cy: .487 }, Uranus: { f: .516, cx: .500, cy: .520 },
    Neptune: { f: .700, cx: .500, cy: .502 }, Pluto: { f: .447, cx: .500, cy: .489 }
  };
  var ORDER = ["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto"];
  var ASP = {
    con: { stroke: "#e8cb8e", dash: "", w: 1.5, name: "合相" },
    sex: { stroke: "rgba(226,196,133,.62)", dash: "5 6", w: 1.1, name: "六合" },
    squ: { stroke: "rgba(240,222,166,.8)", dash: "9 7", w: 1.3, name: "四分" },
    tri: { stroke: "rgba(226,196,133,.72)", dash: "", w: 1.2, name: "三分" },
    // 计算引擎会产出梅花(150°),少了这一行会 fallback 成合相的线型
    qcx: { stroke: "rgba(200,186,214,.62)", dash: "3 6", w: 1.0, name: "梅花" },
    opp: { stroke: "rgba(240,222,166,.88)", dash: "14 8", w: 1.4, name: "对分" }
  };
  var CX = 500, CY = 500, R_OUT = 440, R_IN = 320, R_PLANET = 282, R_HOUSE_NUM = 238, R_ASP = 192;
  function n360(d) { return ((d % 360) + 360) % 360; }
  function pt(r, th) { var t = th * Math.PI / 180; return [CX + r * Math.cos(t), CY - r * Math.sin(t)]; }
  function f2(n) { return Number(n).toFixed(2); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function readChart() {
    var raw = null;
    try { raw = localStorage.getItem("inner_sky_chart_v1"); } catch (e) { return null; }
    if (!raw) return null;
    var c; try { c = JSON.parse(raw); } catch (e) { return null; }
    if (!c || !c.ang || !c.planets || !c.planets.length) return null;
    return c;
  }

  var root = document.getElementById("iskyWheel");
  if (!root) return;
  var appHash = root.getAttribute("data-app") || "app.html";
  var chart = readChart();

  if (!chart) {
    root.innerHTML = '<div class="isky-empty">还没有你的星盘。<br>建立之后，这里会显示属于你的那一张。' +
      '<br><a href="' + esc(appHash) + '#/onboarding" data-app-hash="#/onboarding">建立我的星盘 →</a></div>';
    var lg = document.getElementById("iskyLegend"); if (lg) lg.style.display = "none";
    var ft = document.getElementById("iskyFoot"); if (ft) ft.style.display = "none";
    var tg = document.getElementById("iskyToggle"); if (tg) tg.style.display = "none";
    return;
  }

  var asc = (chart.ang && chart.ang.asc) || 0;
  var mc = (chart.ang && chart.ang.mc) || n360(asc + 270);
  var cusps = (chart.cusps && chart.cusps.length === 12) ? chart.cusps
    : (function () { var a = [], b = Math.floor(asc / 30) * 30; for (var i = 0; i < 12; i++) a.push(n360(b + i * 30)); return a; })();
  function ang(lon) { return 180 + (n360(lon) - asc); }
  function houseOf(lon) {
    for (var i = 0; i < 12; i++) {
      var a = cusps[i], b = cusps[(i + 1) % 12], span = n360(b - a) || 30;
      if (n360(lon - a) < span) return i + 1;
    }
    return 12;
  }

  if (window.console && (chart.planets || []).some(function (p) { return p.house == null; })) {
    console.warn("[inner-sky] 快照缺少 house 字段(旧数据),已按 cusps 现算宫位;重新生成星盘可写入新格式");
  }

  var state = { hoverAsp: null, aspectsOn: true, openSign: null };

  /* ---- 星座扇形 ---- */
  var signs = SIGNS.map(function (s, i) {
    var a1 = ang(i * 30), a2 = a1 + 30, mid = (a1 + a2) / 2;
    var o1 = pt(R_OUT, a1), o2 = pt(R_OUT, a2), i1 = pt(R_IN, a1), i2 = pt(R_IN, a2);
    var l = pt((R_OUT + R_IN) / 2, mid);
    var half = 15 * Math.PI / 180, rMid = (R_OUT + R_IN) / 2;
    var iw = 2 * R_OUT * Math.sin(half), ih = R_OUT - R_IN * Math.cos(half);
    var tr = 90 - mid; tr = ((tr + 180) % 360 + 360) % 360 - 180;
    var tRot = Math.abs(tr) > 90 ? tr + 180 : tr;
    return {
      i: i, name: s.name, art: s.art, lx: l[0], ly: l[1],
      ax: l[0] - iw / 2, ay: l[1] - (R_OUT - rMid), aw: iw, ah: ih,
      rot: "rotate(" + f2(90 - mid) + " " + f2(l[0]) + " " + f2(l[1]) + ")",
      textRot: "rotate(" + f2(tRot) + " " + f2(l[0]) + " " + f2(l[1]) + ")",
      wedge: "M" + o1[0] + " " + o1[1] + "A" + R_OUT + " " + R_OUT + " 0 0 0 " + o2[0] + " " + o2[1] +
        "L" + i2[0] + " " + i2[1] + "A" + R_IN + " " + R_IN + " 0 0 1 " + i1[0] + " " + i1[1] + "Z"
    };
  });

  /* ---- 背景细星 ---- */
  var stars = [], seed = 20260823;
  function rnd() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }
  for (var si = 0; si < 70; si++) {
    var sa = rnd() * 360, sr = R_IN + 8 + rnd() * (R_OUT - R_IN - 16), sp = pt(sr, sa);
    stars.push({ cx: sp[0], cy: sp[1], r: (0.9 + rnd() * 1.8).toFixed(2), o: (0.35 + rnd() * 0.5).toFixed(2) });
  }

  /* ---- 宫位线 / 宫位号 / 四轴 ---- */
  var houseLines = cusps.map(function (c, i) {
    var a = ang(c), p1 = pt(R_ASP, a), p2 = pt(R_IN, a), card = (i % 3 === 0);
    return { x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1], stroke: card ? "rgba(240,222,166,.72)" : "rgba(226,196,133,.44)", w: card ? 1.7 : 1.3 };
  });
  var houseNums = cusps.map(function (c, i) {
    var span = n360(cusps[(i + 1) % 12] - c) || 30, p = pt(R_HOUSE_NUM, ang(c + span / 2));
    return { n: String(i + 1), x: p[0], y: p[1] };
  });
  var axes = [
    { label: "ASC", lon: asc }, { label: "DSC", lon: n360(asc + 180) },
    { label: "MC", lon: mc }, { label: "IC", lon: n360(mc + 180) }
  ].map(function (a) {
    var th = ang(a.lon), p1 = pt(R_ASP, th), p2 = pt(R_OUT + 4, th), tp = pt(R_OUT + 40, th);
    return { label: a.label, x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1], tx: tp[0], ty: tp[1] };
  });

  /* ---- 行星（防重叠展开） ---- */
  var raw = (chart.planets || []).filter(function (p) { return BODIES[p.key]; });
  var withAng = raw.map(function (p, i) {
    var h = (p.house >= 1 && p.house <= 12) ? p.house : houseOf(p.lon);   // 以应用算出的宫位为准
    return { i: i, key: p.key, lon: n360(p.lon), retro: !!p.retro, house: h, theta: n360(ang(p.lon)) };
  });
  /* 展开只在「本宫」内进行：行星落第几宫，就必须画在第几宫的扇形里 */
  var SEP = 8, angByIdx = {};
  var byHouse = {};
  withAng.forEach(function (p) {
    var h = p.house - 1;
    (byHouse[h] || (byHouse[h] = [])).push(p);
  });
  Object.keys(byHouse).forEach(function (hk) {
    var h = +hk, grp = byHouse[h];
    var span = n360(cusps[(h + 1) % 12] - cusps[h]) || 30;
    var a0 = ang(cusps[h]), m = Math.min(4, span / 6);
    var lo = a0 + m, hi = a0 + span - m, room = hi - lo;
    grp.sort(function (x, y) { return n360(x.lon - cusps[h]) - n360(y.lon - cusps[h]); });
    var n = grp.length;
    if (n === 1) { angByIdx[grp[0].i] = a0 + n360(grp[0].lon - cusps[h]); return; }
    if ((n - 1) * SEP >= room) {
      grp.forEach(function (p, k) { angByIdx[p.i] = lo + room * (k / (n - 1)); });
      return;
    }
    var t = grp.map(function (p) {
      return Math.min(hi, Math.max(lo, a0 + n360(p.lon - cusps[h])));
    });
    for (var pass = 0; pass < 4; pass++) {
      for (var k = 1; k < n; k++) if (t[k] - t[k - 1] < SEP) t[k] = t[k - 1] + SEP;
      var over = t[n - 1] - hi;
      if (over > 0) for (var k2 = 0; k2 < n; k2++) t[k2] = Math.max(lo, t[k2] - over);
    }
    grp.forEach(function (p, k) { angByIdx[p.i] = t[k]; });
  });

  var planets = withAng.map(function (p) {
    var b = BODIES[p.key], q = pt(R_PLANET, angByIdx[p.i]);
    var fr = FRAC[p.key] || { f: .7, cx: .5, cy: .5 }, size = 40 / fr.f;
    var signIdx = Math.floor(p.lon / 30);
    return {
      i: p.i, art: ART[p.key], size: size, house: p.house,
      tx1: pt(R_IN - 4, ang(p.lon))[0], ty1: pt(R_IN - 4, ang(p.lon))[1],
      tx2: pt(R_PLANET + 26, ang(p.lon))[0], ty2: pt(R_PLANET + 26, ang(p.lon))[1],
      tx3: pt(R_PLANET + 26, angByIdx[p.i])[0], ty3: pt(R_PLANET + 26, angByIdx[p.i])[1],
      ax: q[0] - size / 2 + (0.5 - fr.cx) * size, ay: q[1] - size / 2 + (0.5 - fr.cy) * size,
      x: q[0], y: q[1], retro: p.retro,
      tipT: b.name + " · " + SIGNS[signIdx].name + " " + Math.floor(p.lon % 30) + "°",
      tipB: "第 " + p.house + " 宫 · " + b.kw + (p.retro ? " · 逆行" : "")
    };
  });

  var aspects = (chart.aspects || []).map(function (a, i) {
    var pa = withAng[a.a], pb = withAng[a.b];
    if (!pa || !pb) return null;
    var st = ASP[a.type] || ASP.con;
    var p1 = pt(R_ASP - 4, angByIdx[pa.i]), p2 = pt(R_ASP - 4, angByIdx[pb.i]);
    return {
      i: i, x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1], stroke: st.stroke, dash: st.dash, w: st.w + .4,
      tipT: BODIES[pa.key].name + " " + (a.name || st.name) + " " + BODIES[pb.key].name,
      tipB: "误差 " + (a.orb == null ? "—" : Number(a.orb).toFixed(1) + "°")
    };
  }).filter(Boolean);

  /* ---- SVG ---- */
  function svgMarkup() {
    var o = ['<svg viewBox="-72 -72 1144 1144" aria-label="我的星盘">',
      '<defs>',
      '<radialGradient id="iskyRim" cx="50%" cy="50%" r="50%">',
      '<stop offset="74%" stop-color="#d9c7f2" stop-opacity="0"></stop>',
      '<stop offset="88%" stop-color="#e7d5b4" stop-opacity=".16"></stop>',
      '<stop offset="95%" stop-color="#e7d5b4" stop-opacity=".22"></stop>',
      '<stop offset="100%" stop-color="#c9b6ea" stop-opacity="0"></stop></radialGradient>',
      '<radialGradient id="iskyBand" cx="50%" cy="50%" r="50%">',
      '<stop offset="70%" stop-color="#efe3c9" stop-opacity=".5"></stop>',
      '<stop offset="100%" stop-color="#b9a3dd" stop-opacity=".85"></stop></radialGradient>',
      '<radialGradient id="iskyCore" cx="50%" cy="50%" r="50%">',
      '<stop offset="0%" stop-color="#2b1e55" stop-opacity=".95"></stop>',
      '<stop offset="100%" stop-color="#1b1338" stop-opacity=".45"></stop></radialGradient>',
      '<filter id="iskySoft" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="14"></feGaussianBlur></filter>'];
    signs.forEach(function (s) {
      o.push('<clipPath id="iskyClip' + s.i + '"><path d="' + s.wedge + '"></path></clipPath>');
    });
    o.push('</defs>');

    o.push('<circle cx="500" cy="500" r="492" fill="url(#iskyRim)" opacity=".85" filter="url(#iskySoft)"></circle>');
    o.push('<circle cx="500" cy="500" r="440" fill="url(#iskyBand)" opacity=".28"></circle>');
    signs.forEach(function (s) {
      o.push('<path class="isky-wedge" data-sign="' + s.i + '" d="' + s.wedge + '" fill="transparent" stroke="rgba(226,196,133,.5)" stroke-width="1.6" style="cursor:pointer"></path>');
    });
    stars.forEach(function (st) {
      o.push('<circle cx="' + f2(st.cx) + '" cy="' + f2(st.cy) + '" r="' + st.r + '" fill="#fff8e6" opacity="' + st.o + '"></circle>');
    });
    o.push('<circle cx="500" cy="500" r="320" fill="url(#iskyCore)" opacity=".2"></circle>');
    o.push('<circle cx="500" cy="500" r="448" fill="none" stroke="rgba(226,196,133,.4)" stroke-width="1.6"></circle>');
    o.push('<circle cx="500" cy="500" r="440" fill="none" stroke="rgba(232,203,142,.72)" stroke-width="2"></circle>');
    o.push('<circle cx="500" cy="500" r="348" fill="none" stroke="rgba(232,203,142,.7)" stroke-width="2"></circle>');
    o.push('<circle cx="500" cy="500" r="320" fill="none" stroke="rgba(226,196,133,.34)" stroke-width="1.4"></circle>');
    o.push('<circle cx="500" cy="500" r="192" fill="none" stroke="rgba(226,196,133,.42)" stroke-width="1.6"></circle>');

    signs.forEach(function (s) {
      o.push('<g clip-path="url(#iskyClip' + s.i + ')"><image class="isky-art" data-sign="' + s.i + '" href="' + s.art + '" x="' + f2(s.ax) + '" y="' + f2(s.ay) + '" width="' + f2(s.aw) + '" height="' + f2(s.ah) + '" transform="' + s.rot + '" opacity=".16" preserveAspectRatio="xMidYMid slice"></image></g>');
    });
    signs.forEach(function (s) {
      o.push('<g transform="' + s.textRot + '" style="pointer-events:none"><text class="isky-signtext" data-sign="' + s.i + '" x="' + f2(s.lx) + '" y="' + f2(s.ly) + '" text-anchor="middle" dominant-baseline="middle" fill="#e6c489" style="font-size:34px;letter-spacing:.08em;font-weight:400;paint-order:stroke;stroke:rgba(16,10,38,.5);stroke-width:5px;stroke-linejoin:round">' + esc(s.name) + '</text></g>');
    });

    houseLines.forEach(function (h) {
      o.push('<line x1="' + f2(h.x1) + '" y1="' + f2(h.y1) + '" x2="' + f2(h.x2) + '" y2="' + f2(h.y2) + '" stroke="' + h.stroke + '" stroke-width="' + h.w + '"></line>');
    });
    houseNums.forEach(function (h) {
      o.push('<text x="' + f2(h.x) + '" y="' + f2(h.y) + '" text-anchor="middle" dominant-baseline="middle" fill="rgba(226,196,133,.78)" style="font-size:34px;pointer-events:none">' + h.n + '</text>');
    });
    axes.forEach(function (a) {
      o.push('<line x1="' + f2(a.x1) + '" y1="' + f2(a.y1) + '" x2="' + f2(a.x2) + '" y2="' + f2(a.y2) + '" stroke="rgba(248,228,168,.95)" stroke-width="1.7" stroke-dasharray="7 7"></line>');
      o.push('<text x="' + f2(a.tx) + '" y="' + f2(a.ty) + '" text-anchor="middle" dominant-baseline="middle" fill="#e6c489" style="font-size:32px;letter-spacing:.16em;font-weight:500;pointer-events:none">' + a.label + '</text>');
    });

    o.push('<g id="iskyAspects" style="transition:opacity .35s">');
    aspects.forEach(function (a) {
      o.push('<line class="isky-asp" data-asp="' + a.i + '" x1="' + f2(a.x1) + '" y1="' + f2(a.y1) + '" x2="' + f2(a.x2) + '" y2="' + f2(a.y2) + '" stroke="' + a.stroke + '" stroke-width="' + a.w + '" stroke-dasharray="' + a.dash + '" opacity=".8" style="cursor:crosshair;transition:opacity .2s,stroke-width .2s"></line>');
    });
    o.push('</g>');

    o.push('<g style="animation:iskyTwinkle 7s ease-in-out infinite">');
    o.push('<circle cx="500" cy="500" r="46" fill="#efe0c4" opacity=".35" filter="url(#iskySoft)"></circle>');
    o.push('<path d="M500 456a44 44 0 1 0 0 88 34 34 0 1 1 0-88z" fill="#f2e7d0" opacity=".45"></path></g>');

    planets.forEach(function (p) {
      o.push('<path d="M' + f2(p.tx1) + ' ' + f2(p.ty1) + 'L' + f2(p.tx2) + ' ' + f2(p.ty2) + 'L' + f2(p.tx3) + ' ' + f2(p.ty3) + '" fill="none" stroke="rgba(232,203,142,.5)" stroke-width="1.2" style="pointer-events:none"></path>');
      o.push('<image class="isky-planet" data-planet="' + p.i + '" href="' + p.art + '" x="' + f2(p.ax) + '" y="' + f2(p.ay) + '" width="' + f2(p.size) + '" height="' + f2(p.size) + '" preserveAspectRatio="xMidYMid meet" style="cursor:pointer"></image>');
      if (p.retro) o.push('<text x="' + f2(p.x) + '" y="' + f2(p.y + 44) + '" text-anchor="middle" fill="#f7e2ac" style="font-size:26px;pointer-events:none">R</text>');
    });
    o.push('</svg>');
    return o.join("");
  }

  root.innerHTML = svgMarkup() + '<div class="isky-layer" id="iskyLayer"></div>';
  var layer = document.getElementById("iskyLayer");
  var svg = root.querySelector("svg");

  function showTip(t, b) {
    layer.innerHTML = '<div class="isky-tip"><div class="t">' + esc(t) + '</div><div class="b">' + esc(b) + '</div></div>';
  }
  function clearLayer() { layer.innerHTML = ""; }

  function setSignDim(open) {
    signs.forEach(function (s) {
      var art = svg.querySelector('.isky-art[data-sign="' + s.i + '"]');
      var txt = svg.querySelector('.isky-signtext[data-sign="' + s.i + '"]');
      var on = open === null || open === s.i;
      if (art) art.setAttribute("opacity", open === null ? ".16" : (on ? ".32" : ".08"));
      if (txt) txt.setAttribute("opacity", open === null ? "1" : (on ? "1" : ".45"));
    });
  }

  function openSign(i) {
    state.openSign = i;
    setSignDim(i);
    var s = SIGNS[i];
    var houseIdx = -1;
    for (var h = 0; h < 12; h++) {
      var c = cusps[h], nx = cusps[(h + 1) % 12], mid = n360(i * 30 + 15);
      if (n360(mid - c) < (n360(nx - c) || 30)) { houseIdx = h; break; }
    }
    var inside = withAng.filter(function (p) { return Math.floor(p.lon / 30) === i; })
      .map(function (p) { return BODIES[p.key].name + " " + Math.floor(p.lon % 30) + "°"; });
    layer.innerHTML = '<div class="isky-sign"><div class="row"><div class="ttl">' +
      '<span class="thumb" style="background-image:url(\'' + s.art + '\')"></span>' + esc(s.name) +
      '</div><button class="x" type="button" aria-label="关闭">✕</button></div>' +
      '<p class="meta">' + esc(s.elem + "象 · " + s.mode + " · 守护星 " + s.ruler + (houseIdx >= 0 ? " · 落第 " + (houseIdx + 1) + " 宫" : "")) + '</p>' +
      '<div class="body">' + esc(inside.length ? "这个星座里的星体：" + inside.join("、") + "。"
        : "这个星座里没有星体，它的能量通过守护星 " + s.ruler + " 表达。") + '</div></div>';
    layer.querySelector(".x").addEventListener("click", function () {
      state.openSign = null; setSignDim(null); clearLayer();
    });
  }

  svg.addEventListener("mouseover", function (e) {
    var t = e.target;
    if (state.openSign !== null) return;
    if (t.classList.contains("isky-planet")) {
      var p = planets[+t.getAttribute("data-planet")];
      if (p) showTip(p.tipT, p.tipB);
    } else if (t.classList.contains("isky-asp")) {
      var i = +t.getAttribute("data-asp"), a = aspects[i];
      state.hoverAsp = i;
      svg.querySelectorAll(".isky-asp").forEach(function (l) {
        var hot = +l.getAttribute("data-asp") === i;
        l.setAttribute("opacity", hot ? "1" : ".22");
        l.setAttribute("stroke-width", hot ? String(aspects[+l.getAttribute("data-asp")].w + 1) : String(aspects[+l.getAttribute("data-asp")].w));
      });
      if (a) showTip(a.tipT, a.tipB);
    }
  });
  svg.addEventListener("mouseout", function (e) {
    var t = e.target;
    if (t.classList.contains("isky-planet") || t.classList.contains("isky-asp")) {
      if (state.hoverAsp !== null) {
        state.hoverAsp = null;
        svg.querySelectorAll(".isky-asp").forEach(function (l) {
          l.setAttribute("opacity", ".8");
          l.setAttribute("stroke-width", String(aspects[+l.getAttribute("data-asp")].w));
        });
      }
      if (state.openSign === null) clearLayer();
    }
  });
  svg.addEventListener("click", function (e) {
    var w = e.target.closest ? e.target.closest(".isky-wedge") : null;
    if (!w) return;
    var i = +w.getAttribute("data-sign");
    if (state.openSign === i) { state.openSign = null; setSignDim(null); clearLayer(); }
    else openSign(i);
  });

  var toggle = document.getElementById("iskyToggle");
  if (toggle) {
    toggle.addEventListener("click", function () {
      state.aspectsOn = !state.aspectsOn;
      var g = document.getElementById("iskyAspects");
      if (g) g.setAttribute("opacity", state.aspectsOn ? "1" : "0");
      toggle.textContent = state.aspectsOn ? "隐藏相位线" : "显示相位线";
    });
  }

  var legend = document.getElementById("iskyLegend");
  if (legend) {
    legend.innerHTML = ORDER.map(function (k) {
      var fr = FRAC[k] || { f: .7 };
      return '<div class="it"><div class="ic" style="background-image:url(\'' + ART[k] + '\');transform:scale(' + (0.62 / fr.f).toFixed(2) + ')"></div>' +
        '<div class="nm">' + esc(BODIES[k].name) + '</div><div class="kw">' + esc(BODIES[k].kw) + '</div></div>';
    }).join("");
  }
})();
