# 我的内在指南 · Phase 6:Claude 生成层原型

> **Evidence decides what may be said.
> Selection decides what deserves to be said.
> Claude decides only how to say it.**
>
> 这一阶段是 dev prototype。没有 production rollout、没有自动生成、没有 persistence。

---

## 0. 一句话结论

四张测试盘(C1 / C4 / C6 / C10)的 15 个 ready 方向,**第一次生成就全部通过 11 道验证**,
零 retry、零占星外漏、零编造原因、零鸡汤、零诊断。
同一条机制在两个人身上写出来不一样(相似度 0.10–0.11),
不同机制之间最高相似度 0.132(门槛 0.35)。

**但有一件事必须先讲清楚(见 §J 的诚实说明):**
这一批文案是 Claude 依照 `compass-v1` 的 prompt **实际写的**,
可是走的是开发工作阶段的对话,**不是从浏览器打出去的 HTTPS API 请求** ——
因为这个开发环境没有 `ANTHROPIC_API_KEY`,Edge Function 也还没部署。
live 那条路已经写好、接好、测过失败路径,但还没有真的通过网路跑过一次。

---

## A. File Plan / 实际档案

**新增 4 个**

| 档案 | 为什么 |
| --- | --- |
| `docs/edge/compass-generate.ts` | **独立的 Edge Function**(不是 read-chart 的第五种 kind,理由见 §B) |
| `assets/compass-generation.js` | contract 建构 · scrub · prompt · 解析 · 11 道验证 · 一次 retry · rubric |
| `assets/compass-recorded.js` | 已录制的生成结果(dev fixture,明写不是 API 回应) |
| `tools/compass-generation-report.js` | 报告 / `--payload` / `--prompt` / `--blind` / `--json` |

**修改 2 个**:`app.html`(Generation Mode 切换 + 生成按钮 + 盲读 + 状态)、`tests/run-tests.js`。

**冻结、一个字都没动**

- `assets/compass-evidence.js`(27 条规则 + 2 条护栏、evidence scoring、独立锚点记账、门槛)
- `assets/compass-selection.js`(权重、distinctiveness、redundancy、insufficient 逻辑)
- `assets/compass-translation.js`(所有确定性文案)
- `assets/compass-preview.js`、`assets/compass-cases.js`
- `docs/edge/read-chart.ts` —— **仍然没有 `kind="compass"`**
- `index.html`、Supabase、认证、付费

五个 sha256 钉在测试里(规则表 / composite / 方向归属 / selection 权重 / 翻译文案),改一个字就红。

---

## B. API 架构:为什么独立成一支 Edge Function

我先读了 `read-chart.ts` 才决定,不是预设。

`read-chart` 的四种 kind 有一个共同入口:

```ts
if (!chart || !chart.planets || !chart.cusps || !chart.ang) return 400;
let ns = computeNineSteps(chart);
...
const systemBlocks = [{ text: MASTER_SYSTEM, ... }];
```

也就是说,**每一种 kind 都以原始盘面为入口,而且一律套用整份占星写作指令**。
Phase 6 的核心规则正好相反:写作阶段绝对不能看到盘面。

所以独立端点:

1. `compass-generate` **根本不接受星盘栏位** —— 送了就 400。结构上不可能外漏。
2. 完全不套用 `MASTER_SYSTEM`。
3. 自己的 prompt 版本、自己的失败语义(`generation_failed`,不退回通用文案)。
4. `read-chart.ts` 一个位元组都不必改,四种既有内容零风险。
5. 之前几个阶段一路断言的「服务端仍然没有 `kind="compass"`」继续成立。

```
raw chart → evidence engine → accepted patterns → selection engine
          → CompassGenerationInput → [compass-generate] → Claude
          → 11 道验证 → preview
```

前端 `compass-generation.js` 扫一次 payload,服务端 `compass-generate.ts` **再扫一次**。
两份实作刻意分开写 —— 前端被绕过时服务端仍然会挡。

---

## C. Generation Input Contract(`compass-input-1.0`)

