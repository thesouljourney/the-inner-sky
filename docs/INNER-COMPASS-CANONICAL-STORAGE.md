# 我的内在指南 · 帐号层的正式结果(R1 / canonical-1.0)

```
表:    public.compass_results     (docs/sql/compass_results.sql)
模组:  assets/compass-canonical.js  纯函式:窄对应 + 解析
接线:  app.html  window.Compass.canonical / compassResolveCanonical()
```

---

## 1. 要解决的问题

在这之前,一份已经生成并通过验证的内在指南**只存在 localStorage**。

所以同一个登入使用者换一台装置,看到的是「还没有生成」——一旦他按下生成,
就会产生**第二份不一样的指南**(生成在文字层本来就不是确定性的),
而情境、锚点、今天的问题全部跟着分岔:

```
桌机  Compass A → Situations A → Anchors A → 今天的问题 A
手机  Compass B → Situations B → Anchors B → 今天的问题 B
```

今天的问题不一致只是**症状**。病根是:已接受的文案没有帐号层的身分。

## 2. 产品不变式

> **一个登入使用者 = 一份正式的内在指南。**
> 第二台装置【读】它,不会自己再生成一份。

正式的东西是**已接受的文案**,不是它的呈现。情境与锚点永远是推导层 ——
所以 `situations-1.x` / `anchors-3.x` 可以在**不重新生成**的前提下继续改进。

```
已接受的文案(canonical)
        ↓
   帐号层储存
        ↓
 ┌──────┼──────┐
情境   锚点   今天的问题
```

## 3. 为什么是明确栏位,不是 JSONB

用 JSONB 的话,「不准存机制 / 证据 / 分数 / prompt」只是一条**约定**;
用明确栏位的话,那些东西**根本没有地方可以落地** —— 送上来会被 PostgREST
以未知栏位挡掉。

所以这张表的栏位清单,本身就是隐私契约的完整定义:

```
\d public.compass_results   =   这张表可能存在的东西的全部
```

四个方向是已锁的产品框架,稳定到值得用明确栏位换这个保证。

## 4. 存什么 / 不存什么

**三个不一样的数字,不要混为一谈:**

| | 数量 | 内容 |
|---|---|---|
| 资料表栏位 | **18** | `user_id` · `prompt_version` · `generated_at` · `revision` · 12 个方向栏位 · `created_at` · `updated_at` |
| `toRow()` 输出 | **14** | `prompt_version` · `generated_at` · 12 个方向栏位 |
| INSERT 送出的 body | **15** | `toRow()` 的 14 个 + `user_id` |

**由资料库产生、前端不送**的有四个:`revision`(default 1)、`created_at`、
`updated_at`(default now(),另有 touch trigger)。前端连碰都不碰它们 ——
少一个前端写得动的栏位,就少一条要稽核的路径。

**不存**(每一项在表里都没有栏位):
mechanism · livedMechanism · domain · evidence · support · tension · composite ·
structuralAnchors · selectionReason · selectionScore · strength · distinctiveness ·
原始星盘 · 出生日期时间地点 · 行星 / 星座 / 宫位 / 相位 / 度数 / 逆行 / 元素 ·
generation contract · system prompt · user prompt · 模型原始输出 ·
validation 内部状态 · retry 诊断 · firstAttempt · trace · shadow validator ·
模型推理 · **个人情境** · **锚点** · 今天的问题选到第几个 · 心情 · 星空记录 · 收藏

`toRow()` 是**白名单**:只读那 12 条已知路径,快取里将来多出任何东西都上不去。

## 5. 三态,不是布林

云端读取的结果只有这几种,而且**只有 `absent` 可以走到 NONE**:

| status | 意思 | 可不可以显示生成 |
|---|---|---|
| `valid` | 读到一列,通过窄 schema | 不行(有指南) |
| `absent` | 真的没有这一列 | 检查本机候选之后,**才**可以 |
| `error` | 连不上 / 逾时 / 未授权 / 解析失败 | **绝对不行** |
| `invalid` | 有那一列,但读不成形状 | **绝对不行** |

> 坏掉的一列**不等于**「这个人没有指南」——资料库里那一列就在那里。
> 这时候显示生成,等于请使用者再做一份**不一样的**指南。

## 6. 解析状态机

