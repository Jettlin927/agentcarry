# Privacy

AgentCarry is designed to operate locally.

## Data read

Depending on the selected adapter, AgentCarry may read local coding-agent session
files, repository instructions, file metadata, and read-only Git state. It reads
only the selected session and workspace facts needed for a handoff.

For an explicitly active handoff, the current source agent sends one structured
checkpoint through process stdin after native capture. The checkpoint is
schema-validated, evidence-hashed, redacted with the rest of the capsule, and is
not placed in process arguments or persisted by AgentCarry.

AgentCarry never opens native source storage for writing. A still-running source
agent may append its own normal invocation events; AgentCarry treats the
verified pre-checkpoint byte prefix as the immutable snapshot of record.

Repository instruction contents are not copied into the Work Capsule. AgentCarry
records only their path, SHA-256, and scope so the target agent can reread its
native instructions. Dirty workspace files are represented by path, state, and a
streamed SHA-256 when the file still exists; AgentCarry does not copy file bodies
into the capsule.

## Data stored

Capsules are temporary by default and deleted after target launch. With explicit
`--output` or `--keep-capsule`, the user chooses a persistent destination.
Lightweight lineage may contain session identifiers, timestamps, capsule hashes,
and loss summaries, but not a duplicated transcript.

## Network

The deterministic path requires no AgentCarry network service. A
source-assisted path may invoke a user-configured local coding agent; the target
agent's own provider and privacy terms then apply. AgentCarry does not add
telemetry, analytics, crash reporting, cloud sync, or automatic update checks.

## Secrets

High-confidence secrets are removed before capsules are rendered or passed to a
target. Redaction is defense in depth, not a guarantee that arbitrary transcript
text contains no sensitive information. The loss receipt reports redactions
without echoing secret values.
