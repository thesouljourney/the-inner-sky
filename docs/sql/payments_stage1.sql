-- The Inner Sky · 付费系统第 1 阶段（数据库）
-- ===============================================================
-- 在 Supabase 的 SQL Editor 里整段跑一次。整段包在一个 transaction 里，
-- 任何一步失败就全部回滚，不会留下一半的状态。
--
-- 两套系统各管各的：
--   · 付费权限 —— 认账号（user_id）：purchases / entitlements / entitlement_topics /
--     subscriptions / checkout_orders / billing_customers
--   · 阅读生成 —— 认出生资料：charts / readings
-- 这份 migration 只在一个地方把两者接起来：一个账号只能有一张星盘，
-- 出生资料一旦完整就不能再改。
--
-- 这份 SQL：
--   · 只新增表、栏位、函数和规则；不删除任何资料
--   · 唯一被移除的东西是 charts 的 DELETE 规则（用户不能再删除自己的星盘）
--   · 付费强制目前只对 billing_test_users 名单里的账号生效（enforcement_mode = test_accounts）
--
-- 所有写入付费资料的函数都只有 service_role（Edge Function）能执行。
-- ===============================================================

begin;

-- ---------------------------------------------------------------
-- 1. 强制付费设定（只有 service_role 能读写）
-- ---------------------------------------------------------------
create table if not exists public.billing_settings (
  id               boolean primary key default true check (id),   -- 永远只有一行
  enforcement_mode text not null default 'test_accounts'
                   check (enforcement_mode in ('test_accounts', 'all')),
  updated_at       timestamptz not null default now()
);
insert into public.billing_settings (id) values (true) on conflict (id) do nothing;

create table if not exists public.billing_test_users (
  user_id    uuid primary key,
  note       text,
  created_at timestamptz not null default now()
);

alter table public.billing_settings   enable row level security;
alter table public.billing_test_users enable row level security;
revoke all on public.billing_settings, public.billing_test_users from anon, authenticated;

-- ---------------------------------------------------------------
-- 2. 基础函数
-- ---------------------------------------------------------------
-- 九个付费主题的唯一权威清单（与 app.html TOPICS9 / read-chart TOPIC_SPEC 相同）
create or replace function public.canonical_topic_ids()
returns text[] language sql immutable as $$
  select array['self','emotion','career','family','love','partner','wealth','study','body']::text[]
$$;

-- 一组 topic 是否刚好 n 个、不重复、全部合法
create or replace function public._valid_topic_set(p text[], n int)
returns boolean language sql immutable as $$
  select p is not null
     and coalesce(array_length(p, 1), 0) = n
     and (select count(distinct x) from unnest(p) x) = n
     and p <@ public.canonical_topic_ids()
$$;

