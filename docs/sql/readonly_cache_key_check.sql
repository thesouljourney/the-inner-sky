-- The Inner Sky · read-chart v13 快取指纹核对(只读)
-- ===============================================================
-- 目的:确认「服务端用资料库里的出生资料自己算快取指纹」之后,既有快取仍然命中,
--       不会因为换算法而重新呼叫模型、多花费用。
-- 做法:用每张星盘 charts.data 的出生资料,依 read-chart v13 / 前端 askServer 的同一个公式
--       组出指纹,数一数 readings 表里有几个命中。
-- 只读:只有 select,不写入任何资料;不输出任何解读内容、邮箱或出生资料。
--
-- 公式(与 app.html 逐字相同):
--   seed = date | time | lat.toFixed(4) | lon.toFixed(4)
--   生命蓝图:sha256(seed|blueprint|v11-bp) + "-blueprint-writing-1.0"
--   主题:    sha256(seed|topic:<tid>|v10)          英文再加 "|en-w2"
-- 注:这里用 round(x, 4) 模拟 JavaScript 的 toFixed(4);两者只在第 5 位小数刚好是 5 的
--     极少数情况、或座标是 -0.0000x 时可能不同。真正的服务端使用与前端相同的 JavaScript。
-- ===============================================================
with c as (
  select ch.user_id,
         ch.data,
         concat_ws('|',
           coalesce(ch.data->>'date', ''), coalesce(ch.data->>'time', ''),
           round((ch.data->>'lat')::numeric, 4)::text,
           round((ch.data->>'lon')::numeric, 4)::text) as seed
    from public.charts ch
   where jsonb_typeof(ch.data->'lat') = 'number' and jsonb_typeof(ch.data->'lon') = 'number'
),
keys as (
  select user_id, 'blueprint' as kind, 'zh' as lang,
         encode(sha256(convert_to(seed || '|blueprint|v11-bp', 'UTF8')), 'hex') || '-blueprint-writing-1.0' as fp
    from c
  union all
  select user_id, 'blueprint', 'en',
         encode(sha256(convert_to(seed || '|blueprint|v11-bp|en-w2', 'UTF8')), 'hex') || '-blueprint-writing-1.0'
    from c
  union all
  select c.user_id, 'topic', 'zh',
         encode(sha256(convert_to(c.seed || '|topic:' || t || '|v10', 'UTF8')), 'hex')
    from c, unnest(public.canonical_topic_ids()) t
  union all
  select c.user_id, 'topic', 'en',
         encode(sha256(convert_to(c.seed || '|topic:' || t || '|v10|en-w2', 'UTF8')), 'hex')
    from c, unnest(public.canonical_topic_ids()) t
)
select left(c.user_id::text, 8)                                                         as user_prefix,
       exists (select 1 from public.early_access_users e where e.user_id = c.user_id)    as early_user,
       (c.data ? 'reading')                                                              as blueprint_in_chart,
       (select count(*) from public.readings r join keys k on k.fp = r.fingerprint
         where k.user_id = c.user_id and k.kind = 'blueprint')                           as blueprint_cache_hits,
       (select count(*) from unnest(public.canonical_topic_ids()) t
         where c.data->'topics' ? t)                                                     as topics_in_chart_zh,
       (select count(*) from public.readings r join keys k on k.fp = r.fingerprint
         where k.user_id = c.user_id and k.kind = 'topic' and k.lang = 'zh')             as topic_cache_hits_zh,
       (select count(*) from unnest(public.canonical_topic_ids()) t
         where c.data->'topics_en' ? t)                                                  as topics_in_chart_en,
       (select count(*) from public.readings r join keys k on k.fp = r.fingerprint
         where k.user_id = c.user_id and k.kind = 'topic' and k.lang = 'en')             as topic_cache_hits_en
  from c
 order by early_user desc, user_prefix;
