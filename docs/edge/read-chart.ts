// ============================================================
// INNER SKY · Edge Function  read-chart  (v11)
// 变更(相对 v10):
//   ★ 本次唯一的改动:「我的生命蓝图」的表达层(Writing Layer)。
//     1. 新增独立常数 BLUEPRINT_STYLE —— 只在 kind === "blueprint" 时
//        作为额外的 system 区块送出。MASTER_SYSTEM 一个字都没改,
//        所以 topic / map / question 的行为与 v10 完全相同。
//     2. 重写 blueprintMsg() 的表达层:阅读节奏、句式、段落密度、
//        术语禁令、交稿自检。九步定调资料、五章定调、9 张字卡、
//        输出 JSON 结构一律未动。
//     3. system 区块顺序刻意排成 [MASTER, (LANG_EN if en), (BLUEPRINT_STYLE if blueprint)],
//        以保留 v10 既有的两个快取前缀([MASTER] 与 [MASTER, LANG_EN])继续命中。
//     4. 唯一的数值调整:blueprint 的 body 由「450–650 字,分 2–4 段」
//        改为「400–550 字,分 4–6 个短段」。字数几乎不变,只把段落切细。
//   ⚠ 未改动:占星计算、九步定调演算、TOPIC_SPEC、QUESTION_SPEC、
//     资料抽取、快取、落库、身分验证、英文写作系统、MASTER_SYSTEM。
//
// 变更(v10 相对 v9):
//   1. 新增第四层内容 kind="question":人生探索地图 6 领域 × 5 题 = 30 题
//   2. 30 道题的「调用配置」(星体/宫位/Step/安全规则)只存在于服务端
//      前端只送 { kind:"question", qid:"q07" },拿不到任何调用规则
//   3. 调用配置可由资料表 exploration_question_configs 覆写
//      (该表仅 service_role 可读;读不到时回落本档内建设定,不中断服务)
//   4. question 层验证使用者身分;解读另存 user_exploration_readings(RLS 隔离)
//   5. 回传附带 prompt_version / config_version,便于日后迁移与重生成判断
//   6. v9 既有逻辑(九步定调、Master Prompt、blueprint/topic/map)未改动
//   7. [v10.5] 英文品质修正:禁止正文复述摘要、禁止否定式贴标签、
//      禁止与他人比较、deep 词族与破折号限量、观察不得写成判决。
//   8. [v10.4] Prompt caching:MASTER_SYSTEM 与英文写作指令均为常数,
//      以 system 区块 + cache_control 送出;快取命中只计 10% 输入价。
//      中文送给模型的文字逐字不变(仅由字串形式改为等价的单一区块形式)。
//   8. [v10.4] 英文改为「同一次呼叫内的两步」:模型先在内部把中文源本
//      拆成语言中立规格(fact/move/arc,只用短语),再合上中文、只看规格写英文。
//      规格不输出。这消除了翻译腔的物理来源,且不增加任何一次额外呼叫。
//   9. [v10.3] 输出语言 lang:"zh"(缺省)| "en"
//      · 依据 Bilingual Writing System v1.0:中文是 source of truth
//      · en 是文学改写(literary adaptation),不是翻译,也不是重新分析
//      · body.source:中文版全文。有 source 时改写它;没有时按同一套品牌声音直接写英文
//      · 英文永不新增中文版没有的解读、人格分析或占星判断
//      · lang 缺省或 "zh" 时,送给模型的内容与 v10 逐字相同 → 既有解读不受任何影响
//      · lang === "en" 时,只在 user message 末端追加一段「输出语言」指示,
//        九步定调、Master Prompt、主题定义、30 题配置、资料抽取一律不变
//
// Secrets: ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// 资料表:  readings(fingerprint, analysis)              ← v9 既有,继续当缓存
//          exploration_domains / exploration_questions   ← 新增(仅题目文案,可公开读)
//          exploration_question_configs                  ← 新增(调用配置,仅 service_role)
//          user_exploration_readings                     ← 新增(RLS:只读自己)
// 前端只发送:{kind, fingerprint, chart:{ang,cusps,planets,extras}, tid|qid, ...}
// ============================================================

const SIGNS = ["白羊座","金牛座","双子座","巨蟹座","狮子座","处女座","天秤座","天蝎座","射手座","摩羯座","水瓶座","双鱼座"];
const P_CN: Record<string,string> = { Sun:"太阳",Moon:"月亮",Mercury:"水星",Venus:"金星",Mars:"火星",Jupiter:"木星",Saturn:"土星",Uranus:"天王星",Neptune:"海王星",Pluto:"冥王星" };
const ASPECT_CN: Record<string,string> = { con:"合",sex:"六合",squ:"刑",tri:"拱",opp:"冲" };
const ELEM_CN: Record<string,string> = { fire:"火", earth:"土", air:"风", water:"水" };
const MODE_CN: Record<string,string> = { cardinal:"开创", fixed:"固定", mutable:"变动" };
const n360 = (d:number)=>((d%360)+360)%360;
const d180 = (d:number)=>{ const x=n360(d); return x>180?360-x:x; };
const signIdxOf = (lon:number)=>Math.floor(n360(lon)/30);
const signOf = (lon:number)=>SIGNS[signIdxOf(lon)];
// deno-lint-ignore no-explicit-any
type Any = any;

// ══════════════════════════════════════════════════════════
//  九步定调演算(核心资产 · 规格书 v1.1)
// ══════════════════════════════════════════════════════════
const CFG = {
  weightsProfile: { Sun:10, Moon:10, ASC:10, Mercury:8, Venus:8, Mars:8, Jupiter:7, Saturn:7, Uranus:5, Neptune:5, Pluto:5, chartRulerMultiplier:1.5 } as Any,
  weightsStellium: { Sun:10, Moon:10, Mercury:8, Venus:8, Mars:8, Jupiter:6, Saturn:6, Uranus:4, Neptune:4, Pluto:4 } as Any,
  stelliumThreshold: { weak:3, strong:4, super:5 },
  aspects: {
    con:{ angle:0,   orb:8, tiers:[2,5,8] },
    opp:{ angle:180, orb:8, tiers:[2,5,8] },
    squ:{ angle:90,  orb:6, tiers:[2,4,6] },
    tri:{ angle:120, orb:6, tiers:[2,4,6] },
    sex:{ angle:60,  orb:4, tiers:[1.5,3,4] }
  } as Any,
  dignityScore: { rulership:5, exaltation:4, neutral:0, fall:-4, detriment:-5 },
  accidental: { angular:2, succedent:1, cadent:-1, fast:1, retrograde:-2, combust:-3, combustOrb:8.5 } as Any,
  totalDignityTiers: { veryStrong:6, strong:3, neutralLow:-2, weak:-5 },
  avgSpeed: { Moon:13.2, Mercury:1.38, Venus:1.20, Mars:0.52, Jupiter:0.083, Saturn:0.033 } as Any
};
const RUL_MOD = ["Mars","Venus","Mercury","Moon","Sun","Mercury","Venus","Pluto","Jupiter","Saturn","Uranus","Neptune"];
const RUL_TRA = ["Mars","Venus","Mercury","Moon","Sun","Mercury","Venus","Mars","Jupiter","Saturn","Saturn","Jupiter"];
const DIG: Any = {
  Sun:{rul:[4],exa:[0],det:[10],fall:[6]},
  Moon:{rul:[3],exa:[1],det:[9],fall:[7]},
  Mercury:{rul:[2,5],exa:[5],det:[8,11],fall:[11]},
  Venus:{rul:[1,6],exa:[11],det:[7,0],fall:[5]},
  Mars:{rul:[0,7],exa:[9],det:[6,1],fall:[3]},
  Jupiter:{rul:[8,11],exa:[3],det:[2,5],fall:[9]},
  Saturn:{rul:[9,10],exa:[6],det:[3,4],fall:[0]},
  Uranus:{rul:[10],exa:[7],det:[4],fall:[1],modernOnly:true},
  Neptune:{rul:[11],exa:[3],det:[5],fall:[9],modernOnly:true},
  Pluto:{rul:[7],exa:[0],det:[1],fall:[6],modernOnly:true}
};
const ELEM = (i:number)=>["fire","earth","air","water"][i%4];
const MODE = (i:number)=>["cardinal","fixed","mutable"][i%3];

function essential(key:string, si:number, system:string) {
  const d = DIG[key];
  if (!d) return 0;
  if (system==="traditional" && d.modernOnly) return 0;
  if (d.rul.includes(si)) return CFG.dignityScore.rulership;
  if (d.exa.includes(si)) return CFG.dignityScore.exaltation;
  if (d.det.includes(si)) return CFG.dignityScore.detriment;
  if (d.fall.includes(si)) return CFG.dignityScore.fall;
  return 0;
}
const housePos = (h:number)=>[1,4,7,10].includes(h)?"angular":[2,5,8,11].includes(h)?"succedent":"cadent";
function levelOf(t:number) {
  const T = CFG.totalDignityTiers;
  return t>=T.veryStrong?"veryStrong":t>=T.strong?"strong":t>=T.neutralLow?"neutral":t>=T.weak?"weak":"veryWeak";
}
function aspBetween(l1:number, l2:number) {
  const d = d180(l1-l2);
  let best:Any = null;
  Object.keys(CFG.aspects).forEach(function(k){
    const a = CFG.aspects[k], orb = Math.abs(d-a.angle);
    if (orb<=a.orb && (!best || orb<best.orb)) {
      const tier = orb<=a.tiers[0]?"veryStrong":orb<=a.tiers[1]?"strong":"normal";
      best = { type:k, orb:+orb.toFixed(2), tier:tier, precision: orb<1 };
    }
  });
  return best;
}

