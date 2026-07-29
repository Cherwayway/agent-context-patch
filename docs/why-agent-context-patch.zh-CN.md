# Agent Context Patch 与 Claude Code Auto Memory 的区别

Claude Code Auto Memory 和 Agent Context Patch 解决的是同一个问题的不同层次。
Auto Memory 适合零配置的个人记忆；Agent Context Patch 面向需要团队共享、跨 Agent
复用和审计的 workspace 经验治理。

两者可以同时使用。

| 问题 | Claude Code Auto Memory | Agent Context Patch |
| --- | --- | --- |
| 谁决定记住什么？ | Claude 判断哪些笔记以后可能有用。 | 只在出现高信号且已经验证的失败或纠正后，由 Agent 判断是否形成经验。 |
| 保存在哪里？ | 机器本地、按仓库隔离，同一仓库的 worktree 共享。 | workspace 文件，可随仓库审阅和共享。 |
| 哪些 Agent 能使用？ | Claude Code。 | 通过各自适配器供 Claude Code 和 OpenAI Codex 使用。 |
| 修改如何授权？ | Claude 自行写入 memory 笔记。 | 精确 PatchPlan 先经过 policy 检查；高风险改动必须人工批准。 |
| 机械层保证什么？ | Memory 是上下文，不是强制配置。 | Commit Kernel 保证 context 写入的路径、hash、冲突和回滚；Active Context 本身仍然是行为指导，不是硬性执行。 |
| 如何处理过期内容？ | Claude 保持简短索引，并可整理详细笔记。 | 先替换再新增、context budget 和人工批准的清理流程，避免静默堆积。 |
| 如何审计？ | 用户可以通过 Claude Code 的 memory 工具查看和编辑。 | proposal 证据、Decision、ApplyAttempt 和前后 hash 构成 workspace 审计轨迹。 |

## 适合只用 Auto Memory 的场景

- 希望在一台机器上零配置地保留个人偏好；
- 内容只是私人习惯或方便以后查看的本地笔记；
- 不需要团队成员或第二种 Agent 依赖同一条持久规则。

## 适合使用 Agent Context Patch 的场景

- 同一类已经验证的错误可能在后续 Agent 任务中再次出现；
- Claude Code 与 Codex 需要共享同一条仓库经验；
- 经验需要审阅、版本管理并与协作者共享；
- context 写入需要路径、冲突、隐私与回滚边界；
- 过期、重复或冲突的指令需要显式生命周期。

## 边界

Agent Context Patch 不替代 Claude 的 memory，也不会声称自然语言指令可以变成
确定性配置。语义判断始终属于 Agent。确定性内核只负责让 context 的“写入动作”
安全、精确且可审计。

Claude Code 用户可以回到[快速安装](../README.zh-CN.md#快速安装)使用插件入口；
Codex 或其他 Agent 使用同一份不可变 Release 安装提示词。
