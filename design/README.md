# Design Canvas seed

这里是从 **线上现行的 `app.html`(`#/my-sky` 完整星盘页)与 `index.html`(落地页)**
抓下来的真实区块,拆成八块 artboard,给 Claude Design 当起点用。
以后要改设计,从这里开始,不要再从旧档案开始。

对应 main commit:`3881b2d`

画布 artifact:<https://claude.ai/code/artifact/6591858a-af83-4105-a6fb-430c72c1e817>

## 八块 artboard

| 档案 | 内容 | 画布尺寸 |
| --- | --- | --- |
| `Sky-Hero.dc.html` | 完整星盘 · 云天开场 + 星盘 | 1440 × 880 |
| `Sky-Core.dc.html` | 完整星盘 · 四个核心 | 1440 × 600 |
| `Sky-Houses.dc.html` | 完整星盘 · 十二个生命领域(含行星归宫) | 1440 × 1400 |
| `Sky-Tail.dc.html` | 完整星盘 · 中场 + 相位 + 结尾 | 1440 × 1620 |
| `Hero.dc.html` | 落地页 · 首屏 · 标题 + 行星 | 1440 × 760 |
| `Chapters.dc.html` | 落地页 · 九个主题 3×3 宫格 | 1440 × 1000 |
| `Main.dc.html` | 落地页 · 我的星空 · 生命脉络 | 1440 × 990 |
| `Story.dc.html` | 落地页 · CTA「你不是来寻找答案」 | 1440 × 650 |

`canvas.json` 是画布排版(位置、标题、开场视图),`images.json` 记录带进画布的图片。

## 这些档案是怎么来的

不是手抄的。流程是:

```bash
cd design
node extract.js          # 落地页 index.html  → raw.json
node extract-mysky.js    # 完整星盘 app.html  → raw-mysky.json
node build-all.mjs       # 组出八块 artboard + canvas.json + images.json + img/
```

1. 用 Chromium 以 1440 宽开启现行档案,**等 JS 跑完**再抓 DOM。
   `extract-mysky.js` 会先把 `window.Cloud` 打桩(不连 Supabase)、
   走到 `#/my-sky`、等盘面 SVG 画完才抓 —— 所以星盘、星座插画、
   行星归宫全部是真实算出来的结果,不是静态标记。
2. 把页面所有 CSS 合并进每块 artboard,包含外部的
   `assets/inner-sky-chart.css`(漏掉它,星盘图例会变成一条直排清单)。
   完整星盘页的 CSS 挂在 `#dpage` 底下,所以那四块 artboard 外面要包
   `<div id="dpage" class="sky-page">`,不然样式全部不生效。
3. 图片路径改写成裸档名(`assets/signs/sm/aries.webp` → `aries.webp`),
   **但 `assets/signs/art/` 底下有同名档**(也叫 `aries.webp`,是十二星座插画),
   直接取档名会互相覆盖 —— 星盘外圈会拿到插画而不是星座纹理。
   所以 `signs/art/` 一律加 `art-` 前缀。这个坑踩过一次,别再踩。
4. 大图降采样:`clouds.png` 1.65MB → 54KB,三张用到的星座插画缩到 260px。
   整包图片控制在 ~400KB(画布每次存档都会整份重传)。

最后用 design skill 的 `seed-canvas.mjs` 把八块 artboard + `canvas.json` +
`img/` 打包成一个 artifact,发布到上面那个网址(同一个 URL,连结不会变)。

## 注意

- 排版/配色/字级要跟 `app.html` / `index.html` 一致 —— 这里是镜像,不是重新设计。
- 云层只有一层,不重复不镜像(见 `index.html` 的 `.canvas > .clouds`)。
- 九个主题必须维持严格 3×3。
- artboard 里的 JS 逻辑(星盘计算、行星归宫)不在这些档案里,
  它们住在 `app.html` / `assets/inner-sky-chart.js`。Design 改不到,也不该改。
- `raw.json` / `raw-mysky.json` / `inner-sky-canvas.html` 是中间产物,不进版控,
  照上面三行指令随时重跑。
