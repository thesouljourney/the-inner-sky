/* ============================================================
   我的内在指南 · 想留给自己的几句话(selfNotes)
   ------------------------------------------------------------
   这一层取代「从四段文案里用句型 / 关键词挑句子」的做法:
   在一份指南定案之后,请 AI 【根据这个人已经看到的四个方向内容】
   写 2–4 句留给自己的话,一次生成、存起来,之后每次进页面直接读。

   这支档案只放【纯函式】——不发请求、不碰 localStorage、不碰 DOM:
     · SYSTEM / VERSION      写作指令(服务端 docs/edge/compass-generate.ts
                              有一份逐字相同的副本,测试盯着两边)
     · buildInput(dirs)      把四个方向「使用者看得到的文字」整理成送出去的资料
     · buildPrompt(input)    组出 { system, user, promptVersion }
     · parse(text)           把模型回来的字串解析成字串阵列
     · check(notes, sources) 逐句检查:长度、禁用说法、是否几乎照抄上面的卡片
     · sourcesFrom(...)      列出「上面卡片已经显示的字」,给 check 比对用
   请求、重试、储存都在 app.html(compassEnsureSelfNotes)。
   ============================================================ */
(function (root) {
  "use strict";

  var VERSION = "selfnotes-v1";

  var SYSTEM = `你在为 The Inner Sky 的「我的内在指南」写「想留给自己的几句话」。

你会收到这个人的内在指南里【已经写好、他已经读过】的四个方向内容:
grounds(什么让我安定)、moves(什么让我前进)、drains(什么正在消耗我)、calls(我正在被什么吸引)。
有些方向可能没有内容,那就只看有的。

你的工作:把这些内容【转化】成 2 到 4 句,像他写给自己、之后回来看的话。

【依据】
· 只能根据收到的内容来写。不新增任何没有依据的判断,不引入新的性格描述。
· 不要直接复制上面的标题、开头句、简介或正文原句,也不要只是换几个字重复原文。
  要把意思消化之后,用新的、更私人的说法说出来。

【每一句的作用】
第一句:偏向理解自己、接纳自己现在的状态。
第二句:偏向下一次类似情况再出现时,可以拿来提醒自己的话。
如果写第三、第四句,它们也要各自有不同的作用,不要重复前面的意思。

【语气】
像这个人写给自己看的话:温柔、自然、安静、有一点余韵。
不鸡汤、不说教、不像占星报告、不像心理报告。
风格参考(只是参考,不要照抄这两句):
「不需要一直记得。需要的时候,再回来看看就好。」
「又想再确认一次的时候,可以记得:想深入和还不到时候,常常是同时的。」

【避免】
「你是一个……的人」「你的星盘显示……」「你应该……」「你必须……」「一定要……」
任何占星词(星座、宫位、行星、相位、太阳、月亮等)、玄学词(宇宙、命运、灵魂、能量)、心理诊断词。

【长度】
每句约 25–55 个中文字。

【输出】
只输出 JSON,不要任何说明文字、不要 markdown 代码围栏。格式:
{ "selfNotes": [ "第一句", "第二句" ] }`;

  var KEYS = ["grounds", "moves", "drains", "calls"];
  var FIELDS = ["openingLine", "shortInsight", "coreInsight", "explanation", "reflectionPrompt"];

  /* 只送【使用者已经看得到的字】。机制、证据、分数一概没有(结果里本来也没有)。 */
  function buildInput(directions) {
    var out = { directions: {} };
    KEYS.forEach(function (k) {
      var d = directions && directions[k];
      if (!d) return;
      var o = {};
      FIELDS.forEach(function (f) {
        if (typeof d[f] === "string" && d[f].trim()) o[f] = d[f].trim();
      });
      if (Object.keys(o).length) out.directions[k] = o;
    });
    return out;
  }
  function hasContent(input) {
    return !!(input && input.directions && Object.keys(input.directions).length);
  }

  /* user 讯息必须内嵌 JSON.stringify(input, null, 1) —— 服务端会核对这件事 */
  function buildPrompt(input) {
    var user = "下面是这个人的内在指南里,已经写好、他已经读过的四个方向内容:\n\n" +
      JSON.stringify(input, null, 1) +
      "\n\n请依照写作指令,写 2 到 4 句「想留给自己的几句话」,只输出 JSON。";
    return { system: SYSTEM, user: user, promptVersion: VERSION };
  }

  /* 容忍 ```json 围栏与前后多余文字;回 null 代表解析不出来 */
  function parse(text) {
    if (typeof text !== "string") return null;
    var s = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    var a = s.indexOf("{"), b = s.lastIndexOf("}");
    if (a < 0 || b <= a) return null;
    var o;
    try { o = JSON.parse(s.slice(a, b + 1)); } catch (e) { return null; }
    if (!o || !Array.isArray(o.selfNotes)) return null;
    return o.selfNotes
      .filter(function (x) { return typeof x === "string"; })
      .map(function (x) { return x.replace(/\s+/g, " ").trim(); })
      .filter(Boolean);
  }

  /* ── 逐句检查 ───────────────────────────────────────────── */
  var MIN_LEN = 12, MAX_LEN = 80;      // 目标 25–55;这里放宽,只挡明显不对的
  var BANNED = [
    /你是一个/, /你是那种/, /你就是/,
    /你应该/, /你必须/, /一定要/, /务必/,
    /星盘|命盘|星座|宫位|行星|相位|逆行|上升|本命/,
    /太阳|月亮|水星|金星|火星|木星|土星|天王星|海王星|冥王星/,
    /宇宙|命运|灵魂|能量|疗愈|创伤/
  ];
  function norm(s) {
    return String(s || "").replace(/[\s,，。.!！?？;；:：、「」『』“”"'‘’()（）…—\-~～]/g, "");
  }
  function bigrams(s) {
    var o = {};
    for (var i = 0; i < s.length - 1; i++) o[s.slice(i, i + 2)] = 1;
    return o;
  }
  /* 这一句有多少比例的二字组也出现在来源里(0–1) */
  function containment(note, src) {
    var a = bigrams(note), b = bigrams(src), n = 0, hit = 0;
    for (var k in a) { n++; if (b[k]) hit++; }
    return n ? hit / n : 0;
  }
  /* 「明显接近照抄」才算重复:
       · 整句等于、或整段包含 / 被包含(两边都够长),或
       · 这一句 80% 以上的二字组都在同一个来源句里。
     主题相近、用了几个相同的词都不算 —— 刻意不做严格的语意比对。 */
  var COPY_RATIO = 0.8;
  function isNearCopy(note, sources) {
    var n = norm(note);
    if (n.length < 6) return false;
    return (sources || []).some(function (src) {
      var s = norm(src);
      if (s.length < 6) return false;
      if (n === s) return true;
      if (n.length >= 10 && s.length >= 10 && (s.indexOf(n) >= 0 || n.indexOf(s) >= 0)) return true;
      return containment(n, s) >= COPY_RATIO;
    });
  }
  function check(notes, sources) {
    var clean = [], rejected = [], seen = {};
    (notes || []).forEach(function (t) {
      var why = "";
      var len = norm(t).length;
      if (len < MIN_LEN) why = "too_short";
      else if (len > MAX_LEN) why = "too_long";
      else if (BANNED.some(function (re) { return re.test(t); })) why = "banned_phrase";
      else if (isNearCopy(t, sources)) why = "near_copy";
      else if (seen[norm(t)]) why = "duplicate";
      if (why) rejected.push({ note: t, why: why });
      else { seen[norm(t)] = 1; clean.push(t); }
    });
    return { clean: clean.slice(0, 4), rejected: rejected };
  }

  /* 上面卡片【已经显示】的字:方向标题、开头句、简介、核心句、正文的每一句,
     再加上页面另外算出来显示在卡片上的情境句(由呼叫端传进来)。 */
  function sourcesFrom(directions, extra) {
    var out = [];
    KEYS.forEach(function (k) {
      var d = directions && directions[k];
      if (!d) return;
      ["openingLine", "shortInsight", "coreInsight", "reflectionPrompt"].forEach(function (f) {
        if (typeof d[f] === "string" && d[f]) out.push(d[f]);
      });
      if (typeof d.explanation === "string") {
        out.push(d.explanation);
        d.explanation.split(/[。！？!?；;\n]/).forEach(function (s) { if (s.trim()) out.push(s); });
      }
    });
    (extra || []).forEach(function (s) { if (typeof s === "string" && s) out.push(s); });
    return out;
  }

  /* 存下来的 selfNotes 是否可以直接拿来显示 */
  function usable(notes) {
    return Array.isArray(notes) &&
      notes.filter(function (x) { return typeof x === "string" && x.trim(); }).length > 0;
  }

  var api = {
    VERSION: VERSION, SYSTEM: SYSTEM,
    buildInput: buildInput, hasContent: hasContent, buildPrompt: buildPrompt,
    parse: parse, check: check, isNearCopy: isNearCopy, sourcesFrom: sourcesFrom,
    usable: usable, COPY_RATIO: COPY_RATIO
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CompassSelfNotes = api;
})(typeof window !== "undefined" ? window : this);