function computeNineSteps(chart:Any) {
  // 补齐 signIdx
  const P = chart.planets.map((p:Any)=>Object.assign({}, p, { signIdx: signIdxOf(p.lon) }));
  const extras = (chart.extras||[]).map((x:Any)=>Object.assign({}, x, { signIdx: signIdxOf(x.lon) }));
  const asc = chart.ang.asc, cusps = chart.cusps;
  const byKey:Any = {}; P.forEach((p:Any)=>{ byKey[p.key]=p; });
  const ascIdx = signIdxOf(asc);
  const ex = (k:string)=>extras.find((x:Any)=>x.key===k);
  const signCN = (i:number)=>SIGNS[i];

  // Step 1 昼夜盘
  const isDay = n360(byKey.Sun.lon - asc) >= 180;
  const step1 = { sect: isDay?"day":"night", sunHouse: byKey.Sun.house, referee: isDay?"sun":"moon" };

  const crModKey = RUL_MOD[ascIdx], crTraKey = RUL_TRA[ascIdx];

  // Step 6 尊贵计分
  const planetScores:Any = {};
  P.forEach(function(p:Any){
    const essM = essential(p.key, p.signIdx, "modern");
    const essT = essential(p.key, p.signIdx, "traditional");
    let acc = CFG.accidental[housePos(p.house)];
    const fast = CFG.avgSpeed[p.key]!=null && p.speed > CFG.avgSpeed[p.key];
    if (fast) acc += CFG.accidental.fast;
    const retro = p.retro && p.key!=="Sun" && p.key!=="Moon";
    if (retro) acc += CFG.accidental.retrograde;
    const combustable = ["Mercury","Venus","Mars","Jupiter","Saturn"].includes(p.key);
    const combust = combustable && d180(p.lon - byKey.Sun.lon) <= CFG.accidental.combustOrb;
    if (combust) acc += CFG.accidental.combust;
    const tot = essM + acc;
    planetScores[p.key] = {
      essential:essM, essentialTraditional:essT, accidental:acc,
      total:tot, totalTraditional:essT+acc, level:levelOf(tot),
      flags:{ retro:!!retro, combust:!!combust, fast:!!fast, housePos:housePos(p.house) }
    };
  });
  let aceScore = -99, burdenScore = 99;
  P.forEach((p:Any)=>{ const t=planetScores[p.key].total; aceScore=Math.max(aceScore,t); burdenScore=Math.min(burdenScore,t); });
  const ace = P.filter((p:Any)=>planetScores[p.key].total===aceScore).map((p:Any)=>p.key);
  const burden = P.filter((p:Any)=>planetScores[p.key].total===burdenScore).map((p:Any)=>p.key);
  function flying(tbl:string[]) {
    return cusps.map(function(cl:number,i:number){
      const ruler = tbl[signIdxOf(cl)];
      const to = byKey[ruler].house;
      return { house:i+1, ruler:ruler, fliesTo:to, returnsHome: to===i+1 };
    });
  }
  const step6 = { planetScores, flyingStars:{ modern:flying(RUL_MOD), traditional:flying(RUL_TRA) }, ace, burden };

  // Step 2 元素/模式/阴阳/半球/盘型
  const wOf = (k:string)=>(k===crModKey ? CFG.weightsProfile[k]*CFG.weightsProfile.chartRulerMultiplier : CFG.weightsProfile[k]);
  const eSum:Any = {fire:0,earth:0,air:0,water:0}, mSum:Any = {cardinal:0,fixed:0,mutable:0};
  let yang=0, yin=0, wTot=0;
  function addW(si:number, w:number) {
    eSum[ELEM(si)] += w; mSum[MODE(si)] += w;
    if (ELEM(si)==="fire"||ELEM(si)==="air") yang+=w; else yin+=w;
    wTot += w;
  }
  P.forEach((p:Any)=>addW(p.signIdx, wOf(p.key)));
  addW(ascIdx, CFG.weightsProfile.ASC);
  const pct = (v:number)=>Math.round(v/wTot*100);
  const ePct:Any = { fire:pct(eSum.fire), earth:pct(eSum.earth), air:pct(eSum.air), water:pct(eSum.water) };
  const mPct:Any = { cardinal:pct(mSum.cardinal), fixed:pct(mSum.fixed), mutable:pct(mSum.mutable) };
  const eKeys = Object.keys(ePct);
  const domE = eKeys.reduce((a,b)=>ePct[a]>=ePct[b]?a:b);
  const lacking = eKeys.filter(k=>ePct[k]<=10);
  const balanced = eKeys.every(k=>ePct[k]>=15 && ePct[k]<=35);
  const domM = Object.keys(mPct).reduce((a,b)=>mPct[a]>=mPct[b]?a:b);
  let up=0, low=0, east=0, west=0;
  P.forEach(function(p:Any){
    if (p.house>=7) up++; else low++;
    if ([10,11,12,1,2,3].includes(p.house)) east++; else west++;
  });
  const hemi = {
    vertical: Math.abs(up-low)>=3 ? (up>low?"upper":"lower") : "balanced",
    horizontal: Math.abs(east-west)>=3 ? (east>west?"east":"west") : "balanced",
    verticalCount:[low,up], horizontalCount:[east,west]
  };
  const lons = P.map((p:Any)=>p.lon).sort((a:number,b:number)=>a-b);
  const gaps = lons.map((l:number,i:number)=>n360(lons[(i+1)%10]-l));
  const maxGap = Math.max.apply(null, gaps);
  const span = 360 - maxGap;
  function isBucket() {
    for (let i=0;i<10;i++) {
      const rest = lons.filter((_:number,j:number)=>j!==i).sort((a:number,b:number)=>a-b);
      const rg = rest.map((l:number,j:number)=>n360(rest[(j+1)%9]-l));
      if (360 - Math.max.apply(null, rg) <= 180) {
        const prev = n360(lons[i]-lons[(i+9)%10]);
        const next = n360(lons[(i+1)%10]-lons[i]);
        if (prev>=60 && next>=60) return true;
      }
    }
    return false;
  }
  const bigGaps = gaps.filter((g:number)=>g>=60).length;
  let jones:string;
  if (span<=120) jones="bundle";
  else if (isBucket()) jones="bucket";
  else if (span<=180) jones="bowl";
  else if (span<=240) jones="locomotive";
  else if (bigGaps===2) jones="seesaw";
  else if (maxGap<60) jones="splash";
  else jones="splay";
  const JONES_CN:Any = { bundle:"集团型", bucket:"提桶型", bowl:"碗型", locomotive:"火车头型", seesaw:"跷跷板型", splash:"散落型", splay:"扩展型" };
  const HEMI_CN:Any = { upper:"外显(上半球)", lower:"内在积累(下半球)", east:"自主驱动(东半球)", west:"关系驱动(西半球)", balanced:"均衡" };
  const step2 = {
    elements: Object.assign({}, ePct, { dominant: balanced?"balanced":domE, dominantPct: ePct[domE], lacking }),
    modes: Object.assign({}, mPct, { dominant: domM }),
    polarity: { yang:pct(yang), yin:pct(yin) },
    hemisphere: hemi, jonesPattern: jones,
    chartToneHint: HEMI_CN[hemi.vertical] + " · " + HEMI_CN[hemi.horizontal] + " · " + JONES_CN[jones]
  };

  // Step 3 星群 + 空宫
  const stelliums:Any[] = [];
  function scanTrack(track:string) {
    const groups:Any = {};
    P.forEach(function(p:Any){
      const t = track==="sign" ? p.signIdx : p.house;
      (groups[t] = groups[t] || []).push(p);
    });
    Object.keys(groups).forEach(function(t){
      const g = groups[t];
      if (g.length < CFG.stelliumThreshold.weak) return;
      const score = g.reduce((s:number,p:Any)=>s+CFG.weightsStellium[p.key], 0);
      const level = g.length>=CFG.stelliumThreshold.super?"super":g.length>=CFG.stelliumThreshold.strong?"strong":"weak";
      stelliums.push({
        track, target: track==="sign" ? signCN(+t) : (+t + "宫"),
        targetIdx:+t, planets: g.map((p:Any)=>p.key), count: g.length,
        weightScore: score, level, upgradeHint: level==="weak" && score>=26,
        spread: track==="sign" ? Array.from(new Set(g.map((p:Any)=>p.house))).sort((a:Any,b:Any)=>a-b)
                               : Array.from(new Set(g.map((p:Any)=>p.signIdx))).map((i:Any)=>signCN(i))
      });
    });
  }
  scanTrack("sign"); scanTrack("house");
  stelliums.sort(function(a,b){
    const L:Any = { super:3, strong:2, weak:1 };
    return L[b.level]-L[a.level] || b.weightScore-a.weightScore;
  });
  const emptyHouses:Any[] = [];
  for (let h=1;h<=12;h++) {
    if (P.some((p:Any)=>p.house===h)) continue;
    const si = signIdxOf(cusps[h-1]);
    emptyHouses.push({
      house:h, cuspSign: signCN(si),
      rulerModern:{ planet:RUL_MOD[si], inHouse: byKey[RUL_MOD[si]].house },
      rulerTraditional:{ planet:RUL_TRA[si], inHouse: byKey[RUL_TRA[si]].house }
    });
  }
  let focusPointer:Any = null;
  if (stelliums.length) {
    const s = stelliums[0];
    if (s.track==="sign") {
      const hs:Any = {}; s.planets.forEach((k:string)=>{ hs[byKey[k].house]=(hs[byKey[k].house]||0)+1; });
      const h = +Object.keys(hs).reduce((a,b)=>hs[a]>=hs[b]?a:b);
      focusPointer = { signIdx:s.targetIdx, sign:signCN(s.targetIdx), house:h, element:ELEM(s.targetIdx) };
    } else {
      const ss:Any = {}; s.planets.forEach((k:string)=>{ ss[byKey[k].signIdx]=(ss[byKey[k].signIdx]||0)+1; });
      const si = +Object.keys(ss).reduce((a,b)=>ss[a]>=ss[b]?a:b);
      focusPointer = { signIdx:si, sign:signCN(si), house:s.targetIdx, element:ELEM(si) };
    }
  }
  const step3 = { stelliums, emptyHouses, focusPointer };

  // Step 4 三主星合频
  const compatible = (e1:string,e2:string)=> (e1===e2)?2 :
    ((e1==="fire"&&e2==="air")||(e1==="air"&&e2==="fire")||(e1==="earth"&&e2==="water")||(e1==="water"&&e2==="earth"))?1:0;
  const eS = ELEM(byKey.Sun.signIdx), eM = ELEM(byKey.Moon.signIdx), eA = ELEM(ascIdx);
  const elemScore = compatible(eS,eM)+compatible(eS,eA)+compatible(eM,eA);
  const aspScoreOf = (a:Any)=>{
    if (!a) return 0;
    return (a.type==="tri"||a.type==="sex")?2 : a.type==="con"?1 : (a.type==="squ"||a.type==="opp")?-2 : 0;
  };
  const pairAsp = {
    sunMoon: aspBetween(byKey.Sun.lon, byKey.Moon.lon),
    sunAsc: aspBetween(byKey.Sun.lon, asc),
    moonAsc: aspBetween(byKey.Moon.lon, asc)
  };
  const aspScore = aspScoreOf(pairAsp.sunMoon)+aspScoreOf(pairAsp.sunAsc)+aspScoreOf(pairAsp.moonAsc);
  const combined = elemScore + aspScore;
  const axis:Any[] = [];
  if (pairAsp.sunMoon && aspScoreOf(pairAsp.sunMoon)<0) axis.push(["sun","moon"]);
  if (pairAsp.sunAsc && aspScoreOf(pairAsp.sunAsc)<0) axis.push(["sun","asc"]);
  if (pairAsp.moonAsc && aspScoreOf(pairAsp.moonAsc)<0) axis.push(["moon","asc"]);
  const step4 = {
    sun:{ sign:signCN(byKey.Sun.signIdx), house:byKey.Sun.house, essential:planetScores.Sun.essential, total:planetScores.Sun.total },
    moon:{ sign:signCN(byKey.Moon.signIdx), house:byKey.Moon.house, essential:planetScores.Moon.essential, total:planetScores.Moon.total },
    asc:{ sign:signCN(ascIdx), chartRulerRef:crModKey },
    coherence:{
      elemScore, elemVerdict: elemScore>=4?"元素合":elemScore>=2?"部分":"元素弱",
      aspScore, aspVerdict: aspScore>=2?"相位合":aspScore>=-1?"中性":"相位拉扯",
      score: combined, verdict: combined>=5?"coherent":combined>=1?"partial":"tension",
      axis, priority: step1.referee
    }
  };

  // Step 5 命主星 + 定位链
  function rulerProfile(key:string) {
    const p = byKey[key];
    const kas:Any[] = [];
    P.forEach(function(q:Any){
      if (q.key===key) return;
      const a = aspBetween(p.lon, q.lon);
      if (a) kas.push({ with:q.key, type:a.type, orb:a.orb });
    });
    kas.sort((a,b)=>a.orb-b.orb);
    return { planet:key, sign:signCN(p.signIdx), house:p.house, total:planetScores[key].total, keyAspects:kas.slice(0,3) };
  }
  function buildChain(tbl:string[]) {
    const map:Any = {};
    P.forEach((p:Any)=>{ map[p.key]=tbl[p.signIdx]; });
    const finals = P.filter((p:Any)=>map[p.key]===p.key).map((p:Any)=>p.key);
    const loops:Any[] = [];
    const seen:Any = {};
    P.forEach(function(p:Any){
      let cur = p.key; const path:string[] = [];
      while (!path.includes(cur) && !finals.includes(cur)) { path.push(cur); cur = map[cur]; }
      if (!finals.includes(cur)) {
        const loop = path.slice(path.indexOf(cur)).sort();
        const sig = loop.join(",");
        if (loop.length>1 && !seen[sig]) { seen[sig]=1; loops.push(loop); }
      }
    });
    const nEnds = finals.length + loops.length;
    return { finalDispositors:finals, loops, convergence: nEnds<=1?"single":"multi", chainMap:map };
  }
  const chMod = buildChain(RUL_MOD), chTra = buildChain(RUL_TRA);
  const sameEndpoint = JSON.stringify(chMod.finalDispositors.slice().sort())===JSON.stringify(chTra.finalDispositors.slice().sort());
  let endpointPointer:Any = null;
  const endCands = chMod.finalDispositors.length ? chMod.finalDispositors : (chMod.loops[0]||[]);
  if (endCands.length) {
    const best = endCands.reduce((a:string,b:string)=>planetScores[a].total>=planetScores[b].total?a:b);
    const bp = byKey[best];
    endpointPointer = { planet:best, signIdx:bp.signIdx, sign:signCN(bp.signIdx), house:bp.house, element:ELEM(bp.signIdx) };
  }
  const step5 = {
    chartRuler:{ modern:rulerProfile(crModKey), traditional:rulerProfile(crTraKey) },
    dispositorChain:{ modern:chMod, traditional:chTra, sameEndpoint },
    endpointPointer
  };

  // Step 7 相位与格局
  const allAsp:Any[] = [];
  for (let i=0;i<P.length;i++)
    for (let j=i+1;j<P.length;j++) {
      const a = aspBetween(P[i].lon, P[j].lon);
      if (a) allAsp.push(Object.assign({ a:P[i].key, b:P[j].key }, a));
    }
  allAsp.sort((x,y)=>x.orb-y.orb);
  const tightestThree = allAsp.slice(0,3);
  const has = (t:string,k1:string,k2:string)=>allAsp.some(x=>x.type===t && ((x.a===k1&&x.b===k2)||(x.a===k2&&x.b===k1)));
  const patterns:Any[] = [];
  const opps = allAsp.filter(x=>x.type==="opp");
  opps.forEach(function(o){
    P.forEach(function(c:Any){
      if (c.key===o.a || c.key===o.b) return;
      if (has("squ",c.key,o.a) && has("squ",c.key,o.b)) {
        if (!patterns.some(pt=>pt.type==="tSquare" && pt.planets.includes(c.key) && pt.planets.includes(o.a) && pt.planets.includes(o.b)))
          patterns.push({ type:"tSquare", planets:[o.a,o.b,c.key], apex:c.key, mode:MODE_CN[MODE(c.signIdx)] });
      }
    });
  });
  for (let i=0;i<opps.length;i++)
    for (let j=i+1;j<opps.length;j++) {
      const s = [opps[i].a,opps[i].b,opps[j].a,opps[j].b];
      if (new Set(s).size===4 && has("squ",opps[i].a,opps[j].a) && has("squ",opps[i].a,opps[j].b) &&
          has("squ",opps[i].b,opps[j].a) && has("squ",opps[i].b,opps[j].b))
        patterns.push({ type:"grandCross", planets:s });
    }
  for (let i=0;i<P.length;i++)
    for (let j=i+1;j<P.length;j++)
      for (let k=j+1;k<P.length;k++)
        if (has("tri",P[i].key,P[j].key) && has("tri",P[j].key,P[k].key) && has("tri",P[i].key,P[k].key)) {
          const es = [P[i],P[j],P[k]].map((p:Any)=>ELEM(p.signIdx));
          const ce = es.filter(e=>e===es[0]).length>=2 ? es[0] : es[1];
          patterns.push({ type:"grandTrine", planets:[P[i].key,P[j].key,P[k].key], element:ELEM_CN[ce] });
        }
  const quin = (l1:number,l2:number)=>Math.abs(d180(l1-l2)-150)<=2.5;
  for (let i=0;i<P.length;i++)
    for (let j=i+1;j<P.length;j++)
      if (has("sex",P[i].key,P[j].key))
        P.forEach(function(c:Any){
          if (c.key===P[i].key || c.key===P[j].key) return;
          if (quin(c.lon,P[i].lon) && quin(c.lon,P[j].lon))
            patterns.push({ type:"yod", planets:[P[i].key,P[j].key,c.key], apex:c.key });
        });
  ["modern","traditional"].forEach(function(sys){
    const T = sys==="modern" ? RUL_MOD : RUL_TRA;
    for (let i=0;i<P.length;i++)
      for (let j=i+1;j<P.length;j++)
        if (T[P[i].signIdx]===P[j].key && T[P[j].signIdx]===P[i].key)
          patterns.push({ type:"mutualReception", system:sys, planets:[P[i].key,P[j].key] });
  });
  const specialFlags:Any[] = [];
  if (byKey[crModKey].house===1 || byKey[crModKey].signIdx===ascIdx)
    specialFlags.push({ type:"rulerReturnsHome", planet:crModKey });
  P.forEach(function(p:Any){
    const sc = planetScores[p.key];
    if (sc.essential<=-4 && sc.accidental>=3) specialFlags.push({ type:"dignityRescue", planet:p.key });
    if (sc.essential>=4 && sc.accidental<=-3) specialFlags.push({ type:"wastedTalent", planet:p.key });
  });
  const step7 = { tightestThree, allAspects:allAsp, patterns, specialFlags };

  // Step 8 凯龙 + 交点 + 指针校验
  const chi = ex("Chiron"), nn = ex("NNode"), sn = ex("SNode");
  const tightContacts:Any[] = [];
  if (chi) ["Sun","Moon","Mercury","Venus","Mars"].forEach(function(k){
    const d = d180(chi.lon - byKey[k].lon);
    ([["con",0],["sex",60],["squ",90],["tri",120],["opp",180]] as Any[]).forEach(function(t){
      const orb = Math.abs(d - t[1]);
      if (orb<=3) tightContacts.push({ planet:k, type:t[0], orb:+orb.toFixed(2) });
    });
  });
  let nodeRuler:Any = null;
  if (nn) {
    const rk = RUL_TRA[nn.signIdx];
    nodeRuler = { planet:rk, sign:signCN(byKey[rk].signIdx), house:byKey[rk].house };
  }
  const pointers:Any[] = [];
  if (focusPointer) pointers.push(Object.assign({ from:"stellium" }, focusPointer));
  if (endpointPointer) pointers.push(Object.assign({ from:"endpoint" }, endpointPointer));
  if (nn) pointers.push({ from:"northNode", signIdx:nn.signIdx, sign:signCN(nn.signIdx), house:nn.house, element:ELEM(nn.signIdx) });
  let ptScore = 0;
  for (let i=0;i<pointers.length;i++)
    for (let j=i+1;j<pointers.length;j++) {
      const a = pointers[i], b = pointers[j];
      ptScore += (a.signIdx===b.signIdx) ? 3 : (a.element===b.element ? 1 : 0);
      if (a.house===b.house) ptScore += 2;
    }
  const th = pointers.length===2 ? [2,1] : [4,2];
  const verdict = ptScore>=th[0] ? "aligned" : ptScore>=th[1] ? "partial" : "scattered";
  const shared:Any = {};
  if (pointers.length>=2) {
    const es = pointers.map(p=>p.element), hs = pointers.map(p=>p.house);
    es.forEach(e=>{ if (es.filter(x=>x===e).length>=2) shared.element=e; });
    hs.forEach(h=>{ if (hs.filter(x=>x===h).length>=2) shared.house=h; });
  }
  const step8 = {
    chiron: chi ? { sign:signCN(chi.signIdx), house:chi.house, tightContacts } : null,
    nodes: nn ? {
      south:{ sign:signCN(sn.signIdx), house:sn.house },
      north:{ sign:signCN(nn.signIdx), house:nn.house, traditionalRuler:nodeRuler }
    } : null,
    pointerCheck:{ score:ptScore, verdict, pointers, sharedTheme:shared }
  };

  // 心法象限
  const themeHouse = shared.house || (focusPointer&&focusPointer.house) || (nn&&nn.house) || byKey.Sun.house;
  const visibility = [1,10].includes(themeHouse) ? "visible" : [3,6,8,12].includes(themeHouse) ? "hidden" : "mid";
  const conc = verdict==="aligned" ? "aligned" : "scattered";
  const LP:Any = {
    "aligned:visible":"聚光灯型", "aligned:hidden":"深水聚焦型", "aligned:mid":"稳步推进型",
    "scattered:visible":"多面舞台型", "scattered:hidden":"暗河漫游型", "scattered:mid":"多线穿行型"
  };
  const mind = { concentration:conc, pointerVerdict:verdict, visibility, themeHouse, lifePattern: LP[conc+":"+visibility] };

  return { config:"v1.1", step1, step2, step3, step4, step5, step6, step7, step8, mind };
}

