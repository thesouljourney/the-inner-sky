-- 我的内在指南 · 「今天想问自己的一个问题」题库(做法 C)
-- ---------------------------------------------------------------
-- 在 Supabase 的 SQL Editor 里整段跑一次就好。在已有资料的表上跑是安全的:
-- 新栏位一律从 null 开始,旧的列不受影响。
--
-- 做法:一次请 AI 根据【这个人的星盘推导出来的内在运作方式】与他读过的文案,
-- 写一批(约 30 题)问题存在这一列;每天依序用一题,剩 3 题时再写下一批,
-- 并避开所有用过的题。大约一个月才呼叫一次 API,题目不会重复。
--
-- 仍然守着这张表的隐私契约:存的只是使用者会读到的题目本身。
-- 不存 prompt、不存模型原始输出、不存星盘、不存检查的内部状态。
--
--   daily_questions          还没用完的题(daily_questions[1] 是 daily_questions_start 那一天的题)
--   daily_questions_start    daily_questions[1] 是哪一天的题(使用者本地日期)
--   daily_questions_used     最近用过的题(最多 200 题),下一批会避开
--   daily_questions_version  写作指令版本(questions-v1)
--
-- 还没跑这段之前:题库只存在这台装置上(换装置会重新写一批),页面照常显示。
-- ---------------------------------------------------------------

alter table public.compass_results
  add column if not exists daily_questions         text[],
  add column if not exists daily_questions_start   date,
  add column if not exists daily_questions_used    text[],
  add column if not exists daily_questions_version text;

alter table public.compass_results drop constraint if exists cr_daily_questions_chk;
alter table public.compass_results add constraint cr_daily_questions_chk check (
  (daily_questions is null or (
     cardinality(daily_questions) <= 60 and
     char_length(array_to_string(daily_questions, '')) <= 6000)) and
  (daily_questions_used is null or (
     cardinality(daily_questions_used) <= 200 and
     char_length(array_to_string(daily_questions_used, '')) <= 20000)) and
  char_length(coalesce(daily_questions_version, '')) <= 40);
