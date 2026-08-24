/* ============================================================
   tools/gen-ephem-minor.js
   生成 assets/astro/ephem-minor.js —— 小天体(凯龙 / 四小行星 /
   爱神 / 赛姬 / 阋神)的 Chebyshev 星历表。

   方法
   ─────
   1. 起始状态向量(日心 · 赤道 J2000 · AU / AU per day):
      · Chiron / Ceres / Pallas / Juno / Vesta
        取自 Swiss Ephemeris(tools/seed-states.json,由 pyswisseph 导出)
      · Eros433 / Psyche16 / Eris
        由 JPL 密切轨道根数在其历元转成状态向量
   2. 用 astronomy-engine 的 GravitySimulator(太阳 + 八大行星 + 冥王星
      的 N 体积分)以 1 日步长正推到 2100、逆推到 1900。
   3. 每 SEG 天为一段,在 Chebyshev 节点上取值,拟合 DEG 次多项式。
   4. 输出到 assets/astro/ephem-minor.js。

   校验:tests/ 里的 Astro-Seek(Swiss Ephemeris)对照测试。

   用法:node tools/gen-ephem-minor.js
   ============================================================ */
"use strict";
const fs = require("fs");
const path = require("path");
const A = require("astronomy-engine");

const OUT = path.join(__dirname, "..", "assets", "astro", "ephem-minor.js");
const SWISS = JSON.parse(fs.readFileSync(path.join(__dirname, "ephem-swiss.json"), "utf8"));

const JD0 = 2451545.0;                 // J2000.0
const START_TT = jdToTT(2415020.5);    // 1900-01-01
const END_TT   = jdToTT(2488070.5);    // 2100-01-01
const SEG = 800;                       // 每段天数
const DEG = 12;                        // Chebyshev 次数
const STEP = 1.0;                      // 积分步长(日)

function jdToTT(jd) { return jd - JD0; }

/* ---------- JPL 密切轨道根数(黄道 J2000, 度 / AU) ----------
   与 app.html 里原有的一致,只用来给 N 体积分提供起点。 */
const ELEMENTS = {
  Eros433:  { jd: 2460000.5, a: 1.45812914,  e: 0.22278189, i: 10.82782330, om: 304.28704012, w: 178.92699518, M: 110.77765267 },
  Psyche16: { jd: 2460000.5, a: 2.92414501,  e: 0.13411742, i: 3.09684542,  om: 150.03080705, w: 229.32824982, M: 203.81918295 },
  Eris:     { jd: 2461000.5, a: 67.99638658, e: 0.43696497, i: 43.86893126, om: 36.02717322,  w: 150.73228552, M: 211.44938911 }
};
const D2R = Math.PI / 180;
const GAUSS_K = 0.01720209895;           // 高斯引力常数 (AU^1.5 / day)
const OBL_J2000 = 84381.406 / 3600 * D2R;
const CE = Math.cos(OBL_J2000), SE = Math.sin(OBL_J2000);

/* 密切根数 → 日心赤道 J2000 状态向量 */
function elementsToState(el) {
  const n = GAUSS_K / Math.pow(el.a, 1.5);              // rad/day
  const M = (el.M * D2R) % (2 * Math.PI);
  let E = M;
  for (let k = 0; k < 60; k++) {
    const dE = (E - el.e * Math.sin(E) - M) / (1 - el.e * Math.cos(E));
    E -= dE;
    if (Math.abs(dE) < 1e-14) break;
  }
  const cosE = Math.cos(E), sinE = Math.sin(E);
  const b = el.a * Math.sqrt(1 - el.e * el.e);
  // 轨道平面内位置 / 速度
  const px = el.a * (cosE - el.e), py = b * sinE;
  const eDot = n / (1 - el.e * cosE);
  const vx = -el.a * sinE * eDot, vy = b * cosE * eDot;
  const w = el.w * D2R, om = el.om * D2R, inc = el.i * D2R;
  const cw = Math.cos(w), sw = Math.sin(w), co = Math.cos(om), so = Math.sin(om);
  const ci = Math.cos(inc), si = Math.sin(inc);
  // 近点幅角 → 黄道 J2000
  const R = [
    [co * cw - so * sw * ci, -co * sw - so * cw * ci],
    [so * cw + co * sw * ci, -so * sw + co * cw * ci],
    [sw * si,                 cw * si]
  ];
  const ecl = (q1, q2) => [R[0][0] * q1 + R[0][1] * q2, R[1][0] * q1 + R[1][1] * q2, R[2][0] * q1 + R[2][1] * q2];
  const p = ecl(px, py), v = ecl(vx, vy);
  // 黄道 J2000 → 赤道 J2000
  const rot = ([x, y, z]) => [x, y * CE - z * SE, y * SE + z * CE];
  return { p: rot(p), v: rot(v), tt: jdToTT(el.jd) };
}

