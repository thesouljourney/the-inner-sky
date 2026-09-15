/* ============================================================
   我的内在指南 · 已录制的生成结果(Phase 6 · dev fixture)
   ------------------------------------------------------------
   ⚠ 这不是从浏览器打出去的 API 回应。

   这一批文案是 Claude 依照 compass-generation.js 产出的
   system + user prompt(promptVersion = compass-v1)实际写出来的,
   但走的是开发工作阶段的对话,不是 HTTPS 请求。
   录下来的用途只有三个:
     1. 让 Phase 6 的验证管线有真实的模型输出可以跑
     2. 让 dev preview 在还没部署 Edge Function 之前就看得到结果
     3. 当作日后换 prompt 版本时的比较基准

   所以 UI 上它是一个【明写出来的】传输方式(「已录制」),
   永远不会冒充 live API —— 不准在 live 失败时自动退回这一份。
   ============================================================ */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CompassRecorded = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var PROMPT_VERSION = "compass-v1";
  var MODEL = "claude-opus-5 (in-session, not an HTTP API call)";

  var R = {
    C1: {
      grounds: {
        coreInsight: "你要先安静下来，把话想成形，才有办法重新靠近人。",
        explanation: "刚发生的时候，你多半不想说，也说不好。你需要先把外面的声音关小，让事情在心里排出顺序；等它变成一句讲得出来的话，你才比较容易开口，也才重新想回到人群里。次序被打乱的时候，你会讲得很卡。",
        reflectionPrompt: "那件事，你现在是还需要安静一会儿，还是已经想得差不多了？"
      },
      moves: {
        coreInsight: "事情说得通的时候你做得很久，说不通的时候会突然没力。",
        explanation: "你的力气不是照事情的重要程度分配的，而是看它对你还讲不讲得通。讲得通的时候，再繁琐你也接得住；一旦只剩下把它交出去这个理由，同样的量会突然变得很难撑。别人常以为你是累了。",
        reflectionPrompt: "手上这几件事里，哪一件你现在还说得出它为什么值得做？"
      },
      drains: {
        coreInsight: "你会一段一段地靠近一个人，每一段都先确认过再走下一段。",
        explanation: "你不是不愿意靠近，而是要先看看这一步稳不稳，才愿意再往前放一点。所以别人感觉到的距离，常常比你心里实际的距离远一截。真正花掉你力气的，是每一段之间那个反复确认的过程。",
        reflectionPrompt: "现在有没有一个人，其实你早就可以再多说一点了？"
      },
      calls: {
        coreInsight: "同一件事重复久了，你的注意力会先散掉，而不是先累。",
        explanation: "难度对你来说不太是问题，重复才是。同一个流程做到第三遍，你会开始走神，做得完但整个人是空的。这时候让你回来的通常不是休息，而是换一个角度重新看它一次，哪怕事情本身没变。",
        reflectionPrompt: "最近有哪件事，你其实是想换个做法，而不是想停下来？"
      }
    },

    C4: {
      grounds: {
        coreInsight: "乱起来的时候，你要先退开一点，之后才想找人。",
        explanation: "状态不对的时候，你的第一反应不是找人说，而是先把外面的事情挡一挡。等自己里面理顺了，你才会重新想跟人联系。那段独处不是在躲谁，是你把自己接回来的方式；反过来先被要求说清楚，你会更乱。",
        reflectionPrompt: "今天有没有一段时间，是可以完全不用回应任何人的？"
      },
      moves: {
        coreInsight: "讲得通的时候你很耐，讲不通的时候你撑不了几天。",
        explanation: "决定你投入多少的不是这件事有多要紧，而是它对你还成不成立。成立的时候，你可以在一件事上磨很久也不觉得勉强；一旦变成照着做就好，热度掉得很快。所以你不是没有毅力，是需要那个理由还在。",
        reflectionPrompt: "现在做的事情里，有哪一件的理由已经不见了？"
      },
      drains: {
        coreInsight: "被看见的时候，你先感觉到的是风险，不是被肯定。",
        explanation: "事情被摊到台面上，你的第一反应通常是把自己收一点，而不是松一口气。所以你会挑场合、挑说法，露多少都算过。真正耗掉你的不是做那件事，是做完之后还要处理「有多少人在看」这件事。",
        reflectionPrompt: "最近有没有一次，你其实可以让别人多看到一点？"
      },
      calls: {
        coreInsight: "只停在表面的事，你人在那里，心思会飘走。",
        explanation: "客套、流程、只说一半的对话，会让你越做越远。一旦可以往下问一层、看到事情背后连着什么，你反而没那么容易累。你要的不是更轻松的事，是可以认真的事——认真的时候你才真的在场。",
        reflectionPrompt: "最近哪一件事，你其实还想再往下问一层？"
      }
    },

    C6: {
      grounds: {
        coreInsight: "留得住你的关系，通常是那种你随时可以退一步的。",
        explanation: "靠得太近的时候，你会开始想往后站，但那不是想离开。你需要知道随时可以有一段自己的时间——重点是那个余地还在，不是你有多常用它。一旦那块空间被收走，你才会真的开始往外走。",
        reflectionPrompt: "现在的关系里，有没有一段时间是只属于你自己的？"
      },
      moves: {
        coreInsight: "一天被排满的时候，你会慢慢没劲，哪怕事情你不讨厌。",
        explanation: "你在意的不太是做什么，而是有没有一点自己决定的余地。安排全部来自外面的时候，力气会一点一点漏掉；只要有一小块是你自己排的，同样的一天又会重新转得动。你要的不是更少的事，是一处自己说了算的地方。",
        reflectionPrompt: "这一周有没有哪一件事，是你可以自己决定怎么做的？"
      },
      drains: {
        coreInsight: "被看到的时候，你会先绷起来，而不是先高兴。",
        explanation: "越多人在看，你越会先算风险：讲到哪里、说到什么程度、之后要怎么收。你跟别人相处本来就容易顺着对方走，再加上被注视，那一层要顾的东西就更多。累通常是从这里来的，不是从事情本身来的。",
        reflectionPrompt: "最近有没有一次，你其实可以不用管别人怎么看？"
      },
      calls: {
        coreInsight: "事情只在表面转，你会先走神，然后整个人淡掉。",
        explanation: "浅的场合和浅的关系，对你都是同一件事：做得完，但人不在里面。一旦可以往下走一层，或者换个角度重新看它，你反而会突然醒过来。你要的不是新鲜，是可以往深处走的那一步。",
        reflectionPrompt: "最近哪一场对话，你其实还想再往下说一层？"
      }
    },

    C10: {
      grounds: {
        coreInsight: "有退路的时候，你才待得住一群人里面。",
        explanation: "你不是不想参加，而是要知道自己什么时候可以走、参加到什么程度由你说了算。有这个余地在，你可以待得很久也很自在；一旦变成非到场不可、非融入不可，你会先在心里退出去，人还在那里。",
        reflectionPrompt: "最近有没有一个场合，是你可以照自己的方式参加的？"
      },
      drains: {
        coreInsight: "你决定得不慢，慢的是决定完之后那一段反复。",
        explanation: "该做决定的时候你做得出来，也按时做了。麻烦的是之后——你会回头再看一次，再确认一次，隔几天又想起来。真正花掉的力气不在选择本身，在选完以后那段一直没关上的检查。",
        reflectionPrompt: "有没有一件事，其实你已经决定了，只是还没让它过去？"
      },
      calls: {
        coreInsight: "泛泛地熟起来，对你来说比不熟还费力。",
        explanation: "闲聊、点头之交、只交换近况的场合，你参加完会觉得比工作还累。要等到可以说点真的东西，你才会真的靠过去。所以你的人不多，但一旦进去了，你是认真在里面的——你要的是能换到东西的那种来往。",
        reflectionPrompt: "最近有没有一次对话，你其实想说得再真一点？"
      }
    }
  };

  /* ── compass-v1.1 的校准样本(Phase 6.2)─────────────────────
     同样是 Claude 依照 compass-v1.1 的 prompt 实际写的,同样【不是】HTTP API 回应。
     写的是 C1 那一组机制 —— 也正好是使用者自己那张盘选中的四条。
     用途:让你在真的打 API 之前,先看到 v1.1 应该长什么样子。 */
  var R11 = {
    C1: {
      grounds: {
        coreInsight: "你不是不想说，多半只是还没把自己整理好。",
        explanation: "事情刚发生的时候，你通常讲不清楚，也不太想讲。你需要先把外面的声音关小一点，让心里的东西自己沉下来，变成一句讲得出口的话，你才比较容易开口，也才重新想靠近人。所以有些时候，你不一定要先解释，先让自己安静一会儿就够了。",
        reflectionPrompt: "最近有没有一件事，你其实还没想清楚，就被要求先说出来了？"
      },
      moves: {
        coreInsight: "你会投入很久的事，通常是你说得出为什么要做的那一种。",
        explanation: "当你知道这件事为什么要做、会把你带到哪里，你可以在上面耗很久也不觉得勉强。一旦只剩下交出去就好这个理由，同样的事情会突然变得很难推动。所以没力气的时候，可以先看看是不是那个自己认同的理由不见了。",
        reflectionPrompt: "最近有没有一件事，你忽然发现自己说不出为什么还在做它？"
      },
      drains: {
        coreInsight: "真正让你累的，可能不是靠近，而是靠近之前那一次次的确认。",
        explanation: "你通常是先说一点，停下来看看对方怎么接；没问题，再多说一点。这样一段一段来，你会觉得比较稳，可是每一段之间都要重新掂量一次，那个反覆掂量本身就很花力气。所以慢一点没关系，只是也可以先看看，有些人是不是其实已经不用再确认了。",
        reflectionPrompt: "现在有没有一个人，其实你早就可以少确认几次了？"
      },
      calls: {
        coreInsight: "你会重新有兴趣，常常是因为换了一个看法，而不是换了一件事。",
        explanation: "同一件事做到第三遍，你会开始走神，做得完，但整个人不在里面。难的部分你反而撑得住，重复才是真正把你磨掉的。这时候让你回来的，往往不是休息，是有人给了它另一层意思。所以你可以先不用急着换掉它，看看它还有没有另一层没被你看见。",
        reflectionPrompt: "最近有没有一件事，你其实是想换个角度，而不是想放下它？"
      }
    }
  };

  /* ── compass-v1.2 的校准样本(Phase 6.3)─────────────────────
     只修三件事:方向那一句不要变成「所以 + 建议」的模板、
     不替使用者判断现实、calls 真正回答「我会往哪里靠近」。
     同样是依 v1.2 的 prompt 实际写的,同样【不是】HTTP API 回应。 */
  var R12 = {
    C1: {
      grounds: {
        coreInsight: "你不是不想说，多半只是还没把自己整理好。",
        explanation: "事情刚发生的时候，你通常讲不清楚，也不太想讲。你需要先把外面的声音关小一点，让心里的东西慢慢沉下来，变成一句讲得出口的话，你才比较容易开口，也才重新想靠近人。有些时候，先让自己安静一会儿就够了，不一定要马上解释。",
        reflectionPrompt: "最近有没有一件事，你其实还没想清楚，就被要求先说出来了？"
      },
      moves: {
        coreInsight: "你会投入很久的事，通常是你说得出为什么要做的那一种。",
        explanation: "当你知道这件事为什么要做、会把你带到哪里，你可以在上面做很久，也不觉得勉强。一旦只剩下交出去就好这个理由，同样的事情会突然变得很难推动。没力气的时候，可以先看看那个自己认同的理由还在不在，而不是先怀疑自己不够努力。",
        reflectionPrompt: "最近有没有一件事，你忽然发现自己说不出为什么还在做它？"
      },
      drains: {
        coreInsight: "真正让你累的，可能不是靠近，而是靠近之前那一次次的确认。",
        explanation: "你通常是先说一点，停下来看看对方怎么接；没问题，再多说一点。这样一段一段来，你会觉得比较稳，可是每一段之间都要重新掂量一次，那个反覆掂量本身就很花力气。慢一点没有关系。只是当你发现自己一直停在再确认一下，也许可以先看看，现在到底是什么让你放不下心。",
        reflectionPrompt: "最近有没有一段关系，让你发现自己一直在等一个可以放心的感觉？"
      },
      calls: {
        coreInsight: "你容易被那些还有另一层可以理解的东西吸引。",
        explanation: "对你来说，新鲜不一定来自换一件事。有时候是原本熟悉的东西突然多出一个解释，或者你发现它后面还连着一个更大的问题。只要还有东西可以继续理解，你通常就还会往里面走，就算没有人要求你。如果最近有件事你一直绕回去想，那不一定是分心，也可能只是它还有一层没被你看完。",
        reflectionPrompt: "最近有没有什么事，你明明没有非做不可，却还是一直回去想它？"
      }
    }
  };

  /* 包成 transport 可以吃的形状 —— 与真实 API 回来的文字格式完全一致,
     这样验证管线跑的是同一条路径。 */
  function textFor(caseId, version) {
    var byVersion = { "compass-v1.1": R11, "compass-v1.2": R12 };
    var pick = byVersion[version];
    var m = (pick && pick[caseId]) ? pick[caseId] : R[caseId];
    if (!m) return null;
    return JSON.stringify({
      directions: Object.keys(m).map(function (k) {
        return { direction: k, coreInsight: m[k].coreInsight,
                 explanation: m[k].explanation, reflectionPrompt: m[k].reflectionPrompt };
      })
    });
  }
  function transportFor(caseId, version) {
    return function (p) {
      var t = textFor(caseId, (p && p.promptVersion) || version);
      if (!t) return Promise.reject(new Error("no recorded generation for " + caseId));
      return Promise.resolve(t);
    };
  }

  return {
    PROMPT_VERSION: PROMPT_VERSION, MODEL: MODEL,
    CASES: Object.keys(R), RAW: R, RAW_V11: R11, RAW_V12: R12,
    CASES_V11: Object.keys(R11), CASES_V12: Object.keys(R12),
    textFor: textFor, transportFor: transportFor,
    isRecorded: true
  };
});
