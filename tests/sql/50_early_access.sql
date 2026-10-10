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
-- A = 早期体验用户（有星盘）；B = 普通新用户；C = 只有部分范围的体验用户
\set A '''aaaaaaaa-0000-4000-8000-000000000001'''
\set B '''bbbbbbbb-0000-4000-8000-000000000002'''
\set C '''cccccccc-0000-4000-8000-000000000003'''

\echo '== 10. 早期体验用户：enforcement_mode = all =='
begin;
update billing_settings set enforcement_mode = 'all';
insert into early_access_users (user_id, note) values (:A, 'Early User');
select pg_temp.ok((select scopes from early_access_users where user_id = :A) = array['topics','life_thread','inner_tools'], '预设范围 = 九个主题 + 生命脉络 + Inner Tools');
select pg_temp.ok(enforcement_applies(:A), 'enforcement_applies 不变（体验用户一样受登录、星盘等规则约束）');
select pg_temp.ok(paid_access(:A, 'topic', t) = 'early_access', 'all 模式：体验用户可读主题 ' || t) from unnest(canonical_topic_ids()) t;
select pg_temp.ok(paid_access(:A, 'map', null) = 'early_access', 'all 模式：体验用户可读生命脉络');
select pg_temp.ok(inner_tools_access(:A) = 'early_access', 'all 模式：体验用户可用 Inner Tools');
select pg_temp.ok(paid_access(:A, 'topic', 'nope') = 'invalid', '不合法的 topic 仍然是 invalid');
select pg_temp.ok(paid_access(:A, 'other', null) = 'invalid', '未知的 kind 仍然是 invalid');
select pg_temp.ok(paid_access(null, 'topic', 'self') = 'unauthenticated', '未登录仍然是 unauthenticated');
-- 新用户必须付费
select pg_temp.ok(paid_access(:B, 'topic', 'self') = 'denied', 'all 模式：新用户读主题 → denied');
select pg_temp.ok(paid_access(:B, 'map', null) = 'denied', 'all 模式：新用户读生命脉络 → denied');
select pg_temp.ok(inner_tools_access(:B) = 'expired', 'all 模式：新用户 Inner Tools → expired');
select pg_temp.ok(not early_access_covers_plan(:B, 'complete'), '新用户：可以进入付款流程');
select pg_temp.ok((reserve_checkout_order(:B,'test','complete',null,false)->>'to_limit') = '9', 'all 模式：新用户不在测试名单也能下单');
-- 体验用户不能下单
select pg_temp.ok(early_access_covers_plan(:A, p), '体验用户已涵盖方案 ' || p)
  from unnest(array['topics_3','topics_6','complete','topic_upgrade','complete_upgrade','inner_tools_monthly']) p;
select pg_temp.fails($$select reserve_checkout_order('aaaaaaaa-0000-4000-8000-000000000001','test','topics_3',array['self','love','career'],false)$$, 'checkout:early_access', '体验用户买 3 Topics → 拒绝');
select pg_temp.fails($$select reserve_checkout_order('aaaaaaaa-0000-4000-8000-000000000001','test','complete',null,true)$$, 'checkout:early_access', '体验用户买 Complete + 6M → 拒绝');
select pg_temp.fails($$select reserve_checkout_order('aaaaaaaa-0000-4000-8000-000000000001','test','inner_tools_monthly',null,false)$$, 'checkout:early_access', '体验用户订 Monthly → 拒绝');
select pg_temp.ok((select count(*) from checkout_orders where user_id = :A) = 0, '体验用户没有任何订单');
select pg_temp.ok((select count(*) from purchases where user_id = :A) = 0
              and (select count(*) from entitlements where user_id = :A) = 0
              and (select count(*) from entitlement_topics where user_id = :A) = 0
              and (select count(*) from subscriptions where user_id = :A) = 0, '没有假的购买、权限、订阅记录');
