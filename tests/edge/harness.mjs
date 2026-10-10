// Edge Function 本机测试工具
// ------------------------------------------------------------------
// · 资料库：本机 PostgreSQL，套用 tests/sql/00_mock_supabase.sql + docs/sql/payments_stage1.sql，
//   用一个很小的 PostgREST 模拟层接 /rest/v1/rpc/* 与少数表格读写 —— 呼叫的是【真实的】SQL 函数，
//   而且每个 RPC 都以 service_role 身分执行（会一起验证 GRANT）。
// · Stripe：记忆体里的假 Stripe（customers / checkout sessions / subscriptions / 幂等键 / 故障注入）
// · Webhook：用同一把 secret 计算签名
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import pg from "pg";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
export const SUPABASE_URL = "https://supabase.test";
export const WEBHOOK_SECRET = "test_webhook_secret_for_local_tests";
export const USERS = {
  A: "aaaaaaaa-0000-4000-8000-000000000001",
  B: "bbbbbbbb-0000-4000-8000-000000000002",
  C: "cccccccc-0000-4000-8000-000000000003",
};
export const TOKENS = { tokA: USERS.A, tokB: USERS.B, tokC: USERS.C };
export const PRICES = {
  STRIPE_PRICE_3_TOPICS: "price_test_t3", STRIPE_PRICE_6_TOPICS: "price_test_t6",
  STRIPE_PRICE_COMPLETE: "price_test_complete", STRIPE_PRICE_INNER_TOOLS_6M: "price_test_6m",
  STRIPE_PRICE_INNER_TOOLS_MONTHLY: "price_test_monthly", STRIPE_PRICE_TOPIC_UPGRADE: "price_test_up5",
  STRIPE_PRICE_COMPLETE_UPGRADE: "price_test_up10",
};

export function setEnv(overrides = {}) {
  Object.assign(process.env, {
    PAYMENTS_ENV: "test", STRIPE_SECRET_KEY: "sk_test_local", STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    SUPABASE_URL, SUPABASE_ANON_KEY: "anon_local", SUPABASE_SERVICE_ROLE_KEY: "service_local",
    ...PRICES, ...overrides,
  });
}

// ── 资料库 ──────────────────────────────────────────────────────
export async function createDb() {
  const name = "edge_test_" + process.pid;
  const admin = new pg.Client({ database: "postgres" });
  await admin.connect();
  await admin.query(`drop database if exists ${name}`);
  await admin.query(`create database ${name}`);
  await admin.end();
  const pool = new pg.Pool({ database: name, max: 4 });
  await pool.query(fs.readFileSync(path.join(ROOT, "tests/sql/00_mock_supabase.sql"), "utf8"));
  await pool.query(fs.readFileSync(path.join(ROOT, "docs/sql/payments_stage1.sql"), "utf8"));
  await pool.query(fs.readFileSync(path.join(ROOT, "docs/sql/payments_stage1b.sql"), "utf8"));
  await pool.query(`insert into auth.users values ('${USERS.C}') on conflict do nothing`);
  return {
    pool,
    async drop() {
      await pool.end();
      const a = new pg.Client({ database: "postgres" });
      await a.connect();
      await a.query(`drop database if exists ${name}`);
      await a.end();
    },
  };
}
export async function resetDb(pool) {
  await pool.query(`truncate public.purchases, public.checkout_orders, public.entitlement_topics,
    public.entitlements, public.subscriptions, public.billing_customers, public.billing_test_users, public.early_access_users cascade`);
  await pool.query(`update public.billing_settings set enforcement_mode = 'test_accounts'`);
}