```js
{
  version: "compass-input-1.0",
  language: "zh",
  directions: {
    grounds: {
      direction, status: "ready" | "insufficient_evidence",
      selectedPattern: { key, mechanism, domain, selectionReason },
      livedMechanism,                       // 有人手写过才有,当参考不当抄本
      support: [ { mechanism, domain } ],   // 同方向其他 accepted 机制,最多 3 条
      tension:   null | { otherMechanism, note },
      composite: null | { key, sequence, childMechanisms, whyComposite },
      differentiationContext: { strengthTier, distinctivenessTier }
    }, moves, drains, calls
  },
  globalContext: { crossDirectionTensions, repeatedMechanisms, styleContext }
}
```

`insufficient_evidence` 的方向**只有两个栏位**(`direction` + `status`),
连机制都不带 —— 模型没有东西可以拿来写。

---

## D. 实际送给 Claude 的东西

```
node tools/compass-generation-report.js --payload
```

只有上面那个结构。每个方向送:
`selectedPattern{key, mechanism, domain, selectionReason}` · `livedMechanism` ·
`support[]` · `tension` · `composite` · `differentiationContext`;
全域送 `crossDirectionTensions` · `repeatedMechanisms` · `styleContext`。

机制长这样(这就是模型看到的全部):

> `regulation runs as an ordered sequence rather than a preference: input is reduced first,
> the state is sorted internally, it is then put into words, and contact becomes wanted again afterwards`

## E. 明确没有送的东西

行星名 · 星座 · 宫位 · 相位 · 度数 · 逆行 · 元素 · 分宫制 · `structuralAnchors`
出生日期 · 出生时间 · 出生地点 · 时区
姓名 · email · user id · 付费资料
日记 · 心情 · 收藏 · My Sky 记录

`scrub()` 对十张测试盘的 payload 全部回报 **0 处违规**。

> 注意:证据层的 `sourceSignals` 里就是 `"Jupiter in house 3"` 这种原始讯号。
> contract 刻意**完全不带** `sourceSignals` 与 `structuralAnchors`。
> 我实际做过反向验证:把 `structuralAnchors` 加进 contract,
> scrub 立刻挡下全部十张盘,测试一次掉 16 项。

---

## F. Prompt 版本

`COMPASS_PROMPT_VERSION = "compass-v1"`,`compass-input-1.0`,`compass-output-1.0`。
每次生成都记录 `promptVersion / inputContractVersion / outputSchemaVersion / model /
generatedAt / requests / retried`。

看完整 prompt:`node tools/compass-generation-report.js --prompt`

---

## G. Output Schema

```json
{ "directions": [ { "direction": "grounds", "coreInsight": "…", "explanation": "…", "reflectionPrompt": "…" } ] }
```

只允许 structured JSON。自由 markdown 解析不出东西 → 触发唯一一次 retry。
`insufficient_evidence` 的方向不准出现在结果里。

---

## H. 验证管线(11 道)

| # | 检查 | 失败处理 |
| --- | --- | --- |
| 1 | JSON schema | retry(一次) |
| 2 | 必填栏位 | retry |
| 3 | 长度(core 15–35 / expl 70–130) | retry |
| 4 | 占星外漏 | retry |
| 5 | 玄学 / 过度文学 | retry |
| 6 | 心理诊断 | retry |
| 7 | 贴标签 | retry |
| 8 | 套话 | retry |
| 9 | 反思句是「一句问句」 | retry |
| 10 | **mechanism fidelity** | **不 retry → generation_failed** |
| 11 | **跨卡重复(< 0.35)** | retry |

第 4–9 道直接复用 Phase 4 的护栏(那一层冻结,这里只读),同一份规则不会有两套实作。

**第 10 道怎么做的(以及它的限度)**

```
(a) 编造原因词表 —— 童年 / 小时候 / 原生家庭 / 父母 / 前任 / 伴侣 / 上司 /
    害怕别人失望 / 怕被抛弃 / 因为你害怕 / 为了不让… 命中即失败
(b) 机制形状检查 —— 机制含 first/then/after/until/only when(或是 composite)
    → 文案必须保住顺序(先 / 才 / 之后 / 一旦 / 直到);
      机制是条件型(when/if/while)→ 文案必须保住条件。
```

