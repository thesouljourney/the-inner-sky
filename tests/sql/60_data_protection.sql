\set ON_ERROR_STOP 1
create or replace function pg_temp.ok(cond boolean, label text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', label; end if; raise notice 'ok  %', label; end $$;
\set A '''aaaaaaaa-0000-4000-8000-000000000001'''
-- 每一个「装置」都只拿自己读到的那一份(快照),整份写回 —— 与前端 updateChart / savePrefs 的行为相同

\echo '== 11. 两个装置拿同一份旧版本,各自新增不同的主题(两种写入顺序) =='
begin;
set local role authenticated; set local request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000001'; set local request.jwt.claim.role = 'authenticated';
update charts set data = jsonb_set(data, '{topics}', '{"self":{"ver":10,"sections":[{"body":"S"}]}}');
select data as s0 from charts \gset
update charts set data = jsonb_set(:'s0'::jsonb, '{topics,emotion}', '{"ver":10,"sections":[{"body":"E"}]}');   -- 装置 1
update charts set data = jsonb_set(:'s0'::jsonb, '{topics,career}', '{"ver":10,"sections":[{"body":"C"}]}');    -- 装置 2(没看过 emotion)
select pg_temp.ok((select array_agg(k order by k) from charts, jsonb_object_keys(data->'topics') k) = array['career','emotion','self'],
  '顺序 1→2:两个装置新增的主题都留下');
rollback;
begin;
set local role authenticated; set local request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000001'; set local request.jwt.claim.role = 'authenticated';
update charts set data = jsonb_set(data, '{topics}', '{"self":{"ver":10,"sections":[{"body":"S"}]}}');
select data as s0 from charts \gset
update charts set data = jsonb_set(:'s0'::jsonb, '{topics,career}', '{"ver":10,"sections":[{"body":"C"}]}');    -- 装置 2 先
update charts set data = jsonb_set(:'s0'::jsonb, '{topics,emotion}', '{"ver":10,"sections":[{"body":"E"}]}');   -- 装置 1 后
select pg_temp.ok((select array_agg(k order by k) from charts, jsonb_object_keys(data->'topics') k) = array['career','emotion','self'],
  '顺序 2→1:两个装置新增的主题都留下');
rollback;

\echo '== 12. 实际发生过的情况:旧分页只有 6 篇,别的装置补到 9 篇,旧分页收藏一句话后整份写回 =='
begin;
set local role authenticated; set local request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000001'; set local request.jwt.claim.role = 'authenticated';
update charts set data = jsonb_set(data, '{topics}', (select jsonb_object_agg(t, jsonb_build_object('ver',10,'sections',jsonb_build_array(jsonb_build_object('body',t))))
                                                         from unnest(array['self','emotion','career','family','love','wealth']) t));
select data as old_tab from charts \gset
update charts set data = jsonb_set(data, '{topics}', data->'topics' || (select jsonb_object_agg(t, jsonb_build_object('ver',10,'sections',jsonb_build_array(jsonb_build_object('body',t))))
                                                                         from unnest(array['partner','study','body']) t));
update charts set data = :'old_tab'::jsonb || '{"favs":[{"key":"k1","text":"一句话","addedAt":1000}]}';
select pg_temp.ok((select count(*) from charts, jsonb_object_keys(data->'topics') k) = 9, '旧分页写回后九个主题都还在');
select pg_temp.ok((select data->'favs'->0->>'key' from charts) = 'k1', '旧分页这次的收藏照常存入');
-- 资料完全不带 topics(例如很早以前打开的分页)
update charts set data = '{"date":"1994-11-20","time":"08:30","lat":1.29,"lon":103.85,"nick":"A"}';
select pg_temp.ok((select count(*) from charts, jsonb_object_keys(data->'topics') k) = 9, '整份不带 topics 的写入也不会清掉主题');
rollback;

\echo '== 13. 正常更新、重新生成、版本降级、同版本的旧副本(savedAt 由资料库盖上) =='
begin;
set local role authenticated; set local request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000001'; set local request.jwt.claim.role = 'authenticated';
update charts set data = data || '{"topics":{"self":{"ver":10,"sections":[{"body":"旧"}]}},
  "reading":{"ver":10,"bpVer":11,"chapters":[{"body":"新写法"}]},
  "lifemap":{"ver":10,"sections":[{"body":"脉络"}]},
  "qa":{"q01":{"ver":10,"sections":[{"body":"答"}]}},
  "topics_en":{"self":{"ver":10,"sections":[{"body":"en"}]}}}';