/* ---------- 起点集合(只有 N 体积分的三颗需要) ---------- */
const SEEDS = {};
for (const k of Object.keys(ELEMENTS)) SEEDS[k] = elementsToState(ELEMENTS[k]);

// Swiss Ephemeris 直接给系数的天体(精度最高)
const SWISS_BODIES = ["Chiron", "Ceres", "Pallas", "Juno", "Vesta"];
// 没有 Swiss 星历文件、改用 JPL 密切根数 + N 体积分的天体
const NBODY_BODIES = ["Eros433", "Psyche16", "Eris"];

/* ---------- 用 GravitySimulator 采样一个天体的日心位置 ---------- */
function sampleBody(key) {
  const seed = SEEDS[key];
  const t0 = A.MakeTime(seed.tt);
  const sv = new A.StateVector(seed.p[0], seed.p[1], seed.p[2], seed.v[0], seed.v[1], seed.v[2], t0);

  // 采样点:所有段的所有 Chebyshev 节点(按时间排序)
  const nSeg = Math.ceil((END_TT - START_TT) / SEG);
  const nodes = [];
  for (let s = 0; s < nSeg; s++) {
    const a = START_TT + s * SEG, b2 = a + SEG;
    for (let j = DEG; j >= 0; j--) {                       // cos 节点由大到小 → 时间由小到大
      const x = Math.cos(Math.PI * (j + 0.5) / (DEG + 1));
      nodes.push({ seg: s, j: DEG - j, tt: (a + b2) / 2 + x * SEG / 2 });
    }
  }
  nodes.sort((p, q) => p.tt - q.tt);

  const values = new Array(nodes.length);
  // 逆推(seed → 1900)与正推(seed → 2100)分别用一个模拟器
  const back = nodes.filter(n => n.tt <= seed.tt).sort((p, q) => q.tt - p.tt);
  const fwd  = nodes.filter(n => n.tt >  seed.tt).sort((p, q) => p.tt - q.tt);
  const idx = new Map(nodes.map((n, i) => [n, i]));

  for (const [list, sim] of [[back, new A.GravitySimulator(A.Body.Sun, t0, [sv])],
                             [fwd,  new A.GravitySimulator(A.Body.Sun, t0, [sv])]]) {
    let cur = seed.tt;
    for (const nd of list) {
      const dir = Math.sign(nd.tt - cur) || 1;
      while (Math.abs(nd.tt - cur) > STEP) {
        cur += dir * STEP;
        sim.Update(A.MakeTime(cur));
      }
      cur = nd.tt;
      const st = sim.Update(A.MakeTime(cur))[0];
      values[idx.get(nd)] = [st.x, st.y, st.z];
    }
  }
  return { nSeg, nodes, values, idx };
}

