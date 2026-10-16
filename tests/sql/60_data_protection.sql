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

\echo '== 13. 正常更新、重新生成、版本降级、同版本的旧副本 =='
begin;
set local role authenticated; set local request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000001'; set local request.jwt.claim.role = 'authenticated';
update charts set data = data || '{"topics":{"self":{"ver":10,"savedAt":100,"sections":[{"body":"旧"}]}},
  "reading":{"ver":10,"bpVer":11,"savedAt":100,"chapters":[{"body":"新写法"}]},
  "lifemap":{"ver":10,"savedAt":100,"sections":[{"body":"脉络"}]},
  "qa":{"q01":{"ver":10,"sections":[{"body":"答"}]}},
  "topics_en":{"self":{"ver":10,"sections":[{"body":"en"}]}}}';
select data as s0 from charts \gset
update charts set data = jsonb_set(:'s0'::jsonb, '{topics,self}', '{"ver":10,"savedAt":200,"sections":[{"body":"重新生成"}],"previews":{"ver":1}}');
select pg_temp.ok((select data->'topics'->'self'->'sections'->0->>'body' from charts) = '重新生成', '重新生成 / 补上预览(savedAt 较新):新内容取代旧内容');
update charts set data = :'s0'::jsonb || '{"nick":"旧分页"}';
select pg_temp.ok((select data->'topics'->'self'->'sections'->0->>'body' from charts) = '重新生成', '同版本但 savedAt 较早的旧副本不能盖回去');
update charts set data = jsonb_set(:'s0'::jsonb, '{topics,self}', '{"ver":9,"savedAt":999,"sections":[{"body":"过期版本"}]}');
select pg_temp.ok((select data->'topics'->'self'->'sections'->0->>'body' from charts) = '重新生成', '版本较旧的内容不能盖掉较新的(即使 savedAt 较晚)');
update charts set data = jsonb_set(:'s0'::jsonb, '{topics,self}', '{"ver":10,"sections":[{"body":"旧版前端重写"}]}');
select pg_temp.ok((select data->'topics'->'self'->'sections'->0->>'body' from charts) = '重新生成', '没有 savedAt 的写入(旧版前端)不能盖掉有 savedAt 的内容');
update charts set data = jsonb_set(:'s0'::jsonb, '{qa,q01}', '{"ver":10,"sections":[{"body":"两边都没有 savedAt"}]}');
select pg_temp.ok((select data->'qa'->'q01'->'sections'->0->>'body' from charts) = '两边都没有 savedAt', '两边都没有 savedAt:与以前相同,以新写入为准');
update charts set data = jsonb_set(:'s0'::jsonb, '{reading}', '{"ver":10,"bpVer":10,"savedAt":999,"chapters":[{"body":"旧写法"}]}');
select pg_temp.ok((select data->'reading'->'chapters'->0->>'body' from charts) = '新写法', '生命蓝图:旧写法(bpVer 较低)不能盖掉升级后的版本');
update charts set data = jsonb_set(:'s0'::jsonb, '{reading}', '{"ver":10,"bpVer":11,"savedAt":300,"chapters":[{"body":"同版本重写"}]}');
select pg_temp.ok((select data->'reading'->'chapters'->0->>'body' from charts) = '同版本重写', '生命蓝图:同版本、较新的更新照常写入');
update charts set data = (:'s0'::jsonb - 'lifemap' - 'qa' - 'topics_en') || '{"reading":null}';
select pg_temp.ok((select data ? 'lifemap' and data->'qa' ? 'q01' and data->'topics_en' ? 'self'
                            and data->'reading'->'chapters'->0->>'body' = '同版本重写' from charts),
  '生命脉络 / 探索题 / 英文主题 / 生命蓝图:少带或写成 null 都不会被清掉');
