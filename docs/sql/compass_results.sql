-- 我的内在指南 · 正式结果表(canonical Inner Compass)
-- ---------------------------------------------------------------
-- 在 Supabase 的 SQL Editor 里整段跑一次就好。
--
-- 这段 SQL 只会「新增」一张新表与它的 RLS 政策。
-- 不会碰 charts / prefs / readings / user_exploration_readings /
-- compass_entries,也不会改任何既有栏位、既有政策或既有资料。
--
-- 跑完之后不需要改前端:下一次开 #/compass,前端会自己探测到这张表。
-- 探测不到的时候前端一律安静回落到本机,绝不阻断页面、绝不重新生成。
-- ---------------------------------------------------------------
--
-- 这张表要解决的问题
-- ---------------------------------------------------------------
-- 在这之前,一份已经生成并通过验证的内在指南只存在 localStorage 里。
-- 所以同一个登入使用者换一台装置,看到的是「还没有生成」——
-- 一旦他按下生成,就会产生【第二份不一样的指南】,
-- 而情境、锚点、今天的问题全部跟着分岔。
--
-- 产品不变式:
--
--     一个登入使用者 = 一份正式的内在指南
--
-- 第二台装置【读】它,不会自己再生成一份。
--
-- ---------------------------------------------------------------
-- 隐私边界:为什么是明确栏位,不是 JSONB
-- ---------------------------------------------------------------
-- 这张表【只】收使用者在自己的指南里已经看得到的字。
--
-- 用 JSONB 的话,「不准存机制 / 证据 / 分数 / prompt」只是一条约定,
-- 要靠应用层自律;用明确栏位的话,那些东西【根本没有地方可以落地】——
-- 送上来会被 PostgREST 以未知栏位挡掉。
--
-- 所以这张表的栏位清单,本身就是隐私契约的完整定义:
--   \d public.compass_results  =  这张表可能存在的东西的全部
--
-- 四个方向(grounds / moves / drains / calls)是已锁的产品框架,
-- 稳定到值得用明确栏位换取这个保证。
--
-- ⚠ 刻意【不】存的东西(每一项在这里都没有栏位):
--   mechanism / livedMechanism / domain / evidence / support / tension /
--   composite / structuralAnchors / selectionReason / selectionScore /
--   strength / distinctiveness / 原始星盘 / 出生日期时间地点 /
--   行星 / 星座 / 宫位 / 相位 / 度数 / 逆行 / 元素 /
--   generation contract / system prompt / user prompt / 模型原始输出 /
--   validation 内部状态 / retry 诊断 / firstAttempt / trace /
--   shadow validator 结果 / 模型推理 /
--   个人情境(Personal Situations)/ 锚点(Personal Anchors)/
--   今天的问题选到第几个 / 心情 / 星空记录 / 收藏
--
-- ⚠ 情境与锚点是【推导层】,刻意不存。
--   它们要能在不重新生成的前提下,从同一份已接受的文案里被改进
--   (situations-1.x / anchors-3.x)。正式的东西是【文案】,不是它的呈现。
-- ---------------------------------------------------------------

