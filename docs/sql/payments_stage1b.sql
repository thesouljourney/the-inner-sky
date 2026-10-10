-- The Inner Sky · 付费系统 Stage 1b：早期体验用户（Early Access）
-- ===============================================================
-- 在 Supabase 的 SQL Editor 里整段跑一次（包在一个 transaction 里，失败会全部回滚）。
-- 前提：Stage 1（payments_stage1.sql）已经执行。
--
-- 这份 SQL【不写入任何账号】。体验用户名单由你确认实际 user_id 与 email 后，
-- 另外用 docs/sql/early_access_seed.sql 写入。
--
-- 设计：
--   · early_access_users 与 billing_test_users 完全分开：
--       billing_test_users = Sandbox 付款测试名单（会被强制付费）
--       early_access_users = 早期体验用户（指定功能免费）
--   · 免费范围以 scopes 明确列出：topics / life_thread / inner_tools。
--     未来新的付费功能【不会】自动包含；要给体验用户，再把新的 scope 加进名单即可。
--   · enforcement_applies() 不变：登录验证、一账号一张星盘、出生资料锁定、
--     未来的生成频率限制都不经过这里，体验用户照样受这些规则约束。
--   · 只调整四个读取 / 下单的检查：paid_access、inner_tools_access、
--     inner_tools_write_allowed、reserve_checkout_order。
--   · 不建立任何 purchases / entitlements / subscriptions 记录。
-- ===============================================================

begin;

-- ---------------------------------------------------------------
-- 1. 体验用户名单
-- ---------------------------------------------------------------
create table if not exists public.early_access_users (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  scopes     text[] not null default array['topics','life_thread','inner_tools']::text[],
  note       text,
  granted_at timestamptz not null default now(),
  -- 只接受已知的范围；将来新增功能时，同时放宽这个检查
  constraint early_access_scopes_chk check (
    cardinality(scopes) > 0 and scopes <@ array['topics','life_thread','inner_tools']::text[])
);

alter table public.early_access_users enable row level security;
drop policy if exists "early access read own" on public.early_access_users;
create policy "early access read own" on public.early_access_users
  for select to authenticated using (auth.uid() = user_id);
revoke all on public.early_access_users from public, anon, authenticated;
grant select on public.early_access_users to authenticated;

-- 两份名单不能混用：同一个账号不能同时是体验用户与付款测试账号
create or replace function public.billing_lists_exclusive()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_table_name = 'early_access_users'
     and exists (select 1 from billing_test_users where user_id = new.user_id) then
    raise exception 'early_access:account_is_billing_test_user';
  end if;
  if tg_table_name = 'billing_test_users'
     and exists (select 1 from early_access_users where user_id = new.user_id) then
    raise exception 'early_access:account_is_early_user';
  end if;
  return new;
end $$;
drop trigger if exists early_access_exclusive_trg on public.early_access_users;
create trigger early_access_exclusive_trg before insert or update on public.early_access_users
  for each row execute function public.billing_lists_exclusive();
drop trigger if exists billing_test_exclusive_trg on public.billing_test_users;
create trigger billing_test_exclusive_trg before insert or update on public.billing_test_users
  for each row execute function public.billing_lists_exclusive();

-- 这个账号是否拥有某个体验范围
create or replace function public.early_access_has(p_user uuid, p_scope text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select p_user is not null and exists (
    select 1 from early_access_users where user_id = p_user and p_scope = any (scopes))
$$;

-- 体验用户是否已经拥有某个付款类别的全部权限（是 → 不能进入付款流程）
--   topics          = 九个主题（Complete 也包含 Life Thread，两者都要有才算）
--   inner_tools_sub = Inner Tools
create or replace function public.early_access_covers_category(p_user uuid, p_category text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select case p_category
    when 'topics'          then early_access_has(p_user, 'topics') and early_access_has(p_user, 'life_thread')
    when 'inner_tools_sub' then early_access_has(p_user, 'inner_tools')
    else false
  end
$$;

-- 给 create-checkout-session 在建立订单前先判断（与 reserve_checkout_order 内的检查相同）
create or replace function public.early_access_covers_plan(p_user uuid, p_plan text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select early_access_covers_category(p_user,
    case when p_plan = 'inner_tools_monthly' then 'inner_tools_sub' else 'topics' end)
$$;

-- ---------------------------------------------------------------
-- 2. 读取权限：体验用户在自己的范围内回传 early_access（read-chart 视同 ok）
--    顺序：未登录 → 不适用强制 → topic 不合法 → 体验范围 → 购买权限
-- ---------------------------------------------------------------
create or replace function public.paid_access(p_user uuid, p_kind text, p_tid text)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when p_user is null then 'unauthenticated'
    when not enforcement_applies(p_user) then 'not_enforced'
    when p_kind = 'topic' and not coalesce(p_tid = any (canonical_topic_ids()), false) then 'invalid'
    when p_kind = 'topic' and early_access_has(p_user, 'topics') then 'early_access'
    when p_kind = 'map' and early_access_has(p_user, 'life_thread') then 'early_access'
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

create or replace function public.inner_tools_access(p_user uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when p_user is null then 'unauthenticated'
    when not enforcement_applies(p_user) then 'not_enforced'
    when early_access_has(p_user, 'inner_tools') then 'early_access'
    when coalesce((select inner_tools_until from entitlements where user_id = p_user) > now(), false) then 'ok'
    else 'expired'
  end
$$;

-- RLS（compass_entries / compass_results 的新增、编辑）用的判断
create or replace function public.inner_tools_write_allowed()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select not public.enforcement_applies(auth.uid())
      or public.early_access_has(auth.uid(), 'inner_tools')
      or coalesce((select inner_tools_until from entitlements where user_id = auth.uid()) > now(), false)
$$;

-- ---------------------------------------------------------------
-- 3. 建立订单：体验用户已经拥有的类别不能下单（与 Stage 1 相同，只多一个检查）
-- ---------------------------------------------------------------
create or replace function public.reserve_checkout_order(
  p_user uuid, p_env text, p_plan text, p_topic_ids text[], p_inner_tools_6m boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
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

  -- Stage 1b：体验用户已经拥有这个类别的权限 → 不能进入付款流程
  if early_access_covers_category(p_user, cat) then
    raise exception 'checkout:early_access';
  end if;

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

-- ---------------------------------------------------------------
-- 4. 执行权限
-- ---------------------------------------------------------------
revoke execute on function
  public.billing_lists_exclusive(),
  public.early_access_has(uuid, text),
  public.early_access_covers_category(uuid, text),
  public.early_access_covers_plan(uuid, text),
  public.paid_access(uuid, text, text),
  public.inner_tools_access(uuid),
  public.reserve_checkout_order(uuid, text, text, text[], boolean)
from public, anon, authenticated;
grant execute on function
  public.early_access_has(uuid, text),
  public.early_access_covers_category(uuid, text),
  public.early_access_covers_plan(uuid, text),
  public.paid_access(uuid, text, text),
  public.inner_tools_access(uuid),
  public.reserve_checkout_order(uuid, text, text, text[], boolean)
to service_role;
revoke execute on function public.inner_tools_write_allowed() from public, anon;
grant  execute on function public.inner_tools_write_allowed() to authenticated, service_role;

commit;
