# 我的内在指南 · 架构审计

> 对应 `INNER-COMPASS-CONTENT-SPEC.md`。
> 这份是**调查报告**，不是实作。所有代码片段都只是文件，没有任何一行进产品。
> 调查对象：本仓库当前的 `main` + 内在指南分支。

---

## A · 目前有哪些原始星盘资料

星盘由 `assets/astro/astro-core.js` 的 `computeNatalChart()` 在**前端本机**算出来，
结果放在 `app.html` 的模块变数 `curResult`。实测一张盘的输出：

```
chart.ang        asc / mc / dsc / ic / armc / eps / ep / vertex / antivertex
chart.cusps      12 个宫头黄经
chart.planets    10 颗  每颗带 key / name / kw / lon / sign / signIdx /
                        degInSign / deg / min / sec / house / speed / retro
chart.extras     23 个  ASC DSC MC IC EP NNode SNode NNodeMean Chiron
                        Ceres Pallas Juno Vesta Eros433 Psyche16 Lilith
                        PoF PoSpirit PoE PoM Vertex SMmid Eris
chart.aspects    18 条  aKey / bKey / type / name / angle / exact / orb /
                        tone / applying / separating
chart.stats      元素、三方四正等统计
chart.isDay      日夜盘
chart.system     宫位制（placidus，极区回落 porphyry）
```

另外，`chartPayload(res)` 是目前送去服务端的**精简版**，只有：

```js
{ ang:{asc,mc}, cusps, planets:[{key,lon,house,retro,speed}], extras:[{key,lon,house}] }
```

⚠ 注意：**相位（aspects）目前没有送去服务端**——服务端自己用 `aspBetween()` 重算。

### 还有一层更有价值的东西：九步定调

`docs/edge/read-chart.ts` 的 `computeNineSteps(chart)` 会算出一份**高度结构化**的
盘面解读中间层，回传：

```
step1  日夜盘 / 太阳宫位 / 裁决星
step2  元素与三方四正百分比、缺什么、半球、Jones 格局
step3  星群（sign / house 两轨）、空宫、焦点指针
step4  （见档案）
step5  命主星（现代 / 传统）、终点指针
step6  每颗行星的力量评分、最强 ace、最受压 burden、飞星
step7  结构格局 patterns、最紧的三个相位 tightestThree、特殊旗标
step8  南北交点方向、指针检查
mind   集中度 / 指针裁决 / 显隐 / 主题宫 / lifePattern
```

**这是内在指南最该用的证据层**——它已经把「哪些讯号强、哪些重複、哪些互相矛盾」
算好了，正好对应规格第五部分的证据标准。

⚠ 但它**只存在于服务端的 Edge Function 里**，前端拿不到，也没有被存下来。
这是本次审计最重要的一个缺口，见 F 节。

---

## B · 九个主题目前存了什么、拿得到什么

存在星盘物件的 `chart.topics`（英文版 `chart.topics_en`），一个主题一笔：

```js
chart.topics[tid] = {
  tagline:  "一句话核心命题",
  sections: [{ title, body }, …],   // 4–6 段，每段 250–450 字
  aha:      ["最多两条值得记住的理解"],
  question: "留给他的一个问题",
  action:   "至多一个轻量行动建议",
  ver, ts, raw
}
```

九个 tid：`self / emotion / career / family / love / partner / wealth / study / body`

**结构化程度**：中等偏好。`tagline` / `aha` / `question` / `action` 是短栏位，
可以直接当讯号用；`sections[].body` 是自由散文，要抽取模式需要再做一层处理。

**每个主题各自抽了哪些盘面因子**（`TOPIC_SPEC[tid].data`）——
这一点对判断「两个主题是否算独立证据」非常关键：

| 主题 | 宫位 | 主要行星 / 点 |
|---|---|---|
| self 个人 | 1, 10 | 全部十颗 + 元素 + ace/burden + mind |
| emotion 情感模式 | 4,5,7,8 | Venus Mars Moon Neptune + Eros Juno |
| career 事业 | 2,6,10,11 | Sun Mars Saturn Jupiter Mercury + ace/burden |
| family 家庭 | 3,4,10 | Moon Saturn Sun Mercury + Chiron |
| love 感情 | 5,7,8 | Venus Mars Moon Saturn + Juno Vertex |
| partner 心动与吸引 | 7 | Venus Mars + Vertex Juno |
| wealth 金钱 | 2,6,8,11 | Venus Jupiter Saturn Pluto Mars + PoF |
| study 学习方式 | 3,9 | Mercury Jupiter Saturn Moon + 元素 |
| body 身心状态 | 1,6,12 | Sun Moon Mars Saturn Neptune + Chiron |

