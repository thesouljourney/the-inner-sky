// Supabase Edge Function: create-checkout-session（v2）
// ------------------------------------------------------------------
// 单文件，可直接贴到 Supabase Dashboard 部署。
//
// 前端只送：{ plan, topic_ids?, include_inner_tools_6m? }
// 服务器负责一切判断：
//   1. 验证登录 → 只有适用付费强制的账号能建立 checkout（Sandbox 期间 = 测试名单）
//   2. 每个用户在每个环境固定一个 Stripe Customer（billing_customers）
//   3. reserve_checkout_order：在资料库锁内验证方案、取代同类别旧订单
//   4. 旧的 Stripe session 全部 expire —— 无法确认就不回传付款网址
//   5. 建立新的 Stripe Checkout Session（Idempotency-Key = 订单 id）
//   6. activate_checkout_order：这段时间被别的请求取代 → expire 自己刚建的 session
//
// Secrets（只在 Supabase）：
//   STRIPE_SECRET_KEY, PAYMENTS_ENV (test | live),
//   STRIPE_PRICE_3_TOPICS, STRIPE_PRICE_6_TOPICS, STRIPE_PRICE_COMPLETE,
//   STRIPE_PRICE_INNER_TOOLS_6M, STRIPE_PRICE_INNER_TOOLS_MONTHLY,
//   STRIPE_PRICE_TOPIC_UPGRADE, STRIPE_PRICE_COMPLETE_UPGRADE,
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY（后三个由 Supabase 自动提供）

const STRIPE_API_VERSION = "2026-07-29.dahlia";
const ALLOWED_ORIGIN = "https://the-inner-sky.vercel.app";
const SITE = "https://the-inner-sky.vercel.app";
const SUCCESS_URL = SITE + "/app.html?checkout=success&session_id={CHECKOUT_SESSION_ID}#/checkout-test";
const CANCEL_URL = SITE + "/app.html?checkout=cancel#/checkout-test";
const SESSION_TTL_SECONDS = 31 * 60;   // Stripe 最短 30 分钟

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin",
};

// deno-lint-ignore no-explicit-any
type Any = any;
const G = globalThis as Any;
function env(name: string): string {
  return (G.Deno?.env?.get?.(name) ?? G.process?.env?.[name] ?? "") as string;
}
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}
function fail(status: number, code: string, message?: string): Response {
  return json(status, { error: message || code, code });
}

// ── Stripe ──────────────────────────────────────────────────────
function encodeForm(obj: Any, prefix = "", out = new URLSearchParams()): URLSearchParams {
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((x, i) => {
        if (x !== null && typeof x === "object") encodeForm(x, `${key}[${i}]`, out);
        else out.append(`${key}[${i}]`, String(x));
      });
    } else if (typeof v === "object") encodeForm(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}
type StripeResult = { ok: boolean; status: number; body: Any; network?: boolean };
async function stripe(method: string, path: string, params?: Any, idempotencyKey?: string): Promise<StripeResult> {
  const headers: Record<string, string> = {
    Authorization: "Bearer " + env("STRIPE_SECRET_KEY"),
    "Stripe-Version": STRIPE_API_VERSION,
  };
  let url = "https://api.stripe.com/v1" + path;
  let body: string | undefined;
  if (params) {
    const form = encodeForm(params).toString();
    if (method === "GET") url += (url.includes("?") ? "&" : "?") + form;
    else { body = form; headers["Content-Type"] = "application/x-www-form-urlencoded"; }
  }
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  let r: Response;
  try { r = await fetch(url, { method, headers, body }); }
  catch (_e) { return { ok: false, status: 0, body: null, network: true }; }
  const b = await r.json().catch(() => null);
  return { ok: r.ok, status: r.status, body: b };
}

