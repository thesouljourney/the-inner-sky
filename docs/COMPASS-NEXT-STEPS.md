# 我的内在指南 · 现况与下一步

## 一、储存:已经做完,等你跑一段 SQL 就会自动上云

`#/compass` 的「此刻的我」与「今天的问题」会真的存下来。储存层自己会选：

```
开页面时探测一次 compass_entries 这张表在不在
  ├─ 在   → 存进资料库（跟着帐号走，换装置也在）
  │        并且把这台装置上还没上云的记录一次搬上去，搬完清掉本机那一份
  └─ 不在 → 存在这台装置的 localStorage
           页面上如实写着「目前这些记录只存在这台装置上。」
```

**所以现在就能用**，只是还没上云。

### 要上云，只有一步

把 `docs/sql/compass_entries.sql` 整段贴进 Supabase 的 SQL Editor 跑一次。

跑完之后：

- **前端一行都不用改**，下一次开页面自己切换
- 使用者已经写过的记录会自动搬上去，不会不见
- 页面上那句「只存在这台装置上」会自己消失

那段 SQL 只**新增**一张新表与它的索引、RLS 政策。
不碰 `charts` / `prefs` / `readings` / `user_exploration_readings`，
不改任何既有栏位、既有政策或既有资料。

### 资料形状

```js
Entry = {
  id,     // uuid
  ts,     // ISO 时间（资料库里是 created_at）
  mood,   // 字串，可为空，上限 40 字
  text,   // 字串，可为空，上限 4000 字（资料库里是 body）
  kind    // "note"（此刻的我）| "answer"（回答今天的问题）
}
```

上限是刻意的：一则「此刻」要一直是一则「此刻」，不会变成贴一整篇文章进来。
前端与资料库两边都挡（`shape()` 截断 + `check` 约束）。

### 储存层的介面

`window.Compass.store` 只有三个方法，页面只用这三个：

```js
store.list(ownerId)          // → Promise<Array<Entry>>，由新到旧
store.add(ownerId, entry)    // → Promise<Entry>
store.remove(ownerId, id)    // → Promise<void>

window.Compass.storeMode()   // "table" | "local" | "unknown"
```

`user_id` 由资料库从登入 token 取，受 RLS 限制 —— 前端送什么都越不过它。

### 还没做的（等你说要不要）

- **删除单则记录的 UI**。`store.remove()` 已经可以用，但页面上还没有入口。
  要加的话是一个很小的改动，说一声。
- **分页**。目前一次取最新 200 则，超过的还没有「载入更多」。

---

## 二、个人化内容：接口已经留好，还没有生成逻辑

四个方向、想留给自己的话、今天的问题现在一律是 **placeholder**，
画面上都挂着「示例 · 尚未接上你的星盘」—— 一眼看得出还没生成，不会被误认成正式内容。

### 接上生成只要一次呼叫

```js
Compass.setGenerator(function (chart) {
  return {
    version: "compass-1.0",
    directions: [ { key, no, en, label, text }, … ],   // 四项，key 对应 Compass.DIRECTIONS
    reminders:  [ { key, when, line }, … ],            // 三到四项
    question:   "一段话，可含换行"
  };
});
```

- **缺哪一项，那一项就继续走 placeholder** —— 可以先只接四个方向，
  其他两块维持示例，互不影响。
- 接上之后**版面一行都不用改**，示例标记自动消失。
- 生成器丢错会被接住并退回示例，页面不会开天窗。

契约也写在代码里：`Compass.GENERATION_CONTRACT`。

### 生成端要读什么

就是既有的那三层，**不需要新的星盘计算**：

- 生命蓝图 `chart.reading`
- 九个主题 `chart.topics`
- 生命脉络 `chart.lifemap`

建议比照 `read-chart` 既有做法新增一个 `kind="compass"`，
把这三层当输入、输出上面那个结构，并且**不要改写**这三层的任何内容 ——
跟 `kind="preview"` 一样自成一个快取命名空间就好。

**目前这一版没有新增任何 Claude API 呼叫。**

---

## 三、刻意没有碰的

- 生命脉络 / 生命蓝图 / 九个主题 / 三十道探索题：一个字都没动
- 既有资料表、RLS、认证、付费、路由、素材：一个字都没动
- 没有新增任何 Claude API 呼叫
