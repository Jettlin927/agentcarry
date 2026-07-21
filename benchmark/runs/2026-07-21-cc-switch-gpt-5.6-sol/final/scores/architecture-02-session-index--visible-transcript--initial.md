# Continuation score: architecture-02-session-index:visible-transcript:initial

- Fixture: architecture-02-session-index
- Mode: visible-transcript
- Target: claude / gpt-5.6-sol
- Provider route: cc-switch-codex-oauth
- Human reviewer: jettlin927
- Fidelity: 67.50 / 100.00
- Token ratio: 1.0000

| Category | Earned | Weight |
| --- | ---: | ---: |
| criticalConstraints | 30.00 | 30.00 |
| objectiveAndState | 10.00 | 20.00 |
| decisionsAndFailedAttempts | 15.00 | 20.00 |
| completedAndPending | 7.50 | 15.00 |
| workspaceEvidence | 5.00 | 10.00 |
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
