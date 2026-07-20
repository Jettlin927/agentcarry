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
session. Unknown-activity, empty, subagent, automation, other-workspace, or
ambiguous sessions fail closed.

For the current active task, the repository Skill starts:

```text
agentcarry continue --to claude --active --checkpoint-stdin --dry-run --json
```

After `CHECKPOINT_STDIN_READY`, it sends one schema-valid UTF-8 JSON line through
the execution tool's stdin. AgentCarry has already frozen and verified the
native byte prefix at that point. Checkpoint content is not included in process
arguments or a temporary file.

The initial Windows verification used a real idle Codex session: 213 canonical
events produced 215 evidence references, three explicit losses, and two Claude
target steps. The source JSONL SHA-256 matched before and after. No real
transcript content or session identifier is stored in this repository.

The active Windows verification used the real current Codex Desktop task from a
nested repository directory. It found the last activity marker beyond the
initial 256 KiB tail, reached the stdin readiness handshake, accepted the
visible current message despite a native terminal newline, prepared the Claude
dry-run, and exited 0. No transcript content or session identifier from that
verification is committed.
