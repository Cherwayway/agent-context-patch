# Agent Context Patch 可发现性诊断

日期：2026-07-29

观测窗口：GitHub Traffic 的滚动 14 天窗口（2026-07-15 至 2026-07-28，UTC）

范围：只诊断公开仓库的获取、索引、排名、定位、转化与信任；不把无法识别来源的 clone 当作真人采用。

## 结论

当前的主要问题不是 GitHub “限流”，也不是 README 写得不够多，而是仓库尚未建立第一批外部获取入口。

证据链是：

1. GitHub 能按精确仓库名找到项目，说明仓库已进入 GitHub 搜索索引。
2. 但在用户更可能使用的宽泛关键词和大 Topic 中，仓库进不了前 100；GitHub 官方也说明许多仓库排名依赖 stars。
3. 14 天内只有 1 个去重网页访客，referrer 也只有 GitHub 自身的 1 个去重访客；没有公开外部反链。
4. 现有 stars、fork、Issues、PR 都能追溯到团队内部账号。
5. 36 个 unique cloners 与 CI 高峰高度相关，不能当作 36 个真人用户。
6. 同类项目的共同差异不是“README 更长”，而是已有作者受众、包管理器、插件/Skill/MCP 目录或演示内容等外部分发面。
7. Claude Code 已默认提供 Auto Memory；如果开始获得访问，项目还需要正面解释为什么它不是“另一个记忆工具”。

因此，当前漏斗首先断在 `外部触达 -> 仓库访问`，还没有足够样本判断 README 或安装流程的真实转化率。

## 事实快照

### 仓库与互动

截至本次观测：

| 指标 | 当前值 | 判断 |
| --- | ---: | --- |
| 创建时间 | 2026-07-09 | 仍处于冷启动期 |
| Stars | 2 | `Cherwayway`、`enzeDamon`，均为内部 |
| Forks | 1 | `enzeDamon/agent-context-patch`，内部 |
| Watchers | 0 | 无持续关注信号 |
| Owner followers | 0 | GitHub 社交图无法提供首批分发 |
| Homepage | 空 | 没有独立落地页或演示入口 |
| Topics | 10 个 | 元数据已具备，不等于获得排名 |
| README 优化时间 | 2026-07-25 | 距本次观测约 3.5 天 |

README 优化提交 `1f5d2b8` 修改了中英文 README。它改善的是用户到达后的理解和安装路径，没有新增外部触达渠道。

### Traffic

GitHub Traffic API 当前返回：

| 指标 | Count | Uniques |
| --- | ---: | ---: |
| Views | 37 | 1 |
| Clones | 83 | 36 |
| Referrer: `github.com` | 10 | 1 |

GitHub 官方口径是最近 14 天的访客和 full clones，数据按 UTC 统计；views/clones 每小时更新，referrers/popular content 每天更新。由于窗口滚动，之前看到的 2 个 unique visitors 降为 1 并不矛盾。

### Clone 不是采用人数

两个 clone 高峰与 GitHub Actions 活动同步：

| 日期（UTC） | Workflow runs | 每次 run 的 checkout jobs | Clones / unique cloners |
| --- | ---: | ---: | ---: |
| 2026-07-19 | 8 | 2 | 32 / 13 |
| 2026-07-26 | 10 | 2 | 33 / 12 |

仓库的 `verification.yml` 在 Ubuntu 和 Windows 两个 matrix job 中都运行 `actions/checkout@v6`。这个时间相关性强烈支持“自动化 checkout 污染 clone 指标”，但 GitHub 不提供每次 clone 的身份，因此这仍是推断，不是逐条归因。

其余 clone 也可能来自 CLI、Agent 安装、安全扫描或机器人；它们都可以绕过仓库网页。没有外部 referrer、star、issue、fork 或安装回访时，不能把它们解释成真人用户。

## 漏斗诊断

### 1. 获取：主要根因

公开 GitHub 代码搜索中，精确仓库 URL 的外部引用为 0。唯一曾命中的 `link-ways/shang-mai` 是当前登录账号可见的私有仓库，安装与升级提交均由 `Cherwayway` 完成，已排除为外部采用。

外部网页搜索中，以下精确查询均未返回目标仓库：

- `"Agent Context Patch" GitHub`
- `site:github.com/Cherwayway/agent-context-patch`
- `"Cherwayway/agent-context-patch"`

这只是 2026-07-29 的搜索快照，不能证明所有搜索引擎都未收录；但它与“公开外部反链为 0”以及“referrer 只有 GitHub 自身”相互印证。

Google 官方说明，新站点或新页面如果外部链接很少，爬虫可能难以发现；链接同时用于发现新页面和判断相关性。这符合当前仓库的观测，但不意味着 GitHub 页面存在技术性 `noindex` 问题。

### 2. GitHub 索引：已收录，但排名弱

