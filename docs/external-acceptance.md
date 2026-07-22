# External handoff acceptance

AgentCarry v0.1 needs at least ten distinct people who did not author the
repository to attempt one real Codex to Claude Code handoff. The cohort must
include both Windows and macOS. Failed attempts are useful and remain in the
denominator; the gate requires ten complete, auditable records, not a fabricated
100% success rate.

[简体中文](external-acceptance.zh-CN.md)

## Who can participate

A participant must not have authored an AgentCarry commit or pull request before
the attempt. Use your own GitHub account to submit the result. The public handle
is the only participant identifier retained.

You need Node.js 22 or newer plus already installed and configured Codex and
Claude Code CLIs. AgentCarry does not install those agents, start login, choose a
provider, or change authentication.

## Two-minute terminal path

Install the pinned acceptance build directly from the public repository:

```text
npm install --global github:Jettlin927/agentcarry#v0.1.0-acceptance.1
```

Open a repository containing a real, completed Codex task and run:

```text
agentcarry doctor
agentcarry continue --to claude
```

Start a timer when you enter the `continue` command. Read the displayed source,
first action, loss receipt, and two target steps. Answer the single confirmation
yourself. Stop the timer only when Claude begins the recorded first action. A
session opening or acknowledgment alone is not Continuation.

If automatic source selection is ambiguous, retry once with the displayed
completed session ID:

```text
agentcarry continue --to claude --session <id>
```

Do not use `--force` unless you understand and explicitly accept every named
critical loss. Do not change agent installation, login, model, provider, or
permissions merely to make the acceptance attempt pass.

## What to record

Record only:

- Windows or macOS version and architecture;
- the `agentcarry --version` result plus Node.js, Codex, and Claude Code versions;
- idle/active source and automatic/explicit selection;
- whether a target session was created, whether the recorded first action began,
  and the resulting continued/blocked outcome;
- exact command-start and outcome timestamps in UTC;
- seconds from command entry to outcome, and to Continuation when successful;
- loss codes;
- whether a Manual Supplement was required and its category;
- a stable blocker code and phase after failure.

Never submit keys, provider output, email addresses, screenshots, complete
messages, transcript excerpts, session files, or local paths. A Manual
Supplement record says which category was missing; it does not reproduce the
private information. The Issue form uses enumerated categories and codes instead
of free-form supplement or blocker descriptions.

## Submit the record

Open the repository's **External handoff acceptance** Issue form from the same
GitHub account named in the form. A maintainer must verify that the Issue author
matches the participant, check that the participant had no AgentCarry repository
author history at the time of the attempt, and complete a privacy review. The
maintainer records their handle, review time, and all three checks in `review`,
resolves the pinned acceptance tag to its 40-character commit, then materializes
a record conforming to
[`external-handoff-record.v1.schema.json`](../schema/external-handoff-record.v1.schema.json)
under `acceptance/runs/`. The Issue URL is the audit evidence. A blocked record
must also link a separate follow-up failure Issue; a blocker code in the
acceptance form is not sufficient. These checks are required record fields, so
an unreviewed submission cannot pass the cohort gate. The validator deliberately
keeps CI independent of the GitHub API; reviewers can audit every evidence link.
For this v0.1 cohort the schema accepts only repository owner `Jettlin927` as
`reviewedBy`. The completion command validates that attestation and the public
links; it does not claim cryptographic or live-API proof of the underlying facts.

Maintainers run:

```text
npm run acceptance:validate
npm run acceptance:report -- --output acceptance/REPORT.md
npm run acceptance:check-report
npm run acceptance:report -- --require-complete
```

The report check fails when the committed report differs from the reviewed
records. The final command fails until there are at least ten distinct reviewed
participants and both platforms. The report publishes continuation rate, Time
to Continuation, Manual Supplement frequency, common loss codes, and blocker
counts.