create table if not exists public.compass_results (
  -- 一个使用者一列。主键就是不变式本身:
  -- 「同一个人有两份正式指南」在这个 schema 里无法表示。
  user_id        uuid primary key references auth.users(id) on delete cascade,

  -- 出身资讯(provenance)。R6 起 promptVersion 同时也是内容版本号:
  -- 前端拿它跟 generation 层的 DEFAULT_PROMPT_VERSION 比对,不一样就在背景
  -- 重新生成一次、成功才换上去 —— 旧内容在那之前一个字都不会被动。
  prompt_version text        not null,
  generated_at   timestamptz not null,

  -- 乐观并发用。R1 上线时前端只会 INSERT;R6 起版本升级会走一次条件 UPDATE
  -- (WHERE revision=eq.<旧值>,对不上就是 0 列,不会覆盖别人刚写的那一份)。
  revision       smallint    not null default 1,

  -- 四个方向。每个方向的必要三句,加上 v1.4 起新增的两个可选栏位
  -- (opening/short——跟 prompt 一样,不参与这个方向存不存在的判断)。
  grounds_core   text, grounds_expl   text, grounds_prompt text,
  grounds_opening text, grounds_short text,
  moves_core     text, moves_expl     text, moves_prompt   text,
  moves_opening  text, moves_short   text,
  drains_core    text, drains_expl    text, drains_prompt  text,
  drains_opening text, drains_short  text,
  calls_core     text, calls_expl     text, calls_prompt   text,
  calls_opening  text, calls_short   text,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint cr_prompt_version_chk check (char_length(prompt_version) between 1 and 40),

  constraint cr_core_len_chk check (
    char_length(coalesce(grounds_core, '')) <= 200 and
    char_length(coalesce(moves_core,   '')) <= 200 and
    char_length(coalesce(drains_core,  '')) <= 200 and
    char_length(coalesce(calls_core,   '')) <= 200),

  constraint cr_expl_len_chk check (
    char_length(coalesce(grounds_expl, '')) <= 1200 and
    char_length(coalesce(moves_expl,   '')) <= 1200 and
    char_length(coalesce(drains_expl,  '')) <= 1200 and
    char_length(coalesce(calls_expl,   '')) <= 1200),

  constraint cr_prompt_len_chk check (
    char_length(coalesce(grounds_prompt, '')) <= 300 and
    char_length(coalesce(moves_prompt,   '')) <= 300 and
    char_length(coalesce(drains_prompt,  '')) <= 300 and
    char_length(coalesce(calls_prompt,   '')) <= 300),

  constraint cr_opening_len_chk check (
    char_length(coalesce(grounds_opening, '')) <= 40 and
    char_length(coalesce(moves_opening,   '')) <= 40 and
    char_length(coalesce(drains_opening,  '')) <= 40 and
    char_length(coalesce(calls_opening,   '')) <= 40),

  constraint cr_short_len_chk check (
    char_length(coalesce(grounds_short, '')) <= 160 and
    char_length(coalesce(moves_short,   '')) <= 160 and
    char_length(coalesce(drains_short,  '')) <= 160 and
    char_length(coalesce(calls_short,   '')) <= 160),

  -- 一份指南至少要有一个方向讲得出话,不收全空的列
  constraint cr_not_empty_chk check (
    coalesce(grounds_core, '') <> '' or coalesce(moves_core, '') <> '' or
    coalesce(drains_core,  '') <> '' or coalesce(calls_core,  '') <> '')
);

-- 主键已经是 user_id,读写都走它,不需要额外索引。

alter table public.compass_results enable row level security;

-- RLS 的形状与既有的 compass_entries / user_exploration_readings 一致:
-- 只碰得到自己的。
drop policy if exists "compass result read own"   on public.compass_results;
drop policy if exists "compass result write own"  on public.compass_results;
drop policy if exists "compass result update own" on public.compass_results;

create policy "compass result read own"   on public.compass_results
  for select using (auth.uid() = user_id);

create policy "compass result write own"  on public.compass_results
  for insert with check (auth.uid() = user_id);

-- UPDATE 政策本来是为了「以后要用」先开着(R1 上线时前端还不会呼叫它)。
-- R6 起真的会呼叫了:内容版本升级时,前端会做一次带 revision=eq. 条件的
-- PATCH,把新生成、已经通过验证的内容换上去。RLS 这一层只管「是不是本人」,
-- 乐观并发(避免两台装置互相覆盖)由前端那条 revision 过滤条件负责。
create policy "compass result update own" on public.compass_results
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ⚠ 刻意【没有】DELETE 政策。
--   RLS 不允许的就是禁止的 —— 所以包含前端在内,没有任何东西删得掉
--   一份正式的内在指南。
--   帐号整个删除时仍然会经由 user_id 的 on delete cascade 一起清掉。
--   将来若要做「重设 / 删除 / 重新生成」,那是一个独立的产品功能,
--   要连同它自己的政策一起审查,不是因为资料库做得到就顺手开。

