# 我的内在指南 · Phase 3.5：定点规则校准

> 范围限定在 DRIVE / RELATION / wider-frame-pull 三组 + 独立性稽核。
> **没有新增任何规则**（仍是 27 条核心 + 2 条护栏），没有改 accepted 门槛（仍是 7），
> 没有全域调整 genericRisk 或 minIndependent，没有为了统计好看而改规则。

---

## 结论先讲：找到的是两个**记账缺陷**，不是机制问题

一条规则的 `needs` / `mechanism` / `minIndependent` **一个字都没有改**。
改的是两处「算分的方式」——它们在无关机制的地方系统性地扭曲了结果。

---

## 缺陷 D1 · `DIRECTION_DOMAINS` 从 Phase 2 起就没跟上

这张表是**只有 9 条规则**时写的。规则表扩到 27 条时：

- **8 个 domain 从来没有被加进任何方向**
  `trust` `self-expectation` `stimulation` `boundaries` `intimacy`
  `relational-response` `recognition` `decision-pattern`
- 另有 3 个只列在**与规则宣告不同**的方向下
  `expression`（列在 moves，但 `checked-before-spoken` 宣告 drains）
  `autonomy`（列在 calls，但 `autonomy-or-stall` 宣告 moves）
  `meaningful-engagement`（列在 moves，但 `depth-or-disengage` 宣告 calls）

后果：**27 条里有 11 条**，不管证据多好，永远拿不到「方向相关」那 2 分。

### 实证（同一张盘 C1）

| 规则 | 独立结构 | 物件 | needs | 分数 | 状态 |
|---|---|---|---|---|---|
| `solitude-then-contact`（domain ∈ grounds ✓） | 4 | 6 | 2/2 | **8** | accepted |
| `closeness-needs-room`（domain ∉ 任何方向 ✗） | **5** | **7** | 2/2 | **6** | provisional |

证据更厚的那一条，分数低 2 分。**这无法用机制辩护。**

按族分布：RELATION 4/4、PROCESSING 2/4、DIRECTION 2/4、LOAD 1/5、DRIVE 1/4、DECISION 1/2。
这解释了为什么 RELATION 族 4 条里 3 条从未 accepted——**不是 genericRisk 太严，是这张表漏了它们**。

**修正**：把表补齐，每个 domain 列在它真正服务的方向下（必要时跨列）。
门槛、needs、minIndependent 一律未动。

---

## 缺陷 D2 · 独立性膨胀

§10 要求优先修 independence accounting。稽核确实找到了：

```
wider-frame-pull 在 C1 上号称 8 个「独立证据」：
  planet-house|H3+Sun        ┐
  planet-house|H3+Mercury    │ 同一个宫位
  planet-house|H3+Jupiter    │ 被算了四次
  planet-house|H3+Pluto      ┘
  aspect|Jupiter+Sun / Moon / Mars
  node-house|H3+NNode
```

四颗行星同宫是**一个**结构事实（这个宫位很重），不是四份独立证据。

**修正**：独立性改以「结构锚点」计——

| 讯号类型 | 锚点 |
|---|---|
| planet-house / stellium | 那个**宫位** |
| aspect | 那**一对**行星 |
| angular | 那条**轴** |
| element / mode balance | 那个**统计量** |
| retrograde / node / sect | 各自一个 |

同一锚点下不管几笔讯号，永远只算一份。

**实测收敛**：`naming-to-settle` 5→2、`checked-before-spoken` 4→1、
`wider-frame-pull` 8→5、`growth-through-articulating` 8→5。

---

## 逐条判定

### DRIVE

| 规则 | 判定 | 依据 |
|---|---|---|
| `meaning-gates-effort` | **KEEP** | A=9/10，证据厚实（独立 3–9） |
| `making-restores-agency` | **KEEP** | A=7/10，未受任何缺陷影响 |
| `autonomy-or-stall` | **CALIBRATE（仅 D1）** | domain `autonomy` 列在 calls 而非它宣告的 moves。9 张盘 needs 全中、独立 3–5，却全部卡在 6 分。**分类：C. SIGNAL-MISMATCH（记账层）** |
| `starting-is-the-hard-part` | **DEFER** | 修正后仍 0/10。g0（`hard-to-switch`/`sustained-effort`/`slow-to-commit`）全靠整盘统计量，3 张盘 g0 命中 0。**分类：C. SIGNAL-MISMATCH（词汇层）** —— 但这是 needs 设计问题，本阶段不动 |

### RELATION