select pg_temp.ok((select jsonb_typeof(data->'topics'->'self'->'savedAt') = 'number' and jsonb_typeof(data->'lifemap'->'savedAt') = 'number' from charts),
  '新写入的内容由资料库盖上 savedAt');
select data as s0 from charts \gset
select (data->'topics'->'self'->>'savedAt')::numeric as base from charts \gset
-- 根据最新版(带回同一个 savedAt)重新生成 → 接受,并盖上更新的时间
update charts set data = jsonb_set(:'s0'::jsonb, '{topics,self}', jsonb_build_object('ver',10,'savedAt',:base,'sections',jsonb_build_array(jsonb_build_object('body','重新生成')),'previews',jsonb_build_object('ver',1)));
select pg_temp.ok((select data->'topics'->'self'->'sections'->0->>'body' = '重新生成' and (data->'topics'->'self'->>'savedAt')::numeric > :base from charts),
  '根据最新版重新生成 / 补上预览:接受,savedAt 由资料库更新');
-- 旧分页(手上还是 s0,savedAt 较早)整份写回
update charts set data = :'s0'::jsonb || '{"nick":"旧分页"}';
select pg_temp.ok((select data->'topics'->'self'->'sections'->0->>'body' from charts) = '重新生成', '同版本但 savedAt 较早的旧副本不能盖回去');
update charts set data = jsonb_set(:'s0'::jsonb, '{topics,self}', '{"ver":10,"sections":[{"body":"旧副本加了东西"}]}');
select pg_temp.ok((select data->'topics'->'self'->'sections'->0->>'body' from charts) = '重新生成', '没有 savedAt 的旧副本(旧版前端)也盖不回去');
update charts set data = jsonb_set(:'s0'::jsonb, '{topics,self}', '{"ver":9,"savedAt":99999999999999,"sections":[{"body":"过期版本"}]}');
select pg_temp.ok((select data->'topics'->'self'->'sections'->0->>'body' from charts) = '重新生成', '版本较旧的内容不能盖掉较新的(就算 savedAt 很大)');
-- 装置时钟不准也没关系:前端送的 savedAt 只是「根据哪一版改的」
select data as s1 from charts \gset
select (data->'topics'->'self'->>'savedAt')::numeric as base1 from charts \gset
update charts set data = jsonb_set(:'s1'::jsonb, '{topics,self}', jsonb_build_object('ver',10,'savedAt',:base1,'sections',jsonb_build_array(jsonb_build_object('body','时钟落后的装置重新生成'))));
select pg_temp.ok((select data->'topics'->'self'->'sections'->0->>'body' from charts) = '时钟落后的装置重新生成', '装置时钟落后:根据最新版的重新生成照常接受');
update charts set data = jsonb_set(:'s1'::jsonb, '{topics,self}', '{"ver":10,"savedAt":99999999999999,"sections":[{"body":"伪造很大的 savedAt"}]}');
select pg_temp.ok((select (data->'topics'->'self'->>'savedAt')::numeric < 99999999999999 from charts), '前端送来很大的 savedAt 也会被资料库换成服务器时间(不会卡住之后的更新)');
select data as s2 from charts \gset
select (data->'topics'->'self'->>'savedAt')::numeric as base2 from charts \gset
update charts set data = jsonb_set(:'s2'::jsonb, '{topics,self}', jsonb_build_object('ver',10,'savedAt',:base2,'sections',jsonb_build_array(jsonb_build_object('body','之后的正常更新'))));
select pg_temp.ok((select data->'topics'->'self'->'sections'->0->>'body' from charts) = '之后的正常更新', '之后根据最新版的更新照常接受');
-- 内容没变(只差 savedAt):保留原本的时间,不当成新的更新
update charts set data = jsonb_set(:'s2'::jsonb, '{topics,self}', (select (data->'topics'->'self') - 'savedAt' from charts));
select pg_temp.ok((select data->'topics'->'self'->'sections'->0->>'body' from charts) = '之后的正常更新', '内容相同、只差 savedAt:维持原状');
-- 两边都没有 savedAt 的旧资料:与以前相同,以新写入为准
update charts set data = jsonb_set(data, '{qa,q01}', '{"ver":10,"sections":[{"body":"答"}]}');   -- 先让资料库这一份没有 savedAt(service 以外写入会盖时间,这里直接测合并函数)
select pg_temp.ok(public._content_merge('{"ver":10,"x":2}', '{"ver":10,"x":1}', 1000) = '{"ver":10,"x":2,"savedAt":1000}', '两边都没有 savedAt:以新写入为准并盖上时间');
-- 生命蓝图
select data as s3 from charts \gset
select (data->'reading'->>'savedAt')::numeric as rb from charts \gset
update charts set data = jsonb_set(:'s3'::jsonb, '{reading}', '{"ver":10,"bpVer":10,"savedAt":99999999999999,"chapters":[{"body":"旧写法"}]}');
select pg_temp.ok((select data->'reading'->'chapters'->0->>'body' from charts) = '新写法', '生命蓝图:旧写法(bpVer 较低)不能盖掉升级后的版本');
update charts set data = jsonb_set(:'s3'::jsonb, '{reading}', jsonb_build_object('ver',10,'bpVer',11,'savedAt',:rb,'chapters',jsonb_build_array(jsonb_build_object('body','同版本重写'))));
select pg_temp.ok((select data->'reading'->'chapters'->0->>'body' from charts) = '同版本重写', '生命蓝图:根据最新版的同版本更新照常写入');
update charts set data = jsonb_set(:'s3'::jsonb, '{reading}', '{"ver":10,"bpVer":12,"chapters":[{"body":"更新的写作层"}]}');
select pg_temp.ok((select data->'reading'->'chapters'->0->>'body' from charts) = '更新的写作层', '生命蓝图:写作层升级(bpVer 较高)一律接受');
-- 少带 / null
select data as s4 from charts \gset
update charts set data = (:'s4'::jsonb - 'lifemap' - 'qa' - 'topics_en') || '{"reading":null}';
select pg_temp.ok((select data ? 'lifemap' and data->'qa' ? 'q01' and data->'topics_en' ? 'self'
                            and data->'reading'->'chapters'->0->>'body' = '更新的写作层' from charts),
  '生命脉络 / 探索题 / 英文主题 / 生命蓝图:少带或写成 null 都不会被清掉');
