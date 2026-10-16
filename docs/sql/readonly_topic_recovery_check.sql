-- The Inner Sky · 主题能不能从服务器快取恢复(只读)
-- ===============================================================
-- 目的:找出「星盘里少了某个正式主题,但服务器快取(readings)里还有那一篇中文」的账号。
--       这些主题生成过、也付过模型费用,只是被旧装置 / 旧分页整份写回时盖掉了。
-- 只读:只有 select;不输出任何解读内容、邮箱或出生资料(user_id 只显示前 8 码)。
--
-- 快取键与 read-chart / 前端相同:sha256(date|time|lat.toFixed(4)|lon.toFixed(4)|topic:<tid>|v10)
-- 注:这里用 round(x, 4) 模拟 JavaScript 的 toFixed(4);两者只在第 5 位小数刚好是 5 的
--     极少数情况、或座标是 -0.0000x 时可能不同(那样会显示成 cache_missing,实际上可能有)。
--
-- 怎么恢复(本档不做任何写入):
--   · 最安全:请用户本人(只开一个分页)打开缺少的那个主题页 —— 网站向 read-chart 要内容,
--     快取命中就原样返回、不呼叫模型、不花钱,并照常存回星盘。
--   · 后台恢复(需要另外授权、另写一次性 SQL):把 readings.analysis 原文以
--     {"ver":10,"raw":<analysis>} 写回 charts.data.topics.<tid>;前端 reviveTopic() 会从 raw 解析出内容。
-- ===============================================================
with c as (
  select ch.user_id, ch.data,
         concat_ws('|', coalesce(ch.data->>'date', ''), coalesce(ch.data->>'time', ''),
                   round((ch.data->>'lat')::numeric, 4)::text, round((ch.data->>'lon')::numeric, 4)::text) as seed
    from public.charts ch
   where jsonb_typeof(ch.data->'lat') = 'number' and jsonb_typeof(ch.data->'lon') = 'number'
),
t as (
  select c.user_id, tid,
         coalesce(jsonb_typeof(c.data->'topics'->tid) = 'object'
          and jsonb_typeof(c.data->'topics'->tid->'ver') = 'number'
          and (c.data->'topics'->tid->>'ver')::numeric >= 10
          and ((jsonb_typeof(c.data->'topics'->tid->'sections') = 'array'
                and jsonb_array_length(c.data->'topics'->tid->'sections') > 0)
               or c.data->'topics'->tid ? 'raw'), false)                                as in_chart,
         exists (select 1 from public.readings r
                  where r.fingerprint = encode(sha256(convert_to(c.seed || '|topic:' || tid || '|v10', 'UTF8')), 'hex')) as in_cache
    from c, unnest(public.canonical_topic_ids()) tid
)
select left(t.user_id::text, 8)                                                         as user_prefix,
       exists (select 1 from public.early_access_users e where e.user_id = t.user_id)    as early_user,
       count(*) filter (where in_chart)                                                  as topics_in_chart,
       string_agg(tid, ',' order by tid) filter (where not in_chart and in_cache)        as recoverable_from_cache,
       string_agg(tid, ',' order by tid) filter (where not in_chart and not in_cache)    as never_generated_or_cache_missing
  from t
 group by t.user_id
having count(*) filter (where not in_chart and in_cache) > 0
 order by early_user desc, user_prefix;
