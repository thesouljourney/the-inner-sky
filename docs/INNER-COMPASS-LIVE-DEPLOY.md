# 我的内在指南 · Phase 6.1:真实 API 路径

> 目标:证明 `浏览器 → compass-generate → 既有的 ANTHROPIC_API_KEY → Anthropic → structured JSON → 验证 → Preview` 真的会动。

---

## 0. 三种状态,分清楚

| | 状态 |
| --- | --- |
| **CODE READY** | ✅ 是 |
| **DEPLOYED** | ❌ 否 —— 这个容器连不到 Supabase,也没有 CLI(见 §2) |
| **LIVE VERIFIED** | ❌ 否 —— 必须部署后才做得到 |

**不再把「没有 API key」当成 blocker。** 这个 Supabase 专案本来就有
`ANTHROPIC_API_KEY`(`read-chart` 一直在用),`compass-generate` 用的是**同一个**:
`Deno.env.get("ANTHROPIC_API_KEY")`,全档一处,**不需要任何其他 secret**。
唯一还没做的事是「把函式放上去」,而那件事必须由你按几下。

---

## 1. 这个专案的 Edge Function 到底怎么维护(实际检查,不是假设)

| 问题 | 实际情况 |
| --- | --- |
| A. 是不是 Dashboard 手动维护 | **是**。没有 `supabase/` 目录、没有 `config.toml` |
| B. 有没有 deploy workflow | **没有**。`.github/workflows` 不存在 |
| C. 有没有 Supabase CLI setup | **没有**。`package.json` 只有 test / gen:* 三个脚本 |
| D. 有没有 CI deployment | **没有** |
| E. project ref / URL 形式 | ref = `lbzddxzzywqbbtumjfjc`(`app.html:3590`)<br>`https://lbzddxzzywqbbtumjfjc.supabase.co/functions/v1/<name>` |
| F. 浏览器怎么呼叫 read-chart | `POST FUNC_URL`,标头 `Authorization: Bearer <使用者 token 或 anon>` + `apikey: <anon>` |

`docs/edge/read-chart.ts` 的档头自己就写着「请在 Edge Functions → Secrets 添加」——
也就是说,`docs/edge/` 是**权威副本**,由人贴进 Dashboard。

**所以我没有替你新增 `supabase/functions/` 结构。** 那会凭空改掉专案惯例,
而且在没有 CLI 的情况下毫无用处。

`compass-generate` 的呼叫标头与 `read-chart` **完全同一套**(测试盯着),
端点也是从 `CloudCfg.url` 推导出来的 —— 所以部署完成后,
**前端一个字都不用改,不用给我 URL**。

---

## 2. 为什么这个容器不能自己部署(实测,不是推测)

```
lbzddxzzywqbbtumjfjc.supabase.co   → 000   CONNECT 被 gateway 403
deno.land                          → 000   (所以也装不了 Deno)
api.anthropic.com                  → 可连(没有金钥而已)
supabase CLI                       → 不存在
```

代理状态里的原文:

```
{"kind":"connect_rejected",
 "detail":"gateway answered 403 to CONNECT (policy denial or upstream failure)",
 "host":"lbzddxzzywqbbtumjfjc.supabase.co:443"}
```

Supabase 整个网域被网路政策挡掉,所以我**连健康检查都打不出去**,更不用说部署。

---

## 3. 你要做的事(七步,大约 3 分钟)

1. 打开 Supabase Dashboard → 专案 `lbzddxzzywqbbtumjfjc` → **Edge Functions**
2. **Create a new function**,名称填 `compass-generate`(一个字都不要差)
3. 把 **`docs/edge/compass-generate.ts` 的完整内容**贴进编辑器,覆盖预设范本
4. **Deploy**
5. 确认 secret:Edge Functions → **Secrets**,应该已经有 `ANTHROPIC_API_KEY`
   (`read-chart` 一直在用同一个)。**有就不要动,不需要新增任何 secret。**
6. 验证部署成功:浏览器打开
   `https://lbzddxzzywqbbtumjfjc.supabase.co/functions/v1/compass-generate`
   应该看到
   `{"ok":true,"function":"compass-generate (compass-v1)","anthropic_key_set":true,...}`
   · `anthropic_key_set` 是 **true** → secret 读得到
   · 是 **false** → 这才是真正的 secret visibility 问题,回报给我
7. 回到 `app.html#/compass/preview` → Generation Mode 选 **Claude API(live)**
   → case 选 **C1** → 按一次 **用 Claude 生成**

**不需要**给我 API key。**不需要**给我 function URL(前端已经推导得出)。

### 部署完成后,请把这个交回来

画面上按一下 **「复制验证报告」**,把复制到的整段贴回来就好。
那段报告包含:endpoint、promptVersion、server 回报的 model、
每一次 POST 的 HTTP 状态与耗时、请求数、retry、四个方向的文案、
长度与各项风险旗标、跨卡相似度。
**它刻意不含任何 Authorization / apikey / 金钥 / 身分资料**(测试挡着)。

或者在本机跑:

