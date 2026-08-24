/* ============================================================
   assets/astro/timezone.js
   历史时区 / 夏令时解析。

   为什么不自带时区数据库:浏览器和 Node 内建的 ICU 里已经带了完整
   IANA tzdb,含历史规则。举例(已实测):
     Asia/Kuala_Lumpur 1980-01-01 → +07:30(1982 才改成 +08:00)
     Asia/Taipei       1975-07-01 → +09:00(台湾当年实施夏令时)
     Asia/Tokyo        1948-07-01 → +10:00(战后夏令时)
     Asia/Shanghai     1988-07-01 → +09:00(1986–1991 夏令时)
     America/Los_Angeles 1975-01-01 → −08:00 / 1975-07-01 → −07:00

   所以这里只做一件事:把「出生地时区 + 当地出生日期时间」正确地
   反解成 UTC 瞬间,并如实报告当时的偏移、是否夏令时、是否落在
   夏令时切换造成的重复 / 不存在时段。

   绝不使用使用者「现在」的时区,也绝不按国家猜时区。
   ============================================================ */
(function (root, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.InnerSkyTZ = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var MINUTE = 60000;
  var offsetFmtCache = {};
  var abbrFmtCache = {};

  function offsetFormatter(tzId) {
    if (!offsetFmtCache[tzId]) {
      offsetFmtCache[tzId] = new Intl.DateTimeFormat("en-US", {
        timeZone: tzId, timeZoneName: "longOffset", year: "numeric"
      });
    }
    return offsetFmtCache[tzId];
  }
  function abbrFormatter(tzId) {
    if (!abbrFmtCache[tzId]) {
      abbrFmtCache[tzId] = new Intl.DateTimeFormat("en-US", {
        timeZone: tzId, timeZoneName: "short", year: "numeric"
      });
    }
    return abbrFmtCache[tzId];
  }

  function isValidZone(tzId) {
    if (!tzId || typeof tzId !== "string") return false;
    try { new Intl.DateTimeFormat("en-US", { timeZone: tzId }); return true; }
    catch (e) { return false; }
  }

  /* 某个 UTC 瞬间,该时区相对 UTC 的偏移(分钟,东正西负) */
  function offsetMinutesAt(tzId, utcDate) {
    var parts = offsetFormatter(tzId).formatToParts(utcDate);
    var name = "";
    for (var i = 0; i < parts.length; i++) if (parts[i].type === "timeZoneName") name = parts[i].value;
    // "GMT+07:30" / "GMT-08:00" / "GMT"(= UTC)
    var m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(name);
    if (!m) return 0;
    var sign = m[1] === "-" ? -1 : 1;
    return sign * (parseInt(m[2], 10) * 60 + (m[3] ? parseInt(m[3], 10) : 0));
  }

  function abbreviationAt(tzId, utcDate) {
    try {
      var parts = abbrFormatter(tzId).formatToParts(utcDate);
      for (var i = 0; i < parts.length; i++) if (parts[i].type === "timeZoneName") return parts[i].value;
    } catch (e) { /* ignore */ }
    return null;
  }

  function fmtOffset(min) {
    var sign = min < 0 ? "-" : "+", a = Math.abs(min);
    return "UTC" + sign + String(Math.floor(a / 60)).padStart(2, "0") + ":" + String(a % 60).padStart(2, "0");
  }

  /* 该地当年的「标准时间」偏移 = 一年里最小的偏移(南北半球通用) */
  function standardOffsetMinutes(tzId, utcDate) {
    var y = utcDate.getUTCFullYear();
    var jan = offsetMinutesAt(tzId, new Date(Date.UTC(y, 0, 4)));
    var jul = offsetMinutesAt(tzId, new Date(Date.UTC(y, 6, 4)));
    return Math.min(jan, jul);
  }
  function dstInEffect(tzId, utcDate) {
    return offsetMinutesAt(tzId, utcDate) > standardOffsetMinutes(tzId, utcDate);
  }

  function parseDate(dateStr) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || "").trim());
    if (!m) throw new Error("出生日期格式必须是 YYYY-MM-DD:" + dateStr);
    return [+m[1], +m[2], +m[3]];
  }
  function parseTime(timeStr) {
    var m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(timeStr || "").trim());
    if (!m) throw new Error("出生时间格式必须是 HH:MM:" + timeStr);
    var h = +m[1], mi = +m[2], s = m[3] ? +m[3] : 0;
    if (h > 23 || mi > 59 || s > 59) throw new Error("出生时间超出范围:" + timeStr);
    return [h, mi, s];
  }

  /* 把当地时间在某时区下还原成 UTC 瞬间。

     取前后各 24 小时的偏移作为候选(夏令时切换最多产生两种偏移),
     逐一回代验证:
       · 两个候选都成立 → 当地时间重复(秋季回拨),取较早的一次,
         并把 ambiguous 标出来让上层可以提示使用者;
       · 一个都不成立 → 当地时间不存在(春季跳钟的空档),
         按 tzdb 惯例顺延到跳钟后的第一刻,并标 nonexistent;
       · 正常情况只有一个成立。
     这样 30 / 45 分钟这类非整点时区、以及历史上的怪规则都能正确处理。 */
  function localToUtc(dateStr, timeStr, tzId) {
    if (!isValidZone(tzId)) {
      var err = new Error("无法识别的时区 ID:" + tzId);
      err.code = "INVALID_TIMEZONE";
      throw err;
    }
    var d = parseDate(dateStr), t = parseTime(timeStr);
    var naive = Date.UTC(d[0], d[1] - 1, d[2], t[0], t[1], t[2]);
    var DAY = 86400000;

    var candOffsets = [];
    [naive - DAY, naive, naive + DAY].forEach(function (ms) {
      var o = offsetMinutesAt(tzId, new Date(ms));
      if (candOffsets.indexOf(o) === -1) candOffsets.push(o);
    });

    var valid = [];
    candOffsets.forEach(function (o) {
      var utcMs = naive - o * MINUTE;
      if (offsetMinutesAt(tzId, new Date(utcMs)) === o) valid.push({ off: o, ms: utcMs });
    });
    valid.sort(function (a, b) { return a.ms - b.ms; });

    var chosen, ambiguous = false, nonexistent = false;
    if (valid.length === 1) {
      chosen = valid[0];
    } else if (valid.length > 1) {
      ambiguous = true;
      chosen = valid[0];                       // 重复时段取第一次出现
    } else {
      nonexistent = true;
      /* 空档一定是偏移「往前跳」造成的,所以用跳钟之前的偏移(候选里最小的
         那个)回代:得到的瞬间正好是原本的当地时间往后顺延一个空档长度,
         与 tzdb / Temporal 的 compatible 规则一致。
         例:1985-04-28 02:30 America/New_York → 03:30 EDT。 */
      var o = Math.min.apply(null, candOffsets);
      chosen = { off: offsetMinutesAt(tzId, new Date(naive - o * MINUTE)), ms: naive - o * MINUTE };
    }

    var utc = new Date(chosen.ms);
    return {
      utc: utc,
      offsetMinutes: chosen.off,
      offsetText: fmtOffset(chosen.off),
      abbreviation: abbreviationAt(tzId, utc),
      dst: dstInEffect(tzId, utc),
      ambiguous: ambiguous,
      nonexistent: nonexistent,
      tzId: tzId
    };
  }

  /* 反向:UTC → 当地时间字串,给「出生资料回显」用 */
  function utcToLocal(utcDate, tzId) {
    var off = offsetMinutesAt(tzId, utcDate);
    var shifted = new Date(utcDate.getTime() + off * MINUTE);
    var pad = function (n) { return String(n).padStart(2, "0"); };
    return {
      date: shifted.getUTCFullYear() + "-" + pad(shifted.getUTCMonth() + 1) + "-" + pad(shifted.getUTCDate()),
      time: pad(shifted.getUTCHours()) + ":" + pad(shifted.getUTCMinutes()),
      offsetMinutes: off,
      offsetText: fmtOffset(off)
    };
  }

  return {
    isValidZone: isValidZone,
    offsetMinutesAt: offsetMinutesAt,
    standardOffsetMinutes: standardOffsetMinutes,
    dstInEffect: dstInEffect,
    abbreviationAt: abbreviationAt,
    fmtOffset: fmtOffset,
    localToUtc: localToUtc,
    utcToLocal: utcToLocal
  };
});