```
UNKNOWN ──auth 解析完──▶ RESOLVING ──fetch──┐
                                            │
   valid ─────────────────────────────────▶ CANONICAL            (本机不同 → CONFLICT_CANDIDATE)
   absent ──有本机候选──▶ ADOPT_LOCAL ──INSERT──▶ CANONICAL
                        │                  └─409─▶ 重读 ──▶ CANONICAL / CONFLICT_CANDIDATE
                        │                  └─失败─▶ PENDING_UPLOAD
                        └──没有候选───────────────▶ NONE
   error  ──有本机──▶ CACHED_OFFLINE      ──没有──▶ 停在 RESOLVING
   invalid ─────────▶ INVALID_CANONICAL
```

| 状态 | 画面 | 生成按钮 |
|---|---|---|
| UNKNOWN / RESOLVING | 正在读取… | ✗ |
| CANONICAL / ADOPT_LOCAL | 指南 | ✗ |
| PENDING_UPLOAD | 指南(照常) | ✗ |
| CACHED_OFFLINE | 指南(本机那一份) | ✗ |
| CONFLICT_CANDIDATE | **云端那一份**,另一份留着不呈现 | ✗ |
| INVALID_CANONICAL | 有本机就呈现本机;没有就「暂时无法读取…」 | ✗ |
| **NONE** | 还没有生成 | **✓ 只有这一个** |

## 7. 两台同时第一次生成

`user_id` 是**主键**,而且写入**刻意不用 upsert / merge-duplicates**:

```
A: fetch → absent      B: fetch → absent
A: 生成 A              B: 生成 B
A: INSERT → 201        B: INSERT → 409
                       B: 重读 → 拿到 A → 呈现 A
                       B: 把 B 留成候选(不呈现、不覆盖、不合并)
```

「同一个人有两份正式指南」在这个 schema 里**无法表示**,所以静默覆盖不是政策问题,
是资料库层面做不到的事。

## 8. 绝不合并

永远不会有 Compass C = A 的一部分 + B 的一部分。
四个方向属于**同一次已接受的生成结果**,取舍只在**整份**的层级发生。

## 9. promptVersion

只是**出身**,不是汰换的理由。旧版本不代表比较差;
使用者已经认得的那一份,不会因为伺服器换了 prompt 版本就被悄悄换掉。

## 10. 本机快取

| 键 | 角色 |
|---|---|
| `inner_sky_compass_result_v1` | **只读**,迁移证据,**永远不删** |
| `inner_sky_compass_result_v2` | 工作快取:`{result, revision, sync, at, candidate}` |

`sync` ∈ `canonical` / `pending-upload`。`candidate` 是另一份有效、
但这一次不呈现的文案 —— 留着,不覆盖、不合并、不呈现。

⚠ v1 / v2 都**只读 owner 完全相同的那一桶**。`anon` 绝不参与 ——
与 `compass_entries` 的 `migrateLocalUp()` 刻意不同,那一支会把 anon 并进帐号,
这一层**不可以**:一份没有身分时生成的指南,不该因为一次猜测就永久成为某个帐号的正式版本。

## 11. 安全诊断

坏掉的一列会留下一笔结构性的诊断(`canonical_row_invalid`),
只含 `code` / `reason` / `httpStatus`,**不含**文案、user id、行内容或任何生成内部状态。
`window.Compass.canonical.diagnostics()` 可以读回最近 20 笔。

## 12. ⚠ 上线顺序

`compass_results` **不存在**的时候,PostgREST 回 404(`42P01`)。
`fetch()` 把任何非 2xx 都归成 `error` —— **不是 `absent`** ——
所以缺表**不会**被误读成「这个人没有指南」。实测:

| 情形 | 结果 |
|---|---|
| 缺表 + 有本机快取 | 呈现本机那一份,不显示生成,不尝试写入,Anthropic 0 |
| 缺表 + 没有本机快取 | 停在「正在读取…」,**不显示生成**,Anthropic 0 |

**因此上线顺序是强制的,不是偏好:**

```
1. 先在 Supabase 跑 docs/sql/compass_results.sql
2. 验证表、RLS、跨使用者读写都挡得住
3. 才部署前端
```

倒过来的话,**没有本机快取的登入使用者会完全无法生成** ——
他会一直停在「正在读取…」。这是刻意的安全行为(宁可等,也不要产生第二份
不一样的指南),但它表示前端先上线 = 新使用者被挡住。

## 13. 目前不做的事

R2 今天的问题换日边界(UTC → 本地)· R3 anon 重新设计 · R4 星空记录日期 ·
重新生成的 UI · 冲突选择的 UI · 候选历史的 UI。

架构上都留了路:`revision` 支援条件更新、UPDATE 政策已经在、候选已经存着。