2026-07-29 的 GitHub Repository Search 快照：

| 查询 | 结果规模 | 目标仓库位置 |
| --- | ---: | --- |
| `agent-context-patch in:name` | 1 | 第 1 |
| `topic:self-improving-agents` | 49 | 第 16 |
| `topic:agent-memory` | 2,229 | 前 100 之外 |
| `topic:openai-codex` | 1,249 | 前 100 之外 |
| `topic:agents-md` | 1,037 | 前 100 之外 |
| `topic:claude-code` | 52,844 | 前 100 之外 |
| `claude code memory in:name,description,readme` | 258,476 | 前 100 之外 |
| `openai codex memory in:name,description,readme` | 32,659 | 前 100 之外 |

精确名称可查证明它不是“没被 GitHub 收录”；大类目不可见说明问题是冷启动排名和竞争密度。

GitHub 官方说明 Topics 可以帮助分类和发现项目，但 Explore 展示热门或相关项目；许多仓库排名依赖 stars。当前 2 个内部 star 无法启动推荐反馈循环。

### 3. 定位：开始获客后会成为主要转化风险

Claude Code 官方文档当前说明：

- Auto Memory 默认开启；
- 会自动保存 build commands、debugging insights、architecture notes、preferences 和 workflow habits；
- 每个仓库有自己的 memory 目录，并在新会话加载索引。

当前 README 的首要承诺是“把已验证的纠正变成持久 workspace memory”，但没有出现 `Auto Memory`、`built-in memory` 或明确对比。因此一个刚看到项目的 Claude Code 用户很容易先得出“官方已经有了”的结论。

项目真正有辨识度的价值应被表达为：

- 只从已验证的失败/纠正形成可复用规则；
- 语义判断与确定性的路径、hash、冲突和回滚内核分离；
- workspace 内可审计、可 review、可共享，而非隐藏的机器本地记忆；
- 跨 Claude Code 与 Codex，而不是锁在单一工具；
- 有 replace-before-add、过期清理和安全审批生命周期。

这是“记忆治理与安全提交协议”，不是泛化的“Agent 记忆”。

### 4. 转化与信任：有风险，但现在没有足够流量验证

有利信号：

- MIT License、CI、版本化 Release、校验和、跨平台验证都存在；
- README 首屏已有问题陈述、差异表和可复制安装 prompt；
- 项目强调本地、无遥测、可审计和不可静默修改全局指令。

潜在阻力：

- 安装要求用户理解 immutable release、checksum、dry-run、plan hash 和批准边界，首次体验比 `npm install` 或 `/plugin install` 更重；
- 没有外部案例、第三方安装证明或真人 testimonial；
- 没有一眼可见的终端录屏/GIF，安全机制的价值需要读较多文字才能理解；
- 没有 Claude 插件 marketplace 清单，也没有 npm/PyPI 等标准分发入口。

但 14 天只有 1 个 unique visitor，不能从当前数据计算 README 到 star/install 的转化率。继续只改 README 属于在没有样本时优化漏斗后半段。

## 同类项目对照

这是观测性对照，不把相关性写成因果：

| 项目 | 创建时间 | Stars（快照） | 已观察到的分发资产 |
| --- | --- | ---: | --- |
| `Cherwayway/agent-context-patch` | 2026-07-09 | 2 | GitHub repo 与 Releases；owner 0 followers |
| `alexknowshtml/claude-memory-health` | 2026-06-26 | 59 | owner 176 followers；Claudeers 目录页 |
| `coleam00/claude-memory-compiler` | 2026-04-06 | 1,260 | owner 7,240 followers；外部文章/社区提及；直接安装 prompt |
| `AVIDS2/memorix` | 2026-02-14 | 591 | npm 包、Skill/MCP 目录、外部介绍页、Bilibili 演示视频 |

这些项目各自产品不同，不能直接比较 star 转化率；但它们都至少有一个 GitHub 之外的发现入口，而本仓库当前没有。

## 根因优先级

| 优先级 | 根因 | 置信度 | 为什么 |
| --- | --- | --- | --- |
| P0 | 没有外部获取/分发入口 | 高 | 外部反链 0、referrer 仅 GitHub/1 unique、owner 0 followers |
| P0 | GitHub 大类搜索与推荐冷启动 | 高 | 精确名可查，宽泛查询均不进前 100；stars 全内部 |
| P1 | 与 Claude 内置 Auto Memory 的差异没有正面表达 | 高 | 官方能力与 README 首要承诺表面重叠，README 无对比 |
| P1 | 安装面不在用户现有发现/安装路径中 | 高 | 无 Claude marketplace、npm/PyPI 或主流 Skill/MCP 目录 |
| P2 | 首次安装认知负担较高 | 中 | 可从流程观察，但尚无真人漏斗样本 |
| P2 | 外部社会证明为零 | 高 | 无外部 star/fork/issue/case study，但它也部分是 P0 的结果 |
| 排除 | GitHub 技术性未收录或明显“限流” | 高 | 精确名称搜索正常；没有 suppression 证据 |