-- Inner Tools 写入（RLS）
set local role authenticated; set local request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000001'; set local request.jwt.claim.role = 'authenticated';
insert into compass_entries (user_id, body) values ('aaaaaaaa-0000-4000-8000-000000000001', 'early note');
update compass_entries set body = 'edited';
select pg_temp.ok((select body from compass_entries) = 'edited', 'all 模式：体验用户可以新增、编辑 Inner Tools 记录');
-- 出生资料仍然锁定、星盘不能删除、不能第二张
update charts set data = data || '{"date":"2000-01-01"}'::jsonb;
select pg_temp.ok((select data->>'date' from charts) = '1994-11-20', '体验用户：出生日期仍然锁定');
delete from charts;
select pg_temp.ok((select count(*) from charts) = 1, '体验用户：星盘仍然不能删除');
select pg_temp.fails($$insert into charts (id, user_id, data) values (gen_random_uuid(), 'aaaaaaaa-0000-4000-8000-000000000001', '{"date":"2001-01-01"}')$$, 'charts_one_per_user', '体验用户：仍然只能有一张星盘');
-- 名单本身：只看得到自己，不能自己加入或修改
select pg_temp.ok((select count(*) from early_access_users) = 1, '体验用户只看得到自己那一行');
select pg_temp.fails($$update early_access_users set scopes = array['topics']$$, 'permission denied', '不能修改自己的范围');
select pg_temp.fails($$delete from early_access_users$$, 'permission denied', '不能删除名单');
reset role;
set local role authenticated; set local request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002'; set local request.jwt.claim.role = 'authenticated';
select pg_temp.ok((select count(*) from early_access_users) = 0, '其他用户看不到名单');
select pg_temp.fails($$insert into early_access_users (user_id) values ('bbbbbbbb-0000-4000-8000-000000000002')$$, 'permission denied', '新用户不能把自己加进名单');
select pg_temp.fails($$insert into compass_entries (user_id, body) values ('bbbbbbbb-0000-4000-8000-000000000002','x')$$, 'row-level security', 'all 模式：新用户没有 Inner Tools 不能新增');
select pg_temp.fails($$select early_access_covers_plan('bbbbbbbb-0000-4000-8000-000000000002','complete')$$, 'permission denied', '前端不能直接调用 early_access_covers_plan');
reset role;
set local role anon;
select pg_temp.fails($$select * from early_access_users$$, 'permission denied', 'anon 不能读名单');
rollback;

\echo '== 11. test_accounts 模式（Sandbox 期间）=='
begin;
insert into early_access_users (user_id) values (:A);
select pg_temp.ok(paid_access(:A, 'topic', 'self') = 'not_enforced', '不在测试名单 → 照旧 not_enforced');
select pg_temp.ok(inner_tools_access(:A) = 'not_enforced', 'Inner Tools 照旧 not_enforced');
select pg_temp.fails($$select reserve_checkout_order('aaaaaaaa-0000-4000-8000-000000000001','test','complete',null,false)$$, 'checkout:early_access', 'test_accounts 模式：体验用户一样不能下单');
rollback;

\echo '== 12. 两份名单互斥 =='
begin;
insert into early_access_users (user_id) values (:A);
select pg_temp.fails($$insert into billing_test_users (user_id) values ('aaaaaaaa-0000-4000-8000-000000000001')$$, 'early_access:account_is_early_user', '体验用户不能加进付款测试名单');
insert into billing_test_users (user_id) values (:B);
select pg_temp.fails($$insert into early_access_users (user_id) values ('bbbbbbbb-0000-4000-8000-000000000002')$$, 'early_access:account_is_billing_test_user', '付款测试账号不能加进体验名单');
select pg_temp.fails($$update billing_test_users set user_id = 'aaaaaaaa-0000-4000-8000-000000000001'$$, 'early_access:account_is_early_user', '改 user_id 也不能绕过');
select pg_temp.ok(paid_access(:B, 'topic', 'self') = 'denied', '付款测试账号照旧被强制付费');
rollback;

\echo '== 13. 部分范围 / 未来功能不自动包含 =='
begin;
update billing_settings set enforcement_mode = 'all';
insert into auth.users values (:C);
insert into early_access_users (user_id, scopes) values (:C, array['topics']);
select pg_temp.ok(paid_access(:C, 'topic', 'self') = 'early_access', '只有 topics：主题开放');
select pg_temp.ok(paid_access(:C, 'map', null) = 'denied', '只有 topics：生命脉络不开放');
select pg_temp.ok(inner_tools_access(:C) = 'expired', '只有 topics：Inner Tools 不开放');
select pg_temp.ok(not early_access_covers_plan(:C, 'inner_tools_monthly'), '只有 topics：Monthly 仍要付费');
select pg_temp.ok(not early_access_covers_plan(:C, 'complete'), '没有 life_thread：Complete 仍可购买');
select pg_temp.ok((reserve_checkout_order(:C,'test','inner_tools_monthly',null,false)->>'category') = 'inner_tools_sub', '只有 topics：可以订 Monthly');
select pg_temp.fails($$insert into early_access_users (user_id, scopes) values ('bbbbbbbb-0000-4000-8000-000000000002', array['future_feature'])$$, 'early_access_scopes_chk', '未知的范围（未来功能）不接受');
select pg_temp.fails($$insert into early_access_users (user_id, scopes) values ('bbbbbbbb-0000-4000-8000-000000000002', array[]::text[])$$, 'early_access_scopes_chk', '空范围不接受');
select pg_temp.ok(not early_access_covers_category(:A, 'something_new'), '未知的付款类别 → 不涵盖');
delete from auth.users where id = :C;
select pg_temp.ok((select count(*) from early_access_users where user_id = :C) = 0, '账号删除 → 名单自动移除');
rollback;
