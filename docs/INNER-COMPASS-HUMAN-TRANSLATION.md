# 我的内在指南 · Phase 4:人话翻译原型

> 这一阶段要验证的**只有一件事**:
> selection 层已经选出来的内部机制,能不能**稳定地**翻成自然、具体、简单、有温度,
> 但**不文学、不玄学、不心理诊断**的使用者语言。
>
> 这是 measurement,不是产品。所有产出一律 dev-only。

---

## 0. 这一阶段没有动的东西

| 项目 | 状态 |
| --- | --- |
| `app.html` | **未修改**(测试会挡:不得 import 翻译层) |
| `index.html` | 未修改 |
| `docs/edge/read-chart.ts` | 未修改,仍然没有 `kind="compass"` |
| 27 条 evidence rules + 2 条 guard | **未修改**(测试断言 29 条) |
| composite / tension 规则 | 未修改 |
| `assets/compass-selection.js` | 未修改 |
| 生命脉络 / 九个主题 prompts | 未修改 |
| Supabase / 资料库 / 认证 / Stripe | 未碰 |
| Claude API 呼叫 | **零新增** |
| 日记 / 心情 / 收藏 | **不读**(测试会挡) |

新增档案只有三个:
`assets/compass-translation.js`、`tools/compass-translation-report.js`、本文件。

---

## 1. 四层转换(不可跳级)

```
Layer 1  内部模式        patternKey            ← selection 层给的,这一层不重新读盘
Layer 2  内部机制        mechanism             ← 冻结规则表里那句英文机制描述
Layer 3  生活经验        lived                 ← 开发用:刻意写成「会发生什么事」的描述
Layer 4  使用者语言      coreInsight /
                        explanation /
                        reflectionPrompt
```

Layer 3 是关键的一层。没有它,Layer 2 → Layer 4 会直接变成把机制翻译成中文,
读起来就是「你的调节方式是先减少输入再整理」——正确,但那不是人话。
有 Layer 3 之后,同一条机制先被写成「状态乱掉的时候会先把外面的声音关小」,
Layer 4 才有东西可以写。

规则表里的 `mechanism` 与翻译表里的 `lived` 一对一,
所以每一句文案都能反查回它是从哪一条规则来的(`mechanismTraceable`)。

---

## 2. 契约

| 栏位 | 规格 | 强制方式 |
| --- | --- | --- |
| `coreInsight` | 15–35 个中文字,一句话 | `coreLenOk`,测试挡 |
| `explanation` | 70–130 个中文字 | `explLenOk`,测试挡 |
| `reflectionPrompt` | **一句**简单问题 | `promptIsQuestion` + 只允许一个句末标点 |
| 语言 | 这一版只做中文 | 测试禁止文案里出现英文字母 |

长度是按「去掉标点与空白之后的字数」算的。

---

## 3. 绝对禁区(自动护栏)

`checkCopy()` 会对每一条文案跑五组词表:

| 类别 | 举例 | 判定 |
| --- | --- | --- |
| **占星** | 星座、宫位、行星、相位、逆行、上升、星盘… | 出现即 `astrologyLeak = true`,**零容忍** |
| **玄学 / 过度文学** | 灵魂、宇宙、能量场、疗愈、绽放、显化… | 出现即 `literaryRisk = high` |
| **心理诊断** | 创伤、依恋、神经系统、失调、回避型… | 出现即 `diagnosticLeak = true` |
| **贴标签** | 「你是一个…」「你天生…」「你注定…」 | 出现即 `labelRisk = high` |
| **套话** | 相信自己、学会放下、找到平衡、拥抱真实的自己… | 出现即 `genericRisk = high` |

另有一组 **SOFT**(生命、内在、成长、自我、本质):
出现一次不算问题,累积三个以上才算文学风险。
这样处理是因为这些词在中文里太常用,直接禁用会把正常句子也挡掉。

**具体行为**:一条文案必须同时有「时间 / 条件标记」(的时候、之后、一旦、通常…)
与「动作标记」(说、写、停、配合、决定…)。
只有形容词的句子过不了 `concreteBehaviourPresent`。

