import fs from 'fs';
import { execSync } from 'child_process';
const REPO = '/home/user/the-inner-sky';
const raw = JSON.parse(fs.readFileSync('raw.json','utf8'));

/* ---- 图片:大图降采样,其余原样;全部以档名(basename)当 key ---- */
const images = {};                       // 档名 -> 本机路径
fs.mkdirSync('img', { recursive: true });
// clouds.png 1.65MB → 缩到 70KB 以内
execSync(`python3 -c "
from PIL import Image
im = Image.open('${REPO}/assets/clouds.png').convert('RGBA')
im.thumbnail((520, 520), Image.LANCZOS)
im.save('img/clouds.png', optimize=True)
"`);
images['clouds.png'] = 'img/clouds.png';
// 星座 / 行星小图:原样带进去(每张 ~8-11KB)
for (const dir of ['signs/sm','planets/sm']) {
  for (const f of fs.readdirSync(`${REPO}/assets/${dir}`)) {
    if (/\.(webp|png)$/i.test(f)) images[f] = `${REPO}/assets/${dir}/${f}`;
  }
}

/* ---- 路径改写:assets/... → 档名 ---- */
const toBase = s => s
  .replace(/assets\/signs\/sm\//g, '')
  .replace(/assets\/planets\/sm\//g, '')
  .replace(/assets\/clouds\.png/g, 'clouds.png');

const css = toBase(raw.css);
const clouds = toBase((raw.preview.match(/<div class="clouds"[\s\S]*?<\/div>/) || [''])[0]) ||
               '<div class="clouds" aria-hidden="true"></div>';

function board(inner, wrapCanvas) {
  const body = wrapCanvas
    ? `<div class="canvas">\n${clouds}\n${toBase(inner)}\n</div>`
    : toBase(inner);
  return `<!doctype html>
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
}

const boards = {
  'Hero.dc.html':     board(raw.hero,     false),
  'Chapters.dc.html': board(raw.chapters, true),
  'Main.dc.html':     board(raw.preview,  true),
  'Story.dc.html':    board(raw.story,    true)
};
for (const [name, src] of Object.entries(boards)) {
  fs.writeFileSync(name, src);
  console.log(name.padEnd(18), (src.length/1024).toFixed(0) + ' KB');
}

const canvas = {
  artboards: [
    { file:'Hero.dc.html',     x:0,    y:0,    w:1440, h:760,  title:'Hero · 首屏' },
    { file:'Chapters.dc.html', x:1560, y:0,    w:1440, h:1000, title:'九个主题 3×3' },
    { file:'Main.dc.html',     x:0,    y:1160, w:1440, h:990,  title:'我的星空 · 探索卡 · 生命脉络' },
    { file:'Story.dc.html',    x:1560, y:1160, w:1440, h:650,  title:'CTA · 你不是来寻找答案' }
  ],
  annotations: [
    { id:'seed-note', x:0, y:-150, w:640,
      text:'从 main 现行的 index.html 抓下来的真实区块(渲染后的 DOM + 完整 CSS)。\n对应 commit:' +
           execSync('git -C ' + REPO + ' rev-parse --short HEAD').toString().trim() +
           '\n改设计时以这里为准,不要再从旧档案开始。' }
  ],
  launch: { view:'canvas' }
};
fs.writeFileSync('canvas.json', JSON.stringify(canvas, null, 2));
fs.writeFileSync('images.json', JSON.stringify(images, null, 2));
console.log('图片', Object.keys(images).length, '张 · clouds.png',
  (fs.statSync('img/clouds.png').size/1024).toFixed(0) + ' KB');
