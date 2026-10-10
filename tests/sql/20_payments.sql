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
-- 模拟一次完整付款：reserve → activate → apply
create or replace function pg_temp.buy(u uuid, plan text, topics text[], sixm boolean, sess text) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  r := reserve_checkout_order(u, 'test', plan, topics, sixm);
  perform activate_checkout_order((r->>'order_id')::uuid, sess);
  return apply_checkout_payment((r->>'order_id')::uuid, sess, u, 'test', 'pi_'||sess, null, 'price_x', 100, 'sgd', true);
end $$;
set role service_role;

\echo '== 3. 方案验证 =='
select pg_temp.fails($$select reserve_checkout_order('aaaaaaaa-0000-4000-8000-000000000001','test','topics_3',array['self','career'],false)$$, 'invalid_topics', 'topics_3 只给 2 个');
select pg_temp.fails($$select reserve_checkout_order('aaaaaaaa-0000-4000-8000-000000000001','test','topics_3',array['self','career','body','love'],false)$$, 'invalid_topics', 'topics_3 给 4 个');
select pg_temp.fails($$select reserve_checkout_order('aaaaaaaa-0000-4000-8000-000000000001','test','topics_6',array['self','career','body','love','study'],false)$$, 'invalid_topics', 'topics_6 给 5 个');
select pg_temp.fails($$select reserve_checkout_order('aaaaaaaa-0000-4000-8000-000000000001','test','topics_6',array['self','career','body','love','study','wealth','family'],false)$$, 'invalid_topics', 'topics_6 给 7 个');
select pg_temp.fails($$select reserve_checkout_order('aaaaaaaa-0000-4000-8000-000000000001','test','topics_3',array['self','self','body'],false)$$, 'invalid_topics', '重复 topic');
select pg_temp.fails($$select reserve_checkout_order('aaaaaaaa-0000-4000-8000-000000000001','test','topics_3',array['self','money','body'],false)$$, 'invalid_topics', '假的 topic id');
select pg_temp.fails($$select reserve_checkout_order('aaaaaaaa-0000-4000-8000-000000000001','test','topics_3',array['self','career','body'],true)$$, 'addon_not_allowed', '6M 不能加在 topics_3');
select pg_temp.fails($$select reserve_checkout_order('aaaaaaaa-0000-4000-8000-000000000001','test','topic_upgrade',null,false)$$, 'upgrade_not_available', '0 的时候不能升级');

\echo '== 4. 取代旧订单 / 并发 =='
begin;
select reserve_checkout_order('aaaaaaaa-0000-4000-8000-000000000001','test','topics_3',array['self','family','body'],false) as r1 \gset
select activate_checkout_order(((:'r1')::jsonb->>'order_id')::uuid, 'cs_A');
select reserve_checkout_order('aaaaaaaa-0000-4000-8000-000000000001','test','complete',null,false) as r2 \gset
select pg_temp.ok((:'r2')::jsonb->'expire_sessions' = '["cs_A"]', '新订单回传要 expire 的旧 session');
select pg_temp.ok((select status from checkout_orders where stripe_checkout_session_id='cs_A') = 'superseded', '旧订单变成 superseded');
select pg_temp.ok((select count(*) from checkout_orders where status in ('creating','open')) = 1, '同时只有一张有效订单');
select reserve_checkout_order('aaaaaaaa-0000-4000-8000-000000000001','test','complete',null,false) as r3 \gset
select pg_temp.ok(not activate_checkout_order(((:'r2')::jsonb->>'order_id')::uuid, 'cs_B'), '被取代后 activate 失败（必须 expire 自己）');
select pg_temp.ok((:'r3')::jsonb->'expire_sessions' = '["cs_A"]', 'expire 未确认的旧 session 会再次回传');
select mark_session_expired('cs_A');
select reserve_checkout_order('aaaaaaaa-0000-4000-8000-000000000001','test','complete',null,false) as r4 \gset
select pg_temp.ok((:'r4')::jsonb->'expire_sessions' = '[]', 'expire 确认后不再回传');
rollback;

