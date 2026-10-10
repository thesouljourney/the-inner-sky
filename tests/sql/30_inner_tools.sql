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

\echo '== 7. Monthly → 再买 Complete + 6M =='
begin;
insert into billing_test_users values (:A);
-- Monthly：checkout → 订阅同步 → 第一期 invoice.paid（paid_through = 现在 + 20 天）
select reserve_checkout_order(:A,'test','inner_tools_monthly',null,false) as m \gset
select activate_checkout_order(((:'m')::jsonb->>'order_id')::uuid, 'cs_m');
select apply_checkout_payment(((:'m')::jsonb->>'order_id')::uuid,'cs_m',:A,'test','','sub_1','price_m',199,'sgd',true);
select upsert_subscription(:A,'test','cus_1','sub_1','price_m','active', now()-interval '10 days', now()+interval '20 days', false);
select record_invoice_paid(:A,'test','sub_1','in_1','price_m',199,'sgd', now()+interval '20 days', false);
select pg_temp.ok(abs(extract(epoch from (select inner_tools_until from entitlements) - (now()+interval '20 days'))) < 5, 'Monthly：用到已付期限');
select pg_temp.ok((select count(*) from purchases where stripe_invoice_id is not null) = 0, '第一期不重复记一笔');
select pg_temp.fails($$select reserve_checkout_order('aaaaaaaa-0000-4000-8000-000000000001','test','inner_tools_monthly',null,false)$$, 'subscription_exists', '已有订阅不能再订');
-- 买 Complete + 6M
select reserve_checkout_order(:A,'test','complete',null,true) as c \gset
select activate_checkout_order(((:'c')::jsonb->>'order_id')::uuid, 'cs_c6');
select apply_checkout_payment(((:'c')::jsonb->>'order_id')::uuid,'cs_c6',:A,'test','pi','','price_c',1976,'sgd',true) as r \gset
select pg_temp.ok((:'r')::jsonb->>'cancel_subscription' = 'sub_1', '回传要期末取消的 Monthly');
select pg_temp.ok((select cancel_requested_at is not null from subscriptions), '记下「应该期末取消」');
select pg_temp.ok(abs(extract(epoch from (select inner_tools_until from entitlements) - (now()+interval '20 days'+interval '6 months'))) < 5, '6M 从 Monthly 已付期限结束后开始算');
-- 取消 API 还没成功 → 订阅事件回报 cancel_needed
select upsert_subscription(:A,'test','cus_1','sub_1','price_m','active', now()-interval '10 days', now()+interval '20 days', false) as u \gset
select pg_temp.ok(((:'u')::jsonb->>'cancel_needed')::boolean, '取消还没生效 → cancel_needed（会重试）');
-- 重送 6M 付款事件
select apply_checkout_payment(((:'c')::jsonb->>'order_id')::uuid,'cs_c6',:A,'test','pi','','price_c',1976,'sgd',true) as d \gset
select pg_temp.ok((:'d')::jsonb->>'result' = 'duplicate' and (:'d')::jsonb->>'cancel_subscription' = 'sub_1', '重送：不加 6 个月，但仍提醒要取消');
select pg_temp.ok(abs(extract(epoch from (select inner_tools_until from entitlements) - (now()+interval '20 days'+interval '6 months'))) < 5, '重送后到期日不变');
-- 取消失败，下一期还是续费了（期间 +30 天）
select record_invoice_paid(:A,'test','sub_1','in_2','price_m',199,'sgd', now()+interval '50 days', true) as iv \gset
select pg_temp.ok((select entitlement_status from purchases where stripe_invoice_id='in_2') = 'review', '取消后仍续费 → 标记 review，不静默');
select pg_temp.ok(abs(extract(epoch from (select inner_tools_until from entitlements) - (now()+interval '50 days'+interval '6 months'))) < 5, '多付的那一期不浪费：6M 起点往后移');
select record_invoice_paid(:A,'test','sub_1','in_2','price_m',199,'sgd', now()+interval '50 days', true);
select pg_temp.ok((select count(*) from purchases where stripe_invoice_id='in_2') = 1, '同一张 invoice 只记一次');
-- 取消终于生效
select upsert_subscription(:A,'test','cus_1','sub_1','price_m','active', now(), now()+interval '50 days', true) as u2 \gset
select pg_temp.ok(not ((:'u2')::jsonb->>'cancel_needed')::boolean, '取消生效后不再要求重试');
select upsert_subscription(:A,'test','cus_1','sub_1','price_m','canceled', now(), now()+interval '50 days', true);
select pg_temp.ok(abs(extract(epoch from (select inner_tools_until from entitlements) - (now()+interval '50 days'+interval '6 months'))) < 5, '订阅结束不缩短权限');
select pg_temp.fails($$select reserve_checkout_order('aaaaaaaa-0000-4000-8000-000000000001','test','inner_tools_monthly',null,false)$$, 'inner_tools_6m_active', '6M 期间不能订 Monthly');
rollback;

