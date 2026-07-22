# AgentCarry

把一个 Coding Agent 中已经进行到一半的任务，带着证据和明确的损失说明，交给另一个 Agent 继续。

AgentCarry 是本地优先、完全开源的 CLI。它面向频繁使用 Codex、Claude Code、OpenCode、Gemini CLI、Pi 等产品的开发者，解决的不是“导出聊天记录”，而是“换 Agent 后继续当前工作”。

> 当前状态：v0.1 实现与 benchmark 验证阶段。Codex → Claude Code 已同时支持
> 可审计的 `--dry-run` 准备和经确认的交互式启动。

[English](README.md)

## 它做什么

```text
已有的本地 session
        ↓
带原始证据引用的 Work Capsule
        ↓
损失收据 + 当前工作区事实
        ↓
在另一个 Agent 中创建可继续的新 session
```

预期命令保持很少：

```powershell
agentcarry continue --to claude
agentcarry continue --to claude --dry-run
agentcarry continue --to claude --active --checkpoint-stdin --dry-run --json
agentcarry inspect --session <id> --json
agentcarry doctor --json
```

AgentCarry 不安装 Agent、不管理认证、不替用户切换模型或权限、不修改源 session，也不会默认上传 transcript。

非 dry-run 命令会先输出便于人阅读的交接摘要、全部迁移损失和精确目标步骤，
然后只确认一次；除 `y` / `yes` 以外的任何回答都会安全取消，不创建目标 session。
交互式目标程序会占用 stdout，无法同时维持“stdout 只有一个 JSON 文档”的机器契约，
因此实时启动拒绝 `--json`；自动化审计请使用 `--dry-run --json`。

## 为什么不是另一个聊天记录工具

已有产品分别解决了历史搜索、原始 transcript 注入、Agent 实时通信和 ACP 编排。AgentCarry 只守一个更窄的楔子：

- 从已经存在的本地 session 开始，而不是要求会话必须由它启动；
- Capsule 中的关键事实引用原始事件或当前工作区证据；
- 关键约束或下一步不确定时默认停止；
- 无法迁移的隐藏状态、工具状态和附件进入损失收据；
- 用公开 benchmark 与“只复制可见消息”的基线比较续作质量；
- Windows、PowerShell、中文路径与 macOS/Linux 都是一等测试环境。

详细边界见[产品边界 ADR](docs/decisions/0001-product-boundary.md)和[竞品地图](docs/competitive-landscape.md)。
当前 adapter 的真实验证范围见[兼容矩阵](docs/compatibility.md)。

## 路线图

- **Phase 0：** 12 个受控连续性 fixture、scorer，以及[首份公开报告](benchmark/runs/2026-07-21-cc-switch-gpt-5.6-sol/final/REPORT.md)；两个 Capsule 模式如实未通过“正确下一步”和 token 比例门槛。
- **v0.1：** Codex → Claude Code，包含 dry-run、脱敏和损失收据。
- **v0.2：** Claude Code → OpenCode。
- **v0.3：** Codex、Claude Code、OpenCode 双向适配。
- **v0.4：** Pi 与 Gemini CLI。
- **v0.5：** 仓库 Skill 与跨历史发现。
- **v0.6：** 对 AgentCarry 创建的会话加入可选 ACP runtime。

版本门槛见[路线图](docs/roadmap.md)。

稳定 JSON envelope、退出码与 dry-run 不启动保证见 [CLI 契约](docs/cli-contract.md)。

## 试跑 tracer bullet

需要 Node.js 22 或更高版本、npm 和 Git：

```text
npm ci
npm run demo:tracer
```

这个跨平台 demo 会用临时且已脱敏的 Codex session 运行真实构建后的
CLI，输出损失项和精确的 Claude 命令，证明未启动 Claude 进程，并校验源文件
哈希不变。详见 [Codex 到 Claude Code dry-run demo](docs/demos/codex-to-claude-dry-run.md)。

## 交互式继续任务

在目标仓库中，把当前工作区最新完成的 Codex 任务交给 Claude Code：

```text
npm run build
node dist/cli-main.js continue --to claude
```

一次肯定确认后，AgentCarry 会在内部执行两步：先通过 stdin 在一个禁用工具的
非交互回合中写入已脱敏的 continuation brief，再用同一个 session ID 进入 Claude
Code 原生交互界面。交互回合仍使用用户自己的模型、provider、权限、Skill、MCP 与认证。
seed 失败时不会执行 resume；AgentCarry 不安装 Claude Code，也不会发起登录。

脱敏的 [真实 Claude 交互启动记录](docs/demos/codex-to-claude-interactive.md) 同时说明了
Windows provider 冒烟与三平台进程边界各自证明了什么。

## 两分钟外部验收

没有参与过 AgentCarry 开发的 Windows/macOS 用户，可以安装固定的公开验收版本，
再用一条命令完成真实交接：

```text
npm install --global github:Jettlin927/agentcarry#v0.1.0-acceptance.1
agentcarry continue --to claude
```

不收集私密聊天的验收协议和当前 cohort 进度见
[外部用户真实 handoff 验收](docs/external-acceptance.zh-CN.md)与
[`acceptance/REPORT.md`](acceptance/REPORT.md)。AgentCarry 仍然不会安装 Codex、
Claude Code 或管理它们的认证。

## 安装仓库 Skill

首先直接告诉当前 Coding Agent：

