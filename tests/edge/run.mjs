// 新版 create-checkout-session / stripe-webhook 的本机整合测试
// 用法：PGHOST=... PGPORT=... PGUSER=postgres node tests/edge/run.mjs
import {
  setEnv, createDb, resetDb, FakeStripe, installFetch, signedEvent, checkoutRequest, USERS, PRICES,
} from "./harness.mjs";

setEnv();
const checkout = (await import("../../docs/edge/create-checkout-session.ts")).handler;
const webhook = (await import("../../docs/edge/stripe-webhook.ts")).handler;

let pass = 0;
const failures = [];
function ok(cond, label, extra) {
  if (cond) { pass++; return; }
  failures.push(label + (extra !== undefined ? "  → " + JSON.stringify(extra) : ""));
}
// 测试过程中预期会出现的 console.error / warn 不印出来
const quiet = { error: console.error, warn: console.warn };
console.error = () => {}; console.warn = () => {};

const { pool, drop } = await createDb();
let stripe;
const q = async (sql, args = []) => (await pool.query(sql, args)).rows;
const one = async (sql, args = []) => (await q(sql, args))[0];
async function fresh(testUsers = [USERS.A]) {
  await resetDb(pool);
  for (const u of testUsers) await pool.query("insert into public.billing_test_users (user_id) values ($1)", [u]);
  stripe = new FakeStripe();
  installFetch({ pool, stripe });
  setEnv();
}
async function buy(token, body) {
  const r = await checkout(checkoutRequest(token, body));
  return { status: r.status, body: await r.json() };
}
const lastSession = () => Object.values(stripe.sessions).at(-1);
async function send(type, object, opts) {
  const r = await webhook(signedEvent(type, object, opts));
  return { status: r.status, body: await r.json() };
}
const topicsOf = async (u) => (await q("select topic_id from public.entitlement_topics where user_id=$1 order by topic_id", [u])).map((r) => r.topic_id);
const ent = (u) => one("select * from public.entitlements where user_id=$1", [u]);
const near = (d, ms) => Math.abs(new Date(d).getTime() - ms) < 10_000;
const DAY = 86400_000;

async function scenario(name, fn) {
  try { await fn(); } catch (e) { failures.push(`${name}: 例外 ${e?.stack || e}`); }
}

// ═══════════════ create-checkout-session ═══════════════
await scenario("C1 设定", async () => {
  await fresh();
  setEnv({ STRIPE_SECRET_KEY: "sk_live_x" });
  ok((await buy("tokA", { plan: "complete" })).status === 500, "C1 PAYMENTS_ENV=test 但用 live 金钥 → 拒绝");
  setEnv({ PAYMENTS_ENV: "" });
  ok((await buy("tokA", { plan: "complete" })).status === 500, "C1 没有 PAYMENTS_ENV → 拒绝");
  setEnv();
  ok(Object.keys(stripe.calls).length === 0, "C1 设定错误时完全不呼叫 Stripe");
});

await scenario("C2 登录与名单", async () => {
  await fresh();
  ok((await buy(null, { plan: "complete" })).status === 401, "C2 没有 token → 401");
  ok((await buy("tokX", { plan: "complete" })).status === 401, "C2 无效 token → 401");
  const r = await buy("tokB", { plan: "complete" });
  ok(r.status === 403 && r.body.code === "payments_not_enabled", "C2 不在测试名单 → 403", r);
  ok((await q("select * from public.checkout_orders")).length === 0, "C2 被拒时不建立订单");
});

