/* ============================================================
   我的内在指南 · 人话翻译层原型(Phase 4)
   ------------------------------------------------------------
   要验证的只有一件事:
     已经选出来的内部机制,能不能稳定地翻成自然、具体、简单、有温度,
     但不文学、不玄学、不心理诊断的使用者语言。

   ⚠ 硬边界
     · 只消费 selection 层已经选出来的结构,【不】重新读星盘、不自己解释盘面
     · 不呼叫任何 API —— 这一版是确定性模板 + 开发者手写的转换,
       先证明「机制 → 生活经验 → 人话」这条路径本身是对的
     · 四层转换不可跳级:Layer1 内部模式 → Layer2 机制 → Layer3 生活经验 → Layer4 人话
     · 所有输出目前一律 dev-only,不进产品 UI
     · 不读日记 / 心情 / 收藏
   ============================================================ */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CompassTranslation = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ──────────────────────────────────────────────────────────
     1. 禁用词表 —— 自动护栏
     ────────────────────────────────────────────────────────── */
  var BANNED = {
    astrology: ["星座", "宫位", "行星", "太阳", "月亮", "水星", "金星", "火星", "木星",
      "土星", "天王星", "海王星", "冥王星", "相位", "逆行", "上升", "天顶", "天底",
      "节点", "北交", "南交", "元素", "固定宫", "变动宫", "基本宫", "守护星",
      "落点", "度数", "星盘", "命盘", "本命", "星图", "占星", "配置显示"],
    mystical: ["灵魂", "宇宙", "命运", "能量场", "疗愈", "蜕变", "绽放", "召唤",
      "丰盛", "内在小孩", "高我", "显化", "振动频率", "生命的河流", "心之所向"],
    diagnostic: ["创伤", "依恋", "神经系统", "失调", "回避型", "焦虑型", "解离",
      "应对机制", "防御机制", "自我疗愈", "情绪管理障碍"],
    label: ["你是一个", "你天生", "你就是一个", "你的性格是", "你属于", "你注定"],
    cliche: ["相信自己", "学会放下", "不要想太多", "你值得被爱", "听从内心",
      "找到平衡", "勇敢做自己", "一切都会好起来", "你已经很努力了", "拥抱真实的自己"]
  };
  /* 「默认少用」而不是禁用:出现一次提醒,出现多次才算风险 */
  var SOFT = ["生命", "内在", "成长", "自我", "本质"];

  /* ──────────────────────────────────────────────────────────
     2. 翻译表
     ------------------------------------------------------------
     每一条都要能回答:这句人话是从哪一个机制来的。
       mechanismRef  对应 compass-evidence 里那条规则的 patternKey
       lived         Layer 3:生活经验(开发用,刻意写成描述而不是文案)
       zh            Layer 4:使用者语言
     英文(en)先留位不实作 —— 先把中文做稳,避免两个语言同时漂。
     ────────────────────────────────────────────────────────── */
  var T = {
    "carry-before-noticing-cost": {
      lived: "stabilises or finishes things first; tiredness registers only after the task period closes",
      zh: {
        coreInsight: "你常常会先把事情处理好，才发现自己已经累了一阵子。",
        explanation: "忙的时候，你不太容易马上注意到自己的状态。通常是事情告一段落以后，才感觉到那阵疲惫其实已经累积了一段时间。对你来说，累有时候不是事情太多，而是太久没有停下来看一眼自己。",
        reflectionPrompt: "最近有没有一件事，其实可以不用那么急？"
      }
    },
    "meaning-gates-effort": {
      lived: "energy is allocated by whether the work still reads as meaningful, not by its importance",
      zh: {
        coreInsight: "同样的忙，说得通的时候你撑得住，说不通的时候特别容易空。",
        explanation: "你投入多少，不太是看事情重不重要，而是看它对你还说不说得通。说得通的时候，你可以做很久也不觉得勉强；一旦变成交代得过去就好，力气会掉得比想象中快。别人以为你是累了，其实是那件事对你已经没有说法了。",
        reflectionPrompt: "最近做的事情里，哪一件你还说得出为什么要做？"
      }
    },
    "autonomy-or-stall": {
      lived: "motivation drops when the shape of the day is externally prescribed, regardless of content",
      zh: {
        coreInsight: "一旦每天都被排满，你会慢慢提不起劲，即使那些事你并不讨厌。",
        explanation: "你在意的往往不是做什么，而是有没有一点自己决定的余地。安排全部来自外面的时候，动力会一点一点退掉；只要有一小块时间是你自己选的，整件事又会重新转得动。你要的不是特别自由，只是有一处是自己排的。",
        reflectionPrompt: "这一周有没有一件事，是你可以自己决定怎么做的？"
      }
    },
    "solitude-then-contact": {
      lived: "reduces input first to regulate; wanting contact returns after internal sorting is done",
      zh: {
        coreInsight: "你需要先一个人待一会儿，之后才比较想重新靠近别人。",
        explanation: "状态乱掉的时候，你通常不是想离开谁，只是需要先把外面的声音关小一点。等自己里面理顺了，你会自然想回到关系里。那段独处不是退开，是你重新接上的方式。所以那阵安静过去以后，你常常反而更想找人说话。",
        reflectionPrompt: "今天有没有一段时间，可以完全不用回应任何人？"
      }
    },
    "naming-to-settle": {
      lived: "a state stays diffuse until put into words; naming it stops it occupying background attention",
      zh: {
        coreInsight: "有些事情，你要讲出来或写下来，它才真的放得下。",
        explanation: "一直留在心里的时候，它会以一种模糊的方式占着你。等你把它说成一句话，事情本身可能没变，但它不再一直在背景里响。讲清楚有时候不是为了得到答案，是为了让它停下来。",
        reflectionPrompt: "最近有什么事，你其实想说但还没说出口？"
      }
    },
    "clarity-before-release": {
      lived: "unresolved input stays mentally active until certainty is reached; output is postponed, not dropped",
      zh: {
        coreInsight: "你不是没有想法，只是要先想清楚，才愿意说出来。",
        explanation: "事情还没确定之前，它会一直在你脑子里转，不太容易先放着。所以你说得比别人晚，不是因为犹豫，是因为你想确认这句话站得住。代价是有些话，最后就留在里面了。在场的人以为你没意见，其实你只是还没确认到可以说出口。",
        reflectionPrompt: "有没有一句话，你其实已经想得够久了？"
      }
    },
    "depth-or-disengage": {
      lived: "surface-level involvement does not hold attention; engagement starts past the first layer",
      zh: {
        coreInsight: "只碰到表面的事，你很难真的投入进去。",
        explanation: "停在客套和流程上的时候，你会觉得心思飘着，做得完但没真的在里面。一旦可以往下走一层，你反而没那么容易累。你要的不是更轻松的事，是可以认真的事。所以一场只在表面打转的会议，会让你比熬夜还累。",
        reflectionPrompt: "最近哪一件事，你其实还想再往下问一层？"
      }
    },
    "closeness-needs-room": {
      lived: "closeness is sustainable while room to withdraw stays available; the room matters more than its use",
      zh: {
        coreInsight: "关系里留得住你的，往往是那块可以喘口气的空间。",
        explanation: "靠得太紧的时候，你会开始想往后退，但那通常不是想离开。你需要知道随时可以有一点自己的时间——真正重要的是那个余地还在，而不是你有多常用到它。等到那块空间被收走，你才会真的开始往外走。",
        reflectionPrompt: "你现在的关系里，有没有一块只属于你的时间？"
      }
    },
    "stability-before-movement": {
      lived: "concrete footing is required before commitment; ambiguity is tolerated far less than difficulty",
      zh: {
        coreInsight: "你不是怕难，是怕事情还没落定就要往前走。",
        explanation: "条件清楚的时候，你可以承受相当大的麻烦；但如果地基还在晃，再小的一步你都会先停下来。别人看起来像犹豫，其实你只是在等一个踩得稳的地方。所以你会先把条件一项一项问清楚，才决定要不要动。",
        reflectionPrompt: "这件事里，你还缺哪一块才觉得踏实？"
      }
    },
    "wider-frame-pull": {
      lived: "interest moves toward the larger frame around a subject rather than the subject itself",
      zh: {
        coreInsight: "你常常绕着一件事往外看，想知道它后面还连着什么。",
        explanation: "光知道怎么做，对你来说不太够；你会想知道这件事放在更大的图里是什么位置。这让你学得比较慢，但记得比较久，也比较不容易被单一种说法带着走。遇到只给结论、不给来路的说明，你会想再往前多追一步。",
        reflectionPrompt: "最近有什么事，你想再多知道一点它的来龙去脉？"
      }
    },
    "pace-set-by-the-other": {
      lived: "pace is matched to the other person before checking one's own; mismatch surfaces as fatigue",
      zh: {
        coreInsight: "你常常先接上对方的节奏，之后才发现自己被带着走。",
        explanation: "跟人相处的时候，你会先跟上对方的速度，快慢都能配合。难的不是说不出口，而是那一刻你根本没想到先问自己想不想。累通常不是从争执来的，是从一路配合下来的。等你发现不对劲的时候，通常已经跟着走了好一段。",
        reflectionPrompt: "最近有没有一次，你其实想慢一点？"
      }
    },
    "open-loop-stays-loud": {
      lived: "an unfinished matter keeps running in the background and costs more than the outcome itself",
      zh: {
        coreInsight: "没讲清楚的那件事，会比结果不好本身更难放下。",
        explanation: "事情悬着的时候，它不会安静地等你，而是一直在后面开着。你可能白天做得好好的，某个空档又突然想起来。对你来说难受的常常不是结论，是还没有结论的那一段。所以就算结果不理想，有了明确的说法反而松得下来。",
        reflectionPrompt: "现在有没有一件事，你只是需要一个明确的说法？"
      }
    }
  };

  /* Composite:必须表达顺序,不能把两个 child 的句子拼起来 */
  var COMPOSITES = {
    "regulation-sequence": {
      childPatterns: ["solitude-then-contact", "naming-to-settle"],
      sequence: ["withdraw", "process", "articulate", "reconnect"],
      lived: "reduces input, sorts internally, puts it into words, then wants contact again — in that order",
      zh: {
        coreInsight: "你通常不是一有感觉就想说，而是先消化，再开口。",
        explanation: "事情刚发生的时候，你需要先把外面的声音关小，让自己想一想。等心里的东西变成一句讲得出口的话，你才比较容易说，也才比较想回到人群里。顺序反过来的时候，你会讲得很辛苦。",
        reflectionPrompt: "最近那件事，你消化得差不多了吗？"
      }
    }
  };

  /* 张力:两边都保留,写成先后而不是「有时候这样有时候那样」 */
  var TENSIONS = {
    "articulation-as-regulation~withdraw-to-reset": {
      families: ["withdraw-to-reset", "articulation-as-regulation"],
      lived: "both needs are real and ordered: space first, words after — not two alternating states",
      zh: {
        coreInsight: "你既需要一个人待着，也需要把话说出来，只是有先后。",
        explanation: "这看起来像两种相反的需要，其实是同一件事的两段。你要先有自己的空间，让事情沉下来；等它成形，再说出来，你才真的放得下。被催着先讲，你会讲得零碎；一直不讲，它又会一直留在那里。顺序对了，两边都成立。",
        reflectionPrompt: "你现在是需要先安静一下，还是已经可以说了？"
      }
    }
  };

  /* ──────────────────────────────────────────────────────────
     3. 品质护栏
     ────────────────────────────────────────────────────────── */
  function hits(text, list) {
    return list.filter(function (w) { return String(text).indexOf(w) >= 0; });
  }
  var CJK = /[，。！？；：、（）「」“”\s]/g;
  function len(s) { return String(s || "").replace(CJK, "").length; }

  /* 具体行为:要同时有「时间 / 条件」与「动作」,不能只是抽象描述 */
  var TIME_MARKERS = ["的时候", "之后", "以后", "先", "才", "一旦", "最近", "等",
    "通常", "常常", "某个", "这一周", "今天", "现在"];
  var ACTION_MARKERS = ["说", "讲", "写", "做", "停", "想", "问", "等", "回应",
    "安排", "配合", "决定", "开口", "退", "靠近", "放下", "忙", "累", "跟上"];

  function checkCopy(zh) {
    var all = [zh.coreInsight, zh.explanation, zh.reflectionPrompt].join("");
    var astro = hits(all, BANNED.astrology);
    var myst = hits(all, BANNED.mystical);
    var diag = hits(all, BANNED.diagnostic);
    var label = hits(all, BANNED.label);
    var cliche = hits(all, BANNED.cliche);
    var soft = hits(all, SOFT);
    var youAre = (all.match(/你是/g) || []).length;
    var hasTime = TIME_MARKERS.some(function (m) { return all.indexOf(m) >= 0; });
    var hasAction = ACTION_MARKERS.some(function (m) { return all.indexOf(m) >= 0; });

    return {
      astrologyLeak: astro.length > 0,
      astrologyTerms: astro,
      genericRisk: cliche.length ? "high" : (hasTime && hasAction ? "low" : "medium"),
      genericTerms: cliche,
      literaryRisk: myst.length ? "high" : (soft.length >= 3 ? "medium" : "low"),
      literaryTerms: myst.concat(soft.length >= 3 ? soft : []),
      labelRisk: label.length ? "high" : (youAre >= 2 ? "medium" : "low"),
      labelTerms: label,
      diagnosticLeak: diag.length > 0,
      diagnosticTerms: diag,
      concreteBehaviourPresent: hasTime && hasAction,
      coreLen: len(zh.coreInsight),
      explLen: len(zh.explanation),
      coreLenOk: len(zh.coreInsight) >= 15 && len(zh.coreInsight) <= 35,
      explLenOk: len(zh.explanation) >= 70 && len(zh.explanation) <= 130,
      promptPresent: !!(zh.reflectionPrompt && zh.reflectionPrompt.trim()),
      promptIsQuestion: /[？?]$/.test(String(zh.reflectionPrompt || "").trim())
    };
  }

  function recognitionPotential(q) {
    if (!q.concreteBehaviourPresent) return "low";
    if (q.genericRisk === "high" || q.literaryRisk === "high") return "low";
    if (q.coreLenOk && q.explLenOk && q.genericRisk === "low") return "high";
    return "medium";
  }

  /* ──────────────────────────────────────────────────────────
     4. 翻译
     ------------------------------------------------------------
     input = selection 层选出来的那一项
       { patternKey, kind, domain, mechanism, primaryDirection,
         strength, distinctiveness, compositeInfo?, tensionInfo? }
     ────────────────────────────────────────────────────────── */
  function translate(input) {
    input = input || {};
    if (input.status === "insufficient_evidence" || !input.patternKey) {
      /* §18:证据不够就不生成任何文案,也不给通用 fallback */
      return { status: "insufficient_evidence", patternKey: null, copy: null };
    }

    var key = input.patternKey;
    var entry = null, kind = "pattern";

    if (input.tensionInfo && TENSIONS[tensionKey(input.tensionInfo)]) {
      entry = TENSIONS[tensionKey(input.tensionInfo)]; kind = "tension";
    } else if (COMPOSITES[key]) {
      entry = COMPOSITES[key]; kind = "composite";
    } else if (T[key]) {
      entry = T[key]; kind = "pattern";
    }

    if (!entry) {
      /* 还没写翻译的模式:如实回报,不硬凑 */
      return { status: "not_translated", patternKey: key, copy: null,
               note: "no authored translation for this pattern yet" };
    }

    var q = checkCopy(entry.zh);
    q.mechanismTraceable = !!(input.mechanism || entry.lived);
    q.recognitionPotential = recognitionPotential(q);

    return {
      status: "ok",
      patternKey: key,
      kind: kind,
      primaryDirection: input.primaryDirection || null,
      /* Layer 2:开发用 */
      internalMechanism: input.mechanism || null,
      /* Layer 3:开发用 */
      livedExperience: entry.lived,
      /* Layer 4:未来给使用者看的,目前仍是 dev-only */
      coreInsight: entry.zh.coreInsight,
      explanation: entry.zh.explanation,
      reflectionPrompt: entry.zh.reflectionPrompt,
      sequence: entry.sequence || null,
      childPatterns: entry.childPatterns || null,
      qualityChecks: q
    };
  }

  function tensionKey(t) {
    if (!t) return "";
    return [t.familyA, t.familyB].sort().join("~");
  }

  /* 不同模式之间不可以只是换几个词。
     用「相邻两字」的 Jaccard,而不是单字 —— 中文单字重叠率天生就高
     (你、的、时候…),单字比法会把完全不同的两段算成 0.5,量不出东西。 */
  function bigrams(s) {
    var t = String(s).replace(CJK, ""), out = {};
    for (var i = 0; i + 1 < t.length; i++) out[t.slice(i, i + 2)] = true;
    return out;
  }
  function similarity(a, b) {
    var A = bigrams(a), B = bigrams(b);
    var ka = Object.keys(A), kb = Object.keys(B);
    if (!ka.length || !kb.length) return 0;
    var inter = ka.filter(function (g) { return B[g]; }).length;
    return inter / (ka.length + kb.length - inter);
  }
  function separationCheck(keys) {
    var rows = [], out = [];
    (keys || Object.keys(T)).forEach(function (k) {
      if (T[k]) rows.push({ key: k, zh: T[k].zh });
    });
    for (var i = 0; i < rows.length; i++)
      for (var j = i + 1; j < rows.length; j++) {
        var s = similarity(rows[i].zh.coreInsight + rows[i].zh.explanation,
                           rows[j].zh.coreInsight + rows[j].zh.explanation);
        out.push({ a: rows[i].key, b: rows[j].key, similarity: Math.round(s * 1000) / 1000 });
      }
    return out.sort(function (x, y) { return y.similarity - x.similarity; });
  }

  return {
    BANNED: BANNED,
    TRANSLATIONS: T,
    COMPOSITES: COMPOSITES,
    TENSIONS: TENSIONS,
    translate: translate,
    checkCopy: checkCopy,
    separationCheck: separationCheck,
    similarity: similarity,
    translatedKeys: function () {
      return Object.keys(T).concat(Object.keys(COMPOSITES)).sort();
    }
  };
});
