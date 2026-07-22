# AgentCarry

Continue an existing coding task in another agent—with evidence and explicit loss.

AgentCarry is a local-first, open-source CLI for carrying work from an existing
Codex, Claude Code, OpenCode, Gemini CLI, or Pi session into a new session in
another coding agent.

It does not pretend that proprietary sessions are interchangeable. AgentCarry
builds a neutral **Work Capsule** containing the current objective, constraints,
decisions, completed work, pending work, workspace facts, validations, and
references to the original evidence. Before launch, it prints a **loss receipt**
for state that cannot be transferred.

> Status: design and benchmark phase. The first vertical slice is
> Codex → Claude Code with `--dry-run`.

[简体中文](README.zh-CN.md)

## Why AgentCarry

Coding-agent users already switch tools because of model quality, price,
limits, and specialized capabilities. Today, the usual handoff is to paste a
long transcript and hope the next agent understands it.

AgentCarry focuses on one job:

```text
existing local session
        ↓
evidence-backed Work Capsule
        ↓
loss receipt + workspace freshness
        ↓
new session in another coding agent
```

The intended command is deliberately small:

```powershell
agentcarry continue --to claude
agentcarry continue --to claude --dry-run
agentcarry continue --to claude --active --checkpoint-stdin --dry-run --json
agentcarry inspect --session <id> --json
agentcarry doctor --json
```

AgentCarry never installs coding agents, manages provider credentials, changes
permissions, mutates the source session, or silently uploads transcripts.

## Product wedge

Adjacent tools already cover transcript search, raw transcript injection,
real-time agent messaging, and ACP orchestration. AgentCarry is narrower:

- retroactive: it starts from sessions that already exist on the local machine;
- evidence-backed: capsule facts point to source events or current workspace facts;
- fail-closed: uncertain critical state stops a handoff unless explicitly forced;
- honest: unsupported state is listed in a loss receipt;
- measurable: continuation quality is compared with a visible-transcript baseline;
- portable: adapters cover Windows, macOS, and Linux without changing the core verb.

See [Product boundary](docs/decisions/0001-product-boundary.md) and
[Competitive landscape](docs/competitive-landscape.md).
Current adapter evidence is tracked in the [compatibility matrix](docs/compatibility.md).

## Roadmap

- **Phase 0:** twelve controlled continuity fixtures, a public scorer, and a
  [published first report](benchmark/runs/2026-07-21-cc-switch-gpt-5.6-sol/final/REPORT.md)
  whose capsule modes honestly fail the next-action and token-ratio gates.
- **v0.1:** Codex → Claude Code, including dry-run, secret redaction, and loss receipt.
- **v0.2:** Claude Code → OpenCode.
- **v0.3:** bidirectional Codex, Claude Code, and OpenCode adapters.
- **v0.4:** Pi and Gemini CLI.
- **v0.5:** repository Skill and cross-history discovery.
- **v0.6:** optional ACP runtime for sessions created through AgentCarry.

Full scope and release gates: [Roadmap](docs/roadmap.md).

The stable command envelope and exit codes are documented in the
[CLI contract](docs/cli-contract.md).

## Try the tracer bullet

With Node.js 22 or newer, npm, and Git:

```text
npm ci
npm run demo:tracer
```

This cross-platform demo runs the real built CLI against a temporary sanitized
Codex session, prints the loss and exact Claude commands, proves that no Claude
process starts, and verifies the source hash is unchanged. See the
[Codex to Claude Code dry-run demo](docs/demos/codex-to-claude-dry-run.md).

## Install the repository Skill

First ask the coding agent that will use the Skill:

```text
Review https://github.com/Jettlin927/agentcarry/tree/main/skills/agentcarry and install the agentcarry Skill into your own user-level Skill directory. Do not install or update AgentCarry or another coding agent, and do not change authentication. Tell me the exact destination and every file you changed.
```

The canonical Skill lives at [`skills/agentcarry/SKILL.md`](skills/agentcarry/SKILL.md).
Manual Codex, Claude Code, OpenCode, Gemini CLI, and Pi paths—and an optional
telemetry-disabled interactive `npx skills add` command—are documented in
[Skill installation](docs/skill-installation.md). AgentCarry itself has no Skill
installer command.

## Work Capsule

The schema is versioned independently from the CLI. Capsule v2 includes:

```text
source, workspace, currentUserMessage, objective, constraints, decisions,
failedAttempts, completed, pending, nextAction, files, commands, validations,
openQuestions, evidenceRefs, losses, lineage
```

Critical facts are never silently truncated. Current workspace and Git facts
win over stale transcript claims and are timestamped. See
[`work-capsule.v2.schema.json`](schema/work-capsule.v2.schema.json). Capsule v1
remains published for historical Phase 0 artifacts.
An active source agent submits one explicit completed checkpoint through stdin
using [`active-checkpoint.v1.schema.json`](schema/active-checkpoint.v1.schema.json).
AgentCarry first verifies a stable native-session prefix and requires the
checkpoint's visible current user message to match the last complete native
message after terminal line-ending normalization. The native message remains
verbatim; partial assistant output and hidden state are never claimed as moved.
Fail-closed behavior is defined in [Loss receipt semantics](docs/loss-semantics.md).

The Claude target prompt is compiled from the canonical Capsule into a compact
continuation brief. It puts the first and forbidden-early actions first, merges
duplicate facts and evidence references, and retains constraints, current state,
failed attempts, workspace and Git facts, relevant files, commands, validations,
and transfer losses. The complete canonical
JSON, Markdown rendering, and loss receipt remain available in dry-run output
for machine use and audit; they are not duplicated into the target prompt.

## Benchmark before claims

AgentCarry will not claim that a capsule preserves continuity merely because it
looks plausible. The Phase 0 benchmark runs twelve controlled tasks in three
handoff modes:

1. visible user and assistant messages only;
2. deterministic Work Capsule;
3. source-assisted Work Capsule.

The benchmark scores critical constraints, objective and state, decisions and
failed attempts, completed and pending work, workspace evidence, and the next
correct action. A dry 36-run plan and resumable raw-output collector keep target
model, settings, response text, and exact input-token categories auditable. See
[Continuity benchmark](docs/benchmarks/continuity-benchmark.md).
Benchmark v2 separates the target CLI's full-call input from its calibrated
fixed harness overhead and gates only the AgentCarry-controlled payload against
the visible-transcript payload. The published Phase 0 v1 report remains frozen
with its original metric and schema.

## Security and privacy

- local-only by default;
- zero AgentCarry telemetry;
- no transcript or crash uploads;
- high-confidence secrets are redacted before rendering or launch;
- capsules are ephemeral unless `--output` or `--keep-capsule` is explicit;
- source sessions are read-only;
- target permissions, model, skills, MCP configuration, and authentication remain
  owned by the target agent and the user.

See [SECURITY.md](SECURITY.md) and [PRIVACY.md](PRIVACY.md).

## Contributing

Agent adapters are the long-term maintenance cost and the main contribution
surface. An adapter must ship with version metadata and sanitized fixtures. See
[CONTRIBUTING.md](CONTRIBUTING.md).

## License

Apache-2.0. The CLI, official adapters, capsule schema, benchmark fixtures,
scorer, results, lineage format, and repository Skill are all intended to remain
open source.
