repo: thesouljourney/the-inner-sky
branch: main

## Last sync
date: 2026-08-24T12:52:10Z

### Updated in this project
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

## Sync history
- 2026-08-24T08:40:35Z 星盘 section 首次接入落地页
- 2026-08-23T04:25:00Z 新增「我的星空」星盘 section（Design Component），浅色晨曦风格
