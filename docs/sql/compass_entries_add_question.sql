-- 我的内在指南 · 记录表:补上「那天的问题」这一栏
-- ---------------------------------------------------------------
-- 什么时候要跑这一段:
--   你已经跑过 docs/sql/compass_entries.sql,表已经在线上了。
--   那一版没有 question 这一栏,所以使用者回答了「今天想问自己的一个问题」
--   之后,那个问题不会被存下来 —— 过几天回来看只剩下自己的答案。
--
-- 这一段做什么:
--   只做一件事 —— 加一个【可以为 null】的新栏位,再加一条长度限制。
--   不 drop 表、不重建表、不删任何一列、不改任何既有栏位、不碰既有政策与索引。
--   既有的每一列 question 都会是 null,前端读回来是空字串,画面自己会跳过,
--   不会凭空补一个问题出来,也不会报错。
--
-- 安全性:整段可以重复跑。第二次跑什么都不会发生。
--
-- 怎么跑:Supabase → SQL Editor → 整段贴上 → Run。
-- ---------------------------------------------------------------

alter table public.compass_entries
  add column if not exists question text;

-- 长度限制与前端一致(shape() 截在 160 字)。
-- 用 not valid 先挂上去,只约束之后写进来的资料,不去扫既有的列;
-- 既有列全是 null,所以紧接着 validate 也一定会过。
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'compass_question_len_chk'
      and conrelid = 'public.compass_entries'::regclass
  ) then
    alter table public.compass_entries
      add constraint compass_question_len_chk
      check (char_length(coalesce(question,'')) <= 160) not valid;
    alter table public.compass_entries
      validate constraint compass_question_len_chk;
  end if;
end $$;

-- 跑完之后不需要改前端:下一次开 #/compass,
-- 新写下的回答就会连同当天的问题一起存上去,展开时看得到「那天的问题：…」。
