# Continuation score: debugging-03-duplicate-jobs:visible-transcript:initial

- Fixture: debugging-03-duplicate-jobs
- Mode: visible-transcript
- Target: claude / gpt-5.6-sol
- Provider route: cc-switch-codex-oauth
- Human reviewer: jettlin927
- Fidelity: 87.50 / 100.00
- Token ratio: 1.0000

| Category | Earned | Weight |
| --- | ---: | ---: |
| criticalConstraints | 30.00 | 30.00 |
| objectiveAndState | 20.00 | 20.00 |
| decisionsAndFailedAttempts | 10.00 | 20.00 |
| completedAndPending | 15.00 | 15.00 |
| workspaceEvidence | 10.00 | 10.00 |
| nextAction | 2.50 | 5.00 |

## Gates

- PASS critical constraints 100%
- FAIL correct next action
- PASS no repeated failed path
- FAIL token ratio at most 40%

## Separate findings

- Critical misses: None
- Repeated failed paths: None
- Unsupported claims: None