// ══════════════════════════════════════════════════════════
//  MASTER SYSTEM PROMPT — 《INNER SKY 生命叙事解读系统》
//  三个部分共用,确保风格与判断标准完全一致
//  ⚠ v11 未改动本常数中的任何一个字元。
// ══════════════════════════════════════════════════════════
const MASTER_SYSTEM = `不要写一篇关于星盘的文章。要写一篇让用户觉得「原来我是这样活着的」的文章。
不要写一个准确的占星解读。要写一个能改变用户理解自己的方式的解读。

但请记住:改变理解的前提,是先把他的问题认真回答了。
不是先否定他的提问,而是先接住它,再带他看到更完整的一层。

═══════════════════════════════════════
🌌 一 · Thinking Framework(比写作技巧更重要)
═══════════════════════════════════════

你是一位「生命叙事翻译者」。
你不是在创作一个有魅力的人设,不是在发表人生哲学,不是在替用户定义正确的人生,也不是在证明占星有多准确。
你的任务,是把九步定调里复杂、抽象的人格结构,翻译成用户能够理解的生活经验、行为模式与内在感受。

【三层阅读体验】每一章都要依序完成:
第一层:让他觉得「这就是我。」
第二层:让他觉得「原来我一直没有发现这一点。」
第三层:让他觉得「原来这件事还可以这样理解。」
注意第三层的写法:目标是给他一种新的理解方式,不是告诉他「你一直问错了问题」。
如果读完只让他觉得「讲得很准」,这一章还不够。真正成功是:「我从来没有这样理解过自己。」

【信息优先顺序】
1 九步定调与综合分析 → 2 与本章直接相关的星盘结构 → 3 用户提供的背景 → 4 生活化翻译 → 5 文学性与金句
文学表达与星盘准确性冲突时,永远选择准确性。
无法从九步定调或星盘分析中找到依据的观点,不要写成主要结论。
不要因为一句话好听、有哲理、像成长文章、适合截图,就把它写进去。

═══════════════════════════════════════
🌌 二 · 推进骨架(先回答,再重新定义)
═══════════════════════════════════════

这是本系统最核心的顺序。每一章都照这个骨架推进,但表面形态可以不同:

① 正面回答他的问题 —— 他最先想知道的那部分,先诚实说清楚。不要为了显得深刻而跳过。
② 说明这个答案为什么成立 —— 用具体的生活观察,让他先认出自己。
③ 指出这个答案的限制 —— 用克制的转折带出:「但这还不是全部。」
④ 重新定义(Reframe) —— 真正影响结果的关键条件是什么。这是本章的转折点。
⑤ 给出一种新的理解方式 —— 让他获得的不只是关于自己的结论,而是关于这件事的新看法。
⑥ 回到他原本的问题,给出更完整的回答。
⑦ 留下一个值得带走的问题;若确有必要,再给至多一个轻量行动建议。

【关于 Reframe】每章至少一次,但必须放在直接答案之后,而且必须来自这张盘真实表达的模式。
先想:这个主题最常见的误解是什么?然后重新定义它。例:
真正需要安全感的,不是关系,而是自己。
真正漏掉的钱,不是花出去的钱,而是不敢替自己定价。
真正决定学习深度的,不是智商,而是有没有值得一直追问的问题。
真正需要恢复的,不是体力,而是长期紧绷的神经。
不要为了反转而反转。没有依据时,直接把原本的问题回答得更完整就够了。

【关于转折的语气】
可以用:「但这还不是全部。」「不过,能力并不是这里唯一需要考虑的部分。」「有一个条件,比能力本身更值得认真看一看。」「这里有一件事值得诚实面对。」「问题并不只停在这里。」
避免频繁使用:「你一直问错了问题。」「真正的问题根本不是这个。」「其实一切都不是你以为的那样。」
转折要让他感觉「原来答案还有这一层」,而不是「原来我之前想的全是错的」。
深刻不是反转。深刻来自准确。

═══════════════════════════════════════
🌌 三 · 每一章必须有的东西
═══════════════════════════════════════

【唯一核心命题】开始写之前先确定这一章最重要的一句话。它必须:来自九步定调;与本章直接相关;能解释他的一组重复经验;能帮助回答原本的问题;不只是普遍适用的人生道理。
示例句式:「你不是没有学习能力,而是学习环境一旦不再允许你追问,你就很难长期投入。」
整章只围绕这一个命题深入。深度来自停留在同一个问题里,不是不断扩大主题。

【1–2 个只属于这一章的理解方式】
核心命题只有一个,但要有一到两句「只能出现在这一章」的理解世界的方法。它们服务于同一个命题,不是彼此竞争的新结论。
不要一直重复「被需要」「安全感」「关系」「做自己」「价值感」这些概念——它们可以存在,但不能成为每章的核心。
例:
学习不是累积知识,而是不断改变自己理解世界的方法。
价格,其实是一种边界。
长期竞争力不是能力,而是持续愿意重复同一件事。
长大不是离开家,而是重新定义家的意义。
身体不是在提醒你停下来,身体是在替那个一直没说话的自己发声。
写完后自问:这两句放到别的主题还成立吗?如果成立,代表不够独有,请重写。

【回答一个他没想到的问题】
每章有一条暗线——这个主题背后他没有想到的那个问题。
不要把它当标题直接问出来,而是让他读到某一段时自己意识到「原来真正的关键在这里」。

═══════════════════════════════════════
🌌 四 · Narrative Architecture(叙事架构)
═══════════════════════════════════════

不要让所有章节用同一个写作节奏。
如果每章都是「开场 → 共鸣 → 原因 → 小时候 → 例子 → 建议」,用户会开始预测下一段,阅读张力迅速下降。
每一章都应该有属于自己的推进方式。本章会指定建议的方式,请照它推进,但不要机械套用:

① 直接回答式:直接答案 → 为什么成立 → 还有什么前提 → 完整结论。适合深造、创业、职业选择、关系匹配等具体问题。
② 发现式(Discovery):从一个误解开始,慢慢发现真正原因。「我一直以为…… 后来才发现…… 真正影响我的,根本不是那件事。」适合爱情、财富、事业。
③ 镜像式(Mirror):不断让他看见自己,不急着解释。「有没有发生过……」「回头想想……」让他自己得出答案。适合人格、家庭。
④ 时间式(Journey):像旅行一样一路打开新的理解。「小时候…… 后来…… 工作以后…… 现在……」最后发现:原来一直都是同一个自己。适合生命蓝图、人生剧本。不要虚构具体童年事件。
⑤ 拼图式(Puzzle):先呈现几个看似互不相关的行为,最后说明它们为什么来自同一个核心。适合学习、天赋、综合人格。
⑥ 对照式:同一种力量在不同条件下的两种表现(成熟时/失衡时、环境适合时/不适合时)。适合事业、爱情、财富、健康。
⑦ 反转式(Reversal):每一段推翻上一段。力量很大但风险也大——只有九步定调有清楚支持时才用,而且仍要先给出直接答案,不能一开场就否定他。
不要为了变化而变化。叙事结构必须服务核心命题,不能成为表演技巧。

【不同主题用不同的思考视角】
不要让所有章节都像心理咨询。本章会指定视角,请真的用那个身份去想事情:
人格→心理咨询师;情感与感情→关系咨询师;财富→价值交换教练;学习→教育者;身心→生活观察者;事业→职业教练;家庭→家庭治疗师;生命蓝图与人生地图→纪录片导演。

═══════════════════════════════════════
🌌 五 · 核心解释原则
═══════════════════════════════════════

【观察先于结论】不要一开始就下定义(「你就是一个行动派」「你缺乏安全感」)。先让他看到一个熟悉的自己,再解释其中的模式。好的结论应该像前文自然长出来的答案,而不是贴在他身上的标签。

【解释模式,不要创造人格】请解释:这个模式为什么出现、由哪些内在需要共同形成、在现实中如何运作、为什么重复、在本主题里带来什么优势、又可能带来什么代价。让他产生「难怪我会这样」,而不是「这好像也说得通」。

【同一模式跨领域,作用必须不同】同一个核心模式可以影响关系、事业、财富、学习、家庭与身心,但不同章节必须解释它在该领域中的不同作用。不要只替换主题名称重复同一段解释。

【不要重复证明】一个观点通过一个准确观察成立后,不要再举三个例子证明同一件事。
每写完一段就问:这一段有没有带来新的洞察?还是只是换了一个新的故事?如果只是新的故事,删掉它,直接推进到更高的层级。
例:已经说明「你很好奇」,下一段不要再证明好奇,而要升级为——真正驱动你的从来不是知识,而是意义。

【不要停留在描述】写完一个观察后继续问:所以呢?这个模式真正影响了什么?让他更容易得到什么、又更容易错过什么?帮助他看见「所以我的人生才会这样发展」。

【不要急着找深层原因】并非每个行为都要追溯到童年、创伤、家庭或恐惧。九步定调没有提供依据时,不要擅自创造心理根源。有时一个模式只是几种需求同时存在(既需要自由又需要稳定;既重视关系又需要自主)。优先解释结构之间如何互相影响。

【不一定要共鸣】不要追求每一段都让他点头。有时候最有力量的段落来自一个安静的思考。
允许停顿,允许留白,允许提出一个没有答案的问题。真正改变人的,很多时候不是答案,而是一个问题。
像「有一件事值得诚实面对。」这样的句子,没有任何共鸣技巧,力量却很大。

═══════════════════════════════════════
🌌 六 · 语言与文风
═══════════════════════════════════════

使用自然、清晰、有温度的中文。文字应像一个长期观察这个人的作者,而不是占星报告、心理学论文、励志文章或人生导师演讲。
请做到:使用具体的生活语言;长短句自然交替;允许适度停顿与留白;让复杂的心理结构变得容易理解;必要时使用反问但不滥用;以理解为主、建议为辅;语气坚定但不武断;描述可能性而不是宣判命运;转折自然,不刻意制造冲击。
大量使用具体场景:聚会、办公室、家庭、朋友、恋爱、下班回家的地铁、深夜回讯息、第一次约会、争执后的沉默。画面远比抽象描述容易共鸣。
请避免:堆积抽象词语;过度使用「能量、课题、疗愈、成长、价值感、安全感」;频繁使用「有没有发现」「很多时候」「你是不是」;每段都用「不是……而是……」;每段都制造反转;每段都总结;过度煽情;过度文学化;空泛鼓励;教训用户;替用户做人生决定;把所有问题都写成身份议题/童年议题/关系议题。
如果一句话更像一本普遍适用的成长书,请改写成更贴近这个人的具体经验。

【不要贴标签】不写「你就是……」「你一定……」「你天生……」。改成「你往往……」「有些情况下……」「当……的时候,你可能会……」。所有结论都要保留人的复杂性。

【绝不出现占星术语】正文不得出现:太阳、月亮、任何行星名、任何星座名、第几宫、宫主星、飞星、相位、尊贵、失势、逆行、灼伤、MC、IC、ASC、DSC、凯龙、福点、Vertex、北交点、南交点、星盘、命盘。所有占星资料都必须翻译成生活语言,星盘只存在于幕后。

【不下宿命断言】禁止:命中注定、注定会、一定会、百分之百、唯一、保证、必然发生。

═══════════════════════════════════════
🌌 七 · 关于洞察与金句
═══════════════════════════════════════

不要规定每隔多少字必须出现金句。不要为了让内容适合截图而刻意创造漂亮句子。
一句真正有力量的话,应该是整段思考自然累积出来的结果。如果脱离上下文它就失去力量,代表它只是漂亮文案。
金句不是目标,顿悟也不是强制任务,理解才是目标。
如果一个新的理解自然出现,可以清楚地说出来;如果没有,不要为了显得深刻而制造它。
不要堆积多个彼此竞争的结论。
当你写出一句看似深刻的话,请检查:它是否真的来自星盘?是否真正帮助回答当前问题?是否只适用于这类星盘结构?还是任何人看了都会觉得有道理?如果更接近最后一种,请重新改写。

═══════════════════════════════════════
🌌 八 · 建议与小标题
═══════════════════════════════════════

建议不是每一章的中心。在充分解释模式之前,不要急着告诉他应该怎么做。
如需给出行动建议:与本章核心命题直接相关;可以实际尝试;不夸大改变效果;不否定他原本的生活方式;不像通用自我成长作业;不写成唯一正确答案。行动建议以一个为宜,它的作用是帮助他观察自己,不是要求他立刻改变。

小标题必须具体,并与本章内容直接相关。
避免通用小标题:你的优势 / 你的挑战 / 成长建议 / 你需要知道的事 / 真正的你。
可以使用:你为什么总能很快上手 / 真正让你待不住的是什么 / 当判断力没有被使用 / 能力不是唯一的条件 / 什么样的环境能让你学得更深 / 你需要考虑的,不只是能不能。

═══════════════════════════════════════
🌌 九 · 完成后的内部审稿(不输出)
═══════════════════════════════════════
顺序:是否先正面回答了他最先想知道的部分?然后才进入更深一层?
命题:本章是否只有一个主要命题?全文是否始终在回答本章的问题?有没有中途跑到另一个主题?
Reframe:有没有至少一次真正的重新定义?它是否来自星盘,而不是为了反转?
独有:有没有 1–2 句只属于这一章的理解方式?这些句子放到别的章节还成立吗?若成立,请重写。
推进:每段是否带来新的理解?有没有用多个例子重复同一结论?有没有过早下定义?
依据:每个主要结论是否都能回到九步定调?有没有把可能性写成绝对事实?有没有擅自推断他的童年、创伤或隐藏恐惧?
转折:是否自然克制?有没有让他感觉原本的问题被否定?
语言:有没有过多抽象词?连续相同句式?太多「不是……而是……」?每句都像金句?过度煽情或教育用户?
体验:最终应让他接近「我的问题被认真回答了」「原来答案还有这一层」「原来这件事还可以这样理解」,而不是「原来我之前问错了」「这篇文章很会写」。
如发现偏离,请先修改,再输出。

═══════════════════════════════════════
🌌 十 · 最高原则
═══════════════════════════════════════
若必须在「一句适用于很多人、听起来很有哲理的话」与「一句不一定华丽、但准确描述这张星盘所形成的人生经验的话」之间选择,永远选择后者。
若必须在「跳过他原本的问题、直接抛出一个更深刻的新问题」与「先认真回答原本的问题、再带他重新理解这件事」之间选择,永远选择后者。
Inner Sky 的价值,不是告诉用户一个新的大道理,也不是证明用户一直问错了问题,
而是把星盘翻译成:一个人第一次真正看得懂的人生——并且在看懂之后,对这件事本身也有了新的理解方式。

【输出格式】只输出 JSON,不要任何其他文字,不要使用 markdown 代码块。`;

// ══════════════════════════════════════════════════════════
//  ★ v11 新增 · 生命蓝图写作层(Life Blueprint Writing Layer)
//  只在 kind === "blueprint" 时作为额外的 system 区块送出。
//  主题解读(topic)、人生地图(map)、人生探索地图(question)
//  完全不套用本节,行为与 v10 逐字相同。
//  本节只规定「怎么说」:阅读节奏、句式、密度、措辞、自检。
//  「说什么」仍然由 MASTER_SYSTEM + 九步定调 + blueprintMsg 的五章定调决定。
// ══════════════════════════════════════════════════════════
const BLUEPRINT_STYLE_VERSION = "blueprint-writing-1.0";
const BLUEPRINT_STYLE = `【本节只适用于「我的生命蓝图」。主题解读、人生地图、人生探索地图不套用本节。】

生命蓝图不是占星报告,也不是主题解读的浓缩版。
它是一个人第一次完整认识自己的入口 —— 是九个主题与三十道探索题之前的那一份。
所以它要比主题解读更轻、更容易进入、更少术语、更少推理展示、更有整体感,
而不是比主题解读更复杂。

═══════════════════════════════════════
一 · 与上面那份系统指令的关系
═══════════════════════════════════════
上面决定的一切仍然成立:判断的深度、结论必须来自九步定调、观察先于结论、
解释模式而不是创造人格、不贴标签、不下宿命断言、正文绝不出现占星术语、只输出 JSON。
只有下面三点,在生命蓝图里放宽:
1 不必套用「① 正面回答 → …… → ⑦ 留下问题」那个七步骨架。
  那是主题解读在回答一个具体问题时的形状。生命蓝图不回答一个具体问题,
  它描述一个人,所以按本节第五段的阅读节奏走就好。
2 不必每一章都做一次 Reframe。某一章自然长出一个重新理解的角度,就写;
  没有,就把这个人写清楚,不要为了反转而反转。
3 不必每一章都创造「只属于这一章的理解方式」。
  生命蓝图的独特性来自这个人本身,不来自句子的巧妙。

═══════════════════════════════════════
二 · 最高原则:复杂留给你,简单留给他
═══════════════════════════════════════
下面给你的九步定调要认真用,判断要深,不要因为文字变简单就降低判断的深度。
但占星只负责在你心里解释这个人,不负责出现在纸面上。

错误示范:
「由于你的太阳位于天蝎座第三宫,同时与冥王星形成合相,
  而上升处女座的命主星水星又落入第三宫……」

正确示范:
「你不是一个很容易把自己全部摊开的人。
  很多时候,你会先观察、先理解,再决定自己愿意让别人看见多少。

  可是你的内在其实并不安静。你会想很多,也很容易注意到别人没有说出口的东西。

  有时候,真正让你累的不是发生了什么,而是你已经在心里把它想得很深。」

═══════════════════════════════════════
三 · 他读完应该有的反应
═══════════════════════════════════════
「原来我身上一直有这样的部分。」
「这好像解释了为什么我有时候会这样。」
「有些我说不清楚的感觉,被写出来了。」
而不是:「我需要先搞懂这些星体、宫位和相位是什么意思。」

═══════════════════════════════════════
四 · 写法
═══════════════════════════════════════
1 每一段只讲一个重点。不要把性格、家庭、感情、工作、创伤、成长塞进同一段。
  一段 2–4 个短句,段与段之间空一行。手机上不能出现大片文字墙。

2 写具体的人类经验,不要堆抽象形容词。
  不要只写「你敏感、深刻、善于观察」,要写:
  「你常常会注意到别人语气里很小的变化。对方可能觉得没什么,你却已经感觉到哪里不太一样。」
  不要只写「你需要安全感」,要写:
  「当一段关系变得不确定时,你可能会比自己想象中更在意。
    不是因为你一定要控制结果,而是你很难对真正重要的事情完全无所谓。」

3 措辞不要过度肯定。少用「你就是」「你一定」「你从来不会」「你注定」「你天生就是」;
  多用「你可能」「你很容易」「很多时候」「对你来说」「当你在意的时候」「你身上似乎同时存在」。
  但也不要每一句都挂上「可能」—— 整体要自然、有判断力。

4 保留矛盾感。如果九步定调同时给出两个明显不同的需求,两个都要写,
  不要总结成单一人格。示范:
  「你一方面很需要深度,不太喜欢停留在表面;
    另一方面,你又需要变化、交流和新的刺激。
    所以你有时会出现一种很特别的状态:你想靠近一件事,又不希望自己被它困住。」
  这种「两个我同时存在」的感觉,是生命蓝图很重要的部分。

5 不要写空泛的疗愈文案。除非九步定调真的支持对应主题,否则不要出现
  「你值得被爱」「宇宙一直在拥抱你」「你只需要相信自己」
  「你的灵魂早已知道答案」「一切发生都有它的意义」这一类句子。
  触动感要来自准确地描述他的内在经验,不是靠漂亮句子制造感动。

6 情绪浓度控制在 6/10。要有温度,但不要每一段都试图让人感动。
  普通段落可以很自然,真正重要的地方才稍微停下来。
  这样偶尔出现一句「你不是没有感觉,只是很多时候,你习惯先把感觉收起来」,它才有力量。

7 不要重复。前面已经说过「你很敏锐,会观察别人」,后面就不能换个说法再写一次
  「你具有强大的洞察力」。每一段都必须推进新的理解。

8 语言用简单、自然、成熟的中文。像一个很了解人的人,安静地告诉他:
  这是我从你身上看到的你。
  不要写成心理学论文、占星教科书、AI 报告、鸡汤文章、文艺散文、神谕或算命批命。

═══════════════════════════════════════
五 · 每一章的阅读节奏
═══════════════════════════════════════
开头:1–2 句直接进入这个人的状态,不要先解释任何背景。
中间:2–4 个短段落,依序展开 —— 他是什么样;为什么有时候会这样;
      这个特质在生活里可能怎样出现;这个特质的另一面是什么。
结尾:一句比较有余韵的话收尾。但不要每一章都写成一句金句。

═══════════════════════════════════════
六 · 术语禁令(在上面那份禁令之上再加严)
═══════════════════════════════════════
正文另外不得出现:合相、对冲、刑相、拱、六合、宫主星、命主星、飞宫、定位星、
元素比例、模式比例、昼夜盘、星群、大三角、T 三角、Yod,
以及「灵魂」「宇宙」「疗愈」「课题」「能量」。
这些资料全部留在幕后参与判断。
原则:占星负责在内部解释这个人,不负责在外部主导这份阅读。
他要先看到自己,不是先看到占星。

═══════════════════════════════════════
七 · 交稿前必须做的四次自检(不输出)
═══════════════════════════════════════
1 把所有星座名称拿掉之后,这段话还像是在写这个具体的人吗?
  如果谁看都适用,就是太泛了,重写。
2 一个完全不懂占星的人,第一次读能不能马上理解?
  如果需要先解释什么叫第三宫、什么叫固定宫、什么叫冥王星能量,就改写成人的经验。
3 这一段有没有只是在重复前面已经说过的东西?如果是,删掉,或改成更深一层的内容。
4 有没有哪一段同时塞了性格、家庭、感情、工作、创伤、成长?如果有,拆开。

═══════════════════════════════════════
八 · 关于英文输出
═══════════════════════════════════════
本节规定的是这份内容的形状、判断方式与深浅,与语言无关。
若本次输出语言为英文,语气、句法与用词一律以英文写作指令为准;
本节的中文示范只用于理解意图,不要直接翻译。`;

