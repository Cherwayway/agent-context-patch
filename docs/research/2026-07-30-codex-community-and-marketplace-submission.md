# Codex 社区分发与 Claude 插件市场提交调研

日期：2026-07-30

范围：只核对 OpenAI、Anthropic 及其官方 GitHub 组织的一手页面；调研子任务本身未发帖、未提交表单、未修改任何外部状态。

## 结论

1. **第一外部渠道应选 `openai/codex` GitHub Discussions 的 `Show and tell`。** 这是 OpenAI 官方 Codex 仓库内明确用于展示作品的分类，项目相关性最高，且帖子回复、投票/反应及同期仓库 Traffic 变化都可观察，政策风险低于在泛社区直接推广。
2. OpenAI Developer Community 明确允许分享与 OpenAI/开发者工作相关的作品，但禁止重复、过度推广、跨版重复发布和无关自荐。Discord 有 OpenAI 官方入口，但公开页面没有披露频道级推广规则，不宜作为第一站。
3. **Anthropic 当前没有第三方申请进入 `claude-plugins-official` 的公开流程。** 两个提交表单进入的是 `claude-community`；官方市场由 Anthropic 另行挑选，是否收录完全由其决定。
4. GitHub 仓库中的 `.claude-plugin/marketplace.json` 只足以让用户添加一个自托管市场，**不等于已向 Anthropic 提交，也不等于进入任何 Anthropic 市场**。

## OpenAI / Codex 可用渠道

