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
--   2. 同一项两边都有、内容不同 → 用版本与「服务器盖的时间」判断谁比较新:
--        · 版本(ver,生命蓝图再加 bpVer)较高 → 接受新的;较低 → 保留原本的。
--        · 版本相同 → 看 savedAt。savedAt 由【资料库】在每次接受内容变更时盖上(毫秒,服务器时钟),
--          前端只是把「它手上那一份的 savedAt」原样带回来,当作「我是根据哪一版改的」。
--          带回来的 savedAt 等于(或晚于)资料库现在这一份 → 是根据最新版改的 → 接受,并重新盖时间;
--          比资料库这一份早 → 旧分页的旧副本 → 保留资料库的。
--        · 完全不依赖装置时钟:装置时间不准也不会让新内容被拒绝、或让旧内容盖掉新内容。
--        · 内容相同(只差 savedAt)→ 保留原本那份,不重新盖时间。
--        · 旧资料没有 savedAt → 当作 0;两边都没有 → 以新写入为准(与以前相同),并盖上时间。
--   3. 收藏(favs)以 key 合并:旧分页少带的收藏会被留下来。
--        · 新增收藏:前端标记 fresh = true,资料库盖上 addedAt(服务器时钟)并拿掉 fresh。
--        · 取消收藏:前端在 favsRemoved[key] 写入「被取消的那一笔的 addedAt」
--          (还没拿到 addedAt 的新收藏写 -1,由资料库盖上当下时间)。
--          addedAt 不晚于墓碑的收藏不显示 → 取消之后旧分页救不回来;之后再收藏一次(新的 addedAt)会出现。
--          墓碑两边取较大值合并,重送同一个取消不会改变结果(不依赖装置时钟)。
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

-- 内容的 savedAt(由资料库盖上的服务器时间,毫秒);旧资料没有 → 0
create or replace function public._content_saved(v jsonb)
returns numeric language sql immutable set search_path = public, pg_temp as $$
  select case when jsonb_typeof(v -> 'savedAt') = 'number' then (v ->> 'savedAt')::numeric else 0 end
$$;

-- 两份内容是否相同(不看 savedAt)
create or replace function public._content_same(n jsonb, o jsonb)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select case when jsonb_typeof(n) = 'object' and jsonb_typeof(o) = 'object'
              then (n - 'savedAt') = (o - 'savedAt') else n = o end
$$;

-- 一项内容的合并结果:n = 新写入的、o = 资料库原本的、now = 服务器时间(毫秒)。回传 null 表示两边都没有。
create or replace function public._content_merge(n jsonb, o jsonb, now_ms numeric)
returns jsonb language plpgsql immutable set search_path = public, pg_temp as $$
declare
  stamp numeric;
begin
  if n is null or jsonb_typeof(n) = 'null' then
    return case when o is null or jsonb_typeof(o) = 'null' then null else o end;   -- 少带 / null:保留原本的
  end if;
  stamp := greatest(now_ms, public._content_saved(o) + 1);
  if o is null or jsonb_typeof(o) = 'null' then
    return case when jsonb_typeof(n) = 'object' then n || jsonb_build_object('savedAt', stamp) else n end;
  end if;
  if public._content_same(n, o) then
    return o;                                                                       -- 内容没变:保留原本的时间
  end if;
  if public._content_rank(n) > public._content_rank(o)
     or (public._content_rank(n) = public._content_rank(o) and public._content_saved(n) >= public._content_saved(o)) then
    return case when jsonb_typeof(n) = 'object' then n || jsonb_build_object('savedAt', stamp) else n end;
  end if;
  return o;                                                                         -- 旧副本 / 降级:保留原本的
end $$;

-- 收藏的加入时间(毫秒);旧资料没有 addedAt → 0
create or replace function public._fav_added(f jsonb)
returns numeric language sql immutable set search_path = public, pg_temp as $$
  select case when jsonb_typeof(f -> 'addedAt') = 'number' then (f ->> 'addedAt')::numeric else 0 end
$$;

