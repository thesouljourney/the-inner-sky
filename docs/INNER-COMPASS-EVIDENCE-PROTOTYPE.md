# 我的内在指南 · 证据抽取原型

> 这一阶段只回答「**系统凭什么这样说**」，不回答「系统最后怎么说」。
> 没有产生任何给使用者看的文字，没有新增任何 API 呼叫，没有改 UI。
> 上位规格：`INNER-COMPASS-CONTENT-SPEC.md`、`INNER-COMPASS-ARCHITECTURE-AUDIT.md`。

---

## 怎么跑

```bash
node tools/compass-evidence-report.js          # 人看的报告
node tools/compass-evidence-report.js --json   # 机器读的完整结构
```

只在开发时执行。**不会**进产品 UI、不会发任何请求、不读资料库。

---

## 资料角色（硬规则）

| 来源 | 角色 | 能不能计入 `independentEvidenceCount` |
|---|---|---|
| `evidence.chart`（`curResult`） | 主要证据 | ✅ **唯一**能计入的 |
| `evidence.themes`（九个主题） | 次级诠释证据 | ❌ 只当 supporting |
| `context.lifeThreads`（生命脉络） | 综合脉络 | ❌ 只当 contextual，永不计数 |
| 收藏 / 日记 / 心情 / 反思答案 | **完全排除** | ❌ 这一层根本不读这些栏位 |

生命脉络之所以不能算独立证据，是因为架构审计已经确认它读过 blueprint + topics，
任务是「把前面读过的理解连起来」——它说的话很可能只是主题说过的话的複述。

---

## Candidate Pattern Schema

```js
{
  id,                         // "cand:<patternKey>"
  patternKey,                 // 稳定代号
  domain,                     // 24 个人类领域之一，不是星座 / 宫位
  mechanismFamily,            // 机制家族，用来做去重与多样性检查
  summary,                    // 内部工作语言（刻意不好看）
  mechanism,                  // 机制描述；没有 → 通用性检查会挡下来

  sourceSignals: [{
    sourceType,               // chart | theme | lifeThread
    sourceId,                 // 例如 "planet-house:H6+Saturn" / "topics.family" / "lifemap"
    rawSignal,                // 原始讯号（人看得懂的一句）
    role,                     // primary | supporting | contextual
    independence,             // independent | independent-interpretation | contextual-only
    countsTowardIndependentEvidence,   // 只有 chart 是 true
    independenceKey,          // 结构 + 参与物件；同一结构讲几次都只算一次
    relevance,
    relatedDirection,
    circularityBlocked        // 主题已经讲过同一件事时，生命脉络这一笔会被标记
  }],

  evidenceCount,              // 所有来源的笔数（含不计入的）
  independentEvidenceCount,   // 只数盘面结构，去重后
  distinctActorCount,         // 涉及几个不同的盘面物件
  needGroupsHit / needGroupsTotal,

  supportingSources,          // 主题来源 id
  contextualSources,          // 生命脉络来源 id
  contradictionSignals: [{ patternA, patternB, bothStrong, compatibleAsTension, resolution }],

  compassRelevance: { primary, secondary },
  generic,                    // 没有 mechanism → true
  duplicateOf,                // 同家族有更强的 → 指向它
  strength,                   // 内部分数，永不给使用者看
  status,                     // accepted | provisional | rejected
  rejectionReason
}
```

---

## 独立性是怎么判断的

每个盘面讯号带一个 `independenceKey = 结构家族 | 排序后的参与物件`：

```
planet-house|H6+Saturn
aspect|Moon+Neptune
element-balance|elem-water
stellium|H3+Jupiter+Mercury+Pluto+Sun
```

`independentEvidenceCount` 就是**去重后的 key 数量**。所以：

- 同一个结构被不同文字解释两次 → 永远只算一次
- `Moon in H10` 与 `Moon–Neptune 相位` → 不同结构，算两个（符合任务书第 7 节）
- 主题与生命脉络 → 根本不进这个计数

另外记 `distinctActorCount`。如果独立讯号 ≥2 但涉及的盘面物件 ≤2，
评分会扣 1 分 ——「同一组东西换个讲法」压下去。

---

## 分类顺序（先挡死规则，再看强度）

```
generic（没有 mechanism）            → rejected  too-generic-no-mechanism
独立盘面证据 = 0 且只有生命脉络      → rejected  derived-entirely-from-life-threads
独立盘面证据 = 0                      → rejected  no-chart-evidence
独立盘面证据 < 2                      → rejected  isolated-placement-only
needs 没有全部命中                    → provisional
同家族有更强的                        → rejected  duplicate-of-stronger-pattern:<key>
strength ≥ 7                          → accepted
其余                                  → provisional
```

**单一落点永远升不上 accepted** —— 这是硬规则，测试盯着。

---

## 评分（概念阶段，分数永不外露）

| 条件 | 分 |
|---|---|
| 独立盘面证据 ≥ 2 | +3 |
| 结构完全对得上（needs 全中） | +2 |
| 与该方向的领域相符 | +2 |
| 有主题支持 | +2 |
| 跨 ≥2 个相关主题重複 | +1 |
| 生命脉络确认 | **+1（上限，且不进独立计数）** |
| 独立盘面证据 ≤ 1 | −3 |
| 通用（无 mechanism） | −3 |
| 同一组物件换讲法 | −1 |

---

## 张力处理

对立的机制家族列在 `TENSION_PAIRS`。两边都 ≥5 分 → `compatibleAsTension: true`、
`resolution: "keep-as-tension"`，并把这笔张力挂回两个候选身上。
**不取平均、不删掉任何一边。**

只有一边强 → `keep-stronger-only`。

---

## 未来的生成契约（提案，本阶段不实作）

现行 `Compass.GENERATION_CONTRACT` 的 `directions[]` 只有一个 `text`，不够。
内容规格第十四部分要求每个方向三样东西，所以未来要扩成：

```js
directions: [{
  id,                // 对应 Compass.DIRECTIONS 的 key：grounds / moves / drains / calls
  label,             // 显示用标题（中 / 英各一份）
  coreInsight,       // 核心洞察：让人停一下的那一句
                     //   中文约 15–35 字
  explanation,       // 生活化说明：这件事在日常里长什么样
                     //   中文约 70–130 字；不解释占星、不重複 coreInsight
  reflectionPrompt   // 一个简单、具体、答得出来的问题
                     //   扣住这个方向指认出来的那个模式
}]
```

这是**纯新增式扩充**：`text` 可以保留一段时间当回落，UI 那边要加两个显示位置。
**本阶段不动 UI、不动现行契约的产品行为。**

### 契约必须继续继承的硬规则

最终使用者看不到：星座、宫位、行星、相位、度数、逆行、任何技术占星术语，
以及「你的星盘显示」「因为你的月亮……」「从你的配置来看……」这类句子。

最终输出必须：简单、清晰、自然、具体、温暖；不文学、不鸡汤、不玄学、
不心理诊断、不贴标签。

目标反应是「这就是我。」，不是「这句话写得好美。」

---

## 这一阶段刻意没做

最终文案生成、Claude API、`kind="compass"`、想留给自己的话、今天的问题、
日记 / 收藏 / 心情分析、Supabase 改动、生命脉络与九个主题的任何改动、UI 改动。
