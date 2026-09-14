# 我的内在指南 · Phase 6.1:真实 API 路径

> 目标:证明 `浏览器 → compass-generate → Anthropic → structured JSON → 验证 → Preview` 真的会动。

---

## 0. 先讲结论

| 环节 | 状态 |
| --- | --- |
| Edge Function 原始码真的跑得起来 | ✅ 已验证(这是它第一次被执行) |
| 浏览器 → HTTP → Edge Function → JSON → 11 道验证 → UI | ✅ 已验证(桌机 + 手机,真实 HTTP + CORS) |
| Edge Function → **api.anthropic.com** | ❌ **未验证** —— 见 §1 |
| 部署到 Supabase | ❌ **未完成** —— 见 §1 |

**这一次跑出来发现并修好了两个真实缺陷**(见 §4)。它们都会让第一次 live 呼叫直接失败。
没有真的把函式跑起来,这两个都看不到。

---

## 1. 为什么 live 那一段还是做不到(不是没试)

这个开发容器的网路政策实测结果:

```
api.anthropic.com                  → 401   (通得到,只是没有金钥)
lbzddxzzywqbbtumjfjc.supabase.co   → 000   (CONNECT 被 gateway 403 拒绝)
deno.land                          → 000   (同上,所以装不了 Deno)
supabase CLI                       → 不存在
ANTHROPIC_API_KEY                  → 不存在
```

代理状态里的原文:

```
{"kind":"connect_rejected",
 "detail":"gateway answered 403 to CONNECT (policy denial or upstream failure)",
 "host":"lbzddxzzywqbbtumjfjc.supabase.co:443"}
```

所以:

- **不能部署** —— 没有 Supabase CLI、没有专案存取权杖,而且连线本身就被挡。
- **连健康检查都打不到** 已部署的函式。
- **不能打真的 Anthropic** —— 没有金钥,而且金钥**不应该**贴进这个对话
  (贴进来等于写进对话纪录,违反 §2 的「只能存在 server-side secret」)。

### A. 需要部署什么
`docs/edge/compass-generate.ts` → Supabase Edge Function,名称 `compass-generate`。

### B. 需要什么 secret
只要一个:`ANTHROPIC_API_KEY`。
(`read-chart` 还需要 `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`;
`compass-generate` **不写资料库,所以这两个都不需要**。)

### C. 必须由你本人操作的
1. 在 Supabase 建立 `compass-generate` 函式并贴上 `docs/edge/compass-generate.ts`
   —— 这个专案既有的惯例就是这样:没有 `supabase/` 目录、没有 CLI、没有 CI,
   `read-chart.ts` 也是放在 `docs/edge/` 当权威副本,由你贴进 Dashboard。
   我**没有**替你新增 `supabase/functions/` 结构 —— 那会凭空改掉专案惯例。
2. Edge Functions → Secrets 里设定 `ANTHROPIC_API_KEY`(如果 `read-chart` 已经设过,
   同一个专案共用,不必再设)。
3. 部署后在浏览器按一次生成按钮,或跑 §3 的指令。

### D. 我能自己做的(已经做完)
- 把 Edge Function 的原始码**真的执行起来**并修好两个缺陷
- 浏览器端整条路径的真实 HTTP 验证(桌机 + 手机)
- 金钥安全稽核
- 一条指令就能产出 §12 报告的验证脚本

### E. 在这个容器里做不到的
真正的 Supabase 部署、真正的 Anthropic 往返、CURRENT CHART 的 live 验证
(这里没有真实使用者星盘)。

---

## 2. 金钥安全

| 检查 | 结果 |
| --- | --- |
| `sk-ant-` 形状的字串出现在任何 commit | **0 次**(`git log --all -p` 全history 搜过) |
| 出现在 `app.html` / `index.html` / 任何 `assets/*.js` | 无 |
| 前端有没有读 `ANTHROPIC_API_KEY` | 没有(测试挡着) |
| 金钥取得方式 | 只有 `Deno.env.get("ANTHROPIC_API_KEY")`,全档一处 |
| 回传里会不会带出金钥 | 不会(测试挡着;health check 只回报 `anthropic_key_set: true/false`) |
| localStorage | 只放一个**网址**旁路 `compass_gen_url`,不放任何凭证 |

**请不要把金钥贴进任何对话。** 它只该出现在 Supabase 的 Secrets 里。

---

## 3. 部署后怎么验证(一条指令)

```bash
# 打已部署的函式(正式路径)
node tools/compass-live-check.js --url https://<project>.supabase.co/functions/v1/compass-generate \
                                 --anon <SUPABASE_ANON_KEY>            # 先只跑 C1
node tools/compass-live-check.js --url ... --anon ... --all            # C1 过了再跑 C4/C6/C10
```