-- 这个账号是否适用付费强制（后台用）
create or replace function public.enforcement_applies(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when p_user is null then false
    when (select enforcement_mode from billing_settings where id) = 'all' then true
    else exists (select 1 from billing_test_users where user_id = p_user)
  end
$$;

-- 同一个用户的所有付费变更都排队执行
create or replace function public._lock_user(p_user uuid)
returns void language sql as $$
  select pg_advisory_xact_lock(hashtextextended('billing:' || p_user::text, 0))
$$;

-- ---------------------------------------------------------------
-- 3. checkout_orders / billing_customers
-- ---------------------------------------------------------------
create table if not exists public.checkout_orders (
  id                          uuid primary key default gen_random_uuid(),
  user_id                     uuid not null,
  environment                 text not null check (environment in ('test', 'live')),
  category                    text not null check (category in ('topics', 'inner_tools_sub')),
  plan_code                   text not null check (plan_code in
                                ('topics_3','topics_6','complete','topic_upgrade',
                                 'complete_upgrade','inner_tools_monthly')),
  from_limit                  smallint check (from_limit in (0, 3, 6)),
  to_limit                    smallint check (to_limit in (3, 6, 9)),
  topic_ids                   text[],        -- 只有这次新买的；到 9 的为 null（服务器补齐其余）
  inner_tools_6m              boolean not null default false,
  stripe_checkout_session_id  text unique,
  status                      text not null default 'creating' check (status in
                                ('creating','open','processing','superseded',
                                 'expired','failed','paid','paid_conflict')),
  -- deferrable：先标记旧单、再插入新单（反过来会违反一单有效的 unique）
  superseded_by               uuid references public.checkout_orders(id) deferrable initially deferred,
  superseded_at               timestamptz,
  expire_confirmed_at         timestamptz,   -- Stripe 已确认这张 session 不能再付款
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);
-- 同一用户、同一类别、同一环境，最多一张还可能付款的订单
create unique index if not exists checkout_orders_one_active
  on public.checkout_orders (user_id, category, environment)
  where status in ('creating', 'open', 'processing');
create index if not exists checkout_orders_user_idx
  on public.checkout_orders (user_id, created_at desc);

alter table public.checkout_orders enable row level security;
drop policy if exists "checkout orders read own" on public.checkout_orders;
create policy "checkout orders read own" on public.checkout_orders
  for select to authenticated using (auth.uid() = user_id);
revoke insert, update, delete on public.checkout_orders from anon, authenticated;

create table if not exists public.billing_customers (
  user_id            uuid not null,
  environment        text not null check (environment in ('test', 'live')),
  stripe_customer_id text not null unique,
  created_at         timestamptz not null default now(),
  primary key (user_id, environment)
);
alter table public.billing_customers enable row level security;
revoke all on public.billing_customers from anon, authenticated;

-- ---------------------------------------------------------------
-- 4. 现有付费表补栏位（全部 nullable，旧资料不受影响）
-- ---------------------------------------------------------------
alter table public.purchases
  add column if not exists checkout_order_id        uuid references public.checkout_orders(id),
  add column if not exists stripe_payment_intent_id text,
  add column if not exists stripe_invoice_id        text,
  add column if not exists entitlement_status       text;
do $$ begin
  alter table public.purchases add constraint purchases_entitlement_status_chk
    check (entitlement_status in ('applied','conflict','not_applicable','review','legacy'));
exception when duplicate_object then null; end $$;
create unique index if not exists purchases_stripe_invoice_id_unique
  on public.purchases (stripe_invoice_id);

alter table public.subscriptions
  add column if not exists paid_through        timestamptz,   -- 只在 invoice.paid 时更新
  add column if not exists cancel_requested_at timestamptz;   -- 6M 生效后「应该在期末取消」

alter table public.entitlements
  add column if not exists inner_tools_6m_granted_at timestamptz,
  add column if not exists inner_tools_6m_after_sub  text;    -- 6M 衔接的 Monthly 订阅 id

-- ---------------------------------------------------------------
-- 5. 一个账号一张星盘；出生资料完整后不能再改
-- ---------------------------------------------------------------
-- 现有 9 个账号都只有一张星盘，这个 unique 可以直接建立
create unique index if not exists charts_one_per_user on public.charts (user_id);

-- 用户不能再删除自己的星盘（防止删掉后重建一张）
drop policy if exists charts_delete_own on public.charts;

-- 出生资料锁：只对前端用户（anon / authenticated）生效；
-- service_role 与 SQL Editor 不受限，留给后台更正用。
-- 被锁的栏位不报错，而是【原样还原】—— 前端每次 PATCH 整个 data 来保存阅读，
-- 报错会让阅读、收藏一起存不进去。
create or replace function public.charts_birth_lock()
returns trigger language plpgsql as $$
declare
  core    text[] := array['date','time','unknownTime','lat','lon'];
  derived text[] := array['tzId','utc','utcOffsetMinutes','dst'];
  keep    jsonb;
begin
  if coalesce(auth.role(), '') not in ('anon', 'authenticated') then
    return new;
  end if;
  new.id := old.id;
  new.user_id := old.user_id;

  -- 旧资料还不完整（例如缺座标）→ 允许补齐（onboarding 的修复流程）
  -- coalesce：缺栏位时 jsonb_typeof 回传 null，不能让 null 被当成「已完整」
  if not coalesce(old.data ? 'date'
          and (old.data ? 'time' or old.data->'unknownTime' = 'true'::jsonb)
          and jsonb_typeof(old.data->'lat') = 'number'
          and jsonb_typeof(old.data->'lon') = 'number', false) then
    return new;
  end if;

  -- 核心出生资料：一律以旧值为准
  select coalesce(jsonb_object_agg(k, old.data->k), '{}'::jsonb) into keep
    from unnest(core) k where old.data ? k;
  new.data := (new.data - core) || keep;

  -- 由出生资料推导出的栏位：原本是空的可以补一次，已经有值就保留旧值
  select coalesce(jsonb_object_agg(k, old.data->k), '{}'::jsonb) into keep
    from unnest(derived) k where old.data ? k and jsonb_typeof(old.data->k) <> 'null';
  new.data := new.data || keep;
  return new;
end $$;

drop trigger if exists charts_birth_lock_trg on public.charts;
create trigger charts_birth_lock_trg before update on public.charts
  for each row execute function public.charts_birth_lock();

-- ---------------------------------------------------------------
-- 6. Inner Tools：到期后只能看、删，不能新增、编辑
-- ---------------------------------------------------------------
create or replace function public.inner_tools_write_allowed()
returns boolean language sql stable security definer set search_path = public as $$
  select not public.enforcement_applies(auth.uid())
      or coalesce((select inner_tools_until from entitlements where user_id = auth.uid()) > now(), false)
$$;

drop policy if exists "compass write own"  on public.compass_entries;
drop policy if exists "compass update own" on public.compass_entries;
create policy "compass write own" on public.compass_entries
  for insert with check (auth.uid() = user_id and public.inner_tools_write_allowed());
create policy "compass update own" on public.compass_entries
  for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id and public.inner_tools_write_allowed());