## 7 天可证伪实验

目标不是“刷 star”，而是先判断究竟是获取、定位还是安装转化的问题。

### 准备

1. 冻结当前 14 天 Traffic 快照；后续不把 clones 当真人 KPI。
2. 做一个 60–90 秒、从“重复犯错”到“形成审计 patch”的真实终端演示。
3. 增加一页明确对比：`Agent Context Patch vs Claude Auto Memory`。
4. 为不同渠道使用不同的 GitHub 文档落地路径，让 Popular content 能粗略区分来源。
5. 保留安全审批，但提供一个平台原生的安装壳：优先 Claude plugin/marketplace；Codex 侧再选官方可用的插件或 skill 分发面。

### 分发

只选择三个高度相关渠道，每个渠道使用不同落地路径：

1. Claude 插件/Skill 目录或 marketplace；
2. 一个 coding-agent/context-engineering 技术社区，发布完整案例而非裸链接；
3. 定向邀请 10–15 位非团队开发者完成一次安装和一次真实失败后的演化。

Anthropic 官方插件 marketplace 支持发现、安装、版本更新和官方提交入口，因此比继续堆 GitHub Topics 更接近用户的实际安装路径。

### 成功阈值与判定

| 7 天结果 | 结论 | 下一步 |
| --- | --- | --- |
| `< 30` 个外部 unique visitors | 分发/选题仍失败 | 换渠道或案例，不继续润色 README |
| `>= 30` visitors，但 `< 3` 个有效安装/反馈 | 定位、信任或安装转化失败 | 做访谈，压缩安装并强化 Auto Memory 对比 |
| `>= 3` 个安装，但无人完成真实 after-failure | 产品激活失败 | 优化首次价值时刻和触发条件 |
| `>= 3` 个完成真实演化且愿意复用 | 找到初步产品信号 | 扩展目录、案例和可重复发布节奏 |

有效安装应由以下任一证据确认：独立用户反馈、外部仓库中的公开集成、可归因的 issue/discussion，或在不增加遥测的前提下由用户主动提交的验证结果。Release 下载量和 clones 只能作辅助指标。

## 建议的工作顺序

1. 停止继续做无流量样本的 README 微调。
2. 先完成 `Auto Memory` 对比页和一个真实演示。
3. 把现有 skill 包装到平台原生 marketplace/插件安装路径。
4. 执行 7 天三渠道实验并每天保存 Traffic 快照。
5. 根据 `访问 -> 安装 -> 首次演化 -> 复用` 四级漏斗决定下一轮，不以 clone 数或内部 star 判定成功。

## 复现命令与来源

主要只读命令：

```powershell
gh api repos/Cherwayway/agent-context-patch/traffic/views?per=day
gh api repos/Cherwayway/agent-context-patch/traffic/clones?per=day
gh api repos/Cherwayway/agent-context-patch/traffic/popular/referrers
gh api search/repositories -f q='agent-context-patch in:name'
gh api search/code -f q='"github.com/Cherwayway/agent-context-patch" is:public -repo:Cherwayway/agent-context-patch'
gh api users/Cherwayway
```

官方资料与一手页面：

- [GitHub: Viewing traffic to a repository](https://docs.github.com/en/repositories/viewing-activity-and-data-for-your-repository/viewing-traffic-to-a-repository)
- [GitHub: Classifying your repository with topics](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/classifying-your-repository-with-topics)
- [GitHub: Saving repositories with stars](https://docs.github.com/en/get-started/exploring-projects-on-github/saving-repositories-with-stars)
- [GitHub: Discovering projects](https://docs.github.com/en/get-started/exploring-projects-on-github/discovering-projects-on-github)
- [Google Search: crawling and external-link discovery](https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview)
- [Claude Code: project memory and Auto Memory](https://code.claude.com/docs/en/memory)
- [Claude Code: discover and install plugins](https://code.claude.com/docs/en/discover-plugins)
- [Claude Code: create and distribute a marketplace](https://code.claude.com/docs/en/plugin-marketplaces)
- [claude-memory-health](https://github.com/alexknowshtml/claude-memory-health)
- [claude-memory-compiler](https://github.com/coleam00/claude-memory-compiler)
- [Memorix](https://github.com/AVIDS2/memorix)

## 限制

- GitHub 不公开 clone 身份，CI 归因只能由时间相关性推断。
- 搜索排名和 web 索引会变化，本报告只代表 2026-07-29 快照。
- 竞品的外部分发资产与 star 数相关，但公开数据不足以证明每个 star 的来源。
- 在获得至少几十个独立访客之前，无法可靠区分 README、信任与安装流程各自的转化损失。
