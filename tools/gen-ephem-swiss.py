#!/usr/bin/env python3
"""tools/gen-ephem-swiss.py

用 Swiss Ephemeris(pyswisseph)为凯龙星与四颗主要小行星拟合
Chebyshev 星历系数,输出 tools/ephem-swiss.json,再由
tools/gen-ephem-minor.js 合并成 assets/astro/ephem-minor.js。

采样量:日心「赤道 J2000」直角坐标(AU)。这样浏览器端只要
减去地球日心位置、做光行时与光行差改正,再转到当日真黄道,
就能得到与 Astro-Seek 同源的视黄经。

需要 ephe/ 目录下的 seas_18.se1(以及 sepl_18.se1 / semo_18.se1)。
用法:python3 tools/gen-ephem-swiss.py [ephe_dir]
"""
import json, math, os, sys
import swisseph as swe

EPHE = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "ephe")
swe.set_ephe_path(EPHE)

JD0 = 2451545.0
START_TT = 2415020.5 - JD0      # 1900-01-01
END_TT = 2488070.5 - JD0        # 2100-01-01
SEG = 800
DEG = 12

BODIES = {
    "Chiron": swe.CHIRON,
    "Ceres": swe.CERES,
    "Pallas": swe.PALLAS,
    "Juno": swe.JUNO,
    "Vesta": swe.VESTA,
}
# TRUEPOS/NOABERR/NOGDEFL:要的是几何位置。浏览器端自己做光行时与光行差,
# 若这里已经带上 Swiss 的「从太阳看过去」光行时改正,结果会偏出十几角秒。
FLAGS = (swe.FLG_SWIEPH | swe.FLG_HELCTR | swe.FLG_J2000 |
         swe.FLG_XYZ | swe.FLG_EQUATORIAL |
         swe.FLG_TRUEPOS | swe.FLG_NOABERR | swe.FLG_NOGDEFL)


def helio_xyz(jd_tt, body):
    # calc() 接受 TT;我们的时间轴就是 TT,不做 UT 换算
    return swe.calc(jd_tt, body, FLAGS)[0][:3]


# 直接按「当日真黄道黄经」拟合的点(月亮交点 / 黑月莉莉丝)。
# 这些量本身就是角度,拟合前先解卷绕(unwrap)成连续函数。
# 只放「变化平缓」的量。真交点与密切莉莉丝振荡太快,800 天一段的
# Chebyshev 拟不住(实测差到 1°),改在前端直接由月亮状态向量算密切轨道根数,
# 见 astro-core.js 的 trueNodeLon()。
ANGLE_POINTS = {
    "MeanNode": swe.MEAN_NODE,
    "MeanLilith": swe.MEAN_APOG,
}


def cheb_fit(vals):
    n = DEG + 1
    coef = []
    for k in range(n):
        s = 0.0
        for j in range(n):
            x = math.cos(math.pi * (n - 1 - j + 0.5) / n)
            s += vals[j] * math.cos(k * math.acos(max(-1.0, min(1.0, x))))
        coef.append((2.0 / n) * s)
    coef[0] /= 2.0
    return coef


def main():
    n_seg = math.ceil((END_TT - START_TT) / SEG)
    out = {}
    for name, body in BODIES.items():
        segs = []
        for s in range(n_seg):
            a = START_TT + s * SEG
            mid, half = a + SEG / 2.0, SEG / 2.0
            samples = []
            for j in range(DEG + 1):
                # 时间升序的节点
                x = math.cos(math.pi * (DEG - j + 0.5) / (DEG + 1))
                samples.append(helio_xyz(mid + x * half + JD0, body))
            coefs = [[float("%.11g" % c) for c in cheb_fit([p[d] for p in samples])]
                     for d in range(3)]
            segs.append(coefs)
        out[name] = segs
        sys.stderr.write("  %-8s %d segs\n" % (name, n_seg))

    # ---- 角度序列(交点 / 莉莉丝):直接拟合当日真黄道黄经 ----
    angles = {}
    for name, body in ANGLE_POINTS.items():
        segs = []
        prev = None
        base = 0.0
        for s in range(n_seg):
            a = START_TT + s * SEG
            mid, half = a + SEG / 2.0, SEG / 2.0
            # 节点按时间升序,解卷绕要按时间顺序推进
            vals = []
            for j in range(DEG + 1):
                x = math.cos(math.pi * (DEG - j + 0.5) / (DEG + 1))
                lon = swe.calc(mid + x * half + JD0, body, swe.FLG_SWIEPH)[0][0]
                if prev is not None:
                    while lon + base - prev > 180.0:
                        base -= 360.0
                    while lon + base - prev < -180.0:
                        base += 360.0
                prev = lon + base
                vals.append(prev)
            segs.append([float("%.11g" % c) for c in cheb_fit(vals)])
        angles[name] = segs
        sys.stderr.write("  %-10s %d segs (angle)\n" % (name, n_seg))

    meta = {"jd0": JD0, "startTT": START_TT, "endTT": END_TT, "seg": SEG, "deg": DEG,
            "source": "Swiss Ephemeris (pyswisseph %s)" % swe.version}
    dest = os.path.join(os.path.dirname(__file__), "ephem-swiss.json")
    with open(dest, "w") as f:
        json.dump({"meta": meta, "bodies": out, "angles": angles}, f)
    sys.stderr.write("written %s\n" % dest)


if __name__ == "__main__":
    main()
