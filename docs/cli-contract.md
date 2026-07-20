# CLI contract

AgentCarry 0.x keeps three public commands:

```text
agentcarry inspect
agentcarry continue --to <agent>
agentcarry doctor
```

Adapter and benchmark implementation details are not public commands.

## Machine mode

`--json` writes exactly one JSON document to stdout. Human diagnostics go to
stderr and never prefix or suffix the JSON document.

```json
{
  "schemaVersion": "1.0.0",
  "command": "doctor",
  "ok": true,
  "data": {}
}
```

Failures add stable `exitCode`, `code`, and `message` fields. The JSON envelope
version is independent from the Work Capsule schema version.

## Exit codes

| Code | Meaning |
| ---: | --- |
| 0 | Success |
| 1 | Unexpected internal failure |
| 2 | Invalid command or arguments |
| 3 | Source session unavailable, ambiguous, unsupported, or unreadable |
| 4 | Critical transfer loss; handoff stopped unless explicitly forced |
| 5 | Target agent unavailable or launch failed |

## Dry-run invariant

`continue --dry-run` may read the selected source and current workspace, build a
capsule, and render the loss receipt and proposed target command. It must not
invoke the Target Launcher.

Internally, preparation and launch are separate seams. The CLI returns after
`prepareContinue` during dry-run and therefore cannot rely on an adapter to
remember not to launch.

## Active checkpoint invariant

`continue --active --checkpoint-stdin` is an inseparable flag pair. It selects
only a confirmed active main session and never falls back to idle history. The
Reader captures and verifies a fixed native byte prefix before stderr emits
`CHECKPOINT_STDIN_READY`. The caller then sends exactly one UTF-8 JSON line on
stdin conforming to `schema/active-checkpoint.v1.schema.json`.

Checkpoint content is never a command-line argument. The supplied
`currentUserMessage` must match the last complete native user message after only
CRLF/LF and one terminal newline are normalized for comparison. The native
message itself remains verbatim in the Capsule.
Partial assistant output, hidden reasoning, and native tool state remain loss;
they are not reconstructed from the checkpoint.

AgentCarry does not write the source file. A still-running vendor may append its
own invocation events, but cannot alter the already verified snapshot prefix
without making capture fail.

## Doctor compatibility

`doctor` reports Node.js, AgentCarry, Codex CLI, Claude Code CLI, the Codex
Reader, the Claude Launcher, Codex session storage, and prospective lineage
storage. Compatibility has four stable values:

- `supported`: the exact upstream version or storage shape is covered by local
  verification;
- `degraded`: the component exists, but its version or shape is not covered;
- `unsupported`: a required executable or storage permission is missing;
- `unknown`: there is not enough evidence to classify it.

`reported-authenticated` is only the target CLI's local self-report. It is not
evidence that a live provider request will succeed. For a lineage path that does
not exist yet, doctor checks the nearest existing parent directory and creates
nothing.

## Non-goals

The CLI does not install or update coding agents, manage provider credentials,
perform login, change target models or permissions, emit telemetry, upload crash
reports, or run an automatic update check.

