# 我的内在指南 · Phase 5:Dev Preview 接线

> 这一阶段的唯一目标:把已经做好的三层原型
> (evidence → selection → translation)真的显示在 `#/compass` 上,
> 好让我们在浏览器里读到不同测试盘的内在指南。
>
> **这不是 production generation、不是上线、不是接 Claude API。**

---

## 1. 怎么看

```
app.html#/compass/preview
```

正式的 `#/compass` **完全没有改变**。
预览是自己一条路由,而且:

- 三层原型(约 110 KB)只有走到这条路由才会被下载 ——
  正式页面不会因此多下载任何一个位元组
- `#dpage` 会多挂一个 `.cp-preview` class,所有预览样式都锁在它底下
- 画面顶端有一块 dev toolbar,写明 **DEV PREVIEW ONLY**

---

## 2. 档案

| 档案 | 动作 | 为什么 |
| --- | --- | --- |
| `assets/compass-cases.js` | **新增** | 10 张测试盘原本在三个地方各写了一份;Phase 5 浏览器也要用同一批,所以抽成单一来源。数值与之前三处完全一致。 |
| `assets/compass-preview.js` | **新增** | 编排层:natal → evidence → selection → translation,产出可以直接画的 view model。放在 app.html 之外,才能在 Node 里被测试。 |
| `app.html` | 修改 | 新路由、dev toolbar、四张预览卡、开发者细节开关、对应 CSS。全部锁在 `.cp-preview` / `cp-` 前缀底下。 |
| `tools/compass-differentiation-report.js` | 修改 | 只把硬写的测试盘换成 `require` 同一份清单。 |
| `tools/compass-translation-report.js` | 修改 | 同上。 |
| `tests/run-tests.js` | 修改 | 新增 Phase 5 的 46 项;另外两条旧断言改写(见下)。 |

**完全没动的核心档案**

- `assets/compass-evidence.js` —— 27 条规则 + 2 条护栏、evidence scoring
- `assets/compass-selection.js` —— selection scoring、distinctiveness、redundancy
- `assets/compass-translation.js` —— 所有文案一个字都没改
- `docs/edge/read-chart.ts` —— 仍然没有 `kind="compass"`
- `index.html`、Supabase、认证、付费

这三个档案的内容由测试用 sha256 钉死:

```
PATTERN_RULES      3de5d02f45bc7d33
COMPOSITE_RULES    136b2789353db76d
DIRECTION_DOMAINS  9104a5e69ec9f51b
SELECTION WEIGHTS  315af0a295e1a9b0
TRANSLATION COPY   5ff24f5c319f8dd6
```

改动其中任何一个字,测试立刻红。

### 两条旧断言为什么改写

Phase 3 / 4 写过「app.html 不得引入选择层 / 翻译层」。
Phase 5 明确授权接进来,所以这两条改成更准确的保证:

```js
"选择层没有被写成 app.html 的静态 script"   → /<script[^>]+compass-selection/ === false
"选择层只透过开发预览的载入清单出现"        → 全档只出现 1 次(就是 CP_PV_SRC 那一行)
```

也就是:可以载入,但**只能**从开发预览那条路径动态载入。

---

## 3. 预览架构

```
CompassCases.byId(id)
  → InnerSkyAstro.computeNatalChart      (浏览器里既有的引擎,不重写)
    → CompassEvidence.build              (themes 留空,只测盘面)
      → CompassSelection.select          (语料库 = 10 张测试盘,只算一次)
        → CompassTranslation.translate
          → view model { directions[4] }
```

view model 刻意分成两块:

```js
{
  key, no, en, zh,
  state: "ok" | "insufficient_evidence" | "not_translated",
  copy:  { coreInsight, explanation, reflectionPrompt } | null,   // 使用者看的
  dev:   { patternKey, selectionScore, evidenceStrength, … }      // 开发者看的
}
```

`copy` 在任何非 `ok` 的状态下**一律是 null**。
画面没有任何一条路径可以自己生出文案 —— 测试会从两侧夹住这件事:
编排层不准填,UI 的使用者分支只准读 `d.copy.coreInsight / explanation / reflectionPrompt`。

---

## 4. Case Selector

`C1 … C10`,再加一个「我的盘」(只有在已经算出 `curResult` 时才出现)。

- 切换**不重载页面**,只重画预览区
- 切换**不发出任何请求**(浏览器实测:切 4 次,edge function 呼叫 delta = 0)
- 语料库只算一次,之后共用

### 「我的盘」接了

`curResult`(app.html 既有的计算结果)→ 同一条 pipeline。
不需要改任何生产端逻辑:`curResult` 本来就已经算好在记忆体里,
这里只是把参照传进编排层。**distinctiveness 的参照母体仍然是那 10 张测试盘** ——
这是目前唯一的母体,报告里写清楚,不假装它是全体使用者。

如果「我的盘」选到的模式还没翻译,一样如实显示 `not_translated`,不偷偷生成。

---

## 5. 四个方向

