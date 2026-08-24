# The Inner Sky · 本命盘计算系统现状勘查(Current Architecture Audit)

勘查对象:`main` 分支 `efd62db`(= 线上最新版,`github.md` 记录为「合并 v9–v11 网站优化到 main」,
最后同步 2026-08-24T12:52Z)。所有结论都以这份代码为准。

对照基准:Swiss Ephemeris(pyswisseph 2.10.03)—— Astro-Seek 用的就是这一套星历。
下面凡是写「差 X」的地方,都是实测出来的数字,不是估计。

---

## 1. 目前星盘由哪个 file / function / API 计算

| 层 | 位置 | 说明 |
| --- | --- | --- |
| 天文库 | `app.html` 第 963–1230 行(内联压缩) | Astronomy Engine 2.x(Don Cross, MIT) |
| 计算核心 | `app.html` 第 1384–1618 行 `window.AstroCore` | 行星黄经、四轴、Placidus、相位 |
| 扩展点 | `app.html` 第 1622–1811 行 `window.AstroExtra` | 交点、凯龙、小行星、莉莉丝、福点、宿命点 |
| 调用点 | `app.html` `computeFor(c)` → `drawActive()` | 全站只有这一个地方真的算盘 |
| 落地页 | `assets/inner-sky-chart.js` | **只读展示**,资料来自 `localStorage["inner_sky_chart_v1"]`,不重算 |
| 解读 | Supabase Edge Function `read-chart` | 收到的是 `chartPayload(res)` 结构化结果 |

**结论:线上路径其实只有一个计算入口**,页面之间不会各算各的。
真正的问题不在「重复计算」,在**这一个入口本身算错**。

## 2. 目前使用什么 astrology library / ephemeris

Astronomy Engine(VSOP87 截断 + 月球 ELP + 冥王星模型)。
实测十大行星与 Swiss Ephemeris 相差 **0.4″ ~ 7.4″**(天王星最大),换算成显示误差小于半角分 —— 这一层是好的,不需要换掉。

小天体则不是:`AstroExtra` 用 **JPL 密切轨道根数 + 开普勒二体外推**。
实测 1994-11-20 那一天:

| 天体 | 现状 | Swiss | 差 |
| --- | --- | --- | --- |
| 凯龙星 | 176.34° | 174.01° | **2.33°** |
| 智神星 | 34.11° | 42.20° | **8.09°** |
| 灶神星 | 103.06° | 100.12° | **2.94°** |
| 谷神星 | 136.76° | 137.56° | 0.81° |
| 婚神星 | 237.20° | 236.81° | 0.38° |

凯龙差 2.3° 已经足以跨星座。这是二体外推离历元越远误差越大的必然结果。

## 3. 出生地点目前怎样转换成经纬度

`app.html` 里写死一张 `CITY_GROUPS` 表(约 190 个地点):马来西亚各州 + 新加坡各区 + 湖州一个。
每笔就是 `["峇株巴辖(Batu Pahat)", 1.855, 102.933]`。表外的地点完全无法输入。
旧版表单还留了手填经纬度栏位,**预设值是上海 31.2304 / 121.4737**,使用者没选城市直接存,就会拿到上海的盘。

## 4. timezone 怎样处理

**没有处理。** `app.html`:

```js
// ---------- 时间:固定 UTC+8 ----------
function chartDate(c) {
  const [y, mo, d] = c.date.split("-").map(Number);
  const [h, mi] = c.time.split(":").map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h - 8, mi, 0));
}
```

界面文案也明写「时区固定为马来西亚/新加坡时间(UTC+8)」。
任何非 UTC+8 的出生地都会整盘偏掉;偏 1 小时 → ASC 大约偏 15°,通常直接跨一个星座。

## 5. DST 怎样处理

**完全没有。** 连非夏令时的历史时区变化也没有:

| 出生地与日期 | 系统当成 | 实际 | 差 |
| --- | --- | --- | --- |
| 马来西亚 / 新加坡,1982-01-01 之前 | +08:00 | **+07:30** | 30 分钟 |
| 新加坡 1933–1941 | +08:00 | +07:20 | 40 分钟 |
| 台北 1975 夏季 | +08:00 | **+09:00** | 1 小时 |
| 东京 1948–1951 夏季 | +08:00 | +10:00 | 2 小时 |
| 上海 1986–1991 夏季 | +08:00 | +09:00 | 1 小时 |
| 洛杉矶 1975-07 | +08:00 | −07:00 | 15 小时 |

1982 年以前出生的马来西亚 / 新加坡使用者,即使地点在表里,盘也是错的。

## 6. House System 是什么

Placidus(预设),另有 Whole Sign 可切。实测 Placidus 宫头与 Swiss 相差 **0.1″**,算法本身正确。

两个缺口:
* 极区无解时会掉进「等宫近似」兜底,而 Swiss / Astro-Seek 是退回 **Porphyry**。
* 上升点公式在高纬度(实测挪威特罗姆瑟 69.6°N)会落到反向象限,ASC 差 **整整 180°**,连带十二个宫头全错。

