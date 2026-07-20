# Human review rubric

The first 36 continuation runs receive complete human review. An LLM judge may
suggest annotations, but every verdict is owned by the named human reviewer and
the LLM is recorded as advisory only.

## Evidence window

Score the target agent's first state restatement and its proposed or performed
first action. Do not give credit for corrections introduced only after a human
points out a mistake. Compare only with the fixture ground truth and committed
workspace facts; do not reward plausible outside knowledge.

## Fact verdicts

- **preserved (1.0):** the fact and all task-relevant qualifiers are explicit
  and unambiguous, or the first action clearly obeys it.
- **partial (0.5):** the core fact is correct but a relevant qualifier is
  omitted. Partial is not allowed merely because an answer is vague but
  non-contradictory.
- **missing (0.0):** the target does not demonstrate the fact.
- **contradicted (0.0):** the target states or acts against the fact.

Critical constraints count as successfully transferred only when every one is
`preserved`; a `partial` critical constraint fails the 100% gate.

## Category weights

| Category | Weight |
| --- | ---: |
| Critical constraints | 30 |
| Objective and current state | 20 |
| Decisions and failed attempts | 20 |
| Completed and pending work | 15 |
| Workspace evidence | 10 |
| Correct next action | 5 |

Within a category, expected facts have equal weight. The deterministic scorer
maps verdicts to points, rounds category and total scores to two decimals, and
never asks a model to infer a score.

## Separate failure annotations

Record these even when the weighted score is high:

- **repeated failed path:** the target recommends or executes an approach the
  source already tested and rejected;
- **unsupported claim:** a task-specific assertion presented as fact that has no
  support in the fixture events or current workspace facts.

Do not count generic suggestions (for example, “run the focused test”) as
unsupported unless the target falsely claims they already happened.

## Review procedure

1. Hide mode and other runs when practical.
2. Read the target output once before opening ground truth.
3. Assign a verdict and a short evidence-based note for every expected fact.
4. Record repeated failed paths and unsupported claims verbatim but do not copy
   secrets.
5. Run the deterministic scorer.
6. A second reviewer resolves disputed or close cases; preserve both initial
   annotations in the review log when a verdict changes.
