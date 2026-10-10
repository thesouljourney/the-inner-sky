-- 最终审核补充：权限绕过、旧版函数相容、并发、边界情况
\set ON_ERROR_STOP 1
create or replace function pg_temp.ok(cond boolean, label text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', label; end if; raise notice 'ok  %', label; end $$;
create or replace function pg_temp.fails(sql text, expect text, label text) returns void language plpgsql as $$
begin
  begin execute sql; exception when others then
    if position(expect in sqlerrm) > 0 then raise notice 'ok  %  (%)', label, sqlerrm; return; end if;
    raise exception 'FAIL: % → 错误不符: %', label, sqlerrm;
  end;
  raise exception 'FAIL: % → 没有报错', label;
end $$;
\set A '''aaaaaaaa-0000-4000-8000-000000000001'''
\set B '''bbbbbbbb-0000-4000-8000-000000000002'''

\echo '== 10. 权限设定 =='
select pg_temp.ok(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%pg_temp')),
  '所有 SECURITY DEFINER 函数都固定 search_path（pg_temp 放最后）');
select pg_temp.ok(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef and p.proname <> 'inner_tools_write_allowed'
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))),
  'anon / authenticated 不能执行任何付费 SECURITY DEFINER 函数');
select pg_temp.ok(not has_function_privilege('anon', 'public.inner_tools_write_allowed()', 'execute'), 'anon 不能执行 inner_tools_write_allowed');
select pg_temp.ok(not has_table_privilege('authenticated', 'public.checkout_orders', 'truncate')
              and not has_table_privilege('authenticated', 'public.checkout_orders', 'insert')
              and has_table_privilege('authenticated', 'public.checkout_orders', 'select'), 'checkout_orders：前端只能 select（无 truncate）');
select pg_temp.ok(not has_table_privilege('authenticated', 'public.billing_customers', 'select')
              and not has_table_privilege('anon', 'public.billing_settings', 'select')
              and not has_table_privilege('authenticated', 'public.billing_test_users', 'truncate'), '设定表与 Customer 表：前端完全碰不到');
begin;
insert into checkout_orders (user_id, environment, category, plan_code) values (:A, 'test', 'topics', 'complete');
set local role authenticated; set local request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002'; set local request.jwt.claim.role = 'authenticated';
select pg_temp.ok((select count(*) from checkout_orders) = 0, '看不到别人的订单');
select pg_temp.fails($$select inner_tools_6m_end('aaaaaaaa-0000-4000-8000-000000000001')$$, 'permission denied', '不能查别人的 6M 期限');
select pg_temp.fails($$select paid_access('aaaaaaaa-0000-4000-8000-000000000001','topic','self')$$, 'permission denied', '不能查别人的权限');
rollback;

\echo '== 11. 星盘：其他写入方式 =='
begin;
set local role authenticated; set local request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000001'; set local request.jwt.claim.role = 'authenticated';
insert into charts (id, user_id, data) values ('cccccccc-0000-4000-8000-000000000001', :A, '{"date":"2010-10-10","time":"01:00","lat":0,"lon":0}')
  on conflict (id) do update set data = excluded.data;
select pg_temp.ok((select data->>'date' from charts) = '1994-11-20', 'upsert（on conflict update）也被锁住');
update charts set user_id = :B;
select pg_temp.ok((select user_id from charts where id='cccccccc-0000-4000-8000-000000000001') = :A, '不能把星盘转给别人');
update charts set data = data - 'lat' - 'lon' - 'date';
select pg_temp.ok((select data ? 'lat' and data ? 'date' from charts), '删除出生栏位 → 被补回');
rollback;
begin;
set local role authenticated; set local request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002'; set local request.jwt.claim.role = 'authenticated';
insert into charts (id, user_id, data) values ('dddddddd-0000-4000-8000-000000000002', :B, '{"date":"1990-05-05","unknownTime":true,"lat":3.1,"lon":101.7}');
update charts set data = data || '{"time":"10:00","unknownTime":false}'::jsonb;
select pg_temp.ok((select not (data ? 'time') and data->'unknownTime' = 'true'::jsonb from charts), '出生时间未知：之后不能补上时间');
rollback;
begin;
set local role anon; set local request.jwt.claim.role = 'anon';
select pg_temp.ok((select count(*) from charts) = 0, '未登录：看不到任何星盘');
rollback;