await scenario("C3 方案验证", async () => {
  await fresh();
  const cases = [
    [{ plan: "topics_3", topic_ids: ["self", "career"] }, "invalid_topics"],
    [{ plan: "topics_3", topic_ids: ["self", "career", "body", "love"] }, "invalid_topics"],
    [{ plan: "topics_3", topic_ids: ["self", "self", "body"] }, "invalid_topics"],
    [{ plan: "topics_3", topic_ids: ["self", "money", "body"] }, "invalid_topics"],
    [{ plan: "topics_6", topic_ids: ["self", "career", "body", "love", "study"] }, "invalid_topics"],
    [{ plan: "topics_3", topic_ids: ["self", "career", "body"], include_inner_tools_6m: true }, "addon_not_allowed"],
    [{ plan: "topic_upgrade" }, "upgrade_not_available"],
    [{ plan: "free_stuff" }, "invalid_plan"],
    [{ plan: "topics_3", topic_ids: ["self", "career", "<script>"] }, "invalid_topics"],
  ];
  for (const [body, code] of cases) {
    const r = await buy("tokA", body);
    ok(r.status >= 400 && r.status < 500 && r.body.code === code, `C3 ${JSON.stringify(body)} → ${code}`, r);
  }
  ok(Object.values(stripe.sessions).length === 0, "C3 验证失败时不建立任何 Stripe session");
});

