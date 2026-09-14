/* ============================================================
   我的内在指南 · 测试盘清单(单一真实来源)
   ------------------------------------------------------------
   Phase 3 / 3.5 / 4 用的那 10 张盘,原本在三个地方各写了一份。
   Phase 5 要在浏览器里也用同一批,所以抽成这一支。

   ⚠ 这些只是确定性的出生资料,不是任何真实使用者的资料。
     数值与之前三处硬写的完全一致 —— 刻意不换 test set。
   ============================================================ */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CompassCases = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var CASES = [
    { id: "C1",  date: "1994-11-21", time: "01:44", lat:   1.8548, lon: 102.9325, tzId: "Asia/Kuala_Lumpur" },
    { id: "C2",  date: "1988-03-02", time: "14:20", lat:  25.0330, lon: 121.5654, tzId: "Asia/Taipei" },
    { id: "C3",  date: "1975-07-09", time: "06:05", lat:  51.5072, lon:  -0.1276, tzId: "Europe/London" },
    { id: "C4",  date: "2001-12-30", time: "23:10", lat:  40.7128, lon: -74.0060, tzId: "America/New_York" },
    { id: "C5",  date: "1969-05-17", time: "09:40", lat: -33.8688, lon: 151.2093, tzId: "Australia/Sydney" },
    { id: "C6",  date: "1983-09-28", time: "18:55", lat:   3.1390, lon: 101.6869, tzId: "Asia/Kuala_Lumpur" },
    { id: "C7",  date: "1996-02-14", time: "04:15", lat:  35.6762, lon: 139.6503, tzId: "Asia/Tokyo" },
    { id: "C8",  date: "1979-08-23", time: "12:00", lat:  48.8566, lon:   2.3522, tzId: "Europe/Paris" },
    { id: "C9",  date: "2006-04-05", time: "20:30", lat: -23.5505, lon: -46.6333, tzId: "America/Sao_Paulo" },
    { id: "C10", date: "1962-10-11", time: "16:45", lat:  19.0760, lon:  72.8777, tzId: "Asia/Kolkata" }
  ];

  /* 旧写法是 [id, date, time, lat, lon, tz] 的阵列 —— 保留这个形状,
     让既有的两个报告工具与测试改成一行 require 就好,不必重写。 */
  function tuples() {
    return CASES.map(function (c) { return [c.id, c.date, c.time, c.lat, c.lon, c.tzId]; });
  }
  function byId(id) {
    return CASES.filter(function (c) { return c.id === id; })[0] || null;
  }

  return { CASES: CASES, tuples: tuples, byId: byId, ids: CASES.map(function (c) { return c.id; }) };
});
