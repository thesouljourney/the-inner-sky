# 我的生命蓝图 · 独立 Writing Layer(read-chart v11)

> 这次只改**「我的生命蓝图」最终呈现给使用者的文字表达方式**。
> 占星计算、九步定调、星盘资料、行星权重、宫位与相位判断、命主星、日月升、
> 五章定调、9 张字卡、内容分类、个人化生成方式、JSON / database structure、
> 以及 topic / map / question 三层的 Prompt —— 全部未动。

完整档案:**`docs/edge/read-chart.ts`**(可直接覆盖 Supabase Edge Function `read-chart`)。

---

## 1. 为什么不能改 `MASTER_SYSTEM`

`read-chart` 里的 `MASTER_SYSTEM` 是 **blueprint / topic / map / question 四层共用**的 system prompt。
直接改它会同时改掉主题解读、人生地图与三十道探索题 —— 正是要避免的。

所以改法是:

- `MASTER_SYSTEM` **一个字元都没动**。
- 新增独立常数 **`BLUEPRINT_STYLE`**(3124 字元),
  只在 `kind === "blueprint"` 时作为额外的 system 区块送出。
- 重写 `blueprintMsg()` 的表达层。

```ts
const systemBlocks: Any[] = [
  { type:"text", text: MASTER_SYSTEM, cache_control:{ type:"ephemeral" } }
];
if (lang === "en")          systemBlocks.push({ type:"text", text: LANG_EN_DIRECTIVE,  cache_control:{ type:"ephemeral" } });
if (kind === "blueprint")   systemBlocks.push({ type:"text", text: BLUEPRINT_STYLE,     cache_control:{ type:"ephemeral" } });
```

顺序刻意排成 `MASTER → LANG_EN → BLUEPRINT_STYLE`,
这样 v10 既有的两个 prompt-cache 前缀(`[MASTER]` 与 `[MASTER, LANG_EN]`)仍然完整命中,
生命蓝图只是在后面多接一段,不会打散其他三层的快取。区块数最多 3,未超过 4 的上限。

| kind / lang | system 区块 | 与 v10 相比 |
| --- | --- | --- |
| topic zh · map zh · question zh | `MASTER` | 完全相同 |
| topic en · question en | `MASTER → LANG_EN` | 完全相同 |
| blueprint zh | `MASTER → BLUEPRINT` | 多一段 |
| blueprint en | `MASTER → LANG_EN → BLUEPRINT` | 多一段 |

---

## 2. `BLUEPRINT_STYLE` 写了什么

只规定「怎么说」。「说什么」仍然由 `MASTER_SYSTEM` + 九步定调 + `blueprintMsg` 的五章定调决定。

1. **定位** —— 生命蓝图是第一次完整认识自己的入口,比主题解读更轻、更少术语、更有整体感,不是主题解读的浓缩版。
2. **明确列出在生命蓝图里放宽 `MASTER_SYSTEM` 的三点**(其余一律照旧):
   - 不必套用「① 正面回答 → …… → ⑦ 留下问题」那个七步骨架(那是主题解读回答一个具体问题时的形状);
   - 不必每章都做一次 Reframe;
   - 不必每章都创造「只属于这一章的理解方式」。
3. **最高原则:复杂留给你,简单留给他** —— 附一组错误 / 正确示范。
4. **写法八条** —— 每段只讲一个重点(2–4 短句)、写具体的人类经验(附两组正反示范)、
   措辞不过度肯定、保留矛盾感、不写空泛疗愈句(列出五句禁语)、情绪浓度 6/10、不重复、
   语言用简单自然成熟的中文。
5. **阅读节奏** —— 开头 1–2 句直接进入状态;中间 2–4 个短段;结尾一句有余韵的话,但不要每章都写成金句。
6. **术语禁令加严** —— 在 `MASTER_SYSTEM` 既有禁令之上,再禁:合相、对冲、刑相、拱、六合、
   宫主星、命主星、飞宫、定位星、元素比例、模式比例、昼夜盘、星群、大三角、T 三角、Yod,
   以及「灵魂」「宇宙」「疗愈」「课题」「能量」。
7. **交稿前四次自检** —— 拿掉星座名是否还像这个人 / 外行能否秒懂 / 是否重复 / 是否一段塞太多。
8. **英文说明** —— 本节规定形状与深浅,与语言无关;输出英文时语气句法一律以英文写作指令为准,中文示范不要直接翻译。

---

## 3. `blueprintMsg()` 改了哪些行

`git diff` 全档只删掉 **6 行**,其余全是新增。其中与生命蓝图内容有关的删除只有两行:

```diff
-    "3) chapters:前 5 张卡各写一章,每章 summary(30–80 字) + body(450–650 字,分 2–4 段,段落间空一行)。",
-    "   每章围绕自己的一个小命题展开,先让他认出自己,再解释模式如何形成与运作;不要每章都用相同套路。",
```

另外四行是档头 `v10` → `v11` 与 GET 回应多回一个 `blueprint_style_version`。