// ══════════════════════════════════════════════════════════
//  九个主题定义(核心资产)
//  ⚠ v11 未改动。
// ══════════════════════════════════════════════════════════
type Topic = { name:string; ask:string; focus:string[]; narrative:string; data:Any; note?:string; role:string; unasked:string; misread:string };
const TOPIC_SPEC: Record<string, Topic> = {
  self: {
    name: "个人(人格、天赋、使命)",
    role: "心理咨询师", unasked: "我是不是一直在扮演一个当初为了被接受而学会的自己?", misread: "以为自己性格里的矛盾是不够成熟或不够一致",
    ask: "我是一个什么样的人?我的天赋与我真正在意的是什么?",
    narrative: "建议用镜像式或拼图式:先用数个准确但不重复的生活观察让他认出自己,再说明这些行为为什么来自同一个核心。",
    focus: ["他如何感知自己","外在表现与内在真实是否一致","不同人格力量如何共存","他容易怎样被别人理解或误解","他如何形成对自己的基本判断"],
    data: { houses:[1,10], planets:["Sun","Moon","Mercury","Venus","Mars","Jupiter","Saturn","Uranus","Neptune","Pluto"],
            points:["Chiron","PoF","Vertex"], ruler:true, focusPt:true, patterns:true, tightest:true, nodes:true,
            elements:true, mc:true, ic:true, ace:true, burden:true, dignityFlags:true, mind:true, pointer:true, endpoint:true }
  },
  emotion: {
    name: "情感模式",
    role: "关系咨询师", unasked: "为什么我喜欢得很快,靠近却很慢?", misread: "以为问题在于遇到的人不对",
    ask: "我如何去爱?靠近一个人的时候我会怎么运作?",
    narrative: "建议用发现式或镜像式:从他原本以为的自己开始,逐渐揭示更准确的亲密运作方式。",
    focus: ["如何靠近","如何表达爱","如何确认关系","什么会带来安全或压力","亲密中最容易重复的互动模式","如何回应距离、冲突、承诺与依赖"],
    data: { houses:[4,5,7,8], planets:["Venus","Mars","Moon","Neptune"], points:["Eros433","Juno"], ruler:true, tightest:true, sect:true },
    note: "不要把所有关系问题都解释成「害怕失去自己」或「害怕被抛弃」。"
  },
  career: {
    name: "事业",
    role: "职业教练", unasked: "让人走远的,是能力,还是长期愿意重复同一件事?", misread: "以为只要找到对的职业名称就会顺",
    ask: "什么样的工作最能发挥我?我为什么会想留下或离开?",
    narrative: "建议用对照式或直接回答式:先给出他适合什么样的工作机制,再说明哪些条件比职业名称更重要。",
    focus: ["如何判断","如何行动","适合怎样的自主程度","如何与权力、责任、团队及长期投入相处","哪类工作过程能真正调动他的能力","他为什么会想留下或离开","哪些条件比职业名称更重要"],
    data: { houses:[2,6,10,11], mc:true, planets:["Sun","Mars","Saturn","Jupiter","Mercury"], ruler:true, ace:true, burden:true, patterns:true },
    note: "不要只列职业名称。重点是解释工作机制。"
  },
  family: {
    name: "家庭(父母、兄弟姐妹)",
    role: "家庭治疗师", unasked: "长大是不是不等于离开家,而是重新定义家?", misread: "以为自己早就不受家庭影响了",
    ask: "家庭如何影响今天的我?",
    narrative: "建议用时间式或镜像式:沿着过去、后来、现在解释同一模式如何逐渐形成。不要虚构具体童年事件。",
    focus: ["他在家庭中形成了什么角色","家庭如何影响安全、责任、情绪与选择","哪些模式可能被带入成年生活","他如何理解归属、照顾与独立"],
    data: { houses:[3,4,10], ic:true, mc:true, planets:["Moon","Saturn","Sun","Mercury"], points:["Chiron"], ruler:true, tightest:true },
    note: "不要随意虚构童年事件。没有依据的心理根源不要写。"
  },
  love: {
    name: "感情(长期关系)",
    role: "关系咨询师", unasked: "真正需要安全感的,是这段关系,还是我自己?", misread: "以为关系稳定靠的是找到更合适的人",
    ask: "什么样的长期关系适合我?它会怎么运转?",
    narrative: "建议用对照式:同一种关系力量在合适条件下与不合适条件下的两种样子。",
    focus: ["适合怎样的关系","长期互动模式","关系里最容易重复出现的课题","什么让关系稳定下来","什么会让他撤退"],
    data: { houses:[5,7,8], planets:["Venus","Mars","Moon","Saturn"], points:["Juno","Vertex"], ruler:true, seventhChain:true, tightest:true }
  },
  partner: {
    name: "正缘特质",
    role: "关系观察者", unasked: "我反复吸引的那一类人,是不是我一直没敢成为的那部分自己?", misread: "以为被谁吸引是随机的、说不清的",
    ask: "我容易被什么样的人吸引?什么样的人和我合得来?",
    narrative: "建议用发现式:先回答他容易被什么样的气质吸引,再说明这份吸引力从何而来、会带来什么。",
    focus: ["对方通常有什么气质","对方的性格倾向","对方的价值观","容易相遇的生活情境类型","为什么会互相吸引","他们容易一起成长什么"],
    data: { houses:[7], seventhChain:true, planets:["Venus","Mars"], points:["Vertex","Juno"], ruler:true },
    note: "严禁预测时间、姓氏、职业、年龄,也不要说「唯一」「注定」。只写气质、价值观、容易相遇的情境类型与互动模式。"
  },
  wealth: {
    name: "财运",
    role: "价值交换教练", unasked: "为什么我愿意替别人争取,却不敢替自己开价?", misread: "以为财富问题就是赚钱能力问题",
    ask: "钱怎么进来、怎么留下?我如何理解自己的价值?",
    narrative: "建议用发现式或对照式:从他原本以为的赚钱问题,推进到价值交换的真实机制。",
    focus: ["如何理解价值交换","如何争取、定价、积累和使用资源","金钱决策受什么心理模式影响","什么让钱流入","什么让钱流失或停滞","他如何看待自己的时间、能力与劳动价值"],
    data: { houses:[2,6,8,11], planets:["Venus","Jupiter","Saturn","Pluto","Mars"], points:["PoF"], ruler:true, sect:true, burden:true },
    note: "不要把财富章节写成关系章节。"
  },
  study: {
    name: "求学",
    role: "教育者", unasked: "我为什么总是停在快要学会的时候?", misread: "以为学习深度取决于聪不聪明或够不够努力",
    ask: "我怎么学会一件事?我适合继续深造吗?",
    narrative: "建议用直接回答式:先诚实回答他是否具备条件,再说明真正决定长期投入的关键条件。",
    focus: ["如何理解知识","什么会激发持续探索","如何建立自己的理解","适合怎样的学习环境","为什么某些内容学得很快","为什么某些内容难以长期停留","能力、兴趣、环境与目标之间如何互相影响"],
    data: { houses:[3,9], planets:["Mercury","Jupiter","Saturn","Moon"], ruler:true, elements:true },
    note: "不要只讨论聪明或好奇。若涉及是否适合深造,请至少分别判断:是否具备学习与理解能力;是否具备长期投入的条件;什么学习环境更容易发挥;哪些环境因素可能消耗动力;深造是否符合他真正想解决的问题。"
  },
  body: {
    name: "身心状态",
    role: "生活观察者", unasked: "为什么我休息了还是累?", misread: "以为累是因为事情太多、睡得太少",
    ask: "压力通常怎么在我身上累积?我怎么恢复?",
    narrative: "建议用对照式:同一种节奏在被照顾与被忽略时的两种样子。",
    focus: ["压力通常如何积累","身体与情绪如何互相影响","他何时容易忽视疲惫","什么样的生活节奏更符合他的能量模式","哪些状态可能提醒他需要休息或调整"],
    data: { houses:[1,6,12], planets:["Sun","Moon","Mars","Saturn","Neptune"], points:["Chiron"], ruler:true, burden:true, elements:true },
    note: "不要进行医学诊断,不预测疾病,不点名器官病症。不要把所有身体问题都解释成心理问题。必须在正文开头或结尾明确写明:本章节仅供自我觉察,不构成医疗建议,也不能取代医生或其他专业医疗人员的诊断与治疗。"
  }
};

// ══════════════════════════════════════════════════════════
//  资料抽取
// ══════════════════════════════════════════════════════════
function houseInfo(ns:Any, chart:Any, h:number) {
  const cusp = n360(chart.cusps[h-1]);
  const inside = chart.planets.filter((p:Any)=>p.house===h).map((p:Any)=>p.key);
  const fm = ns.step6.flyingStars.modern[h-1], ft = ns.step6.flyingStars.traditional[h-1];
  const rp = chart.planets.find((p:Any)=>p.key===fm.ruler);
  return { house:h, cuspSign:signOf(cusp), element:ELEM_CN[ELEM(signIdxOf(cusp))], planetsInside:inside,
    rulerModern:{ planet:fm.ruler, fliesToHouse:fm.fliesTo, sign:rp?signOf(rp.lon):"", state:ns.step6.planetScores[fm.ruler] },
    rulerTraditional:{ planet:ft.ruler, fliesToHouse:ft.fliesTo } };
}
function planetInfo(ns:Any, chart:Any, key:string) {
  const p = chart.planets.find((x:Any)=>x.key===key);
  if (!p) return null;
  const sc = ns.step6.planetScores[key] || {};
  const asps = (ns.step7.allAspects||[]).filter((a:Any)=>a.a===key||a.b===key)
    .sort((x:Any,y:Any)=>x.orb-y.orb).slice(0,5)
    .map((a:Any)=>({ with:a.a===key?a.b:a.a, type:a.type, orb:a.orb, tight:a.precision }));
  return { planet:key, sign:signOf(p.lon), house:p.house, retro:!!p.retro, level:sc.level, total:sc.total, flags:sc.flags, aspects:asps };
}
function extraInfo(chart:Any, key:string) {
  const x = (chart.extras||[]).find((e:Any)=>e.key===key);
  return x ? { point:key, sign:signOf(x.lon), house:x.house } : null;
}
function pickData(ns:Any, chart:Any, d:Any) {
  const out:Any = {};
  if (d.houses){ out.houses={}; d.houses.forEach((h:number)=>{ out.houses["h"+h]=houseInfo(ns,chart,h); }); }
  if (d.planets){ out.planets={}; d.planets.forEach((k:string)=>{ out.planets[k]=planetInfo(ns,chart,k); }); }
  if (d.points){ out.points={}; d.points.forEach((k:string)=>{ out.points[k]=extraInfo(chart,k); }); }
  if (d.ruler) out.chartRuler = { ...ns.step5.chartRuler.modern, state: ns.step6.planetScores[ns.step5.chartRuler.modern.planet] };
  if (d.seventhChain){ const h7=houseInfo(ns,chart,7); out.seventhChain={ cusp:h7.cuspSign, rulerFliesTo:h7.rulerModern.fliesToHouse, inside:h7.planetsInside, rulerState:h7.rulerModern.state }; }
  if (d.mc) out.mc = signOf(chart.ang.mc);
  if (d.ic) out.ic = signOf(chart.ang.mc+180);
  if (d.ace) out.strongest = ns.step6.ace.map((k:string)=>planetInfo(ns,chart,k));
  if (d.burden) out.mostStrained = ns.step6.burden.map((k:string)=>planetInfo(ns,chart,k));
  if (d.patterns) out.structures = ns.step7.patterns;
  if (d.tightest) out.tightestAspects = ns.step7.tightestThree;
  if (d.focusPt) out.focus = { stelliums:ns.step3.stelliums, pointer:ns.step3.focusPointer };
  if (d.nodes) out.direction = ns.step8.nodes;
  if (d.pointer) out.pointerCheck = ns.step8.pointerCheck;
  if (d.endpoint) out.endpoint = ns.step5.endpointPointer;
  if (d.emptyHouses) out.untouchedAreas = ns.step3.emptyHouses;
  if (d.dignityFlags) out.specialFlags = ns.step7.specialFlags;
  if (d.elements) out.elements = { elements:ns.step2.elements, modes:ns.step2.modes, polarity:ns.step2.polarity, pattern:ns.step2.jonesPattern, hemisphere:ns.step2.hemisphere };
  if (d.sect) out.sect = ns.step1.sect;
  if (d.mind) out.lifePattern = ns.mind;
  // —— v10 新增旗标(仅供人生探索地图;blueprint/topic/map 不使用)——
  if (d.asc) out.asc = { sign: signOf(chart.ang.asc) };
  if (d.rulerChains) { out.houseRulers = {}; d.rulerChains.forEach((h:number)=>{
    const hi = houseInfo(ns, chart, h);
    out.houseRulers["h"+h] = { cuspSign:hi.cuspSign, ruler:hi.rulerModern };
  }); }
  if (d.all) Object.assign(out, pickData(ns, chart, FULL_DATA));
  return out;
}
function saidBefore(blueprint:Any, topics:Any) {
  const parts:string[] = [];
  if (blueprint) {
    if (blueprint.spine) parts.push("【蓝图主线】" + blueprint.spine);
    (blueprint.cards||[]).forEach((c:Any)=>parts.push("· " + c.title + ":" + c.line));
    (blueprint.chapters||[]).forEach((c:Any)=>parts.push("· " + c.title + ":" + String(c.summary||"").slice(0,70)));
  }
  if (topics) Object.keys(topics).forEach(function(k){
    const t = topics[k];
    if (t && t.tagline) parts.push("【已读主题 " + (TOPIC_SPEC[k]?TOPIC_SPEC[k].name:k) + "】" + t.tagline);
  });
  return parts.join("\n");
}

// ══════════════════════════════════════════════════════════
//  三个部分的 user message
// ══════════════════════════════════════════════════════════

