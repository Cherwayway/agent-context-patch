# Agent Context Patch

把 agent 犯过的错误，变成以后可复用的项目上下文。

Agent Context Patch 是一个轻量的 agent 自进化协议，面向 Codex、Claude Code 和其他
AI coding agent。它不把所有任务都复杂化，而是在 agent 出错、返工、验证失败
或发现上下文过期时，帮助 agent 先修当前问题，再沉淀可审批的项目经验。

默认循环：

1. 发现错误、失败、重复纠正或过期上下文。
2. 先修当前任务。
3. 生成带证据的 evolution proposal。
4. 由用户批准是否合并 context patch。
5. 持续清理过时、重复、无用的上下文。

## 快速安装

把这句话交给你的 agent：

```text
Install agent-context-patch from https://github.com/<org>/agent-context-patch.
Run dry-run first, show planned changes, then ask before applying.
After install, run $evolve init for this workspace.
```

本地开发时可以运行：

```powershell
powershell -ExecutionPolicy Bypass -File install/install.ps1 -Mode DryRun
powershell -ExecutionPolicy Bypass -File install/install.ps1 -Mode Workspace -WorkspacePath .
```

## 核心入口

- `$evolve init`：初始化 workspace context。
- `$evolve after-failure`：失败或返工后生成 proposal。
- `$evolve approve`：批准并合并 proposal。
- `$evolve review-context`：检查冲突、过期、冗余 context。
- `$evolve weekly`：生成周报和待审批 patch。

## 适用范围

适合重度 AI coding、AI PRD、AI SEO、项目长期迭代用户。简单的一次性任务不应
进入 loop，只有未来大概率复用的经验才值得沉淀。

## 默认安全边界

默认策略是 `propose`：agent 可以生成 proposal，但不静默修改全局
`AGENTS.md` / `CLAUDE.md`。用户可以按自己的信任程度改成 `notify` 或 `auto`。
