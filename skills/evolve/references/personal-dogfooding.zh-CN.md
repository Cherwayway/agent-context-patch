# 个人自用 Dogfooding Playbook

状态：`experimental-owner-dogfood`。它只服务于当前用户主动要求的个人实践，
不代表已经验证为外部用户的默认工作流。30 天复盘前不得据此扩张公共命令或核心抽象。

这份 Playbook 定义 Agent Context Patch 在个人多仓库工作中的默认用法。
当前目标不是收集其他用户反馈，而是先证明它能让我们自己的 agent 在长期工作中：

- 更少重复犯同一类错误。
- 更快加载真正有用的项目事实。
- 把一次性要求与长期经验分开。
- 主动删除已经过时、冲突或不再影响行为的 context。

## 一个主动入口，两个按需动作

个人日常只需要在首次进入长期仓库时主动初始化；之后的重复错误由 Agent 自动处理：

```text
第一次进入长期维护的仓库：运行 $evolve init，先展示你确认过的项目事实和不确定项。

发生返工或重复错误：Agent 先修好并验证当前问题，再自动运行 $evolve after-failure；只有存在复发风险才生成 Proposal。

本周有真实 evolution 信号：运行 $evolve weekly，合并同根因问题，给出批准、拒绝、观察和清理建议。
```

只有安全门禁要求人工决策时才使用 `$evolve approve`；发现 context 本身过时或膨胀时
使用 `$evolve review-context`。它们是例外处理动作，不需要成为每天的固定仪式。

## Default Personal Loop

每个活跃仓库拥有自己的 `.agent-context/`。项目事实优先留在项目内，
不要因为一条经验看起来“可能通用”就立刻写进全局指令或修改脚手架。

### 1. 开始长期或高风险任务

仅在任务依赖项目历史、约束或重复流程时读取：

1. `.agent-context/PROJECT_CONTEXT_INDEX.md`
2. `.agent-context/PROJECT_PROFILE.md`
3. 与当前任务直接相关的 checklist

一次性简单修改不强制进入 evolution loop。

### 2. 当前任务出现失败或返工

先修当前问题并验证，再由 Agent 自动运行 `$evolve after-failure`。用户不需要记住命令、
请求沉淀或再开一个回合批准低风险补充。

只有满足至少一项时才创建 Proposal：

- 用户指出了 agent 本应从项目 context 中知道的事实。
- 测试、构建或评审暴露了未来可能复发的问题。
- 同一解释、命令序列或人工 workaround 再次出现。
- 现有 context 已过时、冲突或导致错误决策。

Proposal 必须包含具体证据。单纯觉得“以后也许有用”不算证据。

### 3. 选择最小的长期干预

按下面的顺序判断，使用第一个足够解决问题的层级：

1. 更新项目事实或约束：`PROJECT_PROFILE.md`
2. 补一个容易漏掉的验证步骤：`checklists/`
3. 修正 agent 触发规则或流程：项目指导文件或 skill
4. 多个真实场景都无法靠前三项解决：修改脚手架功能
5. 证据不足或只会发生一次：不沉淀

不要把本地业务规则提升成用户全局规则，也不要把一个仓库的特殊需求提升成脚手架能力。

### 4. 自动应用与例外批准

本节不定义第二套生命周期。Proposal、Decision、PatchPlan、Apply Attempt 和
`context_write_policy` 的唯一规则来自 `protocol-v1.md` 与 `proposal-schema.md`。
个人使用默认保持 `context_write_policy: auto`：

- Agent 生成 Proposal 和精确 patch，Proposal 是审计记录而不是用户待办。
- 符合全部 `auto` gate 后立即应用，无需用户批准或回复。
- 应用后完成相关验证，并只发送一次非阻塞回执：经验摘要、Proposal ID 和目标文件。
- 只有 cleanup、config、domain、migration、instruction 或 user-global 等例外路径才请求
  一次明确决策。

用户直接要求沉淀，只能证明这条规则具有 `user_decision` 权威；它不等于绕过安全
门禁。只有满足全部 `auto` gate，或例外路径的精确 PatchPlan 获批，并且 Apply Attempt
成功后，Proposal 才能记录为 `applied`。

## Weekly Review

每周最多做一次 15 分钟复盘；如果本周没有真实信号，不为了产出周报而制造内容。

