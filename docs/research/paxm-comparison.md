# paxm 对照调研：AgentCarry 是否仍有开发必要

> 调研日期：2026-07-21
> 外部对象：[pax-beehive/paxm](https://github.com/pax-beehive/paxm)
> paxm 快照：[`v0.2.1`](https://github.com/pax-beehive/paxm/releases/tag/v0.2.1)，`29095193c51f6af770279ce71359334e3178065f`
> 资料范围：只使用 paxm 官方 GitHub 仓库的 README、文档、源码所公开的接口、评测与 release 信息；本地产品判断以 AgentCarry 当前 README、ADR、路线图、兼容矩阵和源码为准。

## 结论

**有差异化，但不是“跨 Agent 共享上下文”这层差异化。**

paxm 已经完整占据了这一宽泛命题：让一个 Agent 中产生的决定、约定和工作上下文，通过统一的持久记忆层被后续 Codex、Claude Code、OpenCode、Pi 等会话主动或被动召回。它已经提供 CLI、MCP、Skill、hooks、SQLite、远程 provider adapter、历史 backfill、可靠队列、dashboard 和跨 Agent 评测。若 AgentCarry 的最终目的只是“以后换 Agent 时不用重新解释项目”，就没有继续开发的必要。[paxm README](https://github.com/pax-beehive/paxm#what-changes-after-installation)；[paxm Roadmap](https://github.com/pax-beehive/paxm/blob/main/docs/roadmap.md#product-goal)

AgentCarry 仍有一个更窄、可独立成立的目的：

> **把某个已经进行到一半的具体任务，从既有原生 session 中重建成可验证的当前任务状态，明确披露迁移损失，并立即在另一个 Agent 中继续。**

这个目的不是长期记忆。它要求回答“现在做到哪一步、哪些文件和 Git 事实仍然成立、哪些路走失败了、下一步是什么、哪些状态无法迁移”，并启动目标 Agent。paxm 当前公开的核心接口是 `remember`、`recall`、`history` 和 provider routing；它会让新会话得到相关记忆，但没有公开一个等价于 `continue <existing-session> --to <agent>` 的任务交接契约，也没有 Work Capsule、事实级证据、工作区新鲜度和损失收据这一整套交付物。[paxm README：MCP server](https://github.com/pax-beehive/paxm#mcp-server)；[paxm Architecture](https://github.com/pax-beehive/paxm/blob/main/docs/architecture.md)

因此建议是：**继续开发 AgentCarry，但只开发 `existing native session → evidence-backed Work Capsule + loss receipt → target session` 这条纵向切片。** 不要进入持久记忆、provider 适配、自动 recall、长期知识库、dashboard 或通用 Agent 集成平台；这些方向 paxm 已经更成熟。若 AgentCarry 不能在“半完成任务的正确续作”评测中显著胜过 paxm recall/passive-memory 和可见 transcript 基线，就应停止或重新定位。

## 一、paxm 的最终目的

### 1.1 最终目的

paxm 自己把产品定义为一个小型、provider-neutral 的 Agent memory runtime。其目标闭环是：

```text
agent activity → memory write → provider storage → later recall → useful context
```

官方路线图要求先证明三件事：用户能否轻松完成完整记忆闭环、召回是否准确且不过量、用户能否理解并控制系统行为。[paxm Roadmap：Product Goal](https://github.com/pax-beehive/paxm/blob/main/docs/roadmap.md#product-goal)

README 给用户的结果承诺是：新会话携带项目背景，不必重复说明架构决定、工作约定和操作约束；Codex 中写入的记忆可以由 Claude Code、OpenCode、Pi 或 MCP client 召回；存储后端可从本地 SQLite 换成 Zep、Mem0、MemOS、OpenViking 或私有 JSON-RPC provider，而不用重接每个 Agent。[paxm README：What changes after installation](https://github.com/pax-beehive/paxm#what-changes-after-installation)

### 1.2 目标用户

目标用户是同时或先后使用多个 Coding Agent、希望跨会话保留长期项目经验，并且在意本地优先、provider 可替换和配置控制权的开发者或团队。产品同时面向两类调用者：

- 人类/operator：安装、setup、provider 配置、诊断、history、dashboard、backfill；
- Agent：通过 CLI、MCP、Skill 或 lifecycle hook 进行显式/被动 recall 与 remember。

这一人机边界由其架构文档明确区分；Agent-facing tools 无权安装 hook、修改 credential、更新 paxm 或更改 routing。[paxm Architecture：Layers](https://github.com/pax-beehive/paxm/blob/main/docs/architecture.md#layers)

### 1.3 交付物

paxm 当前不是一个单独的“session 转换器”，而是一套记忆基础设施：

- Go CLI 与共享 runtime；
- 内置 SQLite memory provider；
- Zep、Mem0、MemOS、OpenViking 与 JSON-RPC provider adapter；
- Codex/Claude Code plugin、OpenCode plugin、Pi extension，以及更多 Agent 的 MCP/hook 接入；
- 主动调用的 `remember`、`recall`、`history`、`config doctor`；
- 被动 hook 的 prompt-time recall 与 completed-turn capture；
- provider routing、ranking、timeout、durable queue、retry、telemetry、dashboard 和 backfill；
- retrieval、conversation-write、lifecycle、provider contract、LoCoMo 与 cross-agent eval。

来源：[paxm README：How it works](https://github.com/pax-beehive/paxm#how-it-works)、[Agents and providers](https://github.com/pax-beehive/paxm#agents-and-providers)、[Reliability by default](https://github.com/pax-beehive/paxm#reliability-by-default)、[Evaluation](https://github.com/pax-beehive/paxm#evaluation)。

### 1.4 核心工作流

paxm 有两条共用同一 runtime 和 provider router 的路径：

1. **主动路径**：用户或 Agent 用 CLI/MCP/Skill 显式 `remember`，之后以查询显式 `recall`；
2. **被动路径**：Agent lifecycle hook 在模型回复前召回相关上下文，在完整 turn 结束后把可见内容写入本地 durable queue，再异步交给 provider。

默认 SQLite 通过 FTS5/BM25 检索，不需要账号、API key、embedding 或额外 memory-layer 模型调用。远程 provider 慢或失败时，队列重试且不阻断 coding session。[paxm README：How it works](https://github.com/pax-beehive/paxm#how-it-works)；[SQLite quality preview](https://github.com/pax-beehive/paxm#sqlite-quality-preview)

## 二、paxm 当前已实现的能力

截至本次调研，官方仓库显示 latest release 为 `v0.2.1`，并为 Windows、macOS、Linux 的 amd64/arm64 发布制品。[Releases](https://github.com/pax-beehive/paxm/releases)；[paxm README：Releases](https://github.com/pax-beehive/paxm#releases)

### 2.1 已形成完整可用闭环

- `paxm setup`、`config doctor`、`remember`、`recall`、`history` 和 localhost dashboard 已公开；
- Codex 和 Claude Code 有 plugin，Pi 有 extension，OpenCode 有本地 plugin；Cursor、TRAE、Kimi Code、ZCode、Kiro、Cline 有不同程度的 MCP/hook 接入；
- 默认 SQLite、本地 durable write queue、多 provider route、timeout、retry 和 telemetry 已实现；
- `backfill scan/run/status` 可以把 Codex、Claude Code 和 Pi 的原生 JSONL 历史规范化为 turn 并导入 provider，而不是只处理安装后的新会话；
- MCP server 公开四个受限工具：`paxm_recall`、`paxm_remember`、`paxm_history`、`paxm_config_doctor`。

来源：[paxm README](https://github.com/pax-beehive/paxm)、[Agent Integrations](https://github.com/pax-beehive/paxm/blob/main/docs/agent-integrations.md)、[Configuration](https://github.com/pax-beehive/paxm/blob/main/docs/config.md)、[Architecture：Historical Session Backfill](https://github.com/pax-beehive/paxm/blob/main/docs/architecture.md#historical-session-backfill)。

### 2.2 已经直接验证“跨 Agent 经验复用”

paxm 不只是单 Agent 记忆。其 cross-agent tracer 用 Pi 产生经验，再让新的 Claude Code 会话作为 control/passive/active consumer；官方路线图记录的最初三场景结果是 control 2/3，两个 memory-assisted 组均为 3/3。仓库明确把它描述为方向性证据，不是概率估计，而且没有计划继续扩展该场景集。[paxm Roadmap：Recall Evaluation Harness](https://github.com/pax-beehive/paxm/blob/main/docs/roadmap.md#phase-2-recall-evaluation-harness)；[Cross-agent eval](https://github.com/pax-beehive/paxm/tree/main/evals/cross-agent)

这条证据非常重要：AgentCarry 不能再把“一个 Agent 的经验能帮助另一个 Agent”本身当作差异化。

### 2.3 能力边界与明确非目标

paxm 官方明确或通过接口边界表达了以下限制：

- 它是 memory adaptor/runtime，**不是另一个 hosted memory service**；存储位置和 provider 由用户决定；
- provider credential、hook trust、routing、数据位置、disable/uninstall/rollback 归用户所有；
- setup、credential 管理、hook 安装与 backfill 不进入 MCP，防止 Agent 静默接管配置；
- Agent-facing tools 不能安装 hook、改 credential、更新 paxm 或改 routing；
- 新 Agent/provider 集成只在有需求证据时增加，不以最大化集成数量为目标；
- macOS GUI 计划复用 Go runtime，不得成为 CLI、MCP、hook 或 headless 使用的前置条件；在 provider lifecycle 能安全验证前，不开放任意记忆删除或破坏性批量编辑。

来源：[paxm README：How it works](https://github.com/pax-beehive/paxm#how-it-works)、[MCP server](https://github.com/pax-beehive/paxm#mcp-server)、[paxm Architecture](https://github.com/pax-beehive/paxm/blob/main/docs/architecture.md)、[paxm Roadmap：Guiding Principles / Boundaries](https://github.com/pax-beehive/paxm/blob/main/docs/roadmap.md#guiding-principles)。

**需要把事实与推断分开：** paxm 没有在文档中写出“任务 handoff 是非目标”。但其公开产品目标、CLI/MCP 工具、roadmap 和架构都围绕记忆 write/store/recall，而不是选择一个既有 session、生成完整当前任务状态并启动另一 Agent。因此“paxm 当前不是 AgentCarry 式 handoff 产品”是基于官方接口范围的推断，不是维护者作出的永久承诺。

## 三、与 AgentCarry 的重合和差异

### 3.1 高度重合的部分

| 维度 | 重合情况 |
| --- | --- |
| 用户心智 | 都在解决“新会话/换 Agent 后不要从头解释” |
| 用户群 | 都面向同时使用 Codex、Claude Code、OpenCode、Pi 等 Coding Agent 的开发者 |
| 价值取向 | local-first、跨 vendor、用户掌握 credential/配置、尽量不阻断 Agent |
| 接入方式 | 都会使用 CLI、Skill/Plugin、Agent adapter，并需要理解原生 session/event |
| 信息内容 | 决策、约束、失败经验、可见 turn 内容都可能跨会话出现 |
| 质量证明 | 都认为不能只做功能 demo，需要真实 Agent 或生产路径评测 |

这意味着 AgentCarry 当前 README 中“换 Agent 后不用重新解释”不能单独作为定位；这是 paxm 已经兑现得更完整的上层承诺。

### 3.2 核心工作单元不同

| 维度 | paxm | AgentCarry |
| --- | --- | --- |
| 核心名词 | memory item / provider / recall profile | session snapshot / Work Capsule / loss receipt |
| 核心动词 | remember、recall | continue |
| 时间尺度 | 多个未来会话长期复用 | 当前半完成任务的一次性交接 |
| 输入 | 显式写入、hook capture、历史 backfill | 一个被选中的既有原生 session + 当前 workspace 事实 |
| 选择逻辑 | 按 query 与 profile 检索若干相关记忆 | 重建该任务目标、约束、状态、失败路径和下一步 |
| 输出 | 排名后的 memory snippets/context | 版本化 task-state capsule + fact evidence + loss receipt |
| 工作区事实 | 主要保存/召回记忆 | 现场重采文件、Git、验证时间，并让新事实覆盖旧叙述 |
| 失败语义 | provider timeout/failure 可按 route fail-open/best-effort | 关键约束或下一步不确定时 fail closed，必须披露迁移损失 |
| 目标 Agent | 给会话提供 memory | 渲染 capsule 并启动/恢复目标 Agent |
| 成功指标 | recall 相关性、误召回、provider fidelity、memory-assisted answer | 关键约束保真、正确任务状态、正确下一步、续作质量 |

AgentCarry 的本地依据：[产品边界 ADR](../decisions/0001-product-boundary.md)、[架构](../architecture.md)、[路线图](../roadmap.md)、[兼容矩阵](../compatibility.md)。

### 3.3 不能再主张的差异

以下说法已经被 paxm 削弱或消除，不应出现在 AgentCarry 的核心叙事里：

1. “我们支持多个 Coding Agent”——paxm 的覆盖更广；
2. “一个 Agent 的经验能被另一个 Agent 使用”——paxm 已有跨 Agent 实测；
3. “我们是 local-first、无需账号”——paxm 默认 SQLite 已做到；
4. “我们能读取以前的历史”——paxm 已有 resumable backfill；
5. “我们提供 Skill/MCP/hooks”——这些是分发与接入方式，不是护城河；
6. “我们有 benchmark”——必须比较的是 half-finished task continuity，而不是泛化 memory answer。

### 3.4 仍然成立的差异化空间

AgentCarry 必须把全部开发和表达集中在 paxm 当前没有交付的组合契约：

1. **任务级而非知识级：** 一次输出目标、约束、已完成、待办、失败路径、开放问题和正确下一步；
2. **现场证据：** 每个关键事实回链原始 session event 或采集时间明确的 workspace/Git 事实；
3. **新鲜度：** 当前工作区事实优先于 transcript 旧描述，而不是只召回过去写下的内容；
4. **损失可见：** 隐藏 reasoning、工具状态、附件、partial output 等不能迁移的内容进入 loss receipt；关键损失默认停止；
5. **未经准备的任务：** 即使用户之前没有安装 AgentCarry 或 hook，也能从现有 native history 重建；这里必须比 paxm backfill 更进一步，证明能形成“当前任务状态”而不只是 memory items；
6. **立即续作：** 交付物不是供用户稍后搜索的记忆库，而是直接创建目标 Agent 会话；
7. **多跳 lineage：** 后续迁移仍保留原始事实证据，不把摘要继续摘要。

这些特征只有作为一个整体才构成差异。单独的 session reader、摘要、launcher 或 benchmark 都容易被 paxm 或其他项目吸收。

### 3.5 对现有六项停项条件的逐项核查

AgentCarry 的[竞品地图](../competitive-landscape.md)规定：只有另一维护中产品同时做到六项能力，项目才应停止或重新定位。paxm `v0.2.1` 的核查结果如下：

| 停项条件 | paxm `v0.2.1` | 证据与判断 |
| --- | --- | --- |
| 1. 读取至少三个 Coding Agent 的既有原生历史 | **满足** | Historical Session Backfill 已明确解析 Codex、Claude Code、Pi 的 JSONL 历史，并规范化为 turn 写入 provider。[Architecture](https://github.com/pax-beehive/paxm/blob/main/docs/architecture.md#historical-session-backfill) |
| 2. 生成中立、版本化的 task-state capsule | **未发现** | 官方核心对象是 memory item、profile、provider 与 recall result；公开命令和源码 command registry 未出现 task-state capsule 或等价版本化交接对象。[CLI command registry](https://github.com/pax-beehive/paxm/blob/main/internal/cli/commands.go)；[Architecture](https://github.com/pax-beehive/paxm/blob/main/docs/architecture.md) |
| 3. 附带事实级证据和 workspace freshness | **未发现完整等价物** | paxm 有 origin/scope、session/turn/time provenance 和 workspace 隔离，但它们是 memory attribution/retrieval 边界；未发现对每个交接事实回链原始 event、并以当前文件/Git 事实覆盖旧叙述的契约。[README](https://github.com/pax-beehive/paxm#how-it-works)；[Configuration](https://github.com/pax-beehive/paxm/blob/main/docs/config.md#identity-and-provenance) |
| 4. 明确、fail-closed 的 transfer loss | **未发现** | paxm 有 provider required/best-effort、timeout、retry 与 hook fail-open，这是记忆服务可用性语义；未发现“某些 session 状态无法迁移，因此停止目标启动”的 loss receipt。[Reliability](https://github.com/pax-beehive/paxm#reliability-by-default) |
| 5. 保留 multi-hop handoff lineage | **未发现** | 仓库提到的是 multi-hop recall，不是任务在多个目标 Agent 之间迁移时保留原始 capsule/evidence 的 handoff lineage。[todo](https://github.com/pax-beehive/paxm/blob/main/docs/todo.md) |
| 6. 发布可复现的 continuation-quality benchmark | **部分相关，但不满足同一标准** | cross-agent tracer 已可复现地验证 Pi 的经验能否帮助新 Claude 会话避免同类失败；它是 3 场景 memory-assisted recall 评测，官方也声明只是方向性证据，并非对半完成任务状态、损失、workspace freshness 和正确下一步的 continuation benchmark。[Roadmap](https://github.com/pax-beehive/paxm/blob/main/docs/roadmap.md#phase-2-recall-evaluation-harness)；[Cross-agent eval](https://github.com/pax-beehive/paxm/tree/main/evals/cross-agent) |

**六项合取结论：paxm 目前没有触发 AgentCarry 的既定停项条件。** 它明确满足第 1 项、在第 6 项上形成强邻近能力，但第 2 至第 5 项没有发现完整等价物。尤其当前公开命令主要是 setup/config、remember/recall/history、dashboard、backfill、eval、MCP 与 hook；没有发现任务级 `continue --to ...`、target launcher、versioned task-state capsule、fact-level evidence + workspace freshness、explicit loss receipt 或 multi-hop handoff lineage。[CLI command map](https://github.com/pax-beehive/paxm/blob/main/docs/architecture.md#cli-command-map)

这个结论不等于“paxm 永远不会做 handoff”。它只说明在 `v0.2.1` 的官方仓库快照中，两个产品的核心对象、失败语义与目标会话启动职责仍然不同。

## 四、当前风险：差异化已定义，但还没有被证明

AgentCarry 当前兼容矩阵仍是实验阶段：Codex Reader 与 Claude Code dry-run/交互式 Launcher 已实现，OpenCode/Pi/Gemini 仍在计划中。仓库已经有 Capsule schema、workspace collector、redaction、doctor、active checkpoint 和 benchmark/collector 代码，但还没有公开结果证明目标 Agent 的实际续作质量优于可见 transcript 或 paxm memory。[AgentCarry 兼容矩阵](../compatibility.md)；[AgentCarry 路线图](../roadmap.md)

所以当前真实判断不是“已经形成成熟差异化产品”，而是：

> **产品契约有差异化；市场价值仍待一个严格的、带 paxm 对照组的 continuity benchmark 证明。**

paxm 的发展也会继续压缩空间。它已经具备 session hook、历史 backfill、cross-agent eval、workspace 隔离和 provenance；未来增加一个 handoff 输出并非架构上不可能。AgentCarry 的速度优势只能来自把“可审计的半完成任务续作”做得显著更深，而不是做得更宽。

## 五、建议的继续/停止门槛

在继续扩展第二、第三个 adapter 前，先把 paxm 加入 Phase 0 对照组。对同一组半完成 coding task，至少比较：

1. 只复制可见 transcript；
2. paxm 的 passive/active recall（使用官方 SQLite 默认路径）；
3. AgentCarry deterministic Capsule；
4. AgentCarry source-assisted Capsule。

必须统一目标 Agent、模型、权限、仓库快照和任务停止点，并评分：

- 关键约束是否全部保留；
- 是否准确区分已完成、待办和失败路径；
- 是否读取到当前文件/Git 事实而没有采信旧叙述；
- 是否识别不可迁移状态并停止或告警；
- 下一步动作是否正确；
- 恢复到第一个有效代码/验证动作需要多少用户补充。

### 继续开发的最低条件

- AgentCarry 在关键约束、任务状态和正确下一步上稳定优于 transcript 与 paxm 组；
- 优势主要来自 evidence、freshness、loss semantics 和 target launch，而不是提示词偶然性；
- 用户能用一条命令完成交接，不要求提前安装 hooks 或维护 memory provider；
- 至少 Codex → Claude Code 的真实目标会话成功，不只 dry-run。

### 应停止或重新定位的条件

- paxm recall 已能让目标 Agent 同样准确地恢复半完成任务；
- AgentCarry 的 Capsule 只是更长的摘要，没有带来更正确的下一步；
- 用户仍需要大量人工确认，动作没有明显少于复制 transcript；
- 为了补齐效果，AgentCarry 开始建设持久记忆、provider routing、自动 recall、dashboard 等 paxm 已成熟的能力。

## 最终判断

用一句话回答“是否还有开发必要”：

> **有，但前提是 AgentCarry 是任务交接器，不是跨 Agent 记忆层。**

paxm 已经证明“跨 Agent 持久记忆”是一个真实且拥挤的产品方向，也已经覆盖 AgentCarry 原始愿景中的大部分上层叙事。AgentCarry 唯一值得继续下注的地方，是把一个正在进行的任务以可验证、可追溯、明确披露损失的方式交给另一个 Agent，并用严格 benchmark 证明这比记忆召回更能恢复正确工作状态。若这个差距证明不出来，就应停止开发，而不是继续堆 adapter。
