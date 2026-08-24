# The Inner Sky · 修正方案(Proposed Fix)

对应 `docs/AUDIT.md` 的每一条。原则:**Calculation Accuracy > Data Consistency > UI**;
视觉与页面结构一律不动。

---

## 架构

```
BirthData(date / time / place)
      ↓  assets/astro/places.js         LocationResolver  全球城市 → 经纬度 + IANA 时区 ID
      ↓  assets/astro/timezone.js       TimezoneResolver  出生当天的历史偏移与 DST
      ↓                                 UTCConverter      当地时间 → UTC 瞬间
      ↓  assets/astro/astro-core.js     AstrologyEngine   回归黄道 + Placidus
      ↓
NatalChartData ──→ Supabase(charts.data)──→ 所有前端页面 / AI 解读
```

计算核心从 `app.html` 内联抽成 `assets/astro/*.js`。这不只是整理:
放在外部档才能被 Node 测试脚本载入,和浏览器跑的是**同一份实作**。

## 逐项对应

| 勘查发现 | 修正 |
| --- | --- |
| §4 时区写死 UTC+8 | `timezone.js`:用浏览器 / Node 内建的 IANA tzdb(`Intl` longOffset)反解 UTC。不带资料档,历史规则由 ICU 提供 |
| §5 没有 DST | 同上。取出生瞬间前后 24 小时的候选偏移逐一回代验证:两个都成立 = 秋季重复时段(标 `ambiguous`,取第一次);都不成立 = 春季空档(标 `nonexistent`,按 tzdb 惯例顺延) |
| §3 只有 190 个地点 | `places-data.js`:GeoNames 全球 61,672 个城市(人口 ≥5000 或首都 / 一二级行政中心),含国家 / 地区 / 经纬度 / 时区。约 2.8 MB,**聚焦地点栏位时才载入**,不影响首屏 |
| §3 预设上海座标 | 全部拿掉。没选地点就不给存,并明说「我们需要更准确的出生地点才能生成你的星盘」 |
| §2 凯龙 / 小行星二体外推 | 改成 Chebyshev 星历表(`ephem-minor.js`):凯龙与四小行星的系数**直接由 Swiss Ephemeris 拟合**;爱神 / 赛姬 / 阋神没有 Swiss 星历档,改用 JPL 密切根数 + Astronomy Engine 的 N 体积分。浏览器端做光行时与周年光行差改正 |
| §10.2 Vertex 差 180° | 用余纬求上升点后,强制落到盘面西半边(IC → DSC → MC 那半圈)。南北半球、赤道附近、高纬度都实测对上 Swiss |
| §6/§10.4 高纬度 ASC 反向 | 加象限修正:宫头按黄经递增,`(ASC−MC)+(IC−ASC)=180°`,所以 `n360(ASC−MC)` 必在 0–180;超出就 +180 |
| §6 极区宫位兜底 | Placidus 无解时退回 **Porphyry**,与 Swiss / Astro-Seek 一致(旧版是等宫近似) |
| §8 交点定义 | 预设改 **True Node**,由月亮瞬时状态向量算密切轨道升交点(实测与 Swiss 差 <15″);平交点同时输出为 `NNodeMean`。两种定义都写进 `SETTINGS`,不混用 |
| §9 莉莉丝 | 维持 **Mean Black Moon**,但改用 Swiss 拟合的序列,误差从 2.5′ 降到 <1″。密切(True)莉莉丝定义因软件而异,**不输出**,避免混用 |
| §10.5 度分进位 | `fmtDeg` 改成**截断**:28.1755° → `28°10′`(旧版给 `28°11′`) |
| §7 相位缺 Quincunx | 补 150°(orb 3°);同时输出精确夹角、orb、入相位 / 出相位 |
| §12 储存栏位 | `charts.data` 补 `city / region / country / countryCode / placeLabel / tzId / utc / utcOffsetMinutes / dst / engineVersion`。jsonb 栏位,不需要 schema migration |
| §11 死档副本 | 保留但在本文件点名(见下)。它们没有任何页面引用 |
| 旧资料 | 见「迁移」一节 |

## 迁移(旧使用者)

不删任何旧纪录。载入时逐笔跑 `migrateChartRecord()`:

* **有经纬度**(现有旧盘都有)→ 由座标反查 IANA 时区(`tz-lookup`),补上 `tzId` / `utc`,写回云端。
  马来西亚 / 新加坡 1982-01-01 之后出生的盘,偏移仍是 +08:00,**结果不变**;
  1982 年之前的会从 +08:00 修正成 +07:30,盘会变 —— 这正是要修的错。
* **没有经纬度** → 标 `needsPlace`,当成资料不完整,引导使用者重新确认出生地点。
* **同名城市无法唯一确定** → `resolveLegacy()` 回报 `ambiguous`,**不自动挑第一个**,请使用者确认。

## 校准测试

`tests/reference/cases.json` 由 `tools/gen-reference.py` 用 pyswisseph 生成 —— 与 Astro-Seek 同一套
Swiss Ephemeris、同一组设置。时区那一侧的答案来自 Python `zoneinfo`,与前端的 `Intl`/ICU 是两套独立
实作,两边对上才算数。**没有把 Astro-Seek 的数字硬写进代码**:案例可以随时换日期重跑。

26 个案例:马来西亚(含 1982 换时区当天)、新加坡、台湾(1975 夏令时)、日本(1949 战后夏令时)、
香港、上海(1988 夏令时)、捷克、英国、葡萄牙、美国(夏令时 / 回拨重复时段 / 亚利桑那不用夏令时)、
澳洲(雪梨南半球夏令时 / 伯斯)、巴西、冰岛、挪威特罗姆瑟(极区)、肯亚(赤道)、
印度(半小时时区)、尼泊尔(45 分钟时区);跨 1949–2007。

容差:行星与四轴 30″,宫头 5″,交点 30″,凯龙与小行星 60″。比较的是实际黄经,不是显示字串。

## 明确记录的计算设置

写在 `assets/astro/CALCULATION.md`,并由 `astro-core.js` 的 `SETTINGS` 原样导出,
每张盘都带着当时的 `engineVersion` 存进资料库。

## 建议(未执行,等你决定)

`index3.html`、`index_v2.html`、`app.html.html`、`index.html.html` 各内嵌一份旧引擎,
没有任何页面引用。建议删掉,以免有人直接打开拿到旧引擎算的盘。
我没有自行删除 —— 这四个档是你上传的历史版本,处置权在你。
