# 我的内在指南 · 下一阶段需要什么

这一版只做了**入口与页面结构**。以下两件事刻意没有做,列在这里等你决定。

---

## 一、储存层:目前只存在使用者自己的装置上

`#/compass` 的「此刻的我」与「今天的问题」现在会真的存下来,但走的是
`window.Compass.store` 的 **localStorage 实作**(`inner_sky_compass_v1`)。

意思是:

- 换一台装置、换一个浏览器、清掉浏览器资料 → 记录就不在了
- 这些内容目前**没有**进 Supabase,production 的资料表一个字都没有动

页面上也如实写着「目前这些记录只存在这台装置上。」,不会让使用者误以为已经上云。

### 接资料库要做的事

`window.Compass.store` 是一个只有三个方法的介面。换掉这一个物件就好,页面完全不必改:

```js
store.list(ownerId)          // → Promise<Array<Entry>>,由新到旧
store.add(ownerId, entry)    // → Promise<Entry>
store.remove(ownerId, id)    // → Promise<void>

Entry = {
  id,     // uuid
  ts,     // ISO 时间
  mood,   // 字串,可为空
  text,   // 字串,可为空
  kind    // "note"(此刻的我) | "answer"(回答今天的问题)
}
```

有两条路,**都不需要改动任何既有资料表的结构**:

**做法 A(不需要任何 migration,最快)**
存进使用者星盘那一列既有的 `data` jsonb 里,例如 `chart.compass.entries` ——
`favs` / `topics` / `lifemap` 现在就是这样存的,直接沿用 `Cloud.updateChart(c)`。
优点:零 migration、跟着既有的云同步走。
缺点:记录会跟星盘绑在一起,笔数多了之后那一列会变大。

**做法 B(建议,长期比较干净)**
新开一张表:

```sql
create table compass_entries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  mood        text,
  body        text,
  kind        text not null default 'note',   -- note | answer
  constraint compass_kind_chk check (kind in ('note','answer'))
);

create index compass_entries_user_created_idx
  on compass_entries (user_id, created_at desc);

alter table compass_entries enable row level security;

create policy "read own"   on compass_entries for select using (auth.uid() = user_id);
create policy "write own"  on compass_entries for insert with check (auth.uid() = user_id);
create policy "delete own" on compass_entries for delete using (auth.uid() = user_id);
```

RLS 的形状与既有的 `user_exploration_readings` 一致(只读写自己的)。

**需要你决定的:** A 还是 B。选好我再接,接的时候页面一行都不用动。

---

## 二、内容生成:四个方向 / 想留给自己的话 / 今天的问题

这三块现在一律是 **placeholder**,画面上都挂着「示例 · 尚未接上你的星盘」的标记 ——
刻意让人一眼看得出还没有生成,不会被误认成已经写好的内容。

生成的唯一接点是:

```js
window.Compass.buildFromChart(chart)
// 现在回传 null
// 未来回传 { directions: [...], reminders: [...], question: "..." }
```

只要这个函式开始回传东西,示例标记会自动消失、版面一个字都不用改。

生成端要接的话,资料来源就是既有的那三层(不需要新的星盘计算):

- 生命蓝图 `chart.reading`
- 九个主题 `chart.topics`
- 生命脉络 `chart.lifemap`

建议比照 `read-chart` 既有做法,新增一个 `kind="compass"`,
把这三层当输入、输出上面那个结构,并且**不要改写**这三层的任何内容。
跟 `kind="preview"` 一样自成一个快取命名空间就好。

**这一版没有新增任何 Claude API 呼叫。**

---

## 三、目前没做、也刻意不做的

- 没有改任何既有资料表、RLS、认证、付费
- 没有改任何既有页面、路由、素材
- 没有新增 Claude API 呼叫
- 没有把示范文字写成正式内容
