# 我的内在指南 · Phase 3：跨盘差异化与候选选择

> 这一阶段是 **measurement phase，不是 optimization phase**。
> 27 条规则全程冻结，一条都没有改。没有生成任何使用者文案、没有新增 API、没有改 UI。
> 跑法：`node tools/compass-differentiation-report.js [--json]`

---

## 核心区分

```
EVIDENCE STRENGTH        ≠        PERSONAL DISTINCTIVENESS
「能不能这样说」                   「这对这个人特别值得说吗」
```

一个模式可以证据极强，但十张盘有十张都中 —— 它是 **true**，但不 **distinctive**。

---

## Personal distinctiveness 的算法

```
rawDistinct = 1 - acceptedFrequency
confidence  = min(1, acceptedCount / 3)          ← 样本太少就不敢下结论
distinct    = 0.5 + (rawDistinct - 0.5) × confidence
```

那个收缩项是刻意的，用来挡住 **「罕见 = 重要」** 这个错误：
只出现一次的模式可能只是 fixture 偏差、规则太窄、结构巧合，
所以它会被拉回 0.5 附近，而不是拿到接近 1 的满分。

**三条硬规则：**

- distinctiveness 只能 **排序**，不能 **救援**
- `rejected` 永远不会因为稀有而复活
- `provisional` 永远不会因为稀有而自动 `accepted`

> Evidence gate 永远先于 distinctiveness。

---

## Selection score（只在 accepted pool 内排序）

```
selectionScore = 0.40 × evidenceStrength
               + 0.20 × directionRelevance
               + 0.25 × personalDistinctiveness
               + 0.15 × compositeValue
               − 0.50 × redundancyPenalty
```

每一项都留在输出里，不做成黑盒分数。

**Tie-break 用 patternKey 字典序，不看阵列顺序** —— 把候选顺序反过来，
选出来的结果完全一样（C4 的 grounds 有一组恰好同分，测试就盯着它）。

---

## Composite value

composite **不因为「比 child 复杂」就自动优先**（权重只占 0.15，低于 evidence 的 0.40）。

| 条件 | 加分 |
|---|---|
| 产生新的 sequence / mechanism | +0.35 |
| 化解 child 之间的张力 | +0.35 |
| 比单独 child 更具体 | +0.20 |
| 证据链仍然清楚 | +0.10 |

**既没有新顺序、也没有化解张力 → 一律 0 分**（`merely-stitched`）。

composite 被选为 primary 之后，它的 child 在别的方向会拿到 0.9 的冗余罚分 ——
避免四个方向里「composite + child」重複讲同一件事。

---

## 证据重叠与冗余

```
sharedEvidenceCount / evidenceOverlapRatio     两个候选共用了多少条盘面讯号
mechanismSimilarity                            同机制家族=1，同 taxonomy 大族=0.5，否则 0
redundancyPenalty = overlapRatio × (0.25 + 0.75 × mechanismSimilarity)
```

**高重叠不自动 reject** —— 同一个结构本来就可能支持两种不同机制。
只有「证据重叠 **且** 机制相似」才重罚。

---

## 结果（10 张结构不同的测试盘）

### 差异化体检

| 方向 | 不同选择 | 最常选 | modeShare | insufficient | 判定 |
|---|---|---|---|---|---|
| grounds | 5 种 | belonging-on-own-terms 3/10 | 0.30 | 0 | ✓ |
| moves | **2 种** | making-restores-agency 6/10 | 0.60 | 1 | ✓（但偏弱） |
| drains | 6 种 | carry-before-noticing-cost 2/10 | 0.20 | 2 | ✓ |
| calls | 3 种 | growth-through-articulating 5/10 | 0.50 | 0 | ✓ |

**判定：OK** —— 没有任何方向的 modeShare ≥ 0.75，不构成 `DIFFERENTIATION_FAILURE`。

### 两两相似度（Jaccard，45 组）

```
平均 0.325
最相似  C4 ↔ C9  0.636      最不相似  C6 ↔ C10  0.097
```

### Blind signature test

十张盘的四向 signature **没有任何两张完全相同**。

---

## Rule review backlog（只记录，本阶段不处理）

| # | 观察 | 证据 |
|---|---|---|
| 1 | **12 条规则从未 accepted** | autonomy-or-stall、checked-before-spoken、novelty-over-repetition、starting-is-the-hard-part 等在 10 张盘全部触发却从未通过 |
| 2 | **wider-frame-pull 人人都中** | accepted 10/10，distinctiveness 0.00 |
| 3 | 另有 4 条高频 | meaning-gates-effort 9/10、solitude-then-contact 8/10、stability-before-movement 8/10、visible-means-exposed 8/10 |
| 4 | **moves 只有 2 种选择** | 10 张盘只选出 making-restores-agency 与 meaning-gates-effort |
| 5 | calls 的证据偏薄 | avgTopEvidence 0.642，四个方向里最低 |
| 6 | DRIVE 族 4 条里 2 条从未 accepted | autonomy-or-stall、starting-is-the-hard-part |
| 7 | RELATION 族 4 条里 3 条从未 accepted | depth-or-nothing-in-closeness、pace-set-by-the-other、recognition-wanted-not-sought（三条都是 genericRisk=high、门槛 3） |
| 8 | standard-set-internally 触发率只有 0.4 | needs 可能过窄 |

> 第 7 条值得注意：把 high-risk 规则的门槛提到 3，可能把整个 RELATION 族压死了。
> 但**本阶段不动规则** —— 这正是不该为了测试结果去改规则的地方。

---

## calls 是不是结构性偏弱

上一阶段的怀疑**没有被证实**：

```
calls   insufficientRate 0.00   avgTopEvidence 0.642   不同选择 3 种
drains  insufficientRate 0.20   avgTopEvidence 0.688   不同选择 6 种
moves   insufficientRate 0.10   avgTopEvidence 0.685   不同选择 2 种
```

calls 的 insufficient 率是四个方向里 **最低的（0）**，证据强度略低但没有系统性缺口。
**真正弱的是 moves** —— 只有 2 种选择。列入 backlog #4。

---

## 全部为开发期产物

matrix、score、distinctiveness、pairwise、signature、selection explanation
**一律不会显示给使用者**。使用者以后只会看到简单的人话。
