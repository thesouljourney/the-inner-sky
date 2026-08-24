# The Inner Sky · 计算口径(Calculation Settings)

这份文件是**唯一权威**。`astro-core.js` 的 `SETTINGS` 与这里一字对应,
每张盘存进资料库时都会带上当时的 `engineVersion`。

引擎版本:**2.0.0**

| 项目 | 设置 | 备注 |
| --- | --- | --- |
| 黄道系统 | **回归黄道 Tropical** | 无 ayanamsa。不使用 Sidereal / Lahiri / 任何恒星黄道 |
| 坐标系 | 当日**真**春分点与真黄道(true equinox & ecliptic of date) | 含岁差与章动;行星与四轴同一坐标系 |
| 位置类型 | 视地心位置(apparent geocentric) | 含光行时与周年光行差 |
| 十大行星星历 | Astronomy Engine 2.x(VSOP87 截断 + 月球 ELP + 冥王星模型) | 与 Swiss Ephemeris 实测差 0.4″–7.4″ |
| 凯龙 / 谷神 / 智神 / 婚神 / 灶神 | Chebyshev 表,系数**由 Swiss Ephemeris 拟合** | 1900–2100,每 800 天一段、12 次;实测差 <2″(个别 <11″) |
| 爱神星 433 / 赛姬星 16 / 阋神星 | JPL 密切根数 + N 体积分后拟合 | 没有 Swiss 星历档可对照,精度约角分级,仅供参考 |
| 宫位系统 | **Placidus**(预设) | 另支援 Whole Sign / Equal / Porphyry |
| 极区退回 | Placidus 无解 → **Porphyry** | 与 Swiss Ephemeris / Astro-Seek 一致 |
| 落宫判定 | 用**未四舍五入**的 decimal longitude 比对真实宫头 | 绝不用「星座 = 宫位」 |
| 月亮交点 | **真交点 True Node**(预设) | 由月亮瞬时状态向量算密切升交点,与 Swiss 差 <15″。平交点同时输出为 `NNodeMean` |
| 南交点 | 北交点 + 180° | |
| 莉莉丝 | **平均黑月 Mean Black Moon**(月球平远地点) | 对应 Swiss `SE_MEAN_APOG`。密切(True / Osculating)莉莉丝定义因软件而异,**本站不输出** |
| 宿命点 Vertex | 卯酉圈与黄道在**西侧**的交点 | 以 RAMC+180 与余纬求上升点,再强制落到 IC→DSC→MC 半圈 |
| 东升点 East Point | 赤纬 0 的地平东点在黄道上的投影 | 表格列出,不参与解读 |
| 福点 Part of Fortune | **昼夜盘敏感** | 昼盘 ASC + Moon − Sun;夜盘 ASC + Sun − Moon |
| 精神点 | 与福点互换公式 | |
| 昼夜盘判定 | 太阳位于地平线上(第 7–12 宫一侧)为昼 | |
| 相位 | 合 0° / 六合 60° / 刑 90° / 拱 120° / 梅花 150° / 冲 180° | 依实际黄经夹角,不看星座关系 |
| 相位容许度 | 8 / 4 / 6 / 6 / 3 / 8 度 | 涉及日月时各加 1° |
| 入相位 / 出相位 | 依两点速度判断一天后夹角是否变小 | |
| 时区 | 出生地 IANA 时区 ID + **出生当天**的历史规则 | 资料来自浏览器 / Node 内建 tzdb(ICU) |
| 夏令时 | 由 tzdb 规则决定,含历史 DST | 秋季重复时段标 `ambiguous`(取第一次);春季空档标 `nonexistent`(顺延) |
| 地点资料 | GeoNames(CC BY 4.0),人口 ≥5000 或首都 / 一二级行政中心 | 61,672 城市 |
| 座标 → 时区 | tz-lookup(CC0,底层 timezone-boundary-builder) | 只用于旧资料迁移与自订座标 |
| 度分显示 | **截断**到角分,不四舍五入 | 28.1755° → `28°10′`(四舍五入会变成 `28°11′`,与 Astro-Seek 差一分) |
| 内部精度 | 一律保留 decimal longitude | 只有最终渲染才转成度分 |
| 出生时间未知 | 不输出 ASC / MC / DSC / IC / 宫位 / Vertex / 福点 | 行星仍以当地 12:00 计算,并标 `unknownTime` |
| 缺资料 | 抛错,**绝不使用预设值** | 不预设新加坡、不预设 UTC、不预设 12:00、不预设座标、不自动挑同名城市第一项 |

## 与 Astro-Seek 对照时要对齐的设置

在 Astro-Seek 上核对时,请把它的设定调成:
Tropical / Placidus / **True Node** / Lilith **Mean** / 不勾 Sidereal。
这样两边定义才一致。

## 校准

`tests/reference/cases.json` 是 Swiss Ephemeris(Astro-Seek 同源)在相同设置下的答案,
由 `tools/gen-reference.py` 生成。跑 `npm test` 比对 26 个案例的实际黄经。

## 资料来源与授权

* Astronomy Engine — MIT,© 2019–2023 Don Cross
* Swiss Ephemeris — 仅在**建置期**用于拟合系数与产生测试对照,产物不含其原始档
* GeoNames 城市资料 — CC BY 4.0,https://www.geonames.org/
* tz-lookup — CC0 1.0
* city-timezones / i18n-iso-countries — MIT(仅建置期)
