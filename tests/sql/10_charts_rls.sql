\set ON_ERROR_STOP 1
create or replace function pg_temp.ok(cond boolean, label text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', label; end if; raise notice 'ok  %', label; end $$;
-- 预期失败：执行 sql，必须抛出含 expect 的错误
create or replace function pg_temp.fails(sql text, expect text, label text) returns void language plpgsql as $$
begin
  begin execute sql; exception when others then
    if position(expect in sqlerrm) > 0 then raise notice 'ok  %  (%)', label, sqlerrm; return; end if;
    raise exception 'FAIL: % → 错误不符: %', label, sqlerrm;
  end;
  raise exception 'FAIL: % → 没有报错', label;
end $$;

\echo '== 1. 星盘锁 =='
begin;
set local role authenticated; set local request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000001'; set local request.jwt.claim.role = 'authenticated';
update charts set data = data || '{"date":"2000-01-01","lat":40.7,"utc":"2000-01-01T00:00:00Z","topics":{"self":{"x":1}},"nick":"A2"}'::jsonb;
select pg_temp.ok((select data->>'date' from charts) = '1994-11-20', '改出生日期 → 被还原');
select pg_temp.ok((select (data->>'lat')::float from charts) = 1.29, '改纬度 → 被还原');
select pg_temp.ok((select data->>'utc' from charts) = '1994-11-20T00:30:00Z', '改已存在的 utc → 被还原');
select pg_temp.ok((select data->'topics'->'self' from charts) = '{"x":1}', '阅读照常存入');
select pg_temp.ok((select data->>'nick' from charts) = 'A2', '显示名称可以改');
select pg_temp.fails($$insert into charts (id, user_id, data) values (gen_random_uuid(), 'aaaaaaaa-0000-4000-8000-000000000001', '{"date":"2001-01-01"}')$$, 'charts_one_per_user', '第二张星盘 → 拒绝');
delete from charts;
select pg_temp.ok((select count(*) from charts) = 1, '删除星盘 → 无效');
rollback;

begin;
set local role authenticated; set local request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002'; set local request.jwt.claim.role = 'authenticated';
insert into charts (id, user_id, data) values ('dddddddd-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000002', '{"date":"1990-05-05","time":"10:00"}');
update charts set data = data || '{"lat":3.1,"lon":101.7,"tzId":"Asia/Kuala_Lumpur"}'::jsonb;
select pg_temp.ok((select (data->>'lat')::float from charts) = 3.1, '资料不完整时可以补齐（onboarding 修复）');
update charts set data = data || '{"lat":9.9}'::jsonb;
select pg_temp.ok((select (data->>'lat')::float from charts) = 3.1, '补齐之后就锁定');
select pg_temp.ok((select data->>'tzId' from charts) = 'Asia/Kuala_Lumpur', 'tzId 可以补一次');
rollback;

begin;  -- SQL Editor / service_role 可以做后台更正
update charts set data = data || '{"time":"09:30"}'::jsonb;
select pg_temp.ok((select data->>'time' from charts) = '09:30', '后台更正不受锁限制');
rollback;

\echo '== 2. RLS / 执行权限 =='
begin;
insert into readings values ('fp1','secret reading');
insert into entitlement_topics (user_id, topic_id) values ('aaaaaaaa-0000-4000-8000-000000000001', 'self');
set local role authenticated; set local request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002'; set local request.jwt.claim.role = 'authenticated';
select pg_temp.ok((select count(*) from entitlement_topics) = 0, '读不到别人的 entitlement_topics');
select pg_temp.fails($$insert into entitlements (user_id, topic_limit) values ('bbbbbbbb-0000-4000-8000-000000000002', 9)$$, 'row-level security', '前端不能写 entitlements');
select pg_temp.fails($$insert into entitlement_topics (user_id, topic_id) values ('bbbbbbbb-0000-4000-8000-000000000002', 'self')$$, 'row-level security', '前端不能写 entitlement_topics');
select pg_temp.fails($$insert into checkout_orders (user_id, environment, category, plan_code) values ('bbbbbbbb-0000-4000-8000-000000000002','test','topics','complete')$$, 'permission denied', '前端不能写 checkout_orders');
select pg_temp.fails($$select reserve_checkout_order('bbbbbbbb-0000-4000-8000-000000000002','test','complete',null,false)$$, 'permission denied', '前端不能调用付费函数');
select pg_temp.fails($$select * from billing_test_users$$, 'permission denied', '前端读不到测试名单');
select pg_temp.ok((select count(*) from readings) = 0, '前端读不到 readings（cache 内容）');
rollback;
