// Supabase Edge Function: create-checkout-session（Stripe Sandbox）
// ------------------------------------------------------------------
// 这份是参考版本，放在 repo 里只是为了留底 / 对照，前端不会载入它。
// 真正跑的是 Supabase Dashboard 上部署的那一份。
//
// 用到的 Secrets（只在 Supabase，不在前端）：
//   STRIPE_SECRET_KEY   Sandbox 的 sk_test_...（这里会拒绝 sk_live_）
//   STRIPE_PRICE_ID     The Inner Sky｜完整星空解读 S$24.90 SGD
//   SUPABASE_URL / SUPABASE_ANON_KEY   Supabase 自动提供，只用来验证使用者令牌
//
// 前端呼叫方式：
//   POST  Authorization: Bearer <使用者自己的 access_token>
//         Content-Type: application/json
//         body: {}
//   → 200 { url }    → 前端 window.location.href = url
//   → 401 { error: "Invalid or expired user session" }

const ALLOWED_ORIGIN = "https://the-inner-sky.vercel.app";
const SITE = "https://the-inner-sky.vercel.app";
const SUCCESS_URL = SITE + "/app.html?checkout=success&session_id={CHECKOUT_SESSION_ID}#/checkout-test";
const CANCEL_URL = SITE + "/app.html?checkout=cancel#/checkout-test";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin",
};

// 每一个回应（包括错误）都要带 CORS 头，否则浏览器读不到 401，前端就没办法续期重试
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  // 预检：直接放行
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
  const STRIPE_PRICE_ID = Deno.env.get("STRIPE_PRICE_ID") ?? "";
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!STRIPE_SECRET_KEY || !STRIPE_PRICE_ID || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return json(500, { error: "Server not configured" });
  }
  // 第一轮只允许 Sandbox：万一有人把 Live 金钥放进来，宁可不收款
  if (!STRIPE_SECRET_KEY.startsWith("sk_test_")) return json(500, { error: "Sandbox only" });

  // 1) 验证使用者：拿他自己的 access_token 问 Supabase Auth
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return json(401, { error: "Invalid or expired user session" });
  const ur = await fetch(SUPABASE_URL + "/auth/v1/user", {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: "Bearer " + token },
  });
  if (!ur.ok) return json(401, { error: "Invalid or expired user session" });
  const user = await ur.json().catch(() => null);
  if (!user || !user.id) return json(401, { error: "Invalid or expired user session" });

  // 2) 建立 Checkout Session（Stripe REST API，form-encoded）
  const form = new URLSearchParams();
  form.set("mode", "payment");
  form.set("line_items[0][price]", STRIPE_PRICE_ID);
  form.set("line_items[0][quantity]", "1");
  form.set("success_url", SUCCESS_URL);
  form.set("cancel_url", CANCEL_URL);
  form.set("client_reference_id", user.id);
  form.set("metadata[supabase_user_id]", user.id);
  // 同一个 id 也挂在 PaymentIntent 上，Stripe Dashboard 查 payment_intent 时也看得到是谁
  form.set("payment_intent_data[metadata][supabase_user_id]", user.id);
  if (user.email) form.set("customer_email", user.email);

  const sr = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + STRIPE_SECRET_KEY,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });
  const session = await sr.json().catch(() => null);
  if (!sr.ok || !session || !session.url) {
    console.error("stripe checkout error", sr.status, session && session.error);
    return json(502, { error: "Could not create checkout session" });
  }
  return json(200, { url: session.url });
});
