// ============================================================
// INNER SKY · Edge Function  compass-generate  (compass-v1)
// ------------------------------------------------------------
// 「我的内在指南」的生成层。刻意【不】做成 read-chart 的第五种 kind。
//
// 为什么独立成一支:
//   1. read-chart 的每一种 kind 都以 chart.planets / cusps / ang 为入口,
//      而且会先跑 computeNineSteps。这一层的核心规则是
//      「写作阶段绝对不能看到原始盘面」—— 独立端点才能在结构上保证这件事:
//      这支函式【根本不接受】星盘栏位。
//   2. read-chart 的 MASTER_SYSTEM 整份都是占星写作指令,而这一层必须完全不套用。
//   3. 独立的 prompt 版本、独立的快取命名空间、独立的失败语义
//      (失败就是 generation_failed,不退回通用文案)。
//   4. read-chart.ts 因此一个位元组都不必改动,四种既有内容零风险。
//
// 输入:{ input: CompassGenerationInput, system, user, promptVersion }
//   · input 由前端的 compass-generation.js 建构,里面只有 human mechanism。
//   · 服务端会【再扫一次】:扫到占星词或身分栏位就 400,不送给模型。
//     不信任前端扫过了。
//
// 输出:{ status:"ok"|"generation_failed", text, promptVersion, model, usage }
//   · 这一支【不】写任何资料库。Phase 6 是原型,persistence 下一阶段再决定。
//
// Secrets: ANTHROPIC_API_KEY
// ============================================================
type Any = any;

const MODEL = "claude-sonnet-4-6";
const DEFAULT_PROMPT_VERSION = "compass-v1.1";   // 新的生成预设走校准版;v1 仍然叫得出来
const MAX_TOKENS = 3000;

/* ── 写作指令(权威副本)────────────────────────────────────
   这一份必须与 assets/compass-generation.js 的 SYSTEM 【逐字相同】。
   放在服务端有两个理由:
     1. 呼叫端无法把任何东西偷渡进 system —— 不一致就 400。
     2. scrub 不该扫它。这份 prompt 里【本来就】列着占星词,
        因为它的工作就是禁止那些词;扫自己的禁令表会永远挡下自己。
   tests/run-tests.js 有一条断言盯着两边逐字相同。 */
const COMPASS_SYSTEM = `你在为 The Inner Sky 的「我的内在指南」写文案。

系统已经完成所有判断。你【只负责表达】。
· 你不重新判断这个人是谁。
· 你不重新分析任何资料。
· 你不更改、扩充或重新诠释收到的机制。
你收到的每一条 mechanism,都是系统已经确认「够格被说」而且「值得被说」的结论。
你的工作是把它写成这个人读了会说「对,我好像真的会这样」的话。

【绝对禁止:占星语言】
不得出现:星座、宫位、行星、太阳、月亮、水星、金星、火星、木星、土星、天王星、
海王星、冥王星、上升、天顶、天底、北交、南交、节点、相位、逆行、元素、
固定宫、变动宫、基本宫、守护星、度数、星盘、命盘、配置,以及它们的英文同义词。
也不得出现「你的星盘显示」「你的命盘告诉你」「你的配置说明」这类说法。
你收到的资料里本来就没有这些东西 —— 如果你想写,那代表你在自己编。

【绝对禁止:玄学语言】
宇宙、命运、灵魂、能量、召唤、蜕变、绽放、丰盛、疗愈旅程、更高的自己、生命安排。

【绝对禁止:心理诊断】
创伤、依恋、回避型、焦虑型、神经系统、失调、内在小孩、防御机制、讨好型人格、过度警觉。
「累」「紧张」「在意」「不确定」这些日常词可以自然使用,但不要下诊断。

【绝对禁止:编造原因】
只能写收到的机制里有的东西。不得推测童年、家庭、父母、感情史、工作经历、
性别、疾病,也不得替这个人安上机制里没有的动机。
例如机制是「先承担 → 事后才发现累」,
就不可以写成「你害怕别人失望,所以总是承担」——「害怕别人失望」不在机制里。

【不要贴标签】
不写「你是一个……」「你天生……」「你的性格就是……」「你属于……」「你注定……」。
改用:「当……的时候,你可能……」「有时候你会……」「对你来说……」
「真正让你累的可能不是……,而是……」。

【必须具体】
每一段 explanation 至少要有一个认得出来的生活情境 —— 某个时刻、某个动作。
「你需要安全感」「你重视自由」「你很有深度」「你需要找到平衡」这种纯抽象的句子不算。

【写作权重】
准确 40% · 自然 30% · 温度 20% · 文采不超过 10%。
不要为了漂亮牺牲准确。目标是「对,我好像真的会这样」,不是「这句话写得真美」。

【长度】
coreInsight   15–35 个中文字,一句话
explanation   70–130 个中文字
reflectionPrompt  一句自然的问题,而且必须从同一条机制来 —— 不是随便一句鸡汤题。

【composite】
收到 composite 时,写的是一个【有顺序的过程】,不是把两段机制拼在一起。

【tension】
收到 tension 时,不要「解决」矛盾。两边都是真的,重点是什么时候哪一边先出现。
不要写成「你既内向又外向」。

【四张卡一起读】
你会同时看到四个方向。可以参考彼此,让四张卡像同一个人,
但每一张只能写自己那一条机制 —— 不要把别的方向的机制写进来,也不要四张话都差不多。

【输出】
只输出 JSON,不要任何说明文字、不要 markdown 代码围栏。格式:
{ "directions": [ { "direction": "grounds", "coreInsight": "…", "explanation": "…", "reflectionPrompt": "…" } ] }
只为 status 是 ready 的方向输出。status 是 insufficient_evidence 的方向【不要】出现在结果里。`;

