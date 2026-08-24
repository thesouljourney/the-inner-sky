repo: thesouljourney/the-inner-sky
branch: main

## Version
V.12 —— 本命盘计算系统修正(全球出生地点 + 历史时区 + 统一计算核心)
代码里的对应常数:app.html `SITE_VERSION`;计算口径版本另见
`assets/astro/astro-core.js` 的 `SETTINGS.engineVersion`(目前 2.0.0)。

## Last sync
date: 2026-08-24T18:40:00Z

### Updated in this project (V.12)
- 计算核心从 app.html 内联抽成 assets/astro/,浏览器与 Node 测试载入同一份实作
- 时区不再写死 UTC+8:改用出生地 IANA 时区 ID + 出生当天的历史规则(含历史 DST)
- 出生地点换成 GeoNames 全球 63,408 城市,并把旧版 CITY_GROUPS 的马来西亚 /
  新加坡地点(含中文名)并回来,重叠的只保留一笔
- 修正宿命点 Vertex 差 180°、高纬度上升点象限、极区 Placidus 退回 Porphyry
- 凯龙与四小行星改用 Swiss Ephemeris 拟合的 Chebyshev 星历
- 交点预设改真交点,莉莉丝维持平均黑月并改用 Swiss 拟合序列
- 相位补 Quincunx 150°,度分显示改截断
- charts.data 补 city / region / country / tzId / utc / utcOffsetMinutes /
  dst / engineVersion;旧纪录由座标反查时区后补齐
- 新增 tests/(26 案例对照 Swiss Ephemeris)、docs/AUDIT.md、docs/PROPOSED-FIX.md、
  assets/astro/CALCULATION.md
- 出生地点输入框文案简化成「输入出生地点」;下拉选项改成中英并列
  (Batu Pahat, Johor, Malaysia · 峇株巴辖,柔佛,马来西亚)
- 地区名补中文(2,894 个地区里 1,893 个有中文),州属与国名中英文都能搜:
  打「柔佛」或「Johor」、「马来西亚」或「Malaysia」都会带出该地区的城市
- 国家名 People's Republic of China 改成 China / 中国
- 修正自订地点表的国家码:原本照时区猜 MY / SG,湖州(Asia/Shanghai)
  会被标成马来西亚;改成由座标取最近的 GeoNames 城市决定

### Updated in V.11 and earlier
- 「我的星空」星盘接入落地页 index.html，位于「你的空间」右栏，与「我的收藏」同宽、与「继续你的探索」对齐
- 新增 assets/inner-sky-chart.js / .css（DC 版的原生 JS 移植）；星座与行星素材压成 WebP 放在 assets/signs/sm、assets/planets/sm
- 星盘改深色银河风格：金色圆环 / 宫位线 / 相位线，星座名与四轴标签低饱和金，背景图 assets/section-bg.png 半透明
- app.html 的 saveWheelSnapshot() 同时写入 localStorage["inner_sky_chart_v1"]（精简 curResult），登出时一并清除

## Screen map
| 项目文件 | 来源仓库文件 |
| --- | --- |
| index.html（已改） | index.html（落地页结构、:root 变量、.preview / .side 样式） |
| assets/inner-sky-chart.js / .css | 我的星空.dc.html 的原生 JS 移植版 |
| app.html（已改） | app.html（saveWheelSnapshot、logout 清单） |
| 我的星空.dc.html | index3.html（配色、字体栈、SIGNS/BODIES）、app.html（computeChart 资料结构、相位计算） |
| assets/astro/*.js | 本命盘计算核心（V.12 从 app.html 内联抽出，唯一计算入口） |
| tests/ · tools/ · docs/ | V.12 新增：Astro-Seek 校准测试、星历与地点资料生成脚本、勘查与方案文件 |

### 未使用的历史档案
`index3.html`、`index_v2.html`、`app.html.html`、`index.html.html` 各内嵌一份
V.12 之前的旧计算引擎，没有任何页面引用。**暂时保留不删**（2026-08-24 决定）。
要拿它们做参考时请注意：里面的星盘算法是旧版，不要拿来对照结果。

## Sync history
- 2026-08-24T19:25:00Z V.12 国家名改用通用写法(China);修正自订地点的国家码
- 2026-08-24T19:05:00Z V.12 出生地点搜索:中英双语标签、州属 / 国名可搜
- 2026-08-24T18:40:00Z V.12 本命盘计算系统修正:全球地点 + 历史时区 + 统一计算核心 + Astro-Seek 校准测试
- 2026-08-24T08:40:35Z 星盘 section 首次接入落地页
- 2026-08-23T04:25:00Z 新增「我的星空」星盘 section（Design Component），浅色晨曦风格