/* ---------- Chebyshev 拟合 ---------- */
function fitSegment(vals) {
  // vals[j] = 节点 j(时间升序)的坐标值;返回 DEG+1 个系数
  const N = DEG + 1;
  const c = new Array(N).fill(0);
  for (let k = 0; k < N; k++) {
    let s = 0;
    for (let j = 0; j < N; j++) {
      // 节点 j 对应 x = cos(pi*(N-1-j+0.5)/N)
      const x = Math.cos(Math.PI * (N - 1 - j + 0.5) / N);
      s += vals[j] * Math.cos(k * Math.acos(Math.max(-1, Math.min(1, x))));
    }
    c[k] = (2 / N) * s;
  }
  c[0] /= 2;
  return c;
}

function build() {
  const out = {};
  const angles = SWISS.angles || {};
  // 1) Swiss Ephemeris 拟合结果直接并入
  for (const key of SWISS_BODIES) {
    if (!SWISS.bodies[key]) throw new Error("ephem-swiss.json 缺少 " + key + ",请先跑 tools/gen-ephem-swiss.py");
    out[key] = SWISS.bodies[key];
    process.stderr.write("  " + key + " … swiss, " + out[key].length + " segs\n");
  }
  if (SWISS.meta.seg !== SEG || SWISS.meta.deg !== DEG || SWISS.meta.startTT !== START_TT)
    throw new Error("ephem-swiss.json 的分段参数与本脚本不一致");

  // 2) 其余用 GravitySimulator 积分
  for (const key of NBODY_BODIES) {
    process.stderr.write("  " + key + " …");
    const t = Date.now();
    const { nSeg, nodes, values, idx } = sampleBody(key);
    const segs = [];
    for (let s = 0; s < nSeg; s++) {
      const rows = nodes.filter(n => n.seg === s).sort((p, q) => p.j - q.j);
      const coef = [];
      for (let d = 0; d < 3; d++) {
        const vals = rows.map(r => values[idx.get(r)][d]);
        coef.push(fitSegment(vals).map(v => Number(v.toPrecision(11))));
      }
      segs.push(coef);
    }
    out[key] = segs;
    process.stderr.write(" " + nSeg + " segs, " + ((Date.now() - t) / 1000).toFixed(1) + "s\n");
  }

  const header =
`/* ============================================================
   assets/astro/ephem-minor.js  —— 自动生成,请勿手改
   由 tools/gen-ephem-minor.js 产生。

   内容:小天体的日心「赤道 J2000」直角坐标(AU)Chebyshev 星历。
   天体:凯龙星 · 谷神星 · 智神星 · 婚神星 · 灶神星 ·
         爱神星(433) · 赛姬星(16) · 阋神星(136199)
   另含 angles:月亮真交点 / 平交点 / 平黑月莉莉丝 / 真(密切)莉莉丝
        的「当日真黄道黄经」序列(度,已解卷绕),同样由 Swiss 拟合。
   区间:1900-01-01 ~ 2100-01-01(TT)
   分段:每 ${SEG} 天一段,${DEG} 次 Chebyshev。
   精度:凯龙 / 四小行星直接由 Swiss Ephemeris 拟合,< 1 角秒;
         爱神 · 赛姬 · 阋神以 JPL 密切根数为起点做 N 体积分,
         量级约 1 角分,详见 assets/astro/CALCULATION.md。
   生成时间:${new Date().toISOString()}
   ============================================================ */
(function (root) {
  "use strict";
  var EPHEM = {
    jd0: ${JD0},
    startTT: ${START_TT},
    endTT: ${END_TT},
    seg: ${SEG},
    deg: ${DEG},
    angles: __ANGLES__,
    bodies: `;

  const body = JSON.stringify(out);
  const tail = `
  };
  if (typeof module === "object" && module.exports) module.exports = EPHEM;
  else root.InnerSkyEphemMinor = EPHEM;
})(typeof globalThis !== "undefined" ? globalThis : this);
`;
  fs.writeFileSync(OUT, header.replace("__ANGLES__", JSON.stringify(angles)) + body + tail);
  const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
  process.stderr.write("written " + OUT + " (" + kb + " KB)\n");
}

build();