→ 主题之间**有重叠**（例如 Saturn 出现在 career / family / love / wealth / study / body）。
所以「两个主题都提到同一件事」**不自动等于两份独立证据**，见 G 节。

---

## C · 生命脉络目前存了什么

存在 `chart.lifemap`（英文版 `chart.lifemap_en`），形状与主题几乎一样，**多一个 steps**：

```js
chart.lifemap = {
  tagline, sections:[{title,body}], aha:[],
  steps: [{title, body}, …],        // 三件可以着手的事
  question,
  previews: { ver, styleId, ts, map:{ "s0":{preview,keyInsights}, "a0":{…} } },
  ver, ts, raw
}
```

`previews.map` 是上一期加的阅读预览（读完正文之后重新写的引子 + keyInsights），
它是**已经压缩过的洞察**，对内在指南特别好用——但它的独立性等同生命脉络本身。

---

## D · 这些来源彼此够独立吗？——**部分独立，必须分级**

我实际读了 `docs/edge/read-chart.ts` 的生成链路，结论如下。

### 生成依赖关系（实测）

```
生命蓝图 blueprintMsg(ns, chart)
    └─ 只吃 九步定调 + 盘面           ← 独立

九个主题 topicMsg(ns, chart, tid, blueprint, topics)
    ├─ 实质内容来自 pickData(ns, chart, TOPIC_SPEC[tid].data)   ← 各自独立抽取
    └─ blueprint 与已读主题只透过 saidBefore() 进来，
       而且是当作「【避免重复】他已经读过下面这些内容」的**负向约束**
                                        ← 实质上独立，但有弱耦合

生命脉络 mapMsg(ns, chart, blueprint, topics)
    └─ 「把前面读过的所有理解连起来」「收拢：把散落的理解连成一条线」
                                        ← **衍生物，不独立**
```

关键差别在于**前文是怎么被用的**：

- `topicMsg` 用它来**避免重複**（「同一个核心模式可以再次出现，但必须解释它在本主题中的不同作用」）
- `mapMsg` 用它来**当素材**（这一章的任务就是综合前面九章）

### 结论

| 来源 | 独立性 |
|---|---|
| 盘面 / 九步定调 | **完全独立**（一切的源头） |
| 生命蓝图 | **独立**（只吃盘） |
| 九个主题（单一主题内部） | **实质独立**（各自抽各自的盘面因子） |
| 九个主题彼此之间 | **部分独立**（抽取因子有重叠 + 弱负向耦合） |
| 生命脉络 | **不独立**（是九个主题 + 蓝图的综合） |
| 生命脉络的 previews | **不独立**（是生命脉络的再压缩） |

---

## E · `Compass.buildFromChart(chart)` 现在拿得到什么

现在传进去的是 `activeChart()`，也就是资料库那一列 `charts.data` 展开后的整个物件：

**拿得到** ✅

```
出生资料    date / time / lat / lon / tzId / city / sys / nick
生命蓝图    chart.reading      { spine, cards[], chapters[{title,summary,body}] }
九个主题    chart.topics       { tid: {tagline, sections[], aha[], question, action} }
生命脉络    chart.lifemap      { tagline, sections[], aha[], steps[], question, previews }
三十道题    chart.qa           { qid: {…} }
收藏        chart.favs         [{key, text, source, section, ts}]
英文版      chart.*_en
```

**拿不到** ❌

```
算好的盘面   curResult（planets / aspects / cusps / extras / stats）
             —— 是 app.html 的模块变数，没有挂在 chart 上
九步定调     computeNineSteps() 的输出
             —— 只存在于 Edge Function 执行期间，没有回传、没有存下来
```

### 所以 E 的答案是：**三个来源里，两个半拿得到**

生命蓝图、九个主题、生命脉络（含 previews）**现在就拿得到，完全不必动既有生成**。
真正缺的是**盘面本身**与**九步定调**——也就是规格第五部分要求的「2 个独立盘面讯号」
那一半，目前在前端是拿不到的。

---

## F · 最小接线需求

按「改动由小到大」排列。**本期一行都不实作。**

### F1 · 把算好的盘面交给内在指南（最小、零风险）

`curResult` 已经在记忆体里，只是没有传进去。未来只要在呼叫处多带一个参数：

```
Compass.buildFromChart(chart)  →  Compass.build({ chart, natal })
```