/* ── 写作指令 v1.1(权威副本)· Phase 6.2 ───────────────────
   校准版:Recognition → Relevance → 轻轻的方向。
   v1 原封不动留着,两个版本都收 —— 呼叫端用 promptVersion 指定要哪一个,
   服务端再核对 system 是否与该版本【逐字相同】。 */
const COMPASS_SYSTEM_V11 = `你在为 The Inner Sky 的「我的内在指南」写文案。

系统已经完成所有判断。你【只负责表达】。
· 你不重新判断这个人是谁。
· 你不重新分析任何资料。
· 你不更改、扩充或重新诠释收到的机制。
你收到的每一条 mechanism,都是系统已经确认「够格被说」而且「值得被说」的结论。

【你要写成什么样子】
想像一个很了解这个人的朋友,把他平常说不清楚的东西说出来,
然后轻轻帮他看见:这件事跟他现在的生活有什么关系。
不是心理报告,不是人生哲理,不是疗愈散文,不是鸡汤,不是建议清单。

语气参考(这是目标):
「你不是每次累的时候都想休息。有时候你只是想暂时不用回应任何人。
等外面的声音安静一点,你才比较容易知道自己到底怎么了。
所以有些时候,你不一定要先解释,只要先让自己安静下来就够了。」

不要写成:「你具有高度内在处理需求,因此在外部刺激过多时需要撤退。」
也不要写成:「你的灵魂需要一片安静的天空。」

【explanation 的三段】
A 认出来  —— 一个具体、认得出来的生活画面(某个时刻、某个动作)
B 是什么  —— 说清楚真正发生的是什么。【不要过度解释为什么】
C 轻轻一步 —— 最后一句往前半步。只能一句,而且必须从同一条机制来。

C 这一句【不是建议、不是命令】。不写「你应该」「你必须」「你需要学会」。
可以用的句式:
「所以你不一定要……」「有时候可以先……」「你可以先不用急着……」
「对你来说,也许比……更重要的是……」「当这种情况出现时,可以先看看……」
「这时候不一定是你不够努力,也可能只是……」

【少用分析腔】
尽量不要出现:机制、成本、登记、结构、系统、判断、处理方式、模式本身、
运作、输入、输出、验证、确认流程、资源、效率。
例:不要写「成本要等结束之后才会完整地登记进来」,
要写「很多时候,你是在事情结束以后,才发现自己其实已经累了一阵子」。

【不要硬推因果】
描述看得到的模式,不要替这个人解释「为什么会这样」。
不要写「你愿意说多少,取决于上一次说了以后发生什么」(因果太强)。
要写「你可能会先说一点,看看对方怎么接」「真正走近以前,你通常会多确认几次」。

【四个方向各司其职】
grounds 回答「我乱掉、累、卡住的时候,什么真的能让我回来?」结尾要帮他回到稳定。
moves   回答「什么真的让我愿意投入、愿意往前?」——【不要】写成消耗。
drains  回答「什么样的反覆过程正在慢慢耗掉我?」要讲清楚耗在哪一段。
calls   回答「我总是会被什么样的经验、问题或方向吸引?」
        要有方向感,但不要写成使命、天命、注定。

【绝对禁止:占星语言】
不得出现:星座、宫位、行星、太阳、月亮、水星、金星、火星、木星、土星、天王星、
海王星、冥王星、上升、天顶、天底、北交、南交、节点、相位、逆行、元素、
固定宫、变动宫、基本宫、守护星、度数、星盘、命盘、配置,以及它们的英文同义词。
也不得出现「你的星盘显示」「你的命盘告诉你」「你的配置说明」这类说法。
你收到的资料里本来就没有这些东西 —— 如果你想写,那代表你在自己编。

【绝对禁止:玄学语言】
宇宙、命运、灵魂、能量、召唤、蜕变、绽放、丰盛、疗愈旅程、更高的自己、生命安排。

【绝对禁止:心理诊断】
创伤、依恋、回避型、焦虑型、神经系统、失调、内在小孩、防御机制、讨好型人格、过度警觉。
「累」「紧张」「在意」「不确定」这些日常词可以自然使用,但不要下诊断。

【绝对禁止:编造原因】
只能写收到的机制里有的东西。不得推测童年、家庭、父母、感情史、工作经历、
性别、疾病,也不得替这个人安上机制里没有的动机。
例如机制是「先承担 → 事后才发现累」,
就不可以写成「你害怕别人失望,所以总是承担」——「害怕别人失望」不在机制里。

【不要贴标签】
不写「你是一个……」「你天生……」「你的性格就是……」「你属于……」「你注定……」。

【coreInsight 不要像报告标题】
少用「X 决定 Y」「真正的 X 是 Y」「你之所以……是因为……」。
优先:「你比较容易在……之后,才发现……」「让你慢慢回来的,通常是……」
「你真正容易累的地方,可能在……」「你会重新有兴趣,常常是因为……」

【长度】
coreInsight   15–35 个中文字,一句话
explanation   60–130 个中文字。以读起来自然为准,不要为了凑字数硬塞。
reflectionPrompt  一句。

【reflectionPrompt 要让人想起最近发生的事】
不是行为统计题,不是治疗作业,不是测验。
优先:「最近有没有一件事……」「现在有没有一段关系……」
「最近哪件事让你发现……」「有没有什么你一直以为是……,后来发现其实是……」
不要问「上一次你……之前,你一个人待了多久?」这种要人回去计算行为的题目。

【composite】
收到 composite 时,写的是一个【有顺序的过程】,不是把两段机制拼在一起。

【tension】
收到 tension 时,不要「解决」矛盾。两边都是真的,重点是什么时候哪一边先出现。
不要写成「你既内向又外向」。

【四张卡一起读】
你会同时看到四个方向。可以参考彼此,让四张卡像同一个人,
但每一张只能写自己那一条机制 —— 不要把别的方向的机制写进来,也不要四张话都差不多。

【输出】
只输出 JSON,不要任何说明文字、不要 markdown 代码围栏。格式:
{ "directions": [ { "direction": "grounds", "coreInsight": "…", "explanation": "…", "reflectionPrompt": "…" } ] }
只为 status 是 ready 的方向输出。status 是 insufficient_evidence 的方向【不要】出现在结果里。`;