---

## 4. 这一批原型写了什么

12 条模式 + 1 条 composite + 1 条 tension,共 14 条。
选的是 10 张测试盘里最常被 selection 选中的那些,不是挑好写的。

| patternKey | 方向 | accepted | 这 10 张盘里被选成 primary |
| --- | --- | --- | --- |
| `carry-before-noticing-cost` | drains | 4/10 | ✓ |
| `meaning-gates-effort` | moves | 9/10 | ✓ |
| `autonomy-or-stall` | moves | 4/10 | ✓ |
| `solitude-then-contact` | grounds | 8/10 | ✓ |
| `naming-to-settle` | grounds | 3/10 | — |
| `clarity-before-release` | drains | 2/10 | — |
| `depth-or-disengage` | calls | 8/10 | ✓ |
| `closeness-needs-room` | grounds | 8/10 | ✓ |
| `stability-before-movement` | grounds | 8/10 | — |
| `wider-frame-pull` | calls | **10/10** ⚠ | ✓ |
| `pace-set-by-the-other` | drains | 2/10 | — |
| `open-loop-stays-loud` | drains | 2/10 | ✓ |
| `regulation-sequence`(composite) | grounds | — | ✓ |
| `articulation-as-regulation ~ withdraw-to-reset`(tension) | — | — | — |

最后一栏标「—」的四条,在这 10 张盘里都触发过、也 accepted 过,
只是每次都输给同方向分数更高的候选,所以没被选成 primary(是 runner-up)。
它们仍然跑全表护栏。留着是刻意的:翻译表不该只覆盖恰好会被选到的那些。

⚠ `wider-frame-pull` 在 10 张盘里 10/10 accepted。
文案本身不通用(有具体行为、可否认),但**这条模式不构成「只有你」的说法**。
报告会把这件事标出来,而不是假装它是个人化发现。这属于 Phase 3 的 distinctiveness
问题,不是文案问题,这一阶段不动规则。

---

## 5. composite 必须表达顺序

`regulation-sequence` = `solitude-then-contact` + `naming-to-settle`,
`sequence = withdraw → process → articulate → reconnect`。

**错的写法**(把两个 child 的句子接起来):

> 你需要先一个人待一会儿……另外,有些事情你要讲出来才放得下。

**这里的写法**:

> 你通常不是一有感觉就想说,而是先消化,再开口。
> 事情刚发生的时候,你需要先把外面的声音关小,让自己想一想。等心里的东西变成一句讲得出口的话,
> 你才比较容易说,也才比较想回到人群里。顺序反过来的时候,你会讲得很辛苦。

差别在最后一句:它只有在「这是一个顺序」成立时才说得通。
两个特质并列的写法写不出「顺序反过来会怎样」。

测试会断言 composite 的 explanation **不包含**任何 child 的 explanation 原文。

---

## 6. 张力必须两边都保留

`withdraw-to-reset` × `articulation-as-regulation` 看起来矛盾:
一边要安静,一边要说出来。

**错的写法**:「你有时候想独处,有时候想倾诉。」——把张力写成情绪起伏,等于没说。

**这里的写法**:先讲它其实是同一件事的两段,再给顺序,
再讲顺序被打乱时各自会发生什么(「被催着先讲,你会讲得零碎;一直不讲,它又会一直留在那里」)。
两边都成立,而且都有代价。

---

## 7. 证据不足 → 不生成

```js
CT.translate({ status: "insufficient_evidence", primaryDirection: "drains" })
// → { status: "insufficient_evidence", patternKey: null, copy: null }
```

没有通用 fallback、没有安慰话、没有「这个方向的讯号比较分散,可以再观察看看」。
`copy` 就是 `null`。

10 张测试盘里有 3 个方向落在这里(C5/drains、C7/drains、C10/moves),
报告如实列出来。

**还没写翻译的模式**也一样:

```js
CT.translate({ patternKey: "trust-opens-slowly" })
// → { status: "not_translated", copy: null }
```

