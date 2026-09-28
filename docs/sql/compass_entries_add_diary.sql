-- 我的星空记录 · 新增第三种记录「小小日记」(kind = 'diary')
-- ---------------------------------------------------------------
-- 在 Supabase 的 SQL Editor 里整段跑一次就好。
-- 只放宽 kind 的检查条件,不动任何既有资料、栏位或 RLS 政策。
--
-- 还没跑之前:写小小日记会被资料库拒收(页面显示「这次没有存成功」),
-- 此刻的我 / 问问自己不受影响。
-- ---------------------------------------------------------------

alter table public.compass_entries drop constraint if exists compass_kind_chk;
alter table public.compass_entries
  add constraint compass_kind_chk check (kind in ('note','answer','diary'));