drop policy if exists "compass result write own"  on public.compass_results;
drop policy if exists "compass result update own" on public.compass_results;
create policy "compass result write own" on public.compass_results
  for insert with check (auth.uid() = user_id and public.inner_tools_write_allowed());
create policy "compass result update own" on public.compass_results
  for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id and public.inner_tools_write_allowed());

-- ---------------------------------------------------------------
-- 7. Inner Tools 有效期限（由订阅已付期限与 6M 共同算出）
-- ---------------------------------------------------------------
-- inner_tools_until = max(所有订阅的 paid_through,
--                         greatest(6M 生效时间, 衔接订阅的 paid_through) + 6 个月)
-- 续费和 6M 同时发生时，6M 起点会跟着衔接订阅的 paid_through 往后移。
-- 只会往后，不会缩短。
create or replace function public.recompute_inner_tools(p_user uuid)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare
  e        entitlements%rowtype;
  sub_end  timestamptz;
  sixm_end timestamptz;
  result   timestamptz;
begin
  select * into e from entitlements where user_id = p_user;
  if not found then return null; end if;
  select max(paid_through) into sub_end from subscriptions where user_id = p_user;
  if e.inner_tools_6m_granted_at is not null then
    sixm_end := greatest(
      e.inner_tools_6m_granted_at,
      coalesce((select paid_through from subscriptions
                 where stripe_subscription_id = e.inner_tools_6m_after_sub),
               e.inner_tools_6m_granted_at)
    ) + interval '6 months';
  end if;
  result := greatest(e.inner_tools_until, sub_end, sixm_end);
  update entitlements set inner_tools_until = result, updated_at = now()
   where user_id = p_user and inner_tools_until is distinct from result;
  return result;
end $$;

-- 6M 期间的结束时间（没有 6M 就是 null）
create or replace function public.inner_tools_6m_end(p_user uuid)
returns timestamptz language sql stable security definer set search_path = public as $$
  select greatest(e.inner_tools_6m_granted_at,
                  coalesce((select paid_through from subscriptions
                             where stripe_subscription_id = e.inner_tools_6m_after_sub),
                           e.inner_tools_6m_granted_at)) + interval '6 months'
    from entitlements e
   where e.user_id = p_user and e.inner_tools_6m_granted_at is not null
$$;

