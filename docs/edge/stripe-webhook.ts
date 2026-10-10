// Supabase Edge Function: stripe-webhook（v2）
// ------------------------------------------------------------------
// 单文件，可直接贴到 Supabase Dashboard 部署。
// 所有权限变更都交给资料库函数（同一个 transaction、per-user lock、幂等）。
//
// 监听的事件：
//   checkout.session.completed / async_payment_succeeded / async_payment_failed / expired
//   customer.subscription.updated / deleted
//   invoice.paid / invoice.payment_failed / invoice.created
//
// 回应规则：
//   · 签名不对 → 400
//   · 资料库或 Stripe 暂时连不上 → 500（Stripe 会重送，资料库函数保证重送不会重复发放）
//   · 资料本身有问题（找不到订单、user 不符…）→ 记录 log，回 200，不让 Stripe 一直重送
//
// Secrets：STRIPE_WEBHOOK_SECRET, STRIPE_SECRET_KEY, PAYMENTS_ENV (test | live),
//          STRIPE_PRICE_*（与 create-checkout-session 相同的 7 个）,
//          SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const STRIPE_API_VERSION = "2026-07-29.dahlia";
const ACTIVE_SUB = ["active", "trialing", "past_due", "unpaid", "incomplete"];

// deno-lint-ignore no-explicit-any
type Any = any;
const G = globalThis as Any;
function env(name: string): string {
  return (G.Deno?.env?.get?.(name) ?? G.process?.env?.[name] ?? "") as string;
}
function reply(status: number, body: Any): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
// 暂时性错误：回 500 让 Stripe 重送
class Retryable extends Error {}

function validUuid(v: unknown): v is string {
  return typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}
function idOf(v: Any): string | null {
  if (!v) return null;
  return typeof v === "string" ? v : (v.id ?? null);
}
function isoFromUnix(v: unknown): string | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : null;
}

// ── 签名验证（沿用旧版的写法）────────────────────────────────
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function verifySignature(rawBody: string, header: string | null, secret: string): Promise<boolean> {
  if (!header) return false;
  let timestamp = "";
  const sigs: string[] = [];
  for (const part of header.split(",")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim(), v = part.slice(i + 1).trim();
    if (k === "t") timestamp = v;
    if (k === "v1") sigs.push(v);
  }
  const ts = Number(timestamp);
  if (!timestamp || !sigs.length || !Number.isFinite(ts)) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - ts) > 300) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(`${timestamp}.${rawBody}`));
  const expected = Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return sigs.some((s) => constantTimeEqual(s, expected));
}