// 极简 PostgREST：只实作 Edge Function 用得到的那几种
async function postgrest(pool, method, urlPath, headers, body) {
  const auth = headers["Authorization"] || headers["authorization"] || "";
  if (auth !== "Bearer service_local") return [401, { message: "not service role" }];
  const u = new URL("http://x" + urlPath);
  const p = u.pathname.replace(/^\/rest\/v1\//, "");
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local role service_role");
    let res;
    if (p.startsWith("rpc/")) {
      const fn = p.slice(4);
      const args = body || {};
      const names = Object.keys(args);
      const sql = `select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(", ")}) as r`;
      const q = await client.query(sql, names.map((n) => args[n]));
      res = [200, q.rows[0].r === "" ? null : q.rows[0].r];
    } else if (method === "GET") {
      const cols = (u.searchParams.get("select") || "*").split(",").map((c) => `"${c}"`).join(",");
      const where = [], vals = [];
      for (const [k, v] of u.searchParams) {
        if (k === "select") continue;
        const m = /^eq\.(.*)$/.exec(v);
        if (!m) throw new Error("unsupported filter " + v);
        vals.push(m[1]); where.push(`"${k}"::text = $${vals.length}`);
      }
      const q = await client.query(`select ${cols} from public."${p}"${where.length ? " where " + where.join(" and ") : ""}`, vals);
      res = [200, q.rows];
    } else if (method === "POST") {
      const rows = Array.isArray(body) ? body : [body];
      const keys = Object.keys(rows[0]);
      const ignore = String(headers["Prefer"] || "").includes("ignore-duplicates");
      for (const r of rows) {
        await client.query(`insert into public."${p}" (${keys.map((k) => `"${k}"`).join(",")})
          values (${keys.map((_, i) => `$${i + 1}`).join(",")})${ignore ? " on conflict do nothing" : ""}`,
          keys.map((k) => r[k]));
      }
      res = [201, null];
    } else throw new Error("unsupported " + method + " " + p);
    await client.query("commit");
    return res;
  } catch (e) {
    await client.query("rollback").catch(() => {});
    const status = e.code === "P0001" ? 400 : /^23/.test(e.code || "") ? 409 : e.code === "42501" ? 403 : 500;
    return [status, { code: e.code, message: e.message }];
  } finally { client.release(); }
}

// ── 假 Stripe ───────────────────────────────────────────────────
function parseForm(str) {
  const out = {};
  for (const [k, v] of new URLSearchParams(str || "")) {
    const parts = k.replace(/\]/g, "").split("[");
    let cur = out;
    parts.forEach((p, i) => {
      const last = i === parts.length - 1;
      const nextIsIndex = !last && /^\d+$/.test(parts[i + 1]);
      if (last) cur[p] = v;
      else cur = cur[p] ??= nextIsIndex ? [] : {};
    });
  }
  return out;
}
let seq = 0;
const nid = (p) => `${p}_${(++seq).toString(36)}${crypto.randomBytes(3).toString("hex")}`;

