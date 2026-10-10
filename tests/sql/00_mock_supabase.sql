-- 模拟 Supabase（auth.uid / auth.role / anon / authenticated / service_role），
-- 并依照正式资料库的实际结构（2026-10 查询结果）重建相关表与 RLS 规则。
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$; do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$; do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

create table public.charts (id uuid primary key, user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  data jsonb not null, created_at timestamptz default now(), updated_at timestamptz default now());
create table public.prefs (user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade, data jsonb not null default '{}', updated_at timestamptz default now());
create table public.readings (fingerprint text primary key, analysis text not null, created_at timestamptz default now());
create table public.purchases (id uuid primary key default gen_random_uuid(), user_id uuid, stripe_session_id text, price_id text,
  amount_total bigint, currency text, payment_status text, environment text, created_at timestamptz default now(),
  plan_code text, stripe_subscription_id text, constraint purchases_stripe_session_id_unique unique (stripe_session_id));
create table public.entitlements (id uuid primary key default gen_random_uuid(), user_id uuid not null, topic_limit integer not null default 0,
  life_thread_access boolean not null default false, inner_tools_until timestamptz, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), constraint entitlements_topic_limit_check check (topic_limit in (0,3,6,9)),
  constraint entitlements_user_id_unique unique (user_id));
create table public.entitlement_topics (id uuid primary key default gen_random_uuid(), user_id uuid not null, topic_id text not null,
  created_at timestamptz not null default now(), constraint entitlement_topics_user_topic_unique unique (user_id, topic_id));
create table public.subscriptions (id uuid primary key default gen_random_uuid(), user_id uuid not null, stripe_customer_id text,
  stripe_subscription_id text not null, stripe_price_id text not null, status text not null, current_period_start timestamptz,
  current_period_end timestamptz, cancel_at_period_end boolean not null default false, environment text not null default 'test',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint subscriptions_stripe_subscription_unique unique (stripe_subscription_id));
create table public.compass_entries (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(), mood text, body text, kind text not null default 'note', question text);
create table public.compass_results (user_id uuid primary key references auth.users(id) on delete cascade, prompt_version text not null,
  generated_at timestamptz not null, revision smallint not null default 1, grounds_core text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());

do $$ declare t text; begin
  foreach t in array array['charts','prefs','readings','purchases','entitlements','entitlement_topics','subscriptions','compass_entries','compass_results']
  loop execute format('alter table public.%I enable row level security', t); end loop; end $$;
create policy charts_delete_own on charts for delete using (user_id = auth.uid());
create policy charts_insert_own on charts for insert with check (user_id = auth.uid());
create policy charts_select_own on charts for select using (user_id = auth.uid());
create policy charts_update_own on charts for update using (user_id = auth.uid());
create policy "compass delete own" on compass_entries for delete using (auth.uid() = user_id);
create policy "compass read own" on compass_entries for select using (auth.uid() = user_id);
create policy "compass update own" on compass_entries for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "compass write own" on compass_entries for insert with check (auth.uid() = user_id);
create policy "compass result read own" on compass_results for select using (auth.uid() = user_id);
create policy "compass result update own" on compass_results for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "compass result write own" on compass_results for insert with check (auth.uid() = user_id);
create policy "Users can read own entitlement topics" on entitlement_topics for select to authenticated using (auth.uid() = user_id);
create policy "Users can read own entitlement" on entitlements for select to authenticated using (auth.uid() = user_id);
create policy "Users can read own subscriptions" on subscriptions for select to authenticated using (auth.uid() = user_id);

-- 测试资料：A、B 两个用户，A 有一张完整星盘
insert into auth.users values ('aaaaaaaa-0000-4000-8000-000000000001'), ('bbbbbbbb-0000-4000-8000-000000000002');
insert into charts (id, user_id, data) values ('cccccccc-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001',
  '{"date":"1994-11-20","time":"08:30","lat":1.29,"lon":103.85,"tzId":"Asia/Singapore","utc":"1994-11-20T00:30:00Z","nick":"A","topics":{}}');
insert into purchases (user_id, stripe_session_id, plan_code, environment) values (null, 'cs_test_old', 'complete', 'test');
