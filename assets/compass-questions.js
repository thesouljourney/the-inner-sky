/* ============================================================
   我的内在指南 · 今天想问自己的一个问题(题库 daily questions)
   ------------------------------------------------------------
   做法 C:一次请 AI【根据这个人已经看到的四个方向内容】写一批问题(约 30 题),
   存起来,每天依序用一题;快用完时再写下一批,并且避开所有用过的问题。
   一个月大约只呼叫一次 API,题目不会重复。

   这支档案只放【纯函式】——不发请求、不碰 localStorage、不碰 DOM:
     · SYSTEM / VERSION          写作指令(服务端 docs/edge/compass-generate.ts
                                  有一份逐字相同的副本,测试盯着两边)
     · buildInput(dirs, avoid, chartDirs)
                                 四个方向「使用者看得到的文字」+ 从星盘推导的内在运作方式
                                 (题目的根据)+ 要避开的旧题
     · buildPrompt(input)        组出 { system, user, promptVersion }
     · parse(text)               把模型回来的字串解析成字串阵列
     · check(qs, avoid)          逐题检查:长度、问句、禁用说法、与旧题 / 彼此是否几乎一样
     · dayIndex(start, today)    从题库开始那天到今天,过了几天(本地日期)
     · todayOf(bank, today)      今天是哪一题;题库用完回 null
     · needsMore(bank, today)    剩下的题 ≤ REFILL_AT 就该在背景写下一批
     · merge(bank, fresh, today) 把新的一批接在后面;今天以前的题移进 used
   请求、重试、储存都在 app.html(compassEnsureQuestions)。
   ============================================================ */