1. 汇总本周的用户纠正、验证失败、重复 workaround 和 stale context。
2. 按根因合并重复信号，不按对话或任务数量重复建 Proposal。
3. 只审核被安全门禁拦下的 pending Proposal：批准、拒绝、继续观察或合并。
4. 对每个问题选择：context、checklist、skill、功能、清理、暂不处理。
5. 检查已应用改进是否仍然复发；无效则提出精确的回滚或重写 Proposal，获批后执行。
6. 对本周确有相关任务机会的规则，区分 `material_use`、`loaded_only`、
   `relevant_but_missed`、`not_applicable` 和 `unknown`。只读过 context 不等于规则改变了
   行为；没有覆盖到的任务记为 `unknown`，不能算零使用。
7. 对有稳定 rule ID 的规则，只汇总内容安全的机会数、实际改变行为的次数、激活后复发、
   最近一次有效证据指针、无关加载和未知覆盖；不保存原始任务、对话或完整轨迹。
8. 提出删除或归档候选；只有在精确计划获批后才处理过时、重复、过长且不再改变
   agent 行为的 context。
9. 只保留一个下周 watch item，避免待观察事项无限增长。

除了 500/800 行预算外，激活后仍复发、反复只加载未使用、短期快速连续 auto-add、长期没有
rewrite/cleanup，以及几乎所有规则都声明高 retention 但有效性覆盖大多未知，也应触发一次
语义 review。它们只触发检查，不得自动删除规则。

## Promotion Gate

个人使用阶段只允许两种提升：

### 项目 context -> 个人全局 context

必须在至少两个自己的独立仓库中出现，并且不包含具体项目实现细节。

### 项目问题 -> 脚手架改进

必须同时满足：

- 问题确实影响任务结果，而不只是表达偏好。
- 已尝试项目 context 或 checklist，仍无法稳定解决。
- 有可复现案例和明确验收方式。
- 改动仍然服务于“减少重复错误、保持 context 小而有效”的核心目标。

未通过 Promotion Gate 的内容继续留在原仓库；若已无保留价值，提出归档候选，
仅在精确计划获批后归档。

## Success Check

个人自用阶段只看一个核心问题：

> 应用改进后，同类可预防错误是否在后续相关任务中再次发生？

辅助观察：

- 相同用户纠正是否减少。
- agent 是否能从项目 context 直接找到答案。
- Proposal 是否长期积压。
- context 是否只增不减。
- 一条规则是否真的改变了 agent 的计划、执行或验证行为。
- 有多少判断仍因任务机会或证据覆盖不足而是 `unknown`。

功能数量、Proposal 数量和 context 总行数都不是成功指标。

对高价值规则，优先使用 paired fresh-Agent case：相同的脱敏任务与预算，一个不加载候选规则，
一个加载候选规则；由外部 harness 检查可观察结果，而不是相信 Agent 自述“使用了规则”。同时
增加一个无关任务，验证候选规则不会扩大约束范围。只保留结构化结果、输入 digest 和脱敏摘要。

## Fresh-Context Acceptance Cases

每次改变这份 Playbook 的语义，都用一个没有参与设计的新 Agent 检查下面两个场景。

### Positive: 应该沉淀

场景：Agent 修改代码后再次漏跑仓库已经要求的验证命令，用户指出这是第二次返工。

期望行为：先运行验证并修好当前任务；搜索 Active Context 是否已有同义或冲突规则；
若没有足够规则，自动运行 `$evolve after-failure`，提出最小的 workspace checklist PatchPlan，
符合全部 `auto` gate 后立即应用，无需用户批准或回复，并只发送一次非阻塞回执。
不得直接修改全局指令或脚手架。

### Negative: 不应该沉淀

场景：用户一次性要求把某个按钮改成蓝色，没有失败、重复纠正、项目约束或复发风险。

期望行为：完成并验证当前修改，不运行 evolution loop，不创建 Proposal、周报或长期
context。

## First 30 Days

前 30 天只做真实使用记录，不急着泛化产品：

- 选择 2 到 3 个经常使用的仓库运行 `$evolve init`。
- 正常工作，只有遇到符合触发条件的问题才由 Agent 自动运行 `$evolve after-failure`。
- 只有本周存在真实信号或用户主动要求复盘时才运行 `$evolve weekly`；无信号则跳过。
- 30 天后检查哪些错误减少了、哪些 Proposal 没有价值、哪些流程过重。
- 只有到这一步，才决定脚手架需要新增什么能力。
