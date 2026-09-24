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
  /* 生成层自己的 explanation 长度契约(与 v1.1 / v1.2 的写作指令一致) */
  var EXPL_MIN = 60, EXPL_MAX = 130;
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
    /星座|宫位|行星|相位|逆行|上升|天顶|天底|北交|南交|星盘|命盘|本命|度数|守护星|太阳|月亮|水星|金星|火星|木星|土星|天王星|海王星|冥王星|凯龙|莉莉丝|第[一二三四五六七八九十0-9]+宫|白羊座|金牛座|双子座|巨蟹座|狮子座|处女座|天秤座|天蝎座|射手座|摩羯座|水瓶座|双鱼座|黄道|合相|刑相|拱相|冲相/
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

    /* §3:把【真的会送出去的那一份】授权面挂回 view model,给 dev preview 显示。
       刻意不另外重建一份 —— 画面上看到的必须与 payload 同源,否则追溯没有意义。 */
    vm.directions.forEach(function (d) {
      var di = directions[d.key];
      if (!d.dev || !di || di.status !== "ready") return;
      d.dev.auth = {
        patternKey: di.selectedPattern.key,
        mechanism: di.selectedPattern.mechanism,
        livedMechanism: di.livedMechanism,
        support: (di.support || []).map(function (x) {
          return { mechanism: x.mechanism, domain: x.domain };
        }),
        tension: di.tension ? di.tension.otherMechanism : null,
        compositeChildren: di.composite ? di.composite.childMechanisms : null
      };
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

  /* ──────────────────────────────────────────────────────────
     3b. compass-v1.1 —— 写作校准(Phase 6.2)
     ------------------------------------------------------------
     v1 的问题不是不准,是太像「一个聪明的人在分析你」。
     v1.1 只动【表达】,证据层、选择层、机制、隐私契约一律没动。

     三段结构:Recognition → Relevance → 轻轻的方向。
     v1 仍然原封不动留着,方便 A/B。
     ────────────────────────────────────────────────────────── */
  var SYSTEM_V11 = [
    "你在为 The Inner Sky 的「我的内在指南」写文案。",
    "",
    "系统已经完成所有判断。你【只负责表达】。",
    "· 你不重新判断这个人是谁。",
    "· 你不重新分析任何资料。",
    "· 你不更改、扩充或重新诠释收到的机制。",
    "你收到的每一条 mechanism,都是系统已经确认「够格被说」而且「值得被说」的结论。",
    "",
    "【你要写成什么样子】",
    "想像一个很了解这个人的朋友,把他平常说不清楚的东西说出来,",
    "然后轻轻帮他看见:这件事跟他现在的生活有什么关系。",
    "不是心理报告,不是人生哲理,不是疗愈散文,不是鸡汤,不是建议清单。",
    "",
    "语气参考(这是目标):",
    "「你不是每次累的时候都想休息。有时候你只是想暂时不用回应任何人。",
    "等外面的声音安静一点,你才比较容易知道自己到底怎么了。",
    "所以有些时候,你不一定要先解释,只要先让自己安静下来就够了。」",
    "",
    "不要写成:「你具有高度内在处理需求,因此在外部刺激过多时需要撤退。」",
    "也不要写成:「你的灵魂需要一片安静的天空。」",
    "",
    "【explanation 的三段】",
    "A 认出来  —— 一个具体、认得出来的生活画面(某个时刻、某个动作)",
    "B 是什么  —— 说清楚真正发生的是什么。【不要过度解释为什么】",
    "C 轻轻一步 —— 最后一句往前半步。只能一句,而且必须从同一条机制来。",
    "",
    "C 这一句【不是建议、不是命令】。不写「你应该」「你必须」「你需要学会」。",
    "可以用的句式:",
    "「所以你不一定要……」「有时候可以先……」「你可以先不用急着……」",
    "「对你来说,也许比……更重要的是……」「当这种情况出现时,可以先看看……」",
    "「这时候不一定是你不够努力,也可能只是……」",
    "",
    "【少用分析腔】",
    "尽量不要出现:机制、成本、登记、结构、系统、判断、处理方式、模式本身、",
    "运作、输入、输出、验证、确认流程、资源、效率。",
    "例:不要写「成本要等结束之后才会完整地登记进来」,",
    "要写「很多时候,你是在事情结束以后,才发现自己其实已经累了一阵子」。",
    "",
    "【不要硬推因果】",
    "描述看得到的模式,不要替这个人解释「为什么会这样」。",
    "不要写「你愿意说多少,取决于上一次说了以后发生什么」(因果太强)。",
    "要写「你可能会先说一点,看看对方怎么接」「真正走近以前,你通常会多确认几次」。",
    "",
    "【四个方向各司其职】",
    "grounds 回答「我乱掉、累、卡住的时候,什么真的能让我回来?」结尾要帮他回到稳定。",
    "moves   回答「什么真的让我愿意投入、愿意往前?」——【不要】写成消耗。",
    "drains  回答「什么样的反覆过程正在慢慢耗掉我?」要讲清楚耗在哪一段。",
    "calls   回答「我总是会被什么样的经验、问题或方向吸引?」",
    "        要有方向感,但不要写成使命、天命、注定。",
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
    "",
    "【coreInsight 不要像报告标题】",
    "少用「X 决定 Y」「真正的 X 是 Y」「你之所以……是因为……」。",
    "优先:「你比较容易在……之后,才发现……」「让你慢慢回来的,通常是……」",
    "「你真正容易累的地方,可能在……」「你会重新有兴趣,常常是因为……」",
    "",
    "【长度】",
    "coreInsight   15–35 个中文字,一句话",
    "explanation   60–130 个中文字。以读起来自然为准,不要为了凑字数硬塞。",
    "reflectionPrompt  一句。",
    "",
    "【reflectionPrompt 要让人想起最近发生的事】",
    "不是行为统计题,不是治疗作业,不是测验。",
    "优先:「最近有没有一件事……」「现在有没有一段关系……」",
    "「最近哪件事让你发现……」「有没有什么你一直以为是……,后来发现其实是……」",
    "不要问「上一次你……之前,你一个人待了多久?」这种要人回去计算行为的题目。",
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

  /* ──────────────────────────────────────────────────────────
     3c. compass-v1.2 —— 最后的定点校准(Phase 6.3)
     ------------------------------------------------------------
     v1.1 的方向是对的,只有三件事要修:
       1. 「所以 + 建议」变成固定模板,四张连着读会有 AI 味
       2. 方向那一句会越过证据的权限,替使用者判断现实
       3. Calls 退化成 Moves(「怎样重新有动力」而不是「我会往哪里靠近」)
     v1 与 v1.1 都原封不动留着。
     ────────────────────────────────────────────────────────── */
  var SYSTEM_V12 = [
    "你在为 The Inner Sky 的「我的内在指南」写文案。",
    "",
    "系统已经完成所有判断。你【只负责表达】。",
    "· 你不重新判断这个人是谁。",
    "· 你不重新分析任何资料。",
    "· 你不更改、扩充或重新诠释收到的机制。",
    "你收到的每一条 mechanism,都是系统已经确认「够格被说」而且「值得被说」的结论。",
    "",
    "【你要写成什么样子】",
    "想像一个很了解这个人的朋友,把他平常说不清楚的东西说出来,",
    "然后轻轻帮他看见:这件事跟他现在的生活有什么关系。",
    "不是心理报告,不是人生哲理,不是疗愈散文,不是鸡汤,不是建议清单。",
    "",
    "语气参考(这是目标):",
    "「你不是每次累的时候都想休息。有时候你只是想暂时不用回应任何人。",
    "等外面的声音安静一点,你才比较容易知道自己到底怎么了。",
    "有些时候,先让自己安静一会儿就够了,不一定要马上解释。」",
    "",
    "不要写成:「你具有高度内在处理需求,因此在外部刺激过多时需要撤退。」",
    "也不要写成:「你的灵魂需要一片安静的天空。」",
    "",
    "【explanation 的三段】",
    "A 认出来  —— 一个具体、认得出来的生活画面(某个时刻、某个动作)",
    "B 是什么  —— 说清楚真正发生的是什么。【不要过度解释为什么】",
    "C 轻轻一步 —— 认出自己之后,多看到一个可以站的位置。",
    "",
    "★【C 不要变成模板】",
    "四张卡会被连着读。如果每一张的最后一句都是「所以……」,",
    "整组就会变成公式,读起来像 AI 产生的建议清单 —— 这比写得不好更糟。",
    "所以:",
    "· 【不要】每一张都用「所以」「因此」收尾。四张里最多一张可以。",
    "· C 可以是独立一句,也可以直接融进最后半句话,不必自成一句建议。",
    "· 句式要换着用,例如:",
    "  「有些时候……」「这时候……」「对你来说……」「慢一点没有关系。」",
    "  「如果最近刚好遇到这种情况……」「也许真正值得留意的是……」",
    "  「没力气的时候,可以先看看……」「你可以先不用急着……」",
    "  「有些时候,不急着……反而比较容易……」",
    "",
    "★【C 不是建议】",
    "它的作用不是告诉这个人该怎么做,而是让他认出自己之后,多看到一个可以选的位置。",
    "目标是「原来我可以这样理解自己」,不是「好,我照做」。",
    "绝对不写:你应该 / 你必须 / 你需要学会 / 你最好 / 你应该试着。",
    "",
    "★★【只能说证据授权你说的事】",
    "机制成立,不代表你可以从它推出一个关于【现实】的结论。",
    "例如机制是「靠近之前会反覆确认」:",
    "  可以写:反覆确认本身会让人累。",
    "  【不可以】写:这个人其实已经值得你信任 / 你已经不用确认了 /",
    "            你可以放心靠近 / 对方其实是安全的。",
    "你【不可以】替这个人判断:",
    "  某个人值不值得信任、某段关系安不安全、某份工作该不该继续、",
    "  某个选择对不对、他准备好了没有、他该留下还是离开、",
    "  某件事其实没有风险、他只是想太多。",
    "你能帮他看见的是【他自己的过程】,不是外面的现实是什么。",
    "reflectionPrompt 同样不准把结论偷偷写进问题里。",
    "  不要问:「有没有一个人,其实你已经不用再防备了?」(预设了对方是安全的)",
    "  可以问:「最近有没有一段关系,让你发现自己一直在等一个可以放心的感觉?」",
    "",
    "【少用分析腔】",
    "尽量不要出现:机制、成本、登记、结构、系统、判断、处理方式、模式本身、",
    "运作、输入、输出、验证、确认流程、资源、效率。",
    "例:不要写「成本要等结束之后才会完整地登记进来」,",
    "要写「很多时候,你是在事情结束以后,才发现自己其实已经累了一阵子」。",
    "",
    "【不要硬推因果】",
    "描述看得到的模式,不要替这个人解释「为什么会这样」。",
    "不要写「你愿意说多少,取决于上一次说了以后发生什么」(因果太强)。",
    "要写「你可能会先说一点,看看对方怎么接」「真正走近以前,你通常会多确认几次」。",
    "",
    "【四个方向各司其职】",
    "grounds 我乱掉、累、卡住的时候,什么真的能让我回来?结尾要帮他回到稳定。",
    "moves   什么真的让我愿意投入、愿意往前?",
    "        【不要】写成消耗 —— 不要出现「事后才发现累」「撑到最后」「成本」这类东西。",
    "        也避免「耗很久」这种带消耗意味的说法,改用「做很久」「愿意花时间」。",
    "drains  什么样的反覆过程正在慢慢耗掉我?要讲清楚耗在哪一段。",
    "        方向那一句只能看向【他自己现在正在经历什么】,不能评断外面的人或事。",
    "★ calls  我反覆会被什么样的经验、问题、方向吸引?",
    "        就算没有人要求、就算没有实际用途,我还是会一直往哪里靠近?",
    "        这是【orientation / 反覆的好奇】,不是 motivation、不是怎样恢复动力、",
    "        不是怎样继续投入 —— 那些是 moves 的事。",
    "        写之前先自问:如果把这张卡的标题换成「怎样让我重新有动力?」,",
    "        内容是不是照样成立?如果是,代表你把 calls 写成 moves 了,重写。",
    "        calls 可以有方向感,但不准写成命运、使命、注定、人生道路、灵魂召唤、",
    "        宇宙安排、「你来到这里是为了」、「真正的你」、「更高版本的自己」。",
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
    "",
    "【coreInsight 不要像报告标题】",
    "少用「X 决定 Y」「真正的 X 是 Y」「你之所以……是因为……」。",
    "优先:「你比较容易在……之后,才发现……」「让你慢慢回来的,通常是……」",
    "「你真正容易累的地方,可能在……」「你容易被……吸引」",
    "",
    "【长度】",
    "coreInsight   15–35 个中文字,一句话",
    "explanation   60–130 个中文字。以读起来自然为准,不要为了凑字数硬塞。",
    "reflectionPrompt  一句。",
    "",
    "【reflectionPrompt 要让人想起最近发生的事】",
    "不是行为统计题,不是治疗作业,不是测验,也不准把答案预设在问题里。",
    "优先:「最近有没有一件事……」「现在有没有一段关系……」",
    "「最近哪件事让你发现……」「有没有什么你一直以为是……,后来发现其实是……」",
    "不要问「上一次你……之前,你一个人待了多久?」这种要人回去计算行为的题目。",
    "",
    "【四张卡一起读】",
    "四张要像同一个人,但【不能像同一个模板】。",
    "开头方式、句子长短、收尾方式都要有变化;",
    "每一张只能写自己那一条机制,不要把别的方向的机制写进来。",
    "特别注意 moves 与 calls 不可以只是同一件事换句话说。",
    "",
    "【composite】",
    "收到 composite 时,写的是一个【有顺序的过程】,不是把两段机制拼在一起。",
    "",
    "【tension】",
    "收到 tension 时,不要「解决」矛盾。两边都是真的,重点是什么时候哪一边先出现。",
    "不要写成「你既内向又外向」。",
    "",
    "【输出】",
    "只输出 JSON,不要任何说明文字、不要 markdown 代码围栏。格式:",
    '{ "directions": [ { "direction": "grounds", "coreInsight": "…", "explanation": "…", "reflectionPrompt": "…" } ] }',
    "只为 status 是 ready 的方向输出。status 是 insufficient_evidence 的方向【不要】出现在结果里。"
  ].join("\n");

  /* ──────────────────────────────────────────────────────────
     3d. compass-v1.3 —— 更准而不武断(Phase 6.4)
     ------------------------------------------------------------
     v1.2 的结构(三段 explanation、四方向各司其职、证据权限边界)全部保留,
     一个字都没删。这一版只加三件事:
       1. 不准把一个连续的心理过程包装成人为的「三步/四阶段/不能跳过」。
       2. 判断力道要抓准 —— 既不写死(你一定/你必须/你的星盘决定/永远/绝对),
          也不能整段都是「可能/也许」而显得没有判断。
       3. coreInsight 与 explanation 的开头不能是同一句话换个说法——
          要一层一层往下讲,不是原地重复。
     v1 / v1.1 / v1.2 都原封不动留着。 */
  var SYSTEM_V13 = [
    "你在为 The Inner Sky 的「我的内在指南」写文案。",
    "",
    "系统已经完成所有判断。你【只负责表达】。",
    "· 你不重新判断这个人是谁。",
    "· 你不重新分析任何资料。",
    "· 你不更改、扩充或重新诠释收到的机制。",
    "你收到的每一条 mechanism,都是系统已经确认「够格被说」而且「值得被说」的结论。",
    "",
    "【你要写成什么样子】",
    "想像一个很了解这个人的朋友,把他平常说不清楚的东西说出来,",
    "然后轻轻帮他看见:这件事跟他现在的生活有什么关系。",
    "不是心理报告,不是人生哲理,不是疗愈散文,不是鸡汤,不是建议清单。",
    "",
    "语气参考(这是目标):",
    "「你不是每次累的时候都想休息。有时候你只是想暂时不用回应任何人。",
    "等外面的声音安静一点,你才比较容易知道自己到底怎么了。",
    "有些时候,先让自己安静一会儿就够了,不一定要马上解释。」",
    "",
    "不要写成:「你具有高度内在处理需求,因此在外部刺激过多时需要撤退。」",
    "也不要写成:「你的灵魂需要一片安静的天空。」",
    "",
    "【explanation 的三段】",
    "A 认出来  —— 一个具体、认得出来的生活画面(某个时刻、某个动作)",
    "B 是什么  —— 说清楚真正发生的是什么。【不要过度解释为什么】",
    "C 轻轻一步 —— 认出自己之后,多看到一个可以站的位置。",
    "",
    "★【C 不要变成模板】",
    "四张卡会被连着读。如果每一张的最后一句都是「所以……」,",
    "整组就会变成公式,读起来像 AI 产生的建议清单 —— 这比写得不好更糟。",
    "所以:",
    "· 【不要】每一张都用「所以」「因此」收尾。四张里最多一张可以。",
    "· C 可以是独立一句,也可以直接融进最后半句话,不必自成一句建议。",
    "· 句式要换着用,例如:",
    "  「有些时候……」「这时候……」「对你来说……」「慢一点没有关系。」",
    "  「如果最近刚好遇到这种情况……」「也许真正值得留意的是……」",
    "  「没力气的时候,可以先看看……」「你可以先不用急着……」",
    "  「有些时候,不急着……反而比较容易……」",
    "",
    "★【C 不是建议】",
    "它的作用不是告诉这个人该怎么做,而是让他认出自己之后,多看到一个可以选的位置。",
    "目标是「原来我可以这样理解自己」,不是「好,我照做」。",
    "绝对不写:你应该 / 你必须 / 你需要学会 / 你最好 / 你应该试着。",
    "",
    "★★【只能说证据授权你说的事】",
    "机制成立,不代表你可以从它推出一个关于【现实】的结论。",
    "例如机制是「靠近之前会反覆确认」:",
    "  可以写:反覆确认本身会让人累。",
    "  【不可以】写:这个人其实已经值得你信任 / 你已经不用确认了 /",
    "            你可以放心靠近 / 对方其实是安全的。",
    "你【不可以】替这个人判断:",
    "  某个人值不值得信任、某段关系安不安全、某份工作该不该继续、",
    "  某个选择对不对、他准备好了没有、他该留下还是离开、",
    "  某件事其实没有风险、他只是想太多。",
    "你能帮他看见的是【他自己的过程】,不是外面的现实是什么。",
    "reflectionPrompt 同样不准把结论偷偷写进问题里。",
    "  不要问:「有没有一个人,其实你已经不用再防备了?」(预设了对方是安全的)",
    "  可以问:「最近有没有一段关系,让你发现自己一直在等一个可以放心的感觉?」",
    "",
    "★★【不要发明固定步骤】",
    "机制如果本身是一个连续的过程,就照原样写成连续的句子,",
    "不要包装成「三步」「四个阶段」「这几步不能跳过」这种人为的次数或阶段。",
    "只有 composite 明确标出 sequence 时,才可以写「先……再……」这种顺序,",
    "而且顺序来自 composite.sequence,不是你自己发明的步骤数。",
    "不要写:「这四步对你来说不能跳过。」",
    "要写:「对你来说,这几个过程往往是连在一起的:先减少外界的声音,",
    "再给自己一点整理的时间,等感觉逐渐有了形状,表达也会比较自然地出现。」",
    "",
    "★★【判断力道要抓准】",
    "不要把话说死,也不要把话说得没有立场。",
    "太绝对(不可以):你必须先独处才能恢复 / 你一定需要…… / 这对你来说不能跳过 /",
    "  你的星盘决定了…… / 你的问题在于…… / 你的性格就是…… / 永远…… / 绝对…… / 无法……",
    "太虚(也不可以):你可能也许有时会比较想独处 —— 这种没有任何判断的句子。",
    "理想:当外界的信息太多时,你往往需要先退回一点自己的空间,才比较容易重新听见自己的想法。",
    "「可能」「也许」「似乎」可以用,但不要整段都是这些词,读起来要有判断,只是不绝对。",
    "",
    "【少用分析腔】",
    "尽量不要出现:机制、成本、登记、结构、系统、判断、处理方式、模式本身、",
    "运作、输入、输出、验证、确认流程、资源、效率。",
    "例:不要写「成本要等结束之后才会完整地登记进来」,",
    "要写「很多时候,你是在事情结束以后,才发现自己其实已经累了一阵子」。",
    "",
    "【不要硬推因果】",
    "描述看得到的模式,不要替这个人解释「为什么会这样」。",
    "不要写「你愿意说多少,取决于上一次说了以后发生什么」(因果太强)。",
    "要写「你可能会先说一点,看看对方怎么接」「真正走近以前,你通常会多确认几次」。",
    "",
    "【四个方向各司其职】",
    "grounds 我乱掉、累、卡住的时候,什么真的能让我回来?结尾要帮他回到稳定。",
    "moves   什么真的让我愿意投入、愿意往前?",
    "        【不要】写成消耗 —— 不要出现「事后才发现累」「撑到最后」「成本」这类东西。",
    "        也避免「耗很久」这种带消耗意味的说法,改用「做很久」「愿意花时间」。",
    "drains  什么样的反覆过程正在慢慢耗掉我?要讲清楚耗在哪一段。",
    "        方向那一句只能看向【他自己现在正在经历什么】,不能评断外面的人或事。",
    "★ calls  我反覆会被什么样的经验、问题、方向吸引?",
    "        就算没有人要求、就算没有实际用途,我还是会一直往哪里靠近?",
    "        这是【orientation / 反覆的好奇】,不是 motivation、不是怎样恢复动力、",
    "        不是怎样继续投入 —— 那些是 moves 的事。",
    "        写之前先自问:如果把这张卡的标题换成「怎样让我重新有动力?」,",
    "        内容是不是照样成立?如果是,代表你把 calls 写成 moves 了,重写。",
    "        calls 可以有方向感,但不准写成命运、使命、注定、人生道路、灵魂召唤、",
    "        宇宙安排、「你来到这里是为了」、「真正的你」、「更高版本的自己」。",
    "",
    "【绝对禁止:占星语言】",
    "不得出现:星座、宫位、行星、太阳、月亮、水星、金星、火星、木星、土星、天王星、",
    "海王星、冥王星、上升、天顶、天底、北交、南交、节点、相位、逆行、元素、",
    "固定宫、变动宫、基本宫、守护星、度数、星盘、命盘、配置,以及它们的英文同义词。",
    "也不得出现「你的星盘显示」「你的命盘告诉你」「你的配置说明」「你的星盘决定」这类说法。",
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
    "不写「你是一个……」「你天生……」「你的性格就是……」「你属于……」「你注定……」",
    "「你的问题在于……」。",
    "",
    "【coreInsight 不要像报告标题】",
    "少用「X 决定 Y」「真正的 X 是 Y」「你之所以……是因为……」。",
    "优先:「你比较容易在……之后,才发现……」「让你慢慢回来的,通常是……」",
    "「你真正容易累的地方,可能在……」「你容易被……吸引」",
    "",
    "★【coreInsight 与 explanation 不要重复】",
    "coreInsight 是一句概括,explanation 要往下一层讲清楚【怎么发生的】,",
    "不是把 coreInsight 换个字重讲一次。explanation 的第一句如果和 coreInsight",
    "讲的是同一件事、只是换了说法,就重写 explanation 的开头,让它往前推进。",
    "",
    "【长度】",
    "coreInsight   15–35 个中文字,一句话",
    "explanation   60–130 个中文字。以读起来自然为准,不要为了凑字数硬塞。",
    "reflectionPrompt  一句。",
    "",
    "【reflectionPrompt 要让人想起最近发生的事】",
    "不是行为统计题,不是治疗作业,不是测验,也不准把答案预设在问题里。",
    "优先:「最近有没有一件事……」「现在有没有一段关系……」",
    "「最近哪件事让你发现……」「有没有什么你一直以为是……,后来发现其实是……」",
    "不要问「上一次你……之前,你一个人待了多久?」这种要人回去计算行为的题目。",
    "",
    "【四张卡一起读】",
    "四张要像同一个人,但【不能像同一个模板】。",
    "开头方式、句子长短、收尾方式都要有变化;",
    "每一张只能写自己那一条机制,不要把别的方向的机制写进来。",
    "特别注意 moves 与 calls 不可以只是同一件事换句话说。",
    "",
    "【composite】",
    "收到 composite 时,写的是一个【有顺序的过程】,不是把两段机制拼在一起。",
    "",
    "【tension】",
    "收到 tension 时,不要「解决」矛盾。两边都是真的,重点是什么时候哪一边先出现。",
    "不要写成「你既内向又外向」。",
    "",
    "★【写完先自己检查】",
    "· 换一个星盘的人,这段话是否照样成立?如果是,重写到更具体。",
    "· 是不是只是把占星关键词翻成中文?如果是,重新综合成一个心理过程。",
    "· 四个方向是否明显在回答四个不同的问题?如果没有,重新区分。",
    "",
    "【输出】",
    "只输出 JSON,不要任何说明文字、不要 markdown 代码围栏。格式:",
    '{ "directions": [ { "direction": "grounds", "coreInsight": "…", "explanation": "…", "reflectionPrompt": "…" } ] }',
    "只为 status 是 ready 的方向输出。status 是 insufficient_evidence 的方向【不要】出现在结果里。"
  ].join("\n");

  /* 版本表。v1 一个字都没动 —— 要 A/B 就靠这张表。 */
  var SYSTEMS = {
    "compass-v1": SYSTEM,
    "compass-v1.1": SYSTEM_V11,
    "compass-v1.2": SYSTEM_V12,
    "compass-v1.3": SYSTEM_V13
  };
  var PROMPT_VERSIONS = ["compass-v1", "compass-v1.1", "compass-v1.2", "compass-v1.3"];
  /* 预设版本。Phase 6.4 起新的生成走 v1.3;前三版仍然叫得出来。 */
  var DEFAULT_PROMPT_VERSION = "compass-v1.3";

  /* ★★ VOICE LOCK ★★
     compass-v1.3 已经通过人工 voice review,是目前中文 Compass 的声音基准。
     v1 / v1.1 / v1.2 只留作历史与 A/B 对照,不再使用。

     这不只是一句宣告 —— tests/run-tests.js 用 sha256 把每一份写作指令逐字钉住,
     任何一个字被改动,整批测试立刻红。要改 v1.3 的写法,正确做法是:
       开 compass-v1.4,把它加进 SYSTEMS,让 v1.3 原样留着当基准。
     不要就地编辑 v1.3。 */
  var VOICE_BASELINE = {
    version: "compass-v1.3",
    language: "zh",
    lockedAt: "2026-09-24",
    lockedBy: "human voice review",
    note: "改写法请开新版本,不要就地编辑已锁的版本",
    history: ["compass-v1", "compass-v1.1", "compass-v1.2"]
  };

  function buildPrompt(input, retryNote, version) {
    version = SYSTEMS[version] ? version : DEFAULT_PROMPT_VERSION;
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
    return { system: SYSTEMS[version], user: lines.join("\n"), promptVersion: version };
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

  /* §6.2:两项【量测】,不是硬性拒收。
     校准阶段要先看得到,再决定要不要变成硬门槛 —— 现在就挡会挡到没必要挡的句子。 */
  var ANALYTICAL = ["机制", "成本", "登记", "结构", "系统", "判断", "处理方式",
    "模式本身", "运作", "输入", "输出", "验证", "确认流程", "资源", "效率"];
  var GENTLE_CUES = ["不一定要", "可以先", "不用急着", "也许比", "可以先看看",
    "不一定是", "也可能只是", "不必", "不妨", "先不用", "允许自己"];
  var COMMANDING = ["你应该", "你必须", "你需要学会", "请你", "记得要", "一定要"];
  /* 否定形是【温和】的句式,不是命令 —— 「你不一定要先解释」里面含有「一定要」,
     直接比对会把正确的写法误判成命令。先把否定形拿掉再比。 */
  var NEGATED_COMMANDS = ["不一定要", "不必一定要", "没有一定要"];

  /* ★ Phase 6.3:证据权限边界。
     机制成立 ≠ 可以推出一个关于【现实】的结论。
     这一类不是风格问题,是越权 —— 与「编造原因」同级,硬性拒收而且不准 retry。 */
  var REALITY_VERDICT = [
    "值得你信任", "值得信任", "其实是安全", "可以放心靠近", "可以放心了",
    "已经不用再确认", "不用再确认", "不用再防备", "已经不用防备",
    "对方其实", "其实没有风险", "没有什么风险", "你只是想太多", "是你想太多",
    "你已经准备好", "早就准备好", "你早就可以", "其实早就可以",
    "应该留下", "应该离开", "值得继续", "不值得继续", "是正确的选择",
    "其实不需要担心", "不必担心他", "他其实是"
  ];
  /* reflectionPrompt 把答案预设在问题里 */
  /* 只抓「预设了对方安全 / 预设了这个人已经可以放手」这一类 ——
     单纯重述机制不算(例如 decide-then-revisit 的「其实你已经决定了」
     本来就是机制说的事,那不是越权)。 */
  var EMBEDDED_CONCLUSION = [
    "其实你早就可以", "其实你已经可以", "其实你已经不用", "其实早就可以",
    "早就可以少", "其实已经不用", "已经不用再", "其实不需要再", "其实可以不用再"
  ];
  function permissionCheck(copy) {
    var body = [copy.coreInsight, copy.explanation].join("");
    var q = String(copy.reflectionPrompt || "");
    return {
      realityVerdicts: hits(body, REALITY_VERDICT).concat(hits(q, REALITY_VERDICT)),
      embeddedConclusion: hits(q, EMBEDDED_CONCLUSION)
    };
  }

  function toneCheck(copy) {
    var all = [copy.coreInsight, copy.explanation, copy.reflectionPrompt].join("");
    var cmdText = NEGATED_COMMANDS.reduce(function (t, w) { return t.split(w).join("　"); }, all);
    var expl = String(copy.explanation || "");
    return {
      analyticalTerms: hits(all, ANALYTICAL),
      analyticalTone: hits(all, ANALYTICAL).length >= 2 ? "high"
        : (hits(all, ANALYTICAL).length === 1 ? "medium" : "low"),
      gentleDirection: has(expl.slice(Math.floor(expl.length * 0.45)), GENTLE_CUES),
      commandingTerms: hits(cmdText, COMMANDING),
      reportTitleShape: /决定|真正的.{0,6}是|之所以/.test(String(copy.coreInsight || "")),
      /* 最后一句是不是以「所以 / 因此 / 这时候你可以」起头 —— 组层要数这个 */
      conclusionConnector: (function () {
        var parts = expl.split(/[。！？]/).filter(function (x) { return x.trim(); });
        var last = (parts[parts.length - 1] || "").trim();
        var m = last.match(/^(所以|因此|这时候你可以|于是)/);
        return m ? m[1] : null;
      })(),
      openingWords: String(copy.explanation || "").slice(0, 5)
    };
  }

  /* ══════════════════════════════════════════════════════════
     ★ SHADOW VALIDATOR:unsupportedInternalProcess(Phase 7)
     ------------------------------------------------------------
     既有的 permissionCheck 管的是【外部现实】——不准替使用者判断
     某个人值不值得信任。这一支把同一个原则延伸到【内在现实】:

       模型可以描述送进去的机制。
       模型可以把送进去的 support 翻成生活语言。
       模型【不可以】因为「听起来很合理」就自己多发明一个心理历程。

     关键设计(与禁用词表的差别):
       中文短语只回答「这句话做了哪一类宣称」。
       准不准,由【这一次送进去的 sanitized contract】决定。
       所以同一句话:
         input 带 suppression / delayed-emergence 的授权 → PASS
         input 没有                                   → SHADOW FLAG

     ⚠ SHADOW MODE:只标记、只量测、只进报告。
       不拒收、不触发 retry、不改变 ready 状态、不影响任何产出。
     ══════════════════════════════════════════════════════════ */

  /* 刻意保持很小。目标是「凭空编出来的高风险内在故事」,
     不是把每一句心理描述都分类。 */
  var CLAIM_CLASSES = [
    {
      id: "delayed-emergence",
      zh: ["当下没出来", "才冒头", "才冒出来", "后来才爆", "事后才涌", "才浮上来",
           "过一阵子才", "隔了几天才发作", "在小事上突然"],
      /* 授权来源:domain,或英文机制里的这些说法 */
      domains: ["suppression", "delayed-cost", "repeated-tension"],
      mechanism: /held while it matters|surfaces later|later in a smaller|registers only after|stays (?:mentally )?active until|keeps running in the background/i
    },
    {
      id: "suppression",
      zh: ["压抑", "憋着", "忍住不说", "把情绪收起来", "吞回去"],
      domains: ["suppression"],
      mechanism: /is held while|held back|contained|not expressed|withheld/i
    },
    {
      id: "hidden-anger",
      zh: ["其实很生气", "心里有气", "积着怨", "憋着火", "其实在生气"],
      domains: [],
      mechanism: /anger|resentment|irritation/i
    },
    {
      id: "already-knew-but-avoided",
      zh: ["其实早就知道", "你只是不敢", "只是害怕面对", "你心里明白只是"],
      domains: [],
      mechanism: /already knows|knows but|avoids facing/i
    },
    {
      id: "later-realized-hurt",
      zh: ["事后才发现自己受伤", "后来才知道被伤", "过后才觉得痛"],
      domains: [],
      mechanism: /hurt|wounded|injury/i
    },
    {
      id: "trauma-history",
      zh: ["创伤", "那件事留下的伤", "旧伤"],
      domains: [],
      mechanism: /trauma/i
    },
    {
      id: "childhood-origin",
      zh: ["童年", "小时候", "从小", "原生家庭", "早年"],
      domains: [],
      mechanism: /childhood|early years|upbringing/i
    },
    {
      id: "attachment-story",
      zh: ["依恋", "安全感的建立", "早年关系"],
      domains: [],
      mechanism: /attachment|bonding style/i
    }
  ];

  /* 只从 sanitized contract 取,绝不碰原始盘面 */
  function permittedConcepts(dirInput) {
    var texts = [], domains = [];
    if (dirInput && dirInput.selectedPattern) texts.push(dirInput.selectedPattern.mechanism || "");
    if (dirInput && dirInput.livedMechanism) texts.push(dirInput.livedMechanism);
    (dirInput && dirInput.support || []).forEach(function (x) {
      texts.push(x.mechanism || "");
      if (x.domain) domains.push(x.domain);
    });
    if (dirInput && dirInput.tension) texts.push(dirInput.tension.otherMechanism || "");
    if (dirInput && dirInput.composite)
      (dirInput.composite.childMechanisms || []).forEach(function (m) { texts.push(m); });
    if (dirInput && dirInput.selectedPattern && dirInput.selectedPattern.domain)
      domains.push(dirInput.selectedPattern.domain);

    var blob = texts.join(" \n ");
    var granted = [];
    CLAIM_CLASSES.forEach(function (c) {
      var byDomain = c.domains.filter(function (d) { return domains.indexOf(d) >= 0; });
      var byText = c.mechanism.test(blob);
      if (byDomain.length || byText) {
        granted.push({ concept: c.id,
                       via: byDomain.length ? ("domain:" + byDomain.join("/")) : "mechanism-text" });
      }
    });
    return { concepts: granted, domains: domains, sourceCount: texts.filter(Boolean).length };
  }

  function shadowInternalProcessCheck(copy, dirInput) {
    var all = [copy.coreInsight, copy.explanation, copy.reflectionPrompt].join("");
    var perm = permittedConcepts(dirInput);
    var permitted = {};
    perm.concepts.forEach(function (g) { permitted[g.concept] = g.via; });

    var flags = [], claims = [];
    CLAIM_CLASSES.forEach(function (c) {
      var hit = c.zh.filter(function (w) { return all.indexOf(w) >= 0; });
      if (!hit.length) return;
      claims.push({ claimClass: c.id, detectedFragment: hit[0],
                    authorizedBy: permitted[c.id] || null });
      if (!permitted[c.id])
        flags.push({ claimClass: c.id, detectedFragment: hit[0],
                     missingPermission: c.id });
    });
    return {
      status: flags.length ? "SHADOW FLAG" : "PASS",
      shadowOnly: true,          // 明写:这一支永远不影响验收
      flags: flags,
      claimsDetected: claims,
      permittedConcepts: perm.concepts,
      permittedDomains: perm.domains
    };
  }

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
    /* 长度的下限:确定性翻译层(冻结)用 70,但 v1.1 起写作指令写的是 60 ——
       以读起来自然为准。这里用生成层自己的契约,不去动那个冻结的档案。 */
    var explOk = q.explLen >= EXPL_MIN && q.explLen <= EXPL_MAX;
    q.explLenOk = explOk;
    if (!explOk) fails.push({ rule: "lengthExplanation",
      detail: q.explLen + " 字(要 " + EXPL_MIN + "–" + EXPL_MAX + ")" });
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

    /* 命令句是硬性的 —— §4 明写不准出现 */
    var tone = toneCheck(copy);
    if (tone.commandingTerms.length)
      fails.push({ rule: "commandingTone", detail: tone.commandingTerms.join("、") });
    q.tone = tone;

    /* ★ 越过证据权限:与「编造原因」同级,硬性拒收、不准 retry */
    var perm = permissionCheck(copy);
    if (perm.realityVerdicts.length)
      fails.push({ rule: "realityVerdict", detail: perm.realityVerdicts.join("、"), noRetry: true });
    if (perm.embeddedConclusion.length)
      fails.push({ rule: "embeddedConclusion", detail: perm.embeddedConclusion.join("、"), noRetry: true });
    q.permission = perm;

    /* ★ SHADOW:只记录。刻意【不】写进 fails —— 写进去就会拒收与触发重试。 */
    var shadow = shadowInternalProcessCheck(copy, dirInput);
    q.unsupportedInternalProcess = shadow;

    return { ok: fails.length === 0, fails: fails, warns: warns, checks: q,
             fidelity: fid, tone: tone, permission: perm,
             unsupportedInternalProcess: shadow };
  }

  /* ★ Phase 6.3 · 组层品质:四张连着读像不像同一个模板。
     这一层【只量测不拒收】—— 单张都合格但整组公式化,是要人来看的事。 */
  function groupCheck(copies) {
    var keys = ["grounds", "moves", "drains", "calls"].filter(function (k) { return copies[k]; });
    var tones = {}, connectors = [], openings = [];
    keys.forEach(function (k) {
      var t = toneCheck(copies[k]);
      tones[k] = t;
      if (t.conclusionConnector) connectors.push(t.conclusionConnector);
      openings.push(t.openingWords);
    });
    var uniqOpenings = {};
    openings.forEach(function (o) { uniqOpenings[o] = 1; });

    /* moves 与 calls 不可以只是同一件事换句话说 */
    var mc = (copies.moves && copies.calls)
      ? CT.similarity(copies.moves.coreInsight + copies.moves.explanation,
                      copies.calls.coreInsight + copies.calls.explanation)
      : null;

    var flags = [];
    if (connectors.length >= 3) flags.push("formulaic_direction");
    if (Object.keys(uniqOpenings).length < Math.max(2, keys.length - 1)) flags.push("repeated_opening");
    if (mc !== null && mc > 0.30) flags.push("moves_calls_overlap");

    return {
      conclusionConnectorCount: connectors.length,
      conclusionConnectors: connectors,
      distinctOpenings: Object.keys(uniqOpenings).length,
      movesCallsSemanticOverlap: mc === null ? null : Math.round(mc * 1000) / 1000,
      gentleDirectionCount: keys.filter(function (k) { return tones[k].gentleDirection; }).length,
      directions: keys.length,
      flags: flags
    };
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
    var group = groupCheck(copies);
    return {
      ok: !anyFail,
      perDirection: perDirection,
      crossCard: cross,
      group: group,
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
    var version = SYSTEMS[opts.promptVersion] ? opts.promptVersion : DEFAULT_PROMPT_VERSION;
    var input = buildInput(vm, opts);
    var leaks = scrub(input);
    var meta = {
      promptVersion: version,
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
      var p = buildPrompt(input, retryNote, version);
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
    OUTPUT_SCHEMA_VERSION: OUTPUT_SCHEMA_VERSION,
    SYSTEM: SYSTEM,
    SYSTEM_V11: SYSTEM_V11,
    SYSTEM_V12: SYSTEM_V12,
    SYSTEM_V13: SYSTEM_V13,
    SYSTEMS: SYSTEMS,
    PROMPT_VERSIONS: PROMPT_VERSIONS,
    DEFAULT_PROMPT_VERSION: DEFAULT_PROMPT_VERSION,
    VOICE_BASELINE: VOICE_BASELINE,
    toneCheck: toneCheck,
    permissionCheck: permissionCheck,
    CLAIM_CLASSES: CLAIM_CLASSES,
    permittedConcepts: permittedConcepts,
    shadowInternalProcessCheck: shadowInternalProcessCheck,
    groupCheck: groupCheck,
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
