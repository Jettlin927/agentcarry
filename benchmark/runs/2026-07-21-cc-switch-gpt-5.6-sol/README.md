# First 36 routed-provider benchmark run

Status: **raw collection complete; final human review pending**.

This directory contains all 36 initial inputs and outputs. No failed or weaker
initial result was replaced with a rerun.

## Target route

```text
AgentCarry collector
  -> Claude Code CLI harness
  -> CC Switch 3.17.0 local routing
  -> ChatGPT Codex OAuth owned by the operator
  -> gpt-5.6-sol
```

This is not a native Anthropic Claude-model benchmark. It measures AgentCarry
handoff fidelity when Claude Code is used as the target CLI harness and CC
Switch routes the request to `gpt-5.6-sol`.

The collector did not install either CLI, manage authentication, or serialize a
credential. `plan.json` records the public route label
`cc-switch-codex-oauth`, exact upstream model, and the explicit dependency on
Claude Code user settings. The detailed CC Switch mapping remains
operator-managed state outside AgentCarry.

## Reproduce or resume

```shell
npm run --silent benchmark:collect -- benchmark/fixtures \
  --model gpt-5.6-sol \
  --setting-sources user \
  --provider cc-switch-codex-oauth \
  --output benchmark/runs/2026-07-21-cc-switch-gpt-5.6-sol
```

The first execution reported `completed=36, skipped=0`. A second identical
execution validated every stored artifact and reported
`completed=0, skipped=36`.

## Integrity checks

- plan entries: 36;
- input artifacts: 36;
- result artifacts: 36;
- unique run IDs: 36;
- target model/provider/setting mismatches: 0;
- empty target outputs: 0;
- files matching the benchmark credential-leak scan: 0.

## Advisory-only preview

[`advisory-verdicts.json`](advisory-verdicts.json) records an AI review
suggestion for every run. Every fact not listed as an exception has the
suggested verdict `preserved`. This file is not a human assessment and cannot
be used to claim final benchmark completion.

The current advisory preview is:

| Mode | Mean fidelity | Critical constraints preserved | Correct next action | Mean exact-input-token ratio |
| --- | ---: | ---: | ---: | ---: |
| visible transcript | 78.12 | 12/12 | 2/12 | 1.0000 |
| deterministic capsule | 97.29 | 12/12 | 4/12 | 2.2027 |
| source-assisted capsule | 95.21 | 12/12 | 3/12 | 1.8262 |

The preview exposes two real problems rather than a passing launch result:

1. Both capsule modes frequently lose action ordering such as “write the test,
   then implement.”
2. Both capsule modes are larger than the short visible baselines, so the v1
   40% token gate fails decisively. Exact input tokens include fixed target CLI
   and system overhead; the published v1 gate still uses the committed metric
   and must not be rewritten after seeing the result.

## Required human review

A human reviewer should use the self-contained [`REVIEW.html`](REVIEW.html)
workbench: it presents the exact input and output side by side, stores progress
only in the local browser, and exports the completed decisions as JSON.
[`REVIEW_PACKET.md`](REVIEW_PACKET.md) remains the non-interactive archival
copy. The reviewer must confirm or correct all suggested verdicts and own the
final timestamp. Only then may the repository materialize final assessments,
deterministic scores, and the aggregate PASS/FAIL report. The required action is tracked in
[GitHub Issue #5](https://github.com/Jettlin927/agentcarry/issues/5).
