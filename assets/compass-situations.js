/* ============================================================
   我的内在指南 · 个人情境层(Personal Situations v1 / situations-1.0)
   ------------------------------------------------------------
   这一层做的事只有一件:

     把【已经生成、已经通过验证】的四段文案,
     换成一个使用者在生活发生的时候回得来的入口。

       ABOUT ME  →  FOR ME
       「你通常……」 →  「这种时候，我可以回来看看这里。」

   ------------------------------------------------------------
   它【不是】第二个解读引擎

     · 不读星盘
     · 不呼叫任何 API
     · 不产生新的主张
     · 同一份文案永远得到同一组情境

   系统负责的是「哪一句可以说」,不负责「怎么把碎片黏起来」。
   画面上每一个字都是人写的完整句子。

   ------------------------------------------------------------
   安全性靠四件事

     ① 概念授权   句子只有在它需要的概念【真的被这份文案讲过】时才出现
     ② 方向契约   每一条还必须被批准用在【当前这个方向】上(allowedDirection)
     ③ 输出有限   概念 × 方向是可枚举的,测试把【全部可能的句子】列出来
                  逐条审、用 sha256 钉住
     ④ 词典静态稽核  那些句子是我们写的,测试对整本词典扫人格主张 /
                  心理机制 / 成因 / 过去 / 情绪命名 / 万用句 / 命令句

   ⚠ 方向契约是一条【安全边界】,不是排版规则
     文案里出现了某个概念的说法,不等于那句话适合挂在这个方向底下。
     语言命中 + 方向不符 → 这一条不出,该方向退回中性入口。
     【绝对不可以】为了让它对得上而重新诠释文案。

   ------------------------------------------------------------
   四个方向各有各的工作(2026-09-16 人工产品裁定)

     grounds  RETURN   情境 + 朝「回到自己」的许可 / 定位
     moves    MOVE     情境 + 朝「恢复动力」的定位
     drains   NOTICE   情境 + 认出成本在哪里        ← 不需要出口
     calls    FOLLOW   情境 + 朝「什么持续吸引你」的认出 / 定位

     drains 的不对称是【刻意的】。它的工作是「帮我早点认出来」,
     不是「给我一个解法」。不可以为了情绪对称补上宽慰 / 许可 /
     因应方式 / 一小步。

   ⚠ 一小步(micro)全域可选
     只有在来源或机制【明确支持那个具体动作】时才存在。
     18 条里只有 4 条有。合理的自助建议【不算】支持。

   ⚠ 语气守则(沿用 anchors-2.1 / 3.1 的既有裁定)
     · 「也不迟 / 没关系 / 不急」这类宽慰,只有在原文自己给了那个许可时才写
     · 确定度不可以高过来源(hedges 栏位记录必须保住的保留字)
     · 情境必须是【可观察的生活处境】,不得预设内在自我评判

   ------------------------------------------------------------
   ⚠ 这一份已锁(见 SITUATIONS_BASELINE)。改做法请开新版本。
   ============================================================ */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CompassSituations = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var VERSION = "situations-1.0";

  var SITUATIONS_BASELINE = {
    name: "Personal Situations v1",
    version: VERSION,
    status: "LOCKED",
    lockedAt: "2026-09-16",
    lockedBy: "human content review",
    lockReason: "human voice review + direction-specific product contract",
    note: "改做法请开新版本,不要就地编辑已锁的版本。任何改动都需要新的人工内容审查。",
    locks: ["variant set", "allowedDirection contract", "situation wording",
            "direction/recognition wording", "optional micro wording",
            "authorization cues", "hedge requirements", "selection rule",
            "user-facing copy behavior"],
    reviewHistory: ["situations-prototype (Voice Review Pack)",
                    "Voice Calibration (F1–F6)",
                    "direction-specific product model validation"]
  };

  /* 四个方向的内部功能。【只在内部使用】——
     RETURN / MOVE / NOTICE / FOLLOW 永远不可以出现在画面上。 */
  var FUNCTIONS = {
    grounds: "RETURN",
    moves: "MOVE",
    drains: "NOTICE",
    calls: "FOLLOW"
  };

  /* ── 已审定的 18 条 ───────────────────────────────────────
     cues              只用来【认出来源在讲什么】,一个字都不会进画面
     allowedDirection  安全边界:这一条只准挂在这个方向底下
     situation         罗盘上的入口(可观察的生活处境)
     text              点开之后的那几句(directionText / recognitionText)
     micro             可选的第二句。没有就是 null —— 画面上不留空位
     hedges            必须保住的保留字(确定度不可以高过来源)
     ------------------------------------------------------------
     不在这一份里的三条(momentum_needs_meaning/meaning、
     momentum_needs_meaning/not_importance、angle_over_rest/angle)
     在已录语料里一次都没有被授权过,列为【未来候选】,不进 v1。
     见 docs/INNER-COMPASS-SITUATIONS.md。 */
  var VARIANTS = [

    /* ═══ grounds · RETURN ═══ */
    { concept: "settle_before_approach", variant: "quiet", allowedDirection: "grounds",
      cues: ["先让外面安静", "把外面的声音关小"],
      situation: "当我有点乱的时候",
      text: "不用急着把它说清楚。先把外面的声音关小一点，等它在心里排出顺序，话会比较容易出来。",
      micro: null,
      hedges: ["比较容易"] },

    { concept: "settle_before_approach", variant: "block", allowedDirection: "grounds",
      cues: ["把外面的事情挡一挡", "先退开一点"],
      situation: "当我想一个人待一会儿的时候",
      text: "这时候不太需要先找人说。把外面的事情挡一挡，等里面理顺了，想联系的心情自己会回来。",
      micro: null,
      hedges: [] },

    { concept: "settle_before_approach", variant: "not_hiding", allowedDirection: "grounds",
      cues: ["不是在躲谁", "把自己接回来"],
      situation: "当我想躲开的时候",
      text: "一个人待一会儿，不一定是在躲谁。那段安静，也是把自己接回来的方式。",
      micro: null,
      hedges: ["不一定"] },

    { concept: "settle_before_approach", variant: "unformed", allowedDirection: "grounds",
      cues: ["说出来之前是散的", "讲得出口的话", "讲得出来的话"],
      situation: "当我还讲不清楚的时候",
      text: "刚发生的那阵子，多半是说不好的。等它在心里排出顺序，再开口会容易一些。",
      micro: null,
      hedges: ["多半"] },

    { concept: "room_to_step_back", variant: "relationship", allowedDirection: "grounds",
      cues: ["随时可以退一步", "想往后站", "那个余地还在"],
      situation: "当我想往后站一点的时候",
      text: "重点常常是那个余地还在，不是你有多常用它。往后站一点，不等于要走。",
      micro: null,
      hedges: ["常常"] },

    { concept: "room_to_step_back", variant: "group", allowedDirection: "grounds",
      cues: ["什么时候可以走", "有退路"],
      situation: "当我要进到一群人里面的时候",
      text: "待得住的关键，常常是知道自己什么时候可以走。参加到什么程度，由你说了算。",
      micro: null,
      hedges: ["常常"] },

    /* ═══ moves · MOVE ═══ */
    { concept: "momentum_needs_meaning", variant: "stands_up", allowedDirection: "moves",
      cues: ["成不成立", "讲不讲得通"],
      situation: "当我突然撑不下去的时候",
      text: "讲得通的时候，再繁琐你也做得下去；一旦只剩下交差，同样的事会突然很难撑。别人常以为你是累了。",
      micro: "看一眼今天这件事，还讲不讲得通。",
      hedges: [] },

    { concept: "momentum_needs_meaning", variant: "not_persistence", allowedDirection: "moves",
      cues: ["不是没有毅力", "需要那个理由还在"],
      situation: "当一件事变成「照着做就好」的时候",
      text: "成立的时候，你可以磨很久也不觉得勉强。一旦变成照着做就好，热度掉得很快——那跟毅力没什么关系。",
      micro: "先看那个理由还在不在。",
      hedges: [] },

    { concept: "agency_over_volume", variant: "one_slot", allowedDirection: "moves",
      cues: ["自己排的", "自己说了算", "自己决定的余地"],
      situation: "当一天被排满的时候",
      text: "要的不是更少的事，是有一处自己说了算的地方。哪怕只有一小块。",
      micro: null,
      hedges: [] },

    /* ═══ drains · NOTICE ═══
       这五条【刻意】停在「认出成本在哪里」。没有许可、没有出口、
       没有一小步(before_closeness 的那一步是原文自己写的动作)。 */
    { concept: "checking_loop_costs", variant: "closeness", allowedDirection: "drains",
      cues: ["再确认一次", "反覆确认", "反复确认"],
      situation: "当我又想再确认一次的时候",
      text: "你要先看看这一步稳不稳，才愿意再往前放一点。想再确认一次，是这个顺序的一部分。",
      micro: null,
      hedges: [] },

    { concept: "checking_loop_costs", variant: "before_closeness", allowedDirection: "drains",
      cues: ["靠近之前那一次次的确认", "一直停在再确认一下"],
      situation: "当我又停在「再确认一下」的时候",
      text: "累的地方，可能不在靠近本身，在靠近之前那一次次的确认。",
      micro: "先看一眼那件还放不下心的事。",
      hedges: ["可能"] },

    { concept: "checking_loop_costs", variant: "decision", allowedDirection: "drains",
      cues: ["没关上的检查", "不在选择本身"],
      situation: "当我已经决定了、却还在回头看的时候",
      text: "那个决定其实已经做完了。还在耗的是后面那段一直没关上的检查。",
      micro: null,
      hedges: [] },

    { concept: "extra_layer_tires", variant: "after", allowedDirection: "drains",
      cues: ["有多少人在看", "做完之后还要处理"],
      situation: "当事情被摊到台面上的时候",
      text: "第一反应通常是把自己收一点，而不是松一口气。真正耗掉的，是做完之后还要处理「有多少人在看」这件事。",
      micro: null,
      hedges: ["通常"] },

    { concept: "extra_layer_tires", variant: "watched", allowedDirection: "drains",
      cues: ["先绷起来", "越多人在看"],
      situation: "当我知道有人在看着的时候",
      text: "绷起来的那一下，多半不是因为事情难。是被看着的时候，要顾的东西多了一层。",
      micro: null,
      hedges: ["多半"] },

    /* ═══ calls · FOLLOW ═══ */
    { concept: "depth_over_surface", variant: "wake", allowedDirection: "calls",
      cues: ["往下走一层", "换个角度重新看"],
      situation: "当我做得完、人却不在里面的时候",
      text: "往下走一层，或者换个角度重新看它，人比较容易回来。要的不是换一件新的事，是可以往深处走的那一步。",
      micro: "在这件事里挑一个地方，往下多看一层。",
      hedges: ["比较容易"] },

    { concept: "depth_over_surface", variant: "serious", allowedDirection: "calls",
      cues: ["不是更轻松的事", "可以认真的事"],
      situation: "当我开始飘走的时候",
      text: "客套和只说一半的对话，会让你越做越远。能认真的时候，你才真的在场。",
      micro: null,
      hedges: [] },

    { concept: "depth_over_surface", variant: "real_exchange", allowedDirection: "calls",
      cues: ["能换到东西", "说点真的东西"],
      situation: "当只剩下寒暄的时候",
      text: "不用勉强先熟起来。泛泛的来往，对你比不熟还费力。",
      micro: null,
      hedges: [] },

    { concept: "depth_over_surface", variant: "loop_back", allowedDirection: "calls",
      cues: ["一直绕回去想", "还有一层没被你看完"],
      situation: "当我一直绕回去想同一件事的时候",
      text: "一直绕回去想，不一定是分心。也可能只是它还有一层没被你看完。",
      micro: null,
      hedges: ["不一定", "也可能"] }
  ];

  /* 未来候选:在已录语料里没有任何一份文案授权过它们。
     只做纪录,【不】参与 derive —— 覆盖率不是收进来的理由。 */
  var FUTURE_CANDIDATES = [
    { concept: "momentum_needs_meaning", variant: "meaning",
      reason: "no accepted copy in the recorded corpus licenses these cues" },
    { concept: "momentum_needs_meaning", variant: "not_importance",
      reason: "no accepted copy in the recorded corpus licenses these cues" },
    { concept: "angle_over_rest", variant: "angle",
      reason: "no accepted copy in the recorded corpus licenses these cues" }
  ];

  var DIRECTIONS = ["grounds", "moves", "drains", "calls"];

  /* 命令句 / 万用空话:一出现就不是情境层该说的话。
     刻意在这一层自己写一份,不去 require 已锁的锚点层 —— 那一层冻结,
     这一层不该建立对它的执行期依赖。 */
  var COMMANDING = ["你应该", "你必须", "你需要学会", "你最好", "请你", "记得要", "一定要"];
  var GENERIC = ["相信自己", "慢慢来", "照顾好自己", "一切都会好", "做真实的自己",
    "放轻松", "加油", "顺其自然", "活在当下", "爱自己"];

  var CJK = /[，。！？；：、（）「」“”\s—…]/g;
  function flat(s) { return String(s || "").replace(CJK, ""); }
  function has(t, list) { return list.some(function (w) { return String(t).indexOf(w) >= 0; }); }

  /* ── 语言授权:这份文案有没有在讲这一条 ──────────────────
     只看 coreInsight + explanation。
     刻意【不】看 reflectionPrompt —— 那一句专属于「今天的问题」。 */
  function cuesHitIn(copy, v) {
    var blob = flat((copy && copy.coreInsight) || "") + flat((copy && copy.explanation) || "");
    return v.cues.filter(function (w) { return blob.indexOf(flat(w)) >= 0; });
  }

  /* ── 一个方向 → 最多一条 ─────────────────────────────────
     两道关卡:语言命中,而且方向被批准。
     两道都过才有候选;命中但方向不符的,记进 blocked 供追溯,
     该方向退回中性入口。 */
  function candidateFor(dirKey, copy) {
    var out = { situation: null, blocked: [] };
    if (!copy || !copy.coreInsight) return out;
    var best = null, bestHits = 0;
    VARIANTS.forEach(function (v) {
      var hit = cuesHitIn(copy, v);
      if (!hit.length) return;
      if (v.allowedDirection !== dirKey) {
        out.blocked.push({ direction: dirKey, concept: v.concept, variant: v.variant,
                           allowedDirection: v.allowedDirection, cuesHit: hit,
                           reason: "direction-not-allowed" });
        return;
      }
      /* 命中最多的那一条胜出;同分时以词典里的先后为准 —— 完全确定性 */
      if (hit.length > bestHits) { bestHits = hit.length; best = { v: v, hit: hit }; }
    });
    if (!best) return out;
    out.situation = {
      direction: dirKey,
      fn: FUNCTIONS[dirKey] || null,
      concept: best.v.concept,
      variant: best.v.variant,
      situation: best.v.situation,
      text: best.v.text,
      micro: best.v.micro || null,
      cuesHit: best.hit,
      hedges: best.v.hedges.slice(),
      sourceFields: ["coreInsight", "explanation"]
    };
    return out;
  }

  /* ── 四个方向一起推导 ────────────────────────────────────
     纯函式:同一份文案永远得到同一组结果。
     认不出来的方向如实回 null —— 由呼叫端走中性入口,不编。 */
  function derive(copies, opts) {
    opts = opts || {};
    var order = opts.order || DIRECTIONS;
    var situations = {}, neutral = [], blocked = [];
    order.forEach(function (k) {
      var r = candidateFor(k, copies && copies[k]);
      blocked = blocked.concat(r.blocked);
      if (r.situation) situations[k] = r.situation;
      else { situations[k] = null; neutral.push(k); }
    });
    var n = order.filter(function (k) { return !!situations[k]; }).length;
    return { status: n ? "ok" : "none", version: VERSION,
             situations: situations, matched: n, neutral: neutral, blocked: blocked };
  }

  /* ── 回查 ────────────────────────────────────────────────
     每一条都要答得出:
       ① 这些字真的是词典里的吗(不是拼出来的)
       ② 授权 cue 真的在这份文案里吗
       ③ 方向契约有没有被守住
       ④ 保留字有没有掉
       ⑤ 有没有命令句 / 空话 / 问句一小步
     回查不过就当作没有 —— 宁可退回中性,也不给没根据的句子。 */
  function verify(result, copies) {
    var offenders = [];
    DIRECTIONS.forEach(function (k) {
      var s = result && result.situations && result.situations[k];
      if (!s) return;
      var def = VARIANTS.filter(function (v) {
        return v.concept === s.concept && v.variant === s.variant;
      })[0];
      if (!def) { offenders.push(k + ": unknown variant"); return; }
      if (def.allowedDirection !== k) { offenders.push(k + ": direction contract broken"); return; }
      if (s.situation !== def.situation || s.text !== def.text ||
          (s.micro || null) !== (def.micro || null)) {
        offenders.push(k + ": copy is not the reviewed wording"); return;
      }
      if (!cuesHitIn(copies && copies[k], def).length) {
        offenders.push(k + ": cues not present in the accepted copy"); return;
      }
      def.hedges.forEach(function (h) {
        if (def.text.indexOf(h) < 0) offenders.push(k + ": hedge dropped (" + h + ")");
      });
      var body = def.text + (def.micro || "");
      if (has(body, COMMANDING)) offenders.push(k + ": commanding voice");
      if (has(body, GENERIC)) offenders.push(k + ": generic filler");
      if (def.micro && /[？?]/.test(def.micro)) offenders.push(k + ": micro is a question");
    });
    return { ok: offenders.length === 0, offenders: offenders };
  }

  /* 输出空间是有限的 —— 测试把【全部可能进画面的字】列出来逐条审、
     再用 sha256 钉住。3.0 的输出空间是无限的,所以永远可能有一句
     怪的没被发现;这一版没有这个问题。 */
  function allPossibleStrings() {
    var out = [];
    VARIANTS.forEach(function (v) {
      out.push(v.situation);
      out.push(v.text);
      if (v.micro) out.push(v.micro);
    });
    return out;
  }

  return {
    VERSION: VERSION,
    SITUATIONS_BASELINE: SITUATIONS_BASELINE,
    VARIANTS: VARIANTS,
    FUTURE_CANDIDATES: FUTURE_CANDIDATES,
    FUNCTIONS: FUNCTIONS,
    DIRECTIONS: DIRECTIONS,
    COMMANDING: COMMANDING,
    GENERIC: GENERIC,
    cuesHitIn: cuesHitIn,
    candidateFor: candidateFor,
    derive: derive,
    verify: verify,
    allPossibleStrings: allPossibleStrings
  };
});
