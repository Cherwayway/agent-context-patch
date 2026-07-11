# Agent Context Patch

把 Agent 反复犯过的错误，变成短小、持久、可审阅的 workspace context。

Agent Context Patch 采用 Agent-first：旗舰 Agent 负责理解项目、判断经验是否值得沉淀、
生成 context patch。`auto` 必须使用很薄的 deterministic Commit Kernel；人工精确批准也可以
通过它提交，但没有 Node 时仍可使用 `propose`。

默认循环：

1. 发现可复用的失败、纠正、过期规则或工作流经验。
2. 先修复并验证当前任务。
3. 检查 Active Context，优先替换而不是追加。
4. 生成带证据和精确 PatchPlan 的 proposal。
5. 用户批准，或由 `auto` 通过 Commit Kernel 应用低风险计划。
6. 持续提出语义清理 proposal，让 context 保持当前和有用。

## 快速安装

把下面这段话交给 Agent：

```text
Install the latest stable Agent Context Patch from
https://github.com/Cherwayway/agent-context-patch/releases/latest. Resolve it to
one GitHub-enforced immutable tag and source commit, download that exact
Release, and verify its published checksum before running its AGENT_INSTALL.md.
Run Bootstrap dry-run first, show the exact plan hash and the separate AGENTS.md
or CLAUDE.md patch, then ask before applying. After the install, run $evolve
init for this workspace.
```

正式安装只使用由 GitHub 强制不可变的 Release；持续变化的 `main` 只作为开发源。

默认安装位置：

- `$evolve` skill 和可选 Node Commit Kernel 安装在 Agent 的 user-level skill 目录；
- 短 guidance fragment 与 `.agent-context/` 安装在 workspace；
- global trigger 只允许显式 opt-in。

Bootstrap 永远不会自动合并已有 `AGENTS.md` / `CLAUDE.md`；Agent 必须单独展示
语义 patch 并请求批准。

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

V1 只在 workspace 内写 Active Context：

```text
.agent-context/
  PROJECT_CONTEXT_INDEX.md
  PROJECT_PROFILE.md
  config.yml
  checklists/
  proposals/
  reports/
  archive/
```

普通任务默认只读取 index、profile 和相关 enabled checklist。Proposal 自己保存
Decision Log 与 Apply Attempts；report 是派生视图；archive 默认不读取；不再建立独立
`mistakes/` 或 `receipts/` 真相源。

## 核心命令

- `$evolve init`：检查 workspace，报告 `contextRead`，检测 domain 候选，并展示
  可审阅 InitPlan；只有批准后才启用 domain。
- `$evolve after-failure`：先修复当前任务，再执行 replace-before-add 并生成一个
  带证据 proposal；发现重叠或冲突时转为 cleanup proposal。
- `$evolve approve`：展示精确 PatchPlan，批准绑定 plan hash；内部区分
  `approved` 与 `applied`，文件变化会让批准失效。
- `$evolve review-context`：按冲突、过期、重复、authority 与 retention value
  生成语义清理 proposal；不按数量自动删除。
- `$evolve weekly`：生成派生健康报告，不反向覆盖 Active Context。
- `$evolve update`：显式检查最新稳定的不可变 Release，校验 checksum、tag 和 source
  commit，并在替换 user-level skill 前展示完整 UpdatePlan 与精确 plan hash。升级成功后
  需要开启一个新的 Agent 任务加载新版；不会后台检查、上传遥测或静默升级。
  如需及时的外部通知，请订阅本仓库的 GitHub Release 通知；需要检查或升级时再运行
  `$evolve update`。

## 写入策略

默认：

```yaml
context_write_policy: propose
```

只支持两档：

- `propose`：生成计划，等待精确批准；
- `auto`：workspace 显式 opt-in，仅通过 Node Commit Kernel 应用合格的低风险
  create/update 计划。Kernel 会重读 workspace config；只有已启用 domain 的 checklist
  才可能自动写入。

Node 或 kernel 不可用时，`auto` 必须明确降级为 `propose`。删除、archive、
supersede、migration、instruction 文件、domain activation 和 user-global promotion
永远需要人工批准。

## Context Health

- 新规则必须先执行 replace-before-add；
- authority 决定冲突时哪份证据优先；
- retention value 决定规则是否仍值得占据 Active Context；
- 数量和 budget 只触发 review、阻断 `auto`，永远不自动截断；
- cleanup proposal 必须展示删除后损失、替代规则和 context 净变化。

## Evidence Privacy

Evidence 优先保存指针和摘要：使用 workspace-relative 路径、命令、exit code 与 hash，
简短转述用户纠正；不持久化原始聊天、完整日志、secret、credential、客户数据或无关
个人信息。晋升 user-global 前必须去除 workspace 特定内容。

## Legacy Workspace

无 `schema_version` 的 `.agent-context/` 是只读 `legacy_v0`。V1 可以读取，但迁移
必须通过 MigrationPlan、备份、精确批准和 ApplyAttempt。Bootstrap 不会用新模板覆盖
legacy context。

## 架构与开发

领域词汇见 [CONTEXT.md](CONTEXT.md)，架构决策见
[ADR-0001](docs/adr/0001-agent-first-context-evolution.md)，决策与验证证据的映射见
[v1 verification matrix](docs/v1-verification-matrix.md)。

统一验证入口：

```bash
npm test
```

验证会执行真实 demo、协议 fixtures、Commit Kernel 文件结果、Bootstrap
dry-run/apply/idempotency、仓库卫生和平台契约；CI 在 Windows 与 Ubuntu 运行同一入口。
