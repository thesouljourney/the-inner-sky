/* 从现行的 app.html 抓「我的完整星盘」(#/my-sky)的真实渲染结果。
   与 extract.js 同一个作法:用 Chromium 开真页面、等 JS 跑完再抓 DOM,
   所以盘面、四个核心的插画、行星归宫都是实际算出来的结果,不是静态标记。
   Cloud(Supabase)那一层在这里 stub 掉,并喂一张固定的出生资料进去,
   画布才有稳定可重现的内容。 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');

const CHART = { id:"seed", nick:"Preview", date:"1990-11-20", time:"14:30", sys:"placidus",
  city:"Kuala Lumpur", country:"Malaysia", countryCode:"MY", placeLabel:"Kuala Lumpur, Malaysia",
  lat:3.139, lon:101.6869, tzId:"Asia/Kuala_Lumpur" };

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport:{width:1440,height:1000}, deviceScaleFactor:1 });
  await p.goto('http://127.0.0.1:8765/app.html', { waitUntil:'load' });
  await p.waitForFunction(() => !!window.__reloadUserData, null, { timeout:20000 });
  await p.evaluate((c) => {
    const C = window.Cloud;
    C.hasSession = () => true; C.dayValid = () => true;
    C.loadPrefs = () => Promise.resolve({}); C.loadCharts = () => Promise.resolve([c]);
    C.migrateLegacy = () => Promise.resolve([]); C.fetchUser = () => Promise.resolve({});
    C.insertChart = () => Promise.resolve({}); C.updateChart = () => Promise.resolve({});
    C.nick = () => "Preview"; C.email = () => "preview@example.com"; C.userId = () => "seed";
  }, CHART);
  await p.evaluate(() => window.__reloadUserData());
  await p.evaluate(() => { location.hash = '#/my-sky'; });
  await p.waitForSelector('#dpage .sky-house');
  await p.waitForTimeout(2500);

  const out = await p.evaluate(() => {
    const grab = sel => { const e = document.querySelector(sel); return e ? e.outerHTML : null; };
    const grabAll = sels => sels.map(s => { const e = document.querySelector(s); return e ? e.outerHTML : ''; }).join('\n');
    const secs = [...document.querySelectorAll('#dpage .dp-body > *')];
    const byText = t => (secs.find(e => e.textContent.indexOf(t) >= 0) || {}).outerHTML || '';
    return {
      css: [...document.querySelectorAll('style')].map(s => s.textContent).join('\n'),
      hero:   grab('#dpage .dp-hero'),
      core:   byText('先认识你的四个核心'),
      houses: byText('你的十二个生命领域'),
      tail:   grabAll(['#dpage .sky-pause', '#dpage .air-dust', '#dpage .sky-zone-c']),
      foot:   grab('#dpage .dp-foot'),
      assetUrls: [...new Set([...document.querySelectorAll('[src]')].map(e => e.getAttribute('src'))
                    .filter(u => u && !u.startsWith('data:') && /\.(png|jpe?g|webp|svg)$/i.test(u)))]
    };
  });
  fs.writeFileSync('design/raw-mysky.json', JSON.stringify(out));
  console.log('CSS', (out.css.length/1024).toFixed(0), 'KB');
  for (const k of ['hero','core','houses','tail','foot'])
    console.log((k + ':').padEnd(9), out[k] ? (out[k].length/1024).toFixed(0) + ' KB' : '(未取到)');
  console.log('标签引用的档案:', out.assetUrls.join('  '));
  await b.close();
})();