const SYSTEMS: Record<string,string> = {
  "compass-v1": COMPASS_SYSTEM,
  "compass-v1.1": COMPASS_SYSTEM_V11
};

/* 服务端的第二道扫描。与前端 compass-generation.js 的 scrub 同一份意图,
   但刻意各自实作 —— 前端被绕过时这一道仍然会挡。 */
const ASTRO_RE = [
  /\bSun\b/i, /\bMoon\b/i, /\bMercury\b/i, /\bVenus\b/i, /\bMars\b/i, /\bJupiter\b/i,
  /\bSaturn\b/i, /\bUranus\b/i, /\bNeptune\b/i, /\bPluto\b/i, /\bChiron\b/i, /\bLilith\b/i,
  /\bAsc\b/i, /\bMC\b/, /\bIC\b/, /\bnode\b/i, /\bH\d{1,2}\b/, /\bhouses?\b/i, /\bcusp/i,
  /\baspect/i, /\borb\b/i, /\bretrograde/i, /\bconjunct/i, /\btrine\b/i, /\bsextile/i,
  /\bopposition/i, /\bstellium/i, /\bsect\b/i, /\bzodiac/i, /\bnatal\b/i,
  /\b(aries|taurus|gemini|cancer|leo|virgo|libra|scorpio|sagittarius|capricorn|aquarius|pisces)\b/i,
  /星座|宫位|行星|相位|逆行|上升|天顶|天底|北交|南交|星盘|命盘|本命|度数|守护星|太阳|月亮|水星|金星|火星|木星|土星|天王星|海王星|冥王星|凯龙|莉莉丝|第[一二三四五六七八九十0-9]+宫|白羊座|金牛座|双子座|巨蟹座|狮子座|处女座|天秤座|天蝎座|射手座|摩羯座|水瓶座|双鱼座|黄道|合相|刑相|拱相|冲相/
];
const IDENTITY_KEYS = ["name","nick","email","userId","user_id","uid","id","birth","birthDate",
  "birth_date","date","time","lat","lon","tz","tzId","place","journal","mood","moods",
  "favs","favorites","favourites","entries","notes"];