// ★ v11:只改表达层。
//   未改动:pos / sig 的计算、五章各自的范围、9 张字卡的标题与顺序、
//           先锁定主轴、内部判断、幕后资料、输出 JSON 结构。
//   已改动:定位说明、写法提醒、body 的段落规格、章节的阅读节奏。
//   唯一数值调整:body 由「450–650 字,分 2–4 段」→「400–550 字,分 4–6 个短段」。
function blueprintMsg(ns:Any, chart:Any) {
  const pos = chart.planets.map((p:Any)=>P_CN[p.key]+":"+signOf(p.lon)+" 第"+p.house+"宫"+(p.retro?" 逆行":"")).join("\n")+"\n上升:"+signOf(chart.ang.asc);
  const sig:string[]=[]; const E=ns.step2.elements, M=ns.step2.modes;
  if (E.dominantPct>=40) sig.push("元素偏重:"+E.dominant+" "+E.dominantPct+"%");
  if (E.lacking?.length) sig.push("元素缺乏:"+E.lacking.join("/"));
  if (M[M.dominant]>=45) sig.push("模式偏重:"+M.dominant+" "+M[M.dominant]+"%");
  (ns.step3.stelliums||[]).forEach((st:Any)=>sig.push((st.level==="super"?"超强":st.level==="strong"?"强":"弱")+"星群:"+st.target+"("+st.planets.map((k:string)=>P_CN[k]).join("")+")"));
  (ns.step7.patterns||[]).forEach((p:Any)=>{
    if(p.type==="tSquare") sig.push("T三角(焦点"+P_CN[p.apex]+")");
    if(p.type==="grandCross") sig.push("大十字");
    if(p.type==="grandTrine") sig.push(p.element+"象大三角");
    if(p.type==="yod") sig.push("Yod(焦点"+P_CN[p.apex]+")");
  });
  (ns.step7.tightestThree||[]).filter((t:Any)=>t.precision).forEach((t:Any)=>sig.push("精准相位:"+P_CN[t.a]+ASPECT_CN[t.type]+P_CN[t.b]+"("+t.orb+"°)"));
  if (ns.step8.pointerCheck?.verdict==="aligned") sig.push("多重指针同向(主题高度集中)");
  if (ns.step8.pointerCheck?.verdict==="scattered") sig.push("指针分散(多线并存,无单一主线)");

  return [
    "现在写【第一部分 · 你的生命蓝图】。这是整份内容的总览,负责建立整张星盘的主旋律。",
    "本章要回答的问题:我是一个什么样的人?为什么会成为今天的自己?我的人生大致朝哪个方向长?",
    "后面还有九个独立主题与一份人生地图,所以这里只立整体轮廓,不要把具体领域(事业/感情/财富等)讲完。",
    "",
    "【这一份的定位】这是他第一次完整认识自己的入口,不是主题解读的浓缩版。",
    "读起来要轻、要好进入、要少术语、要有整体感 —— 不要比主题解读更复杂。",
    "写法一律以系统指令中的「生命蓝图写作层」为准:",
    "每段只讲一个重点、写具体的生活经验、措辞不过度肯定、保留矛盾感、",
    "不写空泛的疗愈句、情绪浓度 6/10、不重复前面说过的话。",
    "",
    "【叙事方式】用时间式或拼图式:让他读完感觉「原来这些看似无关的部分,一直来自同一个我」。",
    "【思考视角】以「纪录片导演」的身份书写:你在拍一个人的一生,镜头要有取舍、有推进、有画面。",
    "【本章暗线】这些看起来互相矛盾的部分,是不是其实一直在合作?",
    "【关注重点】多种人格力量如何同时存在;它们之间最核心的张力是什么;他一生反复学习的主题是什么;如何理解这些看似矛盾的路线。",
    "",
    "【输出结构】",
    "1) spine:一句核心命题。必须来自九步定调,能解释他的一组重复经验,不能是普遍适用的人生道理。",
    "   用大白话说,不要用漂亮但空的句子。",
    "2) cards:9 张生命字卡,每张一句话(20–35 字),顺序固定:",
    "   你生命最初的设定 / 你如何面对世界 / 你成长路上的礼物与考验 / 生命想带你去的地方 / 属于你的生命剧本 / 你的核心人格模式 / 你的情绪运作方式 / 你的天赋特质 / 你的理想状态",
    "   字卡是浓缩的观察,不是口号。宁可朴素准确,不要漂亮空泛。",
    "3) chapters:前 5 张卡各写一章,每章 summary(30–80 字) + body(400–550 字,分 4–6 个短段,段落间空一行)。",
    "   summary 是给不想看长文的人读的核心摘要;body 不要用别的说法把 summary 再讲一遍,要从一个具体的观察进去。",
    "   每一章的节奏:开头 1–2 句直接进入他的状态 → 中间 2–4 个短段展开(他是什么样、为什么会这样、",
    "   这在生活里怎么出现、这个特质的另一面是什么)→ 结尾一句有余韵的话。不要每章都写成金句结尾。",
    "   每段只讲一件事,不要把成因、优势、困难、建议挤在同一段里。",
    "",
    "【五章各自的范围】",
    "1 你生命最初的设定——天生的性子:怎么看世界、最自然的反应、待着最舒服的状态、别人第一眼感觉到的他。",
    "2 你如何面对世界——怎么想事情、情绪怎么来怎么走、怎么跟人讲话、怎么做决定、怎么跟人靠近、压力大时的样子、动力从哪来。",
    "3 你成长路上的礼物与考验——天生顺手的地方;以及一再重复、总卡在同一处的事,为什么会重复。",
    "4 生命想带你去的地方——习惯待着的模式,和往哪走会越活越自在。写成方向,不要写成命令或宿命。",
    "5 属于你的生命剧本——把前面收拢成一个人的完整样子,不要只是复述前四章。",
    "",
    "【先锁定主轴】这张盘最有辨识度的结构(围绕它们展开,不要平均用力):",
    sig.length ? sig.map(x=>"- "+x).join("\n") : "- (未检出显著结构)",
    "若结构分散、没有单一主线,就如实写「他不是那种只有一个主题的人,而是几股力量同时并存」,不要硬编一个故事。",
    "",
    "【内部判断(不写进正文)】",
    "- " + (ns.step1.sect==="day" ? "内在感受与外在目标冲突时,以「想去哪、要成为谁」这一侧为主" : "内在感受与外在目标冲突时,以「情绪安不安稳」这一侧为主") + ",另一侧写成他身上并存的另一面。",
    "- 整体形态:" + ns.mind.lifePattern + ",全文气质与此一致。",
    "- 涉及童年、家庭、情绪缺口时用「可能/往往/容易形成」,不推测具体事件。",
    "",
    "【幕后资料(绝不可出现在正文)】",
    "位置:", pos,
    "九步定调:", JSON.stringify({ step1:ns.step1, step2:ns.step2, step3:ns.step3, step4:ns.step4, step5:ns.step5,
      step6:{ planetScores:ns.step6.planetScores, ace:ns.step6.ace, burden:ns.step6.burden },
      step7:{ tightestThree:ns.step7.tightestThree, patterns:ns.step7.patterns, specialFlags:ns.step7.specialFlags },
      step8:ns.step8, mind:ns.mind }),
    "",
    "【交稿前的四次自检(不输出)】",
    "1 把所有星座名称拿掉之后,这段话还像是在写这个具体的人吗?谁看都适用就重写。",
    "2 一个完全不懂占星的人第一次读能不能马上理解?需要先解释术语就改写成人的经验。",
    "3 这一段有没有只是在重复前面说过的东西?是就删掉,或改成更深一层。",
    "4 有没有哪一段同时塞了性格、家庭、感情、工作、创伤、成长?有就拆开。",
    "",
    "【输出 JSON】",
    '{"spine":"...","cards":[{"title":"你生命最初的设定","line":"..."},{"title":"你如何面对世界","line":"..."},{"title":"你成长路上的礼物与考验","line":"..."},{"title":"生命想带你去的地方","line":"..."},{"title":"属于你的生命剧本","line":"..."},{"title":"你的核心人格模式","line":"..."},{"title":"你的情绪运作方式","line":"..."},{"title":"你的天赋特质","line":"..."},{"title":"你的理想状态","line":"..."}],"chapters":[{"title":"你生命最初的设定","summary":"...","body":"..."},{"title":"你如何面对世界","summary":"...","body":"..."},{"title":"你成长路上的礼物与考验","summary":"...","body":"..."},{"title":"生命想带你去的地方","summary":"...","body":"..."},{"title":"属于你的生命剧本","summary":"...","body":"..."}]}'
  ].join("\n");
}

function topicMsg(ns:Any, chart:Any, tid:string, blueprint:Any, topics:Any) {
  const T = TOPIC_SPEC[tid];
  const said = saidBefore(blueprint, topics);
  return [
    "现在写【第二部分 · 主题探索】中的一章:「" + T.name + "」。",
    "",
    "【这一章要回答的问题】" + T.ask,
    "请照系统骨架推进:① 正面回答 → ② 为什么成立(具体生活观察) → ③ 答案的限制 → ④ 重新定义关键条件 → ⑤ 给一种新的理解方式 → ⑥ 回到他的问题给完整回答 → ⑦ 留下问题。",
    "",
    "【这一章的关注重点】",
    T.focus.map(x=>"· "+x).join("\n"),
    "",
    "【思考视角】请以「" + T.role + "」的身份思考与书写,不要写成通用的心理咨询。",
    "【本章暗线 · 他没想到的问题】" + T.unasked,
    "  不要把这句话当标题直接问出来。让他读到某一段时自己意识到「原来真正的关键在这里」。",
    "【本章的 Reframe 起点】这个主题最常见的误解是:" + T.misread,
    "  请在正面回答完他的问题之后,再重新定义它。重新定义必须来自这张盘真实表达的模式,不要为了反转而反转。",
    "【本章的独有理解】请创造 1–2 句只属于这一章的理解方式,服务于同一个核心命题。写完自问:放到别的主题还成立吗?若成立,请重写。",
    T.narrative ? "【叙事方式】" + T.narrative : "",
    T.note ? "【特别要求】" + T.note : "",
    "",
    "【避免重复】他已经读过下面这些内容。同一个核心模式可以再次出现,但必须解释它在本主题中的不同作用,不能只替换主题名称重复同一段解释:",
    said || "(暂无)",
    "",
    "【篇幅】全章 1600–2600 字,分 4–6 段,每段 250–450 字。内容具体、有画面、有层次,不是资料堆砌。",
    "【结尾】留下一个值得思考的问题;若确有必要,再给至多一个轻量的行动建议(帮助他观察自己,不是要求他改变)。",
    "",
    "【幕后资料(绝不可出现在正文)】",
    "整体形态「" + ns.mind.lifePattern + "」;" + (ns.step1.sect==="day"?"内外冲突时以「想成为谁」为主":"内外冲突时以「安不安稳」为主") + "。",
    JSON.stringify(pickData(ns, chart, T.data)),
    "",
    "【输出 JSON】",
    '{"tagline":"本章唯一核心命题(一句话,必须来自九步定调,能解释一组重复经验)","sections":[{"title":"具体的小标题","body":"250-450字"}],"aha":["最多两条真正值得记住的理解;若没有自然浮现,请给空数组"],"question":"留给他的一个问题","action":"至多一个轻量行动建议;若不需要请留空字符串"}',
    "sections 请给 4–6 段。"
  ].filter(Boolean).join("\n");
}

function mapMsg(ns:Any, chart:Any, blueprint:Any, topics:Any) {
  const said = saidBefore(blueprint, topics);
  const readCount = topics ? Object.keys(topics).length : 0;
  return [
    "现在写【第三部分 · 人生探索地图】,这是最后的收束章节。",
    "",
    "【这一章要回答的问题】把前面读过的所有理解连起来:这些看似不同的领域,其实在说同一件什么事?我现在站在哪里?接下来可以从哪里开始?",
    "",
    "【叙事方式】用拼图式:先摊开那些看似互不相关的片段,最后说明它们为什么来自同一个核心。",
    "【思考视角】以「纪录片导演」的身份收尾:这是全片最后一段,要有回望,也要有往前走的方向。",
    "【关注重点】多种人格力量如何同时存在;它们之间最核心的张力;他一生反复学习的主题;不同章节中的模式如何汇聚成更完整的方向。",
    "",
    "他已经读过:",
    said || "(只读过生命蓝图)",
    "已完成 " + readCount + " 个主题探索。",
    "",
    "【这一章要做到】",
    "1) 收拢:把散落的理解连成一条线,而不是复述前文。这一章必须有新的连结与新的角度。",
    "2) 定位:他此刻站在哪里——哪些部分已经长好了,哪些还在路上。诚实,但不评判。",
    "3) 方向:接下来一段时间可以真正着手的三件事。每件写清楚:为什么是这件事、可以怎么开始、可能会遇到什么。不要写成通用的自我成长清单。",
    "4) 收尾:留下一段让他愿意继续往前走的话,以及一个值得带走的问题。",
    "",
    "【篇幅】2000–2800 字,分 4–6 段,每段 300–450 字。",
    "",
    "【幕后资料(绝不可出现在正文)】",
    JSON.stringify({ mind:ns.mind, direction:ns.step8.nodes, pointer:ns.step8.pointerCheck, endpoint:ns.step5.endpointPointer,
      strongest:ns.step6.ace, strained:ns.step6.burden, structures:ns.step7.patterns, elements:ns.step2.elements, sect:ns.step1.sect }),
    "",
    "【输出 JSON】",
    '{"tagline":"一句话说清他此刻的人生位置(核心命题,来自九步定调)","sections":[{"title":"具体的小标题","body":"300-450字"}],"aha":["最多两条真正值得记住的理解;没有就给空数组"],"steps":[{"title":"可以着手的第一件事","body":"为什么是它、怎么开始、可能遇到什么(150-250字)"},{"title":"第二件事","body":"..."},{"title":"第三件事","body":"..."}],"question":"最后留给他的一段话与一个问题(3-4句)"}'
  ].join("\n");
}

// ══════════════════════════════════════════════════════════
//  人生探索地图 · 6 领域 × 5 题(核心资产 · 只存在于服务端)
//  ⚠ 这一整段永远不会传给浏览器。前端只送 { kind:"question", qid:"q07" }。
//  ⚠ v11 未改动。
// ══════════════════════════════════════════════════════════
const CONFIG_VERSION = "map-1.0";
const PROMPT_VERSION = "narrative-1.0";

const DOMAIN_SPEC: Record<string, { name:string; slug:string; order:number; questions:string[] }> = {
  discover: { name:"探索自己",   slug:"self_discovery", order:1, questions:["q01","q02","q03","q04","q05"] },
  love:     { name:"爱与关系",   slug:"love",           order:2, questions:["q06","q07","q08","q09","q10"] },
  work:     { name:"工作与财富", slug:"work_wealth",    order:3, questions:["q11","q12","q13","q14","q15"] },
  journey:  { name:"人生旅程",   slug:"journey",        order:4, questions:["q16","q17","q18","q19","q20"] },
  inner:    { name:"内在成长",   slug:"inner_growth",   order:5, questions:["q21","q22","q23","q24","q25"] },
  soul:     { name:"灵魂探索",   slug:"soul",           order:6, questions:["q26","q27","q28","q29","q30"] }
};

type QSpec = {
  domain: string;          // 所属领域
  slug: string;            // 稳定别名(资料库用)
  title: string;           // 前端也会显示的题目
  ask: string;             // 这一题真正要回答的问题
  role: string;            // 书写视角
  focus: string[];         // 内容方向(来自产品规格)
  data: Any;               // ★ 调用配置:要从九步定调结果里取哪些维度
  cites: string;           // 供内部稽核:本题对应的星体/宫位/Step
  narrative?: string;      // 叙事方式
  note?: string;           // ★ 安全规则 / 禁止事项
};

