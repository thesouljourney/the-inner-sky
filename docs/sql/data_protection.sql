-- The Inner Sky · 资料保护:防止旧装置 / 旧分页整份覆盖写回(charts、prefs)
-- ===============================================================
-- 问题:前端存星盘是 PATCH 整份 charts.data,存偏好是 upsert 整份 prefs.data。
--   某个分页或装置还拿着旧版本(例如开着好几天的 iPhone Safari 分页),
--   只要做任何一个会存档的动作(收藏、打开主题、升级生命蓝图…),
--   就会把它手上的旧资料整份写回去,盖掉别的装置新生成的主题与已读记录。
--   已经发生过:某位 Early User 的 3 个主题从星盘与已读记录里同时消失,
--   但服务器快取(readings,只有服务端能写)里三篇都还在。
--
-- 做法:两个 BEFORE UPDATE trigger,只对前端用户(anon / authenticated)生效;
--   service_role 与 SQL Editor 不受影响(留给后台更正),写法与 charts_birth_lock 相同。
--   旧版前端(还开着的旧分页)不需要改任何代码就受到保护 —— 这正是出问题的那一类。
--
-- charts.data 的规则
--   1. 已生成的内容不会因为「这次写入里没有它」而消失:
--        topics / topics_en / qa / qa_en 的每一篇,以及 reading / reading_en / lifemap / lifemap_en。
--      新写入没有这一项(或是 null)→ 保留资料库里原本那一份。
--   2. 同一项两边都有 → 比较「谁比较新」,保留比较新的那一份:
--        先比版本(ver,生命蓝图再加 bpVer);版本相同再比 savedAt(前端每次写入内容时盖上的毫秒时间)。
--      所以正常更新(重新生成、补上预览、生命蓝图升级)照常写入,
--      旧分页拿着较早的一份写回时(版本较旧,或同版本但 savedAt 较早)则保留资料库里较新的那份。
--      旧资料没有 savedAt → 当作 0;两边都没有 → 以新写入为准(与以前相同)。
--   3. 收藏(favs)以 key 合并:旧分页少带的收藏会被留下来。
--      主动取消收藏要留下墓碑 favsRemoved[key] = 取消的时间(毫秒),
--      收藏本身带 addedAt(毫秒);addedAt 不晚于墓碑的收藏不显示 → 取消之后不会被旧分页救回来,
--      之后再收藏一次(addedAt 比较新)又会出现。墓碑两边取较新的时间合并。
--   4. 其他栏位(显示名称、宫位制…)维持「最后写入的为准」;出生资料仍由 charts_birth_lock 锁住。
--
-- prefs.data 的规则(前端从来不会主动删除偏好的任何一项)
--   · 新写入没有带的项目 → 保留资料库原本的值(旧分页手上缺的设定不会被抹掉);有带的以新写入为准。
--   · readTopics(已读记录):两边合并,只会增加不会减少。
--   · readOrder:以新写入的顺序为准,补上旧资料里有、新写入没有的项目。
--
-- 这份 SQL:只新增函数与 trigger;不改动任何既有资料、RLS、付费函数、出生资料锁或 readings 快取。
-- 回滚:docs/sql/data_protection_rollback.sql
-- ===============================================================

begin;

-- 内容的版本排序:ver 为主,生命蓝图再看 bpVer(没有就当 0)
create or replace function public._content_rank(v jsonb)
returns numeric language sql immutable set search_path = public, pg_temp as $$
  select case when jsonb_typeof(v -> 'ver') = 'number' then (v ->> 'ver')::numeric else 0 end * 1000
       + case when jsonb_typeof(v -> 'bpVer') = 'number' then (v ->> 'bpVer')::numeric else 0 end
$$;

-- 前端写入内容时盖上的时间(毫秒);旧资料没有 → 0
create or replace function public._content_saved(v jsonb)
returns numeric language sql immutable set search_path = public, pg_temp as $$
  select case when jsonb_typeof(v -> 'savedAt') = 'number' then (v ->> 'savedAt')::numeric else 0 end
$$;

-- 新写入的这一份是否「不比资料库里的旧」:版本较高,或版本相同且 savedAt 不较早
create or replace function public._content_not_older(n jsonb, o jsonb)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select public._content_rank(n) > public._content_rank(o)
      or (public._content_rank(n) = public._content_rank(o) and public._content_saved(n) >= public._content_saved(o))
$$;

-- 收藏的加入时间(毫秒);旧资料没有 addedAt → 0
create or replace function public._fav_added(f jsonb)
returns numeric language sql immutable set search_path = public, pg_temp as $$
  select case when jsonb_typeof(f -> 'addedAt') = 'number' then (f ->> 'addedAt')::numeric else 0 end
$$;

create or replace function public.charts_content_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare
  grp     text;
  k       text;
  o       jsonb;
  n       jsonb;
  merged  jsonb;
  tomb    jsonb;
  favs    jsonb;
  f       jsonb;
  seen    text[] := '{}';
