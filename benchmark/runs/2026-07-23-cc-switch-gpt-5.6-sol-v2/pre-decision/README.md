# Benchmark v2 second-36 — paused, not final

This directory is an auditable partial run, not a benchmark result or product
claim.

## Fixed target

- Claude Code: `2.1.158`
- target model: `gpt-5.6-sol`
- provider route: `cc-switch-codex-oauth`
- setting sources: `user`
- plan: 12 fixtures × 3 modes = 36 initial target continuations
- token method: `target-calibration-delta-v1`

No credential value is serialized. AgentCarry did not install or authenticate
the target agent.

## Current evidence

- valid target results: 2 / 36
- valid inputs: visible transcript and deterministic capsule for
  `architecture-01-streaming-log`
- rejected pre-target artifact: 1 source-assisted capsule under `rejected/`
- human review and aggregate report: not started

The rejected artifact is retained only as root-cause evidence. A routed
provider ignored Claude Code's `--json-schema` metadata and returned a
historical v1-shaped capsule. It is not a target result and must never enter the
36-run aggregate. The fail-closed boundary fix was completed in
[Issue #47](https://github.com/Jettlin927/agentcarry/issues/47) and
[PR #48](https://github.com/Jettlin927/agentcarry/pull/48).

## Why collection paused

The first real comparable pair measured:

| Mode | Full-call input | Fixed overhead | AgentCarry payload |
| --- | ---: | ---: | ---: |
| visible-transcript | 1443 | 1349 | 94 |
| deterministic-capsule | 1837 | 1349 | 488 |

The current release gate requires capsule payload to be no more than 40% of the
visible-transcript payload. This fixture permits at most 37.6 tokens, while its
eight required ground-truth facts include tool and workspace information absent
from the visible transcript. The measured ratio is 519.1%.

Collection stopped before the remaining calls to avoid spending on a gate that
this pair already fails fixture by fixture. The metric decision and recommended
non-gaming correction are tracked in
[Issue #49](https://github.com/Jettlin927/agentcarry/issues/49). The benchmark
execution issue remains [#42](https://github.com/Jettlin927/agentcarry/issues/42).

Do not present this directory as a completed benchmark. Resume only after the
release gate is decided, then regenerate the rejected source-assisted input and
continue with the existing exclusive-write collector.