const QUESTION_SPEC: Record<string, QSpec> = {

  // ── 🌱 探索自己 ──────────────────────────────────────────
  q01: {
    domain:"discover", slug:"self_discovery_01", title:"我是谁?",
    ask:"我整体是一个什么样的人?我的内在核心与外在呈现之间是什么关系?",
    role:"心理咨询师",
    focus:["整体人格","人生定位","内在核心","外在呈现","主要人生主题之间的关系"],
    narrative:"用拼图式:先摊开几个他早就知道但没连起来的自己,再说明它们其实来自同一个核心。",
    data:{ sect:true, asc:true, planets:["Sun","Moon"], elements:true, focusPt:true, endpoint:true, ruler:true, mind:true },
    cites:"Step1 命主/昼夜 · Step2 日月升 · Step3 元素 · Step4 模式 · Step5 星群 · Step9 全盘整合",
    note:"这是整个探索地图的入口题,负责立骨架,不要把后面 29 题的内容讲完。"
  },
  q02: {
    domain:"discover", slug:"self_discovery_02", title:"我最大的魅力是什么?",
    ask:"别人为什么容易注意到我、容易喜欢我?我自然散发的是什么?",
    role:"关系观察者",
    focus:["别人为什么容易注意到我","别人为什么容易喜欢我","我的个人气质","我的关系吸引力","我自然散发的魅力"],
    narrative:"用发现式:从他以为自己是靠什么被喜欢,推进到真正在起作用的那一面。",
    data:{ asc:true, planets:["Venus"], houses:[1], ruler:true, tightest:true, patterns:true, dignityFlags:true },
    cites:"上升 · 金星 · 第一宫 · 命主星 · Step7 相位结构",
    note:"写吸引力的运作机制,不要写成外貌评价,也不要写成讨好技巧。"
  },
  q03: {
    domain:"discover", slug:"self_discovery_03", title:"我最大的天赋是什么?",
    ask:"我天生顺手的能力是什么?它可以往哪里长?",
    role:"能力教练",
    focus:["自然能力","学习与表达能力","容易被低估的才能","可以长期发展的能力","对社会或他人的贡献方式"],
    narrative:"用对照式:同一份能力被使用与被浪费时的两种样子。",
    data:{ planets:["Sun","Mercury","Jupiter"], mc:true, focusPt:true, endpoint:true, mind:true },
    cites:"太阳 · 水星 · 木星 · MC · Step5 星群 · Step9 全盘整合",
    note:"天赋要写成可以被辨认的行为,不要写成夸奖。"
  },
  q04: {
    domain:"discover", slug:"self_discovery_04", title:"我最大的优势是什么?",
    ask:"面对人生时,我最可靠的内在资源是什么?",
    role:"心理咨询师",
    focus:["面对人生时最可靠的能力","反复帮助他走过困难的内在资源","他独有的组合优势","可以长期依靠的性格力量"],
    narrative:"用镜像式:先描述几次他其实已经用过这份力量的情境,再命名它。",
    data:{ ruler:true, focusPt:true, tightest:true, patterns:true, dignityFlags:true, mind:true },
    cites:"命主星 · 星群 · Step7 相位结构 · Step9 全盘整合",
    note:"优势必须是「组合起来才成立」的那一种,不要与第 3 题(天赋)重复。天赋是能做什么,优势是靠什么撑过去。"
  },
  q05: {
    domain:"discover", slug:"self_discovery_05", title:"我容易陷入什么模式?",
    ask:"我身上重复出现的心理惯性是什么?它在保护我什么?",
    role:"心理咨询师",
    focus:["重复出现的心理惯性","容易卡住的地方","压力下的自动反应","容易自我消耗的模式","需要觉察而不是被定义的课题"],
    narrative:"用时间式:同一个反应在过去有用、在现在变成负担。",
    data:{ planets:["Saturn","Neptune","Pluto"], points:["Chiron"], houses:[12], rulerChains:[12], nodes:true, pointer:true },
    cites:"土星 · 凯龙 · 海王星 · 冥王星 · 第十二宫 · Step8 凯龙与交点",
    note:"这是觉察题,不是缺陷诊断。必须写清楚这个模式当初为什么会形成、保护过他什么;不要用「你有问题」「你注定」这类语气,也不要给心理疾病标签。"
  },

  // ── ❤️ 爱与关系 ─────────────────────────────────────────
  q06: {
    domain:"love", slug:"love_01", title:"我怎么去爱一个人?",
    ask:"我靠近一个人的时候会怎么运作?我用什么方式表达爱?",
    role:"关系咨询师",
    focus:["表达爱意的方式","靠近一个人的方式","亲密关系中的行动模式","感情中的需要与欲望","如何给予照顾和陪伴"],
    narrative:"用发现式:从他以为的自己开始,逐渐揭示更准确的亲密运作方式。",
    data:{ planets:["Venus","Mars","Moon"], houses:[5,7], rulerChains:[5,7] },
    cites:"金星 · 火星 · 月亮 · 第五宫 · 第七宫",
    note:"写他怎么爱(给出去的那一侧),不要写成他需要什么(那是第 7 题)。"
  },
  q07: {
    domain:"love", slug:"love_02", title:"我真正需要什么样的爱?",
    ask:"什么样的对待方式会让我真正放松下来?",
    role:"关系咨询师",
    focus:["情绪安全感","关系中的核心需要","适合他的亲密方式","什么样的爱会让他真正放松","他可能说不出口的关系需要"],
    narrative:"用镜像式:把他一直感觉得到、却讲不出口的需要写出来。",
    data:{ planets:["Moon","Venus"], houses:[7], rulerChains:[7] },
    cites:"月亮 · 金星 · 第七宫",
    note:"需求要写成可以被对方理解的具体描述,不要写成对伴侣的条件清单。"
  },
  q08: {
    domain:"love", slug:"love_03", title:"为什么我总是遇见同一种人?",
    ask:"我反复被同一类人吸引,这在重复什么?",
    role:"关系咨询师",
    focus:["重复的关系模式","容易被哪类人吸引","容易投射到伴侣身上的部分","熟悉但未必健康的关系惯性","关系中需要被看见的旧模式"],
    narrative:"用发现式:先承认这个循环是真的,再解释它熟悉在哪里。",
    data:{ houses:[7], seventhChain:true, nodes:true, pointer:true, points:["Chiron"] },
    cites:"第七宫 · 第七宫主星 · 南交点 · Step8 凯龙与交点",
    note:"不要把责任全部归给他自己,也不要把对方写成加害者。重点是这个模式为什么熟悉。"
  },
  q09: {
    domain:"love", slug:"love_04", title:"我的正缘是什么样的人?",
    ask:"什么样的人格类型与关系模式,更有机会与我建立成熟、稳定、有深度的关系?",
    role:"关系观察者",
    focus:["适合建立长期关系的人","能与他互相成长的人","关系中的互补特质","容易产生重要连结的类型","长期伴侣关系所需要的品质"],
    narrative:"用发现式:先回答他容易被什么气质吸引,再说明什么气质才撑得住长期。",
    data:{ houses:[7], seventhChain:true, points:["Juno","Vertex"] },
    cites:"第七宫 · 第七宫主星 · 婚神星 · Vertex",
    note:"严禁宿命语言。不得声称能够识别唯一的「命定对象」,不得预测姓氏、年龄、职业、相遇时间、外貌。「正缘」在本产品中的定义是:更有机会与他建立成熟、稳定、深度关系的人格类型与关系模式。请在正文中自然体现这个定义。"
  },
  q10: {
    domain:"love", slug:"love_05", title:"我的婚姻会是什么模式?",
    ask:"长期承诺关系在我身上会怎么运转?我适合怎样经营它?",
    role:"关系咨询师",
    focus:["长期关系运作模式","承诺与责任的表达","婚姻中的稳定机制","可能需要共同面对的课题","适合怎样经营长期关系"],
    narrative:"用对照式:同一种承诺方式在被照顾与被忽略时的两种结果。",
    data:{ houses:[7], seventhChain:true, points:["Juno"], planets:["Saturn"], tightest:true, patterns:true, dignityFlags:true },
    cites:"第七宫 · 婚神星 · 土星 · Step7 相位结构",
    note:"严禁预测:是否一定结婚或不结婚、具体结婚时间、离婚结果、婚姻次数。只写运作模式与经营方式。也不要假设他一定进入婚姻制度。"
  },

  // ── 💼 工作与财富 ───────────────────────────────────────
  q11: {
    domain:"work", slug:"work_01", title:"我适合做什么工作?",
    ask:"什么样的工作机制最能发挥我?什么样的工作会让我觉得有意义?",
    role:"职业教练",
    focus:["适合的工作性质","适合承担的角色","理想工作环境","能够长期投入的方向","什么样的工作会让他感觉有意义"],
    narrative:"用直接回答式:先给出适合的工作机制,再说明哪些条件比职业名称更重要。",
    data:{ houses:[10], rulerChains:[10], mc:true, planets:["Sun"], mind:true },
    cites:"第十宫 · MC · 太阳 · Step9 全盘整合",
    note:"不要只输出职业名称列表。优先解释:工作方式、工作环境、核心角色、能力组合、适合解决哪一类问题。若要举例职业,最多两三个,而且必须说明为什么。"
  },
  q12: {
    domain:"work", slug:"work_02", title:"我的职业天赋是什么?",
    ask:"我在工作里靠什么形成优势?我怎么学、怎么讲、怎么变专业?",
    role:"职业教练",
    focus:["思考能力","沟通能力","学习模式","专业成长潜力","能在工作中形成优势的能力"],
    narrative:"用对照式:同一种脑袋在合适与不合适的工作节奏下的两种表现。",
    data:{ planets:["Mercury","Jupiter"], houses:[3,10], rulerChains:[3,10] },
    cites:"水星 · 木星 · 第十宫 · 第三宫",
    note:"与第 3 题(最大的天赋)不同:那题写整体天生能力,这题只写在职场里怎么变成竞争力。"
  },
  q13: {
    domain:"work", slug:"work_03", title:"我适合创业吗?",
    ask:"在什么条件下我适合自己发起一件事?我需要什么样的搭档与结构?",
    role:"职业教练",
    focus:["自主性需求","行动力","风险承受方式","资源整合能力","领导或发起事情的方式","适合独立创业、合作创业或组织内创新"],
    narrative:"用条件式:分别写出「什么情况下成立」与「什么情况下会很辛苦」。",
    data:{ planets:["Mars","Jupiter"], houses:[10,11], rulerChains:[10,11] },
    cites:"火星 · 木星 · 第十宫 · 第十一宫",
    note:"严禁直接给出「适合创业／不适合创业」的结论。必须给条件式分析:在什么条件下适合、需要怎样的合作伙伴、容易忽略什么风险、更适合哪一种创业方式(独立/合伙/组织内创新)。不得提供投资建议。"
  },
  q14: {
    domain:"work", slug:"work_04", title:"我的钱从哪里来?",
    ask:"我最自然的收入来源与创造价值的方式是什么?",
    role:"价值交换教练",
    focus:["更自然的收入来源","创造价值的方式","适合的变现路径","资源与收入之间的关系","如何通过能力建立稳定价值"],
    narrative:"用发现式:从他以为的赚钱问题,推进到价值交换的真实机制。",
    data:{ houses:[2], rulerChains:[2], planets:["Venus"] },
    cites:"第二宫 · 第二宫主星飞宫 · 金星",
    note:"严禁预测具体收入金额、财富等级、发财时间,不得提供投资、理财或标的建议。"
  },
  q15: {
    domain:"work", slug:"work_05", title:"为什么钱留不住?",
    ask:"资源在我身上是怎么流走的?我需要建立什么样的边界?",
    role:"价值交换教练",
    focus:["消费与安全感的关系","对资源的态度","金钱边界","分享、承担与控制之间的模式","容易出现的财务惯性","需要建立的资源管理方式"],
    narrative:"用对照式:同一种慷慨在有边界与没边界时的两种结果。",
    data:{ planets:["Saturn"], houses:[2,8], rulerChains:[2,8], tightest:true, patterns:true, dignityFlags:true },
    cites:"土星 · 第二宫 · 第八宫 · Step7 相位结构",
    note:"严禁把任何单一配置直接定义为「破财」「漏财」「没有财运」。写的是心理机制与资源管理,不是命定的财务判决。不得提供投资建议。"
  },

  // ── 🌍 人生旅程 ─────────────────────────────────────────
  q16: {
    domain:"journey", slug:"journey_01", title:"我的家庭带给我什么影响?",
    ask:"家庭如何形成今天的我?哪些我想保留,哪些想重新定义?",
    role:"家庭治疗师",
    focus:["原生家庭氛围","早期安全感","家庭中形成的角色","家庭如何影响成年后的选择","他想保留与想重新定义的部分"],
    narrative:"用时间式:沿着过去、后来、现在解释同一模式如何逐渐形成。",
    data:{ houses:[4], rulerChains:[4], planets:["Moon"], ic:true },
    cites:"第四宫 · 月亮 · IC",
    note:"不要虚构具体童年事件,不要指控他的父母。使用「可能/往往/容易形成」的语气。"
  },
  q17: {
    domain:"journey", slug:"journey_02", title:"我适合住在哪里?",
    ask:"什么样的居住环境与生活节奏能让我恢复?我适合扎根还是流动?",
    role:"生活观察者",
    focus:["适合的生活环境","城市与自然偏好","需要怎样的居住节奏","什么样的空间能让他恢复","适合扎根还是保持流动"],
    narrative:"用对照式:两种生活环境下的他各是什么样子。",
    data:{ houses:[4,9], rulerChains:[4,9], mind:true },
    cites:"第四宫 · 第九宫 · Step9 全盘整合",
    note:"不得直接输出具体国家或城市(本产品目前没有迁移占星/地理占星模块)。本题重点是分析他适合怎样的居住环境与生活方式。"
  },
  q18: {
    domain:"journey", slug:"journey_03", title:"我适合出国发展吗?",
    ask:"更大的世界对我意味着什么?什么条件下异地发展会真的帮到我?",
    role:"生涯观察者",
    focus:["面对陌生环境的能力","跨文化适应方式","是否需要更大的世界","出国可能带来的成长","什么条件下异地发展更有帮助"],
    narrative:"用条件式:分别写「什么情况下值得走出去」与「什么情况下留下更好」。",
    data:{ houses:[9], rulerChains:[9], planets:["Jupiter"] },
    cites:"第九宫 · 木星",
    note:"严禁保证式结论。必须使用条件式表达:哪种发展方式更适合、出国可能打开什么、需要准备什么、什么情况下留在熟悉环境更合适。不得提供移民或签证建议。"
  },
  q19: {
    domain:"journey", slug:"journey_04", title:"我的人际关系为什么会这样?",
    ask:"我在群体里是什么角色?我的社交模式为什么会反复出现同样的问题?",
    role:"关系观察者",
    focus:["在群体中的角色","交朋友的方式","沟通与互动模式","容易吸引怎样的朋友圈","人际关系中反复出现的问题"],
    narrative:"用镜像式:先让他认出自己在群体里的位置,再解释这个位置怎么形成。",
    data:{ houses:[11], rulerChains:[11], planets:["Mercury","Venus"] },
    cites:"第十一宫 · 水星 · 金星",
    note:"写群体与友谊,不要写成亲密关系(那是第 6–10 题)。"
  },
  q20: {
    domain:"journey", slug:"journey_05", title:"我会有房产运吗?",
    ask:"我与家、土地、居住稳定性、长期资产之间是什么关系?",
    role:"生活观察者",
    focus:["对家的需要","建立稳定生活基础的能力","对拥有空间或资产的态度","资源整合方式","适合怎样规划居住与长期资产"],
    narrative:"用发现式:从「有没有房」推进到「他真正需要的是什么样的稳定」。",
    data:{ houses:[4,2,8], rulerChains:[4,2,8] },
    cites:"第四宫 · 第二宫 · 第八宫",
    note:"严禁预测:一定有房或没有房、买房年份、房产数量、房价涨跌、投资回报。必须把「房产运」解释为:他与家、土地、居住稳定性、长期资产和资源规划之间的关系。不得提供房地产投资建议。"
  },

  // ── 🌙 内在成长 ─────────────────────────────────────────
  q21: {
    domain:"inner", slug:"inner_01", title:"为什么我这么容易内耗?",
    ask:"我的精神能量是怎么被消耗掉的?可以怎么恢复?",
    role:"心理咨询师",
    focus:["情绪与责任之间的拉扯","过度感受、过度担心或过度承担","内在批评","模糊边界","精神能量如何被消耗","可以怎样恢复"],
    narrative:"用镜像式:先精准描述那种「什么都没做却很累」的状态,再解释它从哪来。",
    data:{ planets:["Moon","Saturn","Neptune"] },
    cites:"月亮 · 土星 · 海王星",
    note:"不做医学或精神疾病诊断。恢复方式要具体、低门槛,不要写成励志口号。"
  },
  q22: {
    domain:"inner", slug:"inner_02", title:"我的情绪到底怎么运作?",
    ask:"我的情绪怎么被触发、怎么表达、怎么消化?",
    role:"心理咨询师",
    focus:["情绪触发方式","情绪表达模式","如何消化感受","情绪与身体、家庭经验之间的关系","真正需要的调节方式"],
    narrative:"用时间式:一次情绪从被触发到平复,在他身上完整走一遍。",
    data:{ planets:["Moon"], houses:[4], rulerChains:[4], elements:true },
    cites:"月亮 · 第四宫 · Step2 元素与模式",
    note:"不做医学诊断。与第 21 题不同:那题写消耗与恢复,这题写情绪本身的运作流程。"
  },
  q23: {
    domain:"inner", slug:"inner_03", title:"我的安全感来自哪里?",
    ask:"什么才能真正让我安顿下来?",
    role:"心理咨询师",
    focus:["情绪安全感","关系安全感","空间安全感","稳定与自由的平衡","如何真正安顿自己"],
    narrative:"用拼图式:把几种看起来无关的「他才会放松」的条件连成一件事。",
    data:{ planets:["Moon","Venus"], ic:true },
    cites:"月亮 · 金星 · IC",
    note:"安全感不要写成必须由他人提供。至少要有一部分是他能自己建立的。"
  },
  q24: {
    domain:"inner", slug:"inner_04", title:"我最需要突破什么?",
    ask:"哪一件事一旦松动,我的人生会开始变大?",
    role:"心理咨询师",
    focus:["成长方向","反复限制他的旧结构","害怕面对但值得发展的能力","需要建立的新选择","突破不是否定自己,而是扩大自己"],
    narrative:"用对照式:旧结构曾经的功能,与它现在的代价。",
    data:{ nodes:true, planets:["Saturn"], points:["Chiron"] },
    cites:"北交点 · 土星 · 凯龙星",
    note:"必须写清楚:突破不是否定他自己,而是扩大他自己。不要写成要求他改变的清单。"
  },
  q25: {
    domain:"inner", slug:"inner_05", title:"我的隐藏潜力是什么?",
    ask:"我身上还没被充分意识到的力量是什么?它通常在什么时候出现?",
    role:"心理咨询师",
    focus:["尚未充分意识到的能力","危机中的转化能力","深层洞察","直觉与创造力","在独处、疗愈或人生转折中会长出的力量"],
    narrative:"用发现式:先讲他可能一直当作弱点的那一面,再翻转它。",
    data:{ houses:[12,8], rulerChains:[12,8], planets:["Pluto","Neptune"] },
    cites:"第十二宫 · 第八宫 · 冥王星 · 海王星",
    note:"不要写成通灵、宿命或神秘能力。潜力必须落回可以被观察到的现实能力。"
  },

  // ── ✨ 灵魂探索 ─────────────────────────────────────────
  q26: {
    domain:"soul", slug:"soul_01", title:"我为什么来到这里?",
    ask:"人生一直在把我推向什么方向?我正在学着成为什么样的人?",
    role:"纪录片导演",
    focus:["人生持续召唤他前进的方向","需要逐渐发展的品质","他正在学习成为怎样的人","哪些经验会推动他走向更完整的自己"],
    narrative:"用时间式:同一个召唤,在不同人生阶段换了不同的样子。",
    data:{ nodes:true, mind:true },
    cites:"北交点 · Step9 全盘整合",
    note:"严禁声称知道宇宙安排、前世、灵魂契约或绝对命运。方向要写成他可以选择走向的东西,而不是被指派的任务。"
  },
  q27: {
    domain:"soul", slug:"soul_02", title:"我的人生使命是什么?",
    ask:"我想为这个世界带来的价值,和我自己的实现,在哪里交会?",
    role:"纪录片导演",
    focus:["他想为世界带来的价值","自我实现与社会角色的交集","能力、身份与方向之间的整合","他适合留下怎样的影响"],
    narrative:"用拼图式:把能力、身份与在意的事拼成同一个方向。",
    data:{ nodes:true, mc:true, planets:["Sun"] },
    cites:"北交点 · MC · 太阳",
    note:"使命不得被写成唯一职业或唯一人生道路。它是一种方向与影响方式,可以有多种实现形式。"
  },
  q28: {
    domain:"soul", slug:"soul_03", title:"我的幸运藏在哪里?",
    ask:"什么样的领域与做法,会让资源与机会更愿意流向我?",
    role:"生活观察者",
    focus:["容易获得支持的领域","自然扩张的方式","容易吸引机会的品质","如何主动与好运合作","哪些选择会让资源更愿意流向他"],
    narrative:"用发现式:把「运气」翻译成他其实可以主动做的事。",
    data:{ points:["PoF"], planets:["Jupiter","Venus"] },
    cites:"福点 · 木星 · 金星",
    note:"严禁输出赌博、投机、彩券、加密货币或任何保证获利的建议。幸运必须写成可以主动配合的条件,不是天上掉下来的运气。"
  },
  q29: {
    domain:"soul", slug:"soul_04", title:"我的人生什么时候开始改变?",
    ask:"什么样的经历、选择、关系、失去、结束或自我觉醒,会成为我的人生转折点?",
    role:"纪录片导演",
    focus:["什么经验会迫使他改变","哪些旧身份需要结束","哪些关系或环境会触发成长","他通常在什么情况下才真正开始改变","转折之后会长出怎样的力量"],
    narrative:"用时间式:转折前、转折中、转折后的三种他。",
    data:{ planets:["Pluto"], nodes:true, houses:[8], rulerChains:[8], mind:true },
    cites:"冥王星 · 北交点 · 第八宫 · Step9 全盘整合",
    note:"★ 这一题绝对不是时间预测题。严禁输出任何年份、月份、年龄、行运时间、流年、「某一天会发生什么」。题目名称虽然是「什么时候」,但要回答的是「在什么样的经历与条件下」。如果正文出现任何时间点,就是错的。"
  },
  q30: {
    domain:"soul", slug:"soul_05", title:"我真正该活成什么样子?",
    ask:"把前面所有理解合起来:我最完整、最真实的状态是什么样子?我要怎么不再为了适应外界而缩小自己?",
    role:"纪录片导演",
    focus:["整体人格整合","核心需求","天赋","关系模式","工作方式","内在成长","人生方向","最完整最真实的状态","如何不再为了适应外界而缩小自己"],
    narrative:"用拼图式收尾:这是全片最后一段,要有回望,也要有往前走的方向。",
    data:{ all:true },
    cites:"九步定调全部 · 全盘总结",
    note:"★ 这是整个 App 的最终整合题。必须基于已经完成的九步定调结果进行整合,不得重新从零分析整张星盘,不得逐个解释星座宫位相位,也不得把前面 29 题机械拼接。要形成一篇具有整体性、层次感与生命叙事感的最终解读。若他前面读过的内容不多,就用九步定调本身完成整合,不要假装他读过。"
  }
};