export class FakeStripe {
  constructor() {
    this.customers = {}; this.sessions = {}; this.subs = {}; this.idem = {};
    this.calls = []; this.faults = []; this.hooks = {};
  }
  // 下一次符合的呼叫故意失败：kind = "network" | 状态码
  failNext(method, pathRe, kind) { this.faults.push({ method, pathRe, kind }); }
  async handle(method, url, headers, body) {
    const u = new URL(url);
    const p = u.pathname.replace(/^\/v1/, "");
    const form = method === "GET" ? parseForm(u.search.slice(1)) : parseForm(body);
    this.calls.push({ method, path: p, form, idem: headers["Idempotency-Key"], version: headers["Stripe-Version"] });
    const fi = this.faults.findIndex((f) => f.method === method && f.pathRe.test(p));
    if (fi >= 0) {
      const f = this.faults.splice(fi, 1)[0];
      if (f.kind === "network") throw new TypeError("fetch failed (injected)");
      return [f.kind, { error: { message: "injected failure" } }];
    }
    const key = headers["Idempotency-Key"];
    if (key && method === "POST" && this.idem[key]) return this.idem[key];
    const res = await this.route(method, p, form);
    if (key && method === "POST" && res[0] < 400) this.idem[key] = res;
    return res;
  }
  async route(method, p, f) {
    let m;
    if (method === "POST" && p === "/customers") {
      const id = nid("cus_test");
      this.customers[id] = { id, email: f.email, metadata: f.metadata || {} };
      return [200, this.customers[id]];
    }
    if (method === "GET" && p === "/checkout/sessions") {
      const data = Object.values(this.sessions).filter((s) =>
        (!f.customer || s.customer === f.customer) && (!f.status || s.status === f.status));
      return [200, { object: "list", data }];
    }
    if (method === "POST" && p === "/checkout/sessions") {
      if (this.hooks.beforeCreateSession) await this.hooks.beforeCreateSession(f);
      const id = nid("cs_test");
      this.sessions[id] = {
        id, object: "checkout.session", url: "https://checkout.stripe.com/c/pay/" + id,
        status: "open", payment_status: "unpaid", mode: f.mode, customer: f.customer,
        client_reference_id: f.client_reference_id, metadata: f.metadata || {},
        line_items: { data: (f.line_items || []).map((li) => ({ price: { id: li.price }, quantity: Number(li.quantity) })) },
        payment_method_types: f.payment_method_types, expires_at: Number(f.expires_at),
        amount_total: 0, currency: "sgd", payment_intent: null, subscription: null, livemode: false,
        _form: f,
      };
      return [200, this.sessions[id]];
    }
    if ((m = /^\/checkout\/sessions\/([^/]+)\/expire$/.exec(p)) && method === "POST") {
      const s = this.sessions[m[1]];
      if (!s) return [404, { error: { message: "No such checkout session" } }];
      if (s.status !== "open") return [400, { error: { message: "Only Checkout Sessions with a status of open can be expired." } }];
      s.status = "expired";
      return [200, s];
    }
    if ((m = /^\/checkout\/sessions\/([^/]+)$/.exec(p)) && method === "GET") {
      const s = this.sessions[m[1]];
      return s ? [200, s] : [404, { error: { message: "No such checkout session" } }];
    }
    if ((m = /^\/subscriptions\/([^/]+)$/.exec(p))) {
      const s = this.subs[m[1]];
      if (!s) return [404, { error: { message: "No such subscription" } }];
      if (method === "POST" && f.cancel_at_period_end !== undefined) s.cancel_at_period_end = f.cancel_at_period_end === "true";
      return [200, s];
    }
    return [404, { error: { message: "fake stripe: unknown route " + method + " " + p } }];
  }
  // 测试辅助：让一张 session「完成」
  complete(id, { paid = true, amount = 688, subscription = null } = {}) {
    const s = this.sessions[id];
    s.status = "complete"; s.payment_status = paid ? "paid" : "unpaid";
    s.amount_total = amount; s.payment_intent = s.mode === "payment" ? nid("pi_test") : null;
    s.subscription = subscription;
    return s;
  }
  createSubscription(userId, customer, { periodEnd, metadata } = {}) {
    const id = nid("sub_test");
    const now = Math.floor(Date.now() / 1000);
    this.subs[id] = {
      id, object: "subscription", status: "active", customer, cancel_at_period_end: false, cancel_at: null,
      metadata: metadata ?? { supabase_user_id: userId },
      items: { data: [{ price: { id: PRICES.STRIPE_PRICE_INNER_TOOLS_MONTHLY }, current_period_start: now,
                        current_period_end: periodEnd ?? now + 30 * 86400 }] },
    };
    return this.subs[id];
  }
}

// ── fetch 路由 ──────────────────────────────────────────────────
export function installFetch({ pool, stripe }) {
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    const method = (init.method || "GET").toUpperCase();
    const headers = init.headers || {};
    let status, body;
    if (url.startsWith("https://api.stripe.com/")) {
      [status, body] = await stripe.handle(method, url, headers, init.body);
    } else if (url.startsWith(SUPABASE_URL + "/auth/v1/user")) {
      const tok = String(headers.Authorization || "").replace(/^Bearer /, "");
      const id = TOKENS[tok];
      [status, body] = id ? [200, { id, email: tok + "@example.test" }] : [401, { msg: "invalid JWT" }];
    } else if (url.startsWith(SUPABASE_URL + "/rest/v1/")) {
      [status, body] = await postgrest(pool, method, url.slice(SUPABASE_URL.length), headers,
        init.body ? JSON.parse(init.body) : undefined);
    } else throw new Error("unexpected fetch " + url);
    return new Response(body === null || body === undefined ? "" : JSON.stringify(body), { status });
  };
}

// ── Webhook 事件 ────────────────────────────────────────────────
export function signedEvent(type, object, { livemode = false, secret = WEBHOOK_SECRET, ts } = {}) {
  const payload = JSON.stringify({ id: nid("evt_test"), type, livemode, data: { object } });
  const t = ts ?? Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
  return new Request("https://fn.test/stripe-webhook", {
    method: "POST", headers: { "stripe-signature": `t=${t},v1=${sig}` }, body: payload,
  });
}
export function checkoutRequest(token, body) {
  return new Request("https://fn.test/create-checkout-session", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
    body: JSON.stringify(body),
  });
}
