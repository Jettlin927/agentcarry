# AgentCarry

把一个 Coding Agent 中已经进行到一半的任务，带着证据和明确的损失说明，交给另一个 Agent 继续。

AgentCarry 是本地优先、完全开源的 CLI。它面向频繁使用 Codex、Claude Code、OpenCode、Gemini CLI、Pi 等产品的开发者，解决的不是“导出聊天记录”，而是“换 Agent 后继续当前工作”。

> 当前状态：产品定义与 benchmark 阶段。第一个纵向切片是
> `Codex → Claude Code --dry-run`。

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
agentcarry inspect --session <id> --json
agentcarry doctor --json
```

AgentCarry 不安装 Agent、不管理认证、不替用户切换模型或权限、不修改源 session，也不会默认上传 transcript。

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

- **Phase 0：** 12 个受控连续性 fixture、scorer 和公开结果。
- **v0.1：** Codex → Claude Code，包含 dry-run、脱敏和损失收据。
- **v0.2：** Claude Code → OpenCode。
- **v0.3：** Codex、Claude Code、OpenCode 双向适配。
- **v0.4：** Pi 与 Gemini CLI。
- **v0.5：** 仓库 Skill 与跨历史发现。
- **v0.6：** 对 AgentCarry 创建的会话加入可选 ACP runtime。

版本门槛见[路线图](docs/roadmap.md)。

稳定 JSON envelope、退出码与 dry-run 不启动保证见 [CLI 契约](docs/cli-contract.md)。

## Work Capsule

Work Capsule 不是另一种完整 transcript 格式。它只携带续作必需的状态：当前用户消息、目标、约束、决策、失败路径、已完成、待办、文件与 Git 状态、执行过的命令、验证结果、开放问题、证据引用、损失和 lineage。

关键事实不会被静默截断。工作区当前事实优先于 transcript 中的旧描述，并带采集时间。Schema 见 [`work-capsule.v1.schema.json`](schema/work-capsule.v1.schema.json)。

## 先评测，再宣传

Phase 0 使用 12 个受控任务，对每个任务比较三种交接：

1. 只复制可见的用户消息和 Agent 回复；
2. 确定性 Work Capsule；
3. source-assisted Work Capsule。

评分覆盖关键约束、目标与状态、决策与失败尝试、已完成与待办、工作区证据和正确下一步。规则见[连续性 benchmark](docs/benchmarks/continuity-benchmark.md)。

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