-- ---------------------------------------------------------------
-- 8. 建立 checkout 订单（create-checkout-session 调用）
-- ---------------------------------------------------------------
-- 在 per-user lock 下：验证方案与当前权限 → 把同类别的旧订单标记 superseded →
-- 新增 creating 订单 → 回传需要向 Stripe expire 的旧 session。
-- 失败一律 raise 'checkout:<代码>'，由 Edge Function 转成 HTTP 回应。
create or replace function public.reserve_checkout_order(
  p_user uuid, p_env text, p_plan text, p_topic_ids text[], p_inner_tools_6m boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  cat      text;
  lim      int;
  owned    text[];
  v_from   smallint;
  v_to     smallint;
  v_topics text[] := null;
  v_6m     boolean := coalesce(p_inner_tools_6m, false);
  new_id   uuid := gen_random_uuid();
  to_expire text[];
begin
  if p_user is null then raise exception 'checkout:unauthenticated'; end if;
  if p_env not in ('test', 'live') then raise exception 'checkout:bad_environment'; end if;
  perform _lock_user(p_user);

  select coalesce((select topic_limit from entitlements where user_id = p_user), 0) into lim;
  select coalesce(array_agg(topic_id), '{}') into owned
    from entitlement_topics where user_id = p_user;

  cat := case when p_plan = 'inner_tools_monthly' then 'inner_tools_sub' else 'topics' end;

  if v_6m and not (p_plan = 'complete' and lim = 0) then
    raise exception 'checkout:addon_not_allowed';
  end if;

  if cat = 'inner_tools_sub' then
    if coalesce(array_length(p_topic_ids, 1), 0) > 0 then raise exception 'checkout:unexpected_topics'; end if;
    if coalesce(inner_tools_6m_end(p_user) > now(), false) then
      raise exception 'checkout:inner_tools_6m_active';
    end if;
    if exists (select 1 from subscriptions
                where user_id = p_user and environment = p_env
                  and status in ('active','trialing','past_due','unpaid','incomplete')) then
      raise exception 'checkout:subscription_exists';
    end if;
  else
    if lim = 9 then raise exception 'checkout:already_complete'; end if;
    case p_plan
      when 'topics_3' then
        if lim <> 0 then raise exception 'checkout:use_upgrade'; end if;
        if not _valid_topic_set(p_topic_ids, 3) then raise exception 'checkout:invalid_topics'; end if;
        v_from := 0; v_to := 3; v_topics := p_topic_ids;
      when 'topics_6' then
        if lim <> 0 then raise exception 'checkout:use_upgrade'; end if;
        if not _valid_topic_set(p_topic_ids, 6) then raise exception 'checkout:invalid_topics'; end if;
        v_from := 0; v_to := 6; v_topics := p_topic_ids;
      when 'complete' then
        if lim <> 0 then raise exception 'checkout:use_upgrade'; end if;
        if coalesce(array_length(p_topic_ids, 1), 0) > 0 then raise exception 'checkout:unexpected_topics'; end if;
        v_from := 0; v_to := 9;
      when 'topic_upgrade' then
        if lim = 3 then
          if not _valid_topic_set(p_topic_ids, 3) then raise exception 'checkout:invalid_topics'; end if;
          if p_topic_ids && owned then raise exception 'checkout:topic_already_owned'; end if;
          v_from := 3; v_to := 6; v_topics := p_topic_ids;
        elsif lim = 6 then
          if coalesce(array_length(p_topic_ids, 1), 0) > 0 then raise exception 'checkout:unexpected_topics'; end if;
          v_from := 6; v_to := 9;
        else
          raise exception 'checkout:upgrade_not_available';
        end if;
      when 'complete_upgrade' then
        if lim <> 3 then raise exception 'checkout:upgrade_not_available'; end if;
        if coalesce(array_length(p_topic_ids, 1), 0) > 0 then raise exception 'checkout:unexpected_topics'; end if;
        v_from := 3; v_to := 9;
      else
        raise exception 'checkout:invalid_plan';
    end case;
    if v_topics is not null then
      select array_agg(x order by x) into v_topics from unnest(v_topics) x;
    end if;
  end if;

  -- PayNow 等非同步付款确认中：不能再开新的
  if exists (select 1 from checkout_orders
              where user_id = p_user and category = cat and environment = p_env
                and status = 'processing') then
    raise exception 'checkout:payment_processing';
  end if;

  -- 所有可能还能付款的旧 session（含之前 expire 没确认成功的）
  select coalesce(array_agg(stripe_checkout_session_id), '{}') into to_expire
    from checkout_orders
   where user_id = p_user and category = cat and environment = p_env
     and status in ('creating', 'open', 'superseded')
     and expire_confirmed_at is null
     and stripe_checkout_session_id is not null;

  update checkout_orders
     set status = 'superseded', superseded_by = new_id, superseded_at = now(), updated_at = now()
   where user_id = p_user and category = cat and environment = p_env
     and status in ('creating', 'open');

  insert into checkout_orders (id, user_id, environment, category, plan_code,
                               from_limit, to_limit, topic_ids, inner_tools_6m)
  values (new_id, p_user, p_env, cat, p_plan, v_from, v_to, v_topics, v_6m);

  return jsonb_build_object(
    'order_id', new_id, 'category', cat, 'plan_code', p_plan,
    'from_limit', v_from, 'to_limit', v_to, 'topic_ids', to_jsonb(v_topics),
    'inner_tools_6m', v_6m, 'expire_sessions', to_jsonb(to_expire));
end $$;

-- Stripe session 建好之后：只有订单还是 creating 才能变成 open。
-- 回传 false = 这段时间被新的请求取代了，Edge Function 必须 expire 自己刚建的 session。
create or replace function public.activate_checkout_order(p_order uuid, p_session text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update checkout_orders
     set status = 'open', stripe_checkout_session_id = p_session, updated_at = now()
   where id = p_order and status = 'creating';
  return found;
end $$;

-- 建立失败 / 非同步付款失败
create or replace function public.fail_checkout_order(p_order uuid)
returns void language sql security definer set search_path = public as $$
  update checkout_orders set status = 'failed', updated_at = now()
   where id = p_order and status in ('creating', 'open', 'processing')
$$;

-- Stripe 确认 session 已失效（我们主动 expire 成功，或 checkout.session.expired 事件）
create or replace function public.mark_session_expired(p_session text)
returns void language sql security definer set search_path = public as $$
  update checkout_orders
     set status = case when status = 'superseded' then 'superseded' else 'expired' end,
         expire_confirmed_at = coalesce(expire_confirmed_at, now()),
         updated_at = now()
   where stripe_checkout_session_id = p_session
     and status in ('creating', 'open', 'superseded')
$$;

-- checkout 已完成但付款还没确认（PayNow）
create or replace function public.mark_order_processing(p_order uuid, p_session text)
returns void language sql security definer set search_path = public as $$
  update checkout_orders
     set status = 'processing',
         stripe_checkout_session_id = coalesce(stripe_checkout_session_id, p_session),
         updated_at = now()
   where id = p_order and status in ('creating', 'open', 'superseded')
$$;

-- ---------------------------------------------------------------
-- 9. 套用付款（stripe-webhook 调用；create-checkout-session 遇到旧单已付款时也会调用）
-- ---------------------------------------------------------------
-- 同一个 transaction：purchase 只写一次 → 核对转换是否仍然合法 →
-- 合法就发放权限，不合法就记 paid_conflict、权限不动。
-- p_price_ok：Edge Function 核对 line items 的 Price ID 是否和订单相符。
create or replace function public.apply_checkout_payment(
  p_order uuid, p_session text, p_user uuid, p_env text,
  p_payment_intent text, p_subscription text, p_price_id text,
  p_amount bigint, p_currency text, p_price_ok boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  o          checkout_orders%rowtype;
  e          entitlements%rowtype;
  purchase   uuid;
  valid      boolean;
  new_topics text[];
  link_sub   text;
  stale      text[] := '{}';
begin
  perform _lock_user(p_user);

  select * into o from checkout_orders where id = p_order for update;
  if not found then raise exception 'apply:order_not_found'; end if;
  if o.user_id <> p_user or o.environment <> p_env then raise exception 'apply:order_mismatch'; end if;
  if o.stripe_checkout_session_id is not null and o.stripe_checkout_session_id <> p_session then
    raise exception 'apply:session_mismatch';
  end if;

  insert into purchases (user_id, stripe_session_id, stripe_subscription_id, price_id, plan_code,
                         amount_total, currency, payment_status, environment,
                         checkout_order_id, stripe_payment_intent_id)
  values (p_user, p_session, p_subscription, p_price_id, o.plan_code,
          p_amount, p_currency, 'paid', p_env, o.id, p_payment_intent)
  on conflict (stripe_session_id) do nothing
  returning id into purchase;

  if purchase is null then
    -- 重复事件：什么都不改，只回报目前的状态
    return jsonb_build_object('result', 'duplicate', 'status', o.status,
      'cancel_subscription', (select stripe_subscription_id from subscriptions
                               where user_id = p_user and cancel_requested_at is not null
                                 and not cancel_at_period_end
                                 and status in ('active','trialing','past_due','unpaid','incomplete')
                               limit 1));
  end if;

  update checkout_orders set stripe_checkout_session_id = p_session where id = o.id
     and stripe_checkout_session_id is null;

  if not coalesce(p_price_ok, false) then
    update checkout_orders set status = 'paid_conflict', updated_at = now() where id = o.id;
    update purchases set entitlement_status = 'conflict' where id = purchase;
    return jsonb_build_object('result', 'conflict', 'reason', 'price_mismatch');
  end if;

  -- Monthly：权限由 invoice.paid 的 paid_through 决定，这里只记录
  if o.category = 'inner_tools_sub' then
    update checkout_orders set status = 'paid', updated_at = now() where id = o.id;
    update purchases set entitlement_status = 'not_applicable' where id = purchase;
    return jsonb_build_object('result', 'subscription_recorded');
  end if;

  insert into entitlements (user_id) values (p_user) on conflict (user_id) do nothing;
  select * into e from entitlements where user_id = p_user for update;

  valid := e.topic_limit = o.from_limit
           and not exists (select 1 from entitlement_topics t
                            where t.user_id = p_user and t.topic_id = any (coalesce(o.topic_ids, '{}')));
  if o.inner_tools_6m and (o.from_limit <> 0 or e.inner_tools_6m_granted_at is not null) then
    valid := false;
  end if;

  if not valid then
    update checkout_orders set status = 'paid_conflict', updated_at = now() where id = o.id;
    update purchases set entitlement_status = 'conflict' where id = purchase;
    return jsonb_build_object('result', 'conflict', 'reason', 'state_changed');
  end if;

  new_topics := case when o.to_limit = 9
                     then (select array_agg(x) from unnest(canonical_topic_ids()) x)
                     else o.topic_ids end;
  insert into entitlement_topics (user_id, topic_id)
  select p_user, x from unnest(new_topics) x
  on conflict (user_id, topic_id) do nothing;

  update entitlements
     set topic_limit = greatest(topic_limit, o.to_limit),
         life_thread_access = life_thread_access or o.to_limit = 9,
         updated_at = now()
   where user_id = p_user;

  if o.inner_tools_6m then
    -- 衔接目前还在付费期内的 Monthly（若有）
    select stripe_subscription_id into link_sub from subscriptions
     where user_id = p_user and environment = p_env
       and (status in ('active','trialing','past_due','unpaid','incomplete') or paid_through > now())
     order by paid_through desc nulls last limit 1;
    update entitlements
       set inner_tools_6m_granted_at = now(), inner_tools_6m_after_sub = link_sub
     where user_id = p_user;
    if link_sub is not null then
      update subscriptions set cancel_requested_at = coalesce(cancel_requested_at, now()), updated_at = now()
       where stripe_subscription_id = link_sub;
    end if;
    perform recompute_inner_tools(p_user);
  end if;

  update checkout_orders set status = 'paid', updated_at = now() where id = o.id;
  update purchases set entitlement_status = 'applied' where id = purchase;

  -- 其他还开着的同类别订单：价格是按旧的权限算的，一律作废
  select coalesce(array_agg(stripe_checkout_session_id) filter (where stripe_checkout_session_id is not null), '{}')
    into stale
    from checkout_orders
   where user_id = p_user and category = 'topics' and environment = p_env
     and id <> o.id and status in ('creating', 'open');
  update checkout_orders
     set status = 'superseded', superseded_by = o.id, superseded_at = now(), updated_at = now()
   where user_id = p_user and category = 'topics' and environment = p_env
     and id <> o.id and status in ('creating', 'open');

  return jsonb_build_object('result', 'applied', 'expire_sessions', to_jsonb(stale),
                            'cancel_subscription', link_sub);
end $$;

-- 没有 order_id 的旧版 checkout（这份 migration 之前建立的）：只记录，不发放权限
create or replace function public.record_legacy_payment(
  p_session text, p_user uuid, p_env text, p_plan text, p_price_id text,
  p_amount bigint, p_currency text, p_subscription text)
returns void language sql security definer set search_path = public as $$
  insert into purchases (user_id, stripe_session_id, stripe_subscription_id, price_id, plan_code,
                         amount_total, currency, payment_status, environment, entitlement_status)
  values (p_user, p_session, p_subscription, p_price_id, p_plan,
          p_amount, p_currency, 'paid', p_env, 'legacy')
  on conflict (stripe_session_id) do nothing
$$;

-- ---------------------------------------------------------------
-- 10. 订阅同步（stripe-webhook / billing-reconcile 调用）
-- ---------------------------------------------------------------
-- 同步 Stripe 订阅的最新状态。不延长使用权限（那只看 invoice.paid）。
-- 回传 cancel_needed = 应该期末取消、但 Stripe 上还没设定 → 呼叫端要去设定。
create or replace function public.upsert_subscription(
  p_user uuid, p_env text, p_customer text, p_sub text, p_price text, p_status text,
  p_period_start timestamptz, p_period_end timestamptz, p_cancel_at_period_end boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s subscriptions%rowtype;
begin
  perform _lock_user(p_user);
  insert into subscriptions (user_id, environment, stripe_customer_id, stripe_subscription_id,
                             stripe_price_id, status, current_period_start, current_period_end,
                             cancel_at_period_end)
  values (p_user, p_env, p_customer, p_sub, p_price, p_status,
          p_period_start, p_period_end, coalesce(p_cancel_at_period_end, false))
  on conflict (stripe_subscription_id) do update
     set stripe_customer_id   = coalesce(excluded.stripe_customer_id, subscriptions.stripe_customer_id),
         stripe_price_id      = excluded.stripe_price_id,
         status               = excluded.status,
         current_period_start = excluded.current_period_start,
         current_period_end   = excluded.current_period_end,
         cancel_at_period_end = excluded.cancel_at_period_end,
         updated_at           = now()
  returning * into s;
  insert into entitlements (user_id) values (p_user) on conflict (user_id) do nothing;
  perform recompute_inner_tools(p_user);
  return jsonb_build_object('cancel_needed',
    s.cancel_requested_at is not null and not s.cancel_at_period_end
    and s.status in ('active','trialing','past_due','unpaid','incomplete'));
end $$;

-- invoice.paid：更新 paid_through；续费写一笔 purchase（第一期由 checkout 那笔代表）。
-- 已经要求取消、却还是续费成功 → 这笔标记 review，不静默忽略。
create or replace function public.record_invoice_paid(
  p_user uuid, p_env text, p_sub text, p_invoice text, p_price text,
  p_amount bigint, p_currency text, p_period_end timestamptz, p_is_renewal boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s subscriptions%rowtype;
begin
  perform _lock_user(p_user);
  update subscriptions
     set paid_through = greatest(paid_through, p_period_end), updated_at = now()
   where stripe_subscription_id = p_sub
  returning * into s;
  if not found then raise exception 'invoice:subscription_not_found'; end if;

  if p_is_renewal then
    insert into purchases (user_id, stripe_invoice_id, stripe_subscription_id, price_id, plan_code,
                           amount_total, currency, payment_status, environment, entitlement_status)
    values (p_user, p_invoice, p_sub, p_price, 'inner_tools_monthly',
            p_amount, p_currency, 'paid', p_env,
            case when s.cancel_requested_at is not null then 'review' else 'not_applicable' end)
    on conflict (stripe_invoice_id) do nothing;
  end if;

  insert into entitlements (user_id) values (p_user) on conflict (user_id) do nothing;
  perform recompute_inner_tools(p_user);
  return jsonb_build_object('cancel_needed',
    s.cancel_requested_at is not null and not s.cancel_at_period_end
    and s.status in ('active','trialing','past_due','unpaid','incomplete'));
end $$;

-- ---------------------------------------------------------------
-- 11. 读取权限（read-chart / compass-generate 调用）
-- ---------------------------------------------------------------
-- 回传：unauthenticated / not_enforced / ok / denied / invalid
create or replace function public.paid_access(p_user uuid, p_kind text, p_tid text)
returns text language sql stable security definer set search_path = public as $$
  select case
    when p_user is null then 'unauthenticated'
    when not enforcement_applies(p_user) then 'not_enforced'
    when p_kind = 'topic' and not coalesce(p_tid = any (canonical_topic_ids()), false) then 'invalid'
    when p_kind = 'topic' and (
           exists (select 1 from entitlement_topics where user_id = p_user and topic_id = p_tid)
           or coalesce((select topic_limit from entitlements where user_id = p_user), 0) = 9)
      then 'ok'
    when p_kind = 'map'
         and coalesce((select life_thread_access from entitlements where user_id = p_user), false)
      then 'ok'
    when p_kind in ('topic', 'map') then 'denied'
    else 'invalid'
  end
$$;

-- 回传：unauthenticated / not_enforced / ok / expired
create or replace function public.inner_tools_access(p_user uuid)
returns text language sql stable security definer set search_path = public as $$
  select case
    when p_user is null then 'unauthenticated'
    when not enforcement_applies(p_user) then 'not_enforced'
    when coalesce((select inner_tools_until from entitlements where user_id = p_user) > now(), false) then 'ok'
    else 'expired'
  end
$$;

-- ---------------------------------------------------------------
-- 12. 执行权限：付费函数只有 service_role 能调用
-- ---------------------------------------------------------------
revoke execute on function
  public.enforcement_applies(uuid),
  public._lock_user(uuid),
  public.recompute_inner_tools(uuid),
  public.inner_tools_6m_end(uuid),
  public.reserve_checkout_order(uuid, text, text, text[], boolean),
  public.activate_checkout_order(uuid, text),
  public.fail_checkout_order(uuid),
  public.mark_session_expired(text),
  public.mark_order_processing(uuid, text),
  public.apply_checkout_payment(uuid, text, uuid, text, text, text, text, bigint, text, boolean),
  public.record_legacy_payment(text, uuid, text, text, text, bigint, text, text),
  public.upsert_subscription(uuid, text, text, text, text, text, timestamptz, timestamptz, boolean),
  public.record_invoice_paid(uuid, text, text, text, text, bigint, text, timestamptz, boolean),
  public.paid_access(uuid, text, text),
  public.inner_tools_access(uuid)
from public, anon, authenticated;

grant execute on function
  public.enforcement_applies(uuid),
  public._lock_user(uuid),
  public.recompute_inner_tools(uuid),
  public.inner_tools_6m_end(uuid),
  public.reserve_checkout_order(uuid, text, text, text[], boolean),
  public.activate_checkout_order(uuid, text),
  public.fail_checkout_order(uuid),
  public.mark_session_expired(text),
  public.mark_order_processing(uuid, text),
  public.apply_checkout_payment(uuid, text, uuid, text, text, text, text, bigint, text, boolean),
  public.record_legacy_payment(text, uuid, text, text, text, bigint, text, text),
  public.upsert_subscription(uuid, text, text, text, text, text, timestamptz, timestamptz, boolean),
  public.record_invoice_paid(uuid, text, text, text, text, bigint, text, timestamptz, boolean),
  public.paid_access(uuid, text, text),
  public.inner_tools_access(uuid)
to service_role;

-- RLS 规则里会用到，前端用户必须能执行（只看自己的 auth.uid()）
revoke execute on function public.inner_tools_write_allowed() from public, anon;
grant  execute on function public.inner_tools_write_allowed() to authenticated, service_role;

commit;

-- ===============================================================
-- 跑完之后：把测试账号加进名单（只有这些账号会被强制付费）
--   insert into public.billing_test_users (user_id, note) values ('<测试账号 UUID>', 'sandbox');
--
-- 正式上线时（第 9 阶段）：
--   update public.billing_settings set enforcement_mode = 'all', updated_at = now();
-- ===============================================================