这两道抓的正是任务书 §7 点名的失败模式:把「先承担 → 事后才发现累」
写成「你害怕别人失望,所以总是承担」。

**限度要讲清楚:**这是词表 + 形状检查,不是语义蕴含判定。
它抓得到「多出一个原因」和「顺序被写没了」,
抓不到语义上更细微的偏移。所以每一段都留了 trace(`patternKey` / `mechanism` /
`generatedCopy`),让人可以自己回答「这句话从哪条机制来的」。

---

## I. Retry 逻辑

最多 **1 次**,而且 retry prompt 会具体列出违反了哪几条。
`mechanism fidelity` 失败**不准 retry** —— 让模型「重新解释一次」正是要避免的事,
直接标 `generation_failed`。

实测(注入假输出):

| 注入 | 结果 |
| --- | --- |
| 第一次回非 JSON,第二次正常 | `ok`,requests = 2,retried = true |
| 一直回非 JSON | `generation_failed(invalid_json)`,requests = 2,**copies = null** |
| 回一段编造原因的文案 | `generation_failed(mechanism_fidelity)`,**requests = 1**(没有重试) |

---

## J. / K. / L. / M. 四张盘的结果

> **诚实说明:这一批不是 HTTPS API 回应。**
> 这个开发容器里没有 `ANTHROPIC_API_KEY`,`compass-generate` 也还没部署到 Supabase。
> 所以我没有办法在这一阶段真的打一次 API。
> 下面的文案是 Claude 依照 `compass-v1` 产出的 system + user prompt **实际写出来的**,
> 但走的是这次开发工作阶段的对话。录在 `assets/compass-recorded.js` 里,
> 而且它在 UI 上是一个**明写出来的**传输方式(`Claude(已录制)`),
> **永远不会在 live 失败时自动顶替** —— 测试盯着这件事。
>
> 要看真的 API:部署 `docs/edge/compass-generate.ts`(secret 只需要 `ANTHROPIC_API_KEY`),
> 然后在 `#/compass/preview` 选 `Claude API(live)` 按一次按钮。
> 那条路已经接好,失败路径也在浏览器里实测过(见 §T)。

### C1 · ok · requests 1 · 无 retry

| 方向 | pattern | coreInsight |
| --- | --- | --- |
| grounds | `regulation-sequence`(composite:withdraw → process → articulate → reconnect) | 你要先安静下来，把话想成形，才有办法重新靠近人。 |
| moves | `meaning-gates-effort`(tension) | 事情说得通的时候你做得很久，说不通的时候会突然没力。 |
| drains | `trust-opens-slowly` | 你会一段一段地靠近一个人，每一段都先确认过再走下一段。 |
| calls | `novelty-over-repetition` | 同一件事重复久了，你的注意力会先散掉，而不是先累。 |

composite 那一张写成了一个过程,而且收在「次序被打乱的时候,你会讲得很卡」——
这句话只有在「这是一个顺序」成立时才说得通。
`trust-opens-slowly` 与 `novelty-over-repetition` 在 Phase 4 **都还没有确定性翻译**:
模型补上了模板补不了的位置。

### C4 · ok · requests 1

grounds `solitude-then-contact` /  moves `meaning-gates-effort` /
drains `visible-means-exposed` / calls `depth-or-disengage`

> 被看见的时候，你先感觉到的是风险，不是被肯定。
> 事情被摊到台面上，你的第一反应通常是把自己收一点，而不是松一口气。所以你会挑场合、挑说法，露多少都算过。真正耗掉你的不是做那件事，是做完之后还要处理「有多少人在看」这件事。

### C6 · ok · requests 1

grounds `closeness-needs-room` / moves `autonomy-or-stall` /
drains `visible-means-exposed` / calls `depth-or-disengage`

### C10 · ok · requests 1 · **moves 没有生成**