- 不动既有生成、不动资料库、不多一次 API
- 可以拿到 planets / aspects / cusps / extras / stats / isDay
- **这一步就能满足「2 个独立盘面讯号」的最低证据标准**

### F2 · 让九步定调可用（建议，但要想清楚）

九步定调是这套系统最值钱的证据层，但它现在只活在 Edge Function 里。三条路：

| 做法 | 代价 | 风险 |
|---|---|---|
| **F2-a** 在 Edge Function 新增 `kind="compass"`，由服务端自己算九步再生成 | 多一次 API 呼叫 | 低。与既有四层完全隔离，比照 `kind="preview"` 的做法 |
| **F2-b** 把 `computeNineSteps` 抽成前后端共用模组 | 要重构一支 500 行的档案 | 中。它是既有四层生成的共同基础，动它等于动全部 |
| **F2-c** 让既有生成顺手把九步结果存一份到 `charts.data` | 要改既有回传 | 中高。会碰到既有生成路径 |

**建议 F2-a**：与既有内容完全隔离，且与上一期 `kind="preview"` 是同一个模式（已验证可行）。
`kind="compass"` 只读盘面 + 既有三层内容，**不改写它们任何一个字**。

### F3 · 存放生成结果

比照 lifemap 的 previews：存进 `charts.data` 的一个新键（例如 `chart.compass_content`），
带 `ver` 与内容杂凑，正文改变时自动失效。**不需要 migration。**

⚠ 与日记记录（`compass_entries` 表）分开——那是使用者写的，这是生成的，
两者生命週期完全不同。

### 最小可行路径

```
F1（传盘进去）
  → 先用盘面 + 既有三层内容跑通「证据 → 模式 → 卡片」的整条链
    → 验证证据标准与多样性检查真的挡得住
      → 再决定要不要上 F2-a
```

---

## G · 循环论证风险 ——**存在，而且必须明写规则**

### 风险 1 · 生命脉络与九个主题不是两份独立证据

**生命脉络是从九个主题生成的**（`mapMsg` 的任务就是「把前面读过的所有理解连起来」）。

所以这种推理是**循环的**：

```
✗ 九个主题说你很谨慎
  + 生命脉络也说你很谨慎
  = 两份独立证据
```

生命脉络说你谨慎，**很可能只是因为**它读了九个主题说你谨慎。
这不是第二个证据，这是同一个证据被複述了一次。

**规则**：
> 九个主题与生命脉络在同一条洞察上，**最多合计算一份**交叉验证。

### 风险 2 · previews 是生命脉络的再压缩

`lifemap.previews` 是读完生命脉络正文之后重新写的。它与生命脉络**是同一份证据**。

**规则**：
> previews 不得与生命脉络分开计为两份。

### 风险 3 · 主题之间的因子重叠

九个主题各自抽取的盘面因子有重叠（见 B 节表格）。
两个主题都指向同一件事，可能只是因为它们抽到同一颗行星。

**规则**：
> 两个主题要算成两份独立证据，必须它们抽取的盘面因子**没有产生这个结论的共同来源**。
> 例如 career 与 study 都提到土星 → 不算两份。

### 风险 4 · 生命蓝图的弱耦合

生命蓝图只吃盘，是独立的。但它**被喂进**了后面每一次主题与脉络生成。
所以「蓝图 + 主题都这么说」的独立性，弱于「蓝图 + 盘面讯号都这么说」。

**规则**：
> 生命蓝图可以算一份交叉验证，但不得与九个主题叠加成两份。

---

## H · 证据分级（给未来的生成用）

| 等级 | 来源 | 能不能当证据 |
|---|---|---|
| **主要证据** PRIMARY | 盘面讯号本身：行星状态、相位、宫位、星群、力量评分、元素/三方四正、格局、交点 | ✅ 可以，且**必须**至少两个互相独立的 |
| **支持证据** SUPPORTING | 九步定调的衍生判断：mind / lifePattern / ace / burden / tightestThree / specialFlags / focusPointer | ✅ 可以，用来解释机制怎么运作 |
| **交叉验证** CROSS-VALIDATION | 生命蓝图、九个主题、生命脉络（含 previews）—— 三者**合计最多一份** | ✅ 可以，但只能当第三份 |
| **情境资讯** CONTEXTUAL | 读了几个主题、阅读顺序、生成时间、语言 | ⚠ 只能影响措辞与优先级，**不得**当证据 |
| **不算独立证据** NOT INDEPENDENT | 生命脉络 vs 九个主题互相印证；previews vs 生命脉络；同一盘面因子推出的两个主题结论；内在指南自己之前产出的内容 | ❌ 一律不得叠加计数 |

