-- The Inner Sky · 资料保护的回滚(撤销 docs/sql/data_protection.sql)
-- ===============================================================
-- 只移除两个 trigger 与它们的函数;不改动任何资料。
-- 回滚之后:
--   · 已经被保护下来的内容(主题、生命蓝图、生命脉络、探索题、已读记录、收藏)都还在资料库里,不会消失。
--   · 但从此又回到「最后写入的为准」:旧装置 / 旧分页整份写回时,又可能盖掉别处新增的内容。
--   · 前端写入的 savedAt、收藏墓碑(favsRemoved)与 addedAt 会留在资料里,没有 trigger 时没有作用,也不影响显示。
-- ===============================================================
begin;
drop trigger if exists charts_content_guard_trg on public.charts;
drop trigger if exists prefs_read_guard_trg on public.prefs;
drop function if exists public.charts_content_guard();
drop function if exists public.prefs_read_guard();
drop function if exists public._content_not_older(jsonb, jsonb);   -- 旧版草稿用过的名称;不存在就跳过
drop function if exists public._content_merge(jsonb, jsonb, numeric);
drop function if exists public._content_same(jsonb, jsonb);
drop function if exists public._content_saved(jsonb);
drop function if exists public._content_rank(jsonb);
drop function if exists public._fav_added(jsonb);
commit;