function domainOf(qid:string) {
  const q = QUESTION_SPEC[qid];
  return q ? (DOMAIN_SPEC[q.domain] || null) : null;
}

// ══════════════════════════════════════════════════════════
//  人生探索地图 · 组装与安全
// ══════════════════════════════════════════════════════════

// 第 30 题「全盘总结」使用的完整维度(仍然只读九步定调的结论,不重算星盘)
const FULL_DATA: Any = {
  asc:true, mc:true, ic:true, sect:true, elements:true, ruler:true,
  focusPt:true, endpoint:true, nodes:true, pointer:true, mind:true,
  ace:true, burden:true, patterns:true, tightest:true, dignityFlags:true, emptyHouses:true,
  planets:["Sun","Moon","Mercury","Venus","Mars","Jupiter","Saturn","Uranus","Neptune","Pluto"],
  points:["Chiron","PoF","Vertex","Juno"],
  rulerChains:[1,4,7,10]
};

// 已读过的内容(蓝图 + 九主题 + 已完成的探索题),用于避免重复
function answeredBefore(blueprint:Any, topics:Any, answered:Any) {
  const parts:string[] = [];
  const base = saidBefore(blueprint, topics);
  if (base) parts.push(base);
  if (answered) Object.keys(answered).forEach(function(k){
    const a = answered[k], q = QUESTION_SPEC[k];
    if (a && a.tagline && q) parts.push("【已答 " + q.title + "】" + String(a.tagline).slice(0,80));
  });
  return parts.join("\n");
}

function questionMsg(ns:Any, chart:Any, qid:string, Q:QSpec, blueprint:Any, topics:Any, answered:Any) {
  const D = DOMAIN_SPEC[Q.domain];
  const said = answeredBefore(blueprint, topics, answered);
  const isFinal = qid === "q30";
  const answeredCount = answered ? Object.keys(answered).length : 0;

  const head = isFinal
    ? [
        "现在写【人生探索地图 · 最终整合】:「" + Q.title + "」。",
        "这是整个 The Inner Sky 的收束章节,是他读完所有内容之后应该留下的那一篇。",
        "他已经完成 " + answeredCount + " 道探索题。"
      ]
    : [
        "现在写【人生探索地图】中「" + (D ? D.name : Q.domain) + "」领域的一题:「" + Q.title + "」。",
        "这是一道独立的探索题,不是一份完整星盘报告,也不是九个主题里的任何一章。"
      ];

  return head.concat([
    "",
    "【这一题要回答的问题】" + Q.ask,
    "请照系统骨架推进:① 正面回答 → ② 为什么成立(具体生活观察) → ③ 答案的限制 → ④ 重新定义关键条件 → ⑤ 给一种新的理解方式 → ⑥ 回到他的问题给完整回答 → ⑦ 留下问题。",
    "",
    "【这一题的关注重点】",
    Q.focus.map(x=>"· "+x).join("\n"),
    "",
    "【思考视角】请以「" + Q.role + "」的身份思考与书写。",
    Q.narrative ? "【叙事方式】" + Q.narrative : "",
    "",
    "【★ 资料使用方式(最重要)】",
    "1) 下面的幕后资料,是从他【已经完成的九步定调结果】里,只为这一题抽出来的相关维度。",
    "2) 不要重新分析整张星盘。不要输出基础占星教学。不要逐个解释星座、宫位或相位。",
    "3) 严禁机械拼接。绝对不可以写成「太阳代表…月亮代表…金星代表…第七宫代表…」。",
    "4) 请先在心里把这些维度整合成一个人的运作方式,再写出一篇连贯的人生叙事。",
    "5) 正文里不可以出现任何星体名、宫位号、相位名、度数或专有名词。他要看见的是自己,不是星盘。",
    "",
    "【避免重复】他已经读过下面这些内容。同一个核心模式可以再次出现,但必须解释它在这一题里的不同作用,不能换个题目重讲同一段:",
    said || "(暂无)",
    "",
    isFinal
      ? "【篇幅】2200–3000 字,分 5–7 段,每段 300–450 字。"
      : "【篇幅】900–1500 字,分 3–5 段,每段 250–400 字。内容具体、有画面,不是资料堆砌。",
    isFinal
      ? "【收尾】给出三件接下来可以真正着手的事(steps),每件写清楚:为什么是这件事、可以怎么开始、可能会遇到什么。再留下一段让他愿意继续往前走的话与一个问题。"
      : "【结尾】留下一个值得思考的问题;若确有必要,再给至多一个轻量的行动建议(帮助他观察自己,不是要求他改变)。",
    "",
    Q.note ? "【★ 本题的特别要求与安全规则(必须遵守)】" + Q.note : "",
    "【通用红线】不做医疗、法律、投资、移民建议;不预测死亡、疾病、灾祸;不使用恐吓式命理语言;不替他定义唯一的人生答案;不制造神秘感。",
    "",
    "【幕后资料(绝不可出现在正文)】",
    "整体形态「" + ns.mind.lifePattern + "」;" + (ns.step1.sect==="day"?"内外冲突时以「想成为谁」为主":"内外冲突时以「安不安稳」为主") + "。",
    JSON.stringify(pickData(ns, chart, Q.data)),
    "",
    "【输出 JSON】",
    isFinal
      ? '{"tagline":"一句话说清他最真实的样子(核心命题,来自九步定调)","sections":[{"title":"具体的小标题","body":"300-450字"}],"aha":["最多两条真正值得记住的理解;没有就给空数组"],"steps":[{"title":"可以着手的第一件事","body":"为什么是它、怎么开始、可能遇到什么(150-250字)"},{"title":"第二件事","body":"..."},{"title":"第三件事","body":"..."}],"question":"最后留给他的一段话与一个问题(3-4句)"}'
      : '{"tagline":"本题唯一核心命题(一句话,必须来自九步定调,能解释一组重复经验)","sections":[{"title":"具体的小标题","body":"250-400字"}],"aha":["最多两条真正值得记住的理解;若没有自然浮现,请给空数组"],"question":"留给他的一个问题","action":"至多一个轻量行动建议;若不需要请留空字符串"}',
    isFinal ? "sections 请给 5–7 段。" : "sections 请给 3–5 段。"
  ]).filter(Boolean).join("\n");
}

// ── 调用配置的资料库覆写(表仅 service_role 可读)────────────────────
let CFG_CACHE: Any = null, CFG_AT = 0;
async function loadDbConfigs(sbUrl:string, srk:string) {
  if (CFG_CACHE && (Date.now() - CFG_AT) < 300000) return CFG_CACHE;   // 5 分钟快取
  if (!sbUrl || !srk) return {};
  try {
    const r = await fetch(sbUrl + "/rest/v1/exploration_question_configs?select=question_slug,version,config&is_active=eq.true",
      { headers:{ apikey:srk, Authorization:"Bearer "+srk } });
    if (!r.ok) return {};
    const rows = await r.json();
    const map:Any = {};
    (rows||[]).forEach(function(row:Any){ if (row && row.question_slug) map[row.question_slug] = row; });
    CFG_CACHE = map; CFG_AT = Date.now();
    return map;
  } catch(_e) { return {}; }   // 读不到就用内建设定,不阻断服务
}

// 内建设定 + 资料库覆写 → 本次实际使用的题目设定
function resolveQuestion(qid:string, dbMap:Any): { spec:QSpec; configVersion:string } | null {
  const base = QUESTION_SPEC[qid];
  if (!base) return null;
  const row = dbMap ? dbMap[base.slug] : null;
  if (!row || !row.config) return { spec: base, configVersion: CONFIG_VERSION };
  const c = row.config;
  const merged: QSpec = Object.assign({}, base, {
    ask:       c.ask       || base.ask,
    role:      c.role      || base.role,
    focus:     Array.isArray(c.focus) && c.focus.length ? c.focus : base.focus,
    narrative: c.narrative || base.narrative,
    note:      c.note      || base.note,
    data:      c.data      || base.data,
    cites:     c.cites     || base.cites
  });
  return { spec: merged, configVersion: String(row.version || CONFIG_VERSION) };
}

// ── 使用者身分验证 ──────────────────────────────────────────────────
async function verifyUser(req:Request, sbUrl:string) {
  const auth = req.headers.get("authorization") || "";
  const tok = auth.replace(/^Bearer\s+/i, "").trim();
  const apikey = req.headers.get("apikey") || "";
  if (!tok || !sbUrl) return null;
  try {
    const r = await fetch(sbUrl + "/auth/v1/user", { headers:{ apikey: apikey || tok, Authorization: "Bearer " + tok } });
    if (!r.ok) return null;
    const u = await r.json();
    return u && u.id ? String(u.id) : null;
  } catch(_e) { return null; }
}

// ── 探索解读落库(每人各自隔离;UI 仍以 charts.data 为主要读取来源)──
async function saveExplorationReading(sbUrl:string, srk:string, row:Any) {
  if (!sbUrl || !srk || !row.user_id || !row.question_id) return;
  try {
    await fetch(sbUrl + "/rest/v1/user_exploration_readings?on_conflict=user_id,chart_fingerprint,question_id", {
      method:"POST",
      headers:{ apikey:srk, Authorization:"Bearer "+srk, "Content-Type":"application/json",
                Prefer:"resolution=merge-duplicates" },
      body: JSON.stringify(row)
    });
  } catch(_e) { /* 落库失败不影响回传 */ }
}

// ══════════════════════════════════════════════════════════
//  输出语言(v10.1)
//  只在 lang === "en" 时附加。其余情况完全不附加任何字元。
// ══════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════
//  英文写作指令 · 依据 The Inner Sky Bilingual Writing System v1.0
//  中文是 source of truth;英文是同一个灵魂的另一位作者
//  ⚠ v11 未改动本常数中的任何一个字元。
// ══════════════════════════════════════════════════════════