grounds `belonging-on-own-terms` / **moves = insufficient_evidence → 不呼叫模型、copy = null** /
drains `decide-then-revisit` / calls `depth-or-nothing-in-closeness`

C10 在 Phase 5 是「四个方向一句文案都没有」的那张盘。
现在三个方向有了,第四个仍然空着 —— 而且是空着,不是补了一段安慰话。

完整输出:`node tools/compass-generation-report.js`

---

## N. 同一 pattern、不同人(§29)

| pattern | 出现 | 相似度 | 判定 |
| --- | --- | --- | --- |
| `meaning-gates-effort` | C1/moves、C4/moves | **0.111** | ✓ |
| `visible-means-exposed` | C4/drains、C6/drains | **0.097** | ✓ |
| `depth-or-disengage` | C4/calls、C6/calls | **0.102** | ✓ |

以 `meaning-gates-effort` 为例 —— 共同机制逐字相同:

> C1「事情说得通的时候你做得很久，说不通的时候会突然没力。」
> C4「讲得通的时候你很耐，讲不通的时候你撑不了几天。」

**核心一致**:两边都是「意义是闸门,重要性不是」,而且都写了闸门关上之后会掉。
**差异从哪里来**:C1 的个案脉络是与 `carry-before-noticing-cost` 的 tension
(事后才发现累)→ 写成「突然没力」「别人常以为你是累了」;
C4 多一条 support `making-restores-agency`(做出东西能恢复主导感)
→ 写成「可以在一件事上磨很久」「不是没有毅力」。

**差异是合理的**:两段都没有加进机制里没有的东西,
都可以指回同一条 mechanism,只是切入的角度不同。

---

## O. 不同 pattern 的分离度(§30)

15 段文案两两比对(排除同 pattern),最高 **0.132**:

```
0.132  novelty-over-repetition(C1)  ×  depth-or-disengage(C6)
0.098  meaning-gates-effort(C4)     ×  belonging-on-own-terms(C10)
0.093  closeness-needs-room(C6)     ×  belonging-on-own-terms(C10)
0.090  solitude-then-contact(C4)    ×  autonomy-or-stall(C6)
```

没有出现「全部都变成『你需要给自己更多空间』」的塌陷。
最接近的一对(重复消磨注意力 × 表面留不住注意力)确实是相邻的机制,
但写出来一个讲「换角度」、一个讲「往下一层」,读得出差别。

---

## P. 确定性模板 vs Claude

| 方向 | 模板 | Claude | 相似度 |
| --- | --- | --- | --- |
| C1/grounds | 你通常不是一有感觉就想说，而是先消化，再开口。 | 你要先安静下来，把话想成形，才有办法重新靠近人。 | 0.346 |
| C1/moves | 同样的忙，说得通的时候你撑得住，说不通的时候特别容易空。 | 事情说得通的时候你做得很久，说不通的时候会突然没力。 | 0.176 |
| C1/drains | *(还没写翻译)* | 你会一段一段地靠近一个人，每一段都先确认过再走下一段。 | — |

不只是「写得比较好看」。三点具体差别:

1. **覆盖率**:模板覆盖 20/37,模型覆盖全部 ready 方向。C10 从 0/4 变成 3/3。
2. **个案化**:模板是一条 pattern 一段固定文字,同一条模式在谁身上都一样;
   模型会依 tension / support 调角度(见 §N)。
3. **风险换了位置**:模板不可能产生幻觉,模型可能。
   所以这一阶段的重点不是「模型写得好」,是**那 11 道验证挡不挡得住**。

---

## Q. Current Chart

Phase 5 已经把 `curResult → evidence → selection` 接通了,
所以 Claude 生成也可以走同一条路,**一样只有按按钮才会送**。

`#/compass/preview` 的 case selector 里会多一个「我的盘」。
送出去的 payload 与测试盘完全同一个形状 —— 一样没有出生资料、没有姓名、没有 email。

⚠ 但在这个开发容器里我**没有办法真的验证一次**:这里没有真实使用者的星盘,
Playwright 里的是假资料。所以「我的盘 + live API」这一格,
要等你自己在浏览器里按一次才算数。

