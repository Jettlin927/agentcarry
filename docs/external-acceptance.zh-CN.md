# 外部用户真实 handoff 验收

AgentCarry v0.1 至少需要 10 位没有参与过仓库开发的人，各自完成一次真实的
Codex → Claude Code handoff；参与者必须同时覆盖 Windows 与 macOS。失败记录同样
有价值，也必须进入分母。验收要求的是 10 份完整、可审计记录，不是伪造 100% 成功率。

[English](external-acceptance.md)

## 谁可以参与

参与者在本次尝试前不能为 AgentCarry 提交过 commit 或 PR。请使用自己的 GitHub
账号提交结果；公开 GitHub 用户名是唯一保留的参与者标识。

本机需要 Node.js 22 或更高版本，以及已经安装、配置完成的 Codex 和 Claude Code。
AgentCarry 不安装这些 Agent、不发起登录、不选择 provider，也不修改认证。

## 两分钟终端路径

直接从公开仓库安装固定的验收版本：

```text
npm install --global github:Jettlin927/agentcarry#v0.1.0-acceptance.1
```

进入一个确实存在已完成 Codex 任务的代码仓库：

```text
agentcarry doctor
agentcarry continue --to claude
```

输入 `continue` 命令时开始计时。阅读终端展示的来源 session、第一动作、损失收据和
两条目标步骤，并亲自完成唯一一次确认。只有 Claude 已开始 Capsule 记录的第一动作时
才停止计时；仅仅打开 session 或回复 ACK 不算 Continuation。

如果自动选择来源时出现歧义，只允许使用终端展示的已完成 session ID 重试一次：

```text
agentcarry continue --to claude --session <id>
```

除非你理解并明确接受每一项 critical loss，否则不要使用 `--force`。不要为了让验收
通过而更改 Agent 安装、登录、模型、provider 或权限。

## 记录哪些信息

只记录：

- Windows 或 macOS 版本与架构；
- `agentcarry --version` 结果，以及 Node.js、Codex、Claude Code 版本；
- 来源是 idle/active，选择是 automatic/explicit；
- 是否创建目标 session、是否开始记录中的第一动作，以及 continued/blocked 结果；
- 精确到秒的 UTC 命令开始时间与结果时间；
- 从输入命令到结果的秒数；成功时还要记录 Time to Continuation；
- loss code；
- 是否需要 Manual Supplement，以及补充信息所属类别；
- 失败时的稳定 blocker code 和阶段。

禁止提交密钥、provider 原始输出、邮箱、截图、完整消息、聊天摘录、session 文件或本地
路径。Manual Supplement 只记录“缺了哪一类信息”，不能复述私密内容。Issue 表单只提供
枚举的 category/code，不收集 supplement 或 blocker 的自由文本描述。

## 提交记录

请使用同一个 GitHub 账号打开仓库的 **External handoff acceptance / 外部用户真实交接验收**
Issue 表单。维护者必须确认 Issue 作者与参与者账号一致、检查其在尝试发生时没有 AgentCarry
仓库作者历史，并完成隐私复核；随后把审核人、审核时间和三项检查结果写入 `review`，把固定
验收 tag 解析为 40 位 commit，再按
[`external-handoff-record.v1.schema.json`](../schema/external-handoff-record.v1.schema.json)
整理到 `acceptance/runs/`；该 Issue URL 就是公开审计证据。blocked 记录还必须链接一个独立的
后续失败 Issue，不能只把 blocker code 留在验收表单中。这些检查都是 record 必填字段，
未经复核的提交不能通过 cohort gate。validator 刻意不让 CI 依赖 GitHub API；审计者可以
逐条打开证据链接复核。
本次 v0.1 cohort 的 schema 只接受仓库 owner `Jettlin927` 作为 `reviewedBy`。完成命令验证
这份维护者声明与公开链接，但不声称对底层事实提供密码学证明或 GitHub 实时 API 证明。

维护者执行：

```text
npm run acceptance:validate
npm run acceptance:report -- --output acceptance/REPORT.md
npm run acceptance:check-report
npm run acceptance:report -- --require-complete
```

提交的 REPORT 与已复核 records 不一致时，报告检查会失败。在至少 10 位不同、已复核
参与者且覆盖两个平台之前，最后一条命令必定失败。最终报告公开真实续作率、Time to
Continuation、Manual Supplement 频率、常见 loss code 和 blocker 统计。
