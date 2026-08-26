# Design Canvas seed

这里是从 **线上现行的 `index.html`** 抓下来的落地页区块,拆成四块 artboard,
给 Claude Design 当起点用。以后要改设计,从这里开始,不要再从旧档案开始。

对应 main commit:`df666e0`

## 四块 artboard

| 档案 | 内容 | 画布尺寸 |
| --- | --- | --- |
| `Hero.dc.html` | 首屏 · 标题 + 行星 | 1440 × 760 |
| `Chapters.dc.html` | 九个主题 3×3 宫格 | 1440 × 1000 |
| `Main.dc.html` | 我的星空 · 探索卡 · 生命脉络 | 1440 × 990 |
| `Story.dc.html` | CTA「你不是来寻找答案」 | 1440 × 650 |

`canvas.json` 是画布排版(位置、标题、开场视图)。

## 这些档案是怎么来的

不是手抄的。流程是:

1. 用 Chromium 以 1440 宽开启现行的 `index.html`,**等 JS 跑完**再抓 DOM
   —— 所以 3×3 宫格、星盘轮盘都是真实渲染结果,不是静态标记。
2. 把页面所有 CSS 合并进每块 artboard,包含外部的
   `assets/inner-sky-chart.css`(漏掉它,星盘图例会变成一条直排清单)。
3. 图片路径改写成裸档名(`assets/signs/sm/aries.png` → `aries.png`),
   云图另外压成 `clouds.webp`(30 KB,原图 1.6 MB 塞不进画布)。

`extract.js` 抓 DOM,`build.mjs` 组 artboard。要重抓一次就照这两支跑,
再用 design skill 的 `seed-canvas.mjs` 打包成一个 artifact。

## 注意

- 排版/配色/字级要跟 `index.html` 一致 —— 这里是镜像,不是重新设计。
- 云层只有一层,不重复不镜像(见 `index.html` 的 `.canvas > .clouds`)。
- 九个主题必须维持严格 3×3。
- artboard 里的 JS 逻辑(空盘白羊座、行星计算)不在这些档案里,
  它们住在 `assets/inner-sky-chart.js`。Design 改不到,也不该改。
