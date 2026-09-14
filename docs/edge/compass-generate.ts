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
const PROMPT_VERSION = "compass-v1";
const MAX_TOKENS = 3000;

/* 服务端的第二道扫描。与前端 compass-generation.js 的 scrub 同一份意图,
   但刻意各自实作 —— 前端被绕过时这一道仍然会挡。 */
const ASTRO_RE = [
  /\bSun\b/i, /\bMoon\b/i, /\bMercury\b/i, /\bVenus\b/i, /\bMars\b/i, /\bJupiter\b/i,
  /\bSaturn\b/i, /\bUranus\b/i, /\bNeptune\b/i, /\bPluto\b/i, /\bChiron\b/i, /\bLilith\b/i,
  /\bAsc\b/i, /\bMC\b/, /\bIC\b/, /\bnode\b/i, /\bH\d{1,2}\b/, /\bhouses?\b/i, /\bcusp/i,
  /\baspect/i, /\borb\b/i, /\bretrograde/i, /\bconjunct/i, /\btrine\b/i, /\bsextile/i,
  /\bopposition/i, /\bstellium/i, /\bsect\b/i, /\bzodiac/i, /\bnatal\b/i,
  /\b(aries|taurus|gemini|cancer|leo|virgo|libra|scorpio|sagittarius|capricorn|aquarius|pisces)\b/i,
  /星座|宫位|行星|相位|逆行|上升|天顶|天底|北交|南交|星盘|命盘|本命|度数|守护星/
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
    return json({ ok: true, function: "compass-generate (" + PROMPT_VERSION + ")",
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

    const leaks = scrub(input).concat(scrub({ system, user }));
    if (leaks.length)
      return json({ error: "blocked_by_scrub", leaks: leaks.slice(0, 10) }, 400, cors);

    const ready = Object.keys(input.directions)
      .filter((k) => input.directions[k] && input.directions[k].status === "ready");
    if (!ready.length)
      return json({ status: "no_ready_direction", text: "", promptVersion: PROMPT_VERSION }, 200, cors);

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
                    detail: err.slice(0, 300), promptVersion: PROMPT_VERSION }, 502, cors);
    }
    const data = await resp.json();
    const text = (data.content ?? []).map((b: Any) => (b.type === "text" ? b.text : "")).join("\n");

    /* 验证一律留在呼叫端(compass-generation.js)做 —— 同一份规则只有一处实作。
       这一支只负责「把话拿回来」,不负责判断话写得好不好。 */
    return json({ status: "ok", text, promptVersion: PROMPT_VERSION, model: MODEL,
                  usage: data.usage ?? null, readyDirections: ready }, 200, cors);
  } catch (e) {
    return json({ status: "generation_failed", reason: "exception", detail: String(e) }, 500, cors);
  }
});