update charts set data = jsonb_set(:'s4'::jsonb, '{topics,self}', 'null');
select pg_temp.ok((select data->'topics'->'self'->'sections'->0->>'body' from charts) = '之后的正常更新', '主题写成 null 也不会被清掉');
update charts set data = jsonb_set(:'s4'::jsonb, '{topics}', '[]');
select pg_temp.ok((select jsonb_typeof(data->'topics') = 'object' and data->'topics' ? 'self' from charts), 'topics 写成别的型别也不会被清掉');
-- 其他栏位维持最后写入为准;出生资料锁照常
update charts set data = :'s4'::jsonb || '{"nick":"新名字","sys":"whole","date":"2000-01-01"}';
select pg_temp.ok((select data->>'nick' = '新名字' and data->>'sys' = 'whole' from charts), '显示名称 / 宫位制:最后写入为准');
select pg_temp.ok((select data->>'date' from charts) = '1994-11-20', '出生资料锁照常生效');
update charts set data = (select data from charts) - 'needsPlace';
select pg_temp.ok(true, '前端会合法删除的一般栏位(needsPlace 等)照常可以删除');
rollback;

\echo '== 14. 后台(service_role / SQL Editor)不受限制 =='
begin;
update charts set data = data || '{"topics":{"self":{"ver":10,"sections":[{"body":"S"}]}},"lifemap":{"ver":10}}';
set local request.jwt.claim.role = 'service_role';
update charts set data = data - 'topics' - 'lifemap';
select pg_temp.ok((select not (data ? 'topics') and not (data ? 'lifemap') from charts), 'service_role 可以做后台删除 / 更正');
rollback;
begin;
update charts set data = data || '{"topics":{"self":{"ver":10}}}';
update charts set data = data - 'topics';
select pg_temp.ok((select not (data ? 'topics') from charts), 'SQL Editor(没有前端身分)可以做后台更正');
rollback;

\echo '== 15. 收藏:新增 / 取消 / 再收藏 / 旧分页覆盖(两种顺序),addedAt 与墓碑由资料库决定 =='
begin;
set local role authenticated; set local request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000001'; set local request.jwt.claim.role = 'authenticated';
update charts set data = data || '{"favs":[]}';
select data as s0 from charts \gset
update charts set data = :'s0'::jsonb || '{"favs":[{"key":"k1","text":"a","fresh":true}]}';            -- 装置 1 收藏 k1
select pg_temp.ok((select jsonb_typeof(data->'favs'->0->'addedAt') = 'number' and not (data->'favs'->0 ? 'fresh') from charts),
  '新增的收藏由资料库盖上 addedAt,fresh 标记拿掉');