// ── Stripe ──────────────────────────────────────────────────────
function encodeForm(obj: Any, prefix = "", out = new URLSearchParams()): URLSearchParams {
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((x, i) => out.append(`${key}[${i}]`, String(x)));
    else if (typeof v === "object") encodeForm(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}
async function stripe(method: string, path: string, params?: Any): Promise<Any> {
  const headers: Record<string, string> = {
    Authorization: "Bearer " + env("STRIPE_SECRET_KEY"),
    "Stripe-Version": STRIPE_API_VERSION,
  };
  let url = "https://api.stripe.com/v1" + path, body: string | undefined;
  if (params) {
    const form = encodeForm(params).toString();
    if (method === "GET") url += (url.includes("?") ? "&" : "?") + form;
    else { body = form; headers["Content-Type"] = "application/x-www-form-urlencoded"; }
  }
  let r: Response;
  try { r = await fetch(url, { method, headers, body }); }
  catch (e) { throw new Retryable("stripe network: " + e); }
  const b = await r.json().catch(() => null);
  if (!r.ok) throw new Retryable(`stripe ${method} ${path} → ${r.status} ${b?.error?.message ?? ""}`);
  return b;
}

// ── Supabase（service_role）─────────────────────────────────────
async function db(method: string, path: string, body?: Any): Promise<{ ok: boolean; status: number; data: Any; error: Any }> {
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  let r: Response;
  try {
    r = await fetch(env("SUPABASE_URL") + "/rest/v1/" + path, {
      method,
      headers: { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) { throw new Retryable("db network: " + e); }
  const text = await r.text();
  let parsed: Any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch (_e) { parsed = text; }
  if (r.status >= 500) throw new Retryable(`db ${path} → ${r.status}`);
  return r.ok ? { ok: true, status: r.status, data: parsed, error: null }
              : { ok: false, status: r.status, data: null, error: parsed };
}
// 资料库函数：raise exception 会以 4xx 回来，带着我们自己的错误代码
async function rpc(fn: string, args: Any): Promise<Any> {
  const r = await db("POST", "rpc/" + fn, args);
  if (r.ok) return r.data;
  const msg = String(r.error?.message ?? "");
  const e = new Error(msg || `rpc ${fn} failed`);
  (e as Any).code = msg;
  throw e;
}

// ── 方案 → 应有的 Price ID ──────────────────────────────────────
function expectedPrices(o: { category: string; from: number | null; to: number | null; sixm: boolean }): string[] {
  if (o.category === "inner_tools_sub") return [env("STRIPE_PRICE_INNER_TOOLS_MONTHLY")];
  const base: Record<string, string> = {
    "0->3": env("STRIPE_PRICE_3_TOPICS"), "0->6": env("STRIPE_PRICE_6_TOPICS"),
    "0->9": env("STRIPE_PRICE_COMPLETE"), "3->6": env("STRIPE_PRICE_TOPIC_UPGRADE"),
    "6->9": env("STRIPE_PRICE_TOPIC_UPGRADE"), "3->9": env("STRIPE_PRICE_COMPLETE_UPGRADE"),
  };
  const out = [base[`${o.from}->${o.to}`] || "?"];
  if (o.sixm) out.push(env("STRIPE_PRICE_INNER_TOOLS_6M"));
  return out;
}
function samePrices(lineItems: Any[], expected: string[]): boolean {
  const got = lineItems.map((li) => idOf(li?.price) ?? "").filter(Boolean).sort();
  const want = expected.slice().sort();
  return got.length === want.length && got.every((p, i) => p === want[i]);
}

// ── 主流程 ──────────────────────────────────────────────────────
export async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return reply(405, { error: "Method not allowed" });
  const PAY_ENV = env("PAYMENTS_ENV");
  const KEY = env("STRIPE_SECRET_KEY");
  const SECRET = env("STRIPE_WEBHOOK_SECRET");
  if (!["test", "live"].includes(PAY_ENV) || !SECRET || !env("SUPABASE_URL") || !env("SUPABASE_SERVICE_ROLE_KEY") ||
      !KEY.startsWith(PAY_ENV === "live" ? "sk_live_" : "sk_test_")) {
    console.error("stripe-webhook: server not configured");
    return reply(500, { error: "Server not configured" });
  }

  const raw = await req.text();
  if (!(await verifySignature(raw, req.headers.get("stripe-signature"), SECRET)))
    return reply(400, { received: false, error: "Invalid Stripe signature" });

  let event: Any;
  try { event = JSON.parse(raw); } catch (_e) { return reply(400, { received: false, error: "Invalid JSON" }); }

  // 这个部署只处理自己环境的事件：test 事件绝不会变成 live 权限，反之亦然
  if (Boolean(event.livemode) !== (PAY_ENV === "live")) {
    console.warn("stripe-webhook: ignored event from other environment", event.id, event.type);
    return reply(200, { received: true, ignored: "environment_mismatch" });
  }

  try {
    const result = await dispatch(event, PAY_ENV);
    return reply(200, { received: true, type: event.type, ...result });
  } catch (e) {
    if (e instanceof Retryable) {
      console.error("stripe-webhook retryable", event.type, event.id, String(e));
      return reply(500, { received: false, error: "temporary failure" });
    }
    // 资料问题：记下来，不让 Stripe 一直重送
    console.error("stripe-webhook data problem", event.type, event.id, String((e as Any)?.message ?? e));
    return reply(200, { received: true, recorded: false, problem: String((e as Any)?.message ?? e) });
  }
}

async function dispatch(event: Any, payEnv: string): Promise<Any> {
  const obj = event.data?.object ?? {};
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
    case "checkout.session.async_payment_failed":
      return await onCheckout(event.type, obj.id, payEnv);
    case "checkout.session.expired":
      await rpc("mark_session_expired", { p_session: obj.id });
      return { expired: obj.id };
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      return await syncSubscription(obj.id, payEnv);
    case "invoice.paid":
      return await onInvoicePaid(obj, payEnv);
    case "invoice.payment_failed":
    case "invoice.created": {
      // invoice.created 只拿来对账「应该期末取消」—— 不删除、不作废发票
      const subId = invoiceSubscriptionId(obj);
      if (!subId) return { recorded: false };
      return await syncSubscription(subId, payEnv);
    }
    default:
      return { recorded: false };
  }
}

// ── Checkout ────────────────────────────────────────────────────
async function onCheckout(type: string, sessionId: string, payEnv: string): Promise<Any> {
  // 一律向 Stripe 取最新状态（事件可能晚到或顺序颠倒）
  const s = await stripe("GET", "/checkout/sessions/" + encodeURIComponent(sessionId), { expand: ["line_items"] });
  const md = s.metadata ?? {};
  const userId = md.supabase_user_id || s.client_reference_id;
  if (!validUuid(userId)) throw new Error("checkout session without valid supabase user id");
  const paid = s.payment_status === "paid" || s.payment_status === "no_payment_required";

  if (!md.order_id) return await onLegacyCheckout(type, s, userId, paid, payEnv);

  if (type === "checkout.session.async_payment_failed") {
    await rpc("fail_checkout_order", { p_order: md.order_id });
    return { order: md.order_id, result: "payment_failed" };
  }
  if (!paid) {
    // PayNow：checkout 完成但付款还没确认 → 不发放，挡住同类别其他付款页面
    const r = await rpc("mark_order_processing", { p_order: md.order_id, p_session: s.id });
    await expireAll(r?.expire_sessions);
    return { order: md.order_id, result: "processing" };
  }

  const expected = expectedPrices({
    category: md.category,
    from: md.from_limit === "" || md.from_limit === undefined ? null : Number(md.from_limit),
    to: md.to_limit === "" || md.to_limit === undefined ? null : Number(md.to_limit),
    sixm: md.inner_tools_6m === "true",
  });
  return await applyPayment(md.order_id, s, userId, payEnv, samePrices(s.line_items?.data ?? [], expected));
}

async function applyPayment(orderId: string, s: Any, userId: string, payEnv: string, priceOk: boolean): Promise<Any> {
  const r = await rpc("apply_checkout_payment", {
    p_order: orderId, p_session: s.id, p_user: userId, p_env: payEnv,
    p_payment_intent: idOf(s.payment_intent), p_subscription: idOf(s.subscription),
    p_price_id: idOf(s.line_items?.data?.[0]?.price), p_amount: s.amount_total ?? null,
    p_currency: s.currency ?? null, p_price_ok: priceOk,
  });
  if (r?.result === "conflict") console.warn("paid_conflict", orderId, s.id, r.reason);
  await expireAll(r?.expire_sessions);
  // Monthly checkout：同步订阅（权限由 invoice.paid 决定）
  if (idOf(s.subscription)) await syncSubscription(idOf(s.subscription)!, payEnv);
  // 6M 生效：衔接的 Monthly 要期末取消（重送事件时也会再确认一次）
  if (r?.cancel_subscription) await syncSubscription(r.cancel_subscription, payEnv);
  return { order: orderId, result: r?.result };
}

async function expireAll(ids: Any): Promise<void> {
  for (const sid of (Array.isArray(ids) ? ids : [])) {
    try {
      await stripe("POST", "/checkout/sessions/" + encodeURIComponent(sid) + "/expire");
      await rpc("mark_session_expired", { p_session: sid });
    } catch (_e) {
      // 已经不是 open 了就以实际状态为准；真的连不上就让 Stripe 重送（下次会再 expire）
      const g = await stripe("GET", "/checkout/sessions/" + encodeURIComponent(sid));
      if (g.status === "expired") await rpc("mark_session_expired", { p_session: sid });
      else if (g.status === "open") throw new Retryable("could not expire " + sid);
    }
  }
}

// 第 2 阶段之前、旧版 create-checkout-session 建立的 session（没有 order_id）
// 能明确判断购买内容的 → 用同一套资料库函数发放；判断不了的 → 记录为 legacy，交给人工处理
async function onLegacyCheckout(type: string, s: Any, userId: string, paid: boolean, payEnv: string): Promise<Any> {
  if (type === "checkout.session.async_payment_failed" || !paid) return { legacy: true, result: "not_paid" };
  const md = s.metadata ?? {};
  const legacyPlan = String(md.plan_code || "");
  const record = async (why: string) => {
    await rpc("record_legacy_payment", {
      p_session: s.id, p_user: userId, p_env: payEnv, p_plan: legacyPlan,
      p_price_id: idOf(s.line_items?.data?.[0]?.price), p_amount: s.amount_total ?? null,
      p_currency: s.currency ?? null, p_subscription: idOf(s.subscription),
    });
    console.warn("legacy payment recorded for manual review", s.id, legacyPlan, why);
    if (idOf(s.subscription)) await syncSubscription(idOf(s.subscription)!, payEnv);
    return { legacy: true, result: "recorded_for_review", reason: why };
  };

  let plan = "", sixm = false;
  if (legacyPlan === "complete") plan = "complete";
  else if (legacyPlan === "complete_plus_inner_tools_6m") { plan = "complete"; sixm = true; }
  else if (legacyPlan === "upgrade_to_complete") plan = md.upgrade_from === "3" ? "complete_upgrade" : "topic_upgrade";
  else if (legacyPlan === "inner_tools_monthly") return await record("monthly_access_via_invoice");
  else return await record("no_topic_selection");   // topics_3 / topics_6 / upgrade_to_6

  // 已经套用过（重送）→ 不再建立订单
  const existing = await db("GET", "purchases?select=id&stripe_session_id=eq." + encodeURIComponent(s.id));
  if (existing.ok && existing.data?.length) return { legacy: true, result: "duplicate" };

  let order: Any;
  try {
    order = await rpc("reserve_checkout_order", {
      p_user: userId, p_env: payEnv, p_plan: plan, p_topic_ids: null, p_inner_tools_6m: sixm,
    });
  } catch (e) {
    return await record("state_changed:" + String((e as Any)?.code ?? e));
  }
  await expireAll(order.expire_sessions);
  await rpc("activate_checkout_order", { p_order: order.order_id, p_session: s.id });
  const expected = expectedPrices({ category: "topics", from: order.from_limit, to: order.to_limit, sixm });
  const out = await applyPayment(order.order_id, s, userId, payEnv, samePrices(s.line_items?.data ?? [], expected));
  return { legacy: true, ...out };
}

// ── 订阅 ────────────────────────────────────────────────────────
function invoiceSubscriptionId(inv: Any): string | null {
  return idOf(inv?.parent?.subscription_details?.subscription) ?? idOf(inv?.subscription) ??
    idOf(inv?.lines?.data?.find((l: Any) => l?.parent?.subscription_item_details?.subscription)
      ?.parent?.subscription_item_details?.subscription) ?? null;
}

async function userForSubscription(sub: Any): Promise<string> {
  const m = sub?.metadata?.supabase_user_id;
  if (validUuid(m)) return m;
  const s = await db("GET", "subscriptions?select=user_id&stripe_subscription_id=eq." + encodeURIComponent(sub.id));
  if (s.ok && validUuid(s.data?.[0]?.user_id)) return s.data[0].user_id;
  const cust = idOf(sub.customer);
  if (cust) {
    const c = await db("GET", "billing_customers?select=user_id&stripe_customer_id=eq." + encodeURIComponent(cust));
    if (c.ok && validUuid(c.data?.[0]?.user_id)) return c.data[0].user_id;
  }
  throw new Error("cannot identify subscription user " + sub.id);
}

function subPayload(sub: Any, userId: string, payEnv: string): Any {
  const item = sub?.items?.data?.[0] ?? {};
  const periodEnd = sub.current_period_end ?? item.current_period_end;
  // 新版 API 可能用 cancel_at 表示「在期末取消」
  const cancelScheduled = Boolean(sub.cancel_at_period_end) ||
    (sub.cancel_at != null && periodEnd != null && Number(sub.cancel_at) <= Number(periodEnd) + 1);
  return {
    p_user: userId, p_env: payEnv, p_customer: idOf(sub.customer), p_sub: sub.id,
    p_price: idOf(item.price) ?? env("STRIPE_PRICE_INNER_TOOLS_MONTHLY"),
    p_status: sub.status,
    p_period_start: isoFromUnix(sub.current_period_start ?? item.current_period_start),
    p_period_end: isoFromUnix(periodEnd),
    p_cancel_at_period_end: cancelScheduled,
  };
}

// 取 Stripe 最新的订阅 → 同步 → 如果「应该期末取消」还没生效，就去设定
async function syncSubscription(subId: string, payEnv: string): Promise<Any> {
  let sub = await stripe("GET", "/subscriptions/" + encodeURIComponent(subId));
  const userId = await userForSubscription(sub);
  let r = await rpc("upsert_subscription", subPayload(sub, userId, payEnv));
  if (r?.cancel_needed) {
    sub = await stripe("POST", "/subscriptions/" + encodeURIComponent(subId), { cancel_at_period_end: true });
    r = await rpc("upsert_subscription", subPayload(sub, userId, payEnv));
    if (r?.cancel_needed) throw new Retryable("cancel_at_period_end not confirmed for " + subId);
    return { subscription: subId, cancel_scheduled: true };
  }
  return { subscription: subId };
}

async function onInvoicePaid(inv: Any, payEnv: string): Promise<Any> {
  const subId = invoiceSubscriptionId(inv);
  if (!subId) return { recorded: false };
  await syncSubscription(subId, payEnv);                 // 确保订阅资料存在
  const sub = await stripe("GET", "/subscriptions/" + encodeURIComponent(subId));
  const userId = await userForSubscription(sub);
  const ends = (inv.lines?.data ?? []).map((l: Any) => Number(l?.period?.end)).filter((n: number) => Number.isFinite(n) && n > 0);
  const periodEnd = isoFromUnix(ends.length ? Math.max(...ends) : inv.period_end);
  if (!periodEnd) throw new Error("invoice without period end " + inv.id);
  const r = await rpc("record_invoice_paid", {
    p_user: userId, p_env: payEnv, p_sub: subId, p_invoice: inv.id,
    p_price: idOf(inv.lines?.data?.[0]?.pricing?.price_details?.price) ?? idOf(inv.lines?.data?.[0]?.price) ?? null,
    p_amount: inv.amount_paid ?? null, p_currency: inv.currency ?? null, p_period_end: periodEnd,
    p_is_renewal: inv.billing_reason !== "subscription_create",
  });
  if (r?.cancel_needed) await syncSubscription(subId, payEnv);
  return { subscription: subId, invoice: inv.id };
}

if (G.Deno?.serve) G.Deno.serve(handler);