// ── Supabase（service_role，经 PostgREST）─────────────────────────
type DbResult = { ok: boolean; status: number; data: Any; error: Any };
async function db(method: string, path: string, body?: Any, prefer?: string): Promise<DbResult> {
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  const headers: Record<string, string> = { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json" };
  if (prefer) headers["Prefer"] = prefer;
  let r: Response;
  try {
    r = await fetch(env("SUPABASE_URL") + "/rest/v1/" + path, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) { return { ok: false, status: 0, data: null, error: { message: String(e) } }; }
  const text = await r.text();
  let parsed: Any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch (_e) { parsed = text; }
  return r.ok ? { ok: true, status: r.status, data: parsed, error: null }
              : { ok: false, status: r.status, data: null, error: parsed };
}
const rpc = (fn: string, args: Any) => db("POST", "rpc/" + fn, args);
// raise exception 'checkout:xxx' → 'checkout:xxx'
function dbErrorCode(e: Any): string { return String((e && (e.message || e.msg)) || ""); }

// ── 方案 → Price ID（只在服务器）───────────────────────────────
function pricesFor(order: Any): string[] {
  const P = {
    t3: env("STRIPE_PRICE_3_TOPICS"), t6: env("STRIPE_PRICE_6_TOPICS"), c: env("STRIPE_PRICE_COMPLETE"),
    m6: env("STRIPE_PRICE_INNER_TOOLS_6M"), mo: env("STRIPE_PRICE_INNER_TOOLS_MONTHLY"),
    u5: env("STRIPE_PRICE_TOPIC_UPGRADE"), u10: env("STRIPE_PRICE_COMPLETE_UPGRADE"),
  };
  if (order.category === "inner_tools_sub") return [P.mo];
  const path = `${order.from_limit}->${order.to_limit}`;
  const base: Record<string, string> = {
    "0->3": P.t3, "0->6": P.t6, "0->9": P.c, "3->6": P.u5, "6->9": P.u5, "3->9": P.u10,
  };
  const out = [base[path]];
  if (order.inner_tools_6m) out.push(P.m6);
  return out;
}

const ERROR_STATUS: Record<string, number> = {
  "checkout:invalid_plan": 400, "checkout:invalid_topics": 400, "checkout:unexpected_topics": 400,
  "checkout:addon_not_allowed": 400, "checkout:bad_environment": 500, "checkout:unauthenticated": 401,
};

// ── 主流程 ──────────────────────────────────────────────────────
export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST") return fail(405, "method_not_allowed");

  try {
    // 0. 设定：环境与金钥必须一致（Sandbox 只能用 sk_test_）
    const PAY_ENV = env("PAYMENTS_ENV");
    const KEY = env("STRIPE_SECRET_KEY");
    if (!["test", "live"].includes(PAY_ENV)) return fail(500, "server_not_configured", "PAYMENTS_ENV 未设定");
    if (!KEY.startsWith(PAY_ENV === "live" ? "sk_live_" : "sk_test_"))
      return fail(500, "server_not_configured", "Stripe 金钥与 PAYMENTS_ENV 不一致");
    for (const n of ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY",
                     "STRIPE_PRICE_3_TOPICS", "STRIPE_PRICE_6_TOPICS", "STRIPE_PRICE_COMPLETE",
                     "STRIPE_PRICE_INNER_TOOLS_6M", "STRIPE_PRICE_INNER_TOOLS_MONTHLY",
                     "STRIPE_PRICE_TOPIC_UPGRADE", "STRIPE_PRICE_COMPLETE_UPGRADE"]) {
      if (!env(n)) return fail(500, "server_not_configured", n + " 未设定");
    }

    // 1. 验证登录
    const auth = req.headers.get("Authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    if (!token) return fail(401, "invalid_session", "Invalid or expired user session");
    let user: Any = null;
    try {
      const ur = await fetch(env("SUPABASE_URL") + "/auth/v1/user", {
        headers: { apikey: env("SUPABASE_ANON_KEY"), Authorization: "Bearer " + token },
      });
      if (ur.ok) user = await ur.json().catch(() => null);
      else if (ur.status === 401 || ur.status === 403) return fail(401, "invalid_session", "Invalid or expired user session");
      else return fail(503, "auth_unavailable");
    } catch (_e) { return fail(503, "auth_unavailable"); }
    if (!user || !user.id) return fail(401, "invalid_session", "Invalid or expired user session");

    // 2. 只有适用付费强制的账号（Sandbox 期间 = billing_test_users）能建立 checkout
    const enf = await rpc("enforcement_applies", { p_user: user.id });
    if (!enf.ok) return fail(503, "db_unavailable");
    if (enf.data !== true) return fail(403, "payments_not_enabled", "这个账号目前还不能购买");

    // 3. 请求内容（只接受这三个栏位；topic 由资料库再验证一次）
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return fail(400, "invalid_body");
    const plan = typeof body.plan === "string" ? body.plan : "";
    let topicIds: string[] | null = null;
    if (body.topic_ids !== undefined && body.topic_ids !== null) {
      if (!Array.isArray(body.topic_ids) || body.topic_ids.length > 9 ||
          !body.topic_ids.every((x: Any) => typeof x === "string" && /^[a-z]{2,16}$/.test(x)))
        return fail(400, "invalid_topics");
      topicIds = body.topic_ids;
    }
    if (body.include_inner_tools_6m !== undefined && typeof body.include_inner_tools_6m !== "boolean")
      return fail(400, "invalid_body");
    const with6m = body.include_inner_tools_6m === true;

    // 4. Stripe Customer：每个用户、每个环境固定一个
    const customerId = await ensureCustomer(user, PAY_ENV);
    if (!customerId) return fail(503, "stripe_unavailable", "暂时无法建立付款资料，请稍后再试");

    // 5. 资料库锁内验证并建立订单
    const rsv = await rpc("reserve_checkout_order", {
      p_user: user.id, p_env: PAY_ENV, p_plan: plan, p_topic_ids: topicIds, p_inner_tools_6m: with6m,
    });
    if (!rsv.ok) {
      const code = dbErrorCode(rsv.error);
      if (code.startsWith("checkout:")) {
        const c = code.slice("checkout:".length);
        return fail(ERROR_STATUS[code] ?? 409, c);
      }
      return fail(503, "db_unavailable");
    }
    const order = rsv.data;

    // 6. 旧 session 一律 expire；无法确认就不建立新的
    const toExpire = new Set<string>(order.expire_sessions || []);
    const listed = await stripe("GET", "/checkout/sessions", { customer: customerId, status: "open", limit: 100 });
    if (!listed.ok) {
      await rpc("fail_checkout_order", { p_order: order.order_id });
      return fail(503, "stripe_unavailable", "暂时无法确认之前的付款页面，请稍后再试");
    }
    for (const s of (listed.body?.data || [])) {
      // 同一个类别的才 expire（Monthly 与 topic 互不影响）；没有类别的旧版 session 一律视为 topic 类
      const cat = s?.metadata?.category || (s?.mode === "subscription" ? "inner_tools_sub" : "topics");
      if (cat === order.category) toExpire.add(s.id);
    }
    for (const sid of toExpire) {
      const r = await expireSession(sid);
      if (r === "expired") continue;
      await rpc("fail_checkout_order", { p_order: order.order_id });
      if (r === "completed") {
        return fail(409, "previous_payment_completed", "上一笔付款已经完成，请重新整理页面后再选择");
      }
      return fail(503, "stripe_unavailable", "暂时无法关闭之前的付款页面，请稍后再试");
    }

    // 7. 建立新的 Checkout Session
    const isSub = order.category === "inner_tools_sub";
    const meta: Record<string, string> = {
      order_id: order.order_id,
      supabase_user_id: user.id,
      environment: PAY_ENV,
      category: order.category,
      plan_code: order.plan_code,
      from_limit: order.from_limit === null || order.from_limit === undefined ? "" : String(order.from_limit),
      to_limit: order.to_limit === null || order.to_limit === undefined ? "" : String(order.to_limit),
      topic_ids: (order.topic_ids || []).join(","),
      inner_tools_6m: order.inner_tools_6m ? "true" : "false",
    };
    const params: Any = {
      mode: isSub ? "subscription" : "payment",
      customer: customerId,
      client_reference_id: user.id,
      line_items: pricesFor(order).map((price) => ({ price, quantity: 1 })),
      payment_method_types: isSub ? ["card"] : ["card", "paynow"],
      success_url: SUCCESS_URL,
      cancel_url: CANCEL_URL,
      expires_at: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
      metadata: meta,
    };
    if (isSub) params.subscription_data = { metadata: { order_id: order.order_id, supabase_user_id: user.id } };
    else params.payment_intent_data = { metadata: { order_id: order.order_id, supabase_user_id: user.id } };

    const created = await stripe("POST", "/checkout/sessions", params, "checkout-" + order.order_id);
    if (!created.ok || !created.body?.id || !created.body?.url) {
      console.error("stripe checkout create failed", created.status, created.body?.error?.message);
      await rpc("fail_checkout_order", { p_order: order.order_id });
      return fail(502, "stripe_unavailable", "暂时无法建立付款页面，请稍后再试");
    }
    const session = created.body;

    // 8. 订单仍然是 creating 才能回传网址；否则 expire 自己刚建的
    const act = await rpc("activate_checkout_order", { p_order: order.order_id, p_session: session.id });
    if (!act.ok || act.data !== true) {
      await expireSession(session.id);
      return fail(409, "superseded", "已有另一个付款页面正在建立，请重新整理后再试");
    }
    return json(200, { url: session.url });
  } catch (e) {
    console.error("create-checkout-session error", e);
    return fail(500, "internal_error");
  }
}

// 回传 expired（已确认不能再付款）/ completed（已经完成付款或付款确认中）/ unknown
async function expireSession(sessionId: string): Promise<"expired" | "completed" | "unknown"> {
  const r = await stripe("POST", "/checkout/sessions/" + encodeURIComponent(sessionId) + "/expire");
  if (r.ok) {
    await rpc("mark_session_expired", { p_session: sessionId });
    return "expired";
  }
  if (r.network) return "unknown";
  // expire 被拒（不是 open）→ 以 Stripe 上的实际状态为准
  const g = await stripe("GET", "/checkout/sessions/" + encodeURIComponent(sessionId));
  if (!g.ok) return g.status === 404 ? "expired" : "unknown";
  if (g.body?.status === "expired") {
    await rpc("mark_session_expired", { p_session: sessionId });
    return "expired";
  }
  if (g.body?.status === "complete") return "completed";
  return "unknown";
}

async function ensureCustomer(user: Any, payEnv: string): Promise<string | null> {
  const q = "billing_customers?select=stripe_customer_id&user_id=eq." + user.id + "&environment=eq." + payEnv;
  const found = await db("GET", q);
  if (!found.ok) return null;
  if (found.data?.[0]?.stripe_customer_id) return found.data[0].stripe_customer_id;

  const c = await stripe("POST", "/customers", {
    email: user.email || undefined,
    metadata: { supabase_user_id: user.id, environment: payEnv },
  }, `customer-${payEnv}-${user.id}`);
  if (!c.ok || !c.body?.id) return null;
  const ins = await db("POST", "billing_customers",
    { user_id: user.id, environment: payEnv, stripe_customer_id: c.body.id },
    "resolution=ignore-duplicates,return=minimal");
  if (!ins.ok) return null;
  // 并发时以资料库里那一笔为准
  const again = await db("GET", q);
  return again.ok ? (again.data?.[0]?.stripe_customer_id ?? null) : null;
}

if (G.Deno?.serve) G.Deno.serve(handler);