| 渠道 | 官方性 | 开源项目推广口径 | 建议 |
| --- | --- | --- | --- |
| [`openai/codex` Discussions — Show and tell](https://github.com/openai/codex/discussions/categories/show-and-tell) | OpenAI 官方 Codex 仓库；分类说明为展示自己做的东西 | **明确允许**在该分类展示作品；当前列表已有工具、skills 和开源项目展示帖 | **第一站**。只发一个完整案例帖，不去 Issues 重复发 |
| [OpenAI Developer Community](https://community.openai.com/) | OpenAI 官方入口，但官方说明它是公开、社区运营的论坛，OpenAI 员工不保证回复 | [规则](https://community.openai.com/guidelines)明确允许分享相关作品，但禁止重复或过度推广、跨版重复发布、无关服务广告和垃圾自荐 | 第二站。若发帖，选 [`Codex`](https://community.openai.com/c/codex/37) 或 [`Community`](https://community.openai.com/c/community/21)，写成可复现实例而非裸链接 |
| [OpenAI Developer Showcase](https://developers.openai.com/showcase) | [OpenAI Developers Community 页面](https://developers.openai.com/community)明确邀请提交 project、demo 或 workflow | **明确邀请提交**；但公开页未说明审核周期、收录保证或提交后的访问统计 | 可并行准备，不能代替可立即观测的社区实验 |
| [`openai/codex` Issues](https://github.com/openai/codex/issues) | OpenAI 官方仓库 | 未发现允许推广的规则；[Issue templates](https://github.com/openai/codex/tree/main/.github/ISSUE_TEMPLATE)只覆盖 Codex App、扩展、CLI、bug、功能请求和文档问题 | **不要用于推广**。有真实兼容性 bug 或功能请求时再开 issue |
| [OpenAI Discord](https://discord.com/invite/openai) | 该邀请链接由 [OpenAI Developers Community](https://developers.openai.com/community) 官方页面直接给出；平台由 Discord 托管 | OpenAI 的通用社区规则称适用于所有线上空间，相关作品可分享、垃圾自荐不可接受；但公开官方页面没有频道级发帖位置和推广细则 | 进入后先读服务器规则并确认合适频道；不作为第一站，不跨频道复制粘贴 |
| [OpenAI Forum](https://forum.openai.com/) | OpenAI 官方专家社区，与 Developer Community 不是同一个站点 | 官网只说明 guest 可看资源；完整参与需要现有会员或 OpenAI 员工邀请并满足资格。未找到开源项目推广政策 | 不作为冷启动渠道；准入受限且推广口径未文档化 |

补充：OpenAI Developers Community 页面也链接 Reddit 和 X，但“被官方页面链接”不能证明具体社区由 OpenAI 管理，也不能证明允许项目推广，因此本报告不把它们列为已验证的官方发帖渠道。

### 为什么先发 Codex Show and tell

- **意图匹配最强**：分类本身就是作品展示，不需要把推广伪装成 bug、问答或功能请求。
- **受众匹配最强**：读者已在 Codex 官方仓库，而本项目解决的正是 coding agent 的 workspace context/memory 治理。
- **可观测**：记录发帖前的 GitHub Traffic、star/fork/issue 基线；发帖后观察 7 天的帖子回复/反应、仓库 unique visitors 和外部真实反馈。`unique cloners` 仍不作为采用人数，因为 CI checkout 会污染该指标。
- **归因边界清楚**：第一周只发布这一个外部帖子，不同时铺多个社区；若访问仍为零，说明题目/案例/渠道未形成触达，而不是 README 转化问题。

建议帖子结构：一个真实失败场景 → Agent Context Patch 如何形成可审计 patch → 与 Claude/Codex 内置 memory 的边界 → 60–90 秒演示或终端记录 → 安全边界 → 邀请读者复现并反馈。正文提供价值，只保留一个仓库链接。

## Anthropic Claude Code 插件市场

### 先纠正市场名称

Anthropic 当前维护两个不同市场：

- `claude-plugins-official`：Anthropic 自己策划的官方市场。当前[官方 Claude Code 文档](https://code.claude.com/docs/en/plugins#submit-your-plugin-to-the-community-marketplace)明确说没有申请流程，社区提交表单不会把插件加入该市场。
- `claude-community`：第三方插件经过审核后进入的社区市场，公开镜像为 [`anthropics/claude-plugins-community`](https://github.com/anthropics/claude-plugins-community)。该仓库是只读镜像，直接 PR 会被自动关闭，内容从内部审核流水线同步。

存在一个需要特别注意的文档冲突：[`anthropics/claude-plugins-official` README](https://github.com/anthropics/claude-plugins-official#external-plugins)仍写第三方合作方可通过目录表单提交，但当前 Claude Code 文档更具体地说明该表单进入 `claude-community`，且 `claude-plugins-official` 没有申请流程。本报告按当前产品文档执行，不把表单描述为“官方市场申请”。

### 当前提交入口

| 入口 | 适用账户 | 实际去向 |
| --- | --- | --- |
| [Claude.ai 插件目录提交](https://claude.ai/admin-settings/directory/submissions/plugins/new) | Team 或 Enterprise 组织，且有 directory management 权限；Owner 默认具备 | `claude-community` 审核 |
| [Anthropic Console 插件提交](https://platform.claude.com/plugins/submit) | 不属于 Team/Enterprise 的个人作者也可使用；需要有效 Anthropic Console 账户 | `claude-community` 审核 |

以上账户要求及去向见 [Claude Code 插件提交文档](https://code.claude.com/docs/en/plugins#submit-your-plugin-to-the-community-marketplace)。短链 [`clau.de/plugin-directory-submission`](https://clau.de/plugin-directory-submission)目前也导向这套官方说明。

### 提交前置条件

最低技术和合规准备：

1. 插件放在 GitHub 仓库中；如果插件位于子目录，准备相对仓库根目录的路径。
2. 本地运行 `claude plugin validate ./your-plugin`。官方审核流水线会重复相同校验，并执行自动安全扫描。[官方文档](https://code.claude.com/docs/en/plugins#submit-your-plugin-to-the-community-marketplace)
3. 仓库应包含清晰 README、安装/使用/排障说明，并先让其他人实际测试。[分享插件指南](https://code.claude.com/docs/en/plugins#share-your-plugins)
4. 遵守 [Anthropic Software Directory Policy](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy)：功能描述必须窄而准确、指令可读且不可隐藏/混淆；提供可验证联系方式和支持渠道、工作原理和排障文档、至少三个可工作的示例；持续维护并处理问题。
5. 同意 [Anthropic Software Directory Terms](https://support.claude.com/en/articles/13145338-anthropic-software-directory-terms)。若插件收集用户数据或连接远程服务，必须提供清楚可访问的隐私政策；还要维护安全漏洞报告接收机制。

### Console 表单当前字段

2026-07-30 的 [Console 提交表单](https://platform.claude.com/plugins/submit)要求：

**必填**

- 至少一个支持平台：Claude Code、Claude Cowork；
- GitHub 插件仓库 URL；
- 插件名称；
- 插件描述；
- 示例用例；目录政策要求至少提供三个可工作的例子；
- 联系邮箱；
- 同意 Anthropic 隐私政策和 Software Directory Terms。

**可选或条件必填**

- 仓库内子路径；
- 插件主页/文档站；
- License 类型；表单称留空时默认 Apache 2.0，实际提交前应显式填写并与仓库 LICENSE 保持一致；
- 隐私政策 URL；表单提示 Verified Status 需要该字段，而目录政策要求任何收集数据或连接远程服务的插件必须提供。

### 审核预期

- 提交不保证收录；Anthropic 可能要求补充信息。[Software Directory Terms](https://support.claude.com/en/articles/13145338-anthropic-software-directory-terms)也明确保留拒绝、移除及持续复核的权利。
- 审核包含结构校验、自动安全扫描，以及 Anthropic 的安全、兼容性和质量审核。[插件提交文档](https://code.claude.com/docs/en/plugins#submit-your-plugin-to-the-community-marketplace)、[目录政策](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy)
- 获批后，插件会按特定 commit SHA 固定到社区目录；仓库后续 push 时 CI 更新 SHA。公开目录从审核流水线**每晚同步**，所以批准后仍可能延迟出现。[插件提交文档](https://code.claude.com/docs/en/plugins#submit-your-plugin-to-the-community-marketplace)
- 官方没有公布审核 SLA。当前表单只提示早期运行阶段可能存在发布延迟。

### `marketplace.json` 是否足够

**不够。** [创建与分发 marketplace 的官方指南](https://code.claude.com/docs/en/plugin-marketplaces)说明，`.claude-plugin/marketplace.json` 的作用是让用户通过 `/plugin marketplace add owner/repo` 添加你自己的市场。要进入 Anthropic 社区目录，仍必须使用上述表单；[`anthropics/claude-plugins-community`](https://github.com/anthropics/claude-plugins-community#submitting-a-plugin)也明确拒绝直接 PR，所有变更来自内部审核流水线。

因此正确路径是：

```text
可安装、已验证的 GitHub 插件仓库
  -> claude plugin validate
  -> Claude.ai 或 Console 表单
  -> 自动验证与安全审核
  -> Anthropic 批准
  -> claude-community 夜间同步
```

`claude-plugins-official` 不在这条申请路径中；只能等待 Anthropic 自主挑选。

## 推荐执行顺序

1. 先完善一个真实演示和与内置 memory 的差异说明。
2. 只在 `openai/codex` 的 `Show and tell` 发一个案例帖，跑满 7 天可观测窗口。
3. 同步把 Claude 插件仓库整理到 `claude plugin validate` 无错误，并补齐三个用例、README、License、联系方式和必要的隐私说明。
4. 使用 Console 表单提交到 `claude-community`；不要把它写成“申请官方市场”。
5. 根据真实访客、有效安装反馈和讨论互动决定第二渠道；不要用 CI 污染的 clone 数判断成功。
