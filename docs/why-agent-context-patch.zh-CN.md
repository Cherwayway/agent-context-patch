# Agent Context Patch 与 Claude Code Auto Memory 的区别

Claude Code Auto Memory 和 Agent Context Patch 解决的是同一个问题的不同层次。
Auto Memory 适合零配置的个人记忆；Agent Context Patch 面向需要团队共享、跨 Agent
复用和审计的 workspace 经验治理。

两者可以同时使用。

| 问题 | Claude Code Auto Memory | Agent Context Patch |
| --- | --- | --- |
| 谁决定记住什么？ | Claude 判断哪些笔记以后可能有用。 | 只在出现高信号且已经验证的失败或纠正后，由 Agent 判断是否形成经验。 |
| 保存在哪里？ | 机器本地、按仓库隔离，同一仓库的 worktree 共享。 | workspace 里的 `.agent-context/rules/<id>.md`，加上渲染进 `AGENTS.md` 的 catalog 块，可随仓库审阅和共享。 |
| 哪些 Agent 能使用？ | Claude Code。 | Claude Code 与 OpenAI Codex 读同一份 catalog：Codex 直接读 `AGENTS.md`，Claude Code 通过 import 读取。 |
| 修改如何授权？ | Claude 自行写入 memory 笔记。 | 一次 `evolve apply` 跑完全部机械门禁；只有 hook 重叠或 catalog 超预算时才需要人工 `--approved`。 |
| 机械层保证什么？ | Memory 是上下文，不是强制配置。 | hook、正文和 catalog 的字节预算；隐私扫描；与现役 hook 的相似度门禁；带 hash 校验的 profile 修改；原子写入并留下审计 diff；重新渲染 catalog。规则本身仍然是行为指导，不是硬性执行。 |
| 如何处理过期内容？ | Claude 保持简短索引，并可整理详细笔记。 | 先替换再新增是门禁而不是建议；带日期的 STATE 自动过期；`weekly` 列出从未被查阅的规则和相似 hook 作为合并候选。 |
| 如何审计？ | 用户可以通过 Claude Code 的 memory 工具查看和编辑。 | 每次应用生成一份审计记录，包含证据、前后 hash 和 unified diff；`consult` 计数器记录哪些规则真的被用到。 |

## 适合只用 Auto Memory 的场景

- 希望在一台机器上零配置地保留个人偏好；
- 内容只是私人习惯或方便以后查看的本地笔记；
- 不需要团队成员或第二种 Agent 依赖同一条持久规则。

## 适合使用 Agent Context Patch 的场景

- 同一类已经验证的错误可能在后续 Agent 任务中再次出现；
- Claude Code 与 Codex 需要共享同一条仓库经验；
- 经验需要审阅、版本管理并与协作者共享；
- context 写入需要预算、隐私与回滚边界；
- 过期、重复或冲突的指令需要显式生命周期。

## 边界

Agent Context Patch 不替代 Claude 的 memory，也不会声称自然语言指令可以变成
确定性配置。语义判断始终属于 Agent。确定性运行时刻意保持窄：它让 context 的
“写入动作”安全、精确且可审计，并把读取面压到足够小，始终摆在 Agent 面前。

Claude Code 用户可以回到[快速安装](../README.zh-CN.md#快速安装)使用插件入口；
Codex 或其他 Agent 使用同一份不可变 Release 安装提示词。
