# Launch Copy

Use these as starting points after the demo and marketplace install have been
verified. Keep the concrete failure story; change only the audience-specific
framing and landing path.

## One sentence

Agent Context Patch turns a verified coding-Agent mistake into a small,
reviewable workspace rule that Claude Code and Codex can reuse in later tasks.

## Technical community post

```text
Your coding Agent fixed the bug last week. A fresh task made the same mistake.

I built Agent Context Patch to close that loop without storing raw chats or
letting a script decide what a project lesson means:

verified failure -> Agent-owned lesson -> exact workspace patch -> fresh task

The Agent owns semantics. A narrow deterministic kernel owns paths, hashes,
conflicts, approval boundaries, and rollback. It works with Claude Code and
OpenAI Codex and stays local with no daemon or telemetry.

Here is the 60–90 second fail / repair / reuse demo:
https://github.com/Cherwayway/agent-context-patch/blob/main/docs/launch/terminal-demo.md

I am looking for developers who have actually seen an Agent repeat a verified
mistake. Where would this workflow be too heavy for you?
```

## Direct design-partner invitation

```text
I am testing a local open-source workflow for one narrow problem: a coding
Agent fixes and verifies a mistake, then a later task repeats it because the
lesson stayed in the old chat.

Would you try Agent Context Patch in one real repository? Installation is
reviewed and uses an immutable GitHub Release; there is no telemetry or hosted
service. I care more about where you stop than about getting a star.

Install guide:
https://github.com/Cherwayway/agent-context-patch/blob/main/AGENT_INSTALL.md
```

## 中文技术帖

```text
Coding Agent 上周刚修过的错误，新任务里又犯了一次。

Agent Context Patch 只处理这一条闭环：

验证过的失败 -> Agent 判断可复用经验 -> 安全 workspace patch -> 新任务复用

语义判断仍属于 Agent；确定性内核只负责路径、hash、冲突、审批边界和回滚。
它同时支持 Claude Code 与 OpenAI Codex，本地运行，没有后台服务和遥测。

我正在找确实遇到过“Agent 重复犯错”的开发者试用。相比 star，我更想知道你会卡在哪一步：
https://github.com/Cherwayway/agent-context-patch/blob/main/docs/why-agent-context-patch.zh-CN.md
```
