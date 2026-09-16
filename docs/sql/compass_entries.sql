-- 我的内在指南 · 记录表
-- ---------------------------------------------------------------
-- 在 Supabase 的 SQL Editor 里整段跑一次就好。
--
-- 这段 SQL 只会「新增」一张新表与它的索引、RLS 政策。
-- 不会碰 charts / prefs / readings / user_exploration_readings,
-- 也不会改任何既有栏位、既有政策或既有资料。
--
-- 跑完之后不需要改前端:下一次开 #/compass,前端会自己探测到这张表,
-- 切换成上云储存,并且把使用者这台装置上已经写过的记录一次搬上去。
-- ---------------------------------------------------------------

create table if not exists public.compass_entries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  mood        text,
  body        text,
  kind        text not null default 'note',
  -- 那天的问题:只有「回答了今天的问题」那一种记录才有,其余是 null。
  -- 这里【只】收问题本身,不收任何机制 / 分数 / prompt。
  question    text,
  constraint compass_kind_chk check (kind in ('note','answer')),
  constraint compass_body_len_chk check (char_length(coalesce(body,'')) <= 4000),
  constraint compass_mood_len_chk check (char_length(coalesce(mood,'')) <= 40),
  constraint compass_question_len_chk check (char_length(coalesce(question,'')) <= 160),
  -- 一则记录至少要有一样东西,不收全空的列
  constraint compass_not_empty_chk check (
    coalesce(body,'') <> '' or coalesce(mood,'') <> ''
  )
);

-- ⚠ 这张表如果【已经建过】,上面的 create table if not exists 不会补上 question 这一栏。
--    请改跑 docs/sql/compass_entries_add_question.sql —— 那是一段只加栏位的安全迁移。

-- 读的时候永远是「我自己的、由新到旧」,直接照这个形状建索引
create index if not exists compass_entries_user_created_idx
  on public.compass_entries (user_id, created_at desc);

alter table public.compass_entries enable row level security;

-- RLS 的形状与既有的 user_exploration_readings 一致:只碰得到自己的
drop policy if exists "compass read own"   on public.compass_entries;
drop policy if exists "compass write own"  on public.compass_entries;
drop policy if exists "compass update own" on public.compass_entries;
drop policy if exists "compass delete own" on public.compass_entries;

create policy "compass read own"   on public.compass_entries
  for select using (auth.uid() = user_id);
create policy "compass write own"  on public.compass_entries
  for insert with check (auth.uid() = user_id);
create policy "compass update own" on public.compass_entries
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "compass delete own" on public.compass_entries
  for delete using (auth.uid() = user_id);
