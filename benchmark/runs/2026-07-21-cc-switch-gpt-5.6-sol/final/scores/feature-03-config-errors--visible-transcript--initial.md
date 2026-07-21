# Continuation score: feature-03-config-errors:visible-transcript:initial

- Fixture: feature-03-config-errors
- Mode: visible-transcript
- Target: claude / gpt-5.6-sol
- Provider route: cc-switch-codex-oauth
- Human reviewer: jettlin927
- Fidelity: 85.00 / 100.00
- Token ratio: 1.0000

| Category | Earned | Weight |
| --- | ---: | ---: |
| criticalConstraints | 30.00 | 30.00 |
| objectiveAndState | 20.00 | 20.00 |
| decisionsAndFailedAttempts | 20.00 | 20.00 |
| completedAndPending | 15.00 | 15.00 |
| workspaceEvidence | 0.00 | 10.00 |
| nextAction | 0.00 | 5.00 |

## Gates

- PASS critical constraints 100%
- FAIL correct next action
- PASS no repeated failed path
- FAIL token ratio at most 40%

## Separate findings

- Critical misses: None
- Repeated failed paths: None
- Unsupported claims: None