新增的部分:定位说明、写法提醒(指向系统区块的写作层)、每章的阅读节奏、
`summary` 与 `body` 不得互相复述、交稿前四次自检。

**完全没动**:`pos` / `sig` 的计算、五章各自的范围(逐字保留)、9 张字卡的标题与顺序、
【先锁定主轴】、【内部判断】、【幕后资料】的九步定调 JSON、【输出 JSON】样板。

### 唯一的数值调整

`body` 由「450–650 字,分 2–4 段」改为「**400–550 字,分 4–6 个短段**」。

对应「每段只讲一个重点、手机上不形成文字墙」。洞察的深度与数量不减少,只是换一种排布。
若希望字数原样保持 450–650,改 `blueprintMsg()` 里那一行即可。

---

## 4. 现有使用者怎么看到新写法

有两层会挡住新写法,两层都处理了。**只影响生命蓝图**,主题解读 / 人生地图 / 探索题一律不碰。

### 4.1 服务端 `readings` 快取(按指纹)

`read-chart` 命中快取就直接回旧文字、**根本不呼叫模型**。指纹由前端拼出来,中文版的版本标签原本写死 `|v10`。改成按 `kind` 区分,只让 blueprint 换标签:

```js
// app.html · askServer()
const ver = (kind === "blueprint") ? "v11-bp" : "v10";
const base = String(fpSeed || "") + "|" + kind + sub + "|" + ver + (lang === "en" ? "|en-w2" : "");
```

topic / map / question 维持 `v10`,既有服务端快取继续命中,**不重新生成、不额外花钱**。

### 4.2 使用者已经存下来的那一份(`charts.data` 里的 `c.reading`)

这一层才是真正的阻挡:前端读的是使用者自己存的 `c.reading`,和服务端快取无关。

原本 app 里已经有一套「版本过期自动重生成」的机制(`CONTENT_VER` + `isStale` + `cleanupLegacy`),
但它是**四层共用**的 —— 把 `CONTENT_VER` 从 10 加到 11 会连带把主题解读、人生地图、
三十道探索题全部清掉重生成。所以另开一条只属于生命蓝图的版本轴:

```js
const CONTENT_VER  = 10;   // 不动
const BLUEPRINT_VER = 11;  // 只有生命蓝图的写作层
function blueprintOutdated(saved) { return !!saved && (saved.bpVer || 0) < BLUEPRINT_VER; }
```

新生成的生命蓝图会盖上 `bpVer: 11`。旧的那些没有这个栏位 → 判定为旧写法。

**刻意做成不破坏式**,不走 `cleanupLegacy` 的「先删除再重生成」:

1. 进 `#/reading` 时,**先照常把旧的那一份显示出来**;
2. 同时在背景重新生成一次;
3. **成功**才写回 `charts.data` 并重画;
4. **失败**就什么都不动 —— 旧的那一份仍在画面上、也仍在云端,下次进来再试;
5. 每个星盘每次载入最多试一次,不会反覆呼叫。

英文介面另外处理:英文版是从中文版改写的,所以先把中文换成新写法、写回,
再据以重写英文,否则英文会拿旧中文当来源。这一步是「版本升级」本身,
不是补空的自动流程,所以直接写入,不走 `guardWriteZh`(那道保护是拦自动补中文时的误覆盖)。

### 4.3 部署顺序不再影响结果

原本先上前端、后部署函式的话会出事:前端已经在要新写法、后端还是旧 Prompt,
那一批使用者会拿到旧 Prompt 生成的内容、并被盖上 `bpVer: 11`,之后就不会再自动升级。
两边各加一道保护之后,**先部署哪一边都可以**:

**服务端** —— 生命蓝图的快取自成一个命名空间:

```ts
const cacheFp = (kind === "blueprint" && fp) ? (fp + "-" + BLUEPRINT_STYLE_VERSION) : fp;
```

v10 的服务端会把旧 Prompt 的文字写进裸指纹底下,v11 永远读不到那一批。
日后写作层再升版也会自动换一个新的命名空间。
同时 POST 回应(含快取命中)会带上 `blueprint_style_version`。

**前端** —— 动手之前先探测服务端版本。函式的 GET 不呼叫模型、不花钱,一次工作阶段只问一次:

```js
window.Reading.serverBlueprintStyle().then(function (styleId) {
  if (styleId !== BLUEPRINT_STYLE_ID) return;   // 函式还没部署 → 完全不动手
  runUpgrade();
});
```

没升级就**不生成、不写入、不花钱**,函式部署好之后下一次进页面自动生效。
盖章也改成只有服务端确实回报了新版写作层才盖 `bpVer`:

```js
if (parsed.styleId === BLUEPRINT_STYLE_ID) o.bpVer = BLUEPRINT_VER;
```

### 4.4 成本

服务端部署好之后,每个已经有生命蓝图的使用者,会在下一次进入 `#/reading` 时触发
**一次**生命蓝图重新生成。一次性,不重复。主题解读、人生地图、探索题不会产生任何额外呼叫。
函式部署前:每次载入只多一个不花钱的 GET 探测,零生成呼叫。

