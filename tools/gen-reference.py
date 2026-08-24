#!/usr/bin/env python3
"""tools/gen-reference.py

产生 tests/reference/cases.json —— Astro-Seek 校准用的对照答案。

Astro-Seek 用的是 Swiss Ephemeris,所以这里直接用 pyswisseph
(同一套 Swiss Ephemeris)在相同设置下算出「标准答案」:
    回归黄道 · Placidus · 真交点 · 平均黑月莉莉丝
时区独立用 Python 的 zoneinfo(IANA tzdb)换算,和前端走的
Intl/ICU 是两套实作,两边对上才算数。

这不是把 Astro-Seek 的数字硬写进来 —— 案例是重新算的,
可以随时换日期重跑。

前置:
  pip install pyswisseph
  ephe/ 放 sepl_18.se1 / semo_18.se1 / seas_18.se1
用法:
  python3 tools/gen-reference.py [ephe_dir]
"""
import json, os, sys
from datetime import datetime
from zoneinfo import ZoneInfo
import swisseph as swe

EPHE = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "ephe")
swe.set_ephe_path(EPHE)

# 覆盖:马来西亚 / 新加坡 / 台湾 / 日本 / 欧洲 / 美国 / 澳洲,
#      有夏令时与无夏令时、不同年代、午夜前后、南半球、高纬度。
CASES = [
    # name,                         date,        time,   tz,                    lat,      lon
    ("Batu Pahat 1994 (原始案例)",   "1994-11-21", "01:44", "Asia/Kuala_Lumpur",   1.8548,  102.9325),
    ("Kuala Lumpur 1978 (UTC+7:30)", "1978-05-09", "14:20", "Asia/Kuala_Lumpur",   3.1412,  101.6865),
    ("Johor Bahru 1982 换时区当天",   "1982-01-01", "00:30", "Asia/Kuala_Lumpur",   1.4655,  103.7578),
    ("Singapore 1965",              "1965-08-09", "09:00", "Asia/Singapore",      1.2897,  103.8501),
    ("Singapore 2003 午夜前",        "2003-12-31", "23:58", "Asia/Singapore",      1.2897,  103.8501),
    ("Taipei 1975 夏令时",           "1975-07-15", "05:10", "Asia/Taipei",        25.0478,  121.5319),
    ("Taipei 2001 无夏令时",         "2001-03-03", "18:45", "Asia/Taipei",        25.0478,  121.5319),
    ("Tokyo 1949 战后夏令时",        "1949-08-20", "22:05", "Asia/Tokyo",         35.6895,  139.6917),
    ("Tokyo 1988",                  "1988-02-29", "06:00", "Asia/Tokyo",         35.6895,  139.6917),
    ("Hong Kong 1960 夏令时",        "1960-06-21", "12:00", "Asia/Hong_Kong",     22.2783,  114.1747),
    ("Shanghai 1988 夏令时",         "1988-07-20", "03:33", "Asia/Shanghai",      31.2222,  121.4581),
    ("Prague 1968",                 "1968-08-21", "04:00", "Europe/Prague",      50.0880,   14.4208),
    ("Prague 2016 夏令时",           "2016-06-15", "13:30", "Europe/Prague",      50.0880,   14.4208),
    ("London 1970",                 "1970-01-15", "00:05", "Europe/London",      51.5085,   -0.1257),
    ("Lisbon 1955 夏令时",           "1955-08-10", "13:00", "Europe/Lisbon",      38.7167,   -9.1333),
    ("Los Angeles 1975 夏令时",      "1975-07-04", "12:00", "America/Los_Angeles",34.0522, -118.2437),
    ("New York 1985 回拨重复时段",    "1985-10-27", "01:30", "America/New_York",   40.7143,  -74.0060),
    ("Phoenix 1990 不用夏令时",       "1990-09-09", "16:20", "America/Phoenix",    33.4484, -112.0740),
    ("Sydney 1990 南半球夏令时",      "1990-01-15", "14:00", "Australia/Sydney",  -33.8688,  151.2093),
    ("Perth 2007",                  "2007-11-11", "07:07", "Australia/Perth",   -31.9522,  115.8614),
    ("São Paulo 1998 南半球",        "1998-11-20", "23:40", "America/Sao_Paulo", -23.5475,  -46.6361),
    ("Reykjavík 2001 高纬度",        "2001-07-04", "09:15", "Atlantic/Reykjavik", 64.1355,  -21.8954),
    ("Tromsø 1993 极区 Placidus",    "1993-12-21", "11:00", "Europe/Oslo",        69.6496,   18.9560),
    ("Nairobi 1988 赤道附近",        "1988-09-09", "04:05", "Africa/Nairobi",     -1.2833,   36.8167),
    ("Kolkata 1972 半小时时区",       "1972-04-18", "20:50", "Asia/Kolkata",       22.5697,   88.3697),
    ("Kathmandu 1996 45 分钟时区",    "1996-10-02", "05:45", "Asia/Kathmandu",     27.7172,   85.3240),
]

