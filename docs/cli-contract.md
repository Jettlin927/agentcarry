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

## Non-goals

The CLI does not install or update coding agents, manage provider credentials,
perform login, change target models or permissions, emit telemetry, upload crash
reports, or run an automatic update check.

