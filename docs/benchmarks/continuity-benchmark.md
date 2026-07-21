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

All three inputs are generated from the same `source` and `workspace` fixture
fields. Input builders never read `groundTruth`:

```shell
npm run --silent benchmark:input -- <fixture.json> --mode visible-transcript
npm run --silent benchmark:input -- <fixture.json> --mode deterministic-capsule
npm run --silent benchmark:input -- <fixture.json> --mode source-assisted-capsule --model <model>
```

Visible mode includes only user and assistant messages. Deterministic mode uses
fixed event-role and text heuristics and reports that semantic limitation as a
loss. Source-assisted mode invokes a fresh Claude Code print session with no
tools, no slash commands, strict empty MCP configuration, and
`--no-session-persistence`; it never resumes the source session.

Every artifact records a fingerprint of the same source, byte and character
counts, generation settings, and summarizer usage when applicable. Exact target
input tokens are attached from the target run response; they are not replaced by
an undocumented tokenizer estimate.

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

Reviewers use the committed [human review rubric](../../benchmark/HUMAN_REVIEW_RUBRIC.md)
and record one fact-level assessment per expected ground-truth item. The scorer
then produces deterministic JSON or Markdown without model inference:

```shell
npm run --silent benchmark:score -- <fixture.json> <assessment.json> --format json
npm run --silent benchmark:score -- <fixture.json> <assessment.json> --format markdown
```

## v0.1 success gate

- deterministic or source-assisted capsule fidelity is no worse than baseline;
- critical constraints are 100%;
- the target does not repeat a recorded failed path;
- the next action is correct;
- unsupported claims and hallucinations are no worse than baseline;
- capsule input uses no more than 40% of baseline tokens.

Results must be published even if a gate fails.

## Aggregate report integrity

The final report consumes exactly 36 human-reviewed initial score reports: one
for every fixture and mode. It rejects missing or duplicate pairs and mixed
target agents, models, or settings. Capsule gates compare every fixture with its
visible baseline; a better mean cannot hide a regression on one fixture.

Reruns are disclosed separately and never replace an initial score:

```shell
npm run --silent benchmark:report -- <result-set.json> --format markdown
npm run --silent benchmark:report -- <result-set.json> --format json
```

The report prints PASS or FAIL for fidelity, critical constraints, correct next
action, repeated failed paths, unsupported claims, token ratio, each capsule
mode, and the overall Phase 0 gate.

## Reproducible target collection

Inspect the exact 36-run plan without starting Claude Code or writing an output
directory:

```shell
npm run --silent benchmark:collect -- benchmark/fixtures --model <exact-model> --plan
```

After target authentication is independently working, collect raw inputs and
outputs locally:

```shell
npm run --silent benchmark:collect -- benchmark/fixtures --model <exact-model> --output <directory>
```

Every target run is a fresh Claude Code print session with one fixed system
prompt, no tools, no persistence, no slash commands, an empty strict MCP set,
plan permission mode, one turn, and no setting sources. The runner records the
raw response plus normal, cache-creation, and cache-read input tokens. It writes
each generated input before its target call and creates each initial result with
exclusive-write semantics. A failed later call leaves earlier evidence intact;
re-running the same plan skips validated results and never overwrites them.

The collector does not install Claude Code, log in, repair credentials, review
outputs, score facts, or hide failed runs. Human review and deterministic scoring
remain separate steps.

## Human review packet and finalization

Generate the self-contained browser workbench. It shows the exact handoff input
and target output side by side, keeps pass/fail decisions in browser-local
storage, allows fact-level corrections, and exports the review as JSON:

```shell
npm run --silent benchmark:review -- html benchmark/fixtures <run-directory> \
  --output <run-directory>/REVIEW.html
```

The Markdown packet remains available as a non-interactive archival form of the
same evidence:

```shell
npm run --silent benchmark:review -- packet benchmark/fixtures <run-directory> \
  --output <run-directory>/REVIEW_PACKET.md
```

Both views remain advisory until a human checks every run. After the reviewer
exports the browser decisions and records an approval or corrections in an
auditable location, materialize all assessments, deterministic scores, and
aggregate reports atomically:

```shell
npm run --silent benchmark:review -- finalize benchmark/fixtures <run-directory> \
  --output <run-directory>/final \
  --review-file <exported-human-review.json> \
  --confirmation-source <issue-comment-url> \
  --human-confirmed
```

Finalization refuses to overwrite an existing output directory. It validates
all 12 fixtures, 36 target results, 36 advisory entries, 36 completed browser
decisions, every fact ID and verdict, reviewer metadata, and aggregate integrity
before publishing `assessments/`, `scores/`, `human-review.json`,
`result-set.json`, `report.json`, and `REPORT.md`.

### Explicit routed-provider mode

Some local routing tools configure Claude Code through its user settings. The
collector can opt into that dependency, but never does so implicitly:

```shell
npm run --silent benchmark:collect -- benchmark/fixtures \
  --model <exact-upstream-model> \
  --setting-sources user \
  --provider <public-route-label> \
  --output <directory>
```

`--setting-sources user` requires `--provider`. Both values are written to the
plan and every result, while credential values are neither read into the result
model nor serialized. The explicit model must describe the actual upstream
model, not a Claude role alias. Use this mode only with trusted local settings:
Claude Code may load user-defined hooks and other behavior from that file even
though the benchmark still disables tools, persistence, slash commands, and MCP.

A routed non-Anthropic model measures the AgentCarry handoff through the Claude
Code CLI harness; it is not evidence about the quality of a native Claude model.
