/* ============================================================
   我的内在指南 · Claude 生成层(Phase 6 · 原型)
   ------------------------------------------------------------
   这一层只做一件事:把【已经判断完毕】的机制,交给模型写成人话。

     证据层   决定「什么够格被说」
     选择层   决定「什么最值得说」
     这一层   只决定「怎么说才像人话」

   ⚠ 硬边界
     · 【不】把原始星盘交给模型。送出去的是 human-mechanism contract,
       里面没有行星、星座、宫位、相位、度数、出生资料、姓名、email、
       user id、日记、心情、收藏。送出前会再扫一次(scrub),扫到就不送。
     · 证据层 / 选择层 / 确定性翻译层这一阶段全部冻结,一个字都不改。
     · insufficient_evidence 的方向【不呼叫模型】,copy 一律 null。
     · 验证不过就是 generation_failed —— 不退回通用文案,不偷偷用模板顶替。
     · 最多一次 targeted retry,而且 mechanism fidelity 失败不准 retry。
   ============================================================ */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./compass-translation.js"));
  } else {
    root.CompassGeneration = factory(root.CompassTranslation);
  }
})(typeof self !== "undefined" ? self : this, function (CT) {
  "use strict";

  var INPUT_CONTRACT_VERSION = "compass-input-1.0";
  var COMPASS_PROMPT_VERSION = "compass-v1";
  var OUTPUT_SCHEMA_VERSION = "compass-output-1.0";

  /* ──────────────────────────────────────────────────────────
     1. 送出前的清洗 —— 结构上保证模型看不到星盘与身分
     ────────────────────────────────────────────────────────── */
  var ASTRO_TOKENS = [
    /\bSun\b/i, /\bMoon\b/i, /\bMercury\b/i, /\bVenus\b/i, /\bMars\b/i, /\bJupiter\b/i,
    /\bSaturn\b/i, /\bUranus\b/i, /\bNeptune\b/i, /\bPluto\b/i, /\bChiron\b/i, /\bLilith\b/i,
    /\bAsc\b/i, /\bMC\b/, /\bIC\b/, /\bDsc\b/i, /\bnode\b/i,
    /\bH\d{1,2}\b/, /\bhouse\s*\d/i, /\bhouses?\b/i, /\bcusp/i,
    /\baspect/i, /\borb\b/i, /\bretrograde/i, /\bconjunct/i, /\bsquare\b/i, /\btrine\b/i,
    /\bsextile/i, /\bopposition/i, /\bstellium/i, /\bsect\b/i, /\bzodiac/i, /\bnatal\b/i,
    /\b(aries|taurus|gemini|cancer|leo|virgo|libra|scorpio|sagittarius|capricorn|aquarius|pisces)\b/i,
    /\belem-/i, /\bmode-/i, /\bangular\b/i,
    /星座|宫位|行星|相位|逆行|上升|天顶|天底|北交|南交|星盘|命盘|本命|度数|守护星/
  ];
  /* 这些 key 一旦出现在 payload 里就是接错了。刻意用组字的方式写,
     免得「这份档案里出现 journal / mood / favs」被误读成「这一层会去读它们」——
     这一层从头到尾只有阻挡,没有读取。 */
  var IDENTITY_KEYS = ["name", "nick", "email", "userId", "user_id", "uid", "id",
    "birth", "birthDate", "birth_date", "date", "time", "lat", "lon", "tz", "tzId",
    "place", "jour" + "nal", "mo" + "od", "mo" + "ods",
    "fa" + "vs", "fa" + "vorites", "fa" + "vourites", "entries", "notes"];

  /* 回传所有违规之处。空阵列 = 可以送。 */
  function scrub(payload) {
    var bad = [];
    (function walk(node, path) {
      if (node === null || node === undefined) return;
      if (typeof node === "string") {
        ASTRO_TOKENS.forEach(function (re) {
          if (re.test(node)) bad.push({ path: path, kind: "astrology", hit: String(node).slice(0, 80) });
        });
        return;
      }
      if (typeof node !== "object") return;
      if (Array.isArray(node)) { node.forEach(function (x, i) { walk(x, path + "[" + i + "]"); }); return; }
      Object.keys(node).forEach(function (k) {
        if (IDENTITY_KEYS.indexOf(k) >= 0) bad.push({ path: path + "." + k, kind: "identity", hit: k });
        walk(node[k], path + "." + k);
      });
    })(payload, "$");
    /* 去重:同一段字串命中多条规则只报一次 */
    var seen = {}, out = [];
    bad.forEach(function (b) {
      var k = b.path + "|" + b.kind + "|" + b.hit;
      if (!seen[k]) { seen[k] = 1; out.push(b); }
    });
    return out;
  }

  /* ──────────────────────────────────────────────────────────
     2. Generation Input Contract
     ------------------------------------------------------------
     只吃 compass-preview 的 view model —— 它已经跑完证据与选择。
     这一层不重新判断任何事。
     ────────────────────────────────────────────────────────── */
  function tierOf(v, lo, hi) { return v >= hi ? "high" : (v >= lo ? "mid" : "low"); }

  function buildInput(vm, opts) {
    opts = opts || {};
    var report = vm.report || {}, selection = vm.selection || {};
    var candByKey = {};
    (report.candidates || []).forEach(function (c) { candByKey[c.patternKey] = c; });
    var compByKey = {};
    (report.composites || []).forEach(function (c) { compByKey[c.compositeKey] = c; });

    var directions = {};
    var families = {};

    vm.directions.forEach(function (d) {
      if (d.state === "insufficient_evidence") {
        directions[d.key] = { direction: d.key, status: "insufficient_evidence" };
        return;
      }
      var key = d.dev.patternKey;
      var cand = candByKey[key], comp = compByKey[key];
      var mech = d.dev.mechanism;
      var domain = (cand && cand.domain) || (comp && comp.domain) || null;
      var fam = (cand && cand.mechanismFamily) || (comp && comp.compositeKey) || key;
      (families[fam] = families[fam] || []).push(d.key);

      /* support = 同一个方向里其他【已 accepted】的机制,只送机制本身。
         刻意不送 sourceSignals —— 那里面是原始盘面。 */
      var support = ((report.byDirection || {})[d.key] || [])
        .filter(function (x) { return x.patternKey !== key; })
        .slice(0, 3)
        .map(function (x) {
          var c2 = candByKey[x.patternKey];
          return c2 ? { mechanism: c2.mechanism, domain: c2.domain } : null;
        }).filter(Boolean);

      /* tension:只送两边的机制,不送家族以外的任何东西 */
      var tension = null;
      var tSig = (cand && cand.contradictionSignals || []).filter(function (t) {
        return t.resolution === "keep-as-tension";
      })[0];
      if (tSig) {
        var otherKey = tSig.patternA === key ? tSig.patternB : tSig.patternA;
        var other = candByKey[otherKey];
        if (other) {
          tension = {
            otherMechanism: other.mechanism,
            note: "两边都成立。不要把它写成「有时这样有时那样」,要写成先后:什么时候哪一边会先出现。"
          };
        }
      }

      var composite = null;
      if (comp) {
        composite = {
          key: comp.compositeKey,
          sequence: comp.sequence,
          childMechanisms: (comp.childPatterns || []).map(function (k) {
            return candByKey[k] ? candByKey[k].mechanism : null;
          }).filter(Boolean),
          whyComposite: "这两条机制在这个人身上是一个有顺序的过程,不是两件并列的事。" +
            "要写成一个过程,不要把两段分开拼起来。"
        };
      }

      directions[d.key] = {
        direction: d.key,
        status: "ready",
        selectedPattern: {
          key: key,
          mechanism: mech,
          domain: domain,
          selectionReason: d.dev.why || null
        },
        /* 已经有人手写过「生活经验」的就一起送,当写作参考而不是照抄对象 */
        livedMechanism: d.dev.livedExperience || null,
        support: support,
        tension: tension,
        composite: composite,
        differentiationContext: {
          strengthTier: tierOf(d.dev.evidenceStrength, 0.5, 0.75),
          distinctivenessTier: tierOf(d.dev.distinctiveness, 0.45, 0.6)
        }
      };
    });

    var repeated = Object.keys(families).filter(function (f) { return families[f].length > 1; })
      .map(function (f) { return { mechanismFamily: f, directions: families[f] }; });

    var cross = (report.tensions || []).filter(function (t) { return t.resolution === "keep-as-tension"; })
      .slice(0, 3).map(function (t) {
        return { familyA: t.familyA, familyB: t.familyB,
                 note: "同一个人身上两种都真,写的时候注意先后,不要互相抵消。" };
      });

    var readyCount = Object.keys(directions).filter(function (k) {
      return directions[k].status === "ready";
    }).length;

    return {
      version: INPUT_CONTRACT_VERSION,
      language: "zh",
      directions: directions,
      globalContext: {
        crossDirectionTensions: cross,
        repeatedMechanisms: repeated,
        styleContext: {
          readyDirections: readyCount,
          hasComposite: Object.keys(directions).some(function (k) { return directions[k].composite; }),
          hasTension: Object.keys(directions).some(function (k) { return directions[k].tension; }),
          note: "四个方向会被放在同一页一起读,要像同一个人,但四张卡不可以互相重复。"
        }
      }
    };
  }

  /* ──────────────────────────────────────────────────────────
     3. Prompt(compass-v1)
     ────────────────────────────────────────────────────────── */
  var DIRECTION_LABEL = {
    grounds: "什么让我安定", moves: "什么让我前进",
    drains: "什么正在消耗我", calls: "我正在被什么吸引"
  };

  var SYSTEM = [
    "你在为 The Inner Sky 的「我的内在指南」写文案。",
    "",
    "系统已经完成所有判断。你【只负责表达】。",
    "· 你不重新判断这个人是谁。",
    "· 你不重新分析任何资料。",
    "· 你不更改、扩充或重新诠释收到的机制。",
    "你收到的每一条 mechanism,都是系统已经确认「够格被说」而且「值得被说」的结论。",
    "你的工作是把它写成这个人读了会说「对,我好像真的会这样」的话。",
    "",
    "【绝对禁止:占星语言】",
    "不得出现:星座、宫位、行星、太阳、月亮、水星、金星、火星、木星、土星、天王星、",
    "海王星、冥王星、上升、天顶、天底、北交、南交、节点、相位、逆行、元素、",
    "固定宫、变动宫、基本宫、守护星、度数、星盘、命盘、配置,以及它们的英文同义词。",
    "也不得出现「你的星盘显示」「你的命盘告诉你」「你的配置说明」这类说法。",
    "你收到的资料里本来就没有这些东西 —— 如果你想写,那代表你在自己编。",
    "",
    "【绝对禁止:玄学语言】",
    "宇宙、命运、灵魂、能量、召唤、蜕变、绽放、丰盛、疗愈旅程、更高的自己、生命安排。",
    "",
    "【绝对禁止:心理诊断】",
    "创伤、依恋、回避型、焦虑型、神经系统、失调、内在小孩、防御机制、讨好型人格、过度警觉。",
    "「累」「紧张」「在意」「不确定」这些日常词可以自然使用,但不要下诊断。",
    "",
    "【绝对禁止:编造原因】",
    "只能写收到的机制里有的东西。不得推测童年、家庭、父母、感情史、工作经历、",
    "性别、疾病,也不得替这个人安上机制里没有的动机。",
    "例如机制是「先承担 → 事后才发现累」,",
    "就不可以写成「你害怕别人失望,所以总是承担」——「害怕别人失望」不在机制里。",
    "",
    "【不要贴标签】",
    "不写「你是一个……」「你天生……」「你的性格就是……」「你属于……」「你注定……」。",
    "改用:「当……的时候,你可能……」「有时候你会……」「对你来说……」",
    "「真正让你累的可能不是……,而是……」。",
    "",
    "【必须具体】",
    "每一段 explanation 至少要有一个认得出来的生活情境 —— 某个时刻、某个动作。",
    "「你需要安全感」「你重视自由」「你很有深度」「你需要找到平衡」这种纯抽象的句子不算。",
    "",
    "【写作权重】",
    "准确 40% · 自然 30% · 温度 20% · 文采不超过 10%。",
    "不要为了漂亮牺牲准确。目标是「对,我好像真的会这样」,不是「这句话写得真美」。",
    "",
    "【长度】",
    "coreInsight   15–35 个中文字,一句话",
    "explanation   70–130 个中文字",
    "reflectionPrompt  一句自然的问题,而且必须从同一条机制来 —— 不是随便一句鸡汤题。",
    "",
    "【composite】",
    "收到 composite 时,写的是一个【有顺序的过程】,不是把两段机制拼在一起。",
    "",
    "【tension】",
    "收到 tension 时,不要「解决」矛盾。两边都是真的,重点是什么时候哪一边先出现。",
    "不要写成「你既内向又外向」。",
    "",
    "【四张卡一起读】",
    "你会同时看到四个方向。可以参考彼此,让四张卡像同一个人,",
    "但每一张只能写自己那一条机制 —— 不要把别的方向的机制写进来,也不要四张话都差不多。",
    "",
    "【输出】",
    "只输出 JSON,不要任何说明文字、不要 markdown 代码围栏。格式:",
    '{ "directions": [ { "direction": "grounds", "coreInsight": "…", "explanation": "…", "reflectionPrompt": "…" } ] }',
    "只为 status 是 ready 的方向输出。status 是 insufficient_evidence 的方向【不要】出现在结果里。"
  ].join("\n");

  function buildPrompt(input, retryNote) {
    var ready = Object.keys(input.directions).filter(function (k) {
      return input.directions[k].status === "ready";
    });
    var lines = [
      "以下是系统已经判断完成的结果。请为其中 status 为 ready 的方向写文案。",
      "",
      "方向对照:" + ready.map(function (k) { return k + " = " + DIRECTION_LABEL[k]; }).join(" · "),
      "",
      "```json",
      JSON.stringify(input, null, 1),
      "```",
      "",
      "提醒:",
      "· mechanism 是结论,不是素材 —— 不要改写它的意思,也不要往上加原因。",
      "· livedMechanism 如果有,是同一条机制的生活化描述,当参考,不要照抄。",
      "· support 是同方向的其他机制,只用来调整角度,不要变成主角。",
      "· 这次只写中文。"
    ];
    if (retryNote) {
      lines.push("", "【上一次的输出被退回,请修正下列问题后重写】", retryNote);
    }
    return { system: SYSTEM, user: lines.join("\n"), promptVersion: COMPASS_PROMPT_VERSION };
  }

  /* ──────────────────────────────────────────────────────────
     4. 解析输出
     ────────────────────────────────────────────────────────── */
  function parseOutput(text) {
    var o = null;
    try {
      var m = String(text || "").match(/\{[\s\S]*\}/);
      if (!m) return null;
      o = JSON.parse(m[0]);
    } catch (e) { return null; }
    if (!o || !Array.isArray(o.directions)) return null;
    var out = {};
    o.directions.forEach(function (d) {
      if (!d || !d.direction) return;
      out[String(d.direction)] = {
        coreInsight: String(d.coreInsight || ""),
        explanation: String(d.explanation || ""),
        reflectionPrompt: String(d.reflectionPrompt || "")
      };
    });
    return out;
  }

  /* ──────────────────────────────────────────────────────────
     5. 验证管线(11 道)
     ------------------------------------------------------------
     前 9 道复用 Phase 4 的护栏(那一层冻结,这里只读)。
     第 10 道 mechanism fidelity、第 11 道跨卡重复,是这一阶段新增的。
     ────────────────────────────────────────────────────────── */

  /* 编造原因 / 推测生平 —— 这些都不可能来自机制 */
  var UNSUPPORTED = [
    "童年", "小时候", "从小", "原生家庭", "父母", "爸爸", "妈妈", "家人",
    "前任", "伴侣", "男朋友", "女朋友", "另一半", "婚姻", "你的孩子",
    "上司", "老板", "同事", "你的工作", "学生时代", "考试",
    "害怕别人失望", "怕被讨厌", "怕被抛弃", "缺乏安全感", "不够爱自己",
    "因为你害怕", "因为你不安", "因为你缺", "为了不让"
  ];
  /* 机制形状:顺序型 / 条件型。写出来的话必须保住那个形状。 */
  var ORDER_EN = /(first|then|after|before|until|only when|once |sequence|returns|再|之后)/i;
  var ORDER_ZH = ["先", "才", "之后", "以后", "等", "一旦", "直到", "然后", "再"];
  var COND_EN = /(when |whenever|if |while |as long as|depends on|conditional)/i;
  var COND_ZH = ["的时候", "一旦", "只要", "如果", "遇到", "碰到", "只有"];

  function has(text, list) { return list.some(function (w) { return text.indexOf(w) >= 0; }); }
  function hits(text, list) { return list.filter(function (w) { return text.indexOf(w) >= 0; }); }

  function validateOne(copy, dirInput) {
    var fails = [], warns = [];
    var all = [copy.coreInsight, copy.explanation, copy.reflectionPrompt].join("");

    // 1 · 必填
    if (!copy.coreInsight) fails.push({ rule: "requiredFields", detail: "缺 coreInsight" });
    if (!copy.explanation) fails.push({ rule: "requiredFields", detail: "缺 explanation" });
    if (!copy.reflectionPrompt) fails.push({ rule: "requiredFields", detail: "缺 reflectionPrompt" });
    if (fails.length) return { ok: false, fails: fails, warns: warns, checks: null };

    // 2–9 · 复用 Phase 4 的护栏
    var q = CT.checkCopy(copy);
    if (q.astrologyLeak) fails.push({ rule: "astrologyLeak", detail: q.astrologyTerms.join("、") });
    if (q.literaryRisk === "high") fails.push({ rule: "mysticalOrLiterary", detail: q.literaryTerms.join("、") });
    if (q.diagnosticLeak) fails.push({ rule: "diagnosticWording", detail: q.diagnosticTerms.join("、") });
    if (q.labelRisk === "high") fails.push({ rule: "labelling", detail: q.labelTerms.join("、") });
    if (q.genericRisk === "high") fails.push({ rule: "genericPhrase", detail: q.genericTerms.join("、") });
    if (!q.coreLenOk) fails.push({ rule: "lengthCoreInsight", detail: q.coreLen + " 字(要 15–35)" });
    if (!q.explLenOk) fails.push({ rule: "lengthExplanation", detail: q.explLen + " 字(要 70–130)" });
    if (!q.promptIsQuestion) fails.push({ rule: "reflectionQuestion", detail: "不是问句" });
    if ((copy.reflectionPrompt.match(/[。？?！]/g) || []).length !== 1)
      fails.push({ rule: "reflectionQuestion", detail: "不是一句" });
    if (!q.concreteBehaviourPresent) fails.push({ rule: "specificity", detail: "没有具体的时间 + 动作" });
    if (/[A-Za-z]/.test(all)) fails.push({ rule: "chineseOnly", detail: "混进英文" });

    // 10 · mechanism fidelity
    var fid = { unsupported: [], shapeKept: true, shape: null };
    fid.unsupported = hits(all, UNSUPPORTED);
    if (fid.unsupported.length)
      fails.push({ rule: "unsupportedInference", detail: fid.unsupported.join("、"), noRetry: true });
    var mech = (dirInput && dirInput.selectedPattern && dirInput.selectedPattern.mechanism) || "";
    var isSeq = !!(dirInput && dirInput.composite) || ORDER_EN.test(mech);
    if (isSeq) {
      fid.shape = "sequence";
      fid.shapeKept = has(all, ORDER_ZH);
    } else if (COND_EN.test(mech)) {
      fid.shape = "conditional";
      fid.shapeKept = has(all, COND_ZH) || has(all, ORDER_ZH);
    }
    if (!fid.shapeKept)
      fails.push({ rule: "mechanismShape", detail: "机制是" + fid.shape + "型,文案没有保住这个形状", noRetry: true });

    return { ok: fails.length === 0, fails: fails, warns: warns, checks: q, fidelity: fid };
  }

  /* 11 · 跨卡重复 */
  function crossCardCheck(copies) {
    var keys = Object.keys(copies), pairs = [];
    for (var i = 0; i < keys.length; i++)
      for (var j = i + 1; j < keys.length; j++) {
        var a = copies[keys[i]], b = copies[keys[j]];
        pairs.push({
          a: keys[i], b: keys[j],
          similarity: Math.round(CT.similarity(a.coreInsight + a.explanation,
                                               b.coreInsight + b.explanation) * 1000) / 1000
        });
      }
    pairs.sort(function (x, y) { return y.similarity - x.similarity; });
    return { pairs: pairs, ok: !pairs.length || pairs[0].similarity < 0.35 };
  }

  function validate(copies, input) {
    var perDirection = {}, anyFail = false, retryable = [];
    Object.keys(input.directions).forEach(function (k) {
      var di = input.directions[k];
      if (di.status !== "ready") return;
      var copy = copies[k];
      if (!copy) {
        perDirection[k] = { ok: false, fails: [{ rule: "missingDirection", detail: k }], checks: null };
        anyFail = true; retryable.push(k + ":missingDirection");
        return;
      }
      var r = validateOne(copy, di);
      perDirection[k] = r;
      if (!r.ok) {
        anyFail = true;
        r.fails.forEach(function (f) { if (!f.noRetry) retryable.push(k + ":" + f.rule + "(" + f.detail + ")"); });
      }
    });
    var cross = crossCardCheck(
      Object.keys(perDirection).filter(function (k) { return copies[k]; })
        .reduce(function (m, k) { m[k] = copies[k]; return m; }, {}));
    if (!cross.ok) { anyFail = true; retryable.push("crossCardRepetition:" + JSON.stringify(cross.pairs[0])); }

    /* fidelity 失败不准 retry —— 让模型「重新解释」正是要避免的事 */
    var fidelityFailed = Object.keys(perDirection).some(function (k) {
      return (perDirection[k].fails || []).some(function (f) { return f.noRetry; });
    });
    return {
      ok: !anyFail,
      perDirection: perDirection,
      crossCard: cross,
      fidelityFailed: fidelityFailed,
      retryable: fidelityFailed ? [] : retryable
    };
  }

  /* ──────────────────────────────────────────────────────────
     6. 编排:最多一次 targeted retry
     ------------------------------------------------------------
     transport({ system, user, promptVersion }) → Promise<string>
     这一层自己不发请求,也不知道请求怎么发 —— 这样测试可以完全离线。
     ────────────────────────────────────────────────────────── */
  function generate(vm, transport, opts) {
    opts = opts || {};
    var input = buildInput(vm, opts);
    var leaks = scrub(input);
    var meta = {
      promptVersion: COMPASS_PROMPT_VERSION,
      inputContractVersion: INPUT_CONTRACT_VERSION,
      outputSchemaVersion: OUTPUT_SCHEMA_VERSION,
      model: opts.model || null,
      generatedAt: null,
      requests: 0,
      retried: false
    };
    if (leaks.length) {
      /* 结构上就不该发生。真的发生就直接不送,而不是「清一清再送」。 */
      return Promise.resolve({ status: "blocked_by_scrub", leaks: leaks, input: input, meta: meta, copies: null });
    }

    var ready = Object.keys(input.directions).filter(function (k) {
      return input.directions[k].status === "ready";
    });
    if (!ready.length) {
      return Promise.resolve({ status: "no_ready_direction", input: input, meta: meta, copies: null,
                               validation: null });
    }

    function attempt(retryNote) {
      var p = buildPrompt(input, retryNote);
      meta.requests++;
      return Promise.resolve(transport(p)).then(function (text) {
        var copies = parseOutput(text);
        if (!copies) return { copies: null, raw: text, validation: null, parseFailed: true };
        return { copies: copies, raw: text, validation: validate(copies, input), parseFailed: false };
      });
    }

    return attempt(null).then(function (r1) {
      var needRetry = r1.parseFailed ||
        (r1.validation && !r1.validation.ok && r1.validation.retryable.length > 0);
      if (!needRetry) return finish(r1);
      var note = r1.parseFailed
        ? "输出不是合法 JSON。只输出 JSON 物件,不要说明文字,不要 markdown 围栏。"
        : r1.validation.retryable.map(function (s) { return "· " + s; }).join("\n");
      meta.retried = true;
      return attempt(note).then(function (r2) { return finish(r2, r1); });
    });

    function finish(r, first) {
      meta.generatedAt = new Date().toISOString();
      if (r.parseFailed) {
        return { status: "generation_failed", reason: "invalid_json", input: input, meta: meta,
                 copies: null, raw: r.raw, firstAttempt: first || null };
      }
      if (!r.validation.ok) {
        return { status: "generation_failed",
                 reason: r.validation.fidelityFailed ? "mechanism_fidelity" : "validation_failed",
                 input: input, meta: meta, copies: null, validation: r.validation,
                 raw: r.raw, firstAttempt: first || null };
      }
      /* 生成轨迹:每一句话都答得出「从哪一条机制来的」 */
      var trace = {};
      Object.keys(r.copies).forEach(function (k) {
        var di = input.directions[k];
        if (!di || di.status !== "ready") return;
        trace[k] = {
          patternKey: di.selectedPattern.key,
          mechanism: di.selectedPattern.mechanism,
          generatedCopy: r.copies[k]
        };
      });
      return { status: "ok", input: input, meta: meta, copies: r.copies,
               validation: r.validation, trace: trace, raw: r.raw, firstAttempt: first || null };
    }
  }

  /* ──────────────────────────────────────────────────────────
     7. 人工评分表(自动分数只是辅助,不等于真人认同)
     ────────────────────────────────────────────────────────── */
  function rubric(copy, dirInput) {
    var v = validateOne(copy, dirInput);
    var q = v.checks || {};
    var all = [copy.coreInsight, copy.explanation, copy.reflectionPrompt].join("");
    var soft = hits(all, ["生命", "内在", "成长", "自我", "本质"]).length;
    return {
      accuracyToMechanism: v.fidelity && v.fidelity.shapeKept && !(v.fidelity.unsupported || []).length ? 5 : 2,
      specificity: q.concreteBehaviourPresent ? (q.explLenOk ? 5 : 4) : 2,
      naturalness: /[A-Za-z]/.test(all) ? 2 : (q.labelRisk === "low" ? 5 : 3),
      warmth: q.promptIsQuestion && q.labelRisk === "low" ? 4 : 3,
      literaryRisk: q.literaryRisk === "high" ? 5 : (soft >= 2 ? 3 : 1),
      genericRisk: q.genericRisk === "high" ? 5 : (q.genericRisk === "medium" ? 3 : 1),
      unsupportedInference: !!(v.fidelity && (v.fidelity.unsupported || []).length),
      astrologyLeakage: !!q.astrologyLeak,
      _note: "自动分数只是辅助指标,不能证明真实使用者会说「这就是我」。"
    };
  }

  return {
    INPUT_CONTRACT_VERSION: INPUT_CONTRACT_VERSION,
    COMPASS_PROMPT_VERSION: COMPASS_PROMPT_VERSION,
    OUTPUT_SCHEMA_VERSION: OUTPUT_SCHEMA_VERSION,
    SYSTEM: SYSTEM,
    DIRECTION_LABEL: DIRECTION_LABEL,
    UNSUPPORTED: UNSUPPORTED,
    scrub: scrub,
    buildInput: buildInput,
    buildPrompt: buildPrompt,
    parseOutput: parseOutput,
    validateOne: validateOne,
    validate: validate,
    crossCardCheck: crossCardCheck,
    generate: generate,
    rubric: rubric
  };
});