PLANETS = [("Sun", swe.SUN), ("Moon", swe.MOON), ("Mercury", swe.MERCURY), ("Venus", swe.VENUS),
           ("Mars", swe.MARS), ("Jupiter", swe.JUPITER), ("Saturn", swe.SATURN),
           ("Uranus", swe.URANUS), ("Neptune", swe.NEPTUNE), ("Pluto", swe.PLUTO)]
POINTS = [("NNode", swe.TRUE_NODE), ("NNodeMean", swe.MEAN_NODE), ("Lilith", swe.MEAN_APOG),
          ("LilithTrue", swe.OSCU_APOG), ("Chiron", swe.CHIRON), ("Ceres", swe.CERES),
          ("Pallas", swe.PALLAS), ("Juno", swe.JUNO), ("Vesta", swe.VESTA)]


def build(case):
    name, date, time, tz, lat, lon = case
    y, mo, d = (int(x) for x in date.split("-"))
    hh, mi = (int(x) for x in time.split(":"))
    local = datetime(y, mo, d, hh, mi, tzinfo=ZoneInfo(tz))
    off = local.utcoffset()
    offset_minutes = int(off.total_seconds() // 60)
    utc = local.astimezone(ZoneInfo("UTC"))
    jd = swe.julday(utc.year, utc.month, utc.day, utc.hour + utc.minute / 60 + utc.second / 3600)

    flag = swe.FLG_SWIEPH | swe.FLG_SPEED
    out = {
        "name": name, "date": date, "time": time, "tz": tz, "lat": lat, "lon": lon,
        "expect": {
            "utc": utc.strftime("%Y-%m-%dT%H:%M:%S.000Z"),
            "utcOffsetMinutes": offset_minutes,
            "planets": {}, "points": {}, "cusps": [], "asc": None, "mc": None, "vertex": None
        }
    }
    for key, body in PLANETS:
        r = swe.calc_ut(jd, body, flag)[0]
        out["expect"]["planets"][key] = {"lon": r[0], "speed": r[3]}
    for key, body in POINTS:
        try:
            r = swe.calc_ut(jd, body, flag)[0]
            out["expect"]["points"][key] = {"lon": r[0], "speed": r[3]}
        except Exception as exc:
            out["expect"]["points"][key] = {"error": str(exc)}
    # 极区 Placidus 无解时 Swiss 会退回 Porphyry(pyswisseph 直接抛错),
    # 这里照同样规则取 Porphyry 当对照,前端也必须退回 Porphyry。
    used = "placidus"
    try:
        cusps, ascmc = swe.houses_ex(jd, lat, lon, b"P")
    except Exception:
        used = "porphyry"
        cusps, ascmc = swe.houses_ex(jd, lat, lon, b"O")
    out["expect"]["houseSystem"] = used
    out["expect"]["cusps"] = list(cusps)
    out["expect"]["asc"] = ascmc[0]
    out["expect"]["mc"] = ascmc[1]
    out["expect"]["armc"] = ascmc[2]
    out["expect"]["vertex"] = ascmc[3]
    out["expect"]["eastPoint"] = ascmc[4]
    return out


def main():
    data = {
        "generatedBy": "tools/gen-reference.py",
        "reference": "Swiss Ephemeris via pyswisseph %s (Astro-Seek 使用同一套星历)" % swe.version,
        "settings": {
            "zodiac": "tropical", "houseSystem": "Placidus",
            "node": "true", "lilith": "mean (SE_MEAN_APOG)",
            "timezone": "IANA tzdb via Python zoneinfo"
        },
        "cases": [build(c) for c in CASES]
    }
    dest = os.path.join(os.path.dirname(__file__), "..", "tests", "reference", "cases.json")
    with open(dest, "w") as f:
        json.dump(data, f, indent=1)
    sys.stderr.write("written %s (%d cases)\n" % (dest, len(data["cases"])))


if __name__ == "__main__":
    main()
