# 我的内在指南 · 想留给自己的几句话（selfNotes）

「想留给自己的几句话」原本是从四个方向的文案里，用固定句型和关键词挑句子（CompassAnchorsSemantic）。
现在改成由 AI 根据这个人已经看到的四个方向内容，**写一次、存起来**，之后每次进页面直接读取。

## 上线需要做的两件事

两件都做完，这个功能才完整；只做前端也不会坏，只是会退回旧的挑句子方式。

1. **在 Supabase SQL Editor 跑 `docs/sql/compass_results.sql` 最后的「selfNotes 迁移」那一段**
   - 给 `compass_results` 加三个栏位：`self_notes`、`self_notes_for`、`self_notes_version`
   - 已有资料的表上跑是安全的，新栏位一律从 null 开始
   - 还没跑之前：几句话只存在本机，换装置会再生成一次
2. **重新部署 Edge Function `compass-generate`**（`docs/edge/compass-generate.ts`）
   - 这一版多收一种 `promptVersion: "selfnotes-v1"` 的请求
   - 还没部署之前：生成请求会被拒收（prompt_mismatch），页面退回旧的挑句子方式，隔一天才再试

## 流程

| 情况 | 做法 |
| --- | --- |
| 新用户生成指南 | 指南存进账号（created）后，立刻在背景写几句话并存起来 |
| 旧用户（还没有几句话） | 第一次打开页面时补写一次；写的时候这一段先不出现，写好后出现 |
| 再次打开 / 重新整理 / 换装置 | 依序读：记忆体 → 本机 → 云端，读到就显示，不呼叫 AI |
| 内容版本升级（换了新文案） | 旧的几句话是替旧文案写的，对不上，替新文案重写一次 |
| AI 失败 | 退回旧的挑句子方式（逐句过滤）；0 句才隐藏整段；24 小时内不再重试 |
| 未登入 | 不呼叫 AI，直接用旧的挑句子方式 |

## 存在哪里

- **本机**：`localStorage["inner_sky_compass_result_v2"][owner].selfNotes`
  - 格式：`{ notes: [...], for: generatedAt, v: "selfnotes-v1", synced }`
  - 跟指南本身同一桶
- **云端**：`compass_results` 同一列的 `self_notes`（text[]）、`self_notes_for`、`self_notes_version`
- `for` / `self_notes_for` 记录这几句是替哪一份文案（generatedAt）写的，对不上就不用。

## 检查（`assets/compass-selfnotes.js` 的 `check`）

逐句检查，只挡明显不对的：

- 太短、太长
- 说教或下定义的句子：「你是一个」「你应该」「你必须」「一定要」
- 占星、玄学、诊断用词
- **明显照抄上面卡片**：
  - 整句相同，或整句包含、被包含
  - 这一句 80% 以上的二字组都在同一句来源里
  - 主题相近但说法不同的，不会被挡

第一次通过检查的少于 2 句时，重试一次，取比较好的那一次。

## CompassAnchorsSemantic 现在的角色

只当 **fallback**：selfNotes 不存在、而且这次 AI 生成失败（或未登入）时才用。
回查改成逐句过滤：哪一句不过就只拿掉那一句，其他照样显示。