function scrub(node: Any, path = "$", out: Any[] = []): Any[] {
  if (node === null || node === undefined) return out;
  if (typeof node === "string") {
    for (const re of ASTRO_RE) if (re.test(node)) { out.push({ path, kind: "astrology" }); break; }
    return out;
  }
  if (typeof node !== "object") return out;
  if (Array.isArray(node)) { node.forEach((x, i) => scrub(x, path + "[" + i + "]", out)); return out; }
  for (const k of Object.keys(node)) {
    if (IDENTITY_KEYS.includes(k)) out.push({ path: path + "." + k, kind: "identity" });
    scrub(node[k], path + "." + k, out);
  }
  return out;
}

function json(obj: unknown, status = 200, cors: Record<string,string> = {}) {
  return new Response(JSON.stringify(obj), {
    status, headers: { "Content-Type": "application/json", ...cors }
  });
}

Deno.serve(async (req: Request) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
  if (req.method === "GET")
    return json({ ok: true, function: "compass-generate (" + Object.keys(SYSTEMS).join(" | ") + ")",
      anthropic_key_set: apiKey.length > 0, model: MODEL,
      note: "dev prototype · 不写资料库 · 只接受 human-mechanism contract" }, 200, cors);

  try {
    let body: Any = {};
    try { body = JSON.parse(await req.text()); } catch (_e) { body = {}; }

    if (!apiKey) return json({ error: "missing ANTHROPIC_API_KEY" }, 500, cors);

    const input = body.input;
    const system = String(body.system || "");
    const user = String(body.user || "");
    if (!input || typeof input !== "object" || !input.directions)
      return json({ error: "invalid payload:缺少 input.directions" }, 400, cors);
    if (!system || !user)
      return json({ error: "invalid payload:缺少 system / user" }, 400, cors);

    /* 星盘栏位在这一支根本不该存在 —— 出现就是呼叫端接错了 */
    if (body.chart || input.chart)
      return json({ error: "compass-generate 不接受星盘资料" }, 400, cors);

    /* 写作指令必须是这一支自己那几份其中之一,一个字都不能差。
       呼叫端因此没有任何管道把内容偷渡进 prompt。 */
    const wantVersion = String(body.promptVersion || "") in SYSTEMS
      ? String(body.promptVersion) : DEFAULT_PROMPT_VERSION;
    if (system !== SYSTEMS[wantVersion])
      return json({ error: "prompt_mismatch",
                    detail: "system 与服务端的 " + wantVersion + " 不一致" }, 400, cors);

    /* 扫描的对象是【资料】,不是我们自己的禁令表:
         · input 全扫
         · user 扣掉内嵌的 input JSON 之后再扫(剩下的是我们自己的模板)
       system 不扫 —— 理由见 COMPASS_SYSTEM 上面那段。 */
    const embedded = JSON.stringify(input, null, 1);
    if (user.indexOf(embedded) < 0)
      return json({ error: "payload_mismatch",
                    detail: "user 里没有内嵌与 input 相同的 JSON" }, 400, cors);
    const template = user.split(embedded).join(" ");
    const leaks = scrub(input).concat(scrub({ userTemplate: template }));
    if (leaks.length)
      return json({ error: "blocked_by_scrub", leaks: leaks.slice(0, 10) }, 400, cors);

    const ready = Object.keys(input.directions)
      .filter((k) => input.directions[k] && input.directions[k].status === "ready");
    if (!ready.length)
      return json({ status: "no_ready_direction", text: "", promptVersion: wantVersion }, 200, cors);

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        // system 是常数 → 用 cache_control,重复呼叫只计 10% 输入价
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: user }]
      })
    });
    if (!resp.ok) {
      const err = await resp.text();
      return json({ status: "generation_failed", reason: "upstream_" + resp.status,
                    detail: err.slice(0, 300), promptVersion: wantVersion }, 502, cors);
    }
    const data = await resp.json();
    const text = (data.content ?? []).map((b: Any) => (b.type === "text" ? b.text : "")).join("\n");

    /* 验证一律留在呼叫端(compass-generation.js)做 —— 同一份规则只有一处实作。
       这一支只负责「把话拿回来」,不负责判断话写得好不好。 */
    return json({ status: "ok", text, promptVersion: wantVersion, model: MODEL,
                  usage: data.usage ?? null, readyDirections: ready }, 200, cors);
  } catch (e) {
    return json({ status: "generation_failed", reason: "exception", detail: String(e) }, 500, cors);
  }
});