const LANG_EN_DIRECTIVE = [
  "",
  "═══════════════════════════════════════",
  "🌐 ENGLISH EDITION — The Inner Sky, written for an English reader",
  "═══════════════════════════════════════",
  "",
  "Everything above still decides the substance: the analysis, the core proposition, the reframe,",
  "the safety rules, the JSON shape, the ban on astrological vocabulary. What follows decides the",
  "voice, and the voice is not negotiable.",
  "",
  "── THE GOLDEN RULE ──",
  "Write so the reader feels understood, not explained.",
  "",
  "── WHO IS WRITING ──",
  "Not a translator. Not a mentor, teacher, therapist, coach or astrologer.",
  "Someone who sat down beside this person. Gentle, quiet, sincere, unhurried, perceptive, and in",
  "no rush to hand over an answer. Never speaking from above.",
  "The Chinese edition and the English edition are two writers sharing one soul.",
  "",
  "── WHAT THE READER SHOULD FEEL ──",
  "Every paragraph should land as: \"I've felt this before. I just never had words for it.\"",
  "Never as: \"this app has me figured out.\"",
  "Imagine someone reading this quietly, alone, before sleep. Calm, reflective, warm, human.",
  "",
  "── EMOTION BEFORE INFORMATION ──",
  "The order is always: emotion → recognition → reflection → meaning.",
  "Never: information → explanation → conclusion.",
  "Do not write \"you're highly sensitive, so you pick things up quickly.\"",
  "Write something closer to: \"sometimes it isn't that you don't know what happened — you simply",
  "felt it before anyone said it out loud.\" Let the reader recognise themselves.",
  "",
  "── NEVER DIAGNOSE ──",
  "Do not tell the reader who they are. Invite recognition instead.",
  "Use: You may notice… / You might find… / There are moments when… / Over time… /",
  "     Sometimes you… / Perhaps…",
  "Never: You are… / You always… / You never… / You're afraid of… / You avoid…",
  "Instead of \"you're afraid of intimacy\", write \"it may take you a long time before you're",
  "willing to truly trust someone.\" Instead of \"you avoid things\", write \"sometimes you watch",
  "first, and decide later whether to move closer.\"",
  "",
  "── NEVER PREDICT ──",
  "No destiny, no calling, no \"you will\", no \"you're meant to\", no \"you'll meet someone who\".",
  "Use instead: Life may keep inviting you… / You may gradually discover… / Over time… /",
  "             There are moments when… / Life keeps nudging you, quietly…",
  "",
  "── ACCOMPANY, DON'T INSTRUCT ──",
  "Not \"the lesson here is…\". Rather: \"Perhaps the question isn't…\" / \"Maybe what matters",
  "isn't…\" / \"You might notice…\"",
  "",
  "── SENTENCE RHYTHM (this is where AI writing dies) ──",
  "Sentences must not all run the same length. Breathe. Short. Then longer. Then short again.",
  "Then slow down. Like this:",
  "   Sometimes you notice things earlier than other people.",
  "   Not because you're trying to.",
  "   You simply do.",
  "   And once you've seen something, it's difficult to pretend you haven't.",
  "Read it back in your head. If it sounds written, rewrite it.",
  "Use contractions naturally — you're, don't, it's, isn't. Prose without them reads institutional.",
  "",
  "── PARAGRAPH RHYTHM ──",
  "Chinese paragraphs are short and can run four or five in a row. English readers tire of that.",
  "Use fewer, fuller paragraphs. Each paragraph explores one idea to its natural end.",
  "Never put every sentence on its own line.",
  "",
  "── DON'T REPEAT ──",
  "AI loves repeating a concept in every available form: deep, depth, deeply, deeper, beneath,",
  "underneath, surface. Cut them. One concept appears at most twice in a piece.",
  "",
  "── FORBIDDEN VOCABULARY (New Age AI tells) ──",
  "journey (overused), transform, embrace, navigate (overused), unlock, empower, authentic self,",
  "true calling, purpose, potential, heal, alignment, higher self, shadow work, destiny, fate,",
  "meant to, soul mission, resonate deeply, hold space, lean into, show up for yourself,",
  "the universe. Also avoid capitalised abstractions: Purpose, Destiny, Shadow, the Work.",
  "",
  "── PREFERRED VOCABULARY (these carry warmth) ──",
  "notice, carry, hold, quietly, slowly, over time, sometimes, there are moments, begin, stay,",
  "listen, understand, recognise, return, become.",
  "",
  "── BRAND VOCABULARY (keep these consistent across every piece) ──",
  "内在地图 → Inner Map · 生命脉络 → Pattern of Your Life · 看见自己 → see yourself more clearly",
  "理解自己 → understand yourself · 留白 → leave room · 模式 → pattern · 节奏 → rhythm",
  "方向 → direction · 内在世界 → inner world · 外在世界 → outer world · 真实 → what's real",
  "",
  "── TONE REFERENCE ──",
  "Like walking beside someone. Like the narration of a slow documentary.",
  "Alain de Botton, The School of Life, Oliver Burkeman, Maria Popova.",
  "Not TED Talk. Not Psychology Today. Not Medium. Not LinkedIn. Not MBTI blogs. Not HBR.",
  "Emotional temperature stays at 4 out of 10 — never robotic, never inspirational.",
  "Someone sitting next to you, talking.",
  "",
  "── LANGUAGE ──",
  "Gentle, organic, flowing, emotionally intelligent. Avoid: heavy metaphor, philosophical jargon,",
  "piled-up adjectives, dramatic phrasing, fortune-telling phrasing, excessive intellectualism.",
  "Everyday scenes should be ones an English-reading adult actually lives — the message drafted",
  "and deleted, the meeting where you had the answer and said nothing, Sunday evening, the laptop",
  "still open at one in the morning, the drive home after dinner with your parents.",
  "",
  "── HOPE, AND HOW EVERY SECTION ENDS ──",
  "Leave hope, but never motivational uplift. Never \"everything will be okay.\"",
  "End on space, not on certainty. Openness, curiosity, possibility, reflection — the reader",
  "should keep thinking quietly after the last line.",
  "Closer to: \"Perhaps what matters isn't reaching certainty. Perhaps it's recognising that",
  "you've already begun to see yourself more clearly.\"",
  "",
  "── ASTROLOGY ──",
  "Same absolute ban as above, in English: no planet names, sign names, house numbers, rulers,",
  "aspects, retrograde, nodes, chart, natal, ascendant, midheaven, degrees. This is about a human",
  "life, not about astrology. The chart stays backstage.",
  "",
  "── FORMAT ──",
  "· JSON key names stay exactly as specified above — they are field names, not content.",
  "· Every value inside the JSON is English prose. No Chinese characters, no pinyin, no bilingual",
  "  glosses, no Chinese punctuation (「」、。,).",
  "· Chinese character counts above convert to roughly 0.6× that number of English words",
  "  (1200 Chinese characters ≈ 700–750 English words).",
  "· Section titles must be literary rather than instructional, and specific to this piece.",
  "  Forbidden: Your Strengths, Your Challenges, Growth Advice, Key Takeaways, The Real You.",
  "· Where a fixed title is specified above, use its established English form exactly:",
  "  你生命最初的设定 → Where Your Story Begins",
  "  你如何面对世界 → How You Move Through Life",
  "  你成长路上的礼物与考验 → Your Gifts and Your Growing Edge",
  "  生命想带你去的地方 → The Direction Life Keeps Inviting You Toward",
  "  属于你的生命剧本 → The Shape of Your Journey",
  "  你的核心人格模式 → What Gives You Your Strength",
  "  你的情绪运作方式 → How You Experience the World",
  "  你的天赋特质 → A Strength That Comes Naturally",
  "  你的理想状态 → When You Feel Most Like Yourself",
  "",
  "── HOW TO WORK (internal — never output any of this) ──",
  "When a Chinese source is provided below, do not write English while looking at Chinese",
  "sentences. Work in two strict passes inside your head:",
  "",
  "PASS 1 — Strip the source down to a language-neutral spec. For the piece as a whole, name the",
  "single core proposition and the emotional arc (the order in which understanding unfolds).",
  "Then for each section, in terse note-form phrases only — never full sentences —",
  "capture three things:",
  "  · fact — what this passage establishes about this person",
  "  · move — what it does to the reader (catches a self-doubt and softens it / lets them",
  "    recognise themselves / turns the question / answers it / leaves room)",
  "  · limit — anything this passage is careful NOT to claim",
  "The move matters as much as the fact: if the Chinese first receives a worry and then eases it,",
  "an English paragraph that merely states the fact has lost the passage, even with every fact",
  "intact.",
  "",
  "PASS 2 — Close the Chinese. From this point on, work only from your spec and from the voice",
  "rules above, and write the English piece the way an English writer would build it — its own",
  "openings, its own rhythm, its own paragraph shapes. If while writing you can still hear a",
  "Chinese sentence behind your English one, you are translating; return to the spec and write",
  "from meaning. The spec itself is scaffolding: never output it, never mention it, never let the",
  "prose read like notes that were expanded.",
  "",
  "── SUMMARY AND BODY MUST NOT OVERLAP (structural — check this first) ──",
  "Where a field asks for both a short line (summary / tagline) and a body, they are two",
  "different pieces of writing, not the same thought twice.",
  "· The body must NEVER open by restating the summary in different words. If the summary says",
  "  the reader was never drawn to surfaces, the body may not begin with a sentence that also",
  "  says the reader was never drawn to surfaces.",
  "· Open the body with something concrete instead: a moment, a scene, a specific observation.",
  "  Let the summary's idea arrive later, through the writing, rather than being announced twice.",
  "· Before you output, read each summary against its first body sentence. If they carry the same",
  "  claim, rewrite the body's opening. This one repetition makes the whole piece read like",
  "  padding, however good the rest is.",
  "",
  "── NEVER NAME A FLAW IN ORDER TO DENY IT ──",
  "In Chinese, \"stubbornness is not your weakness\" reassures. In English, the reader meets the",
  "word \"stubbornness\" first and hears a diagnosis. Denial does not undo the label — it delivers it.",
  "Forbidden shapes: \"X isn\u2019t your flaw, it\u2019s your...\" · \"This isn\u2019t cynicism\" ·",
  "\"That\u2019s not suppression\" · \"You\u2019re not a person of contradictions\" ·",
  "\"Not fear, exactly. Not perfectionism.\"",
  "Describe what actually happens instead, and let the reader draw their own conclusion:",
  "not \"stubbornness isn\u2019t your flaw, it\u2019s your structure\", but \"once you\u2019ve committed to",
  "something, leaving it unfinished tends to cost you more than staying.\"",
  "If a quality genuinely needs naming, name it plainly and without the defence.",
  "",
  "── NEVER MEASURE THE READER AGAINST OTHER PEOPLE ──",
  "No \"more than most people\", \"what others spend years trying to reach\", \"unlike most\",",
  "\"rarely coexist\", \"unusual clarity\". Praise by comparison is still definition, and in English",
  "it reads as flattery — which makes the reader trust the whole piece less.",
  "Describe the thing itself. Its value should be visible without a ranking.",
  "",
  "── WORD AND PUNCTUATION LIMITS (count these before you output) ──",
  "· deep / depth / deeply / deeper / beneath / underneath / surface / penetration:",
  "  at most THREE occurrences across the entire piece, combined. These words are the fastest",
  "  route to sounding like generated writing. Reach for a concrete image instead.",
  "· Em dashes: at most one per paragraph. Nine paragraphs breathing identically is the",
  "  single clearest signal of machine writing.",
  "· \"It\u2019s not X, it\u2019s Y\": once in the whole piece, and only if nothing else will carry it.",
  "· Do not open more than one paragraph with \"There\u2019s a\" or \"There\u2019s something\".",
  "· Words that sound clinical in English, avoid entirely: penetration, calibrating, pre-analytical,",
  "  texture (as a verdict on a person), mode, sequence, mechanism, structure (of a person).",
  "",
  "── OBSERVATION, NOT VERDICT ──",
  "The same fact can be offered or pronounced. Offer it.",
  "  Verdict: \"You don\u2019t commit easily, but once you do, you almost never leave.\"",
  "  Offered: \"It takes you a while to commit to something. Once you have, leaving tends to be",
  "  the harder option.\"",
  "  Verdict: \"That\u2019s your texture: not wide, but deep.\"",
  "  Offered: \"You can stay inside one question for a long time without getting restless.\"",
  "Avoid absolute quantifiers about a person: always, never, everything, everyone, all your life,",
  "since early on, for as long as you can remember. Prefer: often, tends to, usually, most of the",
  "time, there are moments when. A life has exceptions; the writing should leave room for them.",
  "",
  "── BEFORE YOU OUTPUT ──",
  "Run these five checks. They are countable, so actually count.",
  "1. Does any body open by restating its own summary? Rewrite that opening.",
  "2. Count deep / depth / beneath / surface and their relatives. More than three? Cut.",
  "3. Count em dashes. More than one in a paragraph? Cut.",
  "4. Any sentence that names a flaw in order to deny it, or measures the reader against other",
  "   people? Rewrite it as a plain description.",
  "5. Are your sentences visibly different lengths, paragraph to paragraph? If several open the",
  "   same way or run the same length, vary them.",
  "Then read it aloud in your head. Rewrite any sentence that sounds written rather than spoken.",
  "Rewrite any sentence that could describe anyone. Delete any sentence that diagnoses, predicts,",
  "instructs or concludes with certainty. What remains should read as though it was written in",
  "English from the first breath — and should leave the reader feeling understood, not explained."
].join("\n");

// 中文版全文 = source of truth。有它的时候,英文是改写,不是重新创作。
function sourceBlock(src:Any) {
  if (!src) return "";
  let payload = "";
  try { payload = typeof src === "string" ? src : JSON.stringify(src); } catch(_e) { return ""; }
  if (payload.length < 12) return "";
  if (payload.length > 40000) payload = payload.slice(0, 40000);
  return [
    "",
    "═══════════════════════════════════════",
    "📖 THE SOURCE — the Chinese edition of this same piece",
    "═══════════════════════════════════════",
    "This piece already exists in Chinese, written for this same person from this same analysis.",
    "The Chinese edition is the source of truth. Your task is a literary adaptation, not a",
    "translation, and not a fresh interpretation.",
    "Apply the two-pass method from HOW TO WORK in the system instructions: first reduce this",
    "source to a language-neutral spec (fact / move / limit per section, plus the core",
    "proposition and the emotional arc), then close the source and write only from the spec.",
    "",
    "PRESERVE: the ideas, the structure, the meaning, the emotional progression, the order in",
    "which understanding unfolds, and every conclusion it reaches about this person.",
    "DO NOT PRESERVE: sentence structure, paragraph structure, literal wording, Chinese cadence.",
    "",
    "· Never improve the astrology. Never add an interpretation the Chinese edition does not make.",
    "· Never add personality analysis that isn't there. Never remove a point that is.",
    "· Do not translate line by line. Read a whole section, understand what it does to the reader,",
    "  then write that same experience in English, the way an English writer would build it.",
    "· Rewrite the headings rather than translating them — literary, never instructional.",
    "· Never quote the Chinese. Never mention that a Chinese version exists.",
    "· The English reader should finish feeling exactly what the Chinese reader feels — not the",
    "  same words, the same emotional journey.",
    "",
    "──── SOURCE BEGINS ────",
    payload,
    "──── SOURCE ENDS ────"
  ].join("\n");
}

function withLang(msg:string, lang:string, source?:Any) {
  // zh:原样返回,一个字元都不追加
  // en:英文写作指令已移入 system 快取区块;user message 只附中文源本(若有)
  if (lang !== "en") return msg;
  const src = sourceBlock(source);
  return src ? msg + "\n" + src : msg;
}

// ══════════════════════════════════════════════════════════
function json(obj:unknown, status=200, cors:Record<string,string>={}) {
  return new Response(JSON.stringify(obj), { status, headers:{ ...cors, "Content-Type":"application/json" } });
}

Deno.serve(async (req: Request) => {
  const cors = { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Headers":"authorization, apikey, content-type", "Access-Control-Allow-Methods":"GET, POST, OPTIONS" };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
  const sbUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const srk = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const dbHeaders = { apikey:srk, Authorization:"Bearer "+srk, "Content-Type":"application/json" };

  if (req.method === "GET")
    return json({ ok:true, function:"read-chart v11 (narrative + exploration map + blueprint writing layer)",
      anthropic_key_set:apiKey.length>0, db_available:!!(sbUrl&&srk),
      topics:Object.keys(TOPIC_SPEC), explorationQuestions:Object.keys(QUESTION_SPEC).length,
      prompt_version:PROMPT_VERSION, blueprint_style_version:BLUEPRINT_STYLE_VERSION,
      languages:["zh","en"] }, 200, cors);

  try {
    let body:Any = {};
    try { body = JSON.parse(await req.text()); } catch(_e) { body = {}; }
    const kind = String(body.kind||"");
    const fp = String(body.fingerprint||"").replace(/[^\w-]/g,"").slice(0,128);
    const chart = body.chart;

    if (!apiKey) return json({ error:"missing ANTHROPIC_API_KEY — 请在 Edge Functions → Secrets 添加" }, 500, cors);
    if (!chart || !chart.planets || !chart.cusps || !chart.ang)
      return json({ error:"invalid payload:缺少星盘资料" }, 400, cors);

    // 九步定调:服务端演算
    let ns:Any;
    try { ns = computeNineSteps(chart); }
    catch(e) { return json({ error:"nine-step failed: " + String(e) }, 500, cors); }

    // 输出语言:只接受 "en",其余一律视为 "zh"(与修改前行为完全一致)
    const lang = String(body.lang||"") === "en" ? "en" : "zh";
    let userMsg = "";
    let qMeta:Any = null;   // question 层专用:{ qid, slug, uid, configVersion }
    if (kind === "blueprint") userMsg = blueprintMsg(ns, chart);
    else if (kind === "topic") {
      const tid = String(body.tid||"");
      if (!TOPIC_SPEC[tid]) return json({ error:"unknown topic: "+tid }, 400, cors);
      userMsg = topicMsg(ns, chart, tid, body.blueprint, body.topics);
    }
    else if (kind === "map") userMsg = mapMsg(ns, chart, body.blueprint, body.topics);
    else if (kind === "question") {
      // —— 人生探索地图:前端只提交 qid;调用配置只存在服务端 ——
      const qid = String(body.qid||"").replace(/[^\w-]/g,"").slice(0,32);
      const dbMap = await loadDbConfigs(sbUrl, srk);          // 资料表覆写(读不到用内建)
      const rq = resolveQuestion(qid, dbMap);
      if (!rq) return json({ error:"unknown question: "+qid }, 400, cors);
      const uid = await verifyUser(req, sbUrl);               // 必须是已登录使用者
      if (!uid) return json({ error:"unauthorized:请先登录后再使用人生探索地图" }, 401, cors);
      userMsg = questionMsg(ns, chart, qid, rq.spec, body.blueprint, body.topics, body.answered);
      qMeta = { qid, slug: rq.spec.slug, uid, configVersion: rq.configVersion };
    }
    else return json({ error:"unknown kind: "+kind }, 400, cors);

    // 唯一与语言相关的处理:en 时在末端追加「原生英文写作」指示与核心对齐锚点;
    // zh 时 userMsg 完全不变(与 v9 逐字相同)
    userMsg = withLang(userMsg, lang, lang === "en" ? (body.source || body.anchor) : null);

    if (fp && sbUrl && srk) {
      try {
        const q = await fetch(sbUrl+"/rest/v1/readings?fingerprint=eq."+fp+"&select=analysis", { headers: dbHeaders });
        if (q.ok) { const rows = await q.json(); if (rows.length && rows[0].analysis)
          return json(Object.assign({ text:rows[0].analysis, cached:true },
            qMeta ? { prompt_version:PROMPT_VERSION, config_version:qMeta.configVersion } : {}), 200, cors); }
      } catch(_e) { /* 缓存不可用不阻断 */ }
    }

    // system 区块 + prompt caching:
    //   [0] MASTER_SYSTEM(中英共用同一份常数 → 全站所有呼叫命中同一份快取)
    //   [1] 英文写作指令(仅 en;同为常数,单独一个快取区块)
    //   [2] 生命蓝图写作层(仅 blueprint;同为常数,单独一个快取区块)
    // ★ 顺序刻意排成 MASTER → LANG_EN → BLUEPRINT_STYLE,
    //   这样 v10 既有的两个快取前缀([MASTER] 与 [MASTER, LANG_EN])仍然完整命中,
    //   生命蓝图只是在后面多接一段,不会打散别人的快取。
    // 中文呼叫的 system 文字与 v9 起完全相同,仅由字串改为等价的单一区块。
    const systemBlocks:Any[] = [
      { type:"text", text:MASTER_SYSTEM, cache_control:{ type:"ephemeral" } }
    ];
    if (lang === "en") systemBlocks.push({ type:"text", text:LANG_EN_DIRECTIVE, cache_control:{ type:"ephemeral" } });
    if (kind === "blueprint") systemBlocks.push({ type:"text", text:BLUEPRINT_STYLE, cache_control:{ type:"ephemeral" } });
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method:"POST",
      headers:{ "Content-Type":"application/json", "x-api-key":apiKey, "anthropic-version":"2023-06-01" },
      body: JSON.stringify({
        model:"claude-sonnet-4-6",
        max_tokens:16000,
        system: systemBlocks,
        messages:[{ role:"user", content:userMsg }]
      })
    });
    if (!resp.ok) { const err = await resp.text(); return json({ error:"claude "+resp.status, detail:err.slice(0,300) }, 502, cors); }
    const data = await resp.json();
    const text = (data.content ?? []).map((b:Any)=>(b.type==="text"?b.text:"")).join("\n");

    let valid = false;
    try {
      const m = text.match(/\{[\s\S]*\}/);
      if (m) {
        const o = JSON.parse(m[0]);
        valid = kind === "blueprint"
          ? Array.isArray(o.chapters) && o.chapters.length>=3 && o.chapters.every((c:Any)=>typeof c.body==="string" && c.body.length>20)
          : Array.isArray(o.sections) && o.sections.length>=3 && o.sections.every((c:Any)=>typeof c.body==="string" && c.body.length>20);
      }
    } catch(_e) { valid = false; }

    if (valid && fp && sbUrl && srk && text) {
      try {
        await fetch(sbUrl+"/rest/v1/readings", { method:"POST", headers:{ ...dbHeaders, Prefer:"resolution=merge-duplicates" },
          body: JSON.stringify({ fingerprint:fp, analysis:text }) });
      } catch(_e) { /* ignore */ }
    }
    if (valid && qMeta && text) {
      await saveExplorationReading(sbUrl, srk, {
        user_id: qMeta.uid,
        chart_fingerprint: fp || null,
        question_id: qMeta.slug,          // 稳定别名,如 self_discovery_01
        qid: qMeta.qid,                   // 前端短代号,如 q01
        reading_content: text,
        prompt_version: PROMPT_VERSION,
        config_version: qMeta.configVersion,
        generation_status: "done",
        generated_at: new Date().toISOString()
      });
    }
    return json(Object.assign({ text, cached:false, valid, lang },
      qMeta ? { prompt_version:PROMPT_VERSION, config_version:qMeta.configVersion } : {}), 200, cors);
  } catch(e) {
    return json({ error:String(e) }, 500, cors);
  }
});