10 张盘 × 4 个方向共 37 个「有选到东西」的位置,其中 20 个有翻译、17 个如实回报
`not_translated`。这个数字不该被掩盖成 100% 覆盖。

---

## 8. 模式之间必须真的不一样

相似度用**相邻两字的 Jaccard**,不是单字。
中文单字重叠率天生就高(你、的、时候、事情…),单字比法会把两段完全不同的文案算成 0.5,
量不出任何东西。

目前 66 组配对里最高的是:

```
0.101  carry-before-noticing-cost × pace-set-by-the-other
0.092  solitude-then-contact × closeness-needs-room
0.092  naming-to-settle × open-loop-stays-loud
0.088  clarity-before-release × stability-before-movement
```

门槛设在 0.35。最高值 0.101 离门槛还很远,代表这 12 条不是同一个模板换词。

---

## 9. 盲测

```
node tools/compass-translation-report.js --blind
```

只印文案,不印 patternKey、不印机制、不印方向。要回答两个问题:

1. 看得出这是星盘生成的吗?
2. 看得出这是同一个模板吗?

九段文案里没有任何一段提到盘面,句子长度、开头方式、结尾方式都不一致
(有的从条件开始「忙的时候…」,有的从否定开始「你不是怕难…」,
有的从对比开始「同样的忙…」)。

---

## 10. 怎么跑

```bash
node tools/compass-translation-report.js            # 完整报告
node tools/compass-translation-report.js --blind    # 盲测语言检查
node tools/compass-translation-report.js --json     # 机器可读
node tests/run-tests.js                             # 全仓测试(含 Phase 4 的 43 项)
```

报告每一条会印:
Pattern / Mechanism / Lived experience / Core insight / Explanation / Prompt /
Quality flags,再加 **WHY THIS IS SPECIFIC** 与 **WHY THIS IS NOT GENERIC** 两段
——而且这两段是从实际检查结果推出来的,不是手写标语。

---

## 11. 护栏真的会咬(mutation 验证)

| 注入的错误 | 被抓到的断言 |
| --- | --- |
| 把「你的水星在第三宫」塞进 explanation | `[tr] 没有任何一条出现占星词汇` |
| 把 reflectionPrompt 改成陈述句 | `[tr] reflectionPrompt 都是问句` |
| 把 composite 改写成两个 child 句子的拼接 | `[tr] composite 文案不是两个 child 句子的拼接` |
| 把 explanation 缩短到 7 个字 | `[tr] 护栏会抓长度不足` |
| 写「你是一个需要说出来的人」 | `[tr] 护栏会抓标签句` |
| 写「相信自己,学会放下」 | `[tr] 护栏会抓套话` |

每一项都实际改过档案跑过一次,确认测试会红。

---

## 12. 目前的结论

**这条路径成立。** mechanism → lived experience → 人话,
在 12 条结构差异明显的模式上都翻得出来,而且:

- 没有任何一条漏出占星语言
- 没有任何一条变成鸡汤或心理诊断
- 彼此之间的相似度远低于门槛
- 证据不够的时候会安静地不生成,而不是补一段通用文字

**还没解决的:**

1. `wider-frame-pull` 这类 10/10 的模式,文案没问题但没有区辨力。
   这是选择层的题目,要在 distinctiveness 上处理,不能靠改文案。
2. 翻译覆盖率 20/37。剩下 9 条模式还没写(`belonging-on-own-terms`、
   `making-restores-agency`、`depth-or-nothing-in-closeness` 等)。
3. `recognitionPotential` 目前是从可量测的讯号推出来的代理指标
   (具体行为 + 长度 + 通用风险),**不是真实的辨识率**。
   要知道使用者会不会说「这就是我」,只能靠真人读。
4. 英文版没做。刻意的:先把中文做稳,避免两个语言同时漂。
5. 目前是开发者手写的确定性模板。下一步才是评估要不要让模型生成,
   以及生成之后用哪一套护栏挡——本文件里这一套就是为那件事准备的。

**这一阶段没有接 Claude API,没有进 production generation,没有改 UI。**
