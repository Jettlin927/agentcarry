# Benchmark v2 second-36 — collection complete, human review pending

This directory contains the complete raw second-36 collection. It is not a
final benchmark result until a human reviews all 36 continuations and the
repository materializes the signed review export.

## Fixed target

- Claude Code: `2.1.158`
- target model: `gpt-5.6-sol`
- provider route: `cc-switch-codex-oauth`
- setting sources: `user`
- plan: 12 fixtures × 3 modes = 36 initial target continuations
- token method: `target-calibration-delta-v1`
- fixed target overhead: 1351 input tokens

No credential value is serialized. AgentCarry did not install or authenticate
the target agent.

## Complete evidence

- raw handoff inputs: 36 / 36
- raw target results: 36 / 36
- canonical Work Capsule input measurements: 24 / 24
- AI advisory entries: 36 / 36
- human review: pending
- aggregate report: intentionally not materialized before human review

The 24 files under `canonical-baselines/` measure each original canonical JSON
Capsule through the same target, wrapper, and fixed-overhead calibration as the
compiled continuation brief. They are metering calls, not additional
continuation results. The visible-transcript ratio remains reported, while the
40% compression gate compares the compiled brief with its matching canonical
Capsule measurement, as decided in
[Issue #49](https://github.com/Jettlin927/agentcarry/issues/49).

## Restart and interruption disclosure

The two pre-decision target results used to discover the invalid visible-token
gate were not mixed into this aggregate. Their original plan, 1349-token
calibration, inputs, results, and README are preserved under `pre-decision/`;
the rejected historical v1 source-assisted artifact remains under `rejected/`.
The final second-36 collection restarted all 36 initial results with one
1351-token calibration after the metric decision.

During that full collection, the provider returned one stream body decoding
error while generating the source-assisted input for
`feature-02-deploy-dry-run`. The failure happened before that input or any
target result was persisted. The exclusive-write collector resumed the same
plan, validated and skipped the existing 23 target results, then completed the
remaining 13. No persisted initial result was overwritten or replaced during
that resume.

## Human review

`advisory-verdicts.json` is an AI-only first pass and cannot finalize the
benchmark. `REVIEW.html` is the self-contained Chinese review workbench: it
shows the exact target payload and response side by side, supports pass/fail and
fact-level corrections, lets the reviewer replace AI suggestions for repeated
failed paths and unsupported claims, stores progress locally in the browser,
and exports the required v2 human-review JSON. Final scoring enforces the human
outcome and those risk-list corrections. `REVIEW_PACKET.md` is the
non-interactive archive.

After all 36 rows are personally reviewed, finalize with an auditable Issue
comment URL:

```shell
npm run --silent benchmark:review -- finalize benchmark/fixtures \
  benchmark/runs/2026-07-23-cc-switch-gpt-5.6-sol-v2 \
  --output benchmark/runs/2026-07-23-cc-switch-gpt-5.6-sol-v2/final \
  --review-file <exported-human-review.json> \
  --confirmation-source <issue-comment-url> \
  --human-confirmed
```

Do not present this directory as a completed or passing benchmark until that
finalization succeeds and the resulting report is committed.