create or replace function public.charts_content_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare
  now_ms  numeric := floor(extract(epoch from clock_timestamp()) * 1000);
  grp     text;
  src     text;
  k       text;
  o       jsonb;
  n       jsonb;
  r       jsonb;
  merged  jsonb;
  tomb    jsonb;
  v       numeric;
  favs    jsonb;
  f       jsonb;
  best    jsonb;
  seq     jsonb;
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
    o := case when jsonb_typeof(old.data -> grp) = 'object' then old.data -> grp else '{}'::jsonb end;
    n := case when jsonb_typeof(new.data -> grp) = 'object' then new.data -> grp else '{}'::jsonb end;
    continue when o = '{}'::jsonb and n = '{}'::jsonb and not (new.data ? grp);
    merged := '{}'::jsonb;
    for k in select jsonb_object_keys(o) union select jsonb_object_keys(n) loop
      r := public._content_merge(n -> k, o -> k, now_ms);
      if r is not null then merged := merged || jsonb_build_object(k, r); end if;
    end loop;
    new.data := jsonb_set(new.data, array[grp], merged, true);
  end loop;

  -- 1 / 2. 单一一份的内容
  foreach grp in array array['reading', 'reading_en', 'lifemap', 'lifemap_en'] loop
    r := public._content_merge(new.data -> grp, old.data -> grp, now_ms);
    if r is not null then
      new.data := jsonb_set(new.data, array[grp], r, true);
    end if;
  end loop;

  -- 3. 收藏:墓碑合并(取较大值;-1 = 由资料库盖上当下时间)→ 收藏以 key 合并 → 滤掉已经取消的
  tomb := case when jsonb_typeof(old.data -> 'favsRemoved') = 'object' then old.data -> 'favsRemoved' else '{}'::jsonb end;
  if jsonb_typeof(new.data -> 'favsRemoved') = 'object' then
    for k in select jsonb_object_keys(new.data -> 'favsRemoved') loop
      continue when jsonb_typeof(new.data -> 'favsRemoved' -> k) <> 'number';
      v := (new.data -> 'favsRemoved' ->> k)::numeric;
      if v < 0 then v := now_ms; end if;
      if jsonb_typeof(tomb -> k) is distinct from 'number' or v > (tomb ->> k)::numeric then
        tomb := tomb || jsonb_build_object(k, v);
      end if;
    end loop;
  end if;
  -- 收藏这次完全没变(大多数存档都是这样)→ 资料库原本那份本来就已经合并、过滤好了,不必重算
  if (new.data -> 'favs') is not distinct from (old.data -> 'favs')
     and (new.data -> 'favsRemoved' is null or (new.data -> 'favsRemoved') = (old.data -> 'favsRemoved')) then
    if old.data ? 'favsRemoved' then
      new.data := new.data || jsonb_build_object('favsRemoved', old.data -> 'favsRemoved');
    end if;
  elsif jsonb_typeof(old.data -> 'favs') = 'array' or jsonb_typeof(new.data -> 'favs') = 'array'
     or tomb <> '{}'::jsonb then
    -- 同一个 key 两边都有时取 addedAt 较新的那一笔(新收藏 fresh 由资料库盖上最新的时间),
    -- 最后再用墓碑过滤;顺序以新写入为准,再补上旧资料里有、新写入没有的。
    best := '{}'::jsonb;
    seq := '[]'::jsonb;
    for f, src in
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
        if src = 'new' or jsonb_typeof(new.data -> 'favs') is distinct from 'array' then
          seq := seq || jsonb_build_array(jsonb_build_object('item', f));
        end if;
        continue;
      end if;
      if src = 'new' and f -> 'fresh' = 'true'::jsonb then
        -- 这次新增的收藏:由资料库盖上加入时间(一定晚于这个 key 的墓碑)
        f := (f - 'fresh') || jsonb_build_object('addedAt',
               greatest(now_ms, case when jsonb_typeof(tomb -> k) = 'number' then (tomb ->> k)::numeric + 1 else 0 end));
      end if;
      if not (best ? k) then
        best := best || jsonb_build_object(k, f);
        seq := seq || jsonb_build_array(jsonb_build_object('key', k));
      elsif public._fav_added(f) > public._fav_added(best -> k) then
        best := best || jsonb_build_object(k, f);
      end if;
    end loop;
    favs := '[]'::jsonb;
    for f in select x from jsonb_array_elements(seq) x loop
      if f ? 'item' then
        favs := favs || jsonb_build_array(f -> 'item');
        continue;
      end if;
      k := f ->> 'key';
      continue when jsonb_typeof(tomb -> k) = 'number' and public._fav_added(best -> k) <= (tomb ->> k)::numeric;
      favs := favs || jsonb_build_array(best -> k);
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
    -- 原本是 true 的一律保留 true(新写入就算带了 false 也不会把已读变回未读)
    new.data := new.data || jsonb_build_object('readTopics',
      n || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(o) e where e.value = 'true'::jsonb), '{}'::jsonb));
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