await scenario("C4 正常建立 topics_3", async () => {
  await fresh();
  const r = await buy("tokA", { plan: "topics_3", topic_ids: ["self", "family", "body"] });
  ok(r.status === 200 && /^https:\/\/checkout\.stripe\.com\//.test(r.body.url), "C4 回传 Stripe 网址", r);
  const s = lastSession(), f = s._form;
  const order = await one("select * from public.checkout_orders");
  ok(order.status === "open" && order.stripe_checkout_session_id === s.id, "C4 订单 open 并对应 session");
  ok(f.customer && f.customer.startsWith("cus_test") && f.customer_email === undefined, "C4 用 Stripe Customer，不用 customer_email");
  ok(f.payment_method_types.join(",") === "card,paynow" && f.mode === "payment", "C4 一次性付款：Card + PayNow");
  ok(f.metadata.order_id === order.id && f.metadata.topic_ids === "body,family,self" && f.metadata.category === "topics", "C4 metadata 带订单与 topic");
  ok(f.line_items.length === 1 && f.line_items[0].price === PRICES.STRIPE_PRICE_3_TOPICS, "C4 Price ID 由服务器决定");
  ok(Math.abs(Number(f.expires_at) - (Date.now() / 1000 + 31 * 60)) < 30, "C4 session 31 分钟后过期");
  const created = stripe.calls.find((c) => c.method === "POST" && c.path === "/checkout/sessions");
  ok(created.idem === "checkout-" + order.id, "C4 Idempotency-Key = 订单 id");
  ok(stripe.calls.every((c) => c.version === "2026-07-29.dahlia"), "C4 所有 Stripe 呼叫固定 API 版本");
  const cust = await one("select * from public.billing_customers");
  ok(cust.user_id === USERS.A && cust.environment === "test", "C4 记录 billing_customers");
  await buy("tokA", { plan: "complete" });
  ok(Object.keys(stripe.customers).length === 1, "C4 第二次沿用同一个 Customer");
});

await scenario("C5 新单取代旧单", async () => {
  await fresh();
  await buy("tokA", { plan: "topics_3", topic_ids: ["self", "family", "body"] });
  const s1 = lastSession();
  const r = await buy("tokA", { plan: "complete" });
  ok(r.status === 200, "C5 第二张建立成功", r);
  ok(stripe.sessions[s1.id].status === "expired", "C5 旧 session 在 Stripe 上已 expire");
  const old = await one("select * from public.checkout_orders where stripe_checkout_session_id=$1", [s1.id]);
  ok(old.status === "superseded" && old.expire_confirmed_at, "C5 旧订单 superseded 且已确认 expire");
  ok((await q("select * from public.checkout_orders where status in ('creating','open')")).length === 1, "C5 同时只有一张有效订单");
});

await scenario("C6 Stripe 上的孤儿 session 也会被 expire", async () => {
  await fresh();
  await buy("tokA", { plan: "complete" });
  const cus = Object.keys(stripe.customers)[0];
  // 模拟：上一次建立 session 后函数当掉，资料库没有记录
  const [, orphan] = await stripe.route("POST", "/checkout/sessions", { mode: "payment", customer: cus, metadata: { category: "topics" } });
  const [, monthly] = await stripe.route("POST", "/checkout/sessions", { mode: "subscription", customer: cus, metadata: { category: "inner_tools_sub" } });
  await buy("tokA", { plan: "topics_6", topic_ids: ["self", "career", "body", "love", "study", "wealth"] });
  ok(stripe.sessions[orphan.id].status === "expired", "C6 资料库没有记录的 topic session 也被 expire");
  ok(stripe.sessions[monthly.id].status === "open", "C6 不同类别（Monthly）的 session 不受影响");
});

await scenario("C7 expire 无法确认 → 不回传网址", async () => {
  await fresh();
  await buy("tokA", { plan: "complete" });
  const s1 = lastSession();
  stripe.failNext("POST", /\/expire$/, "network");
  const r = await buy("tokA", { plan: "topics_3", topic_ids: ["self", "love", "body"] });
  ok(r.status === 503 && !r.body.url, "C7 expire 网络错误 → 503，不回传网址", r);
  ok(stripe.sessions[s1.id].status === "open", "C7 旧 session 仍是唯一可付款的一张");
  ok(Object.values(stripe.sessions).length === 1, "C7 没有建立新 session");
  const r2 = await buy("tokA", { plan: "topics_3", topic_ids: ["self", "love", "body"] });
  ok(r2.status === 200 && stripe.sessions[s1.id].status === "expired", "C7 下一次会再 expire 旧的并成功", r2);
});

await scenario("C8 旧 session 已付款 → 409", async () => {
  await fresh();
  await buy("tokA", { plan: "topics_3", topic_ids: ["self", "love", "body"] });
  const s1 = lastSession();
  stripe.complete(s1.id, { paid: true });            // 已付款但 webhook 还没到
  const r = await buy("tokA", { plan: "complete" });
  ok(r.status === 409 && r.body.code === "previous_payment_completed", "C8 不按旧状态建立新单", r);
  ok(Object.values(stripe.sessions).length === 1, "C8 没有建立新 session");
  ok((await one("select count(*)::int n from public.checkout_orders where status='failed'")).n === 1, "C8 新订单标记 failed");
});

await scenario("C9 并发：建立途中被另一个请求取代", async () => {
  await fresh();
  stripe.hooks.beforeCreateSession = async () => {
    stripe.hooks.beforeCreateSession = null;
    // 另一个请求在这一刻抢先建立订单
    await pool.query(`begin; set local role service_role;
      select public.reserve_checkout_order('${USERS.A}','test','complete',null,false); commit;`);
  };
  const r = await buy("tokA", { plan: "topics_3", topic_ids: ["self", "love", "body"] });
  ok(r.status === 409 && r.body.code === "superseded" && !r.body.url, "C9 被取代 → 409，不回传网址", r);
  ok(lastSession().status === "expired", "C9 自己刚建立的 session 立刻 expire");
});

await scenario("C10 Monthly", async () => {
  await fresh();
  const r = await buy("tokA", { plan: "inner_tools_monthly" });
  const f = lastSession()._form;
  ok(r.status === 200 && f.mode === "subscription" && f.payment_method_types.join(",") === "card", "C10 订阅模式只用 Card", r);
  ok(f.subscription_data.metadata.supabase_user_id === USERS.A && !f.payment_intent_data, "C10 订阅带 user metadata");
  ok(f.line_items[0].price === PRICES.STRIPE_PRICE_INNER_TOOLS_MONTHLY, "C10 Monthly Price ID");
  const r2 = await buy("tokA", { plan: "complete", include_inner_tools_6m: true });
  ok(r2.status === 200 && lastSession()._form.line_items.map((x) => x.price).join(",") === `${PRICES.STRIPE_PRICE_COMPLETE},${PRICES.STRIPE_PRICE_INNER_TOOLS_6M}`, "C10 Complete + 6M：两个 line items", r2);
  ok(Object.values(stripe.sessions).filter((s) => s.status === "open").length === 2, "C10 Monthly 与 topic 的 checkout 互不取代");
});

// ═══════════════ stripe-webhook ═══════════════
await scenario("W1 签名与环境", async () => {
  await fresh();
  const bad = await webhook(signedEvent("checkout.session.completed", { id: "cs_x" }, { secret: "wrong" }));
  ok(bad.status === 400, "W1 签名错误 → 400");
  const stale = await webhook(signedEvent("checkout.session.completed", { id: "cs_x" }, { ts: Math.floor(Date.now() / 1000) - 600 }));
  ok(stale.status === 400, "W1 时间戳过期 → 400");
  const live = await send("checkout.session.completed", { id: "cs_x" }, { livemode: true });
  ok(live.status === 200 && live.body.ignored === "environment_mismatch", "W1 live 事件送到 test 部署 → 忽略", live);
  ok(stripe.calls.length === 0, "W1 被拒的事件完全不呼叫 Stripe");
});

await scenario("W2 topics_3 付款 + 重送", async () => {
  await fresh();
  await buy("tokA", { plan: "topics_3", topic_ids: ["self", "family", "body"] });
  const s = stripe.complete(lastSession().id, { paid: true, amount: 688 });
  const r = await send("checkout.session.completed", { id: s.id });
  ok(r.status === 200 && r.body.result === "applied", "W2 套用", r);
  ok((await topicsOf(USERS.A)).join() === "body,family,self" && (await ent(USERS.A)).topic_limit === 3, "W2 正好是选的三个");
  const again = await send("checkout.session.completed", { id: s.id });
  ok(again.status === 200 && again.body.result === "duplicate", "W2 重送 → duplicate", again);
  ok((await topicsOf(USERS.A)).length === 3 && (await one("select count(*)::int n from public.purchases")).n === 1, "W2 重送不重复写入");
  const p = await one("select * from public.purchases");
  ok(p.entitlement_status === "applied" && p.price_id === PRICES.STRIPE_PRICE_3_TOPICS && p.stripe_payment_intent_id, "W2 付款记录完整");
});

await scenario("W3 PayNow 成功", async () => {
  await fresh();
  await buy("tokA", { plan: "complete" });
  const s = stripe.complete(lastSession().id, { paid: false, amount: 1688 });
  const r = await send("checkout.session.completed", { id: s.id });
  ok(r.body.result === "processing" && (await topicsOf(USERS.A)).length === 0, "W3 付款确认前不发放", r);
  const blocked = await buy("tokA", { plan: "topics_3", topic_ids: ["self", "love", "body"] });
  ok(blocked.status === 409 && blocked.body.code === "payment_processing", "W3 确认中不能开新单", blocked);
  s.payment_status = "paid";
  const r2 = await send("checkout.session.async_payment_succeeded", { id: s.id });
  ok(r2.body.result === "applied" && (await topicsOf(USERS.A)).length === 9, "W3 确认成功 → Complete", r2);
});

await scenario("W4 PayNow 失败", async () => {
  await fresh();
  await buy("tokA", { plan: "complete" });
  const s = stripe.complete(lastSession().id, { paid: false });
  await send("checkout.session.completed", { id: s.id });
  const r = await send("checkout.session.async_payment_failed", { id: s.id });
  ok(r.body.result === "payment_failed", "W4 付款失败", r);
  ok((await one("select status from public.checkout_orders")).status === "failed" && (await topicsOf(USERS.A)).length === 0, "W4 订单 failed、不发放");
  ok((await buy("tokA", { plan: "complete" })).status === 200, "W4 之后可以重新购买");
});

await scenario("W5 Price ID 不符", async () => {
  await fresh();
  await buy("tokA", { plan: "topics_3", topic_ids: ["self", "love", "body"] });
  const s = stripe.complete(lastSession().id, { paid: true });
  s.line_items.data[0].price.id = "price_test_something_else";
  const r = await send("checkout.session.completed", { id: s.id });
  ok(r.body.result === "conflict" && (await topicsOf(USERS.A)).length === 0, "W5 → paid_conflict，不发放", r);
});

await scenario("W6 paid_conflict 与被取代但仍合法", async () => {
  await fresh();
  await buy("tokA", { plan: "topics_3", topic_ids: ["self", "love", "body"] });
  const sA = lastSession();
  await buy("tokA", { plan: "complete" });
  const sB = lastSession();
  stripe.complete(sB.id, { paid: true, amount: 1688 });
  stripe.complete(sA.id, { paid: true, amount: 688 });   // 极端：两张同时付款成功
  await send("checkout.session.completed", { id: sB.id });
  const r = await send("checkout.session.completed", { id: sA.id });
  ok(r.body.result === "conflict", "W6 旧单晚到 → conflict", r);
  ok((await ent(USERS.A)).topic_limit === 9 && (await topicsOf(USERS.A)).length === 9, "W6 权限不被改动");
  const p = await one("select * from public.purchases where stripe_session_id=$1", [sA.id]);
  ok(p && p.entitlement_status === "conflict", "W6 付款记录保留并标记 conflict");

  await fresh();
  await buy("tokA", { plan: "topics_3", topic_ids: ["self", "love", "body"] });
  const a = lastSession();
  stripe.complete(a.id, { paid: true });               // 已付款，但 webhook 还没到
  await pool.query("update public.checkout_orders set status='superseded' where stripe_checkout_session_id=$1", [a.id]);
  const r2 = await send("checkout.session.completed", { id: a.id });
  ok(r2.body.result === "applied" && (await topicsOf(USERS.A)).length === 3, "W6 被取代但转换仍合法 → 照 Stripe 收款发放", r2);
});

await scenario("W7 expired 事件", async () => {
  await fresh();
  await buy("tokA", { plan: "complete" });
  const s = lastSession();
  s.status = "expired";
  await send("checkout.session.expired", { id: s.id });
  ok((await one("select status from public.checkout_orders")).status === "expired", "W7 订单 expired");
  await buy("tokA", { plan: "complete" });
  const s2 = stripe.complete(lastSession().id, { paid: true, amount: 1688 });
  await send("checkout.session.completed", { id: s2.id });
  await send("checkout.session.expired", { id: s2.id });
  ok((await one("select status from public.checkout_orders where stripe_checkout_session_id=$1", [s2.id])).status === "paid", "W7 expired 事件不影响已付款订单");
});

await scenario("W8 旧版 checkout（没有 order_id）", async () => {
  await fresh();
  const legacy = (plan, extra = {}) => {
    const [, s] = [0, { id: "cs_test_legacy_" + plan + Math.random().toString(36).slice(2, 6), object: "checkout.session",
      status: "complete", payment_status: "paid", mode: "payment", customer: null, client_reference_id: USERS.A,
      metadata: { supabase_user_id: USERS.A, plan_code: plan, ...extra }, amount_total: 1688, currency: "sgd",
      payment_intent: "pi_legacy", subscription: null, line_items: { data: [] } }];
    stripe.sessions[s.id] = s;
    return s;
  };
  const c = legacy("complete");
  c.line_items.data = [{ price: { id: PRICES.STRIPE_PRICE_COMPLETE } }];
  const r = await send("checkout.session.completed", { id: c.id });
  ok(r.body.legacy && r.body.result === "applied" && (await topicsOf(USERS.A)).length === 9, "W8 旧版 Complete → 正常发放 9 个主题", r);
  const again = await send("checkout.session.completed", { id: c.id });
  ok(again.body.result === "duplicate" && (await one("select count(*)::int n from public.purchases")).n === 1, "W8 旧版重送 → 不重复", again);

  await fresh();
  const t3 = legacy("topics_3");
  t3.line_items.data = [{ price: { id: PRICES.STRIPE_PRICE_3_TOPICS } }];
  const r3 = await send("checkout.session.completed", { id: t3.id });
  const p3 = await one("select * from public.purchases where stripe_session_id=$1", [t3.id]);
  ok(r3.body.result === "recorded_for_review" && p3.entitlement_status === "legacy", "W8 旧版 topics_3（不知道选了哪三个）→ 记录交人工", r3);

  await fresh();
  await pool.query("insert into public.entitlements (user_id, topic_limit) values ($1, 3)", [USERS.A]);
  await pool.query("insert into public.entitlement_topics (user_id, topic_id) values ($1,'self'),($1,'love'),($1,'body')", [USERS.A]);
  const up = legacy("upgrade_to_complete", { upgrade_from: "3" });
  up.line_items.data = [{ price: { id: PRICES.STRIPE_PRICE_COMPLETE_UPGRADE } }];
  const ru = await send("checkout.session.completed", { id: up.id });
  ok(ru.body.result === "applied" && (await topicsOf(USERS.A)).length === 9 && (await ent(USERS.A)).life_thread_access, "W8 旧版 3→Complete → 正常发放", ru);
});

await scenario("W9 Monthly → Complete + 6M → 期末取消", async () => {
  await fresh();
  // Monthly
  await buy("tokA", { plan: "inner_tools_monthly" });
  const cus = Object.keys(stripe.customers)[0];
  const sub = stripe.createSubscription(USERS.A, cus, { periodEnd: Math.floor((Date.now() + 30 * DAY) / 1000) });
  const ms = stripe.complete(lastSession().id, { paid: true, amount: 99, subscription: sub.id });
  const r1 = await send("checkout.session.completed", { id: ms.id });
  ok(r1.body.result === "subscription_recorded", "W9 Monthly checkout 记录", r1);
  const firstInv = { id: "in_test_1", billing_reason: "subscription_create", amount_paid: 99, currency: "sgd",
    parent: { subscription_details: { subscription: sub.id } },
    lines: { data: [{ period: { end: Math.floor((Date.now() + 30 * DAY) / 1000) } }] } };
  await send("invoice.paid", firstInv);
  ok(near((await ent(USERS.A)).inner_tools_until, Date.now() + 30 * DAY), "W9 Monthly：用到已付期限");
  ok((await one("select count(*)::int n from public.purchases where stripe_invoice_id is not null")).n === 0, "W9 第一期不重复记录");

  // Complete + 6M，取消 API 第一次失败
  await buy("tokA", { plan: "complete", include_inner_tools_6m: true });
  const cs = stripe.complete(lastSession().id, { paid: true, amount: 1976 });
  stripe.failNext("POST", /^\/subscriptions\//, 500);
  const r2 = await send("checkout.session.completed", { id: cs.id });
  ok(r2.status === 500, "W9 取消失败 → 500 让 Stripe 重送", r2);
  ok((await topicsOf(USERS.A)).length === 9, "W9 但 Complete 已经发放（同一个 transaction 已提交）");
  const sixmEnd = new Date((await ent(USERS.A)).inner_tools_until).getTime() - (Date.now() + 30 * DAY);
  ok(sixmEnd > 179 * DAY && sixmEnd < 185 * DAY, "W9 6M 接在 Monthly 已付期限之后（+6 个月）", sixmEnd / DAY);
  const r3 = await send("checkout.session.completed", { id: cs.id });
  ok(r3.status === 200 && r3.body.result === "duplicate" && stripe.subs[sub.id].cancel_at_period_end === true, "W9 重送 → 取消成功、不重复加 6 个月", r3);
  const untilAfter = (await ent(USERS.A)).inner_tools_until;

  // 用户在 Portal 恢复订阅 → 重新取消
  stripe.subs[sub.id].cancel_at_period_end = false;
  const r4 = await send("customer.subscription.updated", { id: sub.id });
  ok(r4.body.cancel_scheduled === true && stripe.subs[sub.id].cancel_at_period_end === true, "W9 Portal 恢复 → 重新设定期末取消", r4);

  // invoice.created 也会对账
  stripe.subs[sub.id].cancel_at_period_end = false;
  await send("invoice.created", { id: "in_test_draft", parent: { subscription_details: { subscription: sub.id } } });
  ok(stripe.subs[sub.id].cancel_at_period_end === true, "W9 invoice.created → 对账取消（不动发票）");

  // 取消还是没赶上、续费成功
  const renewEnd = Math.floor((Date.now() + 60 * DAY) / 1000);
  await send("invoice.paid", { id: "in_test_2", billing_reason: "subscription_cycle", amount_paid: 99, currency: "sgd",
    parent: { subscription_details: { subscription: sub.id } }, lines: { data: [{ period: { end: renewEnd } }] } });
  const p = await one("select * from public.purchases where stripe_invoice_id='in_test_2'");
  ok(p && p.entitlement_status === "review", "W9 取消后仍续费 → 标记 review");
  ok(new Date((await ent(USERS.A)).inner_tools_until) > new Date(untilAfter), "W9 多付的一期不浪费：6M 起点往后移");
  await send("invoice.paid", { id: "in_test_2", billing_reason: "subscription_cycle", amount_paid: 99, currency: "sgd",
    parent: { subscription_details: { subscription: sub.id } }, lines: { data: [{ period: { end: renewEnd } }] } });
  ok((await one("select count(*)::int n from public.purchases where stripe_invoice_id='in_test_2'")).n === 1, "W9 同一张 invoice 只记一次");

  // 订阅结束：不缩短
  const before = (await ent(USERS.A)).inner_tools_until;
  stripe.subs[sub.id].status = "canceled";
  await send("customer.subscription.deleted", { id: sub.id });
  ok(new Date((await ent(USERS.A)).inner_tools_until).getTime() === new Date(before).getTime(), "W9 订阅结束不缩短权限");
  const m2 = await buy("tokA", { plan: "inner_tools_monthly" });
  ok(m2.status === 409 && m2.body.code === "inner_tools_6m_active", "W9 6M 期间不能再订 Monthly", m2);
});

await scenario("W10 订阅找人：metadata 缺失时用 billing_customers", async () => {
  await fresh();
  await buy("tokA", { plan: "inner_tools_monthly" });
  const cus = Object.keys(stripe.customers)[0];
  const sub = stripe.createSubscription(USERS.A, cus, { metadata: {} });
  const r = await send("customer.subscription.updated", { id: sub.id });
  ok(r.status === 200 && (await one("select user_id from public.subscriptions")).user_id === USERS.A, "W10 由 Customer 找到用户", r);
  const unknown = stripe.createSubscription(USERS.A, "cus_unknown", { metadata: {} });
  const r2 = await send("customer.subscription.updated", { id: unknown.id });
  ok(r2.status === 200 && r2.body.recorded === false, "W10 找不到用户 → 记录问题，不无限重送", r2);
});

await scenario("W11 暂时性错误 → 500", async () => {
  await fresh();
  await buy("tokA", { plan: "complete" });
  const s = stripe.complete(lastSession().id, { paid: true, amount: 1688 });
  stripe.failNext("GET", /^\/checkout\/sessions\//, "network");
  const r = await send("checkout.session.completed", { id: s.id });
  ok(r.status === 500 && (await topicsOf(USERS.A)).length === 0, "W11 Stripe 连不上 → 500、不发放", r);
  const r2 = await send("checkout.session.completed", { id: s.id });
  ok(r2.status === 200 && (await topicsOf(USERS.A)).length === 9, "W11 Stripe 重送后成功", r2);
});

console.error = quiet.error; console.warn = quiet.warn;
await drop();
if (failures.length) {
  console.log("失败：");
  failures.forEach((f) => console.log("  ✗ " + f));
  console.log(`Edge Function 测试：通过 ${pass}，失败 ${failures.length}`);
  process.exit(1);
}
console.log(`Edge Function 测试全部通过：${pass} 项`);