---

## R. 盲读

```
node tools/compass-generation-report.js --blind
```
或在 `#/compass/preview` 勾「盲读模式」:
case 按钮变成 A / B / C…,coverage 行的 case id 变成「—」,
开发者细节强制关闭(勾了盲读会自动取消勾选开发者细节),`gaptag` 隐藏。

浏览器实测:盲读开启后 `.cp-devdt` 的 `display` 是 `none`,
case 标签变成 `ABCDEFGHIJK`,coverage 显示 `—`。

---

## S. API 请求次数

| 动作 | 生成请求 |
| --- | --- |
| 冷启动 `#/compass/preview` | 0 |
| 切换 4 次测试盘 | **0** |
| 切换生成模式 | **0** |
| 重画页面 / 开关开发者细节 / 开关盲读 | **0** |
| 按一次「用 Claude 生成」 | 1(验证失败且可重试才会变 2) |
| 同一 case + 同模式 + 同 promptVersion 再看 | 0(快取) |
| 正式 `#/compass` | **0** |

四张盘的报告共 4 次生成,全部一次过,没有任何 retry。

---

## T. 回归测试

全仓 **1930 项通过**(1855 → 1930,Phase 6 新增 75 项)。

浏览器实测(桌机 1280 / 手机 390):

- 确定性模式行为与 Phase 5 完全一致
- recorded 模式:四张盘都生成成功,`overflow = 0`,使用者卡片里搜不到
  `patternKey` / 分数 / `promptVersion` / 占星词
- **live 模式(函式未部署)**:三张卡显示 `generation_failed · dev preview only`,
  insufficient 那张仍然是 `insufficient_evidence`,**没有任何一张出现文案**
- 正式 `#/compass`:预览卡 0、原本四个方向 4、生成请求 0

三项 mutation 实测会红:

| 注入 | 结果 |
| --- | --- |
| 把 `structuralAnchors`(`house:H10`)放进 contract | scrub 挡下全部十张盘,**16 项失败** |
| 让 mechanism fidelity 也可以 retry | 3 项失败 |
| live 失败时偷偷退回已录制 | 2 项失败 |

---

## U. 已知风险

1. **live 那条路还没有真的跑过一次。** 程式、payload、失败路径都测了,
   但没有真实的 HTTP 往返。第一次部署之后要重跑一遍 §J–M。
2. **mechanism fidelity 是词表 + 形状检查,不是语义判定。** 见 §H 的限度说明。
   语义上细微的偏移目前只能靠人读 trace。
3. **自动 rubric 不等于真人认同。** 报告里那些 1–5 分是可量测讯号推出来的代理指标。
   「这就是我」只有真人能回答。
4. **样本只有 4 张盘、15 段文案。** 扩到 C1–C10 会不会出现塌陷,还不知道。
5. **`compass-recorded.js` 是 fixture,不是产品资料。** 它存在的唯一理由是
   让验证管线与预览在部署之前有东西可跑。不要让它进 production。
6. **prompt caching 已经接上**(system 是常数 + `cache_control`),
   但真实成本还没量过。

---

## V. GO / NO-GO:production generation

**NO-GO —— 还不要接 production 自动生成。** 三个理由,依序:

1. **live 路径一次都没有真的跑过。** 这是硬条件。
2. **样本太小。** 4 张盘 15 段。至少要看完 C1–C10(约 35 段),
   而且要确认没有出现「四张卡都变成同一种语气」的塌陷。
3. **fidelity 只有自动词表挡着。** 上线前需要一次人读:
   随机抽 10 段,人工回答「这句话是从哪条机制来的」,答不出来的就是 fidelity 漏网。

**下一步建议的顺序(不是这一阶段做的):**
① 部署 `compass-generate` → ② 对 C1–C10 各打一次真 API →
③ 人读 fidelity 抽样 → ④ 再决定 persistence 与 rollout。

**这一阶段没有做:**production 自动生成、Supabase persistence、英文、
日记个人化、落地页、evidence rules、taxonomy 扩充。