(function (root) {
  "use strict";

  var VERSION = "questions-v1";
  var BATCH = 30;          // 一批写几题
  var REFILL_AT = 3;       // 剩下几题时就先写下一批,不会有「今天没有题」的空档
  var KEEP_USED = 200;     // 记住最近用过的几题(送去给 AI 避开)
  var KEEP_AHEAD = 60;     // 题库里最多保留几题还没用到的

  var SYSTEM = `你在为 The Inner Sky 的「我的内在指南」写「今天想问自己的一个问题」的题库。

你会收到这个人的内在指南里四个方向的内容:
grounds(什么让我安定)、moves(什么让我前进)、drains(什么正在消耗我)、calls(我正在被什么吸引)。
每个方向可能有两层:
· 他已经读过的文案(openingLine / shortInsight / coreInsight / explanation / reflectionPrompt)
· 从他的星盘推导出来的内在运作方式(mechanism / lived / alsoTrue)——这是题目真正的根据
有些方向可能没有内容,那就只看有的。
你也可能收到一份 avoid 清单:那是他之前已经被问过的问题。

你的工作:写 30 个问题。之后每天会拿出其中一个,让他问问自己、写几句回答。

【依据】
· 每一题都要从这个人自己的内在运作方式长出来,让他感觉「这是在问我」,而不是泛泛的自我成长题。
· 内在运作方式只拿来理解他;题目里不提来源,不写成分析或解读。
· 不新增任何没有依据的判断,不引入新的性格描述。
· 四个方向都要照顾到,轮流出现,不要连续好几题都在问同一件事。

【不重复】
· 不可以跟 avoid 清单里的任何一题相同,也不可以只是换几个字的同一个问题。
· 这 30 题彼此之间也不可以重复或太像。
· 不要直接照抄内容里原本的反思问题(reflectionPrompt)。

【每一题的样子】
· 一题只问一件事,读完就知道可以从哪里开始想。
· 贴近日常:可以落在最近、今天、某个时刻、某段关系、某个选择上。
· 可以温柔地深入,但不逼问、不审判、不预设答案。
· 以问号结尾。每题约 15–45 个中文字。

【语气】
温柔、自然、安静,像他自己在心里问自己。
不鸡汤、不说教、不像占星报告、不像心理测验。

【避免】
「你是一个……的人」「你的星盘显示……」「你应该……」「你必须……」「一定要……」
任何占星词(星座、宫位、行星、相位、太阳、月亮等)、玄学词(宇宙、命运、灵魂、能量)、心理诊断词。

【输出】
只输出 JSON,不要任何说明文字、不要 markdown 代码围栏。格式:
{ "questions": [ "第一题？", "第二题？" ] }`;

  var KEYS = ["grounds", "moves", "drains", "calls"];
  var FIELDS = ["openingLine", "shortInsight", "coreInsight", "explanation", "reflectionPrompt"];

  /* 送出去的只有【使用者已经看得到的字】,加上他之前被问过的题目 */
  var ASTRO = /星座|宫位|行星|相位|逆行|上升|天顶|天底|北交|南交|星盘|命盘|本命|度数|守护星|太阳|月亮|水星|金星|火星|木星|土星|天王星|海王星|冥王星|合相|刑相|拱相|冲相/;
  /* chartDirs:从星盘推导的每个方向的内在运作方式(compass-generation 的 buildInput
     已经把原始盘面拿掉,只剩机制本身),题目以它为根据 */
  function chartLayer(g) {
    if (!g || g.status !== "ready") return null;
    var o = {};
    var m = g.selectedPattern && g.selectedPattern.mechanism;
    if (typeof m === "string" && m.trim()) o.mechanism = m.trim();
    if (typeof g.livedMechanism === "string" && g.livedMechanism.trim()) o.lived = g.livedMechanism.trim();
    var also = (g.support || []).map(function (x) { return x && x.mechanism; })
      .filter(function (x) { return typeof x === "string" && x.trim(); });
    if (also.length) o.alsoTrue = also.slice(0, 3);
    return Object.keys(o).length ? o : null;
  }
  function buildInput(directions, avoid, chartDirs) {
    var out = { directions: {}, avoid: [] };
    KEYS.forEach(function (k) {
      var d = directions && directions[k];
      var o = {};
      if (d) FIELDS.forEach(function (f) {
        if (typeof d[f] === "string" && d[f].trim()) o[f] = d[f].trim();
      });
      var c = chartLayer(chartDirs && chartDirs[k]);
      if (c) Object.keys(c).forEach(function (f) { o[f] = c[f]; });
      if (Object.keys(o).length) out.directions[k] = o;
    });
    /* 旧题最多送最近 KEEP_USED 题;万一某题带到占星词(会被服务端的扫描挡下),先拿掉 */
    var seen = {};
    (avoid || []).forEach(function (q) {
      var t = String(q || "").trim();
      if (!t || seen[t] || ASTRO.test(t)) return;
      seen[t] = 1;
      out.avoid.push(t);
    });
    out.avoid = out.avoid.slice(-KEEP_USED);
    return out;
  }
  function hasContent(input) {
    return !!(input && input.directions && Object.keys(input.directions).length);
  }

  /* user 讯息必须内嵌 JSON.stringify(input, null, 1) —— 服务端会核对这件事 */
  function buildPrompt(input) {
    var user = "下面是这个人内在指南的四个方向:他读过的文案、从他的星盘推导出来的内在运作方式," +
      "以及他之前已经被问过的问题(avoid):\n\n" +
      JSON.stringify(input, null, 1) +
      "\n\n请依照写作指令,写 30 个新的问题,只输出 JSON。";
    return { system: SYSTEM, user: user, promptVersion: VERSION };
  }

  function parse(text) {
    if (typeof text !== "string") return null;
    var s = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    var a = s.indexOf("{"), b = s.lastIndexOf("}");
    if (a < 0 || b <= a) return null;
    var o;
    try { o = JSON.parse(s.slice(a, b + 1)); } catch (e) { return null; }
    if (!o || !Array.isArray(o.questions)) return null;
    return o.questions
      .filter(function (x) { return typeof x === "string"; })
      .map(function (x) { return x.replace(/\s+/g, " ").trim(); })
      .filter(Boolean);
  }

  /* ── 逐题检查 ───────────────────────────────────────────── */
  var MIN_LEN = 8, MAX_LEN = 70;      // 目标 15–45;这里放宽,只挡明显不对的
  var BANNED = [
    /你是一个/, /你是那种/, /你就是/, /你应该/, /你必须/, /一定要/, /务必/,
    ASTRO, /宇宙|命运|灵魂|能量|疗愈|创伤/
  ];
  function norm(s) {
    return String(s || "").replace(/[\s,，。.!！?？;；:：、「」『』“”"'‘’()（）…—\-~～]/g, "");
  }
  function bigrams(s) {
    var o = {};
    for (var i = 0; i < s.length - 1; i++) o[s.slice(i, i + 2)] = 1;
    return o;
  }
  function overlap(a, b) {
    var x = bigrams(a), y = bigrams(b), n = 0, hit = 0;
    for (var k in x) { n++; if (y[k]) hit++; }
    return n ? hit / n : 0;
  }
  /* 「几乎是同一题」:整句相同、互相包含,或 80% 以上的二字组重叠 */
  var SAME_RATIO = 0.8;
  function isSame(a, b) {
    var x = norm(a), y = norm(b);
    if (!x || !y) return false;
    if (x === y) return true;
    if (x.length >= 8 && y.length >= 8 && (x.indexOf(y) >= 0 || y.indexOf(x) >= 0)) return true;
    return overlap(x, y) >= SAME_RATIO && overlap(y, x) >= SAME_RATIO * 0.9;
  }
  function check(qs, avoid) {
    var clean = [], rejected = [];
    var old = (avoid || []).slice();
    (qs || []).forEach(function (q) {
      var t = String(q || "").trim();
      var len = norm(t).length, why = "";
      if (len < MIN_LEN) why = "too_short";
      else if (len > MAX_LEN) why = "too_long";
      else if (!/[?？]$/.test(t)) why = "not_question";
      else if (BANNED.some(function (re) { return re.test(t); })) why = "banned_phrase";
      else if (old.some(function (o) { return isSame(t, o); })) why = "repeat_old";
      else if (clean.some(function (c) { return isSame(t, c); })) why = "repeat_batch";
      if (why) rejected.push({ q: t, why: why });
      else clean.push(t);
    });
    return { clean: clean.slice(0, BATCH), rejected: rejected };
  }

  /* ── 题库与日期 ─────────────────────────────────────────────
     bank = { qs: [今天那题, 明天, …], start: "YYYY-MM-DD"(qs[0] 是哪一天的题),
              used: [更早用过的题], v }
     日期一律用使用者本地的日历日(不是 UTC),同一天回来永远是同一题。 */
  function ymd(d) {
    return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
  }
  function parseYmd(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ""));
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }
  function dayIndex(start, today) {
    var a = parseYmd(start), b = parseYmd(today);
    if (!a || !b) return -1;
    return Math.round((b - a) / 86400000);
  }
  function usable(bank) {
    return !!(bank && Array.isArray(bank.qs) && bank.qs.length && parseYmd(bank.start));
  }
  function todayOf(bank, today) {
    if (!usable(bank)) return null;
    var i = dayIndex(bank.start, today);
    return (i >= 0 && i < bank.qs.length) ? bank.qs[i] : null;
  }
  function needsMore(bank, today) {
    if (!usable(bank)) return true;
    var i = dayIndex(bank.start, today);
    return i < 0 || bank.qs.length - i <= REFILL_AT;
  }
  /* 全部用过 / 排着的题:送去给 AI 避开,也拿来挡新的一批 */
  function allKnown(bank) {
    if (!bank) return [];
    return (bank.used || []).concat(bank.qs || []);
  }
  /* 把新的一批接上。今天以前的题移进 used(只留最近 KEEP_USED 题),
     今天那一题变成 qs[0]、start 改成今天 —— 同一天前后读到的一定是同一题。 */
  function merge(bank, fresh, today) {
    var qs = usable(bank) ? bank.qs.slice() : [];
    var used = (bank && bank.used) ? bank.used.slice() : [];
    var i = usable(bank) ? dayIndex(bank.start, today) : 0;
    if (i > 0) { used = used.concat(qs.slice(0, i)); qs = qs.slice(i); }
    if (i < 0) qs = [];
    var known = used.concat(qs);
    (fresh || []).forEach(function (q) {
      if (!known.some(function (k) { return isSame(q, k); })) { qs.push(q); known.push(q); }
    });
    return { qs: qs.slice(0, KEEP_AHEAD), start: today, used: used.slice(-KEEP_USED), v: VERSION };
  }

  var api = {
    VERSION: VERSION, SYSTEM: SYSTEM, BATCH: BATCH, REFILL_AT: REFILL_AT,
    buildInput: buildInput, hasContent: hasContent, buildPrompt: buildPrompt,
    parse: parse, check: check, isSame: isSame,
    ymd: ymd, dayIndex: dayIndex, usable: usable, todayOf: todayOf,
    needsMore: needsMore, allKnown: allKnown, merge: merge
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CompassQuestions = api;
})(typeof window !== "undefined" ? window : this);