begin
  if coalesce(auth.role(), '') not in ('anon', 'authenticated') then
    return new;
  end if;
  if old.data is null or jsonb_typeof(old.data) <> 'object' then
    return new;
  end if;
  if new.data is null or jsonb_typeof(new.data) <> 'object' then
    new.data := '{}'::jsonb;
  end if;

  -- 1 / 2. 一组一组的内容(每个主题 / 每道探索题各算一项)
  foreach grp in array array['topics', 'topics_en', 'qa', 'qa_en'] loop
    o := old.data -> grp;
    continue when o is null or jsonb_typeof(o) <> 'object';
    n := case when jsonb_typeof(new.data -> grp) = 'object' then new.data -> grp else '{}'::jsonb end;
    merged := n;
    for k in select jsonb_object_keys(o) loop
      continue when jsonb_typeof(o -> k) = 'null';
      if not (n ? k) or jsonb_typeof(n -> k) = 'null' or not public._content_not_older(n -> k, o -> k) then
        merged := merged || jsonb_build_object(k, o -> k);
      end if;
    end loop;
    new.data := jsonb_set(new.data, array[grp], merged, true);
  end loop;

  -- 1 / 2. 单一一份的内容
  foreach grp in array array['reading', 'reading_en', 'lifemap', 'lifemap_en'] loop
    o := old.data -> grp;
    continue when o is null or jsonb_typeof(o) = 'null';
    n := new.data -> grp;
    if n is null or jsonb_typeof(n) = 'null' or not public._content_not_older(n, o) then
      new.data := jsonb_set(new.data, array[grp], o, true);
    end if;
  end loop;

  -- 3. 收藏:墓碑合并(两边取较新的时间)→ 收藏以 key 合并 → 滤掉已经取消的
  tomb := case when jsonb_typeof(old.data -> 'favsRemoved') = 'object' then old.data -> 'favsRemoved' else '{}'::jsonb end;
  if jsonb_typeof(new.data -> 'favsRemoved') = 'object' then
    for k in select jsonb_object_keys(new.data -> 'favsRemoved') loop
      if jsonb_typeof(new.data -> 'favsRemoved' -> k) = 'number'
         and (not (tomb ? k) or jsonb_typeof(tomb -> k) <> 'number'
              or (new.data -> 'favsRemoved' ->> k)::numeric > (tomb ->> k)::numeric) then
        tomb := tomb || jsonb_build_object(k, new.data -> 'favsRemoved' -> k);
      end if;
    end loop;
  end if;
  if jsonb_typeof(old.data -> 'favs') = 'array' or jsonb_typeof(new.data -> 'favs') = 'array'
     or tomb <> '{}'::jsonb then
    favs := '[]'::jsonb;
    -- 新写入的顺序优先,再补上旧资料里有、新写入没有的
    for f, grp in
      select s.x, s.src from (
        select t.x, 'new' as src, 0 as pass, t.i
          from jsonb_array_elements(case when jsonb_typeof(new.data -> 'favs') = 'array' then new.data -> 'favs' else '[]'::jsonb end)
               with ordinality as t(x, i)
        union all
        select t.x, 'old', 1, t.i
          from jsonb_array_elements(case when jsonb_typeof(old.data -> 'favs') = 'array' then old.data -> 'favs' else '[]'::jsonb end)
               with ordinality as t(x, i)
      ) s order by s.pass, s.i
    loop
      k := f ->> 'key';
      if k is null then
        -- 没有 key 的旧格式无法比对:以新写入的为准;新写入根本没带 favs 时才沿用旧的
        if grp = 'new' or jsonb_typeof(new.data -> 'favs') <> 'array' or new.data -> 'favs' is null then
          favs := favs || jsonb_build_array(f);
        end if;
        continue;
      end if;
      continue when k = any (seen);
      seen := seen || k;
      continue when jsonb_typeof(tomb -> k) = 'number' and public._fav_added(f) <= (tomb ->> k)::numeric;
      favs := favs || jsonb_build_array(f);
    end loop;
    new.data := new.data || jsonb_build_object('favs', favs);
    if tomb <> '{}'::jsonb then
      new.data := new.data || jsonb_build_object('favsRemoved', tomb);
    end if;
  end if;

  return new;
end $$;

drop trigger if exists charts_content_guard_trg on public.charts;
-- 名称排序在 charts_birth_lock_trg 之后:先锁出生资料,再合并内容(两者处理的栏位互不重叠)
create trigger charts_content_guard_trg before update on public.charts
  for each row execute function public.charts_content_guard();

create or replace function public.prefs_read_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare
  o   jsonb;
  n   jsonb;
  ord jsonb;
  x   jsonb;
begin
  if coalesce(auth.role(), '') not in ('anon', 'authenticated') then
    return new;
  end if;
  if old.data is null or jsonb_typeof(old.data) <> 'object' then
    return new;
  end if;
  if new.data is null or jsonb_typeof(new.data) <> 'object' then
    new.data := '{}'::jsonb;
  end if;

  -- 新写入没有带的项目保留原值
  new.data := old.data || new.data;

  -- 已读记录只增不减
  o := old.data -> 'readTopics';
  if jsonb_typeof(o) = 'object' then
    n := case when jsonb_typeof(new.data -> 'readTopics') = 'object' then new.data -> 'readTopics' else '{}'::jsonb end;
    new.data := new.data || jsonb_build_object('readTopics', o || n);
  end if;

  -- 阅读顺序:新写入的顺序为准,补上遗漏的
  o := old.data -> 'readOrder';
  if jsonb_typeof(o) = 'array' then
    ord := case when jsonb_typeof(new.data -> 'readOrder') = 'array' then new.data -> 'readOrder' else '[]'::jsonb end;
    for x in select v from jsonb_array_elements(o) v loop
      if not (ord @> jsonb_build_array(x)) then ord := ord || jsonb_build_array(x); end if;
    end loop;
    new.data := new.data || jsonb_build_object('readOrder', ord);
  end if;

  return new;
end $$;

drop trigger if exists prefs_read_guard_trg on public.prefs;
create trigger prefs_read_guard_trg before update on public.prefs
  for each row execute function public.prefs_read_guard();

commit;