```bash
node tools/compass-live-check.js \
  --url https://lbzddxzzywqbbtumjfjc.supabase.co/functions/v1/compass-generate \
  --anon <SUPABASE_ANON_KEY>          # 先只跑 C1
# C1 过了再加 --all 跑 C4 / C6 / C10
```

(anon key 是公开的,`app.html` 里本来就有;这不是 secret。)

---

## 4. 第一次部署最常见的五种失败,画面上分得出来

浏览器实测过,五种都会显示成不同的 `generation_failed(...)`,
而且**没有任何一种会出现文案** —— 不 fallback 到已录制,也不 fallback 到模板:

| 状况 | 画面显示 | 归类(§10) |
| --- | --- | --- |
| 函式没部署 | `http 404 · 回应不是 JSON:<html>Function not found</html>` | A. Deployment failure |
| JWT 不对 | `http 401 · Invalid JWT` | C/D. 标头或闸道 |
| secret 读不到 | `http 500 · missing ANTHROPIC_API_KEY` | B. Secret visibility |
| Anthropic 限流 | `http 502 · upstream_429` | E. Anthropic API failure |
| CORS / 网路 | `Failed to fetch`(纪录里标 `network-or-cors`) | C. CORS failure |

第一次部署时会先撞到哪一种,一看就知道,不必来回猜。

---

## 5. 金钥安全

| 检查 | 结果 |
| --- | --- |
| secret 名称 | 沿用既有的 `ANTHROPIC_API_KEY`,**没有改名、没有新建** |
| 需要的其他 secret | **零个**(不写资料库,所以不需要 SERVICE_ROLE_KEY / SUPABASE_URL) |
| `sk-ant-` 形状字串出现在任何 commit | **0 次**(`git log --all -p` 全 history 搜过) |
| 出现在 `app.html` / `index.html` / 任何 `assets/*.js` / 测试 / fixture | 无 |
| 前端有没有读 `ANTHROPIC_API_KEY` | 没有 |
| 取得方式 | 只有 `Deno.env.get("ANTHROPIC_API_KEY")`,全档一处 |
| 回传会不会带出金钥 | 不会;health check 只回报 `anthropic_key_set: true/false` |
| 验证报告 / HTTP 纪录 | 只有网址、状态码、耗时、错误讯息 —— 不含任何凭证 |
| localStorage | 只放一个**网址**旁路 `compass_gen_url`,不放凭证 |

**请不要把金钥贴进任何对话。**

---

## 6. 已经验证到哪里(Phase 6.1 本地段)

`tools/deno-shim.js` 把 `docs/edge/compass-generate.ts` **原封不动**载进 Node 跑
(`Deno.serve` → 真的 `node:http` server),所以测的是那份档案自己的程式码。

浏览器实测(`file://` → `http://127.0.0.1`,真实跨源 + CORS preflight):

```
切到 live 模式                    POST 0 次
C1 / C4 / C6 / C10 各按一次        各 POST 1 次,status=ok,overflow=0,使用者卡片无外漏
C10 的 moves                      仍然 insufficient_evidence,没有送去生成
上游失败                          四张卡全部 generation_failed,没有任何一张出现文案
```

服务端真的送给上游的请求结构:

```
model         claude-sonnet-4-6
max_tokens    3000
system        1 个区块,cache_control: {"type":"ephemeral"}
messages      1 则 user 讯息(约 6200 字元)
顶层栏位      model, max_tokens, system, messages
```

那 6200 字元里搜不到:出生日期 / 行星名(中英) / 星座 / 宫位 / 相位 / 度数 / email / user id。

> ⚠ **上游是本地假回应。** 这一段证明的是「传输 + 解析 + 验证 + 渲染」,
> **不是** Anthropic 那一段。

---

## 7. 这一次跑起来修好的两个缺陷(Phase 6.1 前半)

### 缺陷一:服务端扫自己的禁令表,把自己挡掉了

第一次执行就 400:`{"error":"blocked_by_scrub","leaks":[{"path":"$.system","kind":"astrology"}]}`
因为 scrub 会扫 `{ system, user }`,而**写作指令本身就列着「星座、宫位、行星…」**——
那是它的工作。扫自己的禁令表 = 永远挡下自己,**第一次 live 呼叫必定失败**。

修法:`input` 全扫;`user` 扣掉内嵌的 input JSON 后扫剩下的模板;
`system` 不扫,改成必须与服务端自己的 `COMPASS_SYSTEM` 逐字相同,否则 `prompt_mismatch`。
顺带堵死一个洞:呼叫端再也无法把内容偷渡进 prompt。

### 缺陷二:词表抓不到中文行星名与「第 N 宫」

「这个人的**火星**在**第十宫**」原本可以通过(实测 200)。两边词表都补上;
补完后十张测试盘的 payload 仍然 **0 处违规**。

---

## 8. 三种模式仍然分得很清楚

```
Deterministic        确定性模板(预设)
Claude（已录制）     fixture,画面明写「不是这次打出去的 API 回应」
Claude API（live）   真的送请求
```

live 失败**绝不**自动显示已录制或模板的文案 —— `generation_failed` 就是 `generation_failed`。
`assets/compass-recorded.js` 保留,当回归 fixture 与比较基准,但永远标示 RECORDED。
