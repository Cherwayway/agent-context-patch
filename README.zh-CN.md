# Agent Context Patch

[English](README.md) ·
[最新 Release](https://github.com/Cherwayway/agent-context-patch/releases/latest) ·
[安装指南](AGENT_INSTALL.md) ·
[反馈问题](https://github.com/Cherwayway/agent-context-patch/issues/new?template=feedback.yml)

[![Verification](https://github.com/Cherwayway/agent-context-patch/actions/workflows/verification.yml/badge.svg)](https://github.com/Cherwayway/agent-context-patch/actions/workflows/verification.yml)
[![Latest release](https://img.shields.io/github/v/release/Cherwayway/agent-context-patch)](https://github.com/Cherwayway/agent-context-patch/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**你的 Coding Agent 上周刚修过这个错误，今天却又犯了一次。**

Agent Context Patch 把已经验证过的纠正，变成 **Claude Code 和 OpenAI Codex**
都能读取的短小 workspace memory。后续每个 Agent 任务都会在它本来就要读的指令文件里
看到一份单行 catalog，只在 hook 命中当前任务时再读完整规则，不必从旧对话重新发现经验，
也不必加载所有累积规则。

它完全本地、可以审阅：没有托管服务、后台守护进程和遥测，也不会静默修改全局指令。

已经在使用 Claude Code Auto Memory？它适合个人记忆；Agent Context Patch 补充的是
已验证失败门禁、跨 Agent 共享和可审计的 workspace 写入生命周期。
[查看准确边界](docs/why-agent-context-patch.zh-CN.md)。

## 使用前后

| 没有 Agent Context Patch | 使用 Agent Context Patch |
| --- | --- |
| 修复只存在于聊天记录中。 | 修复验证通过后，Agent 判断其中是否有可复用经验。 |
| 下一次任务冷启动，再次犯错。 | 经验成为短小的 workspace context patch，后续任务可按硬信号选择。 |
| 指令不断追加，逐渐重复甚至冲突。 | 新经验先替换再新增；过期或高风险改动进入人工审阅。 |

例如，可执行的 fresh-Agent 验收从一个“丢弃调用方姓名”的失败 greeting 测试开始。
Agent 修复并验证行为，再把一条可复用 guard 写入 workspace context。真实的用户回执
保持 content-safe：

```text
Evolution outcome: detect=candidate; propose=created; apply=applied; proposal=2026-07-19-caller-input-data-flow; targets=.agent-context/rules/caller-input-data-flow.md; catalog=612B/1 rules.
```

持久 context 保存 guard；回执永远不会暴露经验正文或 proposal 内容。

有效路径保持很短：

```text
验证过的失败 -> 可复用经验 -> 安全 context patch -> 后续 Agent 任务
```

[![短版终端演示：从验证失败到安全复用](docs/assets/agent-context-patch-terminal-demo.gif)](docs/launch/terminal-demo.md)

普通的一次性工作不会进入这个循环。

## 快速安装

### Claude Code 插件

在 Claude Code 中添加项目 marketplace，并安装轻量的安全安装适配器：

```text
/plugin marketplace add Cherwayway/agent-context-patch
/plugin install agent-context-patch@agent-context-patch
/agent-context-patch:install
```

这个插件让用户可以在 Claude Code 内发现项目，但不会静默安装 runtime 或修改
workspace。安装 skill 会解析由 GitHub 强制不可变的最新 Release、验证发布 checksum，
然后展示 Bootstrap 计划和 instruction patch，等待批准。

### Codex 与其他 Agent

把下面这段话交给 Codex 或 Claude Code：

```text
从 https://github.com/Cherwayway/agent-context-patch/releases/latest 安装最新稳定版
Agent Context Patch，并严格遵循 AGENT_INSTALL.md。解析不可变 Release、验证 checksum、
先运行 Bootstrap dry-run，并在应用前向我展示完整计划以及 AGENTS.md 或 CLAUDE.md
语义 patch。批准安装后，运行 $evolve init。
```

正式安装只使用由 GitHub 强制不可变的 Release；持续变化的 `main` 只作为开发源。
Bootstrap 永远不会自行合并已有的 `AGENTS.md` 或 `CLAUDE.md`。

## 适合什么场景

适合：

- 长期 workspace 不断出现 Agent 重复犯错或用户重复纠正；
- 多个 Agent 任务或工具需要共享同一批仓库经验；
- context compaction 后，关键工作流容易被遗忘；
- 现有指令已经过期、重复或互相冲突。

不适合尚未验证的猜测和普通一次性修改，也绝不能用来保存 secrets、原始对话、
客户数据或生产凭据。

## 为什么安全

- Agent 负责语义判断：发生了什么、是否值得复用、最小有效经验是什么。
- catalog 有硬性字节预算，新 hook 与现有 hook 重叠时会被机械地阻断，context
  从结构上就保持短小。
- 每次写入都经过同一个带门禁的 `apply`：schema、修复已验证、隐私扫描、字节上限、
  相似度、预算，然后原子提交并写入带 unified diff 的审计记录。
- runtime 只碰 `.agent-context/` 和指令文件里的受管 block；`AGENTS.md` 或
  `CLAUDE.md` 的其他内容永远不会被修改。
- 合格的低风险新增在当前 Agent 回合内完成；重叠和预算例外才需要人工决策，
  见[写入策略](#写入策略)。

可以继续查看[可执行 Demo](demos/README.md)、
[fresh-Agent 验收证据](docs/acceptance/2026-07-19-observable-delivery-checkpoint.md)
或[架构说明](CONTEXT.md)。

## 工作原理

1. workspace 指令文件里有一个生成的 `acp-catalog` block：每条活跃规则一行 hook，
   按 repo 和 operation 分组，后面是带日期的工作状态。Codex 逐字读取 `AGENTS.md`，
   Claude Code 通过 import 读取，两个 Agent 看到同一份 catalog，不需要任何读取决策。
2. hook 命中当前任务时，Agent 读取该规则的正文：直接打开文件，或用由路径、
   operation、skill、repo 构成的 task signature 运行 `evolve select`。Skill 激活时
   会用固定的 signature 调用 `select`，让 gate 规则随工作流一起出现。
3. Agent 先修复并验证当前任务。
4. 修复验证通过后，只有出现高信号事件才运行 delivery checkpoint：失败验证后来通过、
   用户明确纠正、独立 QA 缺陷、发现过期 workspace context，或首个修复失败而后续修复
   通过。普通无触发任务保持静默。
5. Agent 编写一个 proposal（trigger、evidence、operations）并调用 `evolve apply`。
   runtime 校验、跑完全部门禁、原子写入规则与状态文件、记录带 unified diff 的审计、
   重新渲染 catalog，然后返回一条内容安全的 `detect / propose / apply` 回执。
6. 任务结束时，Agent 用 `evolve consult` 记录真正用到的规则。周报按这些计数排序、
   合并和退役规则。

## 读优先的 Catalog

catalog 是这个版本的核心。存下来却没人读的经验毫无价值，所以 Schema 2 把读取一侧
的成本降到零：

```markdown
<!-- acp-catalog: kit=0.7.0 schema=2 rendered=2026-09-14T08:12:31.000Z rules=12 state=1 -->
## Workspace Context Catalog

### ilands · migration
- gate [hot-table-partial-index-cic] Adding a partial index on a hot table: run CIC in its own workflow step and reject the batch when it fails.

### any · general
- gate [verify-before-evolve] Before evolving context: the current fix must be verified.

### STATE (auto-expires)
- (09-21) ilands: PR 3070 is in review round 3; index recycling is a separate PR.
<!-- /acp-catalog -->
```

- 每条规则一个文件 `.agent-context/rules/<id>.md`：hook 不超过 160 字节
  （“情境 + 动作”）、kind（`gate`、`advice`、`fact`）、`applies_to` 范围
  （repos、路径 glob、ops、skills）、正文不超过 1500 字节。
- block 总量不超过 8 KB。新增会超预算时，`apply` 会被阻断，直到有规则被替换或退役。
- `evolve select --signature '{"paths":[...],"ops":[...],"skills":[...]}'`
  返回命中的规则正文：repos 作为过滤条件，任一维度相交即命中，全局 gate 总是带上，
  gate 优先，上限 12 KB。
- `evolve consult --consulted a,b --missed c` 把真实使用计数写回规则 frontmatter。
  这是项目第一次拥有“规则是否被用到”的数据，周报就建立在它之上。
- 受管 block 之外的内容永远不会被改动。

## 本地 Bootstrap 开发

PowerShell：

```powershell
powershell -ExecutionPolicy Bypass -File install/install.ps1 `
  -Mode DryRun -WorkspacePath .

# 审阅输出的 plan hash 后：
powershell -ExecutionPolicy Bypass -File install/install.ps1 `
  -Mode Apply -WorkspacePath . -ApprovedPlanHash <approved-hash>
```

Bash：

```bash
bash install/install.sh --mode dry-run --workspace .
bash install/install.sh --mode apply --workspace . \
  --approved-plan-hash <approved-hash>
```

## 本地升级验证

先独立校验并解压一个不可变的候选 Release，再从候选 Release 调用 Bootstrap，目标是
已经安装的 user-level skill：

PowerShell：

```powershell
powershell -ExecutionPolicy Bypass `
  -File <candidate-release>\install\install.ps1 `
  -Mode UpdateDryRun `
  -SkillTargetPath <installed-user-skill-target>

# 审阅完整 UpdatePlan，并批准精确 plan hash 后：
powershell -ExecutionPolicy Bypass `
  -File <candidate-release>\install\install.ps1 `
  -Mode UpdateApply `
  -SkillTargetPath <installed-user-skill-target> `
  -ApprovedPlanHash <approved-hash>
```

Bash：

```bash
bash <candidate-release>/install/install.sh \
  --mode update-dry-run \
  --skill-target <installed-user-skill-target>

# 审阅完整 UpdatePlan，并批准精确 plan hash 后：
bash <candidate-release>/install/install.sh \
  --mode update-apply \
  --skill-target <installed-user-skill-target> \
  --approved-plan-hash <approved-hash>
```

候选脚本的位置决定升级源。Update mode 不检查或写入 workspace context，不修改
instruction 文件，也不批准 schema migration。它会把当前与候选 skill 的完整受管文件树
绑定到获批计划，备份旧 skill、验证替换结果，并在失败时恢复旧版本。

v0.2.0 skill 早于 `$evolve update` 出现，因此第一次升级把上述候选 Bootstrap 流程作为
一次性兼容交接；之后统一使用唯一公开命令 `$evolve update`。

## Workspace Context

Schema 2 的全部内容都在 `.agent-context/` 下：

```text
.agent-context/
  config.yml            schema_version 2、write_policy、agents_file、budgets、state TTL
  rules/<id>.md         每条规则一个文件：frontmatter（hook、kind、applies_to、计数）+ 正文
  STATE.yml             带日期的工作状态；每条都会过期（默认 14 天，最长 90 天）
  PROFILE.md            只放已验证的 workspace 事实，不放规则
  proposals/<id>.md     每次已应用变更一条审计记录：证据 + unified diff
  reports/              可重建的周报
  archive/              被替换或退役的规则、过期状态、迁移前历史
```

渲染进指令文件的 catalog 由 `rules/` 和 `STATE.yml` 派生，永远不是第二份真相源。
proposal 是审计记录而不是收件箱：变更和记录在同一次调用里写入。report 是派生视图，
archive 不参与读取。

## 核心命令

所有命令都以 `node <installed-skill>/runtime/cli.mjs <command>` 运行，
`<installed-skill>` 是 user-level 的 evolve skill 目录。每个命令都接受
`--workspace <dir>` 和 `--today YYYY-MM-DD`。

- `init`：创建 Schema 2 workspace 并渲染空 catalog block。
- `status`：校验 workspace 并输出 JSON 摘要（规则数、待重写草稿数、状态条数、
  catalog 字节与预算、写入策略）。
- `catalog [--write]`：打印 block，或把它重新渲染进指令文件。
- `select --signature '<json>' | @file [--json]`：打印命中 task signature 的规则正文。
- `apply --proposal '<json>' | @file [--approved]`：一次调用完成校验、门禁、写入、
  审计和重新渲染。状态：`applied`、`approval_required`、`blocked`、`failed`。
- `consult --consulted a,b [--missed c,d]`：把真实使用记录写入规则 frontmatter。
- `expire`：归档过期的 STATE 条目并重新渲染 catalog。
- `weekly [--memory-dir <dir>]`：写入 `reports/weekly-<date>.md`。
- `memory-sync --memory-dir <dir> [--dry-run]`：把 Claude Code 的项目级 `MEMORY.md`
  重新生成为只保留 `user` 类记忆的视图，其余文件报告为迁移候选。
- `migrate-v1`：把 Schema 1 workspace 就地转换，一次性且有损。
- `receipt --detect <status>:<reason> --propose <status>:<reason>`：格式化无候选回执。
- `$evolve update`：显式检查最新稳定的不可变 Release，校验 checksum、tag 和 source
  commit，并在替换 user-level skill 前展示完整 UpdatePlan 与精确 plan hash。升级成功后
  需要开启一个新的 Agent 任务加载新版；不会后台检查、上传遥测或静默升级。
  如需及时的外部通知，请订阅本仓库的 GitHub Release 通知；需要检查或升级时再运行
  `$evolve update`。

## 写入策略

```yaml
write_policy: auto
```

- `auto`：新 workspace 的默认策略。通过全部门禁的 proposal 在同一次调用里应用，
  不需要用户回合。
- `propose`：显式谨慎模式，`migrate-v1` 也会保留 Schema 1 配置里的这个选择。
  `apply` 返回 `approval_required`，直到用同样的调用加上 `--approved` 重跑。

`--approved` 代表一次人工决策，只绕过相似度门禁和 catalog 预算。它永远不会绕过
schema 校验、修复已验证要求、隐私扫描、字节上限或 profile hash 检查。

Bootstrap 和 Kit update 永远不会改写已有 workspace 的策略。高信号修复成功应用后，
Agent 只打印 `apply` 返回的回执行：三个阶段、proposal id、workspace-relative 目标
和 catalog 大小；不暴露经验正文，也不在 applied 路径请求用户回复。

## Context Health

context 不会因为变大而变好。

- 新 hook 与活跃 hook 的 token 相似度达到 0.5 时被 `similar_rule_exists` 阻断；
  正确做法是 `supersede`，不是换个说法再 add。
- 8 KB 的 catalog 预算会阻断新增，直到有规则被替换或退役。
- `consulted`、`last_consulted`、`missed` 计数记录真实使用；周报列出最常被查阅的规则、
  相关但被错过的规则、30 天内从未被查阅的规则、相似度达到 0.35 的 hook 对，以及
  3 天内到期的状态。
- STATE 条目自动过期；带日期的内容不进规则。
- 周报只给建议；只有 `apply` 会改变 context。

## Evidence Privacy

Evidence 优先保存指针和摘要：使用 workspace-relative 路径、命令、exit code 与 hash，
简短转述用户纠正；不持久化原始聊天、完整日志、secret、credential、客户数据或无关
个人信息。晋升 user-global 前必须去除 workspace 特定内容。

隐私扫描在每个 proposal 上运行，遇到私钥、常见 token 形态、凭据赋值和用户主目录绝对
路径即失败；`--approved` 无法绕过。

## Legacy Workspace

Kit 0.7.0 不再读取 Schema 1 workspace（`PROJECT_CONTEXT_INDEX.md`、
`PROJECT_PROFILE.md`、`checklists/`、PatchPlan proposal）。`migrate-v1` 会就地转换一次：
每条 checklist 条目和 profile 规则变成标记为 `needs_rewrite` 的草稿规则，历史移入
`archive/`，然后渲染 catalog。转换是有损的，这是接受的代价；原文件保留在 `archive/`
供查阅。迁移后 catalog 通常会超预算，下一步是一次性的重写与合并（目标不超过 60 条规则），
之后才接受新增。Bootstrap 永远不会自行转换 workspace。

## 架构与开发

领域词汇见 [CONTEXT.md](CONTEXT.md)，原始架构决策见
[ADR-0001](docs/adr/0001-agent-first-context-evolution.md)，auto-first 默认见
[ADR-0003](docs/adr/0003-auto-first-low-risk-context.md)，delivery checkpoint 与回执行见
[ADR-0005](docs/adr/0005-observable-evolution-outcomes.md)，读优先 catalog、Workspace
Schema 2 以及移除 compiler、lifecycle coordinator 和 marker 规则的决定见
[ADR-0010](docs/adr/0010-read-first-catalog-and-schema-2.md)，行为与测试文件的映射见
[verification matrix](docs/v1-verification-matrix.md)。

统一验证入口：

```bash
npm test
```

验证会执行 `tests/runtime/` 下的 runtime 测试（YAML 子集、文本工具、workspace 校验、
catalog 渲染与替换、选择、apply 门禁与回滚、consult 回写、weekly、memory bridge、
migrate-v1、CLI）、Bootstrap 安装器测试（dry-run、apply、幂等、升级）和仓库卫生检查；
CI 在 Windows 与 Ubuntu 运行同一入口。