select data as s1 from charts \gset
select (data->'favs'->0->>'addedAt')::numeric as a1 from charts \gset
update charts set data = :'s0'::jsonb || '{"nick":"旧分页"}';                                             -- 装置 2(旧)存别的东西
select pg_temp.ok((select jsonb_array_length(data->'favs') = 1 from charts), '旧分页写回:别处新增的收藏还在');
update charts set data = :'s1'::jsonb || jsonb_build_object('favs', '[]'::jsonb, 'favsRemoved', jsonb_build_object('k1', :a1));  -- 装置 1 取消 k1
update charts set data = :'s1'::jsonb || '{"nick":"旧分页 2"}';                                           -- 装置 2 拿着还有 k1 的旧版本写回
select pg_temp.ok((select jsonb_array_length(data->'favs') = 0 and (data->'favsRemoved'->>'k1')::numeric = :a1 from charts),
  '取消的收藏不会被旧分页救回来(墓碑保留)');
update charts set data = :'s1'::jsonb || jsonb_build_object('favs', '[]'::jsonb, 'favsRemoved', jsonb_build_object('k1', :a1));  -- 同一个取消重送一次
select pg_temp.ok((select (data->'favsRemoved'->>'k1')::numeric = :a1 from charts), '重送同一个取消:墓碑不变(不依赖时钟)');
update charts set data = :'s1'::jsonb || '{"favs":[{"key":"k1","text":"a","fresh":true}]}';             -- 之后再收藏一次
select pg_temp.ok((select data->'favs'->0->>'key' = 'k1' and jsonb_array_length(data->'favs') = 1
                          and (data->'favs'->0->>'addedAt')::numeric > :a1 from charts), '再收藏一次会出现(新的 addedAt 晚于墓碑)');
update charts set data = :'s1'::jsonb || '{"nick":"旧分页 3"}';
select pg_temp.ok((select jsonb_array_length(data->'favs') = 1 from charts), '再收藏之后,旧分页也吃不掉');
-- 收藏完全没变、也没带墓碑的写入(大多数存档):墓碑与收藏照旧
update charts set data = ((select data from charts) - 'favsRemoved') || '{"nick":"一般存档"}';
select pg_temp.ok((select (data->'favsRemoved'->>'k1')::numeric = :a1 and jsonb_array_length(data->'favs') = 1 from charts),
  '收藏没变、没带墓碑的一般存档:墓碑与收藏都保留');
rollback;
begin;  -- 顺序相反:旧分页先写,再取消;旧格式收藏(没有 addedAt)
set local role authenticated; set local request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000001'; set local request.jwt.claim.role = 'authenticated';
update charts set data = data || '{"favs":[{"key":"k1","text":"a"},{"key":"k2","text":"b","addedAt":5}]}';
select data as s1 from charts \gset
update charts set data = :'s1'::jsonb || '{"nick":"旧分页"}';
update charts set data = :'s1'::jsonb || '{"favs":[{"key":"k2","text":"b","addedAt":5}],"favsRemoved":{"k1":0}}';
update charts set data = :'s1'::jsonb || '{"nick":"旧分页 2"}';
select pg_temp.ok((select jsonb_array_length(data->'favs') = 1 and data->'favs'->0->>'key' = 'k2' from charts),
  '旧格式收藏(没有 addedAt)取消后也不会被救回;没有取消的照常保留');
select pg_temp.ok((select count(*) = 1 from charts, jsonb_array_elements(data->'favs') f where f->>'key' = 'k2'), '同一个收藏不会重复');
-- 刚收藏、还没拿到 addedAt 就取消(墓碑 -1 → 资料库盖当下时间)
update charts set data = (select data from charts) || '{"favs":[{"key":"k2","text":"b","addedAt":5},{"key":"k3","text":"c","fresh":true}]}';
select data as s2 from charts \gset
update charts set data = (:'s1'::jsonb - 'favs') || '{"favs":[{"key":"k2","text":"b","addedAt":5}],"favsRemoved":{"k3":-1}}';
select pg_temp.ok((select not exists (select 1 from jsonb_array_elements(data->'favs') f where f->>'key' = 'k3')
                          and (data->'favsRemoved'->>'k3')::numeric > 0 from charts), '刚收藏就取消(墓碑 -1):资料库盖上时间,收藏被移除');
