/* ============================================================
   我的内在指南 · 正式结果的对应与解析(canonical-1.0)
   ------------------------------------------------------------
   这一支只做两件事,而且两件都是【纯函式】:

     ① 窄对应   已接受的文案  ⇄  compass_results 的那些栏位
        (v1.4 起每个方向多了 opening/short 两个可选栏位,
        跟 prompt 一样不参与「有没有这个方向」的判断)
     ② 解析     (云端状态, 本机候选) → 这一次该呈现什么

   IO(fetch / localStorage)不在这里,在 app.html。
   这样 A–N 全部的情形都可以在 Node 里当资料驱动的测试跑,
   不需要浏览器、不需要网路、不需要资料库。

   ------------------------------------------------------------
   ⚠ 隐私边界

   toRow 是【白名单】,不是黑名单:它只去读那些已知路径,
   所以快取里将来多出任何东西都不可能被带上云。
   锚点(anchors)刻意【不】上云 —— 那是推导层,而且
   selectionReason 属于生成内部状态。

   ------------------------------------------------------------
   ⚠ 三态,不是布林

   云端的结果只有三类:

     valid    真的读到一列,而且通过窄 schema
     absent   真的读到「没有这一列」
     error    连不上 / 逾时 / 未授权 / 解析失败
     invalid  读到了,但那一列不符合窄 schema

   【只有 absent】可以在检查过本机候选之后走到 NONE。
   error 与 invalid 永远不可以被解读成「这个人没有指南」——
   资料库里那一列可能就在那里。
   ============================================================ */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CompassCanonical = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var VERSION = "canonical-1.0";

  /* 方向 → 栏位。这张表就是这一层的全部对外形状。
     opening/short 是 v1.4 才加的两个可选字段,跟 prompt 一样【不参与】
     「有没有这个方向」的判断——只有 core 才是必要的。 */
  var FIELDS = [
    { key: "grounds", core: "grounds_core", expl: "grounds_expl", prompt: "grounds_prompt",
      opening: "grounds_opening", short: "grounds_short" },
    { key: "moves",   core: "moves_core",   expl: "moves_expl",   prompt: "moves_prompt",
      opening: "moves_opening",   short: "moves_short" },
    { key: "drains",  core: "drains_core",  expl: "drains_expl",  prompt: "drains_prompt",
      opening: "drains_opening",  short: "drains_short" },
    { key: "calls",   core: "calls_core",   expl: "calls_expl",   prompt: "calls_prompt",
      opening: "calls_opening",   short: "calls_short" }
  ];

  /* 与 SQL 的 CHECK 对齐。前端先挡一次,让坏资料连送都不会送出去。 */
  var LIMITS = { core: 200, expl: 1200, prompt: 300, promptVersion: 40, opening: 40, short: 160 };

  /* 解析器可能停在的状态。只有 NONE 可以显示「生成我的内在指南」。 */
  var STATES = ["UNKNOWN", "RESOLVING", "CANONICAL", "ADOPT_LOCAL", "PENDING_UPLOAD",
                "CACHED_OFFLINE", "CONFLICT_CANDIDATE", "NONE", "INVALID_CANONICAL"];
  /* 会显示生成按钮的状态 —— 只有一个。 */
  var GENERATE_STATES = ["NONE"];

  function s(v) { return typeof v === "string" ? v : (v === 0 || v ? String(v) : ""); }
  function trim(v) { return s(v).trim(); }

  /* ── ① 窄对应 ───────────────────────────────────────────── */

  /* 已接受的文案 → 资料列。白名单:只读那 12 条路径 + 两个出身栏位。 */
  function toRow(result) {
    var d = (result && result.directions) || {};
    var row = {
      prompt_version: trim(result && result.promptVersion),
      generated_at: trim(result && result.generatedAt)
    };
    FIELDS.forEach(function (f) {
      var c = d[f.key] || {};
      row[f.core] = trim(c.coreInsight) || null;
      row[f.expl] = trim(c.explanation) || null;
      row[f.prompt] = trim(c.reflectionPrompt) || null;
      row[f.opening] = trim(c.openingLine) || null;
      row[f.short] = trim(c.shortInsight) || null;
    });
    return row;
  }

  /* 资料列 → 已接受的文案。同样只读已知栏位;
     刻意不带 anchors —— 那一层是现算的。 */
  function rowOut(row) {
    var out = { promptVersion: trim(row && row.prompt_version),
                generatedAt: trim(row && row.generated_at),
                directions: {} };
    FIELDS.forEach(function (f) {
      var core = trim(row && row[f.core]);
      if (!core) return;                       // 没有 coreInsight 就当这个方向不存在
      out.directions[f.key] = {
        coreInsight: core,
        explanation: trim(row && row[f.expl]),
        reflectionPrompt: trim(row && row[f.prompt]),
        openingLine: trim(row && row[f.opening]),
        shortInsight: trim(row && row[f.short])
      };
    });
    return out;
  }

  /* ── 窄 schema 验证 ─────────────────────────────────────── */

  function checkShape(promptVersion, generatedAt, directions) {
    if (!promptVersion) return "missing_prompt_version";
    if (promptVersion.length > LIMITS.promptVersion) return "prompt_version_too_long";
    if (!generatedAt || isNaN(new Date(generatedAt).getTime())) return "bad_generated_at";
    var keys = Object.keys(directions || {});
    if (!keys.length) return "no_direction";
    var known = FIELDS.map(function (f) { return f.key; });
    for (var i = 0; i < keys.length; i++) {
      if (known.indexOf(keys[i]) < 0) return "unknown_direction";
      var c = directions[keys[i]] || {};
      if (!trim(c.coreInsight)) return "empty_core";
      if (trim(c.coreInsight).length > LIMITS.core) return "core_too_long";
      if (trim(c.explanation).length > LIMITS.expl) return "explanation_too_long";
      if (trim(c.reflectionPrompt).length > LIMITS.prompt) return "prompt_too_long";
      if (trim(c.openingLine).length > LIMITS.opening) return "opening_too_long";
      if (trim(c.shortInsight).length > LIMITS.short) return "short_too_long";
    }
    return null;
  }

  /* 一列云端资料 → { ok, result, reason }。绝不丢例外。 */
  function validateRow(row) {
    if (!row || typeof row !== "object") return { ok: false, result: null, reason: "not_an_object" };
    var out;
    try { out = rowOut(row); } catch (e) { return { ok: false, result: null, reason: "unreadable" }; }
    var bad = checkShape(out.promptVersion, out.generatedAt, out.directions);
    if (bad) return { ok: false, result: null, reason: bad };
    return { ok: true, result: out, reason: null };
  }

  /* 一份本机快取 → { ok, result, reason }。形状与上面同一套标准。 */
  function validateResult(result) {
    if (!result || typeof result !== "object") return { ok: false, result: null, reason: "not_an_object" };
    var d = (result && result.directions) || {};
    var clean = { promptVersion: trim(result.promptVersion),
                  generatedAt: trim(result.generatedAt), directions: {} };
    Object.keys(d).forEach(function (k) {
      var c = d[k] || {};
      if (!trim(c.coreInsight)) return;
      clean.directions[k] = { coreInsight: trim(c.coreInsight),
                              explanation: trim(c.explanation),
                              reflectionPrompt: trim(c.reflectionPrompt),
                              openingLine: trim(c.openingLine),
                              shortInsight: trim(c.shortInsight) };
    });
    var bad = checkShape(clean.promptVersion, clean.generatedAt, clean.directions);
    if (bad) return { ok: false, result: null, reason: bad };
    return { ok: true, result: clean, reason: null };
  }

  /* 两份文案是不是同一份。只比使用者看得到的那 12 个字段 ——
     generatedAt 不参与:同一份文案不会因为时间戳不同就变成两份。 */
  function sameResult(a, b) {
    if (!a || !b) return false;
    var da = a.directions || {}, db = b.directions || {};
    for (var i = 0; i < FIELDS.length; i++) {
      var k = FIELDS[i].key, x = da[k] || {}, y = db[k] || {};
      if (trim(x.coreInsight) !== trim(y.coreInsight)) return false;
      if (trim(x.explanation) !== trim(y.explanation)) return false;
      if (trim(x.reflectionPrompt) !== trim(y.reflectionPrompt)) return false;
      if (trim(x.openingLine) !== trim(y.openingLine)) return false;
      if (trim(x.shortInsight) !== trim(y.shortInsight)) return false;
    }
    return true;
  }

  /* ── ② 解析 ─────────────────────────────────────────────
     输入全部是【已经查好的事实】,这个函式自己不做 IO:

       cloud  { status: "valid"|"absent"|"error"|"invalid", result?, revision? }
       local  { result?, sync?: "canonical"|"pending-upload", owner? }
       authenticated  boolean
       owner          目前登入的 user id

     回传:

       state      上面 STATES 之一
       result     这一次要呈现的那一份(可能是 null)
       candidate  要保留下来、但这一次不呈现的那一份(可能是 null)
       action     app.html 接下来该做的事:
                  null | "adopt" | "cache" | "retry-upload"
       reason     诊断用的短字串,不含任何文案

     ⚠ 只有 cloud.status === "absent" 而且没有可用的本机候选,
       才会走到 NONE。 */
  function resolve(input) {
    input = input || {};
    var cloud = input.cloud || { status: "error" };
    var authed = !!input.authenticated;
    var local = input.local || null;

    if (!authed) {
      /* 未登入:R1 不改这条路径。照旧只看本机那一桶。
         这里【不会】把 anon 的东西往任何帐号上搬。 */
      var av = local && local.result ? validateResult(local.result) : { ok: false };
      return av.ok
        ? { state: "CANONICAL", result: av.result, candidate: null, action: null, reason: "anon_local" }
        : { state: "NONE", result: null, candidate: null, action: null, reason: "anon_empty" };
    }

    var lv = local && local.result ? validateResult(local.result) : { ok: false, result: null };
    var pending = !!(local && local.sync === "pending-upload");

    if (cloud.status === "valid") {
      /* 云端有效 = 正式的那一份。本机不一样就留着,但【不呈现、不覆盖】。 */
      if (lv.ok && !sameResult(lv.result, cloud.result)) {
        return { state: "CONFLICT_CANDIDATE", result: cloud.result, candidate: lv.result,
                 action: "cache", reason: "local_differs" };
      }
      return { state: "CANONICAL", result: cloud.result, candidate: null,
               action: "cache", reason: lv.ok ? "same" : "cloud_only" };
    }

    if (cloud.status === "absent") {
      /* 真的没有那一列 —— 这是唯一可以走到 NONE 的分支。 */
      if (lv.ok) {
        return { state: pending ? "PENDING_UPLOAD" : "ADOPT_LOCAL",
                 result: lv.result, candidate: null, action: pending ? "retry-upload" : "adopt",
                 reason: pending ? "retry_pending" : "adopt_local" };
      }
      return { state: "NONE", result: null, candidate: null, action: null, reason: "nothing_anywhere" };
    }

    if (cloud.status === "invalid") {
      /* 资料库里【有】一列,只是读不成形状。
         这不等于「没有指南」—— 绝不显示生成、绝不往上覆盖。 */
      return { state: "INVALID_CANONICAL", result: lv.ok ? lv.result : null, candidate: null,
               action: null, reason: "canonical_row_invalid" };
    }

    /* cloud.status === "error":连不上 / 逾时 / 未授权 / 解析失败。
       有本机可用就照常呈现;没有就停在 RESOLVING —— 不是 NONE。 */
    return lv.ok
      ? { state: "CACHED_OFFLINE", result: lv.result, candidate: null, action: null, reason: "offline_cached" }
      : { state: "RESOLVING", result: null, candidate: null, action: null, reason: "offline_unknown" };
  }

  function canGenerate(state) { return GENERATE_STATES.indexOf(state) >= 0; }

  return {
    VERSION: VERSION,
    FIELDS: FIELDS,
    LIMITS: LIMITS,
    STATES: STATES,
    GENERATE_STATES: GENERATE_STATES,
    toRow: toRow,
    rowOut: rowOut,
    validateRow: validateRow,
    validateResult: validateResult,
    sameResult: sameResult,
    resolve: resolve,
    canGenerate: canGenerate
  };
});