-- updated_at:只有将来真的会 UPDATE 时才有意义,先备着。
create or replace function public.compass_results_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists compass_results_touch_trg on public.compass_results;
create trigger compass_results_touch_trg
  before update on public.compass_results
  for each row execute function public.compass_results_touch();

-- ---------------------------------------------------------------
-- v1.4 迁移:这张表如果是【在这次改动之前】就已经建好的,
-- 上面的 create table if not exists 不会帮已存在的表加栏位——
-- 要跑这一段,才会真的补上 opening/short 这四对新栏位。
-- 在已有资料的表上跑是安全的:新栏位一律以 null 开始,
-- 旧的列（v1.4 之前生成的内容）不受影响，也不需要重新生成才能读。
-- ---------------------------------------------------------------
alter table public.compass_results
  add column if not exists grounds_opening text,
  add column if not exists grounds_short   text,
  add column if not exists moves_opening   text,
  add column if not exists moves_short     text,
  add column if not exists drains_opening  text,
  add column if not exists drains_short    text,
  add column if not exists calls_opening   text,
  add column if not exists calls_short     text;

alter table public.compass_results drop constraint if exists cr_opening_len_chk;
alter table public.compass_results add constraint cr_opening_len_chk check (
  char_length(coalesce(grounds_opening, '')) <= 40 and
  char_length(coalesce(moves_opening,   '')) <= 40 and
  char_length(coalesce(drains_opening,  '')) <= 40 and
  char_length(coalesce(calls_opening,   '')) <= 40);

alter table public.compass_results drop constraint if exists cr_short_len_chk;
alter table public.compass_results add constraint cr_short_len_chk check (
  char_length(coalesce(grounds_short, '')) <= 160 and
  char_length(coalesce(moves_short,   '')) <= 160 and
  char_length(coalesce(drains_short,  '')) <= 160 and
  char_length(coalesce(calls_short,   '')) <= 160);

-- ---------------------------------------------------------------
-- selfNotes 迁移:「想留给自己的几句话」改成 AI 生成、一次存好。
-- ---------------------------------------------------------------
-- 在这之前,这一段是每次进页面从四段文案里「挑句子」现算的(推导层,不存)。
-- 现在改成:一份指南定案之后,请 AI 根据这个人【已经看到的】四段文案写 2–4 句,
-- 存进这一列;之后每次进页面直接读,不再呼叫 AI。
--
-- 仍然守着这张表的隐私契约:存的只是使用者在页面上会读到的那几句话。
-- 不存 prompt、不存模型原始输出、不存检查的内部状态。
--
--   self_notes          那几句话本身(1–4 句)
--   self_notes_for      这几句是替哪一份文案写的(那一份的 generatedAt)。
--                       内容升级(R6)换了新文案之后,对不上就会自动重写一次,
--                       所以升级那条 PATCH 不必知道这几个栏位的存在。
--   self_notes_version  写作指令版本(selfnotes-v1)
--
-- 在已有资料的表上跑是安全的:新栏位一律以 null 开始,旧的列不受影响。
-- 还没跑这段之前,前端会探测到栏位不存在,安静地只存在本机,页面照常显示。
alter table public.compass_results
  add column if not exists self_notes         text[],
  add column if not exists self_notes_for     text,
  add column if not exists self_notes_version text;

alter table public.compass_results drop constraint if exists cr_self_notes_chk;
alter table public.compass_results add constraint cr_self_notes_chk check (
  self_notes is null or (
    cardinality(self_notes) between 1 and 4 and
    char_length(array_to_string(self_notes, '')) <= 400));

alter table public.compass_results drop constraint if exists cr_self_notes_meta_chk;
alter table public.compass_results add constraint cr_self_notes_meta_chk check (
  char_length(coalesce(self_notes_for, ''))     <= 40 and
  char_length(coalesce(self_notes_version, '')) <= 40);
