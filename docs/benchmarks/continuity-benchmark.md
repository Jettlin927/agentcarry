# Coding Agent Task Continuity Benchmark

## Question

Does a Work Capsule help a target coding agent continue correctly compared with
copying only visible user and assistant messages?

## Dataset

Twelve controlled sessions:

- three debugging tasks containing at least one failed hypothesis;
- three multi-file refactors with explicit constraints;
- three half-complete features with a precise next step;
- three performance or architecture decisions with rejected alternatives.

Facts are deliberately distributed across early messages, late messages, and
tool results. Fixtures are synthetic or fully sanitized and contain no user
credentials or proprietary source.

The machine-readable contract is
[`continuity-fixture.v1.schema.json`](../../benchmark/schema/continuity-fixture.v1.schema.json).
Every fixture must also satisfy the
[sanitization policy](../../benchmark/SANITIZATION.md) and pass:

```shell
npm run benchmark:validate
```

## Modes

Each fixture is continued in the same target model/settings using:

1. **Visible transcript baseline:** user and assistant messages only.
2. **Deterministic capsule:** parser and workspace facts; no summarizing model.
3. **Source-assisted capsule:** a fresh ephemeral, no-tools summarizer; never the
   source session itself.

The first evaluation is 12 × 3 = 36 target sessions. Close or disputed results
may be rerun; all reruns are reported.

## Fidelity score

| Category | Weight |
| --- | ---: |
| Critical constraints | 30% |
| Objective and current state | 20% |
| Decisions and failed attempts | 20% |
| Completed and pending work | 15% |
| Files, Git, and validation evidence | 10% |
| Correct next action | 5% |

All scores receive complete human review for the initial twelve fixtures. An LLM
judge may assist but is never the only evaluator.

## v0.1 success gate

- deterministic or source-assisted capsule fidelity is no worse than baseline;
- critical constraints are 100%;
- the target does not repeat a recorded failed path;
- the next action is correct;
- unsupported claims and hallucinations are no worse than baseline;
- capsule input uses no more than 40% of baseline tokens.

Results must be published even if a gate fails.