## 5. 验证

用 `tsc` 编译新旧两版,再用 node 实跑比对。

### 5.1 编译

| | 结果 |
| --- | --- |
| `tsc --noEmit --target es2022 --lib es2022,dom` | 新旧两版**同样只有 4 个 `Cannot find name 'Deno'`**(Deno 全域不在 DOM/es2022 型别库里),无其他语法或型别错误 |

### 5.2 共用资产与其他三层:逐字元不变

| 检查项 | 结果 |
| --- | --- |
| `MASTER_SYSTEM`(6261 字元) | 逐字元相同 ✓ |
| `LANG_EN_DIRECTIVE`(12622 字元) | 逐字元相同 ✓ |
| `TOPIC_SPEC` | 相同 ✓ |
| `QUESTION_SPEC`(30 题) | 相同 ✓ |
| `computeNineSteps()` 输出 | 相同 ✓ |
| `topicMsg()` × 9 个主题 | 全部逐字元相同 ✓ |
| `mapMsg()` | 逐字元相同 ✓ |
| `questionMsg()` × 30 题 | 全部逐字元相同 ✓ |

### 5.3 system 区块路由

| kind / lang | 实测 system 区块 | 与 v10 相比 |
| --- | --- | --- |
| blueprint zh | `MASTER → BLUEPRINT` ✓ | 多一段 |
| blueprint en | `MASTER → LANG_EN → BLUEPRINT` ✓ | 多一段 |
| topic zh | `MASTER` ✓ | 相同 |
| topic en | `MASTER → LANG_EN` ✓ | 相同 |
| map zh | `MASTER` ✓ | 相同 |
| question zh | `MASTER` ✓ | 相同 |
| question en | `MASTER → LANG_EN` ✓ | 相同 |

每个区块都带 `cache_control: ephemeral`,最多 3 个区块(上限 4)。

### 5.4 生命蓝图本身

| 检查项 | 结果 |
| --- | --- |
| `blueprintMsg()` 已改动 | 7508 → 8016 字元 ✓ |
| 五章定调 / 先锁定主轴 / 内部判断 / 幕后资料 | 全部保留 ✓ |
| 位置清单(`pos`) | 与旧版逐字元相同 ✓ |
| 九步定调 JSON | 与旧版逐字元相同 ✓ |
| 输出样板 `cards` | 9 张,标题与顺序与前端 `CARD_LABEL` 一致 ✓ |
| 输出样板 `chapters` | 5 章,标题与顺序与前端 `CH_TITLES_ZH` 一致 ✓ |
| 输出 JSON 样板 | 与旧版逐字元相同 ✓ |
| `valid` 校验 | blueprint 仍走 `chapters`,其他仍走 `sections` ✓ |

---

### 5.5 现有使用者能不能拿到新写法(Playwright,模拟已存旧蓝图的帐号)

| 情境 | 探测 GET | 生成 POST | 画面 | 云端 `reading` | `bpVer` | `topics` |
| --- | --- | --- | --- | --- | --- | --- |
| 函式已部署 v11 | 1 | **1(只有 `blueprint`)** | 换成新写法 | 新版主线 | `11` | 一个字没动 ✓ |
| 函式还是 v10(前端先上线) | 1 | **0** | 维持旧版 | 旧版主线 | 未盖章 | 一个字没动 ✓ |
| v11 但生成失败(500) | 1 | 1 | 维持旧版 | 旧版主线 | 未盖章 | 一个字没动 ✓ |
| 升级完成后再进一次 | — | **0** | 新写法 | — | `11` | — ✓ |

指纹比对(改动前 vs 改动后):
blueprint `0adcdeab…` → `d44cc36f…`(**已改变**,绕过服务端旧快取);
topic `c54628bf…` → `c54628bf…`(**完全一致**,既有快取继续命中)。

`npm test` 1594 / 1594 通过(含 `testAppBootOrder` 的 TDZ 静态检查)。

## 6. 上线后建议怎么验收

拿 2–3 张差异明显的既有星盘(元素严重偏重的一张、指针分散的一张、有 T 三角的一张)
各生成一次,然后逐条对:

1. 正文搜「座」「宫」「相」「行星」「星盘」「能量」「课题」「疗愈」「宇宙」「灵魂」—— 应该零命中。
2. 把星座名遮掉念一遍 —— 还像在写这个具体的人吗?
3. 随便挑两段,看有没有在讲同一件事。
4. 手机宽度下看 `body` —— 有没有超过 4 行不换段的地方;`body` 第一句有没有在复述 `summary`。
5. 五章各自回答的问题有没有跑掉(外在的那章有没有跑去讲内在)。
6. 三张盘的输出彼此之间够不够不一样(不一样才代表判断深度没被稀释)。
7. 顺手确认主题解读、人生地图、探索题的文字**没有任何变化**(它们的 Prompt 逐字元未动)。
