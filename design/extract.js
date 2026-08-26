const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const CHART = { ang:{asc:158.3,mc:68.9},
  cusps:Array.from({length:12},(_,i)=>((158.3+i*30)%360)),
  planets:[["Sun",222.4],["Moon",71.9],["Mercury",210.3],["Venus",248.8],["Mars",15.6],
           ["Jupiter",128.2],["Saturn",300.7],["Uranus",47.5],["Neptune",285.1],["Pluto",233.9]]
    .map(([k,l],i)=>({key:k,lon:l,house:(i%12)+1,retro:i===6})),
  aspects:[{a:0,b:1,type:"tri",name:"三分",orb:2.1},{a:2,b:4,type:"squ",name:"四分",orb:1.4}] };
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport:{width:1440,height:1000}, deviceScaleFactor:1 });
  await p.addInitScript((c)=>{ try{ localStorage.clear();
    localStorage.setItem("inner_sky_chart_v1", JSON.stringify(c)); }catch(e){} }, CHART);
  await p.goto('http://127.0.0.1:8765/index.html', { waitUntil:'networkidle' });
  await p.waitForTimeout(2500);
  const out = await p.evaluate(() => {
    const grab = sel => { const e = document.querySelector(sel); return e ? e.outerHTML : null; };
    const css = [...document.querySelectorAll('style')].map(s=>s.textContent).join("\n");
    return {
      css,
      hero:     grab('.hero'),
      chapters: grab('section.chapters'),
      preview:  grab('section.preview'),
      story:    grab('section.story'),
      sky:      grab('#sky .isky'),
      skyCard:  (function(){ const e=document.querySelector('#sky'); if(!e) return null;
                  const c=[...e.querySelectorAll('.card,[class*=isky]')]; return c.length?c[c.length-1].outerHTML:null; })(),
      rootVars: (function(){ const cs=getComputedStyle(document.documentElement); const o={};
                  for (const n of ['--ink','--text-light','--text-secondary','--accent-moon-lavender',
                    '--accent-starlight-gold','--font-display','--font-sans-sc','--font-serif-sc',
                    '--layout-max-width','--layout-gutter']) { const v=cs.getPropertyValue(n); if(v) o[n]=v.trim(); }
                  return o; })(),
      assetUrls: [...new Set([...document.querySelectorAll('[src],[href]')].map(e=>e.getAttribute('src')||e.getAttribute('href'))
                    .filter(u=>u && !u.startsWith('data:') && /\.(png|jpe?g|webp|svg)$/i.test(u)))],
      cssUrls: [...new Set((css.match(/url\((?!['"]?data:)['"]?([^'")]+)['"]?\)/g)||[])
                  .map(m=>m.replace(/url\(['"]?|['"]?\)/g,'')))]
    };
  });
  fs.writeFileSync('raw.json', JSON.stringify(out));
  console.log('CSS', out.css.length, '字元');
  for (const k of ['hero','chapters','preview','story','sky','skyCard'])
    console.log((k+':').padEnd(11), out[k] ? out[k].length + ' 字元' : '(未取到)');
  console.log('CSS 里引用的档案:', out.cssUrls.join('  '));
  console.log('标签引用的档案:', out.assetUrls.slice(0,10).join('  '));
  await b.close();
})();