\echo '== 12. 订单边界 =='
begin;
select pg_temp.fails($$select apply_checkout_payment(gen_random_uuid(),'cs_x','aaaaaaaa-0000-4000-8000-000000000001','test','','','p',1,'sgd',true)$$, 'order_not_found', '不存在的订单');
select reserve_checkout_order(:A,'test','complete',null,false) as r \gset
select activate_checkout_order(((:'r')::jsonb->>'order_id')::uuid, 'cs_r');
select pg_temp.fails(format($$select apply_checkout_payment(%L,'cs_r','bbbbbbbb-0000-4000-8000-000000000002','test','','','p',1,'sgd',true)$$, (:'r')::jsonb->>'order_id'), 'order_mismatch', '别人的 user_id → 拒绝');
select pg_temp.fails(format($$select apply_checkout_payment(%L,'cs_other','aaaaaaaa-0000-4000-8000-000000000001','test','','','p',1,'sgd',true)$$, (:'r')::jsonb->>'order_id'), 'session_mismatch', 'session 不符 → 拒绝');
select pg_temp.fails(format($$select apply_checkout_payment(%L,'cs_r','aaaaaaaa-0000-4000-8000-000000000001','live','','','p',1,'sgd',true)$$, (:'r')::jsonb->>'order_id'), 'order_mismatch', 'test 订单不能用 live 事件套用');
select apply_checkout_payment(((:'r')::jsonb->>'order_id')::uuid,'cs_r',:A,'test','','','p_wrong',1,'sgd',false) as c \gset
select pg_temp.ok((:'c')::jsonb->>'reason' = 'price_mismatch' and (select count(*) from entitlement_topics) = 0, 'Price ID 不符 → conflict，不发放');
select fail_checkout_order(((:'r')::jsonb->>'order_id')::uuid);
select pg_temp.ok((select status from checkout_orders where id = ((:'r')::jsonb->>'order_id')::uuid) = 'paid_conflict', 'fail 不会覆盖已付款的状态');
rollback;
begin;
select reserve_checkout_order(:A,'test','complete',null,false) as r \gset
select activate_checkout_order(((:'r')::jsonb->>'order_id')::uuid, 'cs_open');
select fail_checkout_order(((:'r')::jsonb->>'order_id')::uuid);
select pg_temp.ok((select status from checkout_orders where stripe_checkout_session_id = 'cs_open') = 'open', 'open 订单不能被 fail（必须先 expire）');
rollback;
begin;  -- 被取代的旧单进入 PayNow 付款确认中，同时新单还开着
select reserve_checkout_order(:A,'test','topics_3',array['self','love','body'],false) as o1 \gset
select activate_checkout_order(((:'o1')::jsonb->>'order_id')::uuid, 'cs_p1');
select reserve_checkout_order(:A,'test','complete',null,false) as o2 \gset
select activate_checkout_order(((:'o2')::jsonb->>'order_id')::uuid, 'cs_p2');
select mark_order_processing(((:'o1')::jsonb->>'order_id')::uuid, 'cs_p1') as m \gset
select pg_temp.ok((:'m')::jsonb->'expire_sessions' = '["cs_p2"]', '旧单付款确认中 → 新单作废并回传 expire');
select pg_temp.ok((select status from checkout_orders where stripe_checkout_session_id='cs_p1') = 'processing'
              and (select status from checkout_orders where stripe_checkout_session_id='cs_p2') = 'superseded', '不违反唯一约束');
select mark_order_processing(((:'o1')::jsonb->>'order_id')::uuid, 'cs_p1') as m2 \gset
select pg_temp.ok((:'m2')::jsonb->>'result' = 'ignored', '重送 processing 事件 → 不变');
select apply_checkout_payment(((:'o1')::jsonb->>'order_id')::uuid,'cs_p1',:A,'test','pi','','p',688,'sgd',true) as a \gset
select pg_temp.ok((:'a')::jsonb->>'result' = 'applied' and (select topic_limit from entitlements) = 3, 'PayNow 确认成功 → 发放');
rollback;

\echo '== 13. Inner Tools 期限只会往后 =='
begin;
insert into entitlements (user_id, inner_tools_until) values (:A, now() + interval '400 days');
select upsert_subscription(:A,'test','cus','sub_x','p','active', now(), now()+interval '30 days', false);
select record_invoice_paid(:A,'test','sub_x','in_x','p',199,'sgd', now()+interval '30 days', false);
select pg_temp.ok((select inner_tools_until from entitlements) > now() + interval '399 days', '旧的较晚期限不会被缩短');
select pg_temp.fails($$select record_invoice_paid('aaaaaaaa-0000-4000-8000-000000000001','test','sub_missing','in_y','p',199,'sgd',now(),true)$$, 'subscription_not_found', '没有同步过的订阅 → 报错让 webhook 重试');
rollback;
begin;  -- 6M 只能发放一次
update entitlements set inner_tools_6m_granted_at = now() where user_id = :A;
insert into entitlements (user_id, inner_tools_6m_granted_at) values (:A, now() - interval '1 day') on conflict (user_id) do update set inner_tools_6m_granted_at = excluded.inner_tools_6m_granted_at;
select reserve_checkout_order(:A,'test','complete',null,true) as r \gset
select activate_checkout_order(((:'r')::jsonb->>'order_id')::uuid, 'cs_6m2');
select apply_checkout_payment(((:'r')::jsonb->>'order_id')::uuid,'cs_6m2',:A,'test','','','p',1976,'sgd',true) as c \gset
select pg_temp.ok((:'c')::jsonb->>'result' = 'conflict', '已经给过 6M → 不会再给第二次');
rollback;

\echo '== 14. 旧版已部署函数仍可运作 =='
begin;
-- 旧 webhook 的写法（不带新栏位）
insert into purchases (user_id, stripe_session_id, price_id, plan_code, amount_total, currency, payment_status, environment)
  values (:A, 'cs_legacy', 'p', 'topics_3', 688, 'sgd', 'paid', 'test')
  on conflict (stripe_session_id) do update set payment_status = excluded.payment_status;
insert into entitlements (user_id, topic_limit, life_thread_access, inner_tools_until, updated_at)
  values (:A, 3, false, null, now()) on conflict (user_id) do update set topic_limit = excluded.topic_limit;
insert into subscriptions (user_id, stripe_customer_id, stripe_subscription_id, stripe_price_id, status, current_period_start, current_period_end, cancel_at_period_end, environment, updated_at)
  values (:A, 'cus', 'sub_legacy', 'p', 'active', now(), now() + interval '30 days', false, 'test', now())
  on conflict (stripe_subscription_id) do update set status = excluded.status;
select pg_temp.ok(true, '旧 webhook 写 purchases / entitlements / subscriptions 照常成功');
select record_legacy_payment('cs_legacy2', :A, 'test', 'complete', 'p', 1688, 'sgd', null);
select record_legacy_payment('cs_legacy2', :A, 'test', 'complete', 'p', 1688, 'sgd', null);
select pg_temp.ok((select count(*) from purchases where stripe_session_id='cs_legacy2' and entitlement_status='legacy') = 1, '旧版 checkout 付款：只记录一次、标记 legacy');
rollback;