脚本会照 Phase 6.1 §12 的格式印出:health check、每张盘的 status / requests / retried /
延迟 / 11 道验证 / 长度 / 通用与文学风险 / 编造原因 / 占星外漏 / 跨卡相似度,
最后是总请求数、retry 数、平均延迟。
**C1 失败就停,不会继续送请求**(§5)。输出里永远不含金钥。

另外两种跑法:

```bash
node tools/compass-live-check.js --stub        # 本机跑同一份 .ts,上游用假回应。不需要金钥、不花钱
ANTHROPIC_API_KEY=… node tools/compass-live-check.js   # 本机跑 .ts,上游打真的 Anthropic
```

浏览器里要指到别的端点(例如本机那一份):

```js
localStorage.setItem("compass_gen_url", "http://127.0.0.1:PORT")
```

---

## 4. 这一次真的把函式跑起来之后,抓到的两个缺陷

### 缺陷一:服务端扫自己的禁令表,把自己挡掉了

第一次执行就 400:

```json
{"error":"blocked_by_scrub","leaks":[{"path":"$.system","kind":"astrology"}]}
```

原因:服务端的 scrub 会扫 `{ system, user }`,
而**写作指令本身就列着「星座、宫位、行星、太阳、月亮…」**——因为它的工作就是禁止那些词。
扫自己的禁令表,结果就是永远挡下自己。**第一次 live 呼叫一定会失败。**

修法(不是放宽,是把扫描对象讲清楚):

- `input` —— 全扫(这才是资料)
- `user` —— 扣掉内嵌的 `JSON.stringify(input, null, 1)` 之后再扫剩下的模板
  (顺带要求 `user` 必须内嵌同一份 input,否则 `payload_mismatch`)
- `system` —— **不扫**,改成必须与服务端自己的 `COMPASS_SYSTEM` **逐字相同**,
  否则 `prompt_mismatch`

这一改顺带堵死一个洞:呼叫端再也没有任何管道把内容偷渡进 prompt。
`tests/run-tests.js` 有一条断言盯着两边的 prompt 逐字相同。

### 缺陷二:词表抓不到中文行星名与「第 N 宫」

原本两边的 scrub 词表都只有 `星座|宫位|行星|相位|…`,
所以「这个人的**火星**在**第十宫**」可以大摇大摆通过。实测确实 200 通过。

补上:`太阳|月亮|水星|金星|火星|木星|土星|天王星|海王星|冥王星|凯龙|莉莉丝|第N宫|十二星座全名|黄道|合相|刑相|拱相|冲相`,
前端与服务端两份都补。补完之后十张测试盘的 payload 仍然 **0 处违规**。

> 这两个缺陷都是 Phase 6 的静态测试看不见的 —— 一定要真的把那份档案跑起来才会现形。

---

## 5. 已经验证到哪里

`tools/deno-shim.js` 把 `docs/edge/compass-generate.ts` **原封不动**载进 Node 跑
(`Deno.serve` → 真的 `node:http` server,`Deno.env.get` → `process.env`),
所以测的是那份档案自己的程式码,不是另外写一份的复制品。

浏览器实测(Chromium,`file://` → `http://127.0.0.1` 真实跨源 + CORS preflight):

```
切到 live 模式                    POST 0 次
C1  按一次生成                    POST 1 次   status=ok   overflow=0   使用者卡片无外漏
C4 / C6 / C10 各按一次            各 POST 1 次,全部 ok
C10 的 moves                      仍然 insufficient_evidence,没有送去生成
上游回 529                        四张卡全部 generation_failed,【没有任何一张出现文案】
手机 390px                        同上,overflow=0
```

服务端真的送给 Anthropic 的请求结构(不含任何凭证):

```
model         claude-sonnet-4-6
max_tokens    3000
system        1 个区块,cache_control: {"type":"ephemeral"}
messages      1 则 user 讯息,6200 字元
顶层栏位      model, max_tokens, system, messages
```

那 6200 字元里搜不到:出生日期 / 行星名(中英) / 星座 / 宫位 / 相位 / 度数 / email / user id。

> ⚠ **上游是本地假回应。** 这一轮证明的是「传输 + 解析 + 验证 + 渲染」那一段,
> **不是** Anthropic 那一段。画面上看到的文案来自已录制的 fixture,
> 不是这一次新生成的。

---

## 6. 三种模式仍然分得很清楚

```
Deterministic      确定性模板(预设)
Claude（已录制）   fixture,画面明写「不是这次打出去的 API 回应」
Claude API（live） 真的送请求
```

live 失败**绝不**自动显示已录制的文案 —— `generation_failed` 就是 `generation_failed`。
测试盯着 `.catch` 区块里不准出现 recorded 那条路。
