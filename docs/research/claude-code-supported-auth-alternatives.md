# Claude Code 无 claude.ai 登录的官方认证替代方案

> 调研日期：2026-07-21
> 范围：Claude Code CLI 的官方、合规认证路径，以及可帮助配置这些路径的开源工具。本文不提供封禁绕过、伪造凭据、盗用 token 或利用他人账号的方法。

## 结论

没有一种合法的“跳过登录脚本”能够在没有有效上游凭据的情况下获得 Claude 推理权限。网上所谓的解锁、免登录或中转脚本，最多只是把 Claude Code 指向另一个端点；端点背后仍然必须有合法的 Anthropic、AWS、Google Cloud、Azure 或组织网关凭据。

Claude Code 官方支持以下无需 claude.ai 订阅登录的路径：

1. Anthropic Console API key；
2. Amazon Bedrock；
3. Google Cloud's Agent Platform（原 Vertex AI）；
4. Microsoft Foundry；
5. OpenRouter 或组织自建的 LLM gateway，使用网关签发的 credential。

官方认证文档明确列出 Claude API、Bedrock、Vertex、Foundry 和 Claude apps gateway 等认证类型，并说明云厂商路径无需浏览器登录 claude.ai：[Authentication](https://code.claude.com/docs/en/authentication)。

如果账号是误封，官方给出的处理方式是登录被封账号后提交 appeal。帮助中心也明确列出了重复违反使用政策、不受支持地区注册、违反服务条款等可能原因：[Safeguards warnings and appeals](https://support.claude.com/en/articles/8241253-safeguards-warnings-and-appeals)。不应通过新身份、伪造 token 或第三方“解封包”规避这个决定。

## Claude Code 的官方认证优先级

当多种 credential 同时存在时，Claude Code 当前按以下顺序选择：

1. `CLAUDE_CODE_USE_BEDROCK`、`CLAUDE_CODE_USE_VERTEX` 或 `CLAUDE_CODE_USE_FOUNDRY` 指定的云厂商 credential；
2. `ANTHROPIC_AUTH_TOKEN`，作为 bearer token；
3. `ANTHROPIC_API_KEY`，作为 `X-Api-Key`；
4. `apiKeyHelper` 脚本输出；
5. `CLAUDE_CODE_OAUTH_TOKEN`；
6. `/login` 保存的 Claude Pro、Max、Team 或 Enterprise subscription OAuth。

来源：[Authentication precedence](https://code.claude.com/docs/en/authentication#authentication-precedence)。这解释了为什么 OpenRouter 或组织 gateway 能在不使用已保存 claude.ai 登录的情况下工作，也解释了为什么错误遗留的环境变量会导致 401。

## 官方路径对比

| 路径 | 是否需要 claude.ai 登录 | 实际凭据与计费主体 | Claude Code 入口 | 适合 AgentCarry benchmark 吗 |
| --- | --- | --- | --- | --- |
| Anthropic Console | 否 | 有效的 Console API key；按 API token 计费 | `ANTHROPIC_API_KEY` | 最直接，但被停用的组织/key 仍会失败 |
| Amazon Bedrock | 否 | AWS credentials 或 Bedrock API key；AWS 计费 | `CLAUDE_CODE_USE_BEDROCK=1` | 适合；需固定 provider model ID |
| Google Cloud's Agent Platform | 否 | Google ADC/service account；GCP 计费 | `CLAUDE_CODE_USE_VERTEX=1` | 适合；需固定项目、地区和 model ID |
| Microsoft Foundry | 否 | Foundry API key、Entra ID 或 bearer token；Azure 计费 | `CLAUDE_CODE_USE_FOUNDRY=1` | 适合；需固定 deployment name |
| OpenRouter 直连 | 否 | OpenRouter API key 与 credits；OpenRouter 计费 | `ANTHROPIC_BASE_URL` 加 `ANTHROPIC_AUTH_TOKEN` | 有条件适合；必须固定 Claude 模型及 Anthropic 1P provider |
| LLM gateway | 否，前提是网关签发独立 credential | 网关 credential；真正计费由网关上游承担 | `ANTHROPIC_BASE_URL` 加 credential | 只在上游确实是 Claude 且配置可审计时适合 |

这些都是独立的、有效的认证机制，不是把已封禁的 claude.ai OAuth token 重新包装后继续使用。每个云厂商仍会执行自己的开户、地区、IAM、模型授权与使用政策。

## 1. Anthropic Console API key

Claude Code 的认证优先级中，`ANTHROPIC_API_KEY` 位于已保存的订阅 OAuth 登录之前，并通过 `X-Api-Key` header 发送。非交互模式 `claude -p` 会直接使用该 key；交互模式第一次使用时会要求确认。详见官方 [Authentication precedence](https://code.claude.com/docs/en/authentication#authentication-precedence)。

PowerShell 临时配置：

```powershell
$env:ANTHROPIC_API_KEY = "<valid-console-api-key>"
claude -p "Reply with exactly OK"
```

这要求 key 所属的 Console organization 仍然有效并有余额。官方文档也提醒：属于已禁用或过期组织的 key 会认证失败。不要把 key 写入仓库或 GitHub Issue。

## 2. Amazon Bedrock

Claude Code 可以直接使用 AWS 的默认 credential chain、AWS profile、access key/secret、AWS SSO，或 Amazon Bedrock API key。CLI 登录界面可选择 `3rd-party platform` → `Amazon Bedrock`，也可运行 `/setup-bedrock`；这不是 claude.ai 登录。完整前置条件与认证方式见 [Claude Code on Amazon Bedrock](https://code.claude.com/docs/en/amazon-bedrock)。

PowerShell 最小形态：

```powershell
$env:CLAUDE_CODE_USE_BEDROCK = "1"
$env:AWS_PROFILE = "<aws-profile>"
$env:AWS_REGION = "<bedrock-region>"
$env:ANTHROPIC_MODEL = "<exact-bedrock-model-or-inference-profile-id>"
claude -p "Reply with exactly OK"
```

也可以按官方文档设置 `AWS_BEARER_TOKEN_BEDROCK` 使用 Bedrock API key。AWS 账号必须先获准调用所选 Claude 模型。

## 3. Google Cloud's Agent Platform（原 Vertex AI）

Claude Code 使用 Google Cloud 标准 Application Default Credentials，可来自 `gcloud`、service account 或 workload identity。交互入口是 `3rd-party platform` → `Google Vertex AI`，也可运行 `/setup-vertex`。官方配置要求包括 `CLAUDE_CODE_USE_VERTEX`、项目与地区；见 [Claude Code on Google Cloud's Agent Platform](https://code.claude.com/docs/en/google-vertex-ai)。

PowerShell 最小形态：

```powershell
gcloud auth application-default login
$env:CLAUDE_CODE_USE_VERTEX = "1"
$env:CLOUD_ML_REGION = "<region-or-global>"
$env:ANTHROPIC_VERTEX_PROJECT_ID = "<gcp-project-id>"
$env:ANTHROPIC_MODEL = "<exact-vertex-model-id>"
claude -p "Reply with exactly OK"
```

项目必须启用相应 API、获得 Claude 模型访问权并具有配额。模型并非在每个地区都可用。

## 4. Microsoft Foundry

Claude Code 官方支持 Foundry API key、Microsoft Entra ID default credential chain，以及 Entra 签发的 bearer token。Foundry 没有 Claude Code 内置的交互式 setup wizard，必须通过环境变量配置；见 [Claude Code on Microsoft Foundry](https://code.claude.com/docs/en/microsoft-foundry)。

PowerShell 最小形态：

```powershell
$env:CLAUDE_CODE_USE_FOUNDRY = "1"
$env:ANTHROPIC_FOUNDRY_RESOURCE = "<azure-resource-name>"
$env:ANTHROPIC_FOUNDRY_API_KEY = "<foundry-api-key>"
$env:ANTHROPIC_MODEL = "<exact-deployment-name>"
claude -p "Reply with exactly OK"
```

若使用 Entra ID，可不设置 API key 和 bearer token，先用 `az login` 建立 Azure SDK 可读取的凭据。Azure 订阅必须能创建 Claude resource 和对应模型 deployment。

## 5. OpenRouter 直连

OpenRouter 官方提供 Claude Code integration，无需本地代理脚本：Claude Code 直接以 Anthropic Messages protocol 请求 OpenRouter 的 Anthropic-compatible endpoint。它需要用户自己的 OpenRouter API key，并从 OpenRouter credits 计费；因此这是另一套合法 credential，不是无凭据访问。

PowerShell 临时配置：

```powershell
$env:OPENROUTER_API_KEY = "<valid-openrouter-api-key>"
$env:ANTHROPIC_BASE_URL = "https://openrouter.ai/api"
$env:ANTHROPIC_AUTH_TOKEN = $env:OPENROUTER_API_KEY
$env:ANTHROPIC_API_KEY = ""
claude -p "Reply with exactly OK"
```

OpenRouter 自己的文档强调，Claude Code 只保证与 Anthropic first-party provider 兼容，并建议把 Anthropic 1P 设为最高优先级；Claude Code 对非 Anthropic 模型可能不能正确工作。详见 [OpenRouter: Claude Code integration](https://openrouter.ai/docs/guides/coding-agents/claude-code-integration)。

对 AgentCarry benchmark，这条路径只有在以下条件都满足时才合格：

- 使用具体的 Claude model ID，不使用 `latest`、`auto` 或会漂移的 router alias；
- provider 固定到 Anthropic 1P，不启用跨 provider failover；
- 结果中记录 `provider=openrouter`、OpenRouter model ID 和实际 upstream provider；
- 先确认 OpenRouter 与上游的使用条款允许当前用户和用途。

否则 benchmark 会把模型漂移、provider failover 或协议转换差异混入“任务连续性”得分。即便技术上可连通，如果账号封禁代表适用于用户本人的执行决定，也不应以 OpenRouter 规避；应先走 appeal 或得到适用平台的明确授权。

## 6. LLM gateway 与 `ANTHROPIC_BASE_URL`

官方允许 Claude Code 连接组织运行的 LLM gateway。最重要的限制是：

- `ANTHROPIC_BASE_URL` 只改变请求地址，**不会单独替换登录凭据**；
- 网关必须另行签发 `ANTHROPIC_AUTH_TOKEN`、`ANTHROPIC_API_KEY`，或由 `apiKeyHelper` 返回 credential；
- credential 生效后，网关而非个人 claude.ai 登录负责认证，费用由网关实际连接的上游账号承担；
- Anthropic 明确表示不背书、维护或审计第三方 gateway，也不支持通过 gateway 把 Claude Code 路由到非 Claude 模型。

证据见官方 [Other LLM gateways](https://code.claude.com/docs/en/llm-gateway) 与 [Connect Claude Code to an LLM gateway](https://code.claude.com/docs/en/llm-gateway-connect)。

PowerShell 临时配置：

```powershell
$env:ANTHROPIC_BASE_URL = "https://<trusted-gateway>"
$env:ANTHROPIC_AUTH_TOKEN = "<gateway-issued-bearer-token>"
claude -p "Reply with exactly OK"
```

若网关要求 `x-api-key`，改用 `ANTHROPIC_API_KEY`。`apiKeyHelper` 适合从企业 vault 获取动态或轮换 credential；它不是生成免费凭据的脚本。

### `CLAUDE_CODE_SKIP_*_AUTH=1` 不是免认证

`CLAUDE_CODE_SKIP_BEDROCK_AUTH`、`CLAUDE_CODE_SKIP_VERTEX_AUTH` 和 `CLAUDE_CODE_SKIP_FOUNDRY_AUTH` 的语义是：本机不要再用云厂商凭据签名，因为可信网关会在上游侧完成认证或注入 header。网关仍须持有合法凭据。只设置这些变量而没有可用网关，不会获得模型访问权。官方的 provider-specific gateway 示例见 [Connect Claude Code to an LLM gateway](https://code.claude.com/docs/en/llm-gateway-connect#route-to-a-cloud-provider-through-a-gateway)。

## 开源工具：有，但都不是封禁绕过器

### Claude Code Router

[musistudio/claude-code-router](https://github.com/musistudio/claude-code-router) 是活跃的开源本地 gateway/control plane，可帮助在 Windows、macOS 和 Linux 配置 provider、合法 API key、模型与路由。它能降低手工设置 `BASE_URL` 和模型映射的成本，但不会提供上游授权；用户仍需为所选 provider 提供有效凭据。

对 AgentCarry 当前的连续性 benchmark，不建议把“Claude Code Router + 非 Claude 模型”当作解除 #19 的方式：这会把被测模型从 Claude 换掉，使结果无法再回答“Claude Code 能否承接任务”。如果 CCR 只代理一个可审计的、合法 Claude 上游，才可以作为工程上的 gateway 选择，并应在报告中记录它。

### CC Switch：可用于兼容性实验，但必须改写实验结论

[CC Switch](https://github.com/farion1231/cc-switch/blob/main/docs/user-manual/en/2-providers/2.1-add.md) 可以通过 Local Routing 把 Claude Code 的请求转发到用户已经配置的 provider。2026-07-21 的本机 smoke test 使用 `Claude Code -> CC Switch local routing -> ChatGPT Codex OAuth -> gpt-5.6-sol` 返回成功；这解除的是 collector 的工程阻塞，不是 Anthropic 账号封禁，也不是原生 Claude 模型认证。

因此这条链路只适合作为“Claude Code CLI 外壳承接 AgentCarry handoff”的公开兼容性实验。报告必须同时写明 CC Switch、Codex OAuth 和实际 upstream model，不能简称为 Claude benchmark，也不能与原生 Anthropic、Bedrock、Vertex 或 Foundry 的 Claude 结果混合聚合。

### LiteLLM

[BerriAI/litellm](https://github.com/BerriAI/litellm) 是另一种开源 gateway。它同样只能代理用户已有的合法上游凭据。Anthropic 不对第三方 gateway 的安全性或兼容性负责。

此外，LiteLLM 官方仓库在 2026 年 3 月记录过 PyPI 供应链入侵，恶意版本 `1.82.7` 和 `1.82.8` 会窃取凭据；维护团队表示已删除受影响版本并轮换账号。见其仓库置顶事件记录 [BerriAI/litellm#24518](https://github.com/BerriAI/litellm/issues/24518)。因此本项目不应为了快速解除 benchmark blocker 而临时安装 LiteLLM。若未来确需采用，应单独进行依赖、制品签名、固定版本和 credential 隔离审查。

## 对 AgentCarry 的推荐决策

1. **不要搜索或接入“解封/免登录”脚本。** 这既不能形成可复现的开源 benchmark，也会把源码、会话和凭据交给不可审计的第三方。
2. 若当前已有合法、可用的 Anthropic Console key，优先用 `ANTHROPIC_API_KEY`，因为变量最少且与现有 collector 兼容。
3. 若没有有效 Console key，但已有合规的云账号和 Claude 模型访问权，优先选择用户最熟悉的云平台。Bedrock 和 Vertex 有 Claude Code setup wizard；Foundry 需要环境变量。
4. OpenRouter 是无需本地脚本的可行 gateway 备选，但 benchmark 必须固定 Claude model 与 Anthropic 1P provider；不能用 OpenRouter 的非 Claude 模型解除 #19。
5. collector 不需要管理或安装这些凭据。它只应继承运行环境，并把 `provider`、完整 model/deployment ID 和固定设置记录到结果中。
6. 使用 OpenRouter、Bedrock、Vertex 或 Foundry 重新跑 Phase 0 时，仍需固定一个具体 Claude 模型，先执行一次无工具、单轮 smoke test，再开始 36-run collection。
7. 若封禁可能是误判，先走官方 appeal。若封禁与地区或政策不合规有关，不应把云厂商或 gateway 当成规避手段；只有在相应平台明确授予模型访问权且使用符合其条款时才继续。

## 验收标准

新的认证路径只有同时满足以下条件，才能解除 AgentCarry #19：

- `/status` 显示预期的 API provider 与 credential source；
- 无工具、无持久化、单轮 `claude -p` smoke test 返回成功，不再是 401；
- 使用完整 model/deployment ID，而不是会漂移的 alias；
- 没有把 secret 写入仓库、日志、Issue 或 benchmark fixture；
- benchmark 报告明确记录 provider，以免把不同部署路径的结果混为一谈。
