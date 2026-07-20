# Codex to Claude Code dry-run

This tracer proves the first AgentCarry vertical slice without opening Claude
Code or modifying a source session.

## Reproducible two-minute demo

Prerequisites: Node.js 22 or newer, npm, and Git. Claude Code does not need to be
installed because dry-run preparation never starts it.

```text
npm ci
npm run demo:tracer
```

The demo creates one sanitized, completed Codex session in a temporary Codex
home, records its SHA-256, and runs the built public CLI from the repository
root:

```text
agentcarry continue --to claude --dry-run --json
```

It passes only when AgentCarry:

- automatically selects the session whose `cwd` is the current workspace;
- reads visible messages and tool evidence;
- collects current workspace and Git facts;
- builds a schema-valid capsule and loss receipt;
- renders the exact Claude seed and resume commands;
- starts no Claude process; and
- leaves the source JSONL byte-for-byte unchanged.

The temporary directory is removed after the check. The same command works in
PowerShell, cmd, Bash, and zsh through npm.

## Real local session

From a repository with at least one completed Codex main session, build and run:

```text
npm run build
node dist/cli-main.js continue --to claude --dry-run --json
```

Use `--session <id>` only when deliberately selecting a different completed
session. Active, unknown-activity, empty, subagent, automation, other-workspace,
or ambiguous sessions fail closed.

The initial Windows verification used a real idle Codex session: 213 canonical
events produced 215 evidence references, three explicit losses, and two Claude
target steps. The source JSONL SHA-256 matched before and after. No real
transcript content or session identifier is stored in this repository.