update charts set data = :'s2'::jsonb || '{"nick":"旧分页 3"}';
select pg_temp.ok((select not exists (select 1 from jsonb_array_elements(data->'favs') f where f->>'key' = 'k3') from charts),
  '拿着那笔刚收藏的旧分页写回,也救不回来');
rollback;

\echo '== 16. 已读记录(prefs):只增不减,两种写入顺序 =='
begin;
set local request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000001'; set local request.jwt.claim.role = 'authenticated';
insert into prefs (user_id, data) values (:A, '{"readTopics":{"self":true},"readOrder":["self"],"glyphMode":"sym"}');
select data as p0 from prefs \gset
-- 与前端 savePrefs 相同:upsert 整份 data
insert into prefs (user_id, data) values (:A, jsonb_set(jsonb_set(:'p0'::jsonb, '{readTopics,emotion}', 'true'), '{readOrder}', '["self","emotion"]'))
  on conflict (user_id) do update set data = excluded.data;
insert into prefs (user_id, data) values (:A, jsonb_set(jsonb_set(:'p0'::jsonb, '{readTopics,career}', 'true'), '{readOrder}', '["self","career"]') || '{"glyphMode":"name"}')
  on conflict (user_id) do update set data = excluded.data;
select pg_temp.ok((select array_agg(k order by k) from prefs, jsonb_object_keys(data->'readTopics') k) = array['career','emotion','self'], '两个装置的已读记录都留下');
select pg_temp.ok((select data->'readOrder' from prefs) = '["self","career","emotion"]', '阅读顺序:最后写入为准,补上遗漏的');
select pg_temp.ok((select data->>'glyphMode' from prefs) = 'name', '其他偏好:最后写入为准');
insert into prefs (user_id, data) values (:A, '{}') on conflict (user_id) do update set data = excluded.data;
select pg_temp.ok((select count(*) from prefs, jsonb_object_keys(data->'readTopics') k) = 3, '整份空白的旧资料也不会清掉已读记录');
insert into prefs (user_id, data) values (:A, '{"readTopics":{"self":false}}') on conflict (user_id) do update set data = excluded.data;
select pg_temp.ok((select data->'readTopics'->>'self' from prefs) = 'true', '已读不会被写回未读(就算新写入带了 false)');
select pg_temp.ok((select data->>'glyphMode' from prefs) = 'name', '旧分页没有带的偏好设定保留原值');
insert into prefs (user_id, data) values (:A, '{"glyphMode":"sym"}') on conflict (user_id) do update set data = excluded.data;
select pg_temp.ok((select data->>'glyphMode' from prefs) = 'sym', '有带的偏好设定以新写入为准');
set local request.jwt.claim.role = 'service_role';
update prefs set data = data - 'readTopics';
select pg_temp.ok((select not (data ? 'readTopics') from prefs), 'service_role 可以做后台更正');
rollback;

\echo '== 17. 安全:不是 SECURITY DEFINER、RLS 照常、别人的星盘碰不到 =='
select pg_temp.ok((select bool_and(not prosecdef) from pg_proc where proname in
  ('charts_content_guard','prefs_read_guard','_content_rank','_content_saved','_content_same','_content_merge','_fav_added')),
  '所有资料保护函数都以呼叫者权限执行(没有 SECURITY DEFINER,不会提升权限)');
select pg_temp.ok((select count(*) from pg_trigger where tgname in ('charts_content_guard_trg','prefs_read_guard_trg') and tgenabled = 'O') = 2,
  '两个 trigger 都已启用');
begin;
insert into auth.users values ('bbbbbbbb-0000-4000-8000-000000000002') on conflict do nothing;
update charts set data = data || '{"topics":{"self":{"ver":10,"sections":[{"body":"A 的"}]}}}';
set local role authenticated; set local request.jwt.claim.sub = 'bbbbbbbb-0000-4000-8000-000000000002'; set local request.jwt.claim.role = 'authenticated';
update charts set data = '{"topics":{}}';
select pg_temp.ok((select count(*) from charts) = 0, 'B 看不到 A 的星盘(RLS)');
reset role;
select pg_temp.ok((select data->'topics'->'self'->'sections'->0->>'body' from charts where user_id = :A) = 'A 的', 'B 的写入没有动到 A 的资料');
rollback;