\echo '== 5. 3 → 6 → 9 =='
begin;
select pg_temp.buy('aaaaaaaa-0000-4000-8000-000000000001','topics_3',array['self','family','body'],false,'cs_1') as a \gset
select pg_temp.ok((:'a')::jsonb->>'result' = 'applied', 'topics_3 套用');
select pg_temp.ok((select topic_limit from entitlements) = 3, 'topic_limit = 3');
select pg_temp.ok((select array_agg(topic_id order by topic_id) from entitlement_topics) = array['body','family','self'], '正好是选的三个（首、中、尾）');
select apply_checkout_payment((select id from checkout_orders where stripe_checkout_session_id='cs_1'),'cs_1','aaaaaaaa-0000-4000-8000-000000000001','test','pi','','p',100,'sgd',true) as d \gset
select pg_temp.ok((:'d')::jsonb->>'result' = 'duplicate', 'webhook 重送 → duplicate');
select pg_temp.ok((select count(*) from entitlement_topics) = 3 and (select count(*) from purchases where stripe_session_id='cs_1') = 1, '重送不重复写入');
select pg_temp.fails($$select reserve_checkout_order('aaaaaaaa-0000-4000-8000-000000000001','test','topic_upgrade',array['self','career','study'],false)$$, 'topic_already_owned', '升级不能包含已拥有的');
select pg_temp.fails($$select reserve_checkout_order('aaaaaaaa-0000-4000-8000-000000000001','test','topics_6',array['emotion','career','study','love','partner','wealth'],false)$$, 'use_upgrade', '已有 3 个不能再买 topics_6');
select pg_temp.fails($$select reserve_checkout_order('aaaaaaaa-0000-4000-8000-000000000001','test','complete_upgrade',null,true)$$, 'addon_not_allowed', '6M 不能加在 3→Complete');
select pg_temp.buy('aaaaaaaa-0000-4000-8000-000000000001','topic_upgrade',array['emotion','career','study'],false,'cs_2');
select pg_temp.ok((select topic_limit from entitlements) = 6 and (select count(*) from entitlement_topics) = 6, '3→6：原本 3 个保留 + 新 3 个');
select pg_temp.ok((select not life_thread_access from entitlements), '6 个没有 Life Thread');
select pg_temp.ok(paid_access('aaaaaaaa-0000-4000-8000-000000000001','topic','love') = 'not_enforced', '不在测试名单 → 不强制');
insert into billing_test_users values ('aaaaaaaa-0000-4000-8000-000000000001');
select pg_temp.ok(paid_access('aaaaaaaa-0000-4000-8000-000000000001','topic','career') = 'ok', '拥有的 topic → ok');
select pg_temp.ok(paid_access('aaaaaaaa-0000-4000-8000-000000000001','topic','love') = 'denied', '没买的 topic → denied');
select pg_temp.ok(paid_access('aaaaaaaa-0000-4000-8000-000000000001','map',null) = 'denied', '没有 Complete → Life Thread denied');
select pg_temp.ok(paid_access('aaaaaaaa-0000-4000-8000-000000000001','topic','fake') = 'invalid', '假的 topic → invalid');
select pg_temp.buy('aaaaaaaa-0000-4000-8000-000000000001','topic_upgrade',null,false,'cs_3');
select pg_temp.ok((select topic_limit from entitlements) = 9 and (select count(*) from entitlement_topics) = 9, '6→9：补齐其余 3 个');
select pg_temp.ok((select array_agg(topic_id order by topic_id) from entitlement_topics) = (select array_agg(x order by x) from unnest(canonical_topic_ids()) x), 'Complete 正好是 9 个正式 topic');
select pg_temp.ok(paid_access('aaaaaaaa-0000-4000-8000-000000000001','map',null) = 'ok', 'Complete → Life Thread ok');
select pg_temp.fails($$select reserve_checkout_order('aaaaaaaa-0000-4000-8000-000000000001','test','topic_upgrade',null,false)$$, 'already_complete', 'Complete 之后不能再升级');
rollback;

\echo '== 6. paid_conflict =='
begin;
select reserve_checkout_order('aaaaaaaa-0000-4000-8000-000000000001','test','topics_3',array['self','love','study'],false) as old \gset
select activate_checkout_order(((:'old')::jsonb->>'order_id')::uuid, 'cs_old');
select pg_temp.buy('aaaaaaaa-0000-4000-8000-000000000001','complete',null,false,'cs_new');
select apply_checkout_payment(((:'old')::jsonb->>'order_id')::uuid,'cs_old','aaaaaaaa-0000-4000-8000-000000000001','test','pi','','p',688,'sgd',true) as c \gset
select pg_temp.ok((:'c')::jsonb->>'result' = 'conflict', '旧单在 Complete 之后才付款 → conflict');
select pg_temp.ok((select status from checkout_orders where stripe_checkout_session_id='cs_old') = 'paid_conflict', '订单记为 paid_conflict');
select pg_temp.ok((select entitlement_status from purchases where stripe_session_id='cs_old') = 'conflict', '付款记录保留并标记 conflict');
select pg_temp.ok((select topic_limit from entitlements) = 9 and (select count(*) from entitlement_topics) = 9, '权限没有被改动');
rollback;

begin;  -- 被取代、但转换仍然合法 → 照 Stripe 已收款发放
select reserve_checkout_order('aaaaaaaa-0000-4000-8000-000000000001','test','topics_3',array['self','love','study'],false) as o1 \gset
select activate_checkout_order(((:'o1')::jsonb->>'order_id')::uuid, 'cs_o1');
select reserve_checkout_order('aaaaaaaa-0000-4000-8000-000000000001','test','complete',null,false) as o2 \gset
select activate_checkout_order(((:'o2')::jsonb->>'order_id')::uuid, 'cs_o2');
select apply_checkout_payment(((:'o1')::jsonb->>'order_id')::uuid,'cs_o1','aaaaaaaa-0000-4000-8000-000000000001','test','pi','','p',688,'sgd',true) as r \gset
select pg_temp.ok((:'r')::jsonb->>'result' = 'applied', '被取代但仍合法的已付款单 → 发放');
select pg_temp.ok((:'r')::jsonb->'expire_sessions' = '["cs_o2"]', '同时作废还开着的新单');
select pg_temp.ok((select status from checkout_orders where stripe_checkout_session_id='cs_o2') = 'superseded', '新单变 superseded');
rollback;