\echo '== 8. Inner Tools 到期：可看、可删，不能新增、编辑 =='
begin;
insert into compass_entries (id, user_id, body) values ('eeeeeeee-0000-4000-8000-000000000001', :A, 'old note');
insert into billing_test_users values (:A);
set local role authenticated; set local request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000001'; set local request.jwt.claim.role = 'authenticated';
select pg_temp.ok((select count(*) from compass_entries) = 1, '到期：历史记录照常看得到');
select pg_temp.fails($$insert into compass_entries (user_id, body) values ('aaaaaaaa-0000-4000-8000-000000000001','new')$$, 'row-level security', '到期：不能新增');
select pg_temp.fails($$update compass_entries set body='edited'$$, 'row-level security', '到期：不能编辑');
select pg_temp.fails($$insert into compass_results (user_id, prompt_version, generated_at, grounds_core) values ('aaaaaaaa-0000-4000-8000-000000000001','v',now(),'x')$$, 'row-level security', '到期：不能存新的指南');
delete from compass_entries;
select pg_temp.ok((select count(*) from compass_entries) = 0, '到期：可以删除自己的记录');
rollback;
begin;
set local role authenticated; set local request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000001'; set local request.jwt.claim.role = 'authenticated';
insert into compass_entries (user_id, body) values ('aaaaaaaa-0000-4000-8000-000000000001','new');
select pg_temp.ok(true, '不在测试名单的普通用户：照旧可以新增');
rollback;
begin;
insert into billing_test_users values (:A);
insert into entitlements (user_id, inner_tools_until) values (:A, now() + interval '1 day');
set local role authenticated; set local request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000001'; set local request.jwt.claim.role = 'authenticated';
insert into compass_entries (user_id, body) values ('aaaaaaaa-0000-4000-8000-000000000001','new');
select pg_temp.ok(true, '有效期内：可以新增');
rollback;

\echo '== 9. PayNow 付款确认中 =='
begin;
select reserve_checkout_order(:A,'test','topics_3',array['self','love','body'],false) as p \gset
select activate_checkout_order(((:'p')::jsonb->>'order_id')::uuid, 'cs_p');
select mark_order_processing(((:'p')::jsonb->>'order_id')::uuid, 'cs_p');
select pg_temp.fails($$select reserve_checkout_order('aaaaaaaa-0000-4000-8000-000000000001','test','complete',null,false)$$, 'payment_processing', '付款确认中：不能开新单');
select pg_temp.ok((select count(*) from entitlement_topics) = 0, '付款确认前：不发放权限');
select reserve_checkout_order(:A,'test','inner_tools_monthly',null,false);
select pg_temp.ok(true, '不同类别（Monthly）不受影响');
select fail_checkout_order(((:'p')::jsonb->>'order_id')::uuid);
select reserve_checkout_order(:A,'test','complete',null,false);
select pg_temp.ok(true, '非同步付款失败后可以重新购买');
select mark_session_expired('cs_p');
select pg_temp.ok((select status from checkout_orders where stripe_checkout_session_id='cs_p') = 'failed', 'expired 事件不覆盖其他最终状态');
rollback;
