# AgentCarry continuity benchmark: first-36

- Initial runs: 36 / 36
- Target: claude / gpt-5.6-sol
- Provider route: cc-switch-codex-oauth
- Target settings: `{"maxTurns":1,"mcp":"empty-strict","permissionMode":"plan","persistence":"disabled","settingSources":"user","slashCommands":"disabled","systemPromptSha256":"9f380f2bc0f94a9164ac3cd8991044b19fab7e9359a40fa75697481f043f3982","tools":"disabled"}`
- Phase 0: **FAIL**

| Mode | Runs | Mean fidelity | Critical constraints | Correct next action | Repeated runs/items | Unsupported runs/items | Mean token ratio |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| visible-transcript | 12 | 78.13 | 12/12 | 2/12 | 0/0 | 0/0 | 1.0000 |
| deterministic-capsule | 12 | 97.29 | 12/12 | 4/12 | 0/0 | 0/0 | 2.2027 |
| source-assisted-capsule | 12 | 95.21 | 12/12 | 3/12 | 0/0 | 0/0 | 1.8262 |

## Capsule gates

Each comparison must pass fixture by fixture, not only on the aggregate mean.

| Mode | Mean fidelity delta | Every fidelity >= baseline | Critical 100% | Next action | No repeated path | Unsupported delta | Every unsupported <= baseline | Tokens <= 40% | All gates |
| --- | ---: | --- | --- | --- | --- | ---: | --- | --- | --- |
| deterministic-capsule | +19.17 | PASS | PASS | FAIL | PASS | +0 | PASS | FAIL | FAIL |
| source-assisted-capsule | +17.08 | PASS | PASS | FAIL | PASS | +0 | PASS | FAIL | FAIL |

## Reruns and disputes

None.
