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
- Node.js、AgentCarry commit、Codex、Claude Code 版本；
- 来源是 idle/active，选择是 automatic/explicit；
- 结果是 continued 或 blocked；
- 从输入命令到结果的秒数；成功时还要记录 Time to Continuation；
- loss code；
- 是否需要 Manual Supplement，以及补充信息所属类别；
- 失败时的稳定 blocker code 和一句脱敏摘要。

禁止提交密钥、provider 原始输出、邮箱、截图、完整消息、聊天摘录、session 文件或本地
路径。Manual Supplement 只记录“缺了哪一类信息”，不能复述私密内容。

## 提交记录

请使用同一个 GitHub 账号打开仓库的 **External handoff acceptance / 外部用户真实交接验收**
Issue 表单。维护者复核参与资格，再把记录按
[`external-handoff-record.v1.schema.json`](../schema/external-handoff-record.v1.schema.json)
整理到 `acceptance/runs/`；该 Issue URL 就是公开审计证据。

维护者执行：

```text
npm run acceptance:validate
npm run acceptance:report -- --output acceptance/REPORT.md
npm run acceptance:report -- --require-complete
```

在至少 10 位不同参与者且覆盖两个平台之前，最后一条命令必定失败。最终报告公开真实
续作率、Time to Continuation、Manual Supplement 频率、常见 loss code 和 blocker
统计。重复失败模式必须转成后续 Issue，不能从 cohort 中删除。
