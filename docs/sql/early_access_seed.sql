-- The Inner Sky · 写入早期体验用户名单（Stage 1b 之后执行）
-- ===============================================================
-- 分两步，分开执行：
--   第 1 步（只读）：列出目前所有账号，逐一对照 email 确认 9 个有星盘的账号。
--   第 2 步（写入）：把确认过的 9 个 user_id 贴进 ids_text 再执行。
--                    写入前后都会逐一检查，任何一项不符就整段回滚，什么都不写入。
--
-- 资格只看这里明确列出的 user_id：不按注册日期、不自动挑选。
-- 没有星盘的测试账号不会被加入，也不会被删除或修改。
-- 不会建立任何购买、订阅或权限记录；不会碰星盘与阅读。
-- 免费范围使用预设 scopes：topics、life_thread、inner_tools。
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


-- ── 第 2 步：写入（只改 ids_text 那 9 行，其余不要动）───────────────
-- >>> 第 2 步开始
begin;
do $$
declare
  -- 你确认的 9 个 Early User（一行一个，保留单引号与逗号）
  ids_text text[] := array[
    '<user_id 1>',
    '<user_id 2>',
    '<user_id 3>',
    '<user_id 4>',
    '<user_id 5>',
    '<user_id 6>',
    '<user_id 7>',
    '<user_id 8>',
    '<user_id 9>'
  ];
  expected constant int := 9;
  ids  uuid[];
  bad  text;
  n    int;
begin
  -- 1. 格式：每一项都必须是 user_id（还没填入的占位文字会在这里被挡下）
  select string_agg(coalesce(x, '(空)'), ', ') into bad from unnest(ids_text) x
   where x is null
      or x !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  if bad is not null then
    raise exception '清单里有不是 user_id 的内容（是否还没填入？）：%', bad;
  end if;
  ids := ids_text::uuid[];

  -- 2. 人数核对
  if cardinality(ids) <> expected then
    raise exception '清单有 % 个 user_id，预期 % 个', cardinality(ids), expected;
  end if;

  -- 3. 不能重复
  if (select count(distinct x) from unnest(ids) x) <> cardinality(ids) then
    raise exception '清单里有重复的 user_id';
  end if;

  -- 4. 每个 user_id 都必须存在
  select string_agg(x::text, ', ') into bad from unnest(ids) x
   where not exists (select 1 from auth.users where id = x);
  if bad is not null then raise exception '这些 user_id 不存在：%', bad; end if;

  -- 5. 每个账号都必须已有星盘（没有星盘的测试账号不能加入）
  select string_agg(x::text, ', ') into bad from unnest(ids) x
   where not exists (select 1 from public.charts where user_id = x);
  if bad is not null then raise exception '这些账号没有星盘，不能加入：%', bad; end if;

  -- 6. 名单互斥：不能是付款测试账号
  select string_agg(x::text, ', ') into bad from unnest(ids) x
   where exists (select 1 from public.billing_test_users where user_id = x);
  if bad is not null then raise exception '这些账号在付款测试名单里，不能同时是体验用户：%', bad; end if;

  -- 7. 反向核对：目前所有有星盘的账号都应该在清单里（漏贴或期间有新账号 → 停下来再确认）
  select string_agg(c.user_id::text, ', ') into bad from public.charts c
   where c.user_id <> all (ids);
  if bad is not null then
    raise exception '这些账号有星盘但不在清单里，请再确认：%', bad;
  end if;

  -- 写入（使用预设 scopes；已经在名单里的不重复写入）
  insert into public.early_access_users (user_id, note)
  select x, 'Early User（早期体验用户）' from unnest(ids) x
  on conflict (user_id) do nothing;

  -- 8. 写入后核对：9 个都在名单里，且范围正好是预设的三项
  select count(*) into n from public.early_access_users
   where user_id = any (ids)
     and scopes = array['topics','life_thread','inner_tools']::text[];
  if n <> expected then
    raise exception '写入后核对失败：只有 % 个账号拥有预设范围，预期 %', n, expected;
  end if;

  raise notice '完成：% 个 Early User 已在名单中；没有星盘的 % 个账号未加入、未改动',
    n, (select count(*) from auth.users u
         where not exists (select 1 from public.charts c where c.user_id = u.id));
end $$;
commit;
-- <<< 第 2 步结束


-- ── 写入后检查（只读）──────────────────────────────────────────
select e.user_id, u.email, e.scopes, e.note, e.granted_at
  from public.early_access_users e join auth.users u on u.id = e.user_id
 order by u.created_at;

select (select enforcement_mode from public.billing_settings)  as mode,           -- 预期 test_accounts
       (select count(*) from public.billing_test_users)         as test_users,     -- 预期 0
       (select count(*) from public.early_access_users)         as early_users,    -- 预期 9
       (select count(*) from auth.users)                        as all_accounts;   -- 预期 13（没有删除任何账号）
