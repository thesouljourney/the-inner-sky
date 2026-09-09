/* 从 raw.json(落地页)与 raw-mysky.json(我的完整星盘)组出八块 artboard。
   两份 raw 都是 Chromium 跑完 JS 之后抓下来的真实 DOM,不是手抄的标记。 */
import fs from 'fs';
import { execSync } from 'child_process';
const REPO = '/home/user/the-inner-sky';
const D = REPO + '/design';
process.chdir(D);

/* ---------- 图片:全部以档名当 key ---------- */
const images = {};
fs.mkdirSync('img', { recursive: true });
// clouds.png 1.65MB → 缩到 70KB 以内(落地页用)
execSync(`python3 -c "
from PIL import Image
im = Image.open('${REPO}/assets/clouds.png').convert('RGBA')
im.thumbnail((520, 520), Image.LANCZOS)
im.save('img/clouds.png', optimize=True)
"`);
images['clouds.png'] = 'img/clouds.png';
/* 注意:signs/sm 与 signs/art 底下有同名档(aries.webp …),
   直接取 basename 会互相覆盖 —— 星盘外圈会拿到星座插画而不是连线纹理。
   所以 signs/art 一律加 art- 前缀。 */
for (const [dir, prefix] of [['signs/sm', ''], ['planets/sm', ''], ['signs/art', 'art-'], ['atmos', '']]) {
  for (const f of fs.readdirSync(`${REPO}/assets/${dir}`)) {
    if (/\.(webp|png)$/i.test(f)) images[prefix + f] = `${REPO}/assets/${dir}/${f}`;
  }
}

/* ---------- 路径改写:assets/... → 裸档名 ---------- */
const toBase = s => (s || '')
  .replace(/assets\/signs\/art\//g, 'art-')
  .replace(/assets\/signs\/sm\//g, '')
  .replace(/assets\/planets\/sm\//g, '')
  .replace(/assets\/atmos\//g, '')
  .replace(/assets\/clouds\.png/g, 'clouds.png');

const shell = (css, body) => `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<style>
${css}
</style>
</helmet>
${body}
</x-dc>
</body>
</html>
`;

/* ---------- 落地页(index.html)---------- */
const raw = JSON.parse(fs.readFileSync('raw.json', 'utf8'));
const lpCss = toBase(raw.css);
const clouds = toBase((raw.preview.match(/<div class="clouds"[\s\S]*?<\/div>/) || [''])[0]) ||
               '<div class="clouds" aria-hidden="true"></div>';
const lp = (inner, wrapCanvas) => shell(lpCss,
  wrapCanvas ? `<div class="canvas">\n${clouds}\n${toBase(inner)}\n</div>` : toBase(inner));

/* ---------- 我的完整星盘(app.html #/my-sky)----------
   CSS 全部挂在 #dpage / #dpage.sky-page 底下,所以每块 artboard 都要
   包一层 <div id="dpage" class="sky-page">;body 里的区块再包一层 .dp-body。 */
const my = JSON.parse(fs.readFileSync('raw-mysky.json', 'utf8'));
const myCss = toBase(my.css);
const page = inner => shell(myCss,
  `<div id="dpage" class="sky-page" style="display:block">\n${toBase(inner)}\n</div>`);
const pageBody = inner => page(`<div class="dp-body">\n${inner}\n</div>`);

const boards = {
  'Hero.dc.html':       lp(raw.hero, false),
  'Chapters.dc.html':   lp(raw.chapters, true),
  'Main.dc.html':       lp(raw.preview, true),
  'Story.dc.html':      lp(raw.story, true),
  'Sky-Hero.dc.html':   page(my.hero),
  'Sky-Core.dc.html':   pageBody(my.core),
  'Sky-Houses.dc.html': pageBody(my.houses),
  'Sky-Tail.dc.html':   page(`<div class="dp-body">\n${toBase(my.tail)}\n</div>\n${toBase(my.foot)}`)
};
for (const [name, src] of Object.entries(boards)) {
  fs.writeFileSync(name, src);
  console.log(name.padEnd(20), (src.length / 1024).toFixed(0) + ' KB');
}

const sha = execSync('git -C ' + REPO + ' rev-parse --short origin/main').toString().trim();
const canvas = {
  artboards: [
    { file:'Sky-Hero.dc.html',   x:0,    y:0,    w:1440, h:880,  title:'我的完整星盘 · 云天开场' },
    { file:'Sky-Core.dc.html',   x:1560, y:0,    w:1440, h:600,  title:'四个核心' },
    { file:'Sky-Houses.dc.html', x:1560, y:720,  w:1440, h:1400, title:'十二个生命领域(含行星)' },
    { file:'Sky-Tail.dc.html',   x:0,    y:1000, w:1440, h:1620, title:'中场 · 相位 · 结尾' },
    { file:'Hero.dc.html',       x:3120, y:0,    w:1440, h:760,  title:'落地页 · 首屏' },
    { file:'Chapters.dc.html',   x:4680, y:0,    w:1440, h:1000, title:'落地页 · 九个主题 3×3' },
    { file:'Main.dc.html',       x:3120, y:1160, w:1440, h:990,  title:'落地页 · 我的星空 · 生命脉络' },
    { file:'Story.dc.html',      x:4680, y:1160, w:1440, h:650,  title:'落地页 · CTA' }
  ],
  annotations: [
    { id:'seed-note', x:0, y:-200, w:760,
      text:'从 main 现行的 app.html(#/my-sky)与 index.html 抓下来的真实区块 ——\n' +
           'Chromium 跑完 JS 之后的 DOM + 完整 CSS,盘面 / 插画 / 行星归宫都是实际算出来的。\n' +
           '对应 main commit:' + sha + '\n' +
           '左边四块是完整星盘页,右边四块是落地页。改设计以这里为准。' }
  ],
  launch: { view:'canvas' }
};
fs.writeFileSync('canvas.json', JSON.stringify(canvas, null, 2));
fs.writeFileSync('images.json', JSON.stringify(images, null, 2));
console.log('图片', Object.keys(images).length, '张 · 对应 commit', sha);