update charts set data = jsonb_set(:'s0'::jsonb, '{topics,self}', 'null');
select pg_temp.ok((select data->'topics'->'self'->'sections'->0->>'body' from charts) = '重新生成', '主题写成 null 也不会被清掉');
-- 其他栏位维持最后写入为准;出生资料锁照常
update charts set data = :'s0'::jsonb || '{"nick":"新名字","sys":"whole","date":"2000-01-01"}';
select pg_temp.ok((select data->>'nick' = '新名字' and data->>'sys' = 'whole' from charts), '显示名称 / 宫位制:最后写入为准');
select pg_temp.ok((select data->>'date' from charts) = '1994-11-20', '出生资料锁照常生效');
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

\echo '== 15. 收藏:旧分页不能把取消的收藏救回来,也不能吃掉别处新增的收藏 =='
begin;
set local role authenticated; set local request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000001'; set local request.jwt.claim.role = 'authenticated';
update charts set data = data || '{"favs":[]}';
select data as s0 from charts \gset
update charts set data = :'s0'::jsonb || '{"favs":[{"key":"k1","text":"a","addedAt":1000}]}';           -- 装置 1 收藏 k1
select data as s1 from charts \gset
update charts set data = :'s0'::jsonb || '{"nick":"旧分页"}';                                            -- 装置 2(旧)存别的东西
select pg_temp.ok((select jsonb_array_length(data->'favs') = 1 from charts), '旧分页写回:别处新增的收藏还在');
update charts set data = :'s1'::jsonb || '{"favs":[],"favsRemoved":{"k1":2000}}';                       -- 装置 1 取消 k1
update charts set data = :'s1'::jsonb || '{"nick":"旧分页 2"}';                                          -- 装置 2 拿着还有 k1 的旧版本写回
select pg_temp.ok((select jsonb_array_length(data->'favs') = 0 and (data->'favsRemoved'->>'k1')::numeric = 2000 from charts),
  '取消的收藏不会被旧分页救回来(墓碑保留)');
update charts set data = :'s1'::jsonb || '{"favs":[{"key":"k1","text":"a","addedAt":3000}]}';           -- 之后再收藏一次
select pg_temp.ok((select data->'favs'->0->>'key' = 'k1' and jsonb_array_length(data->'favs') = 1 from charts), '再收藏一次会出现');
rollback;
begin;  -- 顺序相反:先取消、旧分页后写
set local role authenticated; set local request.jwt.claim.sub = 'aaaaaaaa-0000-4000-8000-000000000001'; set local request.jwt.claim.role = 'authenticated';
update charts set data = data || '{"favs":[{"key":"k1","text":"a"},{"key":"k2","text":"b","addedAt":5}]}';  -- k1 是没有 addedAt 的旧收藏
select data as s1 from charts \gset
update charts set data = :'s1'::jsonb || '{"nick":"旧分页"}';
update charts set data = :'s1'::jsonb || '{"favs":[{"key":"k2","text":"b","addedAt":5}],"favsRemoved":{"k1":2000}}';
update charts set data = :'s1'::jsonb || '{"nick":"旧分页 2"}';
select pg_temp.ok((select jsonb_array_length(data->'favs') = 1 and data->'favs'->0->>'key' = 'k2' from charts),
  '旧格式收藏(没有 addedAt)取消后也不会被救回;没有取消的照常保留');
select pg_temp.ok((select count(*) = 1 from charts, jsonb_array_elements(data->'favs') f where f->>'key' = 'k2'), '同一个收藏不会重复');
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
select pg_temp.ok((select data->>'glyphMode' from prefs) = 'name', '旧分页没有带的偏好设定保留原值');
insert into prefs (user_id, data) values (:A, '{"glyphMode":"sym"}') on conflict (user_id) do update set data = excluded.data;
select pg_temp.ok((select data->>'glyphMode' from prefs) = 'sym', '有带的偏好设定以新写入为准');
set local request.jwt.claim.role = 'service_role';
update prefs set data = data - 'readTopics';
select pg_temp.ok((select not (data ? 'readTopics') from prefs), 'service_role 可以做后台更正');
rollback;
