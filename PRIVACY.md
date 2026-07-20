# Privacy

AgentCarry is designed to operate locally.

## Data read

Depending on the selected adapter, AgentCarry may read local coding-agent session
files, repository instructions, file metadata, and read-only Git state. It reads
only the selected session and workspace facts needed for a handoff.

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

