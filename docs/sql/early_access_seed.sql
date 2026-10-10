-- The Inner Sky · 写入早期体验用户名单（Stage 1b 之后执行）
-- ===============================================================
-- 分两步，分开执行：
--   第 1 步（只读）：列出目前所有账号，由你逐一确认 user_id 与 email。
--   第 2 步（写入）：把确认过的 user_id 填进下面的清单再执行。
--                    写入前会逐一检查，任何一项不符就整段回滚，什么都不写入。
-- 不会建立任何购买、订阅或权限记录；不会碰星盘与阅读。
-- ===============================================================


-- ── 第 1 步：只读，列出所有账号 ─────────────────────────────────
select u.id                         as user_id,
       u.email,
       u.created_at,
       (c.user_id is not null)      as has_chart,
       (t.user_id is not null)      as in_billing_test_users,
       (e.user_id is not null)      as already_early_access
  from auth.users u
  left join public.charts c             on c.user_id = u.id
  left join public.billing_test_users t on t.user_id = u.id
  left join public.early_access_users e on e.user_id = u.id
 order by u.created_at;


-- ── 第 2 步：写入（把确认过的 user_id 填进 ids，一行一个）──────────
-- begin;
-- do $$
-- declare
--   ids uuid[] := array[
--     '00000000-0000-0000-0000-000000000000'
--     -- , '...'
--   ]::uuid[];
--   expected int := 9;          -- 你确认的人数
--   bad text;
-- begin
--   if cardinality(ids) <> expected then
--     raise exception '清单有 % 个 user_id，预期 % 个', cardinality(ids), expected;
--   end if;
--   if (select count(distinct x) from unnest(ids) x) <> cardinality(ids) then
--     raise exception '清单里有重复的 user_id';
--   end if;
--   select string_agg(x::text, ', ') into bad from unnest(ids) x
--    where not exists (select 1 from auth.users where id = x);
--   if bad is not null then raise exception '这些 user_id 不存在：%', bad; end if;
--   select string_agg(x::text, ', ') into bad from unnest(ids) x
--    where not exists (select 1 from public.charts where user_id = x);
--   if bad is not null then raise exception '这些账号没有星盘，请再确认：%', bad; end if;
--   select string_agg(x::text, ', ') into bad from unnest(ids) x
--    where exists (select 1 from public.billing_test_users where user_id = x);
--   if bad is not null then raise exception '这些账号在付款测试名单里，不能同时是体验用户：%', bad; end if;
--
--   insert into public.early_access_users (user_id, note)
--   select x, 'Early User（早期体验用户）' from unnest(ids) x
--   on conflict (user_id) do nothing;
-- end $$;
-- commit;


-- ── 写入后检查（只读）──────────────────────────────────────────
-- select e.user_id, u.email, e.scopes, e.granted_at
--   from public.early_access_users e join auth.users u on u.id = e.user_id
--  order by u.created_at;