页面显示的就是这四个,顺序固定:

```
01  What grounds me   什么让我安定
02  What moves me     什么让我前进
03  What drains me    什么正在消耗我
04  What calls me     我正在被什么吸引
```

每张卡片:方向小标题 → Core Insight → Explanation → Reflection Prompt。
**没有** patternKey、分数、行星、宫位、相位、证据笔数 ——
这些只在「显示开发者细节」打开之后,从卡片底部展开。

---

## 6. 三种状态在画面上长什么样

| 状态 | 画面 |
| --- | --- |
| `ok` | 完整的三段文案,珍珠白卡片,接近未来真实产品 |
| `insufficient_evidence` | 虚线卡片 +「此方向目前没有足够证据生成内容。」+ `insufficient_evidence · dev preview only` |
| `not_translated` | 虚线卡片 +「此 pattern 尚未进入 Human Translation prototype。」+ `not_translated · dev preview only`,patternKey 在开发者细节里 |

这两种缺口**刻意留在画面上**。
目前翻译覆盖率是 20/37,我们要看得到这个缺口,而不是让画面看起来是满的。

浏览器实测:

```
C1   ok 2 / 4   not_translated 2   insufficient_evidence 0
C4   ok 3 / 4   not_translated 1   insufficient_evidence 0
C5   ok 3 / 4   not_translated 0   insufficient_evidence 1
C6   ok 3 / 4   not_translated 1   insufficient_evidence 0
C10  ok 0 / 4   not_translated 3   insufficient_evidence 1
```

C10 四个方向一句文案都没有。这就是现在真实的样子。

---

## 7. composite 与 tension

- selection 选到 composite(例如 `regulation-sequence`)时,
  画面**只显示 composite 自己的那一段**,不并列两个 child 的句子。
  child 的 key 只出现在开发者细节。
- tension 同理:用翻译层给的那一段,UI 不自己拼接两段。

测试从两边挡:编排层输出的 `copy.explanation` 不得包含任何 child 的 explanation;
UI 的使用者分支里不得出现 `childPatterns`。

---

## 8. 视觉

保留既有的 The Inner Sky 语言:珍珠白 / 象牙(`--dp-cloud`)、深蓝(`--dp-navy`)、
香槟细线、淡薰衣草(`--dp-lav`)、大量留白、编辑式排版。

两种视觉**刻意分开**,一眼就知道哪一块是工具、哪一块是成品:

| | 字体 | 颜色 | 感觉 |
| --- | --- | --- | --- |
| dev toolbar / 开发者细节 | 等宽字 | 灰阶 + 虚线框 | 像工具 |
| 四张方向卡 | 衬线 + 无衬线 | 珍珠白 / 深蓝 / 香槟 | 像成品 |

指南盘(compass rose)保留,放在四张卡上方。
四张卡在桌机是 2×2、同列等高;`≤900px` 收成一栏。

---

## 9. 手机(390px)

- 横向溢出 **0 px**(实测 `scrollWidth - clientWidth === 0`)
- 四张卡单栏,字级与行距另外设定,不是把桌机缩小
- case 按钮 `min-height:34px`,换行排列,不挤
- reflection prompt 区块有自己的内距,不会贴边

---

## 10. 没有新增任何生成呼叫

浏览器实测:

```
冷启动 #/compass          原型 script 0 支     edge function 呼叫 5 次(既有的,未改变)
冷启动 #/compass/preview  原型 script 5 支     额外 edge function 呼叫 0 次
切换 4 次 case                                额外 edge function 呼叫 0 次
```

`compass-preview.js` 里没有 `fetch` / `XMLHttpRequest`;
app.html 的预览那一段里没有 `netFetch` / `FUNC_URL` / `read-chart`。测试盯着这两件事。

---

## 11. 测试(46 项)

对应任务书第 17 节的 18 类。四项 mutation 实测会红:

| 注入的错误 | 被抓到的断言 |
| --- | --- |
| `not_translated` 时偷补一段 fallback 文案 | `[pv] not_translated 的方向 copy 一律是 null` |
| 使用者卡片印出 patternKey | `[pv] 使用者卡片只印三句话,不印 patternKey / 分数` |
| 改掉一句翻译文案 | `[pv] 翻译文案一个字都没有改变` |
| 开发者细节预设就打开 | `[pv] 开发者细节预设不显示` |

---

## 12. 还没做 / 刻意没做

1. **Compare Cases(side-by-side)** —— 任务书列为非必要项,没做,避免扩大 scope。
2. **翻译覆盖率仍然是 20/37。** 预览把这个缺口摊在画面上,但没有补。
   补它要回到 Phase 4 继续写翻译,不是这一阶段的事。
3. **`wider-frame-pull` 10/10** 的区辨力问题仍然存在,这一阶段没有动规则。
4. **没有任何东西被写进资料库。** 预览是纯计算,不落地。
5. `Compass.setGenerator` 这个正式接口仍然是空的 ——
   预览走的是自己那条路,没有把原型冒充成 production output。