## 7. Tropical / Sidereal 设置是什么

Tropical(回归黄道),没有误用任何 ayanamsa —— 这点是对的。

需要澄清一个容易误判的点:`A.Ecliptic()` 看起来像 J2000 黄道,实测确认它输出的是**当日真黄道**(与 `Rotation_EQJ_ECT` 完全一致,差 0.0000°),所以行星黄经与四轴同在一个坐标系,没有混用。

## 8. Node 使用 True 还是 Mean

**Mean(平交点)**,用 Meeus 的 `125.0445479 − 1934.1362891T …` 级数。
Astro-Seek 预设是 **True Node**,两者在 1994 那天差 0.84°。定义不同不算错,但与校准目标不一致,而且代码里没有任何地方写明用的是哪一种。

## 9. Lilith 使用哪一种定义

**Mean Black Moon(月球平远地点)**,用 Meeus 平近地点 + 180。
与 Swiss 的 `SE_MEAN_APOG` 差 0.0415°(约 2.5′)—— 定义对,级数精度不够。

## 10. 为什么目前结果会与 Astro-Seek 不一致

按影响大小排:

1. **时区写死 UTC+8**(§4/§5)—— 唯一一个能让整张盘全错的因素。
2. **宿命点(Vertex)差 180°**。现有公式
   `atan2(cos(RAIC), −(sin(RAIC)cos ε + tan(90−lat)·sin ε))` 算出来的是 **Anti-Vertex**,
   而且没有强制落到盘面西半边。实测 1994 案例:系统给天秤 1°50′,正解是白羊 1°50′。
3. **凯龙与小行星二体外推**(§2),凯龙差 2.3°。
4. **高纬度 ASC 反向 180°**(§6)。
5. **显示取整方向**。`fmtDeg()` 用 `Math.round` 进位:太阳 28.1755° = 28°10.53′,
   Astro-Seek 显示 `28°10′`,系统会显示 `28°11′`。占星软件惯例是**截断**。
6. **交点定义**为平交点而非真交点(§8)。
7. **相位表缺 Quincunx 150°**,也没有入相位 / 出相位。
8. **平莉莉丝级数精度**差约 2.5′(§9)。

反过来说,**没有问题**的部分:回归黄道设定、Placidus 宫头算法、十大行星位置、
宫位用未取整黄经判断(`lonToHouse` 拿的就是 decimal longitude)、昼夜盘判定、
福点公式、AI 不参与计算。

## 11. 哪些页面存在重复计算

线上路径没有:`index.html`(落地页)只读 localStorage 快照,Edge Function 只收结构化结果。

但仓库里躺着四份**含旧引擎副本**的死档:
`index3.html`、`index_v2.html`(两者内容完全相同)、`app.html.html`、`index.html.html`。
它们各自内嵌一份 `computeChart` / `placidus` / `SiderealTime`,没有任何页面引用,
属于历史上传残留。留着的风险是有人直接打开它们,拿到用旧引擎算的盘。

## 12. Supabase 目前保存哪些 Birth / Chart fields

`charts` 表整笔存进一个 `jsonb data` 栏(`Cloud.insertChart` / `updateChart`),内容是:

```json
{ "nick": "...", "date": "1994-11-21", "time": "01:44",
  "lat": 1.855, "lon": 102.933, "sys": "placidus",
  "reading": {...}, "topics": {...}, "lifemap": {...} }
```

缺:`birth_city` / `birth_region` / `birth_country` / `timezone` / `utc_birth_datetime` / 引擎版本。
好消息是栏位是 jsonb,加栏位不需要改 schema、不需要 migration SQL。

## 13. 哪些地方需要修改

| 项目 | 位置 |
| --- | --- |
| 时区与 UTC 换算 | `chartDate()` —— 整个换掉 |
| 出生地点资料库 | `CITY_GROUPS` / `CITIES` —— 换成全球资料 |
| 出生地点 UI | `initForm()` 与 `renderOnboardingPage()` 两个表单 |
| 预设值 | `clearBtn` 的上海座标、`1990-01-01` / `12:00` 预设 |
| 文案 | `formHint`、onboarding 的「目前支持马来西亚与新加坡(UTC+8)」、`ctMeta` 的「(UTC+8)」 |
| 宿命点 | `AstroExtra.computeExtras` 的 Vertex |
| 上升点象限 | `AstroCore.computeAngles` |
| 极区宫位 | `placidusCusps` 的兜底分支 |
| 小天体星历 | `AstroExtra` 的 `EPH` / `astGeoLon` |
| 交点 / 莉莉丝 | `meanNodeLon` / `meanLilithLon` |
| 相位 | `ASPECTS` 表与 `computeAspects` |
| 度分显示 | `fmtDeg` |
| 储存栏位 | `Cloud.insertChart` 写进去的 `data` 结构 |
| 旧资料 | 需要一套迁移策略 |
| 计算核心位置 | 从 `app.html` 内联抽成外部档,才可能写测试 |