| 规则 | 判定 | 依据 |
|---|---|---|
| `closeness-needs-room` | **CALIBRATE（仅 D1）** | 7 张盘 needs 全中、独立 3–5，全部卡 6 分 |
| `depth-or-nothing-in-closeness` | **CALIBRATE（仅 D1）** | 同上。`genericRisk=high` **保留不动**——门槛 3 不是主因 |
| `pace-set-by-the-other` | **KEEP（判定 A. CORRECTLY RARE）** | 修正后仅 2/10。8 张盘独立证据只有 0–1：H7 行星与 Venus–Neptune 本来就少见。机制确实罕见，规则无需改 |
| `recognition-wanted-not-sought` | **CALIBRATE（仅 D1）** | 修正后 2/10。仍偏低但证据真实 |

> §6 问的「是 generic risk 真的高，还是分类过严」——
> 答案是**两者都不是**：三条 high-risk 规则的门槛 3 **没有被动过**，
> 它们上不去的原因是 D1。

### wider-frame-pull

**KEEP —— 判定 E. COMMON BUT VALID。**

- A: 规则不算过宽，但 g0（`horizon-pull`/`meaning-search`/`expansion-site`）主要由木星驱动，木星与个人行星有相位在多数盘成立
- B: 是，多数盘天然满足
- C: **是** —— 这正是 D2 抓到的：8 笔讯号其实只有 5 个结构
- D: **独立性确实被高估**，已修
- E: 机制本身有效

修正后仍 10/10、distinctiveness 0.00，但**只当过 1 次 primary** ——
selection 层已经在正确降权。**不为了频率好看去破坏一个正确的机制。**

---

## 反事实：同样 10 张盘，修正前 vs 修正后

| 版本 | accepted 总数 | 平均相似度 | moves 种类 | calls 种类 | 判定 |
|---|---|---|---|---|---|
| 修正前 | 80 | 0.325 | 2 | 3 | OK |
| 只修 D2（锚点） | 79 | 0.320 | 3 | 3 | OK |
| 只修 D1（补表） | 115 | 0.316 | 3 | 4 | OK |
| **两个都修** | **115** | **0.312** | **3** | **5** | **OK** |

**D2 单独是收紧的**（−1，`depth-or-disengage` 5→4），不是放水。

### 新增命中凭什么该命中

```
C3 closeness-needs-room   4 个不同结构锚点
   Mercury–Uranus · Venus–Uranus · DSC 轴 · H4
C6 closeness-needs-room   3 个不同结构锚点
   Sun–Uranus · H7 · H9      ← H7 里的三颗行星正确收敛成 1 个锚点
```

不是靠降门槛，是靠拿回本来就该给的那 2 分。

### 差异化重跑（同一组盘，未换 test set）

| 方向 | 不同选择 | modeShare | insufficient |
|---|---|---|---|
| grounds | 5 → 4 | 0.30 → 0.30 | 0 → 0 |
| moves | **2 → 3** | 0.60 → **0.40** | 1 → 1 |
| drains | 6 → 6 | 0.20 → 0.20 | 2 → 2 |
| calls | **3 → 5** | 0.50 → **0.40** | 0 → 0 |

平均两两相似度 0.325 → **0.312**（略降＝略好）。判定仍是 OK。

---

## 仍然从未 accepted（新的 backlog）

| 规则 | 触发 | 分类 | 说明 |
|---|---|---|---|
| `checked-before-spoken` | 10/10 | **B/C** | 锚点修正后独立数掉到 1——它的证据一直是**同一个结构**。这是 D2 揭露的真相，不是新问题 |
| `starting-is-the-hard-part` | 10/10 | **C** | g0 全靠整盘统计量 |
| `rest-needs-permission` | 8/10 | **B** | 需要 Moon–Saturn 或 Sun–Saturn 硬相位 + 责任负载同时成立 |
| `standard-set-internally` | 4/10 | **B** | 触发率本身就只有 0.4，needs 可能过窄 |

### 新观察

- `closeness-needs-room` 1→8，已被 selection 标 `low-distinctiveness`。
  它的 g0 全由天王星驱动，而天王星与个人行星有相位在多数盘成立——
  **规则可能偏宽**。列入 backlog，**本阶段不动**（§0 禁止为了多样性削弱高频规则）。
- `closeness-needs-room` 与 `novelty-over-repetition` 在多张盘共用天王星证据，
  redundancy 机制已在处理。

---

## 防呆

新增不变量测试：**每条规则的 `domain` 必须出现在它宣告的 primary 方向下**。
把表改回旧版会直接红（已做变异验证）。这个 bug 不会再悄悄发生。
