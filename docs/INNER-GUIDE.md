# 我的内在指南 · Rule-based Direction Guide

```
guide-tags-1.0      长期标签(只算一次,星盘只在这里出现)
guide-content-1.0   方向内容库(11 个方向 × 5 个版本 = 55 组,手写)
guide-engine-1.0    匹配引擎(状态 × 主题 × 长期标签 → 一个方向)
```

这个功能**不是**继续解读星盘,**不是**每天呼叫 AI。

前面的章节负责「认识自己」。这一页回答的是:

> **知道这些以后,我现在可以往哪里走?**

---

## 1. 每天 0 次 AI 请求

| 动作 | Anthropic 请求 |
| --- | --- |
| 开启 `#/compass` | **0** |
| 选状态 / 选主题 | **0** |
| 看今天的方向 | **0** |
| 重整页面 | **0** |
| 看星空记录 / 删除 | **0** |

整条路径是:**存好的标签 + 规则匹配 + 内容库**。
测试里把 `fetch` 与 `XMLHttpRequest` 换成会抛错的桩,整条路径照样跑得完。

## 2. 星盘只在后台出现一次

```
九步定调 → Evidence 层(已锁)→ 已接受的机制 → guide-tags → 三组长期标签
                                                              ↓
                                                        存进 profile
                                                              ↓
                                              之后每天都不再读盘、不再重算
```

标签分三类,取值全部来自白名单:

| | 数量 | 值 |
| --- | --- | --- |
| `movement_style` | 1–2 | slow_confirm / action_first / structure_first / space_first / connection_first / experiment_first |
| `stuck_pattern` | 2–3 | should_over_want / ability_over_desire / overthinking / over_responsibility / people_first / fear_change / too_many_options / self_pressure |
| `direction_need` | 2–3 | choice / space / clarity / rest / expression / boundaries / experimentation / stability / meaning / connection / self_trust |

对照表在 `assets/guide-tags.js` 的 `MAP`:**29 条机制 → 三组标签**,人写的,不是从星盘算出来的。
被否决 / 暂列的机制**不进标签**(有断言钉住)。

十张测试盘算出十组可区分的标签。

## 3. 匹配逻辑

```
基础候选  =  规格写死的组合(7 组)  或  状态偏好 + 主题偏好 合并
加权      +  direction_need(命中 +2,第一个再 +1)
             stuck_pattern(每命中一个 +1.5)
             movement_style(每命中一个 +1)
结果      =  ONE PRIMARY DIRECTION（一天只有一个）
```

规格指定的七组优先序逐字钉在测试里:

| | |
| --- | --- |
| tired + work | rest, choice, meaning |
| confused + decision | clarity, choice, space |
| anxious + future | stability, clarity, space |
| stuck + work | experimentation, clarity, choice |
| empty + energy | rest, space |
| hopeful + change | experimentation, self_trust |
| restart + future | experimentation, choice, clarity |

**64 种状态 × 主题组合全部给得出一个方向**(有断言逐格检查)。

## 4. 避免重复

| 规则 | 期限 |
| --- | --- |
| 同一个 headline 不重复 | **30 天** |
| 同一个一小步不重复 | **14 天** |
| 连续同一个方向 → 必须换版本 | 隔天 |

前几个方向都被挡住的时候(例如有人连续一个月选同一组输入),
会把**其余方向**按长期标签排进来一起找 —— 与其重复,不如换一个仍然贴他的方向。

实测:

| | 30 天内 headline 重复 | 14 天内一小步重复 | 连续两天同一版 |
| --- | --- | --- | --- |
| 连续 45 天**同一组输入** | 0 | 0 | 0 |
| 连续 45 天**每天换输入** | 0 | 0 | 0 |

## 5. 内容库

11 个方向 × 5 个版本,每个版本四段:

```
headline + body   01 今天的方向
toward            02 接下来，可以往这里靠近
notYet            03 现在先不用急着
step              04 今天的一小步
```

**整份 55 组做过静态稽核**(一次涵盖所有使用者):

星盘用语 / 「因为你的星盘」这类说法 / 人格断言 / 鸡汤 / 命令句 / 临床词汇 —— 全部 0 命中。
55 个 id、55 个 headline、55 个一小步彼此都不重复。

指纹:内容库 `2881f852cd473ae6` · 方向标签 `fe9c93493accc506`

## 6. 画面

**还没做今天的输入**

```
今天，你想从哪里开始？
   此刻的我        8 个选项
   今天什么事情最占据你的心？   8 个选项
   （可选）写下一句话
   [看看今天的方向]        两个都选好才能按
```

**做完之后** —— 表单完全消失,变成一份属于今天的私人指南:

```
今天的方向 → 接下来，可以往这里靠近 → 现在先不用急着 → 今天的一小步
```

**我的星空记录**:日期 + 方向标签 + 那一天的 headline(+ 自己写下的那句)。
不显示任何星盘资料、机制、分数或 prompt。

## 7. 这一页不再渲染的东西

四个方向(什么让我安定 / 前进 / 消耗 / 吸引)、想留给自己的几句话、今天想问自己的一个问题 ——
这些属于「认识自己」,依规格不在这一页重复。

**相关模组、已锁基准与快取资料全部保留,一个字都没有删:**
`compass-generation.js`(v1 / v1.1 / v1.2)、`compass-anchors.js`(anchors-2.2)、
`compass-anchors-semantic.js`(anchors-3.1)、`compass_entries` 资料表与既有的 localStorage 快取。
它们目前没有画面在用 —— 要不要给它们一个自己的路由,是下一个产品决定。

## 8. 未来才允许呼叫 AI

只有使用者**主动**选择「帮我深入整理」「和我聊聊这件事」这类进阶功能时,才允许呼叫 API。
重整、换状态、重新打开页面、看历史记录 —— 一律不呼叫。

这一版**没有**做那个进阶功能,也没有聊天介面。