### 一个被低估的资料来源：使用者自己的行为

这两样**不是模型生成的**，是使用者自己做的，因此与盘面**完全独立**：

```
chart.favs            他主动收藏了哪些句子（带 source / section / 原文）
compass_entries       他在「此刻的我」写了什么、选了什么心情
```

**这是整个系统里唯一能验证「我们说的对不对」的外部讯号。**

但要谨慎：

- 数量少的时候没有统计意义
- 不得用来推论心理状态（违反规格第二十部分）
- 建议只当**排序讯号**（他反覆收藏关于某个主题的句子 → 那个模式对他重要），
  **不当**证据本身
- 日记内容涉及隐私，若未来要送进生成，必须先取得明确同意

---

## I · 既有内容够不够结构化？——**一半够，一半是散文**

| 栏位 | 形态 | 可抽取性 |
|---|---|---|
| `topics[tid].tagline` | 一句话 | ✅ 好 |
| `topics[tid].aha[]` | 最多两条短句 | ✅ 好 |
| `topics[tid].question` / `action` | 短句 | ✅ 好 |
| `lifemap.tagline` / `aha[]` / `steps[].title` | 短句 | ✅ 好 |
| `lifemap.previews.map[*].preview` | 2–4 句 | ✅ 好（已压缩过） |
| `lifemap.previews.map[*].keyInsights[]` | 1–3 条 | ✅ **最好**（已经是提炼过的洞察点） |
| `reading.spine` / `cards[].line` | 短句 | ✅ 好 |
| `*.sections[].body` | 250–450 字散文 | ⚠ 需要再处理 |
| `reading.chapters[].body` | 400–550 字散文 | ⚠ 需要再处理 |

**结论**：短栏位（tagline / aha / keyInsights / cards）**已经够结构化**，
足以支撑交叉验证那一份。长散文**不必**在第一版就处理 ——
硬去解析散文既贵又不可靠，而且交叉验证本来就只能算一份。

> 建议第一版只吃短栏位。散文留在原地，一个字都不动。

---

## J · 建议的未来输入契约

题目里给的例子是 `Compass.build({ chartEvidence, themeContext, lifeThreadContext })`。
**我不建议照抄**，理由有两个：

1. 它把「主题」与「生命脉络」并列成两个平行输入，
   **在型别上就暗示它们是两份独立证据**——而 G 节证明它们不是。
   契约本身应该让人不容易犯这个错。
2. 它没有位置放最值钱的九步定调，也没有位置放使用者自己的行为讯号。

### 建议的形状（文件，不实作）

```js
Compass.build({
  // ① 主要证据：盘面本身。唯一可以计为「独立讯号」的来源。
  natal: {
    planets, aspects, cusps, ang, extras, stats, isDay
  },

  // ② 支持证据：九步定调（F2 接上之后才有；没有时这一层就是 null）
  structure: null,   // { step1…step8, mind }

  // ③ 交叉验证：三个来源包在同一个物件里，
  //    型别上就说清楚「这一整包合计最多算一份」
  priorReadings: {
    blueprint,          // { spine, cards[] }
    themes,             // { tid: {tagline, aha[]} }
    thread,             // { tagline, aha[], keyInsights[] }
    _countsAs: 1        // ← 明写：整包只算一份交叉验证
  },

  // ④ 情境：只影响措辞与排序，不得当证据
  context: { lang, themesRead, generatedAt }
})
```

回传形状沿用已经定好的生成契约（`Compass.GENERATION_CONTRACT`），
不需要改动 —— 那一层已经在上一期做好并测过了：

```js
{ version, directions:[{key,no,en,label,text}], reminders:[{key,when,line}], question }
```

⚠ 但规格第十四部分要求每个方向有**三样东西**（核心洞察 / 说明 / 提问），
现行契约的 `directions[].text` 只有一个栏位。未来要扩成：

```js
directions: [{ key, no, en, label, core, explanation, prompt }]
```

这是一个**纯新增**的欄位扩充，UI 那边要跟着加两个栏位的显示位置。
本期不动。

---

## 最后：本期实际做了什么

**只有两份文件**：

```
docs/INNER-COMPASS-CONTENT-SPEC.md        内容智能系统规格
docs/INNER-COMPASS-ARCHITECTURE-AUDIT.md  这一份
```

**没有碰**：生成引擎、Claude API、Life Themes 的 Prompt、生命脉络生成、
内在指南 UI、路由、资料库、localStorage、Supabase、认证、任何既有内容。

等你看完审计并明确同意之后，再开始下一阶段。