```text
Review https://github.com/Jettlin927/agentcarry/tree/main/skills/agentcarry and install the agentcarry Skill into your own user-level Skill directory. Do not install or update AgentCarry or another coding agent, and do not change authentication. Tell me the exact destination and every file you changed.
```

唯一的 Skill 源文件是 [`skills/agentcarry/SKILL.md`](skills/agentcarry/SKILL.md)。Codex、
Claude Code、OpenCode、Gemini CLI 和 Pi 的手动路径，以及关闭第三方匿名遥测的
交互式 `npx skills add` 方式见 [Skill 安装说明](docs/skill-installation.md)。
AgentCarry CLI 本身不提供 Skill 安装命令。

## Work Capsule

Work Capsule 不是另一种完整 transcript 格式。它只携带续作必需的状态：当前用户消息、目标、约束、决策、失败路径、已完成、待办、有序下一步、文件与 Git 状态、执行过的命令、验证结果、开放问题、证据引用、损失和 lineage。

关键事实不会被静默截断。工作区当前事实优先于 transcript 中的旧描述，并带采集时间。当前 Schema 见 [`work-capsule.v2.schema.json`](schema/work-capsule.v2.schema.json)；v1 继续保留，用于复现 Phase 0 历史产物。
对于当前仍在运行的任务，源 Agent 通过 stdin 按
[`active-checkpoint.v1.schema.json`](schema/active-checkpoint.v1.schema.json) 提交一次明确完成的
checkpoint。AgentCarry 会先验证 native session 的稳定字节前缀；checkpoint 绑定只规范化终止换行，
Capsule 中仍逐字保留 native session 最后一条完整用户消息。partial assistant output 与隐藏状态不会被冒充为已迁移。
哪些损失可以继续、必须停止或允许一次性 force，见[损失收据语义](docs/loss-semantics.md)。

Claude 的目标提示词由规范化 Capsule 单独编译成精简 continuation brief：第一动作和禁止提前
执行项排在最前，相同事实只出现一次并合并证据引用，同时保留约束、当前状态、失败路径、
工作区与 Git、涉及文件、已运行命令、验证结果和迁移损失。完整规范化 JSON、Markdown 渲染和 loss receipt 仍保留在 dry-run
输出中，供机器消费与审计，但不再重复塞进目标提示词。

## 先评测，再宣传

Phase 0 使用 12 个受控任务，对每个任务比较三种交接：

1. 只复制可见的用户消息和 Agent 回复；
2. 确定性 Work Capsule；
3. source-assisted Work Capsule。

source-assisted 生成会把完整 v2 schema 同时放进 Claude CLI structured-output 参数和模型可见 prompt，并在落盘前校验结果。忽略 structured-output metadata 的 routed provider 必须返回合法 v2 Capsule，否则在该边界明确失败，不会把旧字段留给 launcher 猜测。

评分覆盖关键约束、目标与状态、决策与失败尝试、已完成与待办、工作区证据和正确下一步。规则见[连续性 benchmark](docs/benchmarks/continuity-benchmark.md)。
仓库还提供不会启动 Agent 的 36-run plan，以及可断点续跑且不覆盖 initial result 的 raw-output collector，固定记录 target model、settings、原始回复与所有 input token 类别。
Benchmark v2 会把目标 CLI 的完整调用 input、经校准的固定 harness 开销和 AgentCarry 可控 payload 分开记录；40% 门槛只比较 AgentCarry payload 与 visible-transcript payload。已发布的 Phase 0 v1 报告及其原始指标保持冻结，不会回写。

### Benchmark v2 token 口径

第二轮 36 个 target session 开始前，collector 会用相同模型、provider route、设置、system prompt、固定 wrapper 和稳定空工作目录执行一次空 payload 校准，并以 `calibration.json` 保存；plan 同时固定校准 prompt 的 hash 与字节数，wrapper 改变后不能混合续跑。每个结果按以下方式复算：

```text
fullCallInput = input_tokens + cache_creation_input_tokens + cache_read_input_tokens
fixedOverhead = calibration.fullCallInput
agentCarryPayload = fullCallInput - fixedOverhead
payloadRatio = agentCarryPayload / visibleTranscriptPayloadBaseline
```

Scorer 会拒绝缺失、负数或算术关系不一致的计量；聚合报告分别展示完整调用、固定开销、payload 和 payload ratio。完整方法与 v1 冻结边界见[连续性 benchmark](docs/benchmarks/continuity-benchmark.md)，机器契约见 [`continuation-assessment.v2.schema.json`](benchmark/schema/continuation-assessment.v2.schema.json)。

## 隐私与安全

- 默认仅在本地处理；
- AgentCarry 零遥测、零 transcript 上传、零崩溃上传；
- 高置信秘密在渲染或启动目标 Agent 前脱敏；
- Capsule 默认临时存在，只有显式 `--output` 或 `--keep-capsule` 才保留；
- 源 session 只读；
- 目标 Agent 的权限、模型、Skill、MCP 和认证仍由用户与目标 Agent 管理。

详见 [SECURITY.md](SECURITY.md) 与 [PRIVACY.md](PRIVACY.md)。

## 开源范围

CLI、官方 adapter、Capsule schema、benchmark fixture/scorer/results、lineage 格式和仓库 Skill 全部采用 Apache-2.0 开源，不保留未来闭源的核心模块。
